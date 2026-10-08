// Annonces Discord — module communautaire de Curiosa. Porté de l'ancien site, sans aucune connaissance de ce qui est annoncé :
// il digère les sujets « core.entry » (toute entrée publiée) et « feed.item » (tout ce qu'un module offre au flux RSS).
//
// Webhook entrant : pas de bot. Principe anti-doublon : chaque élément a une clé mémorisée dans le stockage ; un élément inconnu n'est annoncé
// que s'il est récent, un plus ancien est seulement noté comme vu (brancher le webhook n'inonde pas le salon). Un envoi qui échoue est retenté
// à chaque passage tant que l'élément reste récent.
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const MAX_PER_RUN = 5;
const KEEP_KNOWN_MS = 90 * 24 * 3600_000;
const KEEP_LOG = 200;

export const isWebhook = (url) => typeof url === "string" && WEBHOOK.test(url.trim());

/** Envoi brut, ne lève jamais. Les pings ne partent que si `mentions`. */
export async function post(url, content, mentions) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: String(content).slice(0, 2000), allowed_mentions: { parse: mentions ? ["everyone", "roles"] : [] } }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, status: res.status };
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: res.status, error: detail || res.statusText || `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, status: null, error: String(error?.message ?? error).slice(0, 300) };
  }
}

/** Chemin du site (`/x`, jamais `//hôte`) ou adresse http(s) ; tout autre schéma (javascript:, data:…) est refusé. */
const absolute = (site, v) => {
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return /^\/(?!\/)/.test(s) ? `${site}${s}` : null;
};

/** Éléments candidats : { key, title, url, at } — l'adresse est toujours absolue, jamais autre chose que http(s). */
async function candidates(ctx) {
  const site = ctx.api.siteUrl.replace(/\/$/, "");
  const [entries, items, lives] = await Promise.all([
    ctx.api.topics.collect("core.entry", { limit: 30 }).catch(() => []),
    ctx.api.topics.collect("feed.item", { limit: 30 }).catch(() => []),
    ctx.api.topics.collect("stream.live", { limit: 5 }).catch(() => []),
  ]);
  const out = [];
  for (const e of entries) {
    const target = e.path || e.url;
    if (!target || !e.title) continue;
    out.push({ key: `entry:${e.source?.instance ?? ""}:${e.path ?? e.url}`, title: String(e.title), url: absolute(site, e.path ?? e.url), at: e.publishedAt });
  }
  for (const i of items) {
    if (!i.url || !i.title) continue;
    out.push({ key: `item:${i.id ?? i.url}`, title: String(i.title), url: absolute(site, i.url), at: i.publishedAt });
  }
  for (const l of lives) {
    if (!l.id || !l.title) continue;
    out.push({ key: `live:${l.id}`, live: true, game: l.game ? String(l.game) : "", title: String(l.title), url: absolute(site, l.url), at: l.startedAt });
  }
  return out.filter((c) => c.url);
}

async function logSend(ctx, key, subject, result) {
  const rows = await ctx.api.store.list("log", { limit: KEEP_LOG });
  const previous = !result.ok && rows.find((r) => r.data.key === key && !r.data.ok);
  if (previous) await ctx.api.store.update(previous.id, { ...previous.data, attempts: (previous.data.attempts ?? 1) + 1, status: result.status, error: result.error, at: new Date().toISOString() });
  else await ctx.api.store.add("log", { key, subject: subject.slice(0, 300), ok: result.ok, status: result.status ?? null, error: result.error ?? null, attempts: 1, at: new Date().toISOString() });
  for (const old of rows.slice(KEEP_LOG - 1)) await ctx.api.store.remove(old.id);   // journal borné
}

/** Un passage : annonce ce qui est nouveau et récent. Exporté pour les tests. */
export async function announce(ctx, now = Date.now()) {
  const url = String(ctx.setting("webhookUrl") ?? "").trim();
  if (!isWebhook(url)) return { sent: 0, skipped: 0 };
  const fresh = Math.min(24 * 90, Math.max(1, Number(ctx.setting("freshHours")) || 24)) * 3600_000;
  const mention = String(ctx.setting("mention") ?? "").trim();
  const prefix = String(ctx.setting("prefix") ?? "📰").trim();
  const known = new Set((await ctx.api.store.list("known", { limit: 5000 })).map((r) => r.data.key));
  let sent = 0, skipped = 0;
  let liveAt = Math.max(0, ...(await ctx.api.store.list("known", { limit: 5000 })).filter((r) => String(r.data.key).startsWith("live:") && r.data.sent).map((r) => r.data.at));
  for (const c of await candidates(ctx)) {
    if (known.has(c.key)) continue;
    const at = Date.parse(c.at ?? "");
    if (!Number.isFinite(at) || now - at > fresh) { await ctx.api.store.add("known", { key: c.key, at: now }); known.add(c.key); skipped++; continue; }
    if (sent >= MAX_PER_RUN) break;
    if (c.live) {
      // Une coupure de connexion relance souvent le stream : deux lives rapprochés = le même.
      const cooldown = Math.max(0, Number(ctx.setting("liveCooldownHours") ?? 2)) * 3600_000;
      if (liveAt && now - liveAt < cooldown) { await ctx.api.store.add("known", { key: c.key, at: now }); known.add(c.key); skipped++; continue; }
    }                                    // le reste au passage suivant : jamais de rafale
    const head = c.live ? `🔴 ${c.title}${c.game ? ` (${c.game})` : ""}` : `${prefix ? `${prefix} ` : ""}${c.title}`;
    const text = `${mention ? `${mention} ` : ""}${head}\n${c.url}`;
    const result = await post(url, text, Boolean(mention));
    await logSend(ctx, c.key, c.title, result);
    if (result.ok) { await ctx.api.store.add("known", { key: c.key, at: now, sent: true }); known.add(c.key); sent++; if (c.live) liveAt = now; }
    else if (result.status === 429) break;                             // limite de débit Discord : on attend le passage suivant
  }
  // Ménage : les clés vues il y a longtemps n'ont plus d'intérêt (l'élément n'est plus « récent »).
  for (const r of await ctx.api.store.list("known", { limit: 5000 })) if (now - (r.data.at ?? now) > KEEP_KNOWN_MS) await ctx.api.store.remove(r.id);
  return { sent, skipped };
}

export default {
  tasks: { announce: { everyMinutes: 1, run: (ctx) => announce(ctx).then(() => undefined) } },

  async adminPanel(ctx) {
    const url = String(ctx.setting("webhookUrl") ?? "").trim();
    const ok = isWebhook(url);
    const blocks = [{ type: "heading", text: ctx.t("adminTitle") }, { type: "markdown", text: ctx.t(ok ? "configured" : "notConfigured") }];
    if (ok) blocks.push({ type: "adminForm", action: "test", title: ctx.t("testTitle"), submitLabel: ctx.t("testSubmit"), fields: [] });
    const log = await ctx.api.store.list("log", { limit: 50 });
    blocks.push({ type: "heading", text: ctx.t("logTitle") });
    if (!log.length) blocks.push({ type: "markdown", text: ctx.t("noLog") });
    else blocks.push({
      type: "table",
      columns: [ctx.t("colDate"), ctx.t("colSubject"), ctx.t("colResult")],
      rows: log.map((r) => [String(r.data.at).slice(0, 16).replace("T", " "), String(r.data.subject), r.data.ok ? ctx.t("resultOk") : ctx.t("resultFailed", { status: r.data.status ?? "—", attempts: r.data.attempts ?? 1, error: r.data.error ?? "" })]),
    });
    return blocks;
  },

  adminActions: {
    async test(ctx) {
      const url = String(ctx.setting("webhookUrl") ?? "").trim();
      if (!isWebhook(url)) return { error: ctx.t("errNoWebhook") };
      const site = await ctx.api.site(ctx.locale);
      const result = await post(url, ctx.t("testMessage", { site: site.name }), false);
      await logSend(ctx, "test", "Test", result);
      return result.ok ? { ok: ctx.t("okTest") } : { error: ctx.t("errTest", { error: result.error ?? result.status }) };
    },
  },
};

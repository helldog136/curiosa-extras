// Annonces Discord — module communautaire de Curiosa. Porté de l'ancien site, sans aucune connaissance de ce qui est annoncé :
// il digère les sujets « core.entry » (toute entrée publiée) et « feed.item » (tout ce qu'un module offre au flux RSS).
//
// Les directs : Twitch (sujet `stream.live`) et, depuis la 1.1.0, YouTube (service FACULTATIF `youtube.live` de Chaîne YouTube, méthode `current`). Un direct n'est annoncé
// qu'une fois (clé `live:<id>` / `live:yt:<identifiant de vidéo>`), deux directs rapprochés comptent pour le même (délai entre deux annonces), et si les deux plateformes sont en
// direct en même temps, UN message les cite toutes les deux (ou un seul message pour la première, selon le réglage). YouTube coûte 2 unités de limite par vérification : voir youtubeLives().
//
// Webhook entrant : pas de bot. Principe anti-doublon : chaque élément a une clé mémorisée dans le stockage ; un élément inconnu n'est annoncé
// que s'il est récent, un plus ancien est seulement noté comme vu (brancher le webhook n'inonde pas le salon). Un envoi qui échoue est retenté
// à chaque passage tant que l'élément reste récent.
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const MAX_PER_RUN = 5;
const KEEP_KNOWN_MS = 90 * 24 * 3600_000;
const KEEP_LOG = 200;
const YT_SERVICE = "youtube.live";
const VIDEO_RE = /^[\w-]{11}$/;
/** Millisecondes, dans un objet pour que les tests puissent les raccourcir. */
export const YT = { forceMs: 60_000, waitMs: 8_000, minMinutes: 5, maxMinutes: 60, defaultMinutes: 10 };

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
    out.push({ key: `live:${l.id}`, live: true, platform: "twitch", game: l.game ? String(l.game) : "", title: String(l.title), url: absolute(site, l.url), at: l.startedAt });
  }
  return out.filter((c) => c.url);
}

/* ───────────── YouTube ───────────── */

const oneLine = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// Désactivé par défaut (la propriétaire ne doit pas voir arriver des messages qu'elle n'a pas demandés) : seule la valeur « oui » l'active ; une instance sans valeur compte pour « non ».
const ytEnabled = (ctx) => ctx.setting("youtubeLive") === true;
const ytMinutes = (ctx) => { const n = Math.trunc(Number(ctx.setting("youtubeCheckMinutes"))); return Number.isFinite(n) && n >= YT.minMinutes && n <= YT.maxMinutes ? n : YT.defaultMinutes; };

/**
 * Les directs YouTube en cours : [{ videoId, title, startedAt }]. Chaque vérification coûte 2 unités de la limite du jour de YouTube et la tâche passe chaque minute : on ne demande donc
 * qu'une fois toutes les N minutes (réglage, 10 par défaut = 2,9 % de la limite du jour), la réponse est gardée dans le stockage (elle survit à un redémarrage), jamais `fresh`.
 * Exception : juste avant d'annoncer un direct (`force`), on revérifie si la dernière vérification a plus d'une minute, pour savoir si l'autre plateforme est en direct aussi (un seul message).
 * Sans Chaîne YouTube : aucun appel, rien d'écrit. Panne ou limite atteinte : on note l'heure et on n'insiste pas avant la prochaine échéance. Ne lève jamais.
 */
async function youtubeLives(ctx, now, { force = false } = {}) {
  try {
    if (typeof ctx.api.services?.callAll !== "function") return [];
    const doc = (await ctx.api.store.list("yt", { limit: 1 }))[0];
    const age = doc ? now - Number(doc.data?.at) : Infinity;
    if (age >= 0 && age < (force ? YT.forceMs : ytMinutes(ctx) * 60_000)) return Array.isArray(doc.data.lives) ? doc.data.lives : [];
    let timer;
    const answers = await Promise.race([ctx.api.services.callAll(YT_SERVICE, "current", {}), new Promise((r) => { timer = setTimeout(() => r(null), YT.waitMs); })]).finally(() => clearTimeout(timer)).catch(() => null);
    if (Array.isArray(answers) && answers.length === 0) return [];     // aucune Chaîne YouTube : rien à mémoriser
    const lives = [];
    for (const a of Array.isArray(answers) ? answers : []) {
      const v = a?.ok ? a.value : null;
      if (v?.ok === true && v.live === true && VIDEO_RE.test(String(v.videoId ?? "")) && !lives.some((l) => l.videoId === v.videoId)) {
        const started = Date.parse(v.startedAt ?? "");
        lives.push({ videoId: v.videoId, title: oneLine(v.title, 100), startedAt: Number.isFinite(started) ? new Date(started).toISOString() : null });
      }
    }
    const data = { at: now, lives: lives.slice(0, 3) };
    if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add("yt", data);
    return data.lives;
  } catch { return []; }
}

/** Les directs YouTube sous la forme des autres éléments. Un direct sans heure de début est « tout frais » (YouTube ne le dit pas toujours). */
const youtubeCandidates = (lives, now) => lives.map((l) => ({ key: `live:yt:${l.videoId}`, live: true, platform: "youtube", game: "", title: l.title, url: `https://www.youtube.com/watch?v=${l.videoId}`, at: l.startedAt ?? new Date(now).toISOString() }));

const NO_PING = (v) => v.replace(/@/g, "@\u200b");
/**
 * Le texte d'une annonce de direct. `group` : 1 ou 2 directs (Twitch, YouTube) annoncés ensemble.
 * Sans texte personnalisé : Twitch seul = le message d'avant, à l'identique ; sinon une phrase simple (« En direct sur YouTube : titre ») suivie du ou des liens.
 * Avec le texte personnalisé (réglage « Texte de l'annonce ») : {platform}, {title}, {game}, {url} (les liens, un par ligne avec le nom de la plateforme s'il y en a deux) ; sans {url}, les liens sont ajoutés à la fin.
 */
export function liveText(ctx, group) {
  const tpl = String(ctx.setting("liveText") ?? "").trim().slice(0, 500);
  const [first] = group;
  if (!tpl && group.length === 1 && first.platform === "twitch") return `🔴 ${first.title}${first.game ? ` (${first.game})` : ""}\n${first.url}`;
  const names = group.map((g) => ctx.t(g.platform === "youtube" ? "platformYoutube" : "platformTwitch"));
  const platform = group.length > 1 ? ctx.t("platformBoth") : names[0];
  const title = NO_PING(oneLine(first.title, 200));
  const game = NO_PING(oneLine(group.find((g) => g.game)?.game, 100));
  const links = group.length > 1 ? group.map((g, i) => ctx.t("linkLine", { platform: names[i], url: g.url })).join("\n") : first.url;
  if (!tpl) return `${ctx.t("liveDefault", { platform, title })}\n${links}`;
  const filled = tpl.replace(/\{(platform|title|game|url)\}/g, (_, k) => ({ platform, title, game, url: links })[k]).replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").trim();
  return /\{url\}/.test(tpl) ? filled : `${filled}\n${links}`;
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
  const cands = await candidates(ctx);
  const cooldownMs = Math.max(0, Number(ctx.setting("liveCooldownHours") ?? 2)) * 3600_000;
  const isFresh = (c) => { const at = Date.parse(c.at ?? ""); return Number.isFinite(at) && now - at <= fresh; };
  if (ytEnabled(ctx)) {
    // YouTube : vérifié toutes les N minutes ; revérifié tout de suite si un direct est sur le point d'être annoncé (pour savoir si les deux plateformes sont en direct).
    const aboutToAnnounce = cands.some((c) => c.live && !known.has(c.key) && isFresh(c)) && !(liveAt && now - liveAt < cooldownMs);
    cands.push(...youtubeCandidates(await youtubeLives(ctx, now, { force: aboutToAnnounce }), now));
  }
  const both = ctx.setting("liveBoth") !== "first";
  const handled = new Set();               // les directs déjà dits dans le même message
  for (const c of cands) {
    if (known.has(c.key) || handled.has(c.key)) continue;
    if (!isFresh(c)) { await ctx.api.store.add("known", { key: c.key, at: now }); known.add(c.key); skipped++; continue; }
    if (sent >= MAX_PER_RUN) break;
    if (c.live) {
      // Une coupure de connexion relance souvent le stream : deux lives rapprochés = le même. Cela vaut aussi d'une plateforme à l'autre.
      if (liveAt && now - liveAt < cooldownMs) { await ctx.api.store.add("known", { key: c.key, at: now }); known.add(c.key); skipped++; continue; }
    }                                    // le reste au passage suivant : jamais de rafale
    // Twitch ET YouTube en direct en même temps : un seul message qui cite les deux (réglage « Direct sur les deux »), jamais deux.
    const group = [c];
    if (c.live && both) {
      const other = cands.find((p) => p.live && p.platform !== c.platform && !known.has(p.key) && !handled.has(p.key) && isFresh(p));
      if (other) group.push(other);
    }
    const text = c.live ? liveText(ctx, group) : `${prefix ? `${prefix} ` : ""}${c.title}\n${c.url}`;
    const result = await post(url, `${mention ? `${mention} ` : ""}${text}`, Boolean(mention));
    await logSend(ctx, c.key, group.length > 1 ? `${c.title} (${group.map((g) => (g.platform === "youtube" ? "YouTube" : "Twitch")).join(" + ")})` : c.title, result);
    if (result.ok) {
      for (const g of group) { await ctx.api.store.add("known", { key: g.key, at: now, sent: true }); known.add(g.key); handled.add(g.key); }
      sent++; if (c.live) liveAt = now;
    }
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
    // YouTube : une phrase, seulement si la Chaîne YouTube est installée (sinon rien ne change pour ceux qui n'ont pas YouTube).
    try {
      const yt = typeof ctx.api.services?.providers === "function" ? await ctx.api.services.providers(YT_SERVICE) : [];
      if (Array.isArray(yt) && yt.length) blocks.push({ type: "markdown", text: ytEnabled(ctx) ? ctx.t("ytOn", { minutes: ytMinutes(ctx) }) : ctx.t("ytOff") });
    } catch { /* l'information est un plus */ }
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

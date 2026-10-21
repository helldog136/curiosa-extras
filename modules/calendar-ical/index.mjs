// Agenda en ligne — module communautaire de Curiosa. UN rôle : lire un agenda en ligne (Google Agenda et tout autre flux iCal) et le mettre à la
// disposition des autres modules sous forme de créneaux (sujet `planning.slot`). Il ne connaît aucun consommateur :
// le Planning l'affiche, le bot du chat le lit, et chacun fait de même sans savoir d'où viennent les créneaux.
// Le lecteur (ical.mjs) et le téléchargement (fetch.mjs, seul fichier qui parle réseau) vivent à côté ; ce fichier n'est que le module.
const V = new URL(import.meta.url).search;   // même « version » pour les fichiers voisins : après une mise à jour, jamais d'ancien code en mémoire
const { parseCalendar, expand, parseIcs, toSlot, isValidTimeZone } = await import(`./ical.mjs${V}`);
const { readIcs, clearCache, forget, isPublicHttpsUrl, timing } = await import(`./fetch.mjs${V}`);
const { extractGameNames } = await import(`./games.mjs${V}`);
const { tutorialHtml, skillMarkdown } = await import(`./tutorial.mjs${V}`);
export { parseCalendar, expand, parseIcs, toSlot, isValidTimeZone, extractGameNames, tutorialHtml, skillMarkdown };
export { readIcs, clearCache, forget, isPublicHttpsUrl, timing };

const DAY = 86_400_000;
const DEFAULT_SPAN_DAYS = 60;   // sans plage demandée : de maintenant à 60 jours
const MAX_SPAN_DAYS = 400;      // comme la plage maximale du cœur
const MAX_ITEMS = 200;

const text = (v) => String(v ?? "").trim();
const minutes = (v) => Math.min(120, Math.max(1, Math.trunc(Number(v)) || 5));

/** Les réglages de l'instance, nettoyés. Ne sort jamais l'adresse du module (elle ne va qu'à fetch.mjs). `zone` : celui choisi, sinon « » (on prend alors celui de l'agenda). */
function settingsOf(ctx) {
  const tz = text(ctx.setting("timezone"));
  return { url: text(ctx.setting("url")), zone: isValidTimeZone(tz) ? tz : "", ttlMs: minutes(ctx.setting("cacheMinutes")) * 60_000 };
}

/** Dernier fuseau retenu pour chaque instance (en mémoire), pour que le SKILL.md parle du bon fuseau. */
const lastRead = new Map();   // clé d'instance -> { zone }

/**
 * Lit le flux de l'instance et le développe sur [from, to]. Ne lève jamais.
 * Renvoie { ok, events (bruts, avec `cancelled`), zone (fuseau retenu), error?, status?, stale? }.
 */
export async function loadEvents(ctx, { from, to, force = false } = {}, fetchImpl = undefined) {
  const s = settingsOf(ctx);
  const r = await readIcs(s.url, { ttlMs: s.ttlMs, force, ...(fetchImpl ? { fetchImpl } : {}) });
  if (!r.ok) { return { ok: false, events: [], zone: s.zone || "UTC", error: r.error, status: r.status }; }
  if (!r.entry.model || r.entry.modelFor !== r.text) { r.entry.model = parseCalendar(r.text); r.entry.modelFor = r.text; }
  const zone = s.zone || r.entry.model.zone || "UTC";   // le choix de l'administrateur, sinon le fuseau que l'agenda annonce, sinon UTC
  const events = expand(r.entry.model, { timeZone: zone, from, to, keepCancelled: true });
  lastRead.set(ctx.instance.key, { zone });
  return { ok: true, events, zone, stale: !!r.stale, error: r.error, status: r.status };
}

/** Plage demandée par le consommateur (Date) -> [from, to] bornés. Sans plage : maintenant → +60 jours. */
export function windowOf({ from, to } = {}, now = Date.now()) {
  const a = from instanceof Date && !Number.isNaN(from.getTime()) ? from : null;
  const b = to instanceof Date && !Number.isNaN(to.getTime()) ? to : null;
  const lo = a ?? new Date(now);
  let hi = b ?? new Date(lo.getTime() + DEFAULT_SPAN_DAYS * DAY);
  if (hi.getTime() < lo.getTime()) hi = lo;
  if (hi.getTime() - lo.getTime() > MAX_SPAN_DAYS * DAY) hi = new Date(lo.getTime() + MAX_SPAN_DAYS * DAY);
  return [lo, hi];
}

export default {
  exports: {
    /** Les créneaux de la plage demandée (annulés compris, avec leur état : c'est au lecteur de décider). */
    async "planning.slot"(ctx, { limit, from, to } = {}) {
      const s = settingsOf(ctx);
      if (!s.url) return [];
      const [lo, hi] = windowOf({ from, to });
      const r = await loadEvents(ctx, { from: lo, to: hi });
      if (!r.ok) return [];
      const untitled = ctx.t("untitled");
      return r.events.slice(0, Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(limit)) || 50))).map((e) => toSlot(e, { timeZone: r.zone, untitled, gamesOf: extractGameNames }));
    },
  },

  routes: {
    // SKILL.md pour une IA (« Télécharger le skill »). Public : le contenu est généré à partir du fuseau et du nom du site, jamais de secret.
    async skill(request, ctx) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      const zone = settingsOf(ctx).zone || lastRead.get(ctx.instance.key)?.zone || "";
      return new Response(request.method === "HEAD" ? null : await skillMarkdown(ctx, zone), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="SKILL.md"', "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
    },
  },

  hooks: {
    /** Instance effacée (« tout effacer ») : plus aucune copie de l'agenda ni de son adresse en mémoire. En « garder mes données », cette fonction n'est pas appelée et rien n'est touché. */
    onInstanceDelete(ctx) {
      forget(text(ctx.setting("url")));
      lastRead.delete(ctx.instance.key);
    },
  },

  async adminPanel(ctx) {
    const t = ctx.t, s = settingsOf(ctx);
    // Pas d'adresse (ou adresse refusée) : c'est le champ « Adresse de votre agenda » (onglet Réglages, ouvert d'office) qu'il faut remplir. Le mode d'emploi pour la trouver
    // s'affiche donc DANS cet onglet, au-dessus du champ (`tab: "settings"`, cœur 0.2.5) ; Utiliser, resté vide, n'est pas affiché. Une fois l'adresse bonne : retour dans Utiliser.
    const toFill = (problem) => [{ type: "heading", text: t("adminStatus"), tab: "settings" }, { type: "markdown", text: problem, tab: "settings" }, { type: "html", html: tutorialHtml(ctx, s.zone || "UTC"), tab: "settings" }];
    if (!s.url) return toFill(t("adminNotSet"));
    if (!isPublicHttpsUrl(s.url)) return toFill(`⚠️ ${t("err_url")}`);
    const blocks = [{ type: "heading", text: t("adminStatus") }];
    let host = "";
    try { host = new URL(s.url).hostname; } catch { host = ""; }
    blocks.push({ type: "markdown", text: t("adminSaved", { host }) });
    const now = new Date(), r = await loadEvents(ctx, { from: now, to: new Date(now.getTime() + 30 * DAY) });
    if (!r.ok) {
      blocks.push({ type: "markdown", text: `⚠️ ${t(`err_${r.error}`, { status: r.status ?? "" })}` });
    } else {
      const upcoming = r.events.filter((e) => !e.cancelled);
      blocks.push({ type: "markdown", text: `✔ ${t("adminOk", { n: upcoming.length, cancelled: r.events.length - upcoming.length })}` });
      if (r.stale) blocks.push({ type: "markdown", text: `⚠️ ${t("adminStale", { reason: t(`err_${r.error}`, { status: r.status ?? "" }) })}` });
      if (upcoming.length) {
        const fmt = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: r.zone });
        const day = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: r.zone });
        blocks.push({ type: "table", columns: [t("colWhen"), t("colTitle"), t("colGames")], rows: upcoming.slice(0, 10).map((e) => [e.allDay ? `${day.format(e.start)} · ${t("allDay")}` : fmt.format(e.start), e.title || t("untitled"), extractGameNames(e.description).join(", ")]) });
      }
    }
    blocks.push({ type: "adminForm", action: "test", submitLabel: t("testBtn"), fields: [] });
    blocks.push({ type: "html", html: tutorialHtml(ctx, r.zone) });
    return blocks;
  },

  adminActions: {
    /** « Tester l'adresse » : relit le flux sans cache et dit clairement ce qui se passe. Jamais l'adresse dans la réponse. */
    async test(ctx) {
      const s = settingsOf(ctx), t = ctx.t;
      if (!s.url) return { error: t("adminNotSet") };
      if (!isPublicHttpsUrl(s.url)) return { error: t("err_url") };
      const now = new Date(), r = await loadEvents(ctx, { from: now, to: new Date(now.getTime() + 30 * DAY), force: true });
      if (!r.ok) return { error: t(`err_${r.error}`, { status: r.status ?? "" }) };
      return { ok: t("testOk", { n: r.events.filter((e) => !e.cancelled).length }), redirect: "?" };
    },
  },
};

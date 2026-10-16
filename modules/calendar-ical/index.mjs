// Calendrier iCal — module communautaire de Curiosa. UN rôle : lire un calendrier en ligne (Google Agenda et tout autre flux iCal) et le
// mettre à disposition des autres modules sous forme d'évènements BRUTS et NEUTRES (sujet `calendar.event`, service `calendar.provider`).
// Il ne connaît aucun consommateur : c'est le consommateur (le Planning, par exemple) qui interprète les textes.
// Le lecteur (ical.mjs) et le téléchargement (fetch.mjs, seul fichier qui parle réseau) vivent à côté ; ce fichier n'est que le module.
const V = new URL(import.meta.url).search;   // même « version » pour les fichiers voisins : après une mise à jour, jamais d'ancien code en mémoire
const { parseCalendar, expand, parseIcs, toCalendarEvent, isValidTimeZone } = await import(`./ical.mjs${V}`);
const { readIcs, clearCache, isPublicHttpsUrl } = await import(`./fetch.mjs${V}`);
export { parseCalendar, expand, parseIcs, toCalendarEvent, isValidTimeZone };
export { readIcs, clearCache, isPublicHttpsUrl };

const DAY = 86_400_000;
const DEFAULT_SPAN_DAYS = 60;   // sans plage demandée : de maintenant à 60 jours
const MAX_SPAN_DAYS = 400;      // comme la plage maximale du cœur
const MAX_ITEMS = 200;

const text = (v) => String(v ?? "").trim();
const hexColor = (v) => (/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(text(v)) ? text(v) : null);
const tagsOf = (v) => [...new Set(text(v).split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
const minutes = (v) => Math.min(120, Math.max(1, Math.trunc(Number(v)) || 5));

/** Les réglages de l'instance, nettoyés. Ne sort jamais l'adresse du module (elle ne va qu'à fetch.mjs). */
function settingsOf(ctx) {
  const tz = text(ctx.setting("timezone"));
  return {
    url: text(ctx.setting("url")), label: text(ctx.setting("label")).slice(0, 60), color: hexColor(ctx.setting("color")),
    tags: tagsOf(ctx.setting("tags")), timeZone: isValidTimeZone(tz) ? tz : "UTC", ttlMs: minutes(ctx.setting("cacheMinutes")) * 60_000,
  };
}

/** Dernière lecture de chaque instance (en mémoire : l'état est refait à la première lecture après un redémarrage). */
const lastRead = new Map();   // clé d'instance -> { at, ok, error?, status?, stale?, count? }

/**
 * Lit le flux de l'instance et le développe sur [from, to]. Ne lève jamais.
 * Renvoie { ok, events (bruts, avec `cancelled`), error?, status?, stale? }.
 */
export async function loadEvents(ctx, { from, to, force = false } = {}, fetchImpl = undefined) {
  const s = settingsOf(ctx);
  const r = await readIcs(s.url, { ttlMs: s.ttlMs, force, ...(fetchImpl ? { fetchImpl } : {}) });
  if (!r.ok) { lastRead.set(ctx.instance.key, { at: Date.now(), ok: false, error: r.error, status: r.status }); return { ok: false, events: [], error: r.error, status: r.status }; }
  if (!r.entry.model || r.entry.modelFor !== r.text) { r.entry.model = parseCalendar(r.text); r.entry.modelFor = r.text; }
  const events = expand(r.entry.model, { timeZone: s.timeZone, from, to, keepCancelled: true });
  lastRead.set(ctx.instance.key, { at: Date.now(), ok: true, stale: !!r.stale, error: r.error, status: r.status, count: events.length });
  return { ok: true, events, stale: !!r.stale, error: r.error, status: r.status };
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

/** Les étiquettes demandées par le consommateur correspondent-elles à celles de la source ? Aucune demande : tout passe. */
export const matchesTags = (wanted, own) => !Array.isArray(wanted) || wanted.length === 0 || wanted.some((t) => own.includes(String(t).toLowerCase()));

const stateOf = (ctx) => {
  const s = settingsOf(ctx), last = lastRead.get(ctx.instance.key);
  return { configured: !!s.url, valid: !s.url || isPublicHttpsUrl(s.url), last };
};

export default {
  exports: {
    /** Évènements bruts de la plage demandée, chacun avec l'étiquette et la couleur de CETTE source. */
    async "calendar.event"(ctx, { limit, tags, from, to } = {}) {
      const s = settingsOf(ctx);
      if (!s.url || !matchesTags(tags, s.tags)) return [];
      const [lo, hi] = windowOf({ from, to });
      const r = await loadEvents(ctx, { from: lo, to: hi });
      if (!r.ok) return [];
      const untitled = ctx.t("untitled");
      return r.events.slice(0, Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(limit)) || 50))).map((e) => ({
        ...toCalendarEvent(e, { timeZone: s.timeZone, untitled }),
        ...(s.label ? { sourceLabel: s.label } : {}), ...(s.color ? { color: s.color } : {}),
      }));
    },
  },

  services: {
    "calendar.provider": {
      /** { kind, label, color?, active, state, error? } — décrit cette source, sans appel réseau ni adresse. */
      async describe(ctx) {
        const s = settingsOf(ctx), { configured, valid, last } = stateOf(ctx);
        const state = !configured ? "unset" : !valid ? "error" : last ? (last.ok ? (last.stale ? "stale" : "ok") : "error") : "unknown";
        return { kind: "ical", label: s.label || null, color: s.color, active: configured && valid, state, ...(state === "error" ? { error: !valid ? "url" : last?.error } : {}) };
      },
    },
  },

  async adminPanel(ctx) {
    const t = ctx.t, s = settingsOf(ctx);
    const blocks = [{ type: "heading", text: t("adminStatus") }];
    if (!s.url) return [...blocks, { type: "markdown", text: t("adminNotSet") }];
    if (!isPublicHttpsUrl(s.url)) return [...blocks, { type: "markdown", text: `⚠️ ${t("err_url")}` }];
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
        const fmt = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.timeZone });
        const day = new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", timeZone: s.timeZone });
        blocks.push({ type: "table", columns: [t("colWhen"), t("colTitle")], rows: upcoming.slice(0, 10).map((e) => [e.allDay ? `${day.format(e.start)} · ${t("allDay")}` : fmt.format(e.start), e.title || t("untitled")]) });
      }
    }
    blocks.push({ type: "adminForm", action: "test", submitLabel: t("testBtn"), fields: [] });
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

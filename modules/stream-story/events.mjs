// Les événements à venir, de TOUTES les sources, remis dans un seul format puis agrégés : c'est la liste « Pour quoi veux-tu une story ? ».
// Ce fichier ne connaît ni Curiosa, ni le réseau, ni l'horloge (l'heure « maintenant » est donnée par l'appelant) : il nettoie, déduplique, trie, filtre et pagine.
// Les sources parlent à Story par le service `event.source` (méthode `upcoming`) ; l'agenda de streams parle par le sujet `planning.slot`. Story ne connaît aucune source par son nom
// de module : seulement un « type de source » (`kind` : calendar, youtube, twitch…) et un nom à afficher (`label`) que la source donne elle-même.
//
// LE CONTRAT D'UN ÉVÉNEMENT (celui qu'une source rend dans `events`) :
//   id        identifiant STABLE donné par la source, unique et préfixé par elle (« youtube:AbC123 ») : lettres, chiffres, « : _ . - », 100 caractères au plus ;
//   title     le titre (80 caractères au plus) ;
//   start     le début, en UTC (ISO 8601, « 2026-10-24T18:30:00Z ») ; pour une journée entière, `allDay: true` + `day` (« 2026-10-24 ») ;
//   timezone  le fuseau IANA de l'événement (« Europe/Paris »), ou vide quand la source ne le sait pas ;
//   end       la fin (facultative) ;
//   type      stream · live · premiere · video · event · other ;
//   url       le lien (https, facultatif) ; image : une image (https, facultative) ; games : jusqu'à 3 jeux (facultatif).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);

export const SERVICE = "event.source";
export const TYPES = ["stream", "live", "premiere", "video", "event", "other"];
/** Les bornes dures : tout ce qui arrive de plus est ignoré. */
export const LIMITS = { perSource: 100, total: 200, page: 50, pageDefault: 20, sources: 10, label: 40, note: 240, query: 80, title: P.LIMITS.title, url: 300, mergeMs: 15 * 60_000, pastMs: 3 * 3_600_000 };
/** Dans quel ordre les sources passent quand deux événements commencent en même temps (et laquelle garde la main quand deux sources parlent du même événement). */
export const SOURCE_ORDER = ["calendar", "twitch", "youtube"];
const rank = (kind) => { const i = SOURCE_ORDER.indexOf(kind); return i < 0 ? SOURCE_ORDER.length : i; };
export const sourceRank = rank;

const httpsUrl = (u, max = LIMITS.url) => {
  const s = String(u ?? "").trim();
  if (!s || s.length > max || /[\u0000- \u007f"'<>\\]/.test(s)) return "";
  try { const x = new URL(s); return x.protocol === "https:" && !x.username && !x.password ? x.href : ""; } catch { return ""; }
};

/** Qui parle : { kind, label } nettoyés (le type est une courte étiquette en minuscules, le nom une ligne de texte). `fallback` sert quand la source ne dit rien d'utilisable. */
export function cleanSource(raw, fallback = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const kind = typeof r.kind === "string" && P.SOURCE_KIND.test(r.kind) ? r.kind : P.SOURCE_KIND.test(fallback.kind ?? "") ? fallback.kind : "other";
  const label = P.oneLine(r.label, LIMITS.label) || P.oneLine(fallback.label, LIMITS.label) || kind;
  return { kind, label };
}

/**
 * Un événement tel qu'une source l'a donné → l'événement de Story, ou null s'il est inutilisable (sans identifiant sûr, sans début lisible).
 * Ne lève jamais. `source` : { kind, label } de celui qui l'a donné. Le fuseau de l'événement n'est gardé que s'il existe.
 */
export function cleanEvent(raw, source, { fallbackZone = "UTC" } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || !P.EVENT_ID.test(raw.id)) return null;
  if (raw.status === "cancelled" || raw.status === "canceled") return null;
  const t = P.eventTimes(raw, fallbackZone);
  if (!t) return null;
  const games = (Array.isArray(raw.games) ? raw.games : []).filter((g) => typeof g === "string").map((g) => P.oneLine(g, 80)).filter(Boolean).slice(0, 3);
  return {
    id: raw.id, title: P.oneLine(raw.title, LIMITS.title), start: new Date(t.startMs).toISOString(), startMs: t.startMs,
    end: new Date(t.endMs).toISOString(), endMs: t.endMs, allDay: t.allDay, day: t.day, timezone: t.zone,
    type: TYPES.includes(raw.type) ? raw.type : "event", source: source.kind, sourceLabel: source.label, alsoIn: [], ids: [raw.id],
    url: httpsUrl(raw.url), image: httpsUrl(raw.image), games, legacyKey: typeof raw.legacyKey === "string" && /^[a-z0-9]{1,20}$/.test(raw.legacyKey) ? raw.legacyKey : "",
  };
}

/**
 * La réponse du service d'une source → { kind, label, state, message, note, events }.
 *   state "ok" : la source a répondu (elle peut n'avoir rien à venir) ; "setup" : elle ne peut pas travailler tant qu'on ne l'a pas réglée (`message` dit quoi faire) ;
 *   "down" : elle ne répond pas pour l'instant. Une réponse illisible est une panne, jamais une exception.
 */
export function readAnswer(value, fallback, { fallbackZone = "UTC", max = LIMITS.perSource } = {}) {
  const r = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const source = cleanSource(r?.source, fallback);
  if (!r) return { ...source, state: "down", message: "", note: "", events: [] };
  const state = r.state === "setup" || r.state === "down" ? r.state : "ok";
  const events = [];
  for (const raw of Array.isArray(r.events) ? r.events.slice(0, max * 2) : []) {
    const e = cleanEvent(raw, source, { fallbackZone });
    if (e && events.length < max && !events.some((x) => x.id === e.id)) events.push(e);
  }
  return { ...source, state, message: P.oneLine(r.message, LIMITS.note), note: P.oneLine(r.note, LIMITS.note), events };
}

/** Les streams des agendas (sujet `planning.slot`) → événements de type « calendar ». Chaque agenda reste sans nom : c'est « le planning ». */
export function calendarEvents(items, nowMs, fallbackZone, source, max = LIMITS.perSource) {
  return P.upcomingStreams(items, nowMs, fallbackZone, max).map((s, i) => {
    const slot = (Array.isArray(items) ? items : []).find((x) => x && typeof x === "object" && P.streamKeyOf({ id: x.id, start: x.start, title: x.title }) === s.key);
    const stable = slot && typeof slot.id === "string" && slot.id ? P.shortHash(`${slot.id}|${slot.start}`) : P.shortHash(`${s.start}|${s.title}`);
    return {
      id: `calendar:${stable}`, title: s.title, start: s.start, startMs: s.startMs, end: new Date(s.startMs + (s.allDay ? 86_400_000 : 3_600_000)).toISOString(), endMs: s.startMs + (s.allDay ? 86_400_000 : 3_600_000),
      allDay: s.allDay, day: s.day, timezone: s.timezone, type: "stream", source: source.kind, sourceLabel: source.label, alsoIn: [], ids: [`calendar:${stable}`], url: "", image: "", games: s.games, legacyKey: s.key,
    };
  });
}

/* ───────────── Agréger, dédoublonner, trier ───────────── */

/** Un titre comparable : sans majuscules, sans accents, sans ponctuation. */
export const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Deux titres parlent-ils de la même chose ? Identiques une fois nettoyés, ou l'un contient l'autre (8 caractères au moins : « live » seul ne fusionne rien). */
function sameTitle(a, b) {
  const x = plain(a), y = plain(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 && long.includes(short);
}
/** Le même événement vu par deux sources : début à 15 minutes près (même jour pour une journée entière) et même titre, ou même lien. */
function sameEvent(a, b) {
  if (a.source === b.source && a.id !== b.id && !(sameTitle(a.title, b.title) && a.startMs === b.startMs && a.allDay === b.allDay)) return false;   // deux fiches d'une même source ne fusionnent que si elles sont identiques
  if (a.allDay !== b.allDay) return false;
  const close = a.allDay ? a.day === b.day && !!a.day : Math.abs(a.startMs - b.startMs) <= LIMITS.mergeMs;
  if (!close) return false;
  return (a.url && a.url === b.url) || sameTitle(a.title, b.title);
}
const byTime = (a, b) => a.startMs - b.startMs || rank(a.source) - rank(b.source) || plain(a.title).localeCompare(plain(b.title)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Les événements de toutes les sources : à venir (ou commencés depuis moins de 3 h), un seul par événement réel, triés à la minute près (sur l'instant UTC : le fuseau et l'heure d'été
 * n'y changent rien), `LIMITS.total` au plus. Le premier arrivé par ordre de source garde la main ; les autres s'ajoutent à `alsoIn` et à `ids`.
 */
export function aggregate(lists, nowMs, max = LIMITS.total) {
  const all = lists.flat().filter((e) => e.startMs >= nowMs - LIMITS.pastMs || e.endMs >= nowMs).sort(byTime);
  const kept = [];
  for (const e of all) {
    let twin = null;
    for (let i = kept.length - 1; i >= 0; i--) {
      const k = kept[i];
      if (!e.allDay && !k.allDay && e.startMs - k.startMs > LIMITS.mergeMs) break;
      if (sameEvent(k, e)) { twin = k; break; }
    }
    if (!twin) { kept.push({ ...e, alsoIn: [...e.alsoIn], ids: [...e.ids] }); continue; }
    if (twin.source !== e.source && !twin.alsoIn.some((s) => s.kind === e.source)) twin.alsoIn.push({ kind: e.source, label: e.sourceLabel });
    for (const id of e.ids) if (!twin.ids.includes(id) && twin.ids.length < 8) twin.ids.push(id);
    if (!twin.url && e.url) twin.url = e.url;
    if (!twin.image && e.image) twin.image = e.image;
    if (!twin.games.length && e.games.length) twin.games = e.games;
    if (!twin.legacyKey && e.legacyKey) twin.legacyKey = e.legacyKey;
    if (!twin.timezone && e.timezone) twin.timezone = e.timezone;
  }
  return kept.sort(byTime).slice(0, max);
}

/** Retrouve un événement par son identifiant (celui qu'il porte ou celui d'une source qui parlait du même), ou par l'ancienne clé d'un stream d'agenda. */
export function findEvent(events, { id = "", key = "" } = {}) {
  if (id) { const hit = events.find((e) => e.id === id || e.ids.includes(id)); if (hit) return hit; }
  if (key) return events.find((e) => e.legacyKey === key) ?? null;
  return null;
}

/* ───────────── Chercher, filtrer, paginer ───────────── */

/** Les mots que la personne a tapés, nettoyés : 80 caractères au plus. */
export const cleanQuery = (q) => plain(P.oneLine(q, LIMITS.query));
/** Garde les événements dont le titre, le jeu ou le nom de la source contient tous les mots. `source` : un type de source, ou vide pour toutes. */
export function filterEvents(events, { q = "", source = "" } = {}) {
  const words = cleanQuery(q).split(" ").filter(Boolean).slice(0, 6);
  const kind = P.SOURCE_KIND.test(String(source)) ? String(source) : "";
  return events.filter((e) => {
    if (kind && e.source !== kind && !e.alsoIn.some((s) => s.kind === kind)) return false;
    if (!words.length) return true;
    const hay = plain(`${e.title} ${e.games.join(" ")} ${e.sourceLabel} ${e.alsoIn.map((s) => s.label).join(" ")}`);
    return words.every((w) => hay.includes(w));
  });
}
const encode = (e) => Buffer.from(JSON.stringify({ i: e.id, s: e.startMs })).toString("base64url");
const decode = (c) => {
  if (typeof c !== "string" || !/^[A-Za-z0-9_-]{1,260}$/.test(c)) return null;
  try { const o = JSON.parse(Buffer.from(c, "base64url").toString("utf8")); return typeof o?.i === "string" && Number.isFinite(o?.s) ? o : null; } catch { return null; }
};
/**
 * Une page : { items, next } — `next` est un curseur opaque (le dernier élément vu), ou null à la dernière page. `limit` : 1 à 50 (20 par défaut).
 * Un curseur dont l'événement a disparu reprend après son heure ; un curseur illisible redonne la première page.
 */
export function pageOf(events, { cursor = "", limit = LIMITS.pageDefault } = {}) {
  const n = Math.min(LIMITS.page, Math.max(1, Math.trunc(Number(limit)) || LIMITS.pageDefault));
  const c = decode(cursor);
  let from = 0;
  if (c) {
    const at = events.findIndex((e) => e.id === c.i);
    from = at >= 0 ? at + 1 : events.findIndex((e) => e.startMs > c.s);
    if (from < 0) from = events.length;
  }
  const items = events.slice(from, from + n);
  return { items, next: from + n < events.length && items.length ? encode(items[items.length - 1]) : null };
}

/** Ce que la page et les outils de l'IA reçoivent d'un événement. */
export const publicEvent = (e) => ({
  id: e.id, title: e.title, start: e.start, startMs: e.startMs, allDay: e.allDay, day: e.day, timezone: e.timezone, type: e.type, source: e.source, sourceLabel: e.sourceLabel,
  alsoIn: e.alsoIn, url: e.url, games: e.games, legacyKey: e.legacyKey,
});

// Événements : le modèle. Comment un événement est gardé, relu (une sauvegarde ancienne ou abîmée ne fait jamais planter une page), vérifié
// quand on l'écrit, et répété. Aucun accès au stockage ici : data.mjs lit et écrit, ce fichier ne fait que transformer.
const q = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en mémoire après une mise à jour)
const X = await import(`./text.mjs${q}`);
const T = await import(`./time.mjs${q}`);
const TPL = await import(`./templates.mjs${q}`);

export const STATES = ["ok", "full", "cancelled", "postponed"];
export const STATUSES = ["published", "draft"];
const DEFAULT_LENGTH = 2 * 3_600_000;
const REPEATS = { week: { unit: "days", step: 7 }, fortnight: { unit: "days", step: 14 }, month: { unit: "months", step: 1 } };
export const REPEAT_KEYS = Object.keys(REPEATS);

const slotRe = /^(\d{1,2}(?:\s?[:h.]\s?\d{0,2})?(?:\s?(?:am|pm))?)(?:\s?(?:-|–|—|à|to)\s?(\d{1,2}(?:\s?[:h.]\s?\d{0,2})?(?:\s?(?:am|pm))?))?\s+(\S.*)$/i;

/** Le programme tapé en lignes (« 14:00-15:30 Accueil | précisions ») → { items, errors: [{ line }] }. Une ligne vide est ignorée. */
export function parseProgram(raw) {
  const items = [];
  const errors = [];
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    if (items.length >= X.LIMITS.program) { errors.push({ line: i + 1, code: "tooMany" }); break; }
    const m = slotRe.exec(text);
    const time = m ? T.readTime(m[1].replace(/\s/g, "")) : null;
    const end = m && m[2] ? T.readTime(m[2].replace(/\s/g, "")) : null;
    if (!m || !time || (m[2] && !end)) { errors.push({ line: i + 1, code: "badSlot" }); continue; }
    if (end && end <= time) { errors.push({ line: i + 1, code: "slotEnd" }); continue; }
    const [title, ...rest] = m[3].split("|");
    const t = X.clean(title, X.LIMITS.slotTitle);
    if (!t) { errors.push({ line: i + 1, code: "badSlot" }); continue; }
    items.push({ time, end: end ?? "", title: t, text: X.clean(rest.join(" "), X.LIMITS.slotText) });
  }
  return { items, errors };
}
/** Le programme gardé → les lignes de l'éditeur. */
export const programText = (items) => (items ?? []).map((s) => `${s.time}${s.end ? `-${s.end}` : ""} ${s.title}${s.text ? ` | ${s.text}` : ""}`).join("\n");

/** Les intervenants tapés en lignes (« Nom | rôle | lien ») → { items, errors }. Le lien est facultatif : une adresse https ou une page du site. */
export function parseSpeakers(raw) {
  const items = [];
  const errors = [];
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    if (items.length >= X.LIMITS.speakers) { errors.push({ line: i + 1, code: "tooMany" }); break; }
    const [name, role = "", link = ""] = text.split("|").map((s) => s.trim());
    const n = X.clean(name, X.LIMITS.speakerName);
    if (!n) { errors.push({ line: i + 1, code: "badSpeaker" }); continue; }
    const href = link ? X.safeHref(link) : "";
    if (link && (!href || href.startsWith("mailto:"))) { errors.push({ line: i + 1, code: "badSpeakerLink" }); continue; }
    items.push({ name: n, role: X.clean(role, X.LIMITS.speakerRole), link: href ?? "" });
  }
  return { items, errors };
}
export const speakersText = (items) => (items ?? []).map((s) => [s.name, s.role, s.link].join(" | ").replace(/( \| )+$/, "")).join("\n");

function cleanProgram(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list.slice(0, X.LIMITS.program) : []) {
    const time = /^\d{2}:\d{2}$/.test(String(s?.time)) ? s.time : null;
    const title = X.clean(s?.title, X.LIMITS.slotTitle);
    if (!time || !title) continue;
    const end = /^\d{2}:\d{2}$/.test(String(s?.end)) && s.end > time ? s.end : "";
    out.push({ time, end, title, text: X.clean(s?.text, X.LIMITS.slotText) });
  }
  return out;
}
function cleanSpeakers(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list.slice(0, X.LIMITS.speakers) : []) {
    const name = X.clean(s?.name, X.LIMITS.speakerName);
    if (!name) continue;
    const link = s?.link ? X.safeHref(s.link) : "";
    out.push({ name, role: X.clean(s?.role, X.LIMITS.speakerRole), link: link && !link.startsWith("mailto:") ? link : "" });
  }
  return out;
}

const intOrNull = (v) => { const n = Math.trunc(Number(v)); return v === null || v === undefined || v === "" || !Number.isFinite(n) || n < 0 ? null : Math.min(n, 100000); };
const coord = (v, lim) => { const n = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(n) || Math.abs(n) > lim ? null : n; };
const isoOrNull = (v) => { const t = Date.parse(v ?? ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** Les instants d'un événement à partir de son jour, de son heure et de son fuseau. `null` si le jour est illisible. */
export function times({ date, time, endDate, endTime }, zone) {
  const d = T.parseDate(date);
  if (!d) return null;
  const allDay = !time;
  const t = allDay ? { h: 0, mi: 0 } : T.splitTime(time);
  if (!t) return null;
  const start = T.zonedToUtc(d.y, d.mo, d.d, t.h, t.mi, zone);
  let endMs = NaN;
  let lastDay = date;
  if (allDay) {
    const last = T.parseDate(endDate) && endDate >= date ? endDate : date;
    const after = T.parseDate(T.addDays(last, 1));
    endMs = T.zonedToUtc(after.y, after.mo, after.d, 0, 0, zone).ms;
    lastDay = last;
  } else if (endDate || endTime) {
    const ed = T.parseDate(endDate) ? endDate : date;
    const et = T.splitTime(endTime) ?? t;
    const p = T.parseDate(ed);
    endMs = T.zonedToUtc(p.y, p.mo, p.d, et.h, et.mi, zone).ms;
    if (endMs > start.ms) lastDay = T.dayIn(endMs - 1, zone);
  }
  if (!Number.isFinite(endMs) || endMs <= start.ms) { endMs = start.ms + DEFAULT_LENGTH; lastDay = T.dayIn(endMs - 1, zone); if (lastDay < date) lastDay = date; }
  return { startMs: start.ms, endMs, allDay, lastDay, note: start.kind === "ok" ? "" : start.kind };
}

/** Une ligne du stockage → l'événement tel que le module le lit. Ne lève jamais ; `broken` : le jour est illisible (jamais montré aux visiteurs). */
export function read(row, siteZone) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const tz = T.isValidZone(d.tz) ? d.tz : "";
  const zone = tz || (T.isValidZone(siteZone) ? siteZone : "UTC");
  const date = T.parseDate(d.date) ? d.date : "";
  const time = /^\d{2}:\d{2}$/.test(String(d.time)) && T.splitTime(d.time).h < 24 && T.splitTime(d.time).mi < 60 ? d.time : "";
  const endDate = T.parseDate(d.endDate) ? d.endDate : "";
  const endTime = /^\d{2}:\d{2}$/.test(String(d.endTime)) && time ? d.endTime : "";
  const when = date ? times({ date, time, endDate, endTime }, zone) : null;
  const lat = coord(d.lat, 90), lng = coord(d.lng, 180);
  return {
    id: String(row?.id ?? ""),
    createdAt: new Date(row?.createdAt).getTime() || 0,
    slug: X.safeSlug(d.slug) || X.safeSlug(`e-${row?.id}`) || "event",
    title: X.clean(d.title, X.LIMITS.title) || "—",
    status: d.status === "published" ? "published" : "draft",
    state: STATES.includes(d.state) ? d.state : "ok",
    type: X.safeSlug(d.type),
    date, time, endDate, endTime, tz, zone,
    place: X.clean(d.place, X.LIMITS.place),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    text: X.clean(d.text, X.LIMITS.text, true),
    program: cleanProgram(d.program),
    speakers: cleanSpeakers(d.speakers),
    image: d.image ? X.safeMedia(d.image) ?? "" : "",
    imageAlt: X.clean(d.imageAlt, 160),
    signupUrl: d.signupUrl ? X.safeHref(d.signupUrl) ?? "" : "",
    seatsLeft: intOrNull(d.seatsLeft),
    seatsTotal: intOrNull(d.seatsTotal),
    videoUrl: d.videoUrl ? X.safeMedia(d.videoUrl) ?? "" : "",
    albumId: typeof d.albumId === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(d.albumId) ? d.albumId : "",
    albumLink: d.albumLink ? X.safeHref(d.albumLink) ?? "" : "",
    videoId: typeof d.videoId === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(d.videoId) ? d.videoId : "",
    videoHint: X.clean(d.videoHint, 120),
    series: X.safeSlug(d.series),
    rev: Math.max(1, Math.trunc(Number(d.rev)) || 1),
    by: d.by === "assistant" || d.by === "import" ? d.by : "admin",
    publishedAt: isoOrNull(d.publishedAt),
    updatedAt: isoOrNull(d.updatedAt) ?? isoOrNull(row?.createdAt) ?? new Date(0).toISOString(),
    broken: !when,
    startMs: when ? when.startMs : NaN,
    endMs: when ? when.endMs : NaN,
    allDay: when ? when.allDay : !time,
    lastDay: when ? when.lastDay : date,
    note: when ? when.note : "",
  };
}

/** Ce qui est écrit dans le stockage : seulement les champs du modèle, jamais les valeurs calculées. */
export function toDoc(ev) {
  return {
    title: ev.title, slug: ev.slug, status: ev.status, state: ev.state, type: ev.type,
    date: ev.date, time: ev.time, endDate: ev.endDate, endTime: ev.endTime, tz: ev.tz,
    place: ev.place, lat: ev.lat, lng: ev.lng, text: ev.text, program: ev.program, speakers: ev.speakers,
    image: ev.image, imageAlt: ev.imageAlt, signupUrl: ev.signupUrl, seatsLeft: ev.seatsLeft, seatsTotal: ev.seatsTotal, videoUrl: ev.videoUrl,
    albumId: ev.albumId, albumLink: ev.albumLink, videoId: ev.videoId, videoHint: ev.videoHint,
    series: ev.series, rev: ev.rev, by: ev.by, publishedAt: ev.publishedAt, updatedAt: ev.updatedAt,
  };
}

/** Un événement tout neuf (vide). */
export function blank(fields = {}) {
  return {
    title: "", slug: "", status: "draft", state: "ok", type: "", date: "", time: "", endDate: "", endTime: "", tz: "", place: "", lat: null, lng: null, text: "",
    program: [], speakers: [], image: "", imageAlt: "", signupUrl: "", seatsLeft: null, seatsTotal: null, videoUrl: "", albumId: "", albumLink: "", videoId: "", videoHint: "",
    series: "", rev: 1, by: "admin", publishedAt: null, updatedAt: new Date(0).toISOString(), ...fields,
  };
}

// ── Les types ───────────────────────────────────────────────────────────────────────────────────────────────────────

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
export function readType(row) {
  const d = row?.data && typeof row.data === "object" ? row.data : {};
  const names = {};
  for (const [l, v] of Object.entries(d.names ?? {}).slice(0, 12)) if (LOCALE.test(l)) { const n = X.clean(v, X.LIMITS.typeName); if (n) names[l] = n; }
  return {
    id: String(row?.id ?? ""), key: X.safeSlug(d.key) || X.safeSlug(`t-${row?.id}`), names,
    color: TPL.COLOR_KEYS.includes(d.color) ? d.color : TPL.DEFAULT_COLOR,
    icon: X.clean(d.icon, 8).replace(/[<>&"']/g, ""),
    pos: Number(d.pos) || 0, createdAt: new Date(row?.createdAt).getTime() || 0,
  };
}
/** Le nom d'un type dans la langue du visiteur, sinon celle du site, sinon la première qui existe. */
export const typeName = (type, locale, defaultLocale) => type?.names?.[locale] || type?.names?.[defaultLocale] || Object.values(type?.names ?? {})[0] || type?.key || "";

// ── Les répétitions ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les jours d'une répétition, le premier compris : { dates, cut } ou { dates: [], why }. `every` : week · fortnight · month. Il faut `count` (2 à 100) ou `until` (un jour).
 * Bornes : 100 rendez-vous au plus, et jamais plus de 3 ans après le premier. `cut` : une borne a coupé la série.
 */
export function repeatDates(first, { every, count, until } = {}) {
  const rule = REPEATS[every];
  if (!rule || !T.parseDate(first)) return { dates: [], why: "rule" };
  const maxCount = X.LIMITS.occurrences;
  const wanted = Number.isInteger(count) && count >= 2 ? count : null;
  const lastDay = T.parseDate(until) ? until : null;
  if (!wanted && !lastDay) return { dates: [], why: "need" };
  if (wanted && wanted > maxCount) return { dates: [], why: "count" };
  if (lastDay && lastDay < first) return { dates: [], why: "until" };
  const horizon = T.addMonths(first, X.LIMITS.repeatYears * 12);
  const dates = [];
  let cut = false;
  for (let k = 0; k < maxCount + 1; k++) {
    const d = rule.unit === "days" ? T.addDays(first, k * rule.step) : T.addMonths(first, k * rule.step);
    if (!d || d > horizon) { cut = true; break; }
    if (lastDay && d > lastDay) break;
    if (wanted && k >= wanted) break;
    if (dates.length >= maxCount) { cut = true; break; }
    dates.push(d);
  }
  return { dates, cut };
}

/** Le même événement un autre jour : les heures restent celles du mur ; une fin sur un autre jour garde la même durée en jours. */
export function moveToDate(doc, date) {
  const span = doc.endDate ? T.daysBetween(doc.date, doc.endDate) : 0;
  return { ...doc, date, endDate: doc.endDate && Number.isFinite(span) && span >= 0 ? T.addDays(date, span) : "" };
}

/** Un identifiant d'adresse libre pour un événement : titre + jour, avec un numéro si besoin. */
export function uniqueSlug(taken, title, date) {
  const base = X.slugify(`${title}`, 40, "event");
  let slug = `${base}-${date}`.slice(0, 60);
  for (let n = 2; taken.has(slug) && n < 1000; n++) slug = `${base}-${date}`.slice(0, 54) + `-${n}`;
  return slug;
}

/** Les champs qu'on peut appliquer à toute une série (jamais les jours, l'état, les albums ni les places restantes). */
export const SERIES_FIELDS = ["title", "type", "place", "lat", "lng", "text", "program", "speakers", "image", "imageAlt", "signupUrl", "seatsTotal", "videoUrl"];

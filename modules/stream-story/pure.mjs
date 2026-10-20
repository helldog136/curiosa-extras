// Les petites règles de « Story d'annonce », sans aucune connaissance de Curiosa, de Twitch ni du navigateur (pas de ctx, pas de réseau, pas d'horloge cachée :
// l'heure « maintenant » est toujours donnée par l'appelant). Ce fichier est exécuté EXACTEMENT tel quel par le serveur, par la page de l'éditeur et par les tests
// (il fonctionne aussi dans un `vm` vierge : aucun import, aucune API de Node ou du navigateur autre que `Intl`).

/* ───────────── Les formats : UNE seule table ─────────────
 * `margins` : la zone sûre, où l'on place tout ce qui est essentiel (en pixels du format). `zones` : ce qui est caché ou recadré (montré sur l'aperçu seulement).
 * Vertical : le haut (250 px) et le bas (340 px) d'une story sont masqués par le nom du compte et la barre de réponse.
 * Passeport (4:5, le portrait presque carré) : la grille du profil recadre au centre en 3:4, soit 34 px perdus de chaque côté ; marges de 64 px, haut et bas de 60 px.
 * Changer de ratio = changer une ligne de cette table. */
export const FORMATS = [
  { id: "vertical", width: 1080, height: 1920, margins: { top: 250, bottom: 340, left: 64, right: 64 },
    zones: [{ id: "ui", x: 0, y: 0, w: 1080, h: 250 }, { id: "ui", x: 0, y: 1580, w: 1080, h: 340 }] },
  { id: "passeport", width: 1080, height: 1350, margins: { top: 60, bottom: 60, left: 64, right: 64 },
    zones: [{ id: "grid", x: 0, y: 0, w: 34, h: 1350 }, { id: "grid", x: 1046, y: 0, w: 34, h: 1350 }] },
];
export const STYLES = ["neon", "poster", "countdown", "minimal"];
export const ELEMENTS = ["title", "when", "countdown", "game", "brand", "text", "costreamers"];
export const LANGS = ["fr", "en"];
export const LIMITS = { title: 80, text: 140, channelName: 40, modelName: 60, displayName: 40, costreamers: 6, savedCostreamers: 60, models: 30, durationMin: 5, durationMax: 15, durationDefault: 15, fps: 30, streams: 12 };

export const formatOf = (id) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];
/** La zone où l'on peut placer du contenu essentiel : { x, y, w, h }. */
export function safeArea(format) {
  const f = typeof format === "string" ? formatOf(format) : format, m = f.margins;
  return { x: m.left, y: m.top, w: f.width - m.left - m.right, h: f.height - m.top - m.bottom };
}

/* ───────────── Texte ───────────── */

/** Une ligne de texte : sans caractère de contrôle, espaces réduits, coupée à `max` (en caractères entiers, jamais au milieu d'un emoji). */
export function oneLine(v, max) {
  const s = String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return [...s].slice(0, max).join("");
}
/** Une phrase libre : jusqu'à 3 lignes (retours à la ligne gardés), sans caractère de contrôle, coupée à `max` caractères au total. */
export function freeText(v, max) {
  const lines = String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").replace(/\p{Zl}|\p{Zp}/gu, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return [...lines.slice(0, 3).join("\n")].slice(0, max).join("");
}

/** Un pseudo Twitch : 4 à 25 caractères, lettres, chiffres et _ (en minuscules). */
export const LOGIN = /^[a-z0-9_]{4,25}$/;
const NOT_CHANNELS = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
/** Lit ce que la personne a tapé : `pseudo`, `@pseudo` ou `twitch.tv/pseudo`. Rend { login } ou { error: "empty" | "invalid" | "not_channel" }. */
export function normalizeLogin(input) {
  let s = String(input ?? "").trim();
  if (!s) return { error: "empty" };
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]*)/i.exec(s);
  if (url) { try { s = decodeURIComponent(url[1]); } catch { s = url[1]; } if (!s) return { error: "invalid" }; } else s = s.replace(/^@/, "");
  s = s.toLowerCase();
  if (NOT_CHANNELS.has(s)) return { error: "not_channel" };
  return LOGIN.test(s) ? { login: s } : { error: "invalid" };
}

/** Une adresse d'image utilisable par la page : un chemin du site (`/uploads/…`) ou une adresse https. Rien d'autre (jamais `javascript:` ni `data:`). */
export function safeImageUrl(v) {
  const s = String(v ?? "").trim();
  if (!s || s.length > 500 || /[\u0000-\u001f\u007f\s"'<>\\]/.test(s)) return "";
  if (/^\/(?!\/)/.test(s)) return s;
  return /^https:\/\/[^/]+\//.test(s) ? s : "";
}

/* ───────────── Les réglages d'une génération ───────────── */

export const DEFAULT_CONFIG = Object.freeze({ style: "neon", format: "vertical", duration: LIMITS.durationDefault, elements: ELEMENTS.slice(), text: "", channelName: "", costreamers: [], streamKey: "", lang: "fr" });

/** Remet n'importe quelle entrée (modèle enregistré, IA, navigateur) au bon format : valeurs inconnues écartées, durées et longueurs bornées. Ne lève jamais. */
export function cleanConfig(raw, fallback = DEFAULT_CONFIG) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const d = fallback && typeof fallback === "object" ? fallback : DEFAULT_CONFIG;
  const style = STYLES.includes(r.style) ? r.style : STYLES.includes(d.style) ? d.style : DEFAULT_CONFIG.style;
  const format = FORMATS.some((f) => f.id === r.format) ? r.format : FORMATS.some((f) => f.id === d.format) ? d.format : DEFAULT_CONFIG.format;
  const dn = Number(r.duration);
  const duration = Number.isInteger(dn) && dn >= LIMITS.durationMin && dn <= LIMITS.durationMax ? dn : Number.isFinite(dn) && dn > 0 ? Math.min(LIMITS.durationMax, Math.max(LIMITS.durationMin, Math.round(dn))) : cleanConfigDuration(d.duration);
  const elements = Array.isArray(r.elements) ? ELEMENTS.filter((e) => r.elements.includes(e)) : ELEMENTS.filter((e) => (Array.isArray(d.elements) ? d.elements : ELEMENTS).includes(e));
  const logins = [];
  for (const x of Array.isArray(r.costreamers) ? r.costreamers : Array.isArray(d.costreamers) ? d.costreamers : []) {
    const n = typeof x === "string" ? normalizeLogin(x) : { error: "invalid" };
    if (n.login && !logins.includes(n.login) && logins.length < LIMITS.costreamers) logins.push(n.login);
  }
  return {
    style, format, duration, elements,
    text: freeText(r.text ?? d.text, LIMITS.text),
    channelName: oneLine(r.channelName ?? d.channelName, LIMITS.channelName),
    costreamers: logins,
    streamKey: /^[a-z0-9]{1,20}$/.test(String(r.streamKey ?? "")) ? String(r.streamKey) : /^[a-z0-9]{1,20}$/.test(String(d.streamKey ?? "")) && r.streamKey === undefined ? String(d.streamKey) : "",
    lang: LANGS.includes(r.lang) ? r.lang : LANGS.includes(d.lang) ? d.lang : "fr",
  };
}
const cleanConfigDuration = (n) => (Number.isInteger(n) && n >= LIMITS.durationMin && n <= LIMITS.durationMax ? n : LIMITS.durationDefault);

/** Petite empreinte de texte (FNV-1a), en base 36 : sert d'identifiant court d'un stream. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
export const streamKeyOf = (slot) => shortHash(`${slot?.id ?? ""}|${slot?.start ?? ""}|${slot?.title ?? ""}`);

/* ───────────── Dates et heures (Intl seulement) ───────────── */

export function validZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 60) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
const pad = (n) => String(n).padStart(2, "0");
const dtfCache = new Map();
function dtf(tz, key, opts) {
  const k = `${tz}|${key}`;
  let f = dtfCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ...opts }); dtfCache.set(k, f); }
  return f;
}
/** La date et l'heure « sur l'horloge » du fuseau : { y, m, d, h, mi, wd } (wd : 0 = dimanche). */
export function wallParts(ms, tz) {
  const parts = dtf(tz, "wall", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value ?? "0";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), h: Number(g("hour")) % 24, mi: Number(g("minute")), wd };
}
/** L'instant (en ms) où l'horloge du fuseau `tz` marque cette date et cette heure. Un jour de changement d'heure est géré (deux essais). */
export function zonedToUtc(y, m, d, h, mi, tz) {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  let guess = asUtc;
  for (let i = 0; i < 3; i++) {
    const w = wallParts(guess, tz);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    const diff = asUtc - shown;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}
const dayNumber = (p) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
/** Nombre de jours de calendrier entre « maintenant » et le début, sur l'horloge du fuseau (0 = le même jour, 1 = demain, -1 = hier). */
export const dayDiff = (startMs, nowMs, tz) => dayNumber(wallParts(startMs, tz)) - dayNumber(wallParts(nowMs, tz));

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** « Samedi 24 octobre » / « Saturday, October 24 ». */
export function formatDay(ms, tz, lang) {
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const f = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  return capital(f.format(new Date(ms)));
}
/** « 19 h 30 » (« 19 h » pile) en français ; « 7:30 PM » en anglais. */
export function formatTime(ms, tz, lang) {
  const w = wallParts(ms, tz);
  if (lang === "en") return `${w.h % 12 === 0 ? 12 : w.h % 12}:${pad(w.mi)} ${w.h < 12 ? "AM" : "PM"}`;
  return w.mi === 0 ? `${w.h} h` : `${w.h} h ${pad(w.mi)}`;
}
/** « 2026-10-22 » : la date du stream sur l'horloge du fuseau (sert au nom du fichier). */
export function isoDay(ms, tz) { const w = wallParts(ms, tz); return `${w.y}-${pad(w.m)}-${pad(w.d)}`; }

/**
 * Le texte du compte à rebours, calculé à l'instant `nowMs` (celui de la génération) pour un stream qui commence à `startMs`.
 * « Dans 45 min » · « Dans 2 h 15 » · « Ce soir à 19 h 30 » · « Aujourd'hui à 14 h » · « Demain à 19 h 30 » · « Dans 4 jours » · « C'est maintenant ».
 * Un stream de plus de 3 heures dans le passé : rien ("").
 */
export function countdownText({ startMs, nowMs, tz, lang, allDay = false }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || !validZone(tz)) return "";
  const en = lang === "en";
  const diff = startMs - nowMs, days = dayDiff(startMs, nowMs, tz);
  if (allDay) {
    if (days < 0) return "";
    if (days === 0) return en ? "Today" : "Aujourd'hui";
    if (days === 1) return en ? "Tomorrow" : "Demain";
    return en ? `In ${days} days` : `Dans ${days} jours`;
  }
  if (diff < -3 * 3_600_000) return "";
  if (diff <= 60_000) return en ? "Starting now" : "C'est maintenant";
  const mins = Math.ceil(diff / 60_000);
  if (diff < 3_600_000) return en ? `In ${mins} min` : `Dans ${mins} min`;
  const time = formatTime(startMs, tz, lang);
  if (diff < 6 * 3_600_000) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return en ? `In ${h}h${m ? ` ${pad(m)}m` : ""}` : `Dans ${h} h${m ? ` ${pad(m)}` : ""}`;
  }
  if (days === 0) return wallParts(startMs, tz).h >= 18 ? (en ? `Tonight at ${time}` : `Ce soir à ${time}`) : (en ? `Today at ${time}` : `Aujourd'hui à ${time}`);
  if (days === 1) return en ? `Tomorrow at ${time}` : `Demain à ${time}`;
  if (days < 0) return en ? "Starting now" : "C'est maintenant";
  return en ? `In ${days} days` : `Dans ${days} jours`;
}
/** Les trois chiffres du grand compte à rebours : { days, hours, minutes, started }. Au-delà de 99 jours : 99 jours. */
export function countdownParts(startMs, nowMs) {
  const diff = Number.isFinite(startMs) && Number.isFinite(nowMs) ? startMs - nowMs : 0;
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, started: true };
  const total = Math.ceil(diff / 60_000), days = Math.min(99, Math.floor(total / 1440));
  return { days, hours: Math.floor((total % 1440) / 60), minutes: total % 60, started: false };
}

/* ───────────── Les streams ───────────── */

/**
 * Les éléments du sujet `planning.slot` → les prochains streams { key, title, start (ISO), startMs, allDay, day, games, timezone }, à partir de `nowMs`.
 * Un stream annulé ou illisible est écarté seul ; un stream déjà commencé depuis moins de 3 h reste proposé ; deux annonces identiques n'en font qu'une.
 */
export function upcomingStreams(items, nowMs, fallbackZone = "UTC", max = LIMITS.streams) {
  const out = [], seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object" || it.status === "cancelled") continue;
    const parsed = typeof it.start === "string" ? Date.parse(it.start) : NaN;
    if (!Number.isFinite(parsed)) continue;
    const allDay = it.allDay === true, slotZone = validZone(it.timezone) ? it.timezone : "";
    const tz = slotZone || (validZone(fallbackZone) ? fallbackZone : "UTC");
    const day = allDay && typeof it.day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.day) : null;
    const startMs = day ? zonedToUtc(Number(day[1]), Number(day[2]), Number(day[3]), 0, 0, tz) : parsed;
    if (!Number.isFinite(startMs)) continue;
    const endParsed = typeof it.end === "string" ? Date.parse(it.end) : NaN;
    const endMs = Number.isFinite(endParsed) && endParsed > startMs ? endParsed : startMs + (allDay ? 86_400_000 : 3_600_000);
    if (endMs < nowMs && startMs < nowMs - 3 * 3_600_000) continue;
    if (startMs < nowMs - 3 * 3_600_000) continue;
    const title = oneLine(it.title, LIMITS.title);
    const games = (Array.isArray(it.games) ? it.games : []).filter((g) => typeof g === "string").map((g) => oneLine(g, 80)).filter(Boolean).slice(0, 3);
    const dedupe = `${title}|${startMs}|${allDay}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ key: streamKeyOf({ id: it.id, start: it.start, title: it.title }), title, start: new Date(startMs).toISOString(), startMs, allDay, day: day ? it.day : "", games, timezone: slotZone || (allDay ? tz : "") });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title)).slice(0, max);
}

/** Un stream saisi à la main (titre, jour AAAA-MM-JJ, heure HH:MM) → un stream comme ci-dessus, ou { error }. */
export function manualStream({ title, date, time }, tz) {
  const t = oneLine(title, LIMITS.title);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? "")), h = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ""));
  if (!t) return { error: "title" };
  if (!d || Number(d[2]) < 1 || Number(d[2]) > 12 || Number(d[3]) < 1 || Number(d[3]) > 31) return { error: "date" };
  const zone = validZone(tz) ? tz : "UTC";
  const allDay = !String(time ?? "").trim();
  if (!allDay && (!h || Number(h[1]) > 23 || Number(h[2]) > 59)) return { error: "time" };
  const startMs = zonedToUtc(Number(d[1]), Number(d[2]), Number(d[3]), allDay ? 0 : Number(h[1]), allDay ? 0 : Number(h[2]), zone);
  const w = wallParts(startMs, zone);
  if (w.d !== Number(d[3]) || w.m !== Number(d[2])) return { error: "date" };   // un 31 février
  return { key: "manual", title: t, start: new Date(startMs).toISOString(), startMs, allDay, day: allDay ? String(date) : "", games: [], timezone: zone, manual: true };
}

/* ───────────── Ce que dit la vidéo ───────────── */

/**
 * Tout ce que la vidéo écrit, prêt à dessiner : un élément n'est présent que s'il est choisi ET qu'il a de quoi s'afficher.
 * `stream` : un stream (voir plus haut) ou null ; `coStreamers` : [{ login, name }] déjà choisis ; `site` : { name } ; `nowMs` : l'instant de la génération.
 */
export function buildContent(config, { stream, coStreamers = [], site = {}, nowMs, tz }) {
  const c = cleanConfig(config), has = (e) => c.elements.includes(e);
  const zone = validZone(stream?.timezone) ? stream.timezone : validZone(tz) ? tz : "UTC";
  const out = { lang: c.lang, title: "", dayLine: "", timeLine: "", countdown: "", parts: null, game: "", brand: "", text: "", costreamers: [], zone, startMs: stream?.startMs ?? null };
  if (stream) {
    if (has("title")) out.title = oneLine(stream.title, LIMITS.title);
    if (has("when")) { out.dayLine = formatDay(stream.startMs, zone, c.lang); out.timeLine = stream.allDay ? "" : formatTime(stream.startMs, zone, c.lang); }
    if (has("countdown")) { out.countdown = countdownText({ startMs: stream.startMs, nowMs, tz: zone, lang: c.lang, allDay: stream.allDay }); out.parts = stream.allDay ? null : countdownParts(stream.startMs, nowMs); }
    if (has("game") && stream.games?.[0]) out.game = oneLine(stream.games[0], 80);
  }
  if (has("brand")) out.brand = oneLine(c.channelName || site.name, LIMITS.channelName);
  if (has("text")) out.text = freeText(c.text, LIMITS.text);
  if (has("costreamers")) out.costreamers = coStreamers.slice(0, LIMITS.costreamers).map((x) => ({ login: String(x.login), name: oneLine(x.name || x.login, LIMITS.displayName) }));
  return out;
}

/** Le nom du fichier : annonce-2026-10-22-vertical.mp4 (announcement-… en anglais). */
export function fileName({ startMs, tz, format, lang, ext, nowMs }) {
  const day = Number.isFinite(startMs) && validZone(tz) ? isoDay(startMs, tz) : isoDay(nowMs ?? 0, "UTC");
  return `${lang === "en" ? "announcement" : "annonce"}-${day}-${FORMATS.some((f) => f.id === format) ? format : "vertical"}.${ext === "webm" ? "webm" : "mp4"}`;
}

/* ───────────── Mise en lignes ───────────── */

/**
 * Découpe un texte en lignes qui tiennent dans `maxWidth` (`measure(texte)` rend la largeur). Les retours à la ligne voulus sont respectés ; un mot trop long est coupé ;
 * au-delà de `maxLines`, la dernière ligne finit par « … ». Rend un tableau de lignes (jamais vide pour un texte non vide).
 */
export function wrapText(measure, text, maxWidth, maxLines = 3) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { if (lines.length) lines.push(""); continue; }
    let cur = "";
    const push = () => { lines.push(cur); cur = ""; };
    for (let w of words) {
      while (measure(w) > maxWidth && [...w].length > 1) {
        // un mot plus large qu'une ligne : on le coupe au dernier caractère qui tient
        let k = [...w].length - 1;
        while (k > 1 && measure([...w].slice(0, k).join("")) > maxWidth) k--;
        const head = [...w].slice(0, k).join(""), rest = [...w].slice(k).join("");
        if (cur) push();
        cur = head; push(); w = rest;
      }
      const tryLine = cur ? `${cur} ${w}` : w;
      if (measure(tryLine) <= maxWidth || !cur) cur = tryLine; else { push(); cur = w; }
    }
    if (cur) push();
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = [...kept[maxLines - 1]].join("");
  while (last && measure(`${last}…`) > maxWidth) last = [...last].slice(0, -1).join("");
  kept[maxLines - 1] = `${last.replace(/\s+$/, "")}…`;
  return kept;
}
/** Coupe un texte d'une seule ligne pour qu'il tienne dans `maxWidth` (… à la fin). */
export function ellipsize(measure, text, maxWidth) {
  const s = String(text ?? "");
  if (measure(s) <= maxWidth) return s;
  let k = [...s].length;
  while (k > 1 && measure(`${[...s].slice(0, k).join("").replace(/\s+$/, "")}…`) > maxWidth) k--;
  return `${[...s].slice(0, k).join("").replace(/\s+$/, "")}…`;
}

/**
 * La plus grande échelle `u` (jusqu'à `max`) pour laquelle `heightAt(u)` tient dans `avail`. `heightAt` doit croître avec `u`. Cherche par dichotomie ; rend au moins `min`.
 */
export function solveScale(heightAt, avail, max = 1, min = 0.3) {
  if (heightAt(max) <= avail) return max;
  let lo = min, hi = max;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (heightAt(mid) <= avail) lo = mid; else hi = mid; }
  return lo;
}

/**
 * Les cases des co-streamers dans la zone `box` ({ x, y, w, h }) : de 0 à 6 pastilles rondes (une rangée jusqu'à 3, deux rangées au-delà), toutes dans la zone,
 * sans se toucher. Chaque case : { cx, cy, d (diamètre), labelY (haut du nom), labelW (largeur permise du nom) }.
 */
export function layoutCostreamers(n, box, { maxD = 190, gap = 28, labelH = 44 } = {}) {
  const count = Math.max(0, Math.min(LIMITS.costreamers, Math.floor(Number(n) || 0)));
  if (!count) return [];
  const rows = count <= 3 ? [count] : [Math.ceil(count / 2), Math.floor(count / 2)];
  const rowGap = Math.min(gap, 20);
  const widest = Math.max(...rows);
  const d = Math.max(36, Math.min(maxD, (box.w - (widest - 1) * gap) / widest, (box.h - (rows.length - 1) * rowGap) / rows.length - labelH));
  const cellW = Math.max(d, Math.min(box.w / widest, d + gap + 30)), rowH = d + labelH + 8;
  const total = rows.length * rowH + (rows.length - 1) * rowGap;
  let y = box.y + Math.max(0, (box.h - total) / 2);
  const cells = [];
  for (const cols of rows) {
    const rowW = cols * cellW + (cols - 1) * Math.max(0, gap - (cellW - d));
    const step = cols > 1 ? (Math.min(box.w, rowW) - cellW) / (cols - 1) : 0;
    let x = box.x + (box.w - (cellW + step * (cols - 1))) / 2;
    for (let i = 0; i < cols; i++) { cells.push({ cx: x + cellW / 2, cy: y + d / 2, d, labelY: y + d + 14, labelW: cellW }); x += step; }
    y += rowH + rowGap;
  }
  return cells;
}

/** Les initiales d'un nom (« Alice Martin » → « AM », « zoe_live » → « Z »), pour la pastille quand l'image manque. */
export function initials(name) {
  const parts = String(name ?? "").replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? "?")][0] ?? "?", second = parts.length > 1 ? [...parts[1]][0] : "";
  return (first + second).toUpperCase();
}

/* ───────────── Couleurs et mouvements ───────────── */

export function parseHex(hex) {
  const s = String(hex ?? "").trim().replace(/^#/, "");
  const full = /^[0-9a-f]{3}$/i.test(s) ? s.split("").map((c) => c + c).join("") : /^[0-9a-f]{6}$/i.test(s) ? s : null;
  return full ? [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)] : null;
}
export const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => { const x = parseHex(a) ?? [0, 0, 0], y = parseHex(b) ?? [0, 0, 0]; return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const rgba = (hex, a) => { const c = parseHex(hex) ?? [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`; };
export function luminance(hex) {
  const c = (parseHex(hex) ?? [0, 0, 0]).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
/** Le texte (blanc ou presque noir) le plus lisible sur ce fond. */
export const readableOn = (bg) => (contrast(bg, "#ffffff") >= contrast(bg, "#111111") ? "#ffffff" : "#111111");
/** Éclaircit ou fonce une couleur jusqu'à ce qu'elle soit lisible (≥ `ratio`) sur `bg` ; sinon rend le blanc ou le noir lisible. */
export function ensureContrast(color, bg, ratio = 4.5) {
  if (!parseHex(color)) return readableOn(bg);
  if (contrast(color, bg) >= ratio) return color;
  const target = readableOn(bg);
  for (let i = 1; i <= 10; i++) { const c = mix(color, target, i / 10); if (contrast(c, bg) >= ratio) return c; }
  return target;
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOutCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOutCubic = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const easeOutBack = (x) => { const t = clamp01(x), c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
/** Avancement (0 à 1) d'un mouvement qui commence à `start` et dure `len` secondes. */
export const progress = (t, start, len) => clamp01((t - start) / (len > 0 ? len : 1));
/** Un petit générateur au hasard « reproductible » : la même graine donne toujours la même suite (la vidéo est déterministe). */
export function seeded(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

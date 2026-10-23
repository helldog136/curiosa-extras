// Sondages — fonctions pures (aucune lecture ni écriture : de quoi les tester seules).
import { randomInt } from "node:crypto";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Texte d'un visiteur ou d'Emma : normalisé, sans caractères de contrôle ni marques de sens de lecture, sur une ligne, borné. */
export const clean = (v, max) =>
  String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const num = (v, def, min, max) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n)));
};

/* ───────────── Plafonds (voir README : « Bornes ») ───────────── */
export const LIMITS = {
  question: 140,
  choice: 60,
  minChoices: 2,
  maxChoices: 8,
  livePolls: 200,        // sondages « complets » gardés
  archived: 800,         // sondages archivés (résumé seulement)
  voters: 5000,          // votants par sondage
  maxEndMs: 366 * 86_400_000,
};

/* ───────────── Fuseaux horaires ───────────── */

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return typeof tz === "string" && tz.length > 0 && tz.length < 60; } catch { return false; }
}

/** Heure « au mur » (y, m, d, h, mi) dans un fuseau → instant UTC (ms). Sûr autour des changements d'heure (deux passes). */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const offsetAt = (ms) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
  };
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return guess;
}

/**
 * Date et heure saisies par Emma → instant de fin. Rien de saisi = pas de fin (ok, endsAt null).
 * Codes d'erreur : date (illisible), time (illisible), past (déjà passée), far (plus d'un an).
 */
export function parseEnd(dateText, timeText, tz, now = Date.now()) {
  const date = String(dateText ?? "").trim();
  const time = String(timeText ?? "").trim();
  if (!date && !time) return { ok: true, endsAt: null };
  if (!date) return { ok: false, code: "date" };
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dm) return { ok: false, code: "date" };
  const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const chk = new Date(Date.UTC(y, mo - 1, d));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return { ok: false, code: "date" };
  let h = 23, mi = 59;
  if (time) {
    const tm = /^(\d{1,2})\s*(?:[:hH])\s*(\d{2})?$/.exec(time);
    if (!tm) return { ok: false, code: "time" };
    h = Number(tm[1]); mi = tm[2] === undefined ? 0 : Number(tm[2]);
    if (h > 23 || mi > 59) return { ok: false, code: "time" };
  }
  const ms = zonedToUtc(y, mo, d, h, mi, tz);
  if (!Number.isFinite(ms)) return { ok: false, code: "date" };
  if (ms <= now + 60_000) return { ok: false, code: "past" };
  if (ms - now > LIMITS.maxEndMs) return { ok: false, code: "far" };
  return { ok: true, endsAt: new Date(ms).toISOString() };
}

/** Un instant → « AAAA-MM-JJ » et « HH:MM » dans un fuseau (pour préremplir le formulaire). */
export function wallParts(iso, tz) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return { date: "", time: "" };
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** « 3 novembre à 21:00 (heure d'Europe centrale) » — l'heure ET le fuseau sont toujours écrits. */
export function formatEnd(iso, tz, locale) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "long" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/* ───────────── Choix et sondage ───────────── */

/** Un choix par ligne → liste de textes propres, sans doublon (casse ignorée). */
export function parseChoices(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = clean(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), LIMITS.choice);
    const k = t.toLocaleLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

const RESERVED = new Set(["page", "archive", "vote", "results", "live", "vp", "now", "decisions"]);
export function slugify(question, rand = Math.random) {
  const base = String(question ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/g, "") || "sondage";
  const suffix = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  const slug = `${base}-${suffix}`;
  return RESERVED.has(slug) ? `${slug}-x` : slug;
}

export const choiceIds = (n) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

/** État d'un sondage À LA LECTURE : jamais de minuteur en arrière-plan. */
export function stateOf(poll, now = Date.now()) {
  if (!poll) return "missing";
  if (poll.archivedAt) return "closed";
  if (poll.closedAt) return "closed";
  if (poll.endsAt && Date.parse(poll.endsAt) <= now) return "closed";
  return "open";
}

/** Instant où le sondage s'est fermé (ms), ou null s'il est ouvert. */
export function endedAtMs(poll, now = Date.now()) {
  if (stateOf(poll, now) !== "closed") return null;
  const a = Date.parse(poll.closedAt ?? ""), b = Date.parse(poll.endsAt ?? "");
  const cands = [a, b].filter((x) => Number.isFinite(x));
  return cands.length ? Math.min(...cands) : Date.parse(poll.archivedAt ?? "") || Date.parse(poll.createdAt ?? "") || 0;
}

export const pct = (count, voters) => (voters > 0 ? Math.min(100, Math.round((count * 100) / voters)) : 0);

/** Lignes de résultat : texte, voix, pourcentage, « en tête » (égalités comprises, seulement s'il y a au moins une voix). */
export function rows(poll) {
  const counts = poll.counts ?? {};
  const voters = Math.max(0, Number(poll.voters) || 0);
  const top = Math.max(0, ...poll.choices.map((c) => Number(counts[c.id]) || 0));
  return poll.choices.map((c) => {
    const n = Math.max(0, Number(counts[c.id]) || 0);
    return { id: c.id, text: c.text, count: n, pct: pct(n, voters), lead: top > 0 && n === top };
  });
}

/** Le formulaire d'Emma → champs validés. Les erreurs sont PAR CHAMP (affichées sous le champ). */
export function validatePollForm(values, { tz, now = Date.now(), keepChoices = null } = {}) {
  const errors = {};
  const question = clean(values.question, LIMITS.question);
  if (!question) errors.question = "question";
  let choices = keepChoices;
  if (!keepChoices) {
    const list = parseChoices(values.choices);
    if (list.length < LIMITS.minChoices) errors.choices = "few";
    else if (list.length > LIMITS.maxChoices) errors.choices = "many";
    choices = list;
  }
  const n = choices ? choices.length : 0;
  const max = num(values.max, 1, 1, LIMITS.maxChoices);
  const rawMax = String(values.max ?? "").trim();
  if (rawMax !== "" && (!/^\d+$/.test(rawMax) || Number(rawMax) < 1)) errors.max = "max";
  else if (n && max > n) errors.max = "maxHigh";
  const end = parseEnd(values.endDate, values.endTime, tz, now);
  if (!end.ok) errors[end.code === "date" || end.code === "past" || end.code === "far" ? "endDate" : "endTime"] = `end_${end.code}`;
  const resultsMode = values.resultsMode === "after" ? "after" : "always";
  return { errors, value: { question, choices, max: Math.min(max, n || max), endsAt: end.ok ? end.endsAt : null, resultsMode } };
}

/** « 1 » → vrai pour un tableau de choix demandés valides : identifiants connus, sans doublon, entre 1 et `max`. */
export function validBallot(poll, ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > Math.min(poll.max || 1, poll.choices.length)) return null;
  const known = new Set(poll.choices.map((c) => c.id));
  const out = [];
  for (const id of ids) {
    if (typeof id !== "string" || !known.has(id) || out.includes(id)) return null;
    out.push(id);
  }
  return out;
}

/* ───────────── Manches : « toutes les N minutes, le chat décide » ───────────── */

export const ROUND = {
  minMinutes: 1,
  maxMinutes: 60,
  defaultMinutes: 10,
  history: 500,           // décisions gardées (les plus anciennes s'effacent)
  quickChoices: 4,        // « A ou B ? » : de 2 à 4 choix
  quickSeconds: [30, 60, 120, 300],
  resumeGapMs: 60_000,    // si personne n'a regardé depuis plus d'une minute après la fin d'une manche, la suivante part de maintenant
  pinGraceMs: 45_000,     // un sondage rapide reste à l'écran un peu après sa fin
};

/**
 * Le vainqueur d'une manche. Le plus de voix gagne ; à égalité, tirage au sort parmi les premiers ex æquo (et on le DIT : `tie` liste les ex æquo) ;
 * aucune voix = pas de vainqueur. `rand(n)` renvoie un entier de 0 à n-1 (aléatoire sûr par défaut ; injectable pour les tests).
 */
export function pickWinner(poll, rand = (n) => randomInt(n)) {
  const counts = poll.counts ?? {};
  const score = poll.choices.map((c) => ({ id: c.id, text: c.text, count: Math.max(0, Number(counts[c.id]) || 0) }));
  const top = Math.max(0, ...score.map((x) => x.count));
  if (top <= 0) return { winner: null, tie: null };
  const leaders = score.filter((x) => x.count === top);
  if (leaders.length === 1) return { winner: leaders[0], tie: null };
  const drawn = leaders[Math.min(leaders.length - 1, Math.max(0, rand(leaders.length)))];
  return { winner: drawn, tie: leaders.map((x) => x.text) };
}

/** Le formulaire « Manches » → champs validés. Erreurs PAR CHAMP (codes), comme pour un sondage. */
export function validateSeriesForm(values) {
  const errors = {};
  const question = clean(values.question, LIMITS.question);
  if (!question) errors.question = "question";
  const list = parseChoices(values.choices);
  if (list.length < LIMITS.minChoices) errors.choices = "few";
  else if (list.length > LIMITS.maxChoices) errors.choices = "many";
  const raw = String(values.minutes ?? "").trim();
  let minutes = ROUND.defaultMinutes;
  if (raw !== "") {
    if (!/^\d+$/.test(raw) || Number(raw) < ROUND.minMinutes || Number(raw) > ROUND.maxMinutes) errors.minutes = "minutes";
    else minutes = Number(raw);
  }
  return { errors, value: { question, choices: list, minutes } };
}

/** « A ou B ? » : de 2 à 4 choix (les deux premiers sont obligatoires) et une durée courte. */
export function validateQuick(values) {
  const errors = {};
  const picks = ["a", "b", "c", "d"].map((k) => [k, clean(values[k], LIMITS.choice)]);
  if (!picks[0][1]) errors.a = "quick_a";
  if (!picks[1][1]) errors.b = "quick_b";
  const seen = new Set();
  const choices = [];
  for (const [k, t] of picks) {
    if (!t) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) { errors[k] = "quick_same"; continue; }
    seen.add(key);
    choices.push(t);
  }
  const rawSeconds = String(values.seconds ?? "").trim();
  let seconds = 60;
  if (rawSeconds !== "") {
    if (!/^\d+$/.test(rawSeconds) || Number(rawSeconds) < 15 || Number(rawSeconds) > 900) errors.seconds = "quick_seconds";
    else seconds = Number(rawSeconds);
  }
  const question = clean(values.question, LIMITS.question);
  return { errors, value: { choices, seconds, question } };
}

/** « mm:ss » pour un nombre de millisecondes (jamais négatif). */
export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

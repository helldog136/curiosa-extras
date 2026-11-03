// Les dates de validité d'une commande ou d'un timer : une période facultative, soit RÉCURRENTE chaque année (« du 1er novembre au 30 novembre », y compris à cheval
// sur le changement d'année : du 15 décembre au 15 janvier), soit UNIQUE avec ses années. Évaluée uniquement à la lecture (quand quelqu'un tape la commande, quand un timer
// est regardé, quand la page s'affiche) : aucun minuteur. Les jours de début et de fin sont inclus. L'heure est celle du fuseau réglé (UTC sans fuseau, et l'écran le dit).
// Forme gardée : { yearly: boolean, from: { m, d, y? }, to: { m, d, y? } } ; l'absence de période veut dire « toujours active ». Cette forme NE CHANGE PAS : le champ « période » du cœur
// (un seul champ, « Tout le mois de », « Une période toute prête ») parle un autre langage (« 11-01/11-30 », « 2026-11-01/2026-11-30 »), traduit ici dans les deux sens (periodToValue, parsePeriodValue).
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // février : 29 permis pour une période qui revient chaque année
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (m, y) => (m === 2 && y !== undefined && !isLeap(y) ? 28 : DAYS_IN_MONTH[m - 1]);
const int = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const code = (field, reason, extra = {}) => ({ ok: false, field, reason, ...extra });

/** Vérifie une période saisie : { yearly, from: { m, d, y? }, to: { m, d, y? } } (nombres ou textes de nombres). Rend { ok: true, value } (value null : aucune période) ou { ok: false, field, reason }. */
export function parsePeriod(input) {
  if (input === null || input === undefined) return { ok: true, value: null };
  const yearly = input.yearly !== false;
  const side = (o) => ({ m: int(o?.m), d: int(o?.d), y: int(o?.y) });
  const f = side(input.from), t = side(input.to);
  const empty = [f.m, f.d, t.m, t.d].every(Number.isNaN) && Number.isNaN(f.y) && Number.isNaN(t.y);
  if (empty) return { ok: true, value: null };
  for (const [k, s, name] of [["from", f, "from"], ["to", t, "to"]]) {
    if (!Number.isInteger(s.m) || s.m < 1 || s.m > 12) return code(`${name}Month`, "month");
    if (!Number.isInteger(s.d) || s.d < 1 || s.d > 31) return code(`${name}Day`, "day");
    if (s.d > DAYS_IN_MONTH[s.m - 1]) return code(`${name}Day`, "nodate", { month: s.m, day: s.d });
  }
  if (yearly) return { ok: true, value: { yearly: true, from: { m: f.m, d: f.d }, to: { m: t.m, d: t.d } } };
  for (const [name, s] of [["from", f], ["to", t]]) {
    if (!Number.isInteger(s.y) || s.y < 2000 || s.y > 2100) return code(`${name}Year`, "year");
    if (s.d > dim(s.m, s.y)) return code(`${name}Day`, "nodate", { month: s.m, day: s.d, year: s.y });
  }
  if (f.y * 10000 + f.m * 100 + f.d > t.y * 10000 + t.m * 100 + t.d) return code("toYear", "order");
  return { ok: true, value: { yearly: false, from: { m: f.m, d: f.d, y: f.y }, to: { m: t.m, d: t.d, y: t.y } } };
}

/** Relit une période gardée (un document abîmé ne casse rien : on la traite comme absente). */
export function readPeriod(raw) {
  if (!raw || typeof raw !== "object") return null;
  const p = parsePeriod({ yearly: raw.yearly !== false, from: raw.from, to: raw.to });
  return p.ok ? p.value : null;
}

/** La période telle que la porte le champ « période » du cœur : « 11-01/11-30 » (chaque année) ou « 2026-11-01/2026-11-30 » (une seule fois) ; vide = toujours active.
 *  Sans les années pour « chaque année » : celles qui auraient été gardées sont ignorées, comme elles l'ont toujours été. */
export const periodToValue = (p) => {
  if (!p) return "";
  const two = (n) => String(n).padStart(2, "0");
  const one = (x) => `${p.yearly ? "" : `${String(x.y).padStart(4, "0")}-`}${two(x.m)}-${two(x.d)}`;
  return `${one(p.from)}/${one(p.to)}`;
};

/** Ce que renvoie le champ « période » du cœur → { ok, value } comme parsePeriod. Lit aussi, par tolérance, l'ancienne écriture « 01/11 - 30/11 » (une page ouverte avant la mise à jour,
 *  un import, un outil) : une valeur déjà enregistrée ou envoyée dans l'ancienne forme garde exactement son sens. Vide : aucune période (toujours active). */
export function parsePeriodValue(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: true, value: null };
  const y = /^(\d{2})-(\d{2})\/(\d{2})-(\d{2})$/.exec(raw);
  if (y) return parsePeriod({ yearly: true, from: { m: Number(y[1]), d: Number(y[2]) }, to: { m: Number(y[3]), d: Number(y[4]) } });
  const o = /^(\d{4})-(\d{2})-(\d{2})\/(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (o) return parsePeriod({ yearly: false, from: { y: Number(o[1]), m: Number(o[2]), d: Number(o[3]) }, to: { y: Number(o[4]), m: Number(o[5]), d: Number(o[6]) } });
  return parsePeriodText(raw);
}

/** « jj/mm » ou « jj/mm/aaaa » (aussi « jj-mm ») → { d, m, y? } ou null. */
const dayText = (x) => { const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}))?\s*$/.exec(String(x)); return m ? { d: Number(m[1]), m: Number(m[2]), ...(m[3] ? { y: Number(m[3]) } : {}) } : null; };
/** Une période écrite à la main, pour l'import et les outils : « 01/11 - 30/11 » (chaque année) ou « 01/11/2026 - 30/11/2026 » (une fois). Vide : aucune période. */
export function parsePeriodText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: true, value: null };
  const parts = raw.split(/\s+(?:-|–|—|au|to|→|>)\s+|\s*(?:–|—|→)\s*/i);
  const a = parts.length === 2 ? dayText(parts[0]) : null, b = parts.length === 2 ? dayText(parts[1]) : null;
  if (!a || !b) return code("period", "text");
  return parsePeriod({ yearly: a.y === undefined && b.y === undefined, from: a, to: b });
}
/** Les outils des assistants : « MM-JJ » (chaque année) ou « AAAA-MM-JJ » (une fois). */
export function parsePeriodIso(from, until, yearlyFlag) {
  if (!from && !until) return { ok: true, value: null };
  const one = (x) => { const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(String(x ?? "").trim()); return m ? { y: m[1] ? Number(m[1]) : undefined, m: Number(m[2]), d: Number(m[3]) } : null; };
  const a = one(from), b = one(until);
  if (!a || !b) return code("period", "iso");
  const yearly = yearlyFlag === undefined ? a.y === undefined && b.y === undefined : yearlyFlag === true;
  return parsePeriod({ yearly, from: a, to: b });
}

/** Aujourd'hui dans un fuseau : { y, m, d }. */
export function dayIn(now, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: g("year"), m: g("month"), d: g("day") };
}
const key = (m, d) => m * 100 + d;

/** La période est-elle ouverte à cet instant ? Pas de période : toujours. */
export function isOpen(period, now = Date.now(), timeZone = "UTC") {
  if (!period) return true;
  const t = dayIn(new Date(now), timeZone), today = key(t.m, t.d), a = key(period.from.m, period.from.d), b = key(period.to.m, period.to.d);
  if (!period.yearly) { const n = t.y * 10000 + today; return n >= period.from.y * 10000 + a && n <= period.to.y * 10000 + b; }
  return a <= b ? today >= a && today <= b : today >= a || today <= b;   // à cheval sur l'année : du 15 décembre au 15 janvier
}

/** Quand rouvre-t-elle ? { y, m, d } (le prochain premier jour), ou null si la période unique est terminée ou si elle est ouverte. */
export function nextOpening(period, now = Date.now(), timeZone = "UTC") {
  if (!period || isOpen(period, now, timeZone)) return null;
  const t = dayIn(new Date(now), timeZone);
  if (!period.yearly) return t.y * 10000 + key(t.m, t.d) < period.from.y * 10000 + key(period.from.m, period.from.d) ? { y: period.from.y, m: period.from.m, d: period.from.d } : null;
  for (let y = t.y; y <= t.y + 8; y++) {
    // Le 29 février d'une année qui n'en a pas : le 1er mars.
    const m = period.from.m, d = m === 2 && period.from.d === 29 && !isLeap(y) ? 1 : period.from.d, mm = m === 2 && period.from.d === 29 && !isLeap(y) ? 3 : m;
    if (y * 10000 + key(mm, d) > t.y * 10000 + key(t.m, t.d)) return { y, m: mm, d };
  }
  return null;
}

const dateText = (locale, x, withYear) => {
  const text = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(Date.UTC(x.y ?? 2024, x.m - 1, x.d)));
  return String(locale).startsWith("fr") && x.d === 1 ? text.replace(/^1 /, "1er ") : text;   // « 1er novembre »
};
/** « Hors période : se réactive le 1er novembre » (ou « la période est terminée »). `now` : pour les tests. */
export function outsideText(ctx, period, now, timeZone) { return reopenLabel(ctx, nextOpening(period, now, timeZone)); }
/** La même phrase à partir d'une date de réouverture déjà calculée ({ y, m, d } ou null). */
export const reopenLabel = (ctx, n) => (n ? ctx.t("per_outside", { date: dateText(ctx.locale, n, true) }) : ctx.t("per_ended"));
/** Pour le journal : la date de réouverture en texte court « 2026-11-01 » (ou null). */
export const reopenIso = (period, now, timeZone) => { const n = nextOpening(period, now, timeZone); return n ? `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}` : null; };
export const isoText = (ctx, iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "")); return m ? dateText(ctx.locale, { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, true) : ""; };
/** Un message pour une erreur de période (sous le champ), avec un exemple. */
export function periodError(ctx, e) {
  const t = ctx.t;
  switch (e.reason) {
    case "nodate": { const month = new Intl.DateTimeFormat(ctx.locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, e.month - 1, 1))); return t("per_e_nodate", { day: e.day, month, example: `${e.month === 2 ? 28 : DAYS_IN_MONTH[e.month - 1]} ${month}` }); }
    case "year": return t("per_e_year");
    case "order": return t("per_e_order");
    case "text": return t("per_e_text");
    case "iso": return t("per_e_iso");
    default: return t("per_e_incomplete");
  }
}

/** Le champ « période » d'un formulaire : le champ du cœur (`kind: "period"`), UN seul champ (R6) avec « Tout le mois de », « Une période toute prête » et la phrase d'aperçu.
 *  Vide : toujours active. Les jours suivent le fuseau réglé du module (UTC sans fuseau) : l'aide le dit. */
export function periodField(ctx, period, timeZone = "UTC") {
  return { name: "period", label: ctx.t("per_title"), kind: "period", value: periodToValue(period), help: ctx.t(timeZone === "UTC" ? "per_f_help_utc" : "per_f_help", { zone: timeZone }) };
}

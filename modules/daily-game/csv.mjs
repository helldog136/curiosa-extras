// Jeu du jour — import et export de la banque de questions en fichier CSV (lisible dans n'importe quel tableur).
// L'export et l'import ne savent rien du type de jeu : les colonnes propres au jeu viennent du type (games.mjs), les colonnes communes d'ici.
// Colonnes communes : status, date, category, difficulty. Un fichier exporté puis réimporté ne crée aucun doublon (les questions déjà là sont comptées, pas recopiées).
const q = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${q}`);
const G = await import(`./games.mjs${q}`);
const { clean, LIMITS, LEVELS, isDay, csvCell, csvUnprotect, parseCsv, columnKey, fold, languageName } = L;

const LEVEL_WORDS = {
  easy: ["easy", "facile", "1", "simple", "debutant"],
  medium: ["medium", "moyen", "moyenne", "intermediaire", "2"],
  hard: ["hard", "difficile", "expert", "3"],
};
const PUBLISHED_WORDS = ["published", "publie", "publiee", "oui", "yes", "1", "true", "actif"];
const DRAFT_WORDS = ["draft", "brouillon", "non", "no", "0", "false"];

const words = (list, value) => list.includes(columnKey(value));

export function levelOf(value) {
  const v = columnKey(value);
  if (!v) return "";
  for (const [lvl, list] of Object.entries(LEVEL_WORDS)) if (list.includes(v)) return lvl;
  return null;
}

/** « 2026-10-31 » ou « 31/10/2026 » ou « 31-10-2026 » → « 2026-10-31 » ; "" si vide ; null si illisible. */
export function dateOf(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  let iso = v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDay(iso) ? iso : null;
}

export const HEAD = ["status", "date", "category", "difficulty"];

export function columns(type, locales) { return [...HEAD, ...type.csvColumns(locales)]; }

/** Les lignes d'un fichier (en-tête d'abord) : un générateur, jamais le fichier entier en mémoire. */
export function* exportLines(type, locales, items) {
  yield `﻿${columns(type, locales).map(csvCell).join(",")}\r\n`;
  for (const item of items) {
    if (item.type !== type.id) continue;
    yield `${[item.status, item.date, item.cat, item.lvl, ...type.csvRow(item, locales)].map(csvCell).join(",")}\r\n`;
  }
}

/** Un fichier d'exemple à remplir (deux lignes neutres). */
export function sampleCsv(ctx, type, locales) {
  const lang = locales[0];
  const rows = [
    { status: "draft", date: "", cat: ctx.t("sampleCat"), lvl: "easy", d: type.normalize({ tr: { [lang]: { q: ctx.t("sampleQ1"), a: [ctx.t("sampleQ1a"), ctx.t("sampleQ1b"), ctx.t("sampleQ1c")], e: ctx.t("sampleQ1e") } }, correct: 0 }), type: type.id },
    { status: "draft", date: "", cat: ctx.t("sampleCat"), lvl: "medium", d: type.normalize({ tr: { [lang]: { q: ctx.t("sampleQ2"), a: [ctx.t("sampleQ2a"), ctx.t("sampleQ2b")], e: ctx.t("sampleQ2e") } }, correct: 0 }), type: type.id },
  ];
  return [...exportLines(type, locales, rows)].join("");
}

/**
 * Lit un fichier. Tout ou rien : s'il y a une erreur, rien n'est importé et chaque erreur dit la ligne, la colonne et quoi faire.
 * `existing` : { questions: Set de titres déjà là (pliés), dates: Set de dates déjà prises, room: places restantes, planned: nombre de dates à venir déjà prises }.
 * Rend { ok, rows: [{ status, date, cat, lvl, d }], errors: [{ line, message }], skipped, total, ignored: [colonnes ignorées], errorCount }.
 */
export function importCsv(ctx, text, { type, locales, lang, defaultStatus, existing, today }) {
  const errors = [];
  const fail = (line, message) => { errors.push({ line, message }); return null; };
  const none = (message) => ({ ok: false, rows: [], errors: [{ line: 1, message }], skipped: 0, total: 0, ignored: [] });
  if (!String(text ?? "").trim()) return none(ctx.t("csvEmpty"));
  const parsed = parseCsv(text);
  if (parsed.unclosed) return none(ctx.t("csvQuote"));
  const [head, ...body] = parsed.rows;
  // Les colonnes : nom connu (avec ses variantes) et langue facultative (« question_en »).
  const aliases = { ...G.COLUMN_ALIASES, ...Object.fromEntries(Object.entries(type.csvAliases ?? {}).map(([name, list]) => [name, [name, ...list]])) };
  const required = type.csvRequired ?? ["question"];
  const cols = new Map();
  const ignored = [];
  const localeKeys = new Map(locales.map((l) => [columnKey(l), l]));
  head.forEach((raw, index) => {
    let key = columnKey(raw);
    let l = "";
    const m = /^(.*)_([a-z]{2,3}(?:_[a-z0-9]{2,8})?)$/.exec(key);
    if (m && localeKeys.has(m[2])) { key = m[1]; l = localeKeys.get(m[2]); }
    const canonical = Object.entries(aliases).find(([, list]) => list.includes(key))?.[0];
    if (!canonical) { if (String(raw).trim()) ignored.push(String(raw).trim().slice(0, 40)); return; }
    if (!cols.has(`${canonical}|${l}`)) cols.set(`${canonical}|${l}`, index);
  });
  if (!required.some((name) => [...cols.keys()].some((k) => k.startsWith(`${name}|`)))) {
    return none(ctx.t("csvNoColumn", { column: required[0], example: type.csvColumns(locales).slice(0, 3).join(", ") }));
  }
  if (body.length > LIMITS.questions) return { ...none(ctx.t("csvTooMany", { max: LIMITS.questions })), total: body.length, ignored };

  const rows = [];
  const seen = new Set(existing.questions);
  const dates = new Set(existing.dates);
  let planned = existing.planned;
  let skipped = 0;
  body.forEach((cells, i) => {
    const line = i + 2;
    const cellAt = (name, l) => {
      const at = cols.get(`${name}|${l}`);
      return at === undefined ? "" : csvUnprotect(cells[at] ?? "");
    };
    // `get(nom, langue)` : la colonne de cette langue ; sans suffixe, elle vaut pour la langue choisie à l'import.
    const get = (name, l) => cellAt(name, l) || (l === lang || l === "" ? cellAt(name, "") : "");
    const made = type.fromCsv(get, { locales, lang });
    if (made.fail) {
      const e = made.fail;
      return fail(line, ctx.t(e.key, { column: e.column, lang: e.lang ? languageName(e.lang, ctx.locale) : "", count: e.count ?? "" }));
    }
    const rawLevel = cellAt("difficulty", "");
    const lvl = levelOf(rawLevel);
    if (lvl === null) return fail(line, ctx.t("csvLevel", { value: clean(rawLevel, 30) }));
    const rawDate = cellAt("date", "");
    const date = dateOf(rawDate);
    if (date === null) return fail(line, ctx.t("csvDate", { value: clean(rawDate, 30) }));
    if (date && date < today) return fail(line, ctx.t("csvPast", { value: date }));
    const rawStatus = cellAt("status", "");
    const status = !rawStatus ? defaultStatus : words(PUBLISHED_WORDS, rawStatus) ? "published" : words(DRAFT_WORDS, rawStatus) ? "draft" : null;
    if (status === null) return fail(line, ctx.t("csvStatus", { value: clean(rawStatus, 30) }));
    const title = fold(type.title(made.d, [lang, ...locales])).replace(/\s+/g, " ").trim();
    if (seen.has(title)) { skipped++; return null; }
    if (date) {
      if (dates.has(date)) return fail(line, ctx.t("csvDateTaken", { value: date }));
      if (planned >= LIMITS.planned) return fail(line, ctx.t("csvPlannedFull", { max: LIMITS.planned }));
      dates.add(date); planned++;
    }
    if (rows.length >= existing.room) return fail(line, ctx.t("csvFull", { max: LIMITS.questions }));
    seen.add(title);
    rows.push({ status, date, cat: clean(cellAt("category", ""), LIMITS.cat), lvl: LEVELS.includes(lvl) ? lvl : "", d: made.d });
    return null;
  });
  return { ok: errors.length === 0, rows: errors.length ? [] : rows, errors: errors.slice(0, 12), skipped, total: body.length, ignored, errorCount: errors.length };
}

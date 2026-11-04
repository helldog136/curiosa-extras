// VERBATIM COPY of src/core/i18n/audit.mjs of the core (this repository depends on no core version; tests/module-i18n.test.mjs compares both when the core has the file).
// Change it in the core, then copy it here unchanged.
// MODULE I18N: the pure rules of the language system (no import, no I/O).
//
// ONE SOURCE. The runtime (TypeScript, `audit.d.mts` gives the types), the test kit (`testsupport/i18n.mjs`) and the modules repository
// (`scripts/i18n-audit.mjs`, a verbatim COPY that a test compares with this file) all use these functions.
//
// Rules (docs/TRANSLATING.md):
//   - English and French are ALWAYS supported: every visible text of the core and of every module exists in both, with the same {variables}.
//   - Another language may be PARTIAL: the missing texts fall back (requested language -> site main language -> English). NEVER French by accident.
//   - A plain string in a text field has no language: it is reported as "untagged" (it must become `{ "en": "...", "fr": "..." }`).

/** Languages every text must exist in. */
export const REQUIRED_LANGUAGES = ["en", "fr"];
/** The language of last resort. */
export const LAST_RESORT = "en";
/** A language code: `fr`, `pt`, `pt-BR`, `zh-Hans`. */
export const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** The `{variables}` of a text: simple names only (`{date}`), sorted, without duplicates. */
export function textVariables(text) {
  return [...new Set([...String(text ?? "").matchAll(/\{([\p{L}\p{N}_.:-]+)\}/gu)].map((m) => m[1]))].sort();
}

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The text of a declared value for a person. Fallback chain: requested language -> site main language -> English. Nothing else:
 * no "first value of the object", no French by default. A plain string (older module) is returned as written (it has no language). Empty when nothing matches.
 * @param {string | Record<string, string> | undefined | null} value
 * @param {string} locale the requested language
 * @param {string} [siteDefault] the main language of the site
 */
export function pickText(value, locale, siteDefault) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  for (const lang of chain(locale, siteDefault)) {
    const text = value[lang];
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return "";
}

/** The languages tried, in order, without duplicates: `pt-BR` also tries `pt` right after itself. */
export function chain(locale, siteDefault) {
  const out = [];
  const add = (code) => {
    if (typeof code !== "string" || !code) return;
    for (const c of [code, code.split("-")[0]]) if (c && !out.includes(c)) out.push(c);
  };
  add(locale);
  add(siteDefault);
  add(LAST_RESORT);
  return out;
}

/* ───────────────────────── The texts of a manifest ───────────────────────── */

/**
 * Every text of a manifest that a person reads, with its path. `kind`: "text" (shown to people) or "agent" (MCP tool descriptions, read by an AI assistant:
 * written in English in the manifest, translated through the optional top-level `i18n` block).
 * `apply(lang, text)` adds a translation in place (only where the manifest already uses a `{ "en": ..., "fr": ... }` record; a plain string is left alone).
 * @param {any} man a parsed `module.json`
 * @returns {{ path: string, kind: "text" | "agent", value: unknown, apply: (lang: string, text: string) => void }[]}
 */
export function manifestTextEntries(man) {
  const out = [];
  const add = (path, holder, key, kind = "text") => {
    if (!holder || typeof holder !== "object" || holder[key] === undefined) return;
    out.push({ path, kind, value: holder[key], apply: (lang, text) => { if (isRecord(holder[key])) holder[key][lang] = text; } });
  };
  const setting = (path, f) => {
    for (const k of ["label", "help", "unit", "example"]) add(`${path}.${k}`, f, k);
    for (const o of Array.isArray(f?.options) ? f.options : []) add(`${path}.option:${o?.value}`, o, "label");
  };
  add("name", man, "name"); add("description", man, "description"); add("privacy", man, "privacy");
  for (const f of man?.settings ?? []) setting(`setting:${f?.key}`, f);
  for (const s of man?.sections ?? []) { add(`section:${s?.id}.label`, s, "label"); for (const f of s?.options ?? []) setting(`section:${s?.id}.${f?.key}`, f); }
  for (const t of man?.tabs ?? []) add(`tab:${t?.id}.label`, t, "label");
  for (const g of man?.optionalGroups ?? []) for (const k of ["label", "addLabel", "removeLabel"]) add(`group:${g?.id}.${k}`, g, k);
  for (const r of man?.rights ?? []) { add(`right:${r?.id}.label`, r, "label"); add(`right:${r?.id}.help`, r, "help"); }
  for (const p of man?.entryPanels ?? []) { add(`entryPanel:${p?.id}.title`, p, "title"); add(`entryPanel:${p?.id}.help`, p, "help"); }
  for (const e of man?.overlayElements ?? []) { add(`overlayElement:${e?.id}.label`, e, "label"); add(`overlayElement:${e?.id}.description`, e, "description"); }
  for (const c of man?.consumes ?? []) add(`consumes:${c?.topic}.label`, c, "label");
  for (const c of man?.provides ?? []) add(`provides:${c?.topic}.label`, c, "label");
  for (const c of man?.offers ?? []) add(`offers:${c?.service}.label`, c, "label");
  for (const c of man?.requires ?? []) if (isRecord(c)) add(`requires:${c.service}.label`, c, "label");
  for (const s of man?.seeds ?? []) add(`seed:${s?.module}.reason`, s, "reason");
  for (const t of man?.content?.templates ?? []) for (const k of ["name", "description", "title", "summary", "body"]) add(`template:${t?.id}.${k}`, t, k);
  for (const k of ["title", "summary", "body"]) add(`onboarding.sample.${k}`, man?.onboarding?.sample, k);
  for (const e of man?.logEvents ?? []) add(`logEvent:${e?.key}.label`, e, "label");
  for (const p of man?.previews ?? []) { add(`preview:${p?.file}.caption`, p, "caption"); add(`preview:${p?.file}.alt`, p, "alt"); }
  const dash = man?.dashboard ?? {};
  for (const t of dash.tasks ?? []) add(`dashboard.task:${t?.id}.label`, t, "label");
  for (const q of dash.quickActions ?? []) add(`dashboard.action:${q?.id}.label`, q, "label");
  for (const c of dash.cards ?? []) { add(`dashboard.card:${c?.id}.title`, c, "title"); add(`dashboard.card:${c?.id}.empty`, c, "empty"); }
  // Agent-facing: the plain string is English; `i18n.<lang>["mcp.<tool>"]` translates it.
  for (const t of man?.mcp ?? []) {
    const translations = {};
    for (const [lang, table] of Object.entries(isRecord(man?.i18n) ? man.i18n : {})) if (isRecord(table) && typeof table[`mcp.${t?.name}`] === "string") translations[lang] = table[`mcp.${t.name}`];
    out.push({
      path: `mcp:${t?.name}.description`, kind: "agent", value: { en: t?.description, ...translations },
      apply: (lang, text) => { man.i18n = isRecord(man.i18n) ? man.i18n : {}; man.i18n[lang] = isRecord(man.i18n[lang]) ? man.i18n[lang] : {}; man.i18n[lang][`mcp.${t.name}`] = text; },
    });
  }
  return out;
}

/** Prefix of the keys that carry manifest texts inside a module's `locales/<code>.json`: `"manifest.setting:color.label": "..."`. */
export const MANIFEST_KEY_PREFIX = "manifest.";

/**
 * Adds to a manifest the translations that a module ships in its language files (`locales/<code>.json`, keys `manifest.<path>`), for the languages other than
 * English and French (those are written in the manifest itself). This is how a language is added with files only. Mutates and returns the manifest.
 * @param {any} man
 * @param {Record<string, Record<string, string>>} locales
 */
export function applyTranslations(man, locales) {
  const entries = manifestTextEntries(man);
  for (const [lang, table] of Object.entries(locales ?? {})) {
    if (REQUIRED_LANGUAGES.includes(lang) || !LANG_CODE_RE.test(lang) || !isRecord(table)) continue;
    for (const e of entries) {
      const text = table[MANIFEST_KEY_PREFIX + e.path];
      if (typeof text === "string" && text.trim() !== "") e.apply(lang, text);
    }
  }
  return man;
}

/** The keys a translator fills in for a module: every manifest text (`manifest.<path>`), listed with its English text. */
export function manifestSkeleton(man) {
  return manifestTextEntries(man).map((e) => ({ key: MANIFEST_KEY_PREFIX + e.path, english: isRecord(e.value) ? e.value.en ?? "" : String(e.value ?? "") })).filter((x) => x.english);
}

/**
 * Audit of the texts of a manifest.
 * Problems: "untagged" (plain string: no language), "missing" (a required language is absent), "empty", "variables" (not the same {variables} in every language),
 * "code" (not a language code), "overlay" (the `i18n` block names a tool that does not exist or has a bad code).
 * `severity`: "error" for the texts people read, "advisory" for MCP tool descriptions (reported, never blocking).
 * Other declared languages are allowed to be partial: their coverage is in `languages`.
 * @param {any} man
 * @param {{ required?: string[] }} [opts]
 */
export function auditManifest(man, opts = {}) {
  const required = opts.required ?? REQUIRED_LANGUAGES;
  const gaps = [];
  const stats = {};
  const entries = manifestTextEntries(man);
  const gap = (e, lang, problem, detail = "") => gaps.push({ path: e.path, lang, problem, detail, severity: e.kind === "agent" ? "advisory" : "error", key: `${e.path}[${lang}] ${problem}` });
  for (const e of entries) {
    if (typeof e.value === "string") {
      // An `example` is a value to type ("https://example.org/news", "etoile_nord"), the same in every language: a plain string is fine.
      if (e.kind === "text" && !e.path.endsWith(".example")) gap(e, "*", "untagged", e.value.slice(0, 40));
      continue;
    }
    if (!isRecord(e.value)) continue;
    const langs = Object.keys(e.value);
    for (const lang of langs) {
      if (!LANG_CODE_RE.test(lang)) { gap(e, lang, "code"); continue; }
      stats[lang] = stats[lang] ?? { translated: 0 };
      if (typeof e.value[lang] !== "string" || e.value[lang].trim() === "") gap(e, lang, "empty");
      else stats[lang].translated++;
    }
    for (const lang of required) {
      if (!(lang in e.value)) gap(e, lang, "missing");
    }
    const base = typeof e.value.en === "string" ? textVariables(e.value.en) : null;
    if (base) for (const lang of langs) if (lang !== "en" && typeof e.value[lang] === "string" && textVariables(e.value[lang]).join() !== base.join()) gap(e, lang, "variables", `{${base.join("} {")}}`);
  }
  const total = entries.filter((e) => e.kind === "text").length;
  // The `i18n` block: only known tools, only valid codes, no empty text.
  const tools = new Set((man?.mcp ?? []).map((t) => t?.name));
  if (man?.i18n !== undefined) {
    if (!isRecord(man.i18n)) gaps.push({ path: "i18n", lang: "*", problem: "overlay", detail: "must be an object", severity: "error", key: "i18n overlay" });
    else for (const [lang, table] of Object.entries(man.i18n)) {
      if (!LANG_CODE_RE.test(lang)) { gaps.push({ path: `i18n.${lang}`, lang, problem: "code", detail: "", severity: "error", key: `i18n.${lang} code` }); continue; }
      if (!isRecord(table)) { gaps.push({ path: `i18n.${lang}`, lang, problem: "overlay", detail: "must be an object", severity: "error", key: `i18n.${lang} overlay` }); continue; }
      for (const [k, v] of Object.entries(table)) {
        const tool = /^mcp\.([a-z][a-z0-9_]{1,39})$/.exec(k)?.[1];
        if (!tool || !tools.has(tool)) gaps.push({ path: `i18n.${lang}.${k}`, lang, problem: "overlay", detail: "unknown key", severity: "error", key: `i18n.${lang}.${k} overlay` });
        else if (typeof v !== "string" || v.trim() === "") gaps.push({ path: `i18n.${lang}.${k}`, lang, problem: "empty", detail: "", severity: "error", key: `i18n.${lang}.${k} empty` });
      }
    }
  }
  const languages = Object.fromEntries(Object.entries(stats).filter(([l]) => LANG_CODE_RE.test(l)).map(([lang, s]) => [lang, { translated: Math.min(s.translated, total), total, percent: total ? Math.floor((100 * Math.min(s.translated, total)) / total) : 100 }]));
  for (const lang of required) languages[lang] ??= { translated: 0, total, percent: total ? 0 : 100 };
  return { total, gaps: gaps.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), languages, errors: gaps.filter((g) => g.severity === "error"), advisories: gaps.filter((g) => g.severity === "advisory") };
}

/* ───────────────────────── Dictionaries (flat key -> text) ───────────────────────── */

/**
 * Coverage of every dictionary against the English one (the reference: the same keys, the same {variables}).
 * @param {Record<string, Record<string, string>>} dictionaries by language
 * @param {{ required?: string[], reference?: string }} [opts]
 */
export function auditDictionaries(dictionaries, opts = {}) {
  const required = opts.required ?? REQUIRED_LANGUAGES;
  const reference = opts.reference ?? "en";
  const ref = dictionaries[reference] ?? {};
  const keys = Object.keys(ref).filter((k) => !k.startsWith("_"));
  const out = {};
  for (const lang of new Set([...required, ...Object.keys(dictionaries)])) {
    const dict = dictionaries[lang] ?? {};
    const missing = [], empty = [], variables = [];
    for (const k of keys) {
      if (!(k in dict)) { missing.push(k); continue; }
      if (typeof dict[k] !== "string" || dict[k].trim() === "") { empty.push(k); continue; }
      if (lang !== reference && textVariables(dict[k]).join() !== textVariables(ref[k]).join()) variables.push(k);
    }
    const extra = Object.keys(dict).filter((k) => !k.startsWith("_") && !(k in ref));
    const translated = keys.length - missing.length - empty.length;
    out[lang] = { total: keys.length, translated, percent: keys.length ? Math.floor((100 * translated) / keys.length) : 100, missing, empty, variables, extra, required: required.includes(lang) };
  }
  return out;
}

/** The status of a language for a person: "official" (English, French), else "community"; "complete" or "partial: 82%". */
export function languageLabel({ status, percent }) {
  return { status, coverage: percent >= 100 ? "complete" : `partial: ${percent}%` };
}

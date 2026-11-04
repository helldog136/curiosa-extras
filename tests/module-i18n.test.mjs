// Languages of the modules: English AND French are always required; any other language may be partial; the catalogue publishes every language.
// tests/i18n-baseline.json lists the KNOWN gaps (a ratchet: it can only shrink). See docs/TRANSLATING.md of the core.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempDir } from "./helpers/tmp.mjs";
import * as A from "../scripts/i18n-audit.mjs";
import { readModules } from "../scripts/ergonomics-baseline.mjs";
import { COUNTERS, baselineGrowth, currentStatus, formatReport, moduleStatus, phaseTwoPlan, ratchetProblems, readBaseline, reportRows, staleModules, toBaseline } from "../scripts/i18n-baseline.mjs";
import { entryTexts } from "../scripts/rules.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const modules = readModules(root);
const status = currentStatus(root);
const baseline = readBaseline();
const index = JSON.parse(fs.readFileSync(path.join(root, "catalogue/index.json"), "utf8"));
const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const EF = (en, fr) => ({ en, fr });

test("the helper is a verbatim copy of the core's: one set of rules", () => {
  const original = path.join(core, "src/core/i18n/audit.mjs");
  if (!fs.existsSync(original)) return; // an older core: nothing to compare with
  const strip = (s) => s.replace(/^\/\/ VERBATIM COPY[^\n]*\n\/\/ Change it[^\n]*\n/, "");
  assert.equal(strip(fs.readFileSync(path.join(root, "scripts/i18n-audit.mjs"), "utf8")), fs.readFileSync(original, "utf8"), "copy src/core/i18n/audit.mjs of the core here, unchanged");
});

/* ───────────── the ratchet ───────────── */

test("the baseline exists, is sorted, and only talks about modules of this repository", () => {
  assert.ok(baseline, "tests/i18n-baseline.json is missing: node scripts/i18n-baseline.mjs --write");
  assert.equal(baseline.version, 1);
  assert.deepEqual(staleModules(status, baseline), [], "a removed module is still listed");
  for (const [id, keys] of Object.entries(baseline.modules)) assert.deepEqual([...keys].sort(), keys, `${id}: sorted`);
});

for (const m of modules) {
  test(`[${m.name}] translations: English and French complete, no new gap, no gap left in the baseline once fixed`, (t) => {
    const s = status[m.name];
    const problems = ratchetProblems({ [m.name]: s }, baseline);
    if (s.agentTools) t.diagnostic(`${s.agentTools} MCP tool description(s) without a French translation (advisory)`);
    if (s.frenchDefaults) t.diagnostic(`${s.frenchDefaults} place(s) in the code that choose French for every language except English`);
    assert.deepEqual(problems, [], `\n${problems.join("\n")}\nSee docs/TRANSLATING.md of the core. The baseline only shrinks: node scripts/i18n-baseline.mjs --write`);
  });
}

test("counters: the totals of the baseline are the sums, and they can only go down (compared to the base branch when available)", () => {
  assert.deepEqual(baseline.totals, toBaseline(status).totals, "node scripts/i18n-baseline.mjs --write");
  assert.equal(baseline.totals.manifest, 0, "phase 1: every manifest text is declared in English and French");
  assert.equal(baseline.totals.localeFiles, 0, "phase 1: every locale file is complete in English and French");
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const ref = ["origin/dev", "origin/main"].find((r) => git("rev-parse", "--verify", "-q", r).status === 0);
  const old = ref ? git("show", `${ref}:tests/i18n-baseline.json`) : null;
  if (!old || old.status !== 0) return; // first baseline of the repository, or no base branch here
  assert.deepEqual(baselineGrowth(JSON.parse(old.stdout), baseline), [], "the baseline grew compared to the base branch");
});

test("ratchet: a new gap fails, a fixed gap must leave the baseline, a counter that goes up fails, a growing baseline is refused", () => {
  const man = { id: "demo", name: EF("Demo", "Démo"), description: "A plain description" };
  const m = { name: "demo", dir: makeTempDir("curiosa-i18n-empty-"), manifest: man, locales: {} };
  const s = { demo: moduleStatus(m) };
  assert.deepEqual(s.demo.manifest, ["description[*] untagged"]);
  assert.match(ratchetProblems(s, { modules: {} }).join(), /NEW gap/);
  assert.deepEqual(ratchetProblems(s, { modules: { demo: ["description[*] untagged"] } }), []);
  assert.match(ratchetProblems(s, { modules: { demo: ["description[*] untagged", "name[fr] missing"] } }).join(), /is fixed/);
  assert.match(ratchetProblems({ demo: { ...s.demo, agentTools: 2 } }, { modules: { demo: ["description[*] untagged"] }, agentTools: { demo: 1 } }).join(), /went up/);
  assert.match(ratchetProblems({ demo: { ...s.demo, agentTools: 0 } }, { modules: { demo: ["description[*] untagged"] }, agentTools: { demo: 1 } }).join(), /went down/);
  assert.deepEqual(baselineGrowth({ modules: { demo: [] } }, { modules: { demo: ["x"] } }), ["demo: x"]);
  assert.deepEqual(baselineGrowth({ modules: { demo: ["x"] }, agentTools: { demo: 3 } }, { modules: { demo: [] }, agentTools: { demo: 2 } }), []);
});

test("report: lists the modules with a gap and a phase-2 plan in batches of ten", () => {
  const rows = reportRows(status);
  assert.ok(rows.every((r) => r.total > 0));
  const batches = phaseTwoPlan(rows);
  assert.ok(batches.every((b) => b.length <= 10));
  assert.equal(batches.flat().length, rows.length);
  const text = formatReport(status);
  assert.match(text, /TOTAL/);
  assert.match(text, /Phase 2/);
  assert.equal(COUNTERS.length, 4);
});

test("a manifest gap is found in every kind of text: plain string, missing language, empty, other {variables}, bad code, wrong i18n block", () => {
  const r = A.auditManifest({
    name: "Plain", description: EF("Hello {name}", "Bonjour"), mcp: [{ name: "list_x", description: "List." }],
    settings: [{ key: "a", label: EF("A", ""), example: "plain examples are fine" }, { key: "b", label: { en: "B" } }, { key: "c", label: { en: "C", fr: "C", "?": "x" } }],
    i18n: { fr: { "mcp.nope": "x" }, "bad code": {} },
  });
  const problems = Object.fromEntries(r.errors.map((g) => [g.problem, true]));
  for (const p of ["untagged", "variables", "empty", "missing", "code", "overlay"]) assert.ok(problems[p], p);
  assert.ok(!r.errors.some((g) => g.path.endsWith(".example")));
});

/* ───────────── community languages: files only ───────────── */

test("community languages (locales/<code>.json): valid code, keys known, texts keep the {variables} of English; partial is accepted", () => {
  const problems = [];
  for (const m of modules) {
    const en = m.locales.en ?? {};
    const paths = new Set(A.manifestSkeleton(m.manifest).map((x) => x.key));
    for (const [lang, table] of Object.entries(m.locales)) {
      if (["en", "fr"].includes(lang)) continue;
      if (!/^[a-z]{2}$/.test(lang)) problems.push(`${m.name}: locales/${lang}.json is not a two-letter language code`);
      for (const [k, v] of Object.entries(table)) {
        if (typeof v !== "string") { problems.push(`${m.name}/${lang}: ${k} is not a text`); continue; }
        if (!v.trim()) continue; // empty = not translated yet: fine
        const english = k.startsWith(A.MANIFEST_KEY_PREFIX) ? m.manifest && A.manifestSkeleton(m.manifest).find((x) => x.key === k)?.english : en[k];
        if (english === undefined) problems.push(`${m.name}/${lang}: unknown key ${k}`);
        else if (A.textVariables(v).join() !== A.textVariables(english).join()) problems.push(`${m.name}/${lang}: ${k} does not keep the {variables} of English`);
        if (k.startsWith(A.MANIFEST_KEY_PREFIX) && !paths.has(k)) problems.push(`${m.name}/${lang}: ${k} is not a text of module.json`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("skeleton and translation: the add-language script writes a skeleton, and the translated texts reach the catalogue and the module", () => {
  const dir = makeTempDir("curiosa-lang-extras-");
  const mod = path.join(dir, "modules/demo");
  fs.mkdirSync(path.join(mod, "locales"), { recursive: true });
  const manifest = { id: "demo", name: EF("Demo", "Démo"), description: EF("A demo", "Une démo"), settings: [{ key: "t", type: "text", label: EF("Title", "Titre") }] };
  fs.writeFileSync(path.join(mod, "module.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(mod, "locales/en.json"), JSON.stringify({ hi: "Hi {n}" }));
  fs.writeFileSync(path.join(mod, "locales/fr.json"), JSON.stringify({ hi: "Salut {n}" }));
  const script = path.join(core, "scripts/i18n-add-language.mjs");
  if (fs.existsSync(script)) {
    const r = spawnSync(process.execPath, [script, "nl", "--modules", dir, "--no-core"], { cwd: core, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const sk = JSON.parse(fs.readFileSync(path.join(mod, "locales/nl.json"), "utf8"));
    assert.deepEqual(Object.keys(sk).sort(), ["hi", "manifest.description", "manifest.name", "manifest.setting:t.label"]);
    assert.ok(Object.values(sk).every((v) => v === ""));
  }
  const nl = { "manifest.name": "Demo NL", "manifest.description": "Een demo", "manifest.setting:t.label": "Titel", hi: "Hoi {n}" };
  const texts = entryTexts(manifest, { nl });
  assert.deepEqual(Object.keys(texts.i18n), ["en", "fr", "nl"], "English and French first, then the community languages");
  assert.deepEqual(texts.i18n.nl, { name: "Demo NL", description: "Een demo" });
  assert.equal(texts.name, "Demo", "the plain text is English");
  const merged = A.applyTranslations(structuredClone(manifest), { nl });
  assert.equal(A.pickText(merged.settings[0].label, "nl", "en"), "Titel");
  assert.equal(moduleStatus({ name: "demo", dir: mod, manifest, locales: { en: { hi: "Hi {n}" }, fr: { hi: "Salut {n}" }, nl } }).localeFiles, 0, "a community language never creates a gap");
  assert.deepEqual(moduleStatus({ name: "demo", dir: mod, manifest, locales: { en: { hi: "Hi {n}" }, fr: {} } }).localeFiles, 1);
});

/* ───────────── the catalogue ───────────── */

test("catalogue index: the plain name and description are ENGLISH, and every language is published (never one flattened language)", () => {
  const byId = Object.fromEntries(modules.map((m) => [m.manifest.id, m]));
  assert.equal(index.modules.length, modules.length);
  for (const e of index.modules) {
    const m = byId[e.id];
    assert.ok(m, e.id);
    const expected = entryTexts(m.manifest, m.locales);
    assert.equal(e.name, m.manifest.name.en, `${e.id}: the plain name is the English one`);
    assert.equal(e.description, m.manifest.description?.en ?? "", `${e.id}: the plain description is the English one`);
    assert.deepEqual(e.i18n, expected.i18n, `${e.id}: i18n = the texts of module.json (node scripts/build-index.mjs)`);
    for (const l of ["en", "fr"]) assert.ok(e.i18n[l].name && e.i18n[l].description, `${e.id}: ${l}`);
  }
});

test("catalogue index per language: the three suggested extensions read in English and in French, with no word of the other language", () => {
  const suggested = JSON.parse(fs.readFileSync(path.join(root, "catalogue/suggested.json"), "utf8"));
  assert.deepEqual([...suggested].sort(), ["blog", "links", "pages"]);
  const FRENCH = /\b(des|une|avec|vos|votre|simplement|ajoutez|liens|pages libres)\b/i;
  const ENGLISH = /\b(the|with|your|simply|add|articles with|free-form)\b/i;
  for (const id of suggested) {
    const e = index.modules.find((x) => x.id === id);
    assert.doesNotMatch(e.description, FRENCH, `${id}: the plain (English) description has no French word`);
    assert.doesNotMatch(e.i18n.en.description, FRENCH, `${id}: en`);
    assert.doesNotMatch(e.i18n.fr.description, ENGLISH, `${id}: fr`);
  }
});

test("every language of an entry is a valid code; texts are within the core's limits (name 120, description 500)", () => {
  for (const e of index.modules) for (const [lang, t] of Object.entries(e.i18n)) {
    assert.match(lang, A.LANG_CODE_RE, `${e.id}: ${lang}`);
    assert.ok((t.name ?? "").length <= 120 && (t.description ?? "").length <= 500, `${e.id}/${lang}: length`);
    assert.ok(!t.name || t.name.trim(), `${e.id}/${lang}: empty name`);
  }
  assert.ok(fs.statSync(path.join(root, "catalogue/index.json")).size < 1024 * 1024, "the core refuses an index above 1 MB");
});

test("entryTexts: plain strings (older modules) are kept as they are and publish no language", () => {
  const t = entryTexts({ name: "Plain", description: "Plain text" });
  assert.deepEqual(t, { name: "Plain", description: "Plain text" });
  assert.deepEqual(entryTexts({ name: EF("A", "B"), description: { en: "C" } }).i18n, { en: { name: "A", description: "C" }, fr: { name: "B" } });
});

/* ───────────── the setup wizard needs these ───────────── */

test("everything the setup wizard shows is complete in English and French: suggested extensions, their page templates, the starting profiles", () => {
  const profiles = JSON.parse(fs.readFileSync(path.join(root, "catalogue/profiles.json"), "utf8")).profiles;
  const wanted = new Set([...JSON.parse(fs.readFileSync(path.join(root, "catalogue/suggested.json"), "utf8")), ...profiles.flatMap((p) => p.modules)]);
  for (const id of wanted) {
    const m = modules.find((x) => x.manifest.id === id);
    assert.ok(m, id);
    assert.deepEqual(status[m.name].manifest, [], `${id}: manifest texts`);
    assert.equal(status[m.name].frenchDefaults, 0, `${id}: no French default in the code`);
    for (const t of m.manifest.content?.templates ?? []) for (const k of ["name", "title", "summary", "body", "description"]) if (t[k] !== undefined) assert.ok(t[k].en?.trim() && t[k].fr?.trim(), `${id}/${t.id}.${k}`);
  }
  for (const p of profiles) for (const k of ["name", "description"]) assert.ok(p[k].en?.trim() && p[k].fr?.trim(), `profile ${p.id}.${k}`);
  for (const p of profiles) for (const ref of p.samples) {
    const [mod, tpl] = ref.split(":");
    assert.ok(modules.find((x) => x.manifest.id === mod)?.manifest.content?.templates?.some((t) => t.id === tpl), `profile ${p.id}: ${ref} exists`);
  }
});

/* ───────────── the legal texts ───────────── */

test("legal pages: texts exist only in the two official languages; another language is never produced (it would need a person from the country)", async () => {
  const dir = path.join(root, "modules/legal-pages");
  const { docLang, DOC_LANGS, buildDocs } = await import(`${dir}/docs.mjs`);
  assert.deepEqual(DOC_LANGS, ["en", "fr"]);
  assert.equal(docLang("nl", { locale: "nl", defaultLocale: "nl" }), "en", "never French by accident");
  assert.equal(docLang(undefined, { locale: "nl", defaultLocale: "fr" }), "fr", "the main language of the site comes second");
  assert.equal(docLang("fr", { locale: "en" }), "fr");
  assert.equal(docLang(undefined, { locale: "en", defaultLocale: "fr" }), "en");
  const a = { country: "BE" };
  const built = buildDocs({ answers: a, facts: { siteName: { en: "Demo" } }, lang: "nl", mode: "preview" });
  const english = buildDocs({ answers: a, facts: { siteName: { en: "Demo" } }, lang: "en", mode: "preview" });
  assert.equal(built.notice.title, english.notice.title, "a request for another language gives the English text, not a text pretending to be Dutch");
  assert.match(fs.readFileSync(path.join(dir, "locales/en.json"), "utf8"), /not legal advice/i);
});

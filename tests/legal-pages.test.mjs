// Mentions légales (legal-pages) : le manifeste, ce que le site sait des extensions, les questions et leurs règles, les trois textes (FR + EN, six pays),
// la publication « jamais à trous », les pages publiques, l'administration de bout en bout, les rappels, les outils pour les assistants.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = path.join(ROOT, "modules/legal-pages");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(DIR, p), "utf8"));
const manifest = readJson("module.json");
const locales = { fr: readJson("locales/fr.json"), en: readJson("locales/en.json") };
const def = (await import("../modules/legal-pages/index.mjs")).default;
const A = await import("../modules/legal-pages/answers.mjs");
const D = await import("../modules/legal-pages/docs.mjs");
const K = await import("../modules/legal-pages/known.mjs");
const P = await import("../modules/legal-pages/public.mjs");
const Data = await import("../modules/legal-pages/data.mjs");
const Admin = await import("../modules/legal-pages/admin.mjs");

let seq = 0;
/** Un contexte factice complet (langue, textes, stockage, extensions actives). Chaque appel a ses propres données. */
const ctxFor = (opts = {}) => {
  const locale = opts.locale ?? "fr";
  return fakeCtx({
    moduleId: "legal-pages", key: `legal-pages${++seq}`, name: "Mentions légales", basePath: "legal", locale, defaultLocale: "fr", locales: ["fr", "en"],
    messages: locales[locale], settings: { footerLinks: "one", reviewMonths: 12 }, permissions: manifest.permissions,
    site: { name: "Mon site", tagline: "", logo: null },
    brand: { name: "Mon site", tagline: "", about: "", logo: null, contactEmail: "contact@example.org", colors: [], font: { key: "sans", name: "Sans", stack: "sans-serif" }, defaultLocale: "fr", locales: ["fr", "en"] },
    ...opts,
  });
};
/** Un autre contexte qui lit les mêmes données (autre langue, autres extensions…). */
const sameData = (ctx, opts = {}) => ctxFor({ ...opts, rows: Object.fromEntries(["answers", "pages", "state"].map((c) => [c, ctx.dumpStore().filter((r) => r.collection === c).map((r) => r.data)])) });
const inst = (module, name = module) => ({ id: `i-${module}`, key: module, module, basePath: null, name, adminPath: `/admin/instances/i-${module}` });

/** Des réponses complètes et valables pour un pays et un statut. */
function full(country, status, extra = {}) {
  const a = A.withDefaults({}, { detected: {}, thirdPartyNames: [], brandEmail: "contact@example.org", unknown: [] });
  Object.assign(a, { country, status, name: status === "association" ? "Les Amis du Test" : "Jeanne Martin", email: "contact@example.org", phone: "+32 2 123 45 67", address: "12 rue des Lilas\n1000 Bruxelles",
    hostName: "Hébergeur Test SA", hostAddress: "1 avenue du Serveur\n75000 Paris", hostPhone: "+33 1 23 45 67 89" });
  if (status !== "person") Object.assign(a, { legalForm: "SRL", regNumber: { BE: "0123.456.789", FR: "123 456 789 00012", CH: "CHE-123.456.789", CA_QC: "1234567890" }[country] ?? "ABC-1", director: "Jeanne Martin", capital: "1 000 €" });
  Object.assign(a, extra);
  a.touched = Object.fromEntries(A.STEPS.map((s) => [s.id, true]));
  return a;
}
const FACTS = { siteName: { fr: "Mon site", en: "My site" }, detected: {}, unknown: [], collectors: [], moduleIds: [], thirdPartyNames: [], brandEmail: "contact@example.org" };

// ── Manifeste ───────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide, une seule instance, une page publique, cœur 0.2.5", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "legal-pages");
  assert.equal(manifest.name.fr, "Mentions légales");
  assert.equal(manifest.name.en, "Legal pages");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.minCore, "0.2.5");
  assert.equal(manifest.instances, "single");
  assert.equal(manifest.page, true);
  assert.equal(manifest.basePath, "legal");
});

test("manifeste : tout ce qui est déclaré est implémenté (et réciproquement)", () => {
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(Object.keys(def.slots), ["layout.footer"]);
  assert.equal(typeof def.page, "function");
  assert.equal(typeof def.adminPanel, "function");
  assert.equal(def.routes, undefined, "aucune route publique : rien n'est écrit par un visiteur");
  assert.equal(def.tasks, undefined, "aucun travail de fond");
  for (const s of manifest.settings) assert.ok(JSON.stringify(def).length > 0 && fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).some((f) => fs.readFileSync(path.join(DIR, f), "utf8").includes(`"${s.key}"`)), `réglage ${s.key} lu par le code`);
  const used = (code) => ["ctx.api.store", "adminPanel", "slots", "mcp", "page"].filter((k) => code.includes(k));
  assert.ok(used(fs.readFileSync(path.join(DIR, "index.mjs"), "utf8")).length >= 4);
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "pages", "slots", "storage"]);
});

test("manifeste : le droit « publier » existe, et publier / retirer ne passent que par lui", () => {
  assert.deepEqual(manifest.rights.map((r) => r.id), ["publish"]);
  assert.equal(manifest.rights[0].sensitive, true);
  assert.equal(manifest.rights[0].default.editor, false);
  for (const name of ["publish", "unpublish"]) assert.equal(def.adminActions[name].right, "publish", name);
});

test("manifeste : l'onglet « Utiliser » est renommé, au plus un onglet ajouté", () => {
  assert.deepEqual(manifest.tabs.map((t) => t.id), ["use"]);
  assert.ok(manifest.tabs.every((t) => t.label.fr.length <= 20 && t.label.en.length <= 20));
});

test("outils pour les assistants : lecture par défaut, écriture jamais d'office, rien ne publie, noms courts", () => {
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.equal(byName.legal_status.readOnly, true);
  assert.equal(byName.legal_preview.readOnly, true);
  assert.notEqual(byName.legal_set_answers.readOnly, true);
  assert.equal(byName.legal_set_answers.default, false);
  for (const a of manifest.mcp) { assert.ok(`legal-pages__${a.name}`.length <= 64); assert.ok(a.description.length > 80); assert.ok(!a.destructive); }
  assert.ok(!Object.keys(byName).some((n) => /publish/.test(n)), "aucun outil ne publie");
  // le schéma de legal_set_answers couvre exactement les champs de l'assistant
  const fields = A.STEPS.flatMap((s) => s.fields.map((f) => f.name)).sort();
  assert.deepEqual(Object.keys(byName.legal_set_answers.input.properties).sort(), fields);
});

test("le module n'a ni cookie, ni appel réseau, ni écriture de fichier", () => {
  const code = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\/\/.*$/gm, "")).join("\n");
  assert.ok(!/\bfetch\s*\(|ctx\.api\.net|Set-Cookie|document\.cookie|writeFile|appendFile|child_process|\beval\(/.test(code));
});

// ── Ce que le site sait des extensions ─────────────────────────────────────────────────────────────────────────

test("extensions connues : celles qui recueillent déclarent `privacy`, celles qui ne recueillent rien n'en déclarent pas", () => {
  const dirs = ["modules", "examples"].flatMap((g) => fs.readdirSync(path.join(ROOT, g), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(ROOT, g, e.name)));
  const manifests = Object.fromEntries(dirs.map((d) => { const m = JSON.parse(fs.readFileSync(path.join(d, "module.json"), "utf8")); return [m.id, m]; }));
  // Exception connue : le lecteur Twitch intégré par live-status n'est pas déclaré dans son manifeste (le cœur ne le dirait donc pas dans /privacy) ; nos pages le disent.
  const UNDECLARED = ["live-status"];
  for (const id of Object.keys(K.COLLECTORS)) if (manifests[id] && !UNDECLARED.includes(id)) assert.ok(manifests[id].privacy, `${id} récolte (table) : il doit déclarer « privacy »`);
  // une extension « sans effet » ne déclare rien, ou déclare en toutes lettres qu'elle ne recueille rien chez les visiteurs
  for (const id of K.QUIET) if (manifests[id]?.privacy) assert.match(manifests[id].privacy.fr, /ne collecte rien|Rien n'est collecté/i, `${id} est dit « sans effet » mais sa déclaration « privacy » parle de données récoltées`);
  for (const id of Object.keys(K.COLLECTORS)) assert.ok(!K.QUIET.includes(id), `${id} ne peut pas être des deux`);
  assert.deepEqual(K.COLLECTORS["live-status"], { thirdParty: ["Twitch"] }, "le lecteur intégré est un service d'un autre site");
});

test("classify : reconnaît ce qui récolte, ignore ce qui est sans effet, signale l'inconnu, ne devine pas", () => {
  const r = K.classify([inst("contact-form", "Contact"), inst("blog"), inst("bluesky"), inst("faq-or-whatever", "Ma nouveauté"), inst("live-status", "Direct"), inst("legal-pages"), inst("blog", "Blog 2")]);
  assert.equal(r.detected.messages, true);
  assert.equal(r.detected.thirdParty, true);
  assert.deepEqual(r.thirdPartyNames, ["Twitch"]);
  assert.equal(r.detected.publicPosts, false);
  assert.deepEqual(r.unknown.map((u) => u.module), ["faq-or-whatever"]);
  assert.deepEqual(r.collectors.map((c) => c.module).sort(), ["contact-form", "live-status"]);
  assert.deepEqual(r.moduleIds, ["blog", "bluesky", "contact-form", "faq-or-whatever", "live-status"], "chaque extension une fois, sans la nôtre");
  assert.deepEqual(K.classify(null).unknown, []);
  assert.deepEqual(K.classify([{ module: "<script>", name: "x" }]).unknown.map((u) => u.module), ["<script>"]);
});

// ── Les questions ──────────────────────────────────────────────────────────────────────────────────────────────

test("questions : 8 étapes au plus, 6 à 8 posées quand on est un particulier qui ne vend rien", () => {
  assert.ok(A.STEPS.length <= 8);
  const person = A.appliedSteps(full("BE", "person"));
  assert.ok(person.length >= 6 && person.length <= 8, person.map((s) => s.id).join());
  assert.ok(A.appliedSteps(full("BE", "company")).length <= 8);
  assert.ok(!A.appliedSteps(full("BE", "person")).some((s) => s.id === "business"), "un particulier n'a pas d'informations officielles à donner");
  assert.ok(!A.appliedSteps(full("BE", "person")).some((s) => s.id === "keep"), "pas de durée de conservation sans messages privés");
  assert.ok(A.appliedSteps({ ...full("BE", "person"), collect: { messages: true } }).some((s) => s.id === "keep"));
});

test("chaque étape et chaque champ a ses textes (libellé, titre, erreur) en français et en anglais", () => {
  for (const lang of ["fr", "en"]) {
    const L = locales[lang];
    for (const step of A.STEPS) {
      for (const k of [`st.${step.id}.title`, `st.${step.id}.short`]) assert.ok(L[k], `${lang} ${k}`);
      for (const f of step.fields) {
        assert.ok(L[`f.${f.name}.label`] || f.labelKey, `${lang} f.${f.name}.label`);
        if (f.type === "select") for (const o of f.options) assert.ok(L[`o.${f.name}.${o}`], `${lang} o.${f.name}.${o}`);
      }
    }
    for (const country of A.COUNTRIES) for (const k of [`f.regNumber.label.${country}`, `f.regNumber.help.${country}`, `st.business.help.${country}`, `st.address.help.${country}`, `doc.notice.reg.${country}`]) assert.ok(L[k], `${lang} ${k}`);
    for (const status of A.STATUSES) for (const k of [`f.name.label.${status}`, `doc.notice.editor.${status}`]) assert.ok(L[k], `${lang} ${k}`);
  }
});

test("chaque message d'erreur dit quoi faire et donne un exemple (sauf les choix dans une liste)", () => {
  const keys = Object.keys(locales.fr).filter((k) => k.startsWith("err.") && !["err.choose", "err.required", "err.step", "err.ack", "err.publishGap", "err.hostAck"].includes(k));
  for (const lang of ["fr", "en"]) for (const k of keys) assert.match(locales[lang][k], /(par exemple|for example|e\.g\.|Exemple|Example|comme sur)/i, `${lang} ${k} sans exemple`);
});

test("étape « pays » : un pays de la liste, rien d'autre", () => {
  const base = A.withDefaults({}, FACTS);
  assert.deepEqual(A.applyStep(base, "country", { country: "" }, FACTS).errors, { country: "err.choose" });
  assert.deepEqual(A.applyStep(base, "country", { country: "NL" }, FACTS).errors, { country: "err.choose" });
  const ok = A.applyStep(base, "country", { country: "CA_QC" }, FACTS);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.answers.country, "CA_QC");
  assert.equal(ok.answers.touched.country, true);
});

test("étape « qui » : nom et e-mail valables, erreurs par champ", () => {
  const base = A.withDefaults({}, { ...FACTS, brandEmail: "" });
  const bad = A.applyStep(base, "who", { status: "person", name: "J", email: "pas une adresse" }, FACTS);
  assert.deepEqual(bad.errors, { name: "err.name", email: "err.email" });
  assert.ok(!bad.answers.touched.who, "une étape en erreur n'est pas validée");
  for (const email of ["a@b", "a b@example.org", "<x>@example.org", "a@example.org\nBcc: x@y.z"]) assert.ok(A.applyStep(base, "who", { status: "person", name: "Jeanne", email }, FACTS).errors.email, email);
  const ok = A.applyStep(base, "who", { status: "company", name: "  Jeanne   Martin ", email: "Jeanne.Martin+site@example.org" }, FACTS);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.answers.name, "Jeanne Martin");
});

test("étape « adresse » : obligatoire pour une activité, facultative pour un particulier (sauf en France), case « ne pas montrer » réservée à la France", () => {
  const person = (country, extra) => ({ ...A.withDefaults({}, FACTS), country, status: "person", ...extra });
  assert.deepEqual(A.applyStep(person("BE"), "address", { address: "", phone: "" }, FACTS).errors, {}, "particulier belge : rien d'obligatoire");
  assert.ok(A.applyStep({ ...person("BE"), status: "self" }, "address", { address: "" }, FACTS).errors.address);
  assert.ok(A.applyStep(person("FR"), "address", { address: "", phone: "" }, FACTS).errors.address, "particulier français : adresse OU case");
  const hidden = A.applyStep(person("FR"), "address", { address: "", hideAddress: "on", hostAck: "on", phone: "" }, FACTS);
  assert.deepEqual(hidden.errors, {});
  assert.equal(hidden.answers.hideAddress, true);
  assert.deepEqual(A.applyStep(person("FR"), "address", { address: "", hideAddress: "on", phone: "" }, FACTS).errors, { hostAck: "err.hostAck" }, "il faut avoir donné son identité à l'hébergeur");
  assert.ok(A.applyStep(person("FR"), "address", { address: "12 rue des Lilas, 75000 Paris", phone: "" }, FACTS).errors.phone, "en France le téléphone suit l'identité publiée");
  assert.deepEqual(A.fieldsFor("address", person("BE"), FACTS).map((f) => f.name), ["address", "phone"]);
  assert.deepEqual(A.fieldsFor("address", person("FR"), FACTS).map((f) => f.name), ["address", "hideAddress", "hostAck", "phone"]);
  assert.ok(A.applyStep(person("BE"), "address", { address: "x", phone: "" }, FACTS).errors.address);
  assert.ok(A.applyStep(person("BE"), "address", { address: "12 rue des Lilas, 1000 Bruxelles", phone: "abc" }, FACTS).errors.phone);
});

test("étape « organisation » : numéro attendu selon le pays, seulement ce qui ne peut pas être le bon numéro est refusé", () => {
  const biz = (country, status = "company") => ({ ...A.withDefaults({}, FACTS), country, status, name: "Jeanne Martin" });
  const run = (country, values, status) => A.applyStep(biz(country, status), "business", { legalForm: "SRL", vat: "", capital: "1 000 €", director: "Jeanne Martin", ...values }, FACTS).errors;
  assert.deepEqual(run("BE", { regNumber: "0123.456.789" }), {});
  assert.deepEqual(run("BE", { regNumber: "BE 0123 456 789" }), {});
  assert.ok(run("BE", { regNumber: "12345" }).regNumber);
  assert.deepEqual(run("FR", { regNumber: "123 456 789 00012" }), {});
  assert.deepEqual(run("FR", { regNumber: "123456789" }), {});
  assert.ok(run("FR", { regNumber: "1234" }).regNumber);
  assert.deepEqual(run("CH", { regNumber: "CHE-123.456.789" }), {});
  assert.ok(run("CH", { regNumber: "123.456.789" }).regNumber);
  assert.deepEqual(run("CA_QC", { regNumber: "1234567890" }), {});
  assert.ok(run("CA_QC", { regNumber: "12" }).regNumber);
  assert.deepEqual(run("OTHER", { regNumber: "ABC-123" }), {});
  assert.ok(run("BE", { regNumber: "" }).regNumber, "une société belge a un numéro d'entreprise");
  assert.deepEqual(run("CA", { regNumber: "" }, "association"), {}, "une association n'a pas toujours de numéro");
  assert.ok(run("FR", { regNumber: "123 456 789 00012", capital: "" }).capital, "capital d'une société française");
  assert.deepEqual(run("BE", { regNumber: "0123.456.789", capital: "" }), {}, "pas de capital demandé hors de France");
  assert.ok(run("FR", { regNumber: "123 456 789 00012", director: "" }).director);
  assert.ok(run("BE", { regNumber: "0123.456.789", vat: "<b>" }).vat);
  assert.deepEqual(A.fieldsFor("business", biz("BE"), FACTS).map((f) => f.name), ["legalForm", "regNumber", "vat"]);
  assert.deepEqual(A.fieldsFor("business", biz("FR"), FACTS).map((f) => f.name), ["legalForm", "regNumber", "vat", "capital", "director"]);
});

test("étape « hébergeur » : tout est nécessaire en France, facultatif ailleurs (la section est alors omise)", () => {
  const base = (country) => ({ ...A.withDefaults({}, FACTS), country });
  assert.deepEqual(Object.keys(A.applyStep(base("FR"), "host", { hostName: "", hostAddress: "", hostPhone: "", hostCountry: "" }, FACTS).errors).sort(), ["hostAddress", "hostName", "hostPhone"]);
  assert.deepEqual(A.applyStep(base("BE"), "host", { hostName: "", hostAddress: "", hostPhone: "", hostCountry: "" }, FACTS).errors, {});
  assert.ok(A.applyStep(base("BE"), "host", { hostName: "X", hostAddress: "", hostPhone: "abc", hostCountry: "" }, FACTS).errors.hostPhone);
});

test("étape « ce que vous récoltez » : le service tiers doit être nommé, les extensions inconnues obligent à répondre", () => {
  const facts = { ...FACTS, unknown: [{ module: "newcomer", name: "Nouveauté" }] };
  const base = A.withDefaults({}, facts);
  const noAnswer = A.applyStep(base, "collect", { collect_thirdParty: "on", thirdPartyNames: "", unknownExt: "" }, facts);
  assert.deepEqual(noAnswer.errors, { thirdPartyNames: "err.required", unknownExt: "err.choose" });
  const some = A.applyStep(base, "collect", { unknownExt: "some", otherCollect: "" }, facts);
  assert.deepEqual(some.errors, { otherCollect: "err.required" });
  assert.deepEqual(A.applyStep(base, "collect", { unknownExt: "none" }, facts).errors, {});
  assert.deepEqual(A.applyStep(base, "collect", { unknownExt: "some", otherCollect: "Un compteur de clics anonyme." }, facts).errors, {});
  // sans extension inconnue, la question n'est pas posée
  assert.ok(!A.fieldsFor("collect", A.withDefaults({}, FACTS), FACTS).some((f) => f.name === "unknownExt"));
  assert.deepEqual(A.applyStep(A.withDefaults({}, FACTS), "collect", {}, FACTS).errors, {});
});

test("préremplissage : l'adresse de contact du site et les extensions reconnues, jamais une valeur inventée", () => {
  const facts = { ...FACTS, detected: { messages: true, thirdParty: true }, thirdPartyNames: ["Twitch"] };
  const a = A.withDefaults(null, facts);
  assert.equal(a.email, "contact@example.org");
  assert.equal(a.collect.messages, true);
  assert.equal(a.collect.thirdParty, true);
  assert.equal(a.thirdPartyNames, "Twitch");
  for (const k of ["name", "address", "phone", "hostName", "regNumber", "country"]) assert.equal(a[k], "", `${k} reste vide`);
  assert.deepEqual(a.touched, {}, "préremplir n'est pas confirmer");
  // ce que la personne a décidé l'emporte sur la détection
  assert.equal(A.withDefaults({ collect: { messages: false } }, facts).collect.messages, false);
  // des valeurs étranges sont ramenées à des valeurs valables
  const odd = A.withDefaults({ country: "ZZ", status: "x", retention: "never", sells: 5, touched: "oui" }, facts);
  assert.equal(odd.country, ""); assert.equal(odd.status, "person"); assert.equal(odd.retention, "y1"); assert.equal(odd.sells, "no"); assert.deepEqual(odd.touched, {});
});

test("ce qui reste à compléter : champs vides, étapes à confirmer, extension inconnue arrivée depuis", () => {
  const empty = A.evaluate(A.withDefaults({}, FACTS), FACTS);
  assert.ok(empty.some((m) => m.step === "country" && m.kind === "empty"));
  assert.ok(empty.some((m) => m.step === "who" && m.field === "name"));
  const prefilledOnly = A.evaluate({ ...full("BE", "person"), touched: {} }, FACTS);
  assert.ok(prefilledOnly.length > 0 && prefilledOnly.every((m) => m.kind === "confirm"), "tout est valable mais rien n'a été confirmé");
  assert.deepEqual(A.evaluate(full("BE", "person"), FACTS), []);
  const facts = { ...FACTS, unknown: [{ module: "newcomer", name: "N" }] };
  const withUnknown = { ...full("BE", "person"), unknownExt: "none", unknownAck: [] };
  assert.deepEqual(A.evaluate(withUnknown, facts), [{ step: "collect", kind: "confirm" }], "une extension inconnue est apparue depuis la réponse");
  assert.deepEqual(A.evaluate({ ...withUnknown, unknownAck: ["newcomer"] }, facts), []);
  // un particulier français sans adresse ni case n'est pas prêt
  assert.ok(A.evaluate(full("FR", "person", { address: "", hostAck: false }), FACTS).some((m) => m.field === "address"));
});

test("applyPatch (assistant) : vérifie la forme, n'exige rien, ne valide aucune étape", () => {
  const base = A.withDefaults({}, FACTS);
  const ok = A.applyPatch(base, { name: "Jeanne Martin", country: "BE", collect_messages: true }, FACTS);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.answers.name, "Jeanne Martin");
  assert.equal(ok.answers.collect.messages, true);
  assert.deepEqual(ok.answers.touched, {});
  assert.deepEqual(A.applyPatch(base, { email: "nope", country: "NL" }, FACTS).errors, { email: "err.email", country: "err.choose" });
});

test("empreinte : change avec une réponse, pas avec une simple confirmation", () => {
  const a = full("BE", "person");
  const same = { ...a, touched: {}, unknownAck: ["x"] };
  assert.equal(A.fingerprintSource(a), A.fingerprintSource(same));
  assert.notEqual(A.fingerprintSource(a), A.fingerprintSource({ ...a, name: "Autre" }));
  assert.notEqual(Data.fingerprint(a, FACTS), Data.fingerprint(a, { ...FACTS, siteName: { fr: "Nouveau nom", en: "My site" } }), "un nouveau nom de site change les textes");
});

// ── Les textes ─────────────────────────────────────────────────────────────────────────────────────────────────

const SCENARIOS = A.COUNTRIES.flatMap((country) => A.STATUSES.map((status) => [country, status]));

test("textes : chaque pays × chaque statut × chaque langue donne trois pages complètes, sans manque, sans clé brute ni « undefined »", () => {
  for (const [country, status] of SCENARIOS) {
    const answers = full(country, status, { collect: { messages: true, publicPosts: true, memory: true, chat: true, list: true, thirdParty: true }, thirdPartyNames: "Twitch", listTool: "Outil d'envoi", hostCountry: "Belgique", sells: "elsewhere", sellsWhere: "Ma boutique", unknownExt: "some", otherCollect: "Un compteur anonyme." });
    for (const lang of ["fr", "en"]) {
      const built = D.buildDocs({ answers, facts: FACTS, lang, mode: "final" });
      assert.deepEqual(built.gaps, []);
      for (const key of ["notice", "privacy", "cookies"]) {
        const doc = built[key];
        assert.ok(doc.title && doc.description && doc.md.length > 200, `${country}/${status}/${lang}/${key}`);
        assert.ok(!/\b(?:doc|f|o|err|st|adm|public)\.[a-zA-Z]+(?:\.[a-zA-Z_]+)*\b/.test(doc.md.replace(/https?:\/\/\S+/g, "")), `clé brute dans ${country}/${status}/${lang}/${key}: ${doc.md.match(/\b(?:doc|f|o|err|st|adm|public)\.[a-zA-Z.]+/)}`);
        assert.ok(!/undefined|null|NaN|\[object|\{\w+\}|⚠/.test(doc.md), `valeur vide dans ${country}/${status}/${lang}/${key}`);
        assert.ok(!/^[-*] .*: *$/m.test(doc.md), "aucune ligne « Libellé : » sans valeur");
        assert.ok(!/^## .*\n\n(?:## |$)/m.test(doc.md + "\n"), "aucune section vide");
      }
    }
  }
});

test("textes : l'autorité de protection des données est la bonne pour chaque pays", () => {
  const privacy = (country, lang = "fr") => D.buildDocs({ answers: full(country, "person"), facts: FACTS, lang, mode: "final" }).privacy.md;
  assert.match(privacy("BE"), /autoriteprotectiondonnees\.be/);
  assert.match(privacy("FR"), /cnil\.fr/);
  assert.match(privacy("CH"), /edoeb\.admin\.ch/);
  assert.match(privacy("CA"), /priv\.gc\.ca/);
  assert.match(privacy("CA_QC"), /cai\.gouv\.qc\.ca/);
  assert.match(privacy("CA_QC"), /responsable de la protection des renseignements personnels/);
  assert.doesNotMatch(privacy("OTHER"), /https?:\/\//, "pays inconnu : aucune autorité inventée");
  assert.match(privacy("OTHER"), /autorité chargée de la protection des données/);
  assert.match(privacy("BE", "en"), /Data Protection Authority/);
  const cookies = (country) => D.buildDocs({ answers: full(country, "person"), facts: FACTS, lang: "fr", mode: "final" }).cookies.md;
  assert.match(cookies("BE"), /autoriteprotectiondonnees\.be/);
  assert.match(cookies("FR"), /cnil\.fr/);
  assert.doesNotMatch(cookies("CH"), /https?:\/\//);
  for (const [k, url] of Object.entries(D.AUTHORITY_URLS)) assert.match(url, /^https:\/\/[a-z.]+$/, k);
});

test("mentions légales : ce que la loi demande pour la France (hébergeur, directeur de la publication, SIRET, capital) et rien d'inventé ailleurs", () => {
  const notice = (country, status, extra, lang = "fr") => D.buildDocs({ answers: full(country, status, extra), facts: FACTS, lang, mode: "final" }).notice.md;
  const fr = notice("FR", "company");
  for (const needle of ["Hébergeur Test SA", "Directeur ou directrice de la publication : Jeanne Martin", "SIRET", "Capital social", "Forme juridique", "+33 1 23 45 67 89"]) assert.ok(fr.includes(needle), needle);
  const be = notice("BE", "company");
  assert.ok(be.includes("Numéro d'entreprise (BCE) : 0123\\.456\\.789") || be.includes("0123"), "BCE");
  assert.ok(!/Directeur ou directrice de la publication|Capital social/.test(be), "demandés en France seulement");
  const person = notice("BE", "person", { phone: "", hostName: "", hostAddress: "", hostPhone: "" });
  assert.ok(!/Hébergement|Téléphone|Forme juridique|Numéro/.test(person), "particulier belge sans hébergeur ni téléphone : ces lignes sont omises, pas laissées vides");
  assert.match(person, /Adresse : 12 rue des Lilas/);
  const hidden = notice("FR", "person", { address: "", hideAddress: true, hostAck: true, phone: "" });
  assert.match(hidden, /communiquées à l'hébergeur/);
  assert.doesNotMatch(hidden, /Adresse : 12 rue|Lilas/, "l'adresse n'est pas publiée");
  assert.match(hidden, /Hébergeur Test SA/);
  assert.match(notice("FR", "person", { hideAddress: false }, "en"), /Publication director/);
  // un site qui vend ailleurs le dit ; qui vend ici : rien dans le texte public (le rappel est dans l'administration)
  assert.match(notice("BE", "person", { sells: "elsewhere", sellsWhere: "Ma boutique" }), /Ma boutique/);
  assert.doesNotMatch(notice("BE", "person", { sells: "here" }), /Achats/);
});

test("confidentialité : n'affirme que ce qui est coché, avec la durée choisie ; une base légale seulement en Belgique et en France", () => {
  const privacy = (country, collect, extra = {}) => D.buildDocs({ answers: full(country, "person", { collect, ...extra }), facts: FACTS, lang: "fr", mode: "final" }).privacy.md;
  const none = privacy("BE", {});
  assert.match(none, /ne vous demande aucune information personnelle/);
  assert.doesNotMatch(none, /Si vous nous écrivez|lettre d'information|Combien de temps/);
  const msg = privacy("BE", { messages: true }, { retention: "y3" });
  assert.match(msg, /Si vous nous écrivez/);
  assert.match(msg, /conservés 3 ans/);
  assert.match(msg, /intérêt légitime/);
  assert.doesNotMatch(privacy("CH", { messages: true }), /intérêt légitime/);
  assert.doesNotMatch(privacy("CA", { messages: true }), /intérêt légitime/);
  assert.match(privacy("FR", { list: true }, { listTool: "Mon outil" }), /enregistrée chez Mon outil/);
  assert.match(privacy("FR", { list: true }), /enregistrée pour vous envoyer/);
  assert.match(privacy("BE", { thirdParty: true }, { thirdPartyNames: "Twitch, YouTube" }), /Twitch, YouTube/);
  assert.match(privacy("BE", {}, { hostCountry: "Belgique" }), /Pays des serveurs de l'hébergeur : Belgique/);
  assert.match(privacy("BE", {}), /ne sont ni vendues ni cédées/);
});

test("cookies : « aucun cookie de suivi » seulement quand rien d'inconnu n'est déclaré ; pas de bandeau promis", () => {
  const cookies = (collect, extra = {}) => D.buildDocs({ answers: full("BE", "person", { collect, ...extra }), facts: FACTS, lang: "fr", mode: "final" }).cookies.md;
  assert.match(cookies({}), /ne dépose aucun cookie publicitaire ni de suivi/);
  assert.match(cookies({}), /ne vous demande pas d'accepter des cookies/);
  const third = cookies({ thirdParty: true }, { thirdPartyNames: "Twitch" });
  assert.match(third, /À part les contenus d'autres services/);
  assert.doesNotMatch(third, /ne vous demande pas d'accepter/);
  assert.match(third, /Twitch/);
  const other = cookies({}, { unknownExt: "some", otherCollect: "Un compteur anonyme." });
  assert.doesNotMatch(other, /ne dépose aucun cookie/, "on n'affirme pas ce qu'on ne sait pas");
  assert.match(other, /Un compteur anonyme/);
  assert.match(cookies({ memory: true }), /petit témoin retient ce choix/);
});

test("aperçu : un manque est écrit en clair et en gras ; la publication, elle, refuse (jamais de texte à trous)", () => {
  const a = full("BE", "company", { regNumber: "", name: "" });
  const preview = D.buildDocs({ answers: a, facts: FACTS, lang: "fr", mode: "preview" });
  assert.match(preview.notice.md, /\*\*⚠ À compléter : /);
  assert.ok(preview.gaps.includes("name") && preview.gaps.includes("regNumber"));
  assert.throws(() => D.buildDocs({ answers: a, facts: FACTS, lang: "fr", mode: "final" }), /gap:/);
  assert.throws(() => D.buildDocs({ answers: full("BE", "person", { country: "" }), facts: FACTS, lang: "fr", mode: "final" }), /gap:country/);
  assert.throws(() => D.buildDocs({ answers: full("FR", "person", { address: "", hideAddress: true, hostAck: false }), facts: FACTS, lang: "fr", mode: "final" }), /gap:hostAck/);
  assert.match(D.buildDocs({ answers: a, facts: FACTS, lang: "en", mode: "preview" }).notice.md, /\*\*⚠ To fill in: /);
});

test("sécurité des textes : ce que la personne tape est une donnée, jamais du Markdown ni du HTML", () => {
  const evil = "<script>alert(1)</script> [clic](javascript:alert(1)) **gras** `code` # titre\n- liste\n![i](x)";
  const a = full("BE", "company", { name: evil, address: evil, legalForm: evil, hostName: evil, thirdPartyNames: evil, listTool: evil, sellsWhere: evil, otherCollect: evil, hostCountry: evil, collect: { thirdParty: true, list: true }, unknownExt: "some", sells: "elsewhere" });
  const built = D.buildDocs({ answers: a, facts: { ...FACTS, siteName: { fr: evil, en: evil } }, lang: "fr", mode: "final" });
  for (const key of ["notice", "privacy", "cookies"]) {
    const md = built[key].md;
    assert.ok(!md.includes("<script>"), "balise échappée");
    assert.ok(!/(?<!\\)\[clic\]\(/.test(md), "pas de lien créé");
    assert.ok(!/(?<!\\)\*\*gras\*\*/.test(md.replace(/\*\*[^*\n]+\*\*/g, (m) => (m.includes("gras") ? m : "")).replace(/(?<![\\*])\*\*gras/, "")) || md.includes("\\*\\*gras"), "gras échappé");
    assert.ok(md.includes("\\<script\\>") || md.includes("\\<script"), "chevrons échappés");
    assert.ok(!/^\s*# titre/m.test(md) && !/^\s*- liste/m.test(md.replace(/^- .*\\\n- liste/gm, "")), "ni titre ni liste involontaires");
    assert.ok(!/(?<!\\)!\[i\]\(x\)/.test(md), "pas d'image");
  }
  // e-mail : une adresse piégée est refusée avant d'arriver ici, mais l'aperçu ne s'en sert pas comme lien
  const mail = D.buildDocs({ answers: full("BE", "person", { email: "x@example.org" }), facts: FACTS, lang: "fr", mode: "final" }).notice.md;
  assert.match(mail, /\[x@example\.org\]\(mailto:x@example\.org\)/);
});

test("esc : lignes, listes, titres, liens, entités", () => {
  assert.equal(D.esc("a\nb"), "a\\\nb");
  assert.equal(D.esc("# t"), "\\# t");
  assert.equal(D.esc("- x\n1. y\n2) z"), "\\- x\\\n\\1. y\\\n\\2) z");
  assert.equal(D.esc("[a](b) *c* _d_ `e` <f> g|h ~i~ &amp; \\"), "\\[a\\](b) \\*c\\* \\_d\\_ \\`e\\` \\<f\\> g\\|h \\~i\\~ \\&amp; \\\\");
  assert.equal(D.esc(null), "");
});

test("traducteur : une valeur saisie n'est jamais relue comme un modèle", () => {
  const T = D.translator("fr");
  assert.equal(T("doc.notice.phone", { value: "{email}" }), "Téléphone : {email}");
  assert.equal(T("clé inexistante"), "clé inexistante");
  assert.equal(T("doc.gap", { what: "$&" }), "À compléter : $&");
});

test("dates : lisibles dans la langue, en UTC", () => {
  assert.equal(D.longDate("2026-10-22T23:30:00Z", "fr"), "22 octobre 2026");
  assert.equal(D.longDate("2026-10-22T23:30:00Z", "en"), "October 22, 2026");
  assert.equal(D.longDate("pas une date", "fr"), "");
});

// ── Publication et pages publiques ─────────────────────────────────────────────────────────────────────────────

/** Remplit toutes les étapes d'un contexte comme le ferait la personne, puis renvoie le contexte. */
async function answerEverything(ctx, country = "BE", status = "person") {
  const values = {
    country: { country },
    who: { status, name: "Jeanne Martin", email: "contact@example.org" },
    address: { address: "12 rue des Lilas\n1000 Bruxelles", phone: "+32 2 123 45 67" },
    business: { legalForm: "SRL", regNumber: "0123.456.789", vat: "", capital: "1 000 €", director: "Jeanne Martin" },
    host: { hostName: "Hébergeur Test SA", hostAddress: "1 avenue du Serveur\n75000 Paris", hostPhone: "+33 1 23 45 67 89", hostCountry: "" },
    collect: { collect_messages: "on", thirdPartyNames: "", listTool: "", unknownExt: "none", otherCollect: "" },
    keep: { retention: "y1" },
    sells: { sells: "no", sellsWhere: "" },
  };
  for (const id of ["country", "who", "address", "business", "host", "collect", "keep", "sells"]) {
    const facts = await (await import("../modules/legal-pages/facts.mjs")).gatherFacts(ctx);
    const a = A.withDefaults(await Data.readAnswers(ctx), facts);
    if (!A.stepById(id).applies(a)) continue;
    const r = await def.adminActions.saveStep(ctx, { step: id, ...values[id] });
    assert.ok(!r.errors && !r.error, `étape ${id} : ${JSON.stringify(r)}`);
  }
  return ctx;
}

test("avant toute publication : aucune page publique, aucun lien de pied de page", async () => {
  const ctx = ctxFor();
  assert.deepEqual(await def.page(ctx, { segments: [] }), { notFound: true, blocks: [] });
  assert.deepEqual(await def.page(ctx, { segments: ["notice"] }), { notFound: true, blocks: [] });
  assert.equal(await def.slots["layout.footer"](ctx), null);
});

test("parcours complet : répondre, voir l'aperçu, publier, lire les pages, retirer", async () => {
  const ctx = ctxFor({ instances: [inst("contact-form", "Contact"), inst("blog")] });
  // l'écran d'accueil propose de commencer
  const first = await def.adminPanel(ctx, { query: {} });
  assert.ok(first.some((b) => b.type === "adminForm" && b.action === "go"));
  assert.equal(await def.adminBadge(ctx), 1, "pastille : il y a quelque chose à faire");
  await answerEverything(ctx);
  assert.equal(await def.adminBadge(ctx), 1, "prêt à publier = toujours quelque chose à faire");
  // pas de publication sans la case « j'ai relu »
  const noAck = await def.adminActions.publish.run(ctx, {});
  assert.ok(noAck.errors?.ack);
  assert.deepEqual((await Data.readState(ctx)).published, false);
  const done = await def.adminActions.publish.run(ctx, { ack: "on" });
  assert.ok(done.ok && done.redirect === "?published=1", JSON.stringify(done));
  const state = await Data.readState(ctx);
  assert.equal(state.published, true);
  assert.deepEqual(state.modules, ["blog", "contact-form"]);
  assert.equal(await def.adminBadge(ctx), 0, "publié et à jour : plus de pastille");
  // pages publiques
  const index = await def.page(ctx, { segments: [] });
  assert.equal(index.title, "Informations légales");
  assert.match(index.blocks[0].text, /\(\/legal\/notice\)/);
  const notice = await def.page(ctx, { segments: ["notice"] });
  assert.equal(notice.title, "Mentions légales");
  assert.match(notice.blocks[0].text, /Jeanne Martin/);
  assert.match(notice.blocks[1].text, /Dernière mise à jour : \d+ \w+ \d{4}\./);
  assert.ok(notice.blocks[2].items.every((i) => i.href.startsWith("/legal/")));
  const priv = await def.page(ctx, { segments: ["privacy"] });
  assert.match(priv.blocks[0].text, /\]\(\/privacy\)/, "le lien vers la page du cœur est résolu");
  assert.match(priv.blocks[0].text, /Si vous nous écrivez/);
  assert.equal((await def.page(ctx, { segments: ["cookies"] })).title, "Cookies");
  for (const bad of [["nope"], ["notice", "x"], ["privacy", "../etc"], ["__proto__"], ["constructor"]]) assert.equal((await def.page(ctx, { segments: bad })).notFound, true, bad.join("/"));
  // la version anglaise : mêmes données, langue du visiteur différente
  const enCtx = sameData(ctx, { locale: "en" });
  const enNotice = await def.page(enCtx, { segments: ["notice"] });
  assert.equal(enNotice.title, "Legal notice");
  assert.ok(enNotice.blocks[2].items.every((i) => i.href.startsWith("/en/legal/")), "liens avec la langue du visiteur");
  assert.match(enNotice.blocks[1].text, /Last updated: \w+ \d+, \d{4}\./);
  assert.match((await def.page(enCtx, { segments: ["privacy"] })).blocks[0].text, /\]\(\/en\/privacy\)/);
  // retirer
  const gone = await def.adminActions.unpublish.run(ctx);
  assert.ok(gone.ok);
  assert.equal((await Data.readState(ctx)).published, false);
  assert.equal(ctx.dumpStore().filter((r) => r.collection === "pages").length, 0);
  assert.ok(ctx.dumpStore().some((r) => r.collection === "answers"), "les réponses sont gardées");
  assert.equal((await def.page(ctx, { segments: ["notice"] })).notFound, true);
});

test("publier est refusé tant qu'il manque quelque chose, et ne laisse rien de moitié", async () => {
  const ctx = ctxFor();
  await def.adminActions.saveStep(ctx, { step: "country", country: "BE" });
  const r = await def.adminActions.publish.run(ctx, { ack: "on" });
  assert.ok(r.error && /compléter|confirmer/.test(r.error), r.error);
  assert.equal((await Data.readState(ctx)).published, false);
  assert.equal(ctx.dumpStore().filter((x) => x.collection === "pages" || x.collection === "state").length, 0);
  // un texte qui resterait à trous lève avant d'écrire quoi que ce soit
  const facts = { ...FACTS, siteName: { fr: "S", en: "S" } };
  await assert.rejects(Data.publish(ctx, { ...full("BE", "person"), name: "" }, facts), /gap:name/);
  assert.equal(ctx.dumpStore().filter((x) => x.collection === "pages" || x.collection === "state").length, 0);
});

test("sans adresse publique (chemin retiré) : rien ne peut être publié et le module le dit", async () => {
  const ctx = await answerEverything(ctxFor({ basePath: null }));
  const r = await def.adminActions.publish.run(ctx, { ack: "on" });
  assert.match(r.error, /Général/);
  const panel = await def.adminPanel(ctx, { query: {} });
  assert.ok(panel.some((b) => b.type === "markdown" && /Général/.test(b.text)));
  assert.equal(await def.slots["layout.footer"](ctx), null);
  assert.deepEqual(await def.page(ctx, { segments: [] }), { notFound: true, blocks: [] });
});

test("pied de page : un lien, trois liens ou aucun ; langue du visiteur respectée ; racine du site gérée", async () => {
  const base = await answerEverything(ctxFor());
  await def.adminActions.publish.run(base, { ack: "on" });
  const rows = base.dumpStore();
  const mk = (settings, locale = "fr", basePath = "legal") => ctxFor({ settings, locale, basePath, rows: Object.fromEntries(["answers", "pages", "state"].map((c) => [c, rows.filter((r) => r.collection === c).map((r) => r.data)])) });
  assert.deepEqual(await def.slots["layout.footer"](mk({ footerLinks: "one" })), [{ type: "links", items: [{ label: "Mentions légales", href: "/legal" }] }]);
  const all = await def.slots["layout.footer"](mk({ footerLinks: "all" }, "en"));
  assert.deepEqual(all[0].items.map((i) => i.href), ["/en/legal/notice", "/en/legal/privacy", "/en/legal/cookies"]);
  assert.equal(await def.slots["layout.footer"](mk({ footerLinks: "none" })), null);
  assert.equal((await def.slots["layout.footer"](mk({ footerLinks: "one" }, "fr", "")))[0].items[0].href, "/");
  assert.equal((await def.slots["layout.footer"](mk({ footerLinks: "all" }, "fr", "")))[0].items[1].href, "/privacy");
  assert.equal((await def.slots["layout.footer"](mk({})))[0].items.length, 1, "défaut : un seul lien");
});

test("langue du visiteur : repli sur la langue du site, puis l'anglais, puis ce qui existe", () => {
  const pages = { fr: {}, en: {} };
  assert.equal(P.pickLang(pages, { locale: "fr", defaultLocale: "fr" }), "fr");
  assert.equal(P.pickLang(pages, { locale: "nl", defaultLocale: "fr" }), "fr");
  assert.equal(P.pickLang({ en: {} }, { locale: "nl", defaultLocale: "fr" }), "en");
  assert.equal(P.pickLang({ fr: {} }, { locale: "nl", defaultLocale: "nl" }), "fr");
  assert.equal(P.pickLang(null, { locale: "fr", defaultLocale: "fr" }), null);
  assert.equal(P.resolveLinks("[a](@privacy) [b](@notice) [c](@cookies) [d](@home) [e](@evil)", { locale: "en", defaultLocale: "fr", instance: { basePath: "legal" } }), "[a](/en/privacy) [b](/en/legal/notice) [c](/en/legal/cookies) [d](/en/legal) [e](@evil)");
});

// ── L'administration ───────────────────────────────────────────────────────────────────────────────────────────

const KNOWN_BLOCKS = new Set(["markdown", "html", "heading", "table", "adminForm", "copy", "links"]);
const flat = (blocks) => JSON.stringify(blocks);

test("administration : chaque écran rend des blocs connus, avec l'avertissement « modèle d'aide » en haut, dans les deux langues", async () => {
  for (const lang of ["fr", "en"]) {
    const ctx = await answerEverything(ctxFor({ locale: lang, instances: [inst("contact-form", "Contact"), inst("mystery", "Mystère")] }));
    const screens = [{}, { saved: "1" }, { published: "1" }, { view: "preview", lang: "fr" }, { view: "preview", lang: "en" }, ...A.STEPS.map((s) => ({ step: s.id })), { step: "inexistante" }, { view: "inconnue" }];
    for (const query of screens) {
      const blocks = await def.adminPanel(ctx, { query });
      assert.ok(Array.isArray(blocks) && blocks.length > 0);
      for (const b of blocks) assert.ok(KNOWN_BLOCKS.has(b.type), `${lang} ${JSON.stringify(query)} : bloc ${b.type}`);
      assert.match(blocks[0].text ?? "", /modèle d'aide|help template/i, `${lang} ${JSON.stringify(query)} : avertissement en tête`);
      assert.ok(!/\b(?:adm|rem|note|st|f|o|err)\.[a-zA-Z]+\b/.test(flat(blocks).replace(/https?:\/\/\S+/g, "")), `${lang} ${JSON.stringify(query)} : clé de traduction affichée`);
    }
  }
});

test("administration : la page d'assistant et l'accueil disent clairement « modèle d'aide, pas un conseil juridique »", () => {
  for (const lang of ["fr", "en"]) {
    assert.match(locales[lang]["adm.disclaimer"], lang === "fr" ? /pas un conseil juridique/ : /not legal advice/);
    assert.match(locales[lang]["adm.disclaimer.short"], lang === "fr" ? /pas un conseil juridique/ : /not legal advice/);
    assert.match(locales[lang]["adm.publish.ack"], lang === "fr" ? /pas un conseil juridique/ : /not legal advice/);
  }
});

test("administration : chaque question affiche son champ, son aide, sa progression et un lien pour revenir", async () => {
  const ctx = ctxFor({ instances: [inst("contact-form", "Contact"), inst("mystery", "Mystère")] });
  await def.adminActions.saveStep(ctx, { step: "country", country: "FR" });
  const country = await def.adminPanel(ctx, { query: { step: "who" } });
  const form = country.find((b) => b.type === "adminForm");
  assert.equal(form.action, "saveStep");
  assert.deepEqual(form.fields.map((f) => f.name), ["status", "name", "email", "step"]);
  assert.equal(form.fields.find((f) => f.name === "email").value, "contact@example.org", "adresse du site préremplie");
  assert.ok(form.fields.find((f) => f.name === "status").options.length === 4);
  assert.ok(country.some((b) => b.type === "html" && /role="img"/.test(b.html) && /Question 2 sur/.test(b.html)));
  assert.ok(country.at(-1).text.includes("← Question précédente") && country.at(-1).text.includes("?step=country"));
  const collect = await def.adminPanel(ctx, { query: { step: "collect" } });
  assert.ok(collect.some((b) => b.type === "markdown" && /Contact/.test(b.text) && /récolte/.test(b.text)), "extension reconnue nommée");
  assert.ok(collect.some((b) => b.type === "markdown" && /Mystère/.test(b.text)), "extension inconnue nommée");
  const f = collect.find((b) => b.type === "adminForm").fields;
  assert.equal(f.find((x) => x.name === "collect_messages").value, "on", "case cochée d'après l'extension reconnue");
  assert.ok(f.find((x) => x.name === "unknownExt").required);
  // une étape qui ne s'applique pas n'est pas montrée : retour à l'accueil
  const skip = await def.adminPanel(ctx, { query: { step: "business" } });
  assert.ok(!skip.some((b) => b.type === "adminForm" && b.fields.some((x) => x.name === "regNumber")));
});

test("administration : les erreurs sont sous le champ, avec un exemple, et rien n'est enregistré ni validé", async () => {
  const ctx = ctxFor();
  const r = await def.adminActions.saveStep(ctx, { step: "who", status: "person", name: "J", email: "oups" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["email", "name"]);
  assert.match(r.errors.email, /par exemple prenom@example\.org/);
  assert.equal(r.error, undefined);
  assert.equal(ctx.dumpStore().filter((x) => x.collection === "answers").length, 0);
  assert.match((await def.adminActions.saveStep(ctx, { step: "nope" })).error, /n'existe pas/);
  assert.match((await def.adminActions.saveStep(ctx, {})).error, /n'existe pas/);
  const go = await def.adminActions.go(ctx, { to: "<script>" });
  assert.equal(go.redirect, "?step=country", "jamais une destination venue du navigateur");
});

test("administration : après chaque étape on passe à la suivante, et la dernière ramène à l'accueil", async () => {
  const ctx = ctxFor();
  assert.equal((await def.adminActions.saveStep(ctx, { step: "country", country: "BE" })).redirect, "?step=who");
  assert.equal((await def.adminActions.saveStep(ctx, { step: "who", status: "person", name: "Jeanne Martin", email: "a@example.org" })).redirect, "?step=address");
  assert.equal((await def.adminActions.saveStep(ctx, { step: "address", address: "", phone: "" })).redirect, "?step=host", "particulier : pas d'informations officielles");
  await def.adminActions.saveStep(ctx, { step: "who", status: "company", name: "Jeanne Martin", email: "a@example.org" });
  assert.equal((await def.adminActions.saveStep(ctx, { step: "address", address: "12 rue des Lilas, 1000 Bruxelles", phone: "" })).redirect, "?step=business");
  assert.equal((await def.adminActions.saveStep(ctx, { step: "sells", sells: "no" })).redirect, "?saved=1");
});

test("accueil : tableau des réponses, état de chaque question, bon à savoir, bouton de publication seulement quand tout est prêt", async () => {
  const ctx = ctxFor({ instances: [inst("contact-form", "Contact")] });
  await def.adminActions.saveStep(ctx, { step: "country", country: "BE" });
  const partial = await def.adminPanel(ctx, { query: {} });
  const table = partial.find((b) => b.type === "table");
  assert.deepEqual(table.columns, ["Question", "Votre réponse", "État"]);
  assert.equal(table.rows[0][2], "Fait");
  assert.ok(table.rows.some((r) => r[2] === "À compléter"));
  assert.ok(table.rowActions[0].href === "?step={id}" && table.rowIds[0] === "country");
  assert.ok(!partial.some((b) => b.type === "adminForm" && b.action === "publish"), "pas de bouton tant qu'il manque quelque chose");
  assert.ok(partial.some((b) => b.type === "markdown" && /Je ne peux pas encore publier/.test(b.text)));
  const ready = await answerEverything(ctxFor({ instances: [inst("contact-form", "Contact")] }));
  const screen = await def.adminPanel(ready, { query: {} });
  const publishForm = screen.find((b) => b.type === "adminForm" && b.action === "publish");
  assert.ok(publishForm, "bouton de publication");
  assert.equal(publishForm.fields[0].name, "ack");
  assert.match(publishForm.fields[0].label, /pas un conseil juridique/);
  assert.equal(publishForm.submitLabel, "Publier mes pages");
  assert.ok(screen.some((b) => b.type === "markdown" && /Vous vous engagez à effacer les messages/.test(b.text)), "l'engagement de conservation est rappelé");
});

test("aperçu : trois pages, avec manques en gras, liens vers l'étape concernée, texte à copier avec adresses complètes", async () => {
  const ctx = ctxFor();
  await def.adminActions.saveStep(ctx, { step: "country", country: "BE" });
  const blocks = await def.adminPanel(ctx, { query: { view: "preview", lang: "fr" } });
  assert.equal(blocks.filter((b) => b.type === "copy").length, 3);
  assert.ok(blocks.some((b) => b.type === "markdown" && /\*\*⚠ À compléter/.test(b.text)));
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("](?step=who)")));
  const copy = blocks.find((b) => b.type === "copy");
  assert.match(copy.text, /^# Mentions légales/);
  const priv = blocks.filter((b) => b.type === "copy")[1].text;
  assert.match(priv, /\(https:\/\/example\.test\/privacy\)/);
  assert.ok(!/\(@/.test(priv) && !/\(@/.test(flat(blocks.filter((b) => b.type === "markdown"))));
  const en = await def.adminPanel(ctx, { query: { view: "preview", lang: "en" } });
  assert.ok(en.some((b) => b.type === "copy" && /^# Legal notice/.test(b.text)));
});

// ── Rappels ────────────────────────────────────────────────────────────────────────────────────────────────────

async function published(extra = {}) {
  const ctx = await answerEverything(ctxFor({ instances: [inst("blog"), inst("contact-form", "Contact")], ...extra }));
  assert.ok((await def.adminActions.publish.run(ctx, { ack: "on" })).ok);
  return ctx;
}
const reopen = (ctx, instances, settings) => sameData(ctx, { instances, settings: settings ?? { footerLinks: "one", reviewMonths: 12 } });

test("rappels : rien à signaler juste après la publication", async () => {
  const ctx = await published();
  const s = await Admin.load(ctx);
  assert.deepEqual(Admin.attention(ctx, s), []);
  assert.equal(await def.adminBadge(ctx), 0);
  const status = await def.adminPanel(ctx, { query: {} });
  assert.match(status.find((b) => b.type === "heading").text, /en ligne/);
});

test("rappels : une extension qui récolte arrive, une extension inconnue arrive, une extension sans effet arrive (pas de bruit), une extension qui récoltait part", async () => {
  const ctx = await published();
  const base = [inst("blog"), inst("contact-form", "Contact")];
  const quiet = reopen(ctx, [...base, inst("bluesky")]);
  assert.deepEqual(Admin.attention(quiet, await Admin.load(quiet)), []);
  const collector = reopen(ctx, [...base, inst("guestbook", "Livre d'or")]);
  const a1 = Admin.attention(collector, await Admin.load(collector));
  assert.equal(a1.length, 1);
  assert.match(a1[0].text, /Livre d'or.*récolte des informations/);
  assert.equal(a1[0].step, "collect");
  assert.equal(await def.adminBadge(collector), 1);
  const unknown = reopen(ctx, [...base, inst("mystery", "Mystère")]);
  const a2 = Admin.attention(unknown, await Admin.load(unknown));
  assert.match(a2[0].text, /Mystère.*je ne la connais pas/);
  const s2 = await Admin.load(unknown);
  assert.ok(s2.missing.some((m) => m.step === "collect"), "il faut répondre pour l'extension inconnue avant de republier");
  const removed = reopen(ctx, [inst("blog")]);
  assert.match(Admin.attention(removed, await Admin.load(removed))[0].text, /contact-form.*n'est plus installée/);
  const overview = await def.adminPanel(collector, { query: {} });
  assert.ok(overview.some((b) => b.type === "markdown" && /Livre d'or/.test(b.text) && b.text.includes("?step=collect")));
});

test("rappels : une réponse modifiée depuis la publication, un nom de site changé, des textes trop vieux", async () => {
  const ctx = await published();
  const base = [inst("blog"), inst("contact-form", "Contact")];
  const edited = reopen(ctx, base);
  await def.adminActions.saveStep(edited, { step: "who", status: "person", name: "Jeanne Martin-Dupont", email: "contact@example.org" });
  const s = await Admin.load(edited);
  assert.equal(s.dirty, true);
  assert.match(Admin.attention(edited, s)[0].text, /changé quelque chose/);
  const renamed = reopen(ctx, base);
  renamed.api.site = async () => ({ name: "Autre nom", tagline: "", logo: null });
  assert.equal((await Admin.load(renamed)).dirty, true);
  const confirmOnly = reopen(ctx, base);
  await def.adminActions.saveStep(confirmOnly, { step: "who", status: "person", name: "Jeanne Martin", email: "contact@example.org" });
  assert.equal((await Admin.load(confirmOnly)).dirty, false, "revalider la même réponse ne change rien");
  const old = reopen(ctx, base, { footerLinks: "one", reviewMonths: 1 });
  const rows = old.dumpStore().filter((r) => r.collection === "state");
  rows[0].data.at = "2020-01-01T00:00:00.000Z";
  const oldCtx = ctxFor({ instances: base, settings: { reviewMonths: 12 }, rows: { answers: ctx.dumpStore().filter((r) => r.collection === "answers").map((r) => r.data), state: [{ ...rows[0].data, at: "2020-01-01T00:00:00.000Z" }] } });
  assert.match(Admin.attention(oldCtx, await Admin.load(oldCtx)).at(-1).text, /Vos pages datent du 1 janvier 2020|1er janvier 2020/);
});

test("rappels : publier de nouveau met l'état à jour (nouvelles extensions connues, nouvelle date)", async () => {
  const ctx = await published();
  const next = reopen(ctx, [inst("blog"), inst("contact-form", "Contact"), inst("guestbook", "Livre d'or")]);
  await def.adminActions.saveStep(next, { step: "collect", collect_messages: "on", collect_publicPosts: "on", unknownExt: "", thirdPartyNames: "" });
  const pub = await def.adminActions.publish.run(next, { ack: "on" });
  assert.ok(pub.ok, JSON.stringify(pub));
  assert.deepEqual((await Data.readState(next)).modules, ["blog", "contact-form", "guestbook"]);
  assert.deepEqual(Admin.attention(next, await Admin.load(next)), []);
  assert.match((await Data.readPages(next)).fr.privacy.md, /laissez un message, une suggestion ou un vote/);
});

test("bon à savoir : service tiers, liste d'e-mails (Canada ≠ ailleurs), vente, engagement de conservation, contradiction avec une extension", async () => {
  const ctx = ctxFor({ instances: [inst("live-status", "Direct")] });
  await def.adminActions.saveStep(ctx, { step: "country", country: "CA" });
  await def.adminActions.saveStep(ctx, { step: "collect", collect_list: "on", collect_thirdParty: "on", thirdPartyNames: "Twitch", unknownExt: "", listTool: "" });
  await def.adminActions.saveStep(ctx, { step: "sells", sells: "here" });
  const text = flat(await def.adminPanel(ctx, { query: {} }));
  assert.match(text, /bandeau de consentement/);
  assert.match(text, /anti-pourriel/);
  assert.match(text, /conditions de vente/);
  const contradiction = ctxFor({ instances: [inst("contact-form", "Contact")] });
  await def.adminActions.saveStep(contradiction, { step: "country", country: "BE" });
  await def.adminActions.saveStep(contradiction, { step: "collect", unknownExt: "" });
  assert.match(flat(await def.adminPanel(contradiction, { query: {} })), /récolte pourtant des messages privés/);
});

// ── Outils pour les assistants ─────────────────────────────────────────────────────────────────────────────────

test("assistant : état, aperçu et brouillon de réponses ; il ne publie pas et ne valide aucune étape", async () => {
  const ctx = ctxFor({ instances: [inst("contact-form", "Contact"), inst("mystery", "Mystère")] });
  const status = await def.mcp.legal_status(ctx);
  assert.equal(status.published, false);
  assert.equal(status.readyToPublish, false);
  assert.deepEqual(status.extensionsSeen, { collectingInformation: ["Contact"], unknownToThisAssistant: ["Mystère"] });
  assert.match(status.note, /not legal advice/);
  assert.ok(status.missing.some((m) => m.step === "country"));
  const set = await def.mcp.legal_set_answers(ctx, { country: "BE", name: "Jeanne Martin", hostName: "Hébergeur Test SA", collect_messages: true });
  assert.deepEqual(set.recorded, ["country", "name", "hostName", "collect_messages"]);
  assert.ok(set.stillMissing.some((m) => m.reason.includes("confirmation")));
  const saved = ctx.dumpStore().find((r) => r.collection === "answers").data;
  assert.equal(saved.name, "Jeanne Martin");
  assert.deepEqual(saved.touched, {}, "rien n'est validé par un assistant");
  assert.equal((await Data.readState(ctx)).published, false);
  await assert.rejects(def.mcp.legal_set_answers(ctx, { email: "pas une adresse" }), /not recorded, invalid: email/);
  await assert.rejects(def.mcp.legal_set_answers(ctx, {}), /at least one answer/);
  const preview = await def.mcp.legal_preview(ctx, { page: "notice", lang: "en" });
  assert.equal(preview.title, "Legal notice");
  assert.match(preview.markdown, /Jeanne Martin/);
  assert.deepEqual(preview.gaps, [], "tout ce que le texte demande est là ; reste à faire confirmer chaque étape par la personne");
  await assert.rejects(def.mcp.legal_preview(ctx, { page: "../etc" }), /page must be/);
  const manifestInput = manifest.mcp.find((a) => a.name === "legal_set_answers").input;
  assert.deepEqual(validateArgs(manifestInput, { country: "BE", collect_messages: true }), { country: "BE", collect_messages: true });
  assert.throws(() => validateArgs(manifestInput, { country: "NL" }), /one of/, "un pays hors liste est refusé par le schéma");
  assert.throws(() => validateArgs(manifestInput, { unknownField: "x" }), /unexpected argument/, "un champ inconnu est refusé");
});

// ── Sauvegarde lisible ─────────────────────────────────────────────────────────────────────────────────────────

test("sauvegarde lisible : réponses et textes publiés, en texte simple", async () => {
  const empty = ctxFor();
  assert.deepEqual(await def.backup.readable(empty), []);
  const ctx = await published();
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path).sort(), ["answers.md", "published-en.md", "published-fr.md"]);
  const answers = files.find((f) => f.path === "answers.md").content;
  assert.match(answers, /- name: "Jeanne Martin"/);
  assert.match(answers, /- collect\.messages: true/);
  assert.ok(!/touched|savedAt/.test(answers));
  assert.match(files.find((f) => f.path === "published-fr.md").content, /# Mentions légales/);
  assert.match(files.find((f) => f.path === "published-en.md").content, /# Legal notice/);
});

// ── Volume et robustesse ───────────────────────────────────────────────────────────────────────────────────────

test("robustesse : un stockage en double est rangé, de très longues valeurs sont bornées, des extensions bizarres ne cassent rien", async () => {
  const ctx = ctxFor();
  await ctx.api.store.add("answers", { name: "Ancien" });
  await ctx.api.store.add("answers", { name: "Récent" });
  await Data.writeOne(ctx, "answers", { name: "Final" });
  assert.equal(ctx.dumpStore().filter((r) => r.collection === "answers").length, 1);
  const long = "x".repeat(100000);
  const r = A.applyStep(A.withDefaults({}, FACTS), "who", { status: "person", name: long, email: "a@example.org" }, FACTS);
  assert.ok(r.answers.name.length <= 120);
  const weird = ctxFor({ instances: [null, undefined, { module: 5 }, { module: "x".repeat(500), name: "<img src=x onerror=alert(1)>" }, inst("blog")] });
  const blocks = await def.adminPanel(weird, { query: { step: "collect" } });
  assert.ok(blocks.length > 0);
  assert.equal(typeof (await def.adminBadge(weird)), "number");
  const noApi = ctxFor();
  noApi.api.instances.list = async () => { throw new Error("panne"); };
  noApi.api.brand = async () => { throw new Error("panne"); };
  assert.ok((await def.adminPanel(noApi, { query: {} })).length > 0, "une panne de lecture du site ne casse pas l'assistant");
  assert.equal(await def.adminBadge(noApi) >= 0, true);
});

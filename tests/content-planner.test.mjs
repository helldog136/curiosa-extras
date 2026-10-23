// Cahier de contenu : le manifeste, les données, l'administration (liste, page d'une idée, actions), le rythme, la vie privée.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/content-planner", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const sources = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = (await import("../modules/content-planner/index.mjs")).default;
const D = await import("../modules/content-planner/data.mjs");
const V = await import("../modules/content-planner/view.mjs");
const A = await import("../modules/content-planner/admin.mjs");

const NOW = "2026-10-22T10:00:00Z";
let seq = 0;
const ctxFor = (settings = {}, opts = {}) => {
  const ctx = fakeCtx({ key: `cp${++seq}`, moduleId: "content-planner", basePath: null, locale: opts.locale ?? "fr", messages: readJson(`locales/${opts.locale ?? "fr"}.json`), settings, permissions: manifest.permissions, ...opts });
  ctx.__plannerNow = NOW;
  return ctx;
};
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");
const allText = (blocks) => JSON.stringify(blocks);
const ideas = (ctx) => ctx.dumpStore().filter((r) => r.collection === "ideas");
const add = async (ctx, title, extra = {}) => { const r = await def.adminActions.quickAdd(ctx, { quickTitle: title }); assert.ok(r.ok, JSON.stringify(r)); const row = ideas(ctx).at(-1); if (Object.keys(extra).length) await ctx.api.store.update(row.id, { ...row.data, ...extra }); return row.id; };
const form = (blocks, action) => blocks.find((b) => b.type === "adminForm" && b.action === action);

// ── Manifeste : privé de bout en bout ───────────────────────────────────────────────────────────────────────────

test("manifeste : valide, une seule instance, aucune page", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "content-planner");
  assert.equal(manifest.minCore, "0.2.5");
  assert.equal(manifest.instances, "single");
  assert.equal(manifest.page, false);
  assert.equal(manifest.name.fr, "Cahier de contenu");
  assert.equal(manifest.name.en, "Content notebook");
});

test("PRIVÉ : ni page, ni route, ni section, ni emplacement, ni sujet, ni overlay, ni service, ni réseau", () => {
  for (const k of ["page", "routes", "sections", "slots", "exports", "overlay", "services", "filters", "tasks", "news"]) assert.equal(def[k], undefined, `le code ne doit pas définir « ${k} »`);
  for (const k of ["sections", "provides", "consumes", "offers", "requires", "basePath", "content"]) assert.ok(manifest[k] === undefined || (Array.isArray(manifest[k]) && manifest[k].length === 0), `module.json ne doit pas déclarer « ${k} »`);
  assert.ok(!manifest.permissions.some((p) => ["routes", "pages", "sections", "slots", "overlay", "topics", "mail", "filters"].includes(p)), "permissions");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "storage"]);
  assert.ok(!/\bfetch\s*\(|ctx\.api\.net|ctx\.api\.services|ctx\.api\.topics|ctx\.api\.entries|ctx\.api\.mail|setInterval|setTimeout/.test(sources), "aucun appel réseau, service, sujet, e-mail ni minuteur");
});

test("manifeste : actions MCP déclarées = implémentées ; lectures par défaut, écritures jamais accordées d'office", () => {
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  for (const a of manifest.mcp) {
    assert.ok(a.name.length <= 31, `${a.name} : trop long`);
    assert.ok(!a.destructive, `${a.name} : aucune action destructrice (rien n'est supprimé par l'assistant)`);
  }
  const reads = manifest.mcp.filter((a) => a.readOnly).map((a) => a.name).sort();
  assert.deepEqual(reads, ["idea_get", "ideas_list"]);
  for (const a of manifest.mcp.filter((x) => !x.readOnly)) assert.ok(a.default !== true, `${a.name} : une écriture n'est jamais accordée d'office`);
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), ["idea_add", "idea_get", "idea_move", "idea_step", "idea_update", "ideas_list"]);
});

test("manifeste : les actions d'administration utilisées par les boutons existent ; onglet renommé ; réglages sains", () => {
  for (const m of fs.readFileSync(`${DIR}/admin.mjs`, "utf8").matchAll(/action: "([A-Za-z]+)"/g)) assert.ok(m[1] in def.adminActions, `adminAction ${m[1]} manquante`);
  assert.deepEqual(Object.keys(def.adminActions).sort(), ["deleteIdea", "moveIdea", "quickAdd", "saveSteps", "saveText", "saveWhen", "search"]);
  assert.equal(manifest.tabs.length, 1);
  assert.equal(manifest.tabs[0].id, "use");
  const keys = manifest.settings.map((s) => s.key);
  assert.deepEqual(keys, ["stepModel", "rhythmCount", "rhythmPeriod", "networkList"]);
  const rhythm = manifest.optionalGroups.find((g) => g.id === "rhythm");
  assert.deepEqual(rhythm.fields, ["rhythmCount", "rhythmPeriod"]);
  for (const k of ["rhythmCount", "rhythmPeriod"]) assert.equal(manifest.settings.find((s) => s.key === k).default, undefined, "le rythme est facultatif : aucune valeur par défaut");
});

test("textes : français et anglais alignés, aucun mot technique dans ce que lit Emma", () => {
  const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const [k, text] of Object.entries({ ...fr })) assert.ok(!/\b(slug|payload|endpoint|json|api|token|jeton)\b/i.test(text), `${k} : jargon`);
  for (const [k, text] of Object.entries(en)) assert.ok(!/\b(slug|payload|endpoint|json|api|token)\b/i.test(text), `${k} : jargon`);
  for (const k of Object.keys(fr)) assert.ok(fr[k].trim() && en[k].trim(), k);
});

// ── Les données : nettoyage ─────────────────────────────────────────────────────────────────────────────────────

test("données : titres, dates, listes de réseaux et d'étapes sont nettoyés et bornés", () => {
  assert.equal(D.line("  Un   titre\n\tsur deux lignes  ", 120), "Un titre sur deux lignes");
  assert.equal(D.line("x".repeat(500), 120).length, 120);
  assert.equal(D.line("😀".repeat(100), 5).length % 2, 0, "jamais au milieu d'un emoji");
  assert.equal(D.validDate("2026-11-14"), "2026-11-14");
  for (const bad of ["2026-02-30", "2026-13-01", "14/11/2026", "1999-01-01", "2101-01-01", "", "abc", "2026-1-1"]) assert.equal(D.validDate(bad), "", bad);
  assert.deepEqual(D.parseNetworks("YouTube, youtube ; Twitch\nBlog,,  "), ["YouTube", "Twitch", "Blog"]);
  assert.equal(D.parseNetworks(Array.from({ length: 40 }, (_, i) => `r${i}`)).length, D.MAX_NETWORKS);
  assert.equal(D.parseStepLines(Array.from({ length: 40 }, (_, i) => `étape ${i}`).join("\n")).length, D.MAX_STEPS);
  assert.deepEqual(D.mergeSteps([{ label: "Script", done: true }, { label: "Miniature", done: true }], ["script", "Tournage", "Miniature"]), [{ label: "script", done: true }, { label: "Tournage", done: false }, { label: "Miniature", done: true }]);
  assert.deepEqual(D.searchWords("  Éléphant  rose "), ["elephant", "rose"]);
});

test("données : un document abîmé redevient une idée sûre (jamais d'erreur)", () => {
  const i = D.normalize({ id: "a", data: { title: 42, column: "nope", steps: "x", networks: { a: 1 }, targetDate: "pas une date", archived: "oui", notes: null } });
  assert.equal(i.column, "idea");
  assert.equal(i.archived, false);
  assert.deepEqual(i.steps, []);
  assert.equal(i.targetDate, "");
  assert.equal(D.normalize(null).id, "");
  assert.equal(D.normalize({ id: "p", data: { title: "T", column: "doing", publishedAt: "2026-10-01" } }).publishedAt, "", "la date de publication n'existe que pour une idée publiée");
});

// ── Ajouter une idée : un titre suffit ──────────────────────────────────────────────────────────────────────────

test("« J'ai une idée ! » : un titre suffit, les quatre étapes de base arrivent (français et anglais)", async () => {
  const fr = ctxFor();
  const r = await def.adminActions.quickAdd(fr, { quickTitle: "  Tutoriel   sur le montage " });
  assert.ok(r.ok);
  const [row] = ideas(fr);
  assert.equal(row.data.title, "Tutoriel sur le montage");
  assert.equal(row.data.column, "idea");
  assert.deepEqual(row.data.steps.map((s) => s.label), ["Script", "Miniature", "Description", "Publication"]);
  assert.ok(row.data.steps.every((s) => s.done === false));
  assert.equal(row.data.by, "owner");
  const en = ctxFor({}, { locale: "en" });
  await def.adminActions.quickAdd(en, { quickTitle: "Editing tutorial" });
  assert.deepEqual(ideas(en)[0].data.steps.map((s) => s.label), ["Script", "Thumbnail", "Description", "Publishing"]);
});

test("modèle d'étapes : modifiable dans les réglages, 12 au plus ; une idée déjà notée ne change pas", async () => {
  const ctx = ctxFor();
  await add(ctx, "Avant");
  ctx.setting = (k) => ({ stepModel: "Idée\nTournage\nMontage\nTournage\n" }[k]);
  await add(ctx, "Après");
  const [avant, apres] = ideas(ctx);
  assert.equal(avant.data.steps.length, 4);
  assert.deepEqual(apres.data.steps.map((s) => s.label), ["Idée", "Tournage", "Montage"]);
  ctx.setting = (k) => ({ stepModel: Array.from({ length: 30 }, (_, i) => `E${i}`).join("\n") }[k]);
  await add(ctx, "Beaucoup");
  assert.equal(ideas(ctx).at(-1).data.steps.length, D.MAX_STEPS);
});

test("« J'ai une idée ! » : l'erreur est sous le champ, avec un exemple", async () => {
  const ctx = ctxFor();
  for (const bad of ["", "   ", undefined]) {
    const r = await def.adminActions.quickAdd(ctx, { quickTitle: bad });
    assert.ok(r.errors?.quickTitle?.includes("Tutoriel sur le montage"), "exemple dans le message");
    assert.equal(r.ok, undefined);
  }
  const long = await def.adminActions.quickAdd(ctx, { quickTitle: "x".repeat(121) });
  assert.match(long.errors.quickTitle, /120/);
  assert.equal(ideas(ctx).length, 0, "rien n'est noté en cas d'erreur");
});

test("plafond : 1 000 idées au plus, message clair, rien n'est noté en trop", async () => {
  const rows = { ideas: Array.from({ length: D.MAX_IDEAS }, (_, i) => ({ title: `Idée ${i}`, column: "idea", archived: false, steps: [], createdAt: NOW })) };
  const ctx = ctxFor({}, { rows });
  const r = await def.adminActions.quickAdd(ctx, { quickTitle: "Une de trop" });
  assert.match(r.errors.quickTitle, /plein/);
  assert.equal(ideas(ctx).length, D.MAX_IDEAS);
});

// ── La liste : endroits, recherche, pagination ──────────────────────────────────────────────────────────────────

test("liste : formulaire « J'ai une idée ! » en tête, quatre endroits avec leur nombre, une carte par idée", async () => {
  const ctx = ctxFor();
  const a = await add(ctx, "Première");
  const b = await add(ctx, "Deuxième");
  await def.adminActions.moveIdea(ctx, { id: `${b}~doing` });
  const blocks = await def.adminPanel(ctx, { query: {} });
  const f = form(blocks, "quickAdd");
  assert.equal(f.submitLabel, "J'ai une idée !");
  assert.equal(f.fields.length, 1, "un seul champ : le titre");
  assert.equal(blocks.indexOf(f) < blocks.findIndex((x) => x.type === "html" && x.html.includes('<ul class="cp-list">')), true);
  const page = html(blocks);
  assert.match(page, /Idées<span class="cp-n">1<\/span>/);
  assert.match(page, /En préparation<span class="cp-n">1<\/span>/);
  assert.ok(page.includes("Première") && !page.includes("Deuxième"), "l'endroit ouvert montre ses idées seulement");
  assert.ok(page.includes(`href="?idea=${a}&amp;col=idea"`), "toute la carte est le lien vers l'idée");
  const doing = html(await def.adminPanel(ctx, { query: { col: "doing" } }));
  assert.ok(doing.includes("Deuxième") && !doing.includes("Première"));
  assert.match(doing, /aria-current="page">En préparation/);
});

test("liste : états vides par endroit, sans erreur", async () => {
  const ctx = ctxFor();
  assert.match(html(await def.adminPanel(ctx, { query: {} })), /Votre cahier est vide/);
  await add(ctx, "Une");
  for (const col of ["doing", "published", "archived"]) assert.match(html(await def.adminPanel(ctx, { query: { col } })), /cp-empty/);
});

test("pagination : 50 par page, page hors limites ramenée dans les limites, liens précédent / suivant", async () => {
  const rows = { ideas: Array.from({ length: 120 }, (_, i) => ({ title: `Idée numéro ${i}`, column: "idea", archived: false, steps: [], createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })) };
  const ctx = ctxFor({}, { rows });
  const p1 = html(await def.adminPanel(ctx, { query: {} }));
  assert.equal((p1.match(/class="cp-card"/g) ?? []).length, 50);
  assert.match(p1, /Page 1 sur 3/);
  assert.match(p1, /rel="next" href="\?page=2"/);
  assert.ok(!p1.includes('rel="prev"'));
  const p3 = html(await def.adminPanel(ctx, { query: { page: "3" } }));
  assert.equal((p3.match(/class="cp-card"/g) ?? []).length, 20);
  assert.match(p3, /rel="prev" href="\?page=2"/);
  assert.equal((html(await def.adminPanel(ctx, { query: { page: "999" } })).match(/class="cp-card"/g) ?? []).length, 20, "au-delà : la dernière page");
  for (const page of ["0", "-3", "abc", "2.5"]) assert.equal((html(await def.adminPanel(ctx, { query: { page } })).match(/class="cp-card"/g) ?? []).length, 50, `page « ${page} » : la première`);
});

test("recherche : sans tenir compte des accents ni des majuscules, dans tous les endroits ; le formulaire apparaît dès 8 idées", async () => {
  const ctx = ctxFor();
  const a = await add(ctx, "Éléphant en direct");
  await add(ctx, "Autre sujet");
  assert.equal(form(await def.adminPanel(ctx, { query: {} }), "search"), undefined, "peu d'idées : pas de recherche inutile");
  for (let i = 0; i < 8; i++) await add(ctx, `Remplissage ${i}`);
  assert.ok(form(await def.adminPanel(ctx, { query: {} }), "search"));
  await def.adminActions.moveIdea(ctx, { id: `${a}~archived` });
  const found = html(await def.adminPanel(ctx, { query: { q: "ELEPHANT" } }));
  assert.ok(found.includes("Éléphant en direct") && !found.includes("Autre sujet"));
  assert.match(found, /Archivées/, "le résultat dit où se trouve l'idée");
  const redirect = await def.adminActions.search(ctx, { q: "  éléphant  rose " });
  assert.equal(redirect.redirect, "?q=%C3%A9l%C3%A9phant+rose");
  assert.match(html(await def.adminPanel(ctx, { query: { q: "zzz-introuvable" } })), /Rien ne correspond/);
  assert.equal((await def.adminActions.search(ctx, { q: "" })).redirect, "?");
});

test("tri : la date visée la plus proche d'abord, puis les idées sans date, les plus récentes en tête", () => {
  const mk = (id, targetDate, createdAt) => ({ id, title: id, column: "idea", archived: false, targetDate, createdAt, updatedAt: createdAt, publishedAt: "", steps: [], networks: [], notes: "", summary: "", by: "owner" });
  const sorted = [mk("sans-vieux", "", "2026-01-01T00:00:00Z"), mk("loin", "2026-12-01", "2026-01-01T00:00:00Z"), mk("sans-recent", "", "2026-06-01T00:00:00Z"), mk("proche", "2026-11-01", "2026-02-01T00:00:00Z")].sort(D.compare).map((i) => i.id);
  assert.deepEqual(sorted, ["proche", "loin", "sans-recent", "sans-vieux"]);
});

// ── Une idée : étapes, déplacements, détails ───────────────────────────────────────────────────────────────────

test("page d'une idée : menu de déplacement, étapes à cocher, quand et où, texte ; retour vers la liste", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Ma vidéo");
  const blocks = await def.adminPanel(ctx, { query: { idea: id, col: "idea" } });
  assert.match(html(blocks), /href="\?">← Retour à « Idées »/);
  const move = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "moveIdea");
  assert.deepEqual(move.rowIds, ["idea", "doing", "published", "archived"].map((p) => `${id}~${p}`));
  assert.ok(move.rows[0][0].startsWith("✔"), "l'endroit actuel est marqué");
  const steps = form(blocks, "saveSteps");
  assert.deepEqual(steps.fields.filter((f) => f.kind === "checkbox").map((f) => f.label), ["Script", "Miniature", "Description", "Publication"]);
  const when = form(blocks, "saveWhen");
  assert.equal(when.fields.find((f) => f.name === "targetDate").kind, "date");
  assert.deepEqual(when.fields.filter((f) => f.kind === "checkbox").map((f) => f.label).slice(0, 4), ["YouTube", "Twitch", "Instagram", "TikTok"]);
  assert.ok(when.fields.some((f) => f.name === "otherNetworks"));
  assert.ok(form(blocks, "saveText"));
  assert.equal(form(blocks, "saveWhen").fields.some((f) => f.name === "publishedAt"), false, "« Publiée le » seulement pour une idée publiée");
});

test("étapes : cocher puis décocher, un état périmé est refusé", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Étapes");
  const r = await def.adminActions.saveSteps(ctx, { id, n: "4", step_0: "on", step_2: "on" });
  assert.match(r.ok, /2 sur 4/);
  assert.deepEqual(ideas(ctx)[0].data.steps.map((s) => s.done), [true, false, true, false]);
  await def.adminActions.saveSteps(ctx, { id, n: "4", step_2: "on" });
  assert.deepEqual(ideas(ctx)[0].data.steps.map((s) => s.done), [false, false, true, false]);
  const stale = await def.adminActions.saveSteps(ctx, { id, n: "3", step_0: "on" });
  assert.ok(stale.error);
  assert.deepEqual(ideas(ctx)[0].data.steps.map((s) => s.done), [false, false, true, false], "rien n'a bougé");
  assert.ok((await def.adminActions.saveSteps(ctx, { id: "inconnu", n: "1" })).error);
});

test("déplacer : publié enregistre la date du jour, archiver garde l'endroit, ressortir remet l'idée en place", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Voyage");
  await def.adminActions.moveIdea(ctx, { id: `${id}~doing` });
  assert.equal(ideas(ctx)[0].data.column, "doing");
  const r = await def.adminActions.moveIdea(ctx, { id: `${id}~published` });
  assert.match(r.ok, /Publié/);
  assert.equal(ideas(ctx)[0].data.publishedAt, "2026-10-22");
  await def.adminActions.moveIdea(ctx, { id: `${id}~archived` });
  assert.equal(ideas(ctx)[0].data.archived, true);
  assert.equal(ideas(ctx)[0].data.column, "published", "l'idée archivée se souvient d'où elle vient");
  assert.equal(ideas(ctx)[0].data.publishedAt, "2026-10-22", "et la date de publication reste");
  await def.adminActions.moveIdea(ctx, { id: `${id}~idea` });
  assert.equal(ideas(ctx)[0].data.archived, false);
  assert.equal(ideas(ctx)[0].data.publishedAt, "", "sortie de « Publié » : plus de date de publication");
  assert.match((await def.adminActions.moveIdea(ctx, { id: `${id}~idea` })).ok, /déjà/);
  assert.ok((await def.adminActions.moveIdea(ctx, { id: `${id}~ailleurs` })).error);
  assert.ok((await def.adminActions.moveIdea(ctx, { id: `inconnu~doing` })).error);
});

test("quand et où : date, réseaux cochés + réseaux libres, erreurs sous le bon champ", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Réseaux");
  const names = D.suggestions(ctx);
  assert.deepEqual(names.slice(0, 3), ["YouTube", "Twitch", "Instagram"]);
  const r = await def.adminActions.saveWhen(ctx, { id, netNames: names.join("\n"), targetDate: "2026-11-14", net_0: "on", net_3: "on", otherNetworks: "Newsletter, youtube, Mon Podcast" });
  assert.ok(r.ok);
  const data = ideas(ctx)[0].data;
  assert.equal(data.targetDate, "2026-11-14");
  assert.deepEqual(data.networks, ["YouTube", "TikTok", "Newsletter", "Mon Podcast"]);
  const bad = await def.adminActions.saveWhen(ctx, { id, netNames: names.join("\n"), targetDate: "2026-02-30", otherNetworks: "x".repeat(40) });
  assert.match(bad.errors.targetDate, /2026-10-29/, "exemple : dans une semaine");
  assert.ok(bad.errors.otherNetworks);
  assert.equal(ideas(ctx)[0].data.targetDate, "2026-11-14", "une erreur n'enregistre rien");
  const many = await def.adminActions.saveWhen(ctx, { id, netNames: "", otherNetworks: Array.from({ length: 20 }, (_, i) => `R${i}`).join(",") });
  assert.match(many.errors.otherNetworks, /12/);
  assert.equal((await def.adminActions.saveWhen(ctx, { id, netNames: "", targetDate: "" })).ok !== undefined, true);
  assert.equal(ideas(ctx)[0].data.targetDate, "", "date vidée");
  assert.deepEqual(ideas(ctx)[0].data.networks, []);
});

test("réseaux proposés : le réglage change les suggestions, jamais vide", () => {
  assert.deepEqual(D.suggestions(ctxFor({ networkList: "Pinterest, Mastodon" })), ["Pinterest", "Mastodon"]);
  assert.ok(D.suggestions(ctxFor({ networkList: " , " })).includes("YouTube"));
});

test("l'idée : titre, phrase, notes, étapes ; une étape qui garde son nom garde son état", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Texte");
  await def.adminActions.saveSteps(ctx, { id, n: "4", step_0: "on", step_1: "on" });
  const r = await def.adminActions.saveText(ctx, { id, title: "Nouveau titre", summary: "Une phrase.", notes: "Ligne 1\r\nLigne 2", stepsText: "script\nTournage\nMiniature\n\n  " });
  assert.ok(r.ok);
  const d = ideas(ctx)[0].data;
  assert.equal(d.title, "Nouveau titre");
  assert.equal(d.notes, "Ligne 1\nLigne 2");
  assert.deepEqual(d.steps, [{ label: "script", done: true }, { label: "Tournage", done: false }, { label: "Miniature", done: true }]);
  const bad = await def.adminActions.saveText(ctx, { id, title: "", summary: "s".repeat(301), notes: "n".repeat(4001), stepsText: Array.from({ length: 13 }, (_, i) => `E${i}`).join("\n") });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["notes", "stepsText", "summary", "title"]);
  const longStep = await def.adminActions.saveText(ctx, { id, title: "ok", summary: "", notes: "", stepsText: "y".repeat(70) });
  assert.match(longStep.errors.stepsText, /60/);
  assert.equal(ideas(ctx)[0].data.title, "Nouveau titre", "une erreur n'enregistre rien");
});

test("supprimer pour toujours : seulement une idée archivée, la confirmation dit ce qui sera effacé", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "À jeter");
  assert.ok((await def.adminActions.deleteIdea(ctx, { id })).error, "pas sans archiver d'abord");
  assert.equal(ideas(ctx).length, 1);
  assert.ok(!allText(await def.adminPanel(ctx, { query: { idea: id } })).includes("deleteIdea"), "pas de bouton de suppression sur une idée non archivée");
  await def.adminActions.moveIdea(ctx, { id: `${id}~archived` });
  const blocks = await def.adminPanel(ctx, { query: { idea: id } });
  const del = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "deleteIdea");
  assert.equal(del.rowActions[0].danger, true);
  assert.match(del.rowActions[0].confirm, /À jeter.*pour toujours.*impossible/s);
  const r = await def.adminActions.deleteIdea(ctx, { id });
  assert.ok(r.ok);
  assert.equal(ideas(ctx).length, 0);
  assert.ok((await def.adminActions.deleteIdea(ctx, { id })).error, "déjà partie");
});

// ── Le rythme : doux, calculé à la lecture ──────────────────────────────────────────────────────────────────────

const published = (day, title = "Pub") => ({ title, column: "published", archived: false, steps: [], publishedAt: day, createdAt: NOW });
const rhythm1w = { rhythmCount: "1", rhythmPeriod: "week" };

test("rythme : facultatif — sans réglage, aucun message de rythme", async () => {
  const ctx = ctxFor({}, { rows: { ideas: [published("2026-01-01")] } });
  assert.equal(D.rhythmOf(ctx), null);
  assert.ok(!html(await def.adminPanel(ctx, { query: {} })).includes("Votre rythme"));
  assert.equal(D.rhythmOf(ctxFor({ rhythmCount: "0", rhythmPeriod: "week" })), null);
  assert.equal(D.rhythmOf(ctxFor({ rhythmCount: "1", rhythmPeriod: "jamais" })), null);
});

test("rythme : une par semaine — dans les temps, en retard (message doux), longue pause, rien publié", async () => {
  const lines = (rows, settings = rhythm1w) => A.gentleLines(ctxFor(settings, { rows: { ideas: rows } }), rows.map((r, i) => D.normalize({ id: `i${i}`, data: r })), "2026-10-22");
  assert.match(lines([])[0], /Dès que vous rangerez une idée dans « Publié »/);
  assert.match(lines([published("2026-10-16")])[0], /dans votre rythme/, "6 jours : dans les temps");
  assert.match(lines([published("2026-10-15")])[0], /dans votre rythme/, "7 jours : encore dans les temps");
  const late = lines([published("2026-10-13")])[0];
  assert.match(late, /9 jours/);
  assert.match(late, /Ce n'est pas grave/);
  assert.ok(!/retard|oubli|honte|manqu|échec|paresse/i.test(late), "jamais culpabilisant");
  const pause = lines([published("2026-08-01")])[0];
  assert.match(pause, /pause/);
  assert.match(pause, /tout à fait normal/);
  assert.match(pause, /Réglages/);
  assert.ok(!/retard|oubli|honte|manqu|échec|paresse/i.test(pause));
  assert.match(lines([published("2026-10-13")], { rhythmCount: "3", rhythmPeriod: "month" })[0], /3 par mois/);
});

test("rythme : le message en retard propose l'idée en préparation, sinon d'en choisir une, sinon d'en noter une", async () => {
  const mk = (extra) => A.gentleLines(ctxFor(rhythm1w), [published("2026-10-01"), ...extra].map((r, i) => D.normalize({ id: `i${i}`, data: r })), "2026-10-22")[0];
  assert.match(mk([{ title: "Ma vidéo prête", column: "doing", archived: false, steps: [] }]), /« Ma vidéo prête » est déjà en préparation/);
  assert.match(mk([{ title: "Une idée", column: "idea", archived: false, steps: [] }]), /Choisissez une idée/);
  assert.match(mk([]), /Notez une idée/);
});

test("rythme : une idée archivée mais publiée compte toujours ; une idée sortie de « Publié » ne compte plus", () => {
  const status = (rows) => D.rhythmStatus(rows.map((r, i) => D.normalize({ id: `i${i}`, data: r })), { count: 1, period: "week", days: 7 }, "2026-10-22");
  assert.equal(status([{ ...published("2026-10-20"), archived: true }]).state, "ok");
  assert.equal(status([{ title: "x", column: "doing", publishedAt: "2026-10-20" }]).state, "start");
  assert.equal(status([published("2026-10-20"), published("2026-10-21"), published("2026-09-01")]).done, 2);
});

test("dates visées passées : une phrase douce et une pastille, jamais pour une idée publiée ou archivée", async () => {
  const rows = [{ title: "Passée", column: "idea", archived: false, steps: [], targetDate: "2026-10-01" }, { title: "Publiée", column: "published", archived: false, steps: [], targetDate: "2026-01-01", publishedAt: "2026-01-02" }, { title: "Rangée", column: "idea", archived: true, steps: [], targetDate: "2026-01-01" }, { title: "Future", column: "idea", archived: false, steps: [], targetDate: "2027-01-01" }];
  const ctx = ctxFor({}, { rows: { ideas: rows } });
  const page = html(await def.adminPanel(ctx, { query: {} }));
  assert.match(page, /Une idée a une date visée passée\. Aucune urgence/);
  assert.equal((page.match(/class="cp-chip cp-late"/g) ?? []).length, 1);
  const idea = ideas(ctx).find((r) => r.data.title === "Passée");
  assert.match(html(await def.adminPanel(ctx, { query: { idea: idea.id } })), /Ce n&#39;est pas grave/);
});

// ── Vie privée et sécurité ─────────────────────────────────────────────────────────────────────────────────────

const HOSTILE = '<img src=x onerror=alert(1)>"\'</style><script>alert(2)</script>';

test("tout ce que la personne écrit est échappé dans les cartes et la page d'une idée", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, HOSTILE, { summary: HOSTILE, notes: HOSTILE, networks: [HOSTILE], steps: [{ label: HOSTILE, done: false }] });
  for (const query of [{}, { idea: id }, { q: "alert" }, { col: "doing" }]) {
    const page = html(await def.adminPanel(ctx, { query }));
    assert.ok(!page.includes("<img src=x") && !page.includes("<script>alert") && !page.includes("</style><script"), JSON.stringify(query));
  }
  assert.ok(html(await def.adminPanel(ctx, { query: {} })).includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("liens du cahier : seuls nos paramètres, toujours encodés", () => {
  assert.equal(V.href({ idea: 'a"b&c', col: "doing" }), "?idea=a%22b%26c&col=doing");
  assert.equal(V.href({ evil: "x" }), "?");
  assert.equal(V.href({ col: "idea" }), "?");
  assert.equal(V.href({ page: 1 }), "?");
  assert.equal(V.href({ page: 2, col: "published" }), "?col=published&page=2");
});

test("une idée inconnue ou forgée ne plante pas : retour à la liste avec une phrase", async () => {
  const ctx = ctxFor();
  await add(ctx, "Une");
  for (const idea of ["inconnu", "../../etc", "<script>"]) assert.match(html(await def.adminPanel(ctx, { query: { idea } })), /n&#39;existe plus/);
  assert.equal((await def.adminActions.saveText(ctx, { id: "<x>", title: "t" })).error !== undefined, true);
  assert.equal(await D.getIdea(ctx, "a b"), null);
});

test("un document d'une autre forme dans le stockage n'est jamais pris pour une idée", async () => {
  const ctx = ctxFor({}, { rows: { autre: [{ name: "x" }] } });
  const other = ctx.dumpStore()[0].id;
  assert.equal(await D.getIdea(ctx, other), null);
  assert.ok((await def.adminActions.moveIdea(ctx, { id: `${other}~doing` })).error);
  assert.ok((await def.adminActions.deleteIdea(ctx, { id: other })).error);
  assert.equal(ctx.dumpStore().length, 1);
});

test("aucun appel réseau, service, sujet, e-mail : rien ne sort du cahier", async () => {
  const ctx = ctxFor();
  const id = await add(ctx, "Privé");
  await def.adminPanel(ctx, { query: { idea: id } });
  await def.mcp.ideas_list(ctx, {});
  await def.backup.readable(ctx);
  assert.deepEqual([ctx.calls.net, ctx.calls.services, ctx.calls.topics, ctx.calls.mail, ctx.calls.entries, ctx.calls.denied], [[], [], [], [], [], []]);
  assert.ok(ctx.calls.writes.every((w) => w.collection === "ideas"), "on n'écrit que dans la collection des idées");
});

test("volume : 1 000 idées, l'écran reste à 50 cartes et rapide", async () => {
  const rows = { ideas: Array.from({ length: D.MAX_IDEAS }, (_, i) => ({ title: `Idée ${i}`, summary: "une phrase", column: ["idea", "doing", "published"][i % 3], archived: i % 10 === 0, steps: [{ label: "Script", done: i % 2 === 0 }], networks: ["YouTube"], notes: "n".repeat(500), targetDate: i % 4 === 0 ? "2026-12-01" : "", publishedAt: i % 3 === 2 ? "2026-10-01" : "", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })) };
  const ctx = ctxFor(rhythm1w, { rows });
  const t0 = Date.now();
  const blocks = await def.adminPanel(ctx, { query: { col: "doing" } });
  assert.ok((html(blocks).match(/class="cp-card"/g) ?? []).length <= 50);
  assert.ok(Date.now() - t0 < 2000, "moins de 2 secondes");
  assert.ok(JSON.stringify(blocks).length < 120_000, "la page reste légère");
});

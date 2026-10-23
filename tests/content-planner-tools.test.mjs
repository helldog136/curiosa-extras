// Cahier de contenu : les outils pour l'assistant IA (MCP), le fichier CSV et la sauvegarde lisible.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { validateArgs } from "@/core/services/mcp/validate";

const DIR = new URL("../modules/content-planner", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const def = (await import("../modules/content-planner/index.mjs")).default;
const D = await import("../modules/content-planner/data.mjs");
const X = await import("../modules/content-planner/export.mjs");

let seq = 0;
const ctxFor = (settings = {}, opts = {}) => {
  const ctx = fakeCtx({ key: `cpt${++seq}`, moduleId: "content-planner", basePath: null, locale: opts.locale ?? "fr", messages: readJson(`locales/${opts.locale ?? "fr"}.json`), settings, permissions: manifest.permissions, ...opts });
  ctx.__plannerNow = "2026-10-22T10:00:00Z";
  return ctx;
};
const ideas = (ctx) => ctx.dumpStore().filter((r) => r.collection === "ideas");
const call = (ctx, name, args = {}) => {
  const decl = manifest.mcp.find((a) => a.name === name);
  const checked = validateArgs(decl.input, args); // le cœur refuse (en levant) tout argument hors schéma
  return def.mcp[name](ctx, checked ?? args, { name: "test" });
};
const exposed = async (promise) => { try { await promise; } catch (e) { assert.equal(e.expose, true, "l'erreur doit être lisible par l'assistant"); return e.message; } assert.fail("une erreur était attendue"); };

test("MCP : ajouter une idée — le titre suffit, les étapes du modèle, notée « par l'assistant »", async () => {
  const ctx = ctxFor();
  const made = await call(ctx, "idea_add", { title: "  Tutoriel sur le montage " });
  assert.equal(made.title, "Tutoriel sur le montage");
  assert.equal(made.place, "idea");
  assert.deepEqual(made.steps.map((s) => s.name), ["Script", "Miniature", "Description", "Publication"]);
  assert.equal(made.steps[0].number, 1);
  assert.equal(made.addedBy, "assistant");
  assert.equal(ideas(ctx)[0].data.by, "assistant");
});

test("MCP : ajouter avec tout — phrase, endroit, date, réseaux, étapes, notes ; des erreurs claires sinon", async () => {
  const ctx = ctxFor();
  const made = await call(ctx, "idea_add", { title: "Live spécial", summary: "Un live pour fêter.", place: "doing", targetDate: "2026-11-14", networks: ["Twitch", "twitch", "YouTube"], steps: ["Annoncer", "Préparer l'overlay"], notes: "Penser au gâteau" });
  assert.equal(made.place, "doing");
  assert.equal(made.targetDate, "2026-11-14");
  assert.deepEqual(made.networks, ["Twitch", "YouTube"]);
  assert.deepEqual(made.steps.map((s) => s.name), ["Annoncer", "Préparer l'overlay"]);
  assert.equal(made.notes, "Penser au gâteau");
  assert.match(await exposed(call(ctx, "idea_add", { title: "   " })), /title is required/);
  assert.match(await exposed(call(ctx, "idea_add", { title: "ok", targetDate: "2026-02-30" })), /YYYY-MM-DD/);
  assert.match(await exposed(call(ctx, "idea_add", { title: "ok", networks: Array.from({ length: 20 }, (_, i) => `R${i}`) })), /12 networks/);
  assert.match(await exposed(call(ctx, "idea_add", { title: "ok", steps: ["x".repeat(61)] })), /too long/);
  assert.equal(ideas(ctx).length, 1, "aucune idée à moitié notée");
});

test("MCP : le cœur refuse les arguments inconnus ou hors bornes avant d'arriver au module", () => {
  const decl = manifest.mcp.find((a) => a.name === "idea_add");
  assert.throws(() => validateArgs(decl.input, { title: "x", intrus: 1 }), /unexpected argument/);
  assert.throws(() => validateArgs(decl.input, { title: "x", place: "published" }), "on n'ajoute pas directement en « publié »");
  assert.throws(() => validateArgs(decl.input, {}));
  assert.throws(() => validateArgs(manifest.mcp.find((a) => a.name === "idea_move").input, { id: "a", to: "deleted" }));
});

test("MCP : plafond de 1 000 idées — message clair", async () => {
  const rows = { ideas: Array.from({ length: D.MAX_IDEAS }, (_, i) => ({ title: `I${i}`, column: "idea", archived: false, steps: [], createdAt: "2026-01-01T00:00:00Z" })) };
  const ctx = ctxFor({}, { rows });
  assert.match(await exposed(call(ctx, "idea_add", { title: "De trop" })), /notebook is full/);
});

test("MCP : lister — par endroit, recherche sans accents, pages par curseur, sans les notes", async () => {
  const ctx = ctxFor();
  const a = await call(ctx, "idea_add", { title: "Éléphant", notes: "secret de fabrication" });
  const b = await call(ctx, "idea_add", { title: "Girafe", place: "doing" });
  await call(ctx, "idea_add", { title: "Zèbre" });
  await call(ctx, "idea_move", { id: a.id, to: "archived" });
  const active = await call(ctx, "ideas_list", {});
  assert.deepEqual(active.map((i) => i.title).sort(), ["Girafe", "Zèbre"], "par défaut : sans les archivées");
  assert.ok(!JSON.stringify(active).includes("secret de fabrication"), "les notes ne sont dans la liste qu'à la demande");
  assert.deepEqual((await call(ctx, "ideas_list", { place: "archived" })).map((i) => i.title), ["Éléphant"]);
  assert.equal((await call(ctx, "ideas_list", { place: "all" })).length, 3);
  assert.deepEqual((await call(ctx, "ideas_list", { q: "ELEPHANT", place: "all" })).map((i) => i.title), ["Éléphant"]);
  assert.deepEqual((await call(ctx, "ideas_list", { place: "doing" })).map((i) => i.id), [b.id]);
  const first = await call(ctx, "ideas_list", { place: "all", limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.next);
  const second = await call(ctx, "ideas_list", { place: "all", limit: 2, cursor: first.next });
  assert.equal(second.items.length, 1);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.items, ...second.items].map((i) => i.id)).size, 3, "ni doublon ni trou");
  assert.equal((await call(ctx, "ideas_list", { cursor: "n'importe quoi" })).items.length, 2, "un curseur illisible repart du début");
});

test("MCP : lire une idée en entier (notes comprises) ; une idée inconnue ou d'un autre type est refusée clairement", async () => {
  const ctx = ctxFor({}, { rows: { autre: [{ title: "Pas une idée" }] } });
  const a = await call(ctx, "idea_add", { title: "Lue", notes: "Les notes" });
  const got = await call(ctx, "idea_get", { id: a.id });
  assert.equal(got.notes, "Les notes");
  assert.ok(got.createdAt);
  assert.match(await exposed(call(ctx, "idea_get", { id: "inconnu" })), /No idea with this id/);
  const other = ctx.dumpStore().find((r) => r.collection === "autre").id;
  assert.match(await exposed(call(ctx, "idea_get", { id: other })), /No idea/);
});

test("MCP : modifier — seulement les champs donnés ; une date vide la retire ; les étapes ne bougent pas", async () => {
  const ctx = ctxFor();
  const a = await call(ctx, "idea_add", { title: "Avant", summary: "Phrase", targetDate: "2026-11-01", networks: ["Blog"], notes: "N" });
  await call(ctx, "idea_step", { id: a.id, step: "Script" });
  const r = await call(ctx, "idea_update", { id: a.id, title: "Après", targetDate: "" });
  assert.equal(r.title, "Après");
  assert.equal(r.targetDate, null);
  assert.equal(r.summary, "Phrase");
  assert.deepEqual(r.networks, ["Blog"]);
  assert.equal(r.notes, "N");
  assert.equal(r.steps[0].done, true);
  assert.equal((await call(ctx, "idea_update", { id: a.id, networks: ["A", "B"] })).networks.length, 2);
  assert.match(await exposed(call(ctx, "idea_update", { id: a.id, title: "" })), /title is required/);
  assert.match(await exposed(call(ctx, "idea_update", { id: a.id, targetDate: "demain" })), /YYYY-MM-DD/);
  assert.equal(ideas(ctx)[0].data.title, "Après", "une erreur ne change rien");
});

test("MCP : déplacer — publié note la date du jour, archivé n'efface rien, on peut ressortir", async () => {
  const ctx = ctxFor();
  const a = await call(ctx, "idea_add", { title: "Va et vient" });
  assert.equal((await call(ctx, "idea_move", { id: a.id, to: "doing" })).place, "doing");
  const pub = await call(ctx, "idea_move", { id: a.id, to: "published" });
  assert.equal(pub.place, "published");
  assert.equal(pub.publishedAt, "2026-10-22");
  assert.equal((await call(ctx, "idea_move", { id: a.id, to: "archived" })).place, "archived");
  assert.equal(ideas(ctx).length, 1, "archiver ne supprime jamais");
  assert.equal((await call(ctx, "idea_move", { id: a.id, to: "idea" })).place, "idea");
  assert.match(await exposed(call(ctx, "idea_move", { id: "inconnu", to: "doing" })), /No idea/);
});

test("MCP : cocher une étape par son nom (sans tenir compte des capitales) ou son numéro ; décocher ; erreur qui liste les étapes", async () => {
  const ctx = ctxFor();
  const a = await call(ctx, "idea_add", { title: "Cases" });
  assert.equal((await call(ctx, "idea_step", { id: a.id, step: "miniature" })).steps[1].done, true);
  assert.equal((await call(ctx, "idea_step", { id: a.id, step: "1" })).steps[0].done, true);
  const r = await call(ctx, "idea_step", { id: a.id, step: "Script", done: false });
  assert.equal(r.steps[0].done, false);
  assert.equal(r.stepsDone, 1);
  const err = await exposed(call(ctx, "idea_step", { id: a.id, step: "Tournage" }));
  assert.match(err, /1\. Script; 2\. Miniature; 3\. Description; 4\. Publication/);
  assert.match(await exposed(call(ctx, "idea_step", { id: a.id, step: "9" })), /No such step/);
  const none = await call(ctx, "idea_add", { title: "Sans étapes", steps: [] });
  assert.match(await exposed(call(ctx, "idea_step", { id: none.id, step: "1" })), /no steps/);
});

test("MCP : les lectures n'écrivent rien ; les écritures ne touchent que les idées ; jamais de lecture d'un autre module", async () => {
  const ctx = ctxFor();
  const a = await call(ctx, "idea_add", { title: "Lecture" });
  const before = ctx.calls.writes.length;
  await call(ctx, "ideas_list", { place: "all" });
  await call(ctx, "idea_get", { id: a.id });
  assert.equal(ctx.calls.writes.length, before);
  await call(ctx, "idea_update", { id: a.id, notes: "x" });
  await call(ctx, "idea_move", { id: a.id, to: "doing" });
  await call(ctx, "idea_step", { id: a.id, step: "1" });
  assert.ok(ctx.calls.writes.every((w) => w.collection === "ideas"));
  assert.deepEqual([ctx.calls.net, ctx.calls.services, ctx.calls.topics, ctx.calls.entries, ctx.calls.mail], [[], [], [], [], []]);
});

test("MCP : du texte piégé reste du texte (jamais interprété, jamais plus long que prévu)", async () => {
  const ctx = ctxFor();
  const evil = '<script>alert(1)</script>"; DROP TABLE ideas; --\u202e\u0000';
  const a = await call(ctx, "idea_add", { title: evil, summary: evil, notes: evil, networks: [evil] });
  assert.ok(!a.title.includes("\u202e") && !a.title.includes("\u0000"));
  assert.ok(a.title.length <= D.LIMITS.title && a.networks[0].length <= D.LIMITS.network);
  assert.equal(ideas(ctx).length, 1);
});

// ── Fichiers ────────────────────────────────────────────────────────────────────────────────────────────────────

const sample = async (ctx) => {
  const a = await call(ctx, "idea_add", { title: "=SOMME(A1)", summary: "Une \"phrase\"", notes: "Ligne 1\nLigne 2", networks: ["YouTube", "Blog"], targetDate: "2026-11-14" });
  await call(ctx, "idea_step", { id: a.id, step: "Script" });
  const b = await call(ctx, "idea_add", { title: "@cmd|' /C calc'!A0", place: "doing" });
  await call(ctx, "idea_move", { id: b.id, to: "published" });
  const c = await call(ctx, "idea_add", { title: "Rangée" });
  await call(ctx, "idea_move", { id: c.id, to: "archived" });
};
const collect = async (gen) => { let out = ""; for await (const part of gen) out += part; return out; };

test("CSV : un fichier au fil de l'eau, points-virgules en français, virgules en anglais, jamais lu comme une formule", async () => {
  const ctx = ctxFor();
  await sample(ctx);
  const fr = await collect(X.downloads.ideas.generate(ctx));
  assert.ok(fr.startsWith("\ufeff"), "ouvert correctement par Excel");
  const rows = fr.replace(/\r\n$/, "").split("\r\n");
  assert.equal(rows.length, 4);
  assert.match(rows[0], /^\ufeff"Titre";"En une phrase";"Endroit";"Étapes faites";"Étapes"/);
  assert.ok(fr.includes('"\'=SOMME(A1)"'), "formule neutralisée");
  assert.ok(fr.includes("\"'@cmd"), "formule neutralisée");
  assert.ok(fr.includes('"Une ""phrase"""'), "guillemets doublés");
  assert.ok(fr.includes('"1/4"') && fr.includes("[x] Script | [ ] Miniature"));
  assert.ok(fr.includes('"Archivées"') && fr.includes('"Publié"'));
  const en = await collect(X.downloads.ideas.generate(ctxFor({}, { locale: "en", rows: { ideas: ideas(ctx).map((r) => r.data) } })));
  assert.match(en.split("\r\n")[0], /^\ufeff"Title","In one sentence","Place"/);
  assert.equal(X.downloads.ideas.right, "ideas.export");
  assert.equal(X.downloads.ideas.contentType, "text/csv");
  assert.match(X.downloads.ideas.filename(ctx), /^cahier-de-contenu-2026-10-22$/);
});

test("CSV : 1 000 idées sans tout construire d'un coup ; un document étranger est ignoré", async () => {
  const rows = { ideas: Array.from({ length: D.MAX_IDEAS }, (_, i) => ({ title: `Idée ${i}`, column: "idea", archived: false, steps: [], createdAt: "2026-01-01T00:00:00Z" })), autre: [{ foo: 1 }] };
  const ctx = ctxFor({}, { rows });
  let parts = 0, size = 0;
  for await (const part of X.downloads.ideas.generate(ctx)) { parts++; size += part.length; }
  assert.equal(parts, D.MAX_IDEAS + 1, "une ligne à la fois");
  assert.ok(size < 200_000);
});

test("sauvegarde lisible : un tableau et un texte qu'on lit sans rien d'installé", async () => {
  const ctx = ctxFor();
  await sample(ctx);
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path).sort(), ["ideas.csv", "ideas.md"]);
  const md = files.find((f) => f.path === "ideas.md").content;
  assert.match(md, /^# Cahier de contenu/);
  assert.match(md, /## Idées \(1\)/);
  assert.match(md, /## Archivées \(1\)/);
  assert.match(md, /- \[x\] Script/);
  assert.match(md, /- \[ \] Miniature/);
  assert.match(md, /> Ligne 1\n> Ligne 2/);
  assert.match(md, /- Réseaux : YouTube, Blog/);
  const csv = files.find((f) => f.path === "ideas.csv").content;
  assert.ok(csv.includes("\"'=SOMME(A1)\""));
  for (const f of files) assert.ok(f.content.length < 5_000_000);
});

test("sauvegarde lisible : bornée à 5 Mo même avec 1 000 idées pleines de notes", async () => {
  const rows = { ideas: Array.from({ length: D.MAX_IDEAS }, (_, i) => ({ title: `Idée ${i}`, summary: "s".repeat(300), column: "idea", archived: false, steps: Array.from({ length: 12 }, (_, k) => ({ label: `Étape ${k}`.padEnd(60, "x"), done: false })), networks: Array.from({ length: 12 }, (_, k) => `Réseau${k}`.padEnd(30, "y")), notes: "n".repeat(4000), createdAt: "2026-01-01T00:00:00Z" })) };
  const files = await def.backup.readable(ctxFor({}, { rows }));
  for (const f of files) assert.ok(f.content.length <= 5_000_000, `${f.path} : ${f.content.length}`);
  assert.match(files.find((f) => f.path === "ideas.md").content, /La suite a été coupée/);
});

test("sauvegarde lisible : un cahier vide donne des fichiers valides", async () => {
  const files = await def.backup.readable(ctxFor());
  assert.equal(files.length, 2);
  assert.match(files.find((f) => f.path === "ideas.md").content, /## Idées \(0\)/);
});

// Jeu du jour — le sujet « mascot.hint » : une invitation par jour et par instance, jamais la réponse, sans effet si personne ne l'écoute.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { def, D, ctxFor, addQuestion, manifest, messages, NOON, at } from "./helpers/dailyGameKit.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const clockAt = (ms) => { D.clock.now = () => ms; };
test.afterEach(() => { D.clock.now = () => Date.now(); });
const hint = (ctx, q = { locale: ctx.locale, limit: 10 }) => def.exports["mascot.hint"](ctx, q);
const ID_RE = /^[A-Za-z0-9:_.-]{1,100}$/;

test("manifeste : le sujet est déclaré (provides), la permission aussi, le réglage existe", () => {
  assert.deepEqual(manifest.provides.map((p) => p.topic), ["mascot.hint"]);
  assert.ok(manifest.provides[0].label.fr && manifest.provides[0].label.en);
  assert.ok(manifest.permissions.includes("topics"));
  assert.ok(manifest.settings.some((s) => s.key === "mascotHint" && s.default === true));
  assert.ok(manifest.settings.some((s) => s.key === "hintText" && s.translatable));
});

test("une question aujourd'hui : un message { id, text, url }, au bon format pour la mascotte", async () => {
  clockAt(NOON);
  const ctx = ctxFor();
  await addQuestion(ctx, { q: "Capitale du pays-test ?", a: ["Ville-A", "Ville-B", "Ville-C"], correct: 2, e: "EXPLICATION-SECRETE-42" });
  const rows = await hint(ctx);
  assert.equal(rows.length, 1);
  const [h] = rows;
  assert.match(h.id, ID_RE);
  assert.equal(h.id, `daily-game:${ctx.instance.key}:2026-10-24`);
  assert.equal(h.text, "Le jeu du jour t'attend !");
  assert.equal(h.url, "/jeu-du-jour");
  assert.ok(h.text.length <= 140);
  assert.deepEqual(Object.keys(h).sort(), ["id", "text", "url"]);
});

test("jamais la réponse, ni la question, ni l'explication", async () => {
  clockAt(NOON);
  const ctx = ctxFor({ hintText: "Viens jouer" });
  await addQuestion(ctx, { q: "Question-secrète-Z ?", a: ["Réponse-X", "Réponse-Y"], correct: 2, e: "EXPLICATION-SECRETE-42" });
  const s = JSON.stringify(await hint(ctx));
  for (const leak of ["Question-secrète-Z", "Réponse-X", "Réponse-Y", "EXPLICATION-SECRETE-42", "correct"]) assert.ok(!s.includes(leak), leak);
});

test("idempotent dans la journée, nouvel identifiant le lendemain, et la question du jour reste figée", async () => {
  const ctx = ctxFor();
  await addQuestion(ctx, { q: "Q1 ?", a: ["a", "b"], pos: 1 });
  await addQuestion(ctx, { q: "Q2 ?", a: ["a", "b"], pos: 2 });
  clockAt(NOON);
  const a = await hint(ctx), b = await hint(ctx);
  assert.deepEqual(a, b);
  const planned = ctx.dumpStore().filter((r) => r.collection !== "dg_questions").length;
  await hint(ctx); await hint(ctx);
  assert.equal(ctx.dumpStore().filter((r) => r.collection !== "dg_questions").length, planned, "aucune écriture de plus");
  clockAt(at("2026-10-25"));
  const next = await hint(ctx);
  assert.equal(next.length, 1);
  assert.notEqual(next[0].id, a[0].id);
  assert.match(next[0].id, /2026-10-25$/);
});

test("rien à annoncer : banque vide, brouillons seuls, réglage décoché, limite 0", async () => {
  clockAt(NOON);
  const empty = ctxFor();
  assert.deepEqual(await hint(empty), []);
  const drafts = ctxFor();
  await addQuestion(drafts, { status: "draft", q: "Brouillon ?", a: ["a", "b"] });
  assert.deepEqual(await hint(drafts), []);
  const off = ctxFor({ mascotHint: false });
  await addQuestion(off, { q: "Q ?", a: ["a", "b"] });
  assert.deepEqual(await hint(off), []);
  assert.deepEqual(await hint(off, { limit: 10 }), []);
  const zero = ctxFor();
  await addQuestion(zero, { q: "Q ?", a: ["a", "b"] });
  assert.deepEqual(await hint(zero, { limit: 0 }), []);
});

test("texte : anglais par défaut en anglais, réglage libre sur une ligne et borné, lien suivant la langue", async () => {
  clockAt(NOON);
  const en = ctxFor({}, { locale: "en" });
  await addQuestion(en, { q: "Q ?", a: ["a", "b"] });
  const [h] = await hint(en);
  assert.equal(h.text, "Today's game is waiting for you!");
  assert.equal(h.url, "/en/jeu-du-jour");
  const own = ctxFor({ hintText: `  <b>Hop</b>\n${"x".repeat(300)} ` });
  await addQuestion(own, { q: "Q ?", a: ["a", "b"] });
  const [o] = await hint(own);
  assert.ok(o.text.length <= 140 && !o.text.includes("\n"), o.text);
});

test("plusieurs instances : une invitation chacune, identifiants distincts ; sans page, pas de lien", async () => {
  clockAt(NOON);
  const a = ctxFor(), b = ctxFor();
  await addQuestion(a, { q: "Q ?", a: ["a", "b"] }); await addQuestion(b, { q: "Q ?", a: ["a", "b"] });
  const [ha] = await hint(a), [hb] = await hint(b);
  assert.notEqual(ha.id, hb.id);
  const bare = ctxFor({}, { basePath: null });
  await addQuestion(bare, { q: "Q ?", a: ["a", "b"] });
  const [hn] = await hint(bare);
  assert.ok(hn && !("url" in hn));
});

test("mise à jour à chaud : le nouveau fichier est rechargé, l'ancien n'est pas repris", async () => {
  const src = path.join(path.dirname(new URL(import.meta.url).pathname), "../modules/daily-game");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-game-hint-"));
  try {
    fs.cpSync(src, dir, { recursive: true });
    const load = (v) => import(`${pathToFileURL(path.join(dir, "index.mjs")).href}?v=${v}`);
    const before = (await load("a")).default;
    const view = path.join(dir, "view.mjs");
    fs.writeFileSync(view, fs.readFileSync(view, "utf8").replace("clean(ctx.setting(\"hintText\"), 140) || ctx.t(\"hintText\")", "\"TEXTE-NEUF\""));
    const after = (await load("b")).default;
    const mk = () => { const c = fakeCtx({ key: "maj", basePath: "jeu", moduleId: "daily-game", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages: messages("fr"), permissions: manifest.permissions, settings: { timezone: "UTC" } }); c.can = () => true; return c; };
    const c = mk(); D.clock.now = () => NOON;
    await addQuestion(c, { q: "Q ?", a: ["a", "b"] });
    assert.equal((await before.exports["mascot.hint"](c, {}))[0].text, "Le jeu du jour t'attend !");
    assert.equal((await after.exports["mascot.hint"](c, {}))[0].text, "TEXTE-NEUF");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

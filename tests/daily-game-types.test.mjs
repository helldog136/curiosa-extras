// Jeu du jour — la table des types de jeu est extensible : un second jeu (« mot du jour ») s'ajoute sans toucher au choix de la question, au planning,
// à la série, au partage, à l'import ni à l'administration.
import test from "node:test";
import assert from "node:assert/strict";
import { def, G, D, L, ctxFor, post, rows, NOON, textOf } from "./helpers/dailyGameKit.mjs";

const clockAt = (ms) => { D.clock.now = () => ms; };
test.afterEach(() => { D.clock.now = () => Date.now(); });

/** Un jeu de test : deviner un mot. La solution (`word`) ne part jamais avec la page. */
const word = {
  id: "word",
  blank: () => ({ word: "", hint: "" }),
  normalize: (raw) => ({ word: L.clean(raw?.word, 30).toLowerCase(), hint: L.clean(raw?.hint, 100) }),
  complete: (d) => d.word.length >= 3,
  langs: (d) => (d.word ? ["fr", "en"] : []),
  title: (d) => d.hint,
  text: (d) => `${d.word} ${d.hint}`,
  fields: (ctx, item) => [{ name: "word", label: "Mot", value: item?.d.word ?? "" }, { name: "hint", label: "Indice", value: item?.d.hint ?? "" }],
  fromForm: (ctx, values) => (values.word ? { d: word.normalize({ word: values.word, hint: values.hint }) } : { errors: { word: "Écrivez un mot, par exemple « soleil »." } }),
  play: (ctx, item) => ({ html: `<form class="dg-form" data-dg-form data-dg-type="word"><p>${L.esc(item.d.hint)}</p><input name="guess"><button data-dg-submit>OK</button></form>`, lang: ctx.locale, other: false }),
  check(ctx, item, body) {
    if (typeof body?.guess !== "string") return { ok: false };
    const same = L.fold(body.guess).trim() === L.fold(item.d.word);
    return { ok: true, correct: same, score: same ? 1 : 0, reveal: { word: item.d.word } };
  },
  csvAliases: { word: ["mot"], hint: ["indice"] },
  csvRequired: ["word"],
  csvColumns: () => ["word", "hint"],
  csvRow: (item) => [item.d.word, item.d.hint],
  fromCsv: (get) => (get("word", "") ? { d: word.normalize({ word: get("word", ""), hint: get("hint", "") }) } : { fail: { column: "word", key: "csvNoQuestion" } }),
  fromAssistant: (ctx, args) => (args?.word ? { d: word.normalize(args) } : { fail: "'word' is required." }),
  describe: (ctx, item, { solution }) => ({ hint: item.d.hint, ...(solution ? { word: item.d.word } : {}) }),
};

test("un type de jeu mal fait est refusé tout de suite, avec ce qui manque", () => {
  assert.throws(() => G.registerGameType({ id: "Mauvais id" }), /bad id/);
  assert.throws(() => G.registerGameType({ id: "incomplet", blank() {} }), /missing normalize/);
  assert.throws(() => G.registerGameType(null), /bad id/);
  assert.ok(G.gameTypeIds().includes("quiz"));
});

test("un second jeu s'ajoute sans toucher au reste : page, réponse jugée côté serveur, planning, ordre, bloc d'accueil", async () => {
  G.registerGameType(word);
  clockAt(NOON);
  const ctx = ctxFor({ gameType: "word", order: "sequence" });
  await ctx.api.store.add("dg_questions", { type: "word", status: "published", pos: 1, by: "admin", d: { word: "soleil", hint: "Il brille le jour" } });
  await ctx.api.store.add("dg_questions", { type: "word", status: "published", pos: 2, by: "admin", d: { word: "lune", hint: "Elle brille la nuit" } });
  await ctx.api.store.add("dg_questions", { type: "quiz", status: "published", pos: 3, by: "admin", d: { tr: { fr: { q: "Un quiz ?", a: ["a", "b"] } }, correct: 0 } });
  D.invalidate(ctx);
  const page = (await def.page(ctx, { segments: [] })).blocks[0].html;
  assert.match(page, /Il brille le jour/);
  assert.match(page, /data-type="word"/);
  assert.ok(!page.includes("soleil") && !page.includes("Un quiz ?"));
  const today = await D.getToday(ctx);
  const base = { day: today.day, qid: today.item.id };
  const bad = await (await def.routes.answer(post("answer", { ...base, guess: "nuage" }), ctx)).json();
  assert.deepEqual([bad.correct, bad.pts, bad.reveal], [false, 0, { word: "soleil" }]);
  const win = await (await def.routes.answer(post("answer", { ...base, guess: " SOLEIL " }), ctx)).json();
  assert.deepEqual([win.correct, win.pts], [true, 100]);
  assert.equal((await def.routes.answer(post("answer", { ...base, choice: 1 }), ctx)).status, 400);
  assert.equal((await D.outlook(ctx, { count: 3, fresh: true })).left.days, 1);
  assert.ok((await def.sections.today(ctx))[1].html.includes("data-dg-card"));
});

test("l'administration travaille avec les champs du type : formulaire, erreurs, export, import, assistant", async () => {
  G.registerGameType(word);
  clockAt(NOON);
  const ctx = ctxFor({ gameType: "word" });
  const f = (await def.adminPanel(ctx, { query: { new: "1" } })).find((b) => b.type === "adminForm" && b.action === "saveQuestion");
  assert.deepEqual(f.fields.map((x) => x.name), ["id", "word", "hint", "cat", "lvl", "date", "state"]);
  assert.match((await def.adminActions.saveQuestion.run(ctx, { state: "published", word: "" })).errors.word, /Écrivez un mot/);
  assert.ok((await def.adminActions.saveQuestion.run(ctx, { state: "published", word: "Soleil", hint: "Il brille", date: "2026-12-25" })).ok);
  assert.deepEqual([rows(ctx, "dg_questions")[0].type, rows(ctx, "dg_questions")[0].d.word, rows(ctx, "dg_questions")[0].date], ["word", "soleil", "2026-12-25"]);
  let csv = "";
  for await (const c of def.adminDownloads.export.generate(ctx)) csv += c;
  assert.match(csv, /"status","date","category","difficulty","word","hint"\r\n"published","2026-12-25","","","soleil","Il brille"/);
  const imp = await def.adminActions.importCsv.run(ctx, { file: "word,hint\nlune,Elle brille la nuit\n", lang: "fr", state: "published" });
  assert.equal(imp.ok, "1 questions importées (0 déjà présentes, ignorées).", JSON.stringify(imp));
  assert.ok((await def.mcp.daily_questions_list(ctx, { full: true })).items.some((i) => i.word === "lune"));
  assert.equal((await def.mcp.daily_question_add(ctx, { word: "etoile", hint: "Elle scintille" }, { name: "a" })).status, "draft");
  assert.ok(textOf(await def.adminPanel(ctx, { query: {} })).includes("Elle brille la nuit"));
});

test("un type inconnu retombe sur le quiz", () => {
  assert.equal(D.typeOf(ctxFor({ gameType: "inconnu" })).id, "quiz");
  assert.equal(D.typeOf(ctxFor({})).id, "quiz");
});

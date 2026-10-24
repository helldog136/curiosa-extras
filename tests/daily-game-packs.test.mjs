// Jeu du jour — les packs de départ : 30 questions chacun, en français ET en anglais, vérifiables, neutres, bien formées.
import test from "node:test";
import assert from "node:assert/strict";
import { PK, G, L, ctxFor, rows, D, def, NOON } from "./helpers/dailyGameKit.mjs";

const quiz = G.gameType("quiz");
const FORBIDDEN = /\b(twitch|youtube|discord|steam|nintendo|sony|playstation|xbox|microsoft|google|facebook|instagram|tiktok|amazon|netflix|epic games|riot|blizzard|ubisoft|mario|zelda|pok[eé]mon|minecraft|fortnite|tetris|pac-?man)\b/i;

test("deux packs, 30 questions chacun ; deux gabarits", () => {
  assert.deepEqual(PK.PACKS.map((p) => [p.id, p.questions.length, p.type]), [["games", 30, "quiz"], ["streaming", 30, "quiz"]]);
  assert.deepEqual(PK.TEMPLATES.map((t) => [t.id, t.packs]), [["games", ["games"]], ["empty", []]]);
  for (const x of [...PK.TEMPLATES, ...PK.PACKS]) for (const l of ["fr", "en"]) assert.ok(PK.pickText(x.name, l) && PK.pickText(x.about, l));
});

test("chaque question : deux langues complètes, 3 à 4 réponses différentes, même nombre et même bonne réponse, explication, texte neutre", () => {
  for (const p of PK.PACKS) p.questions.forEach((q, n) => {
    const where = `${p.id} #${n + 1}`;
    assert.deepEqual(Object.keys(q.tr).sort(), ["en", "fr"], where);
    assert.ok(q.correct >= 1 && q.correct <= q.tr.fr.a.length, where);
    assert.equal(q.tr.fr.a.length, q.tr.en.a.length, where);
    assert.ok(q.tr.fr.a.length >= 3 && q.tr.fr.a.length <= 4, where);
    assert.ok(["easy", "medium", "hard"].includes(q.lvl) && q.cat.fr && q.cat.en, where);
    for (const l of ["fr", "en"]) {
      const t = q.tr[l];
      assert.ok(t.q.length <= L.LIMITS.text && t.q.endsWith("?"), `${where} ${l} : question`);
      assert.ok(t.e.length >= 20 && t.e.length <= L.LIMITS.text, `${where} ${l} : explication`);
      assert.equal(new Set(t.a.map((x) => x.toLowerCase())).size, t.a.length, `${where} ${l}`);
      for (const text of [t.q, t.e, ...t.a]) assert.ok(text && !/[<>{}]/.test(text) && !FORBIDDEN.test(text), `${where} ${l} : « ${text.slice(0, 40)} »`);
      for (const a of t.a) assert.ok(a.length <= L.LIMITS.choice, `${where} ${l} : réponse trop longue`);
    }
    const d = quiz.normalize({ tr: Object.fromEntries(Object.entries(q.tr).map(([l, v]) => [l, { q: v.q, a: v.a, e: v.e }])), correct: q.correct - 1 });
    assert.ok(quiz.complete(d) && quiz.langs(d).length === 2, where);
  });
});

test("pas de doublon, bonne réponse répartie, niveaux et catégories variés", () => {
  const seen = new Set();
  for (const p of PK.PACKS) {
    const spots = new Map(), levels = new Set(), cats = new Set();
    for (const q of p.questions) {
      for (const l of ["fr", "en"]) { const k = `${l}|${q.tr[l].q.toLowerCase()}`; assert.ok(!seen.has(k), `doublon : ${q.tr[l].q}`); seen.add(k); }
      spots.set(q.correct, (spots.get(q.correct) ?? 0) + 1); levels.add(q.lvl); cats.add(q.cat.fr);
    }
    assert.ok([1, 2, 3].every((n) => spots.get(n) >= 5) && spots.get(4) >= 3, p.id);
    assert.equal(levels.size, 3, p.id);
    assert.ok(cats.size >= 4, p.id);
  }
});

test("un pack activé donne des questions jouables, avec la catégorie de la langue du site", async () => {
  const ctx = ctxFor();
  await def.adminActions.activatePack.run(ctx, { id: "games" });
  const items = rows(ctx, "dg_questions");
  assert.equal(items.length, 30);
  assert.ok(items.some((q) => q.cat === "Vocabulaire"));
  const en = ctxFor({}, { locale: "en" });
  await def.adminActions.activatePack.run(en, { id: "streaming" });
  D.clock.now = () => NOON;
  const page = (await def.page(en, { segments: [] })).blocks[0].html;
  D.clock.now = () => Date.now();
  assert.ok(!page.includes("does not exist in your language"));
  assert.match(page, /type="radio"/);
});

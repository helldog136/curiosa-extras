// Jeu du jour — quelle question aujourd'hui : dates dans le fuseau du site, rotation dans l'ordre ou au hasard sans répétition, planning, « il reste N jours ».
import test from "node:test";
import assert from "node:assert/strict";
import { L, P, D, ctxFor, addQuestion, addMany, rows, at, NOON } from "./helpers/dailyGameKit.mjs";

const mk = (id, extra = {}) => ({ id, status: "published", date: "", pos: Number(id.replace(/\D/g, "")) || 0, createdAt: 0, ...extra });
const bank = (n) => Array.from({ length: n }, (_, i) => mk(`q${i + 1}`));
const rand = (seed) => (n, day) => L.seededIndex(seed, day, n);

/** Joue `days` jours de suite à partir de `from` (comme le fait le site à la première visite de chaque jour). */
function play(from, days, items, mode, seed = 7) {
  let state = { seed, cycleStart: "", hist: {} };
  const out = [];
  let day = from;
  for (let i = 0; i < days; i++, day = L.addDays(day, 1)) {
    const c = P.choose(day, state, items, mode, (n) => rand(seed)(n, day));
    out.push(c.id);
    if (c.id) state = P.remember(state, day, c, 400);
  }
  return { out, state };
}
test.afterEach(() => { D.clock.now = () => Date.now(); });

test("jour : calculé dans le fuseau du site, pas celui du serveur", () => {
  const t = Date.UTC(2026, 9, 24, 23, 30);
  assert.equal(L.dayKey(t, "UTC"), "2026-10-24");
  assert.equal(L.dayKey(t, "Europe/Paris"), "2026-10-25");
  assert.equal(L.dayKey(t, "America/Los_Angeles"), "2026-10-24");
  assert.equal(L.dayKey(t, "Pas/Un_Fuseau"), L.dayKey(t, L.DEFAULT_TZ));
  assert.equal(L.dayKey(Date.UTC(2027, 0, 1, 0, 0), "UTC"), "2027-01-01");
});

test("jour : dates impossibles refusées, calculs de fin de mois et d'année, semaine ISO", () => {
  assert.equal(L.isDay("2026-02-30"), false);
  assert.equal(L.isDay("2028-02-29"), true);
  assert.equal(L.isDay("2026-13-01"), false);
  assert.equal(L.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(L.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(L.daysBetween("2026-10-24", "2026-10-31"), 7);
  assert.equal(L.weekKey("2026-10-24"), "2026-W43");
  assert.equal(L.weekKey("2026-10-26"), "2026-W44");
  assert.equal(L.weekKey("2027-01-01"), "2026-W53");
  assert.equal(L.weekKey("2027-01-04"), "2027-W01");
});

test("rotation dans l'ordre : une par jour, puis le tour recommence", () => {
  assert.deepEqual(play("2026-10-24", 7, bank(3), "sequence").out, ["q1", "q2", "q3", "q1", "q2", "q3", "q1"]);
});

test("rotation au hasard : toutes passent avant qu'une revienne ; ne dépend que de la graine et des dates", () => {
  const items = bank(10);
  const a = play("2026-10-24", 20, items, "random", 11).out;
  assert.deepEqual(a, play("2026-10-24", 20, items, "random", 11).out);
  for (const round of [a.slice(0, 10), a.slice(10, 20)]) assert.equal(new Set(round).size, 10);
  assert.notDeepEqual(a.slice(0, 10), items.map((i) => i.id));
  assert.notDeepEqual(play("2026-10-24", 20, items, "random", 12).out, a);
  assert.notEqual(a[9], a[10]);
});

test("question planifiée : à sa date, hors rotation ; un brouillon est ignoré", () => {
  const items = [...bank(3), mk("q9", { date: "2026-10-26" }), mk("q10", { status: "draft", date: "2026-10-25" })];
  assert.deepEqual(play("2026-10-24", 5, items, "sequence").out, ["q1", "q2", "q9", "q3", "q1"]);
});

test("banque qui bouge : une question ajoutée en cours de tour n'en fait repasser aucune avant la fin du tour", () => {
  let items = bank(4);
  let state = { seed: 3, cycleStart: "", hist: {} };
  const seen = [];
  let day = "2026-10-24";
  for (let i = 0; i < 2; i++, day = L.addDays(day, 1)) { const c = P.choose(day, state, items, "sequence", rand(3)); seen.push(c.id); state = P.remember(state, day, c); }
  items = [...items, mk("q5")];
  for (let i = 0; i < 3; i++, day = L.addDays(day, 1)) { const c = P.choose(day, state, items, "sequence", rand(3)); seen.push(c.id); state = P.remember(state, day, c); }
  assert.deepEqual(seen, ["q1", "q2", "q3", "q4", "q5"]);
  assert.equal(P.choose(day, state, items.filter((i) => i.id !== "q2"), "sequence", rand(3)).id, "q1");
});

test("rien à jouer : pas d'erreur", () => {
  assert.equal(P.choose("2026-10-24", { hist: {}, cycleStart: "" }, [], "sequence", rand(1)).id, null);
  assert.equal(P.choose("2026-10-24", { hist: {}, cycleStart: "" }, [mk("q1", { status: "draft" })], "random", rand(1)).id, null);
});

test("« il reste N jours » : sac du jour plus jours planifiés intercalés", () => {
  const items = [...bank(5), mk("q9", { date: "2026-10-26" }), mk("q8", { date: "2026-12-31" })];
  const s = { hist: {}, cycleStart: "" };
  assert.deepEqual(P.daysLeft("2026-10-24", s, items, "sequence", rand(1), L.addDays), { days: 5, wraps: true });
  assert.deepEqual(P.daysLeft("2026-10-24", s, [], "sequence", rand(1), L.addDays), { days: 0, wraps: false });
  assert.deepEqual(P.daysLeft("2026-10-24", s, [mk("q1", { date: "2026-10-30" })], "sequence", rand(1), L.addDays), { days: 1, wraps: false });
  assert.equal(P.daysLeft("2026-10-24", s, [mk("q1")], "random", rand(1), L.addDays).days, 0);
});

test("« il reste N jours » : même résultat que le programme réellement joué", () => {
  for (const mode of ["sequence", "random"]) {
    const items = [...bank(8), mk("q20", { date: "2026-10-27" })];
    const { out, state } = play("2026-10-24", 1, items, mode, 5);
    const left = P.daysLeft("2026-10-24", state, items, mode, rand(5), L.addDays);
    const seen = new Set([out[0]]);
    let days = 0;
    for (const id of play("2026-10-24", 30, items, mode, 5).out.slice(1)) { if (seen.has(id) && id !== "q20") break; seen.add(id); days++; }
    assert.equal(left.days, days, mode);
  }
});

test("prévision des 7 prochains jours, sans rien écrire", () => {
  const items = [...bank(4), mk("q9", { date: "2026-10-26" })];
  const out = P.forecast("2026-10-24", 7, { seed: 1, cycleStart: "", hist: {} }, items, "sequence", rand(1), L.addDays);
  assert.deepEqual(out.map((d) => d.id), ["q1", "q2", "q9", "q3", "q4", "q1", "q2"]);
  assert.equal(out[2].scheduled, true);
  assert.equal(out[5].repeat, true);
});

test("hasard déterministe : indices dans les bornes et stables", () => {
  for (const n of [1, 2, 7, 100]) { const i = L.seededIndex(9, "2026-10-24", n); assert.ok(i >= 0 && i < n); assert.equal(i, L.seededIndex(9, "2026-10-24", n)); }
});

test("le choix d'un jour est figé : ajouter ou retirer des questions ne change que les jours suivants", async () => {
  const ctx = ctxFor({ order: "sequence" });
  const [a, b, c] = await addMany(ctx, 3);
  D.clock.now = () => NOON;
  assert.equal((await D.getToday(ctx)).item.id, a);
  await addQuestion(ctx, { q: "Nouvelle ?", a: ["x", "y"], pos: 99 });
  assert.equal((await D.getToday(ctx)).item.id, a);
  assert.equal(Object.keys(rows(ctx, "dg_plan")[0].hist).length, 1);
  D.clock.now = () => at("2026-10-25");
  assert.equal((await D.getToday(ctx)).item.id, b);
  const head = await addQuestion(ctx, { q: "En tête ?", a: ["x", "y"], pos: -5 });
  D.clock.now = () => at("2026-10-26");
  assert.equal((await D.getToday(ctx)).item.id, head);
  D.clock.now = () => at("2026-10-27");
  assert.equal((await D.getToday(ctx)).item.id, c, "puis la suite du tour, jamais une déjà passée");
});

test("une question retirée alors qu'elle est la question du jour est remplacée sans erreur", async () => {
  const ctx = ctxFor();
  const [a, b] = await addMany(ctx, 2);
  D.clock.now = () => NOON;
  assert.equal((await D.getToday(ctx)).item.id, a);
  await ctx.api.store.remove(a);
  D.invalidate(ctx);
  assert.equal((await D.getToday(ctx)).item.id, b);
});

test("plusieurs visiteurs en même temps le premier matin : une seule question, la même pour tous", async () => {
  const ctx = ctxFor({ order: "random" });
  await addMany(ctx, 20);
  D.clock.now = () => NOON;
  const picks = await Promise.all(Array.from({ length: 12 }, () => D.getToday(ctx)));
  assert.equal(new Set(picks.map((p) => p.item.id)).size, 1);
  assert.equal(Object.keys(rows(ctx, "dg_plan")[0].hist).length, 1);
});

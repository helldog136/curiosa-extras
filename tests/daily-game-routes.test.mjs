// Jeu du jour — les routes publiques : « answer » (juger sans rien garder), « board » (classement facultatif avec Participation).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeAudience } from "./helpers/fakeAudience.mjs";
import { def, D, ctxFor, addQuestion, addMany, post, rows, NOON, at, pageHtml } from "./helpers/dailyGameKit.mjs";

const clockAt = (ms) => { D.clock.now = () => ms; };
test.afterEach(() => { D.clock.now = () => Date.now(); });
const j = async (res) => res.json();
const TOKEN = (n) => `tok${String(n).padStart(2, "0")}`.padEnd(24, "x");

async function setup(settings = {}, opts = {}, question = {}) {
  clockAt(NOON);
  const ctx = ctxFor(settings, opts);
  const id = await addQuestion(ctx, { q: "Capitale ?", a: ["Paris", "Rome", "Oslo"], correct: 2, e: "Rome est la capitale de l'Italie.", ...question });
  const today = await D.getToday(ctx);
  return { ctx, id, base: { day: today.day, qid: today.item.id } };
}
const answer = (ctx, body, opts) => def.routes.answer(post("answer", body, opts), ctx);

test("réponse : jugée par le site ; solution et explication ne partent qu'avec la réponse", async () => {
  const { ctx, base } = await setup();
  const ok = await j(await answer(ctx, { ...base, choice: 1 }));
  assert.deepEqual([ok.ok, ok.correct, ok.pts], [true, true, 100]);
  assert.deepEqual(ok.reveal, { answer: 1, explain: "Rome est la capitale de l'Italie." });
  const bad = await j(await answer(ctx, { ...base, choice: 0 }));
  assert.deepEqual([bad.correct, bad.pts, bad.reveal.answer], [false, 0, 1]);
});

test("réponse : rien n'est enregistré, aucun cookie, rien en cache", async () => {
  const { ctx, base } = await setup();
  const before = ctx.dumpStore().length;
  for (let i = 0; i < 5; i++) {
    const res = await answer(ctx, { ...base, choice: i % 3 }, { ip: `198.51.100.${i}` });
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(ctx.dumpStore().length, before);
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("198.51.100"));
});

test("réponse : « nouveau jour » si la page est restée ouverte, sans rien révéler", async () => {
  const { ctx, base } = await setup();
  clockAt(at("2026-10-25"));
  const late = await answer(ctx, { ...base, choice: 1 });
  assert.equal(late.status, 409);
  assert.deepEqual(await j(late), { ok: false, reason: "newday" });
  assert.equal((await answer(ctx, { ...base, qid: "autre", choice: 1 })).status, 409);
});

test("réponse : choix illisible ou hors des réponses → 400 sans solution", async () => {
  const { ctx, base } = await setup();
  for (const choice of [3, -1, 99, "x", "1.5", null, undefined, {}, [], 1.5, true]) {
    const res = await answer(ctx, { ...base, choice });
    assert.equal(res.status, 400, JSON.stringify(choice));
    assert.deepEqual(await j(res), { ok: false, reason: "invalid" });
  }
  assert.equal((await j(await answer(ctx, { ...base, choice: "1" }))).correct, true);
});

test("réponse : POST seulement, corps borné, JSON valide", async () => {
  const { ctx, base } = await setup();
  for (const method of ["GET", "PUT", "DELETE"]) assert.equal((await def.routes.answer(post("answer", base, { method }), ctx)).status, 405);
  assert.equal((await answer(ctx, "x".repeat(5000))).status, 413);
  assert.equal((await answer(ctx, "pas du json")).status, 400);
  assert.equal((await answer(ctx, "[1,2]")).status, 400);
  assert.equal((await answer(ctx, "null")).status, 400);
});

test("réponse : le piège à robots répond poliment sans rien révéler", async () => {
  const { ctx, base } = await setup();
  const res = await j(await answer(ctx, { ...base, choice: 1, website: "http://spam.example" }));
  assert.deepEqual([res.reveal, res.correct], [{}, false]);
});

test("réponse : limite par visiteur et par heure, puis 429 ; un autre visiteur n'est pas touché", async () => {
  const { ctx, base } = await setup({ answerLimit: 6 });
  for (let i = 0; i < 6; i++) assert.equal((await answer(ctx, { ...base, choice: 0 }, { ip: "198.51.100.1" })).status, 200);
  const over = await answer(ctx, { ...base, choice: 0 }, { ip: "198.51.100.1" });
  assert.equal(over.status, 429);
  assert.deepEqual(await j(over), { ok: false, reason: "limit" });
  assert.equal((await answer(ctx, { ...base, choice: 0 }, { ip: "198.51.100.2" })).status, 200);
});

test("réponse : une liste d'adresses inventée ne contourne pas la limite", async () => {
  const { ctx, base } = await setup({ answerLimit: 5 });
  let last;
  for (let i = 0; i < 12; i++) last = await answer(ctx, { ...base, choice: 0 }, { headers: { "x-forwarded-for": `9.9.9.${i}, 203.0.113.50` } });
  assert.equal(last.status, 429);
});

test("réponse : limite globale du jeu", async () => {
  const { ctx, base } = await setup();
  let refused = 0;
  for (let i = 0; i < 950; i++) { const res = await answer(ctx, { ...base, choice: 0 }, { ip: `10.1.${Math.floor(i / 250)}.${i % 250}` }); if (res.status === 429) refused++; }
  assert.ok(refused >= 40, `${refused} refus`);
});

test("points : bonus de rapidité seulement si le chronomètre est gardé, jamais de pénalité", async () => {
  const { ctx, base } = await setup({ seconds: 20 });
  let n = 0;
  const score = async (extra, choice = 1) => j(await answer(ctx, { ...base, choice, ...extra }, { ip: `10.2.0.${++n}` }));
  assert.equal((await score({ ms: 0, timer: true })).bonus, 50);
  assert.equal((await score({ ms: 10000, timer: true })).pts, 125);
  assert.equal((await score({ ms: 20000, timer: true })).bonus, 0);
  assert.equal((await score({ ms: 90000, timer: true })).pts, 100);
  assert.equal((await score({ ms: 0, timer: false })).bonus, 0);
  assert.equal((await score({ ms: -5, timer: true })).bonus, 0);
  assert.equal((await score({ ms: "vite", timer: true })).bonus, 0);
  assert.equal((await score({ ms: 0, timer: true }, 0)).pts, 0);
  const none = await setup({ timerMode: "none" });
  assert.equal((await j(await answer(none.ctx, { ...none.base, choice: 1, ms: 0, timer: true }))).bonus, 0);
});

test("réponse : l'explication est dans la langue du visiteur ; pas de question → 404", async () => {
  clockAt(NOON);
  const ctx = ctxFor({}, { locale: "en" });
  await addQuestion(ctx, { q: "Capitale ?", a: ["Paris", "Rome"], correct: 2, e: "Explication française", en: { q: "Capital?", a: ["Paris", "Rome"], e: "English explanation", alt: "" } });
  const today = await D.getToday(ctx);
  assert.equal((await j(await answer(ctx, { day: today.day, qid: today.item.id, choice: 1 }))).reveal.explain, "English explanation");
  const empty = ctxFor();
  const res = await answer(empty, { day: "2026-10-24", qid: "x", choice: 0 });
  assert.equal(res.status, 404);
  assert.deepEqual(await j(res), { ok: false, reason: "none" });
});

// ── Classement ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function boardSetup(settings = {}, audience = fakeAudience(), question = {}) {
  clockAt(NOON);
  const ctx = ctxFor({ leaderboard: true, ...settings }, { services: audience.services });
  await addQuestion(ctx, { q: "Capitale ?", a: ["Paris", "Rome", "Oslo"], correct: 2, e: "Rome.", ...question });
  const today = await D.getToday(ctx);
  const base = { day: today.day, qid: today.item.id };
  const board = (body, opts) => def.routes.board(post("board", body, opts), ctx);
  const score = (n, nick, extra = {}, opts) => board({ act: "score", t: TOKEN(n), ...(nick ? { nick } : {}), ...base, choice: 1, ms: 5000, timer: true, ...extra }, opts);
  return { ctx, audience, base, board, score };
}

test("classement : désactivé par défaut — la route répond comme si elle n'existait pas", async () => {
  clockAt(NOON);
  const ctx = ctxFor({}, { services: fakeAudience().services });
  await addMany(ctx, 1);
  assert.equal((await def.routes.board(post("board", { act: "join", t: TOKEN(1), nick: "Renard" }), ctx)).status, 404);
  assert.ok(!(await pageHtml(ctx)).includes("data-dg-board"));
});

test("classement : sans Participation, rien n'est affiché et la route dit que ce n'est pas disponible", async () => {
  clockAt(NOON);
  const ctx = ctxFor({ leaderboard: true });
  await addMany(ctx, 1);
  const res = await def.routes.board(post("board", { act: "join", t: TOKEN(1), nick: "Renard" }), ctx);
  assert.equal(res.status, 503);
  assert.deepEqual(await j(res), { ok: false, reason: "boardOff" });
  const html = await pageHtml(ctx);
  assert.ok(!html.includes("data-dg-board"));
  assert.match(html, /data-board="0"/);
});

test("classement : score recalculé par le site, jamais cru sur parole, compté une fois par jour", async () => {
  const { ctx, audience, score } = await boardSetup();
  const first = await j(await score(1, "Renard2000"));
  assert.deepEqual([first.ok, first.rank], [true, 1]);
  assert.deepEqual(first.top, [{ rank: 1, name: "Renard2000", pts: 133 }]);
  const again = await j(await score(1, "", { ms: 0 }));
  assert.equal(again.already, true);
  assert.equal(again.top[0].pts, 133);
  const cheat = await j(await score(2, "Loup", { choice: 0, pts: 99999, correct: true, rank: 1 }));
  assert.equal(cheat.top.find((r) => r.name === "Loup").pts, 0);
  assert.equal(rows(ctx, "dg_board").length, 1);
  assert.ok(audience.calls.some(([m]) => m === "claim"));
});

test("classement : du meilleur au moins bon, sans identifiant", async () => {
  const { score } = await boardSetup();
  await score(1, "Alice", { ms: 15000 });
  await score(2, "Bruno", { ms: 0 });
  await score(3, "Chloé", { choice: 0 });
  const last = await j(await score(4, "Dora", { ms: 7500 }));
  assert.deepEqual(last.top.map((r) => r.name), ["Bruno", "Dora", "Alice", "Chloé"]);
  assert.deepEqual(Object.keys(last.top[0]).sort(), ["name", "pts", "rank"]);
});

test("classement : les points s'additionnent dans la semaine, une nouvelle semaine repart de zéro, les anciennes s'effacent", async () => {
  const { ctx, score, board } = await boardSetup();
  await score(1, "Alice", { ms: 15000 });
  const next = async (day, extra = {}) => { clockAt(at(day)); const t = await D.getToday(ctx); return j(await board({ act: "score", t: TOKEN(1), day: t.day, qid: t.item.id, choice: t.item.d.correct, ms: 0, timer: false, ...extra })); };
  assert.equal((await next("2026-10-25")).top[0].pts, 200);
  assert.equal((await next("2026-10-26")).top[0].pts, 100);
  assert.equal(rows(ctx, "dg_board").length, 2);
  for (let w = 2; w <= 7; w++) await next(L_add("2026-10-26", w * 7));
  assert.ok(rows(ctx, "dg_board").length <= 4);
});
const L_add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test("classement : un pseudo refusé dit pourquoi ; sans pseudo, il faut en écrire un", async () => {
  const { score, board } = await boardSetup();
  const banned = await score(1, "administrateur-admin");
  assert.equal(banned.status, 400);
  assert.equal((await j(banned)).reason, "pseudo_banned");
  assert.equal((await j(await score(1, "ab"))).reason, "pseudo_short");
  assert.equal((await j(await score(1, "x".repeat(40)))).reason, "pseudo_long");
  assert.equal((await j(await score(1, "<b>gras</b>"))).reason, "pseudo_chars");
  assert.equal((await j(await score(1, ""))).reason, "boardNeedPseudo");
  assert.equal((await j(await score(2, "Renard"))).ok, true);
  assert.equal((await j(await score(3, "renard"))).reason, "pseudo_taken");
  const join = await j(await board({ act: "join", t: TOKEN(4), nick: "Zorro" }));
  assert.deepEqual(join.top.map((r) => r.name), ["Renard"]);
});

test("classement : une personne en sourdine ne peut pas apparaître", async () => {
  const audience = fakeAudience({ moderator: true });
  const { ctx, score } = await boardSetup({}, audience);
  await score(1, "Renard");
  await audience.asModerator.mute({ room: `dg:${ctx.instance.key}`, pseudo: "Renard", muted: true });
  const res = await score(1, "");
  assert.equal(res.status, 403);
  assert.equal((await j(res)).reason, "muted");
});

test("classement : « quitter » retire la personne du classement et de Participation ; elle peut revenir", async () => {
  const { ctx, audience, score, board } = await boardSetup();
  await score(1, "Alice");
  await score(2, "Bruno");
  assert.equal((await j(await board({ act: "leave", t: TOKEN(1) }))).ok, true);
  assert.deepEqual(rows(ctx, "dg_board")[0].rows.map((r) => r.n), ["Bruno"]);
  assert.equal((await audience.methods.who({ room: `dg:${ctx.instance.key}`, token: TOKEN(1) })).participant, null);
  assert.equal((await j(await score(1, "Alice", { ms: 15000 }))).rank, 2);
});

test("classement : 100 lignes au plus par semaine ; un meilleur score remplace le dernier", async () => {
  const { ctx, score } = await boardSetup();
  for (let i = 0; i < 120; i++) await D.boardAdd(ctx, { week: "2026-W43", pid: `p${String(i).padStart(3, "0")}`, nick: `Joueur${i}`, pts: 100 + i, win: true, day: "2026-10-24" });
  const doc = rows(ctx, "dg_board")[0];
  assert.equal(doc.rows.length, 100);
  assert.equal(doc.rows[0].n, "Joueur119");
  const top = await j(await score(1, "Nouvelle", { ms: 0 }));
  assert.equal(top.rank, 70);
  assert.equal(rows(ctx, "dg_board")[0].rows.length, 100);
  assert.ok(!rows(ctx, "dg_board")[0].rows.some((r) => r.n === "Joueur20"));
});

test("classement : la page montre les dix premiers, échappés, et le formulaire", async () => {
  const { ctx } = await boardSetup();
  for (let i = 0; i < 14; i++) await D.boardAdd(ctx, { week: "2026-W43", pid: `p${i}`, nick: i === 0 ? "<img src=x onerror=alert(1)>" : `Joueur${i}`, pts: 200 - i, win: true, day: "2026-10-24" });
  const html = await pageHtml(ctx);
  assert.match(html, /data-board="1"/);
  assert.match(html, /data-dg-boardform/);
  assert.equal((html.match(/<li><span>/g) ?? []).length, 10);
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("classement : jamais d'adresse gardée — ni dans le jeu, ni dans ce qui est confié à Participation", async () => {
  const { ctx, audience, score } = await boardSetup();
  await score(1, "Renard", {}, { ip: "198.51.100.77" });
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("198.51.100"));
  assert.ok(!audience.dump().includes("198.51.100"));
  assert.ok(!JSON.stringify(audience.calls).includes("198.51.100"));
  const joined = audience.calls.find(([m]) => m === "join")[1];
  assert.deepEqual(Object.keys(joined.conn), ["forwarded"]);
  assert.match(joined.conn.forwarded, /^[A-Za-z0-9_-]{22}$/);
});

test("classement : jeton illisible, action inconnue, jour périmé, corps énorme, piège à robots", async () => {
  const { ctx, board, score, base } = await boardSetup();
  assert.equal((await board({ act: "score", t: "court", ...base, choice: 1 })).status, 400);
  assert.equal((await board({ act: "pirate", t: TOKEN(1) })).status, 400);
  assert.equal((await board("x".repeat(9000))).status, 413);
  assert.equal((await board("{")).status, 400);
  assert.equal((await def.routes.board(post("board", {}, { method: "GET" }), ctx)).status, 405);
  assert.deepEqual(await j(await board({ act: "score", t: TOKEN(1), nick: "Renard", website: "x" })), { ok: true, top: [] });
  assert.equal((await score(1, "Renard", { day: "2026-10-01" })).status, 409);
  assert.equal((await j(await score(1, "Renard", { qid: "autre" }))).reason, "newday");
  assert.equal((await score(1, "Renard", { choice: 9 })).status, 400);
});

test("classement : limite par visiteur et par heure", async () => {
  const { board } = await boardSetup();
  let last;
  for (let i = 0; i < 65; i++) last = await board({ act: "join", t: TOKEN(1), nick: "Renard" }, { ip: "198.51.100.9" });
  assert.equal(last.status, 429);
});

test("classement : Participation absente, en panne, lente ou illisible → le jeu continue", async () => {
  for (const mode of ["throw", "garbage"]) {
    const audience = fakeAudience();
    if (mode === "throw") audience.faults.throw.add("limit"); else audience.services["audience.session"].limit = async () => "pas un objet";
    const { score } = await boardSetup({}, audience);
    const res = await score(1, "Renard");
    assert.equal(res.status, 503, mode);
    assert.equal((await j(res)).reason, "boardOff", mode);
  }
  const slow = fakeAudience();
  slow.faults.hang.add("limit");
  const { ctx, score } = await boardSetup({}, slow);
  const started = Date.now();
  assert.equal((await score(1, "Renard")).status, 503);
  assert.ok(Date.now() - started < 4500);
  assert.match(await pageHtml(ctx), /data-dg-form/);
});

test("classement : la page ne montre le classement que si Participation répond « présent »", async () => {
  clockAt(NOON);
  const present = ctxFor({ leaderboard: true }, { services: fakeAudience().services });
  const absent = ctxFor({ leaderboard: true });
  await addMany(present, 1); await addMany(absent, 1);
  assert.match(await pageHtml(present), /data-dg-board/);
  assert.ok(!(await pageHtml(absent)).includes("data-dg-board"));
});

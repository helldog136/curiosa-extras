import test from "node:test";
import assert from "node:assert/strict";
import { world, pollsMod, pollsDef, pollsFr, pollsEn, post, get, tok } from "./helpers/audienceWorld.mjs";

const L = await import("../modules/polls/lib.mjs");
const T0 = Math.floor(Date.now() / 60_000) * 60_000; // l'heure réelle, arrondie à la minute : certains outils du module lisent l'horloge réelle
const MIN = 60_000;
const alone = (o) => world({ audience: false, ...o });
const polls = async (c) => (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const rounds = async (c) => (await c.api.store.list("rounds")).map((r) => r.data);
const series = async (c) => (await c.api.store.list("meta")).find((r) => r.data.k === "series")?.data;
const current = async (c) => (await polls(c)).find((p) => p.round);
const vote = (c, slug, ids, i, now) => pollsMod.castVote(c, { slug, token: tok(i), ids, now });
const flat = (x) => JSON.stringify(x);

/* ───────────── Le vainqueur : égalités tirées au sort, et dites ───────────── */

test("vainqueur : le plus de voix gagne ; égalité = tirage au sort entre les premiers ex æquo (équitable), liste des ex æquo gardée ; aucune voix = pas de vainqueur", () => {
  const p = (counts) => ({ choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }, { id: "c3", text: "C" }], counts });
  assert.deepEqual(L.pickWinner(p({ c1: 3, c2: 5, c3: 1 })), { winner: { id: "c2", text: "B", count: 5 }, tie: null });
  assert.deepEqual(L.pickWinner(p({})), { winner: null, tie: null });
  assert.deepEqual(L.pickWinner(p({ c1: 0 })), { winner: null, tie: null });
  const tied = L.pickWinner(p({ c1: 4, c2: 4, c3: 2 }), () => 1);
  assert.equal(tied.winner.text, "B"); assert.deepEqual(tied.tie, ["A", "B"], "C n'était pas à égalité");
  assert.equal(L.pickWinner(p({ c1: 4, c2: 4, c3: 4 }), () => 2).winner.text, "C");
  assert.equal(L.pickWinner(p({ c1: 4, c2: 4 }), () => 99).winner.text, "B", "un tirage hors bornes ne casse rien");
  const wins = { A: 0, B: 0, C: 0 };
  for (let i = 0; i < 600; i++) wins[L.pickWinner(p({ c1: 2, c2: 2, c3: 2 })).winner.text]++;
  for (const k of Object.keys(wins)) assert.ok(wins[k] > 140 && wins[k] < 260, `tirage équitable : ${JSON.stringify(wins)}`);
});

/* ───────────── Le cycle d'une manche ───────────── */

test("lancer : la première manche part tout de suite avec des réglages qui marchent sans rien régler ; elle n'apparaît pas dans la liste des sondages", async () => {
  const { polls: c } = alone();
  assert.deepEqual(await pollsMod.startSeries(c, T0), { ok: true });
  const s = await series(c);
  assert.equal(s.status, "running"); assert.equal(s.question, pollsFr.roundQuestion); assert.equal(s.choices.length, 3); assert.equal(s.minutes, 10);
  const r = await current(c);
  assert.equal(r.round.n, 1); assert.equal(r.endsAt, new Date(T0 + 10 * MIN).toISOString()); assert.equal(r.createdAt, new Date(T0).toISOString()); assert.equal(r.max, 1);
  assert.deepEqual(await pollsMod.startSeries(c, T0 + 1000), { ok: false, error: "already" });
  const list = flat(await pollsDef.page(c, { segments: [] }));
  assert.ok(!list.includes(r.slug), "une manche vit sur la page « en cours », pas dans la liste");
  assert.equal(await pollsDef.news(Object.assign(c, { visit: { lastVisit: new Date(T0 - 1000) } })), false, "ni dans la pastille « nouveau »");
  const en = alone({ locale: "en" }).polls; await pollsMod.startSeries(en, T0);
  assert.equal((await series(en)).question, pollsEn.roundQuestion);
});

test("fin de manche : au premier regard après l'heure, le vainqueur est écrit, les votes sont mis de côté puis effacés, la manche suivante démarre SANS dérive", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  for (let i = 1; i <= 7; i++) assert.ok((await vote(c, r1.slug, [i <= 4 ? "c2" : "c1"], i, T0 + i * 1000)).ok);
  await pollsMod.advance(c, T0 + 9 * MIN);
  assert.equal((await rounds(c)).length, 0, "avant l'heure : rien ne bouge");
  assert.equal((await current(c)).slug, r1.slug);
  const out = await pollsMod.advance(c, T0 + 10 * MIN + 5000);
  const [rec] = await rounds(c);
  assert.deepEqual([rec.n, rec.winner, rec.tie, rec.voters, rec.via], [1, pollsFr.roundChoice2, null, 7, "timer"]);
  assert.deepEqual(rec.choices.map((x) => x.count), [3, 4, 0]); assert.equal(rec.question, pollsFr.roundQuestion);
  assert.equal(rec.at, new Date(T0 + 10 * MIN).toISOString(), "l'heure de fin prévue, pas celle du regard");
  const r2 = await current(c);
  assert.notEqual(r2.slug, r1.slug); assert.equal(r2.round.n, 2);
  assert.equal(r2.createdAt, new Date(T0 + 10 * MIN).toISOString(), "démarre à l'heure de fin : pas de trou, pas de dérive");
  assert.equal(r2.endsAt, new Date(T0 + 20 * MIN).toISOString());
  assert.equal(out.lastDecision.winner, pollsFr.roundChoice2);
  assert.equal(await c.api.store.get(r1.id), null, "l'ancien sondage n'existe plus");
  // les votes de la manche sont effacés par petites tranches au passage de ménage suivant, avant la durée habituelle de conservation
  assert.equal(await c.api.store.count(`b-${r1.id}`), 7);
  await pollsMod.sweep(c, T0 + 11 * MIN, { force: true });
  assert.equal(await c.api.store.count(`b-${r1.id}`), 0, "plus aucun bulletin de cette manche");
  assert.ok(!flat(c.api.store.all()).includes(tok(1)), "ni code, ni empreinte lisible");
  const meta = (await c.api.store.list("meta")).find((x) => x.data.k === "cfg").data;
  assert.deepEqual(meta.garbage, [], "la liste d'attente du ménage se vide");
});

test("personne ne regardait : la décision est prise au premier regard, la manche suivante part de MAINTENANT (pas de rattrapage de manches fantômes)", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c3"], 1, T0 + 1000);
  const late = T0 + 3 * 3_600_000;
  await pollsMod.advance(c, late);
  assert.equal((await rounds(c)).length, 1, "une seule décision, pas dix-huit");
  const r2 = await current(c);
  assert.equal(r2.createdAt, new Date(late).toISOString()); assert.equal(r2.round.n, 2); assert.equal(r2.endsAt, new Date(late + 10 * MIN).toISOString());
  assert.equal((await rounds(c))[0].winner, pollsFr.roundChoice3);
});

test("égalité : tirage au sort, le vainqueur ET la liste des ex æquo sont gardés et dits en clair ; personne n'a voté : aucune décision, dit aussi", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c1"], 1, T0 + 1000); await vote(c, r1.slug, ["c3"], 2, T0 + 2000);
  await pollsMod.advance(c, T0 + 11 * MIN, { rand: () => 1 });
  const [tie] = await rounds(c);
  assert.deepEqual(tie.tie, [pollsFr.roundChoice1, pollsFr.roundChoice3]); assert.equal(tie.winner, pollsFr.roundChoice3);
  const r2 = await current(c);
  await pollsMod.advance(c, T0 + 22 * MIN);
  const all = await rounds(c);
  const none = all.find((x) => x.n === 2);
  assert.equal(none.winner, null); assert.equal(none.voters, 0); assert.equal(none.tie, null);
  const page = flat(await pollsDef.page(c, { segments: ["decisions"] }));
  assert.ok(page.includes("Égalité entre") && page.includes(pollsFr.roundChoice1) && page.includes("tirage au sort"), "l'égalité est dite");
  assert.ok(page.includes("Personne n"), "l'absence de vote est dite");
  const en = alone({ locale: "en" }).polls; await pollsMod.startSeries(en, T0);
  const e1 = await current(en); await vote(en, e1.slug, ["c1"], 1, T0 + 1000); await vote(en, e1.slug, ["c2"], 2, T0 + 2000);
  await pollsMod.advance(en, T0 + 11 * MIN, { rand: () => 0 });
  assert.ok(flat(await pollsDef.page(en, { segments: ["decisions"] })).includes("Tie between"));
});

test("des lectures en même temps à la fin d'une manche : une seule décision, une seule nouvelle manche", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  for (let i = 1; i <= 30; i++) await vote(c, r1.slug, ["c1"], i, T0 + i * 100);
  await Promise.all(Array.from({ length: 25 }, (_, i) => pollsMod.advance(c, T0 + 10 * MIN + 1000 + i)));
  assert.equal((await rounds(c)).length, 1);
  assert.equal((await polls(c)).filter((p) => p.round).length, 1);
  assert.equal((await series(c)).n, 2);
});

test("« Suivant » décide tout de suite et lance la manche d'après ; « Arrêter » annule la manche en cours sans décision et efface ses votes ; relancer repart à la manche 1", async () => {
  const { polls: c } = alone();
  assert.deepEqual(await pollsMod.nextRound(c, T0), { ok: false, error: "idle" });
  assert.deepEqual(await pollsMod.stopSeries(c, T0), { ok: false, error: "idle" });
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c2"], 1, T0 + 1000);
  assert.deepEqual(await pollsMod.nextRound(c, T0 + 2 * MIN), { ok: true });
  const [rec] = await rounds(c);
  assert.deepEqual([rec.winner, rec.via, rec.at], [pollsFr.roundChoice2, "next", new Date(T0 + 2 * MIN).toISOString()]);
  const r2 = await current(c);
  assert.equal(r2.round.n, 2); assert.equal(r2.createdAt, new Date(T0 + 2 * MIN).toISOString());
  await vote(c, r2.slug, ["c1"], 2, T0 + 3 * MIN);
  const stopped = await pollsMod.stopSeries(c, T0 + 4 * MIN);
  assert.deepEqual(stopped, { ok: true, cancelled: true });
  assert.equal(await current(c), undefined); assert.equal((await rounds(c)).length, 1, "aucune décision pour une manche annulée");
  assert.equal((await series(c)).status, "idle");
  await pollsMod.sweep(c, T0 + 15 * MIN, { force: true });
  assert.equal(await c.api.store.count(`b-${r2.id}`), 0, "ses votes sont effacés");
  await pollsMod.advance(c, T0 + 40 * MIN);
  assert.equal(await current(c), undefined, "arrêté : rien ne redémarre tout seul");
  await pollsMod.startSeries(c, T0 + 50 * MIN);
  assert.equal((await current(c)).round.n, 1, "relancer repart à la manche 1");
  assert.deepEqual(await pollsMod.stopSeries(c, T0 + 51 * MIN), { ok: true, cancelled: false });
});

test("fermer une manche à la main (outil de l'assistant) : la décision est prise au regard suivant ; l'historique garde 500 décisions, les plus anciennes s'effacent", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c1"], 1, T0 + 1000);
  await pollsDef.mcp.poll_close(c, { id: r1.id });
  await pollsMod.advance(c, T0 + 2000);
  assert.equal((await rounds(c))[0].winner, pollsFr.roundChoice1);
  for (let i = 0; i < 498; i++) await c.api.store.add("rounds", { k: `old-${i}`, n: 0, question: "?", choices: [], voters: 0, winner: null, tie: null, at: "x", decidedAt: new Date(T0 - 1e9 + i).toISOString(), via: "timer" }, { key: `old-${i}` });
  assert.equal(await c.api.store.count("rounds"), 499);
  for (let k = 0; k < 4; k++) await pollsMod.nextRound(c, T0 + (3 + k) * MIN);
  assert.equal(await c.api.store.count("rounds"), 500, "plafond");
  const kept = (await rounds(c)).map((r) => r.k);
  assert.ok(!kept.includes("old-0") && !kept.includes("old-1") && kept.some((k) => !k.startsWith("old-")), "les plus anciennes sont parties");
});

/* ───────────── Réglages des manches ───────────── */

test("réglages : question, choix (2 à 8) et durée (1 à 60 minutes) validés, erreurs PAR CHAMP avec un exemple ; appliqués à la manche suivante", async () => {
  const v = (o) => L.validateSeriesForm({ question: "Q ?", choices: "A\nB", minutes: "10", ...o });
  assert.deepEqual(v({}).errors, {});
  assert.equal(v({ question: " " }).errors.question, "question"); assert.equal(v({ choices: "A" }).errors.choices, "few"); assert.equal(v({ choices: "1\n2\n3\n4\n5\n6\n7\n8\n9" }).errors.choices, "many");
  for (const bad of ["0", "61", "abc", "-5", "2.5", "1e3"]) assert.equal(v({ minutes: bad }).errors.minutes, "minutes", bad);
  assert.equal(v({ minutes: "" }).value.minutes, 10); assert.equal(v({ minutes: "60" }).value.minutes, 60); assert.equal(v({ minutes: "1" }).value.minutes, 1);
  const { polls: c } = alone();
  const r = await pollsDef.adminActions.roundConfig(c, { question: "", choices: "A", minutes: "0" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["choices", "minutes", "question"]);
  assert.match(r.errors.minutes, /1 à 60/); assert.match(r.errors.choices, /Exemple/); assert.match(r.errors.question, /Exemple|exemple/);
  await pollsMod.startSeries(c, T0);
  assert.ok((await pollsDef.adminActions.roundConfig(c, { question: "Quel boss ?", choices: "Boss A\nBoss B", minutes: "5" })).ok);
  assert.equal((await current(c)).question, pollsFr.roundQuestion, "la manche en cours ne change pas en route");
  await pollsMod.nextRound(c, T0 + MIN);
  const r2 = await current(c);
  assert.deepEqual([r2.question, r2.choices.map((x) => x.text), r2.endsAt], ["Quel boss ?", ["Boss A", "Boss B"], new Date(T0 + 6 * MIN).toISOString()]);
});

/* ───────────── Sondage rapide ───────────── */

test("sondage rapide « A ou B ? » : de 2 à 4 choix, durée courte, tout de suite à l'écran ; erreurs par champ ; il reste affiché un peu après sa fin puis l'écran revient à ce qui était", async () => {
  const q = (o) => L.validateQuick({ a: "Boss A", b: "Boss B", ...o });
  assert.deepEqual(q({}).errors, {}); assert.deepEqual(q({}).value, { choices: ["Boss A", "Boss B"], seconds: 60, question: "" });
  assert.equal(q({ a: "" }).errors.a, "quick_a"); assert.equal(q({ b: " " }).errors.b, "quick_b"); assert.equal(q({ b: "boss a" }).errors.b, "quick_same");
  assert.deepEqual(q({ c: "Boss C", d: "Boss D" }).value.choices.length, 4); assert.equal(q({ c: "", d: "Boss D" }).value.choices.length, 3);
  for (const bad of ["abc", "5", "9999", "-3"]) assert.equal(q({ seconds: bad }).errors.seconds, "quick_seconds", bad);
  const { polls: c } = alone();
  await pollsMod.startSeries(c, T0);
  const round = await current(c);
  const bad = await pollsMod.quickPoll(c, { a: "", b: "x" }, T0);
  assert.deepEqual(bad, { ok: false, errors: { a: "quick_a" } });
  const ok = await pollsMod.quickPoll(c, { a: "Boss A", b: "Boss B", seconds: "30" }, T0 + MIN);
  assert.equal(ok.ok, true);
  const quick = (await polls(c)).find((p) => p.quick);
  assert.equal(quick.question, "Boss A ou Boss B ?"); assert.equal(quick.endsAt, new Date(T0 + 90_000).toISOString()); assert.equal(quick.choices.length, 2);
  const cfg = (await c.api.store.list("meta")).find((r) => r.data.k === "cfg");
  const onAir = async (now) => (await pollsDef.routes.live(get(`https://x.test/m/k/live?k=${cfg.data.obsKey}`), c).then((r) => r.json())).question;
  assert.equal(await onAir(), "Boss A ou Boss B ?", "il passe devant la manche en cours");
  assert.equal(cfg.data.onAirUntil, new Date(T0 + 90_000 + 45_000).toISOString());
  const many = await pollsMod.quickPoll(c, { a: "A", b: "B", c: "C", question: "Choisissez" }, T0 + 2 * MIN);
  assert.equal((await polls(c)).find((p) => p.id === many.id).question, "Choisissez");
  assert.equal(many.ok, true);
  const list = flat(await pollsDef.page(c, { segments: [] }));
  assert.ok(list.includes(quick.slug), "un sondage rapide est un sondage comme les autres dans la liste");
});

/* ───────────── Ce qui est à l'écran ───────────── */

test("données de l'écran : la manche avec son numéro, la décision qui vient d'être prise (le temps réglé), puis plus rien ; révision qui change à chaque changement", async () => {
  const { polls: c } = alone();
  await pollsDef.hooks.onInstanceCreate(c);
  await pollsMod.startSeries(c, T0);
  const cfgOf = async () => (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
  const read = async () => (await pollsDef.routes.live(get(`https://x.test/m/k/live?k=${(await cfgOf()).obsKey}`), c)).json();
  const a = await read();
  assert.deepEqual([a.round, a.state, a.rows.length, a.decision], [{ n: 1 }, "open", 3, undefined]);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c1"], 1);
  const b = await read(); assert.notEqual(a.rev, b.rev); assert.equal(b.voters, 1);
  const unchanged = await (await pollsDef.routes.live(get(`https://x.test/m/k/live?k=${(await cfgOf()).obsKey}&rev=${encodeURIComponent(b.rev)}`), c)).json();
  assert.equal(unchanged.unchanged, true);
  await pollsMod.nextRound(c);
  const d = await read();
  assert.equal(d.round.n, 2); assert.equal(d.decision.winner, pollsFr.roundChoice1); assert.equal(d.decision.n, 1);
  assert.ok(Date.parse(d.decision.showUntil) - Date.now() > 15_000 && Date.parse(d.decision.showUntil) - Date.now() <= 20_500, "20 secondes par défaut");
  assert.notEqual(d.rev, b.rev);
  await pollsMod.stopSeries(c);
  const e = await read();
  assert.equal(e.kind, "decision"); assert.equal(e.decision.winner, pollsFr.roundChoice1); assert.deepEqual(e.rows, []);
  // une fois le temps passé : plus rien à montrer
  const later = await (async () => { const cc = alone({ pollsSettings: { winnerSeconds: 5 } }).polls; await pollsDef.hooks.onInstanceCreate(cc); await pollsMod.startSeries(cc, Date.now() - 10_000); await pollsMod.nextRound(cc, Date.now() - 8000); await pollsMod.stopSeries(cc, Date.now() - 7000); const k = (await cc.api.store.list("meta")).find((r) => r.data.k === "cfg").data.obsKey; return (await pollsDef.routes.live(get(`https://x.test/m/k/live?k=${k}`), cc)).json(); })();
  assert.equal(later.empty, true);
});

test("pages publiques : « en cours » avec compte à rebours et décision, historique par pages de 50, ancien lien d'une manche décidée, 404 propres", async () => {
  const { polls: c } = alone();
  await pollsMod.startSeries(c, Date.now() - 5 * MIN);
  const html = (await pollsDef.page(c, { segments: ["now"] })).blocks[0].html;
  const r1 = await current(c);
  assert.ok(html.includes(`data-poll="${r1.slug}"`) && html.includes("data-vp-cd") && /data-left="\d+"/.test(html) && html.includes('data-reload="1"'));
  assert.ok(html.includes("Manche 1") && html.includes("Il reste") && !html.includes("data-vp-live="), "sans Participation : pas de direct, mais le compte à rebours recharge la page");
  assert.ok(html.includes("data-vp-decision") && html.includes(" hidden"), "bandeau de décision prêt, caché");
  await vote(c, r1.slug, ["c3"], 1);
  await pollsMod.nextRound(c);
  const after = (await pollsDef.page(c, { segments: ["now"] })).blocks[0].html;
  assert.ok(after.includes("Le chat a décidé : On fait une pause") && !after.includes("data-vp-decision hidden"), "la décision est affichée en haut");
  assert.ok(after.includes("/polls/decisions"));
  const old = await pollsDef.page(c, { segments: [r1.slug] });
  assert.ok(old.blocks[0].html.includes("Le chat a décidé : On fait une pause") && old.title === pollsFr.roundQuestion, "l'ancien lien montre la décision");
  assert.deepEqual(await pollsDef.page(c, { segments: ["inconnu-zzzz"] }), { notFound: true, blocks: [] });
  for (let i = 0; i < 60; i++) await c.api.store.add("rounds", { k: `r-${i}`, n: 100 + i, question: `Q${i}`, choices: [{ text: "A", count: 1 }], voters: 1, winner: "A", tie: null, at: "x", decidedAt: new Date(T0 + i * 1000).toISOString(), via: "timer" }, { key: `r-${i}` });
  const p1 = flat((await pollsDef.page(c, { segments: ["decisions"] })).blocks), p2 = flat((await pollsDef.page(c, { segments: ["decisions", "page", "2"] })).blocks);
  assert.equal((p1.match(/class=\\"vp-dec\\"/g) ?? []).length, 50); assert.equal((p2.match(/class=\\"vp-dec\\"/g) ?? []).length, 11);
  assert.ok(p1.includes("/polls/decisions/page/2") && p2.includes("/polls/decisions")); 
  for (const segs of [["decisions", "page", "3"], ["decisions", "page", "0"], ["decisions", "page", "x"], ["decisions", "x"], ["decisions", "page"]]) assert.equal((await pollsDef.page(c, { segments: segs })).notFound, true, segs.join("/"));
  const none = alone().polls;
  const empty = (await pollsDef.page(none, { segments: ["now"] })).blocks[0].html;
  assert.ok(empty.includes(pollsFr.nowNone) && !empty.includes("data-poll="));
  assert.ok(flat(await pollsDef.page(none, { segments: ["decisions"] })).includes("encore rien"));
});

test("écran OBS sans Participation : la route du module fait avancer les manches toute seule (l'écran suffit à tout faire tourner)", async () => {
  const { polls: c } = alone();
  await pollsDef.hooks.onInstanceCreate(c);
  await pollsMod.startSeries(c, Date.now() - 11 * MIN);
  const key = (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data.obsKey;
  const live = async () => (await pollsDef.routes.live(get(`https://x.test/m/k/live?k=${key}`), c)).json();
  const d = await live();
  assert.equal(d.round.n, 2, "la manche 1 est décidée, la 2 est à l'écran");
  assert.equal(d.decision.n, 1);
  assert.equal((await rounds(c)).length, 1);
  const overlay = await pollsDef.overlay(c, { query: new URLSearchParams({ k: key }) });
  assert.ok(overlay.script.includes('"alt":null') && overlay.script.includes(`"url":"/m/${c.instance.key}/live?k=`));
  assert.ok(overlay.css.includes(".vo-decision") && overlay.script.includes("Égalité entre"));
});

/* ───────────── Administration ───────────── */

test("administration, onglet « En direct » : état, lien à partager, boutons selon l'état, formulaires préremplis, historique ; sans le droit rien n'est modifiable ; invitation à installer Participation", async () => {
  const { polls: c } = alone();
  const screen = async () => (await pollsDef.adminPanel(c, { query: {} })).filter((b) => b.tab === "screen");
  let b = await screen();
  assert.ok(b.some((x) => x.type === "copy" && x.text.endsWith("/polls/now")));
  assert.ok(b.some((x) => x.type === "adminForm" && x.action === "roundStart") && !b.some((x) => x.action === "roundNext"));
  const cfgForm = b.find((x) => x.action === "roundConfig");
  assert.deepEqual(cfgForm.fields.map((f) => f.name), ["question", "choices", "minutes"]); assert.equal(cfgForm.fields[0].value, pollsFr.roundQuestion);
  const quick = b.find((x) => x.action === "quick");
  assert.deepEqual(quick.fields.map((f) => f.name), ["a", "b", "c", "d", "seconds"]); assert.equal(quick.fields[4].value, "60"); assert.equal(quick.fields[4].options.length, 4);
  assert.ok(b.some((x) => x.type === "suggestInstall" && x.service === "audience.session"), "sans Participation : on propose de l'installer");
  assert.ok(flat(b).includes(pollsFr.roundsIdle));
  assert.ok((await pollsDef.adminActions.roundStart(c, {})).ok);
  b = await screen();
  assert.ok(b.some((x) => x.action === "roundNext") && b.some((x) => x.action === "roundStop" && x.fields[0].required) && !b.some((x) => x.action === "roundStart"));
  assert.ok(flat(b).includes("Manche 1 en cours"));
  assert.equal((await pollsDef.adminActions.roundStart(c, {})).error, pollsFr.remoteErrAlready);
  assert.deepEqual(Object.keys((await pollsDef.adminActions.roundStop(c, {})).errors), ["confirm"]);
  assert.ok((await pollsDef.adminActions.roundNext(c, {})).ok);
  assert.ok((await screen()).some((x) => x.type === "table" && x.rows.length === 1), "l'historique montre la décision");
  assert.ok((await pollsDef.adminActions.roundStop(c, { confirm: "on" })).ok);
  assert.equal((await pollsDef.adminActions.roundNext(c, {})).error, pollsFr.remoteErrIdle);
  const q = await pollsDef.adminActions.quick(c, { a: "", b: "", seconds: "60" });
  assert.deepEqual(Object.keys(q.errors).sort(), ["a", "b"]); assert.match(q.errors.a, /Exemple/);
  assert.equal((await pollsDef.adminActions.quick(c, { a: "x", b: "y", seconds: "7" })).errors.seconds, pollsFr.err_quick_seconds);
  assert.ok((await pollsDef.adminActions.quick(c, { a: "x", b: "y", seconds: "60" })).ok);
  // droits
  c.can = (r) => r === "obs.view";
  const before = c.api.store.writes.length;
  for (const name of ["roundStart", "roundNext", "roundStop", "roundConfig", "quick"]) assert.equal((await pollsDef.adminActions[name](c, { confirm: "on", question: "Q", choices: "A\nB", a: "a", b: "b" })).error, pollsFr.errRight, name);
  assert.equal(c.api.store.writes.length, before);
  const ro = (await pollsDef.adminPanel(c, { query: {} })).filter((x) => x.tab === "screen");
  assert.ok(!ro.some((x) => x.type === "adminForm" && ["roundStart", "roundConfig", "quick"].includes(x.action)), "pas de formulaire sans le droit");
});

test("administration en anglais, téléchargement des décisions (tableur sûr) et sauvegarde lisible", async () => {
  const { polls: c } = alone({ locale: "en" });
  const b = (await pollsDef.adminPanel(c, { query: {} })).filter((x) => x.tab === "screen");
  for (const word of [pollsEn.roundsTitle, pollsEn.roundsStart, pollsEn.quickTitle]) assert.ok(flat(b).includes(word.replace(/"/g, '\\"')), word);
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c1"], 1, T0 + 1000);
  await c.api.store.update(r1.id, { ...(await c.api.store.get(r1.id)).data, question: "=SUM(A1)", choices: [{ id: "c1", text: "+cmd" }, { id: "c2", text: "B" }, { id: "c3", text: "C" }] });
  await pollsMod.nextRound(c, T0 + MIN);
  let csv = ""; for await (const part of pollsDef.adminDownloads.rounds.generate(c)) csv += part;
  assert.ok(csv.includes("'=SUM(A1)") && csv.includes("'+cmd: 1"), "formules neutralisées en début de cellule");
  assert.equal(pollsDef.adminDownloads.rounds.right, "manage");
  const files = await pollsDef.backup.readable(c);
  assert.deepEqual(files.map((f) => f.path).sort(), ["decisions.csv", "polls.csv"]);
  assert.ok(files.find((f) => f.path === "decisions.csv").content.includes("round"));
});

/* ───────────── Outils pour l'assistant ───────────── */

test("outils de l'assistant : état des manches, historique, lancer/suivant/arrêter, sondage rapide ; erreurs lisibles ; lecture seule déclarée", async () => {
  const { polls: c } = alone();
  const manifest = pollsDef && (await import("node:fs")).readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8");
  const m = JSON.parse(manifest);
  const by = Object.fromEntries(m.mcp.map((a) => [a.name, a]));
  assert.ok(by.rounds_status.readOnly && by.rounds_history.readOnly && !by.round_control.readOnly && !by.poll_quick.readOnly);
  for (const n of ["round_control", "poll_quick"]) assert.ok(!by[n].default && !by[n].destructive, n);
  for (const a of m.mcp) { assert.equal(typeof pollsDef.mcp[a.name], "function", a.name); assert.ok(a.name.length <= 31); }
  let st = await pollsDef.mcp.rounds_status(c, {});
  assert.deepEqual([st.running, st.round, st.link], [false, null, "https://example.test/polls/now"]);
  assert.deepEqual(await pollsDef.mcp.round_control(c, { action: "start" }), { done: "start" });
  await assert.rejects(pollsDef.mcp.round_control(c, { action: "start" }), (e) => e.expose && /already/.test(e.message));
  await assert.rejects(pollsDef.mcp.round_control(c, { action: "dance" }), (e) => e.expose && /start, next or stop/.test(e.message));
  st = await pollsDef.mcp.rounds_status(c, {});
  assert.equal(st.running, true); assert.equal(st.round.number, 1); assert.equal(st.round.results.length, 3);
  await pollsDef.mcp.round_control(c, { action: "next" });
  const hist = await pollsDef.mcp.rounds_history(c, { limit: 5 });
  assert.equal(hist.length, 1); assert.equal(hist[0].winner, null); assert.equal(hist[0].round, 1);
  const q = await pollsDef.mcp.poll_quick(c, { choices: ["Pile", "Face"], seconds: 45 });
  assert.ok(q.id && q.link.endsWith("/polls/now"));
  await assert.rejects(pollsDef.mcp.poll_quick(c, { choices: ["Seul"] }), (e) => e.expose && /invalid/.test(e.message));
  await assert.rejects(pollsDef.mcp.poll_quick(c, { choices: ["A", "B"], seconds: 3 }), (e) => e.expose && /seconds/.test(e.message));
  await pollsDef.mcp.round_control(c, { action: "stop" });
  await assert.rejects(pollsDef.mcp.round_control(c, { action: "stop" }), (e) => e.expose && /no rounds/.test(e.message));
  const w = c.api.store.writes.length; await pollsDef.mcp.rounds_history(c, {});
  assert.equal(c.api.store.writes.length, w);
});

test("données d'avant la 1.1 : une configuration sans file d'attente de ménage ni date d'épinglage continue de fonctionner, sans migration", async () => {
  const { polls: c } = alone();
  await c.api.store.add("meta", { k: "cfg", obsKey: "ancienne-cle-secrete-0123456789", onAir: null }, { key: "cfg" });
  await pollsMod.startSeries(c, T0);
  const r1 = await current(c);
  await vote(c, r1.slug, ["c1"], 1, T0 + 1000);
  await pollsMod.nextRound(c, T0 + MIN);
  await pollsMod.sweep(c, T0 + 20 * MIN, { force: true });
  assert.equal((await c.api.store.list("meta")).filter((r) => r.data.k === "cfg").length, 1);
  assert.equal(await c.api.store.count(`b-${r1.id}`), 0);
  const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8"));
  assert.ok((manifest.dataVersion ?? 1) === 1, "aucune migration nécessaire");
});

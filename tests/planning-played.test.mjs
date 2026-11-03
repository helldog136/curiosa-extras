// Planning 2.7.0 + Suggestions de jeux 1.9.0 : « Ajouter les jeux joués à la liste ». Le jeu d'un stream COMMENCÉ (en cours ou passé) est ajouté en « Déjà joué » par le service `game.played` ;
// rien pour un stream à venir, annulé ou en journée entière ; jamais de doublon ; réglage coupé par défaut ; aucun minuteur. Le fournisseur est le vrai module (pas un double).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const rd = (m, l) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${l}`, import.meta.url), "utf8"));
const planning = await import("../modules/planning/index.mjs");
const Played = await import("../modules/planning/played.mjs");
const gs = await import("../modules/game-suggestions/index.mjs");
const def = planning.default;
const hours = (n) => new Date(Date.now() + n * 3_600_000);
const slot = (id, h, extra = {}) => ({ id, title: `Soirée ${id}`, start: hours(h).toISOString(), end: hours(h + 2).toISOString(), allDay: false, status: "confirmed", timezone: "UTC", games: [], ...extra });

// Le fournisseur : le vrai service du module, sur son propre stockage en mémoire.
let list, calls;
beforeEach(() => { Played.resetPlayed(); calls = []; list = fakeCtx({ key: "gs", basePath: "suggestions", messages: rd("game-suggestions", "locales/fr.json"), settings: {}, locale: "fr" }); });
const provider = () => ({ "game.played": { add: async (a) => { calls.push(a); return gs.default.services["game.played"].add(list, a); } } });
const mk = (items, settings = {}, over = {}) => fakeCtx({ key: "pl", settings: { days: 7, timezone: "UTC", ...settings }, topics: { "planning.slot": (q) => (typeof items === "function" ? items(q) : items) }, messages: rd("planning", "locales/fr.json"), locale: "fr", services: provider(), ...over });
const games = () => list.api.store.list("games", { limit: 100 });
const run = async (ctx) => { await def.page(ctx); await Played.playedSettled(); };

test("par défaut le réglage est coupé : rien n'est envoyé, aucun appel", async () => {
  const m = rd("planning", "module.json");
  assert.deepEqual([m.settings.find((s) => s.key === "addPlayedGames").default, m.settings.find((s) => s.key === "addPlayedGames").advanced], [false, undefined]);
  await run(mk([slot("a", -3, { games: ["Celeste"] })]));
  assert.deepEqual(calls, []); assert.equal((await games()).length, 0);
});

test("stream passé ou en cours : le jeu est ajouté en « Déjà joué », sans pseudo, sans jaquette cherchée ; stream à venir, annulé ou en journée entière : rien", async () => {
  const items = [slot("past", -30, { games: ["Celeste"] }), slot("live", -1, { games: ["Hollow Knight", "Céleste "] }), slot("next", 5, { games: ["Futur"] }), slot("off", -20, { games: ["Annulé"], status: "cancelled" }),
    { id: "d", title: "Férié", start: hours(-30).toISOString(), allDay: true, day: new Date(Date.now() - 30 * 3_600_000).toISOString().slice(0, 10), status: "confirmed", timezone: "UTC", games: ["Journée"] }];
  await run(mk(items, { addPlayedGames: true }));
  const rows = await games();
  assert.deepEqual(rows.map((r) => r.data.title).sort(), ["Celeste", "Hollow Knight"], "« Céleste » = « Celeste » : un seul");
  for (const r of rows) assert.deepEqual([r.data.status, r.data.origin, r.data.via, r.data.submitterName, r.data.coverUrl, r.data.replayVotes], ["already_played", "admin", "planning", null, null, 0]);
  assert.deepEqual(list.calls.rawg, [], "aucune recherche de jaquette ici : le rattrapage existant s'en charge");
});

test("idempotent : relancer ne duplique rien, ni côté Planning (mémoire) ni côté fournisseur (accents, casse, ponctuation) ; un jeu déjà présent n'est JAMAIS modifié", async () => {
  await list.api.store.add("games", { title: "Hollow Knight", status: "planned", coverUrl: null, origin: "visitor", submitterName: "Zoé", note: "à jouer", replayVotes: 0, lastVotedAt: null });
  await list.api.store.add("games", { title: "Rejeté: le jeu", status: "rejected", coverUrl: null, origin: "visitor", submitterName: null, note: null, replayVotes: 0, lastVotedAt: null });
  const items = [slot("a", -3, { games: ["HOLLOW  knight!", "Rejeté le jeu", "Nouveau Jeu"] })];
  const ctx = mk(items, { addPlayedGames: true });
  await run(ctx);
  let rows = await games();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => r.data.title === "Hollow Knight").map((r) => [r.data.status, r.data.submitterName, r.data.note]), [["planned", "Zoé", "à jouer"]], "intact");
  assert.equal(rows.find((r) => r.data.title === "Rejeté: le jeu").data.status, "rejected", "un jeu rejeté reste rejeté");
  const n = calls.length;
  await run(ctx); Played.resetPlayed(); await run(ctx);   // 10 minutes : aucun nouveau passage ; mémoire vidée : le fournisseur dit « existe déjà »
  rows = await games();
  assert.equal(rows.length, 3); assert.ok(calls.length >= n);
  const again = await gs.default.services["game.played"].add(list, { title: "nouveau jeu" });
  assert.deepEqual(again, { ok: true, added: false, status: "already_played" });
  const same = await Promise.all([1, 2, 3, 4].map(() => gs.default.services["game.played"].add(list, { title: "Concurrent" })));
  assert.equal(same.filter((r) => r.added).length, 1); assert.equal((await games()).filter((r) => r.data.title === "Concurrent").length, 1);
});

test("au plus un passage toutes les 10 minutes, 7 jours en arrière, 20 jeux au plus par passage, noms trop longs écartés, aucun minuteur", async () => {
  const asked = [];
  const many = Array.from({ length: 30 }, (_, i) => slot(`s${i}`, -2 - i, { games: [`Jeu numéro ${i}`] }));
  const ctx = mk((q) => { asked.push(q); return many; }, { addPlayedGames: true });
  await def.sections.next(ctx); await Played.playedSettled();
  assert.equal((await games()).length, 20);
  const wide = asked.find((q) => q.from && q.to && new Date(q.to) - new Date(q.from) > 6 * 86_400_000 && new Date(q.to) - new Date(q.from) < 8 * 86_400_000);
  assert.ok(wide, "lecture bornée à 7 jours, jusqu'à maintenant");
  assert.ok(new Date(wide.to).getTime() <= Date.now() + 1000, "jamais le futur");
  const k = asked.length; await def.sections.next(ctx); await Played.playedSettled();
  assert.equal(asked.length - k, 1, "un seul appel de plus (la page), pas un nouveau passage");
  assert.deepEqual(Played.playedGames([{ start: hours(-1), games: ["x".repeat(101), "   "], allDay: false }], Date.now()), []);
  const src = fs.readFileSync(new URL("../modules/planning/played.mjs", import.meta.url), "utf8");
  assert.ok(!/setInterval|\btasks\b|\bhooks\b/.test(src.replace(/\/\/.*$/gm, "")), "aucun minuteur");
});

test("Suggestions de jeux absent, muet ou en panne : rien ne casse, la page s'affiche, on réessaie plus tard", async () => {
  const items = [slot("a", -3, { games: ["Celeste"] })];
  for (const services of [{}, { "game.played": { add: async () => { throw new Error("panne"); } } }, { "game.played": { add: async () => new Promise(() => {}) } }]) {
    Played.resetPlayed();
    const ctx = mk(items, { addPlayedGames: true }, { services });
    const t0 = Date.now(); const page = await def.page(ctx);
    assert.ok(Date.now() - t0 < 3000 && page.blocks.length > 0);
  }
});

test("l'administration dit l'état de l'autre côté (installé, absent), seulement quand le réglage est oui", async () => {
  const items = [slot("a", 3, { games: ["Celeste"] })];
  const text = (b) => JSON.stringify(b);
  assert.ok(!/Jeux joués/.test(text(await def.adminPanel(mk(items)))));
  const ok = text(await def.adminPanel(mk(items, { addPlayedGames: true })));
  assert.match(ok, /Suggestions de jeux est installé/);
  const none = text(await def.adminPanel(mk(items, { addPlayedGames: true }, { services: {} })));
  assert.match(none, /n'est pas installé/); assert.match(none, /suggestInstall/);
});

test("fournisseur : refus d'un nom vide ou trop long, plafond de 2000, service déclaré dans le manifeste, FR/EN à parité", async () => {
  for (const title of ["", "   ", "x".repeat(101), null, {}]) assert.deepEqual(await gs.default.services["game.played"].add(list, { title }), { ok: false, error: "invalid" }, String(title));
  const m = rd("game-suggestions", "module.json");
  assert.deepEqual(m.offers.map((o) => [o.service, o.version]), [["game.played", 1]]);
  const p = rd("planning", "module.json");
  assert.deepEqual(p.requires.find((r) => r.service === "game.played").optional, true);
  assert.deepEqual(Object.keys(rd("planning", "locales/fr.json")).sort(), Object.keys(rd("planning", "locales/en.json")).sort());
  const full = fakeCtx({ key: "gf", messages: rd("game-suggestions", "locales/fr.json"), settings: {}, locale: "fr", rows: { games: Array.from({ length: 2000 }, (_, i) => ({ title: `Jeu ${i}`, status: "proposed" })) } });
  assert.deepEqual(await gs.default.services["game.played"].add(full, { title: "Trop" }), { ok: false, error: "full" });
  const s = p.settings.find((x) => x.key === "addPlayedGames");
  assert.ok(s.label.fr.length <= 60 && s.help.fr.length <= 60 && s.help.en.length <= 60 && !/[:：]\s*$/.test(s.label.fr));
});

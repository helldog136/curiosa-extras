// Streams saisis à la main : saisie, validation, répétition, créneaux du sujet `planning.slot`. Dates fixes (2026) : aucun test ne dépend de l'heure du jour.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const M = await import("../modules/calendar-manual/index.mjs");
const def = M.default;
const dir = new URL("../modules/calendar-manual/", import.meta.url);
const fr = JSON.parse(fs.readFileSync(new URL("locales/fr.json", dir), "utf8")), en = JSON.parse(fs.readFileSync(new URL("locales/en.json", dir), "utf8"));
const mk = (settings = {}) => fakeCtx({ key: "man1", settings: { timezone: "Europe/Paris", ...settings }, messages: fr, locale: "fr" });
const form = (o = {}) => ({ title: "Soirée", startDate: "2026-10-14", startTime: "21:00", endTime: "23:30", ...o });
const win = (a, b, extra = {}) => ({ from: new Date(a), to: new Date(b), limit: 200, ...extra });
const slots = (ctx, o) => def.exports["planning.slot"](ctx, o);
const ALL = win("2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z");

test("saisie : titre, jour, heures, jeux → créneau du sujet (heure de Paris convertie en UTC, heure d'été comprise)", async () => {
  const ctx = mk();
  assert.deepEqual(await def.adminActions.save(ctx, form({ games: "Celeste, Hades" })), { ok: "Enregistré.", redirect: "?" });
  const [item] = await slots(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  const id = (await ctx.api.store.list("streams"))[0].id;
  assert.deepEqual(item, { id, title: "Soirée", start: "2026-10-14T19:00:00.000Z", end: "2026-10-14T21:30:00.000Z", allDay: false, status: "confirmed", timezone: "Europe/Paris", games: ["Celeste", "Hades"], text: "Celeste, Hades" });
  const winter = mk(); await def.adminActions.save(winter, form({ startDate: "2026-12-01" }));
  const [w] = await slots(winter, win("2026-11-30T00:00:00Z", "2026-12-02T00:00:00Z"));
  assert.equal(w.start, "2026-12-01T20:00:00.000Z");
  assert.deepEqual([w.games, "text" in w], [[], false], "sans jeu : une liste vide, pas de texte");
});

test("un stream sans heure de fin dure 2 h ; une fin « avant » le début veut dire le lendemain (soirée qui finit après minuit)", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ title: "Sans fin", endTime: "" }));
  await def.adminActions.save(ctx, form({ title: "Nuit", startDate: "2026-10-15", startTime: "22:00", endTime: "01:30" }));
  const [a, b] = await slots(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual([a.start, a.end], ["2026-10-14T19:00:00.000Z", "2026-10-14T21:00:00.000Z"]);
  assert.deepEqual([b.start, b.end], ["2026-10-15T20:00:00.000Z", "2026-10-15T23:30:00.000Z"], "01:30 le 16 octobre à Paris = 23:30 UTC le 15");
});

test("CRUD : modifier, supprimer, élément inconnu ; validation (titre, jour, heures, répétition) ; rien d'enregistré en cas d'erreur", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form());
  const id = (await ctx.api.store.list("streams"))[0].id;
  assert.equal((await def.adminActions.save(ctx, form({ id, title: "Renommé" }))).ok, "Enregistré.");
  assert.equal((await ctx.api.store.get(id)).data.title, "Renommé");
  assert.equal(await ctx.api.store.count("streams"), 1);
  assert.match((await def.adminActions.save(ctx, form({ id: "nope" }))).error, /n'existe plus/);
  for (const [bad, re] of [[{ title: " " }, /titre/], [{ startDate: "2026-02-30" }, /jour n'est pas valide/], [{ startTime: "25:00" }, /heure de début/], [{ startTime: "" }, /heure de début/], [{ endTime: "ab" }, /heure de fin/],
    [{ repeat: "weekly", repeatUntil: "2026-10-01" }, /fin de répétition/], [{ repeat: "weekly", skip: "bientôt" }, /dates à sauter/]]) {
    assert.match((await def.adminActions.save(ctx, form(bad))).error, re, JSON.stringify(bad));
  }
  assert.equal(await ctx.api.store.count("streams"), 1);
  assert.deepEqual(await def.adminActions.remove(ctx, { id }), { ok: "Stream supprimé." });
  assert.equal(await ctx.api.store.count("streams"), 0);
  assert.match((await def.adminActions.remove(ctx, { id })).error, /n'existe plus/);
});

test("limite de 500 streams : message clair, rien d'ajouté", async () => {
  const ctx = mk();
  ctx.api.store.count = async () => 500;
  assert.match((await def.adminActions.save(ctx, form())).error, /limite de 500/);
});

test("admin : liste + formulaire ; suppression avec confirmation « danger » ; modification préremplie ; sans stream : message", async () => {
  const ctx = mk();
  const empty = await def.adminPanel(ctx, { query: {} });
  assert.ok(empty.some((b) => b.type === "markdown" && /Aucun stream/.test(b.text)) && empty.some((b) => b.type === "adminForm" && b.action === "save"));
  assert.match(empty[0].text, /Europe\/Paris/, "le fuseau des heures est dit");
  await def.adminActions.save(ctx, form({ games: "Celeste", repeat: "weekly", repeatUntil: "2026-12-31", skip: "2026-10-21" }));
  const id = (await ctx.api.store.list("streams"))[0].id;
  const table = (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "table");
  assert.deepEqual(table.rowIds, [id]);
  const del = table.rowActions.find((a) => a.action === "remove");
  assert.ok(del.danger === true && /définitive/.test(del.confirm), "jamais destructif sans confirmation");
  assert.deepEqual(table.rows[0].slice(1), ["Soirée", "Celeste", "Chaque semaine, jusqu'au 2026-12-31", "Prévu"]);
  const edit = (await def.adminPanel(ctx, { query: { edit: id } }))[0];
  assert.equal(edit.type, "adminForm"); assert.equal(edit.cancelHref, "?");
  const v = Object.fromEntries(edit.fields.map((f) => [f.name, f.value]));
  assert.deepEqual([v.id, v.title, v.startTime, v.games, v.repeat, v.repeatUntil, v.skip], [id, "Soirée", "21:00", "Celeste", "weekly", "2026-12-31", "2026-10-21"]);
});

test("répétition chaque semaine : même jour, heure d'été respectée, plage respectée, dates sautées, jusqu'à une date", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ startDate: "2026-10-14", repeat: "weekly", skip: "2026-10-28, 2026-11-04" }));   // mercredi 14
  const all = await slots(ctx, ALL);
  assert.deepEqual(all.slice(0, 4).map((i) => i.start.slice(0, 10)), ["2026-10-14", "2026-10-21", "2026-11-11", "2026-11-18"], "les deux dates sautées n'y sont pas");
  assert.deepEqual(all.slice(0, 3).map((i) => i.start.slice(11, 16)), ["19:00", "19:00", "20:00"], "après la bascule du 25 octobre : toujours 21:00 à Paris");
  assert.equal(new Set(all.map((i) => i.id)).size, all.length, "un identifiant par occurrence");
  assert.deepEqual((await slots(ctx, win("2026-10-20T00:00:00Z", "2026-10-22T00:00:00Z"))).map((i) => i.start.slice(0, 10)), ["2026-10-21"]);
  const until = mk(); await def.adminActions.save(until, form({ startDate: "2026-10-12", repeat: "weekly", repeatUntil: "2026-10-27" }));
  assert.deepEqual((await slots(until, ALL)).map((i) => i.start.slice(0, 10)), ["2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.ok((await slots(ctx, { limit: 2 })).length <= 2, "limite respectée");
});

test("une répétition très ancienne ne déborde pas de la plage demandée", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ startDate: "2020-01-01", repeat: "weekly" }));
  const items = await slots(ctx, win("2026-10-12T00:00:00Z", "2026-10-26T00:00:00Z"));
  assert.deepEqual(items.map((i) => i.start.slice(0, 10)), ["2026-10-14", "2026-10-21"]);
});

test("annulé et journée entière : status « cancelled » renvoyé (le lecteur décide) ; `day` donne la date, la fin est minuit le lendemain", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ cancelled: "yes" }));
  await def.adminActions.save(ctx, { title: "Journée", startDate: "2026-10-16", allDay: "yes" });
  const items = await slots(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual(items.map((i) => [i.title, i.status, i.allDay]), [["Soirée", "cancelled", false], ["Journée", "confirmed", true]]);
  const day = items[1];
  assert.equal(day.day, "2026-10-16");
  assert.deepEqual([day.start, day.end], ["2026-10-15T22:00:00.000Z", "2026-10-16T22:00:00.000Z"], "minuit à minuit à Paris");
});

test("plage, limite ; conforme au schéma que déclare le Planning ; fuseau absurde → fuseau par défaut", async () => {
  const ctx = mk();
  for (const d of ["2026-10-14", "2026-10-15", "2026-10-16"]) await def.adminActions.save(ctx, form({ startDate: d }));
  assert.equal((await slots(ctx, win("2026-10-15T00:00:00Z", "2026-10-15T23:00:00Z"))).length, 1);
  assert.equal((await slots(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { limit: 2 }))).length, 2);
  const { conform } = await import("@/core/services/topics");
  const schema = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8")).consumes.find((c) => c.topic === "planning.slot").schema;
  for (const s of await slots(ctx, ALL)) assert.ok(conform(s, schema), JSON.stringify(s));
  const bad = mk({ timezone: "Mars/Olympe" }); await def.adminActions.save(bad, form());
  assert.equal((await slots(bad, ALL))[0].timezone, "Europe/Paris");
});

test("i18n et manifeste : fr/en alignés, aucune clé manquante, aucun service, sujet fourni, stockage déclaré", async () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const code = fs.readFileSync(new URL("index.mjs", dir), "utf8") + fs.readFileSync(new URL("schedule.mjs", dir), "utf8");
  for (const m of code.matchAll(/\bt\(\s*"([A-Za-z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  const sched = fs.readFileSync(new URL("schedule.mjs", dir), "utf8");
  for (const m of sched.matchAll(/error: "(err[A-Za-z]+)"/g)) assert.ok(m[1] in fr && m[1] in en, m[1]);
  const { parseManifest } = await import("@/core/modules/manifest");
  const raw = JSON.parse(fs.readFileSync(new URL("module.json", dir), "utf8"));
  assert.ok(parseManifest(raw).ok);
  assert.deepEqual([raw.version, raw.minCore, raw.instances], ["1.0.1", "0.2.2", "multiple"]);
  assert.equal(raw.offers, undefined, "aucun service : deux modules d'agenda n'offrent jamais le même"); assert.deepEqual(raw.provides.map((p) => p.topic), ["planning.slot"]);
  assert.ok(raw.permissions.includes("storage"));
  const declared = new Set(raw.settings.map((s) => s.key));
  for (const m of code.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
});

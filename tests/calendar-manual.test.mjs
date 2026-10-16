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
const events = (ctx, o) => def.exports["calendar.event"](ctx, o);

test("saisie : titre, début, fin → évènement du sujet (heure de Paris convertie en UTC, heure d'été comprise)", async () => {
  const ctx = mk();
  assert.deepEqual(await def.adminActions.save(ctx, form({ description: "Jeu : Celeste", location: "Chez moi", url: "https://exemple.test/live", category: "Celeste" })), { ok: "Enregistré.", redirect: "?" });
  const [item] = await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  const id = (await ctx.api.store.list("events"))[0].id;
  assert.deepEqual(item, { id, title: "Soirée", start: "2026-10-14T19:00:00.000Z", end: "2026-10-14T21:30:00.000Z", allDay: false, status: "confirmed", description: "Jeu : Celeste", location: "Chez moi", url: "https://exemple.test/live", category: "Celeste" });
  const winter = mk(); await def.adminActions.save(winter, form({ startDate: "2026-12-01" }));
  assert.equal((await events(winter, win("2026-11-30T00:00:00Z", "2026-12-02T00:00:00Z")))[0].start, "2026-12-01T20:00:00.000Z");
});

test("CRUD : modifier, supprimer, élément inconnu ; validation (titre, dates, heures, lien, fin avant début)", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form());
  const id = (await ctx.api.store.list("events"))[0].id;
  assert.equal((await def.adminActions.save(ctx, form({ id, title: "Renommé" }))).ok, "Enregistré.");
  assert.equal((await ctx.api.store.get(id)).data.title, "Renommé");
  assert.equal((await ctx.api.store.count("events")), 1);
  assert.match((await def.adminActions.save(ctx, form({ id: "nope" }))).error, /n'existe plus/);
  for (const [bad, re] of [[{ title: " " }, /titre/], [{ startDate: "2026-02-30" }, /date de début/], [{ startTime: "25:00" }, /heure de début/], [{ endTime: "20:00" }, /fin doit venir/], [{ endTime: "ab" }, /heure de fin/], [{ url: "javascript:alert(1)" }, /http/], [{ endDate: "2026-10-13", endTime: "10:00" }, /fin doit venir/]]) {
    assert.match((await def.adminActions.save(ctx, form(bad))).error, re, JSON.stringify(bad));
  }
  assert.equal(await ctx.api.store.count("events"), 1, "rien d'enregistré en cas d'erreur");
  assert.deepEqual(await def.adminActions.remove(ctx, { id }), { ok: "Évènement supprimé." });
  assert.equal(await ctx.api.store.count("events"), 0);
  assert.match((await def.adminActions.remove(ctx, { id })).error, /n'existe plus/);
});

test("admin : liste + formulaire ; suppression avec confirmation et bouton « danger » ; modification préremplie ; sans évènement : message", async () => {
  const ctx = mk();
  const empty = await def.adminPanel(ctx, { query: {} });
  assert.ok(empty.some((b) => b.type === "markdown" && /Aucun évènement/.test(b.text)) && empty.some((b) => b.type === "adminForm" && b.action === "save"));
  await def.adminActions.save(ctx, form({ repeat: "weekly", repeatDays: "lun, mer", repeatCount: "4" }));
  const id = (await ctx.api.store.list("events"))[0].id;
  const panel = await def.adminPanel(ctx, { query: {} });
  const table = panel.find((b) => b.type === "table");
  assert.deepEqual(table.rowIds, [id]);
  const del = table.rowActions.find((a) => a.action === "remove");
  assert.ok(del.danger === true && /définitive/.test(del.confirm), "jamais destructif sans confirmation");
  assert.match(table.rows[0][2], /Chaque semaine \(lun, mer\)/);
  const edit = (await def.adminPanel(ctx, { query: { edit: id } }))[0];
  assert.equal(edit.type, "adminForm"); assert.equal(edit.cancelHref, "?");
  const v = Object.fromEntries(edit.fields.map((f) => [f.name, f.value]));
  assert.deepEqual([v.id, v.title, v.startTime, v.repeat, v.repeatDays, v.repeatCount], [id, "Soirée", "21:00", "weekly", "lun, mer", "4"]);
});

test("répétition hebdomadaire : jours choisis, nombre de fois, jusqu'à une date, heure d'été respectée, plage respectée", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ startDate: "2026-10-12", repeat: "weekly", repeatDays: "lun, mer", repeatCount: "5" }));   // lundi 12
  const all = await events(ctx, win("2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"));
  assert.deepEqual(all.map((i) => i.start.slice(0, 10)), ["2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26"]);
  assert.deepEqual(all.map((i) => i.start.slice(11, 16)), ["19:00", "19:00", "19:00", "19:00", "20:00"], "après la bascule du 25 octobre : toujours 21:00 à Paris");
  assert.equal(new Set(all.map((i) => i.id)).size, 5, "un identifiant par occurrence");
  assert.deepEqual((await events(ctx, win("2026-10-19T00:00:00Z", "2026-10-21T23:59:00Z"))).map((i) => i.start.slice(0, 10)), ["2026-10-19", "2026-10-21"]);
  const until = mk(); await def.adminActions.save(until, form({ startDate: "2026-10-12", repeat: "weekly", repeatUntil: "2026-10-27" }));   // sans jours : le jour de la date de début (lundi)
  assert.deepEqual((await events(until, win("2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"))).map((i) => i.start.slice(0, 10)), ["2026-10-12", "2026-10-19", "2026-10-26"]);
  const forever = mk(); await def.adminActions.save(forever, form({ startDate: "2026-10-12", repeat: "weekly" }));
  assert.equal((await events(forever, win("2026-10-01T00:00:00Z", "2026-10-31T00:00:00Z"))).length, 3, "sans fin : bornée par la plage demandée");
  assert.equal((await events(forever, { limit: 2 })).length <= 2, true);
  assert.match((await def.adminActions.save(mk(), form({ repeat: "weekly", repeatDays: "blabla" }))).error, /Jours non reconnus/);
  assert.match((await def.adminActions.save(mk(), form({ repeat: "weekly", repeatCount: "0" }))).error, /entre 1 et 520/);
  assert.match((await def.adminActions.save(mk(), form({ repeat: "weekly", repeatUntil: "2026-10-01" }))).error, /précède/);
});

test("annulé et journée entière : status « cancelled » renvoyé (le consommateur décide) ; dates, fin EXCLUE, plusieurs jours", async () => {
  const ctx = mk();
  await def.adminActions.save(ctx, form({ cancelled: "yes" }));
  await def.adminActions.save(ctx, { title: "Convention", startDate: "2026-10-16", endDate: "2026-10-18", allDay: "yes" });
  await def.adminActions.save(ctx, { title: "Un jour", startDate: "2026-10-20", allDay: "yes" });
  const items = await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual(items.map((i) => [i.title, i.status, i.allDay, i.start.slice(0, 10), i.end?.slice(0, 10)]), [
    ["Soirée", "cancelled", false, "2026-10-14", "2026-10-14"], ["Convention", "confirmed", true, "2026-10-16", "2026-10-19"], ["Un jour", "confirmed", true, "2026-10-20", "2026-10-21"]]);
  assert.equal(items[1].start, "2026-10-16", "une date, pas un instant");
});

test("plage, limite, étiquettes, étiquette et couleur de la source ; conforme au schéma du Planning", async () => {
  const ctx = mk({ label: "Soirées spéciales", color: "#aa00cc", tags: "streams" });
  for (const d of ["2026-10-14", "2026-10-15", "2026-10-16"]) await def.adminActions.save(ctx, form({ startDate: d }));
  assert.equal((await events(ctx, win("2026-10-15T00:00:00Z", "2026-10-15T23:00:00Z"))).length, 1);
  assert.equal((await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { limit: 2 }))).length, 2);
  assert.equal((await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { tags: ["autre"] }))).length, 0);
  assert.equal((await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { tags: ["Streams"] }))).length, 3);
  const [a] = await events(ctx, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.equal(a.sourceLabel, "Soirées spéciales"); assert.equal(a.color, "#aa00cc");
  const { conform } = await import("@/core/services/topics");
  const schema = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8")).consumes.find((c) => c.topic === "calendar.event").schema;
  assert.ok(conform(a, schema));
  assert.deepEqual(await def.services["calendar.provider"].describe(ctx), { kind: "manual", label: "Soirées spéciales", color: "#aa00cc", active: true, state: "ok" });
  assert.equal((await events(mk({ color: "rouge; x" }), win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"))).every((i) => !("color" in i)), true);
});

test("i18n et manifeste : fr/en alignés, aucune clé manquante, service each, sujet fourni, stockage déclaré", async () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const code = fs.readFileSync(new URL("index.mjs", dir), "utf8") + fs.readFileSync(new URL("schedule.mjs", dir), "utf8");
  for (const m of code.matchAll(/\bt\(\s*"([A-Za-z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  const sched = fs.readFileSync(new URL("schedule.mjs", dir), "utf8");
  for (const m of sched.matchAll(/error: "(err[A-Za-z]+)"/g)) assert.ok(m[1] in fr && m[1] in en, m[1]);
  const { parseManifest } = await import("@/core/modules/manifest");
  const raw = JSON.parse(fs.readFileSync(new URL("module.json", dir), "utf8"));
  assert.ok(parseManifest(raw).ok);
  assert.deepEqual([raw.version, raw.minCore, raw.instances], ["1.0.0", "0.1.16", "multiple"]);
  assert.equal(raw.offers[0].each, true); assert.ok(raw.permissions.includes("storage"));
  const declared = new Set(raw.settings.map((s) => s.key));
  for (const m of code.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
});

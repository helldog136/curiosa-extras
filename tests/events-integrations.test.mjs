// Événements : ce que le module OFFRE aux autres — la liste des événements à venir (service `event.source`, lue par la Story d'annonce) et les lieux (sujet `map.place`).
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent, manifest } from "./helpers/eventsKit.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const upcoming = (ctx, args) => def.services["event.source"].upcoming(ctx, args);
const SOON = Date.parse("2031-01-01T00:00:00Z");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

test("event.source : le contrat exact (ok, source, state, événements avec identifiant stable, début en UTC, fuseau, type)", async () => {
  const ctx = ctxFor({}, { name: "Mes rendez-vous" });
  const id = await addEvent(ctx, { title: "Soirée jeux", date: "2031-11-14", time: "21:00", endTime: "23:00", place: "Salle", image: "/uploads/a.png" });
  await addEvent(ctx, { title: "Toute la journée", date: "2031-11-20", time: "" });
  const r = await upcoming(ctx, { from: new Date(SOON).toISOString(), to: new Date(SOON + 400 * 86400000).toISOString(), limit: 50, locale: "fr" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.source, { kind: "events", label: "Mes rendez-vous" });
  assert.equal(r.state, "ok");
  assert.equal(r.events.length, 2);
  const [a, b] = r.events;
  assert.equal(a.id, `events:${ctx.instance.key}:${id}`);
  assert.match(a.id, /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,99}$/);
  assert.deepEqual([a.title, a.start, a.end, a.timezone, a.type], ["Soirée jeux", "2031-11-14T20:00:00.000Z", "2031-11-14T22:00:00.000Z", "Europe/Paris", "event"]);
  assert.equal(a.url, `https://example.test/agenda/e/${(await ctx.api.store.get(id)).data.slug}`);
  assert.equal(a.image, "https://example.test/uploads/a.png");
  assert.match(a.start, ISO);
  assert.deepEqual([b.allDay, b.day], [true, "2031-11-20"]);
});

test("event.source : seuls les événements publiés, à venir et qui ont lieu sont proposés ; la période et la limite sont respectées", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Brouillon", date: "2031-05-01", status: "draft" });
  await addEvent(ctx, { title: "Annulé", date: "2031-05-02", state: "cancelled" });
  await addEvent(ctx, { title: "Reporté", date: "2031-05-03", state: "postponed" });
  await addEvent(ctx, { title: "Complet", date: "2031-05-04", state: "full" });
  await addEvent(ctx, { title: "Passé", date: "2020-05-05" });
  for (let i = 0; i < 7; i++) await addEvent(ctx, { title: `E${i}`, date: `2031-06-0${i + 1}` });
  const r = await upcoming(ctx, {});
  assert.deepEqual(r.events.map((e) => e.title), ["Complet", "E0", "E1", "E2", "E3", "E4", "E5", "E6"]);
  assert.equal((await upcoming(ctx, { limit: 3 })).events.length, 3);
  assert.equal((await upcoming(ctx, { limit: 1e9 })).events.length, 8);
  const win = await upcoming(ctx, { from: "2031-06-03T00:00:00Z", to: "2031-06-05T23:59:59Z" });
  assert.deepEqual(win.events.map((e) => e.title), ["E2", "E3", "E4"]);
});

test("event.source : répond sans exception à n'importe quel argument", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Un", date: "2031-05-01" });
  for (const args of [undefined, null, {}, { limit: -4 }, { limit: "beaucoup" }, { limit: 1e9 }, "texte", 42, [], { from: "pas une date", to: {} }, { from: new Date(NaN) }]) {
    const r = await upcoming(ctx, args);
    assert.equal(r.ok, true, JSON.stringify(args));
    assert.match(r.source.kind, /^[a-z][a-z0-9-]{0,19}$/); assert.ok(r.source.label.length >= 1 && r.source.label.length <= 40);
    assert.ok(["ok", "setup", "down"].includes(r.state)); assert.ok(Array.isArray(r.events) && r.events.length <= 100);
  }
  const broken = ctxFor();
  broken.api.store.page = async () => { throw new Error("base en panne"); };
  const r = await upcoming(broken, {});
  assert.deepEqual([r.ok, r.state, r.events], [true, "down", []]);
});

test("event.source : deux agendas (public et formations) répondent chacun pour eux-mêmes", async () => {
  const pub = ctxFor({}, { name: "Agenda public" });
  const training = ctxFor({}, { name: "Formations" });
  await addEvent(pub, { title: "Portes ouvertes", date: "2031-05-01" });
  await addEvent(training, { title: "Initiation", date: "2031-05-02" });
  const [a, b] = [await upcoming(pub, {}), await upcoming(training, {})];
  assert.deepEqual([a.source.label, a.events.map((e) => e.title)], ["Agenda public", ["Portes ouvertes"]]);
  assert.deepEqual([b.source.label, b.events.map((e) => e.title)], ["Formations", ["Initiation"]]);
  assert.notEqual(a.events[0].id.split(":")[1], b.events[0].id.split(":")[1]);
});

test("Story d'annonce : les événements publiés apparaissent dans « Pour quoi veux-tu une story ? » (lecture réelle par loadEvents)", async () => {
  const { loadEvents, resetEvents } = await import("../modules/stream-story/sources.mjs");
  const E = await import("../modules/stream-story/events.mjs");
  resetEvents();
  const provider = ctxFor({}, { name: "Agenda" });
  await addEvent(provider, { title: "Atelier ouvert à tous", date: "2031-03-15", time: "14:00", place: "Salle", image: "/uploads/a.png" });
  await addEvent(provider, { title: "Brouillon", date: "2031-03-16", status: "draft" });
  await addEvent(provider, { title: "Annulé", date: "2031-03-17", state: "cancelled" });
  const story = fakeCtx({ key: "story1", moduleId: "stream-story", locale: "fr", defaultLocale: "fr", locales: ["fr"], messages: {}, services: { "event.source": { upcoming: (args) => upcoming(provider, args) } }, serviceInstances: { "event.source": [{ instance: "agenda", name: "Agenda", methods: { upcoming: (args) => upcoming(provider, args) } }] } });
  const r = await loadEvents(story, { zone: "Europe/Paris", now: Date.parse("2031-03-01T12:00:00Z") });
  const mine = r.events.filter((e) => e.source === "events");
  assert.deepEqual(mine.map((e) => e.title), ["Atelier ouvert à tous"]);
  assert.equal(mine[0].timezone, "Europe/Paris");
  assert.equal(mine[0].start, "2031-03-15T13:00:00.000Z");
  assert.equal(mine[0].type, "event");
  assert.match(mine[0].url, /^https:\/\/example\.test\/agenda\/e\//);
  assert.equal(mine[0].image, "https://example.test/uploads/a.png");
  const src = r.sources.find((s) => s.kind === "events");
  assert.deepEqual([src.label, src.state, src.count], ["Agenda", "ok", 1]);
  const raw = E.readAnswer(await upcoming(provider, {}), { kind: "other", label: "x" });
  assert.deepEqual([raw.kind, raw.state, raw.events.length], ["events", "ok", 1]);
  resetEvents();
});

test("map.place : un lieu par événement publié, à venir, avec coordonnées ; format du contrat", async () => {
  const ctx = ctxFor();
  const id = await addEvent(ctx, { title: "Marché", date: "2031-05-01", time: "10:00", place: "Place centrale", lat: 50.8466, lng: 4.3528 });
  await addEvent(ctx, { title: "Sans coordonnées", date: "2031-05-02" });
  await addEvent(ctx, { title: "Brouillon", date: "2031-05-03", lat: 1, lng: 2, status: "draft" });
  await addEvent(ctx, { title: "Passé", date: "2020-05-03", lat: 1, lng: 2 });
  await addEvent(ctx, { title: "Annulé", date: "2031-05-04", lat: 1, lng: 2, state: "cancelled" });
  const places = await def.exports["map.place"](ctx, { locale: "fr", limit: 50 });
  assert.equal(places.length, 1);
  const [p] = places;
  assert.equal(p.id, `events:${ctx.instance.key}:${id}`);
  assert.deepEqual([p.title, p.lat, p.lng, p.kind, p.at, p.note], ["Marché", 50.8466, 4.3528, "event", "2031-05-01T08:00:00.000Z", "Place centrale"]);
  assert.match(p.url, /^\/agenda\/e\//);
  assert.deepEqual((await def.exports["map.place"](ctxFor(), {})), []);
  for (let i = 0; i < 260; i++) await addEvent(ctx, { title: `L${i}`, date: "2032-01-01", lat: 10, lng: 10 });
  assert.equal((await def.exports["map.place"](ctx, { limit: 1e9 })).length, 200);
  assert.equal((await def.exports["map.place"](ctx, {})).length, 50);
  assert.ok(manifest.provides.some((p2) => p2.topic === "map.place"));
});

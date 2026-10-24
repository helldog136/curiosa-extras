// Événements : ce que l'assistant IA peut faire — lister, créer un BROUILLON, modifier. Jamais publier ni supprimer.
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent, addType, rows, manifest } from "./helpers/eventsKit.mjs";
import { validateArgs } from "@/core/services/mcp/validate";

const call = (ctx, name, args) => { const spec = manifest.mcp.find((a) => a.name === name); validateArgs(spec.input, args ?? {}); return def.mcp[name](ctx, args ?? {}); };

test("créer : toujours un brouillon, marqué « préparé par l'assistant », avec tous les champs vérifiés comme le formulaire", async () => {
  const ctx = ctxFor();
  await addType(ctx);
  const r = await call(ctx, "agenda_create_event", { title: "Atelier IA", date: "2031-03-15", time: "14:00", type: "Atelier", place: "Salle", latitude: "50.8466", longitude: "4.3528", text: "Un texte.", program: ["14:00 Accueil", "15:00 Atelier | détail"], speakers: ["Camille | Illustratrice"], seats_left: 5, seats_total: 20, signup_url: "https://example.org/i" });
  assert.equal(r.ok, true);
  assert.match(r.note, /DRAFT/);
  const [ev] = rows(ctx, "ev_events");
  assert.deepEqual([ev.status, ev.by, ev.type, ev.seatsLeft, ev.program.length, ev.lat], ["draft", "assistant", "atelier", 5, 2, 50.8466]);
  assert.equal(r.event.status, "draft"); assert.equal(r.event.page, null);
  assert.equal(r.event.program[1], "15:00 Atelier | détail");
  await assert.rejects(() => call(ctx, "agenda_create_event", { title: "Mal", date: "pas une date" }), (e) => e.expose === true && /date: .*2026-11-14|date: .*14\/11\/2026/.test(e.message));
  await assert.rejects(() => call(ctx, "agenda_create_event", { title: "Mal", date: "2031-03-15", type: "inconnu" }), (e) => e.expose === true && /type:/.test(e.message));
  assert.equal(rows(ctx, "ev_events").length, 1);
});

test("créer avec répétition : une série de brouillons, bornée à 100", async () => {
  const ctx = ctxFor();
  const r = await call(ctx, "agenda_create_event", { title: "Chaque semaine", date: "2031-03-15", repeat_every: "week", repeat_count: 4 });
  assert.deepEqual(r.series, { created: 4 });
  assert.equal(rows(ctx, "ev_events").length, 4);
  assert.ok(rows(ctx, "ev_events").every((e) => e.status === "draft"));
  assert.equal((await call(ctxFor(), "agenda_create_event", { title: "x", date: "2031-03-15", repeat_every: "week", repeat_count: 100 })).series.created, 100);
  await assert.rejects(async () => call(ctxFor(), "agenda_create_event", { title: "x", date: "2031-03-15", repeat_every: "week", repeat_count: 101 }), /maximum|must be/i);
});

test("modifier : seuls les champs donnés changent ; la publication n'est jamais touchée ; un identifiant inconnu est dit", async () => {
  const ctx = ctxFor();
  const id = await addEvent(ctx, { title: "Soirée", status: "published", place: "Salle A", text: "Ancien texte" });
  const r = await call(ctx, "agenda_update_event", { id, place: "Salle B", state: "full" });
  assert.equal(r.ok, true); assert.match(r.note, /Publication is unchanged/);
  const ev = rows(ctx, "ev_events")[0];
  assert.deepEqual([ev.status, ev.place, ev.text, ev.state, ev.by], ["published", "Salle B", "Ancien texte", "full", "admin"]);
  await assert.rejects(() => call(ctx, "agenda_update_event", { id: "nope", place: "x" }), (e) => e.expose && /No such event/.test(e.message));
  await assert.rejects(() => call(ctx, "agenda_update_event", { id, date: "bof" }), (e) => e.expose && /date:/.test(e.message));
  await assert.rejects(async () => call(ctx, "agenda_update_event", { id, status: "published" }), /unexpected argument/);
  assert.equal((await call(ctx, "agenda_update_event", { id, program: [] })).event.program.length, 0);
});

test("lister : par défaut les prochains, pages par curseur, filtres, jamais le texte sans « full »", async () => {
  const ctx = ctxFor();
  await addType(ctx);
  for (let i = 0; i < 7; i++) await addEvent(ctx, { title: `Futur ${i}`, date: `2031-04-0${i + 1}`, type: i % 2 ? "atelier" : "", text: "secret du texte" });
  await addEvent(ctx, { title: "Ancien", date: "2020-01-01" });
  await addEvent(ctx, { title: "Brouillon", date: "2031-05-01", status: "draft" });
  const p1 = await call(ctx, "agenda_list_events", { limit: 3 });
  assert.deepEqual(p1.items.map((e) => e.title), ["Futur 0", "Futur 1", "Futur 2"]);
  assert.ok(p1.next); assert.equal(p1.total, 8);
  assert.ok(!("text" in p1.items[0]));
  const p2 = await call(ctx, "agenda_list_events", { limit: 3, cursor: p1.next });
  assert.deepEqual(p2.items.map((e) => e.title), ["Futur 3", "Futur 4", "Futur 5"]);
  const p3 = await call(ctx, "agenda_list_events", { limit: 3, cursor: p2.next });
  assert.deepEqual(p3.items.map((e) => e.title), ["Futur 6", "Brouillon"]);
  assert.equal(p3.next, null);
  assert.deepEqual((await call(ctx, "agenda_list_events", { when: "past" })).items.map((e) => e.title), ["Ancien"]);
  assert.equal((await call(ctx, "agenda_list_events", { when: "all", status: "draft" })).items.length, 1);
  assert.equal((await call(ctx, "agenda_list_events", { type: "atelier" })).items.length, 3);
  assert.equal((await call(ctx, "agenda_list_events", { q: "futur 4" })).items.length, 1);
  assert.equal((await call(ctx, "agenda_list_events", { full: true, limit: 1 })).items[0].text, "secret du texte");
  assert.equal((await call(ctx, "agenda_list_events", { cursor: "!!pas un curseur!!" })).items.length, 8);
});

test("lire un événement, lire les types", async () => {
  const ctx = ctxFor();
  await addType(ctx, { key: "atelier", names: { fr: "Atelier", en: "Workshop" }, color: "teal", icon: "🛠️" });
  const id = await addEvent(ctx, { title: "Un", program: [{ time: "10:00", end: "", title: "Accueil", text: "" }] });
  const e = await call(ctx, "agenda_get_event", { id });
  assert.deepEqual([e.title, e.program], ["Un", ["10:00 Accueil"]]);
  await assert.rejects(() => call(ctx, "agenda_get_event", { id: "nope" }), (x) => x.expose);
  assert.deepEqual(await call(ctx, "agenda_list_types", {}), [{ id: "atelier", names: { fr: "Atelier", en: "Workshop" }, color: "teal", icon: "🛠️" }]);
});

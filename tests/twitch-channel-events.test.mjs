// Ma Chaîne Twitch 2.1 : le planning Twitch de la chaîne, donné aux modules qui annoncent des événements (service `event.source`, méthode `upcoming`).
// Le VRAI Connecteur Twitch branché sur le faux Twitch (tests/helpers/fakeTwitch.mjs) ; le contrat est vérifié avec le lecteur de Story d'annonce.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { connector, connectorModule } from "./helpers/twitchConnector.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifestJson = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const events = await import("../modules/twitch-channel/events.mjs");
const helix = await import("../modules/twitch-channel/helix.mjs");
const story = await import("../modules/stream-story/events.mjs");
const def = mod.default;
const upcoming = def.services["event.source"].upcoming;
const H = 3_600_000, DAY = 86_400_000;
const realFetch = globalThis.fetch;
let tw, C;
const seg = (id, hours, extra = {}) => ({ id, start_time: new Date(Date.now() + hours * H).toISOString(), end_time: new Date(Date.now() + (hours + 2) * H).toISOString(), title: `Rendez-vous ${id}`, canceled_until: null, category: { id: "1", name: "Hades" }, is_recurring: false, ...extra });
beforeEach(() => {
  mod.resetCache(); connectorModule.resetCache();
  tw = fakeTwitch({ streams: [], schedule: { segments: [seg("a1", 30), seg("a2", 5), seg("canceled", 8, { canceled_until: "2030-01-01T00:00:00Z" }), seg("past", -9), seg("far", 24 * 400), seg("untitled", 50, { title: "", category: null })] } });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  C = connector();
});
afterEach(() => { globalThis.fetch = realFetch; });
const ctx = (settings = {}, o = {}) => fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", ...settings }, services: { "twitch.api": C.methods }, ...o });

test("manifeste : le planning Twitch est offert comme source d'événements (chaque chaîne répond pour elle-même), parité fr/en, version mineure", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const offer = manifestJson.offers.find((o) => o.service === "event.source");
  assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["upcoming"]]);
  assert.equal(manifestJson.version, "2.2.0"); assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["events_untitled", "events_empty", "events_setup_channel", "events_setup_connector", "events_setup_refused", "events_setup_update"]) assert.ok(fr[k] && en[k], k);
  assert.deepEqual(manifestJson.requires.map((x) => [x.service, x.min, x.optional ?? false]), [["twitch.api", 3, false]], "pas de nouvelle dépendance");
});

test("le planning devient des événements du contrat commun : annulé, passé et trop lointain écartés, jeu repris, identifiant stable et sûr", async () => {
  const r = await upcoming(ctx(), { limit: 50 });
  assert.deepEqual([r.ok, r.state, r.source], [true, "ok", { kind: "twitch", label: "Twitch" }]);
  assert.equal(r.events.length, 3);
  assert.deepEqual(r.events.map((e) => e.title), ["Rendez-vous a2", "Rendez-vous a1", "Stream sur Twitch"], "triés, un titre vide devient une phrase");
  const cleaned = r.events.map((e) => story.cleanEvent(e, r.source));
  assert.ok(cleaned.every(Boolean), "chaque événement est accepté par le lecteur de Story");
  assert.deepEqual(cleaned[0].games, ["Hades"]); assert.equal(cleaned[0].url, "https://www.twitch.tv/machaine"); assert.equal(cleaned[0].type, "stream");
  assert.match(r.events[0].id, /^twitch:machaine:[a-z0-9]+$/); assert.ok(r.events[0].id.length <= 100);
  const again = await upcoming(ctx(), {});
  assert.deepEqual(again.events.map((e) => e.id), r.events.map((e) => e.id), "même rendez-vous, même identifiant");
  assert.equal(new Set(r.events.map((e) => e.id)).size, 3);
  assert.equal((await upcoming(ctx(), { limit: 1 })).events.length, 1, "la limite demandée est respectée");
  assert.ok((await upcoming(ctx(), { limit: 99999 })).events.length <= events.MAX_EVENTS);
});

test("vacances : les rendez-vous pendant les vacances annoncées ne sont pas proposés", () => {
  const now = Date.now();
  const data = { segments: [seg("v1", 10), seg("v2", 100)], vacation: { start_time: new Date(now + 5 * H).toISOString(), end_time: new Date(now + 50 * H).toISOString() } };
  assert.deepEqual(events.scheduleEvents(data, { channel: "machaine", now }).map((e) => e.title), ["Rendez-vous v2"]);
});

test("chaîne sans planning publié : « ok » avec zéro événement et une phrase qui dit quoi faire (pas une panne)", async () => {
  tw.state.schedule = null;
  const r = await upcoming(ctx(), {});
  assert.deepEqual([r.state, r.events, r.note], ["ok", [], fr.events_empty]);
});

test("à régler, dit en mots simples : pas de chaîne, pas de Connecteur, application pas réglée, connecteur trop ancien ; en FR et en EN", async () => {
  assert.equal((await upcoming(ctx({ channel: "" }), {})).message, fr.events_setup_channel);
  assert.equal((await upcoming(fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine" } }), {})).message, fr.events_setup_connector);
  const noApp = connector({ settings: {} });
  assert.equal((await upcoming(ctx({}, { services: { "twitch.api": noApp.methods } }), {})).message, fr.events_setup_connector);
  const old = { ...C.methods, request: async (a) => (a?.path === "schedule" ? { ok: false, error: "forbidden" } : C.methods.request(a)) };
  const r = await upcoming(ctx({}, { services: { "twitch.api": old } }), {});
  assert.deepEqual([r.state, r.message], ["setup", fr.events_setup_update]);
  assert.equal((await upcoming(ctx({ channel: "" }, { locale: "en", messages: en }), {})).message, en.events_setup_channel);
  assert.ok(fr.events_setup_update.length > 20 && !/\b(api|json|token|http)\b/i.test(Object.entries(fr).filter(([k]) => k.startsWith("events_")).map(([, v]) => v).join(" ")), "pas de jargon");
});

test("Twitch en panne : « down » sans rien inventer ; trop de demandes ; réseau coupé", async () => {
  tw.state.rateLimited = true;
  assert.deepEqual([(await upcoming(ctx(), {})).state, (await upcoming(ctx(), {})).events], ["down", []]);
  mod.resetCache(); connectorModule.resetCache(); tw.state.rateLimited = false; tw.state.down = true; C = connector();
  const r = await upcoming(ctx(), {});
  assert.deepEqual([r.state, r.events], ["down", []]);
  assert.ok(!JSON.stringify(r).includes("SEC-RET"), "jamais de secret");
});

test("un seul appel à Twitch pour plusieurs demandes (15 minutes de cache), deux demandes simultanées partagent le même appel", async () => {
  const c = ctx();
  await Promise.all([upcoming(c, {}), upcoming(c, {}), upcoming(c, {})]);
  await upcoming(c, {});
  assert.equal(tw.scheduleCalls, 1);
});

test("trou noir : Twitch qui ne répond jamais ne bloque pas la réponse, la demande suivante repart", async () => {
  const keep = setInterval(() => {}, 100), t0 = { ...helix.timing };
  helix.timing.sharedMs = 150;
  try {
    tw.state.silence = (url) => url.includes("/helix/schedule");
    const t = Date.now(), r = await upcoming(ctx(), {});
    assert.ok(Date.now() - t < 3000); assert.deepEqual([r.state, r.events], ["down", []]);
    tw.state.silence = false; mod.resetCache(); connectorModule.resetCache(); C = connector();   // après la panne : les mémoires de panne (20 s) et le disjoncteur du réseau sont neufs
    assert.equal((await upcoming(ctx(), {})).state, "ok", "la demande suivante repart de zéro");
  } finally { clearInterval(keep); Object.assign(helix.timing, t0); }
});

test("le Connecteur Twitch laisse passer le planning (public) et rien d'autre de nouveau ; la requête est vérifiée", async () => {
  const h = await import("../modules/twitch-connector/helix.mjs");
  const ok = h.check({ as: "app", method: "GET", path: "schedule", query: { broadcaster_id: ["777"], first: ["25"] } });
  assert.deepEqual([ok.as, ok.route], ["app", "GET schedule"]);
  for (const bad of [{ broadcaster_id: ["abc"] }, { broadcaster_id: ["1"], first: ["26"] }, { broadcaster_id: ["1"], first: ["0"] }, { broadcaster_id: ["1"], evil: ["x"] }, {}, { broadcaster_id: ["1", "2"], first: ["5"], after: ["bad cursor!"] }]) assert.ok(h.check({ as: "app", method: "GET", path: "schedule", query: bad }).error, JSON.stringify(bad));
  assert.equal(h.check({ as: "user", method: "GET", path: "schedule", query: { broadcaster_id: ["1"] } }).error, "forbidden", "pas de lecture de planning avec un compte connecté");
  assert.equal(h.check({ as: "app", method: "POST", path: "schedule", query: { broadcaster_id: ["1"] } }).error, "forbidden", "lecture seule");
});

// Home Assistant : ce qui va au journal du cœur (Historique) et l'adresse du site déclarée pour l'assistant de changement de domaine.
// Les actions de la page (bouton « Tout couper », dissocier, test) sont déjà notées par le cœur : le module n'écrit que ce que le cœur ne voit pas.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { FakeHaClient, directTransport } from "./helpers/fakeHaClient.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/home-assistant", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const def = (await import("../modules/home-assistant/index.mjs")).default;
const B = await import("../modules/home-assistant/bridge.mjs");
const L = await import("../modules/home-assistant/live.mjs");
const A = await import("../modules/home-assistant/admin.mjs");
const T0 = Date.parse("2026-10-14T20:00:00Z");
const defaults = Object.fromEntries(manifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
const bridge = () => def.services["home-assistant.bridge"];

function world() {
  B.resetMemory(); L.resetLive();
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  const ctx = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Home Assistant", basePath: "", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: fr,
    settings: { ...defaults }, permissions: manifest.permissions, siteUrl: "https://site.example.org", logEvents: manifest.logEvents,
    serviceInstances: { "twitch.live": [{ instance: "chan", methods: { status: () => ({ known: true, live: true }) } }] },
  });
  ctx.can = () => true;
  return { ctx, tick: (ms) => mock.timers.tick(ms) };
}
async function pairUp(w, bindings = {}) {
  const { code } = await B.createPairing(w.ctx);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx), bindings: { "lumieres:rouge": async () => {}, ...bindings } });
  assert.equal((await ha.pair(code, "Maison")).status, 200);
  await ha.pull(); w.tick(1100);
  return ha;
}
const lines = (w) => w.ctx.dumpLog();

test("le manifeste déclare ses événements et l'adresse du site, sans rien exiger de plus du cœur", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.minCore, "0.2.6", "le journal du cœur est facultatif : un cœur plus ancien l'ignore");
  assert.equal(manifest.returnAddresses, undefined, "aucun retour de connexion d'un service tiers : Home Assistant vient chercher, c'est lui qui connaît l'adresse");
  assert.equal(manifest.siteAddressUses.length, 1);
  const use = manifest.siteAddressUses[0];
  for (const l of ["fr", "en"]) { assert.ok(use.label[l]); assert.ok(use.where[l]); }
  assert.match(use.where.fr, /Appareils et services/);
  assert.ok(manifest.logEvents.length <= 30);
  assert.ok(Object.keys(fr).every((k) => k in en) && Object.keys(en).every((k) => k in fr), "FR et EN : mêmes clés");
});

test("association : Home Assistant associé, une ligne, aucun nom d'appareil ni code", async () => {
  const w = world();
  await pairUp(w);
  const l = lines(w).filter((x) => x.action === "device.paired");
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].data, { replaced: false });
  assert.doesNotMatch(JSON.stringify(lines(w)), /Maison/);
});

test("les mauvais codes annulent le code : une ligne d'avertissement, pas une par essai", async () => {
  const w = world();
  await B.createPairing(w.ctx);
  for (let i = 0; i < 5; i++) await B.redeemCode(w.ctx, { code: "AAAAAAAA", name: "x" }, { now: Date.now() });
  const l = lines(w);
  assert.equal(l.length, 1);
  assert.equal(l[0].action, "pairing.locked"); assert.equal(l[0].level, "warn");
});

test("« Tout couper » : noté seulement s'il vient d'une autre extension, jamais avec un pseudo", async () => {
  const w = world();
  await pairUp(w);
  await B.stop(w.ctx, { by: "admin" });          // la page : le cœur la note lui-même
  await B.start(w.ctx, { by: "admin" });
  await B.stop(w.ctx, { by: "mcp:assistant" });  // l'assistant : le cœur la note lui-même
  await B.start(w.ctx, { by: "owner" });
  assert.deepEqual(lines(w).filter((x) => x.action.startsWith("circuit.")).map((x) => x.action), ["circuit.resumed"]);
  await B.stop(w.ctx, { by: "mod:Sacha_Dupont" });
  const cut = lines(w).filter((x) => x.action === "circuit.cut");
  assert.equal(cut.length, 1); assert.equal(cut[0].level, "warn");
  await B.stop(w.ctx, { by: "mod:Sacha_Dupont" });   // déjà coupé : rien de plus
  assert.equal(lines(w).filter((x) => x.action === "circuit.cut").length, 1);
  assert.doesNotMatch(JSON.stringify(lines(w)), /Sacha/);
});

test("une action réussie ne va pas au journal du cœur ; un échec, une action non reliée ou un oubli, oui", async () => {
  const w = world();
  const ha = await pairUp(w, { "boom:x": async () => { throw new Error("secret"); } });
  const ok = await bridge().enqueue(w.ctx, { key: "lumieres:rouge", viewer: "Sacha", ref: "r1" });
  assert.ok(ok.ok);
  await ha.pull(); w.tick(1100);
  assert.deepEqual(lines(w).filter((x) => x.action.startsWith("action.")), [], "réussie ou seulement livrée : local");
  const id = (await bridge().enqueue(w.ctx, { key: "inconnue:x", viewer: "Sacha", ref: "r2" })).id;
  await B.ack(w.ctx, { id, status: "ignored", code: "unmapped" });
  const id2 = (await bridge().enqueue(w.ctx, { key: "boom:x", viewer: "Sacha", ref: "r3" })).id;
  await B.ack(w.ctx, { id: id2, status: "failed", code: "error" });
  const id3 = (await bridge().enqueue(w.ctx, { key: "lumieres:rouge", viewer: "Sacha", ref: "r4" })).id;
  w.tick(120_000);
  await B.pull(w.ctx, { cursor: 0, limit: 1 }, Date.now());   // l'expiration se constate à la lecture
  const got = lines(w).filter((x) => x.action.startsWith("action."));
  assert.ok(got.some((x) => x.action === "action.unlinked" && x.data.action === "inconnue:x" && x.level === "warn"));
  assert.ok(got.some((x) => x.action === "action.failed" && x.data.action === "boom:x" && x.level === "error"));
  assert.ok(got.some((x) => x.action === "action.expired" && x.data.action === "lumieres:rouge"));
  assert.doesNotMatch(JSON.stringify(lines(w)), /Sacha|secret/, "ni pseudo du public ni message d'erreur");
  void id3;
});

test("un test de la page n'écrit rien de plus au journal du cœur", async () => {
  const w = world();
  await pairUp(w);
  const before = lines(w).length;
  const r = await B.testSend(w.ctx, { key: "lumieres:rouge", by: "admin" });
  assert.ok(r.ok);
  w.tick(120_000);
  await B.pull(w.ctx, { cursor: 0, limit: 1 }, Date.now());
  assert.equal(lines(w).length, before);
});

test("Home Assistant ne répond plus : l'action refusée est notée, avec son nom seulement", async () => {
  const w = world();
  await pairUp(w);
  w.tick(120_000);
  const r = await bridge().enqueue(w.ctx, { key: "lumieres:rouge", viewer: "Sacha" });
  assert.equal(r.ok, false);
  const l = lines(w).filter((x) => x.action === "link.offline");
  assert.equal(l.length, 1); assert.deepEqual(l[0].data, { action: "lumieres:rouge" });
  assert.doesNotMatch(JSON.stringify(l), /Sacha/);
});

test("sans journal du cœur (cœur plus ancien) le module marche comme avant", async () => {
  const w = world();
  delete w.ctx.api.log;
  await pairUp(w);
  await B.stop(w.ctx, { by: "mod:x" });
  assert.equal((await B.status(w.ctx)).enabled, false);
});

test("la page relie l'ancien journal à l'Historique du cœur, dans les deux langues", async () => {
  const w = world();
  const blocks = await A.panel(w.ctx);
  const link = blocks.find((b) => b.type === "links" && b.items.some((i) => i.href === "?tab=history"));
  assert.ok(link);
  assert.ok(fr.jr_history && en.jr_history);
});

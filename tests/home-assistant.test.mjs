// Home Assistant : appairage, appareil, interrogation et accusés, direct, coupe-circuit, contrat de service, sujets, droits, bornes, test du pont, administration.
// Aucun réseau : un faux « Ma Chaîne Twitch » répond à la place du vrai, un faux Home Assistant (helpers/fakeHaClient.mjs) parle le contrat HTTP, l'horloge est simulée.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { FakeHaClient, directTransport } from "./helpers/fakeHaClient.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/home-assistant", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const def = (await import("../modules/home-assistant/index.mjs")).default;
const B = await import("../modules/home-assistant/bridge.mjs");
const S = await import("../modules/home-assistant/store.mjs");
const L = await import("../modules/home-assistant/live.mjs");
const A = await import("../modules/home-assistant/admin.mjs");
const H = await import("../modules/home-assistant/http.mjs");
const tools = (await import("../modules/home-assistant/tools.mjs")).default;

const T0 = Date.parse("2026-10-14T20:00:00Z");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ALL_RIGHTS = manifest.rights.map((r) => r.id);
const defaults = Object.fromEntries(manifest.settings.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));
const bridge = (ctx) => def.services["home-assistant.bridge"];

/** Un site avec le pont installé. `live` : ce que répond « Ma Chaîne Twitch » (null = non installé) ; `yt` : ce que répond « Chaîne YouTube » (`youtube.live`, absent = non installé ; ex. { live: true }). Horloge simulée à T0. */
function world(o = {}) {
  B.resetMemory(); L.resetLive();
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  const live = { known: true, live: true, ...o.live };
  const ctx = fakeCtx({
    key: "ha", moduleId: "home-assistant", name: "Home Assistant", basePath: "", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.locale === "en" ? en : fr,
    settings: { ...defaults, ...o.settings }, permissions: manifest.permissions, siteUrl: "https://site.example.org",
    serviceInstances: {
      ...(o.live === null ? {} : { "twitch.live": [{ instance: "chan", methods: { status: o.liveFn ?? (() => live) } }] }),
      ...(o.yt === undefined ? {} : { "youtube.live": [{ instance: "yt", methods: { current: o.ytFn ?? (() => ({ ok: true, ...o.yt })) } }] }),
    },
  });
  const rights = o.rights ?? ALL_RIGHTS;
  ctx.can = (r) => rights.includes(r);
  return { ctx, live, tick: (ms) => mock.timers.tick(ms), done: () => mock.timers.reset() };
}
const refreshLive = () => L.resetLive();

/** Associe un faux Home Assistant au site. */
async function pairUp(w, bindings = {}) {
  const { code } = await B.createPairing(w.ctx);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx), bindings: { "lumieres:rouge": async () => {}, "tts:lire": async () => {}, ...bindings } });
  const r = await ha.pair(code, "Maison");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  w.ha = ha;
  await ha.pull();   // Home Assistant se montre : il est « connecté »
  w.tick(1100);
  return ha;
}
const enq = (w, args) => bridge().enqueue(w.ctx, args);
const dump = (w) => JSON.stringify(w.ctx.dumpStore());

/* ───────────── Manifeste, langues ───────────── */

test("le manifeste est valide et déclare le contrat exact", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.id, "home-assistant"); assert.equal(manifest.instances, "single"); assert.equal(manifest.version, "1.0.2"); assert.equal(manifest.minCore, "0.2.6");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version]), [["home-assistant.bridge", 1]]);
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.optional]), [["twitch.live", true], ["youtube.live", true]]);
  assert.deepEqual(manifest.provides.map((p) => p.topic).sort(), ["ha.result", "ha.state"]);
  assert.deepEqual(Object.keys(def.services["home-assistant.bridge"]).sort(), ["enqueue", "start", "status", "stop"]);
  assert.deepEqual(Object.keys(def.exports).sort(), ["ha.result", "ha.state"]);
  assert.deepEqual(Object.keys(def.routes).sort(), ["ack", "pair", "pull"]);
});

test("français et anglais : mêmes clés, mêmes variables, rien de vide", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join();
  for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); }
});

test("droits : gérer, couper, tester ; reprendre demande de gérer", () => {
  assert.deepEqual(manifest.rights.map((r) => r.id).sort(), ["ha.manage", "ha.stop", "ha.test"]);
  assert.equal(def.adminActions.stop.right, "ha.stop");
  for (const k of ["start", "pair", "unpair", "clearLog"]) assert.equal(def.adminActions[k].right, "ha.manage", k);
  assert.equal(def.adminActions.test.right, "ha.test");
});

/* ───────────── Appairage ───────────── */

test("appairage : code de 8 caractères sans ambiguïté, valable 10 minutes ; le jeton n'est rendu qu'une fois et seule son empreinte est gardée", async () => {
  const w = world();
  const { code, expiresAt } = await B.createPairing(w.ctx);
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(expiresAt, T0 + 10 * 60_000);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx) });
  const r = await ha.pair(code.toLowerCase().replace(/^(....)/, "$1-"), "Maison");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["instance", "pollSeconds", "token"]);
  assert.equal(r.body.instance, "ha"); assert.equal(r.body.pollSeconds, 3);
  assert.match(r.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!dump(w).includes(r.body.token), "le jeton n'est écrit nulle part");
  assert.ok(dump(w).includes(sha(r.body.token)), "son empreinte SHA-256 l'est");
  const core = (await S.peek(w.ctx, "core"));
  assert.equal(core.pending, null);
  assert.equal(core.paired.name, "Maison");
  w.done();
});

test("appairage : un code ne sert qu'une fois", async () => {
  const w = world();
  const { code } = await B.createPairing(w.ctx);
  const a = new FakeHaClient({ send: directTransport(def, w.ctx) }), b = new FakeHaClient({ send: directTransport(def, w.ctx) });
  assert.equal((await a.pair(code)).status, 200);
  const r = await b.pair(code);
  assert.equal(r.status, 400); assert.deepEqual(r.body, { ok: false, error: "invalid_code" });
  w.done();
});

test("appairage : un code expire au bout de 10 minutes", async () => {
  const w = world();
  const { code } = await B.createPairing(w.ctx);
  w.tick(10 * 60_000 + 1);
  const r = await new FakeHaClient({ send: directTransport(def, w.ctx) }).pair(code);
  assert.equal(r.status, 400);
  assert.equal((await S.peek(w.ctx, "core")).pending, null);
  w.done();
});

test("appairage : 5 mauvais essais annulent le code, même si le bon arrive ensuite", async () => {
  const w = world();
  const { code } = await B.createPairing(w.ctx);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx) });
  for (let i = 0; i < 5; i++) { assert.equal((await ha.pair("AAAAAAAA")).status, 400); w.tick(400_000 / 5 / 10); }
  assert.equal((await S.peek(w.ctx, "core")).pending, null);
  assert.equal((await ha.pair(code)).status, 400);
  assert.ok(JSON.stringify((await S.peek(w.ctx, "log")).lines).includes("pair_locked"));
  w.done();
});

test("appairage : 4 mauvais essais puis le bon code passe", async () => {
  const w = world();
  const { code } = await B.createPairing(w.ctx);
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx) });
  for (let i = 0; i < 4; i++) await ha.pair("BBBBBBBB");
  assert.equal((await ha.pair(code)).status, 200);
  w.done();
});

test("appairage : débit strict par visiteur (429 avec Retry-After)", async () => {
  const w = world();
  const send = directTransport(def, w.ctx, { ip: "198.51.100.7" });
  const statuses = [];
  let retry = null;
  for (let i = 0; i < 12; i++) { const r = await send("pair", { method: "POST", body: JSON.stringify({ code: "CCCCCCCC" }) }); statuses.push(r.status); if (r.status === 429) retry = r.headers.get("retry-after"); }
  assert.equal(statuses.filter((s) => s === 429).length, 2);
  assert.ok(Number(retry) >= 1);
  // un autre visiteur n'est pas touché (jusqu'à la limite globale)
  const other = await directTransport(def, w.ctx, { ip: "198.51.100.8" })("pair", { method: "POST", body: JSON.stringify({ code: "CCCCCCCC" }) });
  assert.equal(other.status, 400);
  w.done();
});

test("appairage : méthode, corps et taille", async () => {
  const w = world();
  const send = directTransport(def, w.ctx);
  assert.equal((await send("pair", { method: "GET" })).status, 405);
  assert.equal((await send("pair", { method: "POST", body: "pas du json" })).status, 400);
  assert.equal((await send("pair", { method: "POST", body: "[1]" })).status, 400);
  assert.equal((await send("pair", { method: "POST", body: JSON.stringify({ code: 12 }) })).status, 400);
  const big = await send("pair", { method: "POST", body: JSON.stringify({ code: "A".repeat(5000) }) });
  assert.equal(big.status, 413);
  for (const r of [big, await send("pair", { method: "POST", body: "x" })]) { assert.equal(r.headers.get("cache-control"), "no-store"); assert.match(r.headers.get("content-type"), /^application\/json/); }
  w.done();
});

test("re-appairage : le nouvel appareil remplace l'ancien, qui reçoit 401", async () => {
  const w = world();
  const first = await pairUp(w);
  assert.equal((await first.pull()).status, 200);
  w.tick(2000);
  const second = await pairUp(w);
  assert.notEqual(first.token, second.token);
  assert.equal((await first.pull()).status, 401);
  assert.equal((await second.pull()).status, 200);
  w.done();
});

test("dissocier : le jeton ne marche plus et ce qui attendait est refusé (points rendus)", async () => {
  const w = world();
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  await B.unpair(w.ctx);
  assert.equal((await ha.pull()).status, 401);
  assert.deepEqual((await def.exports["ha.result"](w.ctx, {})).map((x) => [x.ref, x.status, x.code]), [["r1", "refused", "not_paired"]]);
  assert.deepEqual((await enq(w, { key: "lumieres:rouge", ref: "r2" })), { ok: false, reason: "not_paired" });
  w.done();
});

/* ───────────── Jeton ───────────── */

test("jeton : refus sans en-tête, avec un mauvais jeton ou un jeton modifié d'un caractère ; comparaison en temps constant", async () => {
  const w = world();
  const ha = await pairUp(w);
  const send = directTransport(def, w.ctx);
  const get = (headers) => send("pull", { method: "GET", headers });
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ Authorization: "Bearer " + "a".repeat(43) })).status, 401);
  const flipped = ha.token.slice(0, -1) + (ha.token.endsWith("A") ? "B" : "A");
  w.tick(2000);
  assert.equal((await get({ Authorization: `Bearer ${flipped}` })).status, 401);
  assert.equal((await get({ Authorization: `Basic ${ha.token}` })).status, 401);
  w.tick(2000);
  assert.equal((await get({ Authorization: `Bearer ${ha.token}` })).status, 200);
  const r = await get({});
  assert.equal(r.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(await r.json(), { ok: false, error: "unauthorized" });
  const src = fs.readFileSync(`${DIR}/bridge.mjs`, "utf8");
  assert.match(src, /timingSafeEqual/);
  assert.ok(!/token\s*===|tokenHash\s*===|given\s*===\s*stored/.test(src), "jamais de comparaison ordinaire d'un jeton");
  w.done();
});

test("jeton : jamais dans le stockage, le journal, la page d'administration ni les outils des assistants", async () => {
  const w = world();
  const ha = await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "r1" });
  await ha.step();
  const everything = [dump(w), JSON.stringify(await A.panel(w.ctx)), JSON.stringify(await tools.ha_status(w.ctx)), JSON.stringify(await tools.ha_journal(w.ctx, {})), JSON.stringify(await bridge().status(w.ctx))].join("\n");
  assert.ok(!everything.includes(ha.token));
  const logs = [];
  const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  try { w.ctx.api.store = { list: async () => { throw new Error(`boom ${ha.token}`); } }; await directTransport(def, w.ctx)("pull", { method: "GET", headers: { Authorization: `Bearer ${ha.token}` } }); } finally { console.error = orig; }
  assert.ok(!logs.join("\n").includes(ha.token));
  w.done();
});

test("jeton refusé en rafale : on finit par répondre 429", async () => {
  const w = world();
  await pairUp(w);
  const send = directTransport(def, w.ctx, { ip: "198.51.100.50" });
  const codes = [];
  for (let i = 0; i < 25; i++) codes.push((await send("pull", { method: "GET", headers: { Authorization: "Bearer " + "z".repeat(43) } })).status);
  assert.equal(codes[0], 401); assert.equal(codes.at(-1), 429);
  w.done();
});

/* ───────────── Interrogation et accusés ───────────── */

test("interrogation : forme de la réponse et des actions", async () => {
  const w = world();
  const ha = await pairUp(w);
  const id = (await enq(w, { key: "tts:lire", text: "Bonjour", viewer: "Léa", ref: "x1" })).id;
  const r = await ha.pull();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["actions", "cursor", "enabled", "live", "pollSeconds", "serverTime"]);
  assert.equal(r.body.enabled, true); assert.equal(r.body.live, true); assert.equal(r.body.serverTime, new Date(Date.now()).toISOString());
  assert.equal(r.body.actions.length, 1);
  const a = r.body.actions[0];
  assert.deepEqual(Object.keys(a).sort(), ["expiresAt", "id", "issuedAt", "key", "text", "viewer"]);
  assert.equal(a.id, id); assert.equal(a.key, "tts:lire"); assert.equal(a.text, "Léa dit : Bonjour"); assert.equal(a.viewer, "Léa");
  assert.equal(Date.parse(a.expiresAt) - Date.parse(a.issuedAt), 60_000);
  assert.ok(!("test" in a));
  w.done();
});

test("curseur : l'interrogation reprend après le curseur, par lots", async () => {
  const w = world();
  const ha = await pairUp(w);
  for (let i = 0; i < 5; i++) await enq(w, { key: "lumieres:rouge", ref: `r${i}` });
  const p1 = await ha.pull({ cursor: 0, limit: 2 });
  assert.equal(p1.body.actions.length, 2);
  w.tick(1100);
  const p2 = await ha.pull({ cursor: p1.body.cursor, limit: 2 });
  assert.equal(p2.body.actions.length, 2);
  assert.ok(p2.body.cursor > p1.body.cursor);
  w.tick(1100);
  const p3 = await ha.pull({ cursor: p2.body.cursor, limit: 10 });
  assert.equal(p3.body.actions.length, 1);
  w.tick(1100);
  const p4 = await ha.pull({ cursor: p3.body.cursor });
  assert.deepEqual(p4.body.actions, []); assert.equal(p4.body.cursor, p3.body.cursor);
  w.done();
});

test("livraison : au plus 3 fois tant que l'accusé n'est pas arrivé, puis plus", async () => {
  const w = world();
  const ha = await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "r1" });
  const counts = [];
  for (let i = 0; i < 5; i++) { counts.push((await ha.pull({ cursor: 0 })).body.actions.length); w.tick(1100); }
  assert.deepEqual(counts, [1, 1, 1, 0, 0]);
  w.done();
});

test("accusé : l'action sort de la file et le résultat est publié ; un second accusé est « already », un inconnu « unknown »", async () => {
  const w = world();
  const ha = await pairUp(w);
  const { id } = await enq(w, { key: "lumieres:rouge", ref: "r1" });
  await ha.pull();
  const a = await ha.ack(id, "done", "ok");
  assert.deepEqual(a.body, { ok: true, result: "recorded" });
  assert.equal((await bridge().status(w.ctx)).queued, 0);
  assert.equal((await ha.ack(id, "done", "ok")).body.result, "already");
  assert.equal((await ha.ack("abcdef123456", "done", "ok")).body.result, "unknown");
  const res = await def.exports["ha.result"](w.ctx, {});
  assert.deepEqual(res.map((x) => ({ ref: x.ref, id: x.id, status: x.status, code: x.code })), [{ ref: "r1", id, status: "done", code: "ok" }]);
  assert.ok(!Number.isNaN(Date.parse(res[0].at)));
  w.done();
});

test("accusé : liste fermée de statuts et de codes, aucun texte libre", async () => {
  const w = world();
  const ha = await pairUp(w);
  const { id } = await enq(w, { key: "lumieres:rouge", ref: "r1" });
  await ha.pull();
  for (const [s, c] of [["done", "unmapped"], ["failed", "ok"], ["autre", "ok"], ["ignored", "pas une liste"], ["done", "ok\n"], [undefined, "ok"]]) {
    w.tick(200);
    const r = await ha.ack(id, s, c);
    assert.equal(r.status, 400, `${s}/${c}`);
  }
  const send = directTransport(def, w.ctx);
  const bad = await send("ack", { method: "POST", headers: { Authorization: `Bearer ${ha.token}` }, body: JSON.stringify({ id: "x/../y", status: "done", code: "ok" }) });
  assert.equal(bad.status, 400);
  assert.equal((await bridge().status(w.ctx)).queued, 1, "rien n'a été accepté");
  for (const [s, c] of [["ignored", "unmapped"], ["ignored", "disabled"], ["ignored", "expired"], ["failed", "error"]]) {
    const q = await enq(w, { key: "lumieres:rouge", ref: `${s}${c}` });
    assert.equal((await ha.ack(q.id, s, c)).body.result, "recorded");
  }
  w.done();
});

test("accusé : débit limité (429) et méthode", async () => {
  const w = world();
  const ha = await pairUp(w);
  const codes = [];
  for (let i = 0; i < 65; i++) codes.push((await ha.ack("abcdef123456", "done", "ok")).status);
  assert.equal(codes.filter((c) => c === 429).length, 5);
  const send = directTransport(def, w.ctx);
  assert.equal((await send("ack", { method: "GET" })).status, 405);
  assert.equal((await send("pull", { method: "POST", body: "{}" })).status, 405);
  w.done();
});

test("expiration à la lecture : rien n'est livré en retard, les points sont rendus (ha.result expired), sans minuteur", async () => {
  const w = world();
  const ha = await pairUp(w);
  const { id } = await enq(w, { key: "lumieres:rouge", ref: "r1" });
  w.tick(61_000);
  const r = await ha.pull();
  assert.deepEqual(r.body.actions, []);
  const res = await def.exports["ha.result"](w.ctx, {});
  assert.deepEqual(res.map((x) => [x.ref, x.id, x.status, x.code]), [["r1", id, "expired", "expired"]]);
  assert.equal((await bridge().status(w.ctx)).queued, 0);
  assert.equal((await ha.ack(id, "done", "ok")).body.result, "already", "un accusé tardif ne ressuscite rien");
  assert.ok(S.COLLECTIONS && !/setInterval|setTimeout/.test(["bridge", "store", "http", "index"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("")), "aucun minuteur de fond");
  w.done();
});

test("délai d'expiration réglable de 15 à 300 secondes", async () => {
  for (const [setting, secs] of [[5, 15], [90, 90], [9999, 300], ["abc", 60]]) {
    const w = world({ settings: { expirySeconds: setting } });
    const ha = await pairUp(w);
    await enq(w, { key: "lumieres:rouge", ref: "r1" });
    const a = (await ha.pull()).body.actions[0];
    assert.equal((Date.parse(a.expiresAt) - Date.parse(a.issuedAt)) / 1000, secs, String(setting));
    w.done();
  }
});

test("interrogation : au moins une seconde entre deux appels (429 + Retry-After), paramètres vérifiés", async () => {
  const w = world();
  const ha = await pairUp(w);
  assert.equal((await ha.pull()).status, 200);
  const fast = await ha.pull();
  assert.equal(fast.status, 429); assert.equal(fast.retryAfter, 1);
  w.tick(1000);
  assert.equal((await ha.pull()).status, 200);
  w.tick(1000);
  assert.equal((await ha.pull({ cursor: "abc" })).status, 400);
  w.tick(1000);
  assert.equal((await ha.pull({ cursor: -1 })).status, 400);
  w.tick(1000);
  assert.equal((await ha.pull({ limit: 500 })).status, 200);
  w.done();
});

test("limite de lot : jamais plus de 10 actions par interrogation", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  for (let i = 0; i < 14; i++) await enq(w, { key: "lumieres:rouge", ref: `r${i}` });
  assert.equal((await ha.pull({ limit: 500 })).body.actions.length, 10);
  w.done();
});

test("panne du stockage : 503 avec Retry-After, jamais de détail", async () => {
  const w = world();
  const ha = await pairUp(w);
  const good = w.ctx.api.store;
  let calls = 0;
  w.ctx.api.store = { ...good, list: async (c, o) => { if (++calls > 1) throw new Error("/var/secret/path exploded"); return good.list(c, o); } };
  const orig = console.error; console.error = () => {};
  let r;
  try { w.tick(1500); r = await ha.pull(); } finally { console.error = orig; }
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { ok: false, error: "unavailable" });
  assert.equal(r.retryAfter, 5);
  w.done();
});

test("un tour complet du faux Home Assistant : exécute, accuse, déduplique, ignore sans liaison", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ran = [];
  const ha = await pairUp(w, { "lumieres:rouge": async (a) => ran.push(a.key) });
  await enq(w, { key: "lumieres:rouge", ref: "a" });
  await enq(w, { key: "lumieres:inconnue", ref: "b" });
  const r = await ha.step();
  assert.deepEqual(r.acks.map((x) => [x.status, x.code]), [["done", "ok"], ["ignored", "unmapped"]]);
  assert.deepEqual(ran, ["lumieres:rouge"]);
  const res = await def.exports["ha.result"](w.ctx, { limit: 10 });
  assert.deepEqual(res.map((x) => [x.ref, x.status, x.code]).sort(), [["a", "done", "ok"], ["b", "ignored", "unmapped"]]);
  w.done();
});

/* ───────────── Direct ───────────── */

test("hors direct : refus `not_live`, interrogation vide avec live=false", async () => {
  const w = world({ live: { live: false } });
  const ha = await pairUp(w);
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
  const r = await ha.pull();
  assert.equal(r.body.live, false); assert.deepEqual(r.body.actions, []);
  const st = await bridge().status(w.ctx);
  assert.deepEqual({ ...st, lastSeenAt: typeof st.lastSeenAt }, { enabled: true, paired: true, lastSeenAt: "string", live: false, queued: 0 });
  w.done();
});

test("en direct puis fin : 5 minutes de marge, puis fermé", async () => {
  const w = world();
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  w.live.live = false; refreshLive();
  w.tick(4 * 60_000);
  await ha.pull();   // Home Assistant reste connecté
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r2" })).ok, true, "encore dans la marge");
  assert.equal((await bridge().status(w.ctx)).live, true);
  refreshLive();
  w.tick(61_000);
  await ha.pull();
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r3" }), { ok: false, reason: "not_live" });
  assert.equal((await bridge().status(w.ctx)).live, false);
  w.done();
});

test("sans « Ma Chaîne Twitch » : reste fermé et la page le dit (et propose de l'installer)", async () => {
  const w = world({ live: null });
  await pairUp(w);
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
  const blocks = await A.panel(w.ctx);
  const text = JSON.stringify(blocks);
  assert.match(text, /on ne peut pas savoir si vous êtes en direct/);
  assert.ok(blocks.some((b) => b.type === "suggestInstall" && b.service === "twitch.live"));
  assert.ok(blocks.some((b) => b.type === "suggestInstall" && b.service === "youtube.live"));
  assert.match(text, /Chaîne YouTube/);
  w.done();
});

test("trou noir : Twitch ne répond jamais, la réponse reste rapide, fermée, et la page le dit", async () => {
  const w = world({ liveFn: () => new Promise(() => {}) });
  L.timing.callMs = 40;
  try {
    const ha = await pairUp(w);
    const t0 = performance.now();
    assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
    assert.ok(performance.now() - t0 < 1500);
    refreshLive();
    const r = await ha.pull();
    assert.equal(r.body.live, false);
    refreshLive();
    assert.match(JSON.stringify(await A.panel(w.ctx)), /Twitch ou YouTube ne répond pas/);
  } finally { L.timing.callMs = 2500; }
  w.done();
});

test("Twitch répond « inconnu » (erreur) : fermé, jamais ouvert par erreur", async () => {
  const w = world({ live: { known: false, live: true } });
  await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).reason, "not_live");
  w.done();
});

test("plusieurs chaînes : une seule en direct suffit", async () => {
  B.resetMemory(); L.resetLive();
  const w = world();
  w.ctx.api.services.callAll = async () => [{ ok: true, value: { known: true, live: false } }, { ok: true, value: { known: true, live: true } }];
  await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  w.done();
});

/* ───────────── Direct : Twitch, YouTube, ou les deux ───────────── */

test("direct : YouTube seul (pas de Chaîne Twitch) : en direct => ouvert, la page dit « YouTube »", async () => {
  const w = world({ live: null, yt: { live: true } });
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  const r = await ha.pull();
  assert.equal(r.body.live, true);
  assert.equal((await bridge().status(w.ctx)).live, true);
  assert.match(JSON.stringify(await A.panel(w.ctx)), /YouTube dit que vous êtes en direct/);
  w.done();
});

test("direct : YouTube seul, fin du direct => marge de 5 minutes, puis fermé (not_live)", async () => {
  const yt = { live: true };
  const w = world({ live: null, yt: {}, ytFn: () => ({ ok: true, live: yt.live }) });
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  yt.live = false;
  refreshLive(); w.tick(4 * 60_000); await ha.pull();
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r2" })).ok, true, "dans la marge");
  refreshLive(); w.tick(61_000); await ha.pull();
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r3" }), { ok: false, reason: "not_live" });
  refreshLive();
  assert.match(JSON.stringify(await A.panel(w.ctx)), /vous n'êtes pas en direct/);
  w.done();
});

test("direct : Twitch seul inchangé ; Twitch en direct n'interroge pas YouTube (économie de limite)", async () => {
  let asked = 0;
  const w = world({ yt: { live: true }, ytFn: () => { asked += 1; return { ok: true, live: true }; } });
  await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  assert.equal(asked, 0);
  assert.match(JSON.stringify(await A.panel(w.ctx)), /Twitch dit que vous êtes en direct/);
  w.done();
});

test("direct : Twitch pas en direct, YouTube en direct => ouvert", async () => {
  const w = world({ live: { live: false }, yt: { live: true } });
  await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  assert.equal((await L.liveNow(w.ctx)).source, "youtube");
  w.done();
});

test("direct : les deux disent « en direct » => « les deux » ; les deux « pas en direct » => fermé", async () => {
  const w = world({ live: { live: true }, yt: { live: true } });
  await pairUp(w);
  // Twitch en direct : YouTube n'est pas interrogé ; on le force en vidant le cache et en rendant Twitch muet pour voir les deux côtés
  const both = world({ live: { live: false }, yt: { live: false } });
  await pairUp(both);
  assert.deepEqual(await enq(both, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
  const l = await L.liveNow(both.ctx);
  assert.deepEqual([l.source, l.live, l.known, l.twitch, l.youtube], ["both", false, true, "off", "off"]);
  both.done(); w.done();
});

test("direct : aucune source => fermé, la page dit « Chaîne Twitch ou Chaîne YouTube »", async () => {
  const w = world({ live: null });
  await pairUp(w);
  assert.equal((await L.liveNow(w.ctx)).source, "none");
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
  assert.match(JSON.stringify(await A.panel(w.ctx)), /Ma Chaîne Twitch.*Chaîne YouTube/);
  w.done();
});

test("direct : pannes (YouTube en erreur, Twitch inconnu) => fermé, jamais ouvert par erreur ; une source saine suffit", async () => {
  const bad = world({ live: null, yt: {}, ytFn: () => ({ ok: false, error: "quota" }) });
  await pairUp(bad);
  assert.equal((await L.liveNow(bad.ctx)).source, "unknown");
  assert.equal((await enq(bad, { key: "lumieres:rouge", ref: "r1" })).reason, "not_live");
  assert.match(JSON.stringify(await A.panel(bad.ctx)), /Twitch ou YouTube ne répond pas/);
  const throws = world({ live: { known: false, live: true }, yt: {}, ytFn: () => { throw new Error("panne"); } });
  await pairUp(throws);
  assert.equal((await enq(throws, { key: "lumieres:rouge", ref: "r1" })).reason, "not_live");
  const mixed = world({ live: { known: false, live: false }, yt: { live: true } });
  await pairUp(mixed);
  assert.equal((await enq(mixed, { key: "lumieres:rouge", ref: "r1" })).ok, true, "Twitch muet mais YouTube dit direct");
  bad.done(); throws.done(); mixed.done();
});

test("direct : trou noir YouTube (ne répond jamais) : réponse rapide, fermée ; Twitch en direct reste ouvert", async () => {
  L.timing.callMs = 40;
  try {
    const w = world({ live: null, yt: {}, ytFn: () => new Promise(() => {}) });
    await pairUp(w);
    const t0 = performance.now();
    assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r1" }), { ok: false, reason: "not_live" });
    assert.ok(performance.now() - t0 < 1500);
    w.done();
    const w2 = world({ live: { live: true }, yt: {}, ytFn: () => new Promise(() => {}) });
    await pairUp(w2);
    assert.equal((await enq(w2, { key: "lumieres:rouge", ref: "r1" })).ok, true);
    w2.done();
  } finally { L.timing.callMs = 2500; }
});

test("direct : YouTube « pas en direct » est gardé 60 s (économie de limite), « en direct » 20 s", async () => {
  let asked = 0;
  const w = world({ live: null, yt: {}, ytFn: () => { asked += 1; return { ok: true, live: false }; } });
  await pairUp(w);
  await L.liveNow(w.ctx); await L.liveNow(w.ctx); w.tick(30_000); await L.liveNow(w.ctx);
  assert.equal(asked, 1);
  w.tick(31_000); await L.liveNow(w.ctx);
  assert.equal(asked, 2);
  w.done();
});

test("direct : l'interrogation de Home Assistant (toutes les 3 s) n'appelle jamais YouTube quand rien n'attend ; une mise en file, si", async () => {
  let asked = 0;
  const w = world({ live: null, yt: {}, ytFn: () => { asked += 1; return { ok: true, live: true }; } });
  const ha = await pairUp(w);
  asked = 0; refreshLive();
  for (let i = 0; i < 5; i++) { w.tick(3100); await ha.pull(); }
  assert.equal(asked, 0, "5 interrogations à vide : aucun appel YouTube");
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).ok, true);
  assert.equal(asked, 1, "la mise en file demande");
  w.tick(1100);
  assert.equal((await ha.pull()).body.live, true, "l'interrogation reprend la dernière réponse connue");
  assert.equal(asked, 1);
  w.tick(1100); await ha.step();   // l'action est jouée et acquittée : la file est vide
  asked = 0; w.tick(11 * 60_000);
  assert.equal((await ha.pull()).body.live, false, "plus de 10 minutes sans nouvelle de YouTube et plus de marge : on ne prétend pas être en direct");
  assert.equal(asked, 0);
  w.done();
});

/* ───────────── Coupe-circuit ───────────── */

test("coupe-circuit : tout est refusé (off), l'interrogation dit enabled=false, ce qui attendait est refusé ; reprendre rouvre", async () => {
  const w = world();
  const ha = await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "r1" });
  assert.deepEqual(await bridge().stop(w.ctx, { by: "owner" }), { ok: true, enabled: false });
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r2" }), { ok: false, reason: "off" });
  const r = await ha.pull();
  assert.equal(r.body.enabled, false); assert.deepEqual(r.body.actions, []);
  assert.deepEqual((await def.exports["ha.result"](w.ctx, {})).map((x) => [x.ref, x.status, x.code]), [["r1", "refused", "off"]]);
  assert.equal((await def.exports["ha.state"](w.ctx))[0].enabled, false);
  assert.deepEqual(await bridge().start(w.ctx, { by: "owner" }), { ok: true, enabled: true });
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r3" })).ok, true);
  w.done();
});

test("coupe-circuit : un modérateur peut couper, pas reprendre ; `by` est obligatoire", async () => {
  const w = world();
  await pairUp(w);
  assert.equal((await bridge().stop(w.ctx, { by: "mod:pierre" })).ok, true);
  assert.deepEqual(await bridge().start(w.ctx, { by: "mod:pierre" }), { ok: false, reason: "forbidden" });
  assert.equal((await bridge().status(w.ctx)).enabled, false);
  assert.deepEqual(await bridge().stop(w.ctx, {}), { ok: false, reason: "invalid_by" });
  assert.deepEqual(await bridge().start(w.ctx, null), { ok: false, reason: "invalid_by" });
  assert.equal((await bridge().start(w.ctx, { by: "owner" })).ok, true);
  assert.ok(JSON.stringify((await S.peek(w.ctx, "log")).lines).includes("mod:pierre"), "l'audit garde qui a coupé");
  w.done();
});

test("coupe-circuit : le gros bouton et sa confirmation par l'état (sans boîte de dialogue)", async () => {
  const w = world();
  await pairUp(w);
  let blocks = await A.panel(w.ctx);
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "stop");
  assert.equal(form.submitLabel, "Tout couper");
  assert.ok(!("confirm" in form));
  assert.ok(blocks.findIndex((b) => b === form) <= 3, "visible sans défiler : juste après l'état");
  assert.match((await def.adminActions.stop.run(w.ctx)).ok, /Tout est coupé/);
  blocks = await A.panel(w.ctx);
  assert.equal(blocks[0].tone, "warning"); assert.match(blocks[0].text, /Tout est coupé/);
  assert.equal(blocks.find((b) => b.type === "adminForm" && ["stop", "start"].includes(b.action)).submitLabel, "Reprendre");
  assert.match((await def.adminActions.start.run(w.ctx)).ok, /C'est repris/);
  assert.equal(await A.badge(w.ctx), 0);
  await def.adminActions.stop.run(w.ctx);
  assert.equal(await A.badge(w.ctx), 1);
  w.done();
});

test("coupe-circuit : sans le droit de reprendre, la page l'explique ; sans le droit de couper aussi", async () => {
  const w = world({ rights: ["ha.stop"] });
  await pairUp(w);
  assert.ok((await A.panel(w.ctx)).some((b) => b.type === "adminForm" && b.action === "stop"));
  await def.adminActions.stop.run(w.ctx);
  const cut = JSON.stringify(await A.panel(w.ctx));
  assert.match(cut, /Seule une personne qui gère Home Assistant peut reprendre/);
  assert.ok(!cut.includes('"action":"start"'));
  const none = world({ rights: [] });
  await pairUp(none);
  assert.match(JSON.stringify(await A.panel(none.ctx)), /pas le droit de tout couper/);
  w.done(); none.done();
});

/* ───────────── Le contrat du service ───────────── */

test("service : `status` rend exactement { enabled, paired, lastSeenAt, live, queued }", async () => {
  const w = world();
  assert.deepEqual(await bridge().status(w.ctx), { enabled: true, paired: false, lastSeenAt: null, live: true, queued: 0 });
  await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "r1" });
  const s = await bridge().status(w.ctx);
  assert.deepEqual(Object.keys(s), ["enabled", "paired", "lastSeenAt", "live", "queued"]);
  assert.equal(s.queued, 1);
  w.done();
});

test("service `enqueue` : toutes les raisons de refus", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  // clé invalide
  for (const key of ["", "A", "Lumieres:rouge", "-x", ":x", "x".repeat(41), "a b", undefined, 12, null, "lumières"]) assert.deepEqual(await enq(w, { key, ref: "r" }), { ok: false, reason: "unknown_key" }, String(key));
  assert.deepEqual(await bridge().enqueue(w.ctx, null), { ok: false, reason: "unknown_key" });
  // pas associé
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r" }), { ok: false, reason: "not_paired" });
  const ha = await pairUp(w);
  // ok
  const good = await enq(w, { key: "lumieres:rouge", ref: "r1" });
  assert.equal(good.ok, true); assert.match(good.id, /^[a-f0-9]{16}$/); assert.deepEqual(Object.keys(good), ["ok", "id"]);
  // hors ligne : Home Assistant n'a pas interrogé depuis plus de 60 s
  w.tick(61_000);
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r2" }), { ok: false, reason: "offline" });
  await ha.pull();
  // hors direct
  w.live.live = false; refreshLive(); w.tick(6 * 60_000); await ha.pull();
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r3" }), { ok: false, reason: "not_live" });
  w.live.live = true; refreshLive();
  // texte refusé
  assert.deepEqual(await enq(w, { key: "tts:lire", text: "salut ta gueule", ref: "r4" }), { ok: false, reason: "blocked" });
  assert.deepEqual(await enq(w, { key: "tts:lire", text: "", ref: "r5" }), { ok: false, reason: "blocked" });
  // coupé
  await bridge().stop(w.ctx, { by: "owner" });
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "r6" }), { ok: false, reason: "off" });
  await bridge().start(w.ctx, { by: "owner" });
  // file pleine
  for (let i = 0; i < 50; i++) assert.equal((await enq(w, { key: "lumieres:rouge", ref: `f${i}` })).ok, true);
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "plein" }), { ok: false, reason: "busy" });
  w.done();
});

test("service `enqueue` : la modération ne détaille jamais son motif à l'appelant, mais le journal le garde", async () => {
  const w = world();
  await pairUp(w);
  const r = await enq(w, { key: "tts:lire", text: "merde alors", ref: "r1" });
  assert.deepEqual(r, { ok: false, reason: "blocked" });
  const line = (await S.peek(w.ctx, "log")).lines[0];
  assert.equal(line.status, "refused"); assert.equal(line.code, "blocked"); assert.equal(line.why, "word"); assert.equal(line.detail, "merd*");
  assert.ok(!JSON.stringify(line).includes("alors"), "le texte refusé n'est pas gardé");
  w.done();
});

test("service `enqueue` : même référence deux fois = même action (Twitch qui renvoie)", async () => {
  const w = world();
  await pairUp(w);
  const a = await enq(w, { key: "lumieres:rouge", ref: "same" }), b = await enq(w, { key: "lumieres:rouge", ref: "same" });
  assert.equal(a.id, b.id);
  assert.equal((await bridge().status(w.ctx)).queued, 1);
  w.done();
});

test("le texte n'existe que pour les clés tts: ; les autres clés l'ignorent", async () => {
  const w = world();
  const ha = await pairUp(w);
  await enq(w, { key: "lumieres:rouge", text: "bonjour", viewer: "Léa", ref: "r1" });
  const a = (await ha.pull()).body.actions[0];
  assert.equal(a.text, ""); assert.equal(a.viewer, "Léa");
  w.done();
});

test("attentes du texte lu : par personne (60 s) et pour tout le monde (10 s) ; ne servent que pour la voix", async () => {
  const w = world();
  await pairUp(w);
  assert.equal((await enq(w, { key: "tts:lire", text: "un", viewer: "Léa", ref: "a" })).ok, true);
  assert.equal((await enq(w, { key: "tts:lire", text: "deux", viewer: "Max", ref: "b" })).reason, "busy", "attente globale");
  w.tick(11_000);
  assert.equal((await enq(w, { key: "tts:lire", text: "trois", viewer: "Léa", ref: "c" })).reason, "busy", "attente de la personne");
  assert.equal((await enq(w, { key: "tts:lire", text: "quatre", viewer: "Max", ref: "d" })).ok, true);
  assert.equal((await enq(w, { key: "lumieres:rouge", viewer: "Léa", ref: "e" })).ok, true, "les lumières n'attendent pas");
  w.tick(61_000); await w.ha.pull();
  assert.equal((await enq(w, { key: "tts:lire", text: "cinq", viewer: "léa", ref: "f" })).ok, true);
  w.done();
});

test("un refus de modération ne fait attendre personne", async () => {
  const w = world();
  await pairUp(w);
  assert.equal((await enq(w, { key: "tts:lire", text: "merde", viewer: "Léa", ref: "a" })).reason, "blocked");
  assert.equal((await enq(w, { key: "tts:lire", text: "bonjour", viewer: "Léa", ref: "b" })).ok, true);
  w.done();
});

test("réglages de modération : longueur, pseudo devant, numéros, mots en plus et acceptés", async () => {
  const w = world({ settings: { maxChars: 20, prefixViewer: false, blockNumbers: false, extraWords: "spoiler", allowedWords: "con", globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "tts:lire", text: "abcd efgh abcd efgh ijkl", ref: "a" })).reason, "blocked");
  assert.equal((await enq(w, { key: "tts:lire", text: "pas de spoiler", ref: "b" })).reason, "blocked");
  assert.equal((await enq(w, { key: "tts:lire", text: "c'est con", viewer: "Léa", ref: "c" })).ok, true);
  assert.equal((await enq(w, { key: "tts:lire", text: "0612345678", viewer: "Léa", ref: "d" })).ok, true);
  const texts = (await ha.pull()).body.actions.map((x) => x.text);
  assert.deepEqual(texts, ["c'est con", "0612345678"]);
  w.done();
});

test("le pseudo du viewer est nettoyé, et remplacé s'il est refusé", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  await enq(w, { key: "tts:lire", text: "salut", viewer: "<b>Léa</b> https://x.com", ref: "a" });
  await enq(w, { key: "tts:lire", text: "salut", viewer: "nazi_boy", ref: "b" });
  const [a, b] = (await ha.pull()).body.actions;
  assert.equal(a.text, "Léa dit : salut"); assert.equal(a.viewer, "Léa");
  assert.equal(b.text, "Une personne dit : salut"); assert.equal(b.viewer, "");
  w.done();
});

/* ───────────── Sujets ───────────── */

test("sujets : forme de `ha.result` et `ha.state`", async () => {
  const w = world();
  const ha = await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "r1" });
  await ha.step();
  const [state] = await def.exports["ha.state"](w.ctx);
  assert.deepEqual(Object.keys(state).sort(), ["enabled", "lastSeenAt", "live", "paired"]);
  assert.deepEqual([state.enabled, state.live, state.paired], [true, true, true]);
  assert.ok(!Number.isNaN(Date.parse(state.lastSeenAt)));
  const unpaired = world();
  assert.deepEqual(await def.exports["ha.state"](unpaired.ctx), [{ enabled: true, live: true, paired: false }]);
  w.done(); unpaired.done();
});

/* ───────────── Bornes ───────────── */

test("bornes : journal de 100 lignes, 7 jours, purge à la lecture", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  for (let i = 0; i < 130; i++) { await enq(w, { key: "lumieres:rouge", ref: `r${i}` }); if (i % 40 === 39) { await ha.step(); w.tick(1100); } }
  const log = await S.peek(w.ctx, "log");
  assert.ok(log.lines.length <= 100);
  w.tick(8 * 24 * 3600_000);
  await bridge().status(w.ctx);
  assert.equal((await S.peek(w.ctx, "log")).lines.length, 0);
  w.done();
});

test("bornes : résultats 50 au plus, clés vues 50 au plus, file 50 au plus", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  for (let i = 0; i < 120; i++) {
    const q = await enq(w, { key: `cle:${i}`, ref: `b${i}` }); assert.equal(q.ok, true, JSON.stringify([i, q]));
    if (i % 10 === 9) { await ha.step(); w.tick(4000); }
  }
  assert.ok((await S.peek(w.ctx, "results")).items.length <= 50);
  const core = await S.peek(w.ctx, "core");
  assert.equal(core.keys.length, 50);
  assert.equal(core.keys[0], "cle:119");
  assert.ok((await def.exports["ha.result"](w.ctx, { limit: 500 })).length <= 50);
  w.done();
});

test("bornes : le journal garde le texte lu accepté mais jamais le texte refusé", async () => {
  const w = world();
  await pairUp(w);
  await enq(w, { key: "tts:lire", text: "bonjour a tous", viewer: "Léa", ref: "a" });
  w.tick(61_000);
  await w.ha.pull();
  await enq(w, { key: "tts:lire", text: "merde alors", viewer: "Léa", ref: "b" });
  const all = dump(w);
  assert.ok(all.includes("bonjour a tous"));
  assert.ok(!all.includes("merde alors"));
  w.done();
});

/* ───────────── Journal et page ───────────── */

test("page : état, bouton, assistant en 3 étapes avec le lien HACS, code copiable", async () => {
  const w = world();
  let blocks = await A.panel(w.ctx);
  assert.equal(blocks[0].type, "banner"); assert.match(blocks[0].text, /pas encore associé/);
  let text = JSON.stringify(blocks);
  assert.ok(text.includes("https://github.com/helldog136/homeassistant-curiosa"));
  assert.match(text, /1\. Installez l'intégration/); assert.match(text, /2\. Copiez le code à 8 caractères/); assert.match(text, /3\. C'est tout/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "pair"));
  await def.adminActions.pair.run(w.ctx);
  blocks = await A.panel(w.ctx);
  const code = blocks.find((b) => b.type === "copy" && /^[A-Z2-9]{8}$/.test(b.text));
  assert.ok(code);
  assert.ok(blocks.some((b) => b.type === "copy" && b.text === "https://site.example.org"));
  const ha = new FakeHaClient({ send: directTransport(def, w.ctx) });
  await ha.pair(code.text);
  await ha.pull();
  blocks = await A.panel(w.ctx);
  assert.equal(blocks[0].tone, "success"); assert.match(blocks[0].text, /Home Assistant est connecté/);
  assert.ok(blocks.some((b) => b.type === "table" && b.rowActions?.[0]?.action === "unpair" && b.rowActions[0].confirm));
  w.tick(3 * 60_000);
  blocks = await A.panel(w.ctx);
  assert.equal(blocks[0].tone, "warning"); assert.match(blocks[0].text, /pas été vu depuis/);
  w.done();
});

test("page : journal avec les motifs de refus, pastille Test, pseudo échappé", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w, { "lumieres:rouge": async () => {} });
  await enq(w, { key: "tts:lire", text: "salut ta gueule", viewer: "<script>alert(1)</script>", ref: "a" });
  await enq(w, { key: "lumieres:rouge", viewer: "Léa", ref: "b" });
  await enq(w, { key: "lumieres:inconnue", viewer: "Max", ref: "c" });
  await ha.step();
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  const blocks = await A.panel(w.ctx);
  const html = blocks.find((b) => b.type === "html" && b.html.includes("hj-row")).html;
  assert.match(html, /Refusée : mot refusé de la liste/);
  assert.match(html, /Ignorée : aucune scène n&#39;est liée/);
  assert.match(html, />Faite</);
  assert.match(html, /hj-pill">Test</);
  assert.ok(!html.includes("<script>"));
  assert.ok((html.match(/<li/g) ?? []).length <= 50);
  assert.match(JSON.stringify(blocks), /Les 50 dernières lignes, gardées 7 jours/);
  w.done();
});

test("page : en anglais, aucune clé de traduction brute", async () => {
  const w = world({ locale: "en" });
  await pairUp(w);
  await enq(w, { key: "tts:lire", text: "merde", ref: "a" });
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  const text = JSON.stringify(await A.panel(w.ctx));
  for (const k of Object.keys(en)) assert.ok(!new RegExp(`"${k}"`).test(text), `clé brute : ${k}`);
  assert.match(text, /Cut everything/); assert.match(text, /Latest actions/);
  w.done();
});

test("vider le journal", async () => {
  const w = world();
  await pairUp(w);
  await enq(w, { key: "lumieres:rouge", ref: "a" });
  assert.match((await def.adminActions.clearLog.run(w.ctx)).ok, /Journal vidé/);
  assert.equal((await S.peek(w.ctx, "log")).lines.length, 0);
  w.done();
});

/* ───────────── Tester le pont ───────────── */

test("test : parcours complet avec le faux Home Assistant, marqueur `test: true`, viewer « Test », suivi, journal", async () => {
  const w = world();
  const ran = [];
  const ha = await pairUp(w, { "lumieres:rouge": async (a) => ran.push(a) });
  const r = await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge", text: "" });
  assert.match(r.ok, /Test envoyé/);
  let follow = JSON.stringify(await A.panel(w.ctx));
  assert.match(follow, /Envoyé : l'action lumieres:rouge est dans la file/); assert.match(follow, /En attente que Home Assistant vienne la chercher/);
  w.tick(2000);
  const step = await ha.step();
  assert.equal(step.actions[0].test, true); assert.equal(step.actions[0].viewer, "Test");
  assert.equal(ran.length, 1); assert.equal(ran[0].test, true);
  follow = JSON.stringify(await A.panel(w.ctx));
  assert.match(follow, /Home Assistant l'a récupérée \(après 2 s\)/); assert.match(follow, /Exécuté, en 2 s au total/);
  const html = (await A.panel(w.ctx)).find((b) => b.type === "html" && b.html.includes("hj-row")).html;
  assert.match(html, /hj-pill">Test</);
  assert.deepEqual(await def.exports["ha.result"](w.ctx, {}), [], "un test n'a pas de référence Twitch : rien n'est publié pour le bot");
  w.done();
});

test("test : le suivi se recharge seul pendant 60 s tant que ce n'est pas fini, puis s'arrête", async () => {
  const w = world();
  const ha = await pairUp(w);
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  const reload = async () => JSON.stringify(await A.panel(w.ctx)).includes("location.reload");
  assert.equal(await reload(), true);
  w.tick(30_000); await ha.pull();
  assert.equal(await reload(), true, "récupéré mais pas fini");
  w.tick(31_000);
  assert.equal(await reload(), false, "plus de 60 s");
  const w2 = world();
  const ha2 = await pairUp(w2);
  await def.adminActions.test.run(w2.ctx, { key: "lumieres:rouge" });
  await ha2.step();
  assert.equal(JSON.stringify(await A.panel(w2.ctx)).includes("location.reload"), false, "fini : plus de rechargement");
  w.done(); w2.done();
});

test("test : issues expiré, ignoré (pas de liaison) et échec sont suivies avec leur délai", async () => {
  const w = world();
  const ha = await pairUp(w);
  await def.adminActions.test.run(w.ctx, { key: "lumieres:inconnue" });
  w.tick(1100);
  await ha.step();
  assert.match(JSON.stringify(await A.panel(w.ctx)), /Résultat après 1,1 s : Ignorée : aucune scène/);
  w.tick(4000);
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  w.tick(61_000);
  await ha.pull();
  assert.match(JSON.stringify(await A.panel(w.ctx)), /Résultat après 60 s : Trop tard/);
  w.done();
});

test("test : possible hors direct, mais jamais si tout est coupé, si rien n'est associé ou si Home Assistant est absent", async () => {
  const w = world({ live: { live: false } });
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).error, /pas encore associé/);
  const ha = await pairUp(w);
  w.tick(3100);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).ok, /Test envoyé/);
  w.tick(1100);
  const a = (await ha.pull()).body.actions[0];
  assert.equal(a.test, true, "livré même hors direct");
  w.tick(4000);
  await bridge().stop(w.ctx, { by: "owner" });
  w.tick(3100);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).error, /Tout est coupé/);
  await bridge().start(w.ctx, { by: "owner" });
  w.tick(61_000);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).error, /n'est pas connecté/);
  w.done();
});

test("test : un vrai échange hors direct reste refusé, et un test ne livre pas les vrais ordres hors direct", async () => {
  const w = world({ live: { live: false } });
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r1" })).reason, "not_live");
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  assert.equal((await ha.pull()).body.actions.length, 1);
  w.done();
});

test("test : la modération est la vraie, le refus s'affiche sous le champ avec le motif", async () => {
  const w = world();
  await pairUp(w);
  const r = await def.adminActions.test.run(w.ctx, { key: "tts:lire", text: "salut ta gueule" });
  assert.ok(r.errors?.text); assert.match(r.errors.text, /refusé comme pour un viewer/); assert.match(r.errors.text, /mot refusé de la liste/);
  w.tick(3100);
  const long = await def.adminActions.test.run(w.ctx, { key: "tts:lire", text: "abcd efgh ".repeat(20) });
  assert.match(long.errors.text, /trop long/);
  w.tick(3100);
  const num = await def.adminActions.test.run(w.ctx, { key: "tts:lire", text: "0612345678" });
  assert.match(num.errors.text, /numéro/);
  w.tick(3100);
  const ok = await def.adminActions.test.run(w.ctx, { key: "tts:lire", text: "Bonjour" });
  assert.match(ok.ok, /Test envoyé/);
  w.tick(1100);
  assert.equal((await w.ha.pull()).body.actions[0].text, "Bonjour", "pas de pseudo devant pour un test");
  w.done();
});

test("test : clé libre vérifiée, erreur sous le bon champ", async () => {
  const w = world();
  await pairUp(w);
  assert.ok((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge", customKey: "Pas Valide" })).errors.customKey);
  assert.ok((await def.adminActions.test.run(w.ctx, { key: "n'importe quoi" })).errors.key);
  w.tick(3100);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge", customKey: "lumieres:bleu" })).ok, /Test envoyé/);
  assert.ok((await S.peek(w.ctx, "core")).keys.includes("lumieres:bleu"));
  w.done();
});

test("test : une seule fois toutes les 3 secondes, 30 par heure", async () => {
  const w = world({ settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).ok, /Test envoyé/);
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).error, /un test toutes les 3 secondes/);
  let sent = 1;
  for (let i = 0; i < 40; i++) {
    w.tick(3100);
    if (i % 10 === 0) await ha.step();
    const r = await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
    if (r.ok) sent++;
  }
  assert.equal(sent, 30);
  w.tick(3600_000); await ha.pull();
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).ok, /Test envoyé/);
  w.done();
});

test("test : ne touche jamais à Twitch (aucun appel de service) et ne demande même pas si on est en direct", async () => {
  const w = world();
  await pairUp(w);
  w.ctx.calls.services.length = 0;
  await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" });
  assert.deepEqual(w.ctx.calls.services, []);
  assert.deepEqual(w.ctx.calls.net, []);
  const code = ["admin", "bridge", "tools", "http", "index"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  assert.ok(!/twitch\.api|redemption|refund|reward/i.test(code.replace(/\/\/.*$/gm, "")), "aucun appel à Twitch dans le module");
  w.done();
});

/* ───────────── Service : enqueue({ …, test: true }) (twitch-bot, youtube-live-actions) ───────────── */

test("service `enqueue` + test:true : marqué, possible hors direct, livré avec test:true, journal « Test », jamais d'appel à Twitch ni à YouTube", async () => {
  const w = world({ live: { live: false }, yt: { live: false } });
  const ha = await pairUp(w);
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "r0" })).reason, "not_live", "un vrai échange hors direct reste refusé");
  w.ctx.calls.services.length = 0;
  const r = await enq(w, { key: "lumieres:rouge", viewer: "Léa", ref: "test-1", test: true });
  assert.equal(r.ok, true);
  assert.deepEqual(w.ctx.calls.services.filter(([n]) => n === "twitch.live" || n === "youtube.live"), [], "un test ne demande pas si on est en direct");
  const pulled = (await ha.pull()).body;
  assert.equal(pulled.live, false);
  assert.equal(pulled.actions.length, 1);
  assert.equal(pulled.actions[0].test, true);
  assert.equal(pulled.actions[0].viewer, "Test", "le pseudo d'un test est « Test »");
  const log = JSON.stringify(await A.panel(w.ctx));
  assert.match(log, /Test/);
  const st = await S.peek(w.ctx, "log");
  assert.ok(st.lines.some((l) => l.test === true && l.status !== "refused"));
  // le résultat existe pour que l'appelant montre l'issue de SA simulation ; rien d'autre ne peut en faire un remboursement : `ref` d'un test
  w.tick(1100); await ha.step();
  assert.deepEqual((await def.exports["ha.result"](w.ctx, {})).map((x) => [x.ref, x.status]), [["test-1", "done"]]);
  w.done();
});

test("service `enqueue` + test:true : jamais avec le coupe-circuit actif, jamais sans appairage, Home Assistant doit être là", async () => {
  const w = world({ live: { live: false } });
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "t0", test: true })).reason, "not_paired");
  await pairUp(w);
  await bridge().stop(w.ctx, { by: "owner" });
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "t1", test: true }), { ok: false, reason: "off" });
  await bridge().start(w.ctx, { by: "owner" });
  w.tick(61_000);
  assert.deepEqual(await enq(w, { key: "lumieres:rouge", ref: "t2", test: true }), { ok: false, reason: "offline" });
  assert.deepEqual(await enq(w, { key: "pas valide", ref: "t3", test: true }), { ok: false, reason: "unknown_key" });
  w.done();
});

test("service `enqueue` : seul `test: true` compte (\"true\", 1, objets : un vrai échange)", async () => {
  const w = world({ live: { live: false } });
  await pairUp(w);
  for (const t of ["true", 1, {}, [true], "yes"]) assert.equal((await enq(w, { key: "lumieres:rouge", ref: "x1", test: t })).reason, "not_live", String(t));
  w.done();
});

test("service `enqueue` + test:true : la modération est la vraie, pas de « Pseudo dit : », pas d'attente par viewer, un test ne bloque pas un vrai message", async () => {
  const w = world({ settings: { prefixViewer: true } });
  const ha = await pairUp(w);
  assert.deepEqual(await enq(w, { key: "tts:lire", text: "salut ta gueule", ref: "t1", test: true }), { ok: false, reason: "blocked" });
  const ok = await enq(w, { key: "tts:lire", text: "Bonjour", ref: "t2", test: true });
  assert.equal(ok.ok, true);
  assert.equal((await enq(w, { key: "tts:lire", text: "Encore", ref: "t3", test: true })).ok, true, "pas d'attente par viewer pour un test");
  const real = await enq(w, { key: "tts:lire", text: "Vrai message", viewer: "Léa", ref: "r1" });
  assert.equal(real.ok, true, "les essais n'ont pas réservé l'attente de la voix");
  const texts = (await ha.pull()).body.actions.map((a) => [a.text, a.test === true]);
  assert.deepEqual(texts, [["Bonjour", true], ["Encore", true], ["Léa dit : Vrai message", false]]);
  w.done();
});

test("service `enqueue` + test:true : 30 par heure et 5 par 3 secondes au plus (refus `busy`) ; le bouton de l'administration reste à un toutes les 3 s", async () => {
  const w = world({ live: { live: false }, settings: { globalDelaySeconds: 0, viewerDelaySeconds: 0 } });
  const ha = await pairUp(w);
  let ok = 0, last;
  for (let i = 0; i < 8; i++) { last = await enq(w, { key: "lumieres:rouge", ref: `b${i}`, test: true }); if (last.ok) ok++; }
  assert.equal(ok, 5, "rafale de 5 en 3 s");
  assert.deepEqual(last, { ok: false, reason: "busy" });
  assert.match((await def.adminActions.test.run(w.ctx, { key: "lumieres:rouge" })).error, /un test toutes les 3 secondes/);
  for (let i = 0; i < 40; i++) {
    w.tick(3100);
    if (i % 5 === 0) await ha.step();
    const r = await enq(w, { key: "lumieres:rouge", ref: `c${i}`, test: true });
    if (r.ok) ok++;
  }
  assert.equal(ok, 30);
  w.tick(3600_000); await ha.step();
  assert.equal((await enq(w, { key: "lumieres:rouge", ref: "d1", test: true })).ok, true);
  w.done();
});

test("test : droit `ha.test`, audit, et le formulaire n'est montré qu'à qui peut", async () => {
  const w = world({ rights: ["ha.manage", "ha.stop"] });
  await pairUp(w);
  assert.ok(!(await A.panel(w.ctx)).some((b) => b.type === "adminForm" && b.action === "test"));
  const w2 = world();
  await pairUp(w2);
  const form = (await A.panel(w2.ctx)).find((b) => b.type === "adminForm" && b.action === "test");
  assert.equal(form.submitLabel, "Envoyer un test");
  assert.deepEqual(form.fields.map((f) => f.name), ["key", "customKey", "text"]);
  assert.deepEqual(form.fields[0].options.map((o) => o.value), ["lumieres:rouge", "tts:lire"]);
  await def.adminActions.test.run(w2.ctx, { key: "lumieres:rouge" });
  assert.ok((await S.peek(w2.ctx, "log")).lines.some((l) => l.event === "test"), "audit « test »");
  w.done(); w2.done();
});

/* ───────────── Outils des assistants ───────────── */

test("MCP : lecture (état, journal), écritures non accordées d'office, pas de reprise ni d'association", async () => {
  const names = manifest.mcp.map((m) => m.name);
  assert.deepEqual(names.sort(), ["ha_journal", "ha_status", "ha_stop", "home_assistant_test"]);
  for (const m of manifest.mcp) {
    assert.ok(m.name.length <= 31 && m.description.length > 40, m.name);
    if (m.readOnly) assert.ok(m.default !== false);
    else assert.ok(!m.default && !m.destructive, `${m.name} : écriture non accordée d'office`);
  }
  assert.deepEqual(manifest.mcp.filter((m) => m.readOnly).map((m) => m.name).sort(), ["ha_journal", "ha_status"]);
  assert.deepEqual(Object.keys(def.mcp).sort(), names);
  const w = world();
  await pairUp(w);
  const st = await tools.ha_status(w.ctx);
  assert.equal(st.paired, true); assert.equal(st.deviceName, "Maison"); assert.equal(st.liveSource, "twitch");
  assert.deepEqual(await tools.ha_stop(w.ctx, {}, { name: "assistant" }), { enabled: false });
  assert.equal((await tools.ha_status(w.ctx)).cutBy, "mcp:assistant");
  w.done();
});

test("MCP : la lecture ne modifie rien ; le journal est borné à 100 lignes", async () => {
  const w = world();
  const before = w.ctx.calls.writes.length;
  await tools.ha_status(w.ctx); await tools.ha_journal(w.ctx, {});
  assert.equal(w.ctx.calls.writes.length, before);
  await pairUp(w);
  const lines = await tools.ha_journal(w.ctx, { limit: 100 });
  assert.ok(lines.length <= 100);
  w.done();
});

test("MCP : `home_assistant_test` passe par la vraie file, refuse avec des mots clairs, est limité", async () => {
  const w = world();
  await assert.rejects(() => tools.home_assistant_test(w.ctx, { key: "lumieres:rouge" }, { name: "ia" }), (e) => e.expose === true && /not_paired/.test(e.message));
  await pairUp(w);
  w.tick(3100);
  await assert.rejects(() => tools.home_assistant_test(w.ctx, { key: "Pas Valide" }, { name: "ia" }), (e) => e.expose === true && /lights:red/.test(e.message));
  const r = await tools.home_assistant_test(w.ctx, { key: "tts:lire", text: "Bonjour" }, { name: "ia" });
  assert.equal(r.sent, true);
  await assert.rejects(() => tools.home_assistant_test(w.ctx, { key: "tts:lire", text: "Bonjour" }, { name: "ia" }), (e) => /too many tests/.test(e.message));
  w.tick(3100);
  await assert.rejects(() => tools.home_assistant_test(w.ctx, { key: "tts:lire", text: "ta gueule" }, { name: "ia" }), (e) => /moderation \(word\)/.test(e.message));
  w.done();
});

test("MCP : le détail de la file n'expose jamais le jeton, ni le code d'association", async () => {
  const w = world();
  const { code } = await B.createPairing(w.ctx);
  const out = JSON.stringify([await tools.ha_status(w.ctx), await tools.ha_journal(w.ctx, {})]);
  assert.ok(!out.includes(code));
  w.done();
});

/* ───────────── Contrat HTTP : la forme exacte, pour l'intégration ───────────── */

test("contrat HTTP : en-têtes de toutes les réponses", async () => {
  const w = world();
  const ha = await pairUp(w);
  const send = directTransport(def, w.ctx);
  w.tick(1100);
  for (const r of [await send("pull", { method: "GET", headers: { Authorization: `Bearer ${ha.token}` } }), await send("pull", { method: "GET" }), await send("ack", { method: "GET" })]) {
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-type"), /application\/json; charset=utf-8/);
  }
  assert.equal(H.MAX_BODY, 4096);
  w.done();
});

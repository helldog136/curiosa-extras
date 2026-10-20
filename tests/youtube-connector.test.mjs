// Connecteur YouTube : le seul module qui porte la clé YouTube et parle à l'interface de données de YouTube (service `youtube.api`).
// Faux YouTube : fakeFetch + netReplies du kit du cœur (quota 403, 429, silence, JSON tronqué), à travers le VRAI client réseau (ctx.api.net de fakeCtx).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseManifest } from "@/core/modules/manifest";
import { makeConnector, connectorModule, connectorApi as api, yt } from "./helpers/fakeYoutube.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, netReplies } = kit;
const root = new URL("../modules/", import.meta.url).pathname;
const DIR = `${root}youtube-connector`;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const source = ["index.mjs", "api.mjs"].map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = connectorModule.default;
const KEY = "FAKE-YT-KEY-0001";
const CH = (c) => "UC" + c.repeat(22);
const realFetch = globalThis.fetch;
const savedLimits = { ...api.LIMITS };
let f;
/** Installe un faux YouTube : `answer(url, init)` donne la réponse (voir fakeFetch). */
const serve = (answer) => { f = fakeFetch({ "*": answer }); globalThis.fetch = f; return f; };
const happy = (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/channels")) {
    const ids = (u.searchParams.get("id") ?? "").split(",").filter((x) => /^UC[a-c]/.test(x));   // UCa…, UCb…, UCc… existent ; les autres non
    const handle = u.searchParams.get("forHandle");
    return { json: yt.list(handle ? (handle === "@inconnu" ? [] : [yt.channel(CH("h"), { handle })]) : ids.map((id) => yt.channel(id))) };
  }
  if (u.pathname.endsWith("/playlistItems")) return { json: yt.list([]) };
  if (u.pathname.endsWith("/videos")) return { json: yt.list([]) };
  return { status: 404, json: {} };
};
const chReq = (id = CH("a"), extra = {}) => ({ endpoint: "channels.list", params: { part: "snippet,statistics", id }, ...extra });
const today = () => api.pacificDay(Date.now());
beforeEach(() => { api.resetState(); serve(happy); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(api.LIMITS, savedLimits); });

test("manifeste : valide, une seule instance, offre youtube.api v1, clé secrète, cœur 0.2.0, type « integration » et plateforme youtube, aucune tâche ni minuteur", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.instances, "single");
  assert.equal(manifest.type, "integration");
  assert.equal(manifest.platform, "youtube");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version, !!o.each]), [["youtube.api", 1, false]]);
  assert.equal(manifest.minCore, "0.2.0");
  const keySetting = manifest.settings.find((s) => s.key === "apiKey");
  assert.equal(keySetting.type, "secret");
  assert.ok(!keySetting.advanced && !("default" in keySetting), "saisissable en mode simple, sans valeur par défaut");
  assert.ok(manifest.settings.find((s) => s.key === "dailyBudget").advanced, "le budget est un réglage avancé (défaut 9 000)");
  assert.equal(def.tasks, undefined, "aucune tâche en arrière-plan : tout se fait à la demande");
  assert.ok(!/setInterval|\bfetch\(/.test(source), "ni minuteur répétitif, ni fetch direct (ctx.api.net seulement)");
  assert.deepEqual(Object.keys(def.services["youtube.api"]).sort(), ["adopt", "channels", "request", "status"]);
  assert.deepEqual(api.COSTS, { "channels.list": 1, "playlistItems.list": 1, "videos.list": 1 }, "coût annoncé de chaque appel (search.list exclu)");
});

test("liste FERMÉE : tout appel hors liste ou mal formé est refusé (invalid) sans aucun appel réseau ; sans clé : config, sans réseau", async () => {
  const c = makeConnector();
  for (const bad of [
    { endpoint: "search.list", params: { q: "x" } },
    { endpoint: "channels.list", params: { part: "snippet,brandingSettings", id: CH("a") } },
    { endpoint: "channels.list", params: { part: "snippet", id: Array.from({ length: 51 }, (_, i) => `UC${String(i).padStart(22, "x")}`) } },
    { endpoint: "channels.list", params: { part: "snippet", id: "pas-un-id" } },
    { endpoint: "channels.list", params: { part: "snippet", id: CH("a"), forHandle: "@x" } },
    { endpoint: "playlistItems.list", params: { playlistId: "UU1", maxResults: 51 } },
    { endpoint: "playlistItems.list", params: { playlistId: "../../etc" } },
    { endpoint: "videos.list", params: { id: [] } },
    { endpoint: "videos.list", params: { id: "abc" } },
    { endpoint: "channels.list", params: null },
    {},
  ]) assert.deepEqual(await c.methods.request(bad), { ok: false, error: "invalid" }, JSON.stringify(bad));
  assert.deepEqual(await c.methods.channels({ ids: Array.from({ length: 51 }, (_, i) => `UC${String(i).padStart(22, "x")}`) }), { ok: false, error: "invalid" }, "plus de 50 chaînes par appel : refusé");
  const none = makeConnector({ apiKey: null });
  assert.deepEqual(await none.methods.request(chReq()), { ok: false, error: "config" });
  assert.equal(f.calls.length, 0);
});

test("appel réussi : clé dans l'en-tête x-goog-api-key (jamais dans l'adresse), coût annoncé, cache 10 minutes, compteur d'unités gardé dans le stockage", async () => {
  const c = makeConnector();
  const r = await c.methods.request(chReq());
  assert.equal(r.ok, true); assert.equal(r.status, 200); assert.equal(r.cost, 1);
  assert.equal(r.json.items[0].id, CH("a"));
  assert.ok(Date.parse(r.at) <= Date.now());
  assert.equal(f.calls.length, 1);
  const u = new URL(f.calls[0].url);
  assert.equal(u.origin + u.pathname, "https://www.googleapis.com/youtube/v3/channels");
  assert.ok(!f.calls[0].url.includes(KEY) && u.searchParams.get("key") === null, "la clé n'est jamais dans l'adresse");
  assert.equal(new Headers(f.calls[0].init.headers).get("x-goog-api-key"), KEY);
  const again = await c.methods.request(chReq());
  assert.equal(again.cached, true); assert.equal(again.cost, 0);
  assert.equal(f.calls.length, 1, "même demande dans les 10 minutes : aucun nouvel appel");
  await c.methods.request({ endpoint: "videos.list", params: { id: ["abcdefghijk"] } });
  await c.methods.request({ endpoint: "playlistItems.list", params: { playlistId: "UUaaaaaaaaaa", maxResults: 50 } });
  const s = await c.methods.status();
  assert.equal(s.quota.used, 3);
  assert.equal(s.quota.budget, 9000); assert.equal(s.quota.reserve, 1000);
  assert.deepEqual(c.ctx.dumpStore().filter((x) => x.collection === "quota").map((x) => x.data), [{ day: today(), used: 3 }]);
});

test("compteur d'unités : 20 demandes identiques simultanées = 1 appel et 1 unité ; un refus sans réseau ne coûte rien", async () => {
  const c = makeConnector();
  const all = await Promise.all(Array.from({ length: 20 }, () => c.methods.request(chReq(CH("b")))));
  assert.ok(all.every((r) => r.ok && r.json.items[0].id === CH("b")));
  assert.equal(f.calls.length, 1);
  assert.equal((await c.methods.status()).quota.used, 1);
  serve(netReplies.rateLimited(120));
  await c.methods.request(chReq(CH("c")));
  const used = (await c.methods.status()).quota.used;
  await c.methods.request(chReq(CH("c")));   // en pause : rien ne part
  assert.equal((await c.methods.status()).quota.used, used, "une demande qui ne part pas n'est pas comptée");
});

test("budget : refus propre AVANT l'épuisement (sans réseau), 1 000 unités gardées pour les demandes d'une personne, remise à zéro au jour suivant (Pacifique)", async () => {
  const c = makeConnector({ rows: { quota: [{ day: today(), used: 8000 }] } });
  const r = await c.methods.request(chReq());
  assert.equal(r.ok, false); assert.equal(r.error, "quota");
  assert.equal(r.retryAt, api.nextPacificMidnight(Date.now()));
  assert.equal(f.calls.length, 0, "refusé avant de partir");
  const human = await c.methods.request(chReq(CH("a"), { priority: "interactive" }));
  assert.equal(human.ok, true, "la réserve sert aux demandes faites dans l'administration");
  assert.equal((await c.methods.status()).quota.used, 8001);
  const full = makeConnector({ key: "other", rows: { quota: [{ day: today(), used: 9000 }] } });
  assert.equal((await full.methods.request(chReq(CH("b"), { priority: "interactive" }))).error, "quota");
  assert.equal((await full.methods.status()).quota.exhausted, true);
  const small = makeConnector({ key: "small", settings: { dailyBudget: 100 }, rows: { quota: [{ day: today(), used: 89 }] } });
  assert.equal((await small.methods.request(chReq(CH("c")))).error, "quota", "budget réglable : 100 → 89 pour les pages, 11 réservées");
  const yesterday = makeConnector({ key: "yesterday", rows: { quota: [{ day: "2000-01-01", used: 9000 }] } });
  assert.equal((await yesterday.methods.request(chReq(CH("c")))).ok, true, "un autre jour : compteur remis à zéro");
  assert.equal((await yesterday.methods.status()).quota.used, 1);
});

test("quota épuisé : 403 quotaExceeded (pas un 429) → « quota » jusqu'à minuit heure du Pacifique, plus aucun appel ; le panneau le dit en mots simples, avec la santé du service", async () => {
  const c = makeConnector();
  serve(netReplies.quotaExceeded());
  const r = await c.methods.request(chReq());
  assert.equal(r.ok, false); assert.equal(r.error, "quota");
  const midnight = api.nextPacificMidnight(Date.now());
  assert.ok(Math.abs(r.retryAt - midnight) < 2000, "reprise à minuit, heure du Pacifique");
  const n = f.calls.length;
  for (const id of [CH("b"), CH("c")]) assert.equal((await c.methods.request(chReq(id))).error, "quota");
  assert.equal((await c.methods.channels({ ids: [CH("b")] })).error, "quota");
  assert.equal(f.calls.length, n, "aucun nouvel appel avant minuit");
  serve(netReplies.quotaExceeded("dailyLimitExceeded"));
  const other = makeConnector({ key: "other" });
  assert.equal((await other.methods.request(chReq())).error, "quota");
  const panel = await def.adminPanel(c.ctx);
  const banner = panel.find((b) => b.type === "banner" && /La limite YouTube du jour est épuisée, reprise (aujourd'hui|demain|le .*) à \d{1,2} h/.test(b.text));
  assert.ok(banner, JSON.stringify(panel));
  assert.deepEqual(panel.find((b) => b.type === "netHealth").items.map((i) => [i.host, i.label]), [["www.googleapis.com", "YouTube"]]);
});

test("quota épuisé, 429, silence, JSON tronqué : le dernier résultat connu est rendu, DATÉ (stale + at) ; sans résultat connu, une erreur claire ; jamais d'attente sans fin", async () => {
  api.LIMITS.cacheMs = -1;   // le cache ne sert jamais : chaque demande repart (pour voir le repli)
  api.LIMITS.timeoutMs = 600;
  const c = makeConnector();
  const first = await c.methods.request(chReq());
  assert.equal(first.ok, true);
  for (const [what, reply, error] of [["silence", netReplies.silence(), "timeout"], ["JSON tronqué", netReplies.truncatedJson(), "network"], ["429", netReplies.rateLimited(120), "rate"], ["quota", netReplies.quotaExceeded(), "quota"]]) {
    api.resetState();
    const fresh = makeConnector({ key: `k-${what}` });
    serve(happy);
    assert.equal((await fresh.methods.request(chReq())).ok, true);
    serve(reply);
    const t0 = Date.now();
    const r = await fresh.methods.request(chReq());
    assert.ok(Date.now() - t0 < 2000, `${what} : borné`);
    assert.equal(r.ok, true, what); assert.equal(r.stale, true, what); assert.equal(r.error, error, what);
    assert.ok(Date.parse(r.at) <= t0, `${what} : date du dernier résultat connu`);
    assert.equal(r.json.items[0].id, CH("a"));
    const blind = await fresh.methods.request(chReq(CH("b")));
    assert.deepEqual([blind.ok, blind.error], [false, error], `${what} : sans résultat connu`);
  }
  // Après une panne, la même demande n'est pas refaite pendant une minute (pas de harcèlement).
  api.resetState();
  const d = makeConnector({ key: "down" });
  serve(netReplies.truncatedJson());
  await d.methods.request(chReq());
  await d.methods.request(chReq());
  assert.equal(f.calls.length, 1);
});

test("429 : pause respectée, sans réseau jusqu'à Retry-After ; disjoncteur : après des pannes, l'hôte n'est plus sollicité", async () => {
  const c = makeConnector();
  serve(netReplies.rateLimited(120));
  const r = await c.methods.request(chReq());
  assert.equal(r.error, "rate");
  assert.ok(r.retryAt > Date.now() + 100_000);
  const n = f.calls.length;
  assert.equal((await c.methods.request(chReq(CH("b")))).error, "rate");
  assert.equal(f.calls.length, n);
  api.resetState();
  const d = makeConnector({ key: "down" });
  serve(netReplies.status(500));
  for (const x of "abcdefgh") await d.methods.request(chReq(CH(x)));
  assert.ok(f.calls.length <= 6, `disjoncteur ouvert après 5 échecs (vu ${f.calls.length} appels)`);
});

test("clé refusée (400 API_KEY_INVALID, 403 accessNotConfigured, 401) → « auth », plus d'appel pendant 10 minutes ; une nouvelle clé repart aussitôt", async () => {
  for (const [status, json] of [[400, yt.keyInvalid()], [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }], [401, {}]]) {
    api.resetState();
    const c = makeConnector();
    serve(() => ({ status, json }));
    assert.equal((await c.methods.request(chReq())).error, "auth", String(status));
    assert.equal((await c.methods.request(chReq(CH("b")))).error, "auth");
    assert.equal(f.calls.length, 1, `${status} : pas d'insistance`);
    assert.equal((await c.methods.status()).key, "refused");
    assert.match((await def.adminPanel(c.ctx)).map((b) => b.text).join(" "), /La clé YouTube est refusée/);
  }
  const fixed = makeConnector({ apiKey: "FAKE-YT-KEY-0002" });
  serve(happy);
  assert.equal((await fixed.methods.request(chReq())).ok, true);
  serve(() => ({ status: 400, json: { error: { code: 400, message: "Invalid value", errors: [{ reason: "invalidParameter" }] } } }));
  assert.equal((await fixed.methods.request(chReq(CH("b")))).error, "invalid", "une demande mal formée n'est pas une clé refusée");
});

test("channels : 1 à 50 chaînes par appel, identifiants (1 unité pour tous) et pseudos (1 unité chacun) ; nom, photo https, abonnés (null si cachés) ; introuvables listés", async () => {
  const c = makeConnector();
  serve((url) => {
    const u = new URL(url);
    if (u.searchParams.get("forHandle")) return happy(url);
    return { json: yt.list([yt.channel(CH("a"), { title: "Alpha" }), yt.channel(CH("b"), { hidden: true })]) };
  });
  const r = await c.methods.channels({ ids: [CH("a"), CH("b"), CH("z"), "pas-un-id"], handles: ["@chaine", "inconnu"] });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3, "1 pour les identifiants + 1 par pseudo");
  assert.equal(f.calls.length, 3);
  const a = r.items.find((i) => i.id === CH("a"));
  assert.equal(a.title, "Alpha"); assert.equal(a.subscribers, 1230); assert.equal(a.hidden, false); assert.equal(a.videos, 12); assert.equal(a.views, 3400);
  assert.match(a.avatar, /^https:\/\//);
  assert.ok(Date.parse(a.at) > 0);
  const b = r.items.find((i) => i.id === CH("b"));
  assert.deepEqual([b.subscribers, b.hidden], [null, true], "abonnés cachés : jamais un 0 inventé");
  assert.ok(r.items.some((i) => i.id === CH("h")), "trouvée par son pseudo");
  assert.deepEqual(r.missing.sort(), [CH("z"), "@inconnu", "pas-un-id"].sort());
  assert.deepEqual(await c.methods.channels({}), { ok: true, items: [], missing: [], failed: [], cost: 0 });
});

test("adopt : reprise de la clé sans ressaisie, idempotente, JAMAIS renvoyée ; une clé déjà réglée est gardée", async () => {
  const c = makeConnector({ apiKey: null });
  const r1 = await c.methods.adopt({ apiKey: KEY });
  assert.deepEqual(r1, { adopted: ["apiKey"], ready: true });
  assert.deepEqual(await c.methods.adopt({ apiKey: KEY }), { adopted: [], ready: true }, "deux fois : rien de plus");
  assert.equal(c.ctx.dumpStore().filter((x) => x.collection === "credential").length, 1);
  assert.deepEqual(await c.methods.adopt({ apiKey: "FAKE-YT-KEY-AUTRE" }), { adopted: [], ready: true, conflict: true }, "une autre clé ne remplace pas celle qui marche");
  assert.deepEqual((await c.methods.adopt({ apiKey: "" })).adopted, []);
  assert.equal((await c.methods.status()).key, "set");
  await c.methods.request(chReq());
  assert.equal(new Headers(f.calls[0].init.headers).get("x-goog-api-key"), KEY, "la clé reprise sert aux appels");
  const own = makeConnector({ key: "own", apiKey: "FAKE-YT-KEY-0009" });
  assert.deepEqual(await own.methods.adopt({ apiKey: KEY }), { adopted: [], ready: true, conflict: true }, "le réglage saisi l'emporte");
  assert.equal(own.ctx.dumpStore().length, 0);
});

test("secret : la clé n'apparaît dans AUCUN retour, bloc, journal réseau ni ligne de console — même quand YouTube la répète dans son message d'erreur", async () => {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(" "));
  const out = [];
  try {
    const c = makeConnector();
    out.push(await c.methods.request(chReq()), await c.methods.channels({ ids: [CH("a")], handles: ["@chaine"] }), await c.methods.status(), await def.adminPanel(c.ctx));
    serve(() => ({ status: 400, json: { error: { code: 400, message: `API key not valid: ${KEY}`, errors: [{ reason: "keyInvalid", message: KEY }] } } }));
    api.resetState();
    out.push(await c.methods.request(chReq(CH("b"))), await c.methods.status(), await def.adminPanel(c.ctx));
    const adopted = makeConnector({ key: "adopted", apiKey: null });
    out.push(await adopted.methods.adopt({ apiKey: KEY }), await adopted.methods.adopt({ apiKey: KEY }), await adopted.methods.status(), await def.adminPanel(adopted.ctx));
    out.push(c.ctx.calls.netLog, adopted.ctx.calls.netLog);
    assert.ok(c.ctx.calls.netLog.length > 0, "le journal réseau a bien été écrit");
  } finally { Object.assign(console, saved); }
  const dump = JSON.stringify(out) + lines.join("\n");
  assert.ok(!dump.includes(KEY), "la clé a fui");
  assert.ok(!dump.includes("FAKE-YT"), "même un morceau de la clé");
});

test("heure de reprise : minuit à Los Angeles (heure d'été et d'hiver), jour du quota", () => {
  assert.equal(new Date(api.nextPacificMidnight(Date.parse("2026-10-20T12:00:00Z"))).toISOString(), "2026-10-21T07:00:00.000Z");
  assert.equal(new Date(api.nextPacificMidnight(Date.parse("2026-12-20T12:00:00Z"))).toISOString(), "2026-12-21T08:00:00.000Z");
  assert.equal(new Date(api.nextPacificMidnight(Date.parse("2026-10-21T06:59:00Z"))).toISOString(), "2026-10-21T07:00:00.000Z");
  assert.equal(api.pacificDay(Date.parse("2026-10-21T06:59:00Z")), "2026-10-20");
  assert.equal(api.pacificDay(Date.parse("2026-10-21T07:00:00Z")), "2026-10-21");
});

test("panneau : sans clé, dit quoi faire et où créer la clé gratuite (un lien vers la console Google) ; aucun appel réseau à l'ouverture", async () => {
  const c = makeConnector({ apiKey: null });
  const panel = await def.adminPanel(c.ctx);
  assert.match(panel[0].text, /Ajoutez votre clé YouTube dans Réglages/);
  const help = panel.find((b) => b.type === "markdown" && b.text.includes("console.cloud.google.com"));
  assert.ok(help, "une phrase et un lien vers la console Google");
  assert.equal((help.text.match(/\]\(https:\/\//g) ?? []).length, 1);
  assert.match(panel.map((b) => b.text ?? "").join(" "), /Utilisé aujourd'hui : 0 sur 9/);
  assert.equal(f.calls.length, 0);
});

test("SRP : seul le Connecteur YouTube parle à l'interface de données de YouTube (googleapis.com)", () => {
  for (const id of fs.readdirSync(root)) {
    if (id === "youtube-connector") continue;
    for (const file of fs.readdirSync(`${root}${id}`).filter((x) => x.endsWith(".mjs"))) assert.ok(!fs.readFileSync(`${root}${id}/${file}`, "utf8").includes("googleapis.com"), `${id}/${file} parle à YouTube : passez par le service youtube.api`);
  }
});

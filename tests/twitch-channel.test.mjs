import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifestJson = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const realFetch = globalThis.fetch;
beforeEach(() => mod.resetCache());
afterEach(() => { globalThis.fetch = realFetch; });

function mockTwitch({ live = true, authOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); calls.push({ u, init });
    const json = (o, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => o });
    if (u.includes("id.twitch.tv/oauth2/token")) return authOk ? json({ access_token: "tok", expires_in: 3600 }) : json({}, false);
    if (u.includes("/helix/streams")) return json({ data: live ? [{ id: "42", title: "Soirée", started_at: "2030-01-01T10:00:00Z", game_name: "Zelda" }] : [] });
    if (u.includes("/helix/users")) return json({ data: [{ id: "777" }] });
    if (u.includes("/helix/clips")) return json({ data: [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", thumbnail_url: "https://static-cdn.jtvnw.net/x.jpg", created_at: "2030-01-01T00:00:00Z" }, { title: "Piège", url: "javascript:alert(1)", thumbnail_url: "javascript:x", created_at: "2030-01-01T00:00:00Z" }] });
    return json({}, false);
  };
  return calls;
}
const ctx = (settings = {}) => fakeCtx({ key: "tw", settings: { channel: "MaChaine", clientId: "cid", clientSecret: "sec", ...settings } });

test("manifeste valide ; réglages lus déclarés", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
});

test("stream.live : le live en cours, avec le jeu et l'adresse de la chaîne ; vide hors ligne", async () => {
  mockTwitch();
  assert.deepEqual(await def.exports["stream.live"](ctx()), [{ id: "42", title: "Soirée", url: "https://twitch.tv/machaine", startedAt: "2030-01-01T10:00:00Z", game: "Zelda" }]);
  mod.resetCache(); mockTwitch({ live: false });
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
});

test("sans identifiants valides ou si l'authentification échoue : vide, jamais d'erreur ; aucune requête si la chaîne est invalide", async () => {
  const calls = mockTwitch({ authOk: false });
  assert.deepEqual(await def.exports["stream.live"](ctx()), []);
  mod.resetCache();
  const calls2 = mockTwitch();
  assert.deepEqual(await def.exports["stream.live"](ctx({ channel: "a b!" })), []);
  assert.deepEqual(await def.exports["stream.live"](ctx({ clientSecret: "" })), []);
  assert.equal(calls2.length, 0);
  assert.ok(calls.length >= 1);
});

test("clips : affiches https Twitch uniquement, miniature non http(s) écartée, cache 10 min", async () => {
  const calls = mockTwitch();
  const posters = await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.deepEqual(posters, [{ title: "Beau clip", url: "https://clips.twitch.tv/abc", image: "https://static-cdn.jtvnw.net/x.jpg", kind: "clip" }]);
  const n = calls.length;
  await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.equal(calls.length, n, "second appel servi par le cache");
});

test("le jeton est transmis en en-tête, jamais dans l'adresse", async () => {
  const calls = mockTwitch();
  await def.exports["stream.live"](ctx());
  const helix = calls.find((c) => c.u.includes("/helix/streams"));
  assert.equal(helix.init.headers.Authorization, "Bearer tok");
  assert.ok(!helix.u.includes("tok") && !helix.u.includes("sec"));
});

test("plusieurs instances (une par chaîne) : chacune lit SA chaîne, sans mélanger lives ni clips ; le manifeste l'autorise", async () => {
  assert.equal(manifestJson.instances, "multiple");
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.includes("oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
    if (u.includes("/helix/streams")) return json({ data: u.includes("user_login=rascane") ? [{ id: "2", title: "Chez Rascane", started_at: "2030-01-01T10:00:00Z", game_name: "Zelda" }] : [] });
    return json({});
  };
  const mine = ctx({ channel: "helldog136" }), friend = ctx({ channel: "rascane", clientId: "autre", clientSecret: "autre" });
  assert.deepEqual(await def.exports["stream.live"](mine), [], "ma chaîne est hors ligne");
  const live = await def.exports["stream.live"](friend);
  assert.equal(live.length, 1);
  assert.equal(live[0].url, "https://twitch.tv/rascane");
  assert.equal(live[0].title, "Chez Rascane");
  assert.equal(calls.filter((u) => u.includes("oauth2/token")).length, 2, "un jeton par couple d'identifiants");
  await def.exports["stream.live"](friend); await def.exports["stream.live"](mine);
  assert.equal(calls.filter((u) => u.includes("oauth2/token")).length, 2, "jetons réutilisés : pas de nouvelle authentification en alternant");
});

test("réseau social : fournit « social.link » (le bouton de la chaîne) ; rien tant que la chaîne n'est pas réglée ou si elle est invalide", async () => {
  assert.ok(manifestJson.provides.some((p) => p.topic === "social.link"));
  assert.equal(manifestJson.type, "social");
  assert.deepEqual(await def.exports["social.link"](ctx({ channel: "Rascane" })), [{ label: "Twitch · rascane", url: "https://twitch.tv/rascane", icon: "twitch" }]);
  for (const bad of ["", "  ", "a", "pas valide!", "../x"]) assert.deepEqual(await def.exports["social.link"](ctx({ channel: bad })), [], JSON.stringify(bad));
});

// ── Service `twitch.live` : le seul client de l'API Twitch pour tous les consommateurs ───────────────────────────────────────────────
const svc = def.services["twitch.live"];
const call = (name, c, args) => svc[name](c, args);
const countOf = (calls, part) => calls.filter((c) => c.u.includes(part)).length;

test("manifeste : offre le service twitch.live (lecture seule : channel, status), garde stream.live, permissions storage/admin déclarées", () => {
  assert.deepEqual(manifestJson.offers.map((o) => o.service), ["twitch.api", "twitch.live"]);
  assert.deepEqual(manifestJson.offers.find((o) => o.service === "twitch.live").readOnly, ["channel", "status"]);
  assert.ok(manifestJson.provides.some((p) => p.topic === "stream.live"));
  assert.ok(!manifestJson.requires, "le fournisseur ne dépend de personne");
  assert.ok(manifestJson.permissions.includes("storage") && manifestJson.permissions.includes("admin") && manifestJson.permissions.includes("topics"));
  assert.deepEqual(Object.keys(def.services["twitch.live"]).sort(), ["adopt", "channel", "status"]);
});

test("service channel() : chaîne, adresse, état des identifiants, sans aucun appel réseau", async () => {
  const calls = mockTwitch();
  assert.deepEqual(await call("channel", ctx()), { channel: "machaine", url: "https://twitch.tv/machaine", configured: true, ready: true, missing: [] });
  assert.deepEqual(await call("channel", ctx({ clientId: "", clientSecret: "" })), { channel: "machaine", url: "https://twitch.tv/machaine", configured: false, ready: false, missing: ["clientId", "clientSecret"] });
  assert.deepEqual((await call("channel", ctx({ channel: "pas valide" }))).missing, ["channel"]);
  assert.equal(calls.length, 0);
});

test("service status() : en direct (titre, jeu, spectateurs, début, miniature https) puis hors ligne", async () => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.includes("oauth2/token")) return json({ access_token: "tok", expires_in: 3600 });
    return json({ data: [{ id: "42", title: "Soirée <b>", started_at: "2030-01-01T10:00:00Z", game_name: "Zelda", viewer_count: 12, thumbnail_url: "https://static-cdn.jtvnw.net/live_{width}x{height}.jpg" }] });
  };
  assert.deepEqual(await call("status", ctx()), { configured: true, known: true, live: true, channel: "machaine", url: "https://twitch.tv/machaine", id: "42", title: "Soirée <b>", game: "Zelda", viewers: 12, startedAt: "2030-01-01T10:00:00Z", thumbnail: "https://static-cdn.jtvnw.net/live_440x248.jpg" });
  mod.resetCache(); mockTwitch({ live: false });
  assert.deepEqual(await call("status", ctx()), { configured: true, known: true, live: false, channel: "machaine", url: "https://twitch.tv/machaine" });
});

test("service status() : une miniature non https est écartée ; sans identifiants → configured:false, known:false, aucun appel", async () => {
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("oauth2") ? { access_token: "t" } : { data: [{ id: "1", title: "t", thumbnail_url: "javascript:x" }] }) });
  assert.equal((await call("status", ctx())).thumbnail, null);
  const calls = mockTwitch();
  const r = await call("status", ctx({ clientSecret: "" }));
  assert.deepEqual([r.configured, r.known, r.live, r.error], [false, false, false, "config"]);
  assert.equal(calls.length, 0);
});

test("un SEUL jeton et UN SEUL appel Helix pour le service, stream.live et plusieurs consommateurs, y compris simultanés", async () => {
  const calls = mockTwitch();
  const c = ctx();
  await Promise.all([call("status", c), call("status", c), def.exports["stream.live"](c), call("status", ctx())]);
  await call("status", c);
  assert.equal(countOf(calls, "oauth2/token"), 1);
  assert.equal(countOf(calls, "/helix/streams"), 1);
});

test("service status() : une autre chaîne (args.channel) avec les identifiants de l'instance ; instances = chaînes distinctes, jeton partagé", async () => {
  const calls = mockTwitch();
  const mine = ctx({ channel: "helldog136" });
  assert.equal((await call("status", mine, { channel: "Rascane" })).channel, "rascane");
  assert.equal((await call("status", mine, { channel: "pas valide" })).channel, "helldog136", "chaîne invalide ignorée");
  await call("status", ctx({ channel: "rascane" }));
  assert.equal(countOf(calls, "oauth2/token"), 1);
  assert.equal(countOf(calls, "user_login=rascane"), 1, "même chaîne demandée par deux instances : un appel");
});

test("erreurs : réseau coupé, 401, 429 → jamais d'exception, error explicite, pas de harcèlement (cache d'erreur), jeton refusé oublié", async () => {
  for (const [label, handler, error] of [
    ["réseau", async () => { throw new Error("coupé"); }, "network"],
    ["401 à l'authentification", async () => ({ ok: false, status: 401, json: async () => ({}) }), "auth"],
    ["429 à l'authentification", async () => ({ ok: false, status: 429, json: async () => ({}) }), "rate"],
  ]) {
    mod.resetCache(); const seen = [];
    globalThis.fetch = async (u, i) => { seen.push(String(u)); return handler(u, i); };
    const r = await call("status", ctx());
    assert.deepEqual([r.known, r.live, r.error], [false, false, error], label);
    await call("status", ctx());
    assert.equal(seen.length, 1, `${label} : une seconde demande immédiate ne rappelle pas Twitch`);
  }
  mod.resetCache(); let streams = 0;
  globalThis.fetch = async (u) => { const s = String(u); if (s.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) }; streams++; return { ok: false, status: 429, json: async () => ({}) }; };
  assert.equal((await call("status", ctx())).error, "rate");
  await call("status", ctx());
  assert.equal(streams, 1);
  mod.resetCache(); const t401 = [];
  globalThis.fetch = async (u) => { const s = String(u); t401.push(s); if (s.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "t", expires_in: 3600 }) }; return { ok: false, status: 401, json: async () => ({}) }; };
  assert.equal((await call("status", ctx())).error, "auth");
  assert.equal(t401.filter((s) => s.includes("oauth2")).length, 1);
  assert.deepEqual((await def.exports["stream.live"](ctx())), [], "stream.live reste vide, sans erreur");
});

test("https : tous les appels vont vers id.twitch.tv / api.twitch.tv en https, le secret n'est jamais dans une adresse ni dans la réponse du service", async () => {
  const calls = mockTwitch();
  const r = await call("status", ctx({ clientSecret: "TOP-SECRET" }));
  await def.exports["maze.poster"](ctx({ clientSecret: "TOP-SECRET" }), {});
  for (const c of calls) { assert.match(c.u, /^https:\/\/(id|api)\.twitch\.tv\//); assert.ok(!c.u.includes("TOP-SECRET")); }
  assert.ok(!JSON.stringify(r).includes("TOP-SECRET") && !JSON.stringify(await call("channel", ctx({ clientSecret: "TOP-SECRET" }))).includes("TOP-SECRET"));
});

// ── Reprise des identifiants d'un autre module ─────────────────────────────────────────────────────────────────────────────────────
const empty = (extra = {}) => fakeCtx({ key: "tw", settings: extra });

test("status({ legacy }) : les identifiants d'un consommateur ne servent que si l'instance n'a pas les siens", async () => {
  const calls = mockTwitch();
  const legacy = { channel: "Ancienne", clientId: "old-id", clientSecret: "old-sec" };
  const r = await call("status", empty(), { legacy });
  assert.deepEqual([r.known, r.live, r.channel, r.configured], [true, true, "ancienne", true]);
  assert.equal(calls.find((c) => c.u.includes("/helix/streams")).init.headers["Client-Id"], "old-id");
  mod.resetCache(); const calls2 = mockTwitch();
  await call("status", ctx(), { legacy });
  assert.equal(calls2.find((c) => c.u.includes("/helix/streams")).init.headers["Client-Id"], "cid", "les siens d'abord");
  mod.resetCache(); const calls3 = mockTwitch();
  assert.equal((await call("status", empty(), { legacy: { channel: "ok_chan", clientId: "has space", clientSecret: "x" } })).configured, false);
  assert.equal(calls3.length, 0);
});

test("adopt : copie les champs vides une seule fois, n'écrase jamais (réglage ou reprise), idempotent, ne renvoie jamais une valeur", async () => {
  mockTwitch();
  const c = empty();
  const incoming = { channel: "Ma_Chaine", clientId: "old-id", clientSecret: "old-SECRET" };
  const r1 = await call("adopt", c, incoming);
  assert.deepEqual(r1, { adopted: ["channel", "clientId", "clientSecret"], ready: true });
  assert.ok(!JSON.stringify(r1).includes("old-SECRET"));
  assert.deepEqual(await call("adopt", c, incoming), { adopted: [], ready: true }, "deuxième fois : rien");
  assert.deepEqual(await call("adopt", c, { channel: "autre_chaine", clientId: "autre", clientSecret: "autre" }), { adopted: [], ready: true }, "jamais d'écrasement d'une reprise");
  assert.equal(await c.api.store.count("adopted"), 1);
  assert.deepEqual(await call("channel", c), { channel: "ma_chaine", url: "https://twitch.tv/ma_chaine", configured: true, ready: true, missing: [] });
  assert.equal((await def.exports["social.link"](c))[0].url, "https://twitch.tv/ma_chaine");
  // des réglages déjà saisis ne sont pas écrasés
  const own = empty({ channel: "saisie", clientId: "mon-id" });
  assert.deepEqual(await call("adopt", own, incoming), { adopted: ["clientSecret"], ready: true }, "chaîne et client id saisis : intacts ; seul le secret manquant est repris");
  assert.equal((await call("channel", own)).channel, "saisie");
  // valeurs invalides ignorées
  assert.deepEqual(await call("adopt", empty(), { channel: "pas valide", clientId: "a b", clientSecret: 42 }), { adopted: [], ready: false });
  assert.deepEqual(await call("adopt", empty(), null), { adopted: [], ready: false });
});

test("les réglages saisis ont toujours le dessus sur une reprise, champ par champ", async () => {
  mockTwitch();
  const c = empty();
  await call("adopt", c, { channel: "reprise", clientId: "id-repris", clientSecret: "sec-repris" });
  const typed = fakeCtx({ key: "tw", settings: { channel: "saisie" } });
  typed.api.store = c.api.store;
  assert.equal((await call("channel", typed)).channel, "saisie");
  assert.equal((await call("channel", typed)).ready, true, "identifiants repris pour le reste");
});

test("admin : une reprise est signalée sans jamais afficher de valeur ; « oublier » rend la main aux réglages", async () => {
  const c = empty();
  assert.deepEqual(await def.adminPanel(c), []);
  await call("adopt", c, { channel: "ma_chaine", clientId: "old-id", clientSecret: "old-SECRET" });
  const blocks = await def.adminPanel(c);
  const dump = JSON.stringify(blocks);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "forgetAdopted"));
  for (const v of ["ma_chaine", "old-id", "old-SECRET"]) assert.ok(!dump.includes(v), v);
  assert.ok(Object.keys(def.adminActions).includes("forgetAdopted"));
  assert.equal((await def.adminActions.forgetAdopted(c)).redirect, "?");
  assert.deepEqual(await def.adminPanel(c), []);
  assert.equal((await call("channel", c)).channel, null);
});

test("locales de la Chaîne Twitch : en et fr alignées, textes de l'admin présents", async () => {
  const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of ["adoptedNote", "forget", "forgotten"]) assert.ok(k in fr);
});

// ── Plusieurs chaînes : chaque instance répond pour la sienne (service « each »), identifiants partageables ────────────────────────────
const inst = (key, settings = {}) => fakeCtx({ key, settings });
const typed = (key, channel) => inst(key, { channel, clientId: "cid", clientSecret: "SEC-RET" });

test("manifeste : l'offre twitch.live est « each », minCore 0.1.22, version 1.5.0, réglage facultatif des identifiants d'une autre chaîne", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  for (const o of manifestJson.offers) assert.equal(o.each, true, o.service);
  assert.equal(manifestJson.minCore, "0.1.22");
  assert.equal(manifestJson.version, "1.5.0");
  const s = manifestJson.settings.find((x) => x.key === "useCredentialsOf");
  assert.ok(s && s.type === "text" && s.advanced);
});

test("chaque instance répond pour SA chaîne : status() et channel() sans argument, aucun « maître », jeton unique pour les mêmes identifiants (même simultanés)", async () => {
  const calls = mockTwitch();
  const a = typed("a", "helldog136"), b = typed("b", "rascane");
  const [ra, rb] = await Promise.all([call("status", a), call("status", b)]);
  assert.deepEqual([ra.channel, rb.channel], ["helldog136", "rascane"]);
  assert.deepEqual([(await call("channel", a)).channel, (await call("channel", b)).channel], ["helldog136", "rascane"]);
  assert.equal(countOf(calls, "oauth2/token"), 1, "un seul jeton");
  assert.equal(countOf(calls, "/helix/streams"), 2, "une requête par chaîne");
  assert.ok(!source.includes("master") && !source.includes("maître") || !/ctx\.api\.services/.test(source), "aucun appel de service vers une autre instance");
});

test("status() : nom d'affichage de la chaîne quand Twitch le donne (texte court), sinon absent", async () => {
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes("oauth2") ? { access_token: "t" } : { data: [{ id: "1", title: "t", user_name: "Helldog136" }] }) });
  assert.equal((await call("status", typed("a", "helldog136"))).displayName, "Helldog136");
  mod.resetCache();
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes("oauth2") ? { access_token: "t" } : { data: [{ id: "1", title: "t", user_name: "x".repeat(80) }] }) });
  assert.equal("displayName" in (await call("status", typed("a", "helldog136"))), false);
});

test("identifiants partagés : une chaîne sans client id/secret reprend ceux de l'autre chaîne (champ par champ), un seul jeton, secret jamais exposé", async () => {
  const calls = mockTwitch();
  const donor = typed("a", "helldog136");
  const friend = inst("b", { channel: "rascane", useCredentialsOf: "Helldog136" });
  assert.equal((await call("channel", friend)).ready, false, "tant que la chaîne donneuse n'a pas été lue (ordre de lecture) : pas prête");
  await call("channel", donor);
  const info = await call("channel", friend);
  assert.deepEqual(info, { channel: "rascane", url: "https://twitch.tv/rascane", configured: true, ready: true, missing: [] });
  const r = await call("status", friend);
  assert.deepEqual([r.channel, r.known], ["rascane", true]);
  await call("status", donor);
  assert.equal(countOf(calls, "oauth2/token"), 1);
  const dump = JSON.stringify([info, r, await def.adminPanel(friend), await def.adminPanel(donor)]);
  assert.ok(!dump.includes("SEC-RET") && !dump.includes("cid"), "secret et client id jamais exposés");
  for (const c of calls) assert.ok(!c.u.includes("SEC-RET"));
});

test("identifiants partagés : ce qui est saisi dans l'instance prévaut champ par champ ; la copie gardée survit à un redémarrage ; « oublier » rend la main", async () => {
  mockTwitch();
  const donor = typed("a", "helldog136");
  await call("channel", donor);
  const own = inst("b", { channel: "rascane", clientId: "mon-id", useCredentialsOf: "helldog136" });
  const calls = mockTwitch();
  await call("status", own);
  const h = calls.find((c) => c.u.includes("/helix/streams")).init.headers;
  assert.equal(h["Client-Id"], "mon-id", "client id saisi gardé");
  assert.equal(await own.api.store.count("borrowed"), 1);
  // « redémarrage » : la mémoire est vide, la copie gardée sert
  mod.resetCache();
  assert.equal((await call("channel", own)).ready, true);
  assert.match((await def.adminPanel(own))[0].text, /share_copy|helldog136/);
  // la chaîne donneuse change son secret : la copie est mise à jour dès qu'elle est relue
  await call("channel", inst("a", { channel: "helldog136", clientId: "cid", clientSecret: "NOUVEAU" }));
  await call("channel", own);
  assert.equal((await own.api.store.list("borrowed"))[0].data.clientSecret, "NOUVEAU");
  await def.adminActions.forgetAdopted(own);
  assert.equal(await own.api.store.count("borrowed"), 0);
});

test("identifiants partagés : chaîne inconnue ou identique à la sienne → rien n'est inventé, avertissement dans l'admin", async () => {
  const none = inst("b", { channel: "rascane", useCredentialsOf: "introuvable" });
  assert.equal((await call("channel", none)).ready, false);
  assert.equal((await def.adminPanel(none))[0].tone, "warning");
  const self = inst("c", { channel: "rascane", useCredentialsOf: "rascane" });
  assert.equal((await def.adminPanel(self))[0].tone, "warning");
  assert.equal((await call("channel", inst("d", { channel: "rascane", useCredentialsOf: "pas valide!" }))).ready, false);
});

test("reprise (adopt) avec plusieurs instances : elle ne remplit que les champs vides de l'instance appelée et n'écrase pas une chaîne déjà réglée", async () => {
  mockTwitch();
  const first = inst("a"), second = typed("b", "rascane");
  await call("adopt", first, { channel: "Ancienne", clientId: "o", clientSecret: "p" });
  assert.equal((await call("channel", first)).channel, "ancienne");
  assert.deepEqual(await call("adopt", second, { channel: "Ancienne", clientId: "o", clientSecret: "p" }), { adopted: [], ready: true });
  assert.equal((await call("channel", second)).channel, "rascane");
});

test("locales : textes du partage d'identifiants présents en fr et en", () => {
  for (const l of ["fr", "en"]) { const j = JSON.parse(fs.readFileSync(`${DIR}/locales/${l}.json`, "utf8")); for (const k of ["share_live", "share_copy", "share_none", "share_self"]) assert.ok(j[k], `${l}.${k}`); }
});

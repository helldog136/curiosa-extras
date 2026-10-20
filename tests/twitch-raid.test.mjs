// Raid Twitch 1.2.0 : la liste des partenaires, le dock (adresse secrète, page, données), les attentes bornées, le presse-papier (fonctions de la page), l'administration.
// Aucun réseau : Chaîne Twitch est remplacée par un faux service `twitch.api` ; la page du navigateur est vérifiée à part (voir README du dépôt : essais en navigateur réel faits à la livraison).
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/twitch-raid", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const def = (await import("../modules/twitch-raid/index.mjs")).default;
const pure = await import("../modules/twitch-raid/pure.mjs");
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const partnersMod = await import("../modules/twitch-raid/partners.mjs");
const dock = await import("../modules/twitch-raid/dock.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");

/* ───────────── Un faux « Chaîne Twitch » (service twitch.api) ───────────── */

/** `streams` : ce que Twitch répond (liste de lignes `data`) ; `calls` garde chaque demande de liste. */
function fakeApi(over = {}) {
  const api = {
    calls: [], accounts: [{ ok: true, channel: "emma_live", ready: true, adminPath: "/admin/instances/id-tw" }], streams: [], reply: null, wait: null, ...over,
    methods: {
      account: async () => api.accounts[0],
      request: async (args) => {
        api.calls.push(args);
        if (api.wait) await api.wait();
        if (api.reply) return typeof api.reply === "function" ? api.reply(args) : api.reply;
        const wanted = args.query.user_login;
        return { ok: true, status: 200, json: { data: api.streams.filter((s) => wanted.includes(String(s.user_login).toLowerCase())) } };
      },
    },
  };
  return api;
}
const row = (login, viewers, extra = {}) => ({ user_login: login, user_name: login.toUpperCase(), game_name: "Zelda", title: `Live de ${login}`, viewer_count: viewers, started_at: "2026-10-20T10:00:00Z", type: "live", ...extra });
let api;
const mk = (extra = {}, settings = {}) => fakeCtx({
  key: "raid", moduleId: "twitch-raid", locale: "fr", messages: { ...fr }, settings, siteUrl: "https://site.example.test", permissions: manifest.permissions,
  serviceInstances: { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods: api.methods }] }, ...extra,
});
const timing0 = { ...live.timing };
const ptiming0 = { ...partnersMod.timing };
beforeEach(() => { api = fakeApi(); live.resetLive(); partnersMod.resetPartners(); Object.assign(live.timing, timing0); Object.assign(partnersMod.timing, ptiming0); });
afterEach(() => { mock.timers.reset(); Object.assign(live.timing, timing0); });
const logins = (n) => Array.from({ length: n }, (_, i) => `chaine_${String(i).padStart(3, "0")}`).join("\n");
const P = (...l) => l.map((login) => ({ login, name: "", note: "" }));

/* ───────────── Manifeste ───────────── */

test("manifeste : un module, un service (twitch.api, version 2 au moins), aucun droit d'écriture MCP, réglage avancé facultatif, vie privée déclarée", () => {
  assert.equal(manifest.id, "twitch-raid"); assert.equal(manifest.version, "1.2.0");
  assert.deepEqual(manifest.requires, [{ service: "twitch.api", min: 2 }], "exige la Chaîne Twitch qui sait dire qui est en direct (1.6.0)");
  assert.ok(!("consumes" in manifest) && !("offers" in manifest));
  assert.deepEqual(manifest.provides.map((p) => p.topic), ["stream.partner"], "1.1.0 : le seul lien est un sujet, facultatif pour ceux qui le lisent");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "routes", "storage", "topics"]);
  assert.ok(manifest.mcp.every((t) => t.readOnly === true && t.default === false), "lecture seule, jamais accordé d'office");
  assert.deepEqual(manifest.mcp.map((t) => t.name), ["raid_partners_live"]);
  const s = manifest.settings; assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].advanced, s[0].optional], ["channel", true, true]);
  assert.ok(manifest.privacy.fr && manifest.privacy.en);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(def.routes).sort(), ["dock", "live", "pick"]);
});

/* ───────────── Pseudos ───────────── */

test("pseudos : pseudo, @pseudo et adresses twitch.tv sont reconnus ; 4 à 25 caractères, lettres, chiffres et _ ; messages d'erreur distincts", () => {
  for (const ok of ["emma_live", "@Emma_Live", "  EMMA_live ", "https://twitch.tv/emma_live", "http://www.twitch.tv/Emma_Live/", "twitch.tv/emma_live?sr=a", "https://m.twitch.tv/emma_live#x", "TWITCH.TV/emma_live/about", "abcd", "a".repeat(25)])
    assert.equal(pure.normalizeLogin(ok).login, ok.includes("aaaa") ? ok : ok === "abcd" ? "abcd" : "emma_live", ok);
  for (const bad of ["abc", "a".repeat(26), "emma live", "emma-live", "émma_live", "emma.live", "<b>x</b>", "emma_live!", "@@emma", "https://twitch.tv/", "https://example.org/emma_live", "emma_live/../x"])
    assert.equal(pure.normalizeLogin(bad).error, bad === "" ? "empty" : "invalid", bad);
  assert.equal(pure.normalizeLogin("").error, "empty"); assert.equal(pure.normalizeLogin(null).error, "empty");
  assert.equal(pure.normalizeLogin("https://www.twitch.tv/videos/123456").error, "not_channel", "une adresse de vidéo n'est pas une chaîne");
  assert.equal(pure.normalizeLogin("twitch.tv/directory").error, "not_channel");
  assert.deepEqual(pure.splitList("alice\r\nbob_x, carl;dave  \n\n"), ["alice", "bob_x", "carl", "dave"]);
  assert.deepEqual(pure.splitList("alice_tv bob_x  @carl_99"), ["alice_tv", "bob_x", "@carl_99"], "des pseudos séparés par des espaces");
  assert.deepEqual(pure.splitList("Ma super chaîne\nalice_tv bob mauvais!"), ["Ma super chaîne", "alice_tv bob mauvais!"], "un mot douteux : la ligne entière est refusée plus tard");
  assert.equal(pure.splitList("xxxx\n".repeat(1000)).length, 1000, "des centaines de pseudos collés d'un coup");
  assert.equal(pure.splitList("xxxx\n".repeat(9000)).length, 5000, "plafond de sécurité très au-dessus de la liste");
});

/* ───────────── Liste ───────────── */

test("liste : ajout groupé (un par ligne, adresses, @), doublons et erreurs dits sans bloquer le reste, 2000 au plus, ordre gardé", async () => {
  const ctx = mk();
  const r = await data.addPartners(ctx, "alice_tv\n@Bob_X\nhttps://twitch.tv/carl_99/\nALICE_TV\nmauvais pseudo!\nab\nhttps://twitch.tv/videos/1");
  assert.deepEqual(r.added, ["alice_tv", "bob_x", "carl_99"]);
  assert.deepEqual(r.dup, ["alice_tv"]);
  assert.deepEqual(r.bad.map((b) => [b.text, b.error]), [["mauvais pseudo!", "invalid"], ["ab", "invalid"], ["https://twitch.tv/videos/1", "not_channel"]], "une ligne douteuse est refusée en entier : jamais des chaînes inventées à partir de ses mots");
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), ["alice_tv", "bob_x", "carl_99"]);
  assert.deepEqual((await data.addPartners(ctx, "alice_tv")).added, [], "rien d'ajouté, rien d'écrit");
  const big = mk();
  const full = await data.addPartners(big, logins(pure.MAX_PARTNERS + 5));
  assert.equal(full.added.length, 2000); assert.equal(full.full.length, 5);
  assert.equal((await data.readPartners(big)).length, 2000);
  assert.equal((await ctx.api.store.count("partners")), 1, "une liste = un seul document");
});

test("liste : modifier (pseudo, nom, note), refuser un doublon, retirer, monter et descendre", async () => {
  const ctx = mk();
  await data.addPartners(ctx, "alice_tv bob_x carl_99");
  assert.deepEqual(await data.updatePartner(ctx, "bob_x", { newLogin: "https://twitch.tv/Bobby_X", name: "  Bobby \n le grand ", note: "a raidé\nla semaine dernière" }), { ok: true, login: "bobby_x" });
  assert.deepEqual((await data.readPartners(ctx)).map((p) => [p.login, p.name, p.note]), [["alice_tv", "", ""], ["bobby_x", "Bobby le grand", "a raidé la semaine dernière"], ["carl_99", "", ""]]);
  assert.equal((await data.updatePartner(ctx, "bobby_x", { newLogin: "alice_tv" })).error, "dup");
  assert.equal((await data.updatePartner(ctx, "bobby_x", { newLogin: "x" })).error, "invalid");
  assert.equal((await data.updatePartner(ctx, "inconnu_x", { newLogin: "abcd" })).error, "missing");
  assert.deepEqual(await data.movePartner(ctx, "carl_99", -1), { ok: true, moved: true });
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), ["alice_tv", "carl_99", "bobby_x"]);
  assert.equal((await data.movePartner(ctx, "alice_tv", -1)).moved, false, "déjà en haut");
  assert.equal((await data.movePartner(ctx, "bobby_x", 1)).moved, false, "déjà en bas");
  assert.deepEqual(await data.removePartner(ctx, "carl_99"), { ok: true });
  assert.equal((await data.removePartner(ctx, "carl_99")).error, "missing");
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), ["alice_tv", "bobby_x"]);
});

/* ───────────── Secret du dock ───────────── */

test("secret : créé une seule fois (même en simultané), renouvelable (l'ancien ne marche plus), comparé à temps constant, jamais accepté vide ou démesuré", async () => {
  const ctx = mk();
  const [a, b, c] = await Promise.all([data.dockSecret(ctx), data.dockSecret(ctx), data.dockSecret(ctx)]);
  assert.ok(a.length >= 30 && /^[A-Za-z0-9_-]+$/.test(a), "192 bits, sûr dans une adresse");
  assert.equal(await data.dockSecret(ctx), await data.dockSecret(ctx));
  assert.equal(new Set([a, b, c, await data.dockSecret(ctx)]).size, 1, "jamais deux secrets");
  assert.equal(await ctx.api.store.count("dock"), 1);
  assert.equal(await data.secretMatches(ctx, a), true);
  for (const bad of ["", undefined, null, a.slice(0, -1), a + "x", "x".repeat(500), 12345, [a]]) assert.equal(await data.secretMatches(ctx, bad), false);
  const fresh = await data.renewSecret(ctx);
  assert.notEqual(fresh, a);
  assert.equal(await data.secretMatches(ctx, a), false, "l'ancienne adresse ne marche plus");
  assert.equal(await data.secretMatches(ctx, fresh), true);
  assert.equal(await data.secretMatches(mk(), "n'importe"), false, "aucun secret créé par une simple vérification");
  assert.equal(await mk().api.store.count("dock"), 0);
  assert.match(fs.readFileSync(`${DIR}/data.mjs`, "utf8"), /timingSafeEqual/, "comparaison à temps constant");
});

test("secret : si deux secrets ont été créés en même temps, le plus ancien fait foi et l'autre est retiré", async () => {
  const ctx = mk();
  const first = await ctx.api.store.add("dock", { secret: "A".repeat(32) });
  await new Promise((r) => setTimeout(r, 5));
  await ctx.api.store.add("dock", { secret: "B".repeat(32) });
  assert.equal(await data.dockSecret(ctx), "A".repeat(32));
  assert.equal(await ctx.api.store.count("dock"), 1);
  assert.ok(await ctx.api.store.get(first));
});

/* ───────────── Qui est en direct ───────────── */

test("direct : UN appel groupé (jusqu'à 100 pseudos, first=100), seuls les partenaires en direct, nom affiché de la personne prioritaire, tout nettoyé", async () => {
  const ctx = mk();
  api.streams = [row("alice_tv", 12), row("bob_x", 340, { user_name: "Bob_X", title: "T".repeat(300) }), row("rediff_x", 5, { type: "" }), row("intrus_x", 9), row("carl_99", -3), row("dave_x", 4, { started_at: "pas une date" }), row("alice_tv", 99)];
  await data.addPartners(ctx, "alice_tv bob_x rediff_x carl_99 dave_x erin_off");
  await data.updatePartner(ctx, "alice_tv", { name: "Alice la Grande", note: "secret perso" });
  const partners = await data.readPartners(ctx);
  const r = await live.liveNow(ctx, partners, {});
  assert.equal(r.state, "ok"); assert.equal(r.listed, 6);
  assert.deepEqual(r.live.map((x) => [x.login, x.name, x.viewers]), [["alice_tv", "Alice la Grande", 12], ["bob_x", "Bob_X", 340]], "ni rediffusion, ni inconnu, ni nombre ou date invalide, ni doublon");
  assert.equal(r.live[1].title.length, 140, "titre coupé");
  assert.ok(!JSON.stringify(r).includes("secret perso"), "la note ne sort pas");
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0], { as: "app", method: "GET", path: "streams", query: { user_login: ["alice_tv", "bob_x", "rediff_x", "carl_99", "dave_x", "erin_off"], first: 100 }, channel: "emma_live" });
});

test("direct : aucun partenaire en direct → liste vide (pas une erreur) ; liste vide → état dédié, sans appeler Twitch", async () => {
  const ctx = mk();
  await data.addPartners(ctx, "alice_tv");
  assert.deepEqual((await live.liveNow(ctx, await data.readPartners(ctx), {})).live, []);
  live.resetLive(); api.calls.length = 0;
  assert.deepEqual(await live.liveNow(ctx, [], {}), { state: "no_partners" });
  assert.equal(api.calls.length, 0);
});

test("direct : la réponse est gardée 30 s et partagée (dix docks = un appel) ; elle est refaite quand la liste change", async () => {
  const ctx = mk(); const partners = P("alice_tv", "bob_x");
  api.streams = [row("alice_tv", 1)];
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const results = await Promise.all(Array.from({ length: 10 }, () => live.liveNow(ctx, partners, {})));
  assert.equal(api.calls.length, 1, "dix demandes simultanées, un appel");
  assert.ok(results.every((x) => x === results[0]));
  mock.timers.setTime(1_000_000 + 29_000); await live.liveNow(ctx, partners, {});
  assert.equal(api.calls.length, 1, "encore en cache à 29 s");
  mock.timers.setTime(1_000_000 + 31_000); await live.liveNow(ctx, partners, {});
  assert.equal(api.calls.length, 2, "refait après 30 s");
  await live.liveNow(ctx, P("alice_tv", "bob_x", "carl_99"), {});
  assert.equal(api.calls.length, 3, "une liste modifiée ne sert pas l'ancienne réponse");
});

test("direct : Chaîne Twitch pas prête → « not_ready » avec la cause ; application refusée ; Chaîne Twitch trop ancienne ; chaîne choisie inconnue", async () => {
  const partners = P("alice_tv");
  const ask = async (setup, settings = {}) => { live.resetLive(); api = fakeApi(); setup(); return live.liveNow(mk(), partners, settings); };
  assert.deepEqual(await ask(() => { api.accounts = [{ ok: true, channel: "emma_live", ready: false, adminPath: "/admin/instances/id-tw" }]; }), { state: "not_ready", reason: "setup", adminPath: "/admin/instances/id-tw" });
  assert.equal((await ask(() => { api.accounts = [{ ok: true, channel: "", ready: false }]; })).reason, "setup");
  assert.equal((await ask(() => { api.accounts = []; })).reason, "no_channel");
  assert.equal((await ask(() => {}, { channel: "autre_chaine" })).reason, "channel_unknown");
  assert.equal((await ask(() => { api.reply = { ok: false, error: "auth" }; })).reason, "refused");
  assert.equal((await ask(() => { api.reply = { ok: false, error: "config" }; })).reason, "refused");
  assert.equal((await ask(() => { api.reply = { ok: false, error: "forbidden" }; })).reason, "outdated", "Chaîne Twitch d'avant la 1.6.0");
  live.resetLive();
  const none = await live.liveNow(fakeCtx({ key: "raid", moduleId: "twitch-raid", permissions: manifest.permissions }), partners, {});
  assert.deepEqual([none.state, none.reason], ["not_ready", "no_channel"], "aucune Chaîne Twitch installée");
});

test("direct : Twitch en panne → erreur propre, gardée 15 s ; la dernière liste connue (10 min au plus) est jointe pour que le dock ne se vide pas", async () => {
  const ctx = mk(); const partners = P("alice_tv");
  mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  api.streams = [row("alice_tv", 7)];
  assert.equal((await live.liveNow(ctx, partners, {})).state, "ok");
  api.reply = { ok: false, error: "network" };
  mock.timers.setTime(5_000_000 + 40_000);
  const bad = await live.liveNow(ctx, partners, {});
  assert.deepEqual([bad.state, bad.reason, bad.stale.live.map((x) => x.login)], ["error", "network", ["alice_tv"]]);
  const calls = api.calls.length;
  mock.timers.setTime(5_000_000 + 50_000); await live.liveNow(ctx, partners, {});
  assert.equal(api.calls.length, calls, "après une erreur, Twitch n'est pas harcelé (15 s)");
  api.reply = { ok: false, error: "rate" };
  mock.timers.setTime(5_000_000 + 60_000);
  assert.equal((await live.liveNow(ctx, partners, {})).reason, "rate");
  mock.timers.setTime(5_000_000 + 11 * 60_000);
  assert.equal((await live.liveNow(ctx, partners, {})).stale, undefined, "une liste de plus de 10 minutes n'est plus montrée");
  api.reply = { ok: true, status: 400, json: {} };
  mock.timers.setTime(5_000_000 + 12 * 60_000);
  assert.deepEqual((await live.liveNow(ctx, partners, {})).reason, "twitch");
  api.reply = { ok: true, status: 200, json: { oops: true } };
  mock.timers.setTime(5_000_000 + 13 * 60_000);
  assert.equal((await live.liveNow(ctx, partners, {})).reason, "twitch", "une réponse illisible est une erreur, pas « personne en direct »");
});

/* ───────────── Attentes bornées : le « trou noir » ───────────── */

const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };

test("trou noir : un service Twitch qui ne répond JAMAIS → erreur propre dans le délai, pour tous les appelants, puis le dock redevient normal", async () => {
  Object.assign(live.timing, { callMs: 120, failMs: 10 });
  const ctx = mk(); const partners = P("alice_tv");
  api.wait = () => new Promise(() => {});
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(live.liveNow(ctx, partners, {})), within(live.liveNow(ctx, partners, {}))]);
  assert.deepEqual([a.state, a.reason, b.state, b.reason], ["error", "network", "error", "network"]);
  assert.ok(Date.now() - t0 < 1000, "la borne joue, pas l'attente");
  assert.equal(api.calls.length, 1, "les deux demandes partageaient le même appel");
  // le travail oublié ne bloque pas la suivante : l'entrée partagée a été retirée
  await new Promise((r) => setTimeout(r, 30));
  api.wait = null; api.streams = [row("alice_tv", 3)];
  const ok = await within(live.liveNow(ctx, partners, {}));
  assert.notEqual(ok, HUNG); assert.equal(ok.state, "ok");
});

test("trou noir : un service qui ne répond pas au « compte » (avant l'appel) est borné lui aussi ; routes et MCP répondent quand même", async () => {
  Object.assign(live.timing, { callMs: 120, failMs: 10 });
  const ctx = mk({ serviceInstances: { "twitch.api": [{ instance: "tw", methods: { account: () => new Promise(() => {}), request: () => new Promise(() => {}) } }] } });
  await data.addPartners(ctx, "alice_tv");
  const secret = await data.dockSecret(ctx);
  const t0 = Date.now();
  const res = await within(def.routes.live(new Request(`https://site.example.test/m/raid/live?k=${secret}`), ctx));
  assert.notEqual(res, HUNG); assert.equal(res.status, 200);
  assert.deepEqual([(await res.json()).state, (await within(def.mcp.raid_partners_live(ctx, {}))).state], ["error", "error"]);
  assert.ok(Date.now() - t0 < 1200);
});

test("trou noir : la page d'administration ne reste pas suspendue à Chaîne Twitch", async () => {
  const ctx = mk({ serviceInstances: { "twitch.api": [{ instance: "tw", methods: { account: () => new Promise(() => {}) } }] } });
  const t0 = Date.now();
  const blocks = await within(admin.panel(ctx, { query: {} }), 6000);
  assert.notEqual(blocks, HUNG);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(blocks.some((b) => b.type === "copy"), "l'adresse du dock est montrée quand même");
});

/* ───────────── Les routes publiques ───────────── */

const get = (ctx, route, k, extra = "") => def.routes[route](new Request(`https://site.example.test/m/raid/${route}${k === undefined ? "" : `?k=${encodeURIComponent(k)}`}${extra}`), ctx);

test("routes : sans le bon secret → rien (une phrase, aucune donnée), jamais d'écriture, GET seulement", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv"); api.streams = [row("alice_tv", 4)];
  const secret = await data.dockSecret(ctx);
  for (const k of [undefined, "", "faux", secret.slice(1), `${secret}x`, "x".repeat(1000)]) {
    const page = await get(ctx, "dock", k), json = await get(ctx, "live", k);
    assert.equal(page.status, 403); assert.equal(json.status, 403);
    assert.deepEqual(await json.json(), { state: "denied" });
    const html = await page.text();
    assert.ok(html.includes("Cette adresse n") && !html.includes("alice_tv") && !html.includes("<script"), "ni liste, ni script");
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  assert.equal(api.calls.length, 0, "sans secret, Twitch n'est jamais interrogé");
  for (const route of ["dock", "live"]) for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await def.routes[route](new Request(`https://site.example.test/m/raid/${route}?k=${secret}`, { method, body: "x" }), ctx);
    assert.equal(res.status, 405, `${route} ${method}`);
  }
  assert.equal(await ctx.api.store.count("dock"), 1, "les routes publiques ne créent rien");
});

test("route live : avec le bon secret, l'état et les partenaires en direct (public seulement), l'heure du serveur, rien de mis en cache", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv bob_x"); await data.updatePartner(ctx, "bob_x", { newLogin: "bob_x", note: "NOTE-PRIVEE" });
  api.streams = [row("bob_x", 340), row("alice_tv", 12)];
  const secret = await data.dockSecret(ctx);
  const res = await get(ctx, "live", secret);
  assert.equal(res.status, 200);
  for (const [h, v] of [["cache-control", "no-store"], ["referrer-policy", "no-referrer"], ["x-robots-tag", "noindex, nofollow"], ["content-type", "application/json; charset=utf-8"]]) assert.equal(res.headers.get(h), v);
  const body = await res.json();
  assert.equal(body.state, "ok"); assert.equal(typeof body.now, "number"); assert.equal(body.listed, 2);
  assert.deepEqual(body.live.map((x) => Object.keys(x).sort()), body.live.map(() => ["game", "login", "name", "pos", "startedAt", "title", "viewers"]));
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("NOTE-PRIVEE") && !raw.includes(secret), "ni note, ni secret dans les données");
  assert.deepEqual((await (await get(mk(), "live", secret)).json()).state, "denied", "un autre site (autre secret) ne s'ouvre pas avec celui-ci");
});

test("route dock : page complète, politique de sécurité stricte (scripts à nonce, rien d'extérieur), aucune donnée de partenaire dans la page, ni journal du secret", async () => {
  const logs = []; for (const m of ["log", "error", "warn", "info", "debug"]) mock.method(console, m, (...a) => logs.push(a.join(" ")));
  const ctx = mk(); await data.addPartners(ctx, "alice_tv"); api.streams = [row("alice_tv", 4, { title: "<img src=x onerror=alert(1)>" })];
  const secret = await data.dockSecret(ctx);
  const res = await get(ctx, "dock", secret);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  const csp = res.headers.get("content-security-policy");
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
  assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'self'/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.equal(res.headers.get("cache-control"), "no-store"); assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  const html = await res.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
  assert.equal(html.match(/<script/g).length, 1, "un seul script");
  assert.ok(!/<script[^>]*src=|<link[^>]*stylesheet|<img |<iframe/i.test(html), "rien de chargé depuis l'extérieur");
  assert.ok(!html.includes("alice_tv") && !html.includes("onerror"), "la page ne contient aucune donnée : elles arrivent par la route live");
  assert.ok(html.includes(`/m/raid/live?k=${secret}`), "la page lit la route live avec le même secret");
  assert.ok(html.includes('lang="fr"') && html.includes("Partenaires en direct") && html.includes("Au hasard"));
  assert.notEqual((await get(ctx, "dock", secret)).headers.get("content-security-policy"), csp, "un nonce neuf à chaque affichage");
  const en2 = await (await get(mk({ locale: "en", messages: { ...en } }), "dock", await data.dockSecret(mk({ locale: "en", messages: { ...en } })))).text();
  assert.ok(en2.includes('lang="en"'));
  mock.restoreAll();
  assert.ok(!logs.some((l) => l.includes(secret)), "le secret n'est jamais journalisé");
  assert.ok(!/console\./.test(fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n")), "le module n'écrit rien dans les journaux");
});

test("route dock : la page de l'anglais et celle du français ont les mêmes phrases ; ?lang= choisit la langue (le cœur le gère)", async () => {
  for (const L of [fr, en]) for (const k of Object.keys(L).filter((x) => x.startsWith("dock_"))) assert.ok(L[k].trim(), k);
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("dock_")).sort(), Object.keys(en).filter((k) => k.startsWith("dock_")).sort());
});

/* ───────────── La page : les fonctions recopiées sont EXACTEMENT celles testées ───────────── */

test("page : le script se compile ; les fonctions recopiées dans la page, exécutées SANS aucun accès au module, donnent les mêmes résultats", async () => {
  const ctx = mk(); const secret = await data.dockSecret(ctx);
  const html = await (await get(ctx, "dock", secret)).text();
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new vm.Script(script), "le script de la page est du JavaScript valable");
  const shared = [pure.raidCommand, pure.sortPartners, pure.pickRandom, pure.durationText].map((f) => f.toString()).join("\n");
  assert.ok(script.includes(shared), "recopiées telles quelles");
  const sandbox = vm.createContext({});   // aucun import, aucune variable du module
  vm.runInContext(`${shared}; this.api = { raidCommand, sortPartners, pickRandom, durationText };`, sandbox);
  const items = [{ login: "b_x", viewers: 5, startedAt: 2000, pos: 1 }, { login: "a_x", viewers: 5, startedAt: 3000, pos: 0 }, { login: "c_x", viewers: 1, startedAt: 1000, pos: 2 }];
  for (const mode of pure.SORTS) assert.deepEqual(sandbox.api.sortPartners(items, mode).map((x) => x.login), pure.sortPartners(items, mode).map((x) => x.login), mode);
  assert.equal(sandbox.api.raidCommand("emma_live"), "/raid emma_live");
  assert.equal(sandbox.api.durationText(95 * 60_000), "1 h 35");
  assert.equal(sandbox.api.pickRandom(items, () => 0.5, "").login, pure.pickRandom(items, () => 0.5, "").login);
});

test("page : tout ce qui vient de Twitch ou de la liste est écrit avec textContent (jamais de HTML), la copie a deux méthodes de repli, l'actualisation est bornée", async () => {
  const code = fs.readFileSync(`${DIR}/dock.mjs`, "utf8");
  const client = code.slice(code.indexOf("const CLIENT"), code.indexOf("const CSS"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(client), "aucune insertion de HTML dans la page");
  assert.ok(client.includes("navigator.clipboard.writeText") && client.includes('execCommand("copy")') && client.includes("showManual"), "presse-papier : moderne, repli par un champ caché, puis commande à copier à la main");
  assert.ok(client.includes("AbortController") && client.includes("fetchMs"), "chaque actualisation a une limite de temps");
  assert.ok(client.includes("Math.random"), "tirage dans le navigateur");
  assert.ok(client.includes("visibilitychange"));
});

/* ───────────── Fonctions de la page ───────────── */

test("au hasard : générateur injectable, bornes, « un autre » évite le précédent, personne → null", () => {
  const items = ["a_x", "b_x", "c_x", "d_x"].map((login) => ({ login }));
  assert.equal(pure.pickRandom(items, () => 0).login, "a_x");
  assert.equal(pure.pickRandom(items, () => 0.26).login, "b_x");
  assert.equal(pure.pickRandom(items, () => 0.999999).login, "d_x");
  assert.equal(pure.pickRandom(items, () => 1).login, "d_x", "un générateur qui rendrait 1 ne sort pas de la liste");
  assert.equal(pure.pickRandom(items, () => -0.5).login, "d_x");
  assert.equal(pure.pickRandom(items, () => NaN).login, "d_x");
  assert.equal(pure.pickRandom(items, () => 0, "a_x").login, "b_x", "pas deux fois le même de suite");
  assert.equal(pure.pickRandom(items, () => 0.999, "d_x").login, "c_x");
  assert.equal(pure.pickRandom([items[0]], () => 0.3, "a_x").login, "a_x", "un seul choix possible : on le redonne");
  assert.equal(pure.pickRandom([], () => 0.3), null);
  const seen = new Set(); let prev = ""; let seed = 7;
  const lcg = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 400; i++) { const p = pure.pickRandom(items, lcg, prev); assert.notEqual(p.login, prev); seen.add(p.login); prev = p.login; }
  assert.equal(seen.size, 4, "tous les partenaires peuvent sortir");
});

test("tri : le moins de spectateurs d'abord par défaut ; plus de spectateurs, live récent, live ancien, ordre de la liste ; égalités = ordre de la liste ; la liste n'est pas modifiée", () => {
  const items = [{ login: "a", viewers: 50, startedAt: 3000, pos: 0 }, { login: "b", viewers: 5, startedAt: 1000, pos: 1 }, { login: "c", viewers: 5, startedAt: 2000, pos: 2 }, { login: "d", viewers: 200, startedAt: 500, pos: 3 }];
  const order = (m) => pure.sortPartners(items, m).map((x) => x.login).join("");
  assert.equal(order("viewers_asc"), "bcad"); assert.equal(order("viewers_desc"), "dabc");
  assert.equal(order("newest"), "acbd"); assert.equal(order("oldest"), "dbca"); assert.equal(order("mine"), "abcd");
  assert.equal(order("n'importe quoi"), "bcad", "mode inconnu = par défaut");
  assert.equal(items.map((x) => x.login).join(""), "abcd");
  assert.equal(pure.SORTS[0], "viewers_asc");
});

test("presse-papier : la commande est /raid pseudo, et rien si le pseudo n'est pas valable (jamais de texte venu de Twitch)", () => {
  assert.equal(pure.raidCommand("emma_live"), "/raid emma_live");
  for (const bad of ["", null, undefined, "a b", "x;rm", "/raid x", "a\nb", "ab", "é_é_é", "x".repeat(26)]) assert.equal(pure.raidCommand(bad), "", String(bad));
  assert.equal(pure.durationText(0), "< 1 min"); assert.equal(pure.durationText(59_000), "< 1 min"); assert.equal(pure.durationText(42 * 60_000), "42 min");
  assert.equal(pure.durationText(65 * 60_000), "1 h 05"); assert.equal(pure.durationText(10 * 3_600_000 + 7 * 60_000), "10 h 07"); assert.equal(pure.durationText(-5), "< 1 min"); assert.equal(pure.durationText("x"), "< 1 min");
});

/* ───────────── Administration ───────────── */

const act = (ctx, name, values = {}) => admin.actions[name](ctx, values);

test("admin : l'adresse du dock (copiable) avec le secret, les étapes pour OBS, le tableau, le formulaire d'ajout ; avertissement actionnable si Chaîne Twitch n'est pas réglée", async () => {
  api.accounts = [{ ok: true, channel: "emma_live", ready: false, adminPath: "/admin/instances/id-tw" }];
  const ctx = mk();
  let blocks = await def.adminPanel(ctx, { query: {} });
  const secret = await data.dockSecret(ctx);
  const copy = blocks.find((b) => b.type === "copy");
  assert.equal(copy.text, `https://site.example.test/m/raid/dock?k=${secret}`);
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("Docks de navigateur personnalisés")));
  const warn = blocks.find((b) => b.type === "banner");
  assert.deepEqual([warn.tone, warn.href], ["warning", "/admin/instances/id-tw"]);
  assert.match(warn.text, /Réglez d'abord votre chaîne dans Chaîne Twitch/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "add"));
  const renew = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "renew");
  assert.deepEqual([renew.rowActions[0].danger, typeof renew.rowActions[0].confirm], [true, "string"], "« Nouvelle adresse » demande confirmation");
  api.accounts = [{ ok: true, channel: "emma_live", ready: true }];
  blocks = await def.adminPanel(mk(), { query: {} });
  assert.ok(!blocks.some((b) => b.type === "banner"), "tout est prêt : pas d'avertissement");
  const en2 = await def.adminPanel(mk({ locale: "en", messages: { ...en } }), { query: {} });
  assert.ok(en2.some((b) => b.type === "markdown" && b.text.includes("Custom Browser Docks")));
});

test("admin : ajouter (messages clairs, partiel accepté), modifier, monter, descendre, retirer (confirmé), nouvelle adresse (confirmée), « tout est prêt ? »", async () => {
  const ctx = mk();
  const none = await act(ctx, "add", { logins: "pseudo invalide!" });
  assert.ok(none.error && /pas un pseudo Twitch valable/.test(none.error) && /4 à 25/.test(none.error), none.error);
  const some = await act(ctx, "add", { logins: "alice_tv\nbob_x\nalice_tv\n??" });
  assert.deepEqual(Object.keys(some), ["ok"], "un résultat partiel reste sur la page pour que le message soit lu");
  assert.deepEqual(Object.keys(await act(ctx, "add", { logins: "carl_99" })).sort(), ["ok", "redirect"], "tout est bon : retour à la liste");
  await data.removePartner(ctx, "carl_99");
  assert.match(some.ok, /Ajouté : alice_tv, bob_x\./); assert.match(some.ok, /Déjà dans votre liste : « alice_tv »/); assert.match(some.ok, /« \?\? » n'est pas un pseudo/);
  assert.match((await act(ctx, "add", { logins: "alice_tv" })).error, /Déjà dans votre liste/);
  assert.match((await act(ctx, "add", { logins: "" })).error, /rien à ajouter/);
  assert.equal((await act(ctx, "save", { id: "bob_x", login: "https://twitch.tv/bob_x", name: "Bob", note: "ami" })).ok, "Enregistré.");
  assert.match((await act(ctx, "save", { id: "bob_x", login: "alice_tv" })).error, /Déjà dans votre liste/);
  assert.match((await act(ctx, "save", { id: "bob_x", login: "x" })).error, /n'est pas un pseudo/);
  assert.match((await act(ctx, "save", { id: "inconnu_x", login: "abcd" })).error, /n'est plus dans la liste/);
  await act(ctx, "down", { id: "alice_tv" });
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), ["bob_x", "alice_tv"]);
  await act(ctx, "up", { id: "alice_tv" });
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), ["alice_tv", "bob_x"]);
  const table = (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "table" && b.rowIds?.includes("alice_tv"));
  assert.deepEqual(table.rowActions.map((a) => a.label), ["Modifier", "Monter", "Descendre", "Retirer"]);
  assert.deepEqual([table.rowActions[3].danger, typeof table.rowActions[3].confirm], [true, "string"]);
  assert.match((await act(ctx, "remove", { id: "alice_tv" })).ok, /retirée/);
  assert.match((await act(ctx, "remove", { id: "alice_tv" })).error, /n'est plus dans la liste/);
  const before = await data.dockSecret(ctx);
  assert.match((await act(ctx, "renew")).ok, /nouvelle adresse/);
  assert.notEqual(await data.dockSecret(ctx), before);
  const edit = await def.adminPanel(ctx, { query: { edit: "bob_x" } });
  const form = edit.find((b) => b.type === "adminForm" && b.action === "save");
  assert.deepEqual(form.fields.map((f) => [f.name, f.value]), [["id", "bob_x"], ["login", "bob_x"], ["name", "Bob"], ["note", "ami"]]);
  assert.ok(!edit.some((b) => b.type === "adminForm" && b.action === "add"), "un seul formulaire à la fois");
});

test("admin : « Voir qui est en direct maintenant » dit ce qui va ou ce qu'il faut régler", async () => {
  const ctx = mk();
  assert.match((await act(ctx, "check")).error, /liste de partenaires est vide/);
  await data.addPartners(ctx, "alice_tv bob_x");
  api.streams = [row("alice_tv", 4)];
  assert.match((await act(ctx, "check")).ok, /En direct maintenant : ALICE_TV/);
  api.streams = [];
  assert.match((await act(ctx, "check")).ok, /personne n'est en direct pour le moment. Chaînes dans votre liste : 2/);
  api.accounts = [{ ok: true, channel: "emma_live", ready: false }];
  assert.match((await act(ctx, "check")).error, /Réglez d'abord votre chaîne dans Chaîne Twitch/);
  api.accounts = [{ ok: true, channel: "emma_live", ready: true }]; api.reply = { ok: false, error: "network" };
  assert.match((await act(ctx, "check")).error, /Twitch ne répond pas/);
});

/* ───────────── Assistant (MCP), sauvegarde ───────────── */

test("MCP : partenaires en direct, le moins de spectateurs d'abord, avec la commande (rien n'est envoyé) ; états d'erreur lisibles ; ni note ni secret", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv bob_x carl_99");
  await data.updatePartner(ctx, "carl_99", { newLogin: "carl_99", note: "NOTE-PRIVEE" });
  api.streams = [row("bob_x", 340), row("alice_tv", 12, { started_at: new Date(Date.now() - 90 * 60_000).toISOString() })];
  const r = await def.mcp.raid_partners_live(ctx, {});
  assert.deepEqual(r.live.map((x) => [x.channel, x.viewers, x.raidCommand]), [["alice_tv", 12, "/raid alice_tv"], ["bob_x", 340, "/raid bob_x"]]);
  assert.equal(r.live[0].liveForMinutes, 90); assert.equal(r.listed, 3);
  assert.ok(!JSON.stringify(r).includes("NOTE-PRIVEE") && !JSON.stringify(r).includes(await data.dockSecret(ctx)));
  live.resetLive(); api.reply = { ok: false, error: "rate" };
  assert.deepEqual(await def.mcp.raid_partners_live(ctx, {}), { state: "error", reason: "rate", listed: 3, live: [] });
});

test("sauvegarde lisible : la liste en CSV, sans formule dangereuse, sans le secret", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv");
  await data.updatePartner(ctx, "alice_tv", { newLogin: "alice_tv", name: '=HYPERLINK("x")', note: 'dit "bonjour"' });
  const files = await def.backup.readable(ctx);
  assert.equal(files[0].path, "partners.csv");
  assert.equal(files[0].content, `channel,name,note\r\n"alice_tv","'=HYPERLINK(""x"")","dit ""bonjour"""`);
  assert.ok(!files[0].content.includes(await data.dockSecret(ctx)));
});

test("instance créée : l'adresse du dock existe tout de suite", async () => {
  const ctx = mk(); await def.hooks.onInstanceCreate(ctx);
  assert.equal(await ctx.api.store.count("dock"), 1);
});

/* ───────────── 1.1.0 : les partenaires proposés aux autres modules (sujet « stream.partner ») ───────────── */

const PIC = (n) => `https://static-cdn.jtvnw.net/jtv_user_pictures/u${n}-profile_image-300x300.png`;
/** Un faux « Chaîne Twitch » qui sait répondre à GET users (nom affiché et photo de profil) pour les pseudos demandés. */
function withUsers(users) {
  api.methods.request = async (args) => { api.calls.push(args); return { ok: true, status: 200, json: { data: args.query.login.map((l) => users[l]).filter(Boolean).map((u) => ({ login: u.login, display_name: u.name, profile_image_url: u.picture })) } }; };
}
const exportPartners = (ctx, opts = {}) => def.exports["stream.partner"](ctx, opts);

test("sujet « stream.partner » : pseudo, nom affiché (le sien, sinon celui de Twitch) et photo de profil ; JAMAIS la note ; photos lues en groupes de 20 pseudos au plus", async () => {
  const ctx = mk();
  await data.addPartners(ctx, "alice_tv");
  await data.updatePartner(ctx, "alice_tv", { newLogin: "alice_tv", name: "Alice à moi", note: "NOTE-SECRETE : ne pas raider le lundi" });
  await data.addPartners(ctx, "bob_x carl_99");
  withUsers({ alice_tv: { login: "alice_tv", name: "Alice", picture: PIC(1) }, bob_x: { login: "bob_x", name: "Bob Officiel", picture: PIC(2) } });
  const items = await exportPartners(ctx);
  assert.deepEqual(items, [
    { id: "alice_tv", login: "alice_tv", title: "Alice à moi", image: PIC(1) },
    { id: "bob_x", login: "bob_x", title: "Bob Officiel", image: PIC(2) },
    { id: "carl_99", login: "carl_99", title: "carl_99" },
  ]);
  for (const x of items) assert.ok(typeof x.id === "string" && x.id && typeof x.title === "string" && x.title && (!("image" in x) || /^https:\/\//.test(x.image)), "conforme au schéma du lecteur (id et title texte, image : une adresse ou rien : le cœur écarte l'élément entier si une adresse est vide)");
  assert.ok(!JSON.stringify(items).includes("NOTE-SECRETE") && !JSON.stringify(items).includes("secret"));
  assert.equal(api.calls.length, 1); assert.deepEqual(api.calls[0], { as: "app", method: "GET", path: "users", query: { login: ["alice_tv", "bob_x", "carl_99"] }, channel: "emma_live" });
  // 45 partenaires = 3 demandes de 20, 20 et 5 pseudos
  const big = mk(); await data.addPartners(big, logins(45));
  api.calls.length = 0; partnersMod.resetPartners();
  const many = await exportPartners(big);
  assert.equal(many.length, 45); assert.deepEqual(api.calls.map((c) => c.query.login.length).sort((a, b) => b - a), [20, 20, 5]);
  assert.deepEqual((await exportPartners(big, { limit: 3 })).map((x) => x.login), ["chaine_000", "chaine_001", "chaine_002"]);
  assert.deepEqual(await exportPartners(mk()), [], "aucun partenaire : rien");
});

test("sujet « stream.partner » : une photo n'est reprise que si elle vient du serveur d'images de Twitch ; un nom de Twitch piégé est nettoyé ; aucune photo gardée par ce module", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv bob_x carl_99");
  withUsers({ alice_tv: { login: "alice_tv", name: "<b>Alice</b>\u0000\n" + "x".repeat(100), picture: "https://evil.example/a.png" }, bob_x: { login: "bob_x", name: "Bob", picture: "javascript:alert(1)" }, carl_99: { login: "carl_99", name: "Carl", picture: "https://static-cdn.jtvnw.net/jtv_user_pictures/../../x.png" } });
  const items = await exportPartners(ctx);
  assert.deepEqual(items.map((x) => x.image), [undefined, undefined, undefined], "aucune photo douteuse : la clé est absente (jamais une adresse vide)");
  assert.ok(items[0].title.length <= 40 && !items[0].title.includes("\u0000"));
  assert.ok(!(await ctx.api.store.list("partners")).some((r) => JSON.stringify(r.data).includes("profile_image")), "les photos ne sont pas copiées dans la liste : Twitch en reste propriétaire");
  assert.equal(JSON.stringify(partnersMod.readUsers({ data: [{ login: "x", profile_image_url: PIC(1), display_name: 5 }, null, "x", { login: "" }] })), JSON.stringify({ x: { name: "", image: PIC(1) } }));
  assert.deepEqual(partnersMod.readUsers(null), {}); assert.deepEqual(partnersMod.readUsers({ data: "x" }), {});
});

test("sujet « stream.partner » : Chaîne Twitch absente, pas prête, qui refuse (version ancienne) ou en erreur → les partenaires sont rendus SANS photo, sans erreur ; réponse gardée 6 h, un échec 1 minute", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv bob_x");
  const plain = [{ id: "alice_tv", login: "alice_tv", title: "alice_tv" }, { id: "bob_x", login: "bob_x", title: "bob_x" }];
  api.accounts = [{ ok: true, channel: null, ready: false }]; assert.deepEqual(await exportPartners(ctx), plain);
  partnersMod.resetPartners(); api.accounts = [];
  assert.deepEqual(await exportPartners(ctx), plain);
  partnersMod.resetPartners(); api.accounts = [{ ok: true, channel: "emma_live", ready: true }];
  for (const reply of [{ ok: false, error: "forbidden" }, { ok: false, error: "network" }, { ok: true, status: 500, json: {} }, { ok: true, status: 200, json: null }]) { partnersMod.resetPartners(); api.methods.request = async () => reply; assert.deepEqual(await exportPartners(ctx), plain, JSON.stringify(reply)); }
  partnersMod.resetPartners(); api.methods.request = async () => { throw new Error("service en panne"); };
  assert.deepEqual(await exportPartners(ctx), plain);
  // cache
  partnersMod.resetPartners(); mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  let n = 0; api.methods.request = async () => { n++; return { ok: true, status: 200, json: { data: [{ login: "alice_tv", display_name: "Alice", profile_image_url: PIC(1) }] } }; };
  await exportPartners(ctx); await exportPartners(ctx); assert.equal(n, 1, "deux lectures rapprochées = une seule demande");
  mock.timers.setTime(5_000_000 + 5 * 3600_000); await exportPartners(ctx); assert.equal(n, 1, "encore gardée après 5 h");
  mock.timers.setTime(5_000_000 + 7 * 3600_000); await exportPartners(ctx); assert.equal(n, 2, "relue après 6 h");
  api.methods.request = async () => { n++; return { ok: false, error: "network" }; };
  partnersMod.resetPartners(); const before = n; await exportPartners(ctx); await exportPartners(ctx); assert.equal(n, before + 1, "un échec est gardé : Twitch n'est pas martelé");
  mock.timers.setTime(5_000_000 + 7 * 3600_000 + 61_000); await exportPartners(ctx); assert.equal(n, before + 2, "réessayé après 1 minute");
});

test("sujet « stream.partner » : une liste modifiée est relue tout de suite (la clé du cache change avec la liste)", async () => {
  const ctx = mk(); await data.addPartners(ctx, "alice_tv");
  let n = 0; api.methods.request = async (a) => { n++; return { ok: true, status: 200, json: { data: a.query.login.map((l) => ({ login: l, display_name: l, profile_image_url: PIC(1) })) } }; };
  assert.equal((await exportPartners(ctx)).length, 1); await data.addPartners(ctx, "bob_x");
  assert.equal((await exportPartners(ctx)).length, 2); assert.equal(n, 2);
});

// Raid Twitch 2.0.0 : le dock (adresse secrète, page, données), les attentes bornées, le presse-papier (fonctions de la page), l'administration.
// La liste de raid vit dans Contacts (une catégorie) : elle est préparée dans le FAUX Contacts du contrat (tests/helpers/fakeContactBook.mjs), jamais dans le vrai module.
// Aucun réseau : Chaîne Twitch est remplacée par un faux service `twitch.api` ; la page du navigateur est vérifiée à part (voir README du dépôt : essais en navigateur réel faits à la livraison).
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";

const DIR = new URL("../modules/twitch-raid", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const def = (await import("../modules/twitch-raid/index.mjs")).default;
const pure = await import("../modules/twitch-raid/pure.mjs");
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const dock = await import("../modules/twitch-raid/dock.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");
const source = await import("../modules/twitch-raid/source.mjs");

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
let api, book, CAT;
const mk = (extra = {}, settings = {}) => fakeCtx({
  key: "raid", moduleId: "twitch-raid", locale: "fr", defaultLocale: "fr", messages: { ...fr }, settings, siteUrl: "https://site.example.test", permissions: manifest.permissions,
  services: { "contact.book": book.methods },
  serviceInstances: { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods: api.methods }] }, ...extra,
});
/** 2.0 : la liste de raid = les fiches de la catégorie « Cible de raid » du faux Contacts. `addPartners("a b")` y range des fiches, comme la personne le ferait dans Contacts. */
const addPartners = (text, { name, note } = {}) => {
  for (const login of String(text).split(/\s+/).filter(Boolean)) {
    const { id } = book.seedContact({ name: name ?? login, accounts: [{ network: "twitch", handle: login }], categoryIds: [CAT] });
    if (note) book.methods.note({ id, text: note });
  }
  source.resetSource();
};
const readPartners = async (ctx) => (await source.targets(ctx)).partners;
const contactOf = (login) => book.dump().contacts.find((c) => c.accounts.some((a) => a.handle === login));
const timing0 = { ...live.timing };
const stiming0 = { ...source.timing };
beforeEach(() => { api = fakeApi(); book = fakeContactBook(); CAT = book.seedCategory("Cible de raid"); live.resetLive(); source.resetSource(); Object.assign(live.timing, timing0); });
afterEach(() => { mock.timers.reset(); Object.assign(live.timing, timing0); });
const P = (...l) => l.map((login) => ({ login, name: "", note: "" }));

/* ───────────── Manifeste ───────────── */

test("manifeste 2.0 : la liste vient de Contacts (contact.book v2, dur), un réglage « Liste de raid » (choix d'une catégorie, création à la volée), vie privée offerte, MCP inchangé", () => {
  assert.equal(manifest.id, "twitch-raid"); assert.equal(manifest.version, "2.2.2"); assert.equal(manifest.minCore, "0.2.12"); assert.equal(manifest.pageSetting, "publicPage");   // 2.2 : la page publique a son propre script (cœur 0.2.6)
  assert.equal(manifest.dataVersion, 3);
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.min ?? 1, !!r.optional]), [["twitch.api", 3, false], ["twitch.live", 1, false], ["contact.book", 2, false], ["contact.curate", 1, false]], "sans Contacts, Raid n'a plus de liste : besoin dur ; son extension sert à ajouter et retirer");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.each]), [["privacy.subject", true]], "qui lit contact.book offre privacy.subject");
  assert.deepEqual(Object.keys(def.services["privacy.subject"]).sort(), ["erase", "export", "remap"]);
  const [cat, ch] = manifest.settings;
  assert.deepEqual([cat.key, cat.type, cat.refersTo, cat.allowCreate, cat.optional], ["category", "choice", "category", true, true]);
  assert.deepEqual(cat.source, { kind: "service", service: "contact.book", list: "categories", get: "categoriesResolve", create: "createCategory" });
  assert.ok(!("default" in cat) && !("translatable" in cat), "un choix n'a ni défaut ni traduction");
  assert.deepEqual([ch.key, ch.type, ch.source, ch.fromText, ch.refersTo, ch.advanced, ch.optional], ["channel", "choice", { kind: "providers", service: "twitch.live" }, true, "channel", true, true]);
  assert.deepEqual(manifest.settings.slice(2).map((x) => x.key), ["dockMode", "count", "duration", "smallFirst", "exclude", "hide", "publicPage", "pageTitle", "pageIntro", "emptyText", "watchLabel", "thumbs"], "2.2 : les réglages de la sélection du moment s'ajoutent aux deux d'origine");
  assert.equal(typeof def.migrations[2], "function"); assert.equal(typeof def.migrations[3], "function");
  assert.ok(!("provides" in manifest) && !def.exports, "plus de sujet fourni : le sujet « stream.partner » est retiré (Story lit Contacts)");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "pages", "routes", "storage"]);
  assert.ok(manifest.mcp.every((t) => t.readOnly === true && t.default === false), "lecture seule, jamais accordé d'office");
  assert.deepEqual(manifest.mcp.map((t) => t.name), ["raid_partners_live", "raid_featured_now"]);   // 2.2 : l'outil d'origine, inchangé, puis la sélection du moment
  assert.ok(manifest.privacy.fr && manifest.privacy.en);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(def.routes).sort(), ["dock", "featured", "featured-again", "featured-data", "live", "members", "pick"]);
  assert.equal(def.backup, undefined, "plus de liste à sauvegarder ici : elle est dans Contacts (qui a son export)");
  // Raid n'appelle createCategory qu'à UN endroit (source.mjs, ensureCategory), toujours avec { asCaller: true } : les droits sont ceux de la personne qui a cliqué, vérifiés par Contacts.
  const uses = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).flatMap((f) => fs.readFileSync(`${DIR}/${f}`, "utf8").split("\n").filter((l) => /createCategory/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => `${f}: ${l.trim()}`));
  assert.equal(uses.length, 1, uses.join("\n"));
  assert.ok(uses[0].startsWith("source.mjs:") && /asCaller: true/.test(uses[0]), "createCategory : seulement ensureCategory, avec asCaller");
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
});

/* ───────────── Liste ───────────── */

test("liste (2.0) : les comptes Twitch des fiches de la catégorie, dans l'ordre de Contacts ; ni les autres fiches, ni les autres réseaux ; nom de la fiche, sinon celui de Twitch", async () => {
  const ctx = mk();
  book.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "Alice_TV" }, { network: "youtube", handle: "@alice" }], categoryIds: [CAT] });
  book.seedContact({ name: "bob_x", accounts: [{ network: "twitch", handle: "https://twitch.tv/bob_x" }], categoryIds: [CAT] });
  book.seedContact({ name: "Hors liste", accounts: [{ network: "twitch", handle: "dehors_x" }] });
  book.seedContact({ name: "Sans Twitch", accounts: [{ network: "youtube", handle: "@sans" }], categoryIds: [CAT] });
  book.seedContact({ name: "Deux chaînes", accounts: [{ network: "twitch", handle: "duo_un" }, { network: "twitch", handle: "duo_deux", displayName: "Duo Deux" }], categoryIds: [CAT] });
  const r = await source.targets(ctx);
  assert.equal(r.state, "ok"); assert.deepEqual(r.category, { id: CAT, label: "Cible de raid", how: "default" });
  assert.deepEqual(r.partners.map((p) => [p.login, p.name]), [["alice_tv", "Alice"], ["bob_x", ""], ["duo_un", "Deux chaînes"], ["duo_deux", "Duo Deux"]], "une fiche sans vrai nom (son pseudo) laisse Twitch donner le nom affiché, comme en 1.3");
  assert.ok(r.partners.every((p) => typeof p.contactId === "string"), "Raid ne garde que des identifiants de fiche, en mémoire");
  assert.deepEqual(ctx.dumpStore().filter((x) => x.collection !== "dock"), [], "rien n'est copié dans le stockage du module");
  assert.ok(book.calls.filter(([, m]) => m === "accounts").every(([, , a]) => a.network === "twitch" && a.limit === 500 && a.categoryId === CAT));
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
  addPartners("alice_tv", { name: "Alice la Grande", note: "secret perso" }); addPartners("bob_x rediff_x carl_99 dave_x erin_off");
  const partners = await readPartners(ctx);
  const r = await live.liveNow(ctx, partners, {});
  assert.equal(r.state, "ok"); assert.equal(r.listed, 6);
  assert.deepEqual(r.live.map((x) => [x.login, x.name, x.viewers]), [["alice_tv", "Alice la Grande", 12], ["bob_x", "Bob_X", 340]], "ni rediffusion, ni inconnu, ni nombre ou date invalide, ni doublon");
  assert.equal(r.live[1].title.length, 140, "titre coupé");
  assert.ok(!JSON.stringify(r).includes("secret perso"), "la note (de Contacts) ne sort pas");
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0], { as: "app", method: "GET", path: "streams", query: { user_login: ["alice_tv", "bob_x", "rediff_x", "carl_99", "dave_x", "erin_off"], first: 100 }, channel: "emma_live" });
});


test("direct : aucun partenaire en direct → liste vide (pas une erreur) ; liste vide → état dédié, sans appeler Twitch", async () => {
  const ctx = mk();
  addPartners("alice_tv");
  assert.deepEqual((await live.liveNow(ctx, await readPartners(ctx), {})).live, []);
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
  addPartners("alice_tv");
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

test("route live : avec le bon secret, l'état et les partenaires en direct (public seulement), l'heure du serveur, rien de mis en cache", async () => {
  const ctx = mk(); addPartners("alice_tv"); addPartners("bob_x", { note: "NOTE-PRIVEE" });
  api.streams = [row("bob_x", 340), row("alice_tv", 12)];
  const secret = await data.dockSecret(ctx);
  const res = await get(ctx, "live", secret);
  assert.equal(res.status, 200);
  for (const [h, v] of [["cache-control", "no-store"], ["referrer-policy", "no-referrer"], ["x-robots-tag", "noindex, nofollow"], ["content-type", "application/json; charset=utf-8"]]) assert.equal(res.headers.get(h), v);
  const body = await res.json();
  assert.equal(body.state, "ok"); assert.equal(typeof body.now, "number"); assert.equal(body.listed, 2);
  assert.deepEqual(body.live.map((x) => Object.keys(x).sort()), body.live.map(() => ["game", "login", "name", "pos", "startedAt", "title", "viewers"]));
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes("NOTE-PRIVEE") && !raw.includes(secret) && !raw.includes(contactOf("bob_x").id), "ni note, ni secret, ni identifiant de fiche dans les données");
  assert.deepEqual((await (await get(mk(), "live", secret)).json()).state, "denied", "un autre site (autre secret) ne s'ouvre pas avec celui-ci");
});

test("routes : sans le bon secret → rien (une phrase, aucune donnée), jamais d'écriture, GET seulement ; Contacts n'est même pas lu", async () => {
  const ctx = mk(); addPartners("alice_tv"); api.streams = [row("alice_tv", 4)];
  const secret = await data.dockSecret(ctx);
  const before = book.calls.length;
  for (const k of [undefined, "", "faux", secret.slice(1), `${secret}x`, "x".repeat(1000)]) {
    const page = await get(ctx, "dock", k), json = await get(ctx, "live", k);
    assert.equal(page.status, 403); assert.equal(json.status, 403);
    assert.deepEqual(await json.json(), { state: "denied" });
    const html = await page.text();
    assert.ok(html.includes("Cette adresse n") && !html.includes("alice_tv") && !html.includes("<script"), "ni liste, ni script");
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  assert.equal(api.calls.length, 0, "sans secret, Twitch n'est jamais interrogé");
  assert.equal(book.calls.length, before, "ni Contacts");
  for (const route of ["dock", "live"]) for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await def.routes[route](new Request(`https://site.example.test/m/raid/${route}?k=${secret}`, { method, body: "x" }), ctx);
    assert.equal(res.status, 405, `${route} ${method}`);
  }
  assert.equal(await ctx.api.store.count("dock"), 1, "les routes publiques ne créent rien");
});


test("route dock : page complète, politique de sécurité stricte (scripts à nonce, rien d'extérieur), aucune donnée de partenaire dans la page, ni journal du secret", async () => {
  const logs = []; for (const m of ["log", "error", "warn", "info", "debug"]) mock.method(console, m, (...a) => logs.push(a.join(" ")));
  const ctx = mk(); addPartners("alice_tv"); api.streams = [row("alice_tv", 4, { title: "<img src=x onerror=alert(1)>" })];
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

test("admin : l'adresse du dock (copiable) avec le secret, les étapes pour OBS, le compteur, le lien vers Contacts ; plus d'ajout ni de tableau ; avertissement actionnable si Chaîne Twitch n'est pas réglée", async () => {
  api.accounts = [{ ok: true, channel: "emma_live", ready: false, adminPath: "/admin/instances/id-tw" }];
  const ctx = mk(); addPartners("alice_tv bob_x");
  let blocks = await def.adminPanel(ctx, { query: {} });
  const secret = await data.dockSecret(ctx);
  const copy = blocks.find((b) => b.type === "copy");
  assert.equal(copy.text, `https://site.example.test/m/raid/dock?k=${secret}`);
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("Docks de navigateur personnalisés")));
  const warn = blocks.find((b) => b.type === "banner");
  assert.deepEqual([warn.tone, warn.href], ["warning", "/admin/instances/id-tw"]);
  assert.match(warn.text, /Réglez d'abord le Connecteur Twitch/);
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("**2** chaînes Twitch dans la catégorie « Cible de raid » de Contacts")), "un compteur");
  const link = blocks.find((b) => b.type === "links" && b.items[0].label === "Gérer mes partenaires dans Contacts");
  assert.equal(link.items[0].href, `/admin/instances/id-contact.book-provider?category=${CAT}`, "la page de Contacts, filtrée sur la catégorie");
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm" && !b.tab).map((b) => b.action), ["find", "bulkPreview", "listSearch", "check"], "ajouter (un champ, ou plusieurs lignes), chercher dans la liste, vérifier : l'ancien ajout/import/tri est resté sorti");
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm" && b.tab === "moment").map((b) => b.action), ["momentCheck", "momentReroll"], "2.2 : la sélection du moment a son onglet à part");
  assert.ok(!blocks.some((b) => b.type === "table" && b.rowActions?.some((a) => ["up", "down", "save"].includes(a.action))));
  assert.deepEqual(blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "remove").rowActions.map((a) => a.action), ["remove"], "« Retirer » seulement : la fiche reste dans Contacts");
  const renew = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "renew");
  assert.deepEqual([renew.rowActions[0].danger, typeof renew.rowActions[0].confirm], [true, "string"], "« Nouvelle adresse » demande confirmation");
  api.accounts = [{ ok: true, channel: "emma_live", ready: true }];
  blocks = await def.adminPanel(mk(), { query: {} });
  assert.ok(!blocks.some((b) => b.type === "banner" && b.tone === "warning"), "tout est prêt : pas d'avertissement");
  const en2 = await def.adminPanel(mk({ locale: "en", messages: { ...en } }), { query: {} });
  assert.ok(en2.some((b) => b.type === "markdown" && b.text.includes("Custom Browser Docks")));
});


test("admin : nouvelle adresse (confirmée) ; les actions sont celles de l'ajout rapide, de la liste et de la migration (rien de l'ancien tri)", async () => {
  const ctx = mk();
  assert.deepEqual(Object.keys(admin.actions).sort(), ["attach", "bulkApply", "bulkCancel", "bulkPreview", "check", "create", "find", "finish", "listSearch", "migrate", "momentCheck", "momentReroll", "pick", "remove", "renew"]);
  const before = await data.dockSecret(ctx);
  assert.match((await act(ctx, "renew")).ok, /nouvelle adresse/);
  assert.notEqual(await data.dockSecret(ctx), before);
});


test("admin : « Voir qui est en direct maintenant » dit ce qui va ou ce qu'il faut régler", async () => {
  const ctx = mk();
  assert.match((await act(ctx, "check")).error, /liste de raid est vide/);
  addPartners("alice_tv bob_x");
  api.streams = [row("alice_tv", 4)];
  assert.match((await act(ctx, "check")).ok, /En direct maintenant : ALICE_TV/);
  api.streams = [];
  assert.match((await act(ctx, "check")).ok, /personne n'est en direct pour le moment. Chaînes dans votre liste : 2/);
  api.accounts = [{ ok: true, channel: "emma_live", ready: false }];
  assert.match((await act(ctx, "check")).error, /Réglez d'abord le Connecteur Twitch/);
  api.accounts = [{ ok: true, channel: "emma_live", ready: true }]; api.reply = { ok: false, error: "network" };
  assert.match((await act(ctx, "check")).error, /Twitch ne répond pas/);
  book.admin.deleteCategory(CAT);
  assert.match((await act(ctx, "check")).error, /liste de raid n'existe pas encore/);
});


/* ───────────── Assistant (MCP) ───────────── */

test("MCP : partenaires en direct, le moins de spectateurs d'abord, avec la commande (rien n'est envoyé) ; états d'erreur lisibles ; ni note ni secret", async () => {
  const ctx = mk(); addPartners("alice_tv bob_x"); addPartners("carl_99", { note: "NOTE-PRIVEE" });
  api.streams = [row("bob_x", 340), row("alice_tv", 12, { started_at: new Date(Date.now() - 90 * 60_000).toISOString() })];
  const r = await def.mcp.raid_partners_live(ctx, {});
  assert.deepEqual(r.live.map((x) => [x.channel, x.viewers, x.raidCommand]), [["alice_tv", 12, "/raid alice_tv"], ["bob_x", 340, "/raid bob_x"]]);
  assert.equal(r.live[0].liveForMinutes, 90); assert.equal(r.listed, 3);
  assert.ok(!JSON.stringify(r).includes("NOTE-PRIVEE") && !JSON.stringify(r).includes(await data.dockSecret(ctx)));
  live.resetLive(); api.reply = { ok: false, error: "rate" };
  assert.deepEqual(await def.mcp.raid_partners_live(ctx, {}), { state: "error", reason: "rate", listed: 3, live: [] });
  book.admin.deleteCategory(CAT); source.resetSource();
  assert.deepEqual(await def.mcp.raid_partners_live(ctx, {}), { state: "not_ready", reason: "no_category", listed: 0, live: [] }, "plus de liste dans Contacts : dit clairement");
});


test("instance créée : l'adresse du dock existe tout de suite", async () => {
  const ctx = mk(); await def.hooks.onInstanceCreate(ctx);
  assert.equal(await ctx.api.store.count("dock"), 1);
});

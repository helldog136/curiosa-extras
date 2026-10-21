// Raid Twitch 2.0 : la liste de raid vient de Contacts (une catégorie, « Cible de raid » par défaut), la migration de l'ancienne liste (données 3),
// le dock IDENTIQUE à la 1.3 pour une liste migrée, les catégories supprimées ou fusionnées, Contacts muet, absent ou trop ancien, la vie privée.
// Contacts est TOUJOURS le double du contrat (tests/helpers/fakeContactBook.mjs), jamais le vrai module. Twitch : un faux service `twitch.api`, ou le
// vrai Connecteur Twitch branché sur le faux Twitch (tests/helpers/fakeTwitch.mjs) pour le mode « au hasard ». Aucun réseau.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";
import { carryRights } from "./helpers/callerRights.mjs";
import { connector } from "./helpers/twitchConnector.mjs";
import { runPrivacySubjectContract } from "./contract/privacySubject.contract.mjs";

const DIR = new URL("../modules/twitch-raid", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const def = (await import("../modules/twitch-raid/index.mjs")).default;
const data = await import("../modules/twitch-raid/data.mjs");
const live = await import("../modules/twitch-raid/live.mjs");
const search = await import("../modules/twitch-raid/search.mjs");
const source = await import("../modules/twitch-raid/source.mjs");
const migrate = await import("../modules/twitch-raid/migrate.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");

/* ───────────── Faux Twitch (service), faux Contacts, ancienne liste ───────────── */

/** Un faux `twitch.api` qui sait qui est en direct et compte ses demandes (taille, simultanées). */
function fakeApi(over = {}) {
  const api = {
    calls: [], inflight: 0, maxInflight: 0, accounts: [{ ok: true, channel: "emma_live", ready: true }], liveSet: new Set(), wait: null, ...over,
    methods: {
      account: async () => api.accounts[0],
      request: async (args) => {
        const wanted = args.query.user_login;
        api.calls.push(args); api.inflight++; api.maxInflight = Math.max(api.maxInflight, api.inflight);
        try {
          if (api.wait) await api.wait();
          return { ok: true, status: 200, json: { data: wanted.filter((l) => api.liveSet.has(l)).map((l, i) => ({ user_login: l, user_name: l.toUpperCase(), game_name: "Zelda", title: `Live de ${l}`, viewer_count: 10 + (l.length * 7 + i) % 90, started_at: "2026-10-20T10:00:00Z", type: "live" })) } };
        } finally { api.inflight--; }
      },
    },
  };
  return api;
}
let api, sites = 0;
const name = (i) => `chaine_${String(i).padStart(4, "0")}`;
const names = (n) => Array.from({ length: n }, (_, i) => name(i));
/** L'ancienne liste (1.x) : un document « partners » { items: [{ login, name, note }] }. Quelques noms et notes, et des lignes abîmées. */
const legacyItems = (n) => names(n).map((login, i) => ({ login, name: i % 7 === 3 ? `Membre ${i}` : "", note: i % 11 === 5 ? `note ${i}` : "" }));
/** Un site : son faux Contacts (`book`, avec ou sans la catégorie « Cible de raid »), son ancienne liste, ses réglages. */
function site({ legacy = [], withCategory = true, settings = {}, services, ...extra } = {}) {
  const book = fakeContactBook();
  const cat = withCategory ? book.seedCategory("Cible de raid") : null;
  const ctx = fakeCtx({
    key: `raid${++sites}`, moduleId: "twitch-raid", locale: "fr", defaultLocale: "fr", messages: { ...fr }, settings, siteUrl: "https://site.example.test", permissions: manifest.permissions,
    services: services ?? { "contact.book": book.methods },
    serviceInstances: { "twitch.api": [{ instance: "tw", name: "Chaîne Twitch", methods: api.methods }] },
    rows: legacy.length ? { partners: [{ items: legacy }] } : {}, ...extra,
  });
  return { ctx, book, cat };
}
const legacyDoc = async (ctx) => (await ctx.api.store.list("partners"))[0]?.data;
const stripTimes = (r) => { const { now, asOf, ...rest } = r; return rest; };
const routeLive = async (ctx) => { const k = await data.dockSecret(ctx); return stripTimes(await (await def.routes.live(new Request(`https://site.example.test/m/${ctx.instance.key}/live?k=${k}`), ctx)).json()); };
const routePick = async (ctx, body = {}) => { const k = await data.dockSecret(ctx); return (await def.routes.pick(new Request(`https://site.example.test/m/${ctx.instance.key}/pick?k=${k}`, { method: "POST", body: JSON.stringify(body) }), ctx)).json(); };
/** Ce que la 1.3 aurait affiché : la même logique du dock, avec l'ancienne liste telle qu'elle était lue (data.readPartners de la 1.3 ≡ readLegacy). */
async function dock13(legacy) {
  const ctx = fakeCtx({ key: `old${++sites}`, moduleId: "twitch-raid", permissions: manifest.permissions, serviceInstances: { "twitch.api": [{ instance: "tw", methods: api.methods }] }, rows: { partners: [{ items: legacy }] } });
  return stripTimes(await live.liveNow(ctx, await data.readLegacy(ctx), {}));
}
const act = (ctx, n, values = {}) => admin.actions[n](ctx, values);
const HUNG = Symbol("hung");
const within = (p, ms = 3000) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const stiming0 = { ...source.timing }, mtiming0 = { ...migrate.timing }, ltiming0 = { ...live.timing }, limits0 = { ...search.limits };

beforeEach(() => { api = fakeApi(); live.resetLive(); search.resetSearch(); source.resetSource(); });
afterEach(() => { mock.timers.reset(); Object.assign(source.timing, stiming0); Object.assign(migrate.timing, mtiming0); Object.assign(live.timing, ltiming0); Object.assign(search.limits, limits0); });

/* ───────────── Migration + dock identique à la 1.3 ───────────── */

test("migration (100 chaînes, catégorie « Cible de raid » déjà là) : une fiche par pseudo dans la catégorie, nom et note repris, ancienne liste intacte ; le dock est IDENTIQUE à la 1.3", async () => {
  const legacy = legacyItems(100);
  const { ctx, book, cat } = site({ legacy });
  const before = structuredClone(await legacyDoc(ctx));
  await def.migrations[3](ctx);
  const st = await migrate.readState(ctx);
  assert.deepEqual([st.total, st.done, st.pending, st.categoryId, typeof st.copiedAt, typeof st.migratedAt], [100, 100, [], cat, "string", "string"]);
  const contacts = book.dump().contacts;
  assert.equal(contacts.length, 100);
  assert.ok(contacts.every((c) => c.source === "twitch-raid" && c.categoryIds.includes(cat) && c.accounts.length === 1 && c.accounts[0].network === "twitch"));
  const c3 = contacts.find((c) => c.accounts[0].handle === name(3)), c5 = contacts.find((c) => c.accounts[0].handle === name(5));
  assert.equal(c3.name, "Membre 3"); assert.equal(contacts.find((c) => c.accounts[0].handle === name(4)).name, name(4), "sans nom : le pseudo (règle de Contacts)");
  assert.deepEqual(c5.notes.map((n) => [n.text, n.author]), [["note 5", "twitch-raid"]], "la note de Raid devient une note de la fiche");
  assert.deepEqual(await legacyDoc(ctx), before, "l'ancien document est intact (copie inerte)");
  assert.equal(book.calls.filter(([, m]) => m === "createCategory").length, 0, "Raid ne crée jamais de catégorie lui-même");
  // le dock
  api.liveSet = new Set([name(3), name(42), name(99), name(0)]);
  const now = await routeLive(ctx), then = await dock13(legacy);
  assert.equal(now.state, "ok"); assert.equal(now.live.length, 4);
  assert.deepEqual(now, then, "même état, mêmes membres en direct, mêmes noms, même ordre de liste (pos), même nombre");
  assert.equal(api.calls.length, 2, "1 paquet de 100 chacun (1.3 et 2.0)");
});

test("migration (350 chaînes) : dock identique à la 1.3 — 4 paquets (100, 100, 100, 50), 3 à la fois au plus, cache de 30 s partagé, souvenir d'une minute inchangé", async () => {
  const legacy = legacyItems(350);
  const { ctx, book } = site({ legacy });
  await def.migrations[3](ctx);
  api.liveSet = new Set([name(1), name(149), name(150), name(349)]); api.wait = () => new Promise((r) => setTimeout(r, 5));
  const now = await routeLive(ctx);
  const sizes = api.calls.map((c) => c.query.user_login.length);
  assert.deepEqual(sizes.sort((a, b) => b - a), [100, 100, 100, 50]); assert.ok(api.maxInflight <= 3);
  api.calls.length = 0; api.maxInflight = 0;
  assert.deepEqual(now, await dock13(legacy));
  assert.deepEqual(api.calls.map((c) => c.query.user_login.length).sort((a, b) => b - a), [100, 100, 100, 50]);
  // 20 docks : ni Twitch ni Contacts ne sont redemandés (cache de 30 s, lecture de la liste partagée)
  const n = api.calls.length, reads = book.calls.filter(([, m]) => m === "accounts").length;
  await Promise.all(Array.from({ length: 20 }, () => routeLive(ctx)));
  assert.equal(api.calls.length, n); assert.equal(book.calls.filter(([, m]) => m === "accounts").length, reads);
});

test("mode « au hasard » (700 chaînes migrées) avec le VRAI Connecteur Twitch sur le faux Twitch : route live sans liste ni demande, pick trouve un membre en direct, tirage sans remise par paquets de 100, plafond de recherches", async () => {
  const realFetch = globalThis.fetch;
  const liveOnes = [name(17), name(420), name(688)];
  const tw = fakeTwitch({ streams: liveOnes.map((login, i) => ({ login, name: login.toUpperCase(), title: `Titre ${i}`, viewers: 5 + i })) });
  globalThis.fetch = (u, i) => tw.fetch(u, i);
  try {
    const C = connector();
    const legacy = legacyItems(700);
    const { ctx } = site({ legacy, serviceInstances: { "twitch.api": [C.instance], "twitch.live": [{ instance: "tw", name: "Ma Chaîne Twitch", methods: { channel: async () => ({ channel: "machaine", ready: true }) } }] } });
    await def.migrations[3](ctx);
    const body = await routeLive(ctx);
    assert.deepEqual([body.state, body.mode, body.listed, body.live], ["ok", "random", 700, []]);
    assert.equal(tw.streamCalls ?? 0, 0, "la vue « au hasard » ne demande rien à Twitch");
    const r = await routePick(ctx);
    assert.equal(r.state, "found"); assert.ok(liveOnes.includes(r.pick.login)); assert.equal(r.listed, 700);
    assert.ok(tw.streamSizes.every((n) => n <= 100), "paquets de 100");
    const asked = tw.log.filter((x) => x.path === "/helix/streams").flatMap((x) => new URL(x.url).searchParams.getAll("user_login"));
    assert.equal(new Set(asked).size, asked.length, "tirage sans remise : jamais deux fois le même nom dans une recherche");
    // les suivants viennent d'abord du souvenir (une minute) : aucune demande de plus
    const calls = tw.streamCalls; const again = await routePick(ctx);
    assert.equal(again.state, "found"); assert.equal(tw.streamCalls, calls);
    // plafond partagé
    Object.assign(search.limits, { max: 1 }); search.resetSearch();
    await routePick(ctx); tw.state.streams = []; search.resetSearch(); Object.assign(search.limits, { max: 0 });
    assert.equal((await routePick(ctx)).state, "limited");
  } finally { globalThis.fetch = realFetch; }
});

/* ───────────── Migration : sans catégorie, rejouée, 2 000, coupée ───────────── */

test("migration SANS catégorie : les fiches sont créées, le dock continue (lu par ids), l'admin demande de créer « Cible de raid » ; création à la volée par le cœur puis « Ranger » : tout est dans la catégorie", async () => {
  const legacy = legacyItems(120);
  const { ctx, book } = site({ legacy, withCategory: false });
  await def.migrations[3](ctx);
  let st = await migrate.readState(ctx);
  assert.deepEqual([st.done, st.pending.length, st.categoryId, typeof st.copiedAt, st.migratedAt], [120, 120, null, "string", null]);
  assert.equal(book.calls.filter(([, m]) => m === "createCategory").length, 0, "Raid ne crée pas la catégorie (droit de la personne connectée seulement)");
  // le dock marche déjà (les fiches recopiées, par leurs ids)
  api.liveSet = new Set([name(7)]);
  assert.deepEqual(await routeLive(ctx), await dock13(legacy));
  assert.ok(book.calls.some(([, m, a]) => m === "accounts" && Array.isArray(a.ids) && a.ids.length === 120));
  let blocks = await def.adminPanel(ctx, { query: {} });
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "finish"), "la dernière étape est un bouton : la catégorie se crée toute seule");
  assert.match(blocks.find((b) => b.type === "markdown" && /fiches recopiées/.test(b.text)).text, /120 fiches recopiées.*« Cible de raid ».*créée toute seule/);
  assert.ok(blocks.some((b) => b.type === "markdown" && /\*\*120\*\* chaînes Twitch : vos chaînes de la version 1/.test(b.text)));
  assert.ok(!blocks.some((b) => b.type === "banner" && b.tone === "warning"), "rien d'alarmant : c'est une étape");
  // la personne crée la catégorie dans le réglage (le cœur appelle createCategory POUR elle), puis l'enregistre
  const created = await book.asViewer(["categories.create"]).createCategory({ label: "Cible de raid" });
  assert.equal(created.ok, true);
  const chosen = site({ legacy: [], services: { "contact.book": book.methods }, settings: { category: created.id } }).ctx;
  chosen.api.store = ctx.api.store;   // même instance, réglage enregistré
  Object.assign(chosen.instance, ctx.instance);
  source.resetSource();
  blocks = await def.adminPanel(chosen, { query: {} });
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "finish"), "le bouton « Ranger mes chaînes dans cette catégorie »");
  assert.match(blocks.find((b) => b.type === "markdown" && /fiches recopiées/.test(b.text)).text, /120 fiches recopiées.*« Cible de raid »/);
  assert.equal((await routeLive(chosen)).listed, 120, "pendant ce temps, le dock reste complet (catégorie + fiches en attente)");
  const res = await act(chosen, "finish");
  assert.match(res.ok, /toutes vos chaînes sont dans la catégorie « Cible de raid »/);
  st = await migrate.readState(chosen);
  assert.deepEqual([st.pending, st.categoryId, typeof st.migratedAt], [[], created.id, "string"]);
  assert.ok(book.dump().contacts.every((c) => c.categoryIds.includes(created.id)));
  assert.equal(book.dump().contacts.length, 120, "aucun doublon");
  source.resetSource();
  assert.deepEqual(await routeLive(chosen), await dock13(legacy), "dock identique, lu par la catégorie");
  assert.ok(!(await def.adminPanel(chosen, { query: {} })).some((b) => b.type === "adminForm" && ["finish", "migrate"].includes(b.action)), "migration terminée : plus rien à faire");
});

test("migration SANS catégorie, « Ranger » : la catégorie « Cible de raid » est créée toute seule avec les droits de la personne qui clique (asCaller), puis tout y est rangé", async () => {
  const { ctx, book } = site({ legacy: legacyItems(120), withCategory: false });
  const seen = carryRights(ctx, book);
  await def.migrations[3](ctx);
  assert.equal(book.calls.filter(([, m]) => m === "createCategory").length, 0, "la migration elle-même ne crée rien (aucune personne n'a cliqué)");
  const res = await act(ctx, "finish");
  assert.match(res.ok, /toutes vos chaînes sont dans la catégorie « Cible de raid »/);
  assert.match(res.ok, /La liste « Cible de raid » a été créée dans Contacts/);
  assert.deepEqual(seen.filter((c) => c.method === "createCategory"), [{ service: "contact.book", method: "createCategory", asCaller: true }], "demandé avec asCaller, et seulement pour cet appel");
  assert.ok(seen.filter((c) => c.method !== "createCategory").every((c) => !c.asCaller), "aucun autre appel ne demande les droits");
  const cat = book.dump().categories.find((k) => k.name === "Cible de raid");
  assert.ok(cat);
  assert.ok(book.dump().contacts.every((c) => c.categoryIds.includes(cat.id)));
  assert.deepEqual((await act(ctx, "finish")).error ?? "", "", "rejouable");
  assert.equal(book.dump().categories.filter((k) => k.name === "Cible de raid").length, 1, "jamais deux");
});

test("« Ranger » sans le droit de créer une catégorie, ou sur un cœur qui ignore asCaller : un message qui dit quoi faire, rien n'est créé ni perdu", async () => {
  for (const mode of [{ carried: false }, { rights: [] }]) {
    const { ctx, book } = site({ legacy: legacyItems(5), withCategory: false });
    carryRights(ctx, book, mode);
    await def.migrations[3](ctx);
    const res = await act(ctx, "finish");
    assert.match(res.error, /Impossible de créer toute seule la catégorie « Cible de raid ».*Créez-la vous-même dans Contacts/);
    assert.equal(book.dump().categories.length, 0);
    assert.equal((await migrate.readState(ctx)).pending.length, 5, "les chaînes recopiées attendent toujours : le dock les lit");
  }
});

test("migration rejouée deux fois (et même sans son point de reprise) : aucun doublon de fiche ni de note, rien de perdu, ancienne liste intacte", async () => {
  const legacy = legacyItems(250);
  const { ctx, book } = site({ legacy });
  const before = structuredClone(await legacyDoc(ctx));
  await def.migrations[3](ctx);
  const snap = JSON.stringify(book.dump().contacts.map((c) => [c.id, c.name, c.categoryIds, c.notes.length]));
  await def.migrations[3](ctx);
  assert.equal(JSON.stringify(book.dump().contacts.map((c) => [c.id, c.name, c.categoryIds, c.notes.length])), snap, "rejouée : rien de plus");
  for (const doc of await ctx.api.store.list(migrate.MIG)) await ctx.api.store.remove(doc.id);   // le cœur a remis le stockage comme avant (échec ailleurs) : la migration repart de zéro
  await def.migrations[3](ctx);
  await def.migrations[3](ctx);
  assert.equal(JSON.stringify(book.dump().contacts.map((c) => [c.id, c.name, c.categoryIds, c.notes.length])), snap, "même repartie de zéro : mêmes fiches, mêmes notes (upsert idempotent)");
  assert.deepEqual(await legacyDoc(ctx), before);
  assert.equal(await ctx.api.store.count(migrate.MIG), 1);
});

test("migration de 2 000 chaînes : par lots de 100 avec point de reprise ; coupée en cours (Contacts en panne) → rien d'effacé, reprise au clic, sans doublon ; temps borné", async () => {
  const legacy = [...legacyItems(1998), { login: "pas valable!", name: "", note: "" }, { login: "x", name: "", note: "" }, { login: name(5), name: "doublon", note: "" }, ...legacyItems(2002).slice(1998)];
  let upserts = 0, failAt = 1234;
  const { ctx, book, cat } = site({ legacy });
  const methods = { ...book.methods, upsertByAccount: async (a) => { if (++upserts === failAt) throw new Error("panne"); return book.methods.upsertByAccount(a); } };
  const broken = fakeCtx({ key: ctx.instance.key, moduleId: "twitch-raid", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, services: { "contact.book": methods } });
  broken.api.store = ctx.api.store;
  const before = structuredClone(await legacyDoc(ctx));
  const t0 = performance.now();
  await def.migrations[3](broken);   // ne lève pas : Contacts en panne n'est pas une erreur qui met l'instance de côté
  let st = await migrate.readState(ctx);
  assert.deepEqual([st.total, st.done, st.stopped, st.migratedAt], [2000, 1233, "contacts_down", null], "arrêtée sur la fiche en panne, point de reprise exact");
  assert.equal(book.dump().contacts.length, 1233);
  assert.deepEqual(await legacyDoc(ctx), before, "rien d'effacé");
  const writes = ctx.calls.writes.filter((w) => w.collection === migrate.MIG).length;
  assert.ok(writes >= 13 && writes <= 15, `un point de reprise par lot de 100 (${writes} écritures)`);
  let blocks = await def.adminPanel(ctx, { query: {} });
  assert.match(blocks.find((b) => b.type === "banner" && /passent dans Contacts/.test(b.text)).text, /1233 sur 2000 copiées/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "migrate"));
  failAt = -1;
  const r = await act(broken, "migrate");
  assert.match(r.ok, /vos 2000 chaînes sont dans Contacts/);
  st = await migrate.readState(ctx);
  assert.equal(typeof st.migratedAt, "string");
  const contacts = book.dump().contacts;
  assert.equal(contacts.length, 2000, "2 003 lignes − 2 invalides − 1 doublon (écartés à la lecture, comme en 1.3) = 2 002, bornées à 2 000 ; celle qui était en panne comprise : aucune perdue, aucune en double");
  assert.equal(new Set(contacts.map((c) => c.accounts[0].handle)).size, contacts.length);
  assert.ok(contacts.every((c) => c.categoryIds.includes(cat)));
  console.log(`# migration de 2 000 chaînes (double de Contacts) : ${(performance.now() - t0).toFixed(0)} ms`);
  // temps borné : un budget minuscule s'arrête proprement et reprend
  const other = site({ legacy: legacyItems(2000) });
  Object.assign(migrate.timing, { migrationMs: 1 });
  await def.migrations[3](other.ctx);
  const part = await migrate.readState(other.ctx);
  assert.ok(part.done < 2000 && !part.stopped && !part.migratedAt, "budget dépassé : arrêt propre, sans erreur");
  Object.assign(migrate.timing, mtiming0);
  await def.migrations[3](other.ctx);
  assert.equal((await migrate.readState(other.ctx)).done, 2000); assert.equal(other.book.dump().contacts.length, 2000);
  // le dock sur 2 000 chaînes migrées : mode « au hasard », comme en 1.3
  const body = await routeLive(other.ctx);
  assert.deepEqual([body.mode, body.listed], ["random", 2000]);
});

test("migration quand Contacts est absent, trop ancien ou muet : aucune erreur (l'instance n'est pas mise de côté), état noté, reprise possible ; une ancienne liste vide est « terminée »", async () => {
  Object.assign(migrate.timing, { callMs: 60 }); Object.assign(source.timing, { callMs: 60, readMs: 150 });
  const alive = setInterval(() => {}, 50);
  try {
    const none = site({ legacy: legacyItems(5), services: {} });
    await def.migrations[3](none.ctx);
    assert.equal((await migrate.readState(none.ctx)).stopped, "contacts_missing");
    const old = site({ legacy: legacyItems(5), services: { "contact.book": { get: async () => ({ ok: true }) } } });
    await def.migrations[3](old.ctx);
    assert.equal((await migrate.readState(old.ctx)).stopped, "contacts_old");
    const mute = site({ legacy: legacyItems(5) }); mute.book.faults.hang.add("categories");
    const t0 = Date.now(); await within(def.migrations[3](mute.ctx)); assert.ok(Date.now() - t0 < 1000);
    assert.equal((await migrate.readState(mute.ctx)).stopped, "contacts_down");
    mute.book.faults.hang.delete("categories");
    assert.match((await act(mute.ctx, "migrate")).ok, /vos 5 chaînes sont dans Contacts/);
    const empty = site({});
    await def.migrations[3](empty.ctx);
    const st = await migrate.readState(empty.ctx);
    assert.deepEqual([st.total, typeof st.migratedAt], [0, "string"]);
    assert.ok(!(await def.adminPanel(empty.ctx, { query: {} })).some((b) => b.type === "adminForm" && ["migrate", "finish"].includes(b.action)));
  } finally { clearInterval(alive); }
});

/* ───────────── La catégorie : choisie, par défaut, unique, supprimée, fusionnée ───────────── */

test("catégorie : choisie (réglage), « Cible de raid » par défaut (FR ou EN), l'unique catégorie, sinon « à créer » ou « à choisir » ; supprimée → message actionnable ; fusionnée → suivie", async () => {
  const { ctx, book, cat } = site({});
  book.seedContact({ name: "A", accounts: [{ network: "twitch", handle: "alice_tv" }], categoryIds: [cat] });
  assert.deepEqual(await source.resolveCategory(ctx), { id: cat, label: "Cible de raid", how: "default" });
  const other = book.seedCategory("Amis");
  book.seedContact({ name: "B", accounts: [{ network: "twitch", handle: "bob_tv" }], categoryIds: [other] });
  assert.deepEqual(await source.resolveCategory(ctx), { id: cat, label: "Cible de raid", how: "default" }, "plusieurs catégories : celle qui porte le nom par défaut");
  const en1 = site({ locale: "en", messages: { ...en } }); en1.book.admin.renameCategory(en1.cat, "Raid target");
  assert.equal((await source.resolveCategory(en1.ctx)).how, "default");
  const chosenCtx = site({ services: { "contact.book": book.methods }, settings: { category: other } }).ctx;
  assert.deepEqual(await source.resolveCategory(chosenCtx), { id: other, label: "Amis", how: "chosen" });
  assert.deepEqual((await source.targets(chosenCtx)).partners.map((p) => p.login), ["bob_tv"]);
  // l'unique catégorie (le cœur masque alors le réglage) : utilisée, et l'admin dit laquelle
  const only = site({ withCategory: false }); const k = only.book.seedCategory("Famille");
  only.book.seedContact({ name: "C", accounts: [{ network: "twitch", handle: "carl_tv" }], categoryIds: [k] });
  assert.equal((await source.resolveCategory(only.ctx)).how, "only");
  assert.ok((await def.adminPanel(only.ctx, { query: {} })).some((b) => b.type === "markdown" && /Raid lit la catégorie « Famille », la seule de votre Contacts/.test(b.text)));
  assert.deepEqual(await source.resolveCategory(site({ withCategory: false }).ctx), { problem: "no_category" });
  const many = site({ withCategory: false }); many.book.seedCategory("X1"); many.book.seedCategory("X2");
  assert.deepEqual(await source.resolveCategory(many.ctx), { problem: "choose" });
  // supprimée
  book.admin.deleteCategory(other); source.resetSource();
  assert.deepEqual(await source.resolveCategory(chosenCtx), { problem: "category_gone" });
  assert.deepEqual(await routeLive(chosenCtx), { state: "not_ready", reason: "category_gone" });
  const blocks = await def.adminPanel(chosenCtx, { query: {} });
  assert.match(blocks.find((b) => b.type === "banner" && b.tone === "warning").text, /La catégorie choisie n'existe plus, choisissez-en une/);
  const page = await (await def.routes.dock(new Request(`https://site.example.test/m/x/dock?k=${await data.dockSecret(chosenCtx)}`), chosenCtx)).text();
  assert.ok(page.includes("La catégorie choisie n'existe plus, choisissez-en une"), "le dock a la phrase");
  // fusionnée : on suit (categoriesResolve → moved)
  const merged = site({}); const old = merged.book.seedCategory("Vieux raids");
  merged.book.seedContact({ name: "D", accounts: [{ network: "twitch", handle: "dave_tv" }], categoryIds: [old] });
  const mctx = site({ services: { "contact.book": merged.book.methods }, settings: { category: old } }).ctx;
  merged.book.admin.mergeCategories(merged.cat, old);
  assert.deepEqual(await source.resolveCategory(mctx), { id: merged.cat, label: "Cible de raid", how: "moved" });
  assert.deepEqual((await source.targets(mctx)).partners.map((p) => p.login), ["dave_tv"]);
  assert.ok((await def.adminPanel(mctx, { query: {} })).some((b) => b.type === "banner" && /a été fusionnée dans « Cible de raid »/.test(b.text)));
  assert.ok(merged.book.calls.some(([, m]) => m === "categoriesResolve"));
});

/* ───────────── Contacts muet, absent, trop ancien ───────────── */

test("trou noir : Contacts muet → le dock garde la dernière liste connue 10 minutes au plus (bandeau dans l'admin), puis un état clair ; chaque lecture reste bornée", async () => {
  Object.assign(source.timing, { callMs: 60, readMs: 150 });
  const alive = setInterval(() => {}, 50);
  try {
    const { ctx, book, cat } = site({});
    for (const l of ["alice_tv", "bob_x"]) book.seedContact({ name: l, accounts: [{ network: "twitch", handle: l }], categoryIds: [cat] });
    api.liveSet = new Set(["alice_tv"]);
    mock.timers.enable({ apis: ["Date"], now: 9_000_000 });
    assert.equal((await routeLive(ctx)).live.length, 1);
    book.faults.hang.add("accounts"); book.faults.hang.add("categories");
    mock.timers.setTime(9_000_000 + 60_000); live.resetLive();
    const t0 = performance.now(); const r = await within(routeLive(ctx));
    assert.notEqual(r, HUNG); assert.ok(performance.now() - t0 < 1000);
    assert.deepEqual([r.state, r.listed, r.live.map((x) => x.login)], ["ok", 2, ["alice_tv"]], "la dernière liste connue sert : le dock ne se vide pas");
    const src = await source.targets(ctx);
    assert.deepEqual([src.stale, src.staleFrom], [true, "contacts_down"]);
    const blocks = await within(def.adminPanel(ctx, { query: {} }), 5000);
    assert.match(blocks.find((b) => b.type === "banner" && /Contacts ne répond pas/.test(b.text)).text, /utilise la liste lue à/);
    mock.timers.setTime(9_000_000 + 11 * 60_000); source.resetSource(); live.resetLive();
    // après 10 minutes (le cache aussi a été vidé : la dernière liste connue est oubliée au-delà de 10 min)
    const late = await within(routeLive(ctx));
    assert.deepEqual(late, { state: "not_ready", reason: "contacts_down" }, "au-delà : un état clair, jamais une vieille liste");
    assert.ok(fr.dock_nr_contacts_down && en.dock_nr_contacts_down);
    book.faults.hang.clear(); source.resetSource();
    assert.equal((await routeLive(ctx)).state, "ok", "Contacts revenu : tout repart");
  } finally { clearInterval(alive); }
});

test("trou noir (suite) : la dernière liste connue n'a pas plus de 10 minutes, même sans vider le cache", async () => {
  Object.assign(source.timing, { callMs: 60, readMs: 150 });
  const alive = setInterval(() => {}, 50);
  try {
    const { ctx, book, cat } = site({});
    book.seedContact({ name: "a", accounts: [{ network: "twitch", handle: "alice_tv" }], categoryIds: [cat] });
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    assert.equal((await source.targets(ctx)).state, "ok");
    book.faults.hang.add("categories");
    for (const minute of [1, 5, 9]) { mock.timers.setTime(1_000_000 + minute * 60_000); assert.equal((await source.targets(ctx)).stale, true, `${minute} min`); }
    mock.timers.setTime(1_000_000 + 10 * 60_000 + 20_000);
    assert.deepEqual(await source.targets(ctx), { state: "problem", problem: "contacts_down" });
  } finally { clearInterval(alive); }
});

test("Contacts absent → le dock le dit, l'admin propose de l'installer PAR SERVICE (suggestInstall contact.book v2) ; trop ancien → « mettez Contacts à jour » ; MCP lisible", async () => {
  const none = site({ services: {} });
  assert.deepEqual(await routeLive(none.ctx), { state: "not_ready", reason: "contacts_missing" });
  assert.equal((await routePick(none.ctx)).reason, "contacts_missing");
  const blocks = await def.adminPanel(none.ctx, { query: {} });
  assert.deepEqual(blocks.find((b) => b.type === "suggestInstall"), { type: "suggestInstall", service: "contact.book", min: 2, reason: fr.suggest_reason });
  assert.ok(!JSON.stringify(blocks.find((b) => b.type === "suggestInstall")).includes("contacts\""), "on nomme un service, jamais un module");
  assert.match(blocks.find((b) => b.type === "banner").text, /lit sa liste dans Contacts, qui n'est pas installé/);
  assert.ok(blocks.some((b) => b.type === "copy"), "l'adresse du dock reste là");
  assert.deepEqual(await def.mcp.raid_partners_live(none.ctx, {}), { state: "not_ready", reason: "contacts_missing", listed: 0, live: [] });
  const old = site({ services: { "contact.book": { get: async () => ({ ok: true }) } } });
  assert.deepEqual(await routeLive(old.ctx), { state: "not_ready", reason: "contacts_old" });
  assert.match((await def.adminPanel(old.ctx, { query: {} })).find((b) => b.type === "banner").text, /Mettez Contacts à jour/);
});

test("10 000 comptes dans la catégorie : lus par 20 pages de 500, mode « au hasard » ; au-delà, le reste est ignoré et l'admin le dit", async () => {
  const { ctx, book, cat } = site({});
  for (let i = 0; i < 10_050; i++) book.seedContact({ name: `m${i}`, accounts: [{ network: "twitch", handle: `membre_${String(i).padStart(5, "0")}` }], categoryIds: [cat] });
  const t0 = performance.now(); const src = await source.targets(ctx); const ms = performance.now() - t0;
  assert.deepEqual([src.state, src.partners.length, src.truncated], ["ok", 10_000, true]);
  assert.equal(book.calls.filter(([, m]) => m === "accounts").length, 20);
  console.log(`# 10 000 comptes lus dans le double de Contacts : ${ms.toFixed(0)} ms`);
  assert.deepEqual([(await routeLive(ctx)).mode, (await routeLive(ctx)).listed], ["random", 10_000]);
  assert.ok((await def.adminPanel(ctx, { query: {} })).some((b) => b.type === "banner" && /dépasse 10000 chaînes/.test(b.text)));
});

/* ───────────── Vie privée (privacy.subject) ───────────── */

runPrivacySubjectContract(async () => {
  const { ctx } = site({});
  const svc = def.services["privacy.subject"];
  return {
    methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
    addReference: async (id) => { const st = await migrate.readState(ctx); st.pending.push(id); await migrate.writeState(ctx, st); },
    countReferences: async (id) => (await migrate.readState(ctx)).pending.filter((x) => x === id).length,
  };
}, { prefix: "twitch-raid privacy.subject" });

test("vie privée : une personne effacée dans Contacts disparaît aussi de l'ancienne copie (pseudo, nom, note) ; export dit ce que Raid sait ; fusion suivie", async () => {
  const legacy = [{ login: "alice_tv", name: "Alice", note: "NOTE-A" }, { login: "bob_x", name: "", note: "" }];
  const { ctx, book } = site({ legacy, withCategory: false });
  await def.migrations[3](ctx);
  const alice = book.dump().contacts.find((c) => c.accounts[0].handle === "alice_tv").id, bob = book.dump().contacts.find((c) => c.accounts[0].handle === "bob_x").id;
  const svc = def.services["privacy.subject"];
  book.addPrivacySubject({ instance: ctx.instance.key, methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])) });
  const x = await svc.export(ctx, { contactId: alice });
  assert.deepEqual(x, { label: "Raid Twitch", data: { waitingForCategory: true, previousList: [{ channel: "alice_tv", name: "Alice", note: "NOTE-A" }] } });
  const erased = await book.methods.erase({ id: alice, confirm: true });
  assert.deepEqual(erased.modules, [{ module: ctx.instance.key, ok: true, removed: 2 }], "la référence en attente ET la ligne de l'ancienne copie");
  assert.deepEqual((await legacyDoc(ctx)).items.map((i) => i.login), ["bob_x"]);
  assert.deepEqual((await migrate.readState(ctx)).pending, [bob]);
  // fusion : bob fusionné dans une autre fiche → la référence suit
  const keep = book.seedContact({ name: "Bob (autre)", accounts: [{ network: "youtube", handle: "@bob" }] }).id;
  const merged = await book.methods.merge({ keep, drop: bob });
  assert.deepEqual(merged.remapped, [{ module: ctx.instance.key, ok: true }]);
  assert.deepEqual((await migrate.readState(ctx)).pending, [keep]);
  source.resetSource();
  assert.deepEqual((await source.targets(ctx)).partners.map((p) => p.login), ["bob_x"], "le dock suit la fiche fusionnée");
});

test("migration sans « Cible de raid » quand Contacts n'a qu'UNE autre catégorie (« Famille ») : le dock lit les deux, mais rien n'est rangé d'office dans « Famille » ; « Ranger » crée « Cible de raid » (ou dit quoi faire)", async () => {
  const legacy = legacyItems(3);
  const { ctx, book } = site({ legacy, withCategory: false });
  const fam = book.seedCategory("Famille");
  book.seedContact({ name: "Tata", accounts: [{ network: "twitch", handle: "tata_tv" }], categoryIds: [fam] });
  await def.migrations[3](ctx);
  assert.equal((await migrate.readState(ctx)).pending.length, 3);
  assert.deepEqual((await source.targets(ctx)).partners.map((p) => p.login), ["tata_tv", name(0), name(1), name(2)], "l'unique catégorie (règle du cœur) et les chaînes recopiées");
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "finish"), "le bouton existe : « Cible de raid » se crée toute seule");
  assert.match((await act(ctx, "finish")).error, /Impossible de créer toute seule la catégorie « Cible de raid »/, "sans le droit (cœur ancien) : on dit quoi faire");
  assert.ok(book.dump().contacts.filter((c) => c.source === "twitch-raid").every((c) => !c.categoryIds.includes(fam)), "« Famille » n'a rien reçu");
  // la personne crée « Cible de raid » dans Contacts : Raid la prend toute seule, et propose de ranger
  book.seedCategory("Cible de raid"); source.resetSource();
  assert.ok((await def.adminPanel(ctx, { query: {} })).some((b) => b.type === "adminForm" && b.action === "finish"));
  assert.match((await act(ctx, "finish")).ok, /toutes vos chaînes sont dans la catégorie « Cible de raid »/);
  source.resetSource();
  assert.deepEqual((await source.targets(ctx)).partners.map((p) => p.login), [name(0), name(1), name(2)], "« Cible de raid » lue (par défaut), plus « Famille »");
});

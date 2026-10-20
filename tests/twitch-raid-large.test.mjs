// Raid Twitch 1.2.0 — les grandes communautés : vue complète par paquets de 100 (jusqu'à 500 chaînes), mode « au hasard » au-delà, liste de 2 000 chaînes et son administration.
// Aucun réseau : Chaîne Twitch est remplacée par un faux service `twitch.api` qui compte ses appels (taille de chaque demande, demandes simultanées).
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
const search = await import("../modules/twitch-raid/search.mjs");
const dock = await import("../modules/twitch-raid/dock.mjs");
const admin = await import("../modules/twitch-raid/admin.mjs");

/* ───────────── Un faux « Chaîne Twitch » qui sait qui est en direct ───────────── */

/** `liveSet` : les pseudos en direct ; `max` : limite de pseudos par demande (400 au-delà, comme Twitch) ; `failWhen(logins)` : vrai = panne de ce paquet ; `hang(logins)` : vrai = ne répond jamais. */
function fakeApi(over = {}) {
  const api = {
    calls: [], inflight: 0, maxInflight: 0, accounts: [{ ok: true, channel: "emma_live", ready: true }], liveSet: new Set(), max: 0, failWhen: null, hang: null, wait: null, ...over,
    methods: {
      account: async () => api.accounts[0],
      request: async (args) => {
        const wanted = args.query.user_login;
        api.calls.push(args); api.inflight++; api.maxInflight = Math.max(api.maxInflight, api.inflight);
        try {
          if (api.hang?.(wanted)) await new Promise(() => {});
          if (api.wait) await api.wait();
          if (api.max && wanted.length > api.max) return { ok: true, status: 400, json: { status: 400, message: "too many" } };
          if (api.failWhen?.(wanted)) return { ok: true, status: 503, json: {} };
          return { ok: true, status: 200, json: { data: wanted.filter((l) => api.liveSet.has(l)).map((l, i) => row(l, 10 + i)) } };
        } finally { api.inflight--; }
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
const timing0 = { ...live.timing }, limits0 = { ...search.limits };
beforeEach(() => { api = fakeApi(); live.resetLive(); search.resetSearch(); Object.assign(live.timing, timing0); Object.assign(search.limits, limits0); });
afterEach(() => { mock.timers.reset(); Object.assign(live.timing, timing0); Object.assign(search.limits, limits0); });
const name = (i) => `chaine_${String(i).padStart(4, "0")}`;
const names = (n) => Array.from({ length: n }, (_, i) => name(i));
const P = (n) => names(n).map((login) => ({ login, name: "", note: "" }));
const seeded = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const HUNG = Symbol("hung");
const within = (p, ms = 2500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Les petites règles ───────────── */

test("constantes : 2 000 chaînes au plus, vue complète jusqu'à 500 (une seule valeur), paquets de 100 / 50 / 20, 6 tentatives", () => {
  assert.equal(pure.MAX_PARTNERS, 2000); assert.equal(pure.FULL_VIEW_MAX, 500); assert.deepEqual(pure.PACKET_SIZES, [100, 50, 20]); assert.equal(pure.SEARCH_TRIES, 6);
  assert.equal(pure.modeFor(0), "full"); assert.equal(pure.modeFor(100), "full"); assert.equal(pure.modeFor(500), "full"); assert.equal(pure.modeFor(501), "random"); assert.equal(pure.modeFor(2000), "random");
  const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && f !== "pure.mjs").map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  assert.ok(!/\b500\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "")), "le seuil de 500 n'est écrit qu'à un seul endroit (pure.mjs)");
});

test("paquets : découpage en morceaux de 100, taille plus petite à essayer, doublons et chaîne du propriétaire écartés", () => {
  assert.deepEqual(pure.chunk(names(350), 100).map((c) => c.length), [100, 100, 100, 50]);
  assert.deepEqual(pure.chunk([], 100), []); assert.deepEqual(pure.chunk([1, 2, 3], 2), [[1, 2], [3]]); assert.deepEqual(pure.chunk([1, 2], 0), [[1], [2]]);
  assert.deepEqual([100, 50, 37, 20, 5].map(pure.nextPacketSize), [50, 20, 20, null, null]);
  assert.deepEqual(pure.dedupe(P(3).concat(P(2))).map((p) => p.login), names(3));
  assert.deepEqual(pure.withoutChannel(P(3), "CHAINE_0001").map((p) => p.login), [name(0), name(2)]);
  assert.equal(pure.withoutChannel(P(3), "").length, 3); assert.equal(pure.withoutChannel(P(3), undefined).length, 3);
});

test("tirage sans remise : jamais deux fois le même, d'un appel à l'autre ; on peut tout épuiser ; la liste n'est pas modifiée ; l'aléa est injectable", () => {
  const items = names(250), d = pure.drawer(items, seeded(3));
  const a = d.take(100), b = d.take(100), c = d.take(100);
  assert.deepEqual([a.length, b.length, c.length, d.left()], [100, 100, 50, 0]);
  assert.equal(new Set([...a, ...b, ...c]).size, 250, "chaque nom sort une fois, et une seule");
  assert.deepEqual(d.take(10), []);
  assert.deepEqual(items, names(250));
  assert.deepEqual(pure.drawer(items, seeded(9)).take(5), pure.drawer(items, seeded(9)).take(5), "même graine, même tirage");
  assert.notDeepEqual(pure.drawer(items, seeded(9)).take(5), pure.drawer(items, seeded(10)).take(5));
  for (const odd of [() => 1, () => -1, () => NaN]) assert.equal(new Set(pure.drawer(items, odd).take(250)).size, 250, "un générateur hors limites ne casse rien");
  assert.deepEqual(pure.drawer([], seeded()).take(5), []);
  const counts = new Map(); const rng = seeded(11);
  for (let i = 0; i < 20000; i++) for (const x of pure.drawer(names(10), rng).take(3)) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const n of counts.values()) assert.ok(n > 5500 && n < 6500, `équitable : chacun sort environ 30 % du temps (${n})`);
});

test("recherche statistique : 600 chaînes dont 2 % en direct, 6 tirages de 100 → réussit dans au moins 95 % des 2000 essais ; sur 100 chaînes, un seul tirage suffit", () => {
  const rng = seeded(42);
  let wins = 0;
  for (let t = 0; t < 2000; t++) {
    const liveSet = new Set(pure.drawer(names(600), rng).take(12)), d = pure.drawer(names(600), rng);
    for (let k = 0; k < pure.SEARCH_TRIES && !d.left() === false; k++) { if (d.take(100).some((x) => liveSet.has(x))) { wins++; break; } }
  }
  assert.ok(wins / 2000 >= 0.95, `${wins}/2000`);
  assert.equal(pure.drawer(names(100), rng).take(100).length, 100, "100 chaînes : un seul tirage les contient toutes");
  let big = 0;   // 2000 chaînes, 2 % : 600 vues sur 2000, quasi certain aussi
  for (let t = 0; t < 2000; t++) { const liveSet = new Set(pure.drawer(names(2000), rng).take(40)), d = pure.drawer(names(2000), rng); for (let k = 0; k < 6; k++) if (d.take(100).some((x) => liveSet.has(x))) { big++; break; } }
  assert.ok(big / 2000 >= 0.99, `${big}/2000`);
});

test("administration : recherche (sans accents ni majuscules), pages, identifiants de ligne qui gardent la page", () => {
  const list = [{ login: "alice_tv", name: "Éloïse", note: "" }, { login: "bob_xx", name: "", note: "ami de Léa" }, { login: "carl_99", name: "", note: "" }];
  assert.deepEqual(pure.filterPartners(list, "eloise").map((p) => p.login), ["alice_tv"]);
  assert.deepEqual(pure.filterPartners(list, "LEA").map((p) => p.login), ["bob_xx"]);
  assert.deepEqual(pure.filterPartners(list, "carl").map((p) => p.login), ["carl_99"]);
  assert.equal(pure.filterPartners(list, "  ").length, 3); assert.equal(pure.filterPartners(list, "zzz").length, 0);
  const l = names(2000);
  assert.deepEqual([pure.pageOf(l, 1).items.length, pure.pageOf(l, 1).pages, pure.pageOf(l, 40).items[49], pure.pageOf(l, 41).page, pure.pageOf(l, -3).page, pure.pageOf(l, "x").page, pure.pageOf([], 5).pages], [50, 40, name(1999), 40, 1, 1, 1]);
  assert.equal(pure.rowId("alice_tv"), "alice_tv"); assert.equal(pure.rowId("alice_tv", 1, ""), "alice_tv");
  for (const [page, q] of [[3, ""], [1, "éloïse & co"], [12, "a.b~c/d"]]) assert.deepEqual(pure.parseRowId(pure.rowId("alice_tv", page, q)), { login: "alice_tv", page, q });
  assert.deepEqual(pure.parseRowId("alice_tv"), { login: "alice_tv", page: 1, q: "" });
  assert.deepEqual(pure.parseRowId(undefined), { login: "", page: 1, q: "" });
  assert.match(pure.rowId("alice_tv", 3, "é & z"), /^[a-z0-9_.A-Z-]+$/, "sûr dans une adresse");
});

test("page : canSearch (2 s entre deux recherches, une à la fois) est la même fonction dans la page que dans le module", async () => {
  assert.equal(pure.canSearch(10_000, 0, false, 2000), true); assert.equal(pure.canSearch(10_000, 9_000, false, 2000), false);
  assert.equal(pure.canSearch(11_000, 9_000, false, 2000), true); assert.equal(pure.canSearch(20_000, 0, true, 2000), false);
  const ctx = mk(); const secret = await data.dockSecret(ctx);
  const html = await (await def.routes.dock(new Request(`https://site.example.test/m/raid/dock?k=${secret}`), ctx)).text();
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  const shared = [pure.raidCommand, pure.sortPartners, pure.pickRandom, pure.durationText, pure.canSearch].map((f) => f.toString()).join("\n");
  assert.ok(script.includes(shared));
  const sb = vm.createContext({}); vm.runInContext(`${shared}; this.f = canSearch;`, sb);
  assert.equal(sb.f(11_000, 9_000, false, 2000), true); assert.equal(sb.f(10_500, 9_000, false, 2000), false);
  assert.ok(html.includes("/m/raid/pick?k=") && html.includes("Trouver un streameur en ligne au hasard"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(script), "toujours textContent");
});

/* ───────────── Vue complète (jusqu'à 500 chaînes) : paquets de 100 ───────────── */

test("vue complète : 350 chaînes = 4 paquets (100, 100, 100, 50), 3 à la fois au plus, tout rassemblé et dédoublonné", async () => {
  const ctx = mk(); api.liveSet = new Set([name(5), name(150), name(349)]);
  api.wait = () => tick(15);
  const r = await live.liveNow(ctx, P(350), {});
  assert.deepEqual(api.calls.map((c) => c.query.user_login.length).sort((a, b) => b - a), [100, 100, 100, 50]);
  assert.ok(api.calls.every((c) => c.query.first === 100 && c.path === "streams" && c.as === "app" && c.channel === "emma_live"));
  assert.equal(api.maxInflight, 3, "trois paquets en parallèle, pas plus");
  assert.deepEqual([r.state, r.mode, r.listed, r.partial], ["ok", "full", 350, undefined]);
  assert.deepEqual(r.live.map((x) => x.login).sort(), [name(5), name(150), name(349)]);
  assert.deepEqual(r.live.map((x) => x.pos).sort((a, b) => a - b), [5, 150, 349], "la place dans la liste est celle de la liste entière, pas du paquet");
  assert.equal(new Set(api.calls.flatMap((c) => c.query.user_login)).size, 350, "chaque chaîne est demandée une fois");
});

test("vue complète : 500 chaînes = 5 paquets ; 501 = mode « au hasard », aucune demande à Twitch pour la vue", async () => {
  const ctx = mk();
  assert.equal((await live.liveNow(ctx, P(500), {})).mode, "full"); assert.equal(api.calls.length, 5);
  api.calls.length = 0;
  assert.deepEqual(await live.liveNow(ctx, P(501), {}), { state: "ok", mode: "random", listed: 501, live: [] });
  assert.equal(api.calls.length, 0);
});

test("vue complète : un paquet qui échoue → résultat partiel (ce qu'on a est affiché, le reste est compté), refait au bout de 15 s et non 30", async () => {
  const ctx = mk(); api.liveSet = new Set([name(5), name(150), name(349)]);
  api.failWhen = (w) => w.includes(name(150));
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const r = await live.liveNow(ctx, P(350), {});
  assert.deepEqual([r.state, r.partial, r.listed], ["ok", 100, 350]);
  assert.deepEqual(r.live.map((x) => x.login).sort(), [name(5), name(349)], "les deux autres paquets sont gardés");
  const calls = api.calls.length;
  mock.timers.setTime(1_000_000 + 10_000); await live.liveNow(ctx, P(350), {}); assert.equal(api.calls.length, calls, "encore en cache à 10 s");
  api.failWhen = null; mock.timers.setTime(1_000_000 + 16_000);
  const again = await live.liveNow(ctx, P(350), {});
  assert.equal(again.partial, undefined); assert.equal(again.live.length, 3, "à 16 s tout est revérifié");
  // tout échoue ensuite : la dernière liste connue (complète) est jointe à l'erreur
  api.failWhen = () => true; mock.timers.setTime(1_000_000 + 60_000);
  const bad = await live.liveNow(ctx, P(350), {});
  assert.deepEqual([bad.state, bad.reason, bad.stale.live.length], ["error", "twitch", 3]);
});

test("vue complète : un bandeau le dit — le dock affiche « Certaines chaînes n'ont pas pu être vérifiées » (phrases FR et EN)", () => {
  assert.equal(fr.dock_partial, "Certaines chaînes n'ont pas pu être vérifiées."); assert.ok(en.dock_partial.startsWith("Some channels"));
  assert.match(fs.readFileSync(`${DIR}/dock.mjs`, "utf8"), /banner\(d\.partial \? L\.partial/);
});

test("défense : si Twitch refuse 100 pseudos d'un coup (400), les paquets passent à 50 puis 20 et la taille qui marche est retenue", async () => {
  const ctx = mk(); api.max = 20; api.liveSet = new Set([name(7), name(120)]);
  const r = await live.liveNow(ctx, P(250), {});
  assert.deepEqual([r.state, r.listed, r.partial], ["ok", 250, undefined]);
  assert.deepEqual(r.live.map((x) => x.login).sort(), [name(7), name(120)], "rien n'est perdu malgré la limite");
  assert.ok(Math.max(...api.calls.map((c) => c.query.user_login.length)) === 100 && api.calls.at(-1).query.user_login.length <= 20);
  assert.ok(api.calls.some((c) => c.query.user_login.length === 50) && api.calls.some((c) => c.query.user_login.length === 20));
  // la taille est retenue : au prochain tour, plus aucune demande de 100 ni de 50
  api.calls.length = 0; live.resetLive.length; // (le cache de réponse est vidé ci-dessous sans oublier la taille)
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 40_000 });
  const again = await live.liveNow(ctx, P(250), {});
  assert.equal(again.live.length, 2); assert.ok(api.calls.every((c) => c.query.user_login.length <= 20), api.calls.map((c) => c.query.user_login.length).join());
  assert.equal(api.calls.length, 13, "250 chaînes en paquets de 20 : 13 demandes");
  // même défense, limite à 50
  mock.timers.reset(); live.resetLive(); api = fakeApi({ max: 50 }); api.liveSet = new Set([name(60)]);
  const half = await live.liveNow(mk(), P(100), {});
  assert.deepEqual([half.live.map((x) => x.login), half.partial], [[name(60)], undefined]);
  // une limite plus basse que tout (5) : on abandonne proprement avec une erreur, sans boucle
  live.resetLive(); api = fakeApi({ max: 5 });
  const none = await live.liveNow(mk(), P(100), {});
  assert.deepEqual([none.state, none.reason], ["error", "twitch"]); assert.ok(api.calls.length < 20);
});

test("vue complète : une erreur définitive (application refusée) arrête les paquets suivants ; Twitch qui demande de patienter → « rate »", async () => {
  const ctx = mk(); api.methods.request = async (a) => { api.calls.push(a); return { ok: false, error: "auth" }; };
  const r = await live.liveNow(ctx, P(500), {});
  assert.deepEqual([r.state, r.reason], ["not_ready", "refused"]); assert.ok(api.calls.length <= 3, `${api.calls.length} demandes au plus (les paquets déjà partis)`);
  live.resetLive(); api = fakeApi(); api.methods.request = async () => ({ ok: false, error: "rate" });
  assert.equal((await live.liveNow(mk(), P(300), {})).reason, "rate");
});

test("la chaîne du propriétaire n'est jamais demandée ni affichée (vue complète), et les doublons sont ignorés", async () => {
  const ctx = mk(); api.liveSet = new Set(["emma_live", name(1)]);
  const list = [...P(5), { login: "emma_live", name: "", note: "" }, ...P(3)];
  const r = await live.liveNow(ctx, list, {});
  assert.ok(!api.calls.flatMap((c) => c.query.user_login).includes("emma_live"));
  assert.deepEqual([r.live.map((x) => x.login), r.listed], [[name(1)], 5]);
  assert.equal(api.calls.flatMap((c) => c.query.user_login).length, 5, "les 3 doublons ne sont pas redemandés");
});

test("vue complète : 50 visiteurs simultanés (ou 50 onglets) = UN seul jeu d'appels, rejoint par ceux qui arrivent pendant l'actualisation ; 30 s plus tard, un seul de plus", async () => {
  const ctx = mk(); api.liveSet = new Set([name(3)]); api.wait = () => tick(40);
  const partners = P(350);
  const first = Array.from({ length: 50 }, () => live.liveNow(ctx, partners, {}));
  await tick(10);   // l'actualisation est en cours : les suivants la rejoignent
  const late = Array.from({ length: 50 }, () => live.liveNow(ctx, partners, {}));
  const all = await Promise.all([...first, ...late]);
  assert.equal(api.calls.length, 4, "100 visiteurs, 4 paquets (≤ 5)");
  assert.ok(all.every((x) => x === all[0]), "tous reçoivent la même réponse");
  // par la vraie route, avec le secret
  const secret = await data.dockSecret(ctx); await data.addPartners(ctx, names(350).join("\n")); api.calls.length = 0; live.resetLive();
  const res = await Promise.all(Array.from({ length: 50 }, () => def.routes.live(new Request(`https://site.example.test/m/raid/live?k=${secret}`), ctx)));
  assert.ok(res.every((r) => r.status === 200)); assert.equal(api.calls.length, 4);
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 31_000 });
  const before = api.calls.length;
  await Promise.all(Array.from({ length: 50 }, () => live.liveNow(ctx, partners, {})));
  assert.equal(api.calls.length - before, 4, "30 s plus tard : un seul nouveau jeu d'appels");
});

/* ───────────── Attentes bornées : le « trou noir » ───────────── */

test("trou noir (vue complète) : un paquet qui ne répond jamais ne bloque pas les autres → résultat partiel dans le délai", async () => {
  Object.assign(live.timing, { packetMs: 100, callMs: 900, failMs: 10 });
  const ctx = mk(); api.liveSet = new Set([name(5), name(349)]); api.hang = (w) => w.includes(name(150));
  const t0 = Date.now();
  const r = await within(live.liveNow(ctx, P(350), {}));
  assert.notEqual(r, HUNG); assert.deepEqual([r.state, r.partial, r.live.map((x) => x.login).sort()], ["ok", 100, [name(5), name(349)]]);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

test("trou noir (vue complète) : un service Twitch muet pour TOUS les paquets → erreur propre dans la borne globale, puis tout redevient normal", async () => {
  Object.assign(live.timing, { packetMs: 5000, callMs: 200, failMs: 10 });
  const ctx = mk(); api.hang = () => true;
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(live.liveNow(ctx, P(500), {})), within(live.liveNow(ctx, P(500), {}))]);
  assert.deepEqual([a.state, a.reason, b.state], ["error", "network", "error"]);
  assert.ok(Date.now() - t0 < 1000, "la borne globale joue, pas la borne d'un appel");
  assert.equal(api.calls.length, 3, "trois paquets partis, les deux autres jamais lancés (borne dépassée)");
  await tick(30); api.hang = null; api.calls.length = 0;
  assert.equal((await within(live.liveNow(ctx, P(500), {}))).state, "ok");
});

/* ───────────── Mode « au hasard » (plus de 500 chaînes) ───────────── */

test("au hasard : 700 chaînes dont quelques-unes en direct → un membre en direct est choisi, avec ses informations publiques seulement", async () => {
  const ctx = mk(); api.liveSet = new Set([name(10), name(400)]);
  const r = await search.findRandom(ctx, P(700), {}, { rng: seeded(5) });
  assert.equal(r.state, "found"); assert.ok([name(10), name(400)].includes(r.pick.login));
  assert.deepEqual(Object.keys(r.pick).sort(), ["game", "login", "name", "startedAt", "title", "viewers"]);
  assert.ok(api.calls.length >= 1 && api.calls.length <= 6);
  for (const c of api.calls) assert.ok(c.query.user_login.length <= 100 && c.query.first === 100);
});

test("au hasard : personne en ligne → jusqu'à 6 tentatives avec 100 AUTRES noms (jamais deux fois le même), puis « personne »", async () => {
  const ctx = mk();
  const r = await search.findRandom(ctx, P(700), {}, { rng: seeded(1) });
  assert.deepEqual([r.state, r.listed], ["none", 700]);
  assert.equal(api.calls.length, 6);
  const all = api.calls.flatMap((c) => c.query.user_login);
  assert.deepEqual(api.calls.map((c) => c.query.user_login.length), [100, 100, 100, 100, 100, 100]);
  assert.equal(new Set(all).size, 600, "600 noms différents : aucun tiré deux fois pendant cette recherche");
  // une liste plus courte s'épuise avant 6 tentatives
  search.resetSearch(); api.calls.length = 0;
  const small = await search.findRandom(ctx, P(250), {}, { rng: seeded(2) });
  assert.equal(small.state, "none"); assert.equal(api.calls.length, 3, "100 + 100 + 50, puis il n'y a plus personne à tirer");
  // le message du dock est celui demandé
  assert.equal(fr.dock_rm_none, "Personne n'a été trouvé en ligne pour l'instant, réessayez."); assert.equal(fr.dock_limited, "Trop de recherches, patientez quelques secondes.");
});

test("au hasard : sur 100 chaînes, un seul tirage (tout le monde est demandé)", async () => {
  const ctx = mk(); api.liveSet = new Set([name(99)]);
  const r = await search.findRandom(ctx, P(100), {}, { rng: seeded(3) });
  assert.equal(r.state, "found"); assert.equal(api.calls.length, 1); assert.equal(api.calls[0].query.user_login.length, 100);
});

test("au hasard : 600 chaînes, 2 % en direct, 6 tentatives → réussit dans au moins 95 % de 300 essais complets (module + faux Twitch)", async () => {
  const rng = seeded(77); let wins = 0, calls = 0;
  for (let t = 0; t < 300; t++) {
    search.resetSearch(); api = fakeApi(); api.liveSet = new Set(pure.drawer(names(600), rng).take(12));
    const r = await search.findRandom(mk(), P(600), {}, { rng });
    if (r.state === "found") wins++;
    calls += api.calls.length;
  }
  assert.ok(wins / 300 >= 0.95, `${wins}/300`); assert.ok(calls / 300 <= 6);
});

test("au hasard : la chaîne du propriétaire n'est jamais tirée ; « un autre » évite le précédent", async () => {
  const ctx = mk(); api.liveSet = new Set(["emma_live", name(2), name(3)]);
  const list = [...P(600), { login: "emma_live", name: "", note: "" }];
  const rng = seeded(8); const seen = new Set();
  for (let i = 0; i < 30; i++) { search.resetSearch(); const r = await search.findRandom(ctx, list, {}, { rng }); assert.equal(r.state, "found"); seen.add(r.pick.login); }
  assert.ok(!seen.has("emma_live") && seen.size === 2);
  assert.ok(!api.calls.flatMap((c) => c.query.user_login).includes("emma_live"), "même pas demandée à Twitch");
  search.resetSearch(); api.calls.length = 0;
  let prev = ""; const order = [];
  for (let i = 0; i < 20; i++) { const r = await search.findRandom(ctx, list, {}, { rng, avoid: prev }); assert.notEqual(r.pick.login, prev); prev = r.pick.login; order.push(prev); }
  assert.equal(new Set(order).size, 2);
});

test("au hasard : les membres en direct déjà connus (moins d'une minute) servent d'abord, sans aucune demande ; équitable entre eux ; jamais un souvenir périmé", async () => {
  const ctx = mk(); api.liveSet = new Set(names(700).filter((_, i) => i % 50 === 7));   // 14 en direct
  mock.timers.enable({ apis: ["Date"], now: 10_000_000 });
  const rng = seeded(21);
  const first = await search.findRandom(ctx, P(700), {}, { rng });
  assert.equal(first.state, "found");
  const afterFirst = api.calls.length;
  const known = new Set(); const counts = new Map();
  // le premier balayage a trouvé quelques membres ; on les clique 3000 fois : aucune nouvelle demande
  for (let i = 0; i < 3000; i++) { const r = await search.findRandom(ctx, P(700), {}, { rng }); assert.equal(r.state, "found"); counts.set(r.pick.login, (counts.get(r.pick.login) ?? 0) + 1); known.add(r.pick.login); }
  assert.equal(api.calls.length, afterFirst, "3000 clics, zéro demande de plus");
  assert.ok(known.size >= 1);
  for (const n of counts.values()) assert.ok(Math.abs(n - 3000 / counts.size) < 3000 / counts.size * 0.2, `équitable : ${[...counts.values()].join(",")}`);
  // une minute plus tard les souvenirs sont périmés : plus jamais servis, on redemande à Twitch
  mock.timers.setTime(10_000_000 + 61_000);
  api.liveSet = new Set([name(699)]);
  const r = await search.findRandom(ctx, P(700), {}, { rng });
  assert.ok(api.calls.length > afterFirst, "re-interrogé"); assert.ok(r.state === "found" ? r.pick.login === name(699) || api.liveSet.has(r.pick.login) : r.state === "none", "pas de souvenir périmé");
  assert.ok(![...known].includes(r.pick?.login) || api.liveSet.has(r.pick.login));
});

test("au hasard : « un autre » avec un seul membre connu → il n'y a pas d'autre, on cherche encore puis on le redonne plutôt que rien", async () => {
  const ctx = mk(); api.liveSet = new Set([name(30)]);
  mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
  const rng = seeded(4);
  let r = await search.findRandom(ctx, P(700), {}, { rng });
  while (r.state !== "found") r = await search.findRandom(ctx, P(700), {}, { rng });
  assert.equal(r.pick.login, name(30));
  const again = await search.findRandom(ctx, P(700), {}, { rng, avoid: name(30) });
  assert.equal(again.state, "found"); assert.equal(again.pick.login, name(30));
});

test("au hasard : 300 clics en une minute sur 700 chaînes (2 % en direct) → un petit nombre d'appels à Twitch, jamais un par clic", async () => {
  const ctx = mk(); const rng = seeded(99);
  api.liveSet = new Set(pure.drawer(names(700), rng).take(14));
  const T0 = 20_000_000;
  mock.timers.enable({ apis: ["Date"], now: T0 });
  let found = 0, none = 0, limited = 0;
  for (let i = 0; i < 300; i++) {
    mock.timers.setTime(T0 + Math.floor((i * 59_000) / 300));   // les clics se répartissent sur 59 secondes
    const r = await search.findRandom(ctx, P(700), {}, { rng });
    if (r.state === "found") found++; else if (r.state === "none") none++; else limited++;
  }
  console.log(`# 300 clics / 59 s sur 700 chaînes (14 en direct) : ${api.calls.length} appels à Twitch (${found} trouvés, ${none} sans résultat, ${limited} limités)`);
  assert.ok(api.calls.length <= 6, `${api.calls.length} appels`); assert.equal(limited, 0); assert.equal(found + none, 300);
  assert.ok(found >= 290);
});

test("au hasard : 40 essais de 300 clics sur 59 s (700 chaînes, 2 % en direct) et 300 clics sur 3 minutes → appels mesurés, bornés par le nombre de renouvellements du souvenir", async () => {
  const T0 = 40_000_000; const per = [];
  for (let seed = 1; seed <= 40; seed++) {
    search.resetSearch(); api = fakeApi(); const rng = seeded(seed * 13); api.liveSet = new Set(pure.drawer(names(700), rng).take(14));
    mock.timers.enable({ apis: ["Date"], now: T0 });
    for (let i = 0; i < 300; i++) { mock.timers.setTime(T0 + Math.floor((i * 59_000) / 300)); assert.equal((await search.findRandom(mk(), P(700), {}, { rng })).state, "found"); }
    per.push(api.calls.length); mock.timers.reset();
  }
  console.log(`# 40 essais x 300 clics / 59 s : appels à Twitch min ${Math.min(...per)}, moyenne ${(per.reduce((a, b) => a + b) / 40).toFixed(2)}, max ${Math.max(...per)}`);
  assert.ok(Math.max(...per) <= 6);
  search.resetSearch(); api = fakeApi(); const rng = seeded(5); api.liveSet = new Set(pure.drawer(names(700), rng).take(14));
  mock.timers.enable({ apis: ["Date"], now: T0 });
  for (let i = 0; i < 300; i++) { mock.timers.setTime(T0 + Math.floor((i * 180_000) / 300)); await search.findRandom(mk(), P(700), {}, { rng }); }
  console.log(`# 300 clics / 3 min : ${api.calls.length} appels à Twitch (souvenir d'une minute, donc au plus un renouvellement par minute)`);
  assert.ok(api.calls.length <= 18);
});

test("au hasard : un clic de plus que le plafond (12 par minute, partagé) → « Trop de recherches » et aucune demande de plus ; la minute suivante, ça repart", async () => {
  const ctx = mk(); Object.assign(search.limits, { max: 2 });
  mock.timers.enable({ apis: ["Date"], now: 30_000_000 });
  const rng = seeded(6); const big = P(2000);   // personne en ligne : chaque recherche interroge Twitch
  assert.equal((await search.findRandom(ctx, big, {}, { rng })).state, "none");
  assert.equal((await search.findRandom(ctx, big, {}, { rng })).state, "none");
  const calls = api.calls.length;
  assert.deepEqual(await search.findRandom(ctx, big, {}, { rng }), { state: "limited" });
  assert.equal(api.calls.length, calls);
  mock.timers.setTime(30_000_000 + 61_000);
  assert.equal((await search.findRandom(ctx, big, {}, { rng })).state, "none");
  assert.equal(search.limits.max, 2); assert.equal(limits0.max, 12, "12 par minute par défaut");
});

test("au hasard : des clics simultanés pendant une recherche la REJOIGNENT (une seule salve d'appels)", async () => {
  const ctx = mk(); api.liveSet = new Set([name(10), name(500)]); api.wait = () => tick(30);
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => (i === 20 ? tick(10).then(() => 0) : 0, search.findRandom(ctx, P(700), {}, { rng: seeded(i + 1) }))));
  assert.ok(rs.every((r) => r.state === "found"));
  assert.ok(api.calls.length <= 6, `${api.calls.length} appels pour 40 clics`);
});

test("trou noir (au hasard) : un service Twitch muet → erreur propre dans la borne de la recherche ; une recherche qui plante ne bloque pas la suivante", async () => {
  Object.assign(live.timing, { packetMs: 5000, searchMs: 200 });
  const ctx = mk(); api.hang = () => true;
  const t0 = Date.now();
  const [a, b] = await Promise.all([within(search.findRandom(ctx, P(700), {}, { rng: seeded(1) })), within(search.findRandom(ctx, P(700), {}, { rng: seeded(2) }))]);
  assert.deepEqual([a.state, a.reason, b.state], ["error", "network", "error"]); assert.ok(Date.now() - t0 < 1000);
  await tick(250); api.hang = null; api.liveSet = new Set([name(5)]); search.resetSearch();
  const ok = await within(search.findRandom(ctx, P(100), {}, { rng: seeded(3) }));
  assert.notEqual(ok, HUNG); assert.equal(ok.state, "found");
  // un seul paquet sur plusieurs bloqué : les tentatives suivantes continuent
  Object.assign(live.timing, { packetMs: 80, searchMs: 2000 }); search.resetSearch(); live.resetLive();
  let first = true; api.hang = () => (first ? !(first = false) : false); api.liveSet = new Set([name(650)]);
  const part = await within(search.findRandom(ctx, P(700), {}, { rng: seeded(4) }));
  assert.ok(part.state === "found" || part.state === "none", part.state);
});

test("au hasard : Chaîne Twitch pas prête, refusée, ou liste vide → états lisibles, sans recherche inutile ; 400 → paquets plus petits", async () => {
  api.accounts = [{ ok: true, channel: "emma_live", ready: false, adminPath: "/admin/instances/id-tw" }];
  assert.deepEqual(await search.findRandom(mk(), P(700), {}, {}), { state: "not_ready", reason: "setup", adminPath: "/admin/instances/id-tw" });
  api = fakeApi(); assert.deepEqual(await search.findRandom(mk(), [], {}, {}), { state: "no_partners" });
  api = fakeApi(); api.methods.request = async () => ({ ok: false, error: "config" });
  const bad = await search.findRandom(mk(), P(700), {}, {}); assert.deepEqual([bad.state, bad.reason], ["not_ready", "refused"]);
  api = fakeApi({ max: 20 }); api.liveSet = new Set([name(33)]); live.resetLive(); search.resetSearch();
  const ok = await search.findRandom(mk(), P(700), {}, { rng: seeded(12) });
  assert.ok(ok.state === "found" || ok.state === "none"); assert.ok(api.calls.some((c) => c.query.user_login.length <= 20), "taille réduite après le 400");
  api = fakeApi(); api.failWhen = () => true; live.resetLive(); search.resetSearch();
  assert.equal((await search.findRandom(mk(), P(700), {}, {})).state, "error");
});

/* ───────────── Les routes ───────────── */

const post = (ctx, k, body) => def.routes.pick(new Request(`https://site.example.test/m/raid/pick${k === undefined ? "" : `?k=${encodeURIComponent(k)}`}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
const getLive = (ctx, k) => def.routes.live(new Request(`https://site.example.test/m/raid/live?k=${encodeURIComponent(k)}`), ctx);

test("route pick : POST seulement, secret obligatoire (sans lui, Twitch n'est jamais interrogé), réponse publique uniquement", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(700).join("\n")); await data.updatePartner(ctx, name(10), { newLogin: name(10), note: "NOTE-PRIVEE", name: "Dix" });
  api.liveSet = new Set([name(10)]);
  const secret = await data.dockSecret(ctx);
  assert.equal((await def.routes.pick(new Request(`https://site.example.test/m/raid/pick?k=${secret}`), ctx)).status, 405, "GET refusé : un robot qui suit des liens ne lance pas de recherche");
  for (const k of [undefined, "", "faux", `${secret}x`]) { const r = await post(ctx, k, {}); assert.equal(r.status, 403); assert.deepEqual(await r.json(), { state: "denied" }); }
  assert.equal(api.calls.length, 0);
  let res; for (let i = 0; i < 8 && !(res = await (await post(ctx, secret, { avoid: "" })).json()).pick; i++) search.resetSearch();
  assert.equal(res.state, "found"); assert.equal(res.pick.login, name(10)); assert.equal(res.pick.name, "Dix"); assert.equal(typeof res.now, "number");
  const raw = JSON.stringify(res); assert.ok(!raw.includes("NOTE-PRIVEE") && !raw.includes(secret));
  assert.equal((await post(ctx, secret, "pas un objet")).status, 200, "un corps douteux est ignoré");
  const r2 = await post(ctx, secret, { avoid: "x".repeat(5000) }); assert.equal(r2.status, 200);
});

test("route live (plus de 500 chaînes) : seulement le mode et le nombre, SANS demande à Twitch et sans la liste ; jusqu'à 500 : comme avant", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(612).join("\n")); const secret = await data.dockSecret(ctx);
  const body = await (await getLive(ctx, secret)).json();
  assert.deepEqual([body.state, body.mode, body.listed, body.live], ["ok", "random", 612, []]);
  assert.equal(api.calls.length, 0); assert.ok(!JSON.stringify(body).includes(name(5)), "pas la liste des 612 noms");
  const small = mk(); await data.addPartners(small, names(30).join("\n")); api.liveSet = new Set([name(1)]);
  const b2 = await (await getLive(small, await data.dockSecret(small))).json();
  assert.deepEqual([b2.state, b2.mode, b2.live.length, b2.listed], ["ok", "full", 1, 30]);
});

test("MCP (plus de 500 chaînes) : un tirage au hasard, jamais la liste ; lecture seule ; jusqu'à 500 : la liste comme avant", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(700).join("\n")); api.liveSet = new Set([name(10)]);
  let r; for (let i = 0; i < 8; i++) { search.resetSearch(); r = await def.mcp.raid_partners_live(ctx, {}); if (r.live.length) break; }
  assert.deepEqual([r.state, r.mode, r.listed, r.live.length], ["ok", "random", 700, 1]);
  assert.deepEqual([r.live[0].channel, r.live[0].raidCommand], [name(10), `/raid ${name(10)}`]);
  assert.ok(manifest.mcp.every((t) => t.readOnly === true && t.default === false));
  assert.match(manifest.mcp[0].description, /more than 500/);
  const small = mk(); await data.addPartners(small, "alice_tv bob_x"); api.liveSet = new Set(["alice_tv"]);
  const s = await def.mcp.raid_partners_live(small, {}); assert.deepEqual([s.mode, s.live.length], ["full", 1]);
});

/* ───────────── Administration à 2 000 chaînes ───────────── */

const act = (ctx, n, values = {}) => admin.actions[n](ctx, values);
const tableOf = (blocks) => blocks.find((b) => b.type === "table" && b.columns.length === 2);

test("admin : 2 000 chaînes → compteur, 50 par page, pages, recherche ; le panneau reste rapide ; une seule lecture de la liste", async () => {
  const ctx = mk(); const t0 = performance.now();
  const r = await data.addPartners(ctx, names(2000).join("\n"));
  const tImport = performance.now() - t0;
  assert.equal(r.added.length, 2000); assert.equal(await ctx.api.store.count("partners"), 1, "un seul document");
  assert.ok(ctx.calls.writes.filter((w) => w.collection === "partners").length === 1, "import de 2 000 chaînes = UNE écriture (pas d'écriture quadratique)");
  assert.ok(tImport < 1500, `import ${tImport.toFixed(0)} ms`);
  const t1 = performance.now(); let blocks = await def.adminPanel(ctx, { query: {} }); const tPanel = performance.now() - t1;
  assert.ok(tPanel < 800, `panneau ${tPanel.toFixed(0)} ms`);
  console.log(`# 2000 chaînes : import ${tImport.toFixed(0)} ms (1 écriture), panneau d'administration ${tPanel.toFixed(0)} ms`);
  assert.equal(blocks.find((b) => b.type === "heading" && /^Vos partenaires/.test(b.text)).text, "Vos partenaires : 2000 chaînes (2000 au plus)");
  let table = tableOf(blocks); assert.equal(table.rows.length, 50); assert.deepEqual(table.rowIds.slice(0, 2), [name(0), name(1)]);
  const pager = blocks.find((b) => b.type === "table" && b.rowIds?.[0] === "pager");
  assert.equal(pager.columns[0], "Chaînes 1 à 50 sur 2000"); assert.equal(pager.rows[0][0], "Page 1/40");
  assert.deepEqual(pager.rowActions.map((a) => [a.label, a.href]), [["›", "?page=2"], ["»", "?page=40"]], "pas de lien « # » : ce sont des boutons de ligne, qui acceptent « ?page=… »");
  assert.ok(!blocks.some((b) => b.type === "links" && b.items.some((i) => String(i.href).startsWith("?"))), "un bloc links n'accepte que des adresses complètes");
  blocks = await def.adminPanel(ctx, { query: { page: "40" } });
  table = tableOf(blocks); assert.deepEqual([table.rows.length, table.rowIds[0].split(".")[0], table.rowIds[0].split(".")[1]], [50, name(1950), "40"]);
  assert.equal(tableOf(await def.adminPanel(ctx, { query: { page: "999" } })).rowIds[0].split(".")[0], name(1950), "page hors limites ramenée à la dernière");
  // recherche
  blocks = await def.adminPanel(ctx, { query: { q: "chaine_19" } });
  assert.match(blocks.find((b) => b.type === "heading" && /Résultat/.test(b.text)).text, /100 sur 2000 chaînes/);
  table = tableOf(blocks); assert.equal(table.rows.length, 50); assert.ok(!table.rowActions.some((a) => a.action === "up"), "pas de Monter/Descendre pendant une recherche");
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "search" && b.fields[0].value === "chaine_19"));
  assert.match(JSON.stringify(await def.adminPanel(ctx, { query: { q: "zzzz" } })), /Aucune chaîne ne correspond à « zzzz »/);
  assert.deepEqual(await act(ctx, "search", { q: " chaine_19 " }), { redirect: "?q=chaine_19" });
  assert.deepEqual(await act(ctx, "search", { q: "" }), { redirect: "?" });
  // petite liste : pas de recherche ni de pages
  const small = mk(); await data.addPartners(small, "alice_tv bob_x");
  const sb = await def.adminPanel(small, { query: {} }); assert.ok(!sb.some((b) => b.type === "adminForm" && b.action === "search") && !sb.some((b) => b.rowIds?.[0] === "pager"));
});

test("admin : Retirer / Modifier / Enregistrer depuis la page 7 ou une recherche ramènent à CETTE page ; ajouter et retirer restent possibles à 2 000", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(2000).join("\n"));
  const table = tableOf(await def.adminPanel(ctx, { query: { page: "7" } }));
  const id = table.rowIds[3]; assert.equal(pure.parseRowId(id).login, name(303));
  const removed = await act(ctx, "remove", { id }); assert.deepEqual([removed.redirect, /retirée/.test(removed.ok)], ["?page=7", true]);
  assert.equal((await data.readPartners(ctx)).length, 1999);
  const editing = await def.adminPanel(ctx, { query: { edit: table.rowIds[4] } });   // l'adresse ne contient que « ?edit=… » : la page 7 est dans l'identifiant
  assert.equal(tableOf(editing).rowIds[0].split(".")[0], name(300), "la liste reste sur la page 7 pendant la modification");
  const form = editing.find((b) => b.type === "adminForm" && b.action === "save");
  assert.equal(form.cancelHref, "?page=7"); assert.equal(form.fields[0].value, table.rowIds[4]); assert.equal(form.fields[1].value, name(304));
  const saved = await act(ctx, "save", { id: form.fields[0].value, login: name(304), name: "Nom", note: "n" }); assert.equal(saved.redirect, "?page=7");
  const viaSearch = pure.rowId(name(1500), 1, "chaine_15"); assert.equal((await act(ctx, "remove", { id: viaSearch })).redirect, "?q=chaine_15");
  const added = await act(ctx, "add", { logins: "nouveau_membre" }); assert.equal(added.redirect, "?");
  assert.equal((await data.readPartners(ctx)).length, 1999);
  const downed = await act(ctx, "down", { id: pure.rowId(name(0), 1, "") }); assert.ok(downed.ok);
});

test("admin : import en masse par collage → bilan clair (ajoutés / déjà là / invalides) sans bloquer les bons ; liste pleine dite ; export CSV à 2 000", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(10).join("\n"));
  const text = [...names(10), ...Array.from({ length: 700 }, (_, i) => `membre_${i}`), "pas valable!", "x", "https://twitch.tv/videos/1", "a b c d", ...Array.from({ length: 20 }, (_, i) => `?${i}?`)].join("\n");
  const res = await act(ctx, "add", { logins: text });
  assert.deepEqual(Object.keys(res), ["ok"]);
  assert.match(res.ok, /700 chaînes ajoutées\./); assert.match(res.ok, /10 chaînes étaient déjà|Déjà dans votre liste/); assert.match(res.ok, /pas un pseudo Twitch valable/); assert.match(res.ok, /Autres lignes non valables : 19/);
  assert.ok(res.ok.length < 1200, "le bilan ne recopie pas 700 noms");
  assert.equal((await data.readPartners(ctx)).length, 710);
  const full = await act(ctx, "add", { logins: Array.from({ length: 1400 }, (_, i) => `autre_${i}`).join(" ") });
  assert.match(full.ok, /La liste est pleine \(2000 chaînes au plus\)\. Non ajoutées : 110/); assert.equal((await data.readPartners(ctx)).length, 2000);
  assert.match((await act(ctx, "add", { logins: "encore_un" })).error, /liste est pleine/);
  const t0 = performance.now(); const files = await def.backup.readable(ctx); const ms = performance.now() - t0;
  const lines = files[0].content.split("\r\n"); assert.equal(lines.length, 2001); assert.equal(lines[0], "channel,name,note"); assert.ok(ms < 300, `${ms.toFixed(0)} ms`);
  console.log(`# export CSV à 2000 chaînes : ${ms.toFixed(1)} ms, ${(files[0].content.length / 1024).toFixed(0)} Ko`);
  assert.ok(!files[0].content.includes(await data.dockSecret(ctx)));
});

test("admin : un collage trop long (le cœur coupe à 20 000 caractères) n'ajoute JAMAIS un pseudo coupé en deux et dit où reprendre", async () => {
  const ctx = mk(); const all = names(2000).join("\n");   // 2 000 × 12 caractères = 24 000
  const cut = all.slice(0, pure.PASTE_MAX);               // ce que le cœur transmet au module
  assert.ok(cut.length === 20000 && !cut.endsWith("\n"));
  const res = await act(ctx, "add", { logins: cut });
  const have = await data.readPartners(ctx);
  assert.ok(have.length > 1600 && have.length < 1700, `${have.length}`); assert.ok(have.every((p) => /^chaine_\d{4}$/.test(p.login)), "aucun pseudo tronqué");
  assert.match(res.ok, /trop long/); const after = /juste après « (chaine_\d{4}) »/.exec(res.ok)[1]; assert.equal(after, have.at(-1).login);
  // la suite : on recolle à partir de ce pseudo, sans rien perdre
  const rest = all.slice(all.indexOf(after) + after.length + 1);
  await act(ctx, "add", { logins: rest });
  assert.deepEqual((await data.readPartners(ctx)).map((p) => p.login), names(2000));
});

test("admin : la phrase du mode dit où on en est (FR et EN), l'avertissement « Nouvelle adresse » est clair pour tout le monde", async () => {
  const mkN = async (n, extra = {}) => { const c = mk(extra); await data.addPartners(c, names(n).join("\n")); return c; };
  const text = (blocks, tone) => blocks.filter((b) => b.type === "banner" && b.tone === tone).map((b) => b.text).join("|");
  const r = text(await def.adminPanel(await mkN(612), { query: {} }), "info");
  assert.match(r, /Vous avez 612 chaînes : le dock propose un bouton « au hasard » plutôt que la liste complète\. Jusqu'à 500 chaînes il montre tous les membres en direct\./); assert.match(r, /100 chaînes à la fois/);
  assert.match(text(await def.adminPanel(await mkN(40), { query: {} }), "info"), /Vous avez 40 chaînes : le dock montre tous vos membres en direct\. Au-delà de 500 chaînes/);
  const e = text(await def.adminPanel(await mkN(612, { locale: "en", messages: { ...en } }), { query: {} }), "info");
  assert.match(e, /You have 612 channels: the dock offers a “random” button rather than the full list\. Up to 500 channels/);
  const blocks = await def.adminPanel(await mkN(3), { query: {} });
  const renew = blocks.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "renew");
  assert.match(renew.columns[0], /coupe l'accès à tout le monde/); assert.match(renew.rows[0][0], /cesse de marcher tout de suite pour tout le monde/); assert.match(renew.rowActions[0].confirm, /POUR PERSONNE/);
  assert.ok(renew.rowActions[0].danger);
  assert.match(blocks.find((b) => b.type === "markdown" && /Docks de navigateur/.test(b.text)).text, /Cette adresse ouvre votre dock à toute personne qui l'a/);
  assert.match(fr.renewed, /ne marche plus pour personne/);
});

test("admin « Voir qui est en direct » : vue complète avec bandeau partiel ; au hasard : un essai (compté dans le plafond)", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(350).join("\n")); api.liveSet = new Set([name(1)]); api.failWhen = (w) => w.includes(name(150));
  assert.match((await act(ctx, "check")).ok, /En direct maintenant : CHAINE_0001\. Attention : certaines chaînes n'ont pas pu être vérifiées cette fois \(non vérifiées : 100\)/);
  const big = mk(); await data.addPartners(big, names(700).join("\n")); api = fakeApi(); api.liveSet = new Set([name(1), name(400), name(650)]);
  const big2 = mk(); await data.addPartners(big2, names(700).join("\n"));
  let r; for (let i = 0; i < 5; i++) { search.resetSearch(); r = await act(big2, "check"); if (r.ok && /est en direct/.test(r.ok)) break; }
  assert.match(r.ok, /Essai au hasard : CHAINE_/);
  api.liveSet = new Set(); search.resetSearch(); assert.match((await act(big2, "check")).ok, /personne n'a été trouvé en ligne/);
});

/* ───────────── Vie privée et textes ───────────── */

test("vie privée : le dock n'expose ni notes, ni secret, ni adresse, dans aucune route, à 2 000 chaînes ; manifeste à jour ; FR et EN complets", async () => {
  const ctx = mk(); await data.addPartners(ctx, names(2000).join("\n"));
  for (const i of [3, 700, 1999]) await data.updatePartner(ctx, name(i), { newLogin: name(i), name: `Nom ${i}`, note: `NOTE-PRIVEE-${i}` });
  api.liveSet = new Set([name(3), name(700), name(1999)]);
  const secret = await data.dockSecret(ctx); const seen = [];
  seen.push(await (await getLive(ctx, secret)).text());
  for (let i = 0; i < 6; i++) { search.resetSearch(); seen.push(await (await post(ctx, secret, {})).text()); }
  seen.push(await (await def.routes.dock(new Request(`https://site.example.test/m/raid/dock?k=${secret}`), ctx)).text());
  seen.push(JSON.stringify(await def.mcp.raid_partners_live(ctx, {})));
  const small = mk(); await data.addPartners(small, "alice_tv"); await data.updatePartner(small, "alice_tv", { newLogin: "alice_tv", note: "NOTE-PRIVEE-X" }); api.liveSet = new Set(["alice_tv"]);
  seen.push(await (await getLive(small, await data.dockSecret(small))).text());
  for (const t of seen) assert.ok(!t.includes("NOTE-PRIVEE"), "aucune note");
  for (const t of seen.slice(0, -2)) if (!t.includes("<script")) assert.ok(!t.includes(secret.slice(0, 12)) || t.length < 0, "le secret ne revient jamais dans les données");
  assert.ok(manifest.privacy.fr.includes("Nouvelle adresse") && manifest.privacy.en.includes("New address") && /une minute/.test(manifest.privacy.fr));
  assert.equal(manifest.version, "1.3.0");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["dock_rm_button", "dock_rm_none", "dock_limited", "dock_partial", "mode_random", "mode_full", "add_cut", "search_btn"]) assert.ok(fr[k] && en[k], k);
});

test("trou noir par les routes : un Twitch muet → la route live (vue complète) et la route pick (au hasard) répondent proprement en quelques secondes", async () => {
  Object.assign(live.timing, { packetMs: 5000, callMs: 300, searchMs: 300, failMs: 10 });
  const ctx = mk(); await data.addPartners(ctx, names(350).join("\n")); const secret = await data.dockSecret(ctx);
  api.hang = () => true;
  const t0 = Date.now();
  const res = await within(getLive(ctx, secret)); assert.notEqual(res, HUNG);
  const body = await res.json(); assert.deepEqual([res.status, body.state, body.reason], [200, "error", "network"]);
  const big = mk(); await data.addPartners(big, names(700).join("\n")); const k2 = await data.dockSecret(big);
  const pk = await within(post(big, k2, {})); assert.notEqual(pk, HUNG);
  const pb = await pk.json(); assert.deepEqual([pk.status, pb.state, pb.reason], [200, "error", "network"]);
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  const mcp = await within(def.mcp.raid_partners_live(big, {})); assert.notEqual(mcp, HUNG); assert.equal(mcp.state, "error");
});

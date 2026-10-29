// Sujet « social.stat » : les chiffres des réseaux, publiés par CHAQUE module de plateforme (YouTube, Bluesky, Mastodon, GitHub, Discord, Reddit ; Twitch : twitch-stats.test.mjs).
// Aucun réseau : `fetch` est remplacé par de fausses réponses. Le contrat (forme exacte d'un élément) est vérifié par la même fonction partout : tests/helpers/socialStatContract.mjs.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { problemsOf, problemsOfList } from "./helpers/socialStatContract.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { makeConnector, connectorApi } from "./helpers/fakeYoutube.mjs";

const root = new URL("../modules/", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${root}${p}`, "utf8"));
const load = async (id) => ({ id, manifest: readJson(`${id}/module.json`), mod: await import(`../modules/${id}/index.mjs`), fr: readJson(`${id}/locales/fr.json`), en: readJson(`${id}/locales/en.json`), source: fs.readFileSync(`${root}${id}/index.mjs`, "utf8") });
const realFetch = globalThis.fetch, realNow = Date.now;
const calls = [];
let answer = () => new Response("{}", { status: 404 });
const reply = (status, body = {}, headers = {}) => new Response(status === 204 || (status >= 300 && status < 400) ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
beforeEach(() => { calls.length = 0; answer = () => reply(404); globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); const r = await answer(String(url), init); if (r instanceof Error) throw r; return r; }; });
afterEach(() => { globalThis.fetch = realFetch; Date.now = realNow; });

const YT = "UC" + "a".repeat(22);
// Chaque plateforme : réglages, adresse appelée, réponse correcte → éléments attendus, et le code HTTP qui doit donner chaque erreur.
const PLATFORMS = {
  "youtube-channel": { platform: "youtube", settings: { channelId: YT }, host: "www.googleapis.com", ok: { items: [{ id: YT, statistics: { subscriberCount: "1230000", viewCount: "987654321", videoCount: "321", hiddenSubscriberCount: false } }] },
    values: { followers: 1230000, content: 321, views: 987654321 }, notFound: [200 /* items vides */], labels: { fr: ["Followers YouTube", "Vidéos YouTube", "Vues YouTube"], en: ["YouTube subscribers", "YouTube videos", "YouTube views"] } },
  bluesky: { platform: "bluesky", settings: { profile: "nom.bsky.social" }, host: "public.api.bsky.app", ok: { followersCount: 120, postsCount: 45, handle: "nom.bsky.social" }, values: { followers: 120, content: 45 }, notFound: [400, 404],
    labels: { fr: ["Followers Bluesky", "Publications Bluesky"], en: ["Bluesky followers", "Bluesky posts"] } },
  mastodon: { platform: "mastodon", settings: { profile: "https://mastodon.example/@nom" }, host: "mastodon.example", ok: { followers_count: 77, statuses_count: 1500, acct: "nom" }, values: { followers: 77, content: 1500 }, notFound: [404, 410, 422],
    labels: { fr: ["Followers Mastodon", "Publications Mastodon"], en: ["Mastodon followers", "Mastodon posts"] } },
  github: { platform: "github", settings: { profile: "helldog" }, host: "api.github.com", ok: { login: "helldog", followers: 9, public_repos: 3 }, values: { followers: 9 }, notFound: [404], labels: { fr: ["Followers GitHub"], en: ["GitHub followers"] } },
  discord: { platform: "discord", settings: { profile: "abcDEF" }, host: "discord.com", ok: { approximate_member_count: 321, approximate_presence_count: 10, guild: { name: "Ma communauté" } }, values: { followers: 321 }, notFound: [404],
    labels: { fr: ["Membres Discord"], en: ["Discord members"] } },
  reddit: { platform: "reddit", settings: { profile: "https://www.reddit.com/r/mon_sub" }, host: "www.reddit.com", ok: { data: { subscribers: 4321, display_name_prefixed: "r/mon_sub" } }, values: { followers: 4321 }, notFound: [404],
    labels: { fr: ["Followers Reddit"], en: ["Reddit followers"] } },
};
const ids = Object.keys(PLATFORMS);
const mods = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await load(id)])));
// YouTube : la clé est portée par le Connecteur YouTube (service youtube.api) ; le VRAI connecteur est branché ici, sur le même faux réseau.
let ytConn;
const resetYt = (opts = {}) => { connectorApi.resetState(); ytConn = makeConnector({ apiKey: "KEY-SECRETE", ...opts }); };
const reset = (id) => { mods[id].mod.resetCache?.(); if (id === "youtube-channel") resetYt(); };
const ctxOf = (id, extra = {}, locale = "fr", key = "inst") => fakeCtx({ key, locale, messages: mods[id][locale], name: "Mon compte", settings: { ...(id === "youtube-channel" ? { trackStats: true } : {}), ...PLATFORMS[id].settings, ...extra }, siteUrl: "https://site.example", ...(id === "youtube-channel" ? { services: ytConn.services } : {}) });
const statOf = (id, ctx, args) => mods[id].mod.default.exports["social.stat"](ctx, args ?? { locale: ctx.locale, limit: 50, tags: [] });
const happy = () => (url) => reply(200, ids.map((id) => PLATFORMS[id]).find((p) => url.includes(p.host)).ok);
beforeEach(() => { for (const id of ids) reset(id); });

// ── La fonction de validation du contrat elle-même ──────────────────────────────────────────────────────────────────────────────────

test("contrat : la fonction de validation accepte la forme exacte et refuse tout écart (champs, types, value absent si error)", () => {
  const good = { id: "bluesky:a:followers", platform: "bluesky", account: "nom", accountKey: "a", metric: "followers", label: "Followers Bluesky", value: 0, asOf: "2026-10-15T10:00:00.000Z", url: "https://bsky.app/profile/nom" };
  assert.deepEqual(problemsOf(good, { module: "bluesky", platform: "bluesky" }), []);
  const { value, ...noValue } = good;
  assert.deepEqual(problemsOf({ ...noValue, error: "rate" }), [], "erreur sans valeur : valide");
  const bad = [
    [{ ...good, value: 1, error: "rate" }, /ABSENT/], [{ ...good, value: undefined }, /entier/], [{ ...good, value: 1.5 }, /entier/], [{ ...good, value: -1 }, /entier/], [{ ...good, value: "12" }, /entier/],
    [{ ...good, metric: "karma" }, /hors contrat/], [{ ...good, error: "boom", value: undefined }, /hors contrat/], [{ ...good, asOf: "hier" }, /ISO/], [{ ...good, asOf: "2026-10-15" }, /ISO/],
    [{ ...good, id: "bluesky:a" }, /id/], [{ ...good, id: "bluesky:b:followers" }, /accountKey/], [{ ...good, url: "http://x.example" }, /https/], [{ ...good, label: "" }, /label/], [{ ...good, extra: 1 }, /inconnu/],
    [{ ...good, platform: "Autre" }, /platform/], [{ ...good, account: undefined }, /account/], [null, /objet/],
  ];
  for (const [item, re] of bad) assert.match(problemsOf(item, { module: "bluesky" }).join(" | "), re, JSON.stringify(item));
  assert.match(problemsOfList([good, good]).join(), /double/);
  assert.match(problemsOfList("x").join(), /tableau/);
});

// ── Manifestes, réglages, textes ───────────────────────────────────────────────────────────────────────────────────────────────────

test("manifestes : valides, fournissent social.stat (libellé fr + en), version minorée, minCore inchangé, un seul interrupteur « Suivre mes statistiques »", () => {
  const before = { "youtube-channel": "1.0.2", bluesky: "1.0.1", mastodon: "1.0.1", github: "1.0.1", discord: "1.0.1", reddit: "1.0.1" };
  for (const id of ids) {
    const { manifest } = mods[id];
    const r = parseManifest(manifest); assert.ok(r.ok, `${id} : ${r.ok ? "" : r.error}`);
    const p = manifest.provides.find((x) => x.topic === "social.stat");
    assert.ok(p?.label?.fr && p.label.en, id);
    const [a, b] = [manifest.version, before[id]].map((v) => v.split(".").map(Number));
    assert.ok(a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])), `${id} : ${before[id]} → ${manifest.version} (version montée)`);
    // youtube-channel 1.2.0 : la clé passe au Connecteur YouTube (service youtube.api, réglage hérité) → cœur 0.2.0.
    // Depuis les onglets (cœur 0.2.2, clé « tabs » pour renommer « Utiliser » en « Statistiques ») : 0.2.2 pour tous.
    assert.equal(manifest.minCore, "0.2.2", `${id} : seule exigence de cœur permise : 0.2.2 (onglets)`);
    const switches = manifest.settings.filter((s) => s.type === "boolean" && /statistiques/i.test(s.label.fr));
    assert.equal(switches.length, 1, id);
    assert.equal(switches[0].key, "trackStats");
    assert.equal(switches[0].label.fr, "Suivre mes statistiques");
    assert.ok(!switches[0].advanced, "visible en mode simple");
    assert.equal(switches[0].default, id === "youtube-channel" ? false : true, `${id} : activé par défaut seulement sans clé à fournir`);
    for (const m of mods[id].source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(manifest.settings.some((s) => s.key === m[1]), `${id} : réglage ${m[1]} non déclaré`);
    assert.ok(!manifest.settings.some((s) => s.key === "trackStats" && s.type === "secret"));
  }
  assert.equal(mods.discord.manifest.settings.find((s) => s.key === "invite").type, "text");
  const connector = readJson("youtube-connector/module.json");
  assert.ok(!mods["youtube-channel"].manifest.settings.some((s) => s.key === "apiKey"), "la clé YouTube n'est plus réglée dans youtube-channel");
  assert.equal(connector.settings.find((s) => s.key === "apiKey").type, "secret");
  assert.ok(!connector.settings.find((s) => s.key === "apiKey").advanced, "la clé est saisissable en mode simple (dans le connecteur) : c'est elle qui active les chiffres");
});

test("textes : fr et en alignés, toutes les clés utilisées existent, libellés humains, aucun jargon (mode simple)", () => {
  const JARGON = /\b(m[ée]trique|metric|sujet|topic|api|scope|token|jeton|oauth|endpoint|json|http|quota)\b/i;
  for (const id of ids) {
    const { fr, en, manifest, source } = mods[id];
    assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort(), id);
    for (const m of source.matchAll(/\bt\("([a-zA-Z_]+)"/g)) assert.ok(m[1] in fr, `${id} : ${m[1]}`);
    for (const m of source.matchAll(/err_config_([a-z]+)/g)) assert.ok(`err_config_${m[1]}` in fr);
    for (const reason of source.matchAll(/reason: "([a-z]+)"/g)) assert.ok(`err_config_${reason[1]}` in fr, `${id} : err_config_${reason[1]}`);
    PLATFORMS[id].labels.fr.forEach((l) => assert.ok(Object.values(fr).includes(l), `${id} : ${l}`));
    PLATFORMS[id].labels.en.forEach((l) => assert.ok(Object.values(en).includes(l), `${id} : ${l}`));
    for (const [k, v] of Object.entries({ ...fr, ...Object.fromEntries(Object.entries(en).map(([a, b]) => [`en.${a}`, b])) })) if (/^(en\.)?(err_|stats_|stat_|col_)/.test(k)) assert.ok(!JARGON.test(v), `${id}.${k} : « ${v} »`);
    const s = manifest.settings.find((x) => x.key === "trackStats");
    for (const v of [s.label.fr, s.label.en, s.help.fr, s.help.en]) assert.ok(!JARGON.test(v), `${id} : ${v}`);
  }
});

test("chaque erreur dit quoi faire (phrases exactes demandées pour YouTube)", () => {
  const yt = mods["youtube-channel"].fr;
  assert.equal(yt.err_hidden, "YouTube cache votre nombre de followers : rendez-le public dans YouTube Studio.");
  assert.equal(yt.err_auth, "La clé YouTube est refusée : vérifiez-la dans Réglages, sur la page du connecteur YouTube du site.");
  assert.match(yt.err_config_key, /Ajoutez votre clé YouTube dans Réglages/);
  for (const id of ids) for (const k of Object.keys(mods[id].fr).filter((k) => /^err_/.test(k))) assert.match(mods[id].fr[k], /\p{L}+.*[.]$/su, `${id}.${k} : phrase complète`);
});

// ── Au format du contrat, pour chaque plateforme, chaque chiffre ──────────────────────────────────────────────────────────────────────

for (const id of ids) {
  const P = PLATFORMS[id];

  test(`${id} : chaque chiffre au format exact, valeurs entières, identifiants stables, libellés fr et en, adresse du compte`, async () => {
    answer = happy();
    const items = await statOf(id, ctxOf(id));
    assert.deepEqual(problemsOfList(items, { module: id, platform: P.platform }), []);
    assert.deepEqual(Object.fromEntries(items.map((i) => [i.metric, i.value])), P.values);
    for (const i of items) { assert.equal(i.id, `${id}:inst:${i.metric}`); assert.equal(i.accountKey, "inst"); assert.equal(i.platform, P.platform); }
    assert.deepEqual(items.map((i) => i.label), P.labels.fr);
    reset(id);
    assert.deepEqual((await statOf(id, ctxOf(id, {}, "en"))).map((i) => i.label), P.labels.en);
    assert.ok(items.every((i) => Math.abs(Date.parse(i.asOf) - Date.now()) < 5000));
    assert.ok(items.every((i) => typeof i.account === "string" && i.account.length > 0));
  });

  test(`${id} : rien tant que le compte n'est pas réglé ; « Suivre mes statistiques » décoché : rien et aucune requête ; par défaut (non réglé) : suivi`, async () => {
    answer = happy();
    const noProfile = Object.fromEntries(Object.keys(P.settings).map((k) => [k, ""]));
    assert.deepEqual(await statOf(id, ctxOf(id, noProfile)), []);
    assert.deepEqual(await statOf(id, ctxOf(id, { trackStats: false })), []);
    const panel = await def(id).adminPanel(ctxOf(id, { trackStats: false }));
    assert.deepEqual(panel, [], "rien tant que le suivi est décoché (le guide de la clé YouTube est sur la page du connecteur)");
    assert.equal(calls.length, 0);
    if (id !== "youtube-channel") assert.ok((await statOf(id, ctxOf(id))).length > 0, "sans réglage enregistré, le suivi est actif");
    assert.ok((await statOf(id, ctxOf(id, { trackStats: true }))).length > 0);
  });

  test(`${id} : erreurs 429 → rate, 500 → network, réseau coupé → network, JSON illisible → network ; jamais de value, jamais d'exception`, async () => {
    for (const [what, make, error] of [["429", () => reply(429), "rate"], ["500", () => reply(500), "network"], ["coupé", () => new Error("coupé"), "network"], ["JSON illisible", () => new Response("<html>pas du json", { status: 200 }), "network"]]) {
      reset(id);
      answer = make;
      const items = await statOf(id, ctxOf(id));
      assert.ok(items.length > 0, what);
      assert.deepEqual(problemsOfList(items, { module: id }), [], what);
      assert.ok(items.every((i) => i.error === error && !("value" in i)), `${what} : ${JSON.stringify(items.map((i) => i.error))}`);
    }
  });

  test(`${id} : compte introuvable → config (message qui dit quoi faire) ; chaque erreur du panneau est une phrase du module`, async () => {
    for (const status of P.notFound) {
      reset(id);
      answer = () => (status === 200 ? reply(200, { items: [] }) : reply(status, { error: { message: "introuvable" } }));
      const items = await statOf(id, ctxOf(id));
      assert.ok(items.every((i) => i.error === "config" && !("value" in i)), `${status}`);
      const table = (await def(id).adminPanel(ctxOf(id))).find((b) => b.type === "table");
      for (const row of table.rows) assert.ok(Object.values(mods[id].fr).includes(row[1]), `${id} : « ${row[1]} » doit venir des textes du module`);
    }
  });

  test(`${id} : une seule requête pour plusieurs appels et plusieurs instances du même compte, même simultanés ; erreurs gardées peu de temps`, async () => {
    answer = happy();
    await Promise.all([statOf(id, ctxOf(id)), statOf(id, ctxOf(id)), statOf(id, ctxOf(id, {}, "fr", "autre")), def(id).adminPanel(ctxOf(id))]);
    await statOf(id, ctxOf(id));
    assert.equal(calls.length, 1);
    assert.ok(calls.every((c) => c.url.startsWith("https://")), "https uniquement");
    reset(id); calls.length = 0;
    answer = () => reply(500);
    await statOf(id, ctxOf(id)); await statOf(id, ctxOf(id));
    assert.equal(calls.length, 1, "pas de harcèlement après une erreur");
  });

  test(`${id} : JAMAIS de valeur périmée — passé le délai, un chiffre déjà lu n'est pas resservi si la plateforme tombe ; elle revient → valeur fraîche`, async () => {
    answer = happy();
    assert.ok((await statOf(id, ctxOf(id))).every((i) => !i.error));
    const t0 = realNow();
    Date.now = () => t0 + 3 * 3600_000;   // 3 heures plus tard : plus long que tous les délais
    answer = () => new Error("coupé");
    const down = await statOf(id, ctxOf(id));
    assert.ok(down.every((i) => i.error === "network" && !("value" in i)), JSON.stringify(down));
    Date.now = () => t0 + 3 * 3600_000 + 10 * 60_000;
    answer = happy();
    assert.ok((await statOf(id, ctxOf(id))).every((i) => !i.error && Number.isInteger(i.value)));
  });

  test(`${id} : l'argument limit est respecté ; le panneau d'admin liste les chiffres sans erreur ni exception`, async () => {
    answer = happy();
    assert.equal((await statOf(id, ctxOf(id), { limit: 1 })).length, 1);
    const panel = await def(id).adminPanel(ctxOf(id));
    const table = panel.find((b) => b.type === "table");
    assert.deepEqual(table.rows.map((r) => r[0]), P.labels.fr);
    assert.equal(table.rows[0][1], P.values.followers.toLocaleString("fr"));
  });
}
function def(id) { return mods[id].mod.default; }

// ── Spécificités de chaque plateforme ──────────────────────────────────────────────────────────────────────────────────────────────────

test("YouTube : adresse channels.list (snippet,statistics) par le connecteur, clé dans l'en-tête et jamais dans l'adresse ; abonnés arrondis par YouTube (documenté) ; vidéos et vues exactes", async () => {
  answer = happy();
  await statOf("youtube-channel", ctxOf("youtube-channel"));
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://www.googleapis.com/youtube/v3/channels");
  assert.deepEqual([u.searchParams.get("part"), u.searchParams.get("id"), u.searchParams.get("key")], ["snippet,statistics", YT, null]);
  assert.equal(new Headers(calls[0].init.headers).get("x-goog-api-key"), "KEY-SECRETE");
  const readme = fs.readFileSync(`${root}youtube-channel/README.md`, "utf8");
  assert.match(readme, /arrondi/i);
  assert.match(readme, /3 chiffres significatifs/);
});

test("YouTube : compteur d'abonnés caché → abonnés en error « hidden » SANS valeur, vidéos et vues toujours donnés", async () => {
  answer = () => reply(200, { items: [{ id: YT, statistics: { hiddenSubscriberCount: true, viewCount: "100", videoCount: "5" } }] });
  const items = await statOf("youtube-channel", ctxOf("youtube-channel"));
  assert.deepEqual(problemsOfList(items, { module: "youtube-channel" }), []);
  assert.deepEqual(items.map((i) => [i.metric, i.error ?? i.value]), [["followers", "hidden"], ["content", 5], ["views", 100]]);
  const rows = (await def("youtube-channel").adminPanel(ctxOf("youtube-channel"))).find((b) => b.type === "table").rows;
  assert.equal(rows[0][1], "YouTube cache votre nombre de followers : rendez-le public dans YouTube Studio.");
  // abonnés ni cachés ni donnés : même chose (jamais 0 inventé)
  reset("youtube-channel");
  answer = () => reply(200, { items: [{ id: YT, statistics: { viewCount: "100", videoCount: "5", hiddenSubscriberCount: false } }] });
  assert.equal((await statOf("youtube-channel", ctxOf("youtube-channel")))[0].error, "hidden");
  // un chiffre absent n'est pas publié
  reset("youtube-channel");
  answer = () => reply(200, { items: [{ id: YT, statistics: { subscriberCount: "10", hiddenSubscriberCount: false } }] });
  assert.deepEqual((await statOf("youtube-channel", ctxOf("youtube-channel"))).map((i) => i.metric), ["followers"]);
  // 0 abonné est un vrai zéro
  reset("youtube-channel");
  answer = () => reply(200, { items: [{ id: YT, statistics: { subscriberCount: "0", viewCount: "0", videoCount: "0", hiddenSubscriberCount: false } }] });
  assert.deepEqual((await statOf("youtube-channel", ctxOf("youtube-channel"))).map((i) => i.value), [0, 0, 0]);
});

test("YouTube : sans connecteur ou sans clé → « config » + message d'aide, AUCUNE requête, le reste du module ne casse pas ; clé refusée → auth ; quota → rate", async () => {
  const noConnector = fakeCtx({ key: "inst", locale: "fr", messages: mods["youtube-channel"].fr, settings: { trackStats: true, channelId: YT } });
  assert.deepEqual((await statOf("youtube-channel", noConnector)).map((i) => [i.error, "value" in i]), [["config", false], ["config", false], ["config", false]]);
  assert.match((await def("youtube-channel").adminPanel(noConnector)).find((b) => b.type === "table").rows[0][1], /il faut la clé YouTube du site/);
  resetYt({ apiKey: null });
  const noKey = ctxOf("youtube-channel");
  const items = await statOf("youtube-channel", noKey);
  assert.deepEqual(items.map((i) => [i.metric, i.error, "value" in i]), [["followers", "config", false], ["content", "config", false], ["views", "config", false]]);
  assert.equal(calls.length, 0);
  assert.match((await def("youtube-channel").adminPanel(noKey)).find((b) => b.type === "table").rows[0][1], /Ajoutez votre clé YouTube dans Réglages/);
  assert.deepEqual((await def("youtube-channel").exports["social.link"](noKey)).map((x) => x.icon), ["youtube"], "le bouton marche toujours");
  for (const [status, body, error] of [
    [400, { error: { code: 400, message: "API key not valid", errors: [{ reason: "keyInvalid" }] } }, "auth"],
    [403, { error: { errors: [{ reason: "quotaExceeded" }] } }, "rate"],
    [403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }, "rate"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "auth"],
    [403, { error: { errors: [{ reason: "ipRefererBlocked" }] } }, "auth"],
    [401, {}, "auth"],
  ]) {
    reset("youtube-channel");
    answer = () => reply(status, body);
    const r = await statOf("youtube-channel", ctxOf("youtube-channel"));
    assert.ok(r.every((i) => i.error === error && !("value" in i)), `${status} ${JSON.stringify(body)}`);
  }
  assert.equal(await statOf("youtube-channel", ctxOf("youtube-channel", { channelId: "pas-un-id" })).then((r) => r.length), 0);
});

test("YouTube : la clé n'apparaît ni dans les éléments, ni dans le panneau, ni dans les messages d'erreur ; seul l'en-tête de l'appel la porte", async () => {
  answer = () => reply(403, { error: { message: "Bad key KEY-SECRETE", errors: [{ reason: "keyInvalid" }] } });
  const c = ctxOf("youtube-channel");
  const dump = JSON.stringify([await statOf("youtube-channel", c), await def("youtube-channel").adminPanel(c), await def("youtube-channel").exports["social.link"](c)]);
  assert.ok(!dump.includes("KEY-SECRETE"));
  assert.ok(calls.length > 0);
  assert.ok(calls.every((x) => !x.url.includes("KEY-SECRETE") && !JSON.stringify({ ...x.init, headers: undefined }).includes("KEY-SECRETE") && new Headers(x.init.headers).get("x-goog-api-key") === "KEY-SECRETE"));
});

test("YouTube : les vidéos et le flux existants ne sont pas touchés (la liste des vidéos garde son cache, indépendant des chiffres)", async () => {
  const yt = mods["youtube-channel"].mod;
  answer = (url) => (url.includes("videos.xml") ? new Response(`<feed><entry><yt:videoId>vid00000001</yt:videoId><title>T</title><published>${new Date().toISOString()}</published></entry></feed>`) : reply(200, PLATFORMS["youtube-channel"].ok));
  assert.equal((await yt.listVideos(ctxOf("youtube-channel"), YT)).length, 1);
  await statOf("youtube-channel", ctxOf("youtube-channel"));
  yt.resetCache();
  assert.equal((await yt.listVideos(ctxOf("youtube-channel"), YT)).length, 1);
});

test("Bluesky : adresse de l'API publique getProfile ; l'adresse du profil ou l'identifiant donnent le même compte ; un identifiant tordu n'appelle rien", async () => {
  answer = happy();
  await statOf("bluesky", ctxOf("bluesky"));
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile");
  assert.equal(u.searchParams.get("actor"), "nom.bsky.social");
  mods.bluesky.mod.resetCache(); calls.length = 0;
  const viaUrl = await statOf("bluesky", ctxOf("bluesky", { profile: "https://bsky.app/profile/autre.bsky.social" }));
  assert.equal(new URL(calls[0].url).searchParams.get("actor"), "autre.bsky.social");
  assert.equal(viaUrl[0].url, "https://bsky.app/profile/autre.bsky.social");
  calls.length = 0;
  for (const bad of ["https://bsky.app/", "https://bsky.app/profile/a/b/c", "a b", "../x"]) assert.deepEqual(await statOf("bluesky", ctxOf("bluesky", { profile: bad })), [], bad);
  assert.equal(calls.length, 0);
});

test("Mastodon : appelle le serveur du compte (accounts/lookup), https public seulement — jamais une machine locale, privée, un port ou une adresse à identifiants", async () => {
  answer = happy();
  const ok = await statOf("mastodon", ctxOf("mastodon"));
  assert.equal(calls[0].url, "https://mastodon.example/api/v1/accounts/lookup?acct=nom");
  assert.equal(calls[0].init.redirect, "manual", "les redirections ne sont jamais suivies aveuglément");
  assert.equal(ok[0].account, "nom@mastodon.example");
  calls.length = 0;
  for (const bad of ["https://localhost/@a", "https://127.0.0.1/@a", "https://10.1.2.3/@a", "https://192.168.0.5/@a", "https://169.254.169.254/@a", "https://172.16.0.1/@a", "https://[::1]/@a", "https://[fd00::1]/@a", "https://intranet/@a", "https://mastodon.social:8443/@a", "https://serveur.internal/@a", "https://x.local/@a", "https://100.64.0.1/@a", "http://mastodon.social/@a", "https://u:p@mastodon.social/@a", "https://mastodon.social/", "https://mastodon.social/about", "https://mastodon.social/@a/b/c"]) {
    assert.deepEqual(await statOf("mastodon", ctxOf("mastodon", { profile: bad })), [], bad);
  }
  assert.equal(calls.length, 0, "aucune requête sortante pour ces adresses");
  // un serveur public qui redirige vers le réseau interne n'est pas suivi
  mods.mastodon.mod.resetCache();
  answer = () => reply(302, {}, { location: "https://169.254.169.254/latest/meta-data/" });
  const r = await statOf("mastodon", ctxOf("mastodon"));
  assert.ok(r.every((i) => i.error === "network"));
  assert.equal(calls.length, 1);
  // une redirection vers un autre serveur public est suivie (et revérifiée)
  mods.mastodon.mod.resetCache(); calls.length = 0;
  answer = (url) => (url.startsWith("https://mastodon.example/") ? reply(301, {}, { location: "https://autre.example/api/v1/accounts/lookup?acct=nom" }) : reply(200, PLATFORMS.mastodon.ok));
  assert.equal((await statOf("mastodon", ctxOf("mastodon")))[0].value, 77);
  assert.equal(calls.length, 2);
  // compte distant (@nom@autre.example) et forme /users/nom
  mods.mastodon.mod.resetCache(); calls.length = 0; answer = happy();
  await statOf("mastodon", ctxOf("mastodon", { profile: "https://mastodon.example/@nom@distant.example" }));
  assert.equal(new URL(calls[0].url).searchParams.get("acct"), "nom@distant.example");
  mods.mastodon.mod.resetCache(); calls.length = 0;
  await statOf("mastodon", ctxOf("mastodon", { profile: "https://mastodon.example/users/nom" }));
  assert.equal(new URL(calls[0].url).searchParams.get("acct"), "nom");
});

test("Mastodon : serveur qui refuse la lecture publique (401/403) → hidden avec message ; réponse démesurée → network", async () => {
  for (const status of [401, 403]) { mods.mastodon.mod.resetCache(); answer = () => reply(status); const r = await statOf("mastodon", ctxOf("mastodon")); assert.ok(r.every((i) => i.error === "hidden" && !("value" in i))); }
  mods.mastodon.mod.resetCache();
  answer = () => new Response("x".repeat(300_000), { status: 200 });
  assert.ok((await statOf("mastodon", ctxOf("mastodon"))).every((i) => i.error === "network"));
  assert.match(mods.mastodon.fr.err_hidden, /Demandez à son administrateur/);
});

test("GitHub : GET /users/<nom> public, agent identifiable ; limite de débit (403 ou 429) → rate lisible ; compte inconnu → config", async () => {
  answer = happy();
  await statOf("github", ctxOf("github"));
  assert.equal(calls[0].url, "https://api.github.com/users/helldog");
  assert.ok(calls[0].init.headers["User-Agent"], "GitHub exige un agent");
  assert.ok(!("Authorization" in calls[0].init.headers), "aucune clé : lecture publique");
  for (const status of [403, 429]) { mods.github.mod.resetCache(); answer = () => reply(status, { message: "API rate limit exceeded", documentation_url: "x" }, { "x-ratelimit-remaining": "0" }); const r = await statOf("github", ctxOf("github")); assert.ok(r.every((i) => i.error === "rate" && !("value" in i))); }
  assert.match(mods.github.fr.err_rate, /GitHub limite les demandes/);
  // rate : gardé plus longtemps qu'une erreur ordinaire (60 demandes par heure)
  mods.github.mod.resetCache(); calls.length = 0; answer = () => reply(403);
  await statOf("github", ctxOf("github"));
  const t0 = realNow(); Date.now = () => t0 + 10 * 60_000;
  await statOf("github", ctxOf("github"));
  assert.equal(calls.length, 1, "10 minutes plus tard, on ne réinterroge pas GitHub");
  assert.deepEqual(await statOf("github", ctxOf("github", { profile: "https://github.com/helldog/curiosa" })).then((r) => r.length), 1, "une adresse de dépôt donne le propriétaire");
  assert.deepEqual(await statOf("github", ctxOf("github", { profile: "a_b" })), [], "un identifiant impossible chez GitHub n'appelle rien");
});

test("Discord : le nombre de membres vient de l'invitation (with_counts) ; le lien dédié l'emporte sur le profil ; sans invitation → config sans requête", async () => {
  answer = happy();
  const items = await statOf("discord", ctxOf("discord"));
  assert.equal(calls[0].url, "https://discord.com/api/v10/invites/abcDEF?with_counts=true");
  assert.deepEqual([items[0].account, items[0].url, items[0].value], ["Ma communauté", "https://discord.gg/abcDEF", 321]);
  for (const [setting, code] of [["https://discord.gg/xyz-12", "xyz-12"], ["https://discord.com/invite/Qw3rty", "Qw3rty"], ["Zz9", "Zz9"]]) {
    mods.discord.mod.resetCache(); calls.length = 0;
    await statOf("discord", ctxOf("discord", { invite: setting }));
    assert.ok(calls[0].url.includes(`/invites/${code}?`), setting);
  }
  mods.discord.mod.resetCache(); calls.length = 0;
  for (const bad of ["https://evil.example/invite/abc", "https://discord.gg/a/b", "https://discord.com/channels/1/2", "a b", "../x", "x".repeat(40)]) {
    const r = await statOf("discord", ctxOf("discord", { profile: bad.startsWith("https://discord") ? bad : "abcDEF", invite: bad }));
    assert.ok(r.length === 0 || r.every((i) => i.error === "config" || calls.every((c) => !c.url.includes("evil"))), bad);
  }
  // profil qui n'est pas une invitation, pas de lien dédié
  mods.discord.mod.resetCache(); calls.length = 0;
  const none = await statOf("discord", ctxOf("discord", { profile: "https://discord.com/channels/1/2" }));
  assert.deepEqual(none.map((i) => [i.error, "value" in i]), [["config", false]]);
  assert.equal(calls.length, 0);
  assert.match((await def("discord").adminPanel(ctxOf("discord", { profile: "https://discord.com/channels/1/2" }))).find((b) => b.type === "table").rows[0][1], /Ajoutez le lien d'invitation/);
  // invitation expirée
  mods.discord.mod.resetCache(); answer = () => reply(404, { message: "Unknown Invite", code: 10006 });
  assert.match((await def("discord").adminPanel(ctxOf("discord"))).find((b) => b.type === "table").rows[0][1], /n'existe plus/);
  // nombre absent → hidden, jamais 0
  mods.discord.mod.resetCache(); answer = () => reply(200, { guild: { name: "X" } });
  assert.deepEqual((await statOf("discord", ctxOf("discord"))).map((i) => [i.error, "value" in i]), [["hidden", false]]);
});

test("Reddit : about.json public d'une communauté ou d'un profil, agent HTTP identifiable, cache long ; privé → hidden ; blocage anonyme → rate ; inconnu (redirection) → config", async () => {
  answer = happy();
  await statOf("reddit", ctxOf("reddit"));
  assert.equal(calls[0].url, "https://www.reddit.com/r/mon_sub/about.json?raw_json=1");
  assert.match(calls[0].init.headers["User-Agent"], /^curiosa:statistics:[\d.]+ \(\+https:\/\/site\.example\)$/);
  assert.equal(calls[0].init.redirect, "manual");
  // profil : ses abonnés (subreddit.subscribers) ; le karma n'est pas publié
  mods.reddit.mod.resetCache(); calls.length = 0;
  answer = () => reply(200, { data: { name: "moi", total_karma: 99999, subreddit: { subscribers: 12 } } });
  const user = await statOf("reddit", ctxOf("reddit", { profile: "moi_user" }));
  assert.equal(calls[0].url, "https://www.reddit.com/user/moi_user/about.json?raw_json=1");
  assert.deepEqual(user.map((i) => [i.metric, i.value, i.account]), [["followers", 12, "u/moi_user"]]);
  assert.ok(!JSON.stringify(user).includes("99999"));
  mods.reddit.mod.resetCache();
  answer = () => reply(200, { data: { name: "moi", is_suspended: true } });
  assert.equal((await statOf("reddit", ctxOf("reddit", { profile: "https://www.reddit.com/user/moi_user" })))[0].error, "hidden");
  for (const [res, error] of [[() => reply(403, { reason: "private", error: 403 }), "hidden"], [() => reply(403, { reason: "quarantined" }), "hidden"], [() => reply(403, "Blocked"), "rate"], [() => reply(302, {}, { location: "/subreddits/search.json?q=x" }), "config"], [() => reply(404, { reason: "banned" }), "config"]]) {
    mods.reddit.mod.resetCache(); answer = res;
    assert.ok((await statOf("reddit", ctxOf("reddit"))).every((i) => i.error === error), error);
  }
  // cache long : 59 minutes plus tard, encore en cache
  mods.reddit.mod.resetCache(); calls.length = 0; answer = happy();
  await statOf("reddit", ctxOf("reddit"));
  const t0 = realNow(); Date.now = () => t0 + 59 * 60_000;
  await statOf("reddit", ctxOf("reddit"));
  assert.equal(calls.length, 1);
  assert.deepEqual(await statOf("reddit", ctxOf("reddit", { profile: "https://www.reddit.com/" })), []);
});

// ── Sécurité commune ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("aucun fournisseur n'écrit dans les journaux, ne stocke rien, n'appelle que sa propre plateforme (en https)", async () => {
  for (const id of ids) {
    const src = mods[id].source;
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), id);
    assert.ok(!/ctx\.api\.store|localStorage/.test(src), `${id} : les chiffres ne sont gardés qu'en mémoire`);
    const hosts = new Set([...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => !/^(www\.)?(example|schema|bsky\.app|github\.com|discord\.(gg|com)|reddit\.com|youtube\.com|i\.ytimg\.com)$/.test(h) && !/\bexemple\b/.test(h)));
    for (const h of hosts) assert.ok(h.endsWith(PLATFORMS[id].host) || h === PLATFORMS[id].host || /googleapis|youtube|ytimg/.test(h) && id === "youtube-channel" || h === "console.cloud.google.com" && id === "youtube-channel" /* lien du guide, jamais un appel */, `${id} appelle ${h}`);
  }
});

test("un module qui lève ou une plateforme qui répond n'importe quoi ne casse jamais le site : aucune exception, jamais de valeur fausse", async () => {
  for (const id of ids) {
    for (const body of [null, [], "texte", 12, { followers: "beaucoup", followers_count: -3, followersCount: 1.5, approximate_member_count: "x", data: { subscribers: "z" }, items: [{ statistics: { subscriberCount: "abc", viewCount: "-1", videoCount: "1e9" } }] }]) {
      reset(id);
      answer = () => reply(200, body);
      const items = await statOf(id, ctxOf(id));
      assert.deepEqual(problemsOfList(items, { module: id }), [], `${id} ${JSON.stringify(body)}`);
    }
  }
});

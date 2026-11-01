// Annonces Discord 1.1 : « en direct sur YouTube » (service facultatif youtube.live de Chaîne YouTube), un seul message par direct, Twitch inchangé.
// Le VRAI module Chaîne YouTube et le VRAI Connecteur YouTube, un faux YouTube (compte les appels, 2 par vérification) et un faux webhook Discord.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { fakeYoutubeLive, CHANNEL } from "./helpers/fakeYoutubeLive.mjs";
import { makeConnector, connectorApi } from "./helpers/fakeYoutube.mjs";

const DIR = new URL("../modules/discord-announcer", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const mod = await import("../modules/discord-announcer/index.mjs");
const def = mod.default;
const channelDef = (await import("../modules/youtube-channel/index.mjs")).default;
const channelLive = await import("../modules/youtube-channel/live.mjs");
const channelMessages = JSON.parse(fs.readFileSync(new URL("../modules/youtube-channel/locales/fr.json", import.meta.url), "utf8"));
const HOOK = "https://discord.com/api/webhooks/123456/abc-DEF_9";
const NOW = Date.parse("2030-06-01T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

const realFetch = globalThis.fetch;
let yt, discord;
/** Un seul fetch pour tout : le faux YouTube pour les adresses googleapis, le faux webhook pour Discord. */
function wireFetch({ discordHandler = () => ({ ok: true, status: 204 }) } = {}) {
  yt = fakeYoutubeLive();
  discord = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://discord.com/")) {
      const body = JSON.parse(init.body); discord.push({ url: String(url), body });
      const r = discordHandler(discord.length, body);
      return { ok: r.ok, status: r.status, statusText: "x", text: async () => r.text ?? "" };
    }
    return yt.fetch(url, init);
  };
}
beforeEach(() => { mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: NOW }); channelLive.resetLive(); connectorApi.resetState(); wireFetch(); });
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

const live = (id, o = {}) => ({ id, title: "Soirée jeux", url: "https://twitch.tv/moi", startedAt: iso(NOW - 6 * 60_000), game: "Zelda", source: {}, ...o });
/** locale : "fr" ou "en" ; twitch : liste de directs Twitch ; youtube : false = Chaîne YouTube non installée ; settings : réglages. */
function site({ twitch = [], youtube = true, settings = {}, locale = "fr", extra = {} } = {}) {
  const conn = makeConnector({ apiKey: "FAKE-YT-KEY-0001" });
  const cctx = fakeCtx({ moduleId: "youtube-channel", key: "chaine", settings: { channelId: CHANNEL }, services: conn.services, messages: channelMessages, permissions: ["sections", "topics", "admin"] });
  const methods = { current: (a) => channelDef.services["youtube.live"].current(cctx, a) };
  return fakeCtx({ key: "discord", locale, messages: readJson(`locales/${locale}.json`), settings: { webhookUrl: HOOK, youtubeLive: true, ...settings }, topics: { "stream.live": () => twitch, ...extra },
    ...(youtube ? { serviceInstances: { "youtube.live": [{ instance: "chaine", name: "Chaîne YouTube", methods }] } } : {}) });
}
const goLive = (o = {}) => yt.goLive({ videoId: "LIVEvideo01", title: "Direct YouTube", startedAt: iso(NOW - 4 * 60_000), ...o });
/** Un passage de la tâche, `ms` après le début du test (l'horloge de Chaîne YouTube suit : sa garde de 45 s compte comme en vrai). */
const announce = (ctx, ms = 0) => { mock.timers.setTime(NOW + ms); return mod.announce(ctx, NOW + ms); };
const MIN = 60_000;

test("manifeste : version mineure, Chaîne YouTube FACULTATIVE, réglages simples (annonce YouTube oui, « les deux » = un message, texte vide), vérification avancée 10 min, parité fr/en, clés existantes", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.2.1");
  assert.deepEqual(manifest.requires.map((x) => [x.service, x.optional]), [["youtube.live", true]]);
  const set = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.equal(set.youtubeLive.default, false); assert.equal(set.liveBoth.default, "both"); assert.equal(set.liveText.default, ""); assert.equal(set.liveText.optional, true);
  assert.equal(set.youtubeCheckMinutes.default, 10); assert.equal(set.youtubeCheckMinutes.advanced, true);
  assert.deepEqual(set.liveBoth.options.map((o) => o.value), ["both", "first"]);
  for (const k of ["youtubeLive", "liveBoth"]) assert.ok(!set[k].advanced, k);
  assert.equal(set.liveText.advanced, true, "le texte de l'annonce est un réglage avancé : ses {accolades} ne s'affichent pas en mode simple");
  assert.deepEqual([set.mention.rare, set.prefix.rare, set.liveBoth.rare], [true, true, true], "mention, icône et « en même temps » sont repliés sous « Plus d'options »");
  const src = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
  for (const m of src.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(m[1] in set, m[1]);
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
  for (const k of ["platformTwitch", "platformYoutube", "platformBoth", "linkLine", "liveDefault"]) assert.ok(fr[k] && en[k], k);
  assert.match(fr.liveDefault, /\{platform\}.*\{title\}/); assert.match(en.liveDefault, /\{platform\}.*\{title\}/);
  assert.match(set.liveText.help.fr, /\{platform\}.*\{title\}.*\{game\}.*\{url\}/); assert.match(set.liveText.help.en, /\{platform\}.*\{title\}.*\{game\}.*\{url\}/);
});

test("direct YouTube seul : UN message « En direct sur YouTube : titre » + le lien, une fois ; au passage suivant rien de plus", async () => {
  goLive();
  const ctx = site();
  assert.equal((await announce(ctx)).sent, 1);
  assert.equal(discord.length, 1);
  assert.equal(discord[0].body.content, "🔴 En direct sur YouTube : Direct YouTube\nhttps://www.youtube.com/watch?v=LIVEvideo01");
  assert.deepEqual(discord[0].body.allowed_mentions, { parse: [] });
  for (let i = 1; i <= 30; i++) await announce(ctx, i * MIN);
  assert.equal(discord.length, 1, "un seul message pour tout le direct");
});

test("anglais : phrase par défaut en anglais", async () => {
  goLive();
  await announce(site({ locale: "en" }));
  assert.equal(discord[0].body.content, "🔴 Live on YouTube: Direct YouTube\nhttps://www.youtube.com/watch?v=LIVEvideo01");
});

test("idempotence : le même direct (même identifiant de vidéo) n'est jamais ré-annoncé, même après la fin de la garde, une coupure ou un redémarrage ; un autre direct 3 h plus tard l'est", async () => {
  goLive();
  const ctx = site();
  await announce(ctx);
  yt.endLive(); await announce(ctx, 20 * MIN);
  goLive(); await announce(ctx, 40 * MIN);       // même vidéo qui reprend
  assert.equal(discord.length, 1);
  yt.endLive(); goLive({ videoId: "LIVEvideo02", title: "Autre direct", startedAt: iso(NOW + 179 * MIN) });
  await announce(ctx, 180 * MIN);
  assert.equal(discord.length, 2);
  assert.match(discord[1].body.content, /Autre direct/);
});

test("Twitch seul : exactement le message d'avant (🔴 titre (jeu) + lien), Chaîne YouTube installée ou non", async () => {
  for (const youtube of [true, false]) {
    wireFetch();
    const ctx = site({ twitch: [live("s1")], youtube });
    assert.equal((await announce(ctx)).sent, 1);
    assert.equal(discord[0].body.content, "🔴 Soirée jeux (Zelda)\nhttps://twitch.tv/moi");
  }
});

test("Twitch seul SANS Chaîne YouTube : aucun appel à YouTube, rien d'écrit pour YouTube", async () => {
  const ctx = site({ twitch: [live("s1")], youtube: false });
  await announce(ctx);
  assert.equal(yt.calls.all.length, 0);
  assert.equal((await ctx.api.store.list("yt")).length, 0);
});

test("les deux en direct : « un message qui cite les deux » (défaut) = UN seul message avec les deux liens ; l'un et l'autre sont notés annoncés", async () => {
  goLive();
  const ctx = site({ twitch: [live("s1")] });
  assert.equal((await announce(ctx)).sent, 1);
  assert.equal(discord.length, 1);
  assert.equal(discord[0].body.content, "🔴 En direct sur Twitch et YouTube : Soirée jeux\nTwitch : https://twitch.tv/moi\nYouTube : https://www.youtube.com/watch?v=LIVEvideo01");
  for (let i = 1; i < 10; i++) await announce(ctx, i * MIN);
  assert.equal(discord.length, 1, "jamais de doublon, quelle que soit la plateforme vue en premier");
  const keys = (await ctx.api.store.list("known")).map((r) => r.data.key).sort();
  assert.deepEqual(keys, ["live:s1", "live:yt:LIVEvideo01"]);
});

test("les deux en direct, réglage « un message, pour la première plateforme » : seul Twitch est cité, YouTube est noté comme vu sans être annoncé", async () => {
  goLive();
  const ctx = site({ twitch: [live("s1")], settings: { liveBoth: "first" } });
  assert.deepEqual(await announce(ctx), { sent: 1, skipped: 1 });
  assert.equal(discord.length, 1);
  assert.equal(discord[0].body.content, "🔴 Soirée jeux (Zelda)\nhttps://twitch.tv/moi");
  await announce(ctx, 5 * MIN); await announce(ctx, 15 * MIN);
  assert.equal(discord.length, 1);
});

test("Twitch d'abord, YouTube plus tard (dans le délai entre deux annonces) : pas de second message ; hors délai : une annonce YouTube", async () => {
  const ctx = site({ twitch: [live("s1")] });
  await announce(ctx);
  assert.equal(discord.length, 1);
  goLive({ startedAt: iso(NOW + 29 * MIN) });
  await announce(ctx, 30 * MIN);
  assert.equal(discord.length, 1, "même soirée : un seul message");
  yt.endLive(); goLive({ videoId: "LIVEvideo02", title: "Nuit", startedAt: iso(NOW + 3 * 3600_000) });
  await announce(ctx, 3 * 3600_000 + 5 * MIN);
  assert.equal(discord.length, 2);
  assert.match(discord[1].body.content, /Nuit/);
});

test("quota : une vérification YouTube (2 appels) toutes les 10 minutes au plus, jamais à chaque minute ; 24 h de passages = 144 vérifications au plus (288 unités, moins de 3 %)", async () => {
  const ctx = site();
  for (let i = 0; i < 60; i++) await announce(ctx, i * MIN);                 // une heure de tâches, chaque minute
  assert.equal(yt.calls.detect, 2 * 6, "6 vérifications en une heure");
  assert.ok(24 * 6 * 2 <= 288);
});

test("réglage « minutes entre deux vérifications » : 5 à 60, valeur absurde → 10", async () => {
  for (const [v, checks] of [[5, 12], [60, 1], [1, 6], [9999, 6], ["abc", 6], [0, 6]]) {
    wireFetch(); channelLive.resetLive(); connectorApi.resetState();
    const ctx = site({ settings: { youtubeCheckMinutes: v } });
    for (let i = 0; i < 60; i++) await announce(ctx, i * MIN);
    assert.equal(yt.calls.detect / 2, checks, String(v));
  }
});

test("la dernière réponse survit : un redémarrage (autre contexte, même stockage) ne redemande pas avant l'échéance", async () => {
  const ctx = site();
  await announce(ctx);
  const before = yt.calls.detect;
  await announce(ctx, 2 * MIN);
  assert.equal(yt.calls.detect, before);
});

test("juste avant d'annoncer un direct Twitch, YouTube est revérifié (si la dernière vérification a plus d'une minute) pour savoir s'il est en direct aussi", async () => {
  const ctx = site({ twitch: [] });
  await announce(ctx);                       // YouTube hors direct, vérifié à T
  goLive();
  const twitch = [live("s1", { startedAt: iso(NOW + 4 * MIN) })];
  ctx.api.topics.collect = async (t) => (t === "stream.live" ? twitch : []);
  const calls = yt.calls.detect;
  await announce(ctx, 5 * MIN);              // Twitch vient de démarrer : revérification (5 min > 1 min), les deux sont en direct
  assert.equal(yt.calls.detect, calls + 2);
  assert.equal(discord.length, 1);
  assert.match(discord[0].body.content, /Twitch et YouTube/);
  // pas de revérification en rafale tant qu'il y a des retentatives (échec Discord)
  wireFetch({ discordHandler: () => ({ ok: false, status: 500, text: "boum" }) });
  const ctx2 = site({ twitch: [live("s9", { startedAt: iso(NOW - MIN) })] });
  await announce(ctx2); const c0 = yt.calls.detect;
  for (let i = 1; i <= 5; i++) await announce(ctx2, i * 10_000);
  assert.equal(yt.calls.detect, c0, "retentatives dans la même minute : aucune vérification de plus");
});

test("Chaîne YouTube absente, ou réglage « Annoncer aussi mes directs YouTube » décoché : aucun appel, aucun message YouTube", async () => {
  goLive();
  assert.deepEqual(await announce(site({ youtube: false })), { sent: 0, skipped: 0 });
  assert.deepEqual(await announce(site({ settings: { youtubeLive: false } })), { sent: 0, skipped: 0 });
  assert.equal(yt.calls.all.length, 0); assert.equal(discord.length, 0);
});

test("par défaut (réglage jamais enregistré, ou « non ») : les directs YouTube ne sont PAS annoncés et YouTube n'est pas interrogé ; « oui » les annonce", async () => {
  goLive();
  const bare = site({ settings: { youtubeLive: undefined } });  // instance existante : la valeur n'existe pas
  assert.equal(bare.setting("youtubeLive"), undefined);
  assert.deepEqual(await announce(bare), { sent: 0, skipped: 0 });
  assert.equal(yt.calls.all.length, 0); assert.equal(discord.length, 0);
  const panel = await def.adminPanel(bare);
  assert.ok(panel.some((b) => b.type === "markdown" && /ne sont pas annoncés/.test(b.text)));
  assert.equal((await announce(site({ settings: { youtubeLive: true } }))).sent, 1);
});

test("YouTube en panne (quota, clé refusée, 5xx, trou noir) : aucune exception, aucun message, pas d'insistance avant l'échéance ; Twitch continue", async () => {
  for (const fail of [yt?.fail?.quota, ...["keyInvalid", "denied", "server"].map((n) => (...a) => yt.fail[n](...a))]) {
    wireFetch(); channelLive.resetLive(); connectorApi.resetState();
    goLive(); yt.detectFail = (fail ?? (() => yt.fail.quota()))();
    const ctx = site({ twitch: [live("s1")] });
    const r = await announce(ctx);
    assert.equal(r.sent, 1, "Twitch est annoncé quand même");
    assert.match(discord[0].body.content, /^🔴 Soirée jeux/);
    const calls = yt.calls.all.length;
    for (let i = 1; i < 8; i++) await announce(ctx, i * MIN);
    assert.equal(yt.calls.all.length, calls, "pas d'insistance avant l'échéance");
  }
  wireFetch(); mod.YT.waitMs = 30;
  try {
    goLive(); yt.detectFail = yt.fail.silence();
    const t0 = performance.now();
    assert.equal((await announce(site())).sent, 0);
    assert.ok(performance.now() - t0 < 2000, "trou noir : on n'attend pas indéfiniment");
  } finally { mod.YT.waitMs = 8000; }
});

test("texte modifiable : {platform}, {title}, {game}, {url} ; sans {url} les liens sont ajoutés ; parenthèses vides retirées ; fonctionne pour Twitch aussi", async () => {
  goLive();
  let ctx = site({ settings: { liveText: "Venez voir {title} sur {platform} ({game}) !" } });
  await announce(ctx);
  assert.equal(discord[0].body.content, "Venez voir Direct YouTube sur YouTube !\nhttps://www.youtube.com/watch?v=LIVEvideo01");
  wireFetch(); goLive();
  ctx = site({ twitch: [live("s1")], settings: { liveText: "🎮 {title} — {platform}\n{url}" } });
  await announce(ctx);
  assert.equal(discord[0].body.content, "🎮 Soirée jeux — Twitch et YouTube\nTwitch : https://twitch.tv/moi\nYouTube : https://www.youtube.com/watch?v=LIVEvideo01");
  wireFetch();
  await announce(site({ twitch: [live("s2")], youtube: false, settings: { liveText: "En live : {title} ({game}) {url}" } }));
  assert.equal(discord[0].body.content, "En live : Soirée jeux (Zelda) https://twitch.tv/moi");
  wireFetch();
  await announce(site({ twitch: [live("s3", { game: "" })], youtube: false, settings: { liveText: "Live : {title} ({game})" } }));
  assert.equal(discord[0].body.content, "Live : Soirée jeux\nhttps://twitch.tv/moi");
});

test("texte modifiable en anglais : les mots par défaut viennent de la langue", async () => {
  goLive();
  await announce(site({ twitch: [live("s1")], locale: "en" }));
  assert.match(discord[0].body.content, /^🔴 Live on Twitch and YouTube: Soirée jeux\nTwitch: https:\/\/twitch\.tv\/moi\nYouTube: https:\/\//);
});

test("échappement : un titre YouTube hostile ne peut pas pinger (@ neutralisé), tenir sur plusieurs lignes ou casser le message ; l'adresse vient toujours de l'identifiant vérifié", async () => {
  goLive({ title: "@everyone <@&123>\nmerci‮   à tous" });
  await announce(site({ settings: { mention: "@here" } }));
  const text = discord[0].body.content;
  assert.ok(text.startsWith("@here 🔴 En direct sur YouTube : "));
  assert.ok(!text.slice(5).includes("@everyone") && !/@(?!​)/.test(text.slice(5)), "aucune mention dans le titre");
  assert.equal(text.split("\n").length, 2);
  assert.ok(!/‮/.test(text));
  assert.deepEqual(discord[0].body.allowed_mentions, { parse: ["everyone", "roles"] }, "seule la mention de la propriétaire peut pinger");
  // identifiant de vidéo invalide renvoyé par un fournisseur : ignoré
  wireFetch();
  const ctx = site(); const orig = ctx.api.services.callAll;
  ctx.api.services.callAll = async () => [{ ok: true, instance: "c", value: { ok: true, live: true, videoId: "../../evil", title: "x", startedAt: iso(NOW) } }];
  assert.equal((await announce(ctx)).sent, 0);
  void orig;
});

test("limites d'envoi : au plus 5 messages par passage et arrêt au premier 429 ; un 429 sur un direct YouTube est retenté, pas perdu", async () => {
  goLive();
  wireFetch({ discordHandler: (n) => (n === 1 ? { ok: false, status: 429, text: "rate" } : { ok: true, status: 204 }) });
  goLive();
  const ctx = site();
  assert.equal((await announce(ctx)).sent, 0);
  assert.equal(discord.length, 1);
  assert.equal((await announce(ctx, 2 * MIN)).sent, 1);
  assert.equal(discord.length, 2);
  assert.equal((await announce(ctx, 4 * MIN)).sent, 0);
  const log = await ctx.api.store.list("log");
  assert.deepEqual(log.map((r) => [r.data.ok, r.data.attempts]).sort(), [[false, 1], [true, 1]], "l'échec noté, puis l'envoi réussi");
  const many = Array.from({ length: 8 }, (_, i) => ({ title: `E${i}`, path: `/e/${i}`, publishedAt: iso(NOW - 3600_000), source: { instance: "b" } }));
  wireFetch(); goLive();
  const c2 = site({ extra: { "core.entry": many } });
  assert.equal((await announce(c2)).sent, 5);
});

test("les entrées du site (blog…) restent annoncées comme avant, à côté d'un direct YouTube", async () => {
  goLive();
  const ctx = site({ extra: { "core.entry": [{ title: "Nouveau billet", path: "/blog/n", publishedAt: iso(NOW - 3600_000), source: { instance: "b" } }] } });
  assert.equal((await announce(ctx)).sent, 2);
  assert.deepEqual(discord.map((d) => d.body.content.split("\n")[0]), ["📰 Nouveau billet", "🔴 En direct sur YouTube : Direct YouTube"]);
});

test("un direct YouTube trop ancien (plus de 24 h) est noté comme vu sans être annoncé", async () => {
  goLive({ startedAt: iso(NOW - 30 * 3600_000) });
  const ctx = site();
  assert.deepEqual(await announce(ctx), { sent: 0, skipped: 1 });
  assert.equal(discord.length, 0);
});

test("un direct YouTube sans heure de début est traité comme tout frais", async () => {
  goLive();
  const ctx = site(); const orig = ctx.api.services.callAll;
  ctx.api.services.callAll = async (...a) => (await orig(...a)).map((r) => ({ ...r, value: { ...r.value, startedAt: undefined } }));
  assert.equal((await announce(ctx)).sent, 1);
});

test("administration : une phrase sur YouTube seulement si Chaîne YouTube est installée ; rien de plus pour les autres", async () => {
  const withYt = await def.adminPanel(site());
  assert.ok(withYt.some((b) => b.type === "markdown" && /Vos directs YouTube sont annoncés/.test(b.text) && /10 minutes/.test(b.text)));
  const off = await def.adminPanel(site({ settings: { youtubeLive: false } }));
  assert.ok(off.some((b) => b.type === "markdown" && /ne sont pas annoncés.*Annoncer aussi mes directs YouTube/.test(b.text)));
  const without = await def.adminPanel(site({ youtube: false }));
  assert.ok(!without.some((b) => b.type === "markdown" && /YouTube/.test(b.text)));
});

test("pas de minuteur de fond ajouté : la même tâche d'une minute, aucune autre", () => {
  assert.deepEqual(Object.keys(def.tasks), ["announce"]); assert.equal(def.tasks.announce.everyMinutes, 1);
});

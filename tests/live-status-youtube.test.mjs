// Statut du live 1.4 : la source YouTube (service facultatif youtube.live de Chaîne YouTube, 1.4.0) à côté de Twitch.
// Le VRAI module Chaîne YouTube et le VRAI Connecteur YouTube, un faux YouTube branché sur fetch (il compte les appels : 2 par vérification), une horloge simulée.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest } from "./helpers/builtinChecks.mjs";
import { fakeYoutubeLive, CHANNEL } from "./helpers/fakeYoutubeLive.mjs";
import { makeConnector, connectorApi } from "./helpers/fakeYoutube.mjs";

const ls = await loadModule("modules/live-status");
const { definition: def, manifest, locales } = ls;
const Y = await import("../modules/live-status/youtube.mjs");
const channelDef = (await import("../modules/youtube-channel/index.mjs")).default;
const channelLive = await import("../modules/youtube-channel/live.mjs");
const channelMessages = JSON.parse(fs.readFileSync(new URL("../modules/youtube-channel/locales/fr.json", import.meta.url), "utf8"));

const T0 = Date.parse("2026-10-14T20:00:00Z");
const realFetch = globalThis.fetch;
beforeEach(() => { mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: T0 }); Y.resetYoutube(); channelLive.resetLive(); connectorApi.resetState(); Y.timing.waitMs = 2_500; });
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

const MSG = { live: "{channel} est en direct", liveYoutube: "EN DIRECT YOUTUBE", liveMany: "En direct", watch: "Regarder", viewersOne: "{count} spectateur", viewersMany: "{count} spectateurs", playerChoice: "Chaîne", ytStart: "Lancer YouTube", ytNote: "Rien avant le clic", needSource: "AUCUNE SOURCE", suggestTwitch: "T", suggestYoutube: "Y", ytNeedChannel: "CHAINE", ytNeedKey: "CLE", ytQuota: "QUOTA", ytDown: "PANNE", openYoutube: "Ouvrir", openYoutubeConnector: "Ouvrir connecteur", needCredentials: "RELIEZ", needChannel: "INDIQUEZ" };
const twitchStatus = (o = {}) => ({ live: true, known: true, configured: true, channel: "helldog136", displayName: "helldog136", title: "Soirée Zelda", game: "Zelda", viewers: 12, ...o });
const twitchInstance = (st) => ({ instance: "tw0", name: "Twitch", methods: { channel: () => ({ channel: "helldog136", ready: true, missing: [] }), status: () => st } });

/**
 * Un site : Twitch (faux service, `twitch` = sa réponse d'état ou null pour « non installé »), YouTube (le vrai module, `youtube` = false pour « non installé »).
 * Rend { ctx, yt, calls() } : calls() = nombre d'appels de recherche de direct faits à YouTube (2 par vérification).
 */
function site({ twitch = null, youtube = true, own = {}, names = ["Chaîne YouTube"], oldCore = false } = {}) {
  Y.resetYoutube(); channelLive.resetLive(); connectorApi.resetState();
  const yt = fakeYoutubeLive();
  globalThis.fetch = yt.fetch;
  const conn = makeConnector({ apiKey: "FAKE-YT-KEY-0001" });
  const chans = names.map((name, i) => {
    const cctx = fakeCtx({ moduleId: "youtube-channel", key: `chaine${i}`, settings: { channelId: CHANNEL }, services: conn.services, messages: channelMessages, permissions: ["sections", "topics", "admin"] });
    return { instance: `chaine${i}`, name, methods: { current: (a) => channelDef.services["youtube.live"].current(cctx, a) } };
  });
  const serviceInstances = { ...(twitch ? { "twitch.live": [twitchInstance(twitch)] } : {}), ...(youtube ? { "youtube.live": chans } : {}) };
  const ctx = fakeCtx({ key: "live-status", settings: own, serviceInstances, services: twitch ? { "twitch.live": serviceInstances["twitch.live"][0].methods } : {}, messages: MSG, siteUrl: "https://www.exemple.fr" });
  if (oldCore) delete ctx.api.services.callAll;
  return { ctx, yt, conn, calls: () => yt.calls.detect };
}
const banner = (ctx) => def.slots["layout.banner"](ctx);
const player = (ctx) => def.sections.player(ctx);

test("manifeste : même identifiant et même plateforme, nom « Statut du live », deux sources facultatives, réglages simples avec valeurs par défaut sensées", async () => {
  const m = await assertValidManifest(manifest);
  assert.equal(m.id, "live-status");
  assert.equal(m.version, "1.4.1");
  assert.deepEqual(m.name, { en: "Live status", fr: "Statut du live" });
  assert.equal(m.platform, "twitch");
  assert.ok(m.requires.every((r) => r.optional === true && r.label.fr && r.label.en));
  const set = Object.fromEntries(m.settings.map((s) => [s.key, s]));
  assert.equal(set.playerPlatform.default, "twitch", "les deux en direct : Twitch d'abord, comme avant");
  assert.equal(set.youtubeLoad.default, "click", "YouTube : rien n'est chargé avant le clic");
  assert.deepEqual(set.youtubeLoad.options.map((o) => o.value), ["click", "auto"]);
  assert.match(m.privacy.fr, /YouTube/); assert.match(m.privacy.en, /YouTube/);
  assert.match(m.privacy.fr, /clic/); assert.match(m.privacy.en, /click/);
  assert.equal(m.minCore, "0.2.2");
  assert.ok(!m.offers && !(m.provides ?? []).length && !(m.consumes ?? []).length);
});

test("YouTube seul en direct : bannière « en direct sur YouTube » avec le lien de la vidéo ; hors direct : rien", async () => {
  const s = site();
  s.yt.goLive({ videoId: "LIVEvideo01", title: "Mon direct" });
  assert.deepEqual(await banner(s.ctx), [{ type: "banner", tone: "success", text: "EN DIRECT YOUTUBE", href: "https://www.youtube.com/watch?v=LIVEvideo01" }]);
  const off = site();
  assert.equal(await banner(off.ctx), null);
  assert.equal(await player(off.ctx), null);
});

test("YouTube seul : le lecteur est un bloc « au clic » (rien chargé avant), adresse nocookie de LA vidéo, aucune autre adresse externe", async () => {
  const s = site();
  s.yt.goLive({ videoId: "LIVEvideo01" });
  const [b] = await player(s.ctx);
  assert.equal(b.type, "html");
  assert.match(b.html, /<details><summary>▶ Lancer YouTube<\/summary>/);
  assert.ok(!/<details[^>]*open/.test(b.html), "fermé au départ");
  assert.match(b.html, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/LIVEvideo01\?rel=0&amp;autoplay=1"/);
  assert.match(b.html, /loading="lazy"/);
  assert.match(b.html, /Rien avant le clic/);
  const urls = [...b.html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(urls, ["https://www.youtube-nocookie.com/embed/LIVEvideo01?rel=0&amp;autoplay=1"], "une seule adresse externe, le lecteur ; ni image ni script ni feuille de style");
  assert.ok(!/<script|<img|<link|youtube\.com\/embed/.test(b.html));
});

test("YouTube seul, réglage « dès l'ouverture » : bloc embed nocookie muet (comme le lecteur Twitch)", async () => {
  const s = site({ own: { youtubeLoad: "auto" } });
  s.yt.goLive({ videoId: "LIVEvideo01" });
  assert.deepEqual(await player(s.ctx), [{ type: "embed", title: "YouTube — Chaîne YouTube", src: "https://www.youtube-nocookie.com/embed/LIVEvideo01?rel=0&mute=1" }]);
});

test("Twitch seul (Chaîne YouTube installée, hors direct) : exactement l'affichage d'avant, et la Chaîne YouTube n'est interrogée qu'une fois pour tout le monde", async () => {
  const s = site({ twitch: twitchStatus() });
  assert.deepEqual(await banner(s.ctx), [{ type: "banner", tone: "success", text: "helldog136 est en direct", href: "https://twitch.tv/helldog136" }]);
  assert.deepEqual(await player(s.ctx), [{ type: "embed", title: "Twitch — helldog136", src: "https://player.twitch.tv/?channel=helldog136&parent=www.exemple.fr&muted=true" }]);
  for (let i = 0; i < 40; i++) { await banner(s.ctx); await player(s.ctx); }
  assert.equal(s.calls(), 2, "une vérification (2 appels YouTube) malgré 80 pages vues");
});

test("Twitch seul SANS Chaîne YouTube : aucun appel à YouTube, rien de plus qu'avant", async () => {
  const s = site({ twitch: twitchStatus(), youtube: false });
  assert.deepEqual(await banner(s.ctx), [{ type: "banner", tone: "success", text: "helldog136 est en direct", href: "https://twitch.tv/helldog136" }]);
  assert.equal(s.yt.calls.all.length, 0);
  assert.equal((await player(s.ctx))[0].type, "embed");
  assert.deepEqual(await def.adminPanel(s.ctx), [], "Twitch prêt : aucun message");
});

test("les deux en direct : bannière à deux lignes nommant chaque plateforme, un seul lecteur (Twitch par défaut, YouTube au choix)", async () => {
  const s = site({ twitch: twitchStatus() });
  s.yt.goLive({ videoId: "LIVEvideo01", title: "Direct YouTube" });
  const [b] = await banner(s.ctx);
  assert.equal(b.type, "html");
  const rows = [...b.html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /<span class="k">Twitch<\/span>.*Soirée Zelda.*href="https:\/\/twitch\.tv\/helldog136"/);
  assert.match(rows[1], /<span class="k">YouTube<\/span>.*Direct YouTube.*href="https:\/\/www\.youtube\.com\/watch\?v=LIVEvideo01"/);
  const p = await player(s.ctx);
  assert.equal(p.length, 1); assert.equal(p[0].type, "embed"); assert.match(p[0].src, /^https:\/\/player\.twitch\.tv\//);
  const y = site({ twitch: twitchStatus(), own: { playerPlatform: "youtube" } });
  y.yt.goLive({ videoId: "LIVEvideo01" });
  const q = await player(y.ctx);
  assert.equal(q.length, 1); assert.equal(q[0].type, "html"); assert.match(q[0].html, /youtube-nocookie\.com\/embed\/LIVEvideo01/); assert.ok(!/twitch/.test(q[0].html));
});

test("YouTube en direct et Twitch hors ligne : bannière et lecteur YouTube (même avec « toujours » pour Twitch : pas de panneau « hors ligne »)", async () => {
  const s = site({ twitch: twitchStatus({ live: false }), own: { playerWhen: "always" } });
  s.yt.goLive({ videoId: "LIVEvideo01" });
  assert.equal((await banner(s.ctx))[0].text, "EN DIRECT YOUTUBE");
  const p = await player(s.ctx);
  assert.match(p[0].html, /youtube-nocookie/);
});

test("Twitch en direct et YouTube hors direct : comme avant (une ligne de bannière, lecteur Twitch)", async () => {
  const s = site({ twitch: twitchStatus() });
  const [b] = await banner(s.ctx);
  assert.equal(b.type, "banner"); assert.equal(b.href, "https://twitch.tv/helldog136");
});

test("aucune source : ni bannière ni lecteur ; l'administration le dit en mots simples avec la proposition d'installer l'une OU l'autre", async () => {
  const s = site({ youtube: false });
  assert.equal(await banner(s.ctx), null);
  assert.equal(await player(s.ctx), null);
  const blocks = await def.adminPanel(s.ctx);
  assert.deepEqual(blocks.map((b) => [b.type, b.service ?? b.text]), [["banner", "AUCUNE SOURCE"], ["suggestInstall", "twitch.live"], ["suggestInstall", "youtube.live"]]);
  assert.match(locales.fr.needSource, /Installez Ma Chaîne Twitch ou Chaîne YouTube/);
  assert.match(locales.en.needSource, /Install My Twitch channel or YouTube channel/);
  // Chaîne YouTube présente (même hors direct) ou Twitch présent : plus de proposition.
  const yt = site();
  assert.ok(!(await def.adminPanel(yt.ctx)).some((b) => b.type === "suggestInstall"));
  const tw = site({ twitch: twitchStatus(), youtube: false });
  assert.ok(!(await def.adminPanel(tw.ctx)).some((b) => b.type === "suggestInstall"));
});

test("Chaîne YouTube mal réglée ou en panne : l'administration dit quoi faire, les visiteurs ne voient rien de cassé, Twitch continue", async () => {
  const noChannel = site({ twitch: twitchStatus() });
  // Chaîne sans identifiant : le service répond « channel »
  const origAll = noChannel.ctx.api.services.callAll;
  noChannel.ctx.api.services.callAll = async (name, ...r) => (name === "youtube.live" ? [{ ok: true, instance: "c", name: "Chaîne YouTube", value: { ok: false, error: "channel" } }] : origAll(name, ...r));
  let a = await def.adminPanel(noChannel.ctx);
  assert.ok(a.some((b) => b.text === "CHAINE") && a.some((b) => b.type === "markdown" && b.text.includes("](/admin/modules/youtube-channel)")));
  assert.equal((await banner(noChannel.ctx))[0].type, "banner", "Twitch continue");
  for (const [error, text, link] of [["config", "CLE", "youtube-connector"], ["auth", "CLE", "youtube-connector"], ["unavailable", "CLE", "youtube-connector"], ["quota", "QUOTA"], ["rate", "QUOTA"], ["timeout", "PANNE"], ["network", "PANNE"], ["weird<script>", "PANNE"]]) {
    Y.resetYoutube();
    const s = site();
    s.ctx.api.services.callAll = async () => [{ ok: true, instance: "c", name: "Chaîne YouTube", value: { ok: false, error } }];
    a = await def.adminPanel(s.ctx);
    assert.ok(a.some((b) => b.type === "banner" && b.text === text), `${error} → ${text}`);
    if (link) assert.ok(a.some((b) => b.type === "markdown" && b.text.includes(`](/admin/modules/${link})`)), error);
    assert.equal(await banner(s.ctx), null); assert.equal(await player(s.ctx), null);
  }
});

test("la limite du jour atteinte chez YouTube (403 quotaExceeded) : ni bannière ni lecteur, aucune exception, et la panne est mémorisée (pas de nouvelle question pendant 2 minutes)", async () => {
  const s = site({ twitch: twitchStatus({ live: false }) });
  s.yt.detectFail = s.yt.fail.quota();
  let asked = 0;
  const orig = s.ctx.api.services.callAll;
  s.ctx.api.services.callAll = (name, ...r) => { if (name === "youtube.live") asked++; return orig(name, ...r); };
  assert.equal(await banner(s.ctx), null);
  assert.equal(asked, 1);
  for (let i = 0; i < 20; i++) { await banner(s.ctx); await player(s.ctx); }
  assert.equal(asked, 1, "aucune nouvelle question pendant la garde");
  mock.timers.tick(Y.timing.errorMs + 1000);
  await banner(s.ctx); await banner(s.ctx);
  assert.equal(asked, 2, "puis une nouvelle tentative, une seule");
});

test("YouTube muet (trou noir) : la page n'attend pas plus du délai prévu, aucune exception ; Twitch s'affiche", async () => {
  Y.timing.waitMs = 40;
  const s = site({ twitch: twitchStatus() });
  s.yt.detectFail = s.yt.fail.silence();
  const t0 = performance.now();
  const [b] = await banner(s.ctx);
  assert.ok(performance.now() - t0 < 1500);
  assert.equal(b.type, "banner"); assert.equal(b.href, "https://twitch.tv/helldog136");
  assert.equal(await player(site({ youtube: true }).ctx), null);
});

test("cache : en direct 3 minutes, hors direct 5 minutes ; jamais « fresh » ; une seule vérification pour 30 visiteurs simultanés", async () => {
  const s = site();
  await Promise.all(Array.from({ length: 30 }, () => banner(s.ctx)));
  assert.equal(s.calls(), 2, "30 visiteurs en même temps : une vérification (playlist + vidéos)");
  mock.timers.tick(Y.timing.offMs - 1000); await banner(s.ctx);
  assert.equal(s.calls(), 2, "encore gardé à 4 min 59");
  s.yt.goLive({ videoId: "LIVEvideo01" });
  mock.timers.tick(2000); await banner(s.ctx);
  assert.equal(s.calls(), 4, "à 5 minutes : nouvelle vérification, le direct est vu");
  mock.timers.tick(Y.timing.liveMs - 1000); await banner(s.ctx);
  assert.equal(s.calls(), 4, "en direct : gardé 3 minutes");
  mock.timers.tick(2000); await banner(s.ctx);
  assert.equal(s.calls(), 6);
  // le coût sur une journée de visites ininterrompues reste borné : au plus 1 vérification / 3 minutes = 2 unités × 480 = 960 unités (moins de 10 % des 10 000)
  assert.ok((24 * 60 / 3) * 2 <= 1000);
});

test("le service est interrogé SANS « fresh » et jamais en arrière-plan : aucun appel sans page affichée", async () => {
  const s = site();
  const seen = [];
  const orig = s.ctx.api.services.callAll;
  s.ctx.api.services.callAll = async (name, method, args) => { seen.push([name, method, JSON.stringify(args)]); return orig(name, method, args); };
  await banner(s.ctx);
  assert.deepEqual(seen.filter((x) => x[0] === "youtube.live"), [["youtube.live", "current", "{}"]]);
  const calls = s.calls();
  mock.timers.tick(3_600_000);
  assert.equal(s.calls(), calls, "une heure sans visiteur : aucune vérification");
});

test("échappement : titre, nom d'instance et identifiants hostiles ne produisent aucune balise ni adresse inattendue", async () => {
  const evil = `<img src=x onerror=alert(1)>"'&`;
  const s = site({ names: [evil, "Autre"], twitch: twitchStatus() });
  s.yt.goLive({ videoId: "LIVEvideo01", title: evil });
  const dump = JSON.stringify([await banner(s.ctx), await player(s.ctx)]);
  assert.ok(!dump.includes("<img"), "pas de balise du titre");
  const [b] = await banner(s.ctx);
  assert.match(b.html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  // identifiants de vidéo invalides renvoyés par un fournisseur : écartés
  for (const videoId of ['x" onload="a', "../../x", "short", "a".repeat(12), "", null, 42, "<script>aaaa"]) {
    Y.resetYoutube();
    const o = site({ twitch: twitchStatus({ live: false }) });
    o.ctx.api.services.callAll = async () => [{ ok: true, instance: "c", name: "N", value: { ok: true, live: true, videoId, title: "t" } }];
    assert.equal(await banner(o.ctx), null, String(videoId));
    assert.equal(await player(o.ctx), null);
  }
});

test("deux Chaînes YouTube en direct : une ligne par chaîne dans la bannière, un seul lecteur (la première)", async () => {
  const s = site({ names: ["YouTube principale", "YouTube jeux"] });
  s.yt.goLive({ videoId: "LIVEvideo01" });
  // les deux Chaînes lisent le même faux direct : une seule vidéo, dédoublonnée → la bannière simple
  assert.equal((await banner(s.ctx))[0].type, "banner");
  const p = await player(s.ctx);
  assert.equal(p.length, 1);
  Y.resetYoutube();
  const o = site({ names: ["A", "B"] });
  o.ctx.api.services.callAll = async () => ["AAAAAAAAAA1", "BBBBBBBBBB2"].map((v, i) => ({ ok: true, instance: `c${i}`, name: ["A", "B"][i], value: { ok: true, live: true, videoId: v, title: `Titre ${i}` } }));
  const [b2] = await banner(o.ctx);
  assert.equal([...b2.html.matchAll(/<li>/g)].length, 2);
  const p2 = await player(o.ctx);
  assert.equal(p2.length, 1); assert.match(p2[0].html, /AAAAAAAAAA1/); assert.ok(!/BBBBBBBBBB2/.test(p2[0].html));
});

test("vieux cœur sans callAll : YouTube est ignoré sans erreur, Twitch d'abord", async () => {
  const s = site({ twitch: twitchStatus(), oldCore: true });
  s.yt.goLive({ videoId: "LIVEvideo01" });
  assert.equal((await banner(s.ctx))[0].type, "banner");
  assert.equal(s.yt.calls.all.length, 0);
});

test("un fournisseur YouTube qui lève ou renvoie n'importe quoi : aucune exception", async () => {
  for (const callAll of [async () => { throw new Error("boom"); }, async () => null, async () => [null, {}, { ok: true, value: "x" }, { ok: true, value: { ok: true } }], async () => [{ ok: true, value: { ok: true, live: "oui", videoId: "LIVEvideo01" } }]]) {
    Y.resetYoutube();
    const s = site({ twitch: twitchStatus({ live: false }) });
    const orig = s.ctx.api.services.callAll;
    s.ctx.api.services.callAll = (name, ...r) => (name === "youtube.live" ? callAll() : orig(name, ...r));
    assert.equal(await banner(s.ctx), null);
    assert.equal(await player(s.ctx), null);
    await def.adminPanel(s.ctx);
  }
});

test("textes : toutes les clés utilisées par le code existent en français et en anglais, mêmes clés dans les deux langues, variables conservées", () => {
  assert.deepEqual(Object.keys(locales.fr).sort(), Object.keys(locales.en).sort());
  const used = new Set();
  for (const f of ["index", "source", "adopt", "view", "youtube"]) for (const m of fs.readFileSync(new URL(`../modules/live-status/${f}.mjs`, import.meta.url), "utf8").matchAll(/ctx\.t\(\s*(?:"([A-Za-z_]+)"|c === 1 \? "([A-Za-z]+)" : "([A-Za-z]+)")|\[\s*"(yt[A-Za-z]+)",\s*"[a-z-]+"/g)) [m[1], m[2], m[3], m[4]].filter(Boolean).forEach((k) => used.add(k));
  for (const k of ["liveYoutube", "ytStart", "ytNote", "needSource", "suggestTwitch", "suggestYoutube", "ytNeedChannel", "ytNeedKey", "ytQuota", "ytDown", "openYoutube", "openYoutubeConnector"]) {
    for (const l of ["fr", "en"]) assert.ok(locales[l][k]?.trim(), `${l}.${k}`);
  }
  for (const k of used) for (const l of ["fr", "en"]) assert.ok(locales[l][k], `clé « ${k} » manquante en ${l}`);
  assert.match(locales.fr.liveYoutube, /YouTube/); assert.match(locales.en.liveYoutube, /YouTube/);
  assert.match(locales.fr.ytNote, /Rien n'est chargé/); assert.match(locales.en.ytNote, /Nothing is loaded/);
});

test("le code ne parle jamais à YouTube lui-même (aucune adresse d'API, aucune clé, aucun fetch)", () => {
  for (const f of fs.readdirSync(new URL("../modules/live-status", import.meta.url).pathname).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(new URL(`../modules/live-status/${f}`, import.meta.url), "utf8");
    assert.ok(!/fetch\(|googleapis\.com|api[_-]?key|\bkey=/i.test(src), f);
  }
});

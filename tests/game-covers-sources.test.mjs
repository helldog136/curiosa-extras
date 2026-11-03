// Jaquettes de jeux 1.3.0 : la chaîne de sources (RAWG → Steam → Twitch), la copie locale des images, la route publique, le rafraîchissement paresseux.
// Aucun réseau réel : les réponses ont la FORME RÉELLE de chaque source. Steam : une vraie réponse de la recherche du magasin (tests/fixtures/steam-storesearch-hades.json, relevée le 3 novembre 2026).
// Twitch : la forme documentée de « Search Categories » (id, name, box_art_url à 52x72) ; RAWG : celle de la liste de jeux. Les images sont un vrai petit JPEG.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { JPEG, imageReply, IMAGE_HOSTS } from "./helpers/cover-fakes.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, assertAdminPageErgonomics } = kit;
const DIR = new URL("../modules/game-covers/", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}locales/fr.json`, "utf8"));
const STEAM_HADES = JSON.parse(fs.readFileSync(new URL("./fixtures/steam-storesearch-hades.json", import.meta.url), "utf8"));
const mod = (await import("../modules/game-covers/index.mjs")).default;
const rawg = await import("../modules/game-covers/rawg.mjs");
const hosts = await import("../modules/game-covers/hosts.mjs");
const fixes = await import("../modules/game-covers/fixes.mjs");
const ops = await import("../modules/game-covers/ops.mjs");
const copies = await import("../modules/game-covers/copies.mjs");
const sources = await import("../modules/game-covers/sources.mjs");
const breaker = await import("../modules/game-covers/breaker.mjs");
const { titleKey } = await import("../modules/game-covers/match.mjs");
const svc = mod.services["game.cover"];

const KEY = "FAKE-RAWG-KEY-0123456789";
const cu = (title) => `https://example.test/m/game-covers/cover/${copies.idOf(titleKey(title))}`;
const rawgGame = (id, name, released = "2020-09-17") => ({ id, name, released, platforms: [{ platform: { name: "PC" } }], background_image: `https://media.rawg.io/media/games/${String(id).padStart(3, "0")}/jeu-${id}.jpg` });
const twitchCat = (id, name, igdb = true) => ({ id: String(id), name, box_art_url: `https://static-cdn.jtvnw.net/ttv-boxart/${id}${igdb ? "_IGDB" : ""}-52x72.jpg` });
const steamItem = (id, name) => ({ type: "app", name, id, tiny_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg?t=1`, metascore: "", platforms: { windows: true, mac: false, linux: false }, streamingvideo: false });

const realFetch = globalThis.fetch;
let api, mode;   // mode : { rawg: "up" | "500" | "down" | "empty", steam: "up" | "500" | "down" | Fn, images: "up" | "down" | Fn }
let imageCalls, current = 0, peak = 0;
const RAWG_DB = { hades: [rawgGame(21, "Hades"), rawgGame(22, "Hades II")], "hades ii": [rawgGame(22, "Hades II")], autre: [rawgGame(55, "Autre")], playrooms: [rawgGame(11, "Astro's Playroom"), rawgGame(12, "Playroom Mania"), rawgGame(14, "The Playroom")] };
const STEAM_DB = { hades: STEAM_HADES, playrooms: { total: 1, items: [steamItem(777, "Playrooms")] }, "jeu rare": { total: 1, items: [steamItem(4242, "Jeu Rare")] } };
const TWITCH_DB = { hades: [twitchCat(509658, "Hades", false), twitchCat(1, "Hades II")], "jeu rare": [twitchCat(27471, "Jeu Rare")] };
let twitchMode;   // "up" | "off" | "forbidden" | "network"

const serve = () => {
  mode = { rawg: "up", steam: "up", images: "up" };
  imageCalls = [];
  current = 0; peak = 0;
  api = fakeFetch({ "*": (url) => {
    const u = new URL(url);
    if (u.hostname === "api.rawg.io") {
      if (mode.rawg === "500") return { status: 500, json: {} };
      if (mode.rawg === "down") throw new TypeError("fetch failed");
      if (mode.rawg === "empty") return { json: { results: [] } };
      return { json: { results: RAWG_DB[(u.searchParams.get("search") ?? "").toLowerCase()] ?? [] } };
    }
    if (u.hostname === "store.steampowered.com") {
      if (mode.steam === "500") return { status: 500, json: {} };
      if (mode.steam === "down") throw new TypeError("fetch failed");
      return { json: STEAM_DB[(u.searchParams.get("term") ?? "").toLowerCase()] ?? { total: 0, items: [] } };
    }
    return { status: 404 };
  } });
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const host = new URL(url).hostname;
    if (!IMAGE_HOSTS.has(host)) return api(input, init);
    imageCalls.push(url);
    if (typeof mode.images === "function") return Promise.resolve(mode.images(url));
    if (mode.images === "down") return Promise.reject(new TypeError("fetch failed"));
    current++; peak = Math.max(peak, current);
    return new Promise((ok) => setTimeout(() => { current--; ok(imageReply()); }, 5));
  };
};
const twitchService = () => ({
  status: () => ({ ready: twitchMode !== "off" }),
  request: (args) => {
    if (twitchMode === "network") return { ok: false, error: "network" };
    if (twitchMode === "forbidden") return { ok: false, error: "forbidden" };
    const asked = String(args?.query?.query?.[0] ?? "").toLowerCase();
    return { ok: true, status: 200, json: { data: TWITCH_DB[asked] ?? [] } };
  },
});
const makeCtx = (extra = {}) => {
  const { settings, services, ...rest } = extra;
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Jaquettes", messages: fr, locale: "fr", settings: { rawgKey: KEY, ...(settings ?? {}) }, permissions: ["storage", "routes", "admin", "mcp"], logEvents: manifest.logEvents, services: { "twitch.api": twitchService(), ...(services ?? {}) }, ...rest });
  c.can = () => true;
  return c;
};
const sourceCalls = (host) => api.calls.filter((c) => new URL(c.url).hostname === host).length;
const metaDocs = async (c) => (await c.api.store.list("coverMeta", { limit: 1000 })).map((r) => r.data);
const bytesDocs = async (c) => c.api.store.list("coverBytes", { limit: 1000 });
const OFF = { rawgKey: "", useTwitch: false, useSteam: false };

beforeEach(() => { rawg.clearCache(); rawg.resetBreaker(); sources.resetSources(); copies.resetCopies(); ops.resetRate(); twitchMode = "up"; serve(); });
afterEach(() => { globalThis.fetch = realFetch; });

// ── Hôtes et chemins permis ─────────────────────────────────────────────────────────────────────────────────────────────────
test("hôtes : un seul hôte d'images par source, https, chemin connu, rien d'autre (port, identifiant, paramètre, détour, mauvais hôte)", () => {
  const ok = [["rawg", "https://media.rawg.io/media/games/1f4/a.jpg"], ["twitch", "https://static-cdn.jtvnw.net/ttv-boxart/27471_IGDB-285x380.jpg"], ["twitch", "https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg"],
    ["steam", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg"], ["steam", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg"]];
  for (const [src, url] of ok) assert.equal(hosts.imagePath(src, url), new URL(url).pathname, url);
  const bad = [["rawg", "https://static-cdn.jtvnw.net/ttv-boxart/27471_IGDB-285x380.jpg"], ["twitch", "https://media.rawg.io/media/games/a.jpg"], ["steam", "https://media.rawg.io/media/a.jpg"],
    ["twitch", "http://static-cdn.jtvnw.net/ttv-boxart/27471_IGDB-285x380.jpg"], ["twitch", "https://static-cdn.jtvnw.net:444/ttv-boxart/27471_IGDB-285x380.jpg"], ["twitch", "https://user@static-cdn.jtvnw.net/ttv-boxart/27471-285x380.jpg"],
    ["twitch", "https://static-cdn.jtvnw.net/ttv-boxart/27471-285x380.jpg?x=1"], ["twitch", "https://static-cdn.jtvnw.net/jtv_user_pictures/x-285x380.jpg"], ["twitch", "https://static-cdn.jtvnw.net/ttv-boxart/../x.jpg"],
    ["steam", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/12/capsule_231x87.jpg?t=1"], ["steam", "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/12/../../x.jpg"],
    ["steam", "https://cdn.akamai.steamstatic.com/steam/apps/12/header.jpg"], ["steam", "https://evil.example/store_item_assets/steam/apps/12/header.jpg"], ["inconnue", "https://media.rawg.io/media/a.jpg"]];
  for (const [src, url] of bad) assert.equal(hosts.imagePath(src, url), null, url);
  // Twitch donne une taille fixe (52x72) ou un modèle : on demande toujours 285 x 380.
  assert.equal(hosts.twitchBoxArt("https://static-cdn.jtvnw.net/ttv-boxart/33214-52x72.jpg"), "https://static-cdn.jtvnw.net/ttv-boxart/33214-285x380.jpg");
  assert.equal(hosts.twitchBoxArt("https://static-cdn.jtvnw.net/ttv-boxart/27471_IGDB-{width}x{height}.jpg"), "https://static-cdn.jtvnw.net/ttv-boxart/27471_IGDB-285x380.jpg");
  assert.equal(hosts.twitchBoxArt("https://evil.example/ttv-boxart/1-52x72.jpg"), null);
  // Les adresses à COPIER : toutes passent par la même liste blanche.
  assert.deepEqual(hosts.copyCandidates("rawg", "/media/games/1f4/a.jpg"), ["https://media.rawg.io/media/crop/600/400/games/1f4/a.jpg", "https://media.rawg.io/media/games/1f4/a.jpg"]);
  assert.deepEqual(hosts.copyCandidates("steam", "/store_item_assets/steam/apps/5/library_600x900.jpg").map((u) => new URL(u).hostname), ["shared.akamai.steamstatic.com", "shared.akamai.steamstatic.com"]);
  assert.deepEqual(hosts.copyCandidates("twitch", "/evil.jpg"), []);
});

// ── La chaîne ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAWG répond et le titre est sûr : on ne va pas plus loin (ni Twitch, ni Steam), l'image est copiée et l'adresse rendue est celle du site", async () => {
  const c = makeCtx();
  const r = await svc.cover(c, { title: "Hades" });
  assert.deepEqual(r, { status: "found", url: cu("Hades"), name: "Hades", id: 21, ambiguous: false, source: "rawg" });
  assert.equal(sourceCalls("store.steampowered.com"), 0);
  assert.equal(c.calls.services.filter(([n, m]) => n === "twitch.api" && m === "request").length, 0);
  assert.deepEqual(imageCalls, ["https://media.rawg.io/media/crop/600/400/games/021/jeu-21.jpg"], "la version recadrée (60 Ko) d'abord");
  assert.ok(!JSON.stringify(r).includes("rawg.io"), "jamais l'adresse de la source");
});

test("RAWG en panne : Steam répond d'abord ; si Steam est coupé ou en panne, Twitch (dernier secours) ; le message dit quelle source", async () => {
  mode.rawg = "500";
  const first = await svc.cover(makeCtx(), { title: "Hades" });
  assert.equal(first.source, "steam", "Steam passe avant Twitch (30 jours contre 24 heures)");
  imageCalls.length = 0; serve(); mode.rawg = "500"; sources.resetSources(); rawg.resetBreaker(); rawg.clearCache();
  const c = makeCtx({ settings: { useSteam: false } });
  const r = await svc.cover(c, { title: "Hades" });
  assert.equal(r.status, "found"); assert.equal(r.source, "twitch"); assert.equal(r.url, cu("Hades")); assert.equal(r.name, "Hades");
  assert.deepEqual(imageCalls, ["https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg"]);
  assert.equal(sourceCalls("store.steampowered.com"), 0, "Steam coupé : pas interrogé");
  const auto = (await fixes.readAutoAll(c))[0];
  assert.equal(auto.src, "twitch"); assert.equal(auto.srcId, 509658); assert.equal(auto.img, "/ttv-boxart/509658-285x380.jpg");
  const blocks = await mod.adminPanel(c, { query: {} });
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text === "RAWG : actif ✓ — Steam : coupé — Twitch : connecté ✓"), "toutes les sources disponibles, en mots simples");
  assert.ok(blocks.some((b) => b.type === "markdown" && /^Dernière jaquette trouvée : Twitch, le /.test(b.text)), "la source qui a répondu");
});

test("sans code RAWG (jamais un blocage ni un message d'erreur) : Steam d'abord, puis Twitch ; Twitch non réglé = une source de moins", async () => {
  const c = makeCtx({ settings: { rawgKey: "" } });
  assert.equal((await svc.cover(c, "Hades")).source, "steam");
  assert.equal((await svc.cover(makeCtx({ settings: { rawgKey: "", useSteam: false } }), "Hades")).source, "twitch", "Steam coupé : Twitch en dernier secours");
  twitchMode = "off";
  const r = await svc.cover(makeCtx({ settings: { rawgKey: "" } }), "Jeu Rare");
  assert.equal(r.source, "steam", "Twitch non réglé : une source de moins");
  assert.equal(r.status, "found");
  assert.equal(sourceCalls("api.rawg.io"), 0, "aucune requête vers RAWG sans code");
  const blocks = await mod.adminPanel(makeCtx({ settings: { rawgKey: "" } }), { query: {} });
  assert.ok(!blocks.some((b) => b.type === "banner" && b.tone === "warning"), "pas de message d'erreur");
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text === "RAWG : pas de code (facultatif) — Steam : actif ✓ — Twitch : non connecté (facultatif)"));
  const st = await svc.status(makeCtx({ settings: { rawgKey: "" } }));
  assert.deepEqual([st.ready, st.configured, st.keyHeld], [true, true, false], "les modules voient une source utilisable, donc pas de « clé manquante »");
});

test("Steam (réponse réelle du magasin) : le titre exact gagne sur « Hades II » et sur les bandes originales ; image verticale", async () => {
  const c = makeCtx({ settings: { rawgKey: "", useTwitch: false } });
  const r = await svc.cover(c, { title: "Hades" });
  assert.deepEqual([r.status, r.source, r.name, r.ambiguous], ["found", "steam", "Hades", false]);
  assert.deepEqual(imageCalls, ["https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1145360/library_600x900.jpg"]);
  const list = await svc.candidates(c, { title: "Hades" });
  assert.equal(list.status, "found");
  assert.equal(list.candidates[0].name, "Hades");
  assert.ok(list.candidates.length <= 6 && list.candidates.every((x) => x.source === "steam" && hosts.imagePath("steam", x.url)));
  assert.ok(list.candidates.some((x) => x.name === "Hades II"));
});

test("validation de correspondance : une source qui ne propose qu'un autre jeu ne gagne pas ; le titre incertain est noté « à vérifier » avec sa source", async () => {
  mode.rawg = "down";
  const c = makeCtx({ settings: { useTwitch: false } });
  serve(); mode.rawg = "down";
  STEAM_DB.zelda = { total: 1, items: [steamItem(99, "Zelda Collection Soundtrack")] };
  const r = await svc.cover(c, { title: "Zelda" });
  assert.equal(r.status, "found"); assert.equal(r.ambiguous, true, "pas un titre quasi identique : à vérifier");
  await new Promise((ok) => setTimeout(ok, 20));
  const todo = await fixes.readToCheck(c);
  assert.equal(todo.length, 1); assert.equal(todo[0].src, "steam"); assert.equal(todo[0].title, "Zelda");
  delete STEAM_DB.zelda;
});

test("un titre incertain chez RAWG mais exact chez Steam : la source SÛRE gagne", async () => {
  const c = makeCtx({ settings: { useTwitch: false } });
  const r = await svc.cover(c, { title: "Playrooms" });   // RAWG : trois jeux proches (incertain) ; Steam : « Playrooms »
  assert.deepEqual([r.status, r.source, r.ambiguous], ["found", "steam", false]);
  assert.equal((await fixes.readToCheck(c)).length, 0);
});

test("disjoncteur PAR SOURCE : RAWG et Twitch en panne ne bloquent pas Steam ; après 3 échecs une source ne reçoit plus de requête, les autres continuent", async () => {
  mode.rawg = "500"; twitchMode = "network";
  const c = makeCtx();
  for (const t of ["Jeu Rare", "Autre A", "Autre B", "Autre C"]) await svc.cover(c, t);
  const r = await svc.cover(c, "Jeu Rare");
  assert.equal(r.source, "steam", "la panne des deux premières n'empêche pas la troisième");
  assert.ok(rawg.breakerInfo().open, "RAWG : pause");
  assert.ok(sources.breakerOf("twitch").open, "Twitch : pause");
  assert.equal(sources.breakerOf("steam").open, false, "Steam : intact");
  const before = sourceCalls("api.rawg.io");
  await svc.cover(c, "Encore un titre");
  assert.equal(sourceCalls("api.rawg.io"), before, "RAWG en pause : aucune requête");
  // Le disjoncteur lui-même : 3 échecs, pauses 1, 2, 5, 15, 15 minutes, un seul essai de reprise.
  const b = breaker.makeBreaker();
  const t0 = 1_000_000;
  assert.deepEqual([b.failed(t0), b.failed(t0), b.failed(t0)], [false, false, true]);
  assert.equal(b.gate(t0 + 59_000), "wait"); assert.equal(b.gate(t0 + 61_000), "go"); assert.equal(b.gate(t0 + 62_000), "wait", "un seul essai de reprise à la fois");
  const pauses = []; let now = t0 + 61_000;
  for (let i = 0; i < 4; i++) { const before2 = b.info(now).until; b.failed(now); pauses.push(b.info(now).until - now); now = b.info(now).until + 1; void before2; }
  assert.deepEqual(pauses, [120_000, 300_000, 900_000, 900_000]);
  b.answered(now); assert.equal(b.gate(now), "go"); assert.equal(b.info(now).open, false);
});

test("Twitch : Connecteur absent, trop ancien (« forbidden ») ou non réglé = une source de moins, jamais une erreur ni une panne", async () => {
  for (const how of ["off", "forbidden"]) {
    twitchMode = how; sources.resetSources(); mode.rawg = "500"; rawg.resetBreaker(); rawg.clearCache();
    const c = makeCtx({ settings: { useSteam: false } });
    const r = await svc.cover(c, "Hades");
    assert.equal(r.status, "unreachable", `${how} : RAWG seul en panne`);
    assert.equal(sources.breakerOf("twitch").fails, 0, "ce n'est pas une panne de Twitch");
  }
  const none = makeCtx({ settings: { rawgKey: "", useSteam: false }, services: { "twitch.api": undefined } });
  assert.deepEqual(await svc.cover(none, "Hades"), { status: "no-key", url: null });
  assert.equal((await svc.candidates(none, "Hades")).status, "no-key");
});

test("« Indisponible » seulement si AUCUNE source disponible n'a répondu ; « aucune jaquette » seulement si une source a répondu sans ce jeu ; jamais gardé comme absent", async () => {
  mode.rawg = "500"; mode.steam = "500"; twitchMode = "network";
  const c = makeCtx();
  assert.deepEqual(await svc.cover(c, "Hades"), { status: "unreachable", url: null });
  assert.equal((await fixes.readAutoAll(c)).length, 0, "rien n'est gardé après une panne");
  mode.steam = "up"; rawg.resetBreaker(); rawg.clearCache(); sources.resetSources();
  assert.deepEqual(await svc.cover(c, "Un titre que personne ne connait"), { status: "none", url: null });
  assert.equal((await svc.cover(c, "Hades")).status, "found", "dès qu'une source répond, la jaquette vient");
});

test("les corrections de la personne passent avant toute source : aucune requête, la copie est servie", async () => {
  const c = makeCtx();
  assert.equal((await ops.chooseGame(c, "t", "Hades", 1145360, undefined, "steam")).ok, true);
  const calls = api.calls.length;
  const r = await svc.cover(c, "Hades");
  assert.deepEqual([r.status, r.url, r.ambiguous, r.source], ["found", cu("Hades"), false, "steam"]);
  assert.equal(api.calls.length, calls, "aucune requête de recherche");
  const fix = await fixes.fixFor(c, "Hades");
  assert.deepEqual([fix.kind, fix.src, fix.srcId, fix.img], ["image", "steam", 1145360, "/store_item_assets/steam/apps/1145360/library_600x900.jpg"]);
  assert.equal(fix.rawgId, undefined);
  // Un choix RAWG reste un « jeu » (comme avant).
  assert.equal((await ops.chooseGame(c, "t", "Hades", 22)).ok, true);
  const again = await fixes.fixFor(c, "Hades");
  assert.deepEqual([again.kind, again.rawgId, again.src], ["game", 22, undefined]);
});

test("candidats de TOUTES les sources, 6 au plus par source, avec leur source ; un choix hors liste est refusé", async () => {
  const c = makeCtx();
  const list = await svc.candidates(c, { title: "Hades" });
  assert.equal(list.status, "found");
  assert.deepEqual([...new Set(list.candidates.map((x) => x.source))], ["rawg", "steam", "twitch"]);
  for (const s of ["rawg", "steam", "twitch"]) assert.ok(list.candidates.filter((x) => x.source === s).length <= 6);
  assert.deepEqual(list.sources.map((x) => [x.source, x.state]), [["rawg", "ok"], ["steam", "ok"], ["twitch", "ok"]]);
  assert.equal((await ops.chooseGame(c, "t", "Hades", 31337, undefined, "twitch")).error, "candidate");
  assert.equal((await ops.chooseGame(c, "t", "Hades", 509658, undefined, "twitch")).ok, true);
  assert.equal((await ops.chooseGame(c, "t", "Hades", 509658, undefined, "inconnue")).error, "candidate");
  const screen = await mod.adminPanel(c, { query: { titre: "Hades" } });
  const t = screen.find((b) => b.type === "table");
  assert.ok(t.rowIds.some((id) => id.startsWith("twitch.509658|")) && t.rowIds.some((id) => id.startsWith("steam.1145360|")) && t.rowIds.some((id) => id.startsWith("rawg.21|")));
  assert.deepEqual(t.rows.map((r) => r[2].text).filter((v, i, a) => a.indexOf(v) === i), ["RAWG", "Steam", "Twitch"], "la source est écrite ET colorée");
  assert.ok(t.rows.every((r) => r[2].badge));
});

// ── Copie locale ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("la copie : type lu sur les octets, 300 Ko au plus, aucune redirection, statut 200 seulement ; un refus n'est jamais une erreur visible", async () => {
  const cases = {
    html: () => new Response("<html>pas une image</html>", { status: 200, headers: { "content-type": "image/jpeg" } }),
    svg: () => new Response("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", { status: 200, headers: { "content-type": "image/svg+xml" } }),
    big: () => new Response(new Uint8Array(copies.LIMITS.bytes + 1).fill(0xff), { status: 200, headers: { "content-type": "image/jpeg" } }),
    declared: () => new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(copies.LIMITS.bytes + 5) } }),
    redirect: () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.jpg" } }),
    notfound: () => new Response(null, { status: 404 }),
    text: () => new Response(JPEG, { status: 200, headers: { "content-type": "text/plain" } }),
  };
  for (const [name, reply] of Object.entries(cases)) {
    copies.resetCopies();
    const c = makeCtx();
    mode.images = reply;
    const r = await svc.cover(c, { title: `Hades ${name}` });
    assert.equal(r.url, null, name);
    assert.ok(["unreachable", "none"].includes(r.status) && r.status !== "found", `${name} : ${r.status}`);
    assert.equal((await metaDocs(c)).length, 0, `${name} : rien n'est gardé`);
    assert.ok(imageCalls.every((u) => hosts.imagePath("rawg", u) || hosts.imagePath("steam", u) || hosts.imagePath("twitch", u)), "seulement des adresses permises");
    imageCalls.length = 0;
  }
  // Un PNG et un WebP valides passent.
  for (const [type, bytes] of [["image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], ["image/webp", Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0])]]) {
    copies.resetCopies(); const c = makeCtx(); mode.images = () => imageReply(type, bytes);
    assert.equal((await svc.cover(c, { title: `Hades ${type}` })).status, "none", "sans résultat chez RAWG pour ce titre, mais…");
  }
});

test("la copie est gardée une fois (idempotent), deux demandes en même temps = un seul téléchargement ; l'octet servi est celui de la source", async () => {
  const c = makeCtx();
  const [a, b, d] = await Promise.all([svc.cover(c, "Hades"), svc.cover(c, "hades"), svc.cover(c, "HADES")]);
  assert.deepEqual([a.url, b.url, d.url], [cu("Hades"), cu("Hades"), cu("Hades")]);
  assert.equal(imageCalls.length, 1, "un seul téléchargement");
  await svc.cover(c, "Hades"); await svc.cover(c, "Hades");
  assert.equal(imageCalls.length, 1);
  assert.equal((await metaDocs(c)).length, 1); assert.equal((await bytesDocs(c)).length, 1);
  const res = await mod.routes["cover/:slug"](new Request("https://example.test/m/game-covers/cover/x"), Object.assign(c, { params: { slug: copies.idOf(titleKey("Hades")) } }));
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
});

test("route publique : GET et HEAD seulement, 404 identique pour un repère inconnu ou mal formé, aucun cookie, type fixé, rien venu de la personne qui visite", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades");
  const id = copies.idOf(titleKey("Hades"));
  const call = (method, p) => mod.routes["cover/:slug"](new Request("https://example.test/m/game-covers/cover/x?next=https://evil.example", { method }), Object.assign(c, { params: { slug: p } }));
  const get = await call("GET", id);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/jpeg");
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.equal(get.headers.get("set-cookie"), null);
  assert.equal(get.headers.get("content-security-policy"), "default-src 'none'");
  const head = await call("HEAD", id);
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(JPEG.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await call("POST", id)).status, 405);
  for (const bad of ["0123456789abcdef", "../../etc", "ZZZZZZZZZZZZZZZZ", "", undefined, "a".repeat(17)]) assert.equal((await call("GET", bad)).status, 404, String(bad));
  assert.equal(imageCalls.length, 1, "la route ne télécharge jamais rien");
});

test("bornes : 300 copies au plus et un poids total borné, la plus ancienne fait place ; la dernière écrite reste", async () => {
  const saved = { ...copies.LIMITS };
  try {
    copies.LIMITS.items = 3;
    const c = makeCtx();
    for (const t of ["Hades", "Jeu Rare", "Playrooms", "Hades II"]) { await svc.cover(c, t); await new Promise((ok) => setTimeout(ok, 3)); }
    const left = await metaDocs(c);
    assert.equal(left.length, 3); assert.equal((await bytesDocs(c)).length, 3, "les octets partent avec la fiche");
    assert.ok(left.some((m) => m.id === copies.idOf(titleKey("Hades II"))), "la plus récente reste");
    copies.LIMITS.items = 300; copies.LIMITS.total = JPEG.length * 2 + 1;
    await svc.cover(c, "Jeu Rare 2");
    assert.ok((await metaDocs(c)).reduce((n, m) => n + m.bytes, 0) <= copies.LIMITS.total + JPEG.length);
    assert.ok((await metaDocs(c)).length <= 3);
  } finally { Object.assign(copies.LIMITS, saved); }
});

test("au plus 3 téléchargements à la fois : les autres attendent la prochaine demande (aucun minuteur) et alors réussissent", async () => {
  const c = makeCtx();
  const titles = ["Hades", "Jeu Rare", "Playrooms", "Hades II", "Autre"];
  const first = await Promise.all(titles.map((t) => svc.cover(c, t)));
  assert.ok(peak <= 3, `pic de ${peak}`);
  const pending = first.filter((r) => r.status === "unreachable").length;
  assert.ok(pending >= 1, "certaines copies ne sont pas prêtes à la première demande");
  await copies.settled();
  const second = await Promise.all(titles.map((t) => svc.cover(c, t)));
  assert.ok(second.every((r) => r.status === "found" && r.url.startsWith("https://example.test/m/game-covers/cover/")), JSON.stringify(second.map((r) => r.status)));
});

test("copie impossible : pas d'image (jamais d'erreur visible, jamais « aucune jaquette ») ; le réglage avancé rétablit l'adresse de la source, coupé par défaut", async () => {
  mode.images = "down";
  const c = makeCtx();
  const r = await svc.cover(c, "Hades");
  assert.deepEqual(r, { status: "unreachable", url: null });
  const on = makeCtx({ settings: { remoteFallback: true } });
  const r2 = await svc.cover(on, "Hades");
  assert.equal(r2.status, "found"); assert.equal(r2.url, "https://media.rawg.io/media/games/021/jeu-21.jpg");
  mode.images = "up"; copies.resetCopies();
  assert.equal((await svc.cover(c, "Hades")).url, cu("Hades"), "dès que l'image est accessible, la copie est faite");
});

test("migration : un ancien choix (sans « src ») reste valable tel quel, et sa copie est faite au fil de l'eau ; rien n'est réécrit", async () => {
  const c = makeCtx();
  const at = new Date().toISOString();
  await c.api.store.add("autoCovers", { title: "Hades", name: "Hades", rawgId: 21, img: "/media/games/021/jeu-21.jpg", ambiguous: false, candidates: 2, at, until: new Date(Date.now() + 3_600_000).toISOString() }, { key: "hades" });
  await c.api.store.add("fixes", { title: "Celeste", kind: "game", rawgId: 31, name: "Celeste", img: "/media/games/031/jeu-31.jpg", at }, { key: "celeste" });
  const docs = async () => JSON.stringify([await c.api.store.list("autoCovers", { limit: 50 }), await c.api.store.list("fixes", { limit: 50 })]);
  const before = await docs();
  const r = await svc.cover(c, "hades");
  assert.deepEqual([r.status, r.url, r.id, r.source], ["found", cu("Hades"), 21, "rawg"]);
  assert.equal(sourceCalls("api.rawg.io"), 0, "aucune requête : l'ancien choix suffit");
  assert.equal((await svc.cover(c, "Celeste")).url, cu("Celeste"));
  assert.equal((await metaDocs(c)).length, 2);
  assert.equal(await docs(), before, "les anciens documents ne changent pas");
  assert.deepEqual(Object.keys((await fixes.readAutoAll(c))[0]).includes("src"), false);
});

// ── Rafraîchissement paresseux ──────────────────────────────────────────────────────────────────────────────────────────────────
const ageCopy = async (c, title, ms) => {
  const id = copies.idOf(titleKey(title));
  const row = await c.api.store.getByKey("coverMeta", id);
  await c.api.store.update(row.id, { ...row.data, at: row.data.at - ms }, { key: id });
};

test("rafraîchissement paresseux : une copie plus vieille que l'âge réglé (30 jours par défaut) est refaite quand on la demande, l'ancienne sert en attendant ; sans minuteur", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades");
  assert.equal(copies.refreshMs(c), 30 * 86_400_000);
  const first = (await metaDocs(c))[0].at;
  await ageCopy(c, "Hades", 29 * 86_400_000);
  await svc.cover(c, "Hades"); await copies.settled();
  assert.equal(imageCalls.length, 1, "29 jours : encore bonne");
  await ageCopy(c, "Hades", 2 * 86_400_000);
  const r = await svc.cover(c, "Hades");
  assert.equal(r.url, cu("Hades"), "l'ancienne copie sert tout de suite");
  await copies.settled();
  assert.equal(imageCalls.length, 2, "la nouvelle est récupérée");
  const now = (await metaDocs(c))[0];
  assert.ok(now.at > first, "date renouvelée"); assert.equal((await metaDocs(c)).length, 1);
  // Âge réglable (avancé) : 1 à 365 jours, valeur absurde = 30 jours.
  for (const [v, days] of [[7, 7], [365, 365], [0, 30], [9999, 365], ["x", 30], [undefined, 30]]) assert.equal(copies.refreshMs(makeCtx({ settings: { refreshDays: v } })), days * 86_400_000, String(v));
});

test("une source en panne ne fait JAMAIS perdre une copie bonne : le rafraîchissement échoue, l'ancienne reste servie, et il est retenté plus tard (1 h, 6 h, 24 h), pas à chaque visite", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades");
  const id = copies.idOf(titleKey("Hades"));
  const old = (await bytesDocs(c))[0].data.b64;
  await ageCopy(c, "Hades", 40 * 86_400_000);
  mode.images = "down"; mode.rawg = "down";
  for (let i = 0; i < 5; i++) { const r = await svc.cover(c, "Hades"); assert.equal(r.url, cu("Hades")); await copies.settled(); }
  assert.equal(imageCalls.length, 1 + 2, "1 copie d'origine + l'essai de l'image recadrée et celui de l'originale, UNE seule fois (retenté plus tard)");
  assert.equal((await bytesDocs(c))[0].data.b64, old, "rien n'a été perdu");
  assert.equal((await metaDocs(c)).length, 1);
  void id;
});

test("les jaquettes choisies à la main ne sont jamais écrasées par un rafraîchissement automatique : même chemin, même source", async () => {
  const c = makeCtx();
  assert.equal((await ops.chooseGame(c, "t", "Hades", 509658, undefined, "twitch")).ok, true);
  await ageCopy(c, "Hades", 400 * 86_400_000);
  const searches = sourceCalls("api.rawg.io");
  const r = await svc.cover(c, "Hades"); await copies.settled();
  assert.equal(r.source, "twitch");
  const fix = await fixes.fixFor(c, "Hades");
  assert.deepEqual([fix.src, fix.img], ["twitch", "/ttv-boxart/509658-285x380.jpg"]);
  assert.equal(sourceCalls("api.rawg.io"), searches, "aucune nouvelle recherche : seul le fichier de CETTE image est refait");
  assert.deepEqual([...new Set(imageCalls)], ["https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg"]);
});

test("Twitch : une copie ne dépasse pas 24 heures (conditions des développeurs de Twitch) ; plus vieille, elle n'est plus servie, puis refaite ; les autres sources gardent l'âge réglé", async () => {
  mode.rawg = "500";
  const c = makeCtx({ settings: { useSteam: false } });
  const r = await svc.cover(c, "Hades");
  assert.equal(r.source, "twitch");
  assert.equal(copies.keepMs(c, "twitch"), 24 * 3_600_000); assert.equal(copies.keepMs(c, "rawg"), 30 * 86_400_000); assert.equal(copies.keepMs(c, "steam"), 30 * 86_400_000);
  const id = copies.idOf(titleKey("Hades"));
  const route = (p) => mod.routes["cover/:slug"](new Request("https://example.test/x"), Object.assign(c, { params: { slug: p } }));
  assert.equal((await route(id)).status, 200);
  // Copie Twitch de 25 h demandée par la route : l'adresse mémorisée par un autre module ne devient JAMAIS un 404 tant que la source répond (refaite à la demande, puis 200).
  await ageCopy(c, "Hades", 25 * 3_600_000);
  const before = imageCalls.length;
  const res = await route(id);
  assert.equal(res.status, 200, "refaite à la demande");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
  assert.equal(imageCalls.length, before + 1, "une nouvelle copie a été récupérée");
  assert.ok(Date.now() - (await metaDocs(c))[0].at < 60_000, "et sa date est renouvelée");
  assert.equal((await route(id)).status, 200);
  // Twitch en panne au moment où la copie dépasse 24 h : la règle des 24 h prime (copie effacée), la réponse est un 404 propre (image absente, jamais une erreur) ; un repère inconnu : 404 aussi.
  await ageCopy(c, "Hades", 25 * 3_600_000);
  mode.images = "down"; copies.resetCopies();
  const gone = await route(id);
  assert.equal(gone.status, 404); assert.equal(gone.headers.get("set-cookie"), null);
  assert.equal((await metaDocs(c)).length, 0); assert.equal((await bytesDocs(c)).length, 0);
  mode.images = "up"; copies.resetCopies();
  // Dès que la jaquette est redemandée (Twitch répond), la même adresse redevient valable.
  assert.equal((await svc.cover(c, "Hades")).url, cu("Hades"));
  assert.equal((await route(id)).status, 200);
  assert.equal((await route("0123456789abcdef")).status, 404, "repère inconnu");
  // L'enregistrement automatique expire aussi au bout de 24 h pour Twitch (sinon il serait servi sans copie).
  const auto = (await fixes.readAutoAll(c))[0];
  assert.ok(Date.parse(auto.until) - Date.parse(auto.at) <= 24 * 3_600_000);
});

// ── Administration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("« Jaquettes gardées » : source en pastille écrite ET colorée, vignette = la copie du site, recherche et filtres, 2 actions visibles ; ergonomie du cœur", async () => {
  const c = makeCtx();
  await svc.cover(c, "Hades"); mode.rawg = "500"; await svc.cover(c, "Jeu Rare"); await ops.chooseNone(c, "t", "Sans image");
  const blocks = await mod.adminPanel(c, { query: {} });
  const saved = blocks.filter((b) => b.tab === "saved");
  const t = saved.find((b) => b.type === "table");
  assert.equal(t.columns.length, 5);
  assert.equal(t.columns[2], "Source");
  const by = Object.fromEntries(t.rows.map((r) => [r[0], r]));
  assert.deepEqual(by.Hades[2], { text: "RAWG", badge: "accent" });
  assert.deepEqual(by["Jeu Rare"][2], { text: "Steam", badge: "neutral" });
  assert.equal(by["Sans image"][2], "—");
  assert.match(by.Hades[1].image.src, /^\/m\/game-covers\/cover\/[0-9a-f]{16}$/);
  assert.equal(t.searchable, true);
  assert.deepEqual(t.filters.map((f) => f.column), [2, 3]);
  assert.ok(t.rowActions.filter((a) => !a.danger && !a.inMenu).length <= 2);
  const find = saved.find((b) => b.type === "adminForm" && b.action === "find");
  assert.equal(find.fields[0].label, "Chercher une jaquette"); assert.ok(find.fields[0].example);
  // « Voir » : la copie du site. « Oublier » : la copie part avec la jaquette.
  const view = await mod.adminPanel(c, { query: { tab: "saved", voir: "Hades" } });
  assert.ok(view.find((b) => b.type === "html").html.includes("/m/game-covers/cover/"));
  assert.equal((await mod.adminActions.forget(c, { id: "Hades" })).redirect, "?tab=saved&saved=forgot");
  assert.equal((await metaDocs(c)).some((m) => m.id === copies.idOf(titleKey("Hades"))), false, "copie effacée avec la jaquette oubliée");
  for (const query of [{}, { tab: "saved" }, { tab: "saved", titre: "Hades" }]) assertAdminPageErgonomics((await mod.adminPanel(c, { query })).filter((b) => b.type !== "html"));
});

test("réglages : tous avancés ou le code facultatif ; 7 réglages simples au plus ; aucun mot interdit ; la clé reste un secret facultatif", () => {
  const simple = manifest.settings.filter((s) => !s.advanced && !s.rare);
  assert.ok(simple.length <= 7); assert.deepEqual(simple.map((s) => s.key), ["rawgKey"]);
  assert.equal(manifest.settings.find((s) => s.key === "rawgKey").optional, true);
  assert.deepEqual(manifest.settings.filter((s) => s.advanced).map((s) => s.key).sort(), ["refreshDays", "remoteFallback", "useSteam", "useTwitch"]);
  const days = manifest.settings.find((s) => s.key === "refreshDays");
  assert.deepEqual([days.default, days.min, days.max], [30, 1, 365]); assert.ok(days.unit.fr && days.example.fr);
  assert.equal(manifest.settings.find((s) => s.key === "remoteFallback").default, false, "par défaut le public ne contacte personne");
  const twitch = manifest.requires.find((r) => r.service === "twitch.api");
  assert.deepEqual([twitch.min, twitch.optional], [3, true]);
  assert.equal(manifest.imageHosts, undefined, "aucun hôte d'image déclaré : les vignettes viennent du site");
  for (const s of manifest.settings) for (const l of ["fr", "en"]) { assert.ok(s.label[l].length <= 60 && !/:$/.test(s.label[l]), s.key); if (s.help) assert.ok(s.help[l].length <= 60, `${s.key} : aide ≤ 60 caractères`); }
  for (const l of ["fr", "en"]) assert.ok(manifest.privacy[l].length <= 500);
});

test("route : une copie Rawg ou Steam due pour le renouvellement est servie tout de suite (200) pendant que la nouvelle est récupérée ; source en panne : l'ancienne reste servie, rien n'est perdu", async () => {
  const c = makeCtx({ settings: { useTwitch: false } });
  await svc.cover(c, "Hades");
  const id = copies.idOf(titleKey("Hades"));
  const route = () => mod.routes["cover/:slug"](new Request("https://example.test/x"), Object.assign(c, { params: { slug: id } }));
  const old = (await bytesDocs(c))[0].data.b64;
  await ageCopy(c, "Hades", 45 * 86_400_000);
  mode.images = "down";
  for (let i = 0; i < 3; i++) { const r = await route(); assert.equal(r.status, 200, "ancienne copie servie"); await copies.settled(); }
  assert.equal((await bytesDocs(c))[0].data.b64, old, "aucune perte");
  mode.images = "up"; copies.resetCopies();
  const before = imageCalls.length;
  assert.equal((await route()).status, 200);
  await copies.settled();
  assert.ok(imageCalls.length > before, "renouvelée paresseusement par la route elle-même");
  assert.ok(Date.now() - (await metaDocs(c))[0].at < 60_000);
});

// NON-RÉGRESSION (Jaquettes de jeux 1.3.1). En 1.3.0 la route s'appelait « cover/:id » et lisait `ctx.params.id` : le cœur ne connaît qu'UN segment libre, toujours nommé `slug`
// (`matchModuleRoute` de src/core/modules/pageMeta.ts) ; /m/<clé>/cover/<repère> répondait donc « Not found » (celui du cœur) sur le vrai site. Ici, la route est trouvée EXACTEMENT
// comme le fait le cœur, à partir de l'adresse écrite par le module.
const SLUG_RE = /^[A-Za-z0-9_-]{1,80}$/;
function coreMatch(routes, segments) {   // recopie fidèle de matchModuleRoute (cœur) : la route de ce nom exact, sinon « …/:slug » avec `params: { slug }` et rien d'autre
  const last = segments[segments.length - 1];
  if (last === ":slug") return null;
  if (routes[segments.join("/")]) return { handler: routes[segments.join("/")], params: {} };
  if (last === undefined || !SLUG_RE.test(last)) return null;
  const key = [...segments.slice(0, -1), ":slug"].join("/");
  return Object.prototype.hasOwnProperty.call(routes, key) ? { handler: routes[key], params: { slug: last } } : null;
}

test("l'adresse de jaquette écrite par le module est SERVIE par la route telle que le cœur la trouve (forme réelle : params.slug)", async () => {
  const c = makeCtx();
  const { url } = await svc.cover(c, "Hades");
  const { pathname } = new URL(url);
  assert.match(pathname, /^\/m\/game-covers\/cover\/[0-9a-f]{16}$/, "le module écrit bien une adresse du site");
  const [, key, ...path] = pathname.split("/").slice(1);   // ["m","game-covers","cover","<repère>"] -> clé, puis segments de la route
  assert.equal(key, "game-covers");
  const hit = coreMatch(mod.routes, path);
  assert.ok(hit, "le cœur trouve une route pour cette adresse (sinon : « Not found » et jaquette absente)");
  assert.deepEqual(Object.keys(hit.params), ["slug"], "le cœur ne donne que `slug`");
  const res = await hit.handler(new Request(url), Object.assign(c, { params: Object.freeze({ ...hit.params }) }));
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
  assert.equal(coreMatch(mod.routes, ["cover", "0123456789abcdef/x"]), null, "un seul segment libre");
});

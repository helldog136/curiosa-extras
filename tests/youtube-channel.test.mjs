import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeConnector, connectorApi, yt } from "./helpers/fakeYoutube.mjs";
import { parseManifest } from "@/core/modules/manifest";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, netReplies } = kit;
const DIR = new URL("../modules/youtube-channel", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/youtube-channel/index.mjs");
const def = mod.default;
const CH = "UC" + "a".repeat(22);
const KEY = "FAKE-YT-KEY-0001";
const realFetch = globalThis.fetch;
let f;
const serve = (routes) => { f = fakeFetch(routes); globalThis.fetch = f; return f; };
beforeEach(() => { mod.resetCache(); connectorApi.resetState(); });
afterEach(() => { globalThis.fetch = realFetch; });

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const entry = (id, title, published, views) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${published}</published><media:group><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`;
const FEED = `<feed>${entry("vid00000001", "Vieille &amp; grosse", day(90), 9000)}${entry("vid00000002", "Récente peu vue", day(2), 10)}${entry("vid00000003", "Récente populaire", day(5), 500)}${entry("short000001", "Un short", day(1), 99999)}</feed>`;
/** Faux YouTube public : flux RSS et test « Short » (200 = Short, 303 = vidéo classique). */
function mockFeed({ shorts = ["short000001"], feed = FEED, api } = {}) {
  return serve({
    "*": (url) => {
      if (url.includes("/feeds/videos.xml")) return { text: feed, headers: { "content-type": "application/atom+xml" } };
      const m = /shorts\/([\w-]+)/.exec(url);
      if (m) return { status: shorts.includes(m[1]) ? 200 : 303, text: "" };
      if (url.includes("googleapis.com") && api) return api(url);
      return { status: 404, text: "" };
    },
  });
}
const ctx = (settings = {}, opts = {}) => fakeCtx({ key: "yt", messages: readJson("locales/en.json"), settings: { channelId: CH, ...settings }, ...opts });
const frCtx = (settings = {}, opts = {}) => fakeCtx({ key: "yt", locale: "fr", messages: readJson("locales/fr.json"), settings: { channelId: CH, ...settings }, ...opts });

test("manifeste : valide, la clé n'est plus un réglage (réglage hérité masqué), besoin FACULTATIF du service youtube.api, migration 2, cœur 0.2.0, parité en/fr", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  assert.ok(!declared.has("apiKey"), "la clé n'est plus saisie ici");
  assert.deepEqual(manifestJson.legacySettings, [{ key: "apiKey", secret: true }]);
  assert.deepEqual(manifestJson.requires.map((x) => [x.service, x.min, x.optional]), [["youtube.api", 1, true]]);
  assert.equal(manifestJson.dataVersion, 2);
  assert.equal(typeof def.migrations[2], "function");
  assert.equal(manifestJson.minCore, "0.2.0");
  assert.equal(manifestJson.settings.find((s) => s.key === "channelId").refersTo, "external", "une chaîne YouTube est un profil externe : texte");
  assert.ok(!manifestJson.settings.some((s) => s.type === "secret"), "aucun secret ici");
  assert.ok(!/\bfetch\(|googleapis/.test(source), "aucun fetch direct ni appel à l'interface de données : ctx.api.net et le service youtube.api");
  assert.deepEqual(Object.keys(readJson("locales/fr.json")).sort(), Object.keys(readJson("locales/en.json")).sort());
});

test("flux public : lecture des vidéos, entités XML décodées, vues ; sans fournisseur de youtube.api le flux suffit", async () => {
  mockFeed();
  const v = await mod.listVideos(ctx(), CH);
  assert.equal(v.length, 4);
  assert.equal(v[0].title, "Vieille & grosse");
  assert.equal(v[2].views, 500);
});

test("identifiant de chaîne invalide : aucune requête", async () => {
  mockFeed();
  assert.deepEqual(await mod.listVideos(ctx(), "pas-un-id"), []);
  assert.equal(f.calls.length, 0);
});

test("vidéo mise en avant : la plus vue des récentes, jamais un Short, trop ancienne exclue", async () => {
  mockFeed();
  const blocks = await def.sections.featured(ctx());
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].html, /vid00000003/);
  assert.match(blocks[0].html, /Récente populaire/);
  assert.match(blocks[0].html, /500 views/);
  assert.ok(!/<iframe/.test(blocks[0].html), "pas de lecteur intégré (compterait comme une vue)");
  assert.ok(!/short000001|vid00000001/.test(blocks[0].html));
  mockFeed({ shorts: [] });
  mod.resetCache();
  assert.match((await def.sections.featured(ctx({ includeShorts: true })))[0].html, /short000001/, "Shorts autorisés par réglage");
});

test("aucune vidéo récente : la section n'apparaît pas", async () => {
  mockFeed();
  assert.equal(await def.sections.featured(ctx({ maxAgeDays: 0.5 })), null);
});

test("texte échappé (titre piégé) dans la section", async () => {
  mockFeed({ shorts: [], feed: `<feed>${entry("vid00000009", "&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;", day(1), 1)}</feed>` });
  const html = (await def.sections.featured(ctx()))[0].html;
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("exports : feed.item et maze.poster sans les Shorts, adresses https YouTube, rubrique video", async () => {
  mockFeed();
  const items = await def.exports["feed.item"](ctx(), { limit: 10 });
  assert.deepEqual(items.map((i) => i.id), ["yt:vid00000001", "yt:vid00000002", "yt:vid00000003"]);
  assert.ok(items.every((i) => i.url.startsWith("https://www.youtube.com/watch?v=") && i.topics.includes("video")));
  const posters = await def.exports["maze.poster"](ctx(), { limit: 10 });
  assert.equal(posters.length, 3);
  assert.ok(posters.every((p) => p.image.startsWith("https://i.ytimg.com/vi/") && p.kind === "video"));
});

const API_REPLIES = (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/channels")) return { json: yt.list([yt.channel(CH, { uploads: "UUaaaaaaaaaaaaaaaaaaaaaa" })]) };
  if (u.pathname.endsWith("/playlistItems")) return { json: yt.list([{ snippet: { resourceId: { videoId: "long0000001" }, title: "Longue", publishedAt: day(1) } }, { snippet: { resourceId: { videoId: "tiny0000001" }, title: "Courte", publishedAt: day(1) } }]) };
  if (u.pathname.endsWith("/videos")) return { json: yt.list([{ id: "long0000001", contentDetails: { duration: "PT12M3S" }, statistics: { viewCount: "42" } }, { id: "tiny0000001", contentDetails: { duration: "PT45S" } }]) };
  return { status: 404, json: {} };
};

test("avec le service youtube.api : durées exactes, Shorts (≤ 60 s) distingués sans test réseau ; 3 unités, la clé ne passe jamais par ce module", async () => {
  mockFeed({ api: API_REPLIES });
  const c = makeConnector();
  const me = ctx({}, { services: c.services });
  const out = await def.exports["feed.item"](me, { limit: 10 });
  assert.deepEqual(out.map((i) => i.id), ["yt:long0000001"]);
  assert.ok(!f.calls.some((x) => x.url.includes("/shorts/")), "durée connue : aucun test /shorts");
  assert.ok(!f.calls.some((x) => x.url.includes("/feeds/")), "le flux public n'est pas lu");
  assert.equal((await c.methods.status()).quota.used, 3);
  assert.ok(!JSON.stringify(me.calls).includes(KEY), "le module ne voit jamais la clé");
});

test("youtube.api indisponible (limite du jour atteinte, pas de clé) : repli sur le flux public, la page s'affiche quand même", async () => {
  for (const c of [makeConnector({ rows: { quota: [{ day: connectorApi.pacificDay(), used: 9000 }] } }), makeConnector({ key: "nokey", apiKey: null })]) {
    mod.resetCache();
    mockFeed({ api: () => { throw new Error("aucun appel attendu"); } });
    const blocks = await def.sections.featured(ctx({}, { services: c.services }));
    assert.match(blocks[0].html, /vid00000003/);
    assert.ok(!f.calls.some((x) => x.url.includes("googleapis")));
  }
});

test("cache : deux lectures rapprochées = une seule requête ; liste vide non figée", async () => {
  mockFeed();
  await mod.listVideos(ctx(), CH); await mod.listVideos(ctx(), CH);
  assert.equal(f.calls.length, 1);
  mod.resetCache();
  serve({ "*": netReplies.down() });
  assert.deepEqual(await mod.listVideos(ctx(), CH), []);
});

test("plusieurs instances (une par chaîne) : le manifeste l'autorise", () => {
  assert.equal(manifestJson.instances, "multiple");
});

test("réseau social : fournit « social.link » (le bouton de la chaîne) ; rien tant que l'identifiant n'est pas réglé ou s'il est invalide", async () => {
  assert.ok(manifestJson.provides.some((p) => p.topic === "social.link"));
  assert.equal(manifestJson.type, "social");
  assert.deepEqual(await def.exports["social.link"]({ setting: (k) => (k === "channelId" ? CH : undefined) }), [{ label: "YouTube", url: `https://www.youtube.com/channel/${CH}`, icon: "youtube" }]);
  for (const bad of ["", "UCcourt", "pas-un-id"]) assert.deepEqual(await def.exports["social.link"]({ setting: () => bad }), [], bad);
});

// ── Sans fournisseur : suggestion d'installation par SERVICE ─────────────────────────────────────────────────────────────

test("sans fournisseur de youtube.api : le panneau propose d'installer un module par SERVICE (bloc suggestInstall), jamais par nom ; avec un fournisseur : rien", async () => {
  const panel = await def.adminPanel(frCtx());
  const s = panel.find((b) => b.type === "suggestInstall");
  assert.deepEqual({ ...s, reason: typeof s.reason }, { type: "suggestInstall", service: "youtube.api", min: 1, reason: "string" });
  assert.match(s.reason, /^[a-zé]/, "une fin de phrase (« Il vous manque un module qui … »)");
  assert.ok(!/connect|youtube-|module/i.test(s.reason), `aucun nom de module : « ${s.reason} »`);
  const c = makeConnector();
  assert.ok(!(await def.adminPanel(frCtx({}, { services: c.services }))).some((b) => b.type === "suggestInstall"));
  const stats = await def.adminPanel(frCtx({ trackStats: true }));
  assert.match(stats.find((b) => b.type === "table").rows[0][1], /il faut la clé YouTube du site/);
});

// ── Reprise de la clé vers le fournisseur de youtube.api ───────────────────────────────────────────────────────────────

test("migration 2 : la clé est remise au fournisseur (adopt), puis effacée d'ici SEULEMENT après « ready » ; rejouée deux fois sans effet", async () => {
  const c = makeConnector({ apiKey: null });
  const m = fakeCtx({ key: "yt", migration: true, legacy: { apiKey: KEY }, settings: { channelId: CH }, services: c.services });
  await def.migrations[2](m);
  assert.deepEqual(m.calls.legacyCleared, ["apiKey"]);
  assert.deepEqual(m.calls.services.map(([s, method]) => [s, method]), [["youtube.api", "adopt"]]);
  assert.equal((await c.methods.status()).key, "set", "le fournisseur a la clé");
  await def.migrations[2](m);   // rejouée : la clé n'est plus là, rien à faire
  assert.deepEqual(m.calls.legacyCleared, ["apiKey"]);
  assert.equal(m.calls.services.length, 1);
  assert.equal(c.ctx.dumpStore().filter((x) => x.collection === "credential").length, 1, "jamais en double");
  // une deuxième instance qui avait la même clé : reprise idempotente, effacée aussi
  const m2 = fakeCtx({ key: "yt2", migration: true, legacy: { apiKey: KEY }, settings: { channelId: CH }, services: c.services });
  await def.migrations[2](m2); await def.migrations[2](m2);
  assert.deepEqual(m2.calls.legacyCleared, ["apiKey"]);
  assert.equal(c.ctx.dumpStore().filter((x) => x.collection === "credential").length, 1);
  // sans clé héritée : rien
  const empty = fakeCtx({ key: "yt3", migration: true, legacy: { apiKey: "" }, services: c.services });
  await def.migrations[2](empty);
  assert.equal(empty.calls.services.length, 0);
  // cœur sans ctx.legacy (ou sans clé déclarée) : la migration ne lève pas
  await def.migrations[2](fakeCtx({ migration: true, services: c.services }));
});

test("échec de reprise → RIEN n'est effacé, la migration ne lève jamais : pas de fournisseur, fournisseur pas prêt, qui lève, qui ne répond jamais", async () => {
  const saved = { ...mod.timing };
  mod.timing.serviceMs = 100;
  const keepAlive = setInterval(() => {}, 20);   // les minuteurs du module ne retiennent pas le processus (unref) : le test, lui, doit attendre
  try {
    for (const [what, services] of [
      ["pas de fournisseur", {}],
      ["pas prêt", { "youtube.api": { adopt: async () => ({ adopted: [], ready: false }) } }],
      ["réponse bizarre", { "youtube.api": { adopt: async () => ({ ready: "yes" }) } }],
      ["qui lève", { "youtube.api": { adopt: async () => { throw new Error("panne"); } } }],
      ["trou noir", { "youtube.api": { adopt: () => new Promise(() => {}) } }],
    ]) {
      const m = fakeCtx({ key: "yt", migration: true, legacy: { apiKey: KEY }, settings: { channelId: CH }, services });
      const t0 = Date.now();
      await def.migrations[2](m);
      assert.ok(Date.now() - t0 < 1000, `${what} : borné`);
      assert.deepEqual(m.calls.legacyCleared, [], `${what} : la clé reste`);
      assert.equal(await m.legacy.get("apiKey"), KEY, `${what} : toujours lisible pour la prochaine tentative`);
    }
  } finally { Object.assign(mod.timing, saved); clearInterval(keepAlive); }
});

test("clé gardée sans fournisseur : le panneau le dit et propose l'installation ; une fois le fournisseur installé, l'ouverture du panneau reprend la clé et l'efface", async () => {
  const legacy = { apiKey: KEY };
  const before = fakeCtx({ key: "yt", locale: "fr", messages: readJson("locales/fr.json"), legacy, settings: { channelId: CH } });
  const panel = await def.adminPanel(before);
  assert.ok(panel.some((b) => b.type === "suggestInstall"));
  assert.match(panel.find((b) => b.type === "banner").text, /gardée en sécurité/);
  assert.deepEqual(before.calls.legacyCleared, []);
  const c = makeConnector({ apiKey: null });
  const after = fakeCtx({ key: "yt", locale: "fr", messages: readJson("locales/fr.json"), legacy, settings: { channelId: CH }, services: c.services });
  const panel2 = await def.adminPanel(after);
  assert.deepEqual(after.calls.legacyCleared, ["apiKey"]);
  assert.ok(!panel2.some((b) => b.type === "suggestInstall" || b.type === "banner"));
  assert.equal((await c.methods.status()).ready, true);
});

test("secret : la clé reprise n'apparaît dans aucun bloc, retour, élément publié ni ligne de console", async () => {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(" "));
  const out = [];
  try {
    mockFeed({ api: API_REPLIES });
    const c = makeConnector({ apiKey: null });
    const m = fakeCtx({ key: "yt", migration: true, legacy: { apiKey: KEY }, settings: { channelId: CH, trackStats: true }, services: c.services, messages: readJson("locales/fr.json") });
    out.push(await def.migrations[2](m), await def.adminPanel(m), await def.exports["social.stat"](m, { limit: 10 }), await def.exports["feed.item"](m, { limit: 10 }), await def.sections.featured(m));
    const lost = fakeCtx({ key: "yt", legacy: { apiKey: KEY }, settings: { channelId: CH, trackStats: true }, messages: readJson("locales/fr.json") });
    out.push(await def.adminPanel(lost), await def.exports["social.stat"](lost, { limit: 10 }), m.calls.netLog, c.ctx.calls.netLog, lost.calls.netLog);
  } finally { Object.assign(console, saved); }
  const dump = JSON.stringify(out) + lines.join("\n");
  assert.ok(!dump.includes(KEY) && !dump.includes("FAKE-YT"), "la clé a fui");
});

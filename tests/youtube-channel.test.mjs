import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/youtube-channel", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/youtube-channel/index.mjs");
const def = mod.default;
const CH = "UC" + "a".repeat(22);
const realFetch = globalThis.fetch;
beforeEach(() => mod.resetCache());
afterEach(() => { globalThis.fetch = realFetch; });

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const entry = (id, title, published, views) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${published}</published><media:group><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`;
const FEED = `<feed>${entry("vid00000001", "Vieille &amp; grosse", day(90), 9000)}${entry("vid00000002", "Récente peu vue", day(2), 10)}${entry("vid00000003", "Récente populaire", day(5), 500)}${entry("short000001", "Un short", day(1), 99999)}</feed>`;
function mockFeed({ shorts = ["short000001"] } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).includes("/feeds/videos.xml")) return { ok: true, status: 200, text: async () => FEED };
    const m = /shorts\/([\w-]+)/.exec(String(url));
    if (m) return { ok: shorts.includes(m[1]), status: shorts.includes(m[1]) ? 200 : 303 };
    return { ok: false, status: 404 };
  };
  return calls;
}
const ctx = (settings = {}) => fakeCtx({ key: "yt", messages: readJson("locales/en.json"), settings: { channelId: CH, ...settings } });

test("manifeste valide, réglages déclarés, parité en/fr", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  assert.deepEqual(Object.keys(readJson("locales/fr.json")).sort(), Object.keys(readJson("locales/en.json")).sort());
});

test("flux public : lecture des vidéos, entités XML décodées, vues", async () => {
  mockFeed();
  const v = await mod.listVideos(CH, null);
  assert.equal(v.length, 4);
  assert.equal(v[0].title, "Vieille & grosse");
  assert.equal(v[2].views, 500);
});

test("identifiant de chaîne invalide : aucune requête", async () => {
  const calls = mockFeed();
  assert.deepEqual(await mod.listVideos("pas-un-id", null), []);
  assert.equal(calls.length, 0);
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
  globalThis.fetch = async (url) => String(url).includes("/shorts/") ? { ok: false, status: 303 } : ({ ok: true, status: 200, text: async () => `<feed>${entry("vid00000009", "&lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;", day(1), 1)}</feed>`, });
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

test("API : durées exactes, Shorts (≤ 60 s) distingués sans test réseau", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url)); const u = String(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.includes("/channels?")) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
    if (u.includes("/playlistItems?")) return json({ items: [{ snippet: { resourceId: { videoId: "long0000001" }, title: "Longue", publishedAt: day(1) } }, { snippet: { resourceId: { videoId: "tiny0000001" }, title: "Courte", publishedAt: day(1) } }] });
    if (u.includes("/videos?")) return json({ items: [{ id: "long0000001", contentDetails: { duration: "PT12M3S" }, statistics: { viewCount: "42" } }, { id: "tiny0000001", contentDetails: { duration: "PT45S" } }] });
    return { ok: false, status: 404 };
  };
  const out = await def.exports["feed.item"](ctx({ apiKey: "KEY" }), { limit: 10 });
  assert.deepEqual(out.map((i) => i.id), ["yt:long0000001"]);
  assert.ok(!calls.some((u) => u.includes("/shorts/")), "durée connue : aucun test /shorts");
});

test("cache : deux lectures rapprochées = une seule requête ; liste vide non figée", async () => {
  const calls = mockFeed();
  await mod.listVideos(CH, null); await mod.listVideos(CH, null);
  assert.equal(calls.length, 1);
  mod.resetCache();
  globalThis.fetch = async () => { throw new Error("réseau"); };
  assert.deepEqual(await mod.listVideos(CH, null), []);
});

test("plusieurs instances (une par chaîne) : le manifeste l'autorise", () => {
  assert.equal(JSON.parse(fs.readFileSync(new URL("../modules/youtube-channel/module.json", import.meta.url), "utf8")).instances, "multiple");
});

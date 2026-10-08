import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity } from "./helpers/builtinChecks.mjs";

const ls = await loadModule("modules/live-status");
const { definition: def, manifest, locales } = ls;
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

let n = 0;
const uniq = () => `chan_${++n}_${Math.random().toString(36).slice(2, 8)}`; // le cache de statut est global au module

function stubTwitch({ live = true, token = "tok", fail = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) throw new Error("réseau coupé");
    if (String(url).startsWith("https://id.twitch.tv/")) return Response.json(token ? { access_token: token, expires_in: 3600 } : {});
    return Response.json({ data: live ? [{ id: "1" }] : [] });
  };
  return calls;
}
const settings = (channel, extra = {}) => ({ channel, clientId: "cid", clientSecret: "sec", ...extra });
const banner = (ctx) => def.slots["layout.banner"](ctx);

test("live-status : manifeste valide, section « player », slots/sections, secret sans défaut", async () => {
  const m = await assertValidManifest(manifest);
  assertDefinitionMatchesManifest(m, def);
  assertSettingsSane(m);
  assert.deepEqual(m.sections.map((s) => s.id), ["player"]);
  assert.equal(m.instances, "single");
  assert.deepEqual(m.settings.map((s) => [s.key, s.type]), [["channel", "text"], ["clientId", "text"], ["clientSecret", "secret"]]);
  assert.ok(!m.permissions.includes("routes") && !m.permissions.includes("storage"));
  assert.deepEqual(Object.keys(def.slots), ["layout.banner"]);
});

test("live-status : locales en/fr, variable {channel} conservée", () => {
  assertLocalesParity(locales);
  assert.match(locales.en.live, /\{channel\}/);
  assert.match(locales.fr.live, /\{channel\}/);
});

test("player : sans chaîne ou chaîne invalide → null (pas d'embed)", () => {
  for (const channel of [undefined, "", "ab", "a".repeat(26), "bad name", "x&parent=evil.com", "ch/../x", "<script>", "a-b-c", "é_é_é"]) {
    assert.equal(def.sections.player(fakeCtx({ settings: { channel } })), null, String(channel));
  }
});

test("player : embed Twitch avec parent = hôte du site, muet, chaîne telle quelle", () => {
  const [b] = def.sections.player(fakeCtx({ settings: { channel: "Ma_Chaine" }, siteUrl: "https://www.exemple.fr:8443/x" }));
  assert.equal(b.type, "embed");
  assert.equal(b.title, "Twitch — Ma_Chaine");
  const u = new URL(b.src);
  assert.equal(u.origin, "https://player.twitch.tv");
  assert.equal(u.searchParams.get("channel"), "Ma_Chaine");
  assert.equal(u.searchParams.get("parent"), "www.exemple.fr");
  assert.equal(u.searchParams.get("muted"), "true");
  assert.deepEqual([...u.searchParams.keys()], ["channel", "parent", "muted"]);
});

test("bannière : chaîne ou identifiants manquants → null, sans aucun appel réseau", async () => {
  const calls = stubTwitch();
  for (const s of [{}, settings("ab"), settings(uniq(), { clientId: "" }), settings(uniq(), { clientSecret: undefined }), settings("bad chan!")]) {
    assert.equal(await banner(fakeCtx({ settings: s })), null);
  }
  assert.equal(calls.length, 0);
});

test("bannière : en direct → bannière success avec lien twitch.tv, texte traduit", async () => {
  const calls = stubTwitch({ live: true });
  const ch = uniq();
  const ctx = fakeCtx({ settings: settings(ch), messages: { live: "{channel} est en direct" } });
  const out = await banner(ctx);
  assert.deepEqual(out, [{ type: "banner", tone: "success", text: `${ch} est en direct`, href: `https://twitch.tv/${ch}` }]);
  assert.ok(calls.some((c) => c.url.startsWith("https://api.twitch.tv/helix/streams?user_login=")));
  const api = calls.find((c) => c.url.includes("helix"));
  assert.equal(api.init.headers["Client-Id"], "cid");
  assert.match(api.init.headers.Authorization, /^Bearer /);
  assert.ok(api.init.signal, "timeout configuré");
});

test("bannière : hors ligne → null", async () => {
  stubTwitch({ live: false });
  assert.equal(await banner(fakeCtx({ settings: settings(uniq()) })), null);
});

test("bannière : le statut est mis en cache 60 s par chaîne (un seul appel Helix)", async () => {
  const calls = stubTwitch({ live: true });
  const ch = uniq();
  await banner(fakeCtx({ settings: settings(ch) }));
  const before = calls.length;
  await banner(fakeCtx({ settings: settings(ch) }));
  assert.equal(calls.length, before);
  await banner(fakeCtx({ settings: settings(uniq()) }));
  assert.ok(calls.length > before, "autre chaîne → nouvelle requête");
});

test("bannière : erreur réseau ou jeton refusé → null, aucune exception, rien ne fuit", async () => {
  stubTwitch({ fail: true });
  assert.equal(await banner(fakeCtx({ settings: settings(uniq()) })), null);
});

test("bannière : le secret n'apparaît ni dans la bannière ni dans les en-têtes de l'API Helix", async () => {
  const calls = stubTwitch({ live: true });
  const out = await banner(fakeCtx({ settings: settings(uniq(), { clientSecret: "TOP-SECRET" }) }));
  assert.ok(!JSON.stringify(out).includes("TOP-SECRET"));
  for (const c of calls.filter((x) => x.url.includes("helix"))) assert.ok(!JSON.stringify(c.init.headers).includes("TOP-SECRET"));
});

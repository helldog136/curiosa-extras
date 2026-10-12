import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest, assertDefinitionMatchesManifest, assertSettingsSane, assertLocalesParity } from "./helpers/builtinChecks.mjs";

// live-status PRÉSENTE l'état « en direct » ; l'état vient du service twitch.live de la Chaîne Twitch (le vrai fournisseur est branché ici, comme le fait le cœur).
const ls = await loadModule("modules/live-status");
const tw = await import("../modules/twitch-channel/index.mjs");
const { definition: def, manifest, locales } = ls;
const svc = tw.default.services["twitch.live"];
const realFetch = globalThis.fetch;
beforeEach(() => tw.resetCache());
afterEach(() => { globalThis.fetch = realFetch; });

function stubTwitch({ live = true, fail = false, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) throw new Error("réseau coupé");
    if (String(url).startsWith("https://id.twitch.tv/")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (status !== 200) return new Response("{}", { status });
    return Response.json({ data: live ? [{ id: "1", title: "Soirée", game_name: "Zelda", viewer_count: 3 }] : [] });
  };
  return calls;
}
const streamCalls = (calls) => calls.filter((c) => c.url.includes("/helix/streams")).length;

/** Un couple (fournisseur, consommateur) : le consommateur appelle le vrai service du fournisseur, dont le ctx est celui du fournisseur. */
function wire({ provider = { channel: "machaine", clientId: "cid", clientSecret: "sec" }, own = {}, withProvider = true, messages = { live: "{channel} est en direct" }, siteUrl } = {}) {
  const pctx = fakeCtx({ key: "tw", settings: provider });
  const services = withProvider ? { "twitch.live": Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](pctx, args)])) } : {};
  return { ctx: fakeCtx({ key: "live-status", settings: own, services, messages, siteUrl }), pctx };
}
const banner = (ctx) => def.slots["layout.banner"](ctx);
const player = (ctx) => def.sections.player(ctx);

test("live-status : manifeste valide, dépend du service twitch.live, n'en offre aucun, anciens réglages avancés", async () => {
  const m = await assertValidManifest(manifest);
  assertDefinitionMatchesManifest(m, def);
  assertSettingsSane(m);
  assert.equal(m.version, "1.1.0");
  assert.deepEqual(m.sections.map((s) => s.id), ["player"]);
  assert.equal(m.instances, "single");
  assert.deepEqual(m.requires.map((r) => r.service), ["twitch.live"]);
  assert.ok(!m.offers && !(m.provides ?? []).length && !(m.consumes ?? []).length);
  assert.deepEqual(m.settings.map((s) => [s.key, s.type]), [["channel", "text"], ["clientId", "text"], ["clientSecret", "secret"], ["playerWhen", "select"]]);
  for (const k of ["channel", "clientId", "clientSecret"]) assert.equal(m.settings.find((s) => s.key === k).advanced, true, `${k} : ancien réglage, masqué en version simple`);
  assert.deepEqual(m.permissions.sort(), ["admin", "sections", "slots", "storage"]);
  assert.deepEqual(Object.keys(def.slots), ["layout.banner"]);
});

test("live-status : ne parle jamais à Twitch (aucune adresse, aucun jeton, aucun cache d'API dans son code)", () => {
  for (const f of fs.readdirSync(new URL("../modules/live-status", import.meta.url).pathname).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(new URL(`../modules/live-status/${f}`, import.meta.url), "utf8");
    assert.ok(!/fetch\(|api\.twitch\.tv|id\.twitch\.tv|oauth2|Client-Id|Bearer/.test(src), f);
  }
});

test("live-status : locales en/fr, variable {channel} conservée", () => {
  assertLocalesParity(locales);
  assert.match(locales.en.live, /\{channel\}/);
  assert.match(locales.fr.live, /\{channel\}/);
});

test("player : aucune chaîne connue (ni de la Chaîne Twitch ni d'ancien réglage) ou chaîne invalide → null", async () => {
  stubTwitch();
  assert.equal(await player(wire({ provider: {} }).ctx), null);
  assert.equal(await player(wire({ withProvider: false }).ctx), null);
  for (const channel of ["ab", "a".repeat(26), "bad name", "x&parent=evil.com", "ch/../x", "<script>", "a-b-c", "é_é_é"]) {
    assert.equal(await player(wire({ provider: {}, own: { channel } }).ctx), null, channel);
    assert.equal(await player(wire({ provider: { channel, clientId: "a", clientSecret: "b" } }).ctx), null, channel);
  }
});

test("player : en direct, embed Twitch avec parent = hôte du site, muet, chaîne du fournisseur", async () => {
  stubTwitch({ live: true });
  const [b] = await player(wire({ provider: { channel: "Ma_Chaine", clientId: "cid", clientSecret: "sec" }, siteUrl: "https://www.exemple.fr:8443/x" }).ctx);
  assert.equal(b.type, "embed");
  assert.equal(b.title, "Twitch — ma_chaine");
  const u = new URL(b.src);
  assert.equal(u.origin, "https://player.twitch.tv");
  assert.equal(u.searchParams.get("channel"), "ma_chaine");
  assert.equal(u.searchParams.get("parent"), "www.exemple.fr");
  assert.equal(u.searchParams.get("muted"), "true");
  assert.deepEqual([...u.searchParams.keys()], ["channel", "parent", "muted"]);
});

test("player : seulement en direct quand Twitch peut le dire (hors ligne → rien), réglage « toujours » → toujours, sans appel réseau", async () => {
  stubTwitch({ live: false });
  assert.equal(await player(wire().ctx), null, "hors ligne : rien");
  const calls = stubTwitch({ live: false });
  const [b] = await player(wire({ own: { playerWhen: "always" } }).ctx);
  assert.equal(b.type, "embed");
  assert.equal(calls.length, 0);
});

test("player : sans identifiants Twitch on ne peut pas savoir → PAS de lecteur (plus de panneau blanc), sans appel réseau ; « toujours » l'affiche ; Twitch injoignable → pas de lecteur", async () => {
  const calls = stubTwitch();
  assert.equal(await player(wire({ provider: { channel: "machaine" } }).ctx), null);
  assert.equal((await player(wire({ provider: { channel: "machaine" }, own: { playerWhen: "always" } }).ctx))[0].type, "embed");
  assert.equal(calls.length, 0);
  stubTwitch({ fail: true });
  assert.equal(await player(wire().ctx), null);
});

test("bannière : en direct → bannière success avec lien twitch.tv, texte traduit ; hors ligne → null", async () => {
  stubTwitch({ live: true });
  assert.deepEqual(await banner(wire().ctx), [{ type: "banner", tone: "success", text: "machaine est en direct", href: "https://twitch.tv/machaine" }]);
  tw.resetCache(); stubTwitch({ live: false });
  assert.equal(await banner(wire().ctx), null);
});

test("fournisseur absent (désinstallé, restauration) → dégrade proprement : pas de bannière, lecteur de l'ancien réglage ou rien, aucune exception", async () => {
  const calls = stubTwitch();
  const gone = wire({ withProvider: false, own: { channel: "ancienne", clientId: "x", clientSecret: "y" } }).ctx;
  assert.equal(await banner(gone), null);
  assert.equal(await player(gone), null, "on ne peut pas savoir : pas de lecteur");
  assert.equal((await player(wire({ withProvider: false, own: { channel: "ancienne", playerWhen: "always" } }).ctx))[0].type, "embed");
  const nothing = wire({ withProvider: false }).ctx;
  assert.equal(await banner(nothing), null);
  assert.equal(await player(nothing), null);
  assert.equal(calls.length, 0, "live-status n'appelle jamais Twitch lui-même");
  // le service existe mais plante
  const broken = fakeCtx({ settings: {}, services: { "twitch.live": { channel: () => { throw new Error("boom"); }, status: () => { throw new Error("boom"); } } } });
  assert.equal(await banner(broken), null);
  assert.equal(await player(broken), null);
});

test("erreurs Twitch (réseau, 401, 429) → ni bannière ni lecteur, aucune exception", async () => {
  for (const o of [{ fail: true }, { status: 401 }, { status: 429 }]) {
    tw.resetCache(); stubTwitch(o);
    assert.equal(await banner(wire().ctx), null, JSON.stringify(o));
    assert.equal(await player(wire().ctx), null, JSON.stringify(o));
  }
});

test("un seul appel Twitch pour la bannière, le lecteur, plusieurs visiteurs et stream.live (cache unique côté fournisseur)", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire();
  await Promise.all([banner(w.ctx), player(w.ctx), banner(w.ctx)]);
  await tw.default.exports["stream.live"](w.pctx);
  assert.equal(streamCalls(calls), 1);
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("stream.live toujours publié par la Chaîne Twitch, avec les mêmes données que celles qu'affiche le statut", async () => {
  stubTwitch({ live: true });
  const w = wire();
  assert.ok(await banner(w.ctx));
  const [item] = await tw.default.exports["stream.live"](w.pctx);
  assert.equal(item.url, "https://twitch.tv/machaine");
  assert.equal(item.title, "Soirée");
});

test("mode hérité : anciens réglages seuls (Chaîne Twitch sans identifiants) → fonctionne comme avant, UN appel, fait par le service", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: {}, own: { channel: "Ancienne_Chaine", clientId: "old-id", clientSecret: "old-SECRET" } });
  const out = await banner(w.ctx);
  assert.deepEqual(out, [{ type: "banner", tone: "success", text: "ancienne_chaine est en direct", href: "https://twitch.tv/ancienne_chaine" }]);
  assert.equal((await player(w.ctx))[0].type, "embed");
  assert.equal(streamCalls(calls), 1);
  assert.equal(calls.find((c) => c.url.includes("/helix/streams")).init.headers["Client-Id"], "old-id");
  assert.ok(!JSON.stringify(out).includes("old-SECRET"));
  tw.resetCache(); stubTwitch({ live: false });
  assert.equal(await player(w.ctx), null, "hors ligne : lecteur masqué, comme avant");
});

test("mode hérité : dès que la Chaîne Twitch est configurée, elle prend le dessus (ses identifiants, sa chaîne)", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: { channel: "nouvelle", clientId: "new-id", clientSecret: "sec" }, own: { channel: "ancienne", clientId: "old-id", clientSecret: "old" } });
  const [b] = await banner(w.ctx);
  assert.equal(b.href, "https://twitch.tv/nouvelle");
  assert.equal(calls.find((c) => c.url.includes("/helix/streams")).init.headers["Client-Id"], "new-id");
});

test("plusieurs instances Twitch : le consommateur suit celle que le cœur désigne (maître) ; l'autre n'est pas touchée", async () => {
  const calls = stubTwitch({ live: true });
  const a = wire({ provider: { channel: "chaine_a", clientId: "cid", clientSecret: "sec" } });
  const b = wire({ provider: { channel: "chaine_b", clientId: "cid", clientSecret: "sec" } });
  assert.equal((await banner(a.ctx))[0].href, "https://twitch.tv/chaine_a");
  assert.equal((await banner(b.ctx))[0].href, "https://twitch.tv/chaine_b");
  assert.equal(streamCalls(calls), 2, "une chaîne = un appel");
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "jeton partagé");
});

test("échappement : une chaîne hostile venue du fournisseur ne produit ni bannière ni lecteur ; le titre du live n'entre jamais dans la bannière", async () => {
  const evil = { "twitch.live": { channel: () => ({ channel: '"><script>x</script>', ready: true }), status: () => ({ configured: true, known: true, live: true, channel: '"><img onerror=x>', title: "<script>" }) } };
  const ctx = fakeCtx({ services: evil, messages: { live: "{channel} live" } });
  assert.equal(await banner(ctx), null);
  assert.equal(await player(ctx), null);
  stubTwitch({ live: true });
  tw.resetCache();
  globalThis.fetch = async (u) => (String(u).includes("oauth2") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json({ data: [{ id: "1", title: "<script>alert(1)</script>", game_name: "<b>" }] }));
  assert.ok(!JSON.stringify(await banner(wire().ctx)).includes("<script>"));
});

// ── Reprise des identifiants ────────────────────────────────────────────────────────────────────────────────────────────────────────
const legacyOwn = { channel: "Ancienne_Chaine", clientId: "old-id", clientSecret: "old-SECRET" };

test("admin : ancien réglage rempli et Chaîne Twitch vide → bandeau en langage simple + bouton ; rien à reprendre → aucun bandeau", async () => {
  const w = wire({ provider: {}, own: legacyOwn, messages: { adoptBanner: "BANDEAU", adoptButton: "BOUTON" } });
  const blocks = await def.adminPanel(w.ctx);
  assert.equal(blocks[0].type, "banner");
  assert.equal(blocks[0].text, "BANDEAU");
  assert.deepEqual([blocks[1].type, blocks[1].action, blocks[1].submitLabel], ["adminForm", "adopt", "BOUTON"]);
  const dump = JSON.stringify(blocks);
  for (const v of ["old-id", "old-SECRET", "Ancienne_Chaine"]) assert.ok(!dump.includes(v), `${v} jamais affiché`);
  assert.ok(!(await def.adminPanel(wire({ provider: {} }).ctx)).some((b) => b.type === "adminForm"), "pas d'ancien réglage : pas de bouton");
  assert.deepEqual(await def.adminPanel(wire({ own: legacyOwn }).ctx), [], "la Chaîne Twitch a déjà tout : rien");
});

test("admin : sans identifiants Twitch, message en langage simple avec lien vers la Chaîne Twitch ; absent avec identifiants, en mode hérité complet ou avec « toujours »", async () => {
  const m = { needCredentials: "RENSEIGNEZ" };
  const blocks = await def.adminPanel(wire({ provider: { channel: "machaine" }, messages: m }).ctx);
  assert.equal(blocks.find((b) => b.text === "RENSEIGNEZ").type, "banner");
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("](/admin/modules/twitch-channel)")), "lien vers la Chaîne Twitch");
  for (const w of [wire({ messages: m }), wire({ provider: {}, own: legacyOwn, messages: m }), wire({ provider: {}, own: { playerWhen: "always" }, messages: m })]) {
    assert.ok(!(await def.adminPanel(w.ctx)).some((b) => b.text === "RENSEIGNEZ"));
  }
  assert.match(locales.fr.needCredentials, /Renseignez les identifiants Twitch dans la Chaîne Twitch pour afficher le lecteur seulement quand vous êtes en direct/);
});

test("admin : la Chaîne Twitch absente → message pour l'installer (pas de bouton) ; l'action répond par une erreur claire", async () => {
  const w = wire({ withProvider: false, own: legacyOwn, messages: { adoptUnavailable: "INSTALLEZ" } });
  const blocks = await def.adminPanel(w.ctx);
  assert.deepEqual(blocks.map((b) => b.type), ["banner"]);
  assert.equal(blocks[0].text, "INSTALLEZ");
  assert.deepEqual(await def.adminActions.adopt(w.ctx, {}), { error: "INSTALLEZ" });
});

test("reprise : le bouton copie une fois dans la Chaîne Twitch, la marque faite, puis la Chaîne Twitch prend le dessus ; idempotent ; aucun secret renvoyé", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: {}, own: legacyOwn });
  const r1 = await def.adminActions.adopt(w.ctx, {});
  assert.deepEqual(Object.keys(r1).sort(), ["ok", "redirect"]);
  assert.equal(r1.redirect, "?");
  for (const v of ["old-id", "old-SECRET", "Ancienne_Chaine"]) assert.ok(!JSON.stringify(r1).includes(v));
  assert.deepEqual(await svc.channel(w.pctx), { channel: "ancienne_chaine", url: "https://twitch.tv/ancienne_chaine", configured: true, ready: true, missing: [] });
  assert.equal(await w.ctx.api.store.count("adoption"), 1);
  const done = await def.adminPanel(w.ctx);
  assert.deepEqual(done.map((b) => [b.type, b.tone]), [["banner", "success"]], "plus de bouton, confirmation");
  assert.ok(!JSON.stringify(done).includes("old-SECRET"));
  // 2e clic : rien de plus
  const r2 = await def.adminActions.adopt(w.ctx, {});
  assert.equal(r2.ok, w.ctx.t("adoptAlready"));
  assert.equal(await w.ctx.api.store.count("adoption"), 1);
  assert.equal(await w.pctx.api.store.count("adopted"), 1);
  // l'état en direct vient maintenant de la Chaîne Twitch (identifiants repris)
  assert.ok(await banner(w.ctx));
  assert.equal(calls.find((c) => c.url.includes("/helix/streams")).init.headers["Client-Id"], "old-id");
});

test("reprise : jamais d'écrasement d'une valeur déjà présente dans la Chaîne Twitch", async () => {
  const w = wire({ provider: { channel: "ma_chaine" }, own: legacyOwn });
  const blocks = await def.adminPanel(w.ctx);
  assert.equal(blocks[1].action, "adopt", "il manque encore les identifiants");
  await def.adminActions.adopt(w.ctx, {});
  const info = await svc.channel(w.pctx);
  assert.equal(info.channel, "ma_chaine", "la chaîne saisie dans la Chaîne Twitch est intacte");
  assert.equal(info.ready, true);
  assert.deepEqual(await def.adminPanel(wire({ provider: { channel: "ma_chaine", clientId: "a", clientSecret: "b" }, own: legacyOwn }).ctx), []);
});

test("reprise : rien à reprendre (anciens champs vides) → erreur simple, aucune écriture", async () => {
  const w = wire({ provider: {}, messages: { adoptNothing: "RIEN" } });
  assert.deepEqual(await def.adminActions.adopt(w.ctx, {}), { error: "RIEN" });
  assert.equal(await w.pctx.api.store.count("adopted"), 0);
});

test("textes d'admin de la reprise : tous présents en fr et en", () => {
  for (const l of ["fr", "en"]) for (const k of ["adoptBanner", "adoptButton", "adoptDone", "adoptUnavailable", "adoptNothing", "adoptOk", "adoptAlready", "field_channel", "field_clientId", "field_clientSecret", "needCredentials", "openTwitch"]) assert.ok(locales[l][k], `${l}.${k}`);
  assert.match(locales.fr.adoptBanner, /Les identifiants Twitch se règlent maintenant dans la Chaîne Twitch\. Reprenez-les ici/);
});

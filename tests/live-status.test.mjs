import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { assertValidManifest } from "./helpers/builtinChecks.mjs";

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
function wire({ provider = { channel: "machaine", clientId: "cid", clientSecret: "sec" }, own = {}, withProvider = true, messages = { live: "{channel} est en direct" }, siteUrl, legacy } = {}) {
  const pctx = fakeCtx({ key: "tw", settings: provider });
  const services = withProvider ? { "twitch.live": Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](pctx, args)])) } : {};
  return { ctx: fakeCtx({ key: "live-status", settings: own, services, messages, siteUrl, ...(legacy ? { legacy, migration: true } : {}) }), pctx };
}
const banner = (ctx) => def.slots["layout.banner"](ctx);
const player = (ctx) => def.sections.player(ctx);

test("live-status : manifeste valide, dépend du service twitch.live, n'en offre aucun, identifiants Twitch d'avant seulement en legacySettings (jamais affichés)", async () => {
  const m = await assertValidManifest(manifest);
  assert.equal(m.version, "1.3.0");
  assert.equal(m.minCore, "0.2.0");
  assert.equal(m.dataVersion, 2);
  assert.equal(typeof def.migrations[2], "function");
  assert.deepEqual(m.legacySettings, [{ key: "channel" }, { key: "clientId" }, { key: "clientSecret", secret: true }]);
  assert.deepEqual(m.sections.map((s) => s.id), ["player"]);
  assert.equal(m.instances, "single");
  assert.deepEqual(m.requires.map((r) => r.service), ["twitch.live"]);
  assert.ok(!m.offers && !(m.provides ?? []).length && !(m.consumes ?? []).length);
  assert.deepEqual(m.settings.map((s) => [s.key, s.type]), [["playerWhen", "select"], ["channels", "text"]]);
  assert.deepEqual(m.permissions.sort(), ["admin", "sections", "slots"], "plus de stockage : la marque de reprise manuelle a disparu");
  assert.deepEqual(Object.keys(def.slots), ["layout.banner"]);
});

test("live-status : ne parle jamais à Twitch (aucune adresse, aucun jeton, aucun cache d'API dans son code)", () => {
  for (const f of fs.readdirSync(new URL("../modules/live-status", import.meta.url).pathname).filter((x) => x.endsWith(".mjs"))) {
    const src = fs.readFileSync(new URL(`../modules/live-status/${f}`, import.meta.url), "utf8");
    assert.ok(!/fetch\(|api\.twitch\.tv|id\.twitch\.tv|oauth2|Client-Id|Bearer/.test(src), f);
  }
});

test("live-status : locales en/fr, variable {channel} conservée", () => {
  assert.match(locales.en.live, /\{channel\}/);
  assert.match(locales.fr.live, /\{channel\}/);
});

test("player : aucune chaîne connue ou chaîne invalide → null", async () => {
  stubTwitch();
  assert.equal(await player(wire({ provider: {} }).ctx), null);
  assert.equal(await player(wire({ withProvider: false }).ctx), null);
  for (const channel of ["ab", "a".repeat(26), "bad name", "x&parent=evil.com", "ch/../x", "<script>", "a-b-c", "é_é_é"]) {
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

test("fournisseur absent (désinstallé, restauration) → dégrade proprement : pas de bannière, pas de lecteur, aucune exception", async () => {
  const calls = stubTwitch();
  const gone = wire({ withProvider: false, own: { channel: "ancienne", clientId: "x", clientSecret: "y" } }).ctx;   // d'anciennes valeurs restées dans les réglages n'y changent rien
  assert.equal(await banner(gone), null);
  assert.equal(await player(gone), null, "on ne peut pas savoir : pas de lecteur");
  assert.equal(await player(wire({ withProvider: false, own: { playerWhen: "always" } }).ctx), null, "« toujours » sans Chaîne Twitch : aucune chaîne à montrer");
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

test("plus de mode hérité : des valeurs d'avant restées dans les réglages ne servent plus à interroger Twitch (la Chaîne Twitch sans identifiants → ni bannière ni lecteur, aucun appel)", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: {}, own: { channel: "Ancienne_Chaine", clientId: "old-id", clientSecret: "old-SECRET" } });
  assert.equal(await banner(w.ctx), null);
  assert.equal(await player(w.ctx), null);
  assert.equal(calls.length, 0);
});

test("la Chaîne Twitch configurée donne ses identifiants et sa chaîne", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: { channel: "nouvelle", clientId: "new-id", clientSecret: "sec" } });
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

test("admin : sans identifiants Twitch, message en langage simple avec lien vers la Chaîne Twitch ; absent avec identifiants ou avec « toujours » ; jamais de bouton de reprise", async () => {
  const m = { needCredentials: "RENSEIGNEZ" };
  const blocks = await def.adminPanel(wire({ provider: { channel: "machaine" }, messages: m }).ctx);
  assert.equal(blocks.find((b) => b.text === "RENSEIGNEZ").type, "banner");
  assert.ok(blocks.some((b) => b.type === "markdown" && b.text.includes("](/admin/modules/twitch-channel)")), "lien vers la Chaîne Twitch");
  for (const w of [wire({ messages: m }), wire({ provider: {}, own: { playerWhen: "always" }, messages: m })]) {
    assert.ok(!(await def.adminPanel(w.ctx)).some((b) => b.text === "RENSEIGNEZ"));
  }
  assert.equal(def.adminActions, undefined, "plus d'action de reprise manuelle");
  assert.ok(!(await def.adminPanel(wire({ provider: {}, legacy: legacyOwn }).ctx)).some((b) => b.type === "adminForm"), "même avec d'anciennes valeurs : pas de bouton");
  assert.match(locales.fr.needCredentials, /Renseignez les identifiants Twitch dans la Chaîne Twitch pour afficher le lecteur seulement quand vous êtes en direct/);
});

// ── Reprise automatique des identifiants d'avant (migration, legacySettings) ──────────────────────────────────────────────────────────
const legacyOwn = { channel: "Ancienne_Chaine", clientId: "old-id", clientSecret: "old-SECRET" };
const SECRETS = ["old-id", "old-SECRET", "Ancienne_Chaine", "ancienne_chaine"];
const noLeak = (...things) => { const dump = JSON.stringify(things); for (const v of SECRETS) assert.ok(!dump.includes(v), `${v} ne doit apparaître nulle part`); };
/** Tout ce que le module a rendu visible ou écrit chez lui (les appels de service reçus par le fournisseur, eux, portent forcément les valeurs : c'est leur objet). */
const visible = (ctx) => ({ ...ctx.calls, services: undefined, net: undefined });
const migrate = (w) => def.migrations[2](w.ctx);

test("migration 2 : copie une fois dans la Chaîne Twitch (champs vides), efface ici ce qui est repris, puis la Chaîne Twitch sert ; aucun secret affiché, renvoyé ni journalisé", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: {}, legacy: legacyOwn });
  assert.equal(await migrate(w), undefined, "rien n'est renvoyé");
  assert.deepEqual(w.ctx.calls.legacyCleared.sort(), ["channel", "clientId", "clientSecret"]);
  assert.deepEqual(await svc.channel(w.pctx), { channel: "ancienne_chaine", url: "https://twitch.tv/ancienne_chaine", configured: true, ready: true, missing: [] });
  assert.equal(await w.pctx.api.store.count("adopted"), 1);
  // l'état en direct vient maintenant de la Chaîne Twitch (identifiants repris), exactement comme après l'ancien bouton
  assert.ok(await banner(w.ctx));
  assert.equal(calls.find((c) => c.url.includes("/helix/streams")).init.headers["Client-Id"], "old-id");
  noLeak(visible(w.ctx), await def.adminPanel(w.ctx), await w.ctx.api.store.list("adoption"));
});

test("migration 2 rejouée : rien de plus (aucun appel, aucune écriture, rien d'effacé en double)", async () => {
  const w = wire({ provider: {}, legacy: legacyOwn });
  await migrate(w);
  const cleared = [...w.ctx.calls.legacyCleared];
  const before = w.ctx.calls.services.length;
  await migrate(w); await migrate(w);
  assert.deepEqual(w.ctx.calls.legacyCleared, cleared);
  assert.equal(w.ctx.calls.services.length, before, "plus rien à reprendre : le service n'est même pas appelé");
  assert.equal(await w.pctx.api.store.count("adopted"), 1);
});

test("migration 2 : instance DÉJÀ reprise (ancien bouton cliqué, anciennes valeurs encore là) → même affichage qu'avant, anciennes valeurs effacées, rien écrasé, rien copié de plus", async () => {
  const calls = stubTwitch({ live: true });
  const w = wire({ provider: {}, legacy: legacyOwn });
  await svc.adopt(w.pctx, { ...legacyOwn });                       // la reprise d'autrefois
  const before = await banner(w.ctx);
  assert.equal(await w.pctx.api.store.count("adopted"), 1);
  await migrate(w);
  assert.deepEqual(w.ctx.calls.legacyCleared.sort(), ["channel", "clientId", "clientSecret"]);
  assert.equal(await w.pctx.api.store.count("adopted"), 1, "pas de seconde copie");
  assert.deepEqual(await banner(w.ctx), before);
  assert.equal((await player(w.ctx))[0].type, "embed");
  assert.equal(streamCalls(calls) > 0, true);
});

test("migration 2 : jamais d'écrasement d'une valeur déjà présente dans la Chaîne Twitch ; ses identifiants saisis gardent le dessus", async () => {
  const w = wire({ provider: { channel: "ma_chaine" }, legacy: legacyOwn });
  await migrate(w);
  const info = await svc.channel(w.pctx);
  assert.equal(info.channel, "ma_chaine", "la chaîne saisie dans la Chaîne Twitch est intacte");
  assert.equal(info.ready, true);
  const full = wire({ provider: { channel: "ma_chaine", clientId: "a", clientSecret: "b" }, legacy: legacyOwn });
  await migrate(full);
  assert.equal(await full.pctx.api.store.count("adopted"), 0, "rien à copier");
  assert.deepEqual(full.ctx.calls.legacyCleared.sort(), ["channel", "clientId", "clientSecret"], "ses valeurs étaient déjà inutilisées : effacées");
});

test("migration 2 : Chaîne Twitch indisponible ou qui plante → rien n'est effacé, aucune exception ; la tâche réessaie et finit le travail", async () => {
  const gone = wire({ withProvider: false, legacy: legacyOwn });
  await assert.doesNotReject(() => migrate(gone));
  assert.deepEqual(gone.ctx.calls.legacyCleared, []);
  const broken = fakeCtx({ legacy: legacyOwn, services: { "twitch.live": { adopt: () => { throw new Error("boom"); }, channel: () => { throw new Error("boom"); } } } });
  await assert.doesNotReject(() => def.migrations[2](broken));
  assert.deepEqual(broken.calls.legacyCleared, []);
  // plus tard, la Chaîne Twitch répond : la tâche reprend
  const w = wire({ provider: {}, legacy: legacyOwn });
  const real = w.ctx.api.services.call;
  let up = false;
  w.ctx.api.services.call = async (...a) => (up ? real(...a) : { ok: false, reason: "unavailable" });
  await migrate(w);
  assert.deepEqual(w.ctx.calls.legacyCleared, []);
  up = true;
  assert.equal(typeof def.tasks.adopt.run, "function");
  await def.tasks.adopt.run(w.ctx);
  assert.equal(w.ctx.calls.legacyCleared.length, 3);
  assert.equal((await svc.channel(w.pctx)).ready, true);
});

test("migration 2 : rien à reprendre (valeurs vides, absentes) ou cœur sans ctx.legacy → aucune écriture, aucun appel", async () => {
  for (const legacy of [{ channel: "", clientId: "", clientSecret: "" }, { channel: "  ", clientId: null, clientSecret: undefined }, {}]) {
    const w = wire({ provider: {}, legacy });
    await migrate(w);
    assert.deepEqual([w.ctx.calls.legacyCleared, w.ctx.calls.services], [[], []], JSON.stringify(legacy));
    assert.equal(await w.pctx.api.store.count("adopted"), 0);
  }
  const plain = wire({ provider: {} });
  assert.equal(plain.ctx.legacy, undefined);
  await assert.doesNotReject(() => migrate(plain));
});

test("migration 2 : seulement une partie reprise (chaîne illisible, secret manquant) → l'illisible est effacé, ce qui manque encore reste ici sans rien afficher", async () => {
  const w = wire({ provider: {}, legacy: { channel: "x&y", clientId: "old-id", clientSecret: "" } });
  await migrate(w);
  assert.deepEqual(w.ctx.calls.legacyCleared.sort(), ["channel", "clientId"], "la chaîne illisible est du déchet ; le client id est repris");
  const info = await svc.channel(w.pctx);
  assert.deepEqual(info.missing, ["channel", "clientSecret"]);
  noLeak(visible(w.ctx));
});

test("migration 2 avec plusieurs Chaînes Twitch : la reprise va dans la PREMIÈRE seulement, les autres ne sont pas touchées", async () => {
  const { ctx, pctxs } = wireMany([{ settings: { clientId: "", clientSecret: "" } }, { settings: { channel: "rascane", clientId: "", clientSecret: "" } }], { own: {}, legacy: legacyOwn });
  await def.migrations[2](ctx);
  assert.equal((await svc.channel(pctxs[0])).ready, true, "la première chaîne reçoit la reprise");
  assert.equal((await svc.channel(pctxs[1])).ready, false, "la deuxième n'est pas touchée");
  assert.equal(await pctxs[1].api.store.count("adopted"), 0);
});

test("textes visibles : ni bouton ni message de reprise manuelle ; les clés qui restent existent en fr et en", () => {
  for (const l of ["fr", "en"]) {
    for (const k of Object.keys(locales[l])) assert.ok(!/^adopt|^field_/.test(k), `${l}.${k} : reprise manuelle retirée`);
    for (const k of ["needCredentials", "openTwitch"]) assert.ok(locales[l][k], `${l}.${k}`);
  }
});

// ── Plusieurs chaînes Twitch (une instance par chaîne) : Statut live les annonce TOUTES ─────────────────────────────────────────────────
const bind = (pctx) => Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](pctx, args)]));
/** N instances du vrai fournisseur (ordre de création = ordre du tableau) ; le consommateur a `callAll` (nouveau cœur) ou seulement `call` (vieux cœur : oldCore). */
function wireMany(chans, { own = {}, oldCore = false, messages = {}, legacy, ...rest } = {}) {
  const pctxs = chans.map((c, i) => fakeCtx({ key: c.key ?? `tw${i}`, settings: { clientId: "cid", clientSecret: "sec", ...c.settings } }));
  const methods = pctxs.map((p) => bind(p));
  const ctx = fakeCtx({ key: "live-status", settings: own, services: { "twitch.live": methods[0] }, serviceInstances: { "twitch.live": chans.map((c, i) => ({ instance: pctxs[i].instance.key, name: c.name, methods: methods[i] })) },
    ...(legacy ? { legacy } : {}), messages: { live: "{channel} est en direct", liveMany: "En direct", watch: "Regarder", viewersOne: "{count} spectateur", viewersMany: "{count} spectateurs", playerChoice: "Chaîne", ...messages }, ...rest });
  if (oldCore) delete ctx.api.services.callAll;
  return { ctx, pctxs };
}
/** Faux Helix par chaîne : lives = { login: { title, game, viewers, name } } ; errors = { login: 401 | 429 | "net" }. */
function fakeHelix({ lives = {}, errors = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.startsWith("https://id.twitch.tv/")) return Response.json({ access_token: "tok", expires_in: 3600 });
    const login = new URL(u).searchParams.get("user_login");
    const e = errors[login];
    if (e === "net") throw new Error("coupé");
    if (e) return new Response("{}", { status: e });
    const l = lives[login];
    return Response.json({ data: l ? [{ id: `id-${login}`, title: l.title ?? "Soirée", game_name: l.game ?? "Zelda", viewer_count: l.viewers ?? 3, user_name: l.name ?? login }] : [] });
  };
  return calls;
}
const two = [{ name: "Twitch Helldog136", settings: { channel: "helldog136" } }, { name: "Twitch Rascane", settings: { channel: "rascane" } }];

test("manifeste : minCore 0.2.0, réglage facultatif « Chaînes à annoncer » (texte, pas avancé)", async () => {
  assert.equal(manifest.minCore, "0.2.0");
  const s = manifest.settings.find((x) => x.key === "channels");
  assert.equal(s.type, "text");
  assert.ok(!s.advanced && !s.default);
});

test("2 chaînes, une seule en direct : exactement l'affichage d'une chaîne (bannière simple, lecteur simple)", async () => {
  fakeHelix({ lives: { rascane: {} } });
  const { ctx } = wireMany(two);
  assert.deepEqual(await banner(ctx), [{ type: "banner", tone: "success", text: "rascane est en direct", href: "https://twitch.tv/rascane" }]);
  const [p] = await player(ctx);
  assert.equal(p.type, "embed");
  assert.equal(new URL(p.src).searchParams.get("channel"), "rascane");
});

test("aucune des deux en direct : rien (bannière et lecteur) ; « toujours » : lecteur de la PREMIÈRE chaîne seulement", async () => {
  fakeHelix();
  const { ctx } = wireMany(two);
  assert.equal(await banner(ctx), null);
  assert.equal(await player(ctx), null);
  const a = wireMany(two, { own: { playerWhen: "always" } }).ctx;
  const [p] = await player(a);
  assert.equal(p.type, "embed");
  assert.equal(new URL(p.src).searchParams.get("channel"), "helldog136");
});

test("les deux en direct : bannière = une ligne par chaîne (nom, titre, jeu, spectateurs, Regarder), dans l'ordre de création", async () => {
  fakeHelix({ lives: { helldog136: { title: "Soirée A", game: "Zelda", viewers: 12, name: "Helldog136" }, rascane: { title: "Soirée B", game: "Celeste", viewers: 1, name: "Rascane" } } });
  const [b] = await banner(wireMany(two).ctx);
  assert.equal(b.type, "html");
  const rows = [...b.html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Helldog136.*Soirée A.*Zelda · 12 spectateurs.*href="https:\/\/twitch\.tv\/helldog136".*Regarder/);
  assert.match(rows[1], /Rascane.*Soirée B.*Celeste · 1 spectateur<.*href="https:\/\/twitch\.tv\/rascane"/);
  assert.ok(b.html.indexOf("Helldog136") < b.html.indexOf("Rascane"));
});

test("les deux en direct : lecteur de la première avec une pastille par chaîne (boutons radio, étiquettes, première cochée), un lecteur par chaîne", async () => {
  fakeHelix({ lives: { helldog136: { name: "Helldog136" }, rascane: { name: "Rascane" } } });
  const [p] = await player(wireMany(two, { siteUrl: "https://www.exemple.fr" }).ctx);
  assert.equal(p.type, "html");
  assert.equal([...p.html.matchAll(/type="radio"/g)].length, 2);
  assert.equal([...p.html.matchAll(/ checked/g)].length, 1);
  assert.match(p.html, /id="lsp-live-status-0" checked><label class="p" for="lsp-live-status-0">Helldog136<\/label>/);
  assert.match(p.html, /for="lsp-live-status-1">Rascane<\/label>/);
  const srcs = [...p.html.matchAll(/<iframe src="([^"]+)"/g)].map((m) => new URL(m[1].replaceAll("&amp;", "&")));
  assert.deepEqual(srcs.map((u) => u.searchParams.get("channel")), ["helldog136", "rascane"]);
  for (const u of srcs) { assert.equal(u.origin, "https://player.twitch.tv"); assert.equal(u.searchParams.get("parent"), "www.exemple.fr"); assert.equal(u.searchParams.get("muted"), "true"); }
  assert.ok(!/<script/i.test(p.html), "aucun script");
  assert.match(p.html, /#lsp-live-status \.r0:checked~\.w0\{display:block\}/);
});

test("échappement : titre, jeu et nom d'affichage hostiles ne produisent jamais de balise ; nom d'affichage qui n'est pas la chaîne → on garde la chaîne", async () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  fakeHelix({ lives: { helldog136: { title: evil, game: evil, name: "Helldog136" }, rascane: { title: evil, game: evil, name: evil } } });
  const { ctx } = wireMany(two);
  const [b] = await banner(ctx);
  const [p] = await player(ctx);
  for (const html of [b.html, p.html]) {
    assert.ok(!/<img/i.test(html) && !html.includes("onerror=alert(1)>") && !html.includes('"\''), html);
  }
  assert.match(b.html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  assert.ok(!b.html.includes(evil) && !p.html.includes(evil));
  assert.match(p.html, />rascane<\/label>/, "nom d'affichage qui n'est pas la chaîne écarté");
});

test("une instance en erreur (401, 429, réseau) n'empêche pas l'autre ; l'erreur n'affiche rien", async () => {
  for (const err of [401, 429, "net"]) {
    tw.resetCache();
    fakeHelix({ lives: { rascane: {} }, errors: { helldog136: err } });
    const { ctx } = wireMany(two);
    assert.deepEqual(await banner(ctx), [{ type: "banner", tone: "success", text: "rascane est en direct", href: "https://twitch.tv/rascane" }], String(err));
    assert.equal((await player(ctx))[0].type, "embed");
  }
  tw.resetCache();
  // un fournisseur qui plante (callAll renvoie ok:false) ne gêne pas les autres
  fakeHelix({ lives: { rascane: {} } });
  const { ctx, pctxs } = wireMany(two);
  const real = ctx.api.services.callAll;
  ctx.api.services.callAll = async (...a) => (await real(...a)).map((r, i) => (i === 0 ? { instance: r.instance, ok: false, error: "failed" } : r));
  assert.equal((await banner(ctx))[0].href, "https://twitch.tv/rascane");
  assert.ok(pctxs.length === 2);
});

test("un seul jeton pour deux chaînes aux mêmes identifiants, une requête Helix par chaîne, même pour bannière + lecteur + visiteurs simultanés", async () => {
  const calls = fakeHelix({ lives: { helldog136: {}, rascane: {} } });
  const { ctx } = wireMany(two);
  await Promise.all([banner(ctx), player(ctx), banner(ctx)]);
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
  assert.equal(streamCalls(calls), 2);
});

test("« Chaînes à annoncer » : vide = toutes ; sinon seulement celles listées (bannière et lecteur)", async () => {
  fakeHelix({ lives: { helldog136: {}, rascane: {} } });
  const only = wireMany(two, { own: { channels: " Rascane, inconnue " } }).ctx;
  assert.equal((await banner(only))[0].href, "https://twitch.tv/rascane");
  assert.equal(new URL((await player(only))[0].src).searchParams.get("channel"), "rascane");
  assert.equal((await banner(wireMany(two, { own: { channels: "nobody_here" } }).ctx)), null);
  assert.equal((await banner(wireMany(two).ctx))[0].type, "html");
});

test("vieux cœur sans callAll : repli sur l'appel unique (première chaîne), aucune exception", async () => {
  fakeHelix({ lives: { helldog136: {}, rascane: {} } });
  const { ctx } = wireMany(two, { oldCore: true });
  assert.equal(typeof ctx.api.services.callAll, "undefined");
  assert.deepEqual(await banner(ctx), [{ type: "banner", tone: "success", text: "helldog136 est en direct", href: "https://twitch.tv/helldog136" }]);
  assert.equal((await player(ctx))[0].type, "embed");
  assert.equal(await banner(wireMany(two, { oldCore: true, withProvider: false }).ctx).catch(() => "x") !== "x", true);
});

test("un callAll qui lève → pas d'exception (repli sur rien)", async () => {
  const { ctx } = wireMany(two);
  ctx.api.services.callAll = async () => { throw new Error("boom"); };
  assert.equal(await banner(ctx), null);
  assert.equal(await player(ctx), null);
});

test("aucun secret ni jeton dans ce que présente Statut live ; aucun appel réseau de live-status lui-même", async () => {
  const calls = fakeHelix({ lives: { helldog136: {}, rascane: {} } });
  const { ctx } = wireMany(two);
  const dump = JSON.stringify([await banner(ctx), await player(ctx), await def.adminPanel(ctx)]);
  for (const v of ["sec", "tok", "cid", "Bearer", "oauth"]) assert.ok(!dump.includes(v), v);
  assert.ok(calls.every((c) => /^https:\/\/(id|api)\.twitch\.tv\//.test(c.url)), "les appels viennent du fournisseur");
  const src = fs.readFileSync(new URL("../modules/live-status/view.mjs", import.meta.url), "utf8");
  assert.ok(!/fetch\(|twitch\.tv\/helix|oauth2|Bearer/.test(src));
});

test("textes des plusieurs chaînes : tous présents en fr et en, toutes les clés utilisées par le code existent", () => {
  for (const l of ["fr", "en"]) for (const k of ["liveMany", "watch", "viewersOne", "viewersMany", "playerChoice"]) assert.ok(locales[l][k], `${l}.${k}`);
  assert.match(locales.fr.viewersMany, /\{count\}/);
  const used = new Set();
  for (const f of ["index", "source", "adopt", "view"]) for (const m of fs.readFileSync(new URL(`../modules/live-status/${f}.mjs`, import.meta.url), "utf8").matchAll(/ctx\.t\(\s*(?:"([A-Za-z_]+)"|c === 1 \? "([A-Za-z]+)" : "([A-Za-z]+)")/g)) [m[1], m[2], m[3]].filter(Boolean).forEach((k) => used.add(k));
  for (const k of used) for (const l of ["fr", "en"]) assert.ok(locales[l][k], `clé « ${k} » manquante en ${l}`);
  assert.ok(used.size >= 8);
});

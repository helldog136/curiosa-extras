// Chaîne Twitch 1.5.0 : le service `twitch.api` (parler à Twitch au nom de la chaîne SANS jamais rendre un jeton), les autorisations demandées par un autre module,
// et la connexion d'un compte « bot » séparé. Aucun réseau : un faux Twitch (tests/helpers/fakeTwitch.mjs) répond à la place d'id.twitch.tv et d'api.twitch.tv.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeTwitch } from "./helpers/fakeTwitch.mjs";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const def = mod.default;
const api = def.services["twitch.api"];
const callback = def.routes["oauth/callback"];
const realFetch = globalThis.fetch;
let tw;
beforeEach(() => { mod.resetCache(); tw = fakeTwitch(); globalThis.fetch = (u, i) => tw.fetch(u, i); });
afterEach(() => { globalThis.fetch = realFetch; });

const mk = (extra = {}) => fakeCtx({ key: "tw", locale: "fr", messages: fr, settings: { channel: "MaChaine", clientId: "cid", clientSecret: "SEC-RET", ...extra } });
const unesc = (v) => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const buttonOf = (blocks) => { const b = blocks.find((x) => x.type === "html" && x.html.includes("data-twitch-connect")); return b ? unesc(/href="([^"]+)"/.exec(b.html)[1]) : null; };
const CHAT = ["user:read:chat", "user:write:chat", "user:bot", "channel:bot"];
const want = (ctx, over = {}) => api.wantScopes(ctx, { consumer: "twitch-bot", slot: "main", scopes: CHAT, returnTo: "/admin/instances/bot1", ...over });
/** Le parcours : le panneau donne le lien, l'utilisateur autorise chez Twitch, Twitch rappelle. */
async function connectMain(ctx, who) {
  const link = buttonOf(await def.adminPanel(ctx));
  assert.ok(link, "le bouton de connexion doit être là");
  return { link, res: await callback(new Request(tw.approve(link, who)), ctx) };
}

test("manifeste : offre twitch.api en « each » (une chaîne par instance), version 1.5.1 ; textes ajoutés en fr et en", () => {
  const o = manifest.offers.find((x) => x.service === "twitch.api");
  assert.ok(o && o.each === true && o.label.fr && o.label.en);
  assert.equal(manifest.version, "1.5.1");
  for (const k of ["conn_why_chat", "extras_note"]) { assert.ok(fr[k] && en[k], k); }
  assert.deepEqual(Object.keys(api).sort(), ["account", "connectLink", "disconnect", "request", "wantScopes"]);
});

test("account : avant toute connexion « none » ; prêt dès que l'application et la chaîne sont réglées ; jamais de jeton", async () => {
  const ctx = mk();
  const a = await api.account(ctx, {});
  assert.deepEqual([a.ok, a.channel, a.ready, a.status, a.userId, a.scopes], [true, "machaine", true, "none", null, []]);
  assert.equal(a.adminPath, "/admin/instances/id-tw");
  const empty = await api.account(mk({ clientId: "", clientSecret: "" }), {});
  assert.equal(empty.ready, false);
});

test("wantScopes : liste fermée, consommateur valide, idempotent (aucune écriture si rien ne change), [] retire la demande", async () => {
  const ctx = mk();
  assert.deepEqual((await want(ctx, { scopes: [...CHAT, "channel:manage:broadcast", "bits:read"] })).scopes, [...CHAT].sort(), "une autorisation hors liste est écartée");
  const writes = () => ctx.calls && 0;
  const before = JSON.stringify(await ctx.api.store.list("twitchWants"));
  await want(ctx); await want(ctx);
  assert.equal(JSON.stringify(await ctx.api.store.list("twitchWants")), before, "même demande = aucune écriture");
  assert.equal((await ctx.api.store.list("twitchWants")).length, 1);
  assert.deepEqual(await want(ctx, { consumer: "Pas Valable!" }), { ok: false, error: "invalid" });
  assert.deepEqual(await want(ctx, { returnTo: "https://evil.example/x" }).then((r) => r.ok), true);
  assert.equal((await ctx.api.store.list("twitchWants"))[0].data.returnTo, null, "un retour hors de l'administration est refusé");
  await want(ctx, { scopes: [] });
  assert.equal((await ctx.api.store.list("twitchWants")).length, 0);
  void writes;
  assert.deepEqual(await api.account(ctx, { channel: "autre" }), { ok: false, error: "other_channel" });
});

test("panneau : sans « Suivre mes statistiques », la connexion apparaît dès qu'un module demande des autorisations, avec ces autorisations seules", async () => {
  const ctx = mk({ trackStats: false });
  assert.deepEqual(await def.adminPanel(ctx), [], "rien à connecter tant que personne n'en demande");
  await want(ctx);
  const panel = await def.adminPanel(ctx);
  const link = buttonOf(panel);
  assert.ok(link);
  assert.deepEqual(new URL(link).searchParams.get("scope").split(" ").sort(), [...CHAT].sort(), "aucune autorisation de statistiques demandée");
  assert.ok(panel.some((b) => b.type === "markdown" && /pour que le bot de votre chat/i.test(b.text)), "texte adapté au chat");
  assert.ok(!panel.some((b) => b.type === "table"), "pas de tableau de chiffres vide");
});

test("connexion : le retour va sur la page du module demandeur (adresse vérifiée), les droits demandés sont accordés, status passe à « ok »", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx);
  const { res } = await connectMain(ctx);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/instances/bot1");
  const a = await api.account(ctx, {});
  assert.equal(a.status, "ok");
  assert.equal(a.login, "machaine");
  for (const s of CHAT) assert.ok(a.scopes.includes(s), s);
  assert.deepEqual((await def.adminPanel(ctx)).find((b) => b.type === "banner").tone, "success");
  assert.equal((await api.connectLink(ctx, {})).reason, "connected");
});

test("nouvelle autorisation demandée après coup : status « more » puis il faut reconnecter ; mauvais compte refusé", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx, { scopes: ["user:read:chat"] });
  await connectMain(ctx);
  assert.equal((await api.account(ctx, {})).status, "ok");
  await want(ctx, { scopes: CHAT });
  assert.equal((await api.account(ctx, {})).status, "more");
  const l = await api.connectLink(ctx, {});
  assert.ok(l.url && l.url.startsWith("https://id.twitch.tv/oauth2/authorize"));
  const ctx2 = mk({ trackStats: false }); await want(ctx2);
  const { res } = await connectMain(ctx2, { login: "quelquun_dautre", userId: "9" });
  assert.equal(res.headers.get("location"), "/admin/instances/bot1");
  const a = await api.account(ctx2, {});
  assert.equal(a.status, "none");
  assert.deepEqual(a.result, { code: "wrongAccount", login: "quelquun_dautre" });
});

test("compte bot séparé : un 2e compte (n'importe lequel) se connecte via la MÊME adresse de retour, sans toucher à la connexion de la chaîne", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx, { scopes: ["channel:bot"] });
  await want(ctx, { slot: "bot", scopes: ["user:read:chat", "user:write:chat", "user:bot"] });
  await connectMain(ctx);
  const l = await api.connectLink(ctx, { slot: "bot" });
  assert.ok(l.url);
  assert.equal(new URL(l.url).searchParams.get("redirect_uri"), "https://example.test/m/tw/oauth/callback", "une seule adresse de retour à enregistrer chez Twitch");
  assert.deepEqual(new URL(l.url).searchParams.get("scope").split(" ").sort(), ["user:bot", "user:read:chat", "user:write:chat"]);
  const res = await callback(new Request(tw.approve(l.url, { login: "monbot", userId: "4242" })), ctx);
  assert.equal(res.headers.get("location"), "/admin/instances/bot1");
  const bot = await api.account(ctx, { slot: "bot" });
  assert.deepEqual([bot.status, bot.login, bot.userId], ["ok", "monbot", "4242"]);
  const main = await api.account(ctx, { slot: "main" });
  assert.deepEqual([main.status, main.login], ["ok", "machaine"], "la chaîne n'a pas bougé");
  assert.deepEqual((await api.disconnect(ctx, { slot: "bot" })).ok, true);
  assert.equal((await api.account(ctx, { slot: "bot" })).status, "none");
  assert.equal((await api.account(ctx, { slot: "main" })).status, "ok");
  assert.deepEqual(await api.disconnect(ctx, { slot: "main" }), { ok: false, error: "forbidden" }, "la chaîne se déconnecte sur sa propre page");
  assert.ok(tw.revoked.length >= 2, "les jetons du bot sont révoqués chez Twitch");
});

test("request : liste fermée d'appels, rien d'autre ne passe", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx); await connectMain(ctx);
  const bad = async (a) => (await api.request(ctx, a));
  assert.deepEqual(await bad({ as: "app", method: "GET", path: "channels/followers" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bad({ as: "app", method: "DELETE", path: "chat/messages" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bad({ as: "user", method: "GET", path: "users" }), { ok: false, error: "forbidden" }, "un jeton d'utilisateur ne sert qu'à écrire dans le chat");
  assert.deepEqual(await bad({ as: "user", method: "POST", path: "eventsub/subscriptions" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bad({ as: "app", method: "GET", path: "../oauth2/token" }), { ok: false, error: "forbidden" });
  assert.deepEqual(await bad({ as: "app", method: "GET", path: "users", query: { "x y": "1" } }), { ok: false, error: "invalid" });
  assert.deepEqual(await bad({ as: "user", method: "POST", path: "chat/messages", body: "texte" }), { ok: false, error: "invalid" });
  assert.deepEqual(await bad({ as: "user", method: "POST", path: "chat/messages", body: { message: "x".repeat(20_000) } }), { ok: false, error: "invalid" });
  assert.deepEqual(await bad({ as: "root", method: "GET", path: "users" }), { ok: false, error: "invalid" });
  assert.deepEqual(await bad({ as: "app", method: "GET", path: "users", channel: "autre" }), { ok: false, error: "other_channel" });
  assert.equal(tw.log.filter((c) => c.path === "/helix/channels/followers" || c.path === "/oauth2/token" && c.body?.grant_type === "client_credentials").length, 0, "aucun appel interdit n'est parti");
});

test("request : abonnement (jeton d'application) et message (jeton de l'utilisateur) ; la réponse de Twitch est rendue, jamais un jeton", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx); await connectMain(ctx);
  const made = await api.request(ctx, { as: "app", method: "POST", path: "eventsub/subscriptions", body: { type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "777", user_id: "777" }, transport: { method: "webhook", callback: "https://example.test/m/bot1/webhook", secret: "S" } } });
  assert.equal(made.ok, true); assert.equal(made.status, 202); assert.equal(made.json.data[0].status, "webhook_callback_verification_pending");
  tw.subs[0].status = "enabled";
  const dup2 = await api.request(ctx, { as: "app", method: "POST", path: "eventsub/subscriptions", body: { type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "777", user_id: "777" }, transport: { method: "webhook", callback: "https://example.test/m/bot1/webhook", secret: "S" } } });
  assert.equal(dup2.status, 409);
  const list = await api.request(ctx, { as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: "channel.chat.message" } });
  assert.equal(list.json.data.length, 1);
  assert.equal(list.json.data[0].secret, undefined);
  const sent = await api.request(ctx, { as: "user", method: "POST", path: "chat/messages", body: { broadcaster_id: "777", sender_id: "777", message: "Salut" } });
  assert.deepEqual([sent.ok, sent.status, sent.json.data[0].is_sent], [true, 200, true]);
  assert.deepEqual(tw.chat.map((m) => [m.message, m.as]), [["Salut", "machaine"]]);
  const del = await api.request(ctx, { as: "app", method: "DELETE", path: "eventsub/subscriptions", query: { id: tw.subs[0].id } });
  assert.equal(del.status, 204);
  const everything = JSON.stringify([made, list, sent, del, await api.account(ctx, {}), await api.connectLink(ctx, {})]);
  for (const secret of ["SEC-RET", "app_tok", "at_", "rt_"]) assert.ok(!everything.includes(secret), `« ${secret} » ne doit jamais sortir du service`);
});

test("request avec le jeton d'utilisateur : sans connexion → auth ; autorisation d'écrire absente → scope ; message envoyé par le compte bot si on le demande", async () => {
  const ctx = mk({ trackStats: false });
  const msg = { as: "user", method: "POST", path: "chat/messages", body: { broadcaster_id: "777", sender_id: "777", message: "x" } };
  assert.deepEqual(await api.request(ctx, msg), { ok: false, error: "auth" });
  await want(ctx, { scopes: ["user:read:chat"] }); await connectMain(ctx);
  assert.deepEqual(await api.request(ctx, msg), { ok: false, error: "scope" }, "la chaîne n'a pas accordé l'écriture");
  await want(ctx, { scopes: CHAT, slot: "bot" });
  const l = await api.connectLink(ctx, { slot: "bot" });
  await callback(new Request(tw.approve(l.url, { login: "monbot", userId: "4242" })), ctx);
  const r = await api.request(ctx, { ...msg, slot: "bot", body: { broadcaster_id: "777", sender_id: "4242", message: "Coucou" } });
  assert.equal(r.ok, true);
  assert.deepEqual(tw.chat.map((m) => [m.as, m.sender, m.message]), [["monbot", "4242", "Coucou"]]);
});

test("un jeton refusé (401) est renouvelé UNE fois ; Twitch qui ne répond pas → error network, sans exception", async () => {
  const ctx = mk({ trackStats: false });
  await want(ctx); await connectMain(ctx);
  const doc = (await ctx.api.store.list("twitchConnection"))[0].data;
  tw.expireAccess(doc.access);
  const msg = { as: "user", method: "POST", path: "chat/messages", body: { broadcaster_id: "777", sender_id: "777", message: "Après renouvellement" } };
  assert.equal((await api.request(ctx, msg)).ok, true);
  assert.equal(tw.log.filter((c) => c.body?.grant_type === "refresh_token").length, 1);
  tw.state.down = true;
  assert.deepEqual(await api.request(ctx, msg), { ok: false, error: "network" });
});

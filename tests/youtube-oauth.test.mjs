// Connecteur YouTube 1.3.0 : connexion facultative au compte YouTube (flux « appareil » de Google), lecture du chat avec le jeton, écriture dans le chat (facultative, désactivée par défaut).
// Le VRAI connecteur et le VRAI client réseau du cœur ; un faux Google (tests/helpers/fakeGoogleAuth.mjs) qui contrôle les jetons et les portées. Une horloge simulée fait passer le temps.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseManifest } from "@/core/modules/manifest";
import { makeConnector, connectorModule, connectorApi as api, connectorMessages } from "./helpers/fakeYoutube.mjs";
import { fakeGoogle, CLIENT_ID, CLIENT_SECRET, API_KEY, CHAT, SCOPE_READ, SCOPE_MANAGE, SECRET_RE } from "./helpers/fakeGoogleAuth.mjs";

const O = await import("../modules/youtube-connector/oauth.mjs");
const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { netReplies } = kit;
const DIR = new URL("../modules/youtube-connector/", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}module.json`, "utf8"));
const src = Object.fromEntries(["index.mjs", "api.mjs", "oauth.mjs"].map((f) => [f, fs.readFileSync(`${DIR}${f}`, "utf8")]));
const def = connectorModule.default;
const T0 = Date.parse("2026-10-20T20:00:00Z");
const realFetch = globalThis.fetch;
const saved = { api: { ...api.LIMITS }, oauth: { ...O.LIMITS } };
const fr = connectorMessages("fr");
const en = connectorMessages("en");
let g;

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: T0 });
  api.resetState();
  g = fakeGoogle();
  globalThis.fetch = g.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
  Object.assign(api.LIMITS, saved.api);
  Object.assign(O.LIMITS, saved.oauth);
});

/** Un connecteur avec l'identifiant et le code secret saisis (le cas normal après la mise en route). */
const mk = (settings = {}, o = {}) => makeConnector({ apiKey: o.apiKey === undefined ? API_KEY : o.apiKey, settings: { oauthClientId: CLIENT_ID, oauthClientSecret: CLIENT_SECRET, ...settings }, ...o.ctx });
const run = (c, action) => def.adminActions[action](c.ctx, {});
const tick = (ms) => mock.timers.tick(ms);
const chatReq = (extra = {}) => ({ endpoint: "liveChatMessages.list", params: { liveChatId: CHAT, maxResults: 500 }, ...extra });
/** Connecte le compte de bout en bout (code, approbation, vérification). */
async function connect(c, { decision = "approved", grant } = {}) {
  g.grant = grant ?? null;
  tick(11_000);   // dix secondes au moins entre deux demandes de code
  const a = await run(c, "accountConnect"); assert.ok(a.ok, JSON.stringify(a));
  g.decision = decision;
  tick(6000);
  return run(c, "accountCheck");
}
const dumpOf = (c, ...except) => JSON.stringify(c.ctx.dumpStore().filter((r) => !except.includes(r.collection)));
const collection = (c, name) => c.ctx.dumpStore().filter((r) => r.collection === name);
const flat = (v) => JSON.stringify(v);
/** Comme flat, avec les apostrophes lues comme une personne les lit (le panneau les échappe en &#39;). */
const plain = (v) => flat(v).replace(/&#39;/g, "'");

/** Capture tout ce que le module écrit dans la console pendant `fn`. */
async function withConsole(fn) {
  const lines = [];
  const spies = ["log", "info", "warn", "error", "debug"].map((m) => mock.method(console, m, (...a) => { lines.push(a.map(String).join(" ")); }));
  try { await fn(); } finally { for (const s of spies) s.mock.restore(); }
  return lines;
}

/* ───────────── Manifeste, textes, code ───────────── */

test("manifeste 1.3.0 : valide, secret saisi par la propriétaire, écriture désactivée par défaut et avancée, aucun outil MCP, onglets inchangés, service youtube.api v1", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifest.version, "1.3.1");
  const by = (k) => manifest.settings.find((s) => s.key === k);
  assert.equal(by("oauthClientId").type, "text"); assert.equal(by("oauthClientId").optional, true);
  assert.equal(by("oauthClientSecret").type, "secret"); assert.equal(by("oauthClientSecret").optional, true);
  assert.equal(by("chatReply").type, "boolean"); assert.equal(by("chatReply").default, false, "désactivé par défaut"); assert.equal(by("chatReply").advanced, true, "réglage avancé");
  assert.equal(by("apiKey").type, "secret");
  assert.equal(manifest.mcp, undefined, "aucun outil pour l'assistant : rien de la connexion ne lui est exposé");
  assert.deepEqual(manifest.tabs, [{ id: "use", hidden: true }]);
  assert.equal(manifest.minCore, "0.2.2");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.version]), [["youtube.api", 1]]);
  assert.ok(manifest.offers[0].readOnly.includes("chatPost"), "un message écrit dans le chat n'est jamais recopié vers une réplique");
  assert.equal(def.tasks, undefined, "aucune tâche en arrière-plan");
  for (const h of ["onInstanceDelete"]) assert.equal(typeof def.hooks[h], "function");
});

test("textes : parité exacte FR/EN, toutes les clés utilisées existent (y compris une phrase par erreur et par issue), aucun jargon dans les phrases de la propriétaire", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const used = [...src["index.mjs"].matchAll(/\bt\("([\w]+)"/g)].map((m) => m[1]);
  for (const k of used) assert.ok(k in fr, `clé absente : ${k}`);
  for (const code of ["client_id", "client_secret", "too_fast", "too_many", "client", "scope", "rate", "timeout", "network", "google", "no_pending", "expired", "denied", "policy"]) assert.ok(`err_${code}` in fr && `err_${code}` in en, `err_${code}`);
  for (const code of ["code_expired", "denied", "policy", "client", "google", "scope_missing", "write_missing", "expired", "revoke_failed", "disconnected"]) assert.ok(`last_${code}` in fr && `last_${code}` in en, `last_${code}`);
  const visible = Object.entries(fr).filter(([k]) => /^(acc_|btn_|pend_|err_|last_|check_|cancel_|connect_|disconnect_)/.test(k)).map(([, v]) => v).join(" ");
  assert.ok(!/oauth|token|jeton|endpoint|payload|slug|scope/i.test(visible), "mots simples, pas de jargon");
  for (const k of ["acc_step1", "acc_step2", "acc_step3", "acc_step4"]) assert.match(fr[k], /\*\*/, "chaque étape met en gras ce qu'il faut chercher à l'écran");
  assert.match(fr.acc_step3, /Téléviseurs et périphériques à entrée limitée/);
  assert.match(fr.acc_step2, /Publier l'application/, "sans cela le jeton expire au bout de 7 jours (Google)");
});

test("code : ni fetch direct ni minuteur répétitif ; seulement trois adresses d'OAuth (HTTPS, hôte Google) en liste fermée ; aucun hôte hors Google", () => {
  for (const [f, code] of Object.entries(src)) {
    const bare = code.replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(/.test(bare), `${f} : pas de fetch direct`);
    assert.ok(!/setInterval|setTimeout\s*\(\s*\w+\s*,\s*\d+\s*\)\s*;?\s*\/\/\s*répète/.test(bare), `${f} : aucun minuteur répétitif`);
    for (const m of bare.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) assert.ok(["oauth2.googleapis.com", "www.googleapis.com", "www.google.com", "myaccount.google.com", "console.cloud.google.com", "www.w3.org"].includes(m[1]) || f === "index.mjs", `${f} : hôte inattendu ${m[1]}`);
  }
  assert.deepEqual(Object.values(O.URLS).sort(), ["https://oauth2.googleapis.com/device/code", "https://oauth2.googleapis.com/revoke", "https://oauth2.googleapis.com/token"]);
  assert.ok(Object.isFrozen(O.URLS));
  assert.ok(!/setTimeout|setInterval/.test(src["oauth.mjs"].replace(/\/\/.*$/gm, "")), "oauth.mjs : aucun minuteur (le rafraîchissement est à la demande)");
});

/* ───────────── Le parcours : code, approbation, connexion ───────────── */

test("parcours d'Emma : code court + adresse Google, rien avant l'intervalle, « pas encore » puis « connecté » ; portée de lecture SEULE par défaut ; jetons gardés, rien d'autre", async () => {
  const c = mk();
  const a = await run(c, "accountConnect");
  assert.deepEqual(a, { ok: fr.connect_started, redirect: "?" });
  assert.equal(g.calls.device.length, 1);
  assert.deepEqual(g.calls.device[0].form, { client_id: CLIENT_ID, scope: SCOPE_READ }, "lecture seule : youtube.readonly, rien d'autre (pas de secret envoyé non plus)");
  assert.equal(g.calls.device[0].method, "POST");
  assert.equal(g.calls.device[0].url, "https://oauth2.googleapis.com/device/code");
  let panel = flat(await def.adminPanel(c.ctx));
  assert.match(panel, /ABCD-EFGH/); assert.match(panel, /google\.com\/device/);
  assert.ok(!SECRET_RE.test(panel), "le code de l'appareil ne s'affiche jamais, seulement le code court");
  assert.equal((await connectorModule.default.adminPanel(c.ctx)).filter((b) => b.type === "adminForm").map((b) => b.action).join(), "accountCheck,accountCancel");
  // Trop tôt : aucun appel à Google.
  const early = await run(c, "accountCheck");
  assert.match(early.ok, /pas encore reçu/); assert.equal(g.calls.token.length, 0);
  tick(6000);
  const pending = await run(c, "accountCheck");
  assert.match(pending.ok, /pas encore reçu/); assert.equal(g.calls.token.length, 1);
  assert.equal((await api.status(c.ctx)).oauth.state, "pending");
  g.decision = "approved"; tick(6000);
  const done = await run(c, "accountCheck");
  assert.deepEqual(done, { ok: fr.check_done, redirect: "?" });
  const st = await api.status(c.ctx);
  assert.deepEqual(st.oauth, { state: "connected", configured: true, read: true, write: false, writeWanted: false, scopes: ["read"], since: new Date(T0 + 12_000).toISOString() });
  assert.deepEqual(st.chat, { read: true, write: false });
  assert.equal(collection(c, "oauth-pending").length, 0, "le code en attente est effacé");
  assert.equal(collection(c, "oauth-tokens").length, 1);
  assert.equal(g.calls.token.at(-1).form.client_secret, CLIENT_SECRET, "le code secret n'est envoyé qu'à l'adresse des jetons, dans le corps");
  panel = flat(await def.adminPanel(c.ctx));
  assert.match(panel, /Déconnecter mon compte YouTube/); assert.match(panel, /connecté depuis le/);
});

test("« répondre dans le chat » activé : la portée demandée est youtube (la plus petite que le flux appareil permette pour écrire) ; sans lui, jamais ; l'écran explique ce que Google va demander", async () => {
  const off = mk();
  assert.match(flat(await def.adminPanel(off.ctx)), /seulement l'autorisation de lire/);
  const on = mk({ chatReply: true });
  const panel = flat(await def.adminPanel(on.ctx));
  assert.match(panel, /gérer votre compte YouTube/);
  assert.match(panel, /Le site ne s'en sert que pour cela/);
  const r = await connect(on);
  assert.equal(g.calls.device[0].form.scope, SCOPE_MANAGE);
  assert.ok(r.ok);
  const st = await api.status(on.ctx);
  assert.deepEqual(st.chat, { read: true, write: true });
  assert.deepEqual(st.oauth.scopes, ["manage"]);
});

test("sans compte ni clé ni code : rien ne part, et chaque action le dit en mots simples", async () => {
  const none = makeConnector({ apiKey: null });
  assert.equal((await run(none, "accountConnect")).error, fr.err_client_id);
  assert.equal(g.calls.all.length, 0);
  const noSecret = mk({ oauthClientSecret: "" });
  assert.equal((await run(noSecret, "accountConnect")).error, fr.err_client_secret);
  const badId = mk({ oauthClientId: "pas un identifiant" });
  assert.equal((await run(badId, "accountConnect")).error, fr.err_client_id);
  assert.equal((await run(mk(), "accountCheck")).error, fr.err_no_pending, "rien à vérifier : pas d'appel");
  assert.equal(g.calls.all.length, 0);
  assert.equal((await run(mk(), "accountDisconnect")).ok, fr.disconnect_done);
  assert.equal(g.calls.all.length, 0, "se déconnecter sans compte ne contacte personne");
});

test("anti-abus du bouton « Connecter » : 10 secondes entre deux demandes, 10 par heure ; annuler efface le code", async () => {
  const c = mk();
  assert.ok((await run(c, "accountConnect")).ok);
  const quick = await run(c, "accountConnect");
  assert.equal(quick.error, fr.err_too_fast); assert.equal(g.calls.device.length, 1);
  for (let i = 0; i < 9; i++) { tick(11_000); assert.ok((await run(c, "accountConnect")).ok, `demande ${i + 2}`); }
  tick(11_000);
  assert.equal((await run(c, "accountConnect")).error, fr.err_too_many);
  assert.equal(g.calls.device.length, 10);
  const cancel = await run(c, "accountCancel");
  assert.equal(cancel.ok, fr.cancel_done);
  assert.equal(collection(c, "oauth-pending").length, 0);
  assert.equal((await run(c, "accountCheck")).error, fr.err_no_pending);
  tick(3_600_000);
  assert.ok((await run(c, "accountConnect")).ok, "une heure plus tard, c'est de nouveau permis");
});

/* ───────────── Sécurité du flux ───────────── */

test("sécurité : l'adresse à ouvrir est TOUJOURS celle de Google (https, google.com) — une adresse piégée venue de la réponse est remplacée, jamais affichée ni suivie", async () => {
  for (const evil of ["javascript:alert(1)", "http://www.google.com/device", "https://evil.example/device", "https://www.google.com.evil.example/device", "https://user:pw@www.google.com/device", "https://www.google.com/device?next=https://evil.example", "https://www.google.com:8443/device", "//evil.example/device", "https://www.google.com/dev<script>"]) {
    api.resetState();
    g = fakeGoogle({ verificationUrl: evil }); globalThis.fetch = g.fetch;
    tick(3_700_000);
    const c = mk();
    assert.ok((await run(c, "accountConnect")).ok, evil);
    const panel = flat(await def.adminPanel(c.ctx));
    assert.match(panel, /https:\/\/www\.google\.com\/device/, evil);
    assert.ok(!/evil|javascript:|<script/.test(panel), `aucune trace de ${evil}`);
    const doc = collection(c, "oauth-pending")[0].data;
    assert.equal(doc.url, "https://www.google.com/device");
  }
  assert.equal(O.safeVerificationUrl("https://www.google.com/device"), "https://www.google.com/device");
  assert.equal(O.safeVerificationUrl("https://google.com/device"), "https://google.com/device");
});

test("sécurité : le code court est échappé à l'affichage ; toute action du panneau ne redirige que vers l'écran lui-même (?), jamais ailleurs", async () => {
  const c = mk();
  g.next.device = () => ({ json: { device_code: "4/DEVSECRET-x-CCCCCCCCCCCC", user_code: "<img/src=x/onerror=alert(1)>", verification_url: "https://www.google.com/device", expires_in: 600, interval: 5 } });
  assert.ok((await run(c, "accountConnect")).ok);
  const html = (await def.adminPanel(c.ctx)).filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.ok(!/<img\/src/.test(html)); assert.match(html, /&lt;img\/src=x\/onerror=alert\(1\)&gt;/);
  for (const action of Object.keys(def.adminActions)) {
    const r = await def.adminActions[action](c.ctx, { redirect: "https://evil.example", next: "//evil.example" });
    if (r.redirect !== undefined) assert.equal(r.redirect, "?", action);
  }
});

test("sécurité : un code d'appareil vieux de plus de 30 minutes est mort (aucun appel à Google), un changement d'ID client coupe le code en attente et les jetons", async () => {
  const c = mk();
  await run(c, "accountConnect");
  tick(31 * 60_000);
  const late = await run(c, "accountCheck");
  assert.equal(late.error, fr.err_expired); assert.equal(g.calls.token.length, 0);
  assert.match(flat(await def.adminPanel(c.ctx)), /Le code a expiré avant d'être utilisé/);
  // Un autre identifiant client : le code d'avant ne vaut plus rien.
  const a = mk(); g.decision = "approved";
  await run(a, "accountConnect");
  tick(6000);
  const aCtx = { ...a.ctx, setting: (k) => (k === "oauthClientId" ? "999999999999-zzzzzzzzzzzzzzzz.apps.googleusercontent.com" : a.ctx.setting(k)) };
  assert.equal((await O.checkConnect(aCtx)).error, "no_pending"); assert.equal(g.calls.token.length, 0);
  // Les jetons d'un autre client ne servent plus : « reconnectez ».
  const b = mk();
  await connect(b);
  const ctx2 = { ...b.ctx, setting: (k) => (k === "oauthClientId" ? "999999999999-zzzzzzzzzzzzzzzz.apps.googleusercontent.com" : b.ctx.setting(k)) };
  assert.equal((await O.connection(ctx2)).state, "stale");
  assert.equal((await O.bearer(ctx2, "read")).error, "not_connected");
});

/* ───────────── Les jetons ne sortent jamais ───────────── */

test("jetons : JAMAIS dans une réponse de service, un panneau, un résultat d'action, le journal réseau, la console, ni dans une autre collection que celle des jetons — même quand Google les répète dans ses erreurs", async () => {
  const c = mk({ chatReply: true });
  const seen = [];
  const lines = await withConsole(async () => {
    seen.push(await run(c, "accountConnect"), await def.adminPanel(c.ctx));
    g.decision = "approved"; tick(6000);
    seen.push(await run(c, "accountCheck"), await def.adminPanel(c.ctx));
    seen.push(await c.methods.request(chatReq()), await c.methods.status(), await c.methods.channels({ ids: ["UC" + "a".repeat(22)] }));
    seen.push(await c.methods.chatPost({ liveChatId: CHAT, text: "C'est arrêté" }));
    tick(4000); g.messages = [];
    // Google retire l'accès et répète le jeton dans son message d'erreur.
    g.revokedAtGoogle = true; O.LIMITS.accessSkewMs = 10 * 3_600_000;
    seen.push(await c.methods.request(chatReq()), await c.methods.status(), await def.adminPanel(c.ctx));
    seen.push(await c.methods.chatPost({ liveChatId: CHAT, text: "Encore" }));
    g.revokedAtGoogle = false; O.LIMITS.accessSkewMs = saved.oauth.accessSkewMs; tick(11_000);
    seen.push(await connect(c));
    seen.push(await run(c, "accountDisconnect"), await def.adminPanel(c.ctx));
  });
  const all = flat(seen) + lines.join("\n") + c.ctx.calls.netLog.join("\n") + dumpOf(c, "oauth-tokens", "oauth-pending");
  assert.ok(!SECRET_RE.test(all), `un jeton ou un code d'appareil a fuité : ${(all.match(/.{20}SECRET.{20}/) ?? [])[0]}`);
  assert.ok(!all.includes(CLIENT_SECRET), "le code secret du client n'est jamais réaffiché ni journalisé");
  assert.ok(!all.includes(API_KEY), "la clé YouTube non plus");
  assert.ok(c.ctx.calls.netLog.length > 0, "le journal réseau a bien été examiné");
  for (const u of g.calls.all.map((x) => x.url)) assert.ok(!SECRET_RE.test(u) && !u.includes(CLIENT_SECRET) && !u.includes(API_KEY) && !/access_token|refresh_token=/.test(u), `aucun secret dans une adresse : ${u}`);
  assert.equal(g.calls.revoke[0].url, "https://oauth2.googleapis.com/revoke", "le jeton à révoquer voyage dans le corps, pas dans l'adresse");
});

test("jetons : gardés dans UNE seule collection du stockage privé du connecteur ; jamais dans les réglages, jamais copiés ; la sauvegarde lisible n'existe pas", async () => {
  const c = mk();
  await connect(c);
  const tokenRows = collection(c, "oauth-tokens");
  assert.equal(tokenRows.length, 1);
  assert.deepEqual(Object.keys(tokenRows[0].data).sort(), ["access", "accessUntil", "at", "fp", "refresh", "scopes"]);
  for (const r of c.ctx.dumpStore()) if (r.collection !== "oauth-tokens") assert.ok(!SECRET_RE.test(JSON.stringify(r.data)), r.collection);
  assert.equal(def.backup, undefined, "aucune sauvegarde lisible qui pourrait écrire un jeton dans un fichier");
  assert.equal(manifest.provides, undefined);
  assert.equal(def.exports, undefined, "aucun sujet : rien n'est offert aux autres modules en dehors du service");
});

/* ───────────── Rafraîchissement, panne, retrait ───────────── */

test("rafraîchissement À LA DEMANDE : aucun appel tant que le jeton vaut encore, UN seul appel quand vingt lectures arrivent ensemble, le nouveau jeton sert ensuite", async () => {
  const c = mk();
  await connect(c);
  const before = g.calls.token.length;
  for (let i = 0; i < 3; i++) assert.equal((await c.methods.request(chatReq())).ok, true);
  assert.equal(g.calls.token.length, before, "jeton valable : pas de rafraîchissement");
  const first = g.access;
  O.LIMITS.accessSkewMs = 2 * 3_600_000;   // le jeton « expire bientôt »
  const results = await Promise.all(Array.from({ length: 20 }, () => c.methods.request(chatReq())));
  assert.ok(results.every((r) => r.ok));
  assert.equal(g.calls.token.length, before + 1, "vingt lectures simultanées = un seul rafraîchissement");
  assert.equal(g.calls.token.at(-1).form.grant_type, "refresh_token");
  assert.notEqual(g.access, first);
  assert.equal(g.calls.chatList.at(-1).headers.authorization, `Bearer ${g.access}`);
  assert.equal(def.tasks, undefined);
});

test("accès retiré chez Google (invalid_grant) : les jetons sont effacés, le panneau dit « Reconnectez-le », la lecture retombe sur la clé si elle est là, sinon « Connectez votre compte »", async () => {
  const c = mk();
  await connect(c);
  g.revokedAtGoogle = true; O.LIMITS.accessSkewMs = 2 * 3_600_000;
  const r = await c.methods.request(chatReq());
  assert.equal(r.ok, true); assert.equal(g.calls.chatList.at(-1).headers["x-goog-api-key"], API_KEY, "retombée sur la clé");
  assert.equal(collection(c, "oauth-tokens").length, 0);
  assert.equal((await c.methods.status()).oauth.state, "none");
  assert.match(flat(await def.adminPanel(c.ctx)), /Google a retiré l'accès au compte/);
  // Sans clé : plus rien à essayer.
  const k = makeConnector({ apiKey: null, settings: { oauthClientId: CLIENT_ID, oauthClientSecret: CLIENT_SECRET } });
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  await connect(k);
  g.revokedAtGoogle = true; O.LIMITS.accessSkewMs = 2 * 3_600_000;
  const none = await k.methods.request(chatReq());
  assert.deepEqual([none.ok, none.error], [false, "chat_denied"]);
  assert.deepEqual((await k.methods.status()).chat, { read: false, write: false }, "le statut dit de connecter le compte");
});

test("panne de Google au rafraîchissement (503, trou noir) : les jetons sont GARDÉS, la lecture retombe sur la clé, une pause d'une minute évite d'insister, puis ça repart", async () => {
  const c = mk();
  await connect(c);
  O.LIMITS.accessSkewMs = 2 * 3_600_000; O.LIMITS.timeoutMs = 300;
  g.next.token = { status: 503, text: "" };
  const calls = () => g.calls.token.length;
  const a = await c.methods.request(chatReq());
  assert.equal(a.ok, true); assert.equal(g.calls.chatList.at(-1).headers["x-goog-api-key"], API_KEY);
  assert.equal(collection(c, "oauth-tokens").length, 1, "les jetons restent");
  const n = calls();
  await c.methods.request(chatReq());
  assert.equal(calls(), n, "pause d'une minute : pas de nouvel essai");
  tick(61_000);
  g.next.token = netReplies.silence();
  const t0 = Date.now();
  const hole = await c.methods.request(chatReq());
  assert.equal(hole.ok, true, "trou noir : la lecture retombe sur la clé, sans attendre sans fin");
  assert.equal(collection(c, "oauth-tokens").length, 1);
  tick(61_000);
  const back = await c.methods.request(chatReq());
  assert.equal(back.ok, true);
  assert.equal(g.calls.chatList.at(-1).headers.authorization, `Bearer ${g.access}`, "Google répond de nouveau : le jeton sert");
  assert.ok(t0 > 0);
});

test("« Déconnecter » : les jetons sont effacés ICI avant même d'appeler Google, Google est prévenu (corps du message, jamais l'adresse), et si Google ne répond pas on le dit sans rien garder", async () => {
  const c = mk({ chatReply: true });
  await connect(c);
  const refresh = g.refresh;
  let kept = null;
  g.next.revoke = () => { kept = collection(c, "oauth-tokens").length; return { status: 200, text: "" }; };
  const r = await run(c, "accountDisconnect");
  assert.deepEqual(r, { ok: fr.disconnect_done, redirect: "?" });
  assert.equal(kept, 0, "déjà effacés quand Google est prévenu");
  assert.equal(g.calls.revoke.length, 1);
  assert.equal(g.calls.revoke[0].form.token, refresh); assert.equal(g.calls.revoke[0].method, "POST");
  const st = await c.methods.status();
  assert.deepEqual([st.oauth.state, st.chat.write], ["none", false]);
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "x" })).error, "chat_denied");
  // Google injoignable : déconnecté ici quand même.
  const d = mk({ chatReply: true });
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  await connect(d);
  g.next.revoke = netReplies.down();
  const down = await run(d, "accountDisconnect");
  assert.equal(down.ok, fr.disconnect_local);
  assert.equal(collection(d, "oauth-tokens").length, 0);
  assert.match(plain(await def.adminPanel(d.ctx)), /Compte déconnecté ici, mais Google n'a pas répondu/, "le message du cœur est perdu à la redirection : l'écran garde la trace");
  // Trou noir : borné.
  const h = mk();
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  await connect(h);
  O.LIMITS.timeoutMs = 200; g.next.revoke = netReplies.silence();
  const hole = await run(h, "accountDisconnect");
  assert.equal(hole.ok, fr.disconnect_local);
  assert.equal(collection(h, "oauth-tokens").length, 0);
});

test("suppression de l'instance : l'accès est retiré chez Google aussi (au mieux), sans jamais lever d'erreur", async () => {
  const c = mk();
  await connect(c);
  await def.hooks.onInstanceDelete(c.ctx);
  assert.equal(g.calls.revoke.length, 1);
  assert.equal(collection(c, "oauth-tokens").length, 0);
  const empty = mk();
  await def.hooks.onInstanceDelete(empty.ctx);
  const broken = mk();
  broken.ctx.api.store.list = async () => { throw new Error("base illisible"); };
  await def.hooks.onInstanceDelete(broken.ctx);
});

/* ───────────── Les erreurs de Google ───────────── */

test("demande de code refusée ou en panne : une phrase simple par cas, rien de gardé, aucune attente sans fin", async () => {
  O.LIMITS.timeoutMs = 250;
  const cases = [
    [{ status: 401, json: { error: "invalid_client" } }, "err_client"],
    [{ status: 403, json: { error_code: "rate_limit_exceeded" } }, "err_rate"],
    [{ status: 400, json: { error: "invalid_scope" } }, "err_scope"],
    [{ status: 400, json: { error: "org_internal" } }, "err_policy"],
    [{ status: 503, text: "" }, "err_network"],
    [{ status: 200, json: { device_code: "x" } }, "err_google"],
    [{ status: 200, text: "<html>pas du JSON</html>" }, "err_google"],
    [netReplies.silence(), "err_timeout"],
    [netReplies.down(), "err_network"],
  ];
  for (const [reply, key] of cases) {
    api.resetState();
    const c = mk();
    tick(3_700_000);
    g.next.device = reply;
    const r = await run(c, "accountConnect");
    assert.equal(r.error, fr[key], key);
    assert.equal(collection(c, "oauth-pending").length, 0, key);
    assert.equal(collection(c, "oauth-tokens").length, 0, key);
  }
});

test("pendant l'attente : refus (access_denied), code expiré, règle de l'organisation, ralentir (slow_down) : chaque issue a sa phrase ; « ralentir » espace les essais", async () => {
  for (const [decision, key, last] of [["denied", "err_denied", /refusé l'autorisation/], ["expired", "err_expired", /Le code a expiré/], ["policy", "err_policy", /règle de son organisation/]]) {
    api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
    const c = mk();
    await run(c, "accountConnect"); g.decision = decision; tick(6000);
    const r = await run(c, "accountCheck");
    assert.equal(r.error, fr[key], decision);
    assert.equal(collection(c, "oauth-pending").length, 0); assert.equal(collection(c, "oauth-tokens").length, 0);
    assert.match(flat(await def.adminPanel(c.ctx)), last, decision);
  }
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const c = mk();
  await run(c, "accountConnect"); g.decision = "slow"; tick(6000);
  const slow = await run(c, "accountCheck");
  assert.match(slow.ok, /dans 10 secondes/, "5 s annoncées + 5 s de plus");
  tick(5000);
  const n = g.calls.token.length;
  assert.match((await run(c, "accountCheck")).ok, /pas encore reçu/);
  assert.equal(g.calls.token.length, n, "pas d'appel avant la fin du délai allongé");
});

test("Google refuse l'ID client à l'étape des jetons (mauvais type de client) : phrase claire, code en attente effacé", async () => {
  const c = mk();
  await run(c, "accountConnect"); tick(6000);
  g.next.token = { status: 401, json: { error: "invalid_client" } };
  const r = await run(c, "accountCheck");
  assert.equal(r.error, fr.err_client);
  assert.equal(collection(c, "oauth-pending").length, 0);
  assert.match(flat(await def.adminPanel(c.ctx)), /Google refuse l'ID client ou le code secret/);
});

test("portée décochée sur l'écran de Google : rien n'est connecté et l'accès est rendu à Google ; écriture refusée à l'écran : connecté en lecture seule, avec l'explication", async () => {
  const c = mk();
  const r = await connect(c, { grant: [] });
  assert.equal(r.error, fr.err_scope);
  assert.equal(collection(c, "oauth-tokens").length, 0);
  assert.equal(g.calls.revoke.length, 1, "les jetons reçus sont rendus aussitôt");
  assert.match(flat(await def.adminPanel(c.ctx)), /décoché l'autorisation/);
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const w = mk({ chatReply: true });
  const ok = await connect(w, { grant: [SCOPE_READ] });
  assert.ok(ok.ok && /sans|connecté/.test(ok.ok));
  const st = await api.status(w.ctx);
  assert.deepEqual(st.chat, { read: true, write: false });
  const panel = flat(await def.adminPanel(w.ctx));
  assert.match(panel, /l'autorisation d'écrire n'a pas encore été donnée/);
  assert.equal((await w.methods.chatPost({ liveChatId: CHAT, text: "x" })).error, "chat_denied");
  assert.equal(g.calls.chatInsert.length, 0, "sans la portée, rien ne part vers YouTube");
});

/* ───────────── Lire le chat : le jeton, jamais la clé ───────────── */

test("lecture du chat avec le compte connecté : en-tête d'autorisation, JAMAIS la clé (ni dans l'adresse, ni dans l'en-tête) ; les autres lectures gardent la clé ; 5 unités comptées", async () => {
  const c = mk();
  await connect(c);
  const used = (await c.methods.status()).quota.used;
  const r = await c.methods.request(chatReq());
  assert.deepEqual([r.ok, r.cost], [true, 5]);
  const call = g.calls.chatList.at(-1);
  assert.equal(call.headers.authorization, `Bearer ${g.access}`);
  assert.equal(call.headers["x-goog-api-key"], undefined);
  assert.ok(!/key=|ya29|access_token/.test(call.url));
  assert.equal((await c.methods.status()).quota.used, used + 5);
  await c.methods.request({ endpoint: "channels.list", params: { part: "snippet", id: "UC" + "a".repeat(22) } });   // le faux Google ne connaît pas cette route : seuls les en-têtes comptent
  const last = g.calls.all.at(-1);
  assert.equal(last.headers["x-goog-api-key"], API_KEY); assert.equal(last.headers.authorization, undefined, "le jeton ne sert qu'au chat");
});

test("jeton refusé par YouTube (401) : renouvelé et réessayé UNE fois ; encore refusé ou 403 : « Connectez votre compte », pause de 10 minutes, reconnecter la lève aussitôt", async () => {
  const c = mk();
  await connect(c);
  g.next.chatList = (() => ({ status: 401, json: { error: { code: 401, message: "Invalid Credentials", errors: [{ reason: "authError" }] } } }));
  const tokens = g.calls.token.length;
  const ok = await c.methods.request(chatReq());
  assert.equal(ok.ok, true, "réessayé avec un jeton neuf");
  assert.equal(g.calls.token.length, tokens + 1);
  const forbid = () => ({ status: 403, json: { error: { code: 403, message: "no", errors: [{ reason: "forbidden" }] } } });
  g.next.chatList = forbid;
  const denied = await c.methods.request(chatReq());
  assert.equal(denied.error, "chat_denied"); assert.ok(denied.retryAt > Date.now() + 9 * 60_000);
  const n = g.calls.chatList.length;
  assert.equal((await c.methods.request(chatReq())).error, "chat_denied");
  assert.equal(g.calls.chatList.length, n, "pause : aucun appel");
  assert.equal((await c.methods.status()).chat.read, false);
  tick(11_000);
  await connect(c);   // se reconnecter lève la pause tout de suite
  assert.equal((await c.methods.status()).chat.read, true);
  assert.equal((await c.methods.request(chatReq())).ok, true);
});

test("sans compte connecté : la clé est tentée (YouTube la refuse peut-être : HYPOTHÈSE de la propriétaire, non prouvée par la documentation) ; refus du chat = chat_denied « Connectez votre compte », sans déclarer la clé refusée", async () => {
  g.keyWorksForChat = false;
  const c = mk();
  const r = await c.methods.request(chatReq());
  assert.equal(r.error, "chat_denied");
  const st = await c.methods.status();
  assert.deepEqual([st.key, st.chat.read], ["set", false], "la clé reste bonne pour tout le reste");
  await connect(c);
  assert.equal((await c.methods.request(chatReq())).ok, true, "le compte connecté lit le chat que la clé seule ne pouvait pas lire");
  const open = mk({}, { apiKey: null });
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  assert.equal((await open.methods.request(chatReq())).error, "chat_denied");
  assert.equal(g.calls.all.length, 0, "ni clé ni compte : rien ne part");
});

test("statut du chat : { read, write } selon les portées RÉELLEMENT accordées et le réglage ; jamais de jeton dans le statut", async () => {
  const keyOnly = makeConnector({ apiKey: API_KEY });
  assert.deepEqual((await keyOnly.methods.status()).chat, { read: true, write: false });
  assert.deepEqual((await makeConnector({ apiKey: null }).methods.status()).chat, { read: false, write: false });
  const readOnly = mk({}, { apiKey: null });
  await connect(readOnly);
  assert.deepEqual((await readOnly.methods.status()).chat, { read: true, write: false }, "le compte suffit, même sans clé");
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const off = mk({ chatReply: false });
  await connect(off, { grant: [SCOPE_MANAGE] });
  assert.deepEqual((await off.methods.status()).chat, { read: true, write: false }, "portée donnée mais réglage coupé : pas d'écriture");
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const on = mk({ chatReply: true });
  await connect(on);
  const st = await on.methods.status();
  assert.deepEqual(st.chat, { read: true, write: true });
  assert.ok(!SECRET_RE.test(flat(st)));
});

/* ───────────── Écrire dans le chat ───────────── */

const writer = async (settings = {}) => { const c = mk({ chatReply: true, ...settings }); await connect(c); return c; };

test("écriture : désactivée par défaut — même avec la portée accordée, rien ne part tant que « répondre dans le chat » est coupé ; sans la portée, rien non plus", async () => {
  const off = mk();
  await connect(off, { grant: [SCOPE_MANAGE] });
  const r = await off.methods.chatPost({ liveChatId: CHAT, text: "Bonjour" });
  assert.deepEqual([r.ok, r.error], [false, "write_off"]);
  assert.equal(g.calls.chatInsert.length, 0);
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const notConnected = mk({ chatReply: true });
  assert.equal((await notConnected.methods.chatPost({ liveChatId: CHAT, text: "Bonjour" })).error, "chat_denied");
  assert.equal(g.calls.all.length, 0);
});

test("écriture : un message de 200 caractères au plus, nettoyé, envoyé avec le jeton (jamais la clé), 20 unités comptées, jamais le texte dans la réponse", async () => {
  const c = await writer();
  const used = (await c.methods.status()).quota.used;
  const r = await c.methods.chatPost({ liveChatId: CHAT, text: "  C'est   arrêté\u0000​ pour ce soir \n " });
  assert.deepEqual([r.ok, r.cost], [true, 20]);
  assert.ok(!("text" in r));
  const call = g.calls.chatInsert[0];
  assert.equal(call.method, "POST"); assert.match(call.url, /^https:\/\/www\.googleapis\.com\/youtube\/v3\/liveChat\/messages\?part=snippet$/);
  assert.equal(call.headers.authorization, `Bearer ${g.access}`); assert.equal(call.headers["x-goog-api-key"], undefined);
  assert.deepEqual(call.json, { snippet: { liveChatId: CHAT, type: "textMessageEvent", textMessageDetails: { messageText: "C'est arrêté pour ce soir" } } });
  assert.equal((await c.methods.status()).quota.used, used + 20);
  tick(3100);
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "é".repeat(200) })).ok, true, "200 caractères : permis");
  tick(3100);
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "😀".repeat(200) })).ok, true, "200 caractères comptés comme une personne les compte");
});

test("écriture : refus SANS réseau — texte vide, trop long, identifiant de chat invalide, mauvais types", async () => {
  const c = await writer();
  const n = g.calls.all.length;
  for (const bad of [{}, { liveChatId: CHAT }, { liveChatId: CHAT, text: "" }, { liveChatId: CHAT, text: "   \n " }, { liveChatId: CHAT, text: "x".repeat(201) }, { liveChatId: "", text: "a" }, { liveChatId: "a b", text: "a" }, { liveChatId: CHAT, text: 42 }, { liveChatId: CHAT, text: ["a"] }, { liveChatId: { x: 1 }, text: "a" }, null, undefined]) {
    assert.equal((await c.methods.chatPost(bad)).error, "invalid", JSON.stringify(bad));
  }
  assert.equal(g.calls.all.length, n);
});

test("écriture : limite de débit — 3 secondes entre deux messages, 30 par heure ; le budget du jour est respecté AVANT l'envoi", async () => {
  const c = await writer();
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "un" })).ok, true);
  const quick = await c.methods.chatPost({ liveChatId: CHAT, text: "deux" });
  assert.deepEqual([quick.ok, quick.error], [false, "rate"]); assert.equal(g.calls.chatInsert.length, 1);
  tick(3100);
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "deux" })).ok, true);
  for (let i = 2; i < 30; i++) { tick(3100); assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: `m${i}` })).ok, true, `message ${i + 1}`); }
  tick(3100);
  const cap = await c.methods.chatPost({ liveChatId: CHAT, text: "trente et un" });
  assert.deepEqual([cap.ok, cap.error], [false, "rate"]);
  assert.equal(g.calls.chatInsert.length, 30);
  // Budget : 100 unités par jour, 11 gardées → 4 messages de 20 unités (80), le cinquième est refusé avant de partir.
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const b = await writer({ dailyBudget: 100 });
  const base = (await b.methods.status()).quota.used;
  let sent = 0, refused;
  for (let i = 0; i < 6; i++) { tick(3100); const r = await b.methods.chatPost({ liveChatId: CHAT, text: `b${i}` }); if (r.ok) sent++; else { refused = r; break; } }
  assert.equal(sent, 4); assert.deepEqual([refused.error, refused.budget], ["quota", true]);
  assert.equal(g.calls.chatInsert.length, 4);
  assert.equal((await b.methods.status()).quota.used, base + 80);
});

test("écriture refusée par YouTube : droit manquant (403) = « Connectez votre compte » et pause de 10 minutes sans appel ; chat fini, chat fermé, limite du jour, panne, trou noir : chacun son code, jamais d'attente sans fin", async () => {
  const c = await writer();
  g.next.chatInsert = { status: 403, json: { error: { code: 403, message: "x", errors: [{ reason: "insufficientPermissions" }] } } };
  const denied = await c.methods.chatPost({ liveChatId: CHAT, text: "a" });
  assert.deepEqual([denied.error, denied.retryAt > Date.now() + 9 * 60_000], ["chat_denied", true]);
  tick(3100);
  const n = g.calls.chatInsert.length;
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "b" })).error, "chat_denied");
  assert.equal(g.calls.chatInsert.length, n, "pause de 10 minutes");
  assert.equal((await c.methods.status()).chat.write, false, "le statut le dit");
  assert.equal((await c.methods.status()).chat.read, true, "lire n'est pas touché");
  tick(10 * 60_000 + 1000);
  assert.equal((await c.methods.chatPost({ liveChatId: CHAT, text: "c" })).ok, true);
  const odd = [
    [{ status: 404, json: { error: { code: 404, errors: [{ reason: "liveChatNotFound" }] } } }, "chat_ended"],
    [{ status: 403, json: { error: { code: 403, errors: [{ reason: "liveChatDisabled" }] } } }, "chat_disabled"],
    [{ status: 403, json: { error: { code: 403, errors: [{ reason: "rateLimitExceeded" }] } } }, "rate"],
    [{ status: 400, json: { error: { code: 400, errors: [{ reason: "messageTextInvalid" }] } } }, "invalid"],
    [{ status: 503, text: "" }, "network"],
    [netReplies.silence(), "timeout"],
    [netReplies.down(), "network"],
    [netReplies.quotaExceeded(), "quota"],
  ];
  O.LIMITS.timeoutMs = 250; api.LIMITS.timeoutMs = 250;
  for (const [reply, code] of odd) {
    api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch; tick(3_700_000);
    const w = await writer();
    g.next.chatInsert = reply;
    const r = await w.methods.chatPost({ liveChatId: CHAT, text: "z" });
    assert.equal(r.error, code, code);
    assert.ok(!("text" in r));
  }
});

test("le service ne propose qu'UN nouvel appel d'écriture (chatPost) : rien d'autre ne sait écrire chez YouTube — et le chat lu reste en lecture seule", () => {
  assert.deepEqual(Object.keys(def.services["youtube.api"]).sort(), ["adopt", "channels", "chatPost", "request", "status"]);
  assert.equal(api.normalize("liveChatMessages.insert", { liveChatId: CHAT }), null, "la liste fermée de « request » ne contient pas l'écriture");
  assert.equal(api.CHAT_POST_COST, 20, "barème publié par YouTube (liveChatMessages.insert : 20 unités)");
  assert.equal(api.CHAT_POST_MAX, 200);
  const posts = (src["api.mjs"].match(/method: "POST"/g) ?? []).length;
  assert.equal(posts, 1, "un seul endroit écrit chez YouTube");
});

/* ───────────── Le panneau ───────────── */

test("panneau, première fois : une mise en route en 4 étapes avec les liens de la console Google et les mots à chercher ; aucun bouton de connexion tant que l'ID et le code secret ne sont pas là", async () => {
  const c = makeConnector({ apiKey: API_KEY });
  const blocks = await def.adminPanel(c.ctx);
  const text = plain(blocks);
  for (const needle of ["Compte YouTube (facultatif)", "Mise en route, une seule fois", "console.cloud.google.com/auth/clients", "console.cloud.google.com/auth/overview", "youtube.googleapis.com", "Téléviseurs et périphériques à entrée limitée", "Publier l'application", "ID client Google", "Code secret du client Google"]) assert.ok(text.includes(needle), needle);
  assert.equal(blocks.filter((b) => b.type === "adminForm").length, 0);
  const steps = blocks.find((b) => b.type === "html" && /<ol/.test(b.html)).html;
  assert.equal((steps.match(/<li/g) ?? []).length, 4, "quatre étapes");
  assert.match(steps, /<a href="https:\/\/console\.cloud\.google\.com\/[^"]+" target="_blank" rel="noopener noreferrer"[^>]*>/);
  // En anglais aussi.
  const e = makeConnector({ apiKey: API_KEY, locale: "en" });
  const en4 = plain(await def.adminPanel(e.ctx));
  assert.ok(en4.includes("TVs and Limited Input devices") && en4.includes("Getting started, once"));
  // Un ID mal collé est signalé sous les étapes.
  const bad = mk({ oauthClientId: "abc", oauthClientSecret: "12" });
  const warn = plain(await def.adminPanel(bad.ctx));
  assert.ok(warn.includes("L'ID client ne ressemble pas") && warn.includes("Le code secret du client semble incomplet"));
});

test("panneau, états : prêt (bouton « Connecter », étapes repliées), en attente (code, lien, carré à scanner, deux boutons), connecté (Déconnecter), jamais le code secret ni l'ID dans une réponse", async () => {
  const c = mk();
  let blocks = await def.adminPanel(c.ctx);
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm").map((b) => [b.action, b.submitLabel]), [["accountConnect", fr.btn_connect]]);
  assert.match(blocks.find((b) => b.type === "html" && /<details>/.test(b.html)).html, /Revoir les 4 étapes/);
  await run(c, "accountConnect");
  blocks = await def.adminPanel(c.ctx);
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm").map((b) => b.action), ["accountCheck", "accountCancel"]);
  const pend = blocks.find((b) => b.type === "html" && /ABCD-EFGH/.test(b.html)).html;
  assert.match(pend, /role="img" aria-label="[^"]+"/, "texte alternatif du carré"); assert.match(pend, /<svg|ABCD/);
  assert.match(pend, /href="https:\/\/www\.google\.com\/device" target="_blank" rel="noopener noreferrer"/);
  assert.match(pend, /min-height:44px/, "cible tactile d'au moins 44 px");
  assert.match(pend, /valable encore \d+ min/);
  await connect(c);
  blocks = await def.adminPanel(c.ctx);
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm").map((b) => b.action), ["accountDisconnect"]);
  assert.ok(!flat(blocks).includes(CLIENT_SECRET) && !flat(blocks).includes(CLIENT_ID), "ni le code secret ni l'ID client ne sont réaffichés par le panneau");
  for (const b of blocks.filter((x) => x.type === "adminForm")) assert.ok(def.adminActions[b.action], `action ${b.action} déclarée`);
});

test("panneau, 'répondre dans le chat' activé après une connexion en lecture seule : l'écran dit quoi faire et propose de reconnecter ; coupé alors que l'autorisation reste donnée : il le dit aussi", async () => {
  const c = mk();
  await connect(c);
  const on = { ...c.ctx, setting: (k) => (k === "chatReply" ? true : c.ctx.setting(k)) };
  const blocks = await def.adminPanel(on);
  assert.match(plain(blocks), /l'autorisation d'écrire n'a pas encore été donnée/);
  assert.deepEqual(blocks.filter((b) => b.type === "adminForm").map((b) => b.action), ["accountConnect", "accountDisconnect"]);
  tick(11_000);
  assert.equal((await run({ ...c, ctx: on }, "accountConnect")).ok, fr.connect_started);
  assert.equal(g.calls.device.at(-1).form.scope, SCOPE_MANAGE, "reconnexion avec la portée d'écriture");
  api.resetState(); g = fakeGoogle(); globalThis.fetch = g.fetch;
  const w = mk({ chatReply: true });
  await connect(w);
  const off = { ...w.ctx, setting: (k) => (k === "chatReply" ? false : w.ctx.setting(k)) };
  assert.match(plain(await def.adminPanel(off)), /« répondre dans le chat » est coupé/);
});

test("le panneau s'ouvre sans AUCUN appel à Google, dans tous les états", async () => {
  const c = mk();
  const n0 = g.calls.all.length;
  await def.adminPanel(c.ctx);
  await run(c, "accountConnect");
  const n1 = g.calls.all.length;
  await def.adminPanel(c.ctx); await def.adminPanel(c.ctx);
  assert.equal(g.calls.all.length, n1);
  assert.equal(n0, 0);
});

test("réseau : toute demande part vers l'un des DEUX hôtes de Google (oauth2.googleapis.com, www.googleapis.com), jamais ailleurs, et toujours en HTTPS", async () => {
  const c = await writer();
  await c.methods.request(chatReq());
  await c.methods.chatPost({ liveChatId: CHAT, text: "ok" });
  await run(c, "accountDisconnect");
  const hosts = new Set(g.calls.all.map((x) => new URL(x.url).host));
  assert.deepEqual([...hosts].sort(), ["oauth2.googleapis.com", "www.googleapis.com"]);
  assert.ok(g.calls.all.every((x) => x.url.startsWith("https://")));
  assert.ok(g.calls.all.every((x) => !new URL(x.url).search.includes("token")));
});

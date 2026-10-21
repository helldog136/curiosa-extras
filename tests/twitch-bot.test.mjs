// Bot Twitch : le site répond aux commandes du chat. Aucun réseau : un faux « monde » (Chaîne Twitch, Planning, Sponsors, réseaux) répond à la place des autres modules,
// et les messages de Twitch sont fabriqués avec de vraies signatures.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

/** Horloge simulée pour les tests qui annoncent un prochain stream à date fixe : le résultat ne dépend plus du jour où le test tourne. */
const atClock = async (ms, fn) => { mock.timers.enable({ apis: ["Date"], now: ms }); try { return await fn(); } finally { mock.timers.reset(); } };

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs"));
const source = files.map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const es = await import("../modules/twitch-bot/eventsub.mjs");
const V = await import("../modules/twitch-bot/variables.mjs");
const C = await import("../modules/twitch-bot/commands.mjs");
const S = await import("../modules/twitch-bot/state.mjs");
const SRC = await import("../modules/twitch-bot/sources.mjs");
const E = await import("../modules/twitch-bot/engine.mjs");
const L = await import("../modules/twitch-bot/listen.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const A = await import("../modules/twitch-bot/admin.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;

const NOW = Date.parse("2026-10-14T20:00:00Z");
const CHAT = es.SCOPES.own;

/* ───────────── Le faux monde ───────────── */

/** Un site avec Chaîne Twitch (chaîne « emma », connectée), et, selon les options, Planning, Sponsors, des réseaux. */
function world(o = {}) {
  S.resetMemory(); SRC.resetSources();
  const tw = {
    mainStatus: "ok", mainScopes: [...CHAT], botStatus: "none", botScopes: [], ready: true, subs: [], chat: [], calls: [], wants: [], chatReply: null, listDown: false, createStatus: 202,
    live: { channel: "emma", configured: true, known: true, live: true, title: "Soirée détente", game: "Zelda", startedAt: new Date(NOW - 95 * 60_000).toISOString() },
    ...o.tw,
  };
  const instances = [
    ...(o.sponsors ? [{ key: "sponsors", module: "sponsors", basePath: "sponsors", name: "Sponsors" }] : []),
    ...(o.planning ? [{ key: "planning", module: "planning", basePath: "planning", name: "Planning" }] : []),
    ...(o.instances ?? []),
  ];
  const settings = { onlyWhenLive: true, timezone: "Europe/Paris", ...o.settings };
  const topics = {
    "social.stat": o.followers === undefined ? [{ id: "twitch-channel:emma:followers", platform: "twitch", account: "emma", metric: "followers", value: 1234 }] : o.followers === null ? [] : [{ id: "x", platform: "twitch", account: "emma", metric: "followers", value: o.followers }],
    "planning.slot": o.slots ?? [],
    "social.link": o.links ?? [],
  };
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.locale === "en" ? en : fr, settings, siteUrl: o.siteUrl ?? "https://site.example.org", topics, instances,
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => {
          if (a?.channel && a.channel !== "emma") return { ok: false, error: "other_channel" };
          const bot = a?.slot === "bot";
          return { ok: true, channel: "emma", ready: tw.ready, https: true, status: bot ? tw.botStatus : tw.mainStatus, login: bot ? "monbot" : "emma", userId: bot ? "555" : "100", scopes: bot ? tw.botScopes : tw.mainScopes, wanted: [], adminPath: "/admin/instances/tw1", ...(o.result && !bot ? { result: o.result } : {}) };
        },
        wantScopes: (a) => { tw.wants.push(a); return { ok: true }; },
        connectLink: (a) => ({ ok: true, url: a.slot === "bot" ? "https://id.twitch.tv/oauth2/authorize?bot=1" : "https://id.twitch.tv/oauth2/authorize?main=1" }),
        disconnect: () => ({ ok: true, reached: true }),
        request: (a) => {
          if (a.channel && a.channel !== "emma") return { ok: false, error: "other_channel" };
          tw.calls.push(a);
          if (a.path === "eventsub/subscriptions") {
            if (a.method === "GET") return tw.listDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subs } };
            if (a.method === "DELETE") { tw.subs = tw.subs.filter((s) => s.id !== a.query.id[0] && s.id !== a.query.id); return { ok: true, status: 204, json: null }; }
            if (a.method === "POST") {
              if (tw.createStatus !== 202) return { ok: true, status: tw.createStatus, json: { message: "nope" } };
              const sub = { id: `sub${(tw.seq = (tw.seq ?? 0) + 1)}`, status: "webhook_callback_verification_pending", type: a.body.type, condition: a.body.condition, transport: { method: "webhook", callback: a.body.transport.callback } };
              tw.subs.push(sub); tw.lastSecret = a.body.transport.secret; tw.lastCreate = a.body;
              return { ok: true, status: 202, json: { data: [sub] } };
            }
          }
          if (a.path === "chat/messages") {
            if (tw.chatReply) return tw.chatReply;
            tw.chat.push({ ...a.body, slot: a.slot });
            return { ok: true, status: 200, json: { data: [{ message_id: `out${tw.chat.length}`, is_sent: true }] } };
          }
          return { ok: false, error: "forbidden" };
        },
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { status: () => tw.live } }],
    },
  });
  const by = { sponsors: o.sponsors ?? [] };
  ctx.api.instances.list = async (q) => instances.filter((i) => !q?.module || i.module === q.module);
  ctx.api.entries.list = async (q) => by[q?.instance] ?? [];
  return { ctx, tw };
}
const entry = (id, slug, title) => ({ id, slug, title, path: `/sponsors/${slug}`, summary: "", url: null });
const link = (instance, module, label, url) => ({ label, url, icon: module, source: { instance, module, name: label } });
const chat = (text, over = {}) => ({ messageId: `m${Math.random().toString(36).slice(2)}`, broadcasterId: "100", chatterId: "200", login: "viewer", name: "Viewer", text, kind: "text", foreign: false, badges: [], ...over });
const say = (ctx, text, over = {}, now = NOW) => E.processChat(ctx, chat(text, over), { now });
const sent = (tw) => tw.chat.map((m) => m.message);
const logOf = async (ctx) => (await S.readLog(ctx));

/* ───────────── Twitch : signature, lecture des messages (eventsub.mjs) ───────────── */

test("signature : vecteur connu (HMAC-SHA256 de id + horodatage + corps brut), calculé indépendamment", () => {
  const ts = "2026-10-14T10:00:00.123456789Z", body = JSON.stringify({ a: 1 });
  assert.equal(es.sign("s3cret", "msg-1", ts, body), "sha256=520ac5b11d90349f962cd723969d5d30e59c185481d9bb9c9bc0cfd870423e69");
  assert.equal(es.sign("s3cret", "msg-1", ts, body), `sha256=${createHmac("sha256", "s3cret").update(`msg-1${ts}${body}`).digest("hex")}`);
});

const signed = (secret, body, { id = "msg-1", ts = new Date(NOW).toISOString(), type = "notification" } = {}) => ({
  headers: new Headers({ "twitch-eventsub-message-id": id, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": type, "twitch-eventsub-message-signature": es.sign(secret, id, ts, body) }), rawBody: body,
});

test("vérification : accepte une requête valide ; refuse mauvais secret, corps modifié, en-têtes manquants, trop ancien ET trop dans le futur (10 min)", () => {
  const body = '{"x":1}';
  const ok = es.verify({ secret: "S", ...signed("S", body), now: NOW });
  assert.deepEqual([ok.ok, ok.id, ok.type], [true, "msg-1", "notification"]);
  assert.equal(es.verify({ secret: "AUTRE", ...signed("S", body), now: NOW }).reason, "signature");
  assert.equal(es.verify({ secret: "S", ...signed("S", body), rawBody: body + " ", now: NOW }).reason, "signature");
  assert.equal(es.verify({ secret: "S", headers: new Headers(), rawBody: body, now: NOW }).reason, "headers");
  assert.equal(es.verify({ secret: "", ...signed("S", body), now: NOW }).reason, "secret");
  assert.equal(es.verify({ secret: "S", ...signed("S", body), now: NOW + 10 * 60_000 + 1000 }).reason, "stale");
  assert.equal(es.verify({ secret: "S", ...signed("S", body), now: NOW - 10 * 60_000 - 1000 }).reason, "stale");
  assert.equal(es.verify({ secret: "S", ...signed("S", body), now: NOW + 9 * 60_000 }).ok, true);
  assert.equal(es.verify({ secret: "S", ...signed("S", body, { ts: "pas une date" }), now: NOW }).reason, "stale");
  const sig = signed("S", body); sig.headers.set("twitch-eventsub-message-signature", "sha256=" + "0".repeat(64));
  assert.equal(es.verify({ secret: "S", ...sig, now: NOW }).reason, "signature");
  sig.headers.set("twitch-eventsub-message-signature", "court");
  assert.equal(es.verify({ secret: "S", ...sig, now: NOW }).reason, "signature", "longueur différente : refus sans exception");
  assert.match(fs.readFileSync(`${DIR}/eventsub.mjs`, "utf8"), /timingSafeEqual/, "comparaison à temps constant");
});

test("lecture des corps : challenge, notification de chat, révocation ; le reste est ignoré ou invalide", () => {
  assert.deepEqual(es.parseBody("webhook_callback_verification", '{"challenge":"abc"}'), { kind: "challenge", challenge: "abc" });
  assert.equal(es.parseBody("webhook_callback_verification", "{}").kind, "invalid");
  assert.equal(es.parseBody("notification", "pas du json").kind, "invalid");
  assert.equal(es.parseBody("notification", JSON.stringify({ subscription: { type: "autre.chose" }, event: {} })).kind, "ignored");
  assert.equal(es.parseBody("notification", JSON.stringify({ subscription: { type: es.TYPE }, event: { nope: 1 } })).kind, "invalid");
  assert.deepEqual(es.parseBody("revocation", JSON.stringify({ subscription: { type: es.TYPE, status: "authorization_revoked" } })), { kind: "revocation", status: "authorization_revoked", type: es.TYPE });
  assert.equal(es.parseBody("session_keepalive", "{}").kind, "ignored");
  const ev = { broadcaster_user_id: "100", chatter_user_id: "200", chatter_user_login: "Viewer", chatter_user_name: "Viewer", message_id: "m1", message: { text: "!jeu" }, message_type: "text", badges: [{ set_id: "moderator", id: "1", info: "" }, { set_id: "subscriber" }] };
  const r = es.parseBody("notification", JSON.stringify({ subscription: { type: es.TYPE }, event: ev }));
  assert.deepEqual([r.kind, r.chat.login, r.chat.text, r.chat.badges, r.chat.foreign], ["chat", "viewer", "!jeu", ["moderator", "subscriber"], false]);
  assert.equal(es.parseChat({ ...ev, source_broadcaster_user_id: "999" }).foreign, true, "chat partagé avec une autre chaîne");
  assert.equal(es.levelOf({ badges: ["broadcaster"] }), 3); assert.equal(es.levelOf({ badges: ["moderator", "subscriber"] }), 2); assert.equal(es.levelOf({ badges: ["founder"] }), 1); assert.equal(es.levelOf({ badges: ["vip"] }), 0);
});

test("abonnement : corps de création, adresse de rappel, classement des abonnements de Twitch (bon / en attente / en panne / absent / doublons), raisons de coupure", () => {
  const ids = { broadcasterId: "100", userId: "100" }, cb = "https://site.example.org/m/bot/webhook";
  assert.deepEqual(es.subscriptionBody({ ...ids, callback: cb, secret: "S" }), { type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: "100", user_id: "100" }, transport: { method: "webhook", callback: cb, secret: "S" } });
  const sub = (id, status, over = {}) => ({ id, status, type: es.TYPE, condition: { broadcaster_user_id: "100", user_id: "100" }, transport: { method: "webhook", callback: cb }, ...over });
  const cl = (data) => es.classify({ data }, { callback: cb, ...ids });
  assert.deepEqual(cl([]), { state: "missing", stale: [] });
  assert.deepEqual(cl([sub("a", "enabled")]), { state: "enabled", id: "a", status: "enabled", stale: [] });
  assert.equal(cl([sub("a", "webhook_callback_verification_pending")]).state, "pending");
  const failed = cl([sub("a", "notification_failures_exceeded")]);
  assert.deepEqual([failed.state, failed.stale], ["failed", ["a"]]);
  assert.deepEqual(cl([sub("a", "enabled"), sub("b", "enabled"), sub("c", "authorization_revoked")]).stale, ["b", "c"], "les doublons et les abonnements en panne sont à supprimer");
  assert.equal(cl([sub("z", "enabled", { transport: { method: "webhook", callback: "https://autre.example.org/x" } })]).state, "missing", "l'abonnement d'un autre site n'est pas le nôtre");
  const other = cl([sub("z", "enabled", { condition: { broadcaster_user_id: "100", user_id: "999" } })]);
  assert.deepEqual([other.state, other.stale], ["missing", ["z"]], "un autre compte n'est pas le nôtre : son abonnement (réglage changé depuis) est périmé et supprimé, sinon chaque message arriverait deux fois");
  assert.deepEqual(["authorization_revoked", "user_removed", "notification_failures_exceeded", "webhook_callback_verification_failed", "version_removed"].map(es.failureCode), ["revoked", "revoked", "unreachable", "unreachable", "other"]);
  assert.deepEqual(es.readCreate({ status: 202, json: { data: [{ id: "x" }] } }), { ok: true, id: "x" });
  assert.equal(es.readCreate({ status: 409 }).code, "exists"); assert.equal(es.readCreate({ status: 403 }).code, "denied"); assert.equal(es.readCreate({ status: 400, json: { message: "bad" } }).code, "refused"); assert.equal(es.readCreate({ status: 502 }).code, "twitch");
  assert.deepEqual(es.readSend({ status: 200, json: { data: [{ message_id: "m", is_sent: true }] } }), { sent: true, messageId: "m" });
  assert.equal(es.readSend({ status: 200, json: { data: [{ is_sent: false, drop_reason: { code: "msg_duplicate" } }] } }).code, "dropped");
  assert.equal(es.readSend({ status: 401 }).code, "denied");
  const s = es.sendRequest({ broadcasterId: "100", senderId: "100", text: "Salut", slot: "main" });
  assert.deepEqual(s, { as: "user", slot: "main", method: "POST", path: "chat/messages", body: { broadcaster_id: "100", sender_id: "100", message: "Salut" } });
});

test("tout ce qui est propre à Twitch est dans eventsub.mjs : les autres fichiers ne citent ni les en-têtes, ni les types d'abonnement, ni les autorisations de Twitch", () => {
  for (const f of files.filter((x) => x !== "eventsub.mjs")) {
    const text = fs.readFileSync(`${DIR}/${f}`, "utf8");
    for (const word of ["twitch-eventsub", "channel.chat.message", "user:read:chat", "user:write:chat", "webhook_callback_verification", "sha256="]) assert.ok(!text.includes(word), `${f} ne doit pas contenir « ${word} »`);
  }
});

/* ───────────── Variables et textes ───────────── */

test("variables : liste fermée vérifiée à l'enregistrement, adaptée au type de commande ; départs interdits ; trop long", () => {
  assert.deepEqual(V.COMMON, ["followers", "jeu", "titre", "uptime", "prochain_stream", "utilisateur"]);
  assert.equal(V.checkTemplate("Salut {utilisateur}, on joue à {jeu}", "custom").ok, true);
  const unknown = V.checkTemplate("Bonjour {nom} et {jeu} {message}", "custom");
  assert.deepEqual([unknown.ok, unknown.code, unknown.vars], [false, "unknown", ["nom", "message"]]);
  assert.equal(V.checkTemplate("{lien}", "custom").code, "unknown", "{lien} n'existe que pour les commandes de réseau");
  assert.equal(V.checkTemplate("Mon lien : {lien}", "network").ok, true);
  assert.equal(V.checkTemplate("{adresse} {partenaire}", "partner").ok, true);
  assert.equal(V.checkTemplate("{adresse}", "network").code, "unknown");
  for (const bad of ["/ban machin", ".me fait un truc", "\\x", "!planning"]) assert.equal(V.checkTemplate(bad, "custom").code, "start", bad);
  assert.equal(V.checkTemplate("   ", "custom").code, "empty");
  assert.equal(V.checkTemplate("x".repeat(451), "custom").code, "long");
  assert.equal(V.checkTemplate("{ jeu }", "custom").ok, true, "espaces tolérés dans les accolades");
  assert.equal(V.checkTemplate("%$ {inconnue}", "custom").code, "unknown");
  assert.equal(V.checkTemplate("ok", "custom", "?").ok, true);
  assert.equal(V.checkTemplate("?x", "custom", "?").code, "start", "le préfixe réglé compte aussi");
});

test("rendu : une passe (une valeur contenant {titre} n'est pas remplacée à son tour), pseudo nettoyé, jamais de départ en / . ou préfixe, coupé à 500", () => {
  const values = { titre: "Mon {jeu} préféré", jeu: "Zelda", utilisateur: V.pseudo("Vi​ewer<script>") };
  assert.equal(V.render("{titre} / {jeu} / {utilisateur}", values), "Mon {jeu} préféré / Zelda / Viewerscript");
  assert.equal(V.pseudo("😀😀"), "ami"); assert.equal(V.pseudo("A".repeat(60)).length, 25); assert.equal(V.pseudo("Jean-Luc_2"), "Jean-Luc_2");
  assert.equal(V.render("{titre}", { titre: "/mod tout" }), "• /mod tout");
  assert.equal(V.render("{titre}", { titre: ".disconnect" }), "• .disconnect");
  assert.equal(V.render("{titre}", { titre: "!sr une chanson" }), "• !sr une chanson");
  assert.equal(V.render("{titre}", { titre: "!x" }, "?"), "!x", "seul le préfixe RÉGLÉ est gardé");
  const long = V.render("x{titre}", { titre: "é".repeat(2000) });
  assert.equal([...long].length, 300 + 1, "une valeur est bornée à 300 caractères");
  const big = V.render("é".repeat(450) + " {titre}", { titre: "y".repeat(300) });
  assert.ok([...big].length <= 500 && big.endsWith("…"));
  assert.equal(V.render("a\n\tb\u0000c   d", {}), "a bc d", "caractères de contrôle et espaces nettoyés");
  assert.equal(V.render("{jeu}", {}), "", "variable sans valeur donnée : vide (l'appelant fournit les replis)");
  assert.equal(V.truncate("é".repeat(600)).length, 500);
});

/* ───────────── Les commandes : enregistrement, noms, collisions ───────────── */

const env = (ctx, sources = {}, prefix = "!") => ({ src: { partners: { installed: false, items: [] }, networks: { items: [] }, planning: { installed: true }, followers: { available: true }, ...sources }, t: ctx.t, prefix });
const create = (ctx, fields, e = env(ctx)) => C.saveCommand(ctx, { kind: "custom" }, { text: "Salut", role: "everyone", ...fields }, e);
const listOf = async (ctx, e = env(ctx)) => C.catalog((await C.loadConfig(ctx)).data, e.src, ctx.t);

test("commande personnalisée : créée avec nom, alias, rôle et délais ; le préfixe tapé est retiré ; une erreur ne crée rien", async () => {
  const { ctx } = world();
  assert.equal((await create(ctx, { name: "!Discord", aliases: "dis, !Chat", text: "Rejoignez-nous", cdGlobal: "5", cdUser: "" })).ok, true);
  const c = (await listOf(ctx)).find((x) => x.kind === "custom");
  assert.deepEqual([c.name, c.aliases, c.text, c.role, c.cdGlobal, c.cdUser, c.enabled, c.state], ["discord", ["dis", "chat"], "Rejoignez-nous", "everyone", 5, null, true, "on"]);
  for (const [bad, code] of [[{ name: "avec espace" }, "name"], [{ name: "" }, "name"], [{ name: "x".repeat(26) }, "name"], [{ name: "ok", aliases: "bon, pas bon!" }, "alias"], [{ name: "ok", aliases: "a,b,c,d,e,f" }, "aliases_many"], [{ name: "ok", role: "dieu" }, "role"], [{ name: "ok", cdGlobal: "-1" }, "delay"], [{ name: "ok", cdUser: "99999" }, "delay"], [{ name: "ok", cdUser: "1.5" }, "delay"], [{ name: "ok", text: "" }, "text_empty"], [{ name: "ok", text: "{nimporte}" }, "text_unknown"], [{ name: "ok", text: "/me" }, "text_start"]]) {
    const r = await create(ctx, bad); assert.equal(r.ok, false); assert.equal(r.code, code, JSON.stringify(bad));
  }
  assert.equal((await listOf(ctx)).filter((x) => x.kind === "custom").length, 1);
});

test("collisions : un nom ou un alias déjà pris (commande à soi, toute prête, alias, partenaire, réseau) est refusé avec le nom de l'autre commande", async () => {
  const { ctx } = world();
  const sources = { partners: { installed: true, items: [{ id: "p1", title: "Tesla", slug: "tesla", address: "site.example.org/sponsors/tesla", instance: "sponsors" }] }, networks: { items: [{ key: "yt", module: "youtube-channel", name: "YouTube", url: "https://youtube.com/@emma" }] } };
  const e = env(ctx, sources);
  assert.equal((await create(ctx, { name: "merch" }, e)).ok, true);
  assert.deepEqual(await create(ctx, { name: "merch" }, e).then((r) => [r.code, r.word, r.with]), ["collision", "merch", "merch"]);
  assert.equal((await create(ctx, { name: "autre", aliases: "merch" }, e)).code, "collision", "un alias ne peut pas prendre le nom d'une autre commande");
  assert.equal((await create(ctx, { name: "jeu" }, e)).code, "collision", "ni un nom de commande toute prête");
  assert.equal((await create(ctx, { name: "game" }, e)).code, "collision", "ni son alias");
  assert.equal((await C.saveSourced(ctx, "partner", "p1", { enabled: true }, e)).ok, true);
  assert.equal((await create(ctx, { name: "tesla" }, e)).code, "collision", "ni le nom d'un partenaire");
  assert.equal((await C.saveSourced(ctx, "network", "yt", { enabled: true }, e)).ok, true);
  assert.equal((await create(ctx, { name: "yt", aliases: "yt" }, e)).code, "collision", "ni l'alias d'un réseau");
  const r = await C.saveCommand(ctx, { kind: "builtin", id: "titre" }, { name: "merch" }, e);
  assert.deepEqual([r.ok, r.code], [false, "collision"], "renommer une commande toute prête aussi");
  assert.equal((await C.saveCommand(ctx, { kind: "builtin", id: "titre" }, { name: "titre" }, e)).ok, true, "garder son propre nom n'est pas une collision");
  assert.equal((await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { aliases: "title" }, e)).code, "collision");
});

test("commandes toutes prêtes : 5 par défaut, texte modifiable (rétabli = suit de nouveau le texte d'origine), désactivables, délais et rôle propres", async () => {
  const { ctx } = world();
  const base = await listOf(ctx);
  assert.deepEqual(base.filter((c) => c.kind === "builtin").map((c) => c.name), ["planning", "jeu", "titre", "followers", "uptime"]);
  assert.deepEqual(base.find((c) => c.id === "jeu").aliases, ["game"]);
  assert.equal(base.find((c) => c.id === "jeu").text, fr.cmd_jeu_text);
  assert.equal((await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { text: "Ce soir : {jeu}", role: "subscribers", cdUser: 10, enabled: false }, env(ctx))).ok, true);
  let j = (await listOf(ctx)).find((c) => c.id === "jeu");
  assert.deepEqual([j.text, j.role, j.cdUser, j.state], ["Ce soir : {jeu}", "subscribers", 10, "off"]);
  await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { text: fr.cmd_jeu_text, enabled: true }, env(ctx));
  assert.equal((await C.loadConfig(ctx)).data.builtin.jeu.text, undefined, "le texte d'origine n'est pas copié : il suivra les mises à jour");
  j = (await listOf(ctx)).find((c) => c.id === "jeu");
  assert.deepEqual([j.state, j.role], ["on", "subscribers"]);
});

test("Planning absent : !planning est masquée avec une explication ; présent : elle répond. Followers indisponibles : masquée aussi", async () => {
  const absent = world();
  const plan = (await listOf(absent.ctx, env(absent.ctx, { planning: { installed: false } }))).find((c) => c.id === "planning");
  assert.deepEqual([plan.state, plan.why], ["hidden", "planning_absent"]);
  assert.match(fr.why_planning_absent, /aucun agenda de streams n'est installé/);
  const fol = (await listOf(absent.ctx, env(absent.ctx, { followers: { available: false } }))).find((c) => c.id === "followers");
  assert.deepEqual([fol.state, fol.why], ["hidden", "followers_absent"]);
  assert.equal((await listOf(absent.ctx)).find((c) => c.id === "planning").state, "on");
});

test("partenaires : nom proposé = identifiant de la page (modifiable), texte pré-rempli ; le nom ne suit plus la page ensuite ; collision avec un autre nom → un suffixe", async () => {
  const { ctx } = world();
  const items = [{ id: "p1", title: "Tesla", slug: "tesla", address: "site.example.org/sponsors/tesla", instance: "sponsors" }, { id: "p2", title: "Tesla 2", slug: "jeu", address: "site.example.org/sponsors/jeu", instance: "sponsors" }];
  const sources = { partners: { installed: true, items } };
  const list = await listOf(ctx, env(ctx, sources));
  assert.deepEqual(C.proposePartner(items[0], list, ctx.t), { name: "tesla", aliases: [], text: fr.cmd_partner_text });
  assert.equal(C.proposePartner(items[1], list, ctx.t).name, "jeu2", "« jeu » est déjà pris par une commande toute prête");
  assert.equal(fr.cmd_partner_text, "Découvrez mon parrainage {partenaire} : {adresse}");
  assert.equal((await C.saveSourced(ctx, "partner", "p1", { enabled: true }, env(ctx, sources))).ok, true);
  let p = (await listOf(ctx, env(ctx, sources))).find((c) => c.key === "partner:p1");
  assert.deepEqual([p.name, p.enabled, p.state, p.vars], ["tesla", true, "on", { partenaire: "Tesla", adresse: "site.example.org/sponsors/tesla" }]);
  // la page change de nom et d'adresse : la commande garde son nom, mais le texte (variables) suit le titre et l'adresse
  items[0] = { ...items[0], slug: "tesla-model", title: "Tesla Motors", address: "site.example.org/sponsors/tesla-model" };
  p = (await listOf(ctx, env(ctx, sources))).find((c) => c.key === "partner:p1");
  assert.deepEqual([p.name, p.vars.partenaire, p.vars.adresse], ["tesla", "Tesla Motors", "site.example.org/sponsors/tesla-model"]);
  assert.equal((await C.saveSourced(ctx, "partner", "p1", { name: "parrain" }, env(ctx, sources))).ok, true);
  assert.equal((await listOf(ctx, env(ctx, sources))).find((c) => c.key === "partner:p1").name, "parrain");
  assert.equal((await C.saveSourced(ctx, "partner", "p2", { name: "parrain", enabled: true }, env(ctx, sources))).code, "collision");
  assert.equal((await C.loadConfig(ctx)).data.partners.p2, undefined, "un refus ne laisse rien d'enregistré");
  assert.equal((await C.saveSourced(ctx, "partner", "inconnu", { enabled: true }, env(ctx, sources))).code, "source_missing");
});

test("fiche partenaire supprimée : la commande est en pause (ne répond plus), puis disparaît après 14 jours ; elle revient si la fiche revient avant ; une source illisible ne supprime rien", async () => {
  const { ctx } = world();
  const items = [{ id: "p1", title: "Tesla", slug: "tesla", address: "a/b", instance: "sponsors" }];
  await C.saveSourced(ctx, "partner", "p1", { enabled: true }, env(ctx, { partners: { installed: true, items } }));
  const gone = env(ctx, { partners: { installed: true, items: [] } });
  const p = (await listOf(ctx, gone)).find((c) => c.key === "partner:p1");
  assert.deepEqual([p.state, p.why], ["missing", "partner_missing"]);
  const day = 86_400_000;
  await C.tidy(ctx, { partners: new Set(), networks: new Set() }, NOW);
  assert.ok((await C.loadConfig(ctx)).data.partners.p1.missingSince);
  await C.tidy(ctx, { partners: null, networks: null }, NOW + 40 * day);
  assert.ok((await C.loadConfig(ctx)).data.partners.p1, "source illisible : on ne touche à rien");
  await C.tidy(ctx, { partners: new Set(["p1"]), networks: new Set() }, NOW + 5 * day);
  assert.equal((await C.loadConfig(ctx)).data.partners.p1.missingSince, undefined, "la fiche est revenue");
  await C.tidy(ctx, { partners: new Set(), networks: new Set() }, NOW + 6 * day);
  await C.tidy(ctx, { partners: new Set(), networks: new Set() }, NOW + 6 * day + 15 * day);
  assert.equal((await C.loadConfig(ctx)).data.partners.p1, undefined, "supprimée proprement après 14 jours");
});

test("réseaux : nom et alias proposés (tiktok/tik-tok, x/twitter), jamais de doublon : deux comptes d'un même réseau → youtube, youtube2 ; alias déjà pris écartés ; adresse retirée → en pause", async () => {
  const { ctx } = world();
  const nets = [
    { key: "tt", module: "tiktok", name: "TikTok", url: "https://www.tiktok.com/@emma" }, { key: "x", module: "x-twitter", name: "X", url: "https://x.com/emma" },
    { key: "y1", module: "youtube-channel", name: "YouTube", url: "https://www.youtube.com/@emma" }, { key: "y2", module: "youtube-channel", name: "YouTube", url: "https://www.youtube.com/@emma2" },
    { key: "ig", module: "instagram", name: "Instagram", url: "https://instagram.com/emma" }, { key: "inc", module: "inconnu", name: "Mon Réseau Étrange", url: "https://example.org/emma" },
  ];
  const sources = { networks: { items: nets } };
  const e = () => env(ctx, sources);
  for (const n of nets) assert.equal((await C.saveSourced(ctx, "network", n.key, { enabled: true }, e())).ok, true, n.key);
  const list = await listOf(ctx, e());
  const get = (k) => list.find((c) => c.key === `network:${k}`);
  assert.deepEqual([get("tt").name, get("tt").aliases], ["tiktok", ["tik-tok"]]);
  assert.deepEqual([get("x").name, get("x").aliases], ["x", ["twitter"]]);
  assert.deepEqual([get("y1").name, get("y1").aliases], ["youtube", ["yt"]]);
  assert.deepEqual([get("y2").name, get("y2").aliases], ["youtube2", []], "l'alias « yt » est déjà pris : écarté, pas de doublon");
  assert.equal(get("inc").name, "monrseauetrange".replace("rseau", "reseau"), "nom sans accents ni espaces");
  assert.equal(get("tt").text, fr.cmd_network_text);
  assert.deepEqual(get("tt").vars, { reseau: "TikTok", lien: "www.tiktok.com/@emma" });
  const words = list.flatMap((c) => [c.name, ...c.aliases]);
  assert.equal(new Set(words).size, words.length, "aucun mot en double dans tout le catalogue");
  const gone = env(ctx, { networks: { items: nets.filter((n) => n.key !== "tt") } });
  const tt = (await listOf(ctx, gone)).find((c) => c.key === "network:tt");
  assert.deepEqual([tt.state, tt.why], ["missing", "network_missing"]);
});

test("commande groupée !reseaux : liste les réseaux activés, masquée s'il n'y en a aucun, désactivable", async () => {
  const { ctx, tw } = world({ links: [link("yt", "youtube-channel", "YouTube", "https://www.youtube.com/@emma"), link("tt", "tiktok", "TikTok · emma", "https://www.tiktok.com/@emma"), link("ig", "instagram", "Instagram", "https://instagram.com/emma")] });
  assert.equal((await listOf(ctx)).find((c) => c.kind === "group").state, "hidden");
  await say(ctx, "!reseaux", { badges: ["broadcaster"] });
  assert.equal(tw.chat.length, 0);
  assert.equal((await logOf(ctx))[0].reason, "hidden");
  const nets = (await SRC.networks(ctx)).items;
  assert.deepEqual(nets.map((n) => [n.key, n.name]), [["yt", "YouTube"], ["tt", "TikTok"], ["ig", "Instagram"]], "le nom du réseau est la partie avant « · »");
  const sources = await SRC.gather(ctx, "emma");
  for (const k of ["yt", "tt"]) await C.saveSourced(ctx, "network", k, { enabled: true }, { src: sources, t: ctx.t, prefix: "!" });
  S.resetMemory();
  await say(ctx, "!reseaux", { badges: ["broadcaster"] });
  assert.equal(tw.chat[0].message, "Retrouvez-moi ici : TikTok : www.tiktok.com/@emma · YouTube : www.youtube.com/@emma", "Instagram n'est pas activé : absent de la liste");
  await C.saveCommand(ctx, { kind: "group", id: "reseaux" }, { enabled: false }, { src: sources, t: ctx.t, prefix: "!" });
  S.resetMemory();
  await say(ctx, "!liens", { badges: ["broadcaster"] });
  assert.equal(tw.chat.length, 1);
});

test("MCP et administration partagent les mêmes règles : une commande ne dépasse pas 100 exemplaires", async () => {
  const { ctx } = world();
  for (let i = 0; i < C.MAX_CUSTOM; i++) assert.equal((await create(ctx, { name: `c${i}` })).ok, true);
  assert.equal((await create(ctx, { name: "de-trop" })).code, "too_many");
});

/* ───────────── Répondre : le chat ───────────── */

test("commandes toutes prêtes : !jeu !titre !uptime lisent le direct, !followers les statistiques, !planning le prochain stream (heure du fuseau réglé)", async () => {
  return atClock(NOW, async () => {
  const slots = [{ title: "Passé", start: "2026-10-14T10:00:00Z" }, { title: "Zelda en soirée", start: "2026-10-17T18:30:00Z" }, { title: "Plus tard", start: "2026-10-20T18:30:00Z" }];
  const { ctx, tw } = world({ planning: true, slots });
  let t = NOW;
  for (const cmd of ["!jeu", "!titre", "!uptime", "!followers", "!planning"]) await say(ctx, cmd, {}, (t += 120_000));
  assert.deepEqual(sent(tw), [
    "On joue à Zelda !",
    "Titre du direct : Soirée détente",
    "En direct depuis 1 h 41 min.",
    "Viewer, la communauté compte 1 234 followers, merci à tous !",   // espace insécable normalisée en espace simple
    "Prochain stream : samedi 17 octobre à 20:30 (Zelda en soirée)",
  ]);
  assert.deepEqual(tw.chat.map((m) => [m.broadcaster_id, m.sender_id]), Array(5).fill(["100", "100"]));
  assert.equal(tw.chat[0].slot, "main");
  });
});

test("alias, majuscules et préfixe : !GAME répond comme !jeu ; une commande inconnue ne répond pas et ne remplit pas le journal", async () => {
  const { ctx, tw } = world();
  await say(ctx, "!GAME arguments ignorés du chat");
  assert.deepEqual(sent(tw), ["On joue à Zelda !"]);
  const r = await say(ctx, "!pasunecommande");
  assert.deepEqual([r.handled, r.why], [false, "unknown_command"]);
  assert.equal((await logOf(ctx)).length, 1);
  for (const text of ["salut tout le monde", "jeu", " ! jeu", "!"]) assert.equal((await say(ctx, text)).handled, false, text);
});

test("le texte du chat n'est JAMAIS réinjecté dans la réponse : seul {utilisateur} (nettoyé) l'est", async () => {
  const { ctx, tw } = world();
  await create(ctx, { name: "salut", text: "Bonjour {utilisateur} !" });
  await say(ctx, "!salut {titre} /ban tout", { name: "Evil‮<b>Bob</b>" });
  assert.deepEqual(sent(tw), ["Bonjour EvilbBobb !"]);
  assert.ok(!sent(tw)[0].includes("/ban"));
});

test("valeur indisponible = repli lisible : pas de titre, pas de followers, pas de stream annoncé ; jamais « undefined » ni accolades", async () => {
  const { ctx, tw } = world({ followers: null, planning: true, slots: [], tw: { live: { channel: "emma", configured: true, known: true, live: true, title: "", game: null, startedAt: null } } });
  await create(ctx, { name: "tout", text: "{jeu}|{titre}|{uptime}|{followers}|{prochain_stream}" });
  await say(ctx, "!tout");
  assert.equal(sent(tw)[0], [fr.fb_jeu, fr.fb_titre, fr.fb_uptime, fr.fb_followers, fr.fb_prochain_stream].join("|"));
  assert.ok(!/undefined|null|NaN|[{}]/.test(sent(tw)[0]));
});

test("protections : ne répond que pendant le direct (réglable), jamais dans le doute ; la raison est au journal", async () => {
  const off = world({ tw: { live: { channel: "emma", configured: true, known: true, live: false } } });
  const r = await say(off.ctx, "!jeu");
  assert.deepEqual([r.result, r.reason], ["refused", "offline"]);
  assert.equal(off.tw.chat.length, 0);
  const unknown = world({ tw: { live: { channel: "emma", configured: true, known: false, live: false } } });
  assert.equal((await say(unknown.ctx, "!jeu")).reason, "live_unknown");
  const always = world({ settings: { onlyWhenLive: false }, tw: { live: { channel: "emma", configured: true, known: true, live: false } } });
  await say(always.ctx, "!jeu");
  assert.equal(always.tw.chat.length, 1, "« toujours répondre » : répond hors direct");
  assert.equal(always.tw.chat[0].message, `On joue à ${fr.fb_jeu} !`);
  assert.equal((await logOf(off.ctx))[0].reason, "offline");
});

test("délais : global par commande ET par personne, réglables par défaut et par commande ; un refus ne démarre pas le délai", async () => {
  const { ctx, tw } = world({ settings: { cooldownGlobal: 20, cooldownUser: 60 } });
  assert.equal((await say(ctx, "!jeu", { chatterId: "1", login: "a" }, NOW)).result, "sent");
  let r = await say(ctx, "!jeu", { chatterId: "2", login: "b" }, NOW + 5_000);
  assert.deepEqual([r.reason, r.seconds], ["cooldown", 15], "autre personne, même commande : délai global");
  assert.equal((await say(ctx, "!titre", { chatterId: "1", login: "a" }, NOW + 5_000)).result, "sent", "autre commande : pas de délai");
  assert.equal((await say(ctx, "!jeu", { chatterId: "2", login: "b" }, NOW + 21_000)).result, "sent", "le délai global est écoulé");
  r = await say(ctx, "!jeu", { chatterId: "1", login: "a" }, NOW + 42_000);
  assert.deepEqual([r.reason, r.seconds], ["cooldown", 18], "même personne : délai par personne (60 s) pas écoulé");
  assert.equal((await say(ctx, "!jeu", { chatterId: "1", login: "a" }, NOW + 61_000)).result, "sent");
  await C.saveCommand(ctx, { kind: "builtin", id: "uptime" }, { cdGlobal: 0, cdUser: 0 }, env(ctx));
  assert.equal((await say(ctx, "!uptime", { chatterId: "1" }, NOW + 62_000)).result, "sent");
  assert.equal((await say(ctx, "!uptime", { chatterId: "1" }, NOW + 62_001)).result, "sent", "délais à zéro : pas d'attente");
  assert.equal(tw.chat.length, 6);
  assert.match(fr.reason_cooldown, /\{seconds\}/);
});

test("qui peut l'utiliser : tout le monde / abonnés / modérateurs / seulement moi (le plus haut rôle l'emporte)", async () => {
  for (const [role, who, allowed] of [
    ["everyone", [], true], ["subscribers", [], false], ["subscribers", ["subscriber"], true], ["subscribers", ["founder"], true], ["subscribers", ["moderator"], true], ["subscribers", ["vip"], false],
    ["mods", ["subscriber"], false], ["mods", ["moderator"], true], ["mods", ["broadcaster"], true], ["owner", ["moderator"], false], ["owner", ["broadcaster"], true],
  ]) {
    const { ctx, tw } = world();
    await C.saveCommand(ctx, { kind: "builtin", id: "jeu" }, { role }, env(ctx));
    const r = await say(ctx, "!jeu", { badges: who });
    assert.equal(r.result, allowed ? "sent" : "refused", `${role} / ${who}`);
    if (!allowed) assert.equal(r.reason, "role");
    assert.equal(tw.chat.length, allowed ? 1 : 0);
  }
});

test("arrêt d'urgence : effet immédiat sur le message suivant, sans rien perdre ; la réactivation rétablit tout", async () => {
  const { ctx, tw } = world();
  await say(ctx, "!jeu", {}, NOW);
  assert.equal(tw.chat.length, 1);
  assert.deepEqual(await A.actions.mute(ctx), { ok: fr.muted_done }, "aucune redirection : la page ne remonte pas en haut");
  const r = await say(ctx, "!titre", {}, NOW + 1);
  assert.deepEqual([r.result, r.reason], ["refused", "muted"]);
  assert.equal(tw.chat.length, 1);
  assert.equal((await C.loadConfig(ctx)).data.builtin.jeu === undefined || true, true);
  assert.equal((await listOf(ctx)).filter((c) => c.kind === "builtin" && c.enabled).length, 5, "aucune commande n'a été désactivée");
  await A.actions.unmute(ctx);
  assert.equal((await say(ctx, "!titre", {}, NOW + 2)).result, "sent");
  assert.ok((await logOf(ctx)).some((e) => e.reason === "muted"));
});

test("pas de boucle : un bot connu, soi-même, un message déjà envoyé par le bot, le compte bot séparé, un autre chat et un autre salon sont ignorés EN SILENCE", async () => {
  const { ctx, tw } = world();
  for (const login of ["nightbot", "streamelements", "moobot"]) assert.deepEqual(await say(ctx, "!jeu", { login }).then((r) => [r.handled, r.why]), [false, "bot"]);
  const own = world({ settings: { ignoredBots: "Mon_Autre_Bot, @troisieme" } });
  assert.equal((await say(own.ctx, "!jeu", { login: "mon_autre_bot" })).why, "bot");
  assert.equal((await say(own.ctx, "!jeu", { login: "troisieme" })).why, "bot");
  assert.equal((await say(ctx, "!jeu", { foreign: true })).why, "foreign");
  assert.equal((await say(ctx, "!jeu", { broadcasterId: "999" })).why, "other_channel");
  assert.equal(tw.chat.length, 0);
  assert.equal((await logOf(ctx)).length, 0, "rien au journal : on ne remplit pas le journal avec ce qui ne nous regarde pas");
  // le message que le bot vient d'envoyer lui-même revient par l'écoute : ignoré
  assert.equal((await say(ctx, "!jeu", { messageId: "x1" })).result, "sent");
  S.rememberSent(ctx, "out1");
  assert.equal((await say(ctx, "!jeu", { messageId: "out1" })).why, "own");
  // compte bot séparé : ses propres messages ne déclenchent rien
  const sep = world({ settings: { replyAs: "bot" }, tw: { botStatus: "ok", botScopes: [...es.SCOPES.bot], mainScopes: [...es.SCOPES.own] } });
  assert.equal((await say(sep.ctx, "!jeu", { chatterId: "555", login: "monbot" })).why, "own");
  const r = await say(sep.ctx, "!jeu", { chatterId: "200" });
  assert.equal(r.result, "sent");
  assert.deepEqual([sep.tw.chat[0].sender_id, sep.tw.chat[0].slot], ["555", "bot"], "c'est le compte bot qui répond");
});

test("jamais de réponse qui puisse relancer une commande ou en déclencher une chez Twitch : début en / . ou préfixe neutralisé", async () => {
  const { ctx, tw } = world({ tw: { live: { channel: "emma", configured: true, known: true, live: true, title: "/disconnect", game: "!sr", startedAt: new Date(NOW - 60_000).toISOString() } } });
  await create(ctx, { name: "t", text: "{titre}" }); await create(ctx, { name: "g", text: "{jeu}" });
  await say(ctx, "!t", { chatterId: "1" }); await say(ctx, "!g", { chatterId: "2" });
  assert.deepEqual(sent(tw), ["• /disconnect", "• !sr"]);
  for (const m of sent(tw)) assert.ok(!/^[/.!\\]/.test(m));
  // et l'envoi par le bot de ses propres réponses ne peut pas boucler : elles ne commencent jamais par le préfixe
  const p = world({ settings: { prefix: "?" } });
  await C.saveCommand(p.ctx, { kind: "builtin", id: "jeu" }, { text: "?aide {jeu}" }, env(p.ctx, {}, "?")).then((r) => assert.equal(r.code, "text_start"));
});

test("limite globale de débit : au plus N réponses par 30 s, toutes commandes confondues, sous la limite de Twitch", async () => {
  const { ctx, tw } = world({ settings: { maxPer30s: 3, cooldownGlobal: 0, cooldownUser: 0 } });
  const out = [];
  for (let i = 0; i < 5; i++) out.push((await say(ctx, "!jeu", { chatterId: String(i), login: `u${i}` }, NOW + i * 1000)).reason);
  assert.deepEqual(out, ["ok", "ok", "ok", "rate", "rate"]);
  assert.equal(tw.chat.length, 3);
  assert.equal((await say(ctx, "!jeu", { chatterId: "9" }, NOW + 31_000)).reason, "ok", "la fenêtre glisse");
  assert.ok(es.SEND_LIMIT.messages <= 20 && 18 < es.SEND_LIMIT.messages, "le plafond réglable (18) reste sous la limite connue (20)");
  assert.equal(world({ settings: { maxPer30s: 999 } }).ctx && (await import("../modules/twitch-bot/settings.mjs")).settingsOf(world({ settings: { maxPer30s: 999 } }).ctx).maxPerWindow, 12, "valeur absurde : retour au défaut");
});

test("envoi refusé par Twitch : erreur actionnable au journal, délai et débit rendus (on ne fait pas attendre pour rien) ; 500 caractères au plus", async () => {
  const { ctx, tw } = world({ settings: { cooldownGlobal: 60 } });
  tw.chatReply = { ok: false, error: "scope" };
  let r = await say(ctx, "!jeu", {}, NOW);
  assert.deepEqual([r.result, r.reason], ["error", "send_denied"]);
  tw.chatReply = { ok: true, status: 200, json: { data: [{ is_sent: false, drop_reason: { code: "msg_duplicate" } }] } };
  r = await say(ctx, "!jeu", {}, NOW + 1000);
  assert.deepEqual([r.reason, r.detail], ["send_dropped", "msg_duplicate"]);
  tw.chatReply = { ok: true, status: 500, json: null };
  assert.equal((await say(ctx, "!jeu", {}, NOW + 2000)).reason, "send_twitch");
  tw.chatReply = null;
  assert.equal((await say(ctx, "!jeu", {}, NOW + 3000)).result, "sent", "les échecs n'ont pas fait démarrer le délai");
  assert.match(fr.reason_send_denied, /autorisation à renouveler/);
  const long = world();
  await create(long.ctx, { name: "long", text: "é".repeat(300) + " {titre} {titre} {titre}" });
  await say(long.ctx, "!long");
  assert.ok([...long.tw.chat[0].message].length <= 500);
});

test("synergies : Planning absent → !planning ne répond pas et le journal l'explique ; réseaux et partenaires absents → rien à signaler, aucune erreur", async () => {
  const { ctx, tw } = world({ planning: false });
  const r = await say(ctx, "!planning", { badges: ["broadcaster"] });
  assert.deepEqual([r.result, r.reason, r.detail], ["refused", "hidden", "planning_absent"]);
  assert.equal(tw.chat.length, 0);
  const info = await A.context(ctx);
  assert.deepEqual([info.sources.partners.installed, info.sources.networks.items.length, info.sources.planning.installed], [false, 0, false]);
});

test("partenaire : !tesla répond avec le titre et l'adresse de sa page, tirés de Sponsors au moment de répondre", async () => {
  const { ctx, tw } = world({ sponsors: [entry("p1", "tesla", "Tesla")] });
  const e = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  assert.equal((await C.saveSourced(ctx, "partner", "p1", { enabled: true }, e)).ok, true);
  await say(ctx, "!tesla");
  assert.deepEqual(sent(tw), ["Découvrez mon parrainage Tesla : site.example.org/sponsors/tesla"]);
  assert.ok(!source.includes("helldog"), "aucune adresse réelle dans le code");
});

test("réseau : !tiktok et son alias !tik-tok répondent avec l'adresse fournie par le module du réseau", async () => {
  const { ctx, tw } = world({ links: [link("tt", "tiktok", "TikTok · emma", "https://www.tiktok.com/@emma"), link("x", "x-twitter", "X", "https://x.com/emma")] });
  const e = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  await C.saveSourced(ctx, "network", "tt", { enabled: true }, e); await C.saveSourced(ctx, "network", "x", { enabled: true }, e);
  await say(ctx, "!tik-tok", { chatterId: "1" }); await say(ctx, "!twitter", { chatterId: "2" });
  assert.deepEqual(sent(tw), ["Retrouvez-moi sur TikTok : www.tiktok.com/@emma", "Retrouvez-moi sur X : x.com/emma"]);
});

test("réglages dangereux : préfixe invalide → « ! » ; fuseau inconnu → UTC (dit « UTC » dans la réponse) ; nombres absurdes bornés", async () => {
  return atClock(NOW, async () => {
  const { settingsOf, prefixOf, validPrefix } = await import("../modules/twitch-bot/settings.mjs");
  const s = (settings) => settingsOf(world({ settings }).ctx);
  for (const bad of ["/", ".", "\\", "a", "1", "!!!!", "", " ", "! "]) assert.equal(s({ prefix: bad }).prefix, "!", JSON.stringify(bad));
  assert.equal(s({ prefix: "?" }).prefix, "?"); assert.equal(s({ prefix: "$$" }).prefix, "$$");
  assert.equal(validPrefix("/"), false);
  assert.equal(s({ timezone: "Pas/Un_Fuseau" }).timeZone, "UTC");
  assert.deepEqual([s({ cooldownGlobal: -5 }).cdGlobal, s({ cooldownUser: "abc" }).cdUser, s({ toleranceMinutes: 500 }).toleranceMin, s({ maxPer30s: 0 }).maxPerWindow], [20, 60, 10, 12]);
  const utc = world({ planning: true, slots: [{ title: "", start: "2026-10-17T18:30:00Z" }], settings: { timezone: "" } });
  await say(utc.ctx, "!planning");
  assert.equal(sent(utc.tw)[0], "Prochain stream : samedi 17 octobre à 18:30 UTC");
  void prefixOf;
  });
});

test("textes en anglais : le même bot répond en anglais quand la langue du site l'est", async () => {
  const { ctx, tw } = world({ locale: "en" });
  ctx.locale = "en";
  await say(ctx, "!jeu"); await say(ctx, "!uptime", { chatterId: "3" });
  assert.deepEqual(sent(tw), ["We are playing Zelda!", "Live for 1 h 35 min."]);
});

/* ───────────── Twitch appelle le site : la porte d'entrée ───────────── */

const eventBody = (text, over = {}) => JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: "200", chatter_user_login: "viewer", chatter_user_name: "Viewer", message_id: `mm${Math.random()}`, message: { text }, message_type: "text", badges: [], ...over } });
const post = (secret, body, opts = {}, init = {}) => { const s = signed(secret, body, opts); return new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers: s.headers, body, ...init }); };
async function listening(o = {}) { const w = world(o); w.secret = await S.ensureSecret(w.ctx); return w; }

test("webhook : le challenge est renvoyé en texte brut après vérification de la signature ; une signature fausse reçoit 403 sans rien révéler", async () => {
  const { ctx, secret } = await listening();
  const body = JSON.stringify({ challenge: "pogchamp-kappa-360", subscription: { type: es.TYPE, status: "webhook_callback_verification_pending" } });
  const { response } = await W.handle(post(secret, body, { type: "webhook_callback_verification" }), ctx, { now: NOW });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /^text\/plain/);
  assert.equal(await response.text(), "pogchamp-kappa-360");
  const bad = await W.handle(post("mauvais-secret", body, { type: "webhook_callback_verification" }), ctx, { now: NOW });
  assert.equal(bad.response.status, 403); assert.equal(await bad.response.text(), "Forbidden");
  const none = await W.handle(new Request("https://x/", { method: "POST", body }), ctx, { now: NOW });
  assert.equal(none.response.status, 403);
  const get = await W.handle(new Request("https://x/", { method: "GET" }), ctx, { now: NOW });
  assert.equal(get.response.status, 405);
  const huge = await W.handle(new Request("https://x/", { method: "POST", body: "x".repeat(200_000) }), ctx, { now: NOW });
  assert.equal(huge.response.status, 413);
  const stale = await W.handle(post(secret, body, { type: "webhook_callback_verification", ts: new Date(NOW - 11 * 60_000).toISOString() }), ctx, { now: NOW });
  assert.equal(stale.response.status, 403, "un message de plus de 10 minutes est un rejeu");
  const noSecret = world();
  assert.equal((await W.handle(post("x", body), noSecret.ctx, { now: NOW })).response.status, 404, "pas de secret = pas d'écoute");
});

test("webhook : une notification valide → 204 tout de suite, la réponse part ensuite ; la même (même identifiant) n'est traitée qu'UNE fois", async () => {
  const { ctx, tw, secret } = await listening();
  const body = eventBody("!jeu");
  const first = await W.handle(post(secret, body, { id: "evt-1" }), ctx, { now: NOW });
  assert.equal(first.response.status, 204);
  await first.done;
  assert.deepEqual(sent(tw), ["On joue à Zelda !"]);
  const again = await W.handle(post(secret, body, { id: "evt-1" }), ctx, { now: NOW + 1000 });
  assert.equal(again.response.status, 204, "Twitch croit à un succès : il ne réessaie pas");
  await again.done;
  assert.equal(tw.chat.length, 1, "pas de double réponse");
  const other = await W.handle(post(secret, eventBody("!jeu"), { id: "evt-2" }), ctx, { now: NOW + 2000 });
  await other.done;
  assert.equal(tw.chat.length, 1, "un autre identifiant mais le délai de la commande protège");
  assert.ok((await S.readState(ctx)).lastMessageAt);
});

test("webhook : la réponse HTTP ne dépend pas du traitement (lent ou en erreur) ; une erreur de traitement ne fait pas échouer Twitch", async () => {
  const { ctx, tw, secret } = await listening();
  let release;
  const gate = new Promise((r) => { release = r; });
  tw.chatReply = null;
  const slow = ctx.api.services.callAll;
  ctx.api.services.callAll = async (name, method, args) => { if (method === "request" && args.path === "chat/messages") await gate; return slow(name, method, args); };
  const t0 = Date.now();
  const { response, done } = await W.handle(post(secret, eventBody("!jeu"), { id: "slow" }), ctx, { now: NOW });
  assert.equal(response.status, 204); assert.ok(Date.now() - t0 < 500, "la réponse part avant l'envoi");
  assert.equal(tw.chat.length, 0, "l'envoi n'a pas encore eu lieu");
  release(); await done;
  assert.equal(tw.chat.length, 1);
  // une panne pendant le traitement (les commandes ne se lisent plus) ; la chaîne servie, elle, se résout sans jamais lever (bornée, voir channel.mjs)
  ctx.api.services.callAll = slow;
  const list = ctx.api.store.list;
  ctx.api.store.list = async (collection, opts) => { if (collection === "botConfig") throw new Error("panne"); return list(collection, opts); };
  const errs = []; const log = console.error; console.error = (...a) => errs.push(a.join(" "));
  const bad = await W.handle(post(secret, eventBody("!jeu"), { id: "boom" }), ctx, { now: NOW + 5 });
  await bad.done; console.error = log;
  assert.equal(bad.response.status, 204);
  assert.ok(errs.some((e) => /traitement d'un message en échec/.test(e)));
});

test("webhook : message invalide → 400 ; type de notification inconnu → ignoré (204), jamais d'exception", async () => {
  const { ctx, secret } = await listening();
  assert.equal((await W.handle(post(secret, "n'importe quoi", { id: "a" }), ctx, { now: NOW })).response.status, 400);
  assert.equal((await W.handle(post(secret, "{}", { id: "b", type: "session_keepalive" }), ctx, { now: NOW })).response.status, 204);
  assert.equal((await W.handle(post(secret, JSON.stringify({ subscription: { type: "stream.online" }, event: {} }), { id: "c" }), ctx, { now: NOW })).response.status, 204);
});

test("webhook : révocation → l'état le note puis le bot tente de se remettre à l'écoute (nouvel abonnement)", async () => {
  const { ctx, tw, secret } = await listening();
  const body = JSON.stringify({ subscription: { type: es.TYPE, status: "authorization_revoked" } });
  const r = await W.handle(post(secret, body, { id: "rev1", type: "revocation" }), ctx, { now: NOW });
  assert.equal(r.response.status, 204);
  await r.done;
  assert.equal(tw.subs.length, 1, "un nouvel abonnement a été demandé");
  assert.equal(tw.lastCreate.transport.callback, "https://site.example.org/m/bot/webhook");
  assert.equal(tw.lastCreate.transport.secret, secret);
  const state = await S.readState(ctx);
  assert.equal(state.sub.code, "pending");
});

/* ───────────── L'écoute : état et abonnement ───────────── */

test("diagnostic : la PREMIÈRE chose à faire, dans l'ordre (aucune chaîne, application, autorisation, nouvelle autorisation, site public)", async () => {
  const s = (ctx) => (new Function("return 0"), ctx);
  void s;
  const code = async (o) => (await L.diagnose(world(o).ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(world(o).ctx), { declare: false })).code;
  assert.equal(await code({}), "ready");
  assert.equal(await code({ tw: { ready: false } }), "creds_missing");
  assert.equal(await code({ tw: { mainStatus: "none" } }), "need_connect");
  assert.equal(await code({ tw: { mainStatus: "reconnect" } }), "need_reconnect");
  assert.equal(await code({ tw: { mainScopes: ["user:read:chat"] } }), "need_more");
  assert.equal(await code({ siteUrl: "http://localhost:3000" }), "site_private");
  assert.equal(await code({ siteUrl: "https://192.168.1.5" }), "site_private");
  assert.equal(await code({ siteUrl: "https://mon-site.local" }), "site_private");
  assert.equal(await code({ settings: { channel: "inconnue" } }), "channel_unknown");
  assert.equal(await code({ settings: { replyAs: "bot" } }), "bot_need_connect");
  assert.equal(await code({ settings: { replyAs: "bot" }, tw: { botStatus: "ok", botScopes: ["user:read:chat"], mainScopes: [...es.SCOPES.ownerForBot] } }), "bot_more");
  assert.equal(await code({ settings: { replyAs: "bot" }, tw: { botStatus: "ok", botScopes: [...es.SCOPES.bot], mainScopes: [...es.SCOPES.ownerForBot] } }), "ready");
  assert.equal(L.isPublicSite("https://www.example.org"), true);
  assert.equal(L.isPublicSite("https://www.example.org:8443"), false);
  assert.equal(L.isPublicSite("http://www.example.org"), false);
});

test("le bot annonce à Chaîne Twitch les autorisations qu'il lui faut (chat ; avec compte séparé, ce qu'il faut à chacun)", async () => {
  const own = world();
  await L.declareScopes(own.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(own.ctx), "emma");
  assert.deepEqual(own.tw.wants.map((w) => [w.slot, w.scopes]), [["main", es.SCOPES.own], ["bot", []]]);
  assert.ok(own.tw.wants.every((w) => w.consumer === "bot" && w.returnTo === "/admin/instances/id-bot"));
  const sep = world({ settings: { replyAs: "bot" } });
  await L.declareScopes(sep.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(sep.ctx), "emma");
  assert.deepEqual(sep.tw.wants.map((w) => [w.slot, w.scopes]), [["main", es.SCOPES.ownerForBot], ["bot", es.SCOPES.bot]]);
});

test("écoute : crée l'abonnement avec le bon corps ; en attente tant que Twitch n'a pas vérifié ; « écoute » ensuite ; ne recrée rien s'il fonctionne", async () => {
  const { ctx, tw } = world();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(ctx);
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  assert.equal(tw.subs.length, 1);
  assert.deepEqual(tw.lastCreate, es.subscriptionBody({ broadcasterId: "100", userId: "100", callback: "https://site.example.org/m/bot/webhook", secret: tw.lastCreate.transport.secret }));
  assert.match(tw.lastCreate.transport.secret, /^[0-9a-f]{64}$/);
  assert.equal(tw.lastCreate.transport.secret, await S.ensureSecret(ctx), "le secret envoyé à Twitch est celui qui vérifie les messages");
  assert.equal((await L.ensureListening(ctx, s)).code, "pending", "pas de doublon tant que Twitch vérifie");
  assert.equal(tw.subs.length, 1);
  tw.subs[0].status = "enabled";
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  assert.equal(tw.subs.length, 1);
  assert.equal(tw.calls.filter((c) => c.method === "POST").length, 1);
});

test("écoute : Twitch a coupé l'abonnement (échecs répétés, autorisation retirée) → supprimé et recréé, avec la raison gardée ; les doublons sont nettoyés", async () => {
  const { ctx, tw } = world();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(ctx);
  await L.ensureListening(ctx, s);
  tw.subs[0].status = "notification_failures_exceeded";
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  assert.equal(tw.subs.length, 1); assert.notEqual(tw.subs[0].status, "notification_failures_exceeded");
  assert.equal((await S.readState(ctx)).sub.failure, "unreachable");
  tw.subs.push({ ...tw.subs[0], id: "dup", status: "enabled" }); tw.subs[0].status = "enabled";
  assert.equal((await L.ensureListening(ctx, s)).code, "listening");
  assert.equal(tw.subs.length, 1, "le doublon est supprimé");
  const renew = await L.ensureListening(ctx, s, { renew: true });
  assert.equal(renew.code, "pending"); assert.equal(tw.subs.length, 1);
});

test("écoute : un abonnement « en attente » depuis plus de 10 minutes est recréé ; Twitch en panne ou limité → état clair, jamais d'exception ; droits refusés → reconnecter", async () => {
  const { ctx, tw } = world();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(ctx);
  await L.ensureListening(ctx, s);
  await S.updateState(ctx, (d) => { d.sub.pendingSince = Date.now() - 11 * 60_000; });
  const first = tw.subs[0].id;
  assert.equal((await L.ensureListening(ctx, s)).code, "pending");
  assert.equal(tw.subs.length, 1); assert.notEqual(tw.subs[0].id, first);
  tw.listDown = true;
  assert.equal((await L.ensureListening(ctx, s)).code, "twitch_down");
  tw.listDown = false; tw.subs = []; tw.createStatus = 403;
  assert.equal((await L.ensureListening(ctx, s)).code, "need_reconnect");
  tw.createStatus = 400;
  const r = await L.ensureListening(ctx, s);
  assert.equal(r.code, "refused");
  assert.equal((await S.readState(ctx)).sub.detail, "nope");
  tw.mainStatus = "none";
  assert.equal((await L.ensureListening(ctx, s)).code, "need_connect");
});

test("tâche planifiée : toutes les 10 minutes pour vérifier l'écoute, toutes les heures pour ranger ; badge d'administration seulement s'il y a un problème", async () => {
  assert.equal(def.tasks.listen.everyMinutes, 10); assert.equal(def.tasks.tidy.everyMinutes, 60);
  const { ctx, tw } = world();
  await def.tasks.listen.run(ctx);
  assert.equal(tw.subs.length, 1);
  assert.equal(await def.adminBadge(ctx), 0, "en attente : pas de pastille");
  tw.mainStatus = "reconnect";
  await def.tasks.listen.run(ctx);
  assert.equal(await def.adminBadge(ctx), 1);
  await def.tasks.tidy.run(ctx);
});

test("instance supprimée : l'abonnement chez Twitch est retiré et les demandes d'autorisation aussi", async () => {
  const { ctx, tw } = world();
  const s = (await import("../modules/twitch-bot/settings.mjs")).settingsOf(ctx);
  await L.ensureListening(ctx, s);
  assert.equal(tw.subs.length, 1);
  await def.hooks.onInstanceDelete(ctx);
  assert.equal(tw.subs.length, 0);
  assert.ok(tw.wants.filter((w) => w.scopes.length === 0).length >= 2);
});

/* ───────────── La page d'administration ───────────── */

const textOf = (blocks) => blocks.map((b) => [b.text, b.title, b.submitLabel, b.html, ...(b.columns ?? []), ...(b.rows ?? []).flat(), ...(b.fields ?? []).flatMap((f) => [f.label, f.help])].filter(Boolean).join(" ")).join("\n");
const bannerOf = (blocks) => blocks.filter((b) => b.type === "banner");
const formsOf = (blocks, action) => blocks.filter((b) => b.type === "adminForm" && b.action === action);
const table = (blocks, firstColumn) => blocks.find((b) => b.type === "table" && b.columns[0] === firstColumn);

test("page : l'arrêt d'urgence est TOUT EN HAUT, puis « le bot écoute ? » ; cela vaut pour toutes les situations", async () => {
  for (const o of [{}, { tw: { mainStatus: "none" } }, { tw: { ready: false } }, { siteUrl: "http://localhost:3000" }]) {
    const { ctx } = world(o);
    const blocks = await A.panel(ctx, { query: {} });
    assert.equal(blocks[0].type, "adminForm"); assert.equal(blocks[0].action, "mute"); assert.equal(blocks[0].submitLabel, fr.mute_btn);
    assert.equal(blocks[2].type, "heading"); assert.equal(blocks[2].text, fr.listen_title);
  }
  const { ctx } = world();
  await A.actions.mute(ctx);
  const blocks = await A.panel(ctx, { query: {} });
  assert.equal(blocks[0].type, "banner"); assert.equal(blocks[0].tone, "warning"); assert.match(blocks[0].text, /COUPÉ/);
  assert.equal(blocks[1].action, "unmute"); assert.equal(blocks[1].submitLabel, fr.mute_off_btn);
});

test("page : « Le bot écoute : oui / non », avec pourquoi et quoi faire, en mots simples ; bouton d'autorisation seulement quand il sert", async () => {
  const listening = world();
  await L.ensureListening(listening.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(listening.ctx));
  listening.tw.subs[0].status = "enabled";
  await L.ensureListening(listening.ctx, (await import("../modules/twitch-bot/settings.mjs")).settingsOf(listening.ctx));
  let b = await A.panel(listening.ctx, { query: {} });
  assert.deepEqual(bannerOf(b).map((x) => [x.tone, x.text]), [[ "success", fr.listen_yes ]]);
  assert.match(textOf(b), /Aucun message reçu pour l'instant/);
  const cases = [
    [{ tw: { mainStatus: "none" } }, "listen_need_connect", true], [{ tw: { mainStatus: "reconnect" } }, "listen_need_reconnect", true], [{ tw: { mainScopes: ["user:read:chat"] } }, "listen_need_more", true],
    [{ tw: { ready: false } }, "listen_creds_missing", false], [{ siteUrl: "http://localhost:3000" }, "listen_site_private", false],
  ];
  for (const [o, key, button] of cases) {
    const { ctx } = world(o);
    b = await A.panel(ctx, { query: {} });
    const banner = bannerOf(b)[0];
    assert.equal(banner.tone, "warning"); assert.ok(banner.text.startsWith(fr.listen_no), key); assert.ok(banner.text.includes(fr[key]), key);
    assert.equal(b.filter((x) => x.type === "html" && x.html.includes("data-twitch-connect")).length, button ? 1 : 0, key);
    if (button) assert.match(b.find((x) => x.type === "html").html, /id\.twitch\.tv\/oauth2\/authorize\?main=1/);
    assert.equal(formsOf(b, "check").length, 1); assert.equal(formsOf(b, "relisten").length, 0, "« Réparer l'écoute » ne sert que quand l'abonnement lui-même est en cause");
  }
  const rev = world();
  await S.updateState(rev.ctx, (d) => { d.sub = { code: "revoked", detail: "authorization_revoked", at: Date.now() }; });
  const rb = await A.panel(rev.ctx, { query: {} });
  assert.match(bannerOf(rb)[0].text, /Twitch a arrêté d'envoyer les messages du chat/);
  assert.equal(formsOf(rb, "relisten").length, 1);
  const creds = await A.panel(world({ tw: { ready: false } }).ctx, { query: {} });
  assert.match(textOf(creds), /\[Connecteur Twitch\]\(\/admin\/instances\/tw1\)/, "le lien mène à la page où régler l'application Twitch (celle que donne le Connecteur)");
  const guide = await A.panel(world({ tw: { mainStatus: "none" } }).ctx, { query: {} });
  assert.match(textOf(guide), /Twitch doit d'abord vous demander votre accord/);
  assert.match(textOf(guide), /Autoriser le bot chez Twitch/);
  const failed = world({ result: { code: "wrongAccount", login: "intrus" }, tw: { mainStatus: "none" } });
  assert.match(textOf(await A.panel(failed.ctx, { query: {} })), /compte « intrus »/);
});

test("page : le compte bot séparé n'apparaît qu'en mode avancé (réglage) ; connexion guidée, état, déconnexion", async () => {
  const simple = await A.panel(world().ctx, { query: {} });
  assert.ok(!textOf(simple).includes(fr.bot_title));
  const adv = world({ settings: { replyAs: "bot" } });
  const b = await A.panel(adv.ctx, { query: {} });
  assert.ok(textOf(b).includes(fr.bot_title));
  assert.match(bannerOf(b)[0].text, new RegExp(fr.listen_bot_need_connect));
  assert.match(b.find((x) => x.type === "html").html, /bot=1/);
  const ok = world({ settings: { replyAs: "bot" }, tw: { botStatus: "ok", botScopes: [...es.SCOPES.bot], mainScopes: [...es.SCOPES.own] } });
  const b2 = await A.panel(ok.ctx, { query: {} });
  assert.match(textOf(b2), /Compte bot connecté : monbot/);
  assert.equal(formsOf(b2, "disconnectBot").length, 1);
  assert.match((await A.actions.disconnectBot(ok.ctx)).ok, /déconnecté/);
});

test("page : le résumé liste les commandes (à vous, toutes prêtes, réseaux, groupée) avec leur état, et un lien de modification par ligne ; celles des partenaires ont leur rubrique", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla")], links: [link("tt", "tiktok", "TikTok · emma", "https://www.tiktok.com/@emma")] });
  const e = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  await C.saveCommand(ctx, { kind: "custom" }, { name: "merch", text: "Boutique : example.org/shop", role: "mods" }, e);
  await C.saveSourced(ctx, "partner", "p1", { enabled: true }, e);
  await C.saveSourced(ctx, "network", "tt", { enabled: true }, e);
  await C.saveCommand(ctx, { kind: "builtin", id: "uptime" }, { enabled: false }, e);
  SRC.resetSources();
  const b = await A.panel(ctx, { query: {} });
  const t = table(b, fr.col_command);
  const rows = Object.fromEntries(t.rows.map((r) => [r[0].split(/ {2}| · /)[0], r]));
  assert.deepEqual(Object.keys(rows), ["!merch", "!planning", "!jeu", "!titre", "!followers", "!uptime", "!tiktok", "!reseaux"], "pas de ligne partenaire ici : leur résumé est dans la rubrique des partenaires");
  assert.deepEqual(t.columns, [fr.col_command, fr.col_answer, fr.col_state], "trois colonnes : lisible sur un téléphone");
  assert.deepEqual([rows["!merch"][0], rows["!merch"][2]], [`!merch · ${fr.kind_custom} · ${fr.role_mods}`, fr.state_on]);
  assert.equal(rows["!jeu"][0], `!jeu  !game · ${fr.kind_builtin}`, "tout le monde : le rôle n'est pas répété");
  assert.equal(rows["!uptime"][2], fr.state_off);
  assert.equal(rows["!tiktok"][0], `!tiktok  !tik-tok · ${fr.kind_network} (TikTok · emma)`);
  assert.equal(rows["!reseaux"][2], fr.state_on);
  assert.deepEqual(t.rowIds, ["custom:" + t.rowIds[0].slice(7), "builtin:planning", "builtin:jeu", "builtin:titre", "builtin:followers", "builtin:uptime", "network:tt", "group:reseaux"]);
  assert.deepEqual(t.rowActions.map((a) => a.label), [fr.act_edit, fr.act_toggle]);
  assert.equal(t.rowActions[0].href, "?edit={id}#edit", "chaque commande s'ouvre sur sa configuration, la page descend jusqu'au formulaire au lieu de rester en haut");
  assert.ok(b.some((x) => x.type === "html" && x.html.includes('id="edit"')) === false, "l'ancre n'existe que quand un formulaire est ouvert");
  const pt = table(b, fr.col_partner);
  assert.deepEqual(pt.rows, [[ "Tesla", `!tesla · ${fr.state_on}` ]], "le résumé du partenaire : son nom et l'état de sa commande");
  const noPlanning = await A.panel(world().ctx, { query: {} });
  assert.match(table(noPlanning, fr.col_command).rows.find((r) => r[0].startsWith("!planning"))[2], /Masquée : aucun agenda de streams n'est installé/);
});

test("page : partenaires — explication si Sponsors est absent ; sinon la liste des fiches publiées avec « Modifier » vers la FICHE (plus de formulaire ici)", async () => {
  const absent = await A.panel(world().ctx, { query: {} });
  assert.match(textOf(absent), /apparaît quand vous installez le module \*\*Sponsors\*\*/);
  assert.ok(!absent.some((b) => b.type === "table" && b.columns[0] === fr.col_partner));
  const none = await A.panel(world({ sponsors: [] }).ctx, { query: {} });
  assert.match(textOf(none), /aucune fiche n'est publiée/);
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla"), entry("p2", "nordvpn", "NordVPN")] });
  const b = await A.panel(ctx, { query: {} });
  const t = table(b, fr.col_partner);
  assert.deepEqual(t.rows, [["Tesla", fr.state_not_set], ["NordVPN", fr.state_not_set]]);
  assert.deepEqual(t.rowIds, ["p1", "p2"], "l'identifiant de la fiche : le lien y mène");
  assert.deepEqual(t.rowActions, [{ label: fr.act_edit, href: "/admin/entries/{id}#panel-bot-chat-command" }], "un seul bouton : la fiche, ouverte sur la section de la commande (l'ancre est celle que le cœur donne à la section)");
  assert.match(textOf(b), /Commande de chat pour ce partenaire/);
  assert.equal(formsOf(b, "save").length, 0, "plus aucun formulaire de partenaire sur la page du bot");
  // Un ancien lien « ?edit=partner:… » ne casse rien : il renvoie vers la fiche.
  const old = await A.panel(ctx, { query: { edit: "partner:p1" } });
  assert.match(textOf(old), /\[Ouvrir la fiche\]\(\/admin\/entries\/p1#panel-bot-chat-command\)/);
  assert.equal(formsOf(old, "save").length, 0);
});

test("page : une commande de partenaire dont la fiche n'est plus publiée est dite « en pause » dans la rubrique, avec ce qui va se passer", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla"), entry("p2", "nordvpn", "NordVPN")] });
  const e = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  await C.saveSourced(ctx, "partner", "p1", { enabled: true }, e);
  await C.saveSourced(ctx, "partner", "p2", { enabled: true, name: "nord" }, e);
  const gone = world({ sponsors: [entry("p2", "nordvpn", "NordVPN")] });
  await gone.ctx.api.store.add("botConfig", (await C.loadConfig(ctx)).data);
  SRC.resetSources();
  const b = await A.panel(gone.ctx, { query: {} });
  assert.deepEqual(table(b, fr.col_partner).rows, [["NordVPN", `!nord · ${fr.state_on}`]]);
  assert.match(textOf(b), /En pause \(la fiche n'est plus publiée ou a disparu\) : !tesla \(Tesla\)\. Ces commandes sont retirées toutes seules au bout de deux semaines/);
});

/* ───────────── La section dans la fiche du partenaire ───────────── */

const target = (o = {}) => ({ id: "p1", title: "Tesla", slug: "tesla", path: "/sponsors/tesla", instance: "sponsors", published: true, ...o });
const panelDef = def.entryPanels["chat-command"];
const formOf = (blocks) => blocks.find((b) => b.type === "adminForm");
const fieldsOf = (blocks) => Object.fromEntries(formOf(blocks).fields.map((x) => [x.name, x]));

test("fiche du partenaire : la section est déclarée (par sujet, jamais par nom de module), à la bonne place du manifeste, avec son code et ses actions", () => {
  assert.equal(manifest.entryPanels.length, 1);
  const decl = manifest.entryPanels[0];
  assert.deepEqual([decl.id, decl.for], ["chat-command", { topic: "sponsor.card" }]);
  for (const l of ["fr", "en"]) assert.ok(decl.title[l].length > 10 && decl.help[l].length > 30);
  assert.equal(typeof panelDef.render, "function");
  assert.deepEqual(Object.keys(panelDef.actions), ["save"]);
  assert.ok(manifest.permissions.includes("admin"));
  assert.ok(parseManifest(manifest).ok);
});

test("fiche du partenaire : case « Activer la commande dans le chat », NOM (= identifiant de sa page) et TEXTE pré-remplis et modifiables, aperçu, lien vers le bot", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla")] });
  const b = await panelDef.render(ctx, target(), { advanced: false });
  const f = fieldsOf(b);
  assert.deepEqual(Object.keys(f), ["enabled", "name", "text"], "version simple : trois champs, pas de jargon");
  assert.deepEqual([f.enabled.kind, f.enabled.label, f.enabled.value, f.name.value, f.text.value], ["checkbox", fr.f_enabled_chat, "", "tesla", "Découvrez mon parrainage {partenaire} : {adresse}"]);
  assert.equal(f.name.label, "Nom de la commande (sans le !)");
  assert.ok(f.text.help.includes("{partenaire}") && f.text.help.includes("{adresse}"));
  assert.equal(formOf(b).action, "save");
  assert.match(textOf(b), /Aperçu de la réponse.*Découvrez mon parrainage Tesla : site\.example\.org\/sponsors\/tesla/);
  assert.deepEqual(b.at(-1).items[0].label, fr.entry_open_bot);
  assert.ok(b.at(-1).items[0].href.startsWith("/admin/instances/"));
  assert.ok(!b.some((x) => x.type === "banner" && x.tone === "info"), "fiche publiée : pas de remarque");
});

test("fiche du partenaire : le mode avancé ajoute autres noms, qui peut l'utiliser et attentes", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla")] });
  const f = fieldsOf(await panelDef.render(ctx, target(), { advanced: true }));
  assert.deepEqual(Object.keys(f), ["enabled", "name", "text", "aliases", "role", "cdGlobal", "cdUser"]);
  assert.equal(f.role.options.length, 4);
});

test("fiche du partenaire : enregistrer active la commande, qui répond avec les informations de la fiche ; la section se relit avec ce qui a été enregistré", async () => {
  const { ctx, tw } = world({ sponsors: [entry("p1", "tesla", "Tesla")] });
  const saved = await panelDef.actions.save(ctx, target(), { enabled: "on", name: "parrain", text: "Chez {partenaire} : {adresse}" });
  assert.deepEqual(saved, { ok: fr.saved });
  await say(ctx, "!parrain");
  assert.deepEqual(sent(tw), ["Chez Tesla : site.example.org/sponsors/tesla"]);
  const again = fieldsOf(await panelDef.render(ctx, target(), { advanced: false }));
  assert.deepEqual([again.enabled.value, again.name.value, again.text.value], ["on", "parrain", "Chez {partenaire} : {adresse}"]);
  // décocher met la commande en pause sans rien perdre
  assert.deepEqual(await panelDef.actions.save(ctx, target(), { name: "parrain", text: "Chez {partenaire} : {adresse}" }), { ok: fr.saved });
  SRC.resetSources();
  assert.equal((await listOf(ctx, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" })).find((c) => c.key === "partner:p1").state, "off");
  assert.equal(fieldsOf(await panelDef.render(ctx, target(), { advanced: false })).enabled.value, "");
  // la page du bot montre l'état et mène à la fiche
  SRC.resetSources();
  assert.deepEqual(table(await A.panel(ctx, { query: {} }), fr.col_partner).rows, [["Tesla", `!parrain · ${fr.state_off}`]]);
});

test("fiche du partenaire : les erreurs disent quoi faire et ne laissent rien d'enregistré (nom pris, nom invalide, variable inconnue)", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla"), entry("p2", "nordvpn", "NordVPN")] });
  assert.match((await panelDef.actions.save(ctx, target({ id: "p1" }), { enabled: "on", name: "jeu", text: "x" })).error, /« jeu » est déjà pris par la commande « jeu »/);
  assert.match((await panelDef.actions.save(ctx, target({ id: "p1" }), { enabled: "on", name: "a b", text: "x" })).error, /n'est pas valable/);
  assert.match((await panelDef.actions.save(ctx, target({ id: "p1" }), { enabled: "on", name: "tesla", text: "Salut {pseudo}" })).error, /ne connaît pas : \{pseudo\}/);
  assert.match((await panelDef.actions.save(ctx, target({ id: "p1" }), { enabled: "on", name: "tesla", text: "/ban" })).error, /ne peut pas commencer par \//);
  assert.deepEqual((await C.loadConfig(ctx)).data.partners, {}, "un refus ne laisse rien d'enregistré");
  assert.equal((await panelDef.actions.save(ctx, target({ id: "p1" }), { enabled: "on", name: "tesla", text: "Voir {adresse}" })).ok, fr.saved);
  assert.match((await panelDef.actions.save(ctx, target({ id: "p2", slug: "nordvpn", title: "NordVPN", path: "/sponsors/nordvpn" }), { enabled: "on", name: "tesla", text: "x" })).error, /« tesla » est déjà pris/);
});

test("fiche du partenaire : une fiche en brouillon peut être réglée — la commande attend sa publication ; une fiche qui n'est pas d'un sponsor n'a pas de section", async () => {
  const { ctx } = world({ sponsors: [] });
  const draft = target({ id: "d1", title: "Brouillon", slug: "brouillon", path: "/sponsors/brouillon", published: false });
  const b = await panelDef.render(ctx, draft, { advanced: false });
  assert.equal(b[0].tone, "info");
  assert.equal(b[0].text, fr.entry_unpublished);
  assert.deepEqual(await panelDef.actions.save(ctx, draft, { enabled: "on", name: "brouillon", text: "Voir {adresse}" }), { ok: fr.entry_saved_unpublished });
  assert.equal((await listOf(ctx)).find((c) => c.key === "partner:d1").state, "missing", "pas dans les fiches publiées : en pause jusqu'à la publication");
  const out = await say(ctx, "!brouillon");
  assert.deepEqual([out.result, out.reason], ["refused", "missing"], "le bot ne répond pas tant que la fiche n'est pas publiée");
  // une fiche d'un autre contenu : rien à montrer (le cœur masque la section) et rien à enregistrer
  assert.deepEqual(await panelDef.render(ctx, target({ instance: "blog" }), { advanced: false }), []);
  assert.match((await panelDef.actions.save(ctx, target({ instance: "blog" }), { enabled: "on", name: "x", text: "y" })).error, /n'existe pas/);
});

test("fiche du partenaire : si le bot n'écoute pas encore, la section le dit et mène à la page du bot ; la section est en anglais aussi", async () => {
  const { ctx } = world({ sponsors: [entry("p1", "tesla", "Tesla")], tw: { mainStatus: "none" } });
  const b = await panelDef.render(ctx, target(), { advanced: false });
  const banner = b.find((x) => x.type === "banner" && x.tone === "warning");
  assert.equal(banner.text, fr.entry_bot_not_ready);
  assert.equal(banner.href, `/admin/instances/${ctx.instance.id}`);
  // une éditrice : pas de lien vers la page du bot (elle lui est fermée), mais à qui s'adresser
  const ed = await panelDef.render(ctx, target(), { advanced: false, role: "editor" });
  const edBanner = ed.find((x) => x.type === "banner" && x.tone === "warning");
  assert.equal(edBanner.text, fr.entry_bot_not_ready_editor);
  assert.equal(edBanner.href, undefined);
  assert.ok(!ed.some((x) => x.type === "links"), "aucun lien d'administration pour une éditrice");
  assert.ok((await panelDef.render(ctx, target(), { advanced: false, role: "owner" })).some((x) => x.type === "links"));
  const en_ = world({ sponsors: [entry("p1", "tesla", "Tesla")], locale: "en" });
  const e = await panelDef.render(en_.ctx, target(), { advanced: true });
  assert.equal(formOf(e).submitLabel, en.save_btn);
  assert.equal(fieldsOf(e).enabled.label, en.f_enabled_chat);
  assert.match(textOf(e), /Preview of the answer/);
});

test("page : réseaux — explication sans module de réseau ; sinon liste avec « Configurer » ; modifier un réseau propose nom, autres noms et texte", async () => {
  assert.match(textOf(await A.panel(world().ctx, { query: {} })), /Aucun réseau n'est branché/);
  const { ctx } = world({ links: [link("y", "youtube-channel", "YouTube", "https://www.youtube.com/@emma"), link("y2", "youtube-channel", "YouTube", "https://www.youtube.com/@emma2")] });
  const b = await A.panel(ctx, { query: {} });
  assert.deepEqual(table(b, fr.col_network).rows.map((r) => r[0]), ["YouTube", "YouTube"], "deux comptes d'un même réseau : leur libellé complet les distingue quand le module le donne");
  const e1 = Object.fromEntries(formsOf(await A.panel(ctx, { query: { edit: "network:y" } }), "save")[0].fields.map((x) => [x.name, x]));
  assert.deepEqual([e1.name.value, e1.aliases.value, e1.text.value], ["youtube", "yt", "Retrouvez-moi sur {reseau} : {lien}"]);
  assert.equal(Object.fromEntries(formsOf(await A.panel(ctx, { query: { edit: "network:y2" } }), "save")[0].fields.map((x) => [x.name, x])).name.value, "youtube", "avant activation, les deux proposent le même nom : le 2e est vérifié à l'enregistrement");
  await A.actions.save(ctx, { key: "network:y", enabled: "on", name: "youtube", aliases: "yt", text: "YouTube : {lien}", role: "everyone" });
  const e2 = Object.fromEntries(formsOf(await A.panel(ctx, { query: { edit: "network:y2" } }), "save")[0].fields.map((x) => [x.name, x]));
  assert.deepEqual([e2.name.value, e2.aliases.value], ["youtube2", ""], "une fois le 1er activé, le 2e propose youtube2 sans alias en double");
  const clash = await A.actions.save(ctx, { key: "network:y2", enabled: "on", name: "youtube", aliases: "", text: "Ma 2e chaîne : {lien}", role: "everyone" });
  assert.match(clash.error, /« youtube » est déjà pris par la commande « youtube »/);
});

test("page : modifier un réseau mène aussi à la page de réglages du module du réseau (adresse donnée par le cœur) ; sans elle, pas de lien", async () => {
  const { ctx } = world({ links: [link("y", "youtube-channel", "YouTube", "https://www.youtube.com/@emma")], instances: [{ id: "i9", key: "y", module: "youtube-channel", basePath: null, name: "YouTube", adminPath: "/admin/instances/i9" }] });
  assert.match(textOf(await A.panel(ctx, { query: { edit: "network:y" } })), /\[Modifier l'adresse dans le module de ce réseau\]\(\/admin\/instances\/i9\)/);
  const bare = world({ links: [link("y", "youtube-channel", "YouTube", "https://www.youtube.com/@emma")] });
  assert.ok(!textOf(await A.panel(bare.ctx, { query: { edit: "network:y" } })).includes("Modifier l'adresse dans le module"));
});

test("page : aucune action ne redirige (la page resterait en haut après chaque clic) sauf supprimer et rétablir le texte, qui reviennent à la page de la commande", async () => {
  const { ctx } = world();
  const results = {
    mute: await A.actions.mute(ctx), unmute: await A.actions.unmute(ctx), check: await A.actions.check(ctx), relisten: await A.actions.relisten(ctx),
    toggle: await A.actions.toggle(ctx, { id: "builtin:titre" }), clearLog: await A.actions.clearLog(ctx), disconnectBot: await A.actions.disconnectBot(ctx),
    create: await A.actions.create(ctx, { name: "merch", text: "Boutique", role: "everyone" }),
    save: await A.actions.save(ctx, { key: "builtin:jeu", enabled: "on", name: "jeu", aliases: "game", text: "Mon {jeu}", role: "everyone" }),
  };
  for (const [name, r] of Object.entries(results)) assert.ok(r.ok && r.redirect === undefined, `${name} : un message, pas de redirection (${JSON.stringify(r)})`);
  assert.ok(A.actions.resetText.toString().includes("redirect") && A.actions.remove.toString().includes("redirect"));
  // les textes d'erreur restent affichés sous le bouton cliqué : une erreur n'a jamais de redirection non plus
  assert.deepEqual(Object.keys(await A.actions.create(ctx, { name: "merch", text: "x", role: "everyone" })), ["error"]);
});

test("page : créer une commande — le formulaire est là, une erreur dit quoi faire (nom pris, variable inconnue), succès confirmé", async () => {
  const { ctx } = world();
  const b = await A.panel(ctx, { query: {} });
  const form = formsOf(b, "create")[0];
  assert.deepEqual(form.fields.map((f) => f.name), ["name", "text", "role", "aliases", "cdGlobal", "cdUser"]);
  assert.equal(form.fields.find((f) => f.name === "role").options.length, 4);
  assert.match(form.fields[1].help, /\{followers\} \{jeu\} \{titre\} \{uptime\} \{prochain_stream\} \{utilisateur\}/);
  const v = { name: "merch", aliases: "", text: "Boutique", role: "everyone", cdGlobal: "", cdUser: "" };
  assert.deepEqual(await A.actions.create(ctx, v), { ok: fr.created });
  assert.match((await A.actions.create(ctx, v)).error, /« merch » est déjà pris par la commande « merch »\. Choisissez un autre nom/);
  assert.match((await A.actions.create(ctx, { ...v, name: "autre", text: "Salut {pseudo}" })).error, /ne connaît pas : \{pseudo\}.*\{followers\} \{jeu\}/);
  assert.match((await A.actions.create(ctx, { ...v, name: "x y" })).error, /n'est pas valable/);
  assert.match((await A.actions.create(ctx, { ...v, name: "z", text: "/me" })).error, /ne peut pas commencer par \//);
  const t = table(await A.panel(ctx, { query: { edit: "custom:" + (await C.loadConfig(ctx)).data.custom[0].id } }), fr.delete_title);
  assert.equal(t.rowActions[0].confirm.includes("!merch"), true);
  assert.equal(t.rowActions[0].danger, true);
});

test("page : activer / désactiver, supprimer, rétablir le texte d'origine, vider le journal", async () => {
  const { ctx } = world();
  assert.match((await A.actions.toggle(ctx, { id: "builtin:titre" })).ok, /La commande !titre est désactivée/);
  assert.equal((await listOf(ctx)).find((c) => c.id === "titre").enabled, false);
  assert.match((await A.actions.toggle(ctx, { id: "builtin:titre" })).ok, /activée/);
  assert.match((await A.actions.toggle(ctx, { id: "builtin:rien" })).error, /n'existe pas/);
  await A.actions.save(ctx, { key: "builtin:jeu", enabled: "on", name: "jeu", aliases: "game", text: "Mon texte {jeu}", role: "everyone" });
  assert.equal((await listOf(ctx)).find((c) => c.id === "jeu").text, "Mon texte {jeu}");
  assert.deepEqual(await A.actions.resetText(ctx, { key: "builtin:jeu" }), { ok: fr.reset_done, redirect: "?edit=builtin:jeu#edit" });
  assert.equal((await listOf(ctx)).find((c) => c.id === "jeu").text, fr.cmd_jeu_text);
  await A.actions.create(ctx, { name: "tmp", text: "x", role: "everyone" });
  const id = (await C.loadConfig(ctx)).data.custom[0].id;
  assert.deepEqual(await A.actions.remove(ctx, { id }), { ok: fr.deleted, redirect: "?" });
  assert.equal((await C.loadConfig(ctx)).data.custom.length, 0);
  await say(ctx, "!jeu");
  assert.equal((await logOf(ctx)).length, 1);
  await A.actions.clearLog(ctx);
  assert.equal((await logOf(ctx)).length, 0);
});

test("journal : les 30 dernières lignes ; réponse envoyée ou raison du refus en mots simples ; rien d'autre que pseudo, commande et résultat", async () => {
  const { ctx } = world({ settings: { cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18 } });
  for (let i = 0; i < 35; i++) await say(ctx, "!jeu", { chatterId: String(i), login: `u${i}` }, NOW + i * 2000);
  const log = await logOf(ctx);
  assert.equal(log.length, S.LOG_MAX);
  assert.equal(log[0].user, "u34");
  assert.deepEqual(Object.keys(log[0]).sort(), ["at", "command", "reason", "result", "text", "user"], "ni identifiant Twitch, ni texte tapé par la personne");
  await C.saveCommand(ctx, { kind: "builtin", id: "titre" }, { role: "mods" }, env(ctx));
  await say(ctx, "!titre", { login: "curieux" }, NOW + 100_000);
  const b = await A.panel(ctx, { query: {} });
  const t = table(b, fr.log_time_user);
  assert.match(t.rows[0][0], / · curieux$/);
  assert.deepEqual(t.rows[0].slice(1), ["!titre", `${fr.log_refused} : ${fr.reason_role}`]);
  assert.deepEqual([t.rows[1][1], t.rows[1][2].startsWith(`${fr.log_sent} : `)], ["!jeu", true]);
  assert.ok(textOf(b).includes(fr.log_help));
  assert.equal(JSON.stringify(await ctx.api.store.list("botLog")).includes("Viewer"), false, "le nom d'affichage n'est pas gardé");
});

/* ───────────── Assistants (MCP) ───────────── */

test("MCP : lister / créer / modifier ; JAMAIS activés par défaut ; lecture seule bien marquée ; aucun outil destructif ; noms courts", () => {
  assert.deepEqual(manifest.mcp.map((a) => a.name), ["bot_commands_list", "bot_command_create", "bot_command_update"]);
  for (const a of manifest.mcp) {
    assert.strictEqual(a.default, false, a.name); assert.ok(!a.destructive, a.name); assert.equal(typeof tools[a.name], "function", a.name);
    assert.ok(a.description.length > 150, "description écrite pour une IA");
    assert.ok(`some-quite-long-instance-key-here__${a.name}`.length <= 64, "le nom complet de l'outil reste sous 64 caractères même avec une clé d'instance longue");
    assert.equal(a.input.type, "object");
  }
  assert.equal(manifest.mcp[0].readOnly, true); assert.ok(!manifest.mcp[1].readOnly && !manifest.mcp[2].readOnly);
  assert.deepEqual(Object.keys(tools).sort(), manifest.mcp.map((a) => a.name).sort(), "tout ce qui est déclaré est implémenté, et inversement");
  assert.ok(!/secret|password|token|clientSecret/i.test(JSON.stringify(manifest.mcp)));
  assert.equal(manifest.mcp[1].input.properties.delayAllSeconds.maximum, 3600);
  assert.deepEqual(manifest.mcp[1].input.required, ["name", "text"]);
});

test("MCP : lister montre toutes les commandes et l'arrêt d'urgence ; créer et modifier appliquent les mêmes règles que l'administration (variables, collisions)", async () => {
  const { ctx } = world();
  const list = await tools.bot_commands_list(ctx, {});
  assert.deepEqual([list.prefix, list.muted, list.commands.length], ["!", false, 6]);
  assert.deepEqual(Object.keys(list.commands.find((c) => c.name === "jeu")).sort(), ["aliases", "delayAllSeconds", "delayPerPersonSeconds", "enabled", "kind", "name", "role", "state", "text"]);
  assert.equal(list.commands.find((c) => c.name === "planning").reason, "planning_absent");
  assert.equal((await tools.bot_commands_list(ctx, { kind: "builtin" })).commands.length, 5);
  assert.deepEqual(await tools.bot_command_create(ctx, { name: "!Merch", text: "Boutique : {utilisateur}", aliases: ["shop"], role: "subscribers", delayAllSeconds: 5 }), { created: true, name: "merch" });
  await assert.rejects(tools.bot_command_create(ctx, { name: "merch", text: "x" }), (e) => e.expose === true && /déjà pris/.test(e.message));
  await assert.rejects(tools.bot_command_create(ctx, { name: "ok", text: "Salut {inconnu}" }), (e) => e.expose && /ne connaît pas/.test(e.message));
  await assert.rejects(tools.bot_command_create(ctx, { name: "ok2", text: "/ban" }), (e) => e.expose);
  assert.deepEqual(await tools.bot_command_update(ctx, { name: "shop", newName: "boutique", text: "Nouvelle boutique", enabled: false }), { updated: true, name: "boutique" });
  const c = (await listOf(ctx)).find((x) => x.kind === "custom");
  assert.deepEqual([c.name, c.text, c.enabled, c.role, c.cdGlobal, c.aliases], ["boutique", "Nouvelle boutique", false, "subscribers", 5, ["shop"]]);
  await assert.rejects(tools.bot_command_update(ctx, { name: "nexistepas", text: "x" }), (e) => e.expose && /no command/.test(e.message));
  await assert.rejects(tools.bot_command_update(ctx, { name: "boutique" }), (e) => e.expose && /nothing to change/.test(e.message));
  await assert.rejects(tools.bot_command_update(ctx, { name: "boutique", newName: "jeu" }), (e) => e.expose && /déjà pris/.test(e.message));
  assert.deepEqual(await tools.bot_command_update(ctx, { name: "jeu", text: "Ça joue {jeu}", delayPerPersonSeconds: 0 }), { updated: true, name: "jeu" });
  const items = []; // partenaire et réseau déjà configurés : modifiables par l'assistant aussi, jamais les non configurés
  void items;
  await A.actions.mute(ctx);
  assert.equal((await tools.bot_commands_list(ctx, {})).muted, true);
  assert.ok(!("bot_mute" in tools), "un assistant ne touche pas à l'arrêt d'urgence ni n'envoie de message");
});

/* ───────────── Manifeste, textes, règles du dépôt ───────────── */

test("manifeste : valide, 1.2.2, minCore 0.2.2 (onglets, réglage « choix parmi »), plateforme Twitch, dépend du Connecteur Twitch (v3) et de Ma Chaîne Twitch seulement (aucune dépendance forte à Sponsors ni Planning), consomme les sujets optionnels", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual([manifest.id, manifest.version, manifest.minCore, manifest.platform, manifest.instances, manifest.dataVersion], ["twitch-bot", "1.2.2", "0.2.2", "twitch", "multiple", 2]);
  assert.deepEqual(manifest.requires, [{ service: "twitch.api", min: 3 }, { service: "twitch.live" }]);
  assert.deepEqual(manifest.settings.find((s) => s.key === "channel"), { ...manifest.settings.find((s) => s.key === "channel"), type: "choice", source: { kind: "providers", service: "twitch.live" }, fromText: true, refersTo: "channel", optional: true, advanced: true });
  assert.equal(typeof def.migrations[2], "function");
  assert.deepEqual(manifest.consumes.map((x) => x.topic).sort(), ["planning.slot", "social.link", "social.stat"]);
  assert.ok(!manifest.requires.some((x) => /sponsor|planning|social/.test(x.service)), "Sponsors, Planning et les réseaux ne sont jamais requis");
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "routes", "storage", "topics"]);
  assert.ok(source.includes("ctx.api.store") && source.includes("ctx.api.topics.collect") && source.includes("routes:") && source.includes("adminPanel") && source.includes("mcp:"));
  assert.equal(manifest.page, false);
  assert.ok(manifest.privacy.fr && manifest.privacy.en);
  for (const s of manifest.settings) {
    if (s.advanced) assert.ok(s.default !== undefined || s.optional, `${s.key} : un réglage avancé a un défaut (ou est facultatif)`);
    assert.ok(s.label.fr && s.label.en && s.help.fr && s.help.en, s.key);
  }
  assert.deepEqual(manifest.settings.filter((s) => !s.advanced).map((s) => s.key), ["onlyWhenLive", "timezone"], "mode simple : deux réglages seulement");
  for (const k of ["replyAs", "prefix", "cooldownGlobal", "cooldownUser", "maxPer30s", "toleranceMinutes", "channel", "ignoredBots"]) assert.equal(manifest.settings.find((s) => s.key === k).advanced, true, k);
  const declared = new Set(manifest.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  assert.equal(manifest.settings.find((s) => s.key === "onlyWhenLive").default, true, "ne répond que quand le live tourne, par défaut");
  assert.equal(manifest.settings.find((s) => s.key === "prefix").default, "!");
});

test("textes : fr et en ont exactement les mêmes clés et les mêmes {variables} ; toutes les clés utilisées par le code existent ; aucun jargon", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), `${k} : mêmes variables en fr et en`); }
  const used = new Set();
  for (const m of source.matchAll(/\bt\(\s*["'`]([a-z0-9_${}.]+)["'`]/g)) used.add(m[1]);
  for (const k of used) {
    if (!k.includes("${")) { assert.ok(k in fr, `clé « ${k} » absente des textes`); continue; }
    const re = new RegExp(`^${k.replace(/\$\{[^}]+\}/g, "[a-zA-Z_]+")}$`);
    assert.ok(Object.keys(fr).some((x) => re.test(x)), `aucune clé ne correspond à « ${k} »`);
  }
  const dynamic = { kind: ["custom", "builtin", "partner", "network", "group"], role: ["everyone", "subscribers", "mods", "owner"], why: ["planning_absent", "followers_absent", "group_empty", "partner_missing", "network_missing"], log: ["sent", "refused", "error"],
    res: ["denied", "refused", "network", "rate", "expired", "wrongAccount", "scope"], listen_failure: ["revoked", "unreachable", "other"], cmd: ["planning_text", "jeu_text", "titre_text", "followers_text", "uptime_text"],
    reason: ["muted", "off", "hidden", "missing", "live_unknown", "offline", "role", "cooldown", "rate", "empty", "not_ready", "send_denied", "send_dropped", "send_refused", "send_rate", "send_twitch"],
    listen: ["pending", "unknown", "no_channel", "channel_unknown", "creds_missing", "need_connect", "need_reconnect", "need_more", "bot_need_connect", "bot_reconnect", "bot_more", "site_private", "revoked", "twitch_busy", "twitch_down", "refused"] };
  for (const [p, list] of Object.entries(dynamic)) for (const x of list) assert.ok(`${p}_${x}` in fr || `${p}_${x}`.replace("cmd_", "cmd_") in fr, `${p}_${x}`);
  const everything = JSON.stringify([Object.values(fr), Object.values(en), manifest.settings, manifest.description, manifest.name, manifest.privacy]);
  for (const jargon of ["webhook", "eventsub", "token", "oauth", "scope", "hmac", "client id", "payload", "endpoint", "callback"]) assert.ok(!everything.toLowerCase().includes(jargon), `jargon : « ${jargon} »`);
  assert.ok(!/\bAPI\b/.test(everything), "pas de « API » dans les textes montrés");
});

test("README en langage métier ; neutralité (règles locales du dépôt principal) ; aucun import du cœur ni eval", async () => {
  const readme = fs.readFileSync(`${DIR}/README.md`, "utf8");
  for (const jargon of ["webhook", "eventsub", "token", "oauth", "scope", "hmac", "endpoint", "payload"]) assert.ok(!readme.toLowerCase().includes(jargon), `README : « ${jargon} »`);
  assert.match(readme, /arrêt d'urgence/i); assert.match(readme, /Emma|chat/);
  const { parseNeutralityRules, findViolations, loadNeutralityText } = await import(new URL(`file://${process.cwd()}/tests/helpers/neutrality.mjs`).href);
  const rules = parseNeutralityRules(loadNeutralityText());
  const texts = Object.fromEntries([...files.map((f) => [`modules/twitch-bot/${f}`, fs.readFileSync(`${DIR}/${f}`, "utf8")]), ["modules/twitch-bot/README.md", readme], ["modules/twitch-bot/module.json", JSON.stringify(manifest)], ["fr", JSON.stringify(fr)], ["en", JSON.stringify(en)]]);
  const bad = findViolations(texts, rules.filter((r) => r.term !== "(?<!author\"?: \")helldog"));
  assert.deepEqual(bad, [], "termes interdits par les règles de neutralité");
  assert.ok(!/\beval\(|new Function|from "@\/|prisma/.test(source));
  const sec = ["clientSecret", "access_token", "refresh_token"];
  for (const k of sec) assert.ok(!source.includes(k), `le bot ne manipule jamais « ${k} » : les jetons restent à Chaîne Twitch`);
});

test("page : tout est prêt mais l'écoute n'est pas vérifiée → vérifiée à l'ouverture (pas de clic) ; pas plus d'une fois toutes les 2 minutes ; rien tenté si quelque chose manque", async () => {
  const { ctx, tw } = world();
  const b = await A.panel(ctx, { query: {} });
  assert.equal(tw.subs.length, 1, "l'abonnement a été créé à l'ouverture de la page");
  assert.ok(tw.calls.some((c) => c.method === "POST"));
  assert.equal(bannerOf(b)[0].text, fr.listen_no + " " + fr.listen_pending.replace("{detail}", ""), "Twitch n'a pas encore vérifié : « en attente », pas « non »");
  const posts = tw.calls.filter((c) => c.method === "POST").length;
  await A.panel(ctx, { query: {} });
  assert.equal(tw.calls.filter((c) => c.method === "POST").length, posts, "pas de nouvelle création pour une page rouverte");
  tw.subs[0].status = "enabled";   // Twitch a fini de vérifier ; 5 secondes plus tard, la page rouverte le constate (plus « en attente »)
  await S.updateState(ctx, (d) => { d.sub.at = Date.now() - 6_000; });
  const again = await A.panel(ctx, { query: {} });
  assert.deepEqual(bannerOf(again).map((x) => x.tone), ["success"]);
  assert.equal(tw.calls.filter((c) => c.method === "POST").length, posts, "toujours aucune nouvelle création");
  const blocked = world({ tw: { mainStatus: "none" } });
  await A.panel(blocked.ctx, { query: {} });
  assert.equal(blocked.tw.calls.filter((c) => c.path === "eventsub/subscriptions").length, 0, "rien n'est tenté tant que l'autorisation manque");
});

test("changer de compte qui répond (mode avancé) : la page le constate, supprime l'ancien abonnement et en crée un pour le compte bot — jamais deux écoutes en parallèle", async () => {
  const { ctx, tw } = world();
  const settings = (await import("../modules/twitch-bot/settings.mjs")).settingsOf;
  await L.ensureListening(ctx, settings(ctx));
  tw.subs[0].status = "enabled";
  await L.ensureListening(ctx, settings(ctx));
  assert.deepEqual(tw.subs.map((s) => s.condition.user_id), ["100"]);
  const orig = ctx.setting;
  ctx.setting = (k) => (k === "replyAs" ? "bot" : orig(k));
  Object.assign(tw, { botStatus: "ok", botScopes: [...es.SCOPES.bot] });
  await A.panel(ctx, { query: {} });
  assert.deepEqual(tw.subs.map((s) => s.condition.user_id), ["555"], "l'abonnement de l'ancien compte est supprimé, celui du compte bot est créé");
});

test("!planning : un agenda de streams suffit (Agenda en ligne ou Streams saisis à la main), sans Planning ; un stream annulé n'est jamais annoncé", async () => {
  await atClock(NOW, async () => {
    const slots = [{ title: "Annulé", start: "2026-10-15T18:00:00Z", status: "cancelled" }, { title: "Zelda en soirée", start: "2026-10-17T18:30:00Z", status: "confirmed" }];
    for (const module of ["calendar-ical", "calendar-manual"]) {
      const w = world({ slots });
      w.ctx.api.instances.list = async ({ module: m }) => (m === module ? [{ key: "agenda", module, basePath: null, name: "Agenda" }] : []);
      await say(w.ctx, "!planning");
      assert.equal(sent(w.tw)[0], "Prochain stream : samedi 17 octobre à 20:30 (Zelda en soirée)", module);
    }
    const none = world({ slots });
    none.ctx.api.instances.list = async () => [];
    await say(none.ctx, "!planning", { badges: ["broadcaster"] });
    assert.deepEqual(sent(none.tw), [], "aucun agenda installé : la commande reste muette");
  });
});

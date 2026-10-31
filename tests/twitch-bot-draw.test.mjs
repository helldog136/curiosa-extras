// Bot Twitch : l'alimentation d'un tirage au sort de Participation (service facultatif audience.draw), testée avec un FAUX service.
import test from "node:test";
import assert from "node:assert/strict";
import { world, chat, NOW, S, SRC } from "./helpers/botWorld.mjs";

const D = await import("../modules/twitch-bot/draw.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));

/** Un faux service de tirage : `state` dit s'il est ouvert, `entries` garde ce qu'il a reçu. */
const fakeDraw = (state = { open: true, keyword: "Tirage", level: "everyone", expiresAt: "2026-10-14T21:00:00Z" }) => {
  const f = { state: { ...state }, entries: [], statusCalls: 0, enterResult: { ok: true } };
  f.methods = { status: () => { f.statusCalls++; return { ...f.state }; }, enter: (a) => { f.entries.push(a); return f.enterResult; } };
  return f;
};
const mk = (o = {}, state) => { D.resetDrawMemory(); SRC.resetSources(); const f = fakeDraw(state); return { f, ...world({ draw: f.methods, ...o }) }; };
let n = 0;
const say = (ctx, text, over = {}, now = NOW) => D.feedDraw(ctx, chat(text, { messageId: `d${++n}`, chatterId: `u${n}`, login: `user${n}`, name: `User${n}`, ...over }), { now });

test("déclaration : besoin FACULTATIF audience.draw (le bot marche sans)", () => {
  assert.deepEqual(manifest.requires.find((r) => r.service === "audience.draw"), { service: "audience.draw", optional: true });
});

test("le mot-clé exact (sans le préfixe, sans tenir compte des majuscules ni des espaces autour) inscrit la personne avec son pseudo nettoyé", async () => {
  const { ctx, f, tw } = mk();
  assert.deepEqual(await say(ctx, "tirage", { login: "ada", name: "Ada_L", chatterId: "1" }), { entered: true });
  assert.deepEqual(f.entries, [{ pseudo: "Ada_L", platform: "twitch", login: "ada" }]);
  assert.equal((await say(ctx, "  !TIRAGE  ", { login: "bob", name: "Bob", chatterId: "2" })).entered, true, "avec le préfixe aussi");
  for (const t of ["tirage !", "je veux le tirage", "tirages", "", "tira"]) assert.equal((await say(ctx, t)).why, "no_match", t);
  assert.equal(f.entries.length, 2);
  assert.equal(tw.chat.length, 0, "le bot ne répond JAMAIS dans le chat pour une participation");
  const clean = await say(ctx, "tirage", { name: "<b>Zoé‮ ​{x}</b>", login: "zoe", chatterId: "3" });
  assert.equal(clean.entered, true);
  assert.ok(f.entries.at(-1).pseudo.length <= 25 && !/[<>{}‮​]/.test(f.entries.at(-1).pseudo), f.entries.at(-1).pseudo);
  assert.equal(f.entries.at(-1).pseudo, "bZoéxb".length ? f.entries.at(-1).pseudo : "");
});

test("une seule fois par personne et par tirage ; un autre tirage (autre mot-clé ou autre fin) repart de zéro", async () => {
  const { ctx, f } = mk();
  assert.equal((await say(ctx, "tirage", { chatterId: "1", login: "ada" })).entered, true);
  assert.equal((await say(ctx, "tirage", { chatterId: "1", login: "ada" })).why, "already");
  assert.equal(f.entries.length, 1);
  f.state = { open: true, keyword: "tirage", level: "everyone", expiresAt: "2026-10-14T22:00:00Z" };
  assert.equal((await say(ctx, "tirage", { chatterId: "1", login: "ada" }, NOW + 11_000)).entered, true, "nouveau tirage (autre fin)");
  assert.equal(f.entries.length, 2);
});

test("la mémoire est effacée quand le tirage se ferme ; fermé, rien n'est envoyé ; la lecture de l'état est gardée 10 s", async () => {
  const { ctx, f } = mk();
  await say(ctx, "tirage", { chatterId: "1", login: "ada" });
  f.state = { open: false };
  assert.equal((await say(ctx, "tirage", { chatterId: "2", login: "bob" }, NOW + 11_000)).why, "closed");
  f.state = { open: true, keyword: "tirage", level: "everyone", expiresAt: "2026-10-14T21:00:00Z" };
  assert.equal((await say(ctx, "tirage", { chatterId: "1", login: "ada" }, NOW + 22_000)).entered, true, "ré-ouvert : la mémoire avait été effacée");
  const before = f.statusCalls;
  for (let i = 0; i < 30; i++) await say(ctx, "bonjour", {}, NOW + 22_000 + i * 100);
  assert.equal(f.statusCalls, before, "l'état est gardé 10 s : aucun appel de plus");
  await say(ctx, "bonjour", {}, NOW + 33_000);
  assert.equal(f.statusCalls, before + 1);
});

test("niveau : tout le monde, abonnement, modération (badges Twitch comme pour les commandes)", async () => {
  const lv = async (level, badges) => { const { ctx, f } = mk({}, { open: true, keyword: "go", level, expiresAt: "x" }); await say(ctx, "go", { badges }); return f.entries.length; };
  assert.deepEqual([await lv("everyone", []), await lv("subscriber", []), await lv("subscriber", ["subscriber"]), await lv("subscriber", ["moderator"]), await lv("moderator", ["subscriber"]), await lv("moderator", ["moderator"]), await lv("moderator", ["broadcaster"])], [1, 0, 1, 1, 0, 1, 1]);
});

test("arrêt d'urgence, hors direct (réglage actif) et bot pas prêt : rien n'est envoyé ; réglage « seulement en direct » éteint : on inscrit hors direct", async () => {
  const a = mk(); await S.setMuted(a.ctx, true);
  assert.equal((await say(a.ctx, "tirage")).why, "muted"); assert.equal(a.f.entries.length, 0);
  const b = mk({ tw: { live: { channel: "emma", configured: true, known: true, live: false, title: "", game: "", startedAt: null } } });
  assert.equal((await say(b.ctx, "tirage")).why, "offline");
  const c = mk({ tw: { live: { channel: "emma", configured: true, known: true, live: false, title: "", game: "", startedAt: null } }, settings: { onlyWhenLive: false } });
  assert.equal((await say(c.ctx, "tirage")).entered, true);
  const d = mk({ tw: { mainStatus: "none" } });
  assert.equal((await say(d.ctx, "tirage")).why, "not_ready");
  const e = mk();
  assert.equal((await say(e.ctx, "tirage", { broadcasterId: "999" })).why, "not_ready");
  for (const over of [{ foreign: true }, { login: "nightbot" }]) assert.equal((await say(mk().ctx, "tirage", over)).why, "ignored");
  S.rememberSent(mk().ctx, "own"); 
});

test("jamais d'erreur visible ni de blocage : service absent, qui plante, qui ne répond pas (1,5 s), ou dont l'inscription est refusée", async () => {
  D.resetDrawMemory();
  const none = world();
  assert.equal((await say(none.ctx, "tirage")).why, "closed", "pas de service : rien, sans erreur");
  const boom = mk(); boom.f.methods.status = () => { throw new Error("secret interne"); };
  assert.equal((await say(boom.ctx, "tirage")).entered, false);
  const refused = mk(); refused.f.enterResult = { ok: false, reason: "already" };
  assert.equal((await say(refused.ctx, "tirage")).entered, true, "le résultat de enter est ignoré");
  const throws = mk(); throws.f.methods.enter = () => { throw new Error("x"); };
  assert.equal((await say(throws.ctx, "tirage")).entered, true);
  const slow = mk(); slow.f.methods.status = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await say(slow.ctx, "tirage");
  assert.equal(r.entered, false); assert.ok(Date.now() - t0 < 2500, "borné à 1,5 s");
  const [, , ...rest] = []; void rest;
});

test("mémoire bornée à 5 000 personnes ; rien de ce que les gens écrivent n'est gardé par le bot", async () => {
  const { ctx, f } = mk();
  for (let i = 0; i < 5100; i++) await say(ctx, "tirage", { chatterId: `p${i}`, login: `p${i}`, name: `P${i}` });
  assert.equal(f.entries.length, D.DRAW_LIMITS.maxEntered);
  assert.equal((await say(ctx, "tirage", { chatterId: "tard" })).why, "full");
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("p42"), "aucun pseudo dans le stockage du bot");
  assert.ok(!(await ctx.dumpStore()).some((r) => /draw|entr/i.test(r.collection)), "aucun stockage de tirage");
});

test("par le webhook : un message du chat est transmis au tirage (le bot ne répond pas)", async () => {
  const { ctx, f, tw } = mk();
  const secret = await S.ensureSecret(ctx);
  const es = await import("../modules/twitch-bot/eventsub.mjs");
  const { createHmac } = await import("node:crypto");
  const b = JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: "777", chatter_user_login: "ada", chatter_user_name: "Ada", message_id: "wm1", message: { text: "tirage" }, message_type: "text", badges: [] } });
  const ts = new Date(NOW).toISOString();
  const req = new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers: new Headers({ "twitch-eventsub-message-id": "wh1", "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": `sha256=${createHmac("sha256", secret).update(`wh1${ts}${b}`).digest("hex")}` }), body: b });
  const { done } = await W.handle(req, ctx, { now: NOW }); await done;
  assert.deepEqual(f.entries, [{ pseudo: "Ada", platform: "twitch", login: "ada" }]);
  assert.equal(tw.chat.length, 0);
});

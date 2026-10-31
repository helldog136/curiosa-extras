// Bot Twitch : l'alimentation d'un tirage au sort de Participation (service facultatif audience.draw), testée avec un FAUX service.
import test from "node:test";
import assert from "node:assert/strict";
import { world, chat, NOW, S, SRC } from "./helpers/botWorld.mjs";
import { fakeAudienceDraw } from "./helpers/fakeAudienceDraw.mjs";

const D = await import("../modules/twitch-bot/draw.mjs");
const W = await import("../modules/twitch-bot/webhook.mjs");
const manifest = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));

/** Le double du service livré par Participation (tests/helpers/fakeAudienceDraw.mjs, contrat tests/contract-ext/audience.md). */
const mk = (o = {}, state = { open: true, keyword: "!tirage", level: "all", expiresAt: "2026-10-14T21:00:00Z" }) => {
  D.resetDrawMemory(); SRC.resetSources();
  const d = fakeAudienceDraw(state);
  const f = { d, get entries() { return d.calls.filter((c) => c[0] === "enter").map((c) => c[1]); }, get statusCalls() { return d.calls.filter((c) => c[0] === "status").length; }, set state(v) { Object.assign(d.state, { open: false, keyword: "", level: "all", expiresAt: undefined }, v); }, methods: d.service };
  return { f, ...world({ draw: d.service, ...o }) };
};
let n = 0;
const say = (ctx, text, over = {}, now = NOW) => D.feedDraw(ctx, chat(text, { messageId: `d${++n}`, chatterId: `u${n}`, login: `user${n}`, name: `User${n}`, ...over }), { now });

test("déclaration : besoin FACULTATIF audience.draw (le bot marche sans)", () => {
  assert.deepEqual(manifest.requires.find((r) => r.service === "audience.draw"), { service: "audience.draw", min: 1, optional: true });
});

test("le mot-clé exact « !mot » (comparé au texte tapé, sans tenir compte des majuscules ni des espaces autour) inscrit la personne avec son pseudo nettoyé, son pseudo et son niveau", async () => {
  const { ctx, f, tw } = mk();
  assert.deepEqual(await say(ctx, "!tirage", { login: "ada", name: "Ada_L", chatterId: "1" }), { entered: true });
  assert.deepEqual(f.entries, [{ pseudo: "Ada_L", platform: "twitch", login: "ada", role: "all" }]);
  assert.equal((await say(ctx, "  !TIRAGE  ", { login: "bob", name: "Bob", chatterId: "2" })).entered, true);
  for (const t of ["tirage", "!tirage !", "je veux le !tirage", "!tirages", "", "!tira", "! tirage", "!!tirage"]) assert.equal((await say(ctx, t)).why, "no_match", t);
  assert.equal(f.entries.length, 2);
  assert.equal(tw.chat.length, 0, "le bot ne répond JAMAIS dans le chat pour une participation");
  const clean = await say(ctx, "!tirage", { name: "<b>Zoé\u202e \u200b{x}</b>", login: "zoe", chatterId: "3" });
  assert.equal(clean.entered, true);
  assert.ok(f.entries.at(-1).pseudo.length <= 25 && !/[<>{}\u202e\u200b]/.test(f.entries.at(-1).pseudo), f.entries.at(-1).pseudo);
});

test("le préfixe des commandes du bot n'entre pas en jeu : avec le préfixe « ? », le mot « !tirage » inscrit et « ?tirage » non", async () => {
  const { ctx, f } = mk({ settings: { prefix: "?" } });
  assert.equal((await say(ctx, "?tirage")).why, "no_match");
  assert.equal((await say(ctx, "!tirage")).entered, true);
  assert.equal(f.entries.length, 1);
});

test("une seule fois par personne et par tirage ; un autre tirage (autre mot-clé ou autre fin) repart de zéro", async () => {
  const { ctx, f } = mk();
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" })).entered, true);
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" })).why, "already");
  assert.equal(f.entries.length, 1, "le service n'est appelé qu'une fois pour cette personne");
  f.state = { open: true, keyword: "!tirage", level: "all", expiresAt: "2026-10-14T22:00:00Z" };
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" }, NOW + 11_000)).entered, true, "nouveau tirage (autre fin)");
  assert.equal(f.entries.length, 2);
});

test("l'identifiant du tirage (id, facultatif) : un nouveau tirage avec le même mot-clé et sans échéance repart de zéro, sans attendre d'avoir vu « fermé »", async () => {
  const { ctx, f } = mk({}, { open: true, keyword: "!tirage", level: "all", id: "A-0" });
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" })).entered, true);
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" }, NOW + 11_000)).why, "already", "même tirage");
  f.d.state.id = "B-0";
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" }, NOW + 22_000)).entered, true, "autre tirage");
  f.d.state.id = "B-1";
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" }, NOW + 33_000)).entered, true, "liste vidée");
  assert.equal(f.entries.length, 3);
});

test("la mémoire est effacée quand le tirage se ferme ; fermé, rien n'est envoyé ; la lecture de l'état est gardée 10 s", async () => {
  const { ctx, f } = mk();
  await say(ctx, "!tirage", { chatterId: "1", login: "ada" });
  f.state = { open: false };
  assert.equal((await say(ctx, "!tirage", { chatterId: "2", login: "bob" }, NOW + 11_000)).why, "closed");
  f.state = { open: true, keyword: "!tirage", level: "all", expiresAt: "2026-10-14T21:00:00Z" };
  assert.equal((await say(ctx, "!tirage", { chatterId: "1", login: "ada" }, NOW + 22_000)).entered, true, "ré-ouvert : la mémoire avait été effacée");
  const before = f.statusCalls;
  for (let i = 0; i < 30; i++) await say(ctx, "bonjour", {}, NOW + 22_000 + i * 100);
  assert.equal(f.statusCalls, before, "l'état est gardé 10 s : aucun appel de plus");
  await say(ctx, "bonjour", {}, NOW + 33_000);
  assert.equal(f.statusCalls, before + 1);
});

test("tirage sans inscription par le chat (mot-clé vide) : le bot n'envoie rien", async () => {
  const { ctx, f } = mk({}, { open: true, keyword: "", level: "all" });
  for (const t of ["", "!", "tirage", "!tirage"]) assert.equal((await say(ctx, t)).entered, false, t);
  assert.equal(f.entries.length, 0);
});

test("niveau (all, sub, mod) : le bot compare lui-même aux badges et transmet le niveau le plus haut de la personne", async () => {
  const lv = async (level, badges) => { const { ctx, f } = mk({}, { open: true, keyword: "!go", level, expiresAt: "x" }); await say(ctx, "!go", { badges }); return f.entries.length ? f.entries[0].role : null; };
  assert.deepEqual([await lv("all", []), await lv("sub", []), await lv("sub", ["subscriber"]), await lv("sub", ["moderator"]), await lv("mod", ["subscriber"]), await lv("mod", ["moderator"]), await lv("mod", ["broadcaster"]), await lv("all", ["founder"])], ["all", null, "sub", "mod", null, "mod", "mod", "sub"]);
});

test("arrêt d'urgence, hors direct (réglage actif) et bot pas prêt : rien n'est envoyé ; réglage « seulement en direct » éteint : on inscrit hors direct", async () => {
  const offline = { channel: "emma", configured: true, known: true, live: false, title: "", game: "", startedAt: null };
  const a = mk(); await S.setMuted(a.ctx, true);
  assert.equal((await say(a.ctx, "!tirage")).why, "muted"); assert.equal(a.f.entries.length, 0);
  const b = mk({ tw: { live: offline } });
  assert.equal((await say(b.ctx, "!tirage")).why, "offline");
  const c = mk({ tw: { live: offline }, settings: { onlyWhenLive: false } });
  assert.equal((await say(c.ctx, "!tirage")).entered, true);
  assert.equal((await say(mk({ tw: { mainStatus: "none" } }).ctx, "!tirage")).why, "not_ready");
  assert.equal((await say(mk().ctx, "!tirage", { broadcasterId: "999" })).why, "not_ready");
  for (const over of [{ foreign: true }, { login: "nightbot" }]) assert.equal((await say(mk().ctx, "!tirage", over)).why, "ignored");
  const own = mk(); S.rememberSent(own.ctx, "own"); assert.equal((await say(own.ctx, "!tirage", { messageId: "own" })).why, "ignored");
});

test("jamais d'erreur visible ni de blocage : service absent, qui plante, qui ne répond pas (1,5 s), ou dont l'inscription est refusée (toutes les raisons du contrat)", async () => {
  D.resetDrawMemory();
  assert.equal((await say(world().ctx, "!tirage")).why, "closed", "pas de service : rien, sans erreur");
  const boom = mk(); boom.f.methods.status = () => { throw new Error("secret interne"); };
  assert.equal((await say(boom.ctx, "!tirage")).entered, false);
  for (const reason of ["closed", "muted", "already", "invalid", "full", "level"]) {
    const w = mk(); w.f.methods.enter = async () => ({ ok: false, reason });
    assert.equal((await say(w.ctx, "!tirage")).entered, true, `la réponse « ${reason} » est ignorée`);
    assert.equal(w.tw.chat.length, 0, "jamais de message dans le chat");
  }
  const muted = mk(); muted.f.d.mute("twitch", "ada");
  assert.equal((await say(muted.ctx, "!tirage", { login: "ada", chatterId: "9" })).entered, true);
  const throws = mk(); throws.f.methods.enter = () => { throw new Error("x"); };
  assert.equal((await say(throws.ctx, "!tirage")).entered, true);
  const slow = mk(); slow.f.methods.status = () => new Promise(() => {});
  const t0 = Date.now();
  assert.equal((await say(slow.ctx, "!tirage")).entered, false); assert.ok(Date.now() - t0 < 2500, "borné à 1,5 s");
  const slowEnter = mk(); slowEnter.f.methods.enter = () => new Promise(() => {});
  const t1 = Date.now();
  assert.equal((await say(slowEnter.ctx, "!tirage")).entered, true); assert.ok(Date.now() - t1 < 2500, "l'inscription aussi est bornée");
});

test("mémoire bornée à 5 000 personnes ; rien de ce que les gens écrivent n'est gardé par le bot", async () => {
  const { ctx, f } = mk();
  for (let i = 0; i < 5100; i++) await say(ctx, "!tirage", { chatterId: `p${i}`, login: `p${i}`, name: `P${i}` });
  assert.equal(f.entries.length, D.DRAW_LIMITS.maxEntered);
  assert.equal((await say(ctx, "!tirage", { chatterId: "tard" })).why, "full");
  assert.ok(!JSON.stringify(await ctx.dumpStore()).includes("p42"), "aucun pseudo dans le stockage du bot");
  assert.ok(!(await ctx.dumpStore()).some((r) => /draw|entr/i.test(r.collection)), "aucun stockage de tirage");
});

test("par le webhook : un message du chat est transmis au tirage (le bot ne répond pas)", async () => {
  const { ctx, f, tw } = mk();
  const secret = await S.ensureSecret(ctx);
  const es = await import("../modules/twitch-bot/eventsub.mjs");
  const { createHmac } = await import("node:crypto");
  const b = JSON.stringify({ subscription: { type: es.TYPE, status: "enabled" }, event: { broadcaster_user_id: "100", chatter_user_id: "777", chatter_user_login: "ada", chatter_user_name: "Ada", message_id: "wm1", message: { text: "!tirage" }, message_type: "text", badges: [{ set_id: "subscriber" }] } });
  const ts = new Date(NOW).toISOString();
  const req = new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers: new Headers({ "twitch-eventsub-message-id": "wh1", "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": "notification", "twitch-eventsub-message-signature": `sha256=${createHmac("sha256", secret).update(`wh1${ts}${b}`).digest("hex")}` }), body: b });
  const { done } = await W.handle(req, ctx, { now: NOW }); await done;
  assert.deepEqual(f.entries, [{ pseudo: "Ada", platform: "twitch", login: "ada", role: "sub" }]);
  assert.equal(tw.chat.length, 0);
});

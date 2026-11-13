// Twitch bot 1.17.0: word triggers ("quoi" gets "Feur") and "On stream" media for commands, through the service `alerts.show` of the alerts overlay.
import test from "node:test";
import assert from "node:assert/strict";
import { world, C, S, E, NOW, chat, sent, logOf, SRC } from "./helpers/botWorld.mjs";

const W = await import("../modules/twitch-bot/words.mjs");
const M = await import("../modules/twitch-bot/media.mjs");

/** A fake alerts overlay: a library of three files and a record of what was asked to show. */
function overlay(extra = {}) {
  const shown = [];
  const items = [{ id: "m1", name: "Applause", kind: "picture" }, { id: "m2", name: "Ding", kind: "sound" }, { id: "video:1", name: "Video 1", kind: "video" }, { id: "tone:bell", name: "Bell", kind: "sound", builtin: true }];
  return { shown, items, svc: { "alerts.show": { list: () => ({ items }), show: (a) => { shown.push(a); return extra.show ? extra.show(a) : { ok: true, state: "shown" }; } } } };
}
const env = (w, ov) => ({ src: SRC.noSources(), t: w.ctx.t, prefix: "!", library: () => M.library(w.ctx) });
async function setup(o = {}, triggers = [{ words: "quoi", text: "Feur" }], ovo = overlay()) {
  const w = world({ services: ovo.svc, ...o });
  for (const t of triggers) { const r = await W.saveWord(w.ctx, {}, t, env(w)); assert.ok(r.ok, JSON.stringify(r)); }
  return { ...w, ov: ovo };
}
const say = (w, text, over = {}, now = NOW, extra = {}) => E.processChat(w.ctx, chat(text, over), { now, ...extra });

test("matching: whole words only, case, accents, punctuation, links; 'contains' mode folded", () => {
  const m = (text, w = { words: ["quoi"], mode: "whole" }) => W.matches(w, W.prepare(text));
  for (const ok of ["quoi", "QUOI", "Quoi ?!", "quoi,", "tu dis quoi ?", "quoi quoi", "« quoi »", "t'as dit quoi.", "quoi😀"]) assert.ok(m(ok), ok);
  for (const no of ["quoicoubeh", "quoiii", "pourquoi", "", "https://quoi.example.org/x", "www.quoi.fr", "qu oi"]) assert.ok(!m(no), no);
  assert.ok(m("QUOÏ", { words: ["quoi"], mode: "whole" }), "accents ignored");
  assert.ok(m("bon courage a tous", { words: ["bon courage"], mode: "whole" }), "a phrase is a run of whole words");
  assert.ok(!m("courage bon", { words: ["bon courage"], mode: "whole" }));
  assert.ok(m("quoicoubeh", { words: ["quoi"], mode: "contains" }) && m("pourquoi", { words: ["quoi"], mode: "contains" }));
  assert.ok(m("ça va", { words: ["ca"], mode: "whole" }));
});

test("words list: one to five, no regex characters, taken words refused, either a reply or a media", async () => {
  assert.deepEqual(W.parseWords("quoi, Koi ,quoi").words, ["quoi", "Koi"]);
  for (const bad of ["", " , ", "a|b", ".*", "x".repeat(41), "un deux trois quatre cinq"]) assert.ok(W.parseWords(bad).error, bad);
  assert.equal(W.parseWords("a,b,c,d,e,f").error.code, "words_many");
  const w = await setup();
  assert.equal((await W.saveWord(w.ctx, {}, { words: "Quoi", text: "x" }, env(w))).code, "word_taken");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "salut" }, env(w))).code, "reply_or_media");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "salut", text: "{inconnu}" }, env(w))).code, "text_unknown");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "salut", text: "{1}" }, env(w))).code, "text_unknown", "no pieces about words typed after a command");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "salut", text: "x", chance: 99 }, env(w))).code, "chance");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "salut", text: "x", cdUser: -1 }, env(w))).code, "delay");
  assert.ok((await W.saveWord(w.ctx, {}, { words: "salut", text: "Hello {utilisateur}", chance: 3, role: "subscribers", mode: "contains" }, env(w))).ok);
});

test("a word answers in the chat like a command (same send path), with the viewer's name", async () => {
  const w = await setup({}, [{ words: "quoi", text: "Feur {utilisateur}" }]);
  const r = await say(w, "mais quoi ?", { name: "Camille" });
  assert.deepEqual([r.handled, r.result], [true, "sent"]);
  assert.deepEqual(sent(w.tw), ["Feur Camille"]);
  assert.equal((await logOf(w.ctx))[0].command, "💬 quoi");
  const n = await say(w, "quoicoubeh", {}, NOW + 200_000);
  assert.equal(n.handled, false); assert.equal(sent(w.tw).length, 1);
});

test("guards: own message, other bots, commands, another channel, shared chat, echo of the bot's own text, bot account", async () => {
  const w = await setup();
  S.rememberSent(w.ctx, "mine");
  for (const [text, over] of [["quoi", { messageId: "mine" }], ["quoi", { login: "nightbot" }], ["!quoi", {}], ["!inconnue quoi", {}], ["quoi", { broadcasterId: "999" }], ["quoi", { foreign: true }]]) {
    const r = await say(w, text, over, NOW + Math.random());
    assert.ok(!(r.handled && r.result === "sent"), `${text} ${JSON.stringify(over)}`);
  }
  assert.equal(sent(w.tw).length, 0);
  S.rememberSaid(w.ctx, "Feur quoi", NOW);
  assert.equal((await say(w, "feur quoi", {}, NOW + 1000)).handled, false, "echo");
  const b = await setup({ settings: { replyAs: "bot" }, tw: { botStatus: "ok", botScopes: ["user:write:chat", "user:bot"] } });
  assert.notEqual((await say(b, "quoi", { chatterId: "555" }, NOW + 5)).result, "sent", "the account that speaks for the bot never triggers");
});

test("guards: emergency stop, only while live, who may trigger, rate valve, cooldowns (trigger and person), 1 out of N with a seeded random", async () => {
  let w = await setup();
  await S.setMuted(w.ctx, true);
  assert.equal((await say(w, "quoi")).reason, "muted"); assert.equal(sent(w.tw).length, 0);
  w = await setup({ tw: { live: { channel: "emma", configured: true, known: true, live: false } } });
  assert.equal((await say(w, "quoi")).reason, "offline");
  w = await setup({ settings: { onlyWhenLive: false }, tw: { live: { channel: "emma", configured: true, known: true, live: false } } });
  assert.equal((await say(w, "quoi")).result, "sent", "the setting is reused");
  w = await setup({}, [{ words: "quoi", text: "Feur", role: "mods" }]);
  assert.equal((await say(w, "quoi")).reason, "role");
  assert.equal((await say(w, "quoi", { badges: ["moderator"] }, NOW + 1)).result, "sent");
  w = await setup({}, [{ words: "quoi", text: "Feur", cdGlobal: 30, cdUser: 60 }]);
  assert.equal((await say(w, "quoi", { chatterId: "1" }, NOW)).result, "sent");
  assert.equal((await say(w, "quoi", { chatterId: "2" }, NOW + 10_000)).reason, "cooldown");
  assert.equal((await say(w, "quoi", { chatterId: "2" }, NOW + 31_000)).result, "sent");
  assert.equal((await say(w, "quoi", { chatterId: "1" }, NOW + 40_000)).reason, "cooldown", "same person: 60 s");
  assert.equal((await say(w, "quoi", { chatterId: "1" }, NOW + 95_000)).result, "sent");
  // one time out of 3, seeded
  w = await setup({}, [{ words: "quoi", text: "Feur", chance: 3, cdGlobal: 0, cdUser: 0 }]);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const results = []; for (let i = 0; i < 30; i++) results.push((await say(w, "quoi", {}, NOW + i * 1000, { random: rnd })).result ?? "no");
  const n = results.filter((x) => x === "sent").length; assert.ok(n >= 4 && n <= 16, `about 1 in 3: ${n}`);
  assert.deepEqual(results.filter((x) => x === "sent").length, sent(w.tw).length);
  // valve: 6 per minute for the whole bot, whatever the triggers
  w = await setup({}, [{ words: "a1", text: "A", cdGlobal: 0, cdUser: 0 }]);
  const out = []; for (let i = 0; i < 9; i++) out.push((await say(w, "a1", { chatterId: `u${i}` }, NOW + i * 1000)).reason ?? "ok");
  assert.equal(out.filter((x) => x === "ok").length, 6); assert.ok(out.slice(6).every((x) => x === "rate"));
  assert.equal((await logOf(w.ctx)).filter((e) => e.reason === "rate").length, 3);
  assert.equal((await say(w, "a1", { chatterId: "late" }, NOW + 61_000)).result, "sent", "the minute is over");
});

test("collaboration mode: word triggers are quiet unless the trigger says otherwise; commands still answer", async () => {
  const w = await setup({}, [{ words: "quoi", text: "Feur" }, { words: "hello", text: "Hi", collab: true }]);
  await (await import("../modules/twitch-bot/collab.mjs")).setOn(w.ctx, true, "admin", { now: NOW });
  assert.equal((await say(w, "quoi", {}, NOW + 1000)).reason, "quiet");
  assert.equal((await say(w, "hello", {}, NOW + 2000)).result, "sent");
  assert.equal(sent(w.tw).length, 1);
});

test("a word with a media only writes nothing in the chat; with a reply, it shows after the reply; the chat never depends on the screen", async () => {
  const ov = overlay();
  let w = await setup({}, [{ words: "applause", media: { visual: "m1", sound: "m2", seconds: 8 } }], ov);
  const r = await say(w, "applause !");
  assert.equal(r.result, "sent"); assert.equal(sent(w.tw).length, 0);
  assert.deepEqual(ov.shown, [{ visual: "m1", sound: "m2", seconds: 8 }]);
  const ov2 = overlay({ show: () => ({ ok: false, code: "missing" }) });
  w = await setup({}, [{ words: "quoi", text: "Feur", media: { visual: "m1" } }], ov2);
  assert.equal((await say(w, "quoi")).result, "sent"); assert.deepEqual(sent(w.tw), ["Feur"]);
  const down = world({});
  assert.deepEqual((await M.library(down.ctx)).available, false);
  assert.equal((await W.saveWord(down.ctx, {}, { words: "quoi", text: "x", media: { visual: "m1" } }, { src: SRC.noSources(), t: down.ctx.t, prefix: "!" })).code, "media_absent");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "zz", text: "x", media: { visual: "m2" } }, env(w))).code, "media_missing", "a sound is not a picture");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "zz", text: "x", media: { visual: "m1", seconds: 1 } }, env(w))).code, "media_seconds");
  assert.equal((await W.saveWord(w.ctx, {}, { words: "zz", text: "x", media: { sound: "tone:bell" } }, env(w))).ok, true);
});

test("a command with On stream: answers, then shows; saved through the same checks", async () => {
  const ov = overlay(); const w = world({ services: ov.svc });
  const e = env(w);
  const r = await C.saveCommand(w.ctx, { kind: "custom" }, { name: "merci", text: "Merci", media: { visual: "video:1" } }, e);
  assert.ok(r.ok);
  assert.equal((await say(w, "!merci", {}, NOW)).result, "sent");
  assert.deepEqual(ov.shown, [{ visual: "video:1" }]);
  assert.equal((await C.saveCommand(w.ctx, { kind: "custom", id: r.key.slice(7) }, { media: null }, e)).ok, true);
  await say(w, "!merci", { chatterId: "9" }, NOW + 100_000);
  assert.equal(ov.shown.length, 1, "cleared");
  assert.equal((await C.saveCommand(w.ctx, { kind: "custom" }, { name: "x", text: "x", media: { visual: "nope" } }, e)).code, "media_missing");
});

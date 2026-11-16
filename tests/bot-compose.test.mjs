// Twitch bot 1.21.0 + Alerts overlay 1.16.0: "Place the text" on the pictures and videos a command or a word shows. The bot's window offers the core's editor
// with the bot's automatic values (who typed the command, the first word after it, every word after it); the overlay keeps the placements (service
// `alerts.show` version 3: `place`, `compositions`, `forget`, and `show` with `place`, `vars`, `text`); the bot draws nothing. Without the overlay (or with
// an older one) nothing changes. The two modules talk through the overlay's REAL service code; the fake context is the core's own (real composition kit).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world, say, sent as chatSent } from "./helpers/botWorld.mjs";
import { dialogsOf } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const A = await import("../modules/twitch-bot/admin.mjs");
const BM = await import("../modules/twitch-bot/media.mjs");
const C = await import("../modules/twitch-bot/commands.mjs");
const W = await import("../modules/twitch-bot/words.mjs");
const botTools = (await import("../modules/twitch-bot/tools.mjs")).default;
const md = await import("../modules/alerts-overlay/media.mjs");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const cp = await import("../modules/alerts-overlay/compose.mjs");
const cm = await import("../modules/alerts-overlay/compose-mcp.mjs");
const alDef = (await import("../modules/alerts-overlay/index.mjs")).default;
const alMan = JSON.parse(fs.readFileSync(new URL("../modules/alerts-overlay/module.json", import.meta.url), "utf8"));
const alEn = JSON.parse(fs.readFileSync(new URL("../modules/alerts-overlay/locales/en.json", import.meta.url), "utf8"));
const botEn = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/locales/en.json", import.meta.url), "utf8"));
const botFr = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/locales/fr.json", import.meta.url), "utf8"));
const COMPOSE = !!fakeCtx({ key: "probe" }).overlay;
const skip = COMPOSE ? false : "core before 0.19.0";

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const PIC = U(1, "png"), GIF = U(2, "gif"), VID = U(3, "webm");
let n = 0;
/** A bot and an overlay talking through the real service code of the overlay; `version` is the overlay's alerts.show version. */
async function both({ version = 3 } = {}) {
  tw.resetTwitchState(); md.resetValve(); cp.resetComposeCache();
  const al = fakeCtx({ key: `bc${++n}`, moduleId: "alerts-overlay", locale: "en", messages: alEn, settings: { pushToken: "x" }, permissions: alMan.permissions, uploads: [PIC, GIF, VID].map((url) => ({ url, by: "u1" })) });
  const shown = [];
  const svc = alDef.services["alerts.show"];
  const w = world({ locale: "en" });
  const base = w.ctx.api.services;
  w.ctx.api.services = { ...base,
    providers: async (name) => (name === "alerts.show" ? [{ id: "id-al", key: al.instance.key, name: "Alerts", module: "alerts-overlay", version, each: true, master: true }] : base.providers(name)),
    call: async (name, method, args, opts) => {
      if (name !== "alerts.show") return base.call(name, method, args, opts);
      if (version < 3 && ["place", "compositions", "forget"].includes(method)) return { ok: false, reason: "no_method" };
      if (!svc[method]) return { ok: false, reason: "no_method" };
      const value = await svc[method](al, version < 3 && method === "show" ? (({ place, vars, text, label, variables, ...rest }) => rest)(args) : args);
      if (method === "show") shown.push({ args });
      return { ok: true, value };
    } };
  await svc.add(al, { items: [{ src: PIC, label: "Applause" }, { src: GIF, label: "Confetti" }, { src: VID, label: "Burst" }] });
  // what the overlay sends to its page
  const out = [];
  const orig = tw.showOrHold;
  return { al, bot: w.ctx, tw: w.tw, w, shown, out, orig };
}
const comp = (src, boxes, extra = {}) => ({ v: 1, backdrop: { src }, boxes, ...extra });
const gal = (...items) => JSON.stringify(items);
const botKey = (b) => b.bot.instance.key;

test("texts: the bot's new words in English and French, short, no braces", () => {
  for (const k of ["media_var_user", "media_var_target", "media_var_args", "media_compose_phrase", "media_compose_sample", "media_compose_err"]) {
    assert.ok(botEn[k] && botFr[k], k);
    assert.doesNotMatch(botEn[k] + botFr[k], /[{}]/, k);
  }
  assert.deepEqual(Object.keys(botEn).sort(), Object.keys(botFr).sort());
  const o = alMan.offers.find((x) => x.service === "alerts.show");
  assert.equal(o.version, 3);
  assert.ok(o.readOnly.includes("compositions"));
});

test("the window of a command offers Place the text with the bot's values; a word offers the name only; an older overlay: no option", { skip }, async () => {
  const b = await both();
  assert.ok((await A.actions.create(b.bot, { name: "merci", text: "Merci {utilisateur}", mediaFiles: gal({ src: PIC }) })).ok);
  const page = await A.panel(b.bot, { query: { new: "1" } });
  const g = dialogsOf(page)[0].fields.find((x) => x.name === "mediaFiles");
  assert.deepEqual(g.compose.variables.map((v) => [v.token, v.label]), [["user", "Name"], ["target", "Target"], ["args", "Words after the command"]]);
  assert.equal(g.compose.phrase.label, "The bot's answer");
  assert.equal(g.compose.video, (b.al.overlay.features ?? []).includes("video") ? true : undefined);
  assertAdminPageErgonomics(page);
  const wp = await A.panel(b.bot, { query: { new: "word" } });
  const wg = dialogsOf(wp)[0].fields.find((x) => x.name === "mediaFiles");
  assert.deepEqual(wg.compose.variables.map((v) => v.token), ["user"]);
  const old = await both({ version: 2 });
  const og = dialogsOf(await A.panel(old.bot, { query: { new: "1" } }))[0].fields.find((x) => x.name === "mediaFiles");
  assert.equal(og.compose, undefined, "an overlay before 1.16.0: the gallery as before");
});

test("save: the placed texts go to the overlay under the command's place; a bad one is refused under the gallery and nothing is saved; delete forgets them", { skip }, async () => {
  const b = await both();
  const good = comp(PIC, [{ id: "t1", content: { kind: "custom", text: "Merci {user} → {target}" } }]);
  const bad = await A.actions.create(b.bot, { name: "bravo", text: "Bravo", mediaFiles: gal({ src: PIC, compose: comp(PIC, [{ id: "t1", content: { kind: "custom", text: "{amount}" } }]) }), mediaFiles__compose: "1" });
  assert.ok(bad.errors?.mediaFiles, JSON.stringify(bad));
  assert.equal(((await C.loadConfig(b.bot)).data.custom ?? []).some((c) => c.name === "bravo"), false, "nothing saved");
  const r = await A.actions.create(b.bot, { name: "merci", text: "Merci {utilisateur}", mediaFiles: gal({ src: PIC, compose: good }, { src: GIF }), mediaFiles__compose: "1" });
  assert.ok(r.ok, JSON.stringify(r));
  const cmd = (await C.loadConfig(b.bot)).data.custom.find((c) => c.name === "merci");
  const place = `show:${botKey(b)}:custom:${cmd.id}`;
  assert.deepEqual(Object.keys(await cp.forPlace(b.al, place)), [PIC]);
  const decl = await cp.showPlace(b.al, place);
  assert.deepEqual([decl.label, decl.files, decl.variables, decl.phrase], ["!merci", [PIC, GIF], ["user", "target", "args"], "Merci {utilisateur}"]);
  // the edit window shows it again on its file
  const page = await A.panel(b.bot, { query: { edit: `custom:${cmd.id}` } });
  const g = dialogsOf(page).flatMap((d) => d.fields ?? []).find((x) => x.name === "mediaFiles");
  assert.ok(g, "the edit window has the gallery");
  assert.equal(JSON.parse(g.value).find((x) => x.src === PIC).compose.boxes[0].content.text, "Merci {user} → {target}");
  // an older core form (no mark): the placed texts stay as they are
  assert.ok((await A.actions.save(b.bot, { key: `custom:${cmd.id}`, id: `custom:${cmd.id}`, name: "merci", text: "Merci {utilisateur}", mediaFiles: gal({ src: PIC }, { src: GIF }) })).ok);
  assert.deepEqual(Object.keys(await cp.forPlace(b.al, place)), [PIC]);
  // deleted: forgotten
  assert.ok((await A.actions.remove(b.bot, { id: `custom:${cmd.id}` })).ok);
  assert.deepEqual(await cp.forPlace(b.al, place), {});
  assert.equal(await cp.showPlace(b.al, place), null);
});

test("on stream: the command's picture shows with its text filled by the bot's values (who typed it, the first word after it); the bot draws nothing", { skip }, async () => {
  const b = await both();
  const r = await A.actions.create(b.bot, { name: "merci", text: "Merci {utilisateur}", mediaFiles: gal({ src: PIC, compose: comp(PIC, [{ id: "t1" }, { id: "t2", y: 5, h: 15, content: { kind: "custom", text: "{user} → {target}" } }]) }), mediaFiles__compose: "1" });
  assert.ok(r.ok, JSON.stringify(r));
  const events = [];
  const bus = globalThis.__curiosaAlertsBus, on = (e) => events.push(e);
  bus.on(b.al.instance.key, on);
  try {
    await say(b.bot, "!merci @lune_douce", { name: "etoile_nord", login: "etoile_nord" });
    await new Promise((ok) => setTimeout(ok, 20));
  } finally { bus.off(b.al.instance.key, on); }
  assert.ok(chatSent(b.tw).some((m) => m.includes("Merci etoile_nord")), JSON.stringify(chatSent(b.tw)));
  const show = b.shown.find((x) => x.args.place);
  assert.ok(show, JSON.stringify(b.shown));
  assert.deepEqual(show.args.vars, { user: "etoile_nord", target: "lune_douce", args: "@lune_douce" });
  const alert = events.find((e) => e.image === PIC);
  assert.ok(alert?.compose, JSON.stringify(events));
  assert.deepEqual(alert.compose.boxes.map((x) => x.text), ["Merci etoile_nord", "etoile_nord → lune_douce"]);
  assert.ok(alert.compose.boxes.every((x) => !("content" in x)), "filled texts only");
});

test("a word, an older overlay, a video length; the assistant sees the bot's places and places text there", { skip }, async () => {
  const b = await both();
  const r = await A.actions.createWord(b.bot, { words: "gg", text: "", mediaFiles: gal({ src: VID }), mediaFiles__compose: "1" });
  assert.ok(r.ok, JSON.stringify(r));
  const word = (await C.loadConfig(b.bot)).data.words[0];
  const place = `show:${botKey(b)}:word:${word.id}`;
  // the assistant: the place is listed with the bot's values, and composition_set works there
  const tools = alDef.mcp;
  const listed = (await tools.composition_places(b.al, { kind: "show" })).places;
  const p = listed.find((x) => x.place === place);
  assert.ok(p, JSON.stringify(listed));
  assert.deepEqual(p.automaticValues.map((v) => v.token), ["{user}"]);
  if ((b.al.overlay.features ?? []).includes("video")) {
    const set = await tools.composition_set(b.al, { place, src: VID, composition: JSON.stringify(comp(VID, [{ id: "t1", content: { kind: "custom", text: "GG {user}" } }], { backdrop: { src: VID, play: "once" }, duration: { mode: "fixed", seconds: 9 } })) }, { name: "Camille assistant" });
    assert.equal(set.saved, true);
    // plain words with a core that explains (0.25.0), the path and the code with an older one
    await assert.rejects(tools.composition_set(b.al, { place, src: VID, composition: JSON.stringify(comp(VID, [{ id: "t1", content: { kind: "custom", text: "{target}" } }])) }, { name: "x" }), b.al.overlay.explainErrors ? /uses \{target\}; this place knows \{user\}/ : /boxes\[0\]\.content\.text: variable/);
    const events = [], on = (e) => events.push(e);
    globalThis.__curiosaAlertsBus.on(b.al.instance.key, on);
    try { await say(b.bot, "gg", { name: "lune_douce", login: "lune_douce" }); await new Promise((ok) => setTimeout(ok, 20)); } finally { globalThis.__curiosaAlertsBus.off(b.al.instance.key, on); }
    const alert = events.find((e) => e.video === VID);
    assert.ok(alert?.compose, JSON.stringify(events));
    assert.deepEqual([alert.compose.boxes[0].text, alert.duration], ["GG lune_douce", 9]);
  }
  // the bot's tool lists where to place text
  const list = await botTools.bot_commands_list(b.bot, { kind: "word" });
  assert.equal(list.commands[0].screenPlace, place);
  // an older overlay (version 2): the bot sends exactly what it sent before, the overlay shows the media alone
  const old = await both({ version: 2 });
  assert.ok((await A.actions.create(old.bot, { name: "salut", text: "Salut", mediaFiles: gal({ src: PIC }) })).ok);
  await say(old.bot, "!salut", { name: "etoile_nord", login: "etoile_nord" });
  const s = old.shown.at(-1);
  assert.ok(s, "shown");
  assert.equal(s.args.place !== undefined, true, "the bot always says where; an older overlay ignores it");
});

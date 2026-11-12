// Alerts overlay 1.6.0: what a type shows (text, picture alone, video alone), the texts of viewers, the voice (speech synthesis of the overlay page), the basic moderation,
// the controls of the dock, the tools for assistants. Invented names only. The browser is a fake one with a fake speechSynthesis.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const mod = await import("../modules/alerts-overlay/moderation.mjs");
const def = (await import("../modules/alerts-overlay/index.mjs")).default;
const NOW = Date.parse("2026-11-12T20:00:00Z");
const UUID = "0123456789abcdef0123456789abcdef0123";
const GIF = `/uploads/${UUID}.gif`, MP4 = `/uploads/${UUID.replace(/^0/, "1")}.mp4`;
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
let n = 0, seq = 0;
const item = (type, o = {}) => ({ id: `v${++seq}`, type, at: new Date(NOW - 1000).toISOString(), ...o });
function world({ settings = {}, locale = "en", items = [], flags = [] } = {}) {
  const key = `vo${++n}`, state = { items };
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0, ...settings }, instances: HERE, topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions,
    services: { "twitch.journal": { flag: (a) => { flags.push(a); return { ok: true }; } } } });
  return { key, ctx, state, flags };
}
const query = () => new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "en", "ov-text": "light", "opt-kinds": "channel" });
const envOf = (ctx, config, extra = {}) => ({ config, ignore: new Set(), showText: false, locale: "en", text: (k) => ctx.t(`tw_text_${k}`), title: (p) => ctx.t(`tw_title_${p}`), seconds: 0, baseSeconds: 6, videos: [], now: NOW, ...extra });

test("moderation: links, capitals, repeats, blocked words (case, accents, simple look-alikes); an empty list blocks nothing", () => {
  const rules = { words: mod.wordsOf("Zörblax, qwertyuiop"), links: true, caps: true, repeats: true };
  assert.deepEqual(rules.words, ["zorblax", "qwertyuiop"]);
  assert.equal(mod.flag("hello and thanks", rules), null);
  assert.equal(mod.flag("you are a ZORBLAX", rules), "word");
  assert.equal(mod.flag("z0rbl@x", rules), "word", "look-alike symbols undone");
  assert.equal(mod.flag("z.o.r.b.l.a.x", rules), "word", "spread out letters");
  assert.equal(mod.flag("see https://elsewhere.example.org/x", rules), "link");
  assert.equal(mod.flag("visit www.example.com", rules), "link");
  assert.equal(mod.flag("version 1.5 is fine, 3.2 too", rules), null, "numbers are not links");
  assert.equal(mod.flag("THIS IS ALL CAPITAL LETTERS", rules), "caps");
  assert.equal(mod.flag("OK GG", rules), null, "short texts are left alone");
  assert.equal(mod.flag("aaaaaaaaaa", rules), "repeat"); assert.equal(mod.flag("go go go go go", rules), "repeat");
  assert.equal(mod.flag("zorblax https://x.example.org", { ...rules, links: false, words: [] }), null, "each rule can be off");
  assert.deepEqual(mod.wordsOf(""), []); assert.equal(mod.flag("anything goes", { words: [], links: false, caps: false, repeats: false }), null);
  assert.equal(mod.cut("x".repeat(300), 100).length <= 100, true);
});

test("config: default word list is empty, structural rules on; the voice is off; viewer texts follow the older setting until chosen", () => {
  const c = tw.normaliseConfig({});
  assert.deepEqual(c.moderation.rules, { words: [], links: true, caps: true, repeats: true }); assert.equal(c.moderation.hold, false);
  assert.equal(c.tts.on, false); assert.equal(c.types.cheer.tts, "off"); assert.equal(c.types.cheer.viewer, null); assert.equal(c.types.follow.viewer, false);
  const b = tw.normaliseConfig({ tts: { rate: 99, pitch: -1, volume: 500, max: 5, lang: "xx yy", voice: "x".repeat(300) }, types: { cheer: { present: "nope", video: 9, tts: "loud", viewerMax: 5000 } } });
  assert.deepEqual([b.tts.rate, b.tts.pitch, b.tts.volume, b.tts.max, b.tts.lang, b.tts.voice.length], [2, 0, 100, 20, "", 120]);
  assert.deepEqual([b.types.cheer.present, b.types.cheer.video, b.types.cheer.tts, b.types.cheer.viewerMax], ["text", 0, "off", 250]);
});

test("what a type shows: picture alone, video alone (site uploads only), and the viewer text only where asked", () => {
  const { ctx } = world();
  const config = tw.normaliseConfig({ tts: { on: true }, types: { follow: { present: "gif", image: GIF, sound: "chime" }, raid: { present: "video", video: 1, videoSound: true }, sub: { present: "video", video: 2 }, resub: { viewer: true }, cheer: { viewer: false } } });
  const videos = [MP4, ""];
  const env = envOf(ctx, config, { videos });
  const f = tw.alertFor(item("follow", { name: "Camille" }), env).alert;
  assert.deepEqual([f.present, f.image, f.sound, f.video], ["media", GIF, "chime", undefined], "GIF alone, with its sound");
  const r = tw.alertFor(item("raid", { name: "lune_douce", viewers: 9 }), env).alert;
  assert.deepEqual([r.present, r.video, r.videoSound], ["media", MP4, true], "video with its own sound");
  const s = tw.alertFor(item("sub", { name: "etoile_nord", tier: "1" }), env).alert;
  assert.ok(!s.present && !s.video, "a slot with no video falls back to the text");
  const a = tw.alertFor(item("resub", { name: "Camille", months: 3, text: "Thank you for the streams" }), env).alert;
  assert.equal(a.detail, "Thank you for the streams");
  assert.ok(!("detail" in tw.alertFor(item("cheer", { name: "Camille", amount: 100, text: "Cheer100 hello" }), env).alert), "off for this type");
  assert.ok(!("detail" in tw.alertFor(item("follow", { name: "Camille", text: "x" }), env).alert), "never for a type without text");
  const old = tw.alertFor(item("cheer", { name: "Camille", amount: 100, text: "Cheer100 hello" }), envOf(ctx, tw.normaliseConfig({}), { showText: true })).alert;
  assert.equal(old.detail, "Cheer100 hello", "the older setting still works until the type chooses");
  const long = tw.alertFor(item("resub", { name: "Camille", months: 3, text: Array.from({ length: 80 }, (_, i) => `w${i}x`).join(" ") }), envOf(ctx, tw.normaliseConfig({ types: { resub: { viewer: true, viewerMax: 40 } } }))).alert;
  assert.ok(long.detail.length <= 40);
});

test("voice: what is read (sentence, text, both), the name can be left out, nothing when off, the alert lasts as long as the reading", () => {
  const { ctx } = world();
  const cfgOf = (tts, t) => tw.normaliseConfig({ tts, types: { resub: { viewer: true, ...t } } });
  const it = item("resub", { name: "etoile_nord", months: 4, text: "Keep going" });
  assert.ok(!("say" in tw.alertFor(it, envOf(ctx, cfgOf({ on: true }, { tts: "both" }).constructor === Object ? cfgOf({ on: false }, { tts: "both" }) : null)).alert), "voice off: nothing is read");
  assert.ok(!("say" in tw.alertFor(it, envOf(ctx, cfgOf({ on: true }, { tts: "off" }))).alert), "type off: nothing is read");
  assert.equal(tw.alertFor(it, envOf(ctx, cfgOf({ on: true }, { tts: "sentence" }))).alert.say, "etoile_nord renews · 4 months");
  assert.equal(tw.alertFor(it, envOf(ctx, cfgOf({ on: true }, { tts: "text" }))).alert.say, "Keep going");
  assert.equal(tw.alertFor(it, envOf(ctx, cfgOf({ on: true }, { tts: "both" }))).alert.say, "etoile_nord renews · 4 months. Keep going");
  assert.equal(tw.alertFor(it, envOf(ctx, cfgOf({ on: true, readName: false }, { tts: "sentence" }))).alert.say, "someone renews · 4 months");
  const slow = tw.alertFor(it, envOf(ctx, cfgOf({ on: true, max: 300 }, { tts: "both", viewerMax: 250 }))).alert;
  assert.ok(slow.duration >= 6);
  const cut = tw.alertFor(it, envOf(ctx, cfgOf({ on: true, max: 20 }, { tts: "both" }))).alert.say;
  assert.ok(cut.length <= 20);
});

test("moderation in the alert: refused text shows without text and its words are never read (default), or the whole alert waits; the journal is told", async () => {
  const w = world({ items: [item("resub", { name: "Camille", months: 2, text: "go to www.example.com now" }), item("resub", { name: "lune_douce", months: 3, text: "nice stream" })] });
  await tw.saveConfig(w.ctx, { tts: { on: true }, types: { resub: { viewer: true, tts: "both" } } });
  const got = []; const sent = await tw.pullTwitch(w.ctx, (a) => got.push(a), { ...def_env(w), now: NOW });
  assert.equal(sent, 2);
  assert.ok(!("detail" in got[0]) && got[0].flag === "link" && got[0].say === "Camille renews · 2 months", "no text; only the sentence is read, never the refused text");
  assert.equal(got[1].detail, "nice stream"); assert.match(got[1].say, /nice stream/);
  assert.deepEqual(w.flags.map((f) => [f.reason, f.state]), [["link", "hidden"]]);
  const list = await tw.textsList(w.ctx);
  assert.equal(list.length, 1); assert.equal(list[0].hold, false);
  // accepted anyway: the alert comes again with its text
  const again = []; const r = await tw.decideText(w.ctx, list[0].id, "accept", (a) => again.push(a));
  assert.equal(r.ok, true); assert.equal(again[0].detail, "go to www.example.com now"); assert.equal(again[0].approved, true);
  assert.equal((await tw.textsList(w.ctx)).length, 0); assert.equal((await tw.decideText(w.ctx, "nope", "accept", () => {})).ok, false);
  // hold mode
  const h = world({ items: [item("resub", { name: "Camille", months: 2, text: "https://x.example.org" })] });
  await tw.saveConfig(h.ctx, { moderation: { hold: true }, types: { resub: { viewer: true } } });
  const out = []; assert.equal(await tw.pullTwitch(h.ctx, (a) => out.push(a), { ...def_env(h), now: NOW }), 0, "nothing shown while it waits");
  const held = (await tw.textsList(h.ctx))[0]; assert.equal(held.hold, true); assert.deepEqual(h.flags.map((f) => f.state), ["held"]);
  await tw.decideText(h.ctx, held.id, "dismiss", (a) => out.push(a));
  assert.equal(out.length, 1); assert.ok(!("detail" in out[0]), "dismissed: the event is not lost, the text stays hidden");
});
function def_env(w) { return { t: w.ctx.t, locale: "en", seconds: 0, showText: false, ignore: new Set(), groupMs: 0, baseSeconds: 6, videos: [], onFlag: (it, reason, state) => w.flags.push({ id: it.id, reason, state }) }; }

test("controls: mute stops speech and keeps muted, voice on/off, stop, skip, all kept after a restart and obeyed through ctl", async () => {
  const w = world();
  await tw.saveConfig(w.ctx, { tts: { on: true, voice: "Voice A", rate: 1.2 } });
  const c0 = await tw.ctlOf(w.ctx);
  assert.deepEqual([c0.tts.on, c0.tts.muted, c0.tts.voice, c0.tts.rate], [true, false, "Voice A", 1.2]);
  await tw.setMuted(w.ctx, true); const c1 = await tw.ctlOf(w.ctx);
  assert.equal(c1.tts.muted, true); assert.ok(c1.stop > c0.stop, "the speech in progress is stopped");
  await tw.stopSpeech(w.ctx); assert.ok((await tw.ctlOf(w.ctx)).stop > c1.stop);
  const k = (await tw.ctlOf(w.ctx)).skip; await tw.skipAlert(w.ctx); assert.equal((await tw.ctlOf(w.ctx)).skip, k + 1);
  await tw.setVoiceOn(w.ctx, false); assert.equal((await tw.ctlOf(w.ctx)).tts.on, false);
  assert.equal((await tw.voiceState(w.ctx)).muted, true);
  tw.resetTwitchState();   // a restart: the memory is gone, the store stays
  assert.equal((await tw.ctlOf(w.ctx)).tts.muted, true, "still muted until unmuted");
  await tw.setMuted(w.ctx, false); assert.equal((await tw.voiceState(w.ctx)).muted, false);
  assert.deepEqual(Object.keys(def.services["alerts.queue"]).sort(), ["clear", "decide", "mute", "pause", "resume", "skip", "state", "stopSpeech", "texts", "voice", "voiceOn"]);
  assert.equal((await def.services["alerts.queue"].mute(w.ctx, { muted: true })).muted, true);
  const feed = await (await def.routes.feed(new Request("https://x.test/f?after=now&ctl=1"), w.ctx)).json();
  assert.equal(feed.ctl.tts.muted, true); const plain = await (await def.routes.feed(new Request("https://x.test/f?after=now"), w.ctx)).json(); assert.ok(!("ctl" in plain));
});

test("the page reports the voices it sees (bounded), and the administration shows the state in plain words", async () => {
  const w = world();
  const post = (body) => def.routes["tts-report"](new Request("https://x.test/r", { method: "POST", body: JSON.stringify(body) }), w.ctx);
  assert.equal((await def.routes["tts-report"](new Request("https://x.test/r"), w.ctx)).status, 405);
  assert.equal((await post({ supported: true, voices: Array.from({ length: 200 }, (_, i) => ({ n: `Voice ${i}`, l: "en-US" })) })).status, 200);
  assert.equal((await tw.loadReport(w.ctx)).voices.length, 60);
  assert.equal((await def.routes["tts-report"](new Request("https://x.test/r", { method: "POST", body: "x".repeat(9000) }), w.ctx)).status, 413);
  const tab = (blocks) => blocks.filter((b) => b.tab === "viewers");
  const banner = async () => tab(await def.adminPanel(w.ctx, { query: {} })).find((b) => b.type === "banner").text;
  assert.match(await banner(), /off/);
  await tw.saveConfig(w.ctx, { tts: { on: true } }); assert.match(await banner(), /60 voices/);
  await post({ supported: true, voices: [] }); assert.match(await banner(), /no voice/);
  await post({ supported: false, voices: [] }); assert.match(await banner(), /cannot read aloud/);
  const w2 = world(); await tw.saveConfig(w2.ctx, { tts: { on: true } });
  assert.match(tab(await def.adminPanel(w2.ctx, { query: {} })).find((b) => b.type === "banner").text, /No overlay page has reported/);
});

test("the page with a fake speechSynthesis: reads the sentence with the chosen voice, stops on mute, skip, and survives no voice or no support", async (t) => {
  let clock = NOW;
  t.mock.method(Date, "now", () => clock);
  const spoken = [], cancelled = { n: 0 };
  class Utter { constructor(text) { this.text = text; } }
  const synth = (voices) => ({ getVoices: () => voices, speak: (u) => spoken.push(u), cancel: () => { cancelled.n++; } });
  const run = async ({ voices, support = true, cfg = {} } = {}) => {
    spoken.length = 0; cancelled.n = 0;
    const w = world({ locale: "fr", settings: { durationSeconds: 5 } });
    await tw.saveConfig(w.ctx, { tts: { on: true, voice: "Voice B", ...cfg }, types: { follow: { tts: "sentence" } } });
    const out = await def.overlay(w.ctx, { query: query() });
    const posts = [];
    const globals = support ? { speechSynthesis: synth(voices), SpeechSynthesisUtterance: Utter } : {};
    const page = runOverlayPage(out, { dispatch: (url, o) => { if (url.includes("tts-report")) { posts.push(url); return def.routes["tts-report"](new Request(url, { method: "POST", body: "{}" }), w.ctx); } return def.routes.feed(new Request(url), w.ctx); }, globals });
    const adv = async (ms) => { clock += ms; await page.advance(ms); };
    await adv(10);
    return { w, page, adv, out, posts };
  };
  const { w, page, adv, out } = await run({ voices: [{ name: "Voice A", lang: "en-US" }, { name: "Voice B", lang: "fr-FR" }] });
  assert.match(out.script, /speechSynthesis/); assert.match(out.script, /tts-report/);
  w.state.items = [item("follow", { name: "Camille", at: new Date(clock - 1000).toISOString() })];
  await adv(2100);
  assert.equal(spoken.length, 1); assert.match(spoken[0].text, /Camille/); assert.equal(spoken[0].voice.name, "Voice B"); assert.equal(spoken[0].rate, 1);
  assert.equal(page.shown.length, 1);
  // mute from the dock: the speech stops at the next poll
  const before = cancelled.n; await tw.setMuted(w.ctx, true); await adv(1600); assert.ok(cancelled.n > before, "stopped at once");
  w.state.items.push(item("follow", { name: "etoile_nord", at: new Date(clock - 500).toISOString() })); await adv(6000);
  assert.equal(spoken.length, 1, "muted: the alert shows, nothing is read");
  assert.equal(page.shown.length, 2);
  // no voice at all: nothing is read, nothing breaks
  const n1 = await run({ voices: [] }); n1.w.state.items = [item("follow", { name: "Camille", at: new Date(clock - 500).toISOString() })]; await n1.adv(2100);
  assert.equal(n1.page.shown.length, 1); assert.equal(spoken[0].voice, undefined, "the language is left to the browser");
  // no speech support: the alert shows, no error
  const n2 = await run({ support: false }); n2.w.state.items = [item("follow", { name: "lune_douce", at: new Date(clock - 500).toISOString() })]; await n2.adv(2100);
  assert.equal(n2.page.shown.length, 1); assert.equal(spoken.length, 0);
  assert.equal((await tw.loadReport(n2.w.ctx)).supported, false, "the page said so");
});

test("the page: a GIF or a video of the site stands alone as a card part a skin can restyle; the skip counter ends the card on screen", async (t) => {
  let clock = NOW;
  t.mock.method(Date, "now", () => clock);
  const w = world({ settings: { video1: MP4 } });
  await tw.saveConfig(w.ctx, { types: { follow: { present: "gif", image: GIF }, raid: { present: "video", video: 1, videoSound: false } } });
  const out = await def.overlay(w.ctx, { query: query() });
  assert.match(out.script, /data-ov-part","media"/); assert.ok(!/https?:\/\//.test(out.script));
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx) });
  const adv = async (ms) => { clock += ms; await page.advance(ms); };
  await adv(10);
  w.state.items = [item("follow", { name: "Camille", at: new Date(clock - 500).toISOString() })]; await adv(2100);
  const card = page.stage.children[0];
  const m = card.all('[data-ov-part="media"]')[0];
  assert.equal(m.tagName, "IMG"); assert.equal(m.src, GIF);
  await tw.skipAlert(w.ctx); await adv(1700);
  assert.equal(page.stage.children.length, 0, "skipped: the card goes away");
  w.state.items.push(item("raid", { name: "lune_douce", viewers: 5, at: new Date(clock - 300).toISOString() })); await adv(2500);
  const v = page.stage.children[0].all('[data-ov-part="media"]')[0];
  assert.equal(v.tagName, "VIDEO"); assert.equal(v.src, MP4); assert.equal(v.muted, true);
});

test("the page without Twitch activity is the page of before: no voice, no media code", async () => {
  const bare = world(); bare.ctx.api.instances.list = async () => [];
  const o = await def.overlay(bare.ctx, { query: query() });
  assert.ok(!/speechSynthesis|tts-report|data-ov-part","media"|applyCtl/.test(o.script));
});

test("administration: the viewers tab passes the ergonomics kit (en, fr), saves the voice and the moderation with errors under the field, accepts or dismisses a text", async () => {
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["en", "fr"]) {
    const w = world({ locale, items: [item("resub", { name: "Camille", months: 2, text: "https://x.example.org" })] });
    await tw.saveConfig(w.ctx, { types: { resub: { viewer: true } } });
    await tw.pullTwitch(w.ctx, () => {}, { ...def_env(w), now: NOW });
    const A = def.adminActions;
    const errors = [];
    errors.push(...Object.values((await A.saveVoice(w.ctx, { on: "on", voice: "", rate: "9", volume: "50", pitch: "1", lang: "", max: "140" })).errors));
    errors.push(...Object.values((await A.saveVoice(w.ctx, { on: "on", voice: "", rate: "1", volume: "50", pitch: "1", lang: "english", max: "140" })).errors));
    errors.push((await A.testVoice(world({ locale }).ctx, {})).error);
    assert.ok((await A.saveVoice(w.ctx, { on: "on", voice: "", rate: "1.2", volume: "60", pitch: "1", lang: "fr", max: "100", readName: "" })).ok);
    const c = await tw.loadConfig(w.ctx, NOW + 20_000);
    assert.deepEqual([c.tts.on, c.tts.rate, c.tts.volume, c.tts.lang, c.tts.max, c.tts.readName], [true, 1.2, 60, "fr", 100, false]);
    assert.ok((await A.saveModeration(w.ctx, { hold: "hide", links: "on", caps: "", repeats: "on", words: "zorblax\nqwertyuiop" })).ok);
    const m = (await tw.loadConfig(w.ctx, NOW + 40_000)).moderation; assert.deepEqual([m.caps, m.rules.words.length], [false, 2]);
    errors.push(...Object.values((await A.saveModeration(w.ctx, { words: "x".repeat(4001) })).errors));
    const blocks = await def.adminPanel(w.ctx, { query: {} });
    const table = blocks.find((b) => b.type === "table" && b.tab === "viewers");
    assert.equal(table.searchable, true); assert.equal(table.rows.length, 1); assert.deepEqual(table.rowActions.map((x) => x.action), ["acceptText", "dismissText"]);
    assertAdminPageErgonomics(blocks, { errors });
    const id = table.rowIds[0], got = []; globalThis.__curiosaAlertsBus.on(w.key, (e) => got.push(e));
    assert.ok((await A.acceptText(w.ctx, { id })).ok); assert.equal(got[0].detail, "https://x.example.org"); assert.ok((await A.dismissText(w.ctx, { id })).error, "already decided");
    assertAdminPageErgonomics(await def.adminPanel(w.ctx, { query: { edit: "resub" } }));
    const empty = await def.adminPanel(w.ctx, { query: {} }); assert.ok(empty.some((b) => b.tab === "viewers" && b.type === "markdown" && /No text|Aucun texte/.test(b.text)), "empty state says what to do");
  }
});

test("administration: a type shows a video only if the slot holds one, a picture alone needs a picture, bounds explained", async () => {
  const w = world({ settings: { video2: MP4 } });
  const save = (v) => def.adminActions.saveType(w.ctx, { id: "raid", template: "", seconds: "", sound: "none", anim: "", image: "", ...v });
  assert.ok((await save({ present: "video", video: "1" })).errors.video); assert.ok((await save({ present: "video" })).errors.video);
  assert.ok((await save({ present: "gif" })).errors.image);
  assert.ok((await save({ present: "video", video: "2", videoSound: "on" })).ok);
  const c = (await tw.loadConfig(w.ctx, NOW + 30_000)).types.raid; assert.deepEqual([c.present, c.video, c.videoSound], ["video", 2, true]);
  assert.ok((await save({ present: "", video: "", tts: "sentence" })).ok);
  assert.equal((await save({ tts: "loud" })).errors.tts !== undefined, true);
  const dlg = (await def.adminPanel(w.ctx, { query: { edit: "raid" } })).find((b) => b.presentation === "dialog");
  assert.deepEqual(dlg.fields.find((f) => f.name === "video").options.map((o) => o.value), ["", "2"], "only the videos that exist are offered");
});

test("tools for assistants: read the voice and moderation, change them (bounded), decide on a held text; write tools are off by default and never delete", async () => {
  const w = world({ items: [item("resub", { name: "Camille", months: 2, text: "www.example.com" })] });
  await tw.saveConfig(w.ctx, { types: { resub: { viewer: true } } });
  await tw.pullTwitch(w.ctx, () => {}, { ...def_env(w), now: NOW });
  const g = await def.mcp.voice_moderation_get(w.ctx);
  assert.equal(g.voice.on, false); assert.equal(g.moderation.blockedWordsCount, 0); assert.equal(g.flagged.length, 1); assert.equal(g.flagged[0].reason, "link");
  const u = await def.mcp.voice_moderation_update(w.ctx, { on: true, rate: 1.5, blockedWords: ["zorblax"], holdWholeAlert: true });
  assert.deepEqual([u.voice.on, u.voice.rate, u.moderation.blockedWordsCount, u.moderation.holdWholeAlert], [true, 1.5, 1, true]);
  await assert.rejects(def.mcp.voice_moderation_update(w.ctx, { rate: 9 }), (e) => e.expose === true);
  await assert.rejects(def.mcp.voice_moderation_update(w.ctx, {}), (e) => e.expose === true);
  const got = []; globalThis.__curiosaAlertsBus.on(w.key, (e) => got.push(e));
  assert.equal((await def.mcp.held_text_decide(w.ctx, { id: g.flagged[0].id, action: "accept" })).done, true); assert.equal(got.length, 1);
  await assert.rejects(def.mcp.held_text_decide(w.ctx, { id: "nope", action: "accept" }), (e) => e.expose === true);
  const names = ["voice_moderation_get", "voice_moderation_update", "held_text_decide"];
  for (const nme of names) { const m = manifest.mcp.find((x) => x.name === nme); assert.ok(m && m.i18nOk !== false); }
  assert.equal(manifest.mcp.find((x) => x.name === "voice_moderation_get").readOnly, true);
  for (const nme of names.slice(1)) { const m = manifest.mcp.find((x) => x.name === nme); assert.equal(m.default, false); assert.ok(!m.destructive); }
  assert.deepEqual(manifest.mcp.map((m) => m.name), Object.keys(def.mcp));
});

test("manifest: 1.7.0, optional journal, video settings (six, own tab), viewers tab, FR and EN texts in parity", () => {
  assert.equal(manifest.version, "1.7.0");
  assert.deepEqual(manifest.requires, [{ service: "twitch.journal", optional: true }]);
  assert.equal(manifest.settings.filter((s) => s.type === "video" && s.tab === "media").length, 6);
  assert.deepEqual(manifest.tabs.map((t) => t.id), ["twitch", "viewers", "media"]);
  assert.ok(manifest.privacy.en.length <= 500 && manifest.privacy.fr.length <= 500);
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of ["tw_text_someone", ...tw.PRESENT.map((x) => `tw_present_${x}`), ...tw.TTS_MODES.map((x) => `tw_tts_${x}`), ...mod.REASONS.map((x) => `mod_reason_${x}`)]) assert.ok(en[k] && fr[k], k);
  const words = JSON.stringify([en, fr]).toLowerCase();
  assert.ok(!/zorblax/.test(words));
});

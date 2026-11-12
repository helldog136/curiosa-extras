// Alerts overlay 1.7.0: a sound FILE per type (core 0.10.0: the `audio` kind of the edit window), kept by the module, played once per alert by the page at the volume of the sounds.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const def = (await import("../modules/alerts-overlay/index.mjs")).default;
const NOW = Date.parse("2026-11-12T20:00:00Z");
const UUID = "0123456789abcdef0123456789abcdef0123";
const SND = `/uploads/${UUID}.mp3`, SND2 = `/uploads/${UUID.replace(/^0/, "1")}.ogg`, PIC = `/uploads/${UUID.replace(/^0/, "2")}.png`;
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
const query = () => new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "en", "ov-text": "light", "opt-kinds": "channel" });
let n = 0, seq = 0;
const item = (type, o = {}) => ({ id: `s${++seq}`, type, at: new Date(NOW - 1000).toISOString(), ...o });
function world({ settings = {}, uploads = [], items = [] } = {}) {
  const key = `sf${++n}`, state = { items };
  const ctx = fakeCtx({ key, locale: "en", messages: readJson("locales/en.json"), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0, ...settings }, instances: HERE, uploads, topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions });
  return { key, ctx, state };
}

test("manifest: 1.7.0, core 0.10.0 asked for, no sound slots (the field is in the window of the type)", () => {
  assert.equal(manifest.version, "1.7.0"); assert.equal(manifest.minCore, "0.10.0");
  assert.ok(!manifest.settings.some((s) => s.type === "audio"), "the direct field replaces six slots");
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  for (const k of ["tw_f_audio", "tw_f_audio_help", "tw_err_audio"]) assert.ok(en[k] && fr[k], k);
});

test("config: a sound file only if it is an upload of the site itself with a sound extension", () => {
  const c = tw.normaliseConfig({ types: { follow: { audio: SND }, sub: { audio: PIC }, raid: { audio: "https://elsewhere.example.org/x.mp3" }, gift: { audio: `${SND}?x=1` }, cheer: { audio: "/uploads/../x.mp3" } } });
  assert.equal(c.types.follow.audio, SND);
  for (const id of ["sub", "raid", "gift", "cheer", "resub"]) assert.equal(c.types[id].audio, "", id);
});

test("an alert carries the file instead of the synthesised sound; video with its own sound still works", () => {
  const { ctx } = world();
  const config = tw.normaliseConfig({ types: { follow: { audio: SND, sound: "chime" }, raid: { sound: "bell" }, sub: { present: "video", video: 1, videoSound: true } } });
  const env = { config, ignore: new Set(), showText: false, locale: "en", text: (k) => ctx.t(`tw_text_${k}`), title: (p) => ctx.t(`tw_title_${p}`), seconds: 0, baseSeconds: 6, videos: [`/uploads/${UUID}.mp4`], now: NOW };
  const f = tw.alertFor(item("follow", { name: "Camille" }), env).alert;
  assert.deepEqual([f.audio, f.sound], [SND, undefined]);
  assert.deepEqual([tw.alertFor(item("raid", { name: "lune_douce", viewers: 3 }), env).alert.sound], ["bell"]);
  const s = tw.alertFor(item("sub", { name: "etoile_nord", tier: "1" }), env).alert;
  assert.deepEqual([s.present, s.videoSound], ["media", true]);
});

test("administration: the field is folded in the window, the file is kept by the module (the old one let go), anything else is refused under the field", async () => {
  const w = world({ uploads: [{ url: SND, by: "u1" }, { url: SND2, by: "u1" }, { url: PIC, by: "u1" }] });
  const A = def.adminActions, claims = () => w.ctx.calls.files.filter((c) => c.op === "claim").length;
  const dlg = (await def.adminPanel(w.ctx, { query: { edit: "follow" } })).find((b) => b.presentation === "dialog");
  const f = dlg.fields.find((x) => x.name === "audio");
  assert.deepEqual([f.kind, f.folded, f.value], ["audio", true, ""]);
  const save = (v) => A.saveType(w.ctx, { id: "follow", template: "", seconds: "", sound: "none", anim: "", image: "", ...v });
  assert.ok((await save({ audio: SND })).ok); assert.equal((await tw.loadConfig(w.ctx, NOW + 20_000)).types.follow.audio, SND);
  assert.ok((await save({ audio: SND2 })).ok);
  assert.ok(w.ctx.calls.files.some((c) => c.op === "remove" && c.url === SND), "the previous file is let go");
  for (const bad of [PIC, "https://elsewhere.example.org/x.mp3", `/uploads/${UUID.replace(/^0/, "3")}.mp3`]) assert.ok((await save({ audio: bad })).errors.audio, bad);
  assert.ok((await save({ audio: "" })).ok); assert.equal((await tw.loadConfig(w.ctx, NOW + 40_000)).types.follow.audio, "");
  assert.ok(claims() >= 2);
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  assertAdminPageErgonomics(await def.adminPanel(w.ctx, { query: { edit: "follow" } }));
});

test("the page plays the file once per alert at the volume of the sounds, stops it on skip, and has no such code without a file or without sounds on", async (t) => {
  let clock = NOW; t.mock.method(Date, "now", () => clock);
  const played = [];
  class Aud { constructor(src) { this.src = src; this.volume = 1; played.push(this); this.paused = false; } play() { return Promise.resolve(); } pause() { this.paused = true; } }
  const w = world({ settings: { twitchSounds: true, soundVolume: 60, durationSeconds: 6 }, uploads: [{ url: SND, by: "u1" }] });
  await tw.saveConfig(w.ctx, { types: { follow: { audio: SND } } });
  const out = await def.overlay(w.ctx, { query: query() });
  assert.match(out.script, /new Audio/); assert.ok(!/https?:\/\//.test(out.script));
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx), globals: { Audio: Aud } });
  const adv = async (ms) => { clock += ms; await page.advance(ms); };
  await adv(10);
  w.state.items = [item("follow", { name: "Camille", at: new Date(clock - 500).toISOString() }), item("raid", { name: "lune_douce", viewers: 3, at: new Date(clock - 400).toISOString() })];
  await adv(2100);
  assert.equal(played.length, 1); assert.deepEqual([played[0].src, played[0].volume], [SND, 0.6]);
  await tw.skipAlert(w.ctx); await adv(1700);
  assert.equal(played[0].paused, true, "the file stops with the card");
  const off = world({ settings: { twitchSounds: false } }); await tw.saveConfig(off.ctx, { types: { follow: { audio: SND } } });
  assert.ok(!/new Audio/.test((await def.overlay(off.ctx, { query: query() })).script), "sounds off: no code");
  const none = world({ settings: { twitchSounds: true } });
  assert.ok(!/new Audio/.test((await def.overlay(none.ctx, { query: query() })).script), "no file: no code");
});

test("assistants see whether a type has a sound file, never its address", async () => {
  const w = world(); await tw.saveConfig(w.ctx, { types: { follow: { audio: SND } } });
  const g = await def.mcp.alert_templates_get(w.ctx);
  assert.equal(g.types.find((x) => x.type === "follow").hasSoundFile, true);
  assert.ok(!JSON.stringify(g).includes("/uploads/"));
});

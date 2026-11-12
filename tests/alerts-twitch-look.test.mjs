// Alerts overlay 1.5.0: the look of the Twitch alerts: a picture per type (the site's own, kept by the module), synthesised sounds (nothing loaded), the way of entering per type
// (the shared transition helper), the preview and the sample evening in the administration, and the part names skins can restyle.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const NOW = Date.parse("2026-11-12T20:00:00Z");
const UUID = "0123456789abcdef0123456789abcdef0123";
const PIC = `/uploads/${UUID}.png`, PIC2 = `/uploads/${UUID.replace(/^0/, "1")}.webp`;
let n = 0;
const HERE = [{ id: "te", key: "events", module: "twitch-events", basePath: "", name: "Twitch activity", adminPath: "/admin/instances/te" }];
function world({ settings = {}, uploads = [], locale = "en", items = [] } = {}) {
  const key = `lk${++n}`, state = { items };
  const ctx = fakeCtx({ key, locale, messages: readJson(`locales/${locale}.json`), settings: { pushToken: "secret", groupSeconds: 0, minGapSeconds: 0, ...settings }, instances: HERE, uploads, topics: { "twitch.event": () => state.items.slice() }, permissions: manifest.permissions });
  return { key, ctx, state };
}
let seq = 0;
const item = (type, o = {}) => ({ id: `l${++seq}`, type, at: new Date(NOW - 1000).toISOString(), ...o });

test("config: sound and animation from closed lists, a picture only if it is an upload of the site itself", () => {
  const c = tw.normaliseConfig({ types: {
    follow: { sound: "chime", anim: "slideLeft", image: PIC },
    sub: { sound: "airhorn", anim: "explode", image: "https://elsewhere.example.org/x.png" },
    raid: { image: "/uploads/../../etc/passwd.png" }, gift: { image: "javascript:alert(1)" }, cheer: { image: `/uploads/${UUID}.svg` }, resub: { image: `${PIC}?c=1` },
  } });
  assert.deepEqual([c.types.follow.sound, c.types.follow.anim, c.types.follow.image], ["chime", "slideLeft", PIC]);
  assert.deepEqual([c.types.sub.sound, c.types.sub.anim, c.types.sub.image], ["none", "", ""], "unknown sound or animation and a picture from elsewhere are dropped");
  for (const id of ["raid", "gift", "cheer", "resub"]) assert.equal(c.types[id].image, "", id);
  assert.equal(c.types.online.sound, "none"); assert.equal(c.types.online.anim, "");
});

test("alerts carry their look only when chosen, groups keep it too", () => {
  const { ctx } = world();
  const config = tw.normaliseConfig({ types: { follow: { sound: "pop", anim: "fade", image: PIC }, gift: { sound: "fanfare", image: PIC } } });
  const env = { config, ignore: new Set(), showText: false, locale: "en", text: (k) => ctx.t(`tw_text_${k}`), title: (p) => ctx.t(`tw_title_${p}`), seconds: 0, now: NOW };
  const a = tw.alertFor(item("follow", { name: "Camille" }), env).alert;
  assert.deepEqual([a.sound, a.anim, a.image], ["pop", "fade", PIC]);
  const plain = tw.alertFor(item("raid", { name: "lune_douce", viewers: 9 }), env).alert;
  assert.ok(!("sound" in plain) && !("anim" in plain) && !("image" in plain));
  const staged = (its) => its.map((it) => { const r = tw.alertFor(it, env); return { alert: r.alert, item: it, type: r.type }; });
  const g = tw.groupBurst(staged([item("gift", { name: "Camille", login: "camille", tier: "1", count: 2 }), item("gift", { name: "Camille", login: "camille", tier: "1", count: 3 })]), env);
  assert.deepEqual([g[0].message, g[0].sound, g[0].image], ["Camille gifts 5 subs", "fanfare", PIC]);
  const f = tw.groupBurst(staged(["a", "b", "c"].map((x) => item("follow", { name: `fan_${x}` }))), env);
  assert.deepEqual([f[0].sound, f[0].image], ["pop", PIC]);
});

test("admin: the picture is kept by the module (and the old one let go); a picture that is not the site's own, or not sent by this person, is refused under its field", async () => {
  const w = world({ uploads: [{ url: PIC, by: "u1" }, { url: PIC2, by: "u1" }, { url: `/uploads/2${UUID.slice(1)}.png`, by: "someone-else" }] });
  const A = def.adminActions;
  const save = (v) => A.saveType(w.ctx, { id: "follow", template: "", seconds: "", sound: "none", anim: "", image: "", ...v });
  assert.ok((await save({ image: PIC })).ok);
  assert.equal((await tw.loadConfig(w.ctx, NOW + 20_000)).types.follow.image, PIC);
  assert.ok((await save({ image: PIC2 })).ok);
  assert.equal((await tw.loadConfig(w.ctx, NOW + 40_000)).types.follow.image, PIC2);
  assert.ok(w.ctx.calls.files.some((c) => c.op === "remove" && c.url === PIC), "the previous picture is let go");
  for (const bad of ["https://elsewhere.example.org/a.png", "/uploads/../x.png", `/uploads/2${UUID.slice(1)}.png`, "/uploads/ffffffffffffffffffffffffffffffffffff.png"]) {
    const r = await save({ image: bad });
    assert.ok(r.errors?.image, bad);
    assert.match(r.errors.image, /for example a PNG/);
  }
  assert.equal((await tw.loadConfig(w.ctx, NOW + 60_000)).types.follow.image, PIC2, "a refused picture changes nothing");
  assert.ok((await save({ image: "" })).ok);
  assert.equal((await tw.loadConfig(w.ctx, NOW + 80_000)).types.follow.image, "");
  assert.ok(w.ctx.calls.files.some((c) => c.op === "remove" && c.url === PIC2));
  assert.ok((await save({ sound: "bell", anim: "pop" })).ok);
  assert.ok((await save({ sound: "airhorn" })).errors.sound); assert.ok((await save({ anim: "explode" })).errors.anim);
});

test("tools for assistants: sound and animation, never a picture", async () => {
  const w = world();
  const r = await def.mcp.alert_template_update(w.ctx, { type: "cheer", sound: "fanfare", animation: "slideTop" });
  assert.deepEqual([r.sound, r.animation, r.hasPicture], ["fanfare", "slideTop", false]);
  assert.equal((await def.mcp.alert_template_update(w.ctx, { type: "cheer", animation: "default" })).animation, "default");
  assert.ok(!manifest.mcp.find((m) => m.name === "alert_template_update").input.properties.image, "a picture needs an upload: administration only");
  await assert.rejects(def.mcp.alert_template_update(w.ctx, { type: "cheer", sound: "airhorn" }), (e) => e.expose === true);
});

const query = () => new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale", "ov-lang": "en", "ov-text": "light" });
class Ctx { constructor() { this.nodes = []; this.destination = {}; this.currentTime = 0; } createOscillator() { const o = { frequency: {}, connect() {}, start: (t) => this.nodes.push({ f: o.frequency.value, t, type: o.type }), stop() {} }; return o; } createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v) => { this.peak = Math.max(this.peak ?? 0, v); } }, connect() {} }; } }

test("the page: sounds only when switched on, at the chosen volume, one per alert; the picture shows as its own part; nothing is loaded from elsewhere", async (t) => {
  let clock = NOW;
  t.mock.method(Date, "now", () => clock);
  const made = [];
  const globals = { AudioContext: class extends Ctx { constructor() { super(); made.push(this); } } };
  const w = world({ settings: { twitchSounds: true, soundVolume: 80, durationSeconds: 6 } });
  await tw.saveConfig(w.ctx, { types: { follow: { sound: "chime", image: PIC }, raid: { sound: "fanfare" } } });
  const out = await def.overlay(w.ctx, { query: query() });
  assert.match(out.script, /"volume":80/); assert.match(out.script, /function beep/);
  assert.ok(!/https?:\/\//.test(out.script) && !/https?:\/\//.test(out.html), "nothing from another site");
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx), globals });
  const adv = async (ms) => { clock += ms; await page.advance(ms); };
  await adv(10);
  w.state.items = [item("follow", { name: "Camille", at: new Date(clock - 2000).toISOString() }), item("raid", { name: "lune_douce", viewers: 3, at: new Date(clock - 1500).toISOString() })];
  await adv(2100);
  assert.equal(made[0].nodes.length, 2, "the chime: two notes, once");
  assert.ok(made[0].peak <= 0.2 + 1e-9 && made[0].peak > 0, "at the chosen volume (80 % of a quarter)");
  assert.equal(page.shown[0].message, "Camille follows you");
  await adv(7000);
  assert.equal(made[0].nodes.length, 2 + 4, "the fanfare: four notes, once, for the next alert");
  // the picture is a part of the card that a skin can restyle
  assert.match(out.script, /data-ov-part","image"/);
  assert.match(out.script, /\^\\\/uploads\\\/\[0-9a-f-\]\{36\}/);
});

test("the page: no audio code at all when sounds are off, and no picture or look code without Twitch activity", async () => {
  const off = world({ settings: { twitchSounds: false } });
  const o1 = await def.overlay(off.ctx, { query: query() });
  assert.ok(!/beep|AudioContext/.test(o1.script) && !/"volume"/.test(o1.script));
  const bare = world(); bare.ctx.api.instances.list = async () => [];
  const o2 = await def.overlay(bare.ctx, { query: query() });
  assert.ok(!/beep|AudioContext|data-ov-part","image"|_anim/.test(o2.script));
});

test("the page: the way of entering is per type (the shared transition helper), the others keep the module setting", async (t) => {
  let clock = NOW;
  t.mock.method(Date, "now", () => clock);
  const w = world({ settings: { durationSeconds: 6 } });
  await tw.saveConfig(w.ctx, { types: { raid: { anim: "slideLeft" } } });
  const out = await def.overlay(w.ctx, { query: query() });
  assert.match(out.script, /card\._anim\|\|c\.tr\[/); assert.match(out.script, /function ovTransition/);
  assert.match(out.script, /"tr":\{/);
  const none = world({ settings: { durationSeconds: 6 } });
  const plain = await def.overlay(none.ctx, { query: query() });
  assert.ok(!/ovTransition/.test(plain.script), "no type asks for a way of entering: the page keeps its own animation");
});

test("admin: thumbnails and a preview of the cards, a sample evening goes through the real path, the folded options are folded", async () => {
  const w = world({ uploads: [{ url: PIC, by: "u1" }] });
  await def.adminActions.saveType(w.ctx, { id: "cheer", template: "", seconds: "", min: "", sound: "bell", anim: "", image: PIC });
  const blocks = await def.adminPanel(w.ctx, { query: {} });
  const table = blocks.find((b) => b.type === "table" && b.tab === "twitch");
  const cheer = table.rows[tw.TYPES.indexOf("cheer")][1];
  assert.deepEqual(cheer.image, { src: PIC, alt: "Picture of the alert: Bits" });
  const html = blocks.find((b) => b.type === "html" && b.tab === "twitch").html;
  assert.ok(html.includes(`src="${PIC}"`) && html.includes("etoile_nord sends 500 bits"));
  assert.ok(!/<script|onerror|javascript:/i.test(html));
  const dlg = (await def.adminPanel(w.ctx, { query: { edit: "cheer" } })).find((b) => b.presentation === "dialog");
  assert.deepEqual(dlg.fields.filter((f) => f.folded).map((f) => f.name).sort(), ["anim", "audio", "image", "present", "sound", "tts", "video", "videoSound", "viewer", "viewerMax"]);
  const quiet = (await def.adminPanel(world().ctx, { query: { edit: "raid" } })).find((b) => b.presentation === "dialog");
  assert.ok(quiet.fields.filter((f) => f.folded).every((f) => !f.value), "nothing chosen: the folded options stay shut");
  const got = []; globalThis.__curiosaAlertsBus.on(w.key, (e) => got.push(e));
  assert.ok((await def.adminActions.simulate(w.ctx)).ok);
  assert.deepEqual(got.map((a) => a.kind), ["follow", "sub", "tw_gift", "tw_cheer", "raid"]);
  assert.equal(got[3].image, PIC); assert.equal(got[3].sound, "bell"); assert.ok(got.every((a) => a.queued === true));
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["en", "fr"]) {
    const x = world({ locale });
    const errors = [(await def.adminActions.saveType(x.ctx, { id: "follow", template: "", seconds: "", image: "https://elsewhere.example.org/a.png" })).errors.image, (await def.adminActions.saveType(x.ctx, { id: "follow", template: "", seconds: "", sound: "zzz" })).errors.sound];
    assertAdminPageErgonomics(await def.adminPanel(x.ctx, { query: {} }), { errors });
    assertAdminPageErgonomics(await def.adminPanel(x.ctx, { query: { edit: "cheer" } }));
  }
});

test("manifest: files permission, two settings (sounds off by default, volume advanced), FR and EN texts for every sound and way of entering", () => {
  assert.ok(manifest.permissions.includes("files"));
  const s = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.equal(s.twitchSounds.default, false); assert.equal(s.soundVolume.advanced, true);
  const en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
  for (const x of tw.SOUNDS) assert.ok(en[`tw_sound_${x}`] && fr[`tw_sound_${x}`], x);
  for (const x of tw.ANIMS) assert.ok(en[`tw_anim_${x || "module"}`] && fr[`tw_anim_${x || "module"}`], x);
  assert.equal(manifest.version, "1.7.0");
});

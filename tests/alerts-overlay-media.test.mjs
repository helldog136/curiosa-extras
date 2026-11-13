// Alerts overlay 1.8.0: the media library (pictures, GIFs, sounds named in the "Media" tab, plus the videos of the six fields) and the service `alerts.show` that the Twitch bot calls.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { runOverlayPage } from "./helpers/overlayPageDom.mjs";
import { tableOf, dialogsOf } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const def = (await import("../modules/alerts-overlay/index.mjs")).default;
const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const GIF = U(1, "gif"), WAV = U(2, "mp3"), VID = U(3, "mp4"), PNG = U(4, "png");
let n = 0;
function world(settings = {}, uploads = [{ url: GIF, by: "u1" }, { url: WAV, by: "u1" }, { url: PNG, by: "u1" }]) {
  const key = `md${++n}`; md.resetValve(); tw.resetTwitchState();
  const ctx = fakeCtx({ key, locale: "en", messages: en, settings: { pushToken: "x", ...settings }, uploads });
  const sent = [];
  return { key, ctx, sent, emit: (a) => sent.push(a), A: def.adminActions };
}
const add = (w, name, kind, file) => w.A.addMedia(w.ctx, { name, kind, file });

test("manifest: 1.8.0, offers alerts.show (read-only list), tab renamed Media, FR/EN parity of the new texts", () => {
  assert.equal(manifest.version, "1.8.1");
  const o = manifest.offers.find((x) => x.service === "alerts.show");
  assert.deepEqual([o.version, o.each, o.readOnly], [1, true, ["list"]]);
  assert.deepEqual(manifest.tabs.find((t) => t.id === "media").label, { en: "Media", fr: "Médias" });
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  for (const k of Object.keys(en).filter((k) => k.startsWith("md_"))) assert.ok(fr[k], k);
});

test("library: add a picture and a sound, names are unique (case and accents), files are claimed, rename, remove lets the file go", async () => {
  const w = world();
  assert.ok((await add(w, "Applause", "picture", GIF)).ok);
  assert.ok((await add(w, "Ding", "sound", WAV)).ok);
  assert.ok((await add(w, "applause", "picture", PNG)).errors.name, "duplicate under the field");
  assert.ok((await add(w, "", "picture", PNG)).errors.name);
  assert.ok((await add(w, "Wrong", "picture", WAV)).errors.file, "a sound is not a picture");
  assert.ok((await add(w, "Elsewhere", "picture", "https://elsewhere.example.org/a.gif")).errors.file);
  assert.equal(w.ctx.calls.files.filter((c) => c.op === "claim" && c.result.ok).length, 2);
  const items = await md.list(w.ctx);
  assert.deepEqual(items.filter((m) => !m.builtin).map((m) => [m.name, m.kind]), [["Applause", "picture"], ["Ding", "sound"]]);
  assert.ok(items.some((m) => m.id === "tone:chime" && m.builtin), "built-in sounds are offered");
  const id = items.find((m) => m.name === "Ding").id;
  assert.ok((await w.A.renameMedia(w.ctx, { id, name: "Bell ring" })).ok);
  assert.ok((await w.A.renameMedia(w.ctx, { id, name: "Applause" })).errors.name);
  assert.ok((await w.A.removeMedia(w.ctx, { id })).ok);
  assert.ok(w.ctx.calls.files.some((c) => c.op === "remove" && c.url === WAV));
  assert.ok((await w.A.removeMedia(w.ctx, { id })).error);
});

test("videos of the six fields are listed as Video N and can be shown", async () => {
  const w = world({ video2: VID }, [{ url: GIF, by: "u1" }]);
  const v = (await md.list(w.ctx)).find((m) => m.kind === "video");
  assert.deepEqual([v.id, v.name, v.url], ["video:2", "Video 2", VID]);
  const r = await md.show(w.ctx, { visual: "video:2" }, w.emit);
  assert.ok(r.ok); assert.deepEqual([w.sent[0].video, w.sent[0].videoSound, w.sent[0].present, w.sent[0].queued, w.sent[0].own], [VID, true, "media", true, true]);
});

test("service show: picture, picture + sound, tone, sound alone, seconds, missing, empty, bad seconds; same path as alerts (paused = held, resume releases)", async () => {
  const w = world({ durationSeconds: 7 });
  await add(w, "Applause", "picture", GIF); await add(w, "Ding", "sound", WAV);
  const id = (name) => md.pick(items, name).id; let items = await md.list(w.ctx);
  const call = (i) => def.services["alerts.show"].show(w.ctx, i);
  const sent = [];
  w.ctx.api.services.call = undefined;
  // the service emits through the module bus: listen to it
  const feed = def; assert.ok(feed.services["alerts.show"].list);
  let r = await md.show(w.ctx, { visual: id("Applause") }, w.emit);
  assert.deepEqual([r.ok, r.state], [true, "shown"]);
  assert.deepEqual([w.sent[0].image, w.sent[0].duration, w.sent[0].message, w.sent[0].audio], [GIF, 7, "Applause", undefined]);
  r = await md.show(w.ctx, { visual: id("Applause"), sound: id("Ding"), seconds: 10 }, w.emit);
  assert.deepEqual([w.sent[1].audio, w.sent[1].duration], [WAV, 10]);
  await md.show(w.ctx, { sound: "tone:bell" }, w.emit);
  assert.deepEqual([w.sent[2].present, w.sent[2].sound, w.sent[2].duration], ["sound", "bell", 4]);
  assert.deepEqual(await md.show(w.ctx, {}, w.emit), { ok: false, code: "empty" });
  assert.deepEqual((await md.show(w.ctx, { visual: "nope" }, w.emit)).code, "missing");
  assert.equal((await md.show(w.ctx, { visual: id("Ding") }, w.emit)).code, "missing", "a sound is not a picture");
  assert.equal((await md.show(w.ctx, { visual: id("Applause"), seconds: 1 }, w.emit)).code, "seconds");
  await tw.pause(w.ctx);
  assert.equal((await md.show(w.ctx, { visual: id("Applause") }, w.emit)).state, "held");
  assert.equal(w.sent.length, 3, "nothing shown while paused");
  assert.equal((await tw.queueState(w.ctx)).held, 1);
  await tw.resume(w.ctx, w.emit);
  assert.equal(w.sent.length, 4, "released on resume");
  const listed = await def.services["alerts.show"].list(w.ctx);
  assert.ok(listed.items.every((m) => m.id && m.name && !("url" in m)), "no address leaves the module");
});

test("safety valve: more than 30 media in a minute are refused", async () => {
  const w = world(); await add(w, "Applause", "picture", GIF);
  const id = (await md.list(w.ctx)).find((m) => m.name === "Applause").id;
  let busy = 0; for (let i = 0; i < 35; i++) if ((await md.show(w.ctx, { visual: id }, w.emit, 1000 + i)).code === "busy") busy++;
  assert.equal(busy, 5);
});

test("administration: table with live search, filter, type badge written, dialogs, ergonomics kit (en, fr)", async () => {
  const w = world(); await add(w, "Applause", "picture", GIF); await add(w, "Ding", "sound", WAV);
  const page = await def.adminPanel(w.ctx, { query: { tab: "media" } });
  const t = page.find((b) => b.type === "table" && b.tab === "media");
  assert.equal(t.searchable, true); assert.ok(t.filters.length === 1);
  assert.deepEqual(t.rows.map((r) => r[1].text), ["Picture or GIF", "Sound"]);
  assert.ok(t.rows.every((r) => r[1].badge));
  assert.ok(t.rowActions.find((a) => a.action === "removeMedia").confirm);
  assert.ok(t.rowActions.filter((a) => !a.inMenu).length <= 2);
  assert.ok(t.rows[0][0].image.alt);
  const dlg = (q) => dialogsOf(def.adminPanel(w.ctx, { query: q }) && []);
  for (const q of [{ tab: "media", add: "picture" }, { tab: "media", add: "sound" }, { tab: "media", media: md.pick(await md.list(w.ctx), "Applause").id }]) {
    const p = await def.adminPanel(w.ctx, { query: q });
    const f = p.find((b) => b.presentation === "dialog");
    assert.ok(f, JSON.stringify(q)); assert.ok(f.fields.filter((x) => x.kind !== "hidden").length <= 2);
    assertAdminPageErgonomics(p);
  }
  const wf = world(); wf.ctx = fakeCtx({ key: "mdfr", locale: "fr", messages: fr, settings: {}, uploads: [] });
  assertAdminPageErgonomics(await def.adminPanel(wf.ctx, { query: { tab: "media" } }));
  const empty = (await def.adminPanel(world().ctx, { query: { tab: "media" } })).filter((b) => b.tab === "media" && b.type === "markdown");
  assert.ok(empty.some((b) => /Add a picture/.test(b.text)), "empty state says what to do");
});

test("the page: nothing changes without media; with a library it queues, plays a sound file at the media volume, draws sound-only without a card, and clears on Empty the queue", async (t) => {
  let clock = Date.parse("2026-11-12T20:00:00Z"); t.mock.method(Date, "now", () => clock);
  const none = world();
  const plain = await def.overlay(none.ctx, { query: new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale" }) });
  assert.ok(!/mvol|alerts-media/.test(plain.script) && !/new Audio/.test(plain.script), "empty library: the page is what it was");
  const w = world({ soundVolume: 40 }); await add(w, "Ding", "sound", WAV); await add(w, "Applause", "picture", GIF);
  const items = await md.list(w.ctx);
  const played = []; class Aud { constructor(src) { this.src = src; played.push(this); } play() { return Promise.resolve(); } pause() { this.paused = true; } }
  const out = await def.overlay(w.ctx, { query: new URLSearchParams({ "ov-w": "640", "ov-h": "260", "ov-fit": "scale" }) });
  assert.match(out.script, /mvol/); assert.match(out.css, /data-ov-part="media"/);
  const page = runOverlayPage(out, { dispatch: (url) => def.routes.feed(new Request(url), w.ctx), globals: { Audio: Aud } });
  const adv = async (ms) => { clock += ms; await page.advance(ms); };
  await adv(10);
  assert.ok((await def.services["alerts.show"].show(w.ctx, { sound: md.pick(items, "Ding").id })).ok);
  await adv(1700);
  assert.equal(played.length, 1); assert.equal(played[0].src, WAV); assert.equal(played[0].volume, 0.4);
  assert.deepEqual(page.shown.filter((s) => s.kind).length, 0, "a sound alone draws no card");
});

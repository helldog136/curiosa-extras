// Twitch bot 1.19.0 + Alerts overlay 1.10.0: several pictures or videos for one command or word (one picked each time), the gallery in their window, files kept by the overlay (service alerts.show v2).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world, fr as botFr, en as botEn } from "./helpers/botWorld.mjs";
import { dialogsOf, shownFields, foldedFields } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const A = await import("../modules/twitch-bot/admin.mjs");
const BM = await import("../modules/twitch-bot/media.mjs");
const tools = (await import("../modules/twitch-bot/tools.mjs")).default;
const md = await import("../modules/alerts-overlay/media.mjs");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const alDef = (await import("../modules/alerts-overlay/index.mjs")).default;
const alMan = JSON.parse(fs.readFileSync(new URL("../modules/alerts-overlay/module.json", import.meta.url), "utf8"));
const alEn = JSON.parse(fs.readFileSync(new URL("../modules/alerts-overlay/locales/en.json", import.meta.url), "utf8"));
const botMan = JSON.parse(fs.readFileSync(new URL("../modules/twitch-bot/module.json", import.meta.url), "utf8"));

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
let n = 0;
/** A bot and an overlay talking through the real service code of the overlay; `shown` lists what the overlay was asked to show. */
function both({ uploads = [], v2 = true } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const al = fakeCtx({ key: `bm${++n}`, moduleId: "alerts-overlay", locale: "en", messages: alEn, settings: { pushToken: "x" }, permissions: alMan.permissions, uploads });
  const sent = []; globalThis.__curiosaAlertsBus?.on?.(al.instance.key, (e) => sent.push(e));
  const calls = [];
  const svc = alDef.services["alerts.show"];
  const w = world({ locale: "en" });
  const base = w.ctx.api.services;
  w.ctx.api.services = { ...base,
    providers: async (name) => (name === "alerts.show" ? [{ id: "id-al", key: "al", name: "Alerts", module: "alerts-overlay", version: v2 ? 2 : 1, each: true, master: true }] : base.providers(name)),
    call: async (name, method, args, opts) => { if (name !== "alerts.show") return base.call(name, method, args, opts); calls.push({ method, args, asCaller: opts?.asCaller === true }); if (!svc[method]) return { ok: false, reason: "no_method" }; try { return { ok: true, value: await svc[method](al, args) }; } catch { return { ok: false, reason: "failed" }; } } };
  return { al, bot: w.ctx, calls, sent, w };
}
const lib = (items) => ({ available: true, items });
const L = lib([{ id: "m1", name: "Applause", kind: "picture" }, { id: "m2", name: "Ding", kind: "sound" }, { id: "m3", name: "Cheer", kind: "picture" }, { id: "m4", name: "Clip", kind: "video" }]);

test("media of a command: a list of one is the old value byte for byte; two or more keep the list and the order rule; 12 at most", () => {
  assert.deepEqual(BM.checkMedia({ visual: "m1", sound: "m2", seconds: 6 }, L), { ok: true, value: { visual: "m1", sound: "m2", seconds: 6 } });
  assert.deepEqual(BM.checkMedia({ visuals: ["m1"], sound: "m2", seconds: 6 }, L), { ok: true, value: { visual: "m1", sound: "m2", seconds: 6 } }, "a list of one");
  assert.deepEqual(BM.checkMedia({ visuals: ["m1", "m3", "m4"], pick: "rotate" }, L).value, { visual: "m1", visuals: ["m1", "m3", "m4"], pick: "rotate" });
  assert.deepEqual(BM.checkMedia({ visuals: ["m1", "m3"], pick: "weird" }, L).value.pick, "random");
  assert.deepEqual(BM.checkMedia({ visuals: [] }, L), { ok: true, value: null });
  const many = Array.from({ length: 13 }, (_, i) => `x${i}`);
  assert.deepEqual(BM.checkMedia({ visuals: many }, lib(many.map((id) => ({ id, name: id, kind: "picture" })))), { ok: false, code: "media_limit", field: "mediaFiles" });
  assert.deepEqual(BM.checkMedia({ visuals: ["m1", "m2"] }, L), { ok: false, code: "media_missing", field: "mediaFiles" }, "a sound is not a picture");
  assert.deepEqual(BM.readMedia({ visual: "m1" }), { visual: "m1" });
  assert.deepEqual(BM.readMedia({ visuals: ["m1", "m1", "m3"], pick: "rotate", sound: "m2" }), { visual: "m1", visuals: ["m1", "m3"], pick: "rotate", sound: "m2" });
  assert.equal(BM.nameOf({ visuals: ["m1", "m3"], visual: "m1", sound: "m2" }, L), "Applause +1 + Ding"); assert.equal(BM.nameOf({ visual: "m1" }, L), "Applause");
});

test("showing: one visual goes out exactly as before; a list goes out with its rule and the key of the command", async () => {
  const b = both();
  await md.add(b.al, { name: "A", kind: "picture", url: U(1, "gif") }).catch(() => {});
  const seen = [];
  const svc = b.bot.api.services, base = svc.call;
  svc.call = async (name, method, args, opts) => { seen.push({ method, args }); return base(name, method, args, opts); };
  await BM.showOnStream(b.bot, { visual: "m1", sound: "m2", seconds: 6 }, { key: "cmd:x" });
  assert.deepEqual(seen[0].args, { visual: "m1", sound: "m2", seconds: 6 });
  await BM.showOnStream(b.bot, { visual: "m1", visuals: ["m1", "m3"], pick: "rotate" }, { key: "cmd:x" });
  assert.deepEqual(seen[1].args, { visual: "m1", visuals: ["m1", "m3"], pick: "rotate", key: "cmd:x" });
});

test("overlay show with several visuals: random never repeats twice in a row, rotate follows the order and is kept per command, limit and missing files refused", async () => {
  const files = [1, 2, 3].map((i) => ({ url: U(i, "gif"), by: "u1" })).concat([{ url: U(9, "mp4"), by: "u1" }]);
  const b = both({ uploads: files });
  const ids = [];
  for (const [i, f] of files.entries()) { const r = await md.add(b.al, { name: `File ${i}`, kind: f.url.endsWith("mp4") ? "video" : "picture", url: f.url }); assert.ok(r.ok, JSON.stringify(r)); ids.push(r.id); }
  const out = [], emit = (a) => out.push(a);
  let seed = 3; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 25; i++) assert.ok((await md.show(b.al, { visuals: ids, key: "c1", rng }, emit)).ok);
  const urls = out.map((a) => a.image ?? a.video);
  assert.ok(urls.every((u, i) => i === 0 || u !== urls[i - 1]), "never the same twice in a row"); assert.equal(new Set(urls).size, 4);
  out.length = 0; md.resetValve();
  for (let i = 0; i < 5; i++) await md.show(b.al, { visuals: ids.slice(0, 3), pick: "rotate", key: "c2" }, emit);
  assert.deepEqual(out.map((a) => a.image), [U(1, "gif"), U(2, "gif"), U(3, "gif"), U(1, "gif"), U(2, "gif")]);
  out.length = 0; md.resetValve();
  await md.show(b.al, { visuals: ids.slice(0, 3), pick: "rotate", key: "c3" }, emit); await md.show(b.al, { visuals: ids.slice(0, 3), pick: "rotate", key: "c2" }, emit);
  assert.deepEqual(out.map((a) => a.image), [U(1, "gif"), U(3, "gif")], "each command has its own turn");
  assert.equal(out.length && (await md.show(b.al, { visuals: Array.from({ length: 13 }, (_, i) => `x${i}`) }, emit)).code, "limit");
  assert.deepEqual((await md.show(b.al, { visuals: [ids[0], "nope"] }, emit)).missing, ["nope"]);
  out.length = 0; md.resetValve();
  await md.show(b.al, { visual: ids[0] }, emit); assert.equal(out[0].image, U(1, "gif"), "a single visual is as before");
});

test("service add: several files sent at once are kept and named by the overlay (one claim each), a file already in the library is not added twice, bad files and more than 12 refused", async () => {
  const f = [1, 2, 3].map((i) => U(i, "gif")), clip = U(7, "mp4");
  const b = both({ uploads: [...f, clip].map((url) => ({ url, by: "u1" })) });
  const svc = alDef.services["alerts.show"];
  const r = await svc.add(b.al, { items: [{ src: f[0], label: "Applause" }, { src: f[1] }, { src: clip }] });
  assert.ok(r.ok); assert.deepEqual(Object.keys(r.ids), [f[0], f[1], clip]);
  assert.equal(b.al.calls.files.filter((c) => c.op === "claim" && c.result.ok).length, 3);
  const list = (await svc.list(b.al)).items, files = (await svc.files(b.al)).items;
  assert.ok(list.every((m) => !("url" in m)), "list gives no address"); assert.ok(files.some((m) => m.name === "Applause") && files.filter((m) => /^Picture \d+$/.test(m.name)).length === 1 && files.filter((m) => /^Clip \d+$/.test(m.name)).length === 1, JSON.stringify(files));
  assert.deepEqual(files.find((m) => /^Clip/.test(m.name)).kind, "video"); assert.equal(new Set(files.map((m) => m.name)).size, 3);
  const again = await svc.add(b.al, { items: [{ src: f[0] }, { src: f[2] }] });
  assert.equal(again.ids[f[0]], r.ids[f[0]]); assert.equal((await svc.files(b.al)).items.length, 4);
  assert.deepEqual((await svc.add(b.al, { items: [{ src: "https://elsewhere.example.org/a.gif" }] })).code, "file");
  assert.deepEqual((await svc.add(b.al, { items: Array.from({ length: 13 }, (_, i) => ({ src: U(i + 20, "gif") })) })).code, "limit");
  assert.deepEqual((await svc.add(b.al, { items: [{ src: U(77, "gif") }] })).code, "file", "a file nobody just sent is refused by the claim");
  const o = alMan.offers.find((x) => x.service === "alerts.show");
  assert.deepEqual([o.version, o.callerRights, o.readOnly], [2, ["add"], ["list", "files"]]);
});

test("window of a command: gallery + order folded (old overlay: the old single choice); sound and seconds stay", async () => {
  const b = both({ uploads: [{ url: U(1, "gif"), by: "u1" }] });
  await alDef.services["alerts.show"].add(b.al, { items: [{ src: U(1, "gif"), label: "Applause" }] });
  assert.ok((await A.actions.create(b.bot, { name: "salut", text: "Salut" })).ok);
  const page = await A.panel(b.bot, { query: { new: "1" } });
  const f = dialogsOf(page)[0];
  assert.ok(foldedFields(f).map((x) => x.name).includes("mediaFiles") && !shownFields(f).some((x) => x.name === "mediaFiles"));
  const g = f.fields.find((x) => x.name === "mediaFiles");
  assert.deepEqual([g.kind, g.max, g.accept], ["gallery", 12, ["image", "video"]]); assert.equal(g.library[0].label, "Applause"); assert.equal(g.library[0].value, U(1, "gif"));
  assert.deepEqual(f.fields.find((x) => x.name === "mediaPick").options.map((o) => o.label), ["At random", "In turn"]);
  assert.ok(f.fields.some((x) => x.name === "mediaSound") && f.fields.some((x) => x.name === "mediaSeconds") && !f.fields.some((x) => x.name === "mediaVisual"));
  assertAdminPageErgonomics(page);
  const old = both({ v2: false });
  const f1 = dialogsOf(await A.panel(old.bot, { query: { new: "1" } }))[0];
  assert.ok(f1.fields.some((x) => x.name === "mediaVisual") && !f1.fields.some((x) => x.name === "mediaFiles"));
});

test("save from the window: new files go through the overlay (asCaller), library files are found, the command keeps the ids; the list shows how many; a refusal is under the gallery", async () => {
  const f = [1, 2, 3].map((i) => U(i, "gif"));
  const b = both({ uploads: f.slice(1).map((url) => ({ url, by: "u1" })).concat([{ url: f[0], by: "u1" }]) });
  await alDef.services["alerts.show"].add(b.al, { items: [{ src: f[0], label: "Applause" }] });
  const gal = (...u) => JSON.stringify(u.map((src) => ({ src })));
  const r = await A.actions.create(b.bot, { name: "merci", text: "Merci", mediaFiles: gal(f[0], f[1], f[2]), mediaPick: "rotate", mediaSeconds: "5" });
  assert.ok(r.ok, JSON.stringify([r, b.calls.map((c) => [c.method, JSON.stringify(c.args)])]));
  assert.ok(b.calls.some((c) => c.method === "add" && c.asCaller && c.args.items.length === 2), "only the new files are sent");
  const cmd = (await (await import("../modules/twitch-bot/commands.mjs")).listCustom?.(b.bot))?.find?.((c) => c.name === "merci");
  const page = await A.panel(b.bot, { query: {} });
  assert.ok(JSON.stringify(page).includes("Applause +2"), "the row says the first name and how many more");
  const bad = await A.actions.create(b.bot, { name: "bravo", text: "Bravo", mediaFiles: gal(U(55, "gif")) });
  assert.ok(bad.errors?.mediaFiles, JSON.stringify(bad)); assert.match(bad.errors.mediaFiles, /[.?]$/);
  const tooMany = await A.actions.create(b.bot, { name: "trop", text: "Trop", mediaFiles: gal(...Array.from({ length: 13 }, (_, i) => f[i % 3] + `#${i}`)) });
  assert.ok(tooMany.errors?.mediaFiles || tooMany.error);
});

test("manifests and texts: bot 1.20.0 asks core 0.15.0, overlay 1.10.0; FR/EN parity of the new keys", () => {
  assert.deepEqual([botMan.version, botMan.minCore, alMan.version], ["1.20.0", "0.15.0", "1.10.0"]);
  assert.deepEqual(Object.keys(botEn).sort(), Object.keys(botFr).sort());
  const alFr = JSON.parse(fs.readFileSync(new URL("../modules/alerts-overlay/locales/fr.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(alEn).sort(), Object.keys(alFr).sort());
  for (const k of ["f_media_pick", "media_pick_random", "media_pick_rotate", "err_media_limit"]) assert.ok(botFr[k] && botEn[k], k);
});

test("assistants: onStreamPictures takes names (several at once), one name or an empty list is the old behaviour, more than 12 refused; write tools stay off by default", async () => {
  const w = world({ locale: "en", services: { "alerts.show": { list: () => ({ items: [{ id: "m1", name: "Applause", kind: "picture" }, { id: "m3", name: "Cheer", kind: "picture" }, { id: "m4", name: "Clip", kind: "video" }, { id: "m2", name: "Ding", kind: "sound" }] }), show: () => ({ ok: true, state: "shown" }) } } });
  assert.ok((await tools.bot_command_create(w.ctx, { name: "merci", text: "Merci", onStreamPictures: ["applause", "Cheer", "clip"], onStreamPick: "rotate", onStreamSound: "Ding" })).created);
  const got = (await tools.bot_commands_list(w.ctx, {})).commands.find((c) => c.name === "merci");
  assert.deepEqual(got.onStream.pictures_or_videos, ["Applause", "Cheer", "Clip"]); assert.equal(got.onStream.pick, "in turn"); assert.equal(got.onStream.sound, "Ding");
  assert.ok((await tools.bot_command_update(w.ctx, { name: "merci", onStreamPictures: ["Cheer"] })).updated);
  const one = (await tools.bot_commands_list(w.ctx, {})).commands.find((c) => c.name === "merci");
  assert.equal(one.onStream.picture_or_video, "Cheer"); assert.equal(one.onStream.pictures_or_videos, undefined, "a list of one is the old single choice");
  await assert.rejects(tools.bot_command_update(w.ctx, { name: "merci", onStreamPictures: Array.from({ length: 13 }, () => "Cheer") }), /At most 12/);
  await assert.rejects(tools.bot_command_update(w.ctx, { name: "merci", onStreamPictures: ["Nope"] }), /No picture or video named "Nope"/);
  const wr = botMan.mcp.filter((t) => t.input?.properties?.onStreamPictures);
  assert.equal(wr.length, 2); assert.ok(wr.every((t) => t.default === false), "write tools off by default");
});

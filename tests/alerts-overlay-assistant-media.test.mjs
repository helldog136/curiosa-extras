// Alerts overlay 1.11.0: an AI assistant adds a video it made to the media library and puts it on a Twitch event (core 0.18.0, ctx.api.files.upload).
// The fake context checks the bytes with the core's own rules (checkAssistantFile): real ffmpeg files from tests/fixtures/media, no optimistic fake.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const MEDIA = new URL("./fixtures/media/", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json"), en = readJson("locales/en.json"), fr = readJson("locales/fr.json");
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const mod = await import("../modules/alerts-overlay/index.mjs");
const def = mod.default;
const file = (n) => fs.readFileSync(MEDIA + n);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const UPLOADS = ["reaction_media_upload_begin", "reaction_media_upload_chunk", "reaction_media_upload_finish"];
const NEW = [...UPLOADS, "reaction_media_list", "reaction_get", "reaction_set", "reaction_test", "reaction_media_delete"];

let n = 0;
function world({ assistant = true, locale = "en" } = {}) {
  const key = `am${++n}`; md.resetValve(); tw.resetTwitchState();
  const ctx = fakeCtx({ key, locale, messages: locale === "fr" ? fr : en, settings: { pushToken: "x" }, permissions: manifest.permissions, person: null, ...(assistant ? { assistantUploads: { tokenId: "t1" } } : {}) });
  return { key, ctx, M: def.mcp, actor: { name: "Studio" } };
}
/** The assistant's whole path: begin, bytes (PUT address or base64 pieces), finish. */
async function upload(w, name, buf, { pieces = false } = {}) {
  const b = await w.M.reaction_media_upload_begin(w.ctx, { name, bytes: buf.length, sha256: sha(buf) }, w.actor);
  if (pieces) for (let i = 0; i < b.orSendWithThisTool.pieces; i++) await w.M.reaction_media_upload_chunk(w.ctx, { upload: b.upload, index: i, data: buf.subarray(i * 700_000, (i + 1) * 700_000).toString("base64") }, w.actor);
  else w.ctx.putUpload(b.upload, buf);
  return { begin: b, done: await w.M.reaction_media_upload_finish(w.ctx, { upload: b.upload }, w.actor) };
}
const exposed = (re) => (e) => e.expose === true && re.test(e.message);

test("manifest: 1.11.0, eight new tools; the three upload tools declare uploads and are off by default; delete is destructive; FR texts", () => {
  assert.equal(manifest.version, "1.19.0");
  const tools = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  for (const name of NEW) { assert.ok(tools[name], name); assert.ok(manifest.i18n.fr[`mcp.${name}`], `fr ${name}`); assert.equal(typeof def.mcp[name], "function", name); }
  for (const name of UPLOADS) assert.deepEqual([tools[name].uploads, tools[name].readOnly, tools[name].default], [true, undefined, false], name);
  for (const name of ["reaction_set", "reaction_test"]) assert.equal(tools[name].default, false, `${name} writes: off by default`);
  assert.deepEqual([tools.reaction_media_delete.destructive, tools.reaction_media_delete.default], [true, false]);
  assert.equal(tools.reaction_media_list.readOnly, true); assert.equal(tools.reaction_get.readOnly, true);
  assert.ok(manifest.permissions.includes("files"));
  assert.equal(en.md_by_assistant, "Added by the assistant"); assert.equal(fr.md_by_assistant, "Ajouté par l'assistant");
});

test("a video for the follow: upload (PUT address), put it on the event, read it back, test it on the overlay, the bot can name it", async () => {
  const w = world();
  const { begin, done } = await upload(w, "Follow confetti", file("tiny-vp9.webm"));
  assert.match(begin.sendWithHttp.example, /^curl -sS -T clip\.webm "https:\/\/example\.test\/api\/assistant-upload\//);
  assert.deepEqual([done.name, done.kind, done.durationSeconds, done.width], ["Follow confetti", "video", 1, 64]);
  const list = await w.M.reaction_media_list(w.ctx, {});
  const item = list.items.find((m) => m.name === "Follow confetti");
  assert.deepEqual([item.addedBy, item.kind, item.durationSeconds, item.usedByReactions], ["assistant", "video", 1, []]);
  const set = await w.M.reaction_set(w.ctx, { type: "follow", media: ["follow CONFETTI"], text: "Thanks {name}", durationSeconds: 8, sound: "off", videoSound: true, enabled: true }, w.actor);
  assert.deepEqual([set.enabled, set.media.map((m) => m.name), set.text, set.durationSeconds, set.sound, set.videoSound], [true, ["Follow confetti"], "Thanks {name}", 8, "off", true]);
  assert.deepEqual((await w.M.reaction_get(w.ctx, { type: "follow" })).media, set.media);
  assert.deepEqual((await w.M.reaction_media_list(w.ctx, {})).items.find((m) => m.name === "Follow confetti").usedByReactions, ["follow"]);
  // the test alert goes through the real path to the pages: the video of the library is in it
  const cursor = mod.readFeed(w.key, "now").cursor;
  assert.equal((await w.M.reaction_test(w.ctx, { type: "follow" }, w.actor)).sent, true);
  const ev = mod.readFeed(w.key, cursor).events.map((e) => e.event ?? e).find((e) => e.video);
  assert.equal(ev.video, item.address); assert.equal(ev.videoSound, true); assert.equal(ev.test, true);
  // the Twitch bot reads the same library by name (service alerts.show)
  assert.ok((await def.services["alerts.show"].list(w.ctx)).items.some((m) => m.name === "Follow confetti" && m.kind === "video"));
  // and the Twitch activity window can pick it "from the site"
  assert.ok((await (await import("../modules/alerts-overlay/index.mjs")).reactionService.media(w.ctx)).pictures.some((p) => p.label === "Follow confetti" && p.kind === "video"));
});

test("base64 pieces work too (mp4, gif, a sound), and a sound of the library can be the sound of an event", async () => {
  const w = world();
  assert.equal((await upload(w, "Raid clip", file("tiny-h264.mp4"), { pieces: true })).done.kind, "video");
  assert.equal((await upload(w, "Sub gif", file("tiny.gif"), { pieces: true })).done.kind, "picture");
  assert.equal((await upload(w, "Ding", file("tiny.mp3"))).done.kind, "sound");
  const set = await w.M.reaction_set(w.ctx, { type: "raid", media: ["Raid clip", "Sub gif"], order: "round_robin", sound: "Ding" }, w.actor);
  assert.deepEqual([set.order, set.sound, set.media.length], ["round_robin", "Ding", 2]);
});

test("refusals say what to do: duplicate name, a file that is not what it says, too long, wrong hash, unknown names, more than 12", async () => {
  const w = world();
  await upload(w, "Hype", file("tiny-vp9.webm"));
  await assert.rejects(w.M.reaction_media_upload_begin(w.ctx, { name: "hype", bytes: 10, sha256: "a".repeat(64) }, w.actor), exposed(/already has a file named "hype"/));
  await assert.rejects(upload(w, "Long", file("long-vp8.webm")), exposed(/30 s at most/));
  const b = await w.M.reaction_media_upload_begin(w.ctx, { name: "Bad hash", bytes: 3, sha256: "b".repeat(64) }, w.actor);
  w.ctx.putUpload(b.upload, Buffer.from("abc"));
  await assert.rejects(w.M.reaction_media_upload_finish(w.ctx, { upload: b.upload }, w.actor), exposed(/sha256/));
  await assert.rejects(w.M.reaction_set(w.ctx, { type: "sub", media: ["Nope"] }, w.actor), exposed(/No picture, GIF or video named "Nope".*Available: Hype/));
  await assert.rejects(w.M.reaction_set(w.ctx, { type: "sub", media: Array(13).fill("Hype") }, w.actor), exposed(/At most 12/));
  await assert.rejects(w.M.reaction_set(w.ctx, { type: "sub", text: "{secret}" }, w.actor), exposed(/word that does not exist/));
  await assert.rejects(w.M.reaction_set(w.ctx, { type: "nope" }, w.actor), exposed(/Unknown type/));
  await assert.rejects(w.M.reaction_set(w.ctx, { type: "sub" }, w.actor), exposed(/at least one/));
  assert.equal((await w.M.reaction_media_list(w.ctx, {})).items.length, 1, "nothing refused was kept");
});

test("delete: refused while a reaction uses the file, then the library row AND the file go", async () => {
  const w = world();
  const { done } = await upload(w, "Gift clip", file("tiny-vp9.webm"));
  await w.M.reaction_set(w.ctx, { type: "gift", media: ["Gift clip"] }, w.actor);
  await assert.rejects(w.M.reaction_media_delete(w.ctx, { media: "Gift clip" }, w.actor), exposed(/still used by the reaction of: gift/));
  await w.M.reaction_set(w.ctx, { type: "gift", media: [] }, w.actor);
  assert.equal((await w.M.reaction_media_delete(w.ctx, { media: done.id }, w.actor)).deleted, "Gift clip");
  assert.equal(w.ctx.dumpFiles().filter((f) => f.owner === "me").length, 0, "the file itself is deleted");
});

test("without the right to upload (an action without uploads, or a core before 0.18.0) the tool says so plainly", async () => {
  const w = world({ assistant: false });
  await assert.rejects(w.M.reaction_media_upload_begin(w.ctx, { name: "X", bytes: 10, sha256: "a".repeat(64) }, w.actor), exposed(/not possible here/));
  const old = world();
  delete old.ctx.api.files.upload;
  await assert.rejects(old.M.reaction_media_upload_begin(old.ctx, { name: "X", bytes: 10, sha256: "a".repeat(64) }, old.actor), exposed(/core must be updated to 0\.18\.0/));
});

const mediaTable = async (ctx) => (await def.adminPanel(ctx, { query: {} })).find((b) => b.type === "table" && b.tab === "media");
test("Media tab: 'Added by the assistant' is a pill on those rows only; without such a file the table is exactly as before", async () => {
  const w = world({ locale: "fr" });
  w.ctx.api.store.add("mediaLib", { id: "m1", name: "Mine", kind: "picture", url: "/uploads/00000001-0123-4567-89ab-0123456789ab.gif" });
  const before = await mediaTable(w.ctx);
  assert.deepEqual(before.columns, [fr.md_col_name, fr.md_col_type]);
  assert.equal(before.rows[0].length, 2);
  await upload(w, "Assistant clip", file("tiny.gif"));
  const t = await mediaTable(w.ctx);
  assert.deepEqual(t.columns, [fr.md_col_name, fr.md_col_type, "Origine"]);
  assert.deepEqual(t.rows.find((r) => r[0].text === "Assistant clip")[2], { text: "Ajouté par l'assistant", badge: "info" });
  assert.deepEqual(t.rows.find((r) => r[0].text === "Mine")[2], { text: "" }, "no label for the ordinary case (R14)");
});

test("for compositions: a transparent WebM is reported, size and duration too, and a library picture can be the poster of a video", async () => {
  const w = world();
  const { done: still } = await upload(w, "Glow still", file("tiny.gif"));
  const b = await w.M.reaction_media_upload_begin(w.ctx, { name: "Glow", bytes: file("alpha-vp9.webm").length, sha256: sha(file("alpha-vp9.webm")) }, w.actor);
  w.ctx.putUpload(b.upload, file("alpha-vp9.webm"));
  await assert.rejects(w.M.reaction_media_upload_finish(w.ctx, { upload: b.upload, poster: "Nope" }, w.actor), exposed(/No picture named "Nope"/));
  const done = await w.M.reaction_media_upload_finish(w.ctx, { upload: b.upload, poster: "glow STILL" }, w.actor);
  assert.deepEqual([done.transparent, done.poster, done.durationSeconds, done.width, done.height], [true, "Glow still", 1, 64, 36]);
  const opaque = (await upload(w, "Plain", file("tiny-vp9.webm"))).done;
  assert.equal(opaque.transparent, false);
  const list = (await w.M.reaction_media_list(w.ctx, {})).items;
  const glow = list.find((m) => m.name === "Glow");
  assert.deepEqual([glow.transparent, glow.poster, glow.durationSeconds, glow.width, glow.height], [true, "Glow still", 1, 64, 36]);
  assert.equal(list.find((m) => m.name === "Glow still").transparent, undefined, "pictures carry no transparency flag");
  await assert.rejects(w.M.reaction_media_delete(w.ctx, { media: still.id }, w.actor), exposed(/poster of: Glow/));
});

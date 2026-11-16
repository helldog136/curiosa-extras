// Alerts overlay 1.15.0: MCP tools on compositions (core 0.24.0). The assistant lists the places, reads, checks (dryRun), LOOKS at an approximate picture
// drawn by the site (decoded here with sharp: the text is really on the picture), gets an exact page for its own browser, saves, copies, removes.
// Real files (a PNG made here, a VP9 video with alpha and its still picture) in a temporary folder the core's real preview reads; the fake context is the
// core's own, with the real composition kit (never a stand-in).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

const DIR = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const cp = await import("../modules/alerts-overlay/compose.mjs");
const cm = await import("../modules/alerts-overlay/compose-mcp.mjs");
const rxEvents = await import("../modules/twitch-events/reaction.mjs");
const def = (await import("../modules/alerts-overlay/index.mjs")).default;
const CORE = process.env.CURIOSA_DIR ?? path.resolve("../Curiosa");
const PREVIEW = (fakeCtx({ key: "probe" }).overlay?.features ?? []).includes("preview");
const skip = PREVIEW ? false : "core before 0.24.0 (no preview)";

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const PIC = U(1, "png"), VID = U(2, "webm"), POSTER = U(3, "png"), PIC2 = U(4, "png");
const dir = makeTempDir("compose-mcp-");
let sharp = null;
if (PREVIEW) {
  sharp = createRequire(`${CORE}/`)("sharp");
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#f0e8c8" } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><circle cx="640" cy="300" r="220" fill="#3050c0"/></svg>') }]).png().toFile(path.join(dir, path.basename(PIC)));
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#202020" } }).png().toFile(path.join(dir, path.basename(PIC2)));
  await sharp({ create: { width: 160, height: 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="45" fill="#e02020"/></svg>') }]).png().toFile(path.join(dir, path.basename(POSTER)));
  fs.copyFileSync(path.join(CORE, "tests/fixtures/media/compose-alpha-vp9.webm"), path.join(dir, path.basename(VID)));
}
const tools = def.mcp;
const actor = { name: "Camille assistant" };
async function world() {
  tw.resetTwitchState(); cp.resetComposeCache(); cm.resetPreviewLimits();
  const ctx = fakeCtx({ key: `cm${Math.random().toString(36).slice(2, 8)}`, locale: "en", messages: en, settings: { pushToken: "x" }, permissions: manifest.permissions, uploadsDir: dir, siteUrl: "https://site.example",
    uploads: [PIC, VID, POSTER, PIC2].map((url) => ({ url, owner: "me" })) });
  const poster = await md.addOwned(ctx, { name: "Red band", kind: "picture", url: POSTER, meta: { width: 160, height: 90 } });
  await md.addOwned(ctx, { name: "Glow", kind: "video", url: VID, meta: { seconds: 1.5, width: 160, height: 90, transparent: true, posterId: poster.id } });
  await md.addOwned(ctx, { name: "Blue disc", kind: "picture", url: PIC, meta: { width: 1280, height: 720 } });
  await md.addOwned(ctx, { name: "Dark", kind: "picture", url: PIC2, meta: { width: 1280, height: 720 } });
  const set = await tools.reaction_set(ctx, { type: "sub", media: ["Blue disc", "Glow"] });
  assert.equal(set.media.length, 2);
  await tools.reaction_set(ctx, { type: "raid", media: ["Dark"] });
  return ctx;
}
const fails = async (p, re) => { await assert.rejects(p, (e) => { assert.equal(e.expose, true); assert.match(e.message, re); return true; }); };

test("manifest: seven tools, reads granted by default, writes off, remove destructive, every description in English and French", () => {
  const byName = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  for (const n of ["composition_places", "composition_get", "composition_preview", "composition_render_kit"]) assert.equal(byName[n].readOnly, true, n);
  assert.equal(byName.composition_set.default, false); assert.equal(byName.composition_copy.default, false);
  assert.equal(byName.composition_remove.destructive, true); assert.notEqual(byName.composition_remove.default, true);
  for (const n of Object.keys(byName).filter((k) => k.startsWith("composition_"))) {
    assert.ok(manifest.i18n.fr[`mcp.${n}`], `fr ${n}`); assert.equal(typeof tools[n], "function", n);
  }
  assert.equal(byName.composition_set.input.properties.composition.type, "string", "JSON passed as a string (the core's flat schema)");
  // the same automatic values per type as the window of Twitch activity
  assert.deepEqual(cm.PLACE_WORDS, rxEvents.TYPE_WORDS);
});

test("places, get: the files of each event with what the library knows, the automatic values, a starting point", { skip }, async () => {
  const ctx = await world();
  const { places, videos } = await tools.composition_places(ctx, {});
  assert.equal(videos, true);
  const sub = places.find((p) => p.place === "event:sub");
  assert.deepEqual(sub.files.map((f) => [f.src, f.kind, f.hasComposition]), [[PIC, "picture", false], [VID, "video", false]]);
  const vid = sub.files[1];
  assert.deepEqual([vid.durationSeconds, vid.width, vid.transparent, vid.poster, vid.name], [1.5, 160, true, POSTER, "Glow"]);
  assert.deepEqual(sub.automaticValues.map((x) => x.token), ["{name}", "{tier}"]);
  const g = await tools.composition_get(ctx, { place: "event:sub", src: VID });
  assert.equal(g.composition, null);
  assert.deepEqual(g.startingPoint.duration, { mode: "media", seconds: 2 }, "the video's own length, rounded up");
  assert.equal(g.startingPoint.backdrop.play, "once");
  assert.equal(g.filledWithExamples[0].text.includes("etoile_nord"), true);
  await fails(tools.composition_get(ctx, { place: "event:subscribe", src: VID }), /is not a place/);
  await fails(tools.composition_get(ctx, { place: "event:raid", src: VID }), /is not a file of event:raid.*reaction_set/s);
});

test("set: every problem at once in plain words and nothing saved; dryRun completes a video (still picture, real length); a save is the assistant's", { skip }, async () => {
  const ctx = await world();
  const bad = JSON.stringify({ v: 1, backdrop: { src: VID, play: "spin" }, boxes: [{ id: "t1", size: 400, content: { kind: "custom", text: "Merci {pseudo}" } }, { id: "t1", colour: "#fff" }] });
  await assert.rejects(tools.composition_set(ctx, { place: "event:sub", src: VID, composition: bad }, actor), (e) => {
    assert.equal(e.expose, true);
    assert.match(e.message, /^The composition has \d+ problems; nothing was saved:/);
    for (const re of [/backdrop\.play is not one of: loop, once, hold/, /boxes\[0\]\.size\) must be between 24 and 220/, /uses \{pseudo\}; this place knows \{name\}, \{tier\}/, /used twice/, /colour is not a known key/]) assert.match(e.message, re);
    return true;
  });
  await fails(tools.composition_set(ctx, { place: "event:sub", src: VID, composition: "{oops" }, actor), /not valid JSON/);
  assert.equal(ctx.dumpStore().filter((r) => r.collection === "compositions").length, 0);
  const text = JSON.stringify({ v: 1, format: "16:9", backdrop: { src: VID, play: "hold" }, duration: { mode: "media", seconds: 9 }, boxes: [{ id: "t1", x: 1, y: 70, w: 98, h: 25, look: "bare" }] });
  const dry = await tools.composition_set(ctx, { place: "event:sub", src: VID, composition: text, dryRun: true }, actor);
  assert.equal(dry.saved, false);
  assert.equal(dry.composition.backdrop.poster, POSTER);
  assert.deepEqual(dry.composition.duration, { mode: "media", seconds: 2 });
  assert.ok(dry.warnings.some((w) => /safe margin/.test(w)) && dry.warnings.some((w) => /still picture/.test(w)) && dry.warnings.some((w) => /own length/.test(w)), dry.warnings.join(" | "));
  assert.equal(ctx.dumpStore().filter((r) => r.collection === "compositions").length, 0, "dryRun saves nothing");
  const saved = await tools.composition_set(ctx, { place: "event:sub", src: VID, composition: text }, actor);
  assert.equal(saved.saved, true);
  const [row] = ctx.dumpStore().filter((r) => r.collection === "compositions");
  assert.equal(row.data.by, "assistant:Camille assistant");
  assert.equal(row.data.composition.backdrop.play, "hold");
  // what the editor and the alert then see: the same placement
  assert.equal((await def.services["alerts.reaction"].get(ctx, { type: "sub" })).compositions[VID].backdrop.poster, POSTER);
  const places = await tools.composition_places(ctx, {});
  const vid = places.places.find((p) => p.place === "event:sub").files.find((f) => f.src === VID);
  assert.equal(vid.hasComposition, true); assert.equal(vid.by, "assistant:Camille assistant");
});

test("preview: an IMAGE result the core sends as image content, the text really drawn on the picture; 20 a minute", { skip, timeout: 60000 }, async () => {
  const ctx = await world();
  const comp = JSON.stringify({ v: 1, format: "16:9", backdrop: { src: PIC }, boxes: [{ id: "t1", x: 10, y: 72, w: 80, h: 22, look: "readable" }, { id: "t2", x: 10, y: 6, w: 80, h: 18, content: { kind: "custom", text: "{name} · tier {tier}" } }] });
  const r = await tools.composition_preview(ctx, { place: "event:sub", src: PIC, composition: comp, sample: "long" }, actor);
  const SYM = Symbol.for("curiosa.mcp.image");
  assert.equal(r[SYM], true);
  assert.equal(r.mimeType, "image/png");
  const meta = await sharp(Buffer.from(r.data)).metadata();
  assert.deepEqual([meta.width, meta.height], [960, 540]);
  assert.equal(r.info.approximate, true); assert.equal(r.info.saved, false);
  assert.equal(r.info.boxes[1].text, "etoile_nord_lune_douce_xy · tier 3", "long examples");
  assert.equal(r.info.boxes[0].readableBy, "band");
  // the band of box 1 is on the picture: dark pixels where the bright ground was
  const { data, info } = await sharp(Buffer.from(r.data)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[(y * info.width + x) * 3];
  let dark = 0;
  for (let x = 120; x < 840; x += 4) if (at(x, 470) < 80) dark++;
  assert.ok(dark > 20, `band pixels: ${dark}`);
  // a video: its still picture, transparent parts on the checkerboard
  const v = await tools.composition_preview(ctx, { place: "event:sub", src: VID, composition: JSON.stringify({ v: 1, format: "16:9", backdrop: { src: VID }, boxes: [{ id: "t1" }] }) }, actor);
  assert.equal(v.info.backdrop, "video-still");
  // the saved one, without sending it
  await fails(tools.composition_preview(ctx, { place: "event:raid", src: PIC2 }, actor), /no text placed/);
  // 20 a minute for one access
  for (let i = 2; i < cm.PREVIEW_PER_MINUTE; i++) await tools.composition_preview(ctx, { place: "event:sub", src: PIC, composition: comp, width: 320 }, actor);
  await fails(tools.composition_preview(ctx, { place: "event:sub", src: PIC, composition: comp, width: 320 }, actor), /20 previews a minute at most/);
  await tools.composition_preview(ctx, { place: "event:sub", src: PIC, composition: comp, width: 320 }, { name: "another access" });
});

test("render kit, copy, remove: a page for the assistant's browser on the site's files; boxes copied to a file of another event; removal keeps the file", { skip }, async () => {
  const ctx = await world();
  await tools.composition_set(ctx, { place: "event:sub", src: PIC, composition: JSON.stringify({ v: 1, backdrop: { src: PIC }, boxes: [{ id: "t1", y: 60, h: 30, content: { kind: "custom", text: "Merci {name}" } }] }) }, actor);
  const kit = await tools.composition_render_kit(ctx, { place: "event:sub", src: PIC });
  assert.match(kit.html, /<base href="https:\/\/site\.example\/">/);
  assert.match(kit.html, /window\.CuriosaCompose\.mount/);
  assert.match(kit.howTo, /#t=2\.5/);
  const copy = await tools.composition_copy(ctx, { fromPlace: "event:sub", fromSrc: PIC, toPlace: "event:raid", toSrc: PIC2 }, actor);
  assert.equal(copy.composition.backdrop.src, PIC2);
  assert.equal(copy.composition.boxes[0].content.text, "Merci {name}");
  // a value the target does not know is refused, with the list
  await tools.composition_set(ctx, { place: "event:sub", src: PIC, composition: JSON.stringify({ v: 1, backdrop: { src: PIC }, boxes: [{ id: "t1", content: { kind: "custom", text: "Tier {tier}" } }] }) }, actor);
  await fails(tools.composition_copy(ctx, { fromPlace: "event:sub", fromSrc: PIC, toPlace: "event:raid", toSrc: PIC2 }, actor), /uses \{tier\}; this place knows \{name\}, \{viewers\}/);
  const rm = await tools.composition_remove(ctx, { place: "event:raid", src: PIC2 });
  assert.equal(rm.removed, true);
  assert.deepEqual((await def.services["alerts.reaction"].get(ctx, { type: "raid" })).variants.map((x) => x.src), [PIC2], "the file stays on the reaction");
  assert.equal((await tools.composition_remove(ctx, { place: "event:raid", src: PIC2 })).removed, false);
});

test("an older core: clear words, nothing breaks", async () => {
  const ctx = fakeCtx({ key: "old", locale: "en", messages: en, overlay: null, permissions: manifest.permissions });
  await fails(tools.composition_places(ctx, {}), /0\.19\.0 or later/);
  if (PREVIEW) {
    const c2 = fakeCtx({ key: "old2", locale: "en", messages: en, permissions: manifest.permissions });
    const { features, ...kit } = c2.overlay;
    c2.overlay = { ...kit, features: ["video"] };
    await fails(tools.composition_preview(c2, { place: "event:sub", src: PIC }, actor), /0\.22\.0 or later/);
    assert.ok(features);
  }
});

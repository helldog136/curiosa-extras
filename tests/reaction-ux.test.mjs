// Reaction of an event type (Overlay alertes 1.9.0 + Activité Twitch 1.5.0 window; 1.18.0: one module, the window and the reactions are the overlay's own): list of
// variants, random pick, files kept by the overlay.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world as evWorld, mod as evMod, en as evEn, fr as evFr } from "./helpers/eventsWorld.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const AL = new URL("../modules/alerts-overlay", import.meta.url).pathname;
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const alMan = json(`${AL}/module.json`), alEn = json(`${AL}/locales/en.json`), alFr = json(`${AL}/locales/fr.json`);
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const rx = await import("../modules/alerts-overlay/reaction.mjs");
const alIndex = await import("../modules/alerts-overlay/index.mjs");
const alDef = alIndex.default;
const evRx = await import("../modules/alerts-overlay/twitch/reaction.mjs");

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const G = (n) => U(n, "gif"), V = (n) => U(100 + n, "mp4"), P = (n) => U(200 + n, "png"), WAV = U(300, "mp3");
/** (1.18.0) ONE copy of the overlay on a site with Twitch: the window of Twitch activity and the reactions are the same module (`al` and `ev` are the same context). */
function both({ uploads = [], locale = "en" } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const w = evWorld({ locale, uploads });
  const sent = []; globalThis.__curiosaAlertsBus?.on?.(w.ctx.instance.key, (e) => sent.push(e));
  return { al: w.ctx, ev: w.ctx, sent };
}
const form = (blocks) => blocks.find((b) => b.presentation === "dialog" && b.action === "saveReaction");
const val = (id, over = {}) => ({ id, variants: "[]", pick: "random", text: "", sound: "", audio: "", seconds: "", ...over });
const gal = (...urls) => JSON.stringify(urls.map((src) => ({ src })));

test("pick: random never repeats twice in a row (seeded), rotate goes in order, a list of one is always the first", () => {
  let seed = 7; const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (const size of [2, 3, 12]) { let last = -1; const seen = new Set(); for (let i = 0; i < 400; i++) { const k = tw.chooseIndex({ n: size, mode: "random", last, rng }); assert.ok(k >= 0 && k < size); assert.notEqual(k, last); seen.add(k); last = k; } assert.equal(seen.size, size, "every variant comes"); }
  assert.deepEqual([0, 1, 2, 3, 4].reduce((a) => [...a, tw.chooseIndex({ n: 3, mode: "rotate", last: a.at(-1) ?? -1 })], []), [0, 1, 2, 0, 1]);
  assert.equal(tw.chooseIndex({ n: 1, mode: "random", last: 0 }), 0); assert.equal(tw.chooseIndex({ n: 0 }), 0);
  assert.equal(tw.chooseIndex({ n: 2, mode: "random", last: 0, rng: () => 0.999999 }), 1); assert.equal(tw.chooseIndex({ n: 2, mode: "random", last: 1, rng: () => 0 }), 0);
});

test("a configuration without variants stays exactly as it was; a list of one is the old single picture, byte for byte", async () => {
  const raw = { types: { follow: { present: "gif", image: G(1) } } };
  const cfg = tw.normaliseConfig(raw);
  assert.equal("variants" in cfg.types.follow, false); assert.equal("pick" in cfg.types.follow, false);
  const item = { id: "a", type: "follow", name: "Camille", at: new Date().toISOString(), test: true };
  const env = { text: (k) => `t_${k}`, title: (p) => p };
  const legacy = tw.alertFor(item, { config: cfg, ...env });
  const w = both({ uploads: [{ url: G(1), by: "u1" }] });
  await tw.saveConfig(w.al, raw);
  assert.ok((await rx.set(w.al, "follow", { variants: [G(1)] })).ok);
  const after = tw.alertFor(item, { config: await tw.loadConfig(w.al), ...env });
  assert.deepEqual(after, legacy);
  assert.deepEqual((await tw.loadConfig(w.al)).types.follow, cfg.types.follow, "stored as before: no list for one picture");
});

test("service: several files sent at once are all kept (one claim each), the list is limited to 12, the order and the pick rule are saved", async () => {
  const files = Array.from({ length: 13 }, (_, i) => G(i + 1));
  const w = both({ uploads: files.map((url) => ({ url, by: "u1" })) });
  const r = await rx.set(w.al, "follow", { variants: files.slice(0, 3).map((src) => ({ src })), pick: "rotate" });
  assert.ok(r.ok); assert.deepEqual([r.images, r.videos, r.pick], [3, 0, "rotate"]);
  assert.equal(w.al.calls.files.filter((c) => c.op === "claim" && c.result.ok).length, 3);
  const got = await rx.get(w.al, "follow");
  assert.equal(got.text, "", "the sentence is a string, never a flag");
  assert.deepEqual(got.variants.map((x) => x.src), files.slice(0, 3)); assert.equal(got.pick, "rotate"); assert.equal(got.max, 12);
  assert.deepEqual((await rx.set(w.al, "follow", { variants: files.map((src) => ({ src })) })).errors, { variants: "limit" });
  assert.equal((await rx.get(w.al, "follow")).variants.length, 3, "nothing changed by a refused save");
  assert.deepEqual((await rx.set(w.al, "follow", { variants: [{ src: "https://elsewhere.example.org/a.gif" }] })).errors, { variants: "file" });
  assert.deepEqual((await rx.set(w.al, "follow", { variants: [{ src: G(99) }] })).errors, { variants: "kept" }, "a file the person did not just send is refused");
  assert.deepEqual((await rx.set(w.al, "nope", {})).code, "type");
});

test("service: removing a variant releases its file; a file also held by the library or another type is kept", async () => {
  const files = [G(1), G(2), G(3), V(1)];
  const w = both({ uploads: files.map((url) => ({ url, by: "u1" })) });
  await rx.set(w.al, "follow", { variants: [G(1), G(2), V(1)] });
  assert.deepEqual([(await rx.get(w.al, "follow")).images, (await rx.get(w.al, "follow")).videos], [2, 1]);
  assert.ok((await md.add(w.al, { name: "Applause", kind: "picture", url: G(3) })).ok);
  await rx.set(w.al, "follow", { variants: [G(1), G(3)] });
  const removed = () => w.al.calls.files.filter((c) => c.op === "remove").map((c) => c.url);
  assert.deepEqual(removed().sort(), [G(2), V(1)].sort(), "G2 and the video are let go");
  await rx.set(w.al, "sub", { variants: [G(3)] });
  await rx.set(w.al, "follow", { variants: [] });
  assert.ok(removed().includes(G(1)) && !removed().includes(G(3)), "G1 is released, G3 kept (library and another type)");
  const lib = (await md.list(w.al, { tones: false })).find((m) => m.name === "Applause");
  await md.remove(w.al, lib.id);
  assert.ok(!removed().includes(G(3)), "the library lets go of it but the sub reaction still uses it");
  await rx.set(w.al, "sub", { variants: [] });
  assert.ok(removed().includes(G(3)), "the last holder lets it go");
});

test("service: replacing the single picture of the older window also lets the old one go", async () => {
  const w = both({ uploads: [G(1), G(2)].map((url) => ({ url, by: "u1" })) });
  await rx.set(w.al, "follow", { variants: [G(1)] });
  await alDef.adminActions.saveType(w.al, { id: "follow", image: G(2), present: "gif" });
  assert.ok(w.al.calls.files.some((c) => c.op === "remove" && c.url === G(1)));
  assert.equal((await tw.loadConfig(w.al)).types.follow.image, G(2));
});

test("the alert shows the picked variant: a picture alone, a video alone, never the same one twice; rotate follows the order; state survives", async () => {
  const w = both({ uploads: [G(1), G(2), V(1)].map((url) => ({ url, by: "u1" })) });
  await rx.set(w.al, "follow", { variants: [G(1), G(2), V(1)], pick: "rotate" });
  const cfg = await tw.loadConfig(w.al), pick = tw.pickerOf(tw.stateOf(w.al));
  const shots = [1, 2, 3, 4].map((i) => tw.alertFor({ id: `r${i}`, type: "follow", name: "Camille", at: new Date().toISOString(), test: true }, { config: cfg, text: (k) => k, title: (p) => p, pick }).alert);
  assert.deepEqual(shots.map((a) => a.image ?? a.video), [G(1), G(2), V(1), G(1)]);
  assert.equal(shots[2].present, "media"); assert.equal(shots[0].present, "media");
  await rx.set(w.al, "follow", { pick: "random" });
  const c2 = await tw.loadConfig(w.al); let last = null;
  for (let i = 0; i < 40; i++) { const a = tw.alertFor({ id: `x${i}`, type: "follow", name: "C", at: new Date().toISOString(), test: true }, { config: c2, text: (k) => k, title: (p) => p, pick }).alert; const u = a.image ?? a.video; assert.notEqual(u, last); last = u; }
});

test("test button: builds the alert with what is typed, saved or not; nothing is saved or claimed", async () => {
  const w = both({ uploads: [{ url: G(1), by: "u1" }] });
  const got = [];
  globalThis.__curiosaAlertsBus.on(w.al.instance.key, (e) => got.push(e));
  const r = await alIndex.reactionService.test(w.al, { type: "follow", patch: { variants: [{ src: G(1) }], text: "Hi {name}" } });
  assert.ok(r.ok); assert.equal(got.at(-1).image, G(1));
  assert.equal((await tw.loadConfig(w.al)).types.follow.image, ""); assert.equal(w.al.calls.files.filter((c) => c.op === "claim").length, 0);
  assert.deepEqual((await alIndex.reactionService.test(w.al, { type: "follow", patch: { text: "Hi {nope}" } })).errors, { text: "words" });
});

test("manifests: one module, no reaction service between modules; core 0.15.0; FR/EN parity", () => {
  assert.ok(!alMan.offers.some((x) => ["alerts.reaction", "alerts.reaction.editor"].includes(x.service)), "the protocol between the two halves is gone");
  assert.ok(alMan.permissions.includes("files")); assert.equal(alMan.minCore, "0.36.0");
  assert.deepEqual(Object.keys(alEn).sort(), Object.keys(alFr).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(alEn).filter((k) => k.startsWith("rx_") || k.startsWith("cl_"))) assert.equal(vars(alEn[k]), vars(alFr[k]), k);
});

test("Types tab: a Reaction column (one line per row), Edit in a window, the test in the menu; the window has a gallery and the order, the rest folded", async () => {
  const w = both({ uploads: [{ url: G(1), by: "u1" }, { url: G(2), by: "u1" }] });
  await rx.set(w.al, "follow", { variants: [G(1), G(2)], sound: "chime" });
  await rx.set(w.al, "raid", { variants: [V(1)].slice(0, 0) });
  const blocks = await evMod.adminPanel(w.ev, { query: { tab: "twitch" } });
  const table = blocks.find((b) => b.tab === "twitch" && b.type === "table");
  const col = table.columns.indexOf("Reaction"); assert.ok(col > 0);
  assert.equal(table.rows[0][col].text, "2 GIFs · At random + sound"); assert.equal(table.rows[1][col].text, "Text");
  assert.equal(table.searchable, true);
  assert.deepEqual(table.rowActions.map((a) => [a.label, a.presentation ?? "", !!a.inMenu]), [["Edit", "dialog", false], ["Send a test", "", true], ["Try again", "", true]]);
  assert.ok(!blocks.some((b) => b.tab === "twitch" && b.type === "links"), "no state line when the overlay is there");
  const open = await evMod.adminPanel(w.ev, { query: { tab: "twitch", reaction: "follow" } });
  const f = form(open);
  assert.ok(f.cancelHref && f.extraActions.length === 1 && f.submitLabel === "Save the reaction");
  const visible = f.fields.filter((x) => x.kind !== "hidden" && !x.folded);
  assert.deepEqual(visible.map((x) => x.kind), ["gallery", "segmented"]);
  const g = f.fields.find((x) => x.kind === "gallery"); assert.deepEqual([g.max, g.accept], [12, ["image", "video"]]);
  assert.equal(JSON.parse(g.value).length, 2);
  assert.deepEqual(f.fields.find((x) => x.name === "pick").options.map((o) => o.label), ["At random", "In turn"]);
  assertAdminPageErgonomics(open);
  assertAdminPageErgonomics(blocks);
  assert.ok(!(await evMod.adminPanel(w.ev, { query: { tab: "twitch", reaction: "zzz" } })).some((b) => b.action === "saveReaction"), "an unknown type opens nothing");
});

test("FR: the window and the column in French, same shape", async () => {
  const w = both({ locale: "fr", uploads: [{ url: G(1), by: "u1" }] });
  await rx.set(w.al, "follow", { variants: [G(1)] });
  const open = await evMod.adminPanel(w.ev, { query: { tab: "twitch", reaction: "follow" } });
  assert.equal(form(open).submitLabel, "Enregistrer la réaction"); assert.deepEqual(form(open).fields.find((x) => x.name === "pick").options.map((o) => o.label), ["Au hasard", "À tour de rôle"]);
  assertAdminPageErgonomics(open);
  assert.equal((await evMod.adminPanel(w.ev, { query: { tab: "twitch" } })).find((b) => b.tab === "twitch" && b.type === "table").rows[0].some((c) => c?.text === "GIF"), true);
});

test("save from the window: carries the person (asCaller), the overlay keeps the files; errors come back under their field with an example", async () => {
  const w = both({ uploads: [G(1), G(2), G(3)].map((url) => ({ url, by: "u1" })) });
  const A = evMod.adminActions;
  const ok = await A.saveReaction(w.ev, val("follow", { variants: gal(G(1), G(2), G(3)), pick: "rotate", sound: "chime", seconds: "8" }));
  assert.match(ok.ok, /reaction saved/);
  const cfg = (await tw.loadConfig(w.al)).types.follow;
  assert.deepEqual([cfg.variants, cfg.pick, cfg.sound, cfg.seconds], [[G(1), G(2), G(3)], "rotate", "chime", 8]);
  assert.equal(w.al.calls.files.filter((c) => c.op === "claim" && c.result.ok).length, 3);
  const bad = await A.saveReaction(w.ev, val("follow", { text: "Hello {nope}", seconds: "99" }));
  assert.match(bad.errors.text, /Unknown word.*for example \{name\}/); assert.match(bad.errors.seconds, /for example 8/);
  assert.match((await A.saveReaction(w.ev, val("follow", { variants: gal(G(50)) }))).errors.variants, /could not be kept/);
  assert.match((await A.saveReaction(w.ev, val("follow", { variants: gal(...Array.from({ length: 13 }, (_, i) => G(i + 1))) }))).errors.variants, /At most 12/);
  assert.ok((await A.saveReaction(w.ev, val("zzz"))).error);
  assert.deepEqual((await A.saveReaction(w.ev, val("follow", { variants: "not json" }))).ok !== undefined, true, "a broken list is read as empty, never a crash");
});

test("test from the window: sends the typed values to the overlay without saving", async () => {
  const w = both({ uploads: [{ url: G(1), by: "u1" }] });
  const got = []; globalThis.__curiosaAlertsBus.on(w.al.instance.key, (e) => got.push(e));
  const r = await evMod.adminActions.testReaction(w.ev, val("follow", { variants: gal(G(1)) }));
  assert.match(r.ok, /Test sent/); assert.equal(got.at(-1).image, G(1)); assert.equal((await tw.loadConfig(w.al)).types.follow.image, "");
  assert.match((await evMod.adminActions.testReaction(w.ev, val("follow", { seconds: "1" }))).errors.seconds, /2 to 60/);
});

test("summary wording: Text, GIF, 3 GIFs · at random, Video, files + sound, '—' without the service", () => {
  const ctx = fakeCtx({ locale: "en", messages: evEn });
  const s = (o) => evRx.summaryText(ctx, { images: 0, videos: 0, sound: false, pick: null, ...o });
  assert.deepEqual([s({}), s({ images: 1 }), s({ images: 3, pick: "random" }), s({ videos: 1, sound: true }), s({ images: 2, videos: 1, pick: "rotate" }), evRx.summaryText(ctx, null)], ["Text", "GIF", "3 GIFs · At random", "Video + sound", "3 files · In turn", "—"]);
});

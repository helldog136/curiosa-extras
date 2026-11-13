// Reaction of an event type (Overlay alertes 1.9.0 service `alerts.reaction` + Activité Twitch 1.5.0 window): list of variants, random pick, files kept by the overlay, fallback without it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world as evWorld, A as evAdmin, mod as evMod } from "./helpers/eventsWorld.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const AL = new URL("../modules/alerts-overlay", import.meta.url).pathname, EV = new URL("../modules/twitch-events", import.meta.url).pathname;
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const alMan = json(`${AL}/module.json`), alEn = json(`${AL}/locales/en.json`), alFr = json(`${AL}/locales/fr.json`);
const evMan = json(`${EV}/module.json`), evEn = json(`${EV}/locales/en.json`), evFr = json(`${EV}/locales/fr.json`);
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const rx = await import("../modules/alerts-overlay/reaction.mjs");
const adminTw = await import("../modules/alerts-overlay/twitch-admin.mjs");
const alDef = (await import("../modules/alerts-overlay/index.mjs")).default;
const evRx = await import("../modules/twitch-events/reaction.mjs");

const U = (n, ext) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.${ext}`;
const G = (n) => U(n, "gif"), V = (n) => U(100 + n, "mp4"), P = (n) => U(200 + n, "png"), WAV = U(300, "mp3");
let n = 0;
/** An overlay and a Twitch activity that talk through the real service code of the overlay (the person is carried, as the core 0.14.0 does with asCaller). */
function both({ uploads = [], locale = "en", noOverlay = false } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const al = fakeCtx({ key: `rx${++n}`, moduleId: "alerts-overlay", locale: "en", messages: alEn, settings: { pushToken: "x" }, permissions: alMan.permissions, uploads });
  const sent = []; globalThis.__curiosaAlertsBus?.on?.(al.instance.key, (e) => sent.push(e));
  const w = evWorld({ locale });
  const svc = alDef.services["alerts.reaction"], calls = [];
  const methods = Object.fromEntries(Object.keys(svc).map((k) => [k, (args) => { calls.push(k); return svc[k](al, args); }]));
  if (!noOverlay) {
    const base = w.ctx.api.services;
    w.ctx.api.services = { ...base, providers: async (name) => (name === "alerts.reaction" ? [{ id: "id-al", key: "al", name: "Alerts", module: "alerts-overlay", version: 1, each: true, master: true }] : base.providers(name)),
      call: async (name, method, args, opts) => { if (name !== "alerts.reaction") return base.call(name, method, args, opts); calls.push(`${method}${opts?.asCaller ? ":asCaller" : ""}`); try { return { ok: true, value: await svc[method](al, args) }; } catch { return { ok: false, reason: "failed" }; } } };
    w.ctx.api.instances = { ...w.ctx.api.instances, list: async () => [{ id: "al", key: "al", adminPath: "/admin/instances/al" }] };
  }
  return { al, ev: w.ctx, calls, sent };
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
  const r = await alDef.services["alerts.reaction"].test(w.al, { type: "follow", patch: { variants: [{ src: G(1) }], text: "Hi {name}" } });
  assert.ok(r.ok); assert.equal(got.at(-1).image, G(1));
  assert.equal((await tw.loadConfig(w.al)).types.follow.image, ""); assert.equal(w.al.calls.files.filter((c) => c.op === "claim").length, 0);
  assert.deepEqual((await alDef.services["alerts.reaction"].test(w.al, { type: "follow", patch: { text: "Hi {nope}" } })).errors, { text: "words" });
});

test("manifests: the service is offered with callerRights (set) and read-only reads; Twitch activity asks for it as optional; core 0.14.0; FR/EN parity", () => {
  const o = alMan.offers.find((x) => x.service === "alerts.reaction");
  assert.deepEqual([o.version, o.each, o.callerRights, o.readOnly], [1, true, ["set"], ["list", "get", "media"]]);
  assert.ok(alMan.permissions.includes("files")); assert.equal(alMan.minCore, "0.14.0"); assert.equal(evMan.minCore, "0.14.0");
  assert.deepEqual(evMan.requires.find((x) => x.service === "alerts.reaction"), { service: "alerts.reaction", min: 1, optional: true });
  assert.deepEqual(Object.keys(evEn).sort(), Object.keys(evFr).sort()); assert.deepEqual(Object.keys(alEn).sort(), Object.keys(alFr).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(evEn).filter((k) => k.startsWith("rx_") || k.startsWith("cl_"))) assert.equal(vars(evEn[k]), vars(evFr[k]), k);
});

test("Types tab: a Reaction column (one line per row), Edit in a window, the test in the menu; the window has a gallery and the order, the rest folded", async () => {
  const w = both({ uploads: [{ url: G(1), by: "u1" }, { url: G(2), by: "u1" }] });
  await rx.set(w.al, "follow", { variants: [G(1), G(2)], sound: "chime" });
  await rx.set(w.al, "raid", { variants: [V(1)].slice(0, 0) });
  const blocks = await evMod.adminPanel(w.ev, { query: { tab: "types" } });
  const table = blocks.find((b) => b.tab === "types" && b.type === "table");
  const col = table.columns.indexOf("Reaction"); assert.ok(col > 0);
  assert.equal(table.rows[0][col].text, "2 GIFs · At random + sound"); assert.equal(table.rows[1][col].text, "Text");
  assert.equal(table.searchable, true);
  assert.deepEqual(table.rowActions.map((a) => [a.label, a.presentation ?? "", !!a.inMenu]), [["Edit", "dialog", false], ["Send a test", "", true]]);
  assert.ok(!blocks.some((b) => b.tab === "types" && b.type === "links"), "no state line when the overlay is there");
  const open = await evMod.adminPanel(w.ev, { query: { tab: "types", reaction: "follow" } });
  const f = form(open);
  assert.ok(f.cancelHref && f.extraActions.length === 1 && f.submitLabel === "Save the reaction");
  const visible = f.fields.filter((x) => x.kind !== "hidden" && !x.folded);
  assert.deepEqual(visible.map((x) => x.kind), ["gallery", "segmented"]);
  const g = f.fields.find((x) => x.kind === "gallery"); assert.deepEqual([g.max, g.accept], [12, ["image", "video"]]);
  assert.equal(JSON.parse(g.value).length, 2);
  assert.deepEqual(f.fields.find((x) => x.name === "pick").options.map((o) => o.label), ["At random", "In turn"]);
  assertAdminPageErgonomics(open);
  assertAdminPageErgonomics(blocks);
  assert.ok(!(await evMod.adminPanel(w.ev, { query: { tab: "types", reaction: "zzz" } })).some((b) => b.action === "saveReaction"), "an unknown type opens nothing");
});

test("FR: the window and the column in French, same shape", async () => {
  const w = both({ locale: "fr", uploads: [{ url: G(1), by: "u1" }] });
  await rx.set(w.al, "follow", { variants: [G(1)] });
  const open = await evMod.adminPanel(w.ev, { query: { tab: "types", reaction: "follow" } });
  assert.equal(form(open).submitLabel, "Enregistrer la réaction"); assert.deepEqual(form(open).fields.find((x) => x.name === "pick").options.map((o) => o.label), ["Au hasard", "À tour de rôle"]);
  assertAdminPageErgonomics(open);
  assert.equal((await evMod.adminPanel(w.ev, { query: { tab: "types" } })).find((b) => b.tab === "types" && b.type === "table").rows[0].some((c) => c?.text === "GIF"), true);
});

test("save from Twitch activity: carries the person (asCaller), the overlay keeps the files; errors come back under their field with an example", async () => {
  const w = both({ uploads: [G(1), G(2), G(3)].map((url) => ({ url, by: "u1" })) });
  const A = evMod.adminActions;
  const ok = await A.saveReaction(w.ev, val("follow", { variants: gal(G(1), G(2), G(3)), pick: "rotate", sound: "chime", seconds: "8" }));
  assert.match(ok.ok, /reaction saved/); assert.ok(w.calls.includes("set:asCaller"));
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

test("test from Twitch activity: sends the typed values to the overlay without saving", async () => {
  const w = both({ uploads: [{ url: G(1), by: "u1" }] });
  const got = []; globalThis.__curiosaAlertsBus.on(w.al.instance.key, (e) => got.push(e));
  const r = await evMod.adminActions.testReaction(w.ev, val("follow", { variants: gal(G(1)) }));
  assert.match(r.ok, /Test sent/); assert.equal(got.at(-1).image, G(1)); assert.equal((await tw.loadConfig(w.al)).types.follow.image, "");
  assert.match((await evMod.adminActions.testReaction(w.ev, val("follow", { seconds: "1" }))).errors.seconds, /2 to 60/);
});

test("without the overlay: one state line with a link, no dead Edit button, no summary; actions answer in plain words", async () => {
  const w = both({ noOverlay: true });
  w.ev.api.instances = { ...w.ev.api.instances, list: async () => [] };
  const blocks = await evMod.adminPanel(w.ev, { query: { tab: "types", reaction: "follow" } });
  const line = blocks.find((b) => b.tab === "types" && b.type === "links");
  assert.deepEqual([line.items[0].label, line.items[0].href], ["Alerts overlay: to add", "/admin/catalogue"]);
  const table = blocks.find((b) => b.tab === "types" && b.type === "table");
  assert.ok(table.rowActions.every((a) => a.presentation !== "dialog")); assert.ok(!table.columns.includes("Reaction"), "no column of identical dashes"); assert.ok(table.rows.every((r) => r.length === table.columns.length));
  assert.ok(!blocks.some((b) => b.action === "saveReaction"), "no window without the overlay");
  assert.match((await evMod.adminActions.saveReaction(w.ev, val("follow"))).error, /does not answer/);
  assertAdminPageErgonomics(blocks);
  const old = both({ noOverlay: true }); // a copy exists but is too old to offer the service
  old.ev.api.instances = { ...old.ev.api.instances, list: async () => [{ id: "al", key: "al", adminPath: "/admin/instances/al" }] };
  const l2 = (await evMod.adminPanel(old.ev, { query: { tab: "types" } })).find((b) => b.tab === "types" && b.type === "links");
  assert.deepEqual([l2.items[0].label, l2.items[0].href], ["Alerts overlay: to update", "/admin/instances/al"]);
});

test("checklist: ticks for Twitch authorized, listening and the overlay added, each with its link; nothing when all is done", async () => {
  const w = both({ noOverlay: true }); w.ev.api.instances = { ...w.ev.api.instances, list: async () => [] };
  const t1 = await evRx.checklist(w.ev, { authorized: false, listening: false, authorizeHref: "https://id.example.org/auth" });
  assert.deepEqual(t1.rows.map((r) => [r[0], r[1].text, r[1].badge]), [["Twitch authorized", "To do", "warn"], ["Listening to Twitch", "To do", "warn"], ["Alerts overlay added", "To do", "warn"]]);
  assert.equal(t1.rows[0][2].href, "https://id.example.org/auth"); assert.equal(t1.rows[2][2].href, "/admin/catalogue");
  const ok = both({});
  assert.equal(await evRx.checklist(ok.ev, { authorized: true, listening: true }), null);
  const t2 = await evRx.checklist(ok.ev, { authorized: true, listening: false });
  assert.deepEqual(t2.rows.map((r) => r[1].badge), ["ok", "warn", "ok"]);
  const page = await evMod.adminPanel(w.ev, { query: {} });
  assert.ok(page.some((b) => b.type === "table" && b.columns.includes("Step")));
  assertAdminPageErgonomics(page);
});

test("summary wording: Text, GIF, 3 GIFs · at random, Video, files + sound, '—' without the service", () => {
  const ctx = fakeCtx({ locale: "en", messages: evEn });
  const s = (o) => evRx.summaryText(ctx, { images: 0, videos: 0, sound: false, pick: null, ...o });
  assert.deepEqual([s({}), s({ images: 1 }), s({ images: 3, pick: "random" }), s({ videos: 1, sound: true }), s({ images: 2, videos: 1, pick: "rotate" }), evRx.summaryText(ctx, null)], ["Text", "GIF", "3 GIFs · At random", "Video + sound", "3 files · In turn", "—"]);
});

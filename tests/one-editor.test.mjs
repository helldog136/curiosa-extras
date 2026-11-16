// One editor per Twitch event type (Alerts overlay 1.13.0, Twitch activity 1.10.0).
// With Twitch activity active and editing this copy of the overlay (service `alerts.reaction.editor`), the "Twitch events" tab of the overlay is a summary with a link;
// the window "Reaction" of Twitch activity edits everything (service `alerts.reaction` version 2: minimum, animation, voice, viewer text).
// Without it (alerts from another tool, YouTube only, an older Twitch activity, a second copy of the overlay), the overlay keeps its full editor. Nothing is migrated.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { world as evWorld, mod as evMod } from "./helpers/eventsWorld.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

const AL = new URL("../modules/alerts-overlay", import.meta.url).pathname, EV = new URL("../modules/twitch-events", import.meta.url).pathname;
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const alMan = json(`${AL}/module.json`), evMan = json(`${EV}/module.json`);
const msgs = { al: { en: json(`${AL}/locales/en.json`), fr: json(`${AL}/locales/fr.json`) }, ev: { en: json(`${EV}/locales/en.json`), fr: json(`${EV}/locales/fr.json`) } };
const tw = await import("../modules/alerts-overlay/twitch.mjs");
const md = await import("../modules/alerts-overlay/media.mjs");
const adminTw = await import("../modules/alerts-overlay/twitch-admin.mjs");
const alDef = (await import("../modules/alerts-overlay/index.mjs")).default;
const evRx = await import("../modules/twitch-events/reaction.mjs");

const G = (n) => `/uploads/${String(n).padStart(8, "0")}-0123-4567-89ab-0123456789ab.gif`;
const declared = (man, name) => (man.requires ?? []).some((r) => r.service === name);
let n = 0;

/**
 * A site: an overlay copy (and optionally a second one) and, when `activity` is set, Twitch activity. They talk through the REAL service code of both modules, and, like the core,
 * a module only reaches a service it declares in `requires`; `providers` lists only active instances with their version (an older module offers an older version, or nothing).
 * activity: null (not installed) | "current" | "old" (1.9.0: offers no editor service, reads version 1 of the reaction service)
 */
function site({ activity = "current", locale = "en", second = false, overlayVersion = 2, uploads = [] } = {}) {
  tw.resetTwitchState(); md.resetValve();
  const mk = (key) => fakeCtx({ key, moduleId: "alerts-overlay", locale, messages: msgs.al[locale], settings: { pushToken: "x" }, permissions: alMan.permissions, uploads });
  const al = mk(`one${++n}`), al2 = second ? mk(`two${n}`) : null;
  const w = activity ? evWorld({ locale }) : null, ev = w?.ctx ?? null;
  const svc = alDef.services["alerts.reaction"], edSvc = evMod.services?.["alerts.reaction.editor"];
  // version 1 of the reaction service, as an older overlay answers: no settings of version 2
  const v1 = async (method, args) => { const r = await svc[method](al, args); if (method === "get" && r?.ok) for (const k of ["version", "min", "minMax", "anim", "anims", "tts", "ttsModes", "viewer", "viewerMax", "viewerMaxLimits"]) delete r[k]; return r; };
  const reactionCall = (method, args) => (overlayVersion >= 2 ? svc[method](al, args) : v1(method, args));
  for (const ctx of [al, al2].filter(Boolean)) {
    ctx.api.services = { ...ctx.api.services,
      providers: async (name) => (!declared(alMan, name) ? [] : name === "alerts.reaction.editor" && activity === "current" ? [{ id: "id-ev", key: "ev", name: "Twitch activity", module: "twitch-events", version: 1, each: false, master: true }] : []),
      call: async (name, method, args) => {
        if (!declared(alMan, name)) return { ok: false, reason: "undeclared" };
        if (name !== "alerts.reaction.editor" || activity !== "current") return { ok: false, reason: "unavailable" };
        if (typeof edSvc?.[method] !== "function") return { ok: false, reason: "no_method" };
        try { return { ok: true, value: await edSvc[method](ev, args) }; } catch { return { ok: false, reason: "failed" }; }
      } };
    ctx.api.instances = { ...ctx.api.instances, list: async ({ module } = {}) => (module === "twitch-events" && activity ? [{ id: "id-ev", key: "ev", module: "twitch-events", basePath: null, name: "Twitch activity", adminPath: "/admin/instances/id-ev" }] : []) };
  }
  if (ev) {
    const base = ev.api.services;
    // the overlay copies offer `alerts.reaction` with `each`: the call without a provider reaches the FIRST copy (creation order)
    ev.api.services = { ...base, providers: async (name) => (name === "alerts.reaction" ? [al, al2].filter(Boolean).map((c, i) => ({ id: `id-${c.instance.key}`, key: c.instance.key, name: c.instance.name, module: "alerts-overlay", version: overlayVersion, each: true, master: false })) : base.providers(name)),
      call: async (name, method, args, opts) => { if (name !== "alerts.reaction") return base.call(name, method, args, opts); try { return { ok: true, value: await reactionCall(method, args) }; } catch { return { ok: false, reason: "failed" }; } } };
    ev.api.instances = { ...ev.api.instances, list: async () => [{ id: al.instance.key, key: al.instance.key, adminPath: `/admin/instances/${al.instance.key}` }] };
  }
  return { al, al2, ev };
}
const typesTable = (blocks) => blocks.find((b) => b.type === "table" && b.tab === "twitch");
const editDialog = (blocks) => blocks.find((b) => b.presentation === "dialog" && b.action === "saveType");
const reactionDialog = (blocks) => blocks.find((b) => b.presentation === "dialog" && b.action === "saveReaction");

test("without Twitch activity the Twitch events tab keeps the full editor: five columns, Edit the alert, its window", async () => {
  for (const locale of ["en", "fr"]) {
    const { al } = site({ activity: null, locale });
    const blocks = await alDef.adminPanel(al, { query: { edit: "cheer" } });
    const table = typesTable(blocks);
    assert.equal(table.columns.length, 5); assert.equal(table.rowActions[0].href, "?tab=twitch&edit={id}");
    assert.ok(editDialog(blocks), "its own window opens");
    assert.ok(blocks.some((b) => b.type === "markdown" && b.text === msgs.al[locale].tw_absent), "says how to get Twitch events");
    assertAdminPageErgonomics(blocks);
  }
});

test("an older Twitch activity (no editor service) keeps the full editor too", async () => {
  const { al } = site({ activity: "old" });
  const blocks = await alDef.adminPanel(al, { query: { edit: "follow" } });
  assert.equal(typesTable(blocks).columns.length, 5); assert.ok(editDialog(blocks));
  assert.equal(blocks.find((b) => b.type === "links" && b.tab === "twitch").items[0].href, "/admin/instances/id-ev");
  assert.equal(await adminTw.editorOf(al), null);
});

test("with Twitch activity: a summary (type, what is shown with its order, switch) and Set in Twitch activity on each row; no second editor", async () => {
  for (const locale of ["en", "fr"]) {
    const { al } = site({ locale, uploads: [G(1), G(2), G(3)].map((url) => ({ url, by: "u1" })) });
    const rx = alDef.services["alerts.reaction"];
    assert.ok((await rx.set(al, { type: "follow", patch: { variants: [{ src: G(1) }, { src: G(2) }], pick: "rotate", sound: "chime" } })).ok);
    assert.ok((await rx.set(al, { type: "raid", patch: { variants: [{ src: G(3) }] } })).ok);
    assert.ok((await rx.set(al, { type: "cheer", patch: { min: "500" } })).ok);
    const blocks = await alDef.adminPanel(al, { query: { edit: "cheer" } });
    const table = typesTable(blocks), t = msgs.al[locale];
    assert.deepEqual(table.columns, [t.tw_col_type, t.tw_col_shown, t.tw_col_on]);
    assert.deepEqual(table.rowActions.map((a) => [a.label, a.href ?? a.action, !!a.inMenu]), [[t.tw_editor_btn, "/admin/instances/id-ev?tab=types&reaction={id}", false], [t.tw_test_btn, "testType", true]]);
    assert.equal(editDialog(blocks), undefined, "the window of this tab is not offered, even from an old link");
    const row = (id) => table.rows[table.rowIds.indexOf(id)];
    assert.equal(row("follow")[1].text, locale === "en" ? "2 GIFs · In turn + sound" : "2 GIF · À tour de rôle + son", "the display order is said only with several files"); assert.equal(row("follow")[1].image.src, G(1)); assert.ok(row("follow")[1].title, "the sentence in the tooltip");
    assert.equal(row("raid")[1].text, "GIF", "one file has no order");
    assert.equal(row("online")[1].text, row("online")[1].title, "a text alone says its sentence");
    assert.notEqual(row("online")[1].text, row("offline")[1].text, "no identical label on every text row (R14)");
    assert.ok(table.rows.every((r) => r[2].switch), "the switch stays: showing a type on THIS overlay is not edited anywhere else");
    assert.equal(blocks.some((b) => b.type === "links" && b.tab === "twitch"), false, "the rows carry the link");
    // what stays in the tab: the text styles, the preview, the test evening, the queue
    for (const a of ["applyPreset", "simulate", "pause", "clearQueue"]) assert.ok(blocks.some((b) => b.action === a), a);
    assertAdminPageErgonomics(blocks);
    // the switch still works from the summary
    assert.ok((await alDef.adminActions.setType(al, { id: "follow", enabled: "0" })).ok);
    assert.equal((await tw.loadConfig(al)).types.follow.on, false);
  }
});

test("the link opens the Reaction window of Twitch activity on that type", async () => {
  const { al, ev } = site();
  const href = typesTable(await alDef.adminPanel(al, { query: {} })).rowActions[0].href.replace("{id}", "cheer");
  const q = Object.fromEntries(new URL(href, "https://site.example.org").searchParams);
  assert.deepEqual(q, { tab: "types", reaction: "cheer" });
  assert.ok(reactionDialog(await evMod.adminPanel(ev, { query: q })), "the window of the type opens");
});

test("a second copy of the overlay is not the one Twitch activity writes to: it keeps its own editor", async () => {
  const { al, al2 } = site({ second: true });
  assert.deepEqual(await adminTw.editorOf(al), { path: "/admin/instances/id-ev", name: "Fake" });
  assert.equal(await adminTw.editorOf(al2), null);
  assert.equal(typesTable(await alDef.adminPanel(al2, { query: {} })).columns.length, 5);
});

test("an editor that does not answer, or answers nonsense, never hides the editor", async () => {
  const { al } = site();
  const real = al.api.services;
  for (const value of [null, { edits: true, path: "https://elsewhere.example.org/x" }, { edits: true }, { edits: "yes", path: "/admin/instances/x" }]) {
    al.api.services = { ...real, call: async () => ({ ok: true, value }) };
    assert.equal(await adminTw.editorOf(al), null, JSON.stringify(value));
  }
  al.api.services = { ...real, call: async () => { throw new Error("down"); } };
  assert.equal(await adminTw.editorOf(al), null);
  al.api.services = { ...real, call: async () => ({ ok: false, reason: "unavailable" }) };
  assert.equal(typesTable(await alDef.adminPanel(al, { query: {} })).columns.length, 5);
});

test("the Reaction window edits what the overlay tab edited: minimum, animation, voice, viewer text (all folded), and saves them in the overlay", async () => {
  for (const locale of ["en", "fr"]) {
    const { al, ev } = site({ locale });
    const dlg = reactionDialog(await evMod.adminPanel(ev, { query: { tab: "types", reaction: "cheer" } }));
    const byName = Object.fromEntries(dlg.fields.map((f) => [f.name, f]));
    for (const k of ["min", "anim", "tts", "viewer", "viewerMax"]) assert.equal(byName[k]?.folded, true, k);
    assert.equal(byName.more.value, "2");
    assert.equal(dlg.fields.filter((f) => f.kind !== "hidden" && !f.folded).length, 2, "the short path stays files and order (R2)");
    assert.equal(byName.min.label, msgs.ev[locale].rx_f_min_cheer);
    assert.equal(byName.anim.options.length, tw.ANIMS.length); assert.ok(byName.anim.options.every((o) => !o.label.startsWith("rx_")), "every animation has words");
    assert.ok(byName.tts.options.every((o) => !o.label.startsWith("rx_")));
    const r = await evMod.adminActions.saveReaction(ev, { id: "cheer", variants: "[]", pick: "random", text: "", sound: "", audio: "", seconds: "", more: "2", min: "500", anim: "fade", tts: "both", viewer: "on", viewerMax: "80" });
    assert.ok(r.ok, JSON.stringify(r));
    const c = (await tw.loadConfig(al)).types.cheer;
    assert.deepEqual([c.min, c.anim, c.tts, c.viewer, c.viewerMax], [500, "fade", "both", true, 80]);
    // switched off again from the window: an unticked switch sends nothing
    assert.ok((await evMod.adminActions.saveReaction(ev, { id: "cheer", variants: "[]", pick: "random", more: "2", min: "", anim: "", tts: "", viewerMax: "" })).ok);
    const c2 = (await tw.loadConfig(al)).types.cheer;
    assert.deepEqual([c2.min, c2.anim, c2.tts, c2.viewer, c2.viewerMax], [0, "", "off", false, 140]);
    // errors under the field, with an example; nothing saved
    const bad = await evMod.adminActions.saveReaction(ev, { id: "cheer", variants: "[]", pick: "random", more: "2", min: "-3", anim: "zzz", tts: "", viewerMax: "9" });
    assert.deepEqual(Object.keys(bad.errors).sort(), ["anim", "min", "viewerMax"]);
    assert.equal(bad.errors.min, msgs.ev[locale].rx_err_min);
    // (a select cannot send an unknown animation from the page: that sentence is for a forged form only)
    assert.ok((await alDef.services["alerts.reaction"].set(al, { type: "follow", patch: { sound: "chime" } })).ok);
    assertAdminPageErgonomics(await evMod.adminPanel(ev, { query: { tab: "types", reaction: "cheer" } }), { errors: [bad.errors.min, bad.errors.viewerMax] });
    // a follow has no minimum and no viewer text
    const f = reactionDialog(await evMod.adminPanel(ev, { query: { tab: "types", reaction: "follow" } }));
    assert.deepEqual(f.fields.filter((x) => ["min", "viewer", "viewerMax"].includes(x.name)), []);
  }
});

test("with an older overlay (service version 1) the window shows and sends only what it understands", async () => {
  const { al, ev } = site({ overlayVersion: 1 });
  const dlg = reactionDialog(await evMod.adminPanel(ev, { query: { tab: "types", reaction: "cheer" } }));
  assert.deepEqual(dlg.fields.filter((f) => ["more", "min", "anim", "tts", "viewer", "viewerMax"].includes(f.name)), []);
  assert.equal(evRx.patchOf({ variants: "[]", min: "5", anim: "fade" }).min, undefined, "without the window's mark, nothing of version 2 is sent");
  await tw.saveConfig(al, { types: { cheer: { min: 300, anim: "pop" } } });
  assert.ok((await evMod.adminActions.saveReaction(ev, { id: "cheer", variants: "[]", pick: "random" })).ok);
  const c = (await tw.loadConfig(al)).types.cheer;
  assert.deepEqual([c.min, c.anim], [300, "pop"], "kept as they were");
});

test("version 2 of the service: get gives the settings of the type with their choices; a version 1 patch changes none of them", async () => {
  const { al } = site({ activity: null });
  const rx = alDef.services["alerts.reaction"];
  await tw.saveConfig(al, { types: { resub: { min: 0, tts: "text", viewer: true, viewerMax: 90, anim: "jiggle" } } });
  const g = await rx.get(al, { type: "resub" });
  assert.deepEqual([g.version, g.min, g.tts, g.viewer, g.viewerMax, g.anim], [2, null, "text", true, 90, "jiggle"], "a resub has no minimum");
  assert.deepEqual(g.anims, tw.ANIMS); assert.deepEqual(g.ttsModes, tw.TTS_MODES); assert.deepEqual(g.viewerMaxLimits, tw.TTS_LIMITS.viewerMax);
  assert.equal((await rx.get(al, { type: "follow" })).viewer, null);
  assert.ok((await rx.set(al, { type: "resub", patch: { text: "Thanks {name}" } })).ok);
  const c = (await tw.loadConfig(al)).types.resub;
  assert.deepEqual([c.tts, c.viewer, c.viewerMax, c.anim], ["text", true, 90, "jiggle"]);
  assert.deepEqual((await rx.set(al, { type: "cheer", patch: { min: "1.5" } })).errors, { min: "range" });
  assert.deepEqual((await rx.set(al, { type: "cheer", patch: { tts: "loud" } })).errors, { tts: "choice" });
  assert.ok((await rx.set(al, { type: "follow", patch: { min: "999" } })).ok, "a minimum on a type without one is ignored");
  assert.equal((await tw.loadConfig(al)).types.follow.min, 0);
});

test("the editor service: says whether it edits the asked copy, and where its window is; read only", async () => {
  const { al, al2, ev } = site({ second: true });
  const ed = evMod.services["alerts.reaction.editor"].editor;
  assert.deepEqual(await ed(ev, { instance: al.instance.key }), { edits: true, path: `/admin/instances/${ev.instance.id}`, name: ev.instance.name });
  assert.equal((await ed(ev, { instance: al2.instance.key })).edits, false);
  ev.api.services = { ...ev.api.services, providers: async () => [] };
  assert.equal((await ed(ev, { instance: al.instance.key })).edits, false, "no overlay to write to: it edits nothing");
});

test("manifests: Twitch activity offers the editor service (read only), the overlay asks for it as optional and offers version 2; nothing becomes required", () => {
  const offer = evMan.offers.find((o) => o.service === "alerts.reaction.editor");
  assert.deepEqual([offer.version, offer.readOnly], [1, ["editor"]]); assert.ok(offer.label.en && offer.label.fr);
  const need = alMan.requires.find((r) => r.service === "alerts.reaction.editor");
  assert.equal(need.optional, true); assert.ok(need.label.en && need.label.fr);
  assert.ok(alMan.requires.every((r) => r.optional === true), "the overlay installs and works alone");
  assert.equal(alMan.offers.find((o) => o.service === "alerts.reaction").version, 2);
  assert.deepEqual(evMan.requires.find((r) => r.service === "alerts.reaction"), { service: "alerts.reaction", min: 1, optional: true }, "an older overlay still works with Twitch activity");
  assert.deepEqual([alMan.version, evMan.version], ["1.13.0", "1.10.0"]);
  for (const m of ["al", "ev"]) assert.deepEqual(Object.keys(msgs[m].en).sort(), Object.keys(msgs[m].fr).sort(), m);
});

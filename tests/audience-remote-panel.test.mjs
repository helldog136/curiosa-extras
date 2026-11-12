// Audience 1.9.0 adds, to a switch, groups of segmented choices and a folded explanation (tests at the end); 1.8.0: what a plugged-in module may describe in its panel of the remote control, besides buttons and forms: a SWITCH (shows the current state), values and a heading on buttons,
// a small badge under the tab name and one note. Everything is text, bounded and checked here; the old panels (Polls) are not changed.
import test from "node:test";
import assert from "node:assert/strict";
import { L, R, C, manifest } from "./helpers/audienceHarness.mjs";
import { world } from "./helpers/audienceWorld.mjs";

const base = { title: "Panel", tab: "Tab" };

test("a switch: id, label (40), state sentence (60), hint (80), the values it sends; `on` only when strictly true; at most three; unusable ones are dropped", () => {
  const p = L.sanitizePanel({ ...base, toggles: [
    { id: "pause", label: "L".repeat(80), on: true, text: "T".repeat(90), hint: "H".repeat(120), values: { a: "1", B: "no", n: 5, deep: { x: 1 } } },
    { id: "two", label: "Second", on: "yes" },
    { id: "Bad Id", label: "Nope" }, { id: "nolabel", label: "" }, null, "x", 3,
    { id: "three", label: "Third", on: false }, { id: "four", label: "Fourth" },
  ] });
  assert.deepEqual(p.toggles.map((t) => t.id), ["pause", "two", "three"]);
  assert.deepEqual([p.toggles[0].label.length, p.toggles[0].text.length, p.toggles[0].hint.length], [40, 60, 80]);
  assert.deepEqual(p.toggles[0].values, { a: "1", n: "5" }, "text values with plain names only");
  assert.deepEqual([p.toggles[0].on, p.toggles[1].on, p.toggles[2].on], [true, false, false]);
});

test("a button may carry values and a heading; a badge, an alert flag and a note are bounded; a panel without them gets empty ones", () => {
  const p = L.sanitizePanel({ ...base, buttons: [{ id: "undo", label: "Delete !hello", values: { id: "c1x" }, group: "Just added".repeat(5) }, { id: "plain", label: "Plain" }], badge: "B".repeat(30), alert: true, note: "N".repeat(300) });
  assert.deepEqual(p.buttons[0].values, { id: "c1x" }); assert.equal(p.buttons[0].group.length, 30);
  assert.deepEqual([p.buttons[1].values, p.buttons[1].group], [{}, ""]);
  assert.deepEqual([p.badge.length, p.alert, p.note.length], [14, true, 160]);
  const old = L.sanitizePanel({ title: "Old", buttons: [{ id: "go", label: "Go" }] });
  assert.deepEqual([old.toggles, old.badge, old.alert, old.note], [[], "", false, ""]);
  assert.equal(L.sanitizePanel({ ...base, alert: "true" }).alert, false, "strictly true");
});

test("Polls panel is unchanged by the new fields (same buttons, same view, nothing added but empty defaults)", async () => {
  const w = world({ audience: true });
  const panels = await R.collectPanels(w.aud);
  const polls = panels.find((p) => p.title);
  assert.ok(polls && polls.view && polls.buttons.length > 0);
  assert.deepEqual([polls.toggles, polls.badge, polls.alert, polls.note], [[], "", false, ""]);
  assert.ok(polls.buttons.every((b) => Object.keys(b).sort().join() === "confirm,disabled,group,id,label,tone,values"));
});

test("the page script draws the switch with role=switch, aria-checked, a visible state sentence, a busy sentence and an error under it; no innerHTML", () => {
  assert.match(C.REMOTE_JS, /setAttribute\("role", "switch"\)/);
  assert.match(C.REMOTE_JS, /setAttribute\("aria-checked"/);
  assert.match(C.REMOTE_JS, /st\.textContent = T\.busy/);
  assert.match(C.REMOTE_JS, /ui\.errors\[key\]/);
  assert.doesNotMatch(C.REMOTE_JS, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
});

test("the page carries the word for 'working' in both languages, and the journal words for the bot gestures exist in both", async () => {
  const { fr, en } = await import("./helpers/audienceHarness.mjs");
  for (const d of [fr, en]) for (const k of ["remoteBusy", "what_panel_pause", "what_panel_resume", "what_panel_addcom", "what_panel_undo", "what_panel_collabon", "what_panel_collaboff", "what_panel_collabset", "remoteExplain", "remoteMore"]) assert.ok(d[k], k);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.equal(manifest.version, "1.9.0");
  assert.deepEqual(manifest.offers.map((o) => o.service), ["audience.session", "audience.draw"], "the contract of the services Audience offers is not changed");
  assert.deepEqual(manifest.requires, [{ service: "audience.remote", optional: true }], "the remote is still optional for plugged-in modules, and nothing else is required");
});

/* ───────────── 1.9.0: choices under a switch, a calm "off", a folded explanation ───────────── */

test("a switch may carry groups of segmented choices: at most 3 groups of 2 to 5 options, bounded texts, one action and one value name each; the rest is dropped", () => {
  const opt = (value, label, on) => ({ value, label, on });
  const p = L.sanitizePanel({ ...base, toggles: [{ id: "collabon", label: "Mode", on: false, calm: true, more: "M".repeat(900), foldLabel: "F".repeat(60), choices: [
    { id: "collabset", name: "timers", label: "L".repeat(50), hint: "H".repeat(120), options: [opt("pause", "Pause", true), opt("2", "1 in 2"), opt("3", "X".repeat(30)), opt(5, "1 in 5"), opt("6", "six"), opt("7", "seven")] },
    { id: "collabset", name: "hours", label: "Stops after", folded: true, options: [opt("2", "2 h"), opt("0", "Never", "yes")] },
    { id: "Bad Id", name: "x", label: "Nope", options: [opt("1", "a"), opt("2", "b")] },
    { id: "collabset", name: "Bad-Name", label: "Nope", options: [opt("1", "a"), opt("2", "b")] },
    { id: "collabset", name: "alone", label: "One option", options: [opt("1", "a")] },
    { id: "collabset", name: "fourth", label: "Fourth", options: [opt("1", "a"), opt("2", "b")] },
    { id: "collabset", name: "fifth", label: "Fifth", options: [opt("1", "a"), opt("2", "b")] },
  ] }] });
  const t = p.toggles[0];
  assert.deepEqual([t.calm, t.more.length, t.foldLabel.length], [true, 400, 30]);
  assert.deepEqual(t.choices.map((g) => g.name), ["timers", "hours", "fourth"], "3 groups at most; unusable ones are dropped before the cut");
  const g = t.choices[0];
  assert.deepEqual([g.id, g.label.length, g.hint.length, g.folded, g.options.length], ["collabset", 30, 80, false, 5]);
  assert.deepEqual(g.options.map((o) => [o.value, o.label.length, o.on]), [["pause", 5, true], ["2", 6, false], ["3", 14, false], ["5", 6, false], ["6", 3, false]]);
  assert.deepEqual([t.choices[1].folded, t.choices[1].options.map((o) => o.on)], [true, [false, false]], "`on` only when strictly true");
});

test("a switch without the new fields comes out exactly as before (same keys), and a panel without switches is unchanged", () => {
  const p = L.sanitizePanel({ ...base, toggles: [{ id: "pause", label: "Bot answers", on: true, text: "On", hint: "Hint", values: { a: "1" }, choices: "no", more: "", calm: false }] });
  assert.deepEqual(Object.keys(p.toggles[0]).sort(), ["hint", "id", "label", "on", "text", "values"]);
  assert.deepEqual(L.sanitizeChoices(undefined), []); assert.deepEqual(L.sanitizeChoices([null, 3, {}]), []);
  assert.equal(L.LIMITS.toggles, 3);
});

test("the page script draws the choices as a radio group of buttons (aria-checked, 'working' on the pressed one), a calm switch, and two folds that keep their state; no innerHTML", () => {
  assert.match(C.REMOTE_JS, /setAttribute\("role", "radiogroup"\)/);
  assert.match(C.REMOTE_JS, /setAttribute\("role", "radio"\)/);
  assert.match(C.REMOTE_JS, /tg\.calm/);
  assert.match(C.REMOTE_JS, /h\("details", "mo"\)/);
  assert.match(C.REMOTE_JS, /setAttribute\("aria-expanded"/);
  assert.match(C.REMOTE_JS, /q\.title = text/);
  assert.match(C.REMOTE_JS, /ui\.fold\[fk\]/);
  assert.doesNotMatch(C.REMOTE_JS, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
});

test("the journal has words for the choices gesture, and Audience still has no new route, permission or required service", async () => {
  const { fr, en } = await import("./helpers/audienceHarness.mjs");
  for (const d of [fr, en]) assert.ok(d.what_panel_collabset && d.remoteExplain);
  assert.deepEqual(manifest.permissions, ["slots", "pages", "routes", "storage", "overlay", "admin", "mcp"]);
});

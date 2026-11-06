// Audience 1.8.0: what a plugged-in module may describe in its panel of the remote control, besides buttons and forms: a SWITCH (shows the current state), values and a heading on buttons,
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
  assert.match(C.REMOTE_JS, /ui\.errors\[t\.pid \+ ":tg"\]/);
  assert.doesNotMatch(C.REMOTE_JS, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
});

test("the page carries the word for 'working' in both languages, and the journal words for the bot gestures exist in both", async () => {
  const { fr, en } = await import("./helpers/audienceHarness.mjs");
  for (const d of [fr, en]) for (const k of ["remoteBusy", "what_panel_pause", "what_panel_resume", "what_panel_addcom", "what_panel_undo"]) assert.ok(d[k], k);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  assert.equal(manifest.version, "1.8.0");
  assert.deepEqual(manifest.offers.map((o) => o.service), ["audience.session", "audience.draw"], "the contract of the services Audience offers is not changed");
  assert.deepEqual(manifest.requires, [{ service: "audience.remote", optional: true }], "the remote is still optional for plugged-in modules, and nothing else is required");
});

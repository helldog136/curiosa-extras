// The control dock: a custom poll length (typed in one field) and a poll question (title), for quick polls. Unit level, no browser:
// the parser and its bounds, the same validation as the website's quick form, what the dock remembers, and the shape sent to the page.
// The tap-by-tap behavior in a real browser is in dock-flows.test.mjs; the layout in dock-layout.test.mjs. Invented data only.
import test from "node:test";
import assert from "node:assert/strict";
import { world, pollsMod, pollsDef, pollsFr, pollsEn } from "./helpers/audienceWorld.mjs";
import { def as audDef, K as AK, req as areq, L as AL } from "./helpers/audienceHarness.mjs";

const L = await import("../modules/polls/lib.mjs");
const BASE = "https://x.test/m/audience";
const polls = async (c) => (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const sec = (p) => (Date.parse(p.endsAt) - Date.parse(p.createdAt)) / 1000;

async function remote(w) {
  await AK.ensureMeta(w.aud);
  const key = (await w.aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const press = async (action, values = {}) => { const r = await audDef.routes["remote-press"](areq(`${BASE}/remote-press`, { k: key, panel: "id-polls", action, values }), w.aud); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const view = async () => (await (await audDef.routes["remote-state"](areq(`${BASE}/remote-state?k=${key}`), w.aud)).json()).panels.find((p) => p.id === "id-polls").view;
  return { press, view };
}
const field = (v, name) => v.form.fields.find((f) => f.name === name);

test("parser: one rule for a typed time - a whole number alone is seconds, m / min is minutes, m:ss is minutes and seconds; nothing else", () => {
  const ok = { "45": 45, "90": 90, "1:30": 90, "2m": 120, "90s": 90, "2 min": 120, "2 minutes": 120, "1m30": 90, "1m 30s": 90, "90 sec": 90, "90 secondes": 90, " 2:30 ": 150, "2M": 120, "0:45": 45 };
  for (const [text, n] of Object.entries(ok)) assert.equal(L.parseDuration(text), n, text);
  for (const bad of ["", "abc", "1.5", "1,5 m", "-3", "1:75", "1:2", "m", "2h", "1 2", "9".repeat(30), null, undefined, "2m30m"]) assert.equal(L.parseDuration(bad), null, String(bad));
  assert.deepEqual([L.showDuration(45), L.showDuration(150), L.showDuration(900), L.showDuration(60)], ["45 s", "2:30", "15:00", "1:00"]);
});

test("bounds: the quick poll limits are the module's own (15 s to 15 min); the website form, the dock and the assistant tool share one check", () => {
  assert.deepEqual([L.QUICK.minSeconds, L.QUICK.maxSeconds], [15, 900]);
  const q = (seconds) => L.validateQuick({ a: "x", b: "y", seconds });
  for (const good of ["15", "900", "15s", "15 sec", "15m", "0:15", "2:30", "1m30"]) assert.equal(q(good).errors.seconds, undefined, good);
  for (const bad of ["14", "901", "0:14", "16m", "15:01", "abc", "other"]) assert.equal(q(bad).errors.seconds, "quick_seconds", bad);
  assert.equal(q("").value.seconds, 60, "empty keeps the usual default");
  for (const [msgs, l] of [[pollsEn, "en"], [pollsFr, "fr"]]) {
    const m = msgs.err_quick_seconds;
    assert.ok(m.includes("15 s") && m.includes("15 min") && m.includes("2:30") && !m.endsWith(":"), `${l}: the error gives the bounds and an example`);
    assert.ok(msgs.fQuickSecondsExample.includes("90 s") && msgs.fQuickSecondsExample.includes("2:30"), l);
  }
});

test("dock form: Question first (folded away on a short stage), the durations then 'Other' last; 'Last' appears only after a custom time was used", async () => {
  const w = world({ locale: "en" }); const rm = await remote(w);
  let v = await rm.view();
  assert.deepEqual(v.form.fields.map((f) => f.name), ["question", "a", "b", "seconds", "c", "d"]);
  const qf = field(v, "question");
  assert.deepEqual([qf.low, qf.max, qf.example, qf.recall], [true, L.LIMITS.question, "e.g. Do we raid now?", ""]);
  const s = field(v, "seconds");
  assert.deepEqual(s.options.map((o) => [o.value, o.custom, o.last]), [["30", false, false], ["60", false, false], ["120", false, false], ["300", false, false], ["other", true, false]]);
  assert.equal(s.value, "60"); assert.equal(s.example, "e.g. 90 s or 2:30");
  assert.ok(s.options.every((o) => o.label.length <= 40 && o.short.length <= 10), "labels and short labels fit the dock");
  assert.deepEqual(v.chips.filter((c) => c.id === "poll-yesno").map((c) => c.with), [["question"]]);
  // Typed once as text: the poll runs that long, and the next form offers it as a chip
  const r = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "2:30", question: "" });
  assert.deepEqual([r.status, r.ok], [200, true]);
  const p = (await polls(w.polls))[0]; assert.equal(sec(p), 150);
  await rm.press("poll-close", { id: p.id });
  v = await rm.view();
  assert.deepEqual(field(v, "seconds").options.map((o) => o.value), ["30", "60", "120", "300", "150", "other"]);
  const last = field(v, "seconds").options.find((o) => o.last);
  assert.deepEqual([last.label, last.short], ["Last: 2:30", "↺2:30"]);
  // A preset, even typed as text, is not "remembered" as a custom time; a new custom value replaces the old one
  await rm.press("poll-cancel", {});
  await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "2m" });
  await rm.press("poll-cancel", {});
  assert.equal(field(await rm.view(), "seconds").options.some((o) => o.last && o.value === "120"), false);
  assert.equal(field(await rm.view(), "seconds").options.find((o) => o.last).value, "150", "the preset did not replace the remembered custom time");
  await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "45" });
  assert.equal(sec((await polls(w.polls))[0]), 45);
  await rm.press("poll-cancel", {});
  assert.equal(field(await rm.view(), "seconds").options.find((o) => o.last).value, "45", "a new custom time replaces the old one");
});

test("dock form: a wrong time is refused under its field with the bounds and an example; nothing starts; 'other' alone is refused; the journal says it", async () => {
  for (const [locale, msgs] of [["en", pollsEn], ["fr", pollsFr]]) {
    const w = world({ locale }); const rm = await remote(w);
    for (const bad of ["abc", "7", "20m", "other", "1.5"]) {
      const r = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: bad });
      assert.deepEqual([r.status, r.ok, r.error, r.field, r.message], [400, false, "invalid", "seconds", msgs.err_quick_seconds], `${locale} ${bad}`);
    }
    assert.equal((await polls(w.polls)).length, 0, "nothing started");
    const ok = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "90 s" });
    assert.equal(ok.ok, true); assert.equal(sec((await polls(w.polls))[0]), 90);
    const audit = (await w.aud.api.store.list("audit")).map((r) => r.data);
    assert.ok(audit.some((l) => l.who === "remote" && l.what === "polls.quick"), "journal line as before");
  }
});

test("question: filled, it is the title of Yes / No, Repeat and the A / B form; empty, the usual default stays; it is cut at the module's title limit; the last one is offered", async () => {
  const w = world({ locale: "en" }); const rm = await remote(w);
  let r = await rm.press("poll-yesno", {}); assert.ok(r.ok);
  let p = (await polls(w.polls))[0]; assert.equal(p.question, pollsEn.quickQuestion2.replace("{a}", "Yes").replace("{b}", "No"), "empty: the default title, one tap");
  await rm.press("poll-close", { id: p.id });
  assert.equal(field(await rm.view(), "question").recall, "", "nothing typed yet, nothing to recall");
  r = await rm.press("poll-yesno", { question: "  Do we   raid now?  " }); assert.ok(r.ok);
  p = (await polls(w.polls)).find((x) => L.stateOf(x) === "open"); assert.equal(p.question, "Do we raid now?"); assert.deepEqual(p.choices.map((c) => c.text), ["Yes", "No"]);
  await rm.press("poll-close", { id: p.id });
  let v = await rm.view(); const qf = field(v, "question");
  assert.deepEqual([qf.recall, qf.recallLabel], ["Do we raid now?", "Last: Do we raid now?"]);
  assert.deepEqual(v.chips.map((c) => c.id), ["poll-yesno", "poll-again", "start"]);
  assert.deepEqual(v.chips.find((c) => c.id === "poll-again").with, ["question"]);
  r = await rm.press("poll-again", { question: "Same again, shall we?" }); assert.ok(r.ok);
  p = (await polls(w.polls)).find((x) => L.stateOf(x) === "open"); assert.equal(p.question, "Same again, shall we?");
  await rm.press("poll-close", { id: p.id });
  r = await rm.press("poll-again", {}); assert.ok(r.ok);
  p = (await polls(w.polls)).find((x) => L.stateOf(x) === "open"); assert.equal(p.question, "Same again, shall we?", "Repeat without a question repeats the last title");
  await rm.press("poll-close", { id: p.id });
  r = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "60", question: "x".repeat(300) }); assert.ok(r.ok);
  p = (await polls(w.polls)).find((x) => L.stateOf(x) === "open"); assert.equal(p.question.length, L.LIMITS.question, "the same limit as the website");
  assert.equal(L.validateQuick({ a: "x", b: "y", question: "y".repeat(300) }).value.question.length, L.LIMITS.question);
  await rm.press("poll-close", { id: p.id });
  r = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "60", question: "Cats or dogs tonight?" }); assert.ok(r.ok);
  assert.equal((await polls(w.polls)).find((x) => L.stateOf(x) === "open").question, "Cats or dogs tonight?");
  r = await rm.press("quick", { a: "Cats", b: "Dogs", seconds: "60", question: "" }); // an open poll already runs: refused, the question memory keeps the last typed one
  v = await rm.view(); assert.ok(v);
  const meta = (await w.polls.api.store.list("meta")).map((x) => x.data).find((d) => d.k === "dock");
  assert.deepEqual([meta.question, meta.seconds], ["Cats or dogs tonight?", undefined]);
});

test("question: control characters and blank text count as empty; it is stored as plain text and never run", async () => {
  const w = world({ locale: "en" }); const rm = await remote(w);
  const r = await rm.press("poll-yesno", { question: " \u0007‮  " }); assert.ok(r.ok);
  assert.equal((await polls(w.polls))[0].question, pollsEn.quickQuestion2.replace("{a}", "Yes").replace("{b}", "No"));
  assert.equal((await w.polls.api.store.list("meta")).some((x) => x.data.k === "dock" && x.data.question), false, "a blank question is not remembered");
});

test("sanitize: only the described shapes reach the page (field name list on a button, 'low', 'recall', custom and last options)", () => {
  const v = AL.sanitizeView({ type: "poll", stage: "idle", title: "T", chips: [{ id: "poll-yesno", label: "Yes / No", with: ["question", "Bad Name", "a".repeat(40), "b", "c", "d", "e"] }],
    form: { id: "quick", title: "Q", submit: "Go", fields: [
      { name: "question", label: "Q", type: "text", max: 140, low: true, recall: "r".repeat(300), recallLabel: "Last: r", example: "e.g. x" },
      { name: "seconds", label: "D", type: "select", seg: true, options: [{ value: "60", label: "1 minute", short: "1 min" }, { value: "150", label: "Last: 2:30", short: "↺2:30", last: true }, { value: "other", label: "Other", short: "Other", custom: true }] }] } });
  assert.deepEqual(v.chips[0].with, ["question", "b", "c", "d"]);
  const [q, s] = v.form.fields;
  assert.deepEqual([q.low, q.recall.length, q.recallLabel], [true, 140, "Last: r"]);
  assert.deepEqual(s.options.map((o) => [o.custom, o.last]), [[false, false], [false, true], [true, false]]);
  assert.deepEqual(AL.sanitizeView({ type: "poll", stage: "idle", chips: [{ id: "x", label: "X" }] }).chips[0].with, []);
});

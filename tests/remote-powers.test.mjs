// Remote control 1.5.0 (Audience) / Polls 1.5.0 — every power of the website for live moderation, from the remote: close, cancel, reopen, extend, show on screen, tidy up,
// repeat, yes/no, "pick someone else", cancel a draw, reopen entries and "stop everything". Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import { world, pollsMod, pollsDef, pollsFr, pollsEn, tok } from "./helpers/audienceWorld.mjs";
import { def as audDef, K as AK, req as areq, audienceCtx, fr as audFr, en as audEn } from "./helpers/audienceHarness.mjs";

const L = await import("../modules/polls/lib.mjs");
const D = await import("../modules/audience/draw.mjs");
const R = await import("../modules/audience/remote.mjs");

const BASE = "https://x.test/m/audience";
const flat = (x) => JSON.stringify(x);
const polls = async (c) => (await c.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const rows = async (c, name) => (await c.api.store.list(name)).map((r) => ({ id: r.id, ...r.data }));
const audit = async (w) => (await w.aud.api.store.list("audit")).map((r) => r.data);
const coreLog = (w) => w.polls.__logged ?? [];

/** The remote of a world: press / state through the REAL secret routes of Audience. */
async function remote(w) {
  await AK.ensureMeta(w.aud);
  const key = (await w.aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const press = async (action, values = {}, panel = "id-polls", k = key) => {
    const r = await audDef.routes["remote-press"](areq(`${BASE}/remote-press`, { k, panel, action, values }), w.aud);
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const state = async () => (await audDef.routes["remote-state"](areq(`${BASE}/remote-state?k=${key}`), w.aud)).json();
  const pollsPanel = async () => (await state()).panels.find((p) => p.id === "id-polls");
  return { key, press, state, pollsPanel };
}
const make = async (c, over = {}) => {
  const v = L.validatePollForm({ question: "Which game next", choices: "Moss\nCeleste\nHades", max: 1, ...over }, { tz: "Europe/Paris" });
  const r = await pollsMod.createPoll(c, v.value, "Europe/Paris"); assert.ok(r.ok); return r;
};
const vote = (c, slug, ids, i) => pollsMod.castVote(c, { slug, token: tok(i), ids });

test("poll: close now ends it at once and keeps the result; a second close says it is already closed", async () => {
  const w = world(); const rm = await remote(w);
  const { slug, id } = await make(w.polls); await vote(w.polls, slug, ["c2"], 1); await vote(w.polls, slug, ["c2"], 2);
  assert.deepEqual((await rm.pollsPanel()).buttons.slice(3).map((b) => b.id), ["poll-close", "poll-extend", "poll-show", "poll-cancel"], "an open poll offers the live powers");
  const r = await rm.press("poll-close", { id });
  assert.deepEqual([r.status, r.ok, r.message], [200, true, pollsFr.remoteClosed]);
  const p = (await polls(w.polls))[0];
  assert.equal(L.stateOf(p), "closed"); assert.deepEqual([p.voters, p.counts.c2], [2, 2], "the result stays");
  const again = await rm.press("poll-close", { id });
  assert.deepEqual([again.status, again.ok, again.error, again.message], [400, false, "closed", pollsFr.remoteErrClosed]);
  assert.ok((await audit(w)).some((l) => l.who === "remote" && l.what === "polls.poll-close"), "journal line written by the remote route");
  assert.ok((await audit(w)).some((l) => l.who === "polls" && l.what === "poll.close"), "and by the module, as the website journal does");
});

test("poll: cancel deletes the poll and its votes; it works on a finished poll too; a round cannot be cancelled this way", async () => {
  const w = world(); const rm = await remote(w);
  const a = await make(w.polls); await vote(w.polls, a.slug, ["c1"], 1);
  let r = await rm.press("poll-cancel", { id: a.id });
  assert.deepEqual([r.ok, r.message], [true, pollsFr.remoteCancelled]);
  assert.equal((await polls(w.polls)).length, 0); assert.equal((await rows(w.polls, `b-${a.id}`)).length, 0, "the ballots are erased too");
  const b = await make(w.polls, { question: "Pizza or pasta" }); await pollsDef.mcp.poll_close(w.polls, { id: b.id });
  r = await rm.press("poll-cancel", {});
  assert.deepEqual([r.ok, r.message], [true, pollsFr.remoteDeleted]);
  assert.equal((await polls(w.polls)).length, 0);
  r = await rm.press("poll-cancel", {});
  assert.deepEqual([r.status, r.ok, r.error, r.message], [400, false, "none", pollsFr.remoteErrNone]);
  await rm.press("start"); const round = (await polls(w.polls)).find((p) => p.round);
  r = await rm.press("poll-cancel", { id: round.id });
  assert.equal(r.ok, false, "a running round belongs to Stop");
  assert.ok((await polls(w.polls)).some((p) => p.round));
});

test("poll: a stale remote cannot touch another poll (id mismatch is refused, nothing changes)", async () => {
  const w = world(); const rm = await remote(w);
  const a = await make(w.polls, { question: "First" });
  await new Promise((r) => setTimeout(r, 5));
  const b = await make(w.polls, { question: "Second" });
  const r = await rm.press("poll-cancel", { id: a.id });
  assert.deepEqual([r.status, r.ok, r.error, r.message], [400, false, "changed", pollsFr.remoteErrChanged]);
  assert.equal((await polls(w.polls)).length, 2);
  assert.equal((await rm.press("poll-close", { id: b.id })).ok, true, "the poll in front of the streamer is the newest one");
});

test("poll: extend adds time to a timed poll, refuses a poll with no end, and reopens a finished one for that long", async () => {
  const w = world(); const rm = await remote(w);
  const now = Date.now();
  const q = await pollsMod.quickPoll(w.polls, { a: "Cats", b: "Dogs", seconds: "30" }, now);
  const before = Date.parse((await polls(w.polls))[0].endsAt);
  let r = await rm.press("poll-extend", { seconds: "45" });
  assert.deepEqual([r.ok, r.message], [true, pollsFr.remoteExtended.replace("{n}", "45")]);
  assert.equal(Date.parse((await polls(w.polls))[0].endsAt) - before, 45_000);
  r = await rm.press("poll-extend", {});
  assert.equal(Date.parse((await polls(w.polls))[0].endsAt) - before, 75_000, "30 s by default");
  await rm.press("poll-close", { id: q.id });
  r = await rm.press("poll-extend", {});
  assert.ok(r.ok, "a finished poll is reopened for 30 s"); const p = (await polls(w.polls))[0];
  assert.equal(L.stateOf(p), "open"); assert.ok(Date.parse(p.endsAt) - Date.now() <= 30_000 && Date.parse(p.endsAt) - Date.now() > 25_000);
  const w2 = world(); const rm2 = await remote(w2);
  await make(w2.polls);   // no end time
  r = await rm2.press("poll-extend", {});
  assert.deepEqual([r.ok, r.error, r.message], [false, "noend", pollsFr.remoteErrNoEnd]);
  assert.ok((await rm2.pollsPanel()).buttons.find((b) => b.id === "poll-extend").disabled, "the button is greyed out when there is nothing to extend");
});

test("poll: reopen gives a finished poll a bounded time (60 s by default, 15 to 900), refuses an open one and a purged one", async () => {
  const w = world(); const rm = await remote(w);
  const a = await make(w.polls); await vote(w.polls, a.slug, ["c1"], 1);
  assert.equal((await rm.press("poll-reopen", {})).error, "open", "an open poll cannot be reopened");
  await rm.press("poll-close", {});
  assert.deepEqual((await rm.pollsPanel()).buttons.slice(3).map((b) => b.id), ["poll-show", "poll-reopen", "poll-archive", "poll-cancel", "poll-yesno"], "a finished poll: announce, reopen, tidy, delete");
  let r = await rm.press("poll-reopen", { seconds: "120" });
  assert.deepEqual([r.ok, r.message], [true, pollsFr.remoteReopened.replace("{n}", "120")]);
  let p = (await polls(w.polls))[0]; assert.equal(L.stateOf(p), "open"); assert.equal(p.counts.c1, 1, "votes kept");
  assert.ok(Math.abs(Date.parse(p.endsAt) - Date.now() - 120_000) < 3000);
  await rm.press("poll-close", {});
  r = await rm.press("poll-reopen", { seconds: "7" }); p = (await polls(w.polls))[0];
  assert.ok(Math.abs(Date.parse(p.endsAt) - Date.now() - 60_000) < 3000, "an out-of-range value falls back to 60 s");
  await rm.press("poll-close", {});
  const f = await w.polls.api.store.get(p.id); await w.polls.api.store.update(p.id, { ...f.data, purgedAt: new Date().toISOString() });
  r = await rm.press("poll-reopen", {});
  assert.deepEqual([r.ok, r.error], [false, "purged"]);
});

test("poll: announce puts the poll on the stream screen, hide gives the screen back to automatic; archive tidies a finished poll", async () => {
  const w = world(); const rm = await remote(w);
  const a = await make(w.polls, { question: "Best snack" }); await vote(w.polls, a.slug, ["c3"], 1);
  const cfg = async () => (await w.polls.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
  await rm.press("poll-close", {});
  let r = await rm.press("poll-show", {});
  assert.deepEqual([r.ok, r.message], [true, pollsFr.remoteShown]);
  assert.equal((await cfg()).onAir, a.slug); assert.ok(Date.parse((await cfg()).onAirUntil) > Date.now());
  const screen = JSON.parse((await w.aud.api.store.list("live")).map((x) => x.data).find((x) => x.channel === "screen").json);
  assert.equal(screen.question, "Best snack"); assert.equal(screen.state, "closed");
  r = await rm.press("poll-hide", {}); assert.ok(r.ok); assert.equal((await cfg()).onAir, null);
  r = await rm.press("poll-archive", {}); assert.ok(r.ok);
  assert.equal((await polls(w.polls)).length, 0); assert.equal((await rows(w.polls, "archive")).length, 1, "totals are kept in the archive");
  assert.equal((await rows(w.polls, "archive"))[0].counts.c3, 1);
});

test("poll: yes/no and 'repeat the last poll' start a quick poll in one tap, with the usual length", async () => {
  for (const [locale, msgs] of [["fr", pollsFr], ["en", pollsEn]]) {
    const w = world({ locale }); const rm = await remote(w);
    assert.ok(!(await rm.pollsPanel()).buttons.some((b) => b.id === "poll-again"), "nothing to repeat yet");
    let r = await rm.press("poll-yesno", {}); assert.ok(r.ok, locale);
    let p = (await polls(w.polls))[0]; assert.deepEqual(p.choices.map((c) => c.text), [msgs.quickYes, msgs.quickNo]); assert.equal(p.quick, true);
    assert.equal(Date.parse(p.endsAt) - Date.parse(p.createdAt), 60_000);
    await rm.press("poll-close", {});
    assert.ok((await rm.pollsPanel()).buttons.some((b) => b.id === "poll-yesno"), "still offered after a poll");
    r = await rm.press("poll-again", {}); assert.ok(r.ok);
    assert.equal((await polls(w.polls)).filter((x) => L.stateOf(x) === "open").length, 1);
    const again = (await polls(w.polls)).find((x) => L.stateOf(x) === "open"); assert.deepEqual(again.choices.map((c) => c.text), [msgs.quickYes, msgs.quickNo]);
  }
});

test("poll: with Audience absent nothing breaks and the powers still work through the module's own service", async () => {
  const w = world({ audience: false });
  const a = await make(w.polls);
  const svc = pollsDef.services["audience.remote"];
  assert.equal((await svc.press(w.polls, { action: "poll-close", values: { id: a.id } })).ok, true);
  assert.equal((await svc.press(w.polls, { action: "poll-nope", values: {} })).ok, false);
  const { panel } = await svc.describe(w.polls, {});
  assert.ok(panel.buttons.length <= 8 && panel.buttons.every((b) => b.label.length <= 40 && (!b.confirm || b.confirm.length <= 120)));
});

test("authorization: the secret address guards every new gesture; a wrong secret, a wrong panel or a made-up action do nothing", async () => {
  const w = world(); const rm = await remote(w);
  const a = await make(w.polls); await vote(w.polls, a.slug, ["c1"], 1);
  for (const action of ["poll-close", "poll-cancel", "poll-reopen", "poll-extend", "poll-show", "poll-archive", "panic"]) {
    const bad = await rm.press(action, { id: a.id }, action === "panic" ? "audience" : "id-polls", "not-the-secret");
    assert.equal(bad.status, 404, `${action} with a wrong secret`);
  }
  assert.equal((await rm.press("poll-close", { id: a.id }, "id-unknown")).status, 404, "unknown panel");
  assert.equal((await rm.press("poll-close", { id: a.id }, "audience")).status, 400, "the draw panel does not know poll gestures");
  assert.equal((await rm.press("Poll_Close", {})).status, 400); assert.equal((await rm.press("poll-close; drop", {})).status, 400);
  assert.equal((await polls(w.polls))[0].closedAt ?? null, null, "nothing happened");
  assert.ok(!flat(await audit(w)).includes(rm.key), "the secret never reaches the journal");
});

/* ───────────── Prize draw ───────────── */

const FORM = { title: "Sticker pack", keyword: "!stickers", level: "all", site: true, minutes: null, winners: 1 };
const enter = (c, name) => audDef.services["audience.draw"].enter(c, { pseudo: name, platform: "twitch", login: name.toLowerCase() });

test("draw: pick someone else drops the last winner; cancel closes and empties; reopen puts a mistakenly closed draw back", async () => {
  const c = audienceCtx(); await AK.ensureMeta(c);
  const key = (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const press = async (action, values = {}) => { const r = await audDef.routes["remote-press"](areq(`${BASE}/remote-press`, { k: key, panel: "audience", action, values }), c); return { status: r.status, ...(await r.json()) }; };
  const panel = async () => (await (await audDef.routes["remote-state"](areq(`${BASE}/remote-state?k=${key}`), c)).json()).panels.find((p) => p.id === "audience");
  await D.openNew(c, FORM, { now: Date.now() });
  for (const n of ["etoile_nord", "lune_douce", "Camille", "brume_claire"]) assert.ok((await enter(c, n)).ok);
  assert.deepEqual((await panel()).buttons.map((b) => b.id), ["draw-close", "draw-pick", "draw-cancel", "panic"]);
  assert.ok((await press("draw-close")).ok);
  assert.deepEqual((await panel()).buttons.map((b) => b.id), ["draw-pick", "draw-reopen", "draw-cancel", "panic"], "closed by mistake: pick, reopen or cancel");
  let r = await press("draw-reopen"); assert.deepEqual([r.ok, r.message], [true, audFr.drawOkReopened]);
  assert.equal((await D.current(c)).status, "open");
  r = await press("draw-pick"); assert.ok(r.ok);
  const first = (await D.current(c)).picked.filter((w) => !w.absent);
  assert.equal(first.length, 1);
  assert.deepEqual((await panel()).buttons.map((b) => b.id), ["draw-pick", "draw-redraw", "draw-cancel", "panic"]);
  r = await press("draw-redraw"); assert.ok(r.ok, flat(r)); assert.match(r.message, /^Une autre personne est tirée : /);
  const d = await D.current(c);
  assert.equal(d.picked.length, 2); assert.equal(d.picked.filter((w) => w.absent).length, 1, "the dropped winner is marked absent");
  assert.notEqual(d.picked.find((w) => !w.absent).k, first[0].k, "another person is drawn");
  assert.ok((await c.api.store.list("audit")).some((x) => x.data.what === "draw.redraw" && x.data.who === "remote"));
  r = await press("draw-cancel"); assert.deepEqual([r.ok, r.message], [true, audFr.drawOkCancelled]);
  const e = await D.current(c); assert.deepEqual([e.count, e.picked.length], [0, 0]);
  const log = (await c.api.store.list("audit")).map((x) => x.data.what);
  assert.ok(log.includes("draw.clear"), "the same journal line as 'Empty the draw' on the website");
  r = await press("draw-redraw"); assert.deepEqual([r.ok, r.error], [false, "gone"], "nobody to drop");
});

test("draw: cancelling an open draw closes it first (two journal lines) and refuses when there is no draw", async () => {
  const c = audienceCtx(); await AK.ensureMeta(c);
  const key = (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const press = async (action) => { const r = await audDef.routes["remote-press"](areq(`${BASE}/remote-press`, { k: key, panel: "audience", action, values: {} }), c); return { status: r.status, ...(await r.json()) }; };
  let r = await press("draw-cancel"); assert.deepEqual([r.status, r.ok, r.error], [400, false, "none"]);
  await D.openNew(c, FORM, { now: Date.now() }); await enter(c, "etoile_nord");
  r = await press("draw-cancel"); assert.ok(r.ok);
  const d = await D.current(c); assert.equal(D.stateOf(d), "closed"); assert.equal(d.count, 0);
  const log = (await c.api.store.list("audit")).map((x) => x.data.what);
  assert.deepEqual(log.filter((x) => x.startsWith("draw.")).sort(), ["draw.clear", "draw.close", "draw.new"]);
});

/* ───────────── Stop everything ───────────── */

test("panic: one gesture closes the poll, the repeating vote and the open draw; nothing is deleted nor drawn; it works when nothing runs", async () => {
  const w = world(); const rm = await remote(w);
  let r = await rm.press("panic", {}, "audience");
  assert.deepEqual([r.ok, r.message], [true, audFr.remotePanicDone], "nothing running: still fine");
  const q = await pollsMod.quickPoll(w.polls, { a: "Cats", b: "Dogs", seconds: "300" }, Date.now()); await vote(w.polls, q.slug, ["c1"], 1);
  await make(w.polls, { question: "Longer poll" });
  await rm.press("start");
  await D.openNew(w.aud, FORM, { now: Date.now() }); await enter(w.aud, "lune_douce");
  assert.equal((await polls(w.polls)).filter((p) => L.stateOf(p) === "open").length, 3);
  r = await rm.press("panic", {}, "audience"); assert.ok(r.ok);
  const all = await polls(w.polls);
  assert.equal(all.filter((p) => L.stateOf(p) === "open").length, 0, "no poll is open any more");
  assert.equal(all.filter((p) => !p.round).length, 2, "the polls are closed, not deleted");
  assert.equal(all.find((p) => p.slug === q.slug).counts.c1, 1, "votes kept");
  assert.ok(!all.some((p) => p.round), "the repeating vote is stopped");
  const d = await D.current(w.aud); assert.equal(D.stateOf(d), "closed"); assert.deepEqual(d.picked, [], "nobody was drawn"); assert.equal(d.count, 1, "entries kept");
  const log = await audit(w);
  assert.ok(log.some((l) => l.who === "remote" && l.what === "panic"), "panic is in the journal");
  r = await rm.press("panic", {}, "id-polls"); assert.ok(r.ok, "also reachable on the poll panel itself");
});

test("panic: a module that does not answer, or does not know 'panic', does not block the others", async () => {
  const c = audienceCtx({ serviceInstances: { "audience.remote": [
    { instance: "slow", name: "Slow", methods: { describe: async () => ({ ok: true, panel: { title: "Slow" } }), press: () => new Promise(() => {}) } },
    { instance: "old", name: "Old", methods: { describe: async () => ({ ok: true, panel: { title: "Old" } }), press: async () => ({ ok: false, error: "invalid" }) } },
  ] } });
  await D.openNew(c, FORM, { now: Date.now() });
  const t0 = Date.now(); const r = await R.panic(c);
  assert.ok(r.ok); assert.ok(Date.now() - t0 < 7500, "bounded wait");
  assert.equal(D.stateOf(await D.current(c)), "closed", "the draw was closed anyway");
}, { timeout: 12000 });

/* ───────────── Texts ───────────── */

test("texts: every new key exists in French and English with the same variables; labels fit the remote (40 characters, 120 for the warning)", () => {
  const keys = (o, re) => Object.keys(o).filter((k) => re.test(k));
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  for (const [fr, en, re] of [[pollsFr, pollsEn, /^(remote(Close|Cancel|Extend|Show|ShowResult|Reopen|Archive|Delete|YesNo|Again|PollOpen|PollDone|Closed|Cancelled|Deleted|Reopened|Extended|Shown|Hidden|Archived|PanicDone|PanicNothing|Err(None|Changed|Closed|Open|NoEnd|Partial))|quick(Yes|No))/], [audFr, audEn, /^(drawBtn(Reopen|Redraw|RedrawConfirm|Cancel)|drawCancelConfirm|drawOk(Redrawn|Cancelled)|remotePanic|what_(poll_|panic))/]]) {
    const ks = keys(fr, re); assert.ok(ks.length >= 8);
    for (const k of ks) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); assert.ok(!/[!]/.test(en[k] + fr[k]), `${k}: no exclamation mark`); }
  }
  for (const m of [pollsFr, pollsEn, audFr, audEn]) {
    for (const k of Object.keys(m).filter((x) => /^(remote(Close|Cancel|Extend|Show|ShowResult|Reopen|Archive|Delete|YesNo|Again)|drawBtn(Reopen|Redraw|Cancel)|remotePanic)$/.test(x))) assert.ok(m[k].length <= 40, `${k}: ${m[k]}`);
    for (const k of ["remoteCancelConfirm", "remoteDeleteConfirm", "remotePanicConfirm", "drawBtnRedrawConfirm", "drawCancelConfirm"]) if (m[k]) assert.ok(m[k].split(/\s+/).length <= 6, `${k}: what is lost, in six words at most`);
  }
});

test("manifests: versions bumped, new journal events declared in French and English", async () => {
  const fs = await import("node:fs");
  for (const id of ["polls", "audience"]) {
    const m = JSON.parse(fs.readFileSync(new URL(`../modules/${id}/module.json`, import.meta.url), "utf8"));
    assert.equal(m.version, "1.5.0");
    assert.ok(m.logEvents.some((e) => e.key === "panic.stopped" && e.label.fr && e.label.en));
  }
  const m = JSON.parse(fs.readFileSync(new URL("../modules/polls/module.json", import.meta.url), "utf8"));
  for (const k of ["poll.closed", "poll.cancelled", "poll.deleted", "poll.reopened", "poll.extended", "poll.shown", "poll.hidden", "poll.archived"]) assert.ok(m.logEvents.some((e) => e.key === k && e.label.fr && e.label.en), k);
});

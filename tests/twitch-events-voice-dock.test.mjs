// Twitch activity 1.3.0: the mark left by the moderation of the alerts overlay on a journal line (service `twitch.journal`), and the voice and texts controls of the OBS dock
// (switches that show their state, stop the speech, skip the alert, accept or dismiss a text). Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import { world, deliver, EV, TYPES, NOW, S, D, DK, mod, manifest, fr, en } from "./helpers/eventsWorld.mjs";

const url = (path, k) => `https://site.example.org/m/ev/${path}?k=${encodeURIComponent(k)}`;
const act = (ctx, k, body) => mod.routes["dock-act"](new Request(url("dock-act", k), { method: "POST", body: JSON.stringify(body) }), ctx).then((r) => r.json());
async function site(o = {}) {
  const w = world({ alerts: true, voice: true, ...o });
  await S.ensureSecret(w.ctx);
  return { ...w, k: await D.dockSecret(w.ctx) };
}
const TEXT = { id: "t1", type: "cheer", name: "lune_douce", reason: "link", text: "see www.example.com", hold: false, at: NOW };

test("service twitch.journal: marks a line with a reason and a state of closed lists, shows it in words, refuses the rest", async () => {
  const { ctx } = await site({ locale: "en" });
  await deliver(ctx, TYPES.cheer, EV.cheer, { id: "c1" });
  const svc = mod.services["twitch.journal"];
  assert.deepEqual(manifest.offers.map((o) => o.service), ["twitch.journal"]);
  assert.deepEqual(await svc.flag(ctx, { id: "c1", reason: "link", state: "hidden" }), { ok: true });
  assert.equal((await S.byId(ctx, "c1")).flag.reason, "link");
  const line = (await S.recent(ctx, 5))[0];
  const A = await import("../modules/twitch-events/describe.mjs");
  assert.match(A.detail(ctx, line), /500 bits · text hidden \(link\)/);
  await svc.flag(ctx, { id: "c1", reason: "link", state: "accepted" });
  assert.match(A.detail(ctx, (await S.recent(ctx, 5))[0]), /text accepted/);
  for (const bad of [{ id: "c1", reason: "x", state: "hidden" }, { id: "c1", reason: "link", state: "x" }, { id: "", reason: "link", state: "hidden" }, null]) assert.deepEqual(await svc.flag(ctx, bad), { ok: false, code: "bad" });
  assert.deepEqual(await svc.flag(ctx, { id: "nope", reason: "link", state: "hidden" }), { ok: false, code: "unknown" });
  assert.ok(!JSON.stringify((await S.byId(ctx, "c1")).flag).includes("www"), "only a reason and a state are kept");
  const en2 = world({ locale: "fr" }).ctx;
  assert.match(A.detail(en2, { kind: "cheer", amount: 5, flag: { reason: "word", state: "held" } }), /alerte retenue \(mot bloqué\)/);
});

test("dock data: the voice and the texts waiting come from the overlay, in words; an overlay without the voice shows none", async () => {
  const { ctx, queue } = await site({ locale: "en", queue: { texts: [TEXT, { ...TEXT, id: "t2", reason: "word", hold: true, at: NOW + 5 }] } });
  const p = await D.payload(ctx, { now: NOW });
  assert.deepEqual(p.alerts.voice, { available: true, on: false, muted: false });
  assert.deepEqual(p.alerts.texts.map((x) => [x.id, x.label, x.why, x.held]), [["t2", "Bits", "blocked word", true], ["t1", "Bits", "link", false]]);
  assert.ok(Object.keys(p.alerts.texts[0]).sort().join() === "at,held,id,label,name,reason,text,type,why");
  const old = await site({ alerts: true, voice: false });
  const q = await D.payload(old.ctx, { now: NOW });
  assert.deepEqual(q.alerts.voice, { available: false, on: false, muted: false }); assert.deepEqual(q.alerts.texts, []);
  const bare = world({ alerts: false });
  assert.equal((await D.payload(bare.ctx, { now: NOW })).alerts.linked, false);
  void queue;
});

test("dock actions: voice on/off, mute, stop speech, skip, accept or dismiss: through the overlay, refused without it or without the voice", async () => {
  const { ctx, k, queue } = await site({ queue: { texts: [TEXT] } });
  assert.deepEqual(await act(ctx, k, { action: "voiceOn", on: true }), { ok: true, on: true });
  assert.deepEqual(await act(ctx, k, { action: "mute", muted: true }), { ok: true, muted: true });
  assert.deepEqual(await act(ctx, k, { action: "mute", muted: false }), { ok: true, muted: false });
  assert.equal((await act(ctx, k, { action: "stopSpeech" })).ok, true); assert.equal((await act(ctx, k, { action: "skip" })).ok, true);
  assert.deepEqual(await act(ctx, k, { action: "decide", id: "t1" }), { ok: true });
  assert.deepEqual(queue.calls, ["voiceOn:true", "mute:true", "mute:false", "stopSpeech", "skip", "decide:dismiss:t1"], "a missing choice is the cautious one: dismiss");
  assert.deepEqual(await act(ctx, k, { action: "decide", id: "t1", choice: "accept" }), { ok: false, code: "unknown" }, "already decided");
  const old = await site({ voice: false });
  assert.deepEqual(await act(old.ctx, old.k, { action: "mute", muted: true }), { ok: false, code: "no_voice" });
  const bare = world({ alerts: false }); await S.ensureSecret(bare.ctx); const kb = await D.dockSecret(bare.ctx);
  for (const a of ["voiceOn", "mute", "stopSpeech", "skip", "decide"]) assert.deepEqual(await act(bare.ctx, kb, { action: a, id: "t1" }), { ok: false, code: "no_alerts" }, a);
});

test("the page: three switches that show their state in words, stop and skip buttons, the texts waiting with Accept anyway and Dismiss (44 px), every sentence in FR and EN", async () => {
  const { ctx, k } = await site({ locale: "en", queue: { texts: [TEXT], voice: { on: true, muted: true } } });
  const html = await (await mod.routes.dock(new Request(url("dock", k)), ctx)).text();
  for (const id of ["pause", "voice", "mute"]) assert.match(html, new RegExp(`role="switch" id="${id}" aria-checked`), id);
  for (const id of ["stopspeech", "skip", "heldlist"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /\.decide\{min-width:44px;min-height:44px/); assert.match(html, /\.ctl button\{?|\.ctl button,/);
  assert.ok(!/https?:\/\/(?!site\.example\.org)/.test(html.replace(/xmlns="[^"]*"/g, "")), "nothing third party");
  for (const key of DK.KEYS) { assert.ok(en[`dock_${key}`] && fr[`dock_${key}`], key); assert.deepEqual((en[`dock_${key}`].match(/\{\w+\}/g) ?? []).sort(), (fr[`dock_${key}`].match(/\{\w+\}/g) ?? []).sort(), key); }
  for (const r of ["word", "link", "caps", "repeat"]) assert.ok(en[`flag_reason_${r}`] && fr[`flag_reason_${r}`]);
  for (const st of ["hidden", "held", "accepted", "dismissed"]) assert.ok(en[`d_flag_${st}`] && fr[`d_flag_${st}`]);
  assert.equal(manifest.version, "1.5.0");
});

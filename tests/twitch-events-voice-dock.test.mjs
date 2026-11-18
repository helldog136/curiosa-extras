// (1.18.0: the Twitch part of the alerts overlay; the dock drives the overlay's own queue.) Twitch activity 1.3.0: the mark left by the moderation of the alerts overlay on a journal line (service `twitch.journal`), and the voice and texts controls of the OBS dock
// (switches that show their state, stop the speech, skip the alert, accept or dismiss a text). Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import { seedQueue, TWO, world, deliver, EV, TYPES, NOW, S, D, DK, mod, manifest, fr, en } from "./helpers/eventsWorld.mjs";

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
  assert.ok(manifest.offers.some((o) => o.service === "twitch.journal") && !manifest.offers.some((o) => ["alerts.reaction", "alerts.reaction.editor"].includes(o.service)));
  assert.deepEqual(await svc.flag(ctx, { id: "c1", reason: "link", state: "hidden" }), { ok: true });
  assert.equal((await S.byId(ctx, "c1")).flag.reason, "link");
  const line = (await S.recent(ctx, 5))[0];
  const A = await import("../modules/alerts-overlay/twitch/describe.mjs");
  assert.match(A.detail(ctx, line), /500 bits · text hidden \(link\)/);
  await svc.flag(ctx, { id: "c1", reason: "link", state: "accepted" });
  assert.match(A.detail(ctx, (await S.recent(ctx, 5))[0]), /text accepted/);
  for (const bad of [{ id: "c1", reason: "x", state: "hidden" }, { id: "c1", reason: "link", state: "x" }, { id: "", reason: "link", state: "hidden" }, null]) assert.deepEqual(await svc.flag(ctx, bad), { ok: false, code: "bad" });
  assert.deepEqual(await svc.flag(ctx, { id: "nope", reason: "link", state: "hidden" }), { ok: false, code: "unknown" });
  assert.ok(!JSON.stringify((await S.byId(ctx, "c1")).flag).includes("www"), "only a reason and a state are kept");
  const en2 = world({ locale: "fr" }).ctx;
  assert.match(A.detail(en2, { kind: "cheer", amount: 5, flag: { reason: "word", state: "held" } }), /alerte retenue \(mot bloqué\)/);
});

test("dock data: the voice and the texts waiting come from the overlay, in words", async () => {
  const { ctx } = await site({ locale: "en" });
  await seedQueue(ctx, { texts: [TEXT, { ...TEXT, id: "t2", reason: "word", hold: true, at: NOW + 5 }] });
  const p = await D.payload(ctx, { now: NOW });
  assert.deepEqual(p.alerts.voice, { available: true, on: false, muted: false });
  assert.deepEqual(p.alerts.texts.map((x) => [x.id, x.label, x.why, x.held]), [["t2", "Bits", "blocked word", true], ["t1", "Bits", "link", false]]);
  assert.ok(Object.keys(p.alerts.texts[0]).sort().join() === "at,held,id,label,name,reason,text,type,why");
});

test("dock actions: voice on/off, mute, stop speech, skip, accept or dismiss: the overlay's own queue", async () => {
  const { ctx, k } = await site();
  await seedQueue(ctx, { texts: [TEXT] });
  assert.deepEqual(await act(ctx, k, { action: "voiceOn", on: true }), { ok: true, on: true });
  assert.deepEqual(await act(ctx, k, { action: "mute", muted: true }), { ok: true, muted: true });
  assert.deepEqual(await act(ctx, k, { action: "mute", muted: false }), { ok: true, muted: false });
  assert.equal((await act(ctx, k, { action: "stopSpeech" })).ok, true); assert.equal((await act(ctx, k, { action: "skip" })).ok, true);
  const before = await TWO.loadState(ctx), stop = before.stop;
  assert.deepEqual(await act(ctx, k, { action: "decide", id: "t1" }), { ok: true });
  assert.equal((await TWO.loadConfig(ctx)).tts.on, true); assert.equal((await TWO.loadState(ctx)).ttsMuted, false); assert.ok((await TWO.loadState(ctx)).stop >= stop);
  assert.deepEqual(await TWO.textsList(ctx), [], "a missing choice is the cautious one: dismiss (the text is gone, nothing shown)");
  assert.deepEqual(await act(ctx, k, { action: "decide", id: "t1", choice: "accept" }), { ok: false, code: "unknown" }, "already decided");
});

test("the page: three switches that show their state in words, stop and skip buttons, the texts waiting with Accept anyway and Dismiss (44 px), every sentence in FR and EN", async () => {
  const { ctx, k } = await site({ locale: "en" });
  await seedQueue(ctx, { texts: [TEXT], voice: { on: true, muted: true } });
  const html = await (await mod.routes.dock(new Request(url("dock", k)), ctx)).text();
  for (const id of ["pause", "voice", "mute"]) assert.match(html, new RegExp(`role="switch" id="${id}" aria-checked`), id);
  for (const id of ["stopspeech", "skip", "heldlist"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /\.decide\{min-width:44px;min-height:44px/); assert.match(html, /\.ctl button\{?|\.ctl button,/);
  assert.ok(!/https?:\/\/(?!site\.example\.org)/.test(html.replace(/xmlns="[^"]*"/g, "").replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")), "nothing third party");
  for (const key of DK.KEYS) { assert.ok(en[`dock_${key}`] && fr[`dock_${key}`], key); assert.deepEqual((en[`dock_${key}`].match(/\{\w+\}/g) ?? []).sort(), (fr[`dock_${key}`].match(/\{\w+\}/g) ?? []).sort(), key); }
  for (const r of ["word", "link", "caps", "repeat"]) assert.ok(en[`flag_reason_${r}`] && fr[`flag_reason_${r}`]);
  for (const st of ["hidden", "held", "accepted", "dismissed"]) assert.ok(en[`d_flag_${st}`] && fr[`d_flag_${st}`]);
  assert.equal(manifest.version, "1.19.0");
});

// The control dock page and its live views, without a browser: secret, headers, the administration's theme, texts, bounds, and the stage (idle / running / finished / cancelled) of each module.
// The layout and the gestures run in a real browser: dock-layout.test.mjs, dock-flows.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { world, pollsMod, pollsFr, pollsEn, tok } from "./helpers/audienceWorld.mjs";
import { audienceCtx, def, fr, en, K, C, R, L as AL, req } from "./helpers/audienceHarness.mjs";

const PL = await import("../modules/polls/lib.mjs");
const D = await import("../modules/audience/draw.mjs");
const BASE = "https://x.test/m/audience";
const SRC = fs.readFileSync(new URL("../modules/audience/remote.mjs", import.meta.url), "utf8");
const route = (name, ctx, request) => def.routes[name](request, ctx);
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
const page = async (c, key, extra = "") => route("remote", c, req(`${BASE}/remote?k=${key}${extra}`));
const cssOf = (html) => /<style nonce="[^"]+">([\s\S]*?)<\/style>/.exec(html)[1];

/* ───────────── The page ───────────── */

test("page: one page for phone and dock behind the same secret; &dock=1 only adds the dock class (keyboard hints); other values give the phone page; the secret is refused with a bare 404", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  const phone = await (await page(c, key)).text(), dock = await (await page(c, key, "&dock=1")).text();
  assert.ok(dock.includes('<body class="dk dock">') && phone.includes('<body class="dk">') && !phone.includes("dk dock"));
  for (const other of ["&dock=0", "&dock=true", "&dock=", "&dock=2"]) assert.ok(!(await (await page(c, key, other)).text()).includes("dk dock"), other);
  for (const html of [phone, dock]) {
    assert.ok(html.includes("viewport-fit=cover") && html.includes('content="noindex,nofollow"') && html.includes('name="referrer"'));
    assert.ok(html.includes('id="tabs" role="tablist"') && html.includes('id="panic"') && html.includes('id="strip" role="status" aria-live="polite"'), "tab bar, stop-everything button and status line are in the page itself");
    assert.ok(html.includes(C.REMOTE_JS), "the script, as is");
  }
  for (const k of ["", "nope", key.slice(0, -1), `${key}x`]) { const r = await route("remote", c, req(`${BASE}/remote?k=${k}&dock=1`)); assert.equal(r.status, 404); assert.equal(await r.text(), "Not found"); }
  assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}`, "x"))).status, 405);
  assert.equal(R.wantsDock("https://x.test/a?dock=1"), true); assert.equal(R.wantsDock("https://x.test/a"), false);
  assert.equal(R.wantsScheme("https://x.test/a?scheme=light"), "light"); assert.equal(R.wantsScheme("https://x.test/a?scheme=pink"), null);
});

test("page: security headers and a policy that only allows the page's own script and style and only talks to the site; no inline handler, no inline style attribute", async () => {
  for (const [locale, msgs] of [["fr", fr], ["en", en]]) {
    const c = audienceCtx({ locale, messages: msgs }); const { remoteKey: key } = await meta(c);
    for (const extra of ["", "&dock=1"]) {
      const res = await page(c, key, extra), html = await res.text();
      const nonce = /<script nonce="([^"]+)"/.exec(html)[1], csp = res.headers.get("content-security-policy");
      assert.ok(csp.includes(`script-src 'nonce-${nonce}'`) && csp.includes(`style-src 'nonce-${nonce}'`) && csp.includes("default-src 'none'") && csp.includes("connect-src 'self'") && csp.includes("form-action 'none'") && csp.includes("base-uri 'none'"));
      assert.ok(html.includes(`<style nonce="${nonce}">`) && !/\son\w+=/.test(html) && !/\sstyle="/.test(html));
      assert.equal(res.headers.get("cache-control"), "no-store"); assert.match(res.headers.get("x-robots-tag"), /noindex/); assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.match(html, new RegExp(`<html lang="${locale}">`));
    }
  }
});

test("page: the secret address stays the only way in; the same limits apply (a wrong secret is slowed after 40 tries, the right one never)", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  const statuses = []; for (let i = 0; i < 45; i++) statuses.push((await route("remote", c, req(`${BASE}/remote?k=essai${i}&dock=1`, undefined, { ip: "6.6.6.6" }))).status);
  assert.equal(statuses.filter((x) => x === 429).length, 5);
  for (let i = 0; i < 60; i++) assert.equal((await route("remote", c, req(`${BASE}/remote?k=${key}&dock=1`, undefined, { ip: "6.6.6.7" }))).status, 200);
  assert.ok((await def.adminActions.regenerate(c, { confirm: "on" })).ok);
  const { remoteKey: k2 } = await meta(c); assert.notEqual(key, k2);
  assert.equal((await page(c, key, "&dock=1")).status, 404, "the old address no longer opens the dock");
  assert.equal((await route("remote-state", c, req(`${BASE}/remote-state?k=${key}`))).status, 404);
  assert.equal((await route("remote-press", c, req(`${BASE}/remote-press`, { k: key, panel: "audience", action: "panic", values: {} }))).status, 404, "nor the old panic button");
  assert.equal((await page(c, k2, "&dock=1")).status, 200);
});

test("theme: the page takes the look of the administration (--cur-* tokens from ctx.api.adminTheme); dark for the dock, the device's choice for the phone, ?scheme= can force one; an older core falls back", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  const dock = await (await page(c, key, "&dock=1")).text(), phone = await (await page(c, key)).text(), light = await (await page(c, key, "&dock=1&scheme=light")).text();
  assert.deepEqual(c.calls.adminTheme.map((x) => x.scheme), ["dark", "auto", "light"]);
  for (const html of [dock, phone]) { const css = cssOf(html); assert.ok(css.includes("--cur-bg:#15141a") || css.includes("--cur-bg:#faf7f2"), "the core's tokens are in the page"); }
  const css = cssOf(dock);
  for (const v of ["--cur-bg", "--cur-fg", "--cur-muted", "--cur-surface", "--cur-line", "--cur-accent", "--cur-accent-fg", "--cur-ok", "--cur-warn", "--cur-danger", "--cur-danger-fg", "--cur-focus", "--cur-radius", "--cur-font"]) assert.ok(css.includes(`${v}:`), `${v} has a fallback`);
  assert.ok(light.includes("--cur-bg:#faf7f2"));
  const old = audienceCtx(); delete old.api.adminTheme; const { remoteKey: k2 } = await meta(old);
  const oldHtml = await (await page(old, k2, "&dock=1")).text(); assert.ok(cssOf(oldHtml).includes("--cur-bg:#15141a"), "a core without adminTheme still gets the administration's dark palette");
  const bad = audienceCtx(); bad.api.adminTheme = () => ({ css: ":root{--cur-bg:red}</style><script>alert(1)</script>" }); const { remoteKey: k3 } = await meta(bad);
  const badHtml = await (await page(bad, k3, "&dock=1")).text(); assert.ok(!badHtml.includes("<script>alert(1)"), "the theme text cannot close the style");
  const thr = audienceCtx(); thr.api.adminTheme = () => { throw new Error("boom"); }; const { remoteKey: k4 } = await meta(thr);
  assert.equal((await page(thr, k4)).status, 200, "a failing theme never blocks the remote");
  const body = SRC.slice(SRC.indexOf("const DOCK_CSS"), SRC.indexOf("/** The texts the script needs"));
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|font-family/, "no colour and no font written in the stylesheet: only the administration's tokens");
});

test("layout rules: a 100dvh grid that never scrolls, container queries and clamp(), targets of 44 px and more, visible focus, reduced motion", () => {
  const css = SRC.slice(SRC.indexOf("const DOCK_CSS"), SRC.indexOf("/** The texts the script needs"));
  assert.match(css, /\.app\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-rows:auto minmax\(0,1fr\) auto;height:100dvh/);
  assert.doesNotMatch(css, /overflow(-y|-x)?:\s*(auto|scroll)/, "nothing scrolls");
  assert.match(css, /container:stage\/size/); assert.match(css, /@container stage/); assert.match(css, /clamp\(/);
  assert.match(css, /:focus-visible\{outline:3px/); assert.match(css, /prefers-reduced-motion:reduce/); assert.match(css, /forced-colors/);
  const heights = [...css.matchAll(/min-height:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 8 && heights.every((h) => h >= 32), `${heights}`);
  for (const sel of [".btn{", ".tab{", ".in{", ".panic{", ".seg label{"]) { const m = new RegExp(`${sel.replace(/[.{]/g, "\\$&")}[^}]*min-height:(\\d+)px`).exec(css); assert.ok(m && Number(m[1]) >= 48, `${sel} is at least 48 px high`); }
  assert.match(css, /\.btn\.primary\{min-height:clamp\(56px/);
});

test("script: no repeating timer, a delay on every request, paused when hidden, text only (no innerHTML), no cookie, no colour written in it", () => {
  const js = C.REMOTE_JS;
  assert.doesNotThrow(() => new vm.Script(js));
  assert.ok(!/setInterval/.test(js) && !/document\.cookie/.test(js) && !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js));
  assert.ok(/AbortSignal/.test(js) && /visibilitychange/.test(js) && /document\.hidden/.test(js) && /credentials: "omit"/.test(js));
  assert.ok(/typing/.test(js), "the page is not redrawn while someone is typing");
  assert.doesNotMatch(js, /#[0-9a-fA-F]{6}\b|rgba?\(/);
});

test("texts: every dock text exists in French and English with the same variables, short, no colon at the end, no exclamation mark", () => {
  const keys = Object.keys(fr).filter((k) => /^dock/.test(k) && !["dockTitle", "dockSteps", "dockAddress", "dockOpen", "dockAgain"].includes(k));
  assert.ok(keys.length >= 25);
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of keys) { assert.ok(fr[k] && en[k], k); assert.equal(vars(fr[k]), vars(en[k]), k); for (const v of [fr[k], en[k]]) { assert.ok(v.length <= 60, `${k}: ${v}`); assert.ok(!/[:!]$/.test(v), `${k}: ${v}`); assert.ok(!/<[a-z!/]/i.test(v), k); } }
  for (const m of [pollsFr, pollsEn]) for (const k of Object.keys(m).filter((x) => /^(dock|remote\w+Short|quickSec\d+Short)/.test(x))) assert.ok(m[k].length <= 40 && !/[:!]$/.test(m[k]), `${k}: ${m[k]}`);
  assert.deepEqual(Object.keys(pollsFr).sort(), Object.keys(pollsEn).sort());
  assert.equal(JSON.stringify(R.remoteConfig(audienceCtx(), "k").t).includes("undefined"), false, "every text the script asks for exists");
});

/* ───────────── The live views ───────────── */

test("sanitizeView: bounded, text only, unknown stages and types refused; buttons keep id, labels, one-letter shortcut, values and what is lost", () => {
  assert.equal(AL.sanitizeView(null), null); assert.equal(AL.sanitizeView({ type: "poll", stage: "weird" }), null); assert.equal(AL.sanitizeView({ type: "other", stage: "idle" }), null);
  const v = AL.sanitizeView({
    type: "poll", stage: "live", title: "T".repeat(500), sub: "<b>x</b>", until: "2026-11-05T20:00:00Z", from: "not a date", count: -5, unit: "votes",
    bars: Array.from({ length: 20 }, (_, i) => ({ text: `c${i}`, n: 1e12, pct: 900, lead: i === 0 })),
    primary: { id: "poll-close", label: "Close", key: "cc", values: { id: "p1", bad: { x: 1 } } }, actions: [{ id: "Bad Id", label: "x" }, { id: "ok", label: "OK", short: "o", key: "e" }, { id: "n", label: "" }],
    danger: { id: "poll-cancel", label: "Cancel", loss: "Votes will be lost and more words", key: "x" }, chips: [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, label: `Chip ${i}` })),
    form: { id: "quick", title: "Quick", submit: "Go", fields: [{ name: "a", label: "A", type: "text" }, { name: "Bad", label: "x" }, { name: "s", label: "S", type: "select", seg: true, options: [{ value: "1", label: "One", short: "1" }] }] },
  });
  assert.equal(v.title.length, 140); assert.equal(v.from, null); assert.equal(v.count, 0); assert.equal(v.bars.length, 8); assert.ok(v.bars.every((b) => b.pct <= 100 && b.n <= 1_000_000));
  assert.equal(v.primary.key, "", "a shortcut is exactly one letter or digit"); assert.deepEqual(v.primary.values, { id: "p1" });
  assert.deepEqual(v.actions.map((a) => a.id), ["ok"]); assert.equal(v.actions[0].key, "E"); assert.equal(v.chips.length, 3);
  assert.equal(v.danger.loss.length <= 40, true); assert.deepEqual(v.form.fields.map((f) => f.name), ["a", "s"]); assert.equal(v.form.fields[1].seg, true);
  assert.equal(AL.sanitizePanel({ title: "Old module", buttons: [{ id: "go", label: "Go" }] }).view, null, "a module with no live view still works (plain buttons and forms)");
});

test("polls view: idle, running, finished, cancelled, a repeating vote; the main action is always the first thing to do next, destructive ones carry what is lost", async () => {
  const w = world(); const aud = w.aud; await K.ensureMeta(aud);
  const view = async () => (await (await route("remote-state", aud, req(`${BASE}/remote-state?k=${(await meta(aud)).remoteKey}`))).json()).panels.find((p) => p.id === "id-polls").view;
  let v = await view();
  assert.deepEqual([v.stage, v.primary, v.chips.map((c) => c.id), v.form.fields.filter((f) => !f.more).map((f) => f.name)], ["idle", null, ["poll-yesno", "start"], ["a", "b", "seconds"]], "idle: smart starts and a two-field form");
  assert.deepEqual(v.form.fields.filter((f) => f.more).map((f) => f.name), ["c", "d"]);
  const now = Date.now();
  const q = await pollsMod.quickPoll(w.polls, { a: "Cats", b: "Dogs", seconds: "60" }, now);
  await pollsMod.castVote(w.polls, { slug: q.slug, token: tok(1), ids: ["c1"] }); await pollsMod.castVote(w.polls, { slug: q.slug, token: tok(2), ids: ["c1"] }); await pollsMod.castVote(w.polls, { slug: q.slug, token: tok(3), ids: ["c2"] });
  v = await view();
  assert.deepEqual([v.stage, v.primary.id, v.primary.key, v.count, v.bars.map((b) => [b.text, b.n, b.pct, b.lead])], ["live", "poll-close", "C", 3, [["Cats", 2, 67, true], ["Dogs", 1, 33, false]]]);
  assert.deepEqual(v.actions.map((a) => a.id), ["poll-extend", "poll-show"]); assert.equal(v.danger.id, "poll-cancel"); assert.ok(v.danger.loss && v.danger.loss.split(/\s+/).length <= 6, v.danger.loss);
  assert.ok(v.primary.values.id && v.until && v.from, "the target poll and its times are sent");
  await pollsMod.default.services["audience.remote"].press(w.polls, { action: "poll-close", values: { id: v.primary.values.id } });
  v = await view();
  assert.deepEqual([v.stage, v.primary.id, v.actions.map((a) => a.id), v.danger.id], ["done", "poll-show", ["compose", "poll-reopen", "poll-archive"], "poll-cancel"]);
  assert.ok(v.chips.length >= 1 && v.form, "after a result, a new poll is one tap away");
  await pollsMod.default.services["audience.remote"].press(w.polls, { action: "poll-cancel", values: {} });
  assert.equal((await view()).stage, "idle", "cancelled: back to the start");
  await pollsMod.default.services["audience.remote"].press(w.polls, { action: "start", values: {} });
  v = await view();
  assert.deepEqual([v.stage, v.primary.id, v.danger.id, v.bars.length], ["live", "next", "stop", 3], "a repeating vote: Next is the main action, Stop is confirmed");
});

test("draw view: none, open, drawn, closed; the winner can be dropped with its own button; sign-up word and count are shown", async () => {
  const c = audienceCtx(); const { remoteKey: key } = await meta(c);
  const view = async () => (await (await route("remote-state", c, req(`${BASE}/remote-state?k=${key}`))).json()).panels.find((p) => p.id === "audience").view;
  let v = await view();
  assert.deepEqual([v.type, v.stage, v.chips, v.form.fields.filter((f) => !f.more).map((f) => f.name)], ["draw", "idle", [], ["keyword"]]);
  await D.openNew(c, { title: "Sticker pack", keyword: "!stickers", level: "all", site: true, minutes: null, winners: 1 }, { now: Date.now() });
  for (const n of ["etoile_nord", "lune_douce", "Camille"]) await def.services["audience.draw"].enter(c, { pseudo: n, platform: "twitch", login: n.toLowerCase() });
  v = await view();
  assert.deepEqual([v.stage, v.word, v.count, v.primary.id, v.actions.map((a) => a.id), v.danger.id], ["live", "!stickers", 3, "draw-pick", ["draw-close"], "draw-cancel"]);
  await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: key, panel: "audience", action: "draw-pick", values: {} }), c);
  v = await view();
  assert.equal(v.stage, "done"); assert.equal(v.names.length, 1); assert.deepEqual([v.names[0].action, Object.keys(v.names[0].values), !!v.names[0].loss], ["draw-redraw", ["pid"], true]);
  assert.deepEqual([v.primary.id, v.actions.map((a) => a.id)], ["draw-open", ["draw-pick", "compose"]]);
  const r = await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: key, panel: "audience", action: "draw-redraw", values: { pid: v.names[0].values.pid } }), c);
  assert.equal((await r.json()).ok, true);
  const d = await D.current(c); assert.equal(d.picked.filter((w) => w.absent).length, 1);
  const again = await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: key, panel: "audience", action: "draw-open", values: {} }), c);
  assert.equal((await again.json()).ok, true, "'New draw' with no values reuses the last settings in one tap");
  assert.equal((await D.current(c)).count, 0);
  assert.equal(D.stateOf(await D.current(c)), "open");
});

test("the state endpoint carries the views, the rooms and nothing secret; a module that does not answer is simply absent", async () => {
  const w = world(); const key = (await meta(w.aud)).remoteKey;
  const st = await (await route("remote-state", w.aud, req(`${BASE}/remote-state?k=${key}`))).json();
  assert.deepEqual(st.panels.map((p) => p.view.type), ["poll", "draw"]); assert.ok(Array.isArray(st.rooms) && typeof st.now === "number");
  assert.ok(!JSON.stringify(st).includes(key), "the secret is never in the state");
  w.hang(true);
  const c = audienceCtx({ serviceInstances: { "audience.remote": [{ instance: "slow", name: "Slow", methods: { describe: () => new Promise(() => {}), press: async () => ({ ok: true }) } }] } });
  const k2 = (await meta(c)).remoteKey; const t0 = Date.now();
  const st2 = await (await route("remote-state", c, req(`${BASE}/remote-state?k=${k2}`))).json();
  assert.equal(st2.panels.length, 1, "only the draw panel: the slow module is absent after 3 s"); assert.ok(Date.now() - t0 < 5000);
}, { timeout: 12000 });

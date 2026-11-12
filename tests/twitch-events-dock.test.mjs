// The OBS dock of Twitch activity: secret address (and "New address"), what the page reads (scopes, order, no secret), replay (idempotent, rate limited, hidden without the alerts overlay),
// pause / resume / empty through the alerts queue, tests, the page itself (policy, texts, nothing third party), the pure helpers it runs, and a smoke run of the whole script.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { world, deliver, EV, TYPES, NOW, S, P, D, DK, DP, mod, manifest, fr, en } from "./helpers/eventsWorld.mjs";

const get = (ctx, path, now) => mod.routes[path](new Request(`https://site.example.org/m/ev/${path}`), ctx);
const url = (path, k, extra = "") => `https://site.example.org/m/ev/${path}?k=${encodeURIComponent(k)}${extra}`;
const call = (ctx, path, k, init = {}, extra = "") => mod.routes[path](new Request(url(path, k, extra), init), ctx);
const act = (ctx, k, body) => call(ctx, "dock-act", k, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

async function site(o = {}) {
  const w = world({ alerts: true, ...o });
  await S.ensureSecret(w.ctx);
  const k = await D.dockSecret(w.ctx);
  return { ...w, k };
}

test("address: secret, the page and its data answer only to the right key; wrong keys are counted; New address stops the old one at once", async () => {
  const { ctx, k } = await site();
  assert.match(k, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(await D.dockSecret(ctx), k, "the same address every time");
  assert.equal((await mod.routes.dock(new Request("https://site.example.org/m/ev/dock"), ctx)).status, 403, "no key");
  assert.equal((await call(ctx, "dock", "wrong")).status, 403);
  assert.equal((await call(ctx, "dock-data", "wrong")).status, 403);
  const denied = await call(ctx, "dock-act", "wrong", { method: "POST", body: "{}" });
  assert.equal(denied.status, 403);
  const page = await call(ctx, "dock", k);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal((await call(ctx, "dock-data", k)).status, 200);
  const next = await mod.adminActions.renewDock(ctx);
  assert.ok(next.ok);
  assert.equal((await call(ctx, "dock-data", k)).status, 403, "the old address stops at once");
  assert.equal((await call(ctx, "dock", k)).status, 403);
  const k2 = await D.dockSecret(ctx);
  assert.notEqual(k2, k);
  assert.equal((await call(ctx, "dock-data", k2)).status, 200);
  assert.equal((await call(ctx, "dock-data", k, { method: "POST" })).status, 405);
  assert.equal((await call(ctx, "dock-act", k2, { method: "GET" })).status, 405);
});

test("address: too many wrong keys in a minute are refused before any comparison", async () => {
  const { ctx, k } = await site();
  for (let i = 0; i < D.LIMITS.badPerMinute; i++) await call(ctx, "dock-data", `bad${i}`);
  assert.equal((await call(ctx, "dock-data", "bad-again")).status, 429);
  assert.equal((await call(ctx, "dock-data", k)).status, 429, "even the right key waits (an attacker cannot learn anything from the speed)");
});

test("data: newest first, the scopes (this stream, 24 h, all), flags, plain public values, no secret anywhere", async () => {
  const { ctx, k } = await site();
  const day = 86_400_000;
  await S.record(ctx, "old", { kind: "follow", name: "Camille", login: "camille", at: NOW - 3 * day }, { now: NOW - 3 * day });
  await S.record(ctx, "before", { kind: "follow", name: "lune_douce", at: NOW - 5 * 3_600_000 }, { now: NOW - 5 * 3_600_000 });
  await deliver(ctx, TYPES.online, { ...EV.online, started_at: new Date(NOW - 3_600_000).toISOString() });
  await deliver(ctx, TYPES.cheer, EV.cheer, { id: "c1" });
  await P.sendTest(ctx, "raid", { now: NOW });
  await P.replay(ctx, "c1", { now: NOW + 100 });
  const payload = (scope) => D.payload(ctx, { scope, now: NOW + 1000 });
  const all = await payload("all"), day1 = await payload("day"), stream = await payload("stream");
  assert.deepEqual(all.events.map((e) => e.kind).slice(0, 3), ["cheer", "raid", "cheer"]);
  assert.equal(all.events.length, 6); assert.equal(day1.events.length, 5, "the line of 3 days ago is out of 24 h");
  assert.equal(stream.live, true);
  assert.deepEqual(stream.events.map((e) => e.id).includes("before"), false, "this stream: nothing from before it started");
  assert.equal(stream.events.some((e) => e.kind === "online"), true);
  const first = all.events[0];
  assert.deepEqual(Object.keys(first).sort(), ["at", "detail", "id", "kind", "label", "name", "replay", "test", "tone"]);
  assert.equal(first.replay, true); assert.match(first.detail, /500 bits/); assert.equal(first.label, "Bits"); assert.equal(first.tone, "warn");
  assert.equal(all.alerts.linked, true); assert.equal(all.types.length, 10);
  assert.ok(!/secret|token|email|k=/i.test(JSON.stringify(all).replace(/"text"/g, "")), "nothing private leaves");
  assert.equal((await D.payload(ctx, { scope: "bogus", now: NOW })).scope, "day", "an unknown scope is the default");
  const offline = (await site()).ctx;
  assert.equal((await D.payload(offline, { scope: "stream", now: NOW })).live, false);
});

test("replay: same data, flagged, once for a double click, rate limited, works for a switched-off type, refused without the alerts overlay", async () => {
  const { ctx, k } = await site();
  await deliver(ctx, TYPES.follow, EV.follow, { id: "f1" });
  await S.updateState(ctx, (d) => { d.enabled = { follow: false }; });
  const a = await act(ctx, k, { action: "replay", id: "f1" }), b = await act(ctx, k, { action: "replay", id: "f1" });
  assert.deepEqual([a.ok, b.ok, b.again], [true, true, true]);
  const lines = await S.recent(ctx, 10);
  assert.equal(lines.filter((l) => l.source === "replay").length, 1, "a double click sends one alert");
  assert.equal(lines[0].of, "f1"); assert.equal(lines[0].name, "Etoile_Nord");
  assert.deepEqual(await act(ctx, k, { action: "replay", id: "nope" }), { ok: false, code: "unknown" });
  assert.deepEqual(await act(ctx, k, { action: "bogus" }), { ok: false, code: "bad" });
  assert.deepEqual(await act(ctx, k, null), { ok: false, code: "bad" });
  const { ctx: bare, k: kb } = await site({ alerts: false });
  await deliver(bare, TYPES.follow, EV.follow, { id: "f2" });
  assert.deepEqual(await act(bare, kb, { action: "replay", id: "f2" }), { ok: false, code: "no_alerts" });
  assert.equal((await D.payload(bare, { now: NOW })).alerts.linked, false);
});

test("replay: rate limit (10 a minute) and action limit (40 a minute) answer a plain code", async () => {
  const { ctx, k } = await site();
  await deliver(ctx, TYPES.follow, EV.follow, { id: "f1" });
  let rated = 0;
  for (let i = 0; i < 14; i++) { const r = await D.act(ctx, { action: "replay", id: "f1" }, { now: NOW + i * 4000 }); if (r.code === "rate") rated++; }
  assert.ok(rated > 0);
  const flood = world({ alerts: true }); await S.ensureSecret(flood.ctx);
  let limited = 0;
  for (let i = 0; i < 50; i++) if ((await D.act(flood.ctx, { action: "pause" }, { now: NOW })).code === "rate") limited++;
  assert.equal(limited, 10);
});

test("pause holds, resume releases, empty drops: through the alerts queue, with its numbers; absent overlay: refused", async () => {
  const { ctx, k, queue } = await site({ queue: { held: 3 } });
  const p = await act(ctx, k, { action: "pause" });
  assert.deepEqual([p.ok, p.paused, p.held], [true, true, 3]);
  assert.equal((await D.payload(ctx, { now: NOW })).alerts.paused, true);
  const r = await act(ctx, k, { action: "resume" });
  assert.deepEqual([r.ok, r.paused, r.released], [true, false, 3]);
  queue.held = 2;
  const c = await act(ctx, k, { action: "clear" });
  assert.deepEqual([c.ok, c.dropped], [true, 2]);
  assert.deepEqual(queue.calls, ["pause", "resume", "clear"]);
  const { ctx: bare, k: kb } = await site({ alerts: false });
  for (const a of ["pause", "resume", "clear", "test"]) assert.deepEqual(await act(bare, kb, { action: a, type: "follow" }), { ok: false, code: "no_alerts" }, a);
});

test("test: sends the realistic sample of a type; unknown type refused", async () => {
  const { ctx, k } = await site();
  assert.equal((await act(ctx, k, { action: "test", type: "gift" })).ok, true);
  assert.equal((await S.recent(ctx, 1))[0].kind, "gift");
  assert.equal((await act(ctx, k, { action: "test", type: "zzz" })).code, "unknown");
});

test("the page: strict policy with a nonce, no inline handler, nothing from another site, a heading and labelled controls, FR and EN", async () => {
  for (const locale of ["en", "fr"]) {
    const { ctx, k } = await site({ locale });
    const res = await call(ctx, "dock", k, {}, "&scheme=light");
    const html = await res.text();
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'self'/);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
    assert.ok(html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`));
    assert.ok(!/\son[a-z]+=/i.test(html.replace(/<script[\s\S]*<\/script>/, "")), "no inline handler");
    assert.ok(!/https?:\/\/(?!site\.example\.org)/.test(html), "nothing is loaded from another site");
    assert.ok(!/innerHTML|document\.write|eval\(/.test(html));
    assert.match(html, /<h1>/); assert.match(html, /aria-label=/); assert.match(html, /<label class="sr" for="q">/);
    assert.match(html, new RegExp(`<html lang="${locale}"`));
    assert.match(html, locale === "fr" ? /Ce direct/ : /This stream/);
    assert.ok(html.includes(`dock-data?k=${k}&lang=${locale}`) && html.includes(`dock-act?k=${k}&lang=${locale}`));
    assert.equal(res.headers.get("cache-control"), "no-store"); assert.match(res.headers.get("x-robots-tag"), /noindex/);
    const css = fs.readFileSync(new URL("../modules/twitch-events/dock.mjs", import.meta.url), "utf8").match(/export const CSS = `([\s\S]*?)`;/)[1];
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgb\(|font-family/.test(css), "the stylesheet writes no colour and no font: only the tokens of the administration");
    assert.ok(/min-height:44px/.test(css) && /\.row\{[^}]*height:52px/.test(css));
  }
});

test("the page: every sentence exists in French and English with the same {words}", () => {
  for (const k of DK.KEYS) { assert.ok(en[`dock_${k}`] && fr[`dock_${k}`], k); assert.deepEqual((en[`dock_${k}`].match(/\{\w+\}/g) ?? []).sort(), (fr[`dock_${k}`].match(/\{\w+\}/g) ?? []).sort(), k); }
  for (const k of ["dock_intro", "dock_copy_label", "dock_renew_btn", "dock_renew_confirm", "dock_renewed", "dock_denied"]) assert.ok(en[k] && fr[k], k);
});

test("the look: the raid docks' tokens are the same (this file is a copy, it must not drift)", async () => {
  const raid = await import("../modules/twitch-raid/dock.mjs");
  const kit = await import("../modules/twitch-events/dockkit.mjs");
  assert.equal(kit.FALLBACK_TOKENS, raid.FALLBACK_TOKENS);
  assert.equal(kit.wantsScheme("https://x/?scheme=light"), "light"); assert.equal(kit.wantsScheme("https://x/?scheme=zzz"), null);
});

test("pure helpers: relative time (FR and EN), the back-off, the filters (type groups, search without accents or case)", () => {
  const n = NOW;
  assert.equal(DP.relTime(n - 5000, n, "en"), "now");
  assert.match(DP.relTime(n - 2 * 60_000, n, "en"), /2 min/);
  assert.match(DP.relTime(n - 2 * 60_000, n, "fr"), /il y a 2\smin/);
  assert.match(DP.relTime(n - 3 * 3_600_000, n, "fr"), /il y a 3\sh/);
  assert.equal(DP.relTime(n + 60_000, n, "en"), "now", "a date in the future counts as now");
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(DP.nextDelay), [3000, 6000, 12000, 24000, 30000, 30000]);
  const ev = [{ kind: "hype_begin", label: "Hype", name: "", detail: "level 1" }, { kind: "follow", label: "Follow", name: "Étoile", detail: "" }, { kind: "hype_end", label: "Hype end", name: "", detail: "" }, { kind: "gift", label: "Gift", name: "Camille", detail: "5 subs" }];
  assert.equal(DP.visible(ev, { type: "hype", q: "" }).length, 2, "hype covers its three phases");
  assert.equal(DP.visible(ev, { type: "follow", q: "" }).length, 1);
  assert.equal(DP.visible(ev, { type: "", q: " ETOILE " })[0].kind, "follow");
  assert.equal(DP.visible(ev, { type: "", q: "5 subs" })[0].kind, "gift");
  assert.equal(DP.visible(ev, { type: "gift", q: "zzz" }).length, 0);
});

/** A permissive fake browser: enough to run the whole script of the page and watch what it asks for. */
function runPage(html, { dispatch }) {
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
  const timers = []; let clock = 0, tid = 0;
  const mk = (tag = "div") => {
    const e = { tag, children: [], attrs: {}, style: {}, className: "", textContent: "", hidden: false, disabled: false, value: "", listeners: {} };
    e.appendChild = (c) => { e.children.push(c); return c; };
    e.append = (...c) => c.forEach((x) => e.children.push(x));
    e.replaceChildren = (...c) => { e.children = [...c]; };
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); }; e.getAttribute = (k) => e.attrs[k] ?? null;
    e.addEventListener = (t, f) => { (e.listeners[t] ??= []).push(f); };
    e.closest = () => null; e.querySelectorAll = () => [];
    return e;
  };
  const byId = {};
  const doc = { body: mk("body"), getElementById: (id) => (byId[id] ??= mk()), createElement: mk, querySelectorAll: () => [] };
  const fetched = [];
  const win = {
    document: doc, JSON, Math, Date, Number, String, Promise, Object, Array, Error, Intl, encodeURIComponent, AbortController,
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: clock + (ms || 0), fn }); return tid; }, clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, localStorage: { getItem: () => null, setItem() {} }, confirm: () => true,
    fetch: async (u, init) => { fetched.push({ url: String(u), method: init?.method ?? "GET" }); return dispatch(new URL(String(u), "https://site.example.org").href, init); },
  };
  win.window = win;
  vm.runInNewContext(script, win);
  return {
    fetched, el: (id) => byId[id], doc,
    async advance(ms) {
      const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
      const end = clock + ms;
      await flush();
      for (;;) { const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!next) break; timers.splice(timers.indexOf(next), 1); clock = next.at; await next.fn(); await flush(); }
      clock = end; await flush();
    },
  };
}

test("the whole script: reads the data with the key, shows the lines, says 'reconnecting' with a growing wait when the site stops, and comes back by itself", async () => {
  const { ctx, k } = await site({ locale: "en" });
  await deliver(ctx, TYPES.follow, EV.follow, { id: "f1" });
  const html = await (await call(ctx, "dock", k)).text();
  let down = false;
  const page = runPage(html, { dispatch: async (u, init) => { if (down) throw new Error("offline"); const path = new URL(u).pathname.split("/").pop(); const r = await mod.routes[path](new Request(u, init), ctx); return { ok: r.ok, status: r.status, json: () => r.json() }; } });
  await page.advance(50);
  assert.ok(page.fetched[0].url.includes(`/m/ev/dock-data?k=${k}&lang=en&scope=`), "the first read carries the key");
  const rows = page.el("list").children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children.length, 4, "badge, who and detail, time, replay button");
  const btn = rows[0].children[3];
  assert.equal(btn.disabled, false, "the alerts overlay is linked");
  assert.ok(btn.attrs["aria-label"].includes("Etoile_Nord"));
  assert.equal(page.el("updated").textContent, en.dock_updated);
  down = true;
  await page.advance(3100);
  assert.match(page.el("updated").textContent, /Reconnecting… next try in 6 s/);
  assert.equal(page.el("strip").className, "strip off");
  await page.advance(6100);
  assert.match(page.el("updated").textContent, /next try in 12 s/);
  assert.equal(page.el("list").children.length, 1, "the lines already shown stay while it reconnects");
  down = false;
  await page.advance(12_500);
  assert.equal(page.el("updated").textContent, en.dock_updated);
  const reads = page.fetched.length;
  await page.advance(3100);
  assert.ok(page.fetched.length > reads, "back to a read every 3 seconds");
  // a click on replay: one request, even for a double click
  btn.listeners.click[0](); btn.listeners.click[0]();
  await page.advance(50);
  assert.equal(page.fetched.filter((f) => f.method === "POST").length, 1, "a double click asks once");
  assert.equal((await S.recent(ctx, 5)).filter((l) => l.source === "replay").length, 1);
});

test("the whole script: a key that is no longer good stops the dock with one plain sentence (no retry loop)", async () => {
  const { ctx, k } = await site({ locale: "en" });
  const html = await (await call(ctx, "dock", k)).text();
  await mod.adminActions.renewDock(ctx);
  const page = runPage(html, { dispatch: async (u, init) => { const path = new URL(u).pathname.split("/").pop(); const r = await mod.routes[path](new Request(u, init), ctx); return { ok: r.ok, status: r.status, json: () => r.json() }; } });
  await page.advance(100);
  assert.equal(page.doc.body.textContent, en.dock_denied);
  const n = page.fetched.length;
  await page.advance(120_000);
  assert.equal(page.fetched.length, n, "no more requests with a dead address");
});

test("admin: the OBS dock tab says where to copy the address and how to add it in OBS; New address asks for confirmation and says what happens", async () => {
  const { ctx, k } = await site({ locale: "en" });
  const blocks = await mod.adminPanel(ctx, { query: {} });
  const copy = blocks.find((b) => b.type === "copy" && b.tab === "dock");
  assert.equal(copy.text, `https://site.example.org/m/ev/dock?k=${k}`);
  assert.match(blocks.find((b) => b.type === "markdown" && b.tab === "dock").text, /Custom browser docks/);
  const renew = blocks.find((b) => b.type === "table" && b.tab === "dock");
  assert.ok(renew.rowActions[0].confirm.length > 20 && renew.rowActions[0].danger === true);
  assert.equal(manifest.tabs.find((t) => t.id === "dock").panel, true);
  assert.ok(manifest.requires.some((r) => r.service === "alerts.queue" && r.optional === true));
  assert.equal(manifest.version, "1.1.0");
  const { assertAdminPageErgonomics } = await import("./helpers/ergonomics.mjs");
  for (const locale of ["en", "fr"]) assertAdminPageErgonomics(await mod.adminPanel((await site({ locale })).ctx, { query: {} }));
});

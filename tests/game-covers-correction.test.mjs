// Game covers 1.3.2: a correction made by the owner reaches every consumer at once.
// Production report: the owner corrected the cover of a game (source Twitch), but Planning and the other consumers kept showing the old one.
// Causes reproduced here (each test fails on 1.3.1):
//   1. the "wait before trying again" after a failed download was kept per TITLE, not per image: one failed refresh of the old image blocked the download of the corrected one for 1 h to 24 h
//      (the service answered "unreachable" and the address kept serving the old bytes);
//   2. the served address never changed (and was cached 5 minutes), and the route served whatever copy it had, even when a correction said otherwise;
//   3. a download of the old image still running could put it back after the correction; "No cover" and "Forget all" left the old copy served.
// Fake network only: every image address has its OWN bytes, so a stale copy is visible. Invented titles.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { JPEG, IMAGE_HOSTS } from "./helpers/cover-fakes.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch } = kit;
const DIR = new URL("../modules/game-covers/", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}module.json`, "utf8"));
const en = JSON.parse(fs.readFileSync(`${DIR}locales/en.json`, "utf8"));
const mod = (await import("../modules/game-covers/index.mjs")).default;
const rawg = await import("../modules/game-covers/rawg.mjs");
const ops = await import("../modules/game-covers/ops.mjs");
const copies = await import("../modules/game-covers/copies.mjs");
const sources = await import("../modules/game-covers/sources.mjs");
const { titleKey } = await import("../modules/game-covers/match.mjs");
const gs = await import("../modules/game-suggestions/index.mjs");
const pl = await import("../modules/planning/index.mjs");
const svc = mod.services["game.cover"];

const KEY = "FAKE-RAWG-KEY-0123456789";
const TITLE = "Ember Vale";
const RAWG_IMG = "https://media.rawg.io/media/crop/600/400/games/021/ember-vale.jpg";
const TWITCH_IMG = "https://static-cdn.jtvnw.net/ttv-boxart/847310440_IGDB-285x380.jpg";
const TWITCH2_IMG = "https://static-cdn.jtvnw.net/ttv-boxart/512345_IGDB-285x380.jpg";
const realFetch = globalThis.fetch;

/** Every image address has its own bytes (a valid JPEG header + the address), so a stale copy is visible. */
const bytesFor = (url) => Uint8Array.from([...JPEG, ...Buffer.from(url)]);
const tail = (bytes) => Buffer.from(bytes).toString("latin1").slice(JPEG.length);

let api, imageMode, imageCalls, hold, customReply;
const RAWG_DB = { "ember vale": [{ id: 21, name: "Ember Vale", released: "2020-09-17", platforms: [{ platform: { name: "PC" } }], background_image: "https://media.rawg.io/media/games/021/ember-vale.jpg" }] };
const TWITCH_DB = { "ember vale": [{ id: "847310440", name: "Ember Vale", box_art_url: "https://static-cdn.jtvnw.net/ttv-boxart/847310440_IGDB-52x72.jpg" }, { id: "512345", name: "Ember Vale Legacy", box_art_url: "https://static-cdn.jtvnw.net/ttv-boxart/512345_IGDB-52x72.jpg" }] };
const serve = () => {
  imageMode = "up"; imageCalls = []; hold = null; customReply = null;
  api = fakeFetch({ "*": (url) => {
    const u = new URL(url);
    if (u.hostname === "api.rawg.io") return { json: { results: RAWG_DB[(u.searchParams.get("search") ?? "").toLowerCase()] ?? [] } };
    return { status: 404 };
  } });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!IMAGE_HOSTS.has(new URL(url).hostname)) return api(input, init);
    imageCalls.push(url);
    if (hold && hold.match(url)) await hold.gate;   // an image download that is still running
    if (imageMode === "down") throw new TypeError("fetch failed");
    if (customReply) return customReply(url);
    const b = bytesFor(url);
    return new Response(b, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(b.length) } });
  };
};
const makeCtx = () => {
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Covers", messages: en, locale: "en", settings: { rawgKey: KEY, useSteam: false }, permissions: ["storage", "routes", "admin", "mcp"], logEvents: manifest.logEvents,
    services: { "twitch.api": { status: () => ({ ready: true }), request: (a) => ({ ok: true, status: 200, json: { data: TWITCH_DB[String(a?.query?.query?.[0] ?? "").toLowerCase()] ?? [] } }) } } });
  c.can = () => true;
  return c;
};
/** What a browser would get at this address. */
const fetchRoute = async (c, url, headers = {}, method = "GET") => {
  const id = url.split("/cover/")[1].split("?")[0];
  const res = await mod.routes["cover/:slug"](new Request(url, { method, headers }), Object.assign(c, { params: { slug: id } }));
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
};
const shows = async (c, url) => { const r = await fetchRoute(c, url); return r.status === 200 ? tail(r.bytes) : r.status; };
const choose = (c, id, src) => ops.chooseGame(c, "owner", TITLE, id, undefined, src);
const panel = mod.adminPanel;
const panelText = async (c, query) => JSON.stringify(await panel(c, query));
const aged = (days) => Date.now() + days * 86_400_000;

beforeEach(() => { rawg.clearCache(); rawg.resetBreaker(); sources.resetSources(); copies.resetCopies(); ops.resetRate(); serve(); });
afterEach(() => { globalThis.fetch = realFetch; });

/** The consumers, wired to the real service the way the core wires them (`ctx.api.services.call`). */
const consumers = (gc) => {
  const service = { "game.cover": { status: (a) => svc.status(gc, a), cover: (a) => svc.cover(gc, a) } };
  const pm = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const gm = JSON.parse(fs.readFileSync(new URL("../modules/game-suggestions/module.json", import.meta.url), "utf8"));
  const planning = fakeCtx({ key: "planning", moduleId: "planning", locale: "en", messages: JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/en.json", import.meta.url), "utf8")), permissions: pm.permissions, basePath: "planning", services: service });
  const suggestions = fakeCtx({ key: "game-suggestions", moduleId: "game-suggestions", locale: "en", messages: JSON.parse(fs.readFileSync(new URL("../modules/game-suggestions/locales/en.json", import.meta.url), "utf8")), permissions: gm.permissions, basePath: "suggestions", services: service });
  const slot = { title: "stream", games: [TITLE], allDay: false, start: new Date(), end: new Date(Date.now() + 3_600_000) };
  return {
    planning: async () => (await pl.coversForSlots(planning, [slot])).covers.get(TITLE),
    suggestions: async () => (await gs.coverFor(suggestions, TITLE)).url,
    service: async () => (await svc.cover(gc, TITLE)).url,
  };
};

test("a correction is served at once by the service, Planning and Suggestions; the served address changes so browsers fetch it again", async () => {
  const gc = makeCtx(), user = consumers(gc);
  const first = await user.service();
  assert.equal(await shows(gc, first), RAWG_IMG, "the automatic cover (RAWG)");
  assert.equal(await user.planning(), first);
  const remembered = await user.suggestions();   // Suggestions remember this address in their own data
  assert.equal(remembered, first);

  assert.equal((await choose(gc, 847310440, "twitch")).ok, true);
  const now = { service: await user.service(), planning: await user.planning(), suggestions: await user.suggestions() };
  assert.deepEqual([now.planning, now.suggestions], [now.service, now.service], "every consumer gets the same new address");
  assert.notEqual(now.service, first, "a new address: browsers and caches fetch the image again");
  assert.match(now.service, /\/cover\/[0-9a-f]{16}\?v=[0-9a-f]{12}$/);
  assert.equal(first.split("?")[0], now.service.split("?")[0], "same path (the title does not change), only the version differs");
  assert.equal(await shows(gc, now.service), TWITCH_IMG, "the new address serves the corrected image");
  assert.equal(await shows(gc, first), TWITCH_IMG, "an address remembered earlier serves the corrected image too, never the old one");
  assert.equal(await shows(gc, first.split("?")[0]), TWITCH_IMG, "even without a version");

  // changing the corrected cover again replaces it again
  assert.equal((await choose(gc, 512345, "twitch")).ok, true);
  const third = await user.planning();
  assert.notEqual(third, now.service);
  assert.equal(await shows(gc, third), TWITCH2_IMG);
  assert.equal(await shows(gc, now.service), TWITCH2_IMG);
  assert.equal(await user.suggestions(), third);
  assert.equal(await user.service(), third);
  // one copy only: the old bytes are gone, not kept next to the new ones
  assert.equal((await gc.api.store.list("coverMeta", { limit: 50 })).length, 1);
  assert.equal((await gc.api.store.list("coverBytes", { limit: 50 })).length, 1);
});

test("same version, same bytes: asking again changes nothing; the version is a hash of the image", async () => {
  const gc = makeCtx();
  const a = await svc.cover(gc, TITLE), b = await svc.cover(gc, TITLE);
  assert.equal(a.url, b.url);
  assert.equal(imageCalls.length, 1);
  const r = await fetchRoute(gc, a.url);
  assert.equal(r.headers.get("etag"), `"${new URL(a.url).searchParams.get("v")}"`);
  assert.equal(a.url.split("v=")[1].length, 12);
});

test("cache: the current version may be kept, any other address is revalidated (ETag) so a correction shows at once; no cookie", async () => {
  const gc = makeCtx();
  const first = (await svc.cover(gc, TITLE)).url;
  const cur = await fetchRoute(gc, first);
  assert.match(cur.headers.get("cache-control"), /^public, max-age=\d+$/);
  assert.equal(cur.headers.get("set-cookie"), null);
  const etag = cur.headers.get("etag");
  const hit = await fetchRoute(gc, first, { "If-None-Match": etag });
  assert.equal(hit.status, 304); assert.equal(hit.bytes.length, 0);

  await choose(gc, 847310440, "twitch");
  const second = (await svc.cover(gc, TITLE)).url;
  // a browser that remembered the first address asks again with its old ETag: it gets the new image, not a 304
  const old = await fetchRoute(gc, first, { "If-None-Match": etag });
  assert.equal(old.status, 200);
  assert.equal(tail(old.bytes), TWITCH_IMG);
  assert.equal(old.headers.get("cache-control"), "public, no-cache", "an address that is not the current version is never kept without asking");
  assert.notEqual(old.headers.get("etag"), etag);
  assert.equal((await fetchRoute(gc, second, { "If-None-Match": old.headers.get("etag") })).status, 304);
  assert.equal((await fetchRoute(gc, first.split("?")[0])).headers.get("cache-control"), "public, no-cache");
  const head = await fetchRoute(gc, second, {}, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0);
});

test("a Twitch copy is never kept by a browser longer than Twitch allows (24 h)", async () => {
  const gc = makeCtx();
  await choose(gc, 847310440, "twitch");
  const url = (await svc.cover(gc, TITLE)).url;
  const max = Number(/max-age=(\d+)/.exec((await fetchRoute(gc, url)).headers.get("cache-control"))[1]);
  assert.ok(max > 0 && max <= 3600);
});

test("root cause 1: a failed refresh of the OLD image no longer blocks the corrected image (the waiting time is per image, not per title)", async () => {
  const gc = makeCtx(), user = consumers(gc);
  const first = await user.service();
  // 31 days later the lazy renewal of the old copy fails (the image host is down): the old image is now "waiting"
  imageMode = "down";
  await copies.ensure(gc, titleKey(TITLE), "rawg", "/media/crop/600/400/games/021/ember-vale.jpg".replace("/crop/600/400", ""), { now: aged(31) });
  await copies.settled();
  imageMode = "up";
  assert.equal((await choose(gc, 847310440, "twitch")).ok, true);
  const url = await user.planning();
  assert.ok(url, "1.3.1: the service answered 'unreachable' (no address) for one hour or more");
  assert.equal(await shows(gc, url), TWITCH_IMG);
  assert.equal(await shows(gc, first), TWITCH_IMG);
});

test("a corrected image that fails to download is retried (not forgotten), and the old cover is NOT served in the meantime from an address that was remembered", async () => {
  const gc = makeCtx(), user = consumers(gc);
  const first = await user.service();
  imageMode = "down";
  await choose(gc, 847310440, "twitch");
  assert.equal((await svc.cover(gc, TITLE)).status, "unreachable", "no address while the image is missing");
  assert.equal(await shows(gc, first), 404, "a wrong cover is worse than none");
  imageMode = "up";
  // still inside the waiting time of THIS image: the route does not insist, but the next owner action or any later request does
  copies.resetCopies();
  const url = await user.planning();
  assert.equal(await shows(gc, url), TWITCH_IMG);
  assert.equal(await shows(gc, first), TWITCH_IMG);
});

test("root cause 3: a download of the old image that ends after the correction does not put the old image back", async () => {
  const gc = makeCtx();
  const first = (await svc.cover(gc, TITLE)).url;
  // a renewal of the old copy is still downloading when the owner corrects
  let release; hold = { match: (u) => u === RAWG_IMG, gate: new Promise((r) => { release = r; }) };
  const id = copies.idOf(titleKey(TITLE));
  const slow = copies.ensure(gc, titleKey(TITLE), "rawg", "/media/games/021/ember-vale.jpg", { now: aged(40), waitMs: 50 });
  await slow;
  assert.equal((await choose(gc, 847310440, "twitch")).ok, true);
  hold = null; release();
  await copies.settled();
  await new Promise((r) => setTimeout(r, 20));
  const meta = (await gc.api.store.list("coverMeta", { limit: 5 })).map((r) => r.data);
  assert.deepEqual(meta.map((m) => [m.id, m.src, m.img]), [[id, "twitch", "/ttv-boxart/847310440_IGDB-285x380.jpg"]]);
  assert.equal(await shows(gc, first), TWITCH_IMG);
});

test("an address remembered by a consumer follows the correction even when nobody asked the service since (the route fetches the right image itself)", async () => {
  const gc = makeCtx();
  const first = (await svc.cover(gc, TITLE)).url;
  // the correction is saved without the immediate copy (the image host was slow): only the owner's choice is stored
  const fixes = await import("../modules/game-covers/fixes.mjs");
  await fixes.saveFix(gc, TITLE, { kind: "image", name: "Ember Vale", img: "/ttv-boxart/847310440_IGDB-285x380.jpg", src: "twitch", srcId: 847310440 });
  assert.equal(await shows(gc, first), TWITCH_IMG);
  const fresh = (await svc.cover(gc, TITLE)).url;
  assert.equal(await shows(gc, fresh), TWITCH_IMG);
  assert.equal(imageCalls.filter((u) => u === TWITCH_IMG).length, 1, "downloaded once");
});

test("'No cover' and 'Forget': the kept copy is not served any more; 'Forget all' drops every corrected copy; the next request searches again", async () => {
  const gc = makeCtx();
  const first = (await svc.cover(gc, TITLE)).url;
  assert.equal((await ops.chooseNone(gc, "owner", TITLE)).ok, true);
  assert.equal(await shows(gc, first), 404, "no cover: the address that was remembered shows nothing");
  assert.equal((await svc.cover(gc, TITLE)).status, "none");
  assert.equal((await gc.api.store.list("coverMeta", { limit: 5 })).length, 0);

  // a correction, then "Forget": the automatic cover comes back, with its own copy
  await choose(gc, 847310440, "twitch");
  assert.equal(await ops.forget(gc, "owner", titleKey(TITLE), TITLE), true);
  assert.equal(await shows(gc, first), 404);
  const back = await svc.cover(gc, TITLE);
  assert.equal(back.source, "rawg");
  assert.equal(await shows(gc, back.url), RAWG_IMG);

  // "Forget all"
  await choose(gc, 847310440, "twitch");
  assert.equal(await ops.forgetAll(gc, "owner"), 1);
  assert.equal((await gc.api.store.list("coverMeta", { limit: 5 })).length, 0, "no orphan copy of a forgotten correction");
  const again = await svc.cover(gc, TITLE);
  assert.equal(await shows(gc, again.url), RAWG_IMG);
});

test("old copies written before 1.3.2 (no hash) still work: their version comes from their date, and the route agrees", async () => {
  const gc = makeCtx();
  const url = (await svc.cover(gc, TITLE)).url;
  const id = copies.idOf(titleKey(TITLE));
  const [row] = await gc.api.store.list("coverMeta", { limit: 5 });
  const { sum, ...legacy } = row.data;
  await gc.api.store.update(row.id, legacy);
  const again = (await svc.cover(gc, TITLE)).url;
  assert.match(again, new RegExp(`/cover/${id}\\?v=t[0-9a-z]+$`));
  assert.match((await fetchRoute(gc, again)).headers.get("cache-control"), /max-age=/);
  assert.equal(await shows(gc, url), RAWG_IMG, "the address with the hash still serves it");
});

// ── Trace of a corrected Twitch cover that never reaches the local copy ──────────────────────────────────────────────────────────────
// Path: ops.chooseGame -> fixes.saveFix (the choice is stored) -> copies.ensure(force) -> download -> save. Every consumer (chain.cover -> entryCover -> copies.ensure) only ever gets the KEPT copy.
// The allow-list accepts the "-285x380" Twitch path; what can fail is the download itself, and in 1.3.1 it failed silently (no reason anywhere, a title-wide waiting time of 1 h, 6 h then 24 h).
const FAILS = [
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://static-cdn.jtvnw.net/elsewhere.jpg" } })],
  ["status", () => new Response("denied", { status: 403, headers: { "content-type": "text/plain" } })],
  ["type", () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })],
  ["size", () => new Response(new Uint8Array(400 * 1024), { status: 200, headers: { "content-type": "image/jpeg" } })],
  ["format", () => new Response(Uint8Array.from(Buffer.from("<svg></svg>")), { status: 200, headers: { "content-type": "image/jpeg" } })],
];
for (const [why, reply] of FAILS) {
  test(`corrected Twitch cover, download fails (${why}): the correction page says so in plain words and a retry copies it; consumers get nothing wrong meanwhile`, async () => {
    const gc = makeCtx(), user = consumers(gc);
    const hosts = await import("../modules/game-covers/hosts.mjs");
    assert.equal(hosts.imagePath("twitch", TWITCH_IMG), "/ttv-boxart/847310440_IGDB-285x380.jpg", "the host and path are allowed");
    customReply = reply;
    assert.equal((await choose(gc, 847310440, "twitch")).ok, true, "the correction itself is saved");
    assert.equal((await svc.cover(gc, TITLE)).status, "unreachable");
    assert.equal(await user.planning(), undefined, "no cover rather than a wrong one");
    const page = await panelText(gc, { query: { titre: TITLE } });
    assert.ok(page.includes(en[`copy_why_${why}`]), `reason shown: ${why}`);
    assert.ok(page.includes(en.copy_retry), "retry offered");
    const before = imageCalls.length;
    customReply = null;
    const out = await mod.adminActions.retryCopy(gc, { id: TITLE });
    assert.ok(out.ok, JSON.stringify(out));
    assert.ok(imageCalls.length > before, "the retry ignores the waiting time");
    assert.equal(await shows(gc, await user.planning()), TWITCH_IMG);
    assert.ok((await panelText(gc, { query: { titre: TITLE } })).includes(en.copy_copied));
  });
}

test("a corrected cover that was never asked for shows 'not copied yet' (pending) and a failed retry says why in the error, a later retry copies it", async () => {
  const gc = makeCtx();
  const fixes = await import("../modules/game-covers/fixes.mjs");
  await fixes.saveFix(gc, TITLE, { kind: "image", name: "Ember Vale", img: "/ttv-boxart/847310440_IGDB-285x380.jpg", src: "twitch", srcId: 847310440 });
  assert.ok((await panelText(gc, { query: { titre: TITLE } })).includes(en.copy_pending));
  customReply = FAILS[0][1];
  const bad = await mod.adminActions.retryCopy(gc, { id: TITLE });
  assert.ok(bad.error.includes(en.copy_why_redirect), bad.error);
  customReply = null;
  assert.ok((await mod.adminActions.retryCopy(gc, { id: TITLE })).ok);
  assert.ok((await panelText(gc, { query: { titre: TITLE } })).includes(en.copy_copied));
});

test("manifest 1.3.2: a corrective version, nothing else added (no permission, no host)", () => {
  assert.equal(manifest.version, "1.3.2");
  assert.deepEqual(manifest.permissions, ["storage", "routes", "admin", "mcp"]);
});

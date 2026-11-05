// The control dock in a real browser: the live gestures, the confirm / undo pattern, the keyboard, the lost connection. Invented data only.
// Skipped, loudly, where Chromium or Playwright is missing (see helpers/dockBrowser.mjs).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { scene } from "./helpers/dockScenes.mjs";
import { def as audDef, K as AK, fr as audFr, en as audEn } from "./helpers/audienceHarness.mjs";
import { pollsFr, pollsEn } from "./helpers/audienceWorld.mjs";

const b = await browser();
after(() => closeBrowser());
const skip = b ? false : "Chromium or Playwright not available here: the dock flow tests did not run";
if (skip) console.error(`⚠ ${skip}`);

const L = await import("../modules/polls/lib.mjs");
const D = await import("../modules/audience/draw.mjs");
const polls = async (w) => (await w.polls.api.store.list("polls")).map((r) => ({ id: r.id, ...r.data }));
const audit = async (w) => (await w.aud.api.store.list("audit")).map((r) => r.data);

async function open(name, { locale = "en", dock = true, viewport = [390, 844], reduced = false } = {}) {
  const w = await scene(name, { locale });
  await AK.ensureMeta(w.aud);
  const key = (await w.aud.api.store.list("meta")).find((r) => r.data.k === "cfg").data.remoteKey;
  const hits = [];
  const srv = await serve(audDef, w.aud, { onRequest: (n) => hits.push([n, Date.now()]) });
  const ctx = await b.newContext({ viewport: { width: viewport[0], height: viewport[1] }, colorScheme: "dark", locale: locale === "fr" ? "fr-FR" : "en-US", reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${srv.base}/m/audience/remote?k=${key}${dock ? "&dock=1" : ""}`);
  await page.waitForSelector(".tab");
  const strings = { aud: locale === "fr" ? audFr : audEn, polls: locale === "fr" ? pollsFr : pollsEn };
  return { w, page, srv, hits, errors, key, T: strings, close: async () => { await ctx.close(); await srv.close(); } };
}
const tab = (h, id) => h.page.click(`[data-tab="${id}"]`);
const btn = (h, text) => h.page.locator("button.btn", { hasText: text }).first();
const msg = (h) => h.page.locator("#msg");
const settle = (h, ms = 250) => h.page.waitForTimeout(ms);

test("poll: close now ends it, the stage turns to the result with 'Announce' as the main action, the tab says finished", { skip }, async () => {
  const h = await open("poll-run2");
  try {
    assert.equal(await h.page.locator(".view .btn.primary .lb.l").innerText(), h.T.polls.remoteClose, "running: the biggest control is Close now");
    await h.page.click(".btn.primary"); await settle(h, 800);
    assert.equal(L.stateOf((await polls(h.w))[0]), "closed");
    assert.equal(await h.page.locator(".btn.primary .lb.l").innerText(), h.T.polls.remoteShowResult, "finished: Announce the result");
    assert.match(await h.page.locator('[data-tab="poll"]').getAttribute("aria-label"), new RegExp(h.T.aud.dockStateFinished));
    assert.match(await msg(h).innerText(), new RegExp(h.T.polls.remoteClosed.slice(0, 12)));
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test("poll: cancel is one tap, then a 3-second Confirm / Undo on the same row that says what is lost; Undo and the timeout change nothing", { skip, timeout: 30_000 }, async () => {
  const h = await open("poll-run2");
  try {
    await btn(h, h.T.polls.remoteCancelShort).click();
    await settle(h, 100);
    assert.equal(await h.page.locator('[data-fk="confirm"]').count(), 1, "Confirm appeared");
    assert.match(await h.page.locator('[data-fk="confirm"]').innerText(), new RegExp(h.T.polls.remoteCancelConfirm));
    assert.equal(await h.page.locator("button.undo").count(), 1);
    assert.equal((await polls(h.w)).length, 1, "nothing is deleted by the first tap");
    await h.page.click("button.undo"); await settle(h, 100);
    assert.equal(await h.page.locator('[data-fk="confirm"]').count(), 0, "Undo puts the buttons back");
    assert.equal((await polls(h.w)).length, 1);
    await btn(h, h.T.polls.remoteCancelShort).click();   // armed again: let the 3 seconds pass
    await h.page.waitForTimeout(3300);
    assert.equal(await h.page.locator('[data-fk="confirm"]').count(), 0, "it disarms itself after 3 seconds");
    assert.equal((await polls(h.w)).length, 1);
    await btn(h, h.T.polls.remoteCancelShort).click(); await settle(h, 100);
    await h.page.click('[data-fk="confirm"]'); await settle(h, 400);
    assert.equal((await polls(h.w)).length, 0, "Confirm deletes the poll and its votes");
    assert.equal(await h.page.locator(".view").evaluate((n) => n.tagName), "FORM", "back to the start form");
    assert.ok((await audit(h.w)).some((l) => l.what === "polls.poll-cancel" && l.who === "remote"));
  } finally { await h.close(); }
});

test("poll: +30 s adds time; Show puts the poll on the stream screen; Reopen after closing; all in one tap", { skip }, async () => {
  const h = await open("poll-run2");
  try {
    const before = Date.parse((await polls(h.w))[0].endsAt);
    await btn(h, "+30 s").click(); await settle(h);
    assert.equal(Date.parse((await polls(h.w))[0].endsAt) - before, 30_000);
    await btn(h, h.T.polls.remoteShowShort).click(); await settle(h);
    const cfg = (await h.w.polls.api.store.list("meta")).find((r) => r.data.k === "cfg").data;
    assert.equal(cfg.onAir, (await polls(h.w))[0].slug);
    await h.page.click(".btn.primary"); await settle(h);   // close
    await btn(h, h.T.polls.remoteReopenShort).click(); await settle(h);
    assert.equal(L.stateOf((await polls(h.w))[0]), "open", "reopened");
  } finally { await h.close(); }
});

test("poll: from a hunch to a running poll in one tap (Yes / No), or two words and one tap; a missing word is explained under its field", { skip }, async () => {
  const h = await open("poll-idle");
  try {
    await btn(h, "Yes / No").click(); await settle(h, 400);
    const p = (await polls(h.w))[0]; assert.deepEqual(p.choices.map((c) => c.text), ["Yes", "No"]);
    await h.page.click(".btn.primary"); await settle(h);   // close
    await h.page.click(".btn.primary"); await settle(h, 100);   // announce, still finished
    await btn(h, h.T.polls.dockNewPollShort).click(); await settle(h, 100);
    await h.page.fill('[data-in="id-polls:a"], input[name=a]', "Pizza");
    await h.page.click(".btn.primary"); await settle(h, 400);
    const err = h.page.locator(".fld .err:not([hidden])");
    assert.equal(await err.count(), 1, `the missing second choice is explained under its field: ${await err.evaluateAll((ns) => ns.map((n) => n.outerHTML + " <- " + n.parentElement.outerHTML.slice(0, 200)).join(" || "))}`);
    assert.equal(await h.page.locator("input[name=b]").getAttribute("aria-invalid"), "true");
    assert.equal(await h.page.evaluate(() => document.activeElement.name), "b", "the first field in error has the focus");
    assert.equal((await polls(h.w)).filter((x) => L.stateOf(x) === "open").length, 0, "nothing started");
    await h.page.fill("input[name=b]", "Pasta"); await h.page.click(".btn.primary"); await settle(h, 400);
    assert.equal((await polls(h.w)).filter((x) => L.stateOf(x) === "open").length, 1);
  } finally { await h.close(); }
});

test("draw: open with the word, draw, 'not here' asks to confirm then draws someone else, cancel asks to confirm", { skip, timeout: 30_000 }, async () => {
  const h = await open("draw-idle");
  try {
    await tab(h, "draw");
    await h.page.fill("input[name=keyword]", "!cadeau"); await h.page.click(".btn.primary"); await settle(h, 400);
    assert.equal((await D.current(h.w.aud)).keyword, "!cadeau");
    for (const n of ["etoile_nord", "lune_douce", "Camille", "brume_claire"]) await audDef.services["audience.draw"].enter(h.w.aud, { pseudo: n, platform: "twitch", login: n.toLowerCase() });
    await h.page.waitForTimeout(2300);   // the live poll brings the new count
    assert.equal(await h.page.locator(".word").innerText(), "!cadeau");
    await h.page.click(".btn.primary"); await settle(h, 400);
    const first = (await D.current(h.w.aud)).picked[0];
    assert.equal(await h.page.locator(".win").count(), 1);
    await h.page.click(".win"); await settle(h, 100);
    assert.match(await h.page.locator('[data-fk="confirm"]').innerText(), new RegExp(h.T.aud.drawNotHereLoss));
    assert.equal((await D.current(h.w.aud)).picked.length, 1, "nothing yet");
    await h.page.click('[data-fk="confirm"]'); await settle(h, 500);
    const d = await D.current(h.w.aud);
    assert.equal(d.picked.length, 2); assert.equal(d.picked[0].absent, true); assert.notEqual(d.picked[1].k, first.k);
    await btn(h, h.T.aud.drawBtnCancelShort).click(); await settle(h, 100);
    await h.page.click('[data-fk="confirm"]'); await settle(h, 500);
    assert.equal((await D.current(h.w.aud)).count, 0, "the list is emptied");
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test("chat: mute and unmute one tap; 'clear the room' asks to confirm and says what is lost", { skip, timeout: 30_000 }, async () => {
  const h = await open("chat");
  try {
    await tab(h, "chat");
    await h.page.selectOption("select", { index: 1 });
    await settle(h, 100);
    const name = (await h.page.locator(".pp .pn").first().innerText()).replace(/\s+/g, " ").trim();
    await h.page.locator(".pp button").first().click(); await settle(h, 500);
    assert.match(await msg(h).innerText(), new RegExp(name.split(" ")[0]));
    assert.ok(await h.page.locator(".pp .tag").count() >= 1, "the muted person carries a word, not only a colour");
    await btn(h, h.T.aud.remoteClear).click(); await settle(h, 100);
    assert.match(await h.page.locator('[data-fk="confirm"]').innerText(), new RegExp(h.T.aud.dockClearLoss));
    await h.page.click("button.undo");
    assert.ok(await h.page.locator(".pp").count() > 0, "nothing cleared by Undo");
  } finally { await h.close(); }
});

test("stop everything: reachable from every tab, Confirm / Undo, closes the poll and the draw, deletes nothing", { skip, timeout: 30_000 }, async () => {
  const h = await open("poll-run2");
  try {
    await D.openNew(h.w.aud, { title: "Sticker pack", keyword: "!x", level: "all", site: true, minutes: null, winners: 1 }, { now: Date.now() });
    for (const id of ["chat", "draw", "poll"]) {
      await tab(h, id);
      assert.equal(await h.page.locator("#panic").isVisible(), true, `the button is on the ${id} tab`);
    }
    await h.page.click("#panic"); await settle(h, 100);
    assert.equal(await h.page.locator(".armbar").count(), 1);
    await h.page.click("button.undo"); await settle(h, 100);
    assert.equal(L.stateOf((await polls(h.w))[0]), "open", "Undo: nothing stopped");
    await h.page.click("#panic"); await settle(h, 100); await h.page.click('.armbar [data-fk="confirm"]'); await settle(h, 600);
    assert.equal(L.stateOf((await polls(h.w))[0]), "closed"); assert.equal((await polls(h.w)).length, 1, "the poll is kept");
    assert.equal(D.stateOf(await D.current(h.w.aud)), "closed");
    assert.ok((await audit(h.w)).some((l) => l.what === "panic" && l.who === "remote"));
  } finally { await h.close(); }
});

test("keyboard (dock): letters act on the current tab and are shown as hints; Space is the main action; X arms, Escape undoes; digits change tab; S is stop everything", { skip, timeout: 30_000 }, async () => {
  const h = await open("poll-run2", { dock: true, viewport: [480, 900] });
  try {
    assert.ok(await h.page.locator("kbd").count() >= 3, "shortcut hints are on the buttons of the dock");
    await h.page.keyboard.press("x"); await settle(h, 100);
    assert.equal(await h.page.locator('[data-fk="confirm"]').count(), 1);
    await h.page.keyboard.press("Escape"); await settle(h, 100);
    assert.equal(await h.page.locator('[data-fk="confirm"]').count(), 0);
    await h.page.keyboard.press("2"); await settle(h, 100);
    assert.equal(await h.page.locator('[data-tab="draw"]').getAttribute("aria-selected"), "true");
    await h.page.keyboard.press("1"); await settle(h, 100);
    await h.page.keyboard.press("e"); await settle(h, 400);   // +30 s
    assert.ok(Date.parse((await polls(h.w))[0].endsAt) - Date.now() > 100_000);
    await h.page.keyboard.press("c"); await settle(h, 400);   // close
    assert.equal(L.stateOf((await polls(h.w))[0]), "closed");
    await h.page.keyboard.press("s"); await settle(h, 100);
    assert.equal(await h.page.locator(".armbar").count(), 1, "S arms the panic button");
    await h.page.keyboard.press("Escape");
    const phone = await open("poll-run2", { dock: false });
    try { assert.equal(await phone.page.locator("kbd").evaluateAll((ns) => ns.filter((n) => getComputedStyle(n).display !== "none").length), 0, "no shortcut hints on a touch screen"); } finally { await phone.close(); }
  } finally { await h.close(); }
});

test("lost connection: the strip says offline and retrying, an action is refused clearly (not queued), and the dock recovers by itself", { skip, timeout: 40_000 }, async () => {
  const h = await open("poll-run2");
  try {
    h.srv.down(true);
    await btn(h, "+30 s").click(); await settle(h, 300);
    assert.equal(await msg(h).innerText(), h.T.aud.dockNotSent);
    assert.equal((await polls(h.w)).length, 1);
    const before = Date.parse((await polls(h.w))[0].endsAt);
    await h.page.waitForSelector("#strip.bad", { timeout: 12_000 });
    assert.match(await h.page.locator("#msg").innerText(), /^⚠ .*\d/, "the offline line has a symbol, a word and the retry countdown (colour is not the only signal)");
    assert.equal(Date.parse((await polls(h.w))[0].endsAt), before, "the refused action was not replayed later");
    h.srv.down(false);
    await h.page.waitForSelector("#strip.ok", { timeout: 20_000 });
    assert.equal(await h.page.locator("#strip").getAttribute("class"), "strip ok");
  } finally { await h.close(); }
});

test("a hidden dock does not poll (Page Visibility); it refreshes at once when shown again; the secret is refused with a clear strip", { skip, timeout: 30_000 }, async () => {
  const h = await open("poll-idle");
  try {
    await settle(h, 300);
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    const n0 = h.hits.filter(([n]) => n === "remote-state").length;
    await h.page.waitForTimeout(6000);
    assert.equal(h.hits.filter(([n]) => n === "remote-state").length, n0, "no request while hidden");
    await h.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    await h.page.waitForTimeout(2500);
    assert.ok(h.hits.filter(([n]) => n === "remote-state").length > n0, "refreshed when shown again");
  } finally { await h.close(); }
});

test("accessibility: tablist roles, names on every control, live regions, visible focus, reduced motion respected", { skip, timeout: 30_000 }, async () => {
  const h = await open("poll-run2", { reduced: true });
  try {
    assert.equal(await h.page.locator('[role=tablist] [role=tab]').count(), 3);
    assert.equal(await h.page.locator('[role=tab][aria-selected=true]').count(), 1);
    const unnamed = await h.page.evaluate(() => [...document.querySelectorAll("button,input,select")].filter((n) => !(n.innerText || n.getAttribute("aria-label") || n.title || (n.labels && n.labels.length) || n.getAttribute("placeholder"))).length);
    assert.equal(unnamed, 0, "every control has a name");
    assert.ok(await h.page.locator('#strip[role=status][aria-live=polite], #sr[aria-live=polite]').count() >= 2);
    await h.page.keyboard.press("Tab"); await h.page.keyboard.press("Tab");
    const outline = await h.page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth));
    assert.ok(outline >= 2, `focus ring visible (${outline}px)`);
    await btn(h, h.T.polls.remoteCancelShort).click(); await settle(h, 100);
    assert.equal(await h.page.locator("button.arm").evaluate((n) => getComputedStyle(n, "::after").animationName), "none", "no countdown animation with reduced motion");
    assert.equal(await h.page.evaluate(() => document.documentElement.lang), "en");
  } finally { await h.close(); }
});

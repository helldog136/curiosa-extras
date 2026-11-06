// The bot panel of the remote control in a REAL browser (phone 390 px, OBS dock 300 and 360 px), served by Audience's own routes: the switch, the quick add, the undo, the errors.
// Skipped, loudly, where Chromium or Playwright is missing (see helpers/dockBrowser.mjs). Invented names only.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { remoteWorld, audDef } from "./helpers/botRemoteWorld.mjs";
import { say, fr as botFr, en as botEn } from "./helpers/botWorld.mjs";

const b = await browser();
after(() => closeBrowser());
const skip = b ? false : "Chromium or Playwright not available here: the bot panel browser tests did not run";
if (skip) console.error(`⚠ ${skip}`);

async function open({ locale = "en", dock = false, viewport = [390, 844], scheme = "light" } = {}) {
  const w = await remoteWorld({ locale });
  const srv = await serve(audDef, w.aud);
  const ctx = await b.newContext({ viewport: { width: viewport[0], height: viewport[1] }, colorScheme: scheme, locale: locale === "fr" ? "fr-FR" : "en-US" });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${srv.base}/m/audience/remote?k=${w.key}${dock ? "&dock=1" : ""}&scheme=${scheme}`);
  await page.waitForSelector(".tab");
  await page.click('[data-tab^="p:id-bot"]');
  await page.waitForSelector(".tg");
  return { w, page, srv, errors, T: locale === "fr" ? botFr : botEn, close: async () => { await ctx.close(); await srv.close(); } };
}
const fill = async (h, name, text) => { await h.page.fill('input[name="name"]', name); await h.page.fill('input[name="text"]', text); };
const submit = (h) => h.page.click(".gform .btn.primary");
const flat = (h) => h.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const box = (h, sel) => h.page.locator(sel).first().boundingBox();

test("the switch shows the state and really pauses, then resumes, the bot: it stops answering, then answers again", { skip }, async () => {
  const h = await open();
  try {
    const tg = h.page.locator(".tg");
    assert.deepEqual([await tg.getAttribute("role"), await tg.getAttribute("aria-checked")], ["switch", "true"]);
    assert.match(await tg.innerText(), /Bot answers[\s\S]*On, answering your chat/);
    await h.w.press("addcom", { name: "hello", text: "Welcome {utilisateur}" });
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "1", login: "camille", name: "Camille" })).result, "sent");
    await tg.click();
    await h.page.waitForSelector('.tg[aria-checked="false"]');
    assert.equal(await h.w.muted(), true);
    assert.match(await h.page.locator(".tg").innerText(), /Paused, silent in your chat/);
    assert.match(await h.page.locator("#msg").innerText(), /The bot is paused/);
    assert.match(await h.page.locator('[data-tab^="p:id-bot"]').innerText(), /Paused/, "the tab says it from the other tabs too");
    const before = h.w.tw.chat.length;
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "2", login: "lune_douce", name: "lune_douce" }, Date.now() + 500_000)).reason, "muted");
    assert.equal(h.w.tw.chat.length, before, "nothing written in the chat while paused");
    await h.page.locator(".tg").click();
    await h.page.waitForSelector('.tg[aria-checked="true"]');
    assert.equal(await h.w.muted(), false);
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "3", login: "etoile_nord", name: "etoile_nord" }, Date.now() + 900_000)).result, "sent");
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test("the switch shows 'in progress' at once, and when it fails says so in words under the switch, keeps the old state and can be pressed again", { skip }, async () => {
  const h = await open();
  try {
    const slow = h.w.bot.api.store.update.bind(h.w.bot.api.store), slowAdd = h.w.bot.api.store.add.bind(h.w.bot.api.store);
    let release; const gate = new Promise((r) => { release = r; });
    h.w.bot.api.store.update = async (...a) => { await gate; return slow(...a); }; h.w.bot.api.store.add = async (...a) => { await gate; return slowAdd(...a); };
    await h.page.locator(".tg").click();
    await h.page.waitForSelector('.tg[aria-busy="true"]');
    assert.match(await h.page.locator(".tg").innerText(), /Working…/, "feedback where the finger is");
    assert.equal(await h.page.locator(".tg").isDisabled(), true, "no double press while it works");
    release(); await h.page.waitForSelector('.tg[aria-checked="false"]');
    // now a failure
    h.w.bot.api.store.update = async () => { throw new Error("boom"); }; h.w.bot.api.store.add = async () => { throw new Error("boom"); };
    await h.page.locator(".tg").click();
    await h.page.waitForSelector(".tgw .err:not([hidden])");
    assert.equal(await h.page.locator(".tgw .err").innerText(), h.T.rc_e_switch);
    assert.doesNotMatch(await h.page.locator(".tgw .err").innerText(), /boom|Error|500/);
    assert.equal(await h.page.locator(".tg").getAttribute("aria-checked"), "false", "the state shown is the real one");
    assert.equal(await h.page.locator(".tg").isDisabled(), false);
    assert.equal(await h.page.evaluate(() => document.activeElement && document.activeElement.classList.contains("tg")), true, "focus is on the switch");
    assert.match(await h.page.locator("#msg").innerText(), /not changed/);
  } finally { await h.close(); }
});

test("quick add: two fields and one button; success clears the fields, confirms near the button, lists the command with an undo that really removes it", { skip }, async () => {
  const h = await open();
  try {
    assert.equal(await h.page.locator(".gform input").count(), 2);
    assert.equal(await h.page.locator(".gform .btn.primary").innerText(), "Add the command");
    assert.equal(await h.page.locator('input[name="name"]').getAttribute("placeholder"), "hello", "an example in each free field");
    assert.equal(await h.page.locator('input[name="text"]').getAttribute("placeholder"), "Welcome, make yourself at home");
    await fill(h, "Merch", "Shop: example.org/shop");
    await h.page.press('input[name="text"]', "Enter");   // the keyboard "Go" of a phone sends the form
    await h.page.waitForSelector(".grp");
    assert.deepEqual((await h.w.commands()).map((c) => [c.name, c.text, c.role, c.enabled]), [["merch", "Shop: example.org/shop", "everyone", true]]);
    assert.equal(await h.page.locator('input[name="name"]').inputValue(), "");
    assert.match(await h.page.locator("#msg").innerText(), /Command !merch added\./);
    assert.equal(await h.page.locator(".grp").innerText(), "Just added");
    assert.equal(await h.page.locator(".acts .btn").innerText(), "Delete !merch");
    assert.match(await h.page.locator(".note").innerText(), /Edit it in the administration/);
    await h.page.locator(".acts .btn").click();
    await h.page.waitForFunction(() => !document.querySelector(".grp"));
    assert.deepEqual(await h.w.commands(), []);
    assert.match(await h.page.locator("#msg").innerText(), /Command !merch deleted\./);
    assert.deepEqual(h.errors.filter((e) => !/status of 4\d\d/.test(e)), []);
  } finally { await h.close(); }
});

test("quick add errors: under the field, with an example, what was typed is kept, the cursor goes to the first field in error", { skip }, async () => {
  const h = await open();
  try {
    await h.w.press("addcom", { name: "hello", text: "Hi" });
    await h.page.waitForTimeout(100);
    await fill(h, "hello", "Something else"); await submit(h);
    await h.page.waitForSelector(".fld .err:not([hidden])");
    assert.match(await h.page.locator(".fld .err:not([hidden])").first().innerText(), /!hello is already used\. Pick another name, for example !hello2\./);
    assert.equal(await h.page.locator('input[name="name"]').inputValue(), "hello"); assert.equal(await h.page.locator('input[name="text"]').inputValue(), "Something else");
    assert.equal(await h.page.evaluate(() => document.activeElement && document.activeElement.name), "name");
    assert.equal(await h.page.locator('input[name="name"]').getAttribute("aria-invalid"), "true");
    await fill(h, "fine", "/ban me"); await submit(h);
    await h.page.waitForFunction(() => /cannot start with/.test(document.body.innerText));
    assert.equal(await h.page.evaluate(() => document.activeElement && document.activeElement.name), "text");
    assert.equal(await h.page.locator('input[name="name"]').inputValue(), "fine", "the name typed is kept");
    await fill(h, "x y", "ok"); await submit(h);
    await h.page.waitForFunction(() => /cannot be a name/.test(document.body.innerText));
    assert.deepEqual((await h.w.commands()).map((c) => c.name), ["hello"]);
  } finally { await h.close(); }
});

for (const [name, opts] of [["phone 390 px light", { viewport: [390, 844] }], ["phone 390 px dark", { viewport: [390, 844], scheme: "dark" }], ["dock 360 px dark", { viewport: [360, 640], dock: true, scheme: "dark" }], ["dock 300 px dark", { viewport: [300, 420], dock: true, scheme: "dark" }]]) {
  test(`layout, ${name}: no sideways scroll, targets of 44 px or more, switch / fields / button visible without scrolling, labels not cut`, { skip }, async () => {
    const h = await open(opts);
    try {
      await fill(h, "hello", "Welcome, make yourself at home, this is a rather long reply to check the field");
      assert.equal(await flat(h), true, "no horizontal scroll of the page");
      for (const sel of [".tg", '.gform input[name="name"]', '.gform input[name="text"]', ".gform .btn.primary"]) {
        const r = await box(h, sel);
        assert.ok(r.height >= 44 && r.width >= 44, `${sel}: ${r.width}x${r.height}`);
        assert.ok(r.x >= 0 && r.x + r.width <= opts.viewport[0] + 0.5, `${sel} inside the width`);
      }
      const stage = await h.page.locator("#stage").boundingBox(), go = await box(h, ".gform .btn.primary");
      assert.ok(go.y + go.height <= stage.y + stage.height + 1, "the main button is visible without scrolling");
      const cut = await h.page.evaluate(() => [...document.querySelectorAll(".tgl, .tgs, .ftl, .ttl, .btn .lb")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ": " + e.textContent));
      assert.deepEqual(cut, [], "no label is cut with an ellipsis");
      await h.page.evaluate(() => document.activeElement && document.activeElement.blur());   // the page does not redraw under a finger that is typing
      await h.w.press("addcom", { name: "one", text: "x" }); await h.w.press("pause");
      await h.page.waitForSelector(".grp", { timeout: 9000 });
      assert.equal(await flat(h), true);
      for (const sel of [".acts .btn"]) { const r = await box(h, sel); assert.ok(r.height >= 44, sel); }
    } finally { await h.close(); }
  });
}

test("in French the same panel says the same things with 'vous', and the words of the page come from the French files", { skip }, async () => {
  const h = await open({ locale: "fr" });
  try {
    assert.match(await h.page.locator(".tg").innerText(), /Réponses du bot[\s\S]*Actif, répond dans votre chat/);
    assert.equal(await h.page.locator(".gform .btn.primary").innerText(), "Ajouter la commande");
    await fill(h, "x y", "ok"); await submit(h);
    await h.page.waitForSelector(".fld .err:not([hidden])");
    assert.match(await h.page.locator(".fld .err:not([hidden])").first().innerText(), /« x y » ne peut pas servir de nom\. Utilisez des lettres et des chiffres, sans espace, par exemple bonjour\./);
  } finally { await h.close(); }
});

// The bot panel of the remote control in a REAL browser (phone 390 px, OBS dock 300 and 360 px), served by Audience's own routes: the switch, the quick add, the undo, the errors.
// Skipped, loudly, where Chromium or Playwright is missing (see helpers/dockBrowser.mjs). Invented names only.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { browser, closeBrowser, serve } from "./helpers/dockBrowser.mjs";
import { remoteWorld, audDef, S } from "./helpers/botRemoteWorld.mjs";
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
// Since 1.14.0 the panel has a second switch (collaboration mode): the emergency switch is the first one, its error field is "tg".
const PAUSE = '.tg[data-in$=":tg"]';
const fill = async (h, name, text) => { await h.page.fill('input[name="name"]', name); await h.page.fill('input[name="text"]', text); };
const submit = (h) => h.page.click(".gform .btn.primary");
const flat = (h) => h.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const box = (h, sel) => h.page.locator(sel).first().boundingBox();

test("the switch shows the state and really pauses, then resumes, the bot: it stops answering, then answers again", { skip }, async () => {
  const h = await open();
  try {
    const tg = h.page.locator(PAUSE);
    assert.deepEqual([await tg.getAttribute("role"), await tg.getAttribute("aria-checked")], ["switch", "true"]);
    assert.match(await tg.innerText(), /Bot answers[\s\S]*On, answering your chat/);
    await h.w.press("addcom", { name: "hello", text: "Welcome {utilisateur}" });
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "1", login: "camille", name: "Camille" })).result, "sent");
    await tg.click();
    await h.page.waitForSelector(PAUSE + '[aria-checked="false"]');
    assert.equal(await h.w.muted(), true);
    assert.match(await h.page.locator(PAUSE).innerText(), /Paused, silent in your chat/);
    assert.match(await h.page.locator("#msg").innerText(), /The bot is paused/);
    assert.match(await h.page.locator('[data-tab^="p:id-bot"]').innerText(), /Paused/, "the tab says it from the other tabs too");
    const before = h.w.tw.chat.length;
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "2", login: "lune_douce", name: "lune_douce" }, Date.now() + 500_000)).reason, "muted");
    assert.equal(h.w.tw.chat.length, before, "nothing written in the chat while paused");
    await h.page.locator(PAUSE).click();
    await h.page.waitForSelector(PAUSE + '[aria-checked="true"]');
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
    await h.page.locator(PAUSE).click();
    await h.page.waitForSelector(PAUSE + '[aria-busy="true"]');
    assert.match(await h.page.locator(PAUSE).innerText(), /Working…/, "feedback where the finger is");
    assert.equal(await h.page.locator(PAUSE).isDisabled(), true, "no double press while it works");
    release(); await h.page.waitForSelector(PAUSE + '[aria-checked="false"]');
    // now a failure
    h.w.bot.api.store.update = async () => { throw new Error("boom"); }; h.w.bot.api.store.add = async () => { throw new Error("boom"); };
    await h.page.locator(PAUSE).click();
    await h.page.waitForSelector(".tgw .err:not([hidden])");
    assert.equal(await h.page.locator(".tgw .err:not([hidden])").innerText(), h.T.rc_e_switch);
    assert.doesNotMatch(await h.page.locator(".tgw .err:not([hidden])").innerText(), /boom|Error|500/);
    assert.equal(await h.page.locator(PAUSE).getAttribute("aria-checked"), "false", "the state shown is the real one");
    assert.equal(await h.page.locator(PAUSE).isDisabled(), false);
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
      for (const sel of [PAUSE, '.gform input[name="name"]', '.gform input[name="text"]', ".gform .btn.primary"]) {
        const r = await box(h, sel);
        assert.ok(r.height >= 44 && r.width >= 44, `${sel}: ${r.width}x${r.height}`);
        assert.ok(r.x >= 0 && r.x + r.width <= opts.viewport[0] + 0.5, `${sel} inside the width`);
      }
      const stage = await h.page.locator("#stage").boundingBox(), go = await box(h, ".gform .btn.primary");
      // Since 1.15.0 the collaboration card carries its own choices (timers) and two folds: a short dock (up to 640 px high) needs one scroll to reach the quick-add button
      // (the two switches and the timers choice stay visible at the top); a phone screen shows everything without scrolling.
      if (opts.viewport[1] <= 640) {
        assert.ok(go.y + go.height <= stage.y + stage.height + 260, "the main button is at most one scroll away in a short dock");
        await h.page.locator(".gform .btn.primary").scrollIntoViewIfNeeded();
        const after = await box(h, ".gform .btn.primary"), st2 = await h.page.locator("#stage").boundingBox();
        assert.ok(after.y >= st2.y - 1 && after.y + after.height <= st2.y + st2.height + 1, "and it is fully visible once scrolled");
      } else assert.ok(go.y + go.height <= stage.y + stage.height + 1, "the main button is visible without scrolling");
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
    assert.match(await h.page.locator(PAUSE).innerText(), /Réponses du bot[\s\S]*Actif, répond dans votre chat/);
    assert.equal(await h.page.locator(".gform .btn.primary").innerText(), "Ajouter la commande");
    await fill(h, "x y", "ok"); await submit(h);
    await h.page.waitForSelector(".fld .err:not([hidden])");
    assert.match(await h.page.locator(".fld .err:not([hidden])").first().innerText(), /« x y » ne peut pas servir de nom\. Utilisez des lettres et des chiffres, sans espace, par exemple bonjour\./);
  } finally { await h.close(); }
});

/* ───────────── 1.15.0: the collaboration card (explanation, state, timers choice, folded options) ───────────── */

const CARD = '.tg[data-in$=":tg1"]';
const openCard = async (opts = {}) => { const h = await open(opts); await h.page.waitForSelector(CARD); return h; };
const own = (h) => h.page.locator(".tgw", { has: h.page.locator(CARD) });   // the collaboration card (the emergency switch has its own ? bubble)
const seg = (h, label) => h.page.locator(`.sgb`, { hasText: new RegExp(`^${label}$`) });
const cardText = (h) => h.page.locator(CARD).innerText();
const pseudo = async (h, sel, which) => h.page.evaluate(([s, w]) => getComputedStyle(document.querySelector(s), w).content, [sel, which]);

for (const [name, opts] of [["dock 280 px dark", { viewport: [280, 420], dock: true, scheme: "dark" }], ["dock 280 px light", { viewport: [280, 420], dock: true }], ["phone 390 px light", { viewport: [390, 844] }], ["phone 390 px dark", { viewport: [390, 844], scheme: "dark" }]]) {
  test(`collaboration card, ${name}: says what it does off and on, four choices of 44 px or more, no sideways scroll, no cut label, icon and text (not colour alone)`, { skip }, async () => {
    const h = await openCard(opts);
    try {
      assert.equal(await flat(h), true, "no horizontal scroll");
      const off = await cardText(h);
      assert.match(off, /Collaboration mode[\s\S]*Off — the bot talks as usual/);
      assert.doesNotMatch(await h.page.locator(".tgw", { has: h.page.locator(CARD) }).innerText(), /Commands still answer|Sharing a chat/, "no sentence of help under the switch: it is in the ? bubble");
      const q = own(h).locator(".qm"); const qb = await q.boundingBox();
      assert.ok(qb.width >= 44 && qb.height >= 44 && qb.x + qb.width <= opts.viewport[0] + 0.5, "the ? bubble is a 44 px target inside the width");
      assert.equal(await q.getAttribute("aria-expanded"), "false"); assert.match(await q.getAttribute("title"), /Commands typed by your viewers still get their answer/);
      assert.equal(await pseudo(h, CARD + " .tgs", "::before"), '"○ "', "off: an icon next to the words");
      const tr = h.page.locator(".tgw", { has: h.page.locator(CARD) });
      const segs = tr.locator(".tgc").first().locator(".sgb");
      assert.deepEqual(await segs.allInnerTexts(), ["Pause", "1 in 2", "1 in 3", "1 in 5"]);
      for (let i = 0; i < 4; i++) { const r = await segs.nth(i).boundingBox(); assert.ok(r.height >= 44 && r.width >= 44, `choice ${i}: ${r.width}x${r.height}`); assert.ok(r.x >= 0 && r.x + r.width <= opts.viewport[0] + 0.5); }
      const sw = await h.page.locator(CARD).boundingBox(); assert.ok(sw.height >= 44 && sw.x >= 0 && sw.x + sw.width <= opts.viewport[0] + 0.5);
      assert.equal(await segs.nth(2).getAttribute("aria-checked"), "true", "the default (1 in 3) is selected");
      // the off state is not drawn like a warning (the emergency switch, when paused, keeps its amber)
      const colours = await h.page.evaluate((sel) => { const c = getComputedStyle(document.querySelector(sel)); const w = getComputedStyle(document.documentElement).getPropertyValue("--cur-warn").trim(); return { border: c.borderTopColor, warn: w }; }, CARD);
      assert.notEqual(colours.border, colours.warn);
      // on: icon and words, the state line says exactly what is active
      await h.page.locator(CARD).click();
      await h.page.waitForSelector(CARD + '[aria-checked="true"]');
      assert.equal(await cardText(h).then((x) => x.split("\n").filter(Boolean).at(-1)), "✓ On — timers 1 in 3 — stops in 6 h".replace("✓ ", ""), "text");
      assert.equal(await pseudo(h, CARD + " .tgs", "::before"), '"✓ "', "on: a check mark and the words");
      assert.equal(await flat(h), true);
      const cut = await h.page.evaluate(() => [...document.querySelectorAll(".tgl, .tgs, .sgb, .seglab, .hint, .mo summary")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ": " + e.textContent));
      assert.deepEqual(cut, [], "no label is cut");
      assert.deepEqual(h.errors, []);
    } finally { await h.close(); }
  });
}

test("collaboration card: choose the timers before and while on; the state line follows; the choice is kept for next time; the folds keep their state", { skip }, async () => {
  const h = await openCard({ viewport: [280, 420], dock: true });
  try {
    await seg(h, "1 in 5").click();
    await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("1 in 5")');
    assert.match(await h.page.locator("#msg").innerText(), /Saved for next time you switch it on/);
    assert.equal((await S.readState(h.w.bot)).collab?.on === true, false, "choosing does not switch it on");
    await h.page.locator(CARD).click(); await h.page.waitForSelector(CARD + '[aria-checked="true"]');
    assert.match(await cardText(h), /On — timers 1 in 5 — stops in 6 h/);
    await seg(h, "Pause").click();
    await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("Pause")');
    assert.match(await cardText(h), /On — timers paused — stops in 6 h/);
    assert.match(await h.page.locator("#msg").innerText(), /Saved\. It applies now/);
    // the explanation and the automatic end are folded; a fold stays open when the panel is drawn again
    assert.equal(await h.page.locator(".mo").count(), 1);
    assert.equal(await h.page.locator(".mo[open]").count(), 0);
    await h.page.locator(".mo summary", { hasText: "More options" }).click();
    await h.page.locator('.sgb:text-is("2 h")').click();
    await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("2 h")');
    assert.match(await cardText(h), /On — timers paused — stops in 2 h/);
    assert.equal(await h.page.locator(".mo[open]").count(), 1, "still open after the redraw");
    assert.equal(await h.page.evaluate(() => document.activeElement && document.activeElement.textContent), "2 h", "focus stays on the choice");
    await h.page.locator('.sgb:text-is("Never")').click();
    await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("Never")');
    assert.match(await cardText(h), /On — timers paused — no automatic stop/);
    assert.equal(await own(h).locator(".mop:visible").count(), 0, "the explanation is closed");
    await own(h).locator(".qm").click();
    assert.match(await own(h).locator(".mop:visible").innerText(), /Commands typed by your viewers still get their answer/);
    assert.equal(await own(h).locator(".qm").getAttribute("aria-expanded"), "true");
    await seg(h, "1 in 2").click(); await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("1 in 2")');
    assert.equal(await own(h).locator(".mop:visible").count(), 1, "the bubble stays open when the panel is drawn again");
    await own(h).locator(".qm").click(); assert.equal(await own(h).locator(".mop:visible").count(), 0);
    assert.equal(await flat(h), true);
    // the tab says it, and the bot really behaves: a timer does not go out, a command still answers
    assert.match(await h.page.locator('[data-tab^="p:id-bot"]').innerText(), /Collab/);
    await h.w.press("addcom", { name: "hello", text: "Welcome" });
    assert.equal((await say(h.w.bot, "!hello", { chatterId: "1", login: "camille", name: "Camille" })).result, "sent", "commands still answer");
    // switch off: the choices stay
    await h.page.locator(CARD).click(); await h.page.waitForSelector(CARD + '[aria-checked="false"]');
    assert.match(await cardText(h), /Off — the bot talks as usual/);
    assert.equal(await h.page.locator('.sgb[aria-checked="true"]:text-is("1 in 2")').count(), 1, "the choices are remembered");
  } finally { await h.close(); }
});

test("collaboration card: when the save fails the words are under the switch, the old choice stays selected, and a new try works", { skip }, async () => {
  const h = await openCard({ viewport: [390, 844] });
  try {
    const upd = h.w.bot.api.store.update.bind(h.w.bot.api.store), add = h.w.bot.api.store.add.bind(h.w.bot.api.store);
    h.w.bot.api.store.update = async () => { throw new Error("boom"); }; h.w.bot.api.store.add = async () => { throw new Error("boom"); };
    await seg(h, "1 in 2").click();
    await h.page.waitForSelector(".tgw .err:not([hidden])");
    assert.equal(await h.page.locator(".tgw .err:not([hidden])").last().innerText(), h.T.rc_e_collab);
    assert.doesNotMatch(await h.page.locator(".tgw .err:not([hidden])").last().innerText(), /boom|Error|500/);
    assert.equal(await h.page.locator('.sgb[aria-checked="true"]:text-is("1 in 3")').count(), 1, "the real choice is still shown");
    h.w.bot.api.store.update = upd; h.w.bot.api.store.add = add;
    await seg(h, "1 in 2").click();
    await h.page.waitForSelector('.sgb[aria-checked="true"]:text-is("1 in 2")');
  } finally { await h.close(); }
});

test("in French the collaboration card says the same with 'vous' and short words", { skip }, async () => {
  const h = await openCard({ locale: "fr", viewport: [280, 420], dock: true });
  try {
    assert.match(await cardText(h), /Mode collaboration[\s\S]*Désactivé — le bot parle comme d'habitude/);
    assert.deepEqual(await h.page.locator(".tgc").first().locator(".sgb").allInnerTexts(), ["Pause", "1 sur 2", "1 sur 3", "1 sur 5"]);
    await h.page.locator(CARD).click(); await h.page.waitForSelector(CARD + '[aria-checked="true"]');
    assert.match(await cardText(h), /Activé — timers 1 sur 3 — s'arrête dans 6 h/);
    assert.equal(await flat(h), true);
    assert.deepEqual(await h.page.evaluate(() => [...document.querySelectorAll(".sgb, .tgs")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)), []);
  } finally { await h.close(); }
});

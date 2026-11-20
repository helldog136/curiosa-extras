// Content notebook 1.1.3: the links of the html blocks (tabs, cards, back link, pager) on a place page that another module may share one day ("calendar.notebook"
// is open to any module). The core gives each module a URL namespace there (`cp.col=doing`) and reads unprefixed parameters only for the sole contributor of the page.
// It rewrites the `?...` links written in block keys, never those inside a raw `html` block. Today the notebook is alone on its page; the flow below replays the core's
// own (placeScope) for both cases, so that a second contributor cannot break it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/content-planner", import.meta.url).pathname;
const def = (await import("../modules/content-planner/index.mjs")).default;
const { sectionQuery, scopeBlocks } = await import("@/core/modules/placeScope");
const KEY = "cp";
const makeCtx = () => {
  const c = fakeCtx({ key: KEY, moduleId: "content-planner", basePath: null, locale: "en", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")) });
  c.__plannerNow = "2026-10-22T10:00:00Z";
  return c;
};
const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("\n");
const linkTo = (blocks, pattern) => {
  const m = new RegExp(`<a [^>]*href="(\\?[^"]*)"[^>]*>${pattern}`).exec(htmlOf(blocks));
  assert.ok(m, `link ${pattern} not found`);
  return m[1].replace(/&amp;/g, "&");
};
/** What the core does on /admin/calendar/notebook: the address query goes through sectionQuery, the blocks through scopeBlocks. */
async function placePage(ctx, address, { sole }) {
  const pageQuery = Object.fromEntries(new URLSearchParams(address.replace(/^\?/, "")));
  return scopeBlocks(await def.adminPanel(ctx, { query: sectionQuery(pageQuery, KEY, sole) }), KEY);
}
const current = (blocks) => /class="cp-tab" href="[^"]*" aria-current="page">([^<]*)/.exec(htmlOf(blocks))?.[1];

for (const sole of [false, true]) {
  test(`place page (${sole ? "the notebook alone" : "shared with another module"}): the tabs, the cards and the back link keep their parameters`, async () => {
    const ctx = makeCtx();
    assert.ok((await def.adminActions.quickAdd(ctx, { quickTitle: "Autumn video" })).ok);
    const list = await placePage(ctx, "?", { sole });
    assert.equal(current(list), "Ideas");
    const doing = await placePage(ctx, linkTo(list, "In progress"), { sole });
    assert.equal(current(doing), "In progress", "the tab opens");
    const card = await placePage(ctx, /<a class="cp-card" href="(\?[^"]*)"/.exec(htmlOf(list))[1].replace(/&amp;/g, "&"), { sole });
    assert.ok(card.some((b) => b.type === "heading" && b.text === "Autumn video"), "the card opens the idea");
    const back = await placePage(ctx, linkTo(card, "← Back to “Ideas”"), { sole });
    assert.equal(current(back), "Ideas", "the back link returns to the list");
  });
}

test("the same links work on the module's own page, where the namespace comes back in the query, and as unprefixed bookmarks", async () => {
  const ctx = makeCtx();
  await def.adminActions.quickAdd(ctx, { quickTitle: "Autumn video" });
  const prefixed = Object.fromEntries(new URLSearchParams(linkTo(await def.adminPanel(ctx, { query: {} }), "In progress").replace(/^\?/, "")));
  assert.ok(Object.keys(prefixed).every((k) => k.startsWith(`${KEY}.`)), "the html links carry the namespace");
  assert.equal(current(await def.adminPanel(ctx, { query: prefixed })), "In progress", "own page, prefixed");
  assert.equal(current(await def.adminPanel(ctx, { query: { col: "doing" } })), "In progress", "unprefixed bookmark");
});

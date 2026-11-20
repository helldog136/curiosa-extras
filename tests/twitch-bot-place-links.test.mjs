// Twitch bot 1.24.4: the links of the panel's html blocks on a place page shared with other modules ("live.chat" is shared with the alerts and the YouTube chat actions).
// The core gives each module a URL namespace there (`bot.collab=1`) and reads unprefixed parameters for nobody; it rewrites the `?...` links written in block keys
// (`href`, `cancelHref`...), never those inside a raw `html` block. The "Set the mode" button, the "Add" buttons of the partner and network list and the timers
// "Add this timer" buttons used to reach the module without their parameters. The flow below is the core's own (placeScope). Invented names only.
import test from "node:test";
import assert from "node:assert/strict";
import { ownerWorld } from "./helpers/ownerSet.mjs";
import { dialogsOf } from "./helpers/ui.mjs";

const A = await import("../modules/twitch-bot/admin.mjs");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const { sectionQuery, scopeBlocks } = await import("@/core/modules/placeScope");

const KEY = "bot"; // the instance key of the test world: the namespace of its parameters on a place page
const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("\n");
const linkTo = (blocks, label) => {
  const m = new RegExp(`<a [^>]*href="(\\?[^"]*)"[^>]*>${label}<`).exec(htmlOf(blocks));
  assert.ok(m, `link "${label}" not found`);
  return m[1].replace(/&amp;/g, "&");
};

/** What the core does on /admin/live/chat: the address query goes through sectionQuery, the blocks through scopeBlocks. */
async function placePage(ctx, address, { sole }) {
  const pageQuery = Object.fromEntries(new URLSearchParams(address.replace(/^\?/, "")));
  return scopeBlocks(await def.adminPanel(ctx, { query: sectionQuery(pageQuery, KEY, sole) }), KEY);
}

for (const sole of [false, true]) {
  test(`place page (${sole ? "the bot alone" : "shared with other modules"}): the html buttons of the panel open their window`, async () => {
    const { ctx } = await ownerWorld({ locale: "en" });
    await A.actions.collabOn(ctx);
    const list = await placePage(ctx, "?", { sole });
    assert.equal(dialogsOf(list).length, 0, "the list is shown first, no window");
    // "Set the mode" (the status bar) opens the collaboration choices.
    const collab = await placePage(ctx, linkTo(list, "Set the mode"), { sole });
    assert.ok(collab.some((b) => b.type === "adminForm" && b.action === "collabSave"), "the choices window opens");
    // "Add" (the list of networks without a command) opens the command to create.
    const net = await placePage(ctx, linkTo(list, "Add"), { sole });
    assert.equal(dialogsOf(net).length, 1, "the command window of the network opens");
    // "Add this timer" (the list of commands that can repeat) opens that command.
    const timer = await placePage(ctx, linkTo(list, "Add this timer"), { sole });
    assert.equal(dialogsOf(timer).length, 1, "the command window of the timer opens");
  });
}

test("the same links work on the module's own page, where the namespace comes back in the query, and as unprefixed bookmarks", async () => {
  const { ctx } = await ownerWorld({ locale: "en" });
  await A.actions.collabOn(ctx);
  const own = await def.adminPanel(ctx, { query: {} });
  const prefixed = Object.fromEntries(new URLSearchParams(linkTo(own, "Set the mode").replace(/^\?/, "")));
  assert.ok(Object.keys(prefixed).every((k) => k.startsWith(`${KEY}.`)), "the html links carry the namespace");
  assert.ok((await def.adminPanel(ctx, { query: prefixed })).some((b) => b.type === "adminForm" && b.action === "collabSave"), "own page, prefixed");
  assert.ok((await def.adminPanel(ctx, { query: { collab: "1" } })).some((b) => b.type === "adminForm" && b.action === "collabSave"), "unprefixed bookmark");
});

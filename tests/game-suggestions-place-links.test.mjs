// Game suggestions 1.11.4: the links of the admin html blocks on a place page shared with other modules ("community.games" also holds the daily game and the covers).
// The core gives each module a URL namespace there (`gs.ajout=plusieurs`) and reads unprefixed parameters for nobody; it rewrites the `?...` links written in block keys
// (`href`, `cancelHref`...), never those inside a raw `html` block. "Add several games at once" used to show the same single-game form again. The flow below is the core's own (placeScope).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/game-suggestions", import.meta.url).pathname;
const def = (await import("../modules/game-suggestions/index.mjs")).default;
const { sectionQuery, scopeBlocks } = await import("@/core/modules/placeScope");
const KEY = "gs";
const ctx = () => fakeCtx({ key: KEY, basePath: "suggestions", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), locale: "en" });

const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("\n");
const linkTo = (blocks, label) => {
  const m = new RegExp(`<a [^>]*href="(\\?[^"]*)"[^>]*>${label}<`).exec(htmlOf(blocks));
  assert.ok(m, `link "${label}" not found`);
  return m[1].replace(/&amp;/g, "&");
};
const hasForm = (blocks, action) => blocks.some((b) => b.type === "adminForm" && b.action === action);
/** What the core does on /admin/community/games: the address query goes through sectionQuery, the blocks through scopeBlocks. */
async function placePage(c, address, { sole }) {
  const pageQuery = Object.fromEntries(new URLSearchParams(address.replace(/^\?/, "")));
  return scopeBlocks(await def.adminPanel(c, { query: sectionQuery(pageQuery, KEY, sole) }), KEY);
}

for (const sole of [false, true]) {
  test(`place page (${sole ? "game suggestions alone" : "shared with the daily game and the covers"}): "Add several games at once" opens the list form, its back link returns`, async () => {
    const c = ctx();
    const list = await placePage(c, "?", { sole });
    assert.ok(hasForm(list, "addGame") && !hasForm(list, "addGames"), "the single-game form is shown first");
    const many = await placePage(c, linkTo(list, "Add several games at once"), { sole });
    assert.ok(hasForm(many, "addGames") && !hasForm(many, "addGame"), "the list form opens");
    assert.ok(hasForm(await placePage(c, linkTo(many, "← Add a single game"), { sole }), "addGame"), "the back link shows the single-game form again");
  });
}

test("every parameter of an html link of the panel carries the namespace, so no other module is asked to read it", async () => {
  const c = ctx();
  await def.adminActions.addGame(c, { title: "Hollow Knight" });
  const [row] = await c.api.store.list("games", { limit: 10 });
  const cover = scopeBlocks(await def.adminPanel(c, { query: { jaquette: row.id } }), KEY);
  const links = [...htmlOf(cover).matchAll(/href="\?([^"]*)"/g)].flatMap((m) => m[1].replace(/&amp;/g, "&").split("&"));
  assert.ok(links.length >= 2, "the cover screen has its back link");
  assert.ok(links.every((p) => p.startsWith(`${KEY}.`)), `unprefixed: ${links.filter((p) => !p.startsWith(`${KEY}.`)).join(", ")}`);
});

test("the same links work on the module's own page, where the namespace comes back in the query, and as unprefixed bookmarks", async () => {
  const c = ctx();
  const own = await def.adminPanel(c, { query: {} });
  const prefixed = Object.fromEntries(new URLSearchParams(linkTo(own, "Add several games at once").replace(/^\?/, "")));
  assert.ok(hasForm(await def.adminPanel(c, { query: prefixed }), "addGames"), "own page, prefixed");
  assert.ok(hasForm(await def.adminPanel(c, { query: { ajout: "plusieurs" } }), "addGames"), "unprefixed bookmark");
});

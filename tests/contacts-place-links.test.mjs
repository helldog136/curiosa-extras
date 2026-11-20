// Contacts 2.7.1 — the "Add a person" button (and every other link of the panel) on a place page shared with another module.
// The contact form puts its own section on the same page (community.contacts), so the core gives each module a URL namespace and reads unprefixed parameters
// for nobody. The core rewrites only the `?...` links written in block keys (`href`, `cancelHref`...), never those inside a raw `html` block: the panel's
// links used to reach the module without their parameters, and the click just showed the list again. The flow below is the core's own (placeScope).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const DIR = new URL("../modules/contacts", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const def = (await import("../modules/contacts/index.mjs")).default;
const { sectionQuery, scopeBlocks } = await import("@/core/modules/placeScope");

const makeCtx = (locale = "en") => {
  const c = fakeCtx({ moduleId: "contacts", key: "contacts", locale, messages: readJson(`locales/${locale}.json`) });
  c.api.store = memStore();
  c.can = () => true;
  return c;
};
const htmlOf = (blocks) => blocks.map((b) => b.html ?? "").join("");
const linkTo = (blocks, label) => {
  const m = new RegExp(`<a [^>]*href="(\\?[^"]*)"[^>]*>(?:<[^>]+>)*${label}<`).exec(htmlOf(blocks));
  assert.ok(m, `link "${label}" not found`);
  return m[1].replace(/&amp;/g, "&");
};

/** What the core does on /admin/community/contacts: the address query goes through sectionQuery, the blocks through scopeBlocks. */
async function placePage(ctx, address, { sole }) {
  const pageQuery = Object.fromEntries(new URLSearchParams(address.replace(/^\?/, "")));
  const query = sectionQuery(pageQuery, "contacts", sole);
  return scopeBlocks(await def.adminPanel(ctx, { query }), "contacts");
}
const hasForm = (blocks, action) => blocks.some((b) => b.type === "adminForm" && b.action === action);

for (const sole of [false, true]) {
  test(`place page (${sole ? "contacts alone" : "shared with the contact form"}): "Add a person" opens the form, the navigation and the list links keep their parameters`, async () => {
    const ctx = makeCtx();
    const list = await placePage(ctx, "?", { sole });
    assert.ok(!hasForm(list, "addVia"), "the list is shown first");
    assert.ok(hasForm(await placePage(ctx, linkTo(list, "\\+ Add a person"), { sole }), "addVia"), "the button opens the add form");
    const orgs = await placePage(ctx, linkTo(list, "Organisations"), { sole });
    assert.ok(hasForm(await placePage(ctx, linkTo(orgs, "\\+ Add an organisation"), { sole }), "save"), "the organisation button opens the manual form");
    assert.ok(hasForm(await placePage(ctx, linkTo(list, "Categories"), { sole }), "createCategory"), "the Categories tab opens the categories page");
    // From the add form, the "Add by hand" tab opens the manual form.
    const via = await placePage(ctx, linkTo(list, "\\+ Add a person"), { sole });
    assert.ok(hasForm(await placePage(ctx, linkTo(via, "Add by hand"), { sole }), "save"));
  });
}

test("a bookmark or another module's link with unprefixed parameters still works on the module's own page and on a page it holds alone", async () => {
  const ctx = makeCtx();
  assert.ok(hasForm(await def.adminPanel(ctx, { query: { new: "person" } }), "addVia"));
  assert.ok(hasForm(await placePage(ctx, "?new=person", { sole: true }), "addVia"));
});

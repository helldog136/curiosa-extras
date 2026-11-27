// R35 (core ADR 0011): a task, a shortcut or a card that leads to a page of the core declares the right that page asks for.
// Blog and Pages open /admin/entries/new, a page of the Editor level: their shortcut is declared with the module right `write` (Administration by default, so who sees it does not change; Editor
// keeps the core's own « Add » button), a right the page can be opened with, instead of the unstated default (the right to open the module). The kit advice `dashboard.coreLinkRight` stays quiet.
import test from "node:test";
import assert from "node:assert/strict";
import { readManifests } from "../scripts/rules.mjs";
import path from "node:path";

const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const manifests = readManifests(root);
const CORE_LINK = /^\/admin(\/|\?|$)/;

test("every dashboard contribution that leads to a core page declares a right of the module", () => {
  const bad = [];
  for (const [id, m] of Object.entries(manifests)) {
    for (const kind of ["tasks", "quickActions", "cards"]) {
      for (const it of m.dashboard?.[kind] ?? []) {
        if (typeof it.href === "string" && CORE_LINK.test(it.href) && !it.href.startsWith("/admin/instances/") && !it.right) bad.push(`${id}.${kind}.${it.id} → ${it.href}`);
        if (it.right && !["open", "history", ...(m.rights ?? []).map((r) => r.id)].includes(it.right)) bad.push(`${id}.${kind}.${it.id}: right « ${it.right} » is not declared`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("Blog and Pages: the shortcut needs the right `write` (Administration only, as the shortcut was before: the Editor keeps the core's own « Add » button) and leads to the entry form", () => {
  for (const id of ["blog", "pages"]) {
    const m = manifests[id];
    const [action] = m.dashboard.quickActions;
    assert.match(action.href, /^\/admin\/entries\/new\?c=\{key\}$/, id);
    assert.equal(action.right, "write", id);
    const right = m.rights.find((r) => r.id === "write");
    assert.deepEqual(right.default, { admin: true, editor: false }, id);
    assert.ok(right.label.en && right.label.fr && right.help.en && right.help.fr, `${id}: EN and FR texts`);
    assert.ok(!right.sensitive, id);
  }
});

test("Calendar: the shortcut leads to the module's own page, so it needs no right", () => {
  const [action] = manifests["calendar-manual"].dashboard.quickActions;
  assert.match(action.href, /^\?tab=/);
  assert.equal(action.right, undefined);
});

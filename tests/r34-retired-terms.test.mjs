// R34 on the modules (docs/ERGONOMIE-ADMIN.md, core ADR 0011): « module » is the only word for a piece installed from the catalogue.
// Every FR and EN text shown to people (manifest `{ fr, en }` strings and locales/en.json, locales/fr.json of each module) is scanned for: extension, plugin, add-on, feature / fonctionnalité.
// ALLOWED: a text that keeps a retired word because the word means something else there. It starts EMPTY and each line must say why;
// a line whose text no longer holds the word fails (remove it). It never grows silently: a new line is a reviewed decision.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { retiredTerms, moduleTexts } from "./helpers/retiredTerms.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const ids = fs.readdirSync(path.join(root, "modules")).filter((d) => fs.existsSync(path.join(root, "modules", d, "module.json"))).sort();

/** `module | text id` -> why this text may keep a retired word. */
const ALLOWED = new Map([]);

test("R34: no retired term in a visible text of a module (extension, plugin, add-on, fonctionnalité, feature)", () => {
  const found = [];
  for (const id of ids) for (const t of moduleTexts(path.join(root, "modules", id))) {
    if (ALLOWED.has(`${id} | ${t.id}`)) continue;
    const hits = retiredTerms(t.text, t.lang);
    if (hits.length) found.push(`${id} | ${t.id} [${t.lang}]: ${hits.join(", ")}: ${t.text.slice(0, 90)}`);
  }
  assert.deepEqual(found, [], "write « module » (R34), or justify the text in ALLOWED");
});

test("R34: every allowed text still exists and still holds a retired word (the list does not rot)", () => {
  for (const [key, why] of ALLOWED) {
    assert.ok(why.length > 20, `${key}: say why`);
    const [id, textId] = key.split(" | ");
    const t = moduleTexts(path.join(root, "modules", id)).find((x) => x.id === textId);
    assert.ok(t, `${key} is gone: remove it from ALLOWED`);
    assert.ok(retiredTerms(t.text, t.lang).length > 0, `${key} no longer holds a retired word: remove it from ALLOWED`);
  }
});

test("R34: the checker sees the retired words and spares the lookalikes", () => {
  assert.deepEqual(retiredTerms("Une extension installée", "fr"), ["extension"]);
  assert.deepEqual(retiredTerms("Cette fonctionnalité", "fr"), ["fonctionnalite"]);
  assert.deepEqual(retiredTerms("Install the add-on or the plugin", "en"), ["add-on", "plugin"]);
  assert.deepEqual(retiredTerms("A new feature", "en"), ["feature"]);
  assert.deepEqual(retiredTerms("Featured (shown first)", "en"), []);
  assert.deepEqual(retiredTerms("Un module installé", "*"), []);
});

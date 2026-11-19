// Pages 1.3.0: the "skin" feature ("Skin for this page"). The module only declares it; the core draws the select, checks the value and renders the page.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseManifest } from "@/core/modules/manifest";

const ROOT = new URL("..", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const manifest = readJson("modules/pages/module.json");

test("Pages declares the skin feature and needs the core that knows it", () => {
  assert.equal(manifest.version, "1.3.0");
  assert.equal(manifest.minCore, "0.45.0", "an older core cannot read the feature: it keeps the previous Pages");
  assert.deepEqual(manifest.content.features, ["cover", "summary", "body", "skin"]);
  const parsed = parseManifest(manifest);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.ok(parsed.manifest.content.features.includes("skin"));
});

test("Pages adds no field, setting or script of its own for it (core bricks only)", () => {
  assert.deepEqual(manifest.settings, []);
  assert.ok(!("fieldSchema" in manifest.content) || manifest.content.fieldSchema.length === 0);
  assert.ok(!fs.existsSync(path.join(ROOT, "modules/pages/index.mjs")));
});

test("the catalogue entry and the README are in step with the manifest", () => {
  const entry = readJson("catalogue/index.json").modules.find((m) => m.id === "pages");
  assert.equal(entry.version, "1.3.0");
  assert.equal(entry.requires?.core, "0.45.0");
  const readme = fs.readFileSync(path.join(ROOT, "modules/pages/README.md"), "utf8");
  assert.match(readme, /Skin de cette page/);
  assert.match(readme, /Skin for this page/);
});

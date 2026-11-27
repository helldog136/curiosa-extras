// Twitch activity (twitch-events) takes a place on the Twitch page of the Networks group (admin redesign, E3, decision D11): Networks > Twitch > Activity.
// It stays a partial placement: the journal and the event types move to the place page, the rewards and the OBS dock stay on the module's own page, so the module keeps
// its sidebar entry and its legacy `adminMenu` (a core older than 0.31.0 ignores `places` and shows the module exactly where it was).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readManifests } from "../scripts/rules.mjs";

const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const vocabFile = JSON.parse(fs.readFileSync(path.join(root, "catalogue/places.json"), "utf8"));
const manifests = readManifests(root);
const m = manifests["twitch-events"];
let P = null;
try { P = await import("@/core/modules/places"); } catch { /* core older than 0.31.0 */ }
const noCore = P ? false : "the tested core has no places (0.31.0 or later)";

test("twitch-events: two sections on Networks > Twitch > Activity, the legacy menu entry and the minimum core untouched", () => {
  assert.deepEqual(m.places.map((p) => [p.id, p.place, p.fromTab]), [["events", "networks.twitch.events", "settings"], ["types", "networks.twitch.events", "types"]]);
  assert.equal(m.adminMenu, "Réseaux.Twitch", "an older core keeps the module where it was");
  assert.equal(m.adminMenuOrder, 40);
  assert.equal(m.minCore, "0.36.0", "no new core brick is used");
  assert.equal(m.place, undefined, "full form only");
  assert.ok(m.tabs.every((t) => t.place === undefined), "never tabs[].place: a core older than 0.31.0 refuses it");
  for (const p of m.places) assert.ok(p.order >= 100 && p.order <= 999, p.id);
});

test("vocabulary: the Twitch page has a Channel tab (the sections of the connector and the channel) before the Activity tab, EN and FR", () => {
  const page = vocabFile.pages.find((p) => p.id === "networks.twitch");
  assert.deepEqual(page.tabs.map((t) => t.id), ["main", "events"], "main first: a section without tab goes to the first tab of the vocabulary");
  for (const t of page.tabs) for (const lang of ["en", "fr"]) assert.ok(t[lang] && t[lang].length <= 40, `${t.id}: ${lang}`);
});

test("core: the page Networks > Twitch shows the connector and the channel on Channel, and Twitch activity on Activity", { skip: noCore }, async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const vocab = P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary(vocabFile));
  const parsed = parseManifest(m);
  assert.ok(parsed.ok, parsed.error);
  assert.deepEqual(P.placeIssues(parsed.manifest, vocab), [], "places valid against the vocabulary in force");
  const contribs = ["twitch-connector", "twitch-channel", "twitch-events"].flatMap((id) => {
    const man = parseManifest(manifests[id]).manifest;
    return P.moduleSections(man, vocab.aliases).filter((s) => P.pageId(s.place) === "networks.twitch").map((section) => ({ instanceId: id, instanceKey: id, moduleId: id, moduleName: man.name.en, instanceLabel: man.name.en, siblings: false, connector: id === "twitch-connector", section, visible: true }));
  });
  const page = P.findPage(P.buildPlaceIndex(contribs, vocab, "en"), "networks", "twitch");
  assert.deepEqual(page.tabs.map((t) => [t.title, t.sections.map((s) => `${s.moduleId}.${s.section.id}`)]), [
    ["Channel", ["twitch-connector.main", "twitch-channel.main"]],
    ["Activity", ["twitch-events.events", "twitch-events.types"]],
  ]);
});

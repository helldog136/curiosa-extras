// Admin menu placement (manifest keys `adminMenu`, `adminMenuOrder`, `adminMenuLabels`, core 0.13.0; an older core ignores them).
// 1. Every manifest of the repository declares a valid path, order and labels (same rules as the core's validator).
// 2. The network modules declare exactly the expected place, and nothing else declares a path (a small table).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const manifests = Object.fromEntries(
  fs.readdirSync(path.join(root, "modules")).filter((id) => fs.existsSync(path.join(root, "modules", id, "module.json")))
    .map((id) => [id, JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8"))])
);

// The core's own parser when the tested core has it (0.13.0 and later); the checks below do not depend on it.
let core = null;
try { core = await import("@/core/modules/menuPath"); } catch { /* older core */ }

// Where each network module sits: [path, order]. The order is undefined when the module keeps the default (100).
// Twitch reads as the stream goes: connection, channel, activity, alerts, bot, raid.
// Live status shows Twitch AND YouTube lives: it sits in Networks itself, above the network groups, not inside Twitch.
const EXPECTED = {
  "twitch-connector": ["Réseaux.Twitch", 10],
  "twitch-channel": ["Réseaux.Twitch", 20],
  "live-status": ["Réseaux", undefined],
  "twitch-events": ["Réseaux.Twitch", 40],
  "alerts-overlay": ["Réseaux.Twitch", 50],
  "twitch-bot": ["Réseaux.Twitch", 60],
  "twitch-raid": ["Réseaux.Twitch", 70],
  "discord": ["Réseaux.Discord", 10],
  "discord-announcer": ["Réseaux.Discord", undefined],
  "youtube-connector": ["Réseaux.YouTube", 10],
  "youtube-channel": ["Réseaux.YouTube", 20],
  "youtube-live-actions": ["Réseaux.YouTube", undefined],
};
// Content modules that sit in a core section by path (a path of one segment: the section itself). Links is a list of links that open elsewhere:
// without a path the core files it under "Only in Extensions", where nobody looks for it (2026-11).
const SECTION_PATHS = { links: "Contenu" };
const RESERVED_ROOTS = ["site", "admin", "administration", "account", "compte"];

test("every adminMenu, adminMenuOrder and adminMenuLabels of the repository is valid", () => {
  for (const [id, m] of Object.entries(manifests)) {
    if (m.adminMenu !== undefined) {
      assert.equal(typeof m.adminMenu, "string", `${id}: adminMenu is a string`);
      assert.ok(m.adminMenu.length >= 1 && m.adminMenu.length <= 120, `${id}: adminMenu length`);
      const parts = m.adminMenu.split(".").map((p) => p.trim());
      assert.ok(parts.length >= 1 && parts.length <= 3, `${id}: 1 to 3 segments`);
      assert.ok(parts.every((p) => p !== "" && p.length <= 40), `${id}: no empty or long segment`);
      const first = parts[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      assert.ok(!RESERVED_ROOTS.includes(first), `${id}: root belongs to the core`);
      if (core) assert.ok(core.parseMenuPath(m.adminMenu), `${id}: the core accepts "${m.adminMenu}"`);
    }
    if (m.adminMenuOrder !== undefined) {
      assert.ok(Number.isInteger(m.adminMenuOrder) && m.adminMenuOrder >= 0 && m.adminMenuOrder <= 999, `${id}: adminMenuOrder is an integer from 0 to 999`);
      assert.ok(m.adminMenu !== undefined, `${id}: an order without a path does nothing`);
    }
    if (m.adminMenuLabels !== undefined) {
      assert.ok(m.adminMenuLabels && typeof m.adminMenuLabels === "object" && !Array.isArray(m.adminMenuLabels), `${id}: adminMenuLabels is an object`);
      const keys = Object.keys(m.adminMenuLabels);
      assert.ok(keys.length <= 6, `${id}: 6 groups at most`);
      for (const k of keys) {
        assert.match(k, /^[a-z0-9][a-z0-9-]{0,23}$/, `${id}: group id "${k}"`);
        for (const [lang, text] of Object.entries(m.adminMenuLabels[k])) {
          assert.ok(["en", "fr"].includes(lang) && typeof text === "string" && text.length >= 1 && text.length <= 40, `${id}: label ${k}.${lang}`);
        }
      }
    }
  }
});

test("the network modules declare exactly the expected menu place", () => {
  for (const [id, [menu, order]] of Object.entries(EXPECTED)) {
    assert.ok(manifests[id], `${id} exists`);
    assert.equal(manifests[id].adminMenu, menu, `${id}: adminMenu`);
    assert.equal(manifests[id].adminMenuOrder, order, `${id}: adminMenuOrder`);
    assert.equal(manifests[id].adminMenuLabels, undefined, `${id}: Twitch, Discord and YouTube are known groups, no labels needed`);
  }
});

test("a module under a network group is about that network only (a module for several networks sits in Networks itself)", () => {
  // `platform` of the module, or the networks it reads: a module that needs both Twitch and YouTube services is not a Twitch module.
  const NETWORK_SERVICES = { twitch: /^twitch\./, youtube: /^youtube\./, discord: /^discord\./ };
  for (const [id, m] of Object.entries(manifests)) {
    if (!m.adminMenu) continue;
    const parts = m.adminMenu.split(".").map((p) => p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    const reads = Object.entries(NETWORK_SERVICES).filter(([, re]) => (m.requires ?? []).some((r) => re.test(r.service))).map(([n]) => n);
    if (reads.length > 1) assert.equal(parts.length, 1, `${id} reads ${reads.join(" and ")}: it belongs in Networks, not in one network group`);
  }
});

test("no other module declares a menu path (profile-link modules and tools keep their section)", () => {
  const others = Object.entries(manifests).filter(([id, m]) => !(id in EXPECTED) && !(id in SECTION_PATHS) && (m.adminMenu !== undefined || m.adminMenuOrder !== undefined || m.adminMenuLabels !== undefined)).map(([id]) => id);
  assert.deepEqual(others, []);
});

test("inside Twitch the order reads: connection, channel, activity, alerts, bot, raid; a module keeps its section as a fallback for an older core", () => {
  const twitch = Object.entries(EXPECTED).filter(([, [menu]]) => menu === "Réseaux.Twitch").sort((a, b) => a[1][1] - b[1][1]).map(([id]) => id);
  assert.deepEqual(twitch, ["twitch-connector", "twitch-channel", "twitch-events", "alerts-overlay", "twitch-bot", "twitch-raid"]);
  // An old core ignores the path and still uses menuGroup: keep it where it already was.
  assert.equal(manifests["twitch-raid"].menuGroup, "tools");
  assert.equal(manifests["live-status"].menuGroup, "tools");
  assert.equal(manifests["discord-announcer"].menuGroup, "connections");
});

test("with the core's tree builder, the entries land once, in the expected groups and order", { skip: !core }, () => {
  const items = Object.entries(EXPECTED).map(([id, [menu, order]]) => ({
    id, moduleId: id, name: manifests[id].name.en, badge: 0, error: false, placement: "menu",
    menuPath: core.parseMenuPath(menu), menuOrder: order ?? 100, connector: manifests[id].type === "integration", groupLabels: {},
  }));
  for (const locale of ["en", "fr"]) {
    const tree = core.buildMenuTree(items, locale);
    assert.equal(tree.groups.length, 1, "one Networks group");
    const nets = tree.groups[0];
    assert.equal(nets.title, locale === "fr" ? "Réseaux" : "Networks");
    assert.deepEqual(nets.children.map((c) => c.title), ["Twitch", "YouTube", "Discord"].sort((a, b) => core.KNOWN_GROUPS.findIndex((g) => g.en === a) - core.KNOWN_GROUPS.findIndex((g) => g.en === b)));
    const ofGroup = (t) => nets.children.find((c) => c.title === t).entries.map((e) => e.id);
    assert.deepEqual(ofGroup("Twitch"), ["twitch-connector", "twitch-channel", "twitch-events", "alerts-overlay", "twitch-bot", "twitch-raid"]);
    assert.deepEqual(nets.entries.map((e) => e.id), ["live-status"], "Live status (Twitch and YouTube) sits in Networks itself, before the network groups");
    assert.deepEqual(ofGroup("Discord"), ["discord", "discord-announcer"]);
    assert.deepEqual(ofGroup("YouTube"), ["youtube-connector", "youtube-channel", "youtube-live-actions"]);
    assert.equal(nets.count, items.length, "each entry appears once");
  }
});

test("Links declares the Content section as its menu path, so it is in the sidebar by default (it was only in Extensions)", () => {
  for (const [id, menu] of Object.entries(SECTION_PATHS)) {
    assert.equal(manifests[id].adminMenu, menu, `${id}: adminMenu`);
    assert.equal(manifests[id].menuGroup, "content", `${id}: menuGroup stays the fallback of an older core`);
    assert.equal(manifests[id].adminMenuOrder, undefined, `${id}: default order`);
  }
});

test("a list of links that open elsewhere is pinned to the menu by default, in Content, next to Blog and Pages", { skip: !core }, async () => {
  const place = await import("@/core/modules/menuPlacement");
  const links = manifests.links;
  assert.equal(place.defaultPlacement(links), "menu");
  assert.equal(place.resolvePlacement(links, undefined), "menu", "nothing chosen yet: the default");
  assert.equal(place.resolvePlacement(links, "integrations"), "integrations", "a choice stored by the person still wins");
  assert.equal(place.defaultSection(links), "content");
  // The same manifest without the path is the trap: the core's rule files a links list under Extensions.
  const { adminMenu, ...bare } = links;
  assert.equal(place.defaultPlacement(bare), "integrations");
  const tree = core.buildMenuTree([
    { id: "links", moduleId: "links", name: links.name.fr, badge: 0, error: false, placement: "menu", menuPath: core.parseMenuPath(links.adminMenu), menuOrder: 100, groupLabels: {} },
  ], "fr");
  assert.deepEqual(Object.keys(tree.sections), ["content"]);
  assert.deepEqual(tree.sections.content.entries.map((e) => e.id), ["links"]);
  assert.equal(tree.groups.length, 0, "no new group: it joins the Content section");
});

test("two entries of the admin menu never share a name or a first word (R12): the label of Links is unique", () => {
  const firstWord = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s'’-]+/)[0];
  for (const lang of ["en", "fr"]) {
    const clash = Object.entries(manifests).filter(([id, m]) => id !== "links" && firstWord(m.name[lang]) === firstWord(manifests.links.name[lang])).map(([id]) => id);
    assert.deepEqual(clash, [], `${lang}: no module starts with "${firstWord(manifests.links.name[lang])}"`);
  }
});

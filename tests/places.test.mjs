// PLACES (core 0.31.0, docs/PLACES.md of the core): where our modules put their settings and lists in the admin, written `group.page[.tab]`.
// 1. catalogue/places.json, the vocabulary read by the core with the catalogue: complete, EN+FR, R1 intros, R12 names, read without loss by the core.
// 2. places.known: our modules only use places of the vocabulary (with the core's own pages) or places they define inline (`define`).
// 3. Dual mode: the migrated modules use `places[].fromTab` only, so an older core sees exactly the manifest of before (adminMenu kept, minCore unchanged).
// 4. On core 0.31.0 they place everything they show (each setting once, every panel), pass the kit, and the four live sites get the menus below.
// 5. Rollout: every module with settings or an admin panel is migrated (the Twitch cluster in 1.96.0, the rest in 1.100.0), except the few listed in NOT_PLACED with their reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { manifestsAt, placesOf, readManifests } from "../scripts/rules.mjs";

const root = path.resolve(process.env.CURIOSA_EXTRAS_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const core = path.resolve(process.env.CURIOSA_DIR ?? process.cwd());
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const vocabFile = read("catalogue/places.json");
const manifests = readManifests(root);

// The core's pure places rules (0.31.0 and later). An older core has none: the checks that need it are skipped, the others run.
let P = null;
try { P = await import("@/core/modules/places"); } catch { /* core older than 0.31.0 */ }
let M = null;
try { M = await import("@/core/modules/menuPath"); } catch { /* core older than 0.13.0 */ }
const noCore = P ? false : "the tested core has no places (0.31.0 or later)";
const vocab = P ? P.mergeVocabulary(P.BUILTIN_VOCABULARY, P.sanitizeVocabulary(vocabFile)) : null;

/** The Twitch cluster (1.96.0): version after migration, and the sections each one declares (id → place). */
const TWITCH = {
  "alerts-overlay": ["1.22.1", { events: "live.alerts.events", rules: "live.alerts.rules", voice: "live.alerts.voice", media: "live.chat.media", rewards: "live.rewards" }],
  "twitch-bot": ["1.24.1", { commands: "live.chat.commands", timers: "live.chat.timers", rewards: "live.rewards" }],
  "home-assistant": ["1.4.1", { main: "live.rewards.home" }],
  "twitch-connector": ["1.8.0", { main: "networks.twitch" }],
  "twitch-channel": ["2.6.0", { main: "networks.twitch", stats: "networks.stats" }],
  "twitch-raid": ["2.6.3", { list: "live.raid.list", featured: "live.raid.featured" }],
};
/** Every other module with settings or an admin panel (1.100.0): version after migration, and its sections (id → place). */
const ROLLOUT = {
  "audience": ["1.12.1", { rooms: "live.participation.rooms", nicknames: "live.participation.rooms", draw: "live.participation.draw" }],
  "bandcamp": ["1.2.1", { main: "networks.accounts" }],
  "bluesky": ["1.3.1", { main: "networks.accounts", stats: "networks.stats" }],
  "calendar-ical": ["1.2.1", { sources: "calendar.schedule.sources" }],
  "calendar-manual": ["1.3.1", { streams: "calendar.schedule.streams" }],
  "commissions": ["1.1.2", { main: "community.commissions", packages: "community.commissions.packages" }],
  "community-stats": ["1.4.2", { main: "networks.stats" }],
  "contact-form": ["1.1.1", { form: "community.contacts.form" }],
  "contacts": ["2.6.2", { main: "community.contacts" }],
  "content-planner": ["1.1.2", { main: "calendar.notebook" }],
  "countdown": ["1.4.2", { main: "calendar.countdowns" }],
  "daily-game": ["1.2.2", { daily: "community.games.daily", packs: "community.games.daily" }],
  "directory": ["1.2.2", { main: "content.directory" }],
  "discord-announcer": ["1.4.0", { main: "networks.discord", golive: "live.golive" }],
  "discord": ["1.4.1", { main: "networks.discord", stats: "networks.stats" }],
  "events": ["1.5.2", { main: "calendar.events", types: "calendar.events.types" }],
  "facebook": ["1.2.1", { main: "networks.accounts" }],
  "faq": ["1.1.2", { main: "content.faq", inbox: "content.faq.inbox" }],
  "gallery": ["1.3.2", { main: "content.galleries", takedowns: "content.galleries.takedowns" }],
  "game-covers": ["1.5.0", { covers: "community.games.covers", kept: "community.games.covers" }],
  "game-suggestions": ["1.11.2", { main: "community.games" }],
  "github": ["1.3.2", { main: "networks.accounts", stats: "networks.stats" }],
  "hero": ["1.1.0", { banner: "site.home.banners" }],
  "idea-box": ["1.1.2", { main: "community.ideas" }],
  "instagram": ["1.2.1", { main: "networks.accounts" }],
  "kick": ["1.2.1", { main: "networks.accounts" }],
  "kofi": ["1.2.1", { main: "networks.accounts" }],
  "legal-pages": ["1.1.2", { legal: "site.general.privacy" }],
  "live-status": ["1.6.0", { main: "live.golive" }],
  "map": ["1.2.2", { main: "content.map", types: "content.map.types" }],
  "mastodon": ["1.3.1", { main: "networks.accounts", stats: "networks.stats" }],
  "maze-overlay": ["1.3.1", { look: "obs.overlays.maze", motion: "obs.overlays.maze" }],
  "partnerships": ["2.5.1", { main: "community.partners" }],
  "patreon": ["1.2.1", { main: "networks.accounts" }],
  "pinterest": ["1.2.1", { main: "networks.accounts" }],
  "planning": ["2.9.2", { main: "calendar.schedule", look: "calendar.schedule.look" }],
  "platform-links": ["1.2.2", { main: "networks.accounts.other" }],
  "polls": ["1.9.2", { polls: "live.participation.polls", screen: "live.participation.polls" }],
  "press-kit": ["1.2.0", { main: "content.press-kit" }],
  "reddit": ["1.3.1", { main: "networks.accounts", stats: "networks.stats" }],
  "snapchat": ["1.2.1", { main: "networks.accounts" }],
  "soundcloud": ["1.2.1", { main: "networks.accounts" }],
  "sponsor-ticker": ["1.5.0", { main: "obs.overlays.sponsors" }],
  "sponsors": ["1.2.0", { sponsors: "community.partners.sponsors" }],
  "spotify": ["1.2.0", { main: "networks.accounts" }],
  "steam": ["1.2.1", { main: "networks.accounts" }],
  "stream-story": ["2.15.2", { main: "calendar.story", styles: "calendar.story.styles" }],
  "supporters": ["1.3.0", { main: "community.supporters" }],
  "telegram": ["1.2.1", { main: "networks.accounts" }],
  "testimonials": ["1.5.2", { main: "community.reviews", share: "community.reviews.share" }],
  "thanks-wall": ["1.4.2", { wall: "community.supporters.wall" }],
  "threads": ["1.2.1", { main: "networks.accounts" }],
  "ticker-overlay": ["1.3.0", { main: "obs.overlays.ticker" }],
  "tiktok": ["1.2.1", { main: "networks.accounts" }],
  "videos": ["1.2.2", { main: "content.videos", shelves: "content.videos.shelves" }],
  "x-twitter": ["1.2.1", { main: "networks.accounts" }],
  "youtube-channel": ["1.5.1", { main: "networks.youtube", stats: "networks.stats" }],
  "youtube-connector": ["1.5.0", { main: "networks.youtube" }],
  "youtube-live-actions": ["1.3.0", { chat: "live.chat.youtube", alerts: "live.alerts.events" }],
};
const MIGRATED = { ...TWITCH, ...ROLLOUT };
/** The last release before each migration: what the sites run (or update from). */
// R33 (connection block, core 0.36.0): these four moved their codes out of the settings (legacySettings, dataVersion 2) and raised minCore: their structure is checked in their own tests.
const RESTRUCTURED = new Set(["twitch-connector", "twitch-channel", "youtube-connector", "youtube-live-actions"]);
const BEFORE = (id) => (id in TWITCH ? "v1.95.1" : id === "planning" ? "v1.99.1" : "v1.99.0"); // Planning 2.8.1 came with 1.99.1
/** Modules with sections on a page of the core (Home, General): the core shows module sections on its own pages in a later release, until then they also keep their own sidebar entry. */
const ON_CORE_PAGE = ["hero", "legal-pages"];
/** Modules with no place, and why. Every other module of modules/ declares places. */
const NOT_PLACED = {
  blog: "content only: entries, no settings", codes: "content only: entries, no settings", collection: "content only: entries, no settings", links: "content only: entries, no settings", pages: "content only: entries, no settings",
  mascot: "five tabs with their own blocks: the core allows 3 sections of one module per page",
  "twitch-events": "bridge version, removed once Alerts overlay has taken over its journal and settings",
};

const L = (t, lang) => t[lang];
const firstWord = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^[^a-z0-9]+/, "").split(/[^a-z0-9]+/)[0];

/* ───────────── 1. The vocabulary ───────────── */

test("vocabulary: open groups only (the core owns site, admin, account and Overlay pages), EN and FR everywhere, an R1 intro per page, short titles", () => {
  assert.equal(vocabFile.version, 1);
  assert.deepEqual(vocabFile.groups.map((g) => g.id), ["content", "live", "calendar", "community", "obs", "networks"]);
  assert.equal(vocabFile.pages.length, 32);
  assert.deepEqual(vocabFile.aliases, {}, "nothing renamed yet");
  assert.deepEqual(vocabFile.deprecated, {});
  const ids = new Set();
  for (const p of vocabFile.pages) {
    assert.match(p.id, /^[a-z][a-z0-9-]{1,23}\.[a-z][a-z0-9-]{1,23}$/, p.id);
    assert.ok(!ids.has(p.id), `${p.id} twice`); ids.add(p.id);
    assert.ok(vocabFile.groups.some((g) => g.id === p.id.split(".")[0]), `${p.id}: its group is in the file`);
    assert.notEqual(p.id, "obs.pages", "Overlay pages is the core's page (its copy lives in the core)");
    for (const lang of ["en", "fr"]) {
      assert.ok(p[lang] && p[lang].length <= 40, `${p.id}: ${lang} title, 40 characters at most`);
      assert.ok(p.intro?.[lang] && p.intro[lang].length <= 120, `${p.id}: ${lang} intro (R1), 120 characters at most`);
      assert.ok(/\.$/.test(p.intro[lang]) && p.intro[lang].split(/\s+/).length <= 20, `${p.id}: the intro is one short sentence (R13)`);
    }
    const tabs = p.tabs ?? [];
    assert.ok(tabs.length !== 1, `${p.id}: a tab bar needs 2 tabs at least (one tab = no tab)`);
    assert.ok(tabs.length <= 5 || (typeof p.tabsReason === "string" && p.tabsReason.length > 20), `${p.id}: ${tabs.length} tabs (soft guideline 5): write the reason in tabsReason`);
    assert.equal(new Set(tabs.map((t) => t.id)).size, tabs.length, `${p.id}: tab ids unique`);
    for (const t of tabs) {
      assert.match(t.id, /^[a-z][a-z0-9-]{1,23}$/, `${p.id}.${t.id}`);
      for (const lang of ["en", "fr"]) assert.ok(t[lang] && t[lang].length <= 24, `${p.id}.${t.id}: ${lang} tab title, short (1 to 3 words)`);
    }
  }
  for (const g of vocabFile.groups) for (const lang of ["en", "fr"]) assert.ok(g[lang] && g[lang].length <= 40, `${g.id}: ${lang} title`);
});

test("vocabulary: the words of the person (R9), no word that only says « settings » (rule 7), no exclamation, no capitals (R13)", () => {
  const forbidden = /\b(cl[ée]s?|slug|instance|topic|sujet|token|jeton|webhook|eventsub|route|service|identifiant|payload|api|json|cache|hash|sse|oauth)\b/i;
  const redundant = /\b(r[ée]glages?|settings|configuration|extensions?|modules?|param[eè]tres)\b/i;
  const texts = [...vocabFile.groups.flatMap((g) => [g.en, g.fr]), ...vocabFile.pages.flatMap((p) => [p.en, p.fr, p.intro.en, p.intro.fr, ...(p.tabs ?? []).flatMap((t) => [t.en, t.fr])])];
  for (const s of texts) {
    assert.ok(!forbidden.test(s), `R9: « ${s} »`);
    assert.ok(!redundant.test(s), `rule 7: « ${s} »`);
    assert.ok(!/!|veuillez/i.test(s) && !/\b[A-ZÉÈ]{4,}\b/.test(s.replace(/\b(FAQ|OBS)\b/g, "")), `R13: « ${s} »`);
  }
});

test("vocabulary: the core reads it without losing anything; with the core's own places: 9 groups and 33 pages outside Site, Administration and Account", { skip: noCore }, () => {
  const kept = P.sanitizeVocabulary(vocabFile);
  assert.deepEqual(kept.groups.map((g) => g.id), vocabFile.groups.map((g) => g.id), "every group kept");
  assert.deepEqual(kept.pages.map((p) => [p.id, (p.tabs ?? []).map((t) => t.id), !!p.intro]), vocabFile.pages.map((p) => [p.id, (p.tabs ?? []).map((t) => t.id), true]), "every page, tab and intro kept");
  assert.ok(fs.statSync(path.join(root, "catalogue/places.json")).size < 256 * 1024, "under the core's size limit");
  assert.equal(vocab.groups.length, 9);
  const outside = vocab.pages.filter((p) => !["site", "admin", "account"].includes(p.id.split(".")[0]));
  assert.equal(outside.length, 33);
  for (const p of vocabFile.pages) assert.ok(vocab.pages.some((x) => x.id === p.id && !x.href), `${p.id}: a page of the vocabulary in force, not a core page`);
});

test("vocabulary: no two pages share a name or a first word in a language (R12), the core's pages included", { skip: noCore }, () => {
  for (const lang of ["en", "fr"]) {
    const seen = new Map();
    for (const p of vocab.pages) {
      const name = L(p, lang), word = firstWord(name);
      const clash = [...seen].find(([n, w]) => n.toLowerCase() === name.toLowerCase() || w === word);
      assert.ok(!clash, `${lang}: « ${name} » (${p.id}) and « ${clash?.[0]} »`);
      seen.set(name, word);
    }
  }
});

/* ───────────── 2. places.known ───────────── */

/** Every place a manifest names: sections (short and full forms) and seeAlso links. */
function namedPlaces(m) {
  return [
    ...(m.places ?? []).map((p, i) => ({ where: `places[${i}]`, place: p.place, define: p.define })),
    ...(m.places ?? []).flatMap((p, i) => (p.seeAlso ?? []).map((s) => ({ where: `places[${i}].seeAlso`, place: s, seeAlso: true }))),
    ...(m.tabs ?? []).flatMap((t, i) => (t.place !== undefined ? [{ where: `tabs[${i}].place`, place: t.place }] : [])),
    ...(m.place !== undefined ? [{ where: "place", place: m.place }] : []),
  ];
}

test("places.known: our modules only use places of the vocabulary (with the core's pages and tabs), or places they define inline", { skip: noCore }, () => {
  let used = 0;
  for (const [id, m] of Object.entries(manifests)) {
    for (const { where, place, define, seeAlso } of namedPlaces(m)) {
      used++;
      const parsed = P.parsePlace(place);
      assert.ok(parsed, `${id} ${where}: « ${place} » is not a place`);
      const g = vocab.groups.find((x) => x.id === parsed.group);
      const p = vocab.pages.find((x) => x.id === `${parsed.group}.${parsed.page}`);
      const tabKnown = !parsed.tab || (p?.tabs ?? []).some((t) => t.id === parsed.tab);
      if (g && p && tabKnown) continue;
      assert.ok(!seeAlso, `${id} ${where}: « ${place} » is not in catalogue/places.json (a link leads to a known page)`);
      // Unknown: allowed only when defined inline (the titles the core shows), and never in a group of the core.
      assert.ok(define, `${id} ${where}: « ${place} » is not in catalogue/places.json; add it there (same PR) or define it inline with "define"`);
      assert.ok(g || define.group?.title, `${id} ${where}: unknown group « ${parsed.group} » without define.group.title`);
      assert.ok(p || (define.page?.title && define.page?.intro), `${id} ${where}: unknown page without define.page.title and intro (R1)`);
      assert.ok(tabKnown || define.tab?.title, `${id} ${where}: unknown tab « ${parsed.tab} » without define.tab.title`);
    }
  }
  assert.ok(used >= 15, "the Twitch cluster declares its places");
});

test("catalogue/index.json lists the pages of each module (places), as its manifest says, and only pages of the vocabulary", { skip: noCore }, () => {
  const index = read("catalogue/index.json");
  for (const e of index.modules) {
    const m = manifests[e.id];
    assert.deepEqual(e.places ?? [], placesOf(m), e.id);
    for (const p of e.places ?? []) assert.ok(vocab.pages.some((x) => x.id === p), `${e.id}: ${p}`);
  }
  assert.deepEqual(index.modules.find((e) => e.id === "alerts-overlay").places, ["live.alerts", "live.chat", "live.rewards"]);
});

/* ───────────── 3. Dual mode (older cores) ───────────── */

test("dual mode: places[].fromTab only (never tabs[].place without minCore 0.31.0), so the minimum core does not move", () => {
  for (const [id, m] of Object.entries(manifests)) {
    const tabPlace = (m.tabs ?? []).some((t) => t.place !== undefined);
    const [maj, min] = String(m.minCore ?? "0.0.0").split(".").map(Number);
    assert.ok(!tabPlace || maj > 0 || min >= 31, `${id}: tabs[].place is refused by a core older than 0.31.0`);
  }
  for (const [id, [version]] of Object.entries(MIGRATED)) {
    const m = manifests[id];
    assert.equal(m.version, version, id);
    assert.ok(Array.isArray(m.places) && m.places.length > 0, `${id}: places declared`);
    assert.equal(m.place, undefined, `${id}: full form only`);
    for (const p of m.places) assert.ok(p.order >= 100 && p.order <= 999, `${id}.${p.id}: order 100 to 999`);
  }
});

/** Texts (objects with fr and en) and help lines are left out of the comparison: a text-only patch (R33 wording) is not a change of structure. */
const noTexts = (v) => (Array.isArray(v) ? v.map(noTexts) : v && typeof v === "object" ? (typeof v.fr === "string" && typeof v.en === "string" ? "<text>" : Object.fromEntries(Object.entries(v).filter(([k]) => k !== "help").map(([k, x]) => [k, noTexts(x)]))) : v);

const tagsUsed = [...new Set(Object.keys(MIGRATED).map(BEFORE))];
const histories = Object.fromEntries(tagsUsed.map((tag) => [tag, (() => { try { return Object.keys(manifestsAt(root, tag)).length > 0; } catch { return false; } })()]));
const missingTag = tagsUsed.find((tag) => !histories[tag]);
const needHistory = missingTag && process.env.HOT_UPDATE_REQUIRE_HISTORY !== "1" ? `no git history with ${missingTag} here` : false;

test(`upgrade from the real ${tagsUsed.join(" / ")} manifests: an older core sees the same module (only « places » and the version change; adminMenu, settings, tabs, tools, elements, data kept)`, { skip: needHistory }, () => {
  const beforeBy = Object.fromEntries(tagsUsed.map((tag) => [tag, manifestsAt(root, tag)]));
  for (const id of Object.keys(MIGRATED)) {
    const before = beforeBy[BEFORE(id)];
    const old = before[id], now = manifests[id];
    assert.ok(old, `${id} exists at ${BEFORE(id)}`);
    const { places, version, minCore: nowCore, ...rest } = now;
    const { version: oldVersion, minCore: oldCore, ...oldRest } = old;
    assert.ok(nowCore === oldCore || nowCore === "0.36.0", `${id}: minCore only moves for the connection block (0.36.0)`);
    // (1.20.0) alerts-overlay adds two animated elements AFTER the ones it had: those are compared, the new ones are checked in tests/alerts-gauges.test.mjs
    if (id === "alerts-overlay" && rest.overlayElements.length > oldRest.overlayElements.length) rest.overlayElements = rest.overlayElements.slice(0, oldRest.overlayElements.length);
    if (RESTRUCTURED.has(id)) { assert.equal(now.adminMenu, old.adminMenu, id); continue; }
    assert.deepEqual(noTexts(rest), noTexts(oldRest), `${id}: nothing else changed (an older core drops « places », the top-level object is not strict)`);
    assert.ok(version > oldVersion || version.split(".")[0] > oldVersion.split(".")[0], `${id}: ${oldVersion} → ${version}`);
    // What an older core needs to keep showing the module in the same place.
    assert.equal(now.adminMenu, old.adminMenu, `${id}: adminMenu kept for cores older than 0.31.0`);
    assert.equal(now.adminMenuOrder, old.adminMenuOrder, id);
    assert.ok(now.minCore === old.minCore || now.minCore === "0.36.0", `${id}: minCore unchanged (0.36.0 for the connection block)`);
  }
  // The modules that stay without a place are untouched.
  for (const id of Object.keys(NOT_PLACED)) assert.equal(manifests[id].places, undefined, `${id}: ${NOT_PLACED[id]}`);
});

test("rollout: every module of modules/ with settings or an admin panel declares its places; the few that do not are listed with their reason", () => {
  const dirs = fs.readdirSync(path.join(root, "modules")).filter((d) => fs.existsSync(path.join(root, "modules", d, "module.json")));
  const placed = new Set([...Object.keys(MIGRATED), "stream-goals"]);
  for (const id of dirs) {
    if (placed.has(id)) { assert.ok(manifests[id].places?.length, `${id}: places declared`); continue; }
    assert.ok(NOT_PLACED[id], `${id}: no places and no reason in NOT_PLACED`);
    assert.equal(manifests[id].places, undefined, `${id}: ${NOT_PLACED[id]}`);
  }
  for (const id of Object.keys(NOT_PLACED)) assert.ok(dirs.includes(id), `${id}: listed in NOT_PLACED but not a module`);
  for (const id of ["blog", "codes", "collection", "links", "pages"]) assert.deepEqual(manifests[id].settings ?? [], [], `${id}: content only, nothing to place`);
});

test("every migrated manifest passes the core's own validator (the same check as at install)", async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  for (const id of Object.keys(MIGRATED)) {
    const r = parseManifest(manifests[id]);
    assert.ok(r.ok, `${id}: ${r.error}`);
  }
});

/* ───────────── 4. On core 0.31.0 ───────────── */

test("core 0.31.0: each migrated module places everything it shows (every setting once, every panel tab) and leaves the sidebar for its pages (except Home and General banners, hosted by the core later)", { skip: noCore }, async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const { planTabs, settingTab } = await import("@/core/modules/tabs");
  for (const [id, [, expected]] of Object.entries(MIGRATED)) {
    const m = parseManifest(manifests[id]).manifest;
    const sections = P.moduleSections(m, vocab.aliases);
    assert.deepEqual(Object.fromEntries(sections.map((s) => [s.id, P.placeId(s.place)])), expected, `${id}: sections`);
    const plan = planTabs(m.tabs);
    const placed = sections.flatMap((s) => s.settings);
    assert.equal(new Set(placed).size, placed.length, `${id}: a setting in one section only`);
    const shown = m.settings.filter((s) => !["sources", "general"].includes(settingTab(plan, s))).map((s) => s.key);
    assert.deepEqual([...placed].sort(), [...shown].sort(), `${id}: every setting of the module page is on a place page`);
    // A section on a page of the core is accepted and listed, but the core does not show it there yet (docs/PLACES.md § 3): such a module keeps its own entry.
    if (!ON_CORE_PAGE.includes(id)) assert.ok(P.fullyPlaced(m, sections, (s) => P.isCorePage(s.place, vocab)), `${id}: fully placed (its own sidebar entry goes on core 0.31.0)`);
    for (const s of sections) assert.ok(sections.filter((x) => P.pageId(x.place) === P.pageId(s.place)).length <= 3, `${id}: 3 sections on a page at most`);
    assert.deepEqual(P.placeIssues(m, vocab), [], `${id}: places valid against the vocabulary in force`);
  }
});

test("core 0.31.0: the two « Rewards » become one page, in a stable order (overlay reactions, then the bot's answers, then Smart home), linked from Alerts and Chat", { skip: noCore }, async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const contribs = ["alerts-overlay", "twitch-bot", "home-assistant"].flatMap((id) => {
    const m = parseManifest(manifests[id]).manifest;
    return P.moduleSections(m, vocab.aliases).map((section) => ({ instanceId: id, instanceKey: id, moduleId: id, moduleName: m.name.fr, instanceLabel: m.name.fr, siblings: false, connector: false, section, visible: true }));
  });
  const page = P.findPage(P.buildPlaceIndex(contribs, vocab, "fr"), "live", "rewards");
  assert.deepEqual(page.tabs.map((t) => [t.title, t.sections.map((s) => `${s.moduleId}.${s.section.id}`)]), [
    ["Récompenses", ["alerts-overlay.rewards", "twitch-bot.rewards"]],
    ["Maison connectée", ["home-assistant.main"]],
  ]);
  const links = (id, section) => manifests[id].places.find((p) => p.id === section).seeAlso;
  assert.ok(links("alerts-overlay", "events").includes("live.rewards") && links("twitch-bot", "commands").includes("live.rewards"), "Alerts and Chat link to the one Rewards page (R25)");
});

test("kit: places.valid and compat.minCore pass for the migrated modules; places.budget gives only the known advice", { skip: noCore }, async () => {
  const { checkModule } = await import(pathToFileURL(path.join(core, "testsupport/index.mjs")).href);
  // Advice already true on the module page before the migration (the same fields, now on a place page): to fold in a later step, never hidden here.
  const KNOWN_ADVICE = {
    "alerts-overlay": ['section "media" (live.chat.media) shows 6 fields (R4: 5 visible at most, fold the rare ones)'],
    "twitch-raid": ['section "featured" (live.raid.featured) shows 7 fields (R4: 5 visible at most, fold the rare ones)'],
    commissions: ['section "main" (community.commissions) shows 6 fields (R4: 5 visible at most, fold the rare ones)'],
    "daily-game": ['section "daily" (community.games.daily) shows 9 simple settings (R5: 7 at most)'],
    directory: ['section "main" (content.directory) shows 7 fields (R4: 5 visible at most, fold the rare ones)'],
    faq: ['section "main" (content.faq) shows 7 fields (R4: 5 visible at most, fold the rare ones)'],
    hero: ['section "banner" (site.home.banners) shows 9 simple settings (R5: 7 at most)'],
    "maze-overlay": ['section "look" (obs.overlays.maze) shows 6 fields (R4: 5 visible at most, fold the rare ones)'],
    polls: ['section "polls" (live.participation.polls) shows 6 fields (R4: 5 visible at most, fold the rare ones)'],
    "thanks-wall": ['section "wall" (community.supporters.wall) shows 17 simple settings (R5: 7 at most)'],
  };
  // Dual mode: a module with neither adminMenu nor menuGroup keeps its default sidebar section on a core older than 0.31.0 (unchanged on purpose).
  const NO_MENU = "no adminMenu: on a core older than 0.31.0 the module keeps its default sidebar section (fine if that is wanted)";
  for (const id of [...Object.keys(MIGRATED), "stream-goals"]) {
    const report = await checkModule(path.join(root, "modules", id), { only: ["manifest.valid", "places.valid", "places.budget", "compat.minCore"] });
    const r = Object.fromEntries(report.results.map((x) => [x.id, x]));
    for (const req of ["manifest.valid", "places.valid"]) assert.equal(r[req].status, "pass", `${id} ${req}: ${r[req].problems.join(" ; ")}`);
    // compat.minCore is "na" for a module that declares no minCore (nothing newer than the oldest core is used).
    assert.ok(["pass", "na"].includes(r["compat.minCore"].status), `${id} compat.minCore: ${r["compat.minCore"].problems.join(" ; ")}`);
    const menu = manifests[id].adminMenu || manifests[id].menuGroup ? [] : [NO_MENU];
    // Core 0.35.0: `placeAdvice` reads `manifest.settings` without a default, so the check cannot finish for a module that has no settings (contacts). Core bug, not a module problem.
    const noSettings = !manifests[id].settings;
    const problems = r["places.budget"].problems.filter((p) => !(noSettings && /n'a pas pu se terminer : Cannot read properties of undefined \(reading 'filter'\)/.test(p)));
    assert.deepEqual(problems, [...(KNOWN_ADVICE[id] ?? []), ...menu], `${id} places.budget`);
  }
});

/* ───────────── The four live sites ───────────── */

// The module lists of the four live sites of the study (instances counted; no site name, no instance name). Built from the manifests of THIS repository:
// what each site gets after updating its modules to this release, on core 0.31.0.
const SITES = read("tests/fixtures/places-sites.json");

/** The sidebar a site gets: the place pages (groups › pages [tabs]) and the module entries that stay (adminMenu path, or the core's own sections). */
async function siteMenu(site) {
  const { parseManifest } = await import("@/core/modules/manifest");
  const contribs = [], stay = [];
  for (const [id, count] of Object.entries(SITES[site])) {
    const m = parseManifest(manifests[id]).manifest;
    const sections = P.moduleSections(m, vocab.aliases);
    for (let i = 1; i <= count; i++) {
      const key = i === 1 ? id : `${id}-${i}`;
      for (const section of sections) contribs.push({ instanceId: key, instanceKey: key, moduleId: id, moduleName: m.name.fr ?? m.name, instanceLabel: key, siblings: count > 1, connector: m.type === "integration", section, visible: true });
      const away = sections.length > 0 && P.fullyPlaced(m, sections, (s) => P.isCorePage(s.place, vocab));
      if (!away) stay.push({ id: key, name: `${m.name.fr ?? m.name}${count > 1 ? ` (${i})` : ""}`, adminMenu: m.adminMenu ?? null, order: m.adminMenuOrder, moduleId: id });
    }
  }
  const index = P.buildPlaceIndex(contribs, vocab, "fr");
  const lines = [];
  // Module entries with a path and place pages share the groups of the sidebar (the core's layout feeds both to buildMenuTree).
  const items = [
    ...stay.filter((s) => s.adminMenu).map((s) => ({ id: s.id, name: s.name, badge: 0, error: false, placement: "menu", menuPath: M.parseMenuPath(s.adminMenu), menuOrder: s.order, moduleId: s.moduleId })),
    ...index.groups.flatMap((g) => g.pages.filter((p) => !p.core).map((p, i) => ({ id: `place:${p.id}`, name: p.title, badge: 0, error: false, placement: "menu", menuPath: [{ id: g.id, text: g.title }], menuOrder: i, groupLabels: { [g.id]: { en: g.title, fr: g.title } }, moduleId: "", tabs: p.tabs.map((t) => t.title) }))),
  ];
  const tree = M.buildMenuTree(items, "fr");
  const show = (n, depth) => {
    lines.push(`${"  ".repeat(depth)}${n.title}`);
    for (const e of n.entries) lines.push(`${"  ".repeat(depth + 1)}- ${e.name}${e.tabs?.length > 1 ? ` [${e.tabs.join(", ")}]` : ""}`);
    for (const c of n.children) show(c, depth + 1);
  };
  for (const [id, n] of Object.entries(tree.sections)) if (n) show({ ...n, title: `(section ${id})` }, 0);
  for (const n of tree.groups) show(n, 0);
  const elsewhere = stay.filter((s) => !s.adminMenu).map((s) => s.name).sort((a, b) => a.localeCompare(b, "fr"));
  if (elsewhere.length) lines.push(`(own sections) ${elsewhere.join(" · ")}`);
  return { lines, warnings: index.warnings };
}

const MENUS_FILE = path.join(root, "tests/fixtures/places-menus.json");
// PLACES_MENUS_WRITE=1 rewrites the expected menus from the manifests (read the diff: it is the sidebar of each site).
if (process.env.PLACES_MENUS_WRITE === "1" && !noCore && M) {
  const fresh = {};
  for (const site of Object.keys(SITES)) fresh[site] = (await siteMenu(site)).lines;
  fs.writeFileSync(MENUS_FILE, `${JSON.stringify(fresh, null, 1)}\n`);
}
const EXPECTED_MENUS = JSON.parse(fs.readFileSync(MENUS_FILE, "utf8"));
for (const site of Object.keys(EXPECTED_MENUS)) {
  test(`menu of the live site « ${site} » (${Object.values(SITES[site]).reduce((a, b) => a + b, 0)} instances) after this release, on core 0.31.0`, { skip: noCore || !M }, async () => {
    const { lines, warnings } = await siteMenu(site);
    if (process.env.PLACES_MENUS_PRINT === "1") console.log(`\n${site}\n${lines.join("\n")}`);
    assert.deepEqual(warnings, [], "no folded group, no tab beyond the guideline");
    assert.deepEqual(lines, EXPECTED_MENUS[site]);
  });
}

test("menus: the Twitch cluster leaves « Réseaux › Twitch »; nothing about alerts, rewards or chat on a site without them (graceful absence)", { skip: noCore || !M }, async () => {
  const big = (await siteMenu("streamer-35")).lines.join("\n");
  for (const name of ["Overlay alertes", "Bot Twitch", "Home Assistant", "Connecteur Twitch", "Raid Twitch"]) assert.ok(!big.includes(`- ${name}`), `${name} has no own entry any more`);
  const small = (await siteMenu("creator-14")).lines.join("\n");
  for (const page of ["Alertes", "Récompenses", "Chat", "Raid"]) assert.ok(!small.includes(`- ${page}`), `${page}: no contributor, no page`);
  assert.ok(small.includes("- Twitch"), "the Twitch connection and channels have their page");
});

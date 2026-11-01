// Onglets de la page d'admin des modules (cœur 0.2.2) : ce que chaque manifeste déclare, et ce que le cœur en fait.
// Le cœur classe tout seul (Utiliser · Réglages · Sources · Général) ; les modules ne font que renommer « Utiliser », le retirer ou ajouter « Apparence ».
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { parseManifest } = await import("@/core/modules/manifest");
const { planTabs, settingTab, visibleTabs } = await import("@/core/modules/tabs");

const read = (dir) => JSON.parse(fs.readFileSync(new URL(`../${dir}/module.json`, import.meta.url), "utf8"));
const label = (m, id) => m.tabs.find((t) => t.id === id)?.label;

const RENAMED = {
  "modules/stream-story": ["Fabriquer la vidéo", "Make the video"],
  "modules/twitch-raid": ["Ma liste", "My list"],
  "modules/planning": ["Créneaux", "Slots"],
  "modules/twitch-bot": ["Commandes", "Commands"],
  "modules/partnerships": ["Partenaires", "Partners"],
  "modules/community-stats": ["Chiffres", "Figures"],
  "modules/calendar-manual": ["Mes streams", "My streams"],
  "modules/discord-announcer": ["Annonces", "Announcements"],
  "modules/game-suggestions": ["Suggestions", "Suggestions"],
  "examples/guestbook": ["Messages", "Messages"],
  "modules/twitch-channel": ["Ma chaîne", "My channel"],
  "modules/discord": ["Statistiques", "Statistics"],
  "modules/github": ["Statistiques", "Statistics"],
  "modules/mastodon": ["Statistiques", "Statistics"],
  "modules/reddit": ["Statistiques", "Statistics"],
  "modules/bluesky": ["Statistiques", "Statistics"],
  "modules/youtube-channel": ["Statistiques", "Statistics"],
};
// Modules dont le panneau range des blocs dans un autre onglet que « Utiliser » (clé `tab` d'un bloc, cœur 0.2.5).
const BLOCKS_IN_TABS = ["modules/planning", "modules/calendar-ical", "modules/twitch-bot"];
// Ces modules comptent leurs visiteurs par ctx.api.visitor.fingerprint (cœur 0.2.6, qui couvre aussi les onglets).
const VISITOR_API = ["modules/game-suggestions", "examples/guestbook", "modules/twitch-raid"];   // twitch-raid 2.2 : route publique « members » limitée par visiteur, et script de page (cœur 0.2.6)
// Modules dont l'administration utilise les briques natives du cœur 0.6.0 (tableau enrichi, champs repliés, boutons côte à côte).
const NATIVE_ADMIN = ["modules/game-suggestions", "modules/daily-game"];
// Modules qui proposent des éléments aux pages d'overlay (clé overlayElements) : cœur 0.5.0.
const OVERLAY_ELEMENTS = ["alerts-overlay", "community-stats", "countdown", "game-suggestions", "mascot", "maze-overlay", "planning", "polls", "sponsor-ticker", "testimonials", "thanks-wall", "ticker-overlay", "twitch-channel"].map((d) => `modules/${d}`);
// Modules qui lisent `ambiguous` de ctx.api.rawg.cover (lien « Ce n'est pas le bon jeu ? », cœur 0.2.10).
const RAWG_AMBIGUOUS = ["modules/planning", "modules/game-suggestions", "modules/stream-story"];
const HIDDEN = ["modules/twitch-connector", "modules/youtube-connector", "modules/live-status"];
const LOOK = ["modules/planning", "modules/maze-overlay"];

test("onglets : « Utiliser » est renommé avec le nom de ce qu'on y fait (FR + EN), manifeste valide, minCore 0.2.2", () => {
  for (const [dir, [fr, en]] of Object.entries(RENAMED)) {
    const m = read(dir);
    assert.ok(parseManifest(m).ok, dir);
    assert.deepEqual(label(m, "use"), { fr, en }, dir);
    // Un module qui range un bloc de son panneau dans un autre onglet (clé `tab` d'un bloc, cœur 0.2.5) demande le 0.2.5.
    const expected = NATIVE_ADMIN.includes(dir) ? "0.6.0" : OVERLAY_ELEMENTS.includes(dir) ? "0.5.0" : RAWG_AMBIGUOUS.includes(dir) ? "0.2.10" : dir === "modules/twitch-raid" ? "0.2.12" : VISITOR_API.includes(dir) ? "0.2.6" : BLOCKS_IN_TABS.includes(dir) ? "0.2.5" : "0.2.2";
    assert.equal(m.minCore, expected, `${dir} : les onglets demandent le cœur ${expected}`);
    assert.ok(m.tabs.filter((t) => t.id !== "use" && !["settings", "sources", "general"].includes(t.id)).length <= 3, dir);
  }
});

test("onglets : sans panneau utile, « Utiliser » est retiré : le panneau passe en haut de Réglages, rien n'est perdu", () => {
  for (const dir of HIDDEN) {
    const m = read(dir);
    assert.ok(parseManifest(m).ok, dir);
    assert.deepEqual(m.tabs, [{ id: "use", hidden: true }], dir);
    assert.equal(m.minCore, "0.2.2", dir);
    const plan = planTabs(m.tabs);
    assert.equal(plan.target("use"), "settings", `${dir} : le panneau rejoint Réglages`);
    assert.deepEqual(plan.order.map((t) => t.id), ["settings", "sources", "general"], dir);
    assert.deepEqual(visibleTabs(plan, ["use", "settings"]).map((t) => t.id), ["settings"], `${dir} : un seul onglet, la rangée n'est pas affichée`);
  }
});

test("onglets : Planning et Labyrinthe rangent leurs réglages d'apparence dans un onglet « Apparence », ni plus ni moins", () => {
  for (const dir of LOOK) {
    const m = read(dir);
    assert.ok(parseManifest(m).ok, dir);
    assert.deepEqual(label(m, "look"), { fr: "Apparence", en: "Appearance" }, dir);
    const plan = planTabs(m.tabs);
    const inLook = m.settings.filter((s) => settingTab(plan, s) === "look").map((s) => s.key);
    const appearance = m.settings.filter((s) => s.group === "appearance").map((s) => s.key);
    assert.deepEqual(inLook, appearance, `${dir} : les réglages du groupe « apparence » sont tous dans l'onglet, et eux seuls`);
    assert.ok(inLook.length >= 6, dir);
  }
  assert.deepEqual(planTabs(read("modules/planning").tabs).order.map((t) => t.id), ["use", "settings", "look", "sources", "general"]);
});

test("onglets : les modules non audités ne déclarent rien (les quatre onglets du cœur leur suffisent) ; Contacts renomme seulement « Utiliser »", () => {
  assert.deepEqual(read("modules/contacts").tabs.map((x) => x.id), ["use"], "Contacts : un seul onglet renommé");
  for (const dir of ["modules/blog", "modules/links", "modules/pages", "modules/hero"]) assert.equal(read(dir).tabs, undefined, dir);
});

test("onglets : un module qui place un bloc du panneau dans un onglet demande le cœur 0.2.5, et vise un onglet qu'il connaît", () => {
  for (const dir of BLOCKS_IN_TABS) {
    const m = read(dir);
    assert.ok(parseManifest(m).ok, dir);
    assert.equal(m.minCore, NATIVE_ADMIN.includes(dir) ? "0.6.0" : OVERLAY_ELEMENTS.includes(dir) ? "0.5.0" : RAWG_AMBIGUOUS.includes(dir) ? "0.2.10" : "0.2.5", `${dir} : la clé \`tab\` d'un bloc est ignorée par un cœur plus ancien`);
    const code = fs.readdirSync(new URL(`../${dir}/`, import.meta.url), { recursive: true }).filter((f) => /\.mjs$/.test(f))
      .map((f) => fs.readFileSync(new URL(`../${dir}/${f}`, import.meta.url), "utf8")).join("\n");
    const known = new Set(["settings", "sources", "general", ...(m.tabs ?? []).map((t) => t.id)]);
    const used = [...code.matchAll(/\btab:\s*"([a-z-]+)"/g)].map((x) => x[1]);
    assert.ok(used.length > 0, `${dir} : il place bien un bloc dans un onglet`);
    for (const id of used) assert.ok(known.has(id), `${dir} : l'onglet « ${id} » existe`);
  }
});

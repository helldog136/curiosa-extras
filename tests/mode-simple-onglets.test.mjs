// Mode simple (audit du cœur 0.6.4, docs/ideas/audit-mode-simple-modules.md du cœur) : les onglets de réglages de plus de 7 réglages simples sont rangés
// sous « Plus d'options » (`rare`) ou en mode avancé (`advanced`). Aucune clé ne change, aucune valeur par défaut ne change : seul l'endroit où le réglage s'affiche change.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (id) => JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8"));

// id → { toutes les clés (aucune ne disparaît), rare, advanced (ajoutés par ce changement), défauts qui ne bougent pas }
const EXPECTED = {
  directory: { keys: ["title", "intro", "noun", "nouns", "teamTitle", "nameStyle", "photos", "links", "bio", "hide", "consent", "mapConsent", "proposeLink", "proposeEmail", "proposeLabel"], rare: ["noun", "nouns", "teamTitle", "proposeLabel", "proposeEmail", "proposeLink"], advanced: ["consent", "mapConsent"], defaults: { nameStyle: "card", photos: "request", links: "detail", bio: true } },
  map: { keys: ["intro", "wordOne", "wordMany", "showMapLabel", "nearLabel", "showMap", "showNear", "sort", "directions", "showExternal", "hidePast", "footerLink"], rare: ["wordOne", "wordMany", "showMapLabel", "nearLabel", "directions", "hidePast", "footerLink"], advanced: [], defaults: { showMap: true, showNear: true, sort: "order", directions: "osm", showExternal: true, hidePast: true, footerLink: false } },
  gallery: { keys: ["title", "intro", "people", "consent", "removal", "notify", "forwardToContacts", "sort", "dates", "markup"], rare: ["consent", "sort", "dates"], advanced: ["markup", "forwardToContacts"], defaults: { people: true, removal: true, notify: true, forwardToContacts: true, markup: false } },
  supporters: { keys: ["provider", "accessToken", "publicPage", "review", "title", "intro", "category", "showTiers", "othersTitle", "consentIntro"], rare: ["intro", "showTiers", "othersTitle", "consentIntro"], advanced: ["category"], defaults: { provider: "patreon", publicPage: false, review: true, showTiers: true } },
  countdown: { keys: ["timezone", "keep", "endMessage", "pageTitle", "showSeconds", "overlayLook", "overlayPosition", "overlaySize", "overlayAccent", "overlayEndMinutes"], rare: ["keep", "overlayLook", "overlayPosition", "overlaySize", "overlayAccent", "overlayEndMinutes"], advanced: [], defaults: { timezone: "Europe/Paris", keep: "1d", showSeconds: true, overlayLook: "dark", overlayPosition: "top-center", overlaySize: "m", overlayEndMinutes: 5 } },
  "home-assistant": { keys: ["expirySeconds", "maxChars", "viewerDelaySeconds", "globalDelaySeconds", "prefixViewer", "blockNumbers", "useDefaultWords", "extraWords", "allowedWords"], rare: ["expirySeconds", "maxChars", "viewerDelaySeconds", "globalDelaySeconds"], advanced: ["extraWords", "allowedWords"], defaults: { expirySeconds: 60, maxChars: 140, viewerDelaySeconds: 60, globalDelaySeconds: 10, prefixViewer: true, blockNumbers: true, useDefaultWords: true } },
  videos: { keys: ["vocabPlural", "vocabOne", "vocabSeries", "vocabSeriesOne", "vocabFree", "intro", "thumbs", "share"], rare: ["vocabPlural", "vocabOne", "vocabSeries", "vocabSeriesOne", "vocabFree"], advanced: [], defaults: { thumbs: "copy", share: true } },
  events: { keys: ["timezone", "intro", "wordOne", "wordMany", "pastTitle", "showPast", "subscribe", "mapLink"], rare: ["wordOne", "wordMany", "pastTitle", "subscribe", "mapLink"], advanced: [], defaults: { timezone: "Europe/Paris", showPast: true, subscribe: true, mapLink: true } },
  testimonials: { keys: ["title", "intro", "display", "order", "ratingMode", "showAverage", "askEmail", "notify"], rare: ["order", "showAverage", "askEmail"], advanced: [], defaults: { display: "grid", order: "favorites", ratingMode: "optional", showAverage: true, askEmail: false, notify: true } },
};

for (const [id, exp] of Object.entries(EXPECTED)) {
  test(`[${id}] réglages rangés sous « Plus d'options » ou en avancé : aucune clé perdue, aucun défaut changé, 7 réglages simples au plus`, () => {
    const m = read(id);
    const byKey = new Map(m.settings.map((s) => [s.key, s]));
    for (const k of exp.keys) assert.ok(byKey.has(k), `la clé « ${k} » doit rester`);
    for (const k of exp.rare) { assert.equal(byKey.get(k).rare, true, `${k} est rare`); assert.ok(!byKey.get(k).advanced, `${k} : pas rare ET avancé`); }
    for (const k of exp.advanced) assert.equal(byKey.get(k).advanced, true, `${k} est avancé`);
    for (const [k, v] of Object.entries(exp.defaults)) assert.deepEqual(byKey.get(k).default, v, `le défaut de « ${k} » ne change pas`);
    assert.ok(["0.6.0", "0.11.0"].includes(m.minCore), "`rare` demande le cœur 0.6.0 (0.11.0 pour les éléments à l'échelle TV)");
    const perTab = new Map();
    for (const s of m.settings) if (!s.advanced && !s.rare) { const k = `${s.tab ?? "settings"}${s.group === "appearance" ? "/apparence" : ""}`; perTab.set(k, (perTab.get(k) ?? 0) + 1); }
    for (const [tab, n] of perTab) assert.ok(n <= 7, `${tab} : ${n} réglages simples`);
  });
}

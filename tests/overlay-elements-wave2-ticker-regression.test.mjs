// Non-régression des modules « Overlay défilant » (ticker-overlay), « Témoignages » (testimonials) et « Mascotte » (mascot) à l'arrivée de leurs éléments de page d'overlay (cœur 0.5.0) :
// pages publiques, accueil, adresses, réglages, outils MCP, overlay existant, script de la mascotte : tout doit rester identique, octet pour octet.
// Les empreintes ci-dessous ont été prises sur la version 363a6e5 (dépôt 1.26.0), AVANT toute modification de ces trois modules.
// Horloge simulée (Date fixe). Ce qui dépend légitimement de la version du module (version, minCore, clé overlayElements, empreinte d'adresse du script de la mascotte) est mis à part.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 16);
const read = (m, p) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${p}`, import.meta.url), "utf8"));
const json = (v) => JSON.parse(JSON.stringify(v));
/** Le manifeste sans ce que les éléments d'overlay ajoutent. */
const manifestRest = (m) => { const { version, minCore, overlayElements, previews, ...rest } = m; return rest; };

async function withClock(fn) {
  const real = Date.now; Date.now = () => NOW;
  try { return await fn(); } finally { Date.now = real; }
}

// ── Overlay défilant ────────────────────────────────────────────────────────────────────────────────────────────────
async function tickerSnapshot() {
  const tk = (await import("../modules/ticker-overlay/index.mjs")).default;
  const m = read("ticker-overlay", "module.json");
  const topics = { "core.entry": [{ title: "Article", summary: "Résumé", cover: "https://cdn.test/a.png" }, { title: "Promo", code: "ABC", summary: "ignoré", cover: "/uploads/p.png" }], "overlay.item": [{ title: "Annonce", text: "Ce soir", image: "https://cdn.test/i.png" }, { title: "Seul" }] };
  const ctx = (settings = {}, o = {}) => fakeCtx({ key: "ticker", name: "Mon ticker", locale: "fr", settings, topics, ...o });
  const out = { manifest: sha(manifestRest(m)), keys: Object.keys(tk).filter((k) => k !== "overlayElements").sort(), routes: Object.keys(tk.routes).filter((k) => k !== "element/:slug").sort() };
  const take = (r) => [sha(r.title), sha(r.html), sha(r.css), sha(r.script)].join(".");
  out.overlays = {
    default: take(tk.overlay(ctx(), { query: new URLSearchParams() })),
    right: take(tk.overlay(ctx({ interval: 5, position: "top-right", textColor: "#ff0000", cardColor: "#00ff00" }), { query: new URLSearchParams() })),
    en: take(tk.overlay(ctx({ interval: 30, position: "bottom-right" }, { key: "abc", locale: "en", name: "Autre" }), { query: new URLSearchParams() })),
    hostile: take(tk.overlay(ctx({ interval: "abc", position: "n'importe quoi", textColor: "red" }, { key: "x</script>", name: "<b>N</b>" }), { query: new URLSearchParams("a=1") })),
  };
  const items = async (c) => { const r = await tk.routes.items(new Request("https://x.test/m/ticker/items?lang=fr"), c); return [r.status, r.headers.get("cache-control"), sha(await r.text())].join("."); };
  out.items = { all: await items(ctx()), empty: await items(fakeCtx({})), bad: await items(ctx({}, { topics: { "core.entry": [{ title: "</script>", summary: "<img>", cover: "javascript:1" }], "overlay.item": [{ title: 12 }] } })) };
  return out;
}

// ── Témoignages ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function testimonialsSnapshot() {
  const T = await import("./helpers/testimonials.mjs");
  const { def, ctxFor, seed } = T;
  const m = read("testimonials", "module.json");
  const out = { manifest: sha(manifestRest(m)), keys: Object.keys(def).filter((k) => k !== "overlayElements").sort(), routes: Object.keys(def.routes).filter((k) => k !== "element/:slug").sort(), scenes: {} };
  for (const [display, locale] of [["grid", "en"], ["slow", "fr"], ["grid", "fr"]]) {
    const ctx = ctxFor({ settings: { display, order: "favorites", showAverage: true, perPage: 4 }, locale });
    const people = ["Camille", "Alex", "Sam", "Lou", "Mia", "Noa", "Eli"];
    for (let i = 0; i < people.length; i++) {
      await seed(ctx, { name: people[i], text: `Avis numéro ${i} <b>très</b> sympa & chaleureux.`, rating: i === 5 ? null : (i % 5) + 1, featured: i === 1 || i === 4, at: NOW - (i + 1) * 86_400_000 });
    }
    await seed(ctx, { name: "Refusé", status: "rejected", text: "Un avis refusé", at: NOW - 5000 });
    await seed(ctx, { name: "Attente", status: "pending", text: "Un avis en attente", at: NOW - 4000 });
    await seed(ctx, { name: "SansAccord", status: "approved", text: "Sans accord", consent: { text: "", at: "", locale: "", by: "" }, at: NOW - 3000 });
    const scene = {};
    for (const segs of [[], ["page", "2"], ["tous"], ["etoiles", "5"], ["laisser"]]) scene[segs.join("/") || "main"] = json(await def.page(ctx, { segments: segs }));
    scene.featured = json(await def.sections.featured(ctx, { count: 3, layout: "slow" }));
    scene.featuredGrid = json(await def.sections.featured(ctx, { count: 2, layout: "grid" }));
    scene.rating = json(await def.sections.rating(ctx));
    scene.invite = json(await def.sections.invite(ctx));
    scene.overlayItem = json(await def.exports["overlay.item"](ctx, { limit: 5 }));
    scene.mcpSummary = json(await def.mcp.testimonials_summary(ctx));
    scene.mcpList = json((await def.mcp.testimonials_list(ctx, { status: "all", limit: 4 })).items.map(({ id, ...rest }) => rest));
    scene.admin = json(await def.adminPanel(ctx, { query: {} }));
    out.scenes[`${display}-${locale}`] = Object.fromEntries(Object.entries(scene).map(([k, v]) => [k, sha(v)]));
  }
  return out;
}

// ── Mascotte ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function mascotSnapshot() {
  const K = await import("./helpers/mascotKit.mjs");
  const { def, publishedCtx, ctxFor, assets: A, store: S, get, eventSource, inDays } = K;
  const m = read("mascot", "module.json");
  const out = { manifest: sha(manifestRest(m)), keys: Object.keys(def).filter((k) => k !== "overlayElements").sort(), routes: Object.keys(def.routes).filter((k) => k !== "element/:slug").sort(), scenes: {} };
  // Ce qui dépend de la version du module (empreintes d'adresse du script et de la feuille de style) est neutralisé : le script et la feuille de style, eux, sont comparés en entier.
  const unversioned = (s) => String(s).replace(/(mascot\.(?:css|js)[^"'\s]*?[?&]v=)[0-9a-f]{8}/g, "$1#");
  for (const locale of ["fr", "en"]) {
    const ctx = await publishedCtx({ corner: "left", where: "all" }, { locale, services: { ...eventSource([{ id: "e1", title: "Gros stream", start: inDays(3), url: "https://example.org/e" }]) } });
    await S.saveConfig(ctx, { names: { fr: "Pixel", en: "Pixie" } });
    const built = await A.buildClient(ctx);
    const scene = { cfg: unversioned(JSON.stringify(built.cfg)), code: unversioned(built.code), css: A.CSS };
    const head = await def.slots["layout.head"](ctx);
    scene.head = unversioned(JSON.stringify(head));
    scene.footer = unversioned(JSON.stringify(await def.slots["layout.footer"](ctx)));
    const lines = async (path) => { const r = await def.routes.lines(get(`/m/x/lines?path=${encodeURIComponent(path)}`), ctx); return [r.status, r.headers.get("cache-control"), await r.text()].join("|"); };
    scene.lines = [await lines("/"), await lines("/faq"), await lines("/blog/x")];
    const js = await def.routes["mascot.js"](get(`/m/x/mascot.js?v=${built.hash}`), ctx);
    scene.js = [js.status, js.headers.get("content-type"), js.headers.get("cache-control"), unversioned(await js.text())];
    const css = await def.routes["mascot.css"](get(`/m/x/mascot.css?v=${A.cssHash}`), ctx);
    scene.cssRoute = [css.status, css.headers.get("content-type"), await css.text()];
    scene.admin = json(await def.adminPanel(ctx, { query: {} }));
    scene.phrases = json((await S.loadPhrases(ctx)).map(({ id, ...p }) => p));
    scene.mcp = json(await def.mcp.mascot_phrases_list(ctx, {}));
    out.scenes[locale] = Object.fromEntries(Object.entries(scene).map(([k, v]) => [k, sha(typeof v === "string" ? v : JSON.stringify(v))]));
  }
  // Brouillon : les pages ne chargent rien.
  const draft = ctxFor();
  await def.hooks.onInstanceCreate(draft);
  out.draftHead = await def.slots["layout.head"](draft);
  return out;
}

const GOLDEN = {
  "ticker": {
    "manifest": "9b9adf74ab91d338",
    "keys": [
      "overlay",
      "routes"
    ],
    "routes": [
      "items"
    ],
    "overlays": {
      "default": "419bdd45bea2bdf8.76684f100a44a90e.0a87084bcdfea2d8.fbd8089027f8f0db",
      "right": "419bdd45bea2bdf8.76684f100a44a90e.315f6e7b3a9433b1.c80ffe2abdcf6ee3",
      "en": "eb72e1683b81c924.76684f100a44a90e.bb4faa819e6d7258.c095333c89788a23",
      "hostile": "dc9eebcf0e01a348.76684f100a44a90e.0a87084bcdfea2d8.1cc4f42e404a0eca"
    },
    "items": {
      "all": "200.no-store.8f4ffaed71e1d2f1",
      "empty": "200.no-store.eef46741adfc3a9f",
      "bad": "200.no-store.6c588b8759cebd7f"
    }
  },
  "testimonials": {
    "manifest": "9592b5b21c60ba7c",
    "keys": [
      "adminActions",
      "adminBadge",
      "adminDownloads",
      "adminPanel",
      "backup",
      "exports",
      "hooks",
      "mcp",
      "page",
      "routes",
      "sections",
      "tasks"
    ],
    "routes": [
      "qr",
      "send",
      "withdraw"
    ],
    "scenes": {
      "grid-en": {
        "main": "dc3706d63219d95d",
        "page/2": "9784cb9bd5fc1ae2",
        "tous": "0a12f32df58beec1",
        "etoiles/5": "9ca82bf9a2cb0ffe",
        "laisser": "0a93425047ff757c",
        "featured": "8d98c12d4679b9ce",
        "featuredGrid": "778b32754faec377",
        "rating": "2cafefd7c5d9b8d3",
        "invite": "a903a89553836a7e",
        "overlayItem": "cae58c6fb6a61775",
        "mcpSummary": "7891def77e41e38b",
        "mcpList": "0a91373e8d373683",
        "admin": "750486b3e0e18b3e"
      },
      "slow-fr": {
        "main": "41d1b3b2eebdcc2d",
        "page/2": "0a12f32df58beec1",
        "tous": "395c2827079aad53",
        "etoiles/5": "c5257d23ea40dd44",
        "laisser": "bd4b7b73dd96896b",
        "featured": "8ede8c8874ab7b0a",
        "featuredGrid": "9c9a86b69e7b5e14",
        "rating": "0983e22494952c2a",
        "invite": "33652af72c05c38d",
        "overlayItem": "a5d2a7e99e43787c",
        "mcpSummary": "7891def77e41e38b",
        "mcpList": "0a91373e8d373683",
        "admin": "c7db373958afa187"
      },
      "grid-fr": {
        "main": "30bb0b500b5d2f36",
        "page/2": "6ef48b0133e0796b",
        "tous": "0a12f32df58beec1",
        "etoiles/5": "c5257d23ea40dd44",
        "laisser": "86b9b9b769d39456",
        "featured": "23655908845b287a",
        "featuredGrid": "989390b9e2f4b959",
        "rating": "0983e22494952c2a",
        "invite": "33652af72c05c38d",
        "overlayItem": "a5d2a7e99e43787c",
        "mcpSummary": "7891def77e41e38b",
        "mcpList": "0a91373e8d373683",
        "admin": "ca5c1f73ec741848"
      }
    }
  },
  "mascot": {
    "manifest": "0a6b2ef83eb5ab64",
    "keys": [
      "adminActions",
      "adminPanel",
      "backup",
      "hooks",
      "mcp",
      "routes",
      "slots"
    ],
    "routes": [
      "lines",
      "mascot.css",
      "mascot.js"
    ],
    "scenes": {
      "fr": {
        "cfg": "ff06b40f952c9a9f",
        "code": "b2a93a6dde7de1e0",
        "css": "4cdeec6964b1df8f",
        "head": "fb6f86fd1c87dbad",
        "footer": "74234e98afe7498f",
        "lines": "a9868ed5f3d02f91",
        "js": "82346ba7741261ce",
        "cssRoute": "e9fac6e255e3d5db",
        "admin": "77d69429f26c7698",
        "phrases": "73c3a8055b0f7c1e",
        "mcp": "5a457d7924ceecdc"
      },
      "en": {
        "cfg": "447adf9dd1178351",
        "code": "606251976daad931",
        "css": "4cdeec6964b1df8f",
        "head": "d9c657c01be7ac11",
        "footer": "74234e98afe7498f",
        "lines": "fd2e39c77a231d53",
        "js": "2cb5bd46390d87c1",
        "cssRoute": "e9fac6e255e3d5db",
        "admin": "140e42eb3abe9711",
        "phrases": "73c3a8055b0f7c1e",
        "mcp": "5a457d7924ceecdc"
      }
    },
    "draftHead": null
  }
};

for (const [name, fn] of [["ticker", tickerSnapshot], ["testimonials", testimonialsSnapshot], ["mascot", mascotSnapshot]]) {
  test(`non-régression : ${name} rend exactement la même chose qu'avant ses éléments d'overlay`, async () => {
    const got = await withClock(fn);
    if (process.env.PRINT_GOLDEN) console.log(`GOLDEN_${name}=` + JSON.stringify(got, null, 2));
    assert.deepEqual(got, GOLDEN[name]);
  });
}

test("non-régression : réglages, type, instances et permissions de ces trois modules n'ont pas changé", () => {
  const keys = (m) => read(m, "module.json").settings.map((s) => s.key);
  assert.deepEqual(keys("ticker-overlay"), ["interval", "textColor", "cardColor", "position"]);
  assert.deepEqual(keys("testimonials"), ["title", "intro", "display", "order", "ratingMode", "showAverage", "askEmail", "notify", "perPage", "maxLength", "rateLimit", "emailDays", "structuredData", "aboutName", "aboutType"]);
  assert.deepEqual(keys("mascot"), ["where", "pages", "corner", "announce", "footerLink", "delay", "show", "max"]);
  const info = (m) => { const j = read(m, "module.json"); return [j.type, j.instances, j.page ?? null, j.basePath ?? null, [...j.permissions].sort()]; };
  assert.deepEqual(info("ticker-overlay"), ["overlay", "multiple", null, null, ["overlay", "routes", "topics"]]);
  assert.deepEqual(info("testimonials"), ["widget", "single", true, "avis", ["admin", "mail", "mcp", "pages", "routes", "sections", "storage", "topics"]]);
  assert.deepEqual(info("mascot"), ["widget", "single", false, null, ["admin", "mcp", "routes", "slots", "storage", "topics"]]);
});

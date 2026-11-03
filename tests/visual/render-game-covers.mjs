// Captures de l'administration de Jaquettes de jeux 1.3.0 (sources, jaquettes gardées, choix d'un jeu, états de panne) avec les VRAIS composants du cœur (Blocks, AdminTable, AdminBlockForm), rendus sans JavaScript.
// Non lancé par npm test. Dans le dossier du cœur (CURIOSA_DIR, avec node_modules, une base de test et le CSS compilé) :
//   DATABASE_URL=file:/dev/shm/shots/db.sqlite node --import ./tests/helpers/register.mjs <ce dépôt>/tests/visual/render-core.mjs <dossier de pages> <fichier app.css>
// puis tests/visual/shoot-core.cjs pour les captures (1280 et 390 px, clair et sombre).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";

const CORE = process.env.CURIOSA_DIR ?? process.cwd();
const { renderToStaticMarkup } = createRequire(`${CORE}/package.json`)("react-dom/server");
const OUT = process.argv[2];
const CSS = fs.readFileSync(process.argv[3], "utf8");
const { Blocks } = await import(`${CORE}/src/components/site/Blocks.tsx`);
const { adminThemeCss } = await import(`${CORE}/src/core/adminTheme.ts`);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "../..");
fs.mkdirSync(OUT, { recursive: true });

const page = (title, body, theme, open) => `<!doctype html><html lang="fr" data-admin-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${CSS}</style><style>${adminThemeCss()}</style></head>
<body class="min-h-screen bg-bg text-fg antialiased"><main class="mx-auto max-w-5xl space-y-6 p-4 md:p-6"><h1 class="text-2xl font-semibold">${title}</h1>${open ? body.replace(/<details/g, "<details open") : body}</main></body></html>`;

/** Aucune image réelle : toute adresse d'image (copie du site ou source) devient une illustration dessinée, de couleur stable. */
const art = (seed) => { let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const a = h % 360, b = (a + 70) % 360; return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='72' height='96' viewBox='0 0 72 96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a} 60% 45%)'/><stop offset='1' stop-color='hsl(${b} 60% 30%)'/></linearGradient></defs><rect width='72' height='96' fill='url(#g)'/><circle cx='36' cy='40' r='14' fill='rgba(255,255,255,.35)'/><rect x='14' y='68' width='44' height='6' rx='3' fill='rgba(255,255,255,.55)'/></svg>`)}`; };
const drawn = (h) => h.replace(/(src=")(?:\/m\/[^"/]+\/cover\/[0-9a-f]{16}|https:\/\/(?:media\.rawg\.io|static-cdn\.jtvnw\.net|shared\.akamai\.steamstatic\.com)\/[^"]+)(")/g, (_, a, b) => `${a}${art(_ + b + h.length)}${b}`);
async function html(blocks, tab) {
  const mine = blocks.filter((b) => (tab ? b.tab === tab : !b.tab || b.tab === "use"));
  return drawn(renderToStaticMarkup(await Blocks({ blocks: mine, locale: "fr", adminInstanceId: "i1" })));
}
async function write(name, title, blocks, { tab, open = false } = {}) {
  const body = await html(blocks, tab);
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `${name}-${theme}.html`), page(title, body, theme, open));
  console.log(name, body.length);
}

/* ───── Jaquettes de jeux : données inventées ───── */
const mod = (await import(path.join(root, "modules/game-covers/index.mjs"))).default;
const fx = await import(path.join(root, "modules/game-covers/fixes.mjs"));
const cp = await import(path.join(root, "modules/game-covers/copies.mjs"));
const { titleKey } = await import(path.join(root, "modules/game-covers/match.mjs"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "modules/game-covers/module.json"), "utf8"));
const fr = JSON.parse(fs.readFileSync(path.join(root, "modules/game-covers/locales/fr.json"), "utf8"));
const NOW = Date.parse("2026-11-03T10:00:00Z");
const names = ["Celeste", "Hollow Knight", "Hades", "Outer Wilds", "Stardew Valley", "Tunic", "Dave the Diver", "Disco Elysium", "Inscryption", "Hi-Fi Rush", "Cult of the Lamb", "Pizza Tower", "Vampire Survivors", "Baba Is You", "Return of the Obra Dinn", "Dead Cells"];
const SRC = ["rawg", "rawg", "twitch", "steam"];
const PATH = { rawg: (i) => `/media/games/0${i % 90 + 10}/jeu-${i}.jpg`, twitch: (i) => `/ttv-boxart/${1000 + i}_IGDB-285x380.jpg`, steam: (i) => `/store_item_assets/steam/apps/${2000 + i}/library_600x900.jpg` };
const fetchFake = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "api.rawg.io") return Response.json({ results: [1, 2].map((k) => ({ id: 300 + k, name: k === 1 ? "Hades" : "Hades II", released: k === 1 ? "2020-09-17" : "2024-05-06", platforms: [{ platform: { name: "PC" } }], background_image: `https://media.rawg.io/media/games/0${k}0/jeu-${k}.jpg` })) });
  if (u.hostname === "store.steampowered.com") return Response.json({ total: 2, items: [{ type: "app", name: "Hades II", id: 1145350 }, { type: "app", name: "Hades", id: 1145360 }] });
  return new Response(null, { status: 404 });
};
const twitch = { status: () => ({ ready: true }), request: () => ({ ok: true, status: 200, json: { data: [{ id: "509658", name: "Hades", box_art_url: "https://static-cdn.jtvnw.net/ttv-boxart/509658-52x72.jpg" }] } }) };
const mk = ({ rawgKey = "FAKE-KEY-0123456789", twitchOn = true, steam = true } = {}) => {
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Jaquettes", messages: fr, locale: "fr", settings: { rawgKey, useSteam: steam }, logEvents: manifest.logEvents, services: twitchOn ? { "twitch.api": twitch } : {} });
  c.can = () => true;
  return c;
};
async function world(opts, { rawgDown = false, empty = false } = {}) {
  const c = mk(opts);
  if (empty) return c;
  for (const [i, n] of names.entries()) {
    const at = new Date(NOW - (i + 1) * 3_600_000 * 7).toISOString();
    const src = opts.rawgKey === "" && SRC[i % 4] === "rawg" ? "steam" : SRC[i % 4];
    const key = titleKey(n);
    const img = PATH[src](i);
    const extra = src === "rawg" ? { rawgId: 100 + i } : { src, srcId: 500 + i };
    if (i % 5 === 0) await c.api.store.add("fixes", { title: n, kind: i % 10 === 0 && src === "rawg" ? "game" : "image", name: n, img, ...extra, at }, { key });
    else await c.api.store.add("autoCovers", { title: n, name: n, img, ambiguous: false, candidates: 2, ...extra, at, until: new Date(NOW + 3_600_000).toISOString() }, { key });
    await c.api.store.add("coverMeta", { id: cp.idOf(key), key, src, img, type: "image/jpeg", bytes: 52_000, at: NOW - 3_600_000 }, { key: cp.idOf(key) });
  }
  await c.api.store.add("todo", { key: "playrooms", title: "Playrooms", name: "Astro's Playroom", rawgId: 11, img: "/media/games/003/c.jpg", candidates: 4, at: new Date(NOW - 3_600_000).toISOString() }, { key: "playrooms" });
  await fx.writeOne(c, "keyState", rawgDown ? { state: "unreachable", at: new Date(NOW - 600_000).toISOString(), okAt: new Date(NOW - 3 * 3_600_000).toISOString() } : { state: "ok", at: new Date(NOW - 600_000).toISOString(), okAt: new Date(NOW - 600_000).toISOString() });
  return c;
}
globalThis.fetch = fetchFake;
const ok = await world({}), noKey = await world({ rawgKey: "" }), down = await world({}, { rawgDown: true });
const alone = await world({ twitchOn: false, steam: false }, { rawgDown: true });
const none = await world({ rawgKey: "", twitchOn: false, steam: false }, { empty: true });
await write("jaq-fonctionne", "Jaquettes de jeux : toutes les sources", await mod.adminPanel(ok, { query: {} }));
await write("jaq-sans-code", "Jaquettes de jeux : sans code Rawg (aucun blocage)", await mod.adminPanel(noKey, { query: {} }));
await write("jaq-une-source-en-panne", "Jaquettes de jeux : Rawg en panne, les autres répondent", await mod.adminPanel(down, { query: {} }));
await write("jaq-injoignable", "Jaquettes de jeux : plus aucune source ne répond", await mod.adminPanel(alone, { query: {} }));
await write("jaq-aucune-source", "Jaquettes de jeux : aucune source disponible", await mod.adminPanel(none, { query: {} }));
await write("jaq-gardees", "Jaquettes gardées", await mod.adminPanel(ok, { query: { tab: "saved" } }), { tab: "saved" });
await write("jaq-gardees-sans-code", "Jaquettes gardées : sans code Rawg", await mod.adminPanel(noKey, { query: { tab: "saved" } }), { tab: "saved" });
await write("jaq-choisir", "Quel est le bon jeu ? (toutes les sources)", await mod.adminPanel(ok, { query: { tab: "saved", titre: "Hades" } }), { tab: "saved" });
await write("jaq-voir", "Voir une jaquette gardée", await mod.adminPanel(ok, { query: { tab: "saved", voir: "Hollow Knight" } }), { tab: "saved" });
await write("jaq-oublier", "Oublier une jaquette gardée", await mod.adminPanel(ok, { query: { tab: "saved", oublier: "Outer Wilds" } }), { tab: "saved" });

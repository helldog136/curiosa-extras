// Captures de l'administration de Jaquettes de jeux (états « tout fonctionne » et « RAWG ne répond pas ») avec les VRAIS composants du cœur (Blocks, AdminTable, AdminBlockForm), rendus sans JavaScript.
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

async function html(blocks, tab) {
  const mine = blocks.filter((b) => (tab ? b.tab === tab : !b.tab || b.tab === "use"));
  return renderToStaticMarkup(await Blocks({ blocks: mine, locale: "fr", adminInstanceId: "i1" }));
}
async function write(name, title, blocks, { tab, open = false } = {}) {
  const body = await html(blocks, tab);
  for (const theme of ["light", "dark"]) fs.writeFileSync(path.join(OUT, `${name}-${theme}.html`), page(title, body, theme, open));
  console.log(name, body.length);
}

/* ───── Jaquettes de jeux : données inventées ───── */
const mod = (await import(path.join(root, "modules/game-covers/index.mjs"))).default;
const fx = await import(path.join(root, "modules/game-covers/fixes.mjs"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "modules/game-covers/module.json"), "utf8"));
const fr = JSON.parse(fs.readFileSync(path.join(root, "modules/game-covers/locales/fr.json"), "utf8"));
const NOW = Date.parse("2026-11-03T10:00:00Z");
const names = ["Celeste", "Hollow Knight", "Hades", "Outer Wilds", "Stardew Valley", "Tunic", "Dave the Diver", "Disco Elysium", "Inscryption", "Hi-Fi Rush", "Cult of the Lamb", "Pizza Tower", "Vampire Survivors", "Baba Is You", "Return of the Obra Dinn", "Dead Cells"];
const mk = () => {
  const c = fakeCtx({ moduleId: "game-covers", key: "game-covers", name: "Jaquettes", messages: fr, locale: "fr", settings: { rawgKey: "FAKE-KEY-0123456789" }, logEvents: manifest.logEvents });
  c.can = () => true;
  return c;
};
async function world(state) {
  const c = mk();
  for (const [i, n] of names.entries()) {
    const at = new Date(NOW - (i + 1) * 3_600_000 * 7).toISOString();
    if (i % 5 === 0) await c.api.store.add("fixes", { title: n, kind: i % 10 === 0 ? "game" : "none", ...(i % 10 === 0 ? { rawgId: 100 + i, name: n, img: "/media/games/001/a.jpg" } : {}), at }, { key: n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() });
    else await c.api.store.add("autoCovers", { title: n, name: n, rawgId: 200 + i, img: "/media/games/002/b.jpg", ambiguous: false, candidates: 2, at, until: new Date(NOW + 3_600_000).toISOString() }, { key: n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() });
  }
  await c.api.store.add("todo", { key: "playrooms", title: "Playrooms", name: "Astro's Playroom", rawgId: 11, img: "/media/games/003/c.jpg", candidates: 4, at: new Date(NOW - 3_600_000).toISOString() }, { key: "playrooms" });
  const okAt = new Date(NOW - 3 * 3_600_000).toISOString();
  await fx.writeOne(c, "keyState", state === "ok" ? { state: "ok", at: new Date(NOW - 600_000).toISOString(), okAt: new Date(NOW - 600_000).toISOString() } : { state: "unreachable", at: new Date(NOW - 600_000).toISOString(), okAt });
  return c;
}
const ok = await world("ok"), down = await world("down");
await write("jaq-fonctionne", "Jaquettes de jeux : tout fonctionne", await mod.adminPanel(ok, { query: {} }));
await write("jaq-injoignable", "Jaquettes de jeux : RAWG ne répond pas", await mod.adminPanel(down, { query: {} }));
await write("jaq-enregistrees-injoignable", "Jaquettes enregistrées : RAWG ne répond pas", await mod.adminPanel(down, { query: {} }), { tab: "saved" });
await write("jaq-enregistrees-fonctionne", "Jaquettes enregistrées : tout fonctionne", await mod.adminPanel(ok, { query: { tab: "saved" } }), { tab: "saved" });
await write("jaq-voir-automatique", "Voir une jaquette trouvée toute seule", await mod.adminPanel(down, { query: { tab: "saved", voir: "Hollow Knight" } }), { tab: "saved" });
await write("jaq-oublier", "Oublier une jaquette trouvée toute seule", await mod.adminPanel(down, { query: { tab: "saved", oublier: "Outer Wilds" } }), { tab: "saved" });

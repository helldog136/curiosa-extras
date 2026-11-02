// Captures des administrations de Suggestions de jeux et du Jeu du jour avec les VRAIS composants du cœur (Blocks, AdminTable, AdminBlockForm), rendus sans JavaScript.
// Non lancé par npm test. Dans le dossier du cœur (CURIOSA_DIR, avec node_modules, une base de test et le CSS compilé) :
//   DATABASE_URL=file:/dev/shm/shots/db.sqlite node --import ./tests/helpers/register.mjs <ce dépôt>/tests/visual/render-core.mjs <dossier de pages> <fichier app.css>
// puis tests/visual/shoot-core.cjs pour les captures (1280 et 390 px, clair et sombre).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeCtx } from "../helpers/fakeCtx.mjs";
import { ctxFor, addQuestion, D, NOON } from "../helpers/dailyGameKit.mjs";

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

/* ───── Suggestions de jeux : 34 suggestions de statuts variés ───── */
const gsMod = (await import(path.join(root, "modules/game-suggestions/index.mjs"))).default;
const gsMsg = JSON.parse(fs.readFileSync(path.join(root, "modules/game-suggestions/locales/fr.json"), "utf8"));
const gs = fakeCtx({ key: "gs", basePath: "suggestions", moduleId: "game-suggestions", locale: "fr", messages: gsMsg, settings: {}, rawgConfigured: true, rawgCover: { status: "none", url: null } });
const names = ["Celeste", "Hollow Knight", "Hades", "Outer Wilds", "Stardew Valley", "Tunic", "Dave the Diver", "Disco Elysium", "Return of the Obra Dinn", "Baba Is You", "Inscryption", "Hi-Fi Rush", "Cult of the Lamb", "Pizza Tower", "Vampire Survivors", "Slay the Spire", "Balatro", "Animal Well", "Lethal Company", "Content Warning", "Cocoon", "Dredge", "Sea of Stars", "Pseudo-jeu avec un titre vraiment très long qui ne tient pas sur une ligne du tableau", "Lies of P", "Fez", "Tetris Effect", "Superhot", "Untitled Goose Game", "Return to Monkey Island", "The Witness", "Disco Dungeon", "Loop Hero", "Noita"];
const statuses = ["proposed", "proposed", "proposed", "planned", "accepted", "already_played", "finished", "rejected"];
const by = ["Alex", "Camille", "Sam", "", "Noa", "Robin"];
for (const [i, title] of names.entries()) {
  const admin = i % 7 === 3;
  await gs.api.store.add("games", { title, status: statuses[i % statuses.length], ...(admin ? { origin: "admin" } : { submitterName: by[i % by.length] }), note: i % 4 === 0 ? "Un classique, à faire absolument" : undefined, replayVotes: i % 5 === 0 ? i : 0, coverUrl: i % 9 === 0 ? null : "https://media.example.test/c.jpg" });
}
await write("gs-liste", "Suggestions de jeux", await gsMod.adminPanel(gs, { query: {} }));
await write("gs-liste-ouvert", "Suggestions de jeux (Plus d'options ouvert)", await gsMod.adminPanel(gs, { query: {} }), { open: true });
await write("gs-plusieurs", "Suggestions de jeux (plusieurs jeux)", await gsMod.adminPanel(gs, { query: { ajout: "plusieurs" } }));

/* ───── Jeu du jour : 30 questions, deux langues ───── */
D.clock.now = () => NOON;
const dg = ctxFor({}, { rights: ["edit", "publish", "moderate"] });
const cats = ["Histoire", "Jeux vidéo", "Science", "Cinéma", "Géographie"];
for (let i = 1; i <= 30; i++) await addQuestion(dg, { q: `Question numéro ${i} : de quelle couleur est le ciel un jour de ${["beau", "grand", "petit"][i % 3]} temps ?`, a: ["Bleu", "Vert", "Rouge"], correct: 1, cat: cats[i % 5], lvl: ["easy", "medium", "hard", ""][i % 4], status: i % 9 === 0 ? "draft" : "published", pos: i, ...(i === 5 ? { date: "2026-12-25" } : {}), ...(i === 7 ? { en: { q: "Seul le français est écrit", a: ["x", "y"], e: "", alt: "" } } : {}) });
const dgMod = await import(path.join(root, "modules/daily-game/index.mjs"));
const dgPanel = (q, c = dg) => dgMod.default.adminPanel(c, { query: q });
await write("dg-liste", "Jeu du jour", await dgPanel({}));
await write("dg-nouvelle", "Jeu du jour : nouvelle question", await dgPanel({ new: "1" }));
await write("dg-nouvelle-ouvert", "Jeu du jour : nouvelle question (tout ouvert)", await dgPanel({ new: "1" }), { open: true });
await write("dg-packs", "Jeu du jour : packs et fichiers", await dgPanel({}), { tab: "tools" });
const empty = ctxFor({}, { rights: ["edit", "publish", "moderate"] });
await write("dg-depart", "Jeu du jour (premier pas)", await dgPanel({}, empty));

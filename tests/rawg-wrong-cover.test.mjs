// « Ce n'est pas le bon jeu ? » (cœur 0.2.10) : un lien discret vers /admin/settings/rawg-covers?titre=<titre encodé>, dans l'ADMINISTRATION seulement, quand RAWG n'est pas sûr du jeu
// (`ambiguous`). Planning (admin), Suggestions de jeux (admin, avec mise à jour après correction) et Story d'annonce (route `cover` ; l'éditeur est testé dans stream-story-events-editor).
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { vevent, calendar, feedTopics } from "./helpers/icalFeed.mjs";
import { makeTempDir } from "./helpers/tmp.mjs";

mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T10:00:00Z") });
after(() => mock.timers.reset());

const readJson = (m, f) => JSON.parse(fs.readFileSync(new URL(`../modules/${m}/${f}`, import.meta.url), "utf8"));
const COVER = "https://media.rawg.io/media/games/abc/abcdef0123456789.jpg";
const HREF = (t) => `/admin/settings/rawg-covers?titre=${t}`;
const FOUND = { status: "found", url: COVER, name: "Une autre histoire", id: 7 };

/* ───────────── Planning ───────────── */
const planning = (await import("../modules/planning/index.mjs")).default;
const planningMod = await import("../modules/planning/index.mjs");
const hours = (n) => new Date(Date.now() + n * 3_600_000);
let feed = "";
const pctx = (lang, over = {}) => fakeCtx({ settings: { days: 7, timezone: "UTC" }, topics: feedTopics(() => feed), messages: readJson("planning", `locales/${lang}.json`), locale: lang, rawgConfigured: true, ...over });
const textOf = (blocks) => blocks.filter((b) => b.type === "markdown").map((b) => b.text).join("\n");

test("Planning : jaquette ambiguë → lien « Ce n'est pas le bon jeu ? » avec le titre encodé (espaces, accents, ( ) ! ' &), FR et EN", async () => {
  const title = "Zelda (Tears) & l'été !";
  feed = calendar(vevent("1", hours(2), hours(3), "Soirée", [`DESCRIPTION:Jeu: ${title}`]));
  const fr = textOf(await planning.adminPanel(pctx("fr", { rawgCover: { ...FOUND, ambiguous: true } })));
  assert.ok(fr.includes("Ce n'est pas le bon jeu ?"), fr);
  const encoded = encodeURIComponent(title).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  assert.ok(fr.includes(`](${HREF(encoded)})`), "le titre est encodé, sans parenthèse ni apostrophe brute dans le lien");
  assert.equal(decodeURIComponent(encoded), title, "le même titre que celui passé à cover");
  assert.equal(planningMod.wrongCoverHref(title), HREF(encoded));
  assert.match(fr, /Une autre histoire/, "le jeu trouvé est cité pour repérer l'erreur");
  const en = textOf(await planning.adminPanel(pctx("en", { rawgCover: { ...FOUND, ambiguous: true } })));
  assert.ok(en.includes("Not the right game?") && !en.includes("Ce n'est pas"), en);
});

test("Planning : pas de lien quand ambiguous est faux ou absent, ni sans jaquette trouvée", async () => {
  feed = calendar(vevent("1", hours(2), hours(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]));
  for (const rawgCover of [{ ...FOUND, ambiguous: false }, FOUND, { status: "none", url: null }, { status: "unreachable", url: null }]) {
    const t = textOf(await planning.adminPanel(pctx("fr", { rawgCover })));
    assert.ok(!t.includes("rawg-covers") && !t.includes("Ce n'est pas le bon jeu"), JSON.stringify(rawgCover));
  }
});

test("Planning : jamais côté visiteur (page, sections d'accueil, image, MCP)", async () => {
  feed = calendar(vevent("1", hours(2), hours(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]));
  const c = () => pctx("fr", { rawgCover: { ...FOUND, ambiguous: true } });
  const out = JSON.stringify([await planning.page(c(), { segments: [] }), await planning.sections.next(c(), {}), await planning.sections.upcoming(c(), {}), await planning.mcp.planning_upcoming(c(), {})]);
  assert.ok(!out.includes("rawg-covers") && !out.includes("bon jeu"), "aucune trace du lien côté visiteur");
  assert.ok(!/rawg-covers/.test(fs.readFileSync(new URL("../modules/planning/index.mjs", import.meta.url), "utf8").split("export default")[1].split("async adminPanel")[0]), "le lien n'est écrit que dans la partie admin");
});

/* ───────────── Suggestions de jeux ───────────── */
const gs = (await import("../modules/game-suggestions/index.mjs")).default;
const gsMod = await import("../modules/game-suggestions/index.mjs");
let n = 0;
const gctx = (lang, over = {}) => fakeCtx({ key: `gs${++n}`, basePath: "suggestions", messages: readJson("game-suggestions", `locales/${lang}.json`), locale: lang, settings: {}, ...over });
const form = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return new Request("https://x.test/m/k/suggest", { method: "POST", body: fd, headers: { "x-forwarded-for": "1.1.1.1" } }); };

test("Suggestions de jeux : une jaquette ambiguë est marquée ; l'admin montre le lien (titre encodé, FR/EN) ; rien côté visiteur", async () => {
  const c = gctx("fr", { rawgCover: { ...FOUND, ambiguous: true } });
  await gs.routes.suggest(form({ title: "Hades (II)" }), c);
  const [row] = await c.api.store.list("games");
  assert.equal(row.data.coverAmbiguous, true);
  const admin = textOf(await gs.adminPanel(c));
  assert.ok(admin.includes("Ce n'est pas le bon jeu ?") && admin.includes(`](${HREF("Hades%20%28II%29")})`), admin);
  const pub = JSON.stringify(await gs.page(c, { segments: [] }));
  assert.ok(!pub.includes("rawg-covers") && !pub.includes("bon jeu"), "la page publique ne montre rien");
  assert.equal(gsMod.wrongCoverHref("Hades (II)"), HREF("Hades%20%28II%29"));
});

test("Suggestions de jeux : pas de marque ni de lien quand ambiguous est faux ou absent", async () => {
  for (const rawgCover of [{ ...FOUND, ambiguous: false }, FOUND]) {
    const c = gctx("fr", { rawgCover });
    await gs.routes.suggest(form({ title: "Celeste" }), c);
    assert.equal((await c.api.store.list("games"))[0].data.coverAmbiguous, undefined);
    assert.ok(!textOf(await gs.adminPanel(c)).includes("rawg-covers"));
  }
});

test("Suggestions de jeux : après la correction du propriétaire, l'ouverture de l'admin met la jaquette à jour et le lien disparaît (EN aussi)", async () => {
  let answer = { ...FOUND, ambiguous: true };
  const c = gctx("en", { rawgCover: () => answer });
  await gs.routes.suggest(form({ title: "Playrooms" }), c);
  assert.ok(textOf(await gs.adminPanel(c)).includes("Not the right game?"));
  assert.ok(textOf(await gs.adminPanel(c)).includes("For these suggestions"));
  const fixed = "https://media.rawg.io/media/games/ff/ffff0123456789ab.jpg";
  answer = { status: "found", url: fixed, name: "Playrooms", id: 9, ambiguous: false };
  const after = textOf(await gs.adminPanel(c));
  assert.ok(!after.includes("rawg-covers"), "plus de lien");
  const [row] = await c.api.store.list("games");
  assert.deepEqual([row.data.coverUrl, row.data.coverAmbiguous], [fixed, undefined]);
  // Une panne de RAWG ne change rien et ne casse pas l'admin.
  answer = { ...FOUND, ambiguous: true };
  const c2 = gctx("fr", { rawgCover: () => answer });
  await gs.routes.suggest(form({ title: "Autre" }), c2);
  answer = { status: "unreachable", url: null };
  assert.ok(textOf(await gs.adminPanel(c2)).includes("rawg-covers"), "panne : la mention reste");
});

/* ───────────── Story d'annonce : la route cover ───────────── */
const story = (await import("../modules/stream-story/index.mjs")).default;
const data = await import("../modules/stream-story/data.mjs");
const SITE = "https://site.example.test";
const smanifest = readJson("stream-story", "module.json");
const sctx = (rawgCover) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: readJson("stream-story", "locales/fr.json"), permissions: smanifest.permissions, siteUrl: SITE,
  topics: { "planning.slot": () => [] }, rawgCover,
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
});
const cover = async (ctx, game) => (await story.routes.cover(new Request(`${SITE}/m/story/cover?game=${encodeURIComponent(game)}`, { headers: { "x-story-token": await data.mintToken(ctx) } }), ctx)).json();

test("Story d'annonce : la route cover renvoie title, ambiguous et found ; faux ou absent sinon ; la vidéo reste possible (la jaquette est fournie)", async () => {
  const a = await cover(sctx({ ...FOUND, ambiguous: true }), "Hades (II)");
  assert.deepEqual([a.ok, a.cover, a.ambiguous, a.title, a.found, a.coverState], [true, COVER, true, "Hades (II)", "Une autre histoire", ""]);
  const b = await cover(sctx(FOUND), "Hades");
  assert.deepEqual([b.cover, b.ambiguous], [COVER, false]);
  const c = await cover(sctx({ status: "none", url: null }), "Hades");
  assert.deepEqual([c.cover, c.ambiguous], ["", false]);
  const d = await cover(sctx({ status: "found", url: "https://evil.example/c.jpg", ambiguous: true }), "Hades");
  assert.deepEqual([d.cover, d.ambiguous], ["", false], "une jaquette refusée n'est pas signalée");
});

/* ───────────── Parité et version ───────────── */
test("FR/EN : mêmes clés pour les trois modules ; minCore 0.2.10 ; versions augmentées ; extrait de changelog présent", () => {
  for (const m of ["planning", "stream-story", "game-suggestions"]) {
    assert.deepEqual(Object.keys(readJson(m, "locales/fr.json")).sort(), Object.keys(readJson(m, "locales/en.json")).sort(), m);
    assert.equal(readJson(m, "module.json").minCore, m === "game-suggestions" ? "0.6.0" : m === "planning" ? "0.5.0" : "0.2.10", m);   // le Planning et les Suggestions de jeux demandent 0.5.0 depuis leurs éléments d'overlay
  }
  assert.ok(fs.existsSync(new URL("../docs/changelog-parts/rawg-wrong-cover.md", import.meta.url)));
});

/* ───────────── Mise à jour à chaud ───────────── */
test("mise à jour à chaud : Planning et Story d'annonce copiés dans un autre dossier et chargés avec ?v= montrent le lien (aucun fichier voisin d'une ancienne version)", async () => {
  const os = await import("node:os"), path = await import("node:path"), { pathToFileURL } = await import("node:url");
  const dir = makeTempDir("rawg-link-update-");
  try {
    for (const m of ["planning", "stream-story"]) fs.cpSync(new URL(`../modules/${m}`, import.meta.url).pathname, path.join(dir, m), { recursive: true });
    const load = (m, v) => import(`${pathToFileURL(path.join(dir, m, "index.mjs")).href}?v=${v}`);
    const p = await load("planning", "nouveau");
    assert.equal(p.wrongCoverHref("A B"), HREF("A%20B"));
    feed = calendar(vevent("1", hours(2), hours(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]));
    assert.ok(textOf(await p.default.adminPanel(pctx("fr", { rawgCover: { ...FOUND, ambiguous: true } }))).includes(HREF("Celeste")));
    const s = (await load("stream-story", "nouveau")).default;
    const c = sctx({ ...FOUND, ambiguous: true });
    const r = await (await s.routes.cover(new Request(`${SITE}/m/story/cover?game=Celeste`, { headers: { "x-story-token": await (await import(`${pathToFileURL(path.join(dir, "stream-story", "data.mjs")).href}?v=nouveau`)).mintToken(c) } }), c)).json();
    assert.deepEqual([r.ambiguous, r.title], [true, "Celeste"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

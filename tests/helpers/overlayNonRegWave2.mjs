// Non-régression des éléments d'overlay de la seconde vague (Suggestions de jeux 1.6.0, Mur des remerciements 1.2.0) : ce que les modules rendaient AVANT (dépôt 1.26.0, commit 363a6e5)
// doit rester identique, octet pour octet. `gamesSnapshot` / `thanksSnapshot` rejouent les mêmes scénarios sur le code d'un dossier de dépôt ; les fichiers tests/golden/*.json
// ont été produits avec le dépôt 1.26.0, avant toute modification. Horloge simulée par l'appelant (Date fixe : NOW).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeContactBook } from "./fakeContactBook.mjs";
import { makeWorld } from "./thanks-wall-world.mjs";

export const NOW = Date.parse("2026-10-30T12:00:00Z");
const json = (v) => JSON.parse(JSON.stringify(v));
const readJson = (root, mod, f) => JSON.parse(fs.readFileSync(path.join(root, "modules", mod, f), "utf8"));
const load = (root, mod, file = "index.mjs") => import(`${path.join(root, "modules", mod, file)}?nr=${Math.random().toString(36).slice(2)}`);
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

/** Le manifeste sans ce que les éléments d'overlay ajoutent (version, minCore, clé overlayElements). */
const manifestRest = (m) => { const { version, minCore, overlayElements, ...rest } = m; return rest; };

/** Suggestions de jeux : la page publique (tous les filtres), l'administration, les outils MCP, le vote et la suggestion, sur un jeu de données fixe. */
export async function gamesSnapshot(root) {
  const mod = (await load(root, "game-suggestions")).default;
  const messages = readJson(root, "game-suggestions", "locales/fr.json");
  const DATA = [
    { title: "Hollow Knight", status: "proposed", submitterName: "Alice", note: "Un classique", replayVotes: 0, coverUrl: "https://media.rawg.io/hk.jpg" },
    { title: "Hollow Knight", status: "proposed", submitterName: "Bob", replayVotes: 0 },
    { title: "Celeste", status: "proposed", submitterName: "Chloé", replayVotes: 0 },
    { title: "Stardew Valley", status: "planned", origin: "admin", replayVotes: 0 },
    { title: "Outer Wilds", status: "accepted", replayVotes: 0 },
    { title: "Hades", status: "already_played", origin: "admin", replayVotes: 7, coverUrl: "https://media.rawg.io/hades.jpg" },
    { title: "Dave the Diver", status: "already_played", replayVotes: 3 },
    { title: "Tunic", status: "finished", replayVotes: 0 },
    { title: "Jeu secret <b>", status: "rejected", submitterName: "Troll", replayVotes: 99 },
  ];
  const make = (settings = {}) => {
    const ctx = fakeCtx({ key: "gs", basePath: "suggestions", moduleId: "game-suggestions", locale: "fr", messages, settings });
    return ctx;
  };
  const seeded = async (settings) => { const ctx = make(settings); for (const d of DATA) await ctx.api.store.add("games", d); return ctx; };
  const out = { manifest: manifestRest(readJson(root, "game-suggestions", "module.json")), top: Object.keys(mod).filter((k) => k !== "overlayElements").sort(), routes: Object.keys(mod.routes).filter((k) => k !== "element/:slug").sort(), tasks: Object.keys(mod.tasks).sort(), pages: {} };
  const ctx = await seeded({ title: "Mes jeux", intro: "Bienvenue **ici**" });
  for (const seg of [[], ["proposed"], ["planned"], ["accepted"], ["already_played"], ["finished"], ["rejected"], ["nope"], ["proposed", "x"]]) out.pages[seg.join("/") || "all"] = json(await mod.page(ctx, { segments: seg }));
  out.pageEmpty = json(await mod.page(make(), { segments: [] }));
  out.admin = json(await mod.adminPanel(ctx, { query: {} }));
  out.adminPage2 = json(await mod.adminPanel(ctx, { query: { ajout: "plusieurs", page: "1" } }));
  out.mcpList = json(await mod.mcp.game_suggestions_list(ctx, { limit: 50 }).then((r) => r.map(({ id, createdAt, ...x }) => x)));
  out.mcpListPlanned = json(await mod.mcp.game_suggestions_list(ctx, { status: "planned" }).then((r) => r.map(({ id, createdAt, ...x }) => x)));
  const vote = async (title) => { const c = await seeded(); const [row] = (await c.api.store.list("games")).filter((r) => r.data.title === title); const fd = new FormData(); fd.set("id", row.id); const res = await mod.routes.vote(new Request("https://x.test/m/gs/vote", { method: "POST", body: fd, headers: { "x-forwarded-for": "1.2.3.4" } }), c); return { status: res.status, location: res.headers.get("location"), cookie: res.headers.get("set-cookie")?.replace(/%5B\d+%5D/, "%5BT%5D") ?? null, votes: (await c.api.store.get(row.id)).data.replayVotes }; };
  out.voteOk = await vote("Hades"); out.voteRefused = await vote("Celeste");
  const sg = await seeded();
  const fd = new FormData(); fd.set("title", "  Neon White "); fd.set("name", "Dana"); fd.set("note", "Rapide");
  const res = await mod.routes.suggest(new Request("https://x.test/m/gs/suggest", { method: "POST", body: fd, headers: { "x-forwarded-for": "5.5.5.5" } }), sg);
  out.suggest = { status: res.status, body: await res.json(), added: json((await sg.api.store.list("games")).filter((r) => r.data.title === "Neon White").map((r) => r.data)) };
  return out;
}

/** Mur des remerciements : la page publique (mur, groupe, pagination, mise à l'honneur), l'administration et l'état pour l'assistant, sur des fiches fixes. */
export async function thanksSnapshot(root) {
  const mod = (await load(root, "thanks-wall")).default;
  const W = await load(root, "thanks-wall", "contacts.mjs");
  const book = fakeContactBook();
  const mods = book.seedCategory("Modérateurs"), sup = book.seedCategory("Soutiens"), hide = book.seedCategory("Ne pas montrer");
  const ids = {};
  for (const [name, cats, extra] of [["Zoé Dupont", [mods], { accounts: [{ network: "twitch", handle: "zoe_tv", displayName: "Zoé_TV" }] }], ["Anne Lambert", [mods], {}], ["Charlie Roy", [mods, hide], {}], ["Dina Fox", [sup], {}], ["Émile Noël", [sup], {}], ["Fanny Vo", [sup], {}]]) ids[name] = book.seedContact({ name, categoryIds: cats, ...extra }).id;
  const { ctx } = makeWorld({ book, settings: { category: mods, groupTitle: "Modération", category2: sup, intro: "Merci à **vous**", preview: 2 }, locale: "fr" });
  await ctx.api.store.add("messages", { contactId: ids["Anne Lambert"], texts: { fr: "Toujours là, merci !", en: "Always there, thanks!" } });
  await ctx.api.store.add("honors", { month: "2026-10", contactId: ids["Dina Fox"], why: { fr: "Pour son aide <3" } });
  const out = { manifest: manifestRest(readJson(root, "thanks-wall", "module.json")), top: Object.keys(mod).filter((k) => k !== "overlayElements").sort(), routes: mod.routes ? Object.keys(mod.routes).filter((k) => k !== "element/:slug").sort() : null, pages: {} };
  void W;
  for (const seg of [[], ["g", "1"], ["g", "2"], ["g", "2", "page", "1"], ["g", "3"], ["g", "1", "page", "2"], ["autre"]]) { W.resetWall?.(); out.pages[seg.join("/") || "wall"] = json(await mod.page(ctx, { segments: seg })); }
  out.admin = json(await mod.adminPanel(ctx, { query: {} }));
  const mcp = await mod.mcp.wall_status(ctx, {});
  out.mcpStatus = json(mcp);
  out.mcpPeople = json(await mod.mcp.wall_people?.(ctx, { group: 1 }).catch((e) => ({ error: String(e.message) })) ?? null);
  const none = makeWorld({ withBook: false, locale: "fr" });
  out.noBook = json(await mod.page(none.ctx, { segments: [] }));
  return out;
}

export const fingerprint = (v) => sha(JSON.stringify(v));

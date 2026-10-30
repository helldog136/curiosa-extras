// Non-régression des éléments d'overlay (Planning 2.5.0, Statistiques de la communauté 1.2.0) : ce que les modules rendaient AVANT (dépôt 1.25.0) doit rester identique, octet pour octet.
// `planningSnapshot` / `statsSnapshot` rejouent les mêmes scénarios sur le code d'un dossier de dépôt ; les fichiers tests/golden/*.json ont été produits avec le dépôt 1.25.0
// (commit 85019dc), avant toute modification. Horloge simulée par l'appelant (Date fixe : mercredi 14 octobre 2026, 10:00 UTC).
import fs from "node:fs";
import path from "node:path";
import { fakeCtx } from "./fakeCtx.mjs";
import { vevent, calendar, feedTopics } from "./icalFeed.mjs";

export const NOW = Date.parse("2026-10-14T10:00:00Z");
const hours = (n) => new Date(NOW + n * 3_600_000);
const json = (v) => JSON.parse(JSON.stringify(v));
const readJson = (root, mod, f) => JSON.parse(fs.readFileSync(path.join(root, "modules", mod, f), "utf8"));
const load = (root, mod, file = "index.mjs") => import(`${path.join(root, "modules", mod, file)}?nr=${Math.random().toString(36).slice(2)}`);

/** Le manifeste sans ce que les éléments d'overlay ajoutent (version, minCore, clé overlayElements, droit « routes » des statistiques). */
const manifestRest = (m, extraPermission) => { const { version, minCore, overlayElements, ...rest } = m; return { ...rest, permissions: (rest.permissions ?? []).filter((p) => p !== extraPermission) }; };

export async function planningSnapshot(root) {
  const mod = (await load(root, "planning")).default;
  const messages = readJson(root, "planning", "locales/fr.json");
  const feed = calendar(
    vevent("1", hours(2), hours(5), "Soirée découverte", ["DESCRIPTION:Jeu: Starlight Run"]),
    vevent("2", hours(20), hours(23), "Speedrun et discussion", ["DESCRIPTION:Jeu: Moss Kingdom\\, Neon Harbor"]),
    vevent("3", hours(26), hours(28), "Premier regard"),
    vevent("4", hours(75), hours(77), "Défis de la communauté", ["DESCRIPTION:Jeu: Sky Ferry"]),
  );
  const ctxWith = (settings = {}) => fakeCtx({ key: "planning", settings: { days: 7, timezone: "Europe/Brussels", ...settings }, topics: feedTopics(() => feed), messages, locale: "fr", rawgConfigured: true, rawgCover: ({ title } = {}) => ({ status: "found", url: `https://media.example.test/${encodeURIComponent(String(title))}.jpg` }), basePath: "planning" });
  const out = { manifest: manifestRest(readJson(root, "planning", "module.json")), keys: { sections: Object.keys(mod.sections).sort(), routes: Object.keys(mod.routes).filter((k) => k !== "element/:slug").sort(), top: Object.keys(mod).filter((k) => k !== "overlayElements").sort() }, scenes: {} };
  for (const appearance of ["original", "classic", "alternating", "week", "timeline", "posters", "hero"]) {
    const settings = { appearance, hourFormat: appearance === "week" ? "12" : "24" };
    out.scenes[appearance] = json({
      page: await mod.page(ctxWith(settings)),
      next: await mod.sections.next(ctxWith(settings), {}),
      upcoming: await mod.sections.upcoming(ctxWith(settings), { count: 3 }),
      days: await mod.sections.days(ctxWith(settings), { count: 3 }),
    });
  }
  out.mcp = json(await mod.mcp.planning_upcoming(ctxWith(), { days: 7 }));
  out.admin = json(await mod.adminPanel(ctxWith({ appearance: "week" })));
  const imageCtx = ctxWith();
  try { await mod.routes.image(new Request("https://site.test/m/planning/image?week=0"), imageCtx); } catch (e) { out.imageError = String(e?.message ?? e); }
  out.imageTree = json(imageCtx.calls.png);
  return out;
}

export async function statsSnapshot(root) {
  const mod = (await load(root, "community-stats")).default;
  const { collectNow } = await load(root, "community-stats", "collect.mjs");
  const { readPublic } = await load(root, "community-stats", "publicRead.mjs");
  const { loadStats } = await load(root, "community-stats", "stats.mjs");
  const { setManual } = await load(root, "community-stats", "manual.mjs");
  const messages = readJson(root, "community-stats", "locales/fr.json");
  const DAY = 86_400_000;
  const mk = (id, platform, account, key, metric, label, value) => ({ id, platform, account, accountKey: key, metric, label, value, asOf: new Date(NOW).toISOString() });
  const feed = { d: 0 };
  const items = () => [mk("twitch-channel:emma:followers", "twitch", "emma_live", "emma", "followers", "Followers Twitch", 1000 + feed.d * 3), mk("twitch-channel:emma:paying", "twitch", "emma_live", "emma", "paying", "Payants", 12), mk("youtube-channel:c:content", "youtube", "Emma TV", "c", "content", "Vidéos", 80), mk("youtube-channel:c:views", "youtube", "Emma TV", "c", "views", "Vues", 50_000 + feed.d * 100), mk("twitch-channel:emma:avg_viewers", "twitch", "emma_live", "emma", "avg_viewers", "Audience moyenne", 42)];
  const ctx = fakeCtx({ key: "community-stats", locale: "fr", locales: ["fr", "en"], messages, topics: { "social.stat": () => items() } });
  for (let d = -40; d <= 0; d++) { feed.d = d + 40; await collectNow(ctx, { now: NOW + d * DAY }); }
  await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 7 }, { now: NOW });
  const before = json(await readPublic(ctx));
  const stats = await loadStats(ctx);
  const msg = await mod.adminActions.saveVisibility(ctx, Object.fromEntries(stats.map((s) => [`show_${s.docId}`, ["twitch-channel:emma:followers", "youtube-channel:c:content", "manual:instagram:emma:followers"].includes(s.id) ? "yes" : "no"])));
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === "docId" ? undefined : x)));
  return {
    manifest: manifestRest(readJson(root, "community-stats", "module.json"), "routes"), keys: Object.keys(mod).filter((k) => !["overlayElements", "routes"].includes(k)).sort(), routes: mod.routes ? Object.keys(mod.routes).filter((k) => k !== "element/:slug") : [],
    publicBefore: before, publicAfter: json(await readPublic(ctx)), saveMessage: json(msg),
    admin: strip(await mod.adminPanel(ctx, { query: {}, now: NOW })), mcpList: strip(await mod.mcp.community_stats_list(ctx, {})),
  };
}

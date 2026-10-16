import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/community-stats", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const source = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
const def = (await import("../modules/community-stats/index.mjs")).default;
const { collectNow } = await import("../modules/community-stats/collect.mjs");
const { validateItem, MAX_VALUE } = await import("../modules/community-stats/model.mjs");
const { changeOf, evolutionPhrase, reasonText } = await import("../modules/community-stats/evolution.mjs");
const { setManual, parseWhen, staleManual } = await import("../modules/community-stats/manual.mjs");
const { readPublic } = await import("../modules/community-stats/publicRead.mjs");
const { loadStats, readPoints, addPoint } = await import("../modules/community-stats/stats.mjs");

const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = Date.parse("2026-10-14T10:00:00Z");
const item = (over = {}) => ({ id: "twitch-channel:emma:followers", platform: "twitch", account: "emma_live", accountKey: "emma", metric: "followers", label: "Followers Twitch", value: 1250, asOf: new Date(NOW).toISOString(), url: "https://www.twitch.tv/emma_live", ...over });
function make({ items = [], settings = {}, locale = "fr", messages } = {}) {
  const feed = { items };
  const ctx = fakeCtx({ key: "community-stats", locale, locales: ["fr", "en"], messages: messages ?? (locale === "fr" ? fr : en), settings, topics: { "social.stat": () => (typeof feed.items === "function" ? feed.items() : feed.items) } });
  return { ctx, feed };
}
const statOf = async (ctx, id) => (await loadStats(ctx)).find((s) => s.id === id);
const pointsOf = async (ctx, id) => readPoints(ctx, await statOf(ctx, id), 0);

test("manifeste : valide, 1.1.1, minCore 0.1.16, instance unique, plateforme neutre, consomme social.stat avec datetime, réglages avancés avec défauts sûrs", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(manifestJson.version, "1.1.1"); assert.equal(manifestJson.minCore, "0.1.16"); assert.equal(manifestJson.instances, "single"); assert.equal(manifestJson.icon, "📊");
  assert.ok(!("platform" in manifestJson), "plateforme neutre");
  const c = manifestJson.consumes.find((x) => x.topic === "social.stat");
  assert.deepEqual(Object.fromEntries(c.schema.map((f) => [f.key, f.type])), { id: "string", platform: "string", account: "string", accountKey: "string", metric: "string", label: "string", value: "number", asOf: "datetime", url: "url", error: "string" });
  assert.deepEqual(c.schema.filter((f) => f.required).map((f) => f.key), ["id", "platform", "account", "accountKey", "metric", "label", "asOf"]);
  for (const k of ["period", "retention"]) { const s = manifestJson.settings.find((x) => x.key === k); assert.equal(s.advanced, true); assert.ok(s.options.some((o) => o.value === s.default)); }
  assert.deepEqual(manifestJson.settings.find((x) => x.key === "period").options.map((o) => o.value), ["1h", "6h", "12h", "1d", "1w"]);
  assert.deepEqual(manifestJson.settings.find((x) => x.key === "retention").options.map((o) => o.value), ["3m", "1y", "2y", "5y", "forever"]);
  assert.equal(manifestJson.settings.find((x) => x.key === "period").default, "1d"); assert.equal(manifestJson.settings.find((x) => x.key === "retention").default, "2y");
  assert.deepEqual([...manifestJson.permissions].sort(), ["admin", "mcp", "storage", "topics"]);
  assert.ok(source.includes("ctx.api.store") && source.includes("ctx.api.topics.collect") && source.includes("adminPanel") && source.includes("mcp:"));
});

test("MCP : trois outils, TOUS désactivés par défaut, aucun destructif ; la lecture est en lecture seule, l'écriture ne l'est pas ; bornes déclarées", () => {
  assert.deepEqual(manifestJson.mcp.map((a) => a.name), ["community_stats_list", "community_stats_history", "stats_set_manual"]);
  for (const a of manifestJson.mcp) { assert.strictEqual(a.default, false, a.name); assert.ok(!a.destructive, a.name); assert.equal(typeof def.mcp[a.name], "function"); assert.ok(a.description.length > 150, "description écrite pour une IA"); }
  assert.equal(manifestJson.mcp.find((a) => a.name === "community_stats_list").readOnly, true);
  assert.equal(manifestJson.mcp.find((a) => a.name === "community_stats_history").readOnly, true);
  assert.ok(!manifestJson.mcp.find((a) => a.name === "stats_set_manual").readOnly);
  const set = manifestJson.mcp.find((a) => a.name === "stats_set_manual").input;
  assert.deepEqual(set.required, ["platform", "account", "metric", "value"]);
  assert.equal(set.properties.value.minimum, 0); assert.equal(set.properties.value.maximum, MAX_VALUE); assert.equal(set.properties.value.type, "integer");
  assert.deepEqual(set.properties.metric.enum, ["followers", "paying", "content", "views"]);
  const h = manifestJson.mcp.find((a) => a.name === "community_stats_history").input.properties;
  assert.ok(h.days.maximum <= 1830 && h.limit.maximum <= 500);
  assert.ok(!/secret|password|clientSecret|api[_ -]?key/i.test(JSON.stringify(manifestJson.mcp)), "aucun secret dans les outils");
});

test("collecte : un point par statistique, statistique PRIVÉE par défaut, tâche planifiée déclarée", async () => {
  const { ctx } = make({ items: [item(), item({ id: "twitch-channel:emma:paying", metric: "paying", label: "Abonnés Twitch", value: 12 }), item({ id: "youtube-channel:chaine:views", platform: "youtube", account: "Emma TV", accountKey: "chaine", metric: "views", value: 98765 })] });
  assert.equal(def.tasks.collect.everyMinutes, 15);
  const r = await collectNow(ctx, { now: NOW });
  assert.deepEqual([r.status, r.stored, r.errors, r.rejected], ["done", 3, 0, 0]);
  const stats = await loadStats(ctx);
  assert.equal(stats.length, 3);
  for (const s of stats) { assert.strictEqual(s.visible, false); assert.equal(s.source, "auto"); assert.equal(s.state, "ok"); }
  assert.deepEqual(await pointsOf(ctx, "twitch-channel:emma:followers"), [[Math.floor(NOW / 1000), 1250]]);
  assert.equal((await statOf(ctx, "youtube-channel:chaine:views")).lastValue, 98765);
  assert.equal(ctx.calls.topics[0][0], "social.stat");
  assert.equal(ctx.calls.topics[0][1].limit, 200);
});

test("validation : types, métrique connue, entier ≥ 0 borné, identifiants et adresses propres, tailles bornées — chaque rejet est compté, les autres éléments passent", () => {
  assert.equal(validateItem(item()).ok, true);
  assert.equal(validateItem(item({ value: 0 })).ok, true, "zéro est un chiffre valide");
  const bad = {
    "pas un objet": null, tableau: [], "texte": "x",
    "id sans métrique": item({ id: "twitch-channel:emma" }), "id avec espace": item({ id: "twitch channel:emma:followers" }), "id vide": item({ id: "" }), "id d'un module « manual »": item({ id: "manual:emma:followers" }),
    "métrique inconnue": item({ metric: "revenue", id: "twitch-channel:emma:revenue" }), "métrique ≠ id": item({ metric: "views" }),
    "valeur négative": item({ value: -1 }), "valeur décimale": item({ value: 12.5 }), "valeur texte": item({ value: "12" }), "valeur trop grande": item({ value: MAX_VALUE + 1 }), "valeur NaN": item({ value: NaN }), "valeur Infinity": item({ value: Infinity }),
    "ni valeur ni erreur": item({ value: undefined }), "erreur inconnue": item({ error: "boom", value: undefined }),
    "date illisible": item({ asOf: "hier" }), "date absente": item({ asOf: undefined }),
    "adresse javascript:": item({ url: "javascript:alert(1)" }), "adresse avec mot de passe": item({ url: "https://a:b@example.org/" }), "adresse énorme": item({ url: `https://example.org/${"a".repeat(600)}` }),
    "compte énorme": item({ account: "é".repeat(121) }), "compte vide": item({ account: "  " }), "libellé énorme": item({ label: "x".repeat(121) }), "clé de compte invalide": item({ accountKey: "a b" }), "plateforme invalide": item({ platform: "Twitch!" }),
  };
  for (const [why, raw] of Object.entries(bad)) assert.equal(validateItem(raw).ok, false, why);
  assert.equal(validateItem(item({ account: "  Emma \u0007 live  " })).stat.account, "Emma live", "caractères de contrôle retirés, espaces réduits");
});

test("collecte : les éléments invalides sont écartés SEULS ; un doublon dans la même collecte compte une fois", async () => {
  const { ctx } = make({ items: [item(), item({ value: -5, id: "a-mod:k:views", metric: "views" }), item({ value: 9999 }), null, item({ id: "x-mod:k:content", metric: "content", value: 3.5 })] });
  const r = await collectNow(ctx, { now: NOW });
  assert.deepEqual([r.stored, r.rejected], [1, 4]);
  assert.equal((await loadStats(ctx)).length, 1);
  assert.equal((await statOf(ctx, "twitch-channel:emma:followers")).lastValue, 1250, "le premier gagne");
});

test("fournisseur en erreur : la raison est gardée, AUCUNE valeur n'est écrite, le dernier chiffre connu reste ; retour à la normale efface l'erreur", async () => {
  const { ctx, feed } = make({ items: [item()] });
  await collectNow(ctx, { now: NOW });
  feed.items = [item({ value: undefined, error: "hidden", platform: "youtube", id: "twitch-channel:emma:followers" })];
  await collectNow(ctx, { now: NOW + DAY });
  let s = await statOf(ctx, "twitch-channel:emma:followers");
  assert.deepEqual([s.state, s.error, s.lastValue, s.since], ["error", "hidden", 1250, NOW + DAY]);
  assert.equal((await pointsOf(ctx, s.id)).length, 1, "pas de point pour une erreur");
  feed.items = [item({ error: "auth", value: 777 })]; // une valeur avec une erreur : jamais gardée
  await collectNow(ctx, { now: NOW + 2 * DAY });
  s = await statOf(ctx, s.id);
  assert.deepEqual([s.error, s.lastValue, s.since, (await pointsOf(ctx, s.id)).length], ["auth", 1250, NOW + 2 * DAY, 1]);
  feed.items = [item({ value: 1300 })];
  await collectNow(ctx, { now: NOW + 3 * DAY });
  s = await statOf(ctx, s.id);
  assert.deepEqual([s.state, s.error, s.since, s.lastValue], ["ok", undefined, undefined, 1300]);
});

test("erreur dès le premier passage : la statistique existe, sans chiffre ; un passage où la collecte lève ne change rien et sera retenté", async () => {
  const { ctx, feed } = make({ items: [item({ value: undefined, error: "auth" })] });
  assert.equal((await collectNow(ctx, { now: NOW })).errors, 1);
  const s = await statOf(ctx, "twitch-channel:emma:followers");
  assert.deepEqual([s.state, s.lastValue, (await pointsOf(ctx, s.id)).length], ["error", undefined, 0]);
  feed.items = () => { throw new Error("réseau"); };
  assert.equal((await collectNow(ctx, { now: NOW + HOUR, force: true })).status, "failed");
  const [run] = await ctx.api.store.list("communityRun");
  assert.equal(run.data.lastError, "collect");
  assert.notEqual(run.data.lastBucket, Math.floor((NOW + HOUR) / DAY) + 1, "le passage raté n'est pas compté comme fait");
});

test("statistique qui disparaît des sources : « manquante », historique et réglage « montrer » gardés ; elle revient quand le fournisseur revient", async () => {
  const { ctx, feed } = make({ items: [item()] });
  await collectNow(ctx, { now: NOW });
  const s0 = await statOf(ctx, "twitch-channel:emma:followers");
  await ctx.api.store.update(s0.docId, { ...s0, docId: undefined, visible: true });
  feed.items = [];
  await collectNow(ctx, { now: NOW + DAY });
  let s = await statOf(ctx, s0.id);
  assert.deepEqual([s.state, s.visible, s.lastValue, (await pointsOf(ctx, s.id)).length], ["missing", true, 1250, 1]);
  assert.match(reasonText(ctx, s), /ne partage plus ce chiffre.*Suivre mes statistiques/);
  feed.items = [item({ value: 1400 })];
  await collectNow(ctx, { now: NOW + 2 * DAY });
  s = await statOf(ctx, s0.id);
  assert.deepEqual([s.state, s.visible, s.lastValue, (await pointsOf(ctx, s.id)).length], ["ok", true, 1400, 2]);
});

test("idempotence : pas de deuxième relevé dans la même période ; « mettre à jour maintenant » remplace le point au lieu d'en ajouter ; période suivante = nouveau point", async () => {
  const { ctx, feed } = make({ items: [item()] });
  assert.equal((await collectNow(ctx, { now: NOW })).status, "done");
  feed.items = [item({ value: 1260 })];
  assert.equal((await collectNow(ctx, { now: NOW + 2 * HOUR })).status, "skipped", "même jour : rien");
  assert.equal((await collectNow(ctx, { now: NOW + 2 * HOUR, force: true })).status, "done");
  const id = "twitch-channel:emma:followers";
  assert.deepEqual((await pointsOf(ctx, id)).map((p) => p[1]), [1260], "un seul point, valeur la plus récente");
  assert.equal((await collectNow(ctx, { now: NOW + 2 * HOUR + 60_000, force: true })).status, "tooSoon", "cadence limitée");
  assert.equal((await collectNow(ctx, { now: NOW + DAY })).status, "done");
  assert.equal((await pointsOf(ctx, id)).length, 2);
});

test("période réglable : toutes les heures = un point par heure ; toutes les semaines = un point par semaine ; un réglage inconnu retombe sur « un jour »", async () => {
  const { ctx } = make({ items: [item()], settings: { period: "1h" } });
  for (let h = 0; h < 5; h++) await collectNow(ctx, { now: NOW + h * HOUR + 600_000 * (h % 2) });
  assert.equal((await pointsOf(ctx, "twitch-channel:emma:followers")).length, 5);
  const weekly = make({ items: [item()], settings: { period: "1w" } });
  for (let d = 0; d < 8; d++) await collectNow(weekly.ctx, { now: NOW + d * DAY });
  assert.equal((await pointsOf(weekly.ctx, "twitch-channel:emma:followers")).length, 2);
  const odd = make({ items: [item()], settings: { period: "5m" } });
  await collectNow(odd.ctx, { now: NOW }); await collectNow(odd.ctx, { now: NOW + 2 * HOUR });
  assert.equal((await pointsOf(odd.ctx, "twitch-channel:emma:followers")).length, 1);
});

test("rétention : les vieux chiffres partent, jamais le dernier chiffre connu ; « pour toujours » ne purge rien ; réglage inconnu = 2 ans", async () => {
  const id = "twitch-channel:emma:followers";
  const { ctx, feed } = make({ items: [item({ value: 100 })], settings: { retention: "3m" } });
  let t = NOW - 400 * DAY;
  for (let i = 0; i < 400; i += 10) { feed.items = [item({ value: 100 + i })]; await collectNow(ctx, { now: t + i * DAY }); }
  const points = await pointsOf(ctx, id);
  assert.ok(points.every((p) => p[0] * 1000 >= NOW - 400 * DAY + 390 * DAY - 92 * DAY - 31 * DAY) || points.length < 12, "plus rien d'ancien");
  const s = await statOf(ctx, id);
  assert.ok(Object.keys(s.chunks).length <= 5, "les mois entièrement périmés sont supprimés");
  assert.equal(points.at(-1)[1], 490);
  // le compte ne répond plus depuis 3 ans : son dernier chiffre reste malgré la rétention
  const stale = make({ items: [item({ value: 321 })], settings: { retention: "3m" } });
  await collectNow(stale.ctx, { now: NOW - 3 * 365 * DAY });
  stale.feed.items = [];
  await collectNow(stale.ctx, { now: NOW });
  assert.deepEqual(await pointsOf(stale.ctx, id), [[Math.floor((NOW - 3 * 365 * DAY) / 1000), 321]]);
  assert.equal((await statOf(stale.ctx, id)).lastValue, 321);
  // pour toujours
  const forever = make({ items: [item()], settings: { retention: "forever" } });
  for (let i = 0; i < 6; i++) await collectNow(forever.ctx, { now: NOW - (6 - i) * 200 * DAY });
  assert.equal((await pointsOf(forever.ctx, id)).length, 6);
  // réglage inconnu → 2 ans
  const odd = make({ items: [item()], settings: { retention: "42" } });
  await collectNow(odd.ctx, { now: NOW - 900 * DAY }); await collectNow(odd.ctx, { now: NOW - 100 * DAY });
  assert.equal((await pointsOf(odd.ctx, id)).length, 1, "le point de 900 jours est purgé (2 ans = 731 jours)");
});

test("volume borné : au plus 300 statistiques ; ~20 octets par point (documenté : 730 points ≈ 15 Ko)", async () => {
  const many = Array.from({ length: 320 }, (_, i) => item({ id: `big-mod:k${i}:followers`, accountKey: `k${i}`, account: `compte ${i}` }));
  const { ctx, feed } = make({ items: many.slice(0, 150) });
  await collectNow(ctx, { now: NOW });
  feed.items = many.slice(150, 300); await collectNow(ctx, { now: NOW + HOUR, force: true });
  feed.items = many.slice(300); const r = await collectNow(ctx, { now: NOW + 2 * HOUR, force: true });
  assert.equal((await loadStats(ctx)).length, 300);
  assert.equal(r.overflow, 20, "au-delà de 300 statistiques, les nouvelles sont ignorées (les anciennes gardent tout)");
  const bytes = JSON.stringify(Array.from({ length: 730 }, (_, i) => [1760000000 + i * 86400, 1000 + i])).length;
  assert.ok(bytes < 16_000, `730 points = ${bytes} octets`);
});

test("évolution : 7 et 30 jours, pourcentage, division par zéro, recul insuffisant, tolérance d'une demi-journée", () => {
  const D = 86400, t0 = 1_760_000_000;
  const pts = (list) => list.map(([d, v]) => [t0 + d * D, v]);
  const series = pts([[0, 1000], [23, 1100], [30, 1200], [37, 1260]]);
  assert.deepEqual(changeOf(series, 7), { days: 7, from: 1200, to: 1260, delta: 60, percent: 5, sinceAt: (t0 + 30 * D) * 1000 });
  assert.equal(changeOf(series, 30).from, 1000, "30 jours avant le dernier chiffre : le point du jour 0");
  assert.equal(changeOf(pts([[0, 0], [7, 50]]), 7).percent, null, "départ à 0 : pas de pourcentage, pas d'erreur");
  assert.equal(changeOf(pts([[0, 0], [7, 50]]), 7).delta, 50);
  assert.equal(changeOf(pts([[0, 10], [7, 10]]), 7).delta, 0);
  assert.equal(changeOf(pts([[0, 200], [7, 150]]), 7).percent, -25);
  assert.equal(changeOf(pts([[0, 5]]), 7), null, "un seul point");
  assert.equal(changeOf([], 7), null);
  assert.equal(changeOf(pts([[3, 10], [7, 20]]), 7), null, "pas de point d'il y a une semaine");
  assert.equal(changeOf(pts([[0, 10], [6.6, 20]]), 7).delta, 10, "relevé de 6 jours et demi accepté");
  assert.equal(changeOf(pts([[0, 10], [40, 20]]), 7), null, "point de référence trop ancien pour parler de « cette semaine »");
});

test("phrase d'évolution : +120 abonnés cette semaine, −3 ce mois-ci, singulier, aucun changement, sans recul ; en français ET en anglais", () => {
  const fc = make().ctx, ec = make({ locale: "en" }).ctx;
  const up = { days: 7, delta: 120, percent: 10 }, down = { days: 30, delta: -3, percent: -0.5 };
  assert.equal(evolutionPhrase(fc, up, "followers"), "+120 abonnés cette semaine (+10 %)");
  assert.equal(evolutionPhrase(fc, down, "followers"), "−3 abonnés ce mois-ci (−0,5 %)");
  assert.equal(evolutionPhrase(fc, { days: 7, delta: 1, percent: null }, "paying"), "+1 abonné payant cette semaine");
  assert.equal(evolutionPhrase(fc, { days: 30, delta: -1, percent: null }, "content"), "−1 publication ce mois-ci");
  assert.equal(evolutionPhrase(fc, { days: 7, delta: 12000, percent: null }, "views").replace(/\s/g, " "), "+12 000 vues cette semaine");
  assert.equal(evolutionPhrase(fc, { days: 7, delta: 0, percent: 0 }, "views"), "Pas de changement cette semaine");
  assert.match(evolutionPhrase(fc, null, "views"), /Pas encore assez d'historique/);
  assert.equal(evolutionPhrase(ec, up, "followers"), "+120 followers this week (+10%)");
  assert.equal(evolutionPhrase(ec, down, "views"), "−3 views this month (−0.5%)");
});

test("explications des chiffres manquants : une raison humaine ET une action, propre à la plateforme quand il y en a une", () => {
  const { ctx } = make();
  const s = (error, platform) => ({ state: "error", error, platform });
  assert.match(reasonText(ctx, s("hidden", "youtube")), /YouTube cache votre nombre d'abonnés : rendez-le public dans YouTube Studio/);
  assert.match(reasonText(ctx, s("auth", "twitch")), /Twitch demande votre autorisation : cliquez sur « Connecter ma chaîne »/);
  assert.match(reasonText(ctx, s("auth", "bluesky")), /Bluesky demande votre autorisation.*reconnectez/);
  assert.match(reasonText(ctx, s("rate", "github")), /GitHub demande de patienter.*Rien à faire/);
  assert.match(reasonText(ctx, s("network", "reddit")), /Reddit ne répond pas.*Rien à faire/);
  assert.match(reasonText(ctx, s("config", "mastodon")), /Mastodon n'est pas encore bien réglé|module Mastodon n'est pas encore bien réglé/);
  assert.match(reasonText(make({ locale: "en" }).ctx, s("hidden", "youtube")), /make it public in YouTube Studio/);
});

test("saisie à la main : un point « saisi à la main » avec date et auteur ; un deuxième dans la même période remplace le premier ; privé par défaut", async () => {
  const { ctx } = make();
  const s = await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: "4200" }, { now: NOW, by: "admin" });
  assert.deepEqual([s.id, s.source, s.visible, s.lastValue, s.platformName], ["manual:instagram:emma:followers", "manual", false, 4200, "Instagram"]);
  await setManual(ctx, { platform: "instagram", account: "@Emma", metric: "followers", value: 4300 }, { now: NOW + HOUR, by: "Mon assistant" });
  const pts = await pointsOf(ctx, s.id);
  assert.deepEqual(pts, [[Math.floor((NOW + HOUR) / 1000), 4300, "m", "Mon assistant"]]);
  await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 4000, date: "2026-10-10" }, { now: NOW });
  assert.deepEqual((await pointsOf(ctx, s.id)).map((p) => p[1]), [4000, 4300], "chiffre daté d'avant : rangé dans l'ordre, le dernier reste le plus récent");
  assert.equal((await statOf(ctx, s.id)).lastValue, 4300);
  await setManual(ctx, { platform: "Twitter", account: "emma", metric: "views", value: 0 }, { now: NOW });
  assert.ok(await statOf(ctx, "manual:x:emma:views"), "Twitter = X");
});

test("saisie à la main : refus clair (champs, bornes, date future) et refus pour un compte lu automatiquement", async () => {
  const { ctx } = make({ items: [item()] });
  await collectNow(ctx, { now: NOW });
  const ok = { platform: "Twitch", account: "emma_live", metric: "followers", value: 5 };
  const code = async (over) => setManual(ctx, { ...ok, ...over }, { now: NOW }).then(() => "ok", (e) => e.code);
  assert.equal(await code({}), "automatic", "déjà lu automatiquement");
  assert.equal(await code({ account: "@Emma_Live" }), "automatic", "même compte écrit autrement");
  assert.equal(await code({ account: "emma" }), "automatic", "la clé du compte compte aussi");
  assert.equal(await code({ metric: "paying" }), "ok", "un autre type de chiffre n'est pas lu automatiquement");
  assert.equal(await code({ account: "autre_chaine" }), "ok", "une autre chaîne du même réseau est saisissable");
  assert.equal(await code({ platform: "" }), "platform");
  assert.equal(await code({ platform: "Instagram", account: "  " }), "account");
  assert.equal(await code({ platform: "Instagram", metric: "revenue" }), "metric");
  for (const value of [-1, 1.5, "abc", "", null, MAX_VALUE + 1, "-3", "1e3"]) assert.equal(await code({ platform: "Instagram", value }), "value", String(value));
  assert.equal(await code({ platform: "Instagram", date: "2026-10-20" }), "future");
  assert.equal(await code({ platform: "Instagram", date: "pas une date" }), "date");
  assert.equal(await code({ platform: "Instagram", date: "1999-01-01" }), "date");
  const refused = await setManual(ctx, ok, { now: NOW }).catch((e) => e);
  assert.equal(refused.expose, true, "message visible de l'assistant");
  assert.equal((await loadStats(ctx)).filter((s) => s.source === "manual" && s.platform === "twitch" && s.metric === "followers" && s.account === "emma_live").length, 0);
  assert.equal(parseWhen("2026-10-14", NOW), NOW, "aujourd'hui = maintenant");
});

test("rappel doux : un chiffre saisi à la main de plus de 30 jours est signalé (pastille + bandeau), pas avant", async () => {
  const { ctx } = make();
  await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 10, date: "2026-09-10" }, { now: NOW });
  await setManual(ctx, { platform: "TikTok", account: "@emma", metric: "followers", value: 10, date: "2026-10-01" }, { now: NOW });
  const stats = await loadStats(ctx);
  assert.deepEqual(staleManual(stats, NOW).map((s) => s.platform), ["instagram"]);
  assert.equal(staleManual(stats, Date.parse("2026-10-09T11:00:00Z")).length, 0, "30 jours pile : pas encore");
  const realNow = Date.now; Date.now = () => NOW;
  try {
    assert.equal(await def.adminBadge(ctx), 1);
    const blocks = await def.adminPanel(ctx, { query: {}, now: NOW });
    const banner = blocks.find((b) => b.type === "banner");
    assert.match(banner.text, /Instagram \(@emma\) n'a pas été mis à jour depuis 33 jours/);
  } finally { Date.now = realNow; }
});

test("visibilité : privée par défaut ; readPublic ne rend que ce qu'on a choisi de montrer, avec une valeur actuelle ; une valeur périmée ne sort jamais", async () => {
  const { ctx, feed } = make({ items: [item(), item({ id: "twitch-channel:emma:paying", metric: "paying", label: "Payants", value: 12 }), item({ id: "youtube-channel:c:content", platform: "youtube", account: "Emma TV", accountKey: "c", metric: "content", value: 80 })] });
  await collectNow(ctx, { now: NOW });
  assert.deepEqual(await readPublic(ctx), [], "rien n'est montrable tant qu'on n'a rien choisi");
  const stats = await loadStats(ctx);
  const form = Object.fromEntries(stats.map((s) => [`show_${s.docId}`, s.id === "twitch-channel:emma:followers" || s.id === "youtube-channel:c:content" ? "yes" : "no"]));
  assert.match((await def.adminActions.saveVisibility(ctx, form)).ok, /enregistré/);
  assert.deepEqual((await readPublic(ctx)).map((p) => p.id), ["twitch-channel:emma:followers", "youtube-channel:c:content"], "les abonnés payants restent privés");
  const row = (await readPublic(ctx))[0];
  assert.deepEqual(Object.keys(row).sort(), ["account", "asOf", "id", "manual", "metric", "platform", "url", "value"]);
  assert.equal(row.value, 1250); assert.equal(row.manual, false);
  feed.items = [item({ value: undefined, error: "hidden" })];
  await collectNow(ctx, { now: NOW + DAY });
  assert.deepEqual(await readPublic(ctx), [], "en erreur ou disparu des sources : rien de périmé n'est montrable");
  await def.adminActions.saveVisibility(ctx, { show_inconnu: "yes", [`show_${stats[0].docId}`]: "peut-être" });
  const m = await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 7 }, { now: NOW });
  await def.adminActions.saveVisibility(ctx, { [`show_${m.docId}`]: "yes" });
  assert.deepEqual((await readPublic(ctx)).map((p) => [p.id, p.manual]), [["manual:instagram:emma:followers", true]]);
});

test("MCP community_stats_list : valeurs, origine, fraîcheur, évolutions 7/30 jours, filtres plateforme et métrique", async () => {
  const { ctx, feed } = make({ items: [item({ value: 1000 }), item({ id: "youtube-channel:c:followers", platform: "youtube", account: "Emma TV", accountKey: "c", value: 50 })] });
  for (let d = 0; d <= 40; d += 1) { feed.items = [item({ value: 1000 + d * 3 }), item({ id: "youtube-channel:c:followers", platform: "youtube", account: "Emma TV", accountKey: "c", value: 50 })]; await collectNow(ctx, { now: NOW - (40 - d) * DAY }); }
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const all = await def.mcp.community_stats_list(ctx, {});
    assert.equal(all.count, 2);
    const tw = all.stats.find((s) => s.platform === "twitch");
    assert.deepEqual([tw.value, tw.origin, tw.status, tw.shownOnSite, tw.ageHours], [1120, "automatic", "ok", false, 0]);
    assert.deepEqual(tw.change7d, { from: 1099, to: 1120, delta: 21, percent: 1.9 });
    assert.equal(tw.change30d.delta, 90);
    assert.equal(all.stats.find((s) => s.platform === "youtube").change7d.percent, 0);
    assert.deepEqual((await def.mcp.community_stats_list(ctx, { platform: "YouTube" })).stats.map((s) => s.platform), ["youtube"]);
    assert.equal((await def.mcp.community_stats_list(ctx, { metric: "views" })).count, 0);
    assert.ok(!JSON.stringify(all).includes("https://"), "pas d'adresse dans la sortie");
    // un compte manuel et un chiffre manquant
    await setManual(ctx, { platform: "TikTok", account: "@emma", metric: "followers", value: 9 }, { now: NOW });
    feed.items = [item({ value: undefined, error: "hidden" })];
    await collectNow(ctx, { now: NOW + DAY, force: true }); Date.now = () => NOW + DAY;
    const later = await def.mcp.community_stats_list(ctx, {});
    assert.deepEqual(later.stats.map((s) => [s.platform, s.status, s.problem ?? null, s.origin]), [["tiktok", "manual", null, "manual"], ["twitch", "no_data", "hidden", "automatic"], ["youtube", "not_shared_anymore", null, "automatic"]]);
    assert.equal(later.stats[1].value, 1120, "dernier chiffre connu, signalé par le statut");
  } finally { Date.now = realNow; }
  assert.match((await def.mcp.community_stats_list(make().ctx, {})).note, /No reading yet/);
});

test("MCP community_stats_list : jamais de liste vide muette (aucun relevé, réseaux muets, filtre trop strict) et unité de chaque chiffre", async () => {
  const fresh = make();
  const never = await def.mcp.community_stats_list(fresh.ctx, {});
  assert.equal(never.count, 0);
  assert.match(never.note, /Mettre à jour maintenant/, "dit comment déclencher un relevé");
  assert.match(never.note, /No reading yet/);
  // Un relevé a eu lieu, mais aucun réseau ne partage ses chiffres.
  const quiet = make({ items: [] });
  await collectNow(quiet.ctx, { now: NOW, force: true });
  assert.match((await def.mcp.community_stats_list(quiet.ctx, {})).note, /no network shares figures.*Suivre mes statistiques/s);
  // Des statistiques existent, mais le filtre n'en laisse aucune : on dit lesquelles existent.
  const some = make({ items: [item({ value: 10 })] });
  await collectNow(some.ctx, { now: NOW, force: true });
  const filtered = await def.mcp.community_stats_list(some.ctx, { metric: "views" });
  assert.equal(filtered.count, 0);
  assert.match(filtered.note, /No statistic matches this filter.*twitch.*followers/s);
  const ok = await def.mcp.community_stats_list(some.ctx, {});
  assert.equal(ok.note, undefined);
  assert.equal(ok.stats[0].unit, "people");
});

test("MCP community_stats_history : plage bornée, points datés avec origine et jeton, amincissement régulier, id inconnu refusé", async () => {
  const { ctx, feed } = make({ items: [item()] });
  for (let d = 0; d < 120; d++) { feed.items = [item({ value: 100 + d })]; await collectNow(ctx, { now: NOW - (119 - d) * DAY }); }
  const realNow = Date.now; Date.now = () => NOW;
  try {
    const id = "twitch-channel:emma:followers";
    const h = await def.mcp.community_stats_history(ctx, { id, days: 30 });
    assert.deepEqual([h.totalPoints, h.thinned, h.points.length], [31, false, 31]);
    assert.deepEqual([h.points[0].value, h.points.at(-1).value, h.points[0].origin], [189, 219, "automatic"]);
    const thin = await def.mcp.community_stats_history(ctx, { id, days: 1830, limit: 10 });
    assert.deepEqual([thin.thinned, thin.points.length, thin.points[0].value, thin.points.at(-1).value, thin.totalPoints], [true, 10, 100, 219, 120]);
    const clamped = await def.mcp.community_stats_history(ctx, { id, days: 99999, limit: 99999 });
    assert.equal(clamped.days, 1830); assert.ok(clamped.points.length <= 500);
    await assert.rejects(def.mcp.community_stats_history(ctx, { id: "nope" }), (e) => e.expose === true);
    await def.mcp.stats_set_manual(ctx, { platform: "Facebook", account: "Emma", metric: "views", value: 12 }, { name: "Claude perso" });
    const m = await def.mcp.community_stats_history(ctx, { id: "manual:facebook:emma:views" });
    assert.deepEqual(m.points.map((p) => [p.origin, p.by, p.value]), [["manual", "Claude perso", 12]]);
  } finally { Date.now = realNow; }
});

test("MCP stats_set_manual : compte manuel seulement, entier ≥ 0, nom du jeton dans l'historique, refus exposé pour un compte automatique", async () => {
  const { ctx } = make({ items: [item()] });
  await collectNow(ctx, { now: Date.now() });
  const r = await def.mcp.stats_set_manual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 4200 }, { name: "Jeton Claude" });
  assert.deepEqual([r.id, r.value, r.origin, r.shownOnSite], ["manual:instagram:emma:followers", 4200, "manual", false]);
  assert.equal((await pointsOf(ctx, r.id))[0][3], "Jeton Claude");
  await def.mcp.stats_set_manual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 4201 }, undefined);
  assert.equal((await pointsOf(ctx, r.id))[0][3], "assistant", "jeton inconnu");
  await assert.rejects(def.mcp.stats_set_manual(ctx, { platform: "Twitch", account: "emma_live", metric: "followers", value: 5 }, { name: "x" }), (e) => e.expose === true && /already read automatically/.test(e.message));
  await assert.rejects(def.mcp.stats_set_manual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: -4 }, {}), (e) => e.expose === true);
});

test("admin : état vide chaleureux, avec l'action à faire ; aucun jargon dans la page", async () => {
  const { ctx } = make();
  const blocks = await def.adminPanel(ctx, { query: {}, now: NOW });
  const text = JSON.stringify(blocks);
  assert.match(text, /Aucun de vos réseaux ne partage encore ses chiffres : ouvrez votre module Twitch ou YouTube et cochez « Suivre mes statistiques »/);
  assert.match(text, /Aucun compte saisi à la main pour l'instant/);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "refresh"));
  assert.ok(!blocks.some((b) => b.type === "table" && b.columns.length === 2 && b.columns[0] === "Chiffre"), "pas de tableau vide");
  assert.equal(await def.adminBadge(ctx), 0);
  assert.match(JSON.stringify(await def.adminPanel(make({ locale: "en" }).ctx, { query: {}, now: NOW })), /None of your networks shares its numbers yet/);
});

test("admin : cartes lisibles (compte, chiffre, évolution en phrase, origine, mise à jour, raison+action), interrupteur « montrer sur mon site », comptes manuels, confirmation avant de supprimer", async () => {
  const { ctx, feed } = make({ items: [item({ value: 1000 })] });
  for (let d = 0; d <= 10; d++) { feed.items = [item({ value: 1000 + d * 12 }), item({ id: "youtube-channel:c:followers", platform: "youtube", account: "Emma TV", accountKey: "c", value: 50 })]; await collectNow(ctx, { now: NOW - (10 - d) * DAY }); }
  feed.items = [item({ value: undefined, error: "auth" }), item({ id: "youtube-channel:c:followers", platform: "youtube", account: "Emma TV", accountKey: "c", value: undefined, error: "hidden" })];
  await collectNow(ctx, { now: NOW + DAY, force: true });
  await setManual(ctx, { platform: "Instagram", account: "@emma", metric: "followers", value: 4200 }, { now: NOW });
  const blocks = await def.adminPanel(ctx, { query: {}, now: NOW + DAY });
  const tables = blocks.filter((b) => b.type === "table");
  const cards = tables[0].rows.map((r) => r.join(" | ")).join("\n");
  assert.match(cards, /Twitch · emma_live\nAbonnés : 1\s120\nGardé pour vous/);
  assert.match(cards, /\+84 abonnés cette semaine \(\+8,1 %\)/);
  assert.match(cards, /Twitch demande votre autorisation : cliquez sur « Connecter ma chaîne »/);
  assert.match(cards, /Dernier chiffre connu/);
  assert.match(cards, /YouTube cache votre nombre d'abonnés : rendez-le public dans YouTube Studio/);
  assert.match(cards, /Instagram · @emma\nAbonnés : 4\s200/);
  assert.match(cards, /Saisi à la main/);
  const visibility = blocks.find((b) => b.type === "adminForm" && b.action === "saveVisibility");
  assert.equal(visibility.fields.length, 3);
  assert.ok(visibility.fields.every((f) => f.value === "no" && f.options.length === 2), "tout est privé au départ");
  assert.match(JSON.stringify(blocks), /« Montrer sur mon site » autorise l'affichage d'un chiffre aux visiteurs/);
  assert.match(visibility.fields[0].options[1].label, /Oui, le montrer sur mon site/);
  const manual = tables.find((t) => t.rowActions?.some((a) => a.action === "forget" && /Supprimer/.test(a.label)));
  assert.ok(manual.rowActions.every((a) => !a.action || a.confirm), "toute suppression demande confirmation");
  assert.equal(manual.rowIds.length, 1);
  for (const t of tables) for (const a of t.rowActions ?? []) if (/Supprimer|Effacer/.test(a.label)) assert.ok(a.confirm && a.danger, a.label);
  const edit = await def.adminPanel(ctx, { query: { edit: manual.rowIds[0] }, now: NOW });
  assert.ok(edit.some((b) => b.type === "adminForm" && b.action === "saveManual" && b.fields.some((f) => f.name === "value" && f.value === "4200")));
  assert.match(JSON.stringify(blocks), /fréquence des mises à jour et la durée de conservation/);
});

test("admin : actions — mettre à jour (cadence), noter un chiffre (messages humains), supprimer un compte, effacer un chiffre qui ne vient plus", async () => {
  const { ctx, feed } = make({ items: [item()] });
  const realNow = Date.now; let clock = NOW; Date.now = () => clock;
  try {
    assert.match((await def.adminActions.refresh(ctx)).ok, /à jour/);
    assert.match((await def.adminActions.refresh(ctx)).error, /viennent d'être mis à jour/);
    clock += 3 * 60_000;
    assert.ok((await def.adminActions.refresh(ctx)).ok);
    const add = (v) => def.adminActions.saveManual(ctx, { platform: "Instagram", otherPlatform: "", account: "@emma", metric: "followers", value: "4200", date: "", ...v });
    assert.match((await add({})).ok, /enregistré/);
    assert.match((await add({ value: "12,5" })).error, /nombre entier/);
    assert.match((await add({ platform: "__other", otherPlatform: "" })).error, /réseau/);
    assert.match((await add({ platform: "__other", otherPlatform: "Mastodon perso", account: "emma" })).ok, /enregistré/);
    assert.ok(await statOf(ctx, "manual:mastodon-perso:emma:followers"));
    assert.match((await add({ date: "2999-01-01" })).error, /futur/);
    assert.match((await add({ platform: "__other", otherPlatform: "Twitch", account: "emma_live", metric: "followers" })).error, /Twitch donne déjà ce chiffre tout seul/);
    const manual = await statOf(ctx, "manual:instagram:emma:followers");
    assert.match((await def.adminActions.forget(ctx, { id: manual.docId })).ok, /supprimé/);
    assert.equal(await statOf(ctx, manual.id), undefined);
    assert.equal(await ctx.api.store.count("communitySamples") > 0, true);
    assert.match((await def.adminActions.forget(ctx, { id: "inconnu" })).error, /Introuvable/);
    feed.items = []; clock += DAY; await collectNow(ctx, { now: clock });
    const gone = await statOf(ctx, "twitch-channel:emma:followers");
    assert.equal(gone.state, "missing");
    const panel = await def.adminPanel(ctx, { query: {}, now: clock });
    assert.ok(panel.some((b) => b.type === "heading" && b.text === "Chiffres qui ne sont plus reçus"));
    const before = await ctx.api.store.count("communitySamples");
    await def.adminActions.forget(ctx, { id: gone.docId });
    assert.ok((await ctx.api.store.count("communitySamples")) < before, "l'historique de la statistique effacée part avec elle");
  } finally { Date.now = realNow; }
});

test("textes : aucun jargon dans les fichiers de langue ni dans ce que lit la personne (nom, description, réglages, source de chiffres)", () => {
  const banned = /\b(sujets?|métriques?|collecteurs?|collector|topics?|metrics?|api|json|schéma|schema|endpoint|payload|série temporelle|time series|relevés?)\b/i;
  const seen = [];
  const texts = (v) => (typeof v === "string" ? [v] : Object.values(v ?? {}).flatMap(texts));
  for (const [lang, file] of [["fr", fr], ["en", en]]) for (const [k, s] of Object.entries(file)) seen.push([`${lang}.${k}`, s]);
  for (const part of [manifestJson.name, manifestJson.description, manifestJson.consumes[0].label, ...manifestJson.settings.flatMap((s) => [s.label, s.help, ...(s.options ?? []).map((o) => o.label)])]) for (const s of texts(part)) seen.push(["module.json", s]);
  for (const [where, s] of seen) assert.ok(!banned.test(s), `${where} : « ${s} »`);
  assert.ok(!/[^\p{L}\p{N}]id[^\p{L}\p{N}]/iu.test(fr.title + fr.intro + fr.manualHelp), "pas d'identifiant à l'écran");
});

test("i18n : mêmes clés en fr et en, toutes les clés ctx.t du code existent (y compris celles construites : métriques, unités, fréquences, raisons, erreurs)", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  for (const m of source.matchAll(/\bt\(`([A-Za-z0-9_]+)\$\{/g)) assert.ok(Object.keys(fr).some((k) => k.startsWith(m[1])), `préfixe ${m[1]}`);
  for (const metric of ["followers", "paying", "content", "views"]) for (const k of [`metric_${metric}`, `unit_${metric}_one`, `unit_${metric}_other`]) assert.ok(fr[k] && en[k], k);
  for (const p of ["1h", "6h", "12h", "1d", "1w"]) assert.ok(fr[`freq_${p}`] && en[`freq_${p}`]);
  for (const e of ["auth", "rate", "network", "hidden", "config", "missing"]) assert.ok(fr[`reason_${e}`] && en[`reason_${e}`], e);
  for (const e of ["platform", "account", "metric", "value", "date", "future", "automatic", "tooMany"]) assert.ok(fr[`err_${e}`] && en[`err_${e}`], e);
  for (const k of ["evoUp7", "evoDown7", "evoFlat7", "evoUp30", "evoDown30", "evoFlat30"]) assert.ok(fr[k] && en[k], k);
  for (const [lang, file] of [["fr", fr], ["en", en]]) for (const [k, s] of Object.entries(file)) assert.ok(String(s).trim().length > 0 && !/TODO|XXX/.test(s), `${lang}.${k}`);
});

test("SRP : le module ne connaît aucun module de réseau, n'appelle aucun service, ne garde que ses collections et n'invente aucun cumul", () => {
  assert.ok(!/[a-z]+-channel|ctx\.api\.instances/.test(source.replace(/\/\/.*$/gm, "")), "aucun identifiant de module fournisseur dans le code : seules les statistiques publiées comptent");
  assert.ok(!source.includes("ctx.api.services"));
  const collections = new Set([...source.matchAll(/store\.(?:add|list|count)\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...collections].sort(), ["communityRun", "communitySamples", "communityStats"]);
  assert.ok(!/audience totale|total audience|\.reduce\(|\bsum\(/i.test(source.replace(/\/\/.*$/gm, "")), "aucun cumul fabriqué entre statistiques");
});

test("addPoint : jamais deux points dans la même période, même à cheval sur deux mois ; les points restent triés", async () => {
  const { ctx } = make();
  const stat = { id: "x-mod:k:views", metric: "views", chunks: {}, source: "auto" };
  const week = 7 * DAY;
  const t1 = Date.parse("2026-09-30T23:00:00Z"); // jeudi d'une période hebdomadaire qui chevauche septembre/octobre
  const bucket = Math.floor(t1 / week);
  const t2 = Math.min(Date.parse("2026-10-01T01:00:00Z"), (bucket + 1) * week - 1);
  await addPoint(ctx, stat, t1, 10, week);
  await addPoint(ctx, stat, t2, 11, week);
  const all = await readPoints(ctx, stat, 0);
  assert.equal(all.length, Math.floor(t2 / week) === bucket ? 1 : 2);
  await addPoint(ctx, stat, t1 - 20 * DAY, 5, week);
  const sorted = await readPoints(ctx, stat, 0);
  assert.deepEqual(sorted.map((p) => p[0]), [...sorted.map((p) => p[0])].sort((a, b) => a - b));
});

// ── Chiffres de période (30 jours glissants) publiés par Chaîne Twitch : avg_viewers, peak_viewers, hours_streamed, hours_watched, followers_gained ──

const PERIOD = { avg_viewers: 150, peak_viewers: 240, hours_streamed: 750, hours_watched: 17680, followers_gained: 40 };   // les durées sont en MINUTES
const periodItems = () => Object.entries(PERIOD).map(([metric, value]) => item({ id: `twitch-channel:emma:${metric}`, metric, value, label: `Twitch ${metric}` }));

test("période : la liste fermée accepte les cinq chiffres de direct, refuse un nom inconnu, un identifiant qui ne correspond pas, un décimal, un négatif", () => {
  for (const [metric, value] of Object.entries(PERIOD)) assert.equal(validateItem(item({ id: `twitch-channel:emma:${metric}`, metric, value, label: "x" })).ok, true, metric);
  assert.equal(validateItem(item({ id: "twitch-channel:emma:avg_viewers", metric: "avg_viewers", value: 0 })).ok, true, "zéro = aucun direct mesuré");
  assert.equal(validateItem(item({ id: "twitch-channel:emma:revenue", metric: "revenue" })).ok, false);
  assert.equal(validateItem(item({ id: "twitch-channel:emma:avg_viewers", metric: "peak_viewers" })).ok, false);
  assert.equal(validateItem(item({ id: "twitch-channel:emma:avg_viewers", metric: "avg_viewers", value: 10.5 })).ok, false);
  assert.equal(validateItem(item({ id: "twitch-channel:emma:avg_viewers", metric: "avg_viewers", value: -1 })).ok, false);
  assert.equal(validateItem(item({ id: "twitch-channel:emma:followers_gained", metric: "followers_gained", value: undefined, error: "auth" })).ok, true, "pas de chiffre pour cause d'autorisation");
});

test("période : gardés dans l'historique comme les autres ; la saisie à la main reste réservée aux quatre chiffres d'origine", async () => {
  const { ctx } = make({ items: periodItems() });
  const r = await collectNow(ctx, { now: NOW });
  assert.deepEqual([r.status, r.stored, r.rejected], ["done", 5, 0]);
  assert.deepEqual(await pointsOf(ctx, "twitch-channel:emma:hours_streamed"), [[Math.floor(NOW / 1000), 750]]);
  await assert.rejects(setManual(ctx, { platform: "Instagram", account: "@emma", metric: "avg_viewers", value: 5 }, { now: NOW }), (e) => e.code === "metric");
  const form = JSON.stringify(await def.adminPanel(ctx, { query: {}, now: NOW }));
  assert.ok(!/"value":"avg_viewers"/.test(form), "le formulaire de saisie n'offre pas les chiffres de direct");
});

test("période : la page d'administration parle simplement (durées en heures et minutes, pas de comparaison hebdomadaire inventée)", async () => {
  const { ctx } = make({ items: periodItems() });
  await collectNow(ctx, { now: NOW });
  const text = JSON.stringify(await def.adminPanel(ctx, { query: {}, now: NOW + 3600_000 }));
  assert.match(text, /Spectateurs moyens \(30 jours\) : 150/);
  assert.match(text, /Pic de spectateurs \(30 jours\) : 240/);
  assert.match(text, /Temps de direct \(30 jours\) : 12 h 30/);
  assert.match(text, /Temps regardé par vos spectateurs \(30 jours\) : 294 h 40/);
  assert.match(text, /Followers gagnés en direct \(30 jours\) : 40/);
  assert.match(text, /Calculé sur vos directs des 30 derniers jours, mesurés par votre site\./);
  const short = JSON.stringify(await def.adminPanel(make({ items: [item({ id: "twitch-channel:emma:hours_streamed", metric: "hours_streamed", value: 45 })] }).ctx, { query: {}, now: NOW }));
  assert.ok(!/45 min/.test(short), "avant la première collecte rien n'est affiché");
  const m = make({ items: [item({ id: "twitch-channel:emma:hours_streamed", metric: "hours_streamed", value: 45 })], locale: "en" });
  await collectNow(m.ctx, { now: NOW });
  assert.match(JSON.stringify(await def.adminPanel(m.ctx, { query: {}, now: NOW })), /Time live \(30 days\) : 45 min/);
  for (const k of ["metric_avg_viewers", "metric_peak_viewers", "metric_hours_streamed", "metric_hours_watched", "metric_followers_gained", "periodNote", "durHm", "durM"]) assert.ok(fr[k] && en[k], k);
});

test("période : l'IA voit l'unité (minutes, spectateurs, personnes) ; le filtre de métrique accepte les nouveaux chiffres", async () => {
  const { ctx } = make({ items: periodItems() });
  await collectNow(ctx, { now: NOW });
  const all = await def.mcp.community_stats_list(ctx, {});
  const by = Object.fromEntries(all.stats.map((s) => [s.metric, s]));
  assert.deepEqual([by.hours_streamed.unit, by.hours_watched.unit, by.avg_viewers.unit, by.peak_viewers.unit, by.followers_gained.unit], ["minutes", "minutes", "viewers", "viewers", "people"]);
  assert.equal(by.hours_streamed.value, 750);
  assert.equal((await def.mcp.community_stats_list(ctx, { metric: "peak_viewers" })).count, 1);
  const tool = manifestJson.mcp.find((t) => t.name === "community_stats_list");
  for (const k of Object.keys(PERIOD)) assert.ok(tool.input.properties.metric.enum.includes(k), k);
  assert.ok(tool.description.length <= 1000);
});

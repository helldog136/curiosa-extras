// Chaîne Twitch : l'enregistreur de directs (sessions, segments par jeu), les vidéos et clips, les chiffres de synthèse (social.stat), les outils MCP et le panneau « Mes directs ».
// Aucun réseau : un faux Helix scripté dans le temps (tests/helpers/fakeLive.mjs) avec une horloge simulée (Date.now).
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { fakeLive, T0, MIN, video, clip } from "./helpers/fakeLive.mjs";
import { connector, connectorModule } from "./helpers/twitchConnector.mjs";
import { problemsOfList } from "./helpers/socialStatContract.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/twitch-channel", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8")), en = JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8"));
const mod = await import("../modules/twitch-channel/index.mjs");
const live = await import("../modules/twitch-channel/live.mjs");
const helix = await import("../modules/twitch-channel/helix.mjs");
const def = mod.default;
const realFetch = globalThis.fetch;
let L, C;   // C : le vrai Connecteur Twitch (application « cid »), par qui passent tous les appels
beforeEach(() => { mod.resetCache(); connectorModule.resetCache(); L = fakeLive(); L.install(); C = connector(); });
afterEach(() => L.restore(realFetch));

const settings = (extra = {}) => ({ channel: "MaChaine", trackStats: true, statsFollowers: true, ...extra });
const mk = (extra = {}, key = "tw", locale = "fr") => fakeCtx({ key, locale, messages: locale === "fr" ? fr : en, settings: settings(extra), services: { "twitch.api": C.methods } });
/** Le « client » que Ma Chaîne Twitch donne à helix.mjs : la chaîne et l'appel au Connecteur. */
const client = (channel = "machaine") => ({ channel, call: async (req) => { const r = await C.methods.request({ ...req, channel }); return r.ok ? { status: r.status, json: r.json } : { error: r.error }; }, account: () => C.methods.account({ channel }) });
/** Un passage de la tâche planifiée à la minute `min` (horloge simulée). */
const tick = async (ctx, min) => { L.at(min); await def.tasks["record-lives"].run(ctx); };
const sessionsOf = async (ctx, opts) => (await live.listSessions(ctx, { limit: 100, ...opts })).sessions;
const stat = (ctx) => def.exports["social.stat"](ctx, { limit: 50 });
const byMetric = (items) => Object.fromEntries(items.map((x) => [x.metric, x]));
const everyIt = async (ctx, f) => { for (let m = 0; m <= 8; m += 2) await f(m); };

/** Un direct simple : 5 mesures (10, 20, 30, 40, 50 spectateurs) toutes les 2 minutes, puis 3 vérifications hors direct. */
async function simpleLive(ctx) {
  L.tw.state.followers = 100;
  for (const [m, v] of [[0, 10], [2, 20], [4, 30], [6, 40], [8, 50]]) {
    L.live("777", { viewer_count: v, started_at: new Date(T0 - 60_000).toISOString() });
    if (m === 8) L.tw.state.followers = 105;
    await tick(ctx, m);
  }
  L.offline();
  L.tw.state.followers = 106;
  for (const m of [10, 12, 14]) await tick(ctx, m);
}

// ── Manifeste, tâche, interrupteur ───────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : tâche « record-lives » chaque minute (granularité minimale du cœur), trois outils MCP en lecture seule jamais accordés d'office, réglages avancés avec défauts", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(def.tasks["record-lives"].everyMinutes, 1);
  assert.deepEqual(manifest.mcp.map((t) => t.name), ["twitch_streams", "twitch_games", "twitch_videos"]);
  for (const t of manifest.mcp) { assert.equal(t.readOnly, true); assert.equal(t.default, false); assert.ok(`mcp__Helldog136_Site__twitch-channel__${t.name}`.length <= 64); assert.ok(t.name.length <= 24); assert.ok(t.description.length > 100 && t.description.length <= 1000); assert.equal(typeof def.mcp[t.name], "function"); }
  assert.ok(manifest.permissions.includes("mcp"));
  const s = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.deepEqual([s.liveEveryMinutes.default, s.rawDays.default, s.keepYears.default], ["2", "90", "5"]);
  for (const k of ["liveEveryMinutes", "rawDays", "keepYears"]) { assert.equal(s[k].advanced, true); assert.ok(s[k].options.some((o) => o.value === s[k].default)); }
  assert.equal(s.trackStats.default, false, "rien ne change pour un site qui n'a pas coché l'interrupteur");
});

test("« Suivre mes statistiques » décoché : aucune requête, aucune donnée, aucun chiffre ; chaîne ou identifiants invalides : idem", async () => {
  for (const extra of [{ trackStats: false }, { channel: "a b!" }, { noApp: true }]) {
    if (extra.noApp) C = connector({ settings: {} });   // Connecteur sans application Twitch
    const ctx = mk(extra);
    L.live("777");
    for (let m = 0; m < 20; m += 2) await tick(ctx, m);
    assert.equal(L.log.length, 0); assert.equal(L.tw.log.length, 0);
    for (const c of Object.values(live.COLLECTIONS)) assert.equal(await ctx.api.store.count(c), 0);
    assert.ok(!(await stat(ctx)).some((x) => /_viewers|hours_|gained/.test(x.metric)), "aucun chiffre de direct");
  }
  assert.deepEqual(await stat(mk({ trackStats: false })), []);
  const ctx = mk({ trackStats: false });
  assert.match((await def.mcp.twitch_streams(ctx, {})).note, /switched off/);
  assert.equal(JSON.stringify(await def.adminPanel(ctx)), "[]");
});

// ── Sessions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("session simple : début, fin, durée, pic, moyenne pondérée, heures regardées, followers au début et à la fin, fermée après 3 vérifications hors direct", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  await simpleLive(ctx);
  const [s, ...others] = await sessionsOf(ctx);
  assert.equal(others.length, 0);
  assert.equal(s.open, false);
  assert.equal(s.startedAt, new Date(T0 - 60_000).toISOString(), "le début est celui de Twitch");
  assert.equal(s.endedAt, new Date(T0 + 8 * MIN).toISOString(), "la fin est la dernière mesure en direct");
  assert.equal(s.durationSec, 540);
  assert.equal(s.peakViewers, 50);
  assert.equal(s.viewerSeconds, (10 + 20 + 30 + 40) * 120, "chaque mesure vaut jusqu'à la suivante");
  assert.equal(s.coveredSec, 480);
  assert.equal(s.avgViewers, 25);
  assert.equal(s.hoursWatched, 3.3);
  assert.deepEqual([s.followersStart, s.followersEnd, s.followersGained], [100, 106, 6]);
  assert.equal(s.approximate, false);
  assert.equal(s.segments.length, 1);
  assert.equal(s.segments[0].followersPerHour, null, "moins de 10 minutes : pas de followers par heure inventés");
});

test("plusieurs jeux dans un direct : un segment par jeu (début, fin, durée, moyenne, pic, heures regardées, followers gagnés, followers par heure)", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  const followersAt = (m) => (m <= 60 ? 100 + Math.floor(m / 2) : 130 + Math.floor((m - 60) / 6));
  for (let m = 0; m <= 118; m += 2) {
    L.tw.state.followers = followersAt(m);
    L.live("777", m < 60 ? { viewer_count: 100, game_id: "1", game_name: "Zelda", started_at: new Date(T0).toISOString() } : { viewer_count: 200 + (m === 90 ? 40 : 0), game_id: "509658", game_name: "Just Chatting", started_at: new Date(T0).toISOString() });
    await tick(ctx, m);
  }
  L.offline();
  for (const m of [120, 122, 124]) { L.tw.state.followers = followersAt(m); await tick(ctx, m); }
  const [s] = await sessionsOf(ctx);
  assert.equal(s.segments.length, 2);
  const [a, b] = s.segments;
  assert.deepEqual([a.game, a.durationSec, a.avgViewers, a.peakViewers, a.hoursWatched], ["Zelda", 3600, 100, 100, 100]);
  assert.deepEqual([a.followersGained, a.followersPerHour], [30, 30]);
  assert.deepEqual([b.game, b.durationSec, b.peakViewers, b.followersGained], ["Just Chatting", 3480, 240, 10]);
  assert.equal(b.followersPerHour, 10.3);
  assert.equal(a.endedAt, b.startedAt, "les segments se suivent sans trou ni chevauchement");
  assert.equal(s.durationSec, 118 * 60);
  assert.deepEqual([s.followersStart, s.followersEnd, s.followersGained], [100, 140, 40]);
  assert.equal(s.viewerSeconds, a.viewerSeconds + b.viewerSeconds);
  assert.equal(s.peakViewers, 240);
  // par jeu sur une période : « followers par heure » seulement avec au moins 1 h de direct aux followers connus
  const games = live.gamesOf([s]);
  assert.deepEqual(games.map((g) => [g.game, g.followersPerHour]).sort(), [["Just Chatting", null], ["Zelda", 30]]);
});

test("coupure brève (2 vérifications hors direct) : le direct continue ; fin réelle (3) : il se ferme ; le trou n'est pas compté comme regardé", async () => {
  const ctx = mk();
  for (const m of [0, 2, 4, 6]) { L.live("777", { viewer_count: 100 }); await tick(ctx, m); }
  L.offline();
  for (const m of [8, 10]) await tick(ctx, m);
  assert.equal((await sessionsOf(ctx))[0].open, true, "2 vérifications hors direct : pas fermé");
  L.live("777", { viewer_count: 100, id: "S2" });   // Twitch a donné un nouveau numéro de direct après la coupure
  for (const m of [12, 14]) await tick(ctx, m);
  let all = await sessionsOf(ctx);
  assert.equal(all.length, 1, "une seule session : la coupure brève ne coupe pas le direct en deux");
  assert.equal(all[0].coveredSec, 480);
  assert.equal(all[0].cutSec, 360, "les 6 minutes entre la dernière mesure et la reprise ne comptent pas");
  assert.equal(all[0].viewerSeconds, 100 * (360 + 120), "6→... : (0→6 min) + (12→14 min)");
  assert.equal(all[0].approximate, false, "une coupure réelle n'est pas une approximation");
  L.offline();
  for (const m of [16, 18]) await tick(ctx, m);
  assert.equal((await sessionsOf(ctx))[0].open, true);
  await tick(ctx, 20);
  all = await sessionsOf(ctx);
  assert.equal(all[0].open, false); assert.equal(all[0].endedAt, new Date(T0 + 14 * MIN).toISOString());
  // un second direct plus tard = une seconde session
  L.live("777", { id: "S3", started_at: new Date(T0 + 60 * MIN).toISOString(), viewer_count: 7 });
  await tick(ctx, 60);
  assert.equal((await sessionsOf(ctx)).length, 2);
});

test("redémarrage du site au milieu d'un direct : refermé à la dernière mesure, marqué approximatif ; trou court dans le même direct : compté à part", async () => {
  // A. le site est arrêté 2 h, le direct est fini : fermeture immédiate à la dernière mesure connue
  const a = mk({}, "a");
  for (const m of [0, 2, 4, 6, 8]) { L.live("777", { viewer_count: 50 }); await tick(a, m); }
  L.offline();
  await tick(a, 120);
  let [s] = await sessionsOf(a);
  assert.equal(s.open, false); assert.equal(s.endedAt, new Date(T0 + 8 * MIN).toISOString());
  assert.deepEqual(s.approxReasons, ["interrupted"]); assert.equal(s.approximate, true);
  // B. le site manque 20 minutes mais le même direct continue : même session, trou jamais comblé
  const b = mk({}, "b");
  for (const m of [0, 2, 4, 6, 8]) { L.live("777", { viewer_count: 50 }); await tick(b, m); }
  await tick(b, 28);
  [s] = await sessionsOf(b);
  assert.equal(s.open, true); assert.equal(s.gapSec, 20 * 60); assert.deepEqual(s.approxReasons, ["gaps"]);
  assert.equal(s.coveredSec, 8 * 60, "seules les minutes mesurées comptent");
  assert.equal(s.viewerSeconds, 50 * 480);
  // C. plus de 30 minutes sans mesure : l'ancien direct est refermé (interrompu), un nouveau commence
  const c = mk({}, "c");
  for (const m of [0, 2, 4]) { L.live("777", { viewer_count: 50 }); await tick(c, m); }
  await tick(c, 60);
  const all = await sessionsOf(c);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((x) => x.open), [true, false]);
  assert.deepEqual(all[1].approxReasons, ["interrupted"]);
  assert.deepEqual(all[0].approxReasons, ["partial_start"], "le nouveau a commencé avant d'être mesuré");
});

test("moyenne pondérée par le temps (pas la moyenne des mesures) ; heures regardées = somme spectateurs × temps ; trou de 4 minutes toléré, jamais interpolé au-delà de 3 intervalles", async () => {
  const ctx = mk();
  for (const [m, v] of [[0, 100], [2, 100], [6, 500], [8, 500], [10, 300]]) { L.live("777", { viewer_count: v }); await tick(ctx, m); }
  L.offline();
  for (const m of [12, 14, 16]) await tick(ctx, m);
  const [s] = await sessionsOf(ctx);
  assert.equal(s.viewerSeconds, 100 * 120 + 100 * 240 + 500 * 120 + 500 * 120);
  assert.equal(s.coveredSec, 600);
  assert.equal(s.avgViewers, 260, "la moyenne simple des mesures serait 300");
  assert.equal(s.hoursWatched, 43.3);
  assert.equal(s.peakViewers, 500);
  assert.equal(s.gapSec, 0);
});

test("pic, un seul direct très court (une mesure) : le chiffre mesuré, jamais un zéro ni une estimation", async () => {
  const ctx = mk();
  L.live("777", { viewer_count: 77 }); await tick(ctx, 0);
  L.offline();
  for (const m of [2, 4, 6]) await tick(ctx, m);
  const [s] = await sessionsOf(ctx);
  assert.deepEqual([s.peakViewers, s.avgViewers, s.hoursWatched, s.coveredSec, s.open], [77, 77, 0, 0, false]);
});

test("chaîne jamais en direct : aucune session, aucune mesure brute, aucune erreur ; le suivi indique depuis quand il est actif", async () => {
  const ctx = mk();
  for (let m = 0; m < 60; m += 4) await tick(ctx, m);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.sessions), 0);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.days), 0);
  assert.equal(L.calls("streams").length, 15, "hors direct : une vérification toutes les 4 minutes");
  const st = await live.trackingState(ctx);
  assert.equal(st.since, T0); assert.equal(st.lastError, null);
  const panel = JSON.stringify(await def.adminPanel(ctx));
  assert.match(panel, /Suivi actif depuis le/); assert.match(panel, /Aucun direct mesuré pour l'instant/);
  const note = (await def.mcp.twitch_streams(ctx, {})).note;
  assert.match(note, /none measured since 2026-10-15T18:00:00.000Z/);
  const items = byMetric(await stat(ctx));
  assert.equal(items.hours_streamed.value, 0); assert.equal(items.peak_viewers.value, 0);
});

test("fréquence : 2 minutes en direct (1 requête de direct par mesure), 4 minutes hors direct, réglable de 1 à 5 minutes ; jamais deux fois à la même seconde", async () => {
  const ctx = mk();
  L.live("777"); L.at(0);
  for (let s = 0; s < 600; s += 20) { L.state.clock = T0 + s * 1000; await def.tasks["record-lives"].run(ctx); }
  assert.equal(L.calls("streams").length, 5, "10 minutes de passages toutes les 20 s : 5 mesures");
  const fast = mk({ liveEveryMinutes: "1" }, "f");
  for (let s = 0; s < 300; s += 20) { L.state.clock = T0 + 3600_000 + s * 1000; await def.tasks["record-lives"].run(fast); }
  assert.equal(L.calls("streams").length, 10, "1 minute : 5 mesures de plus");
  assert.equal(live.intervalOf(mk({ liveEveryMinutes: "0" })), 2); assert.equal(live.intervalOf(mk({ liveEveryMinutes: "99" })), 2);
  assert.equal(live.rawDaysOf(mk({ rawDays: "x" })), 90); assert.equal(live.keepYearsOf(mk({ keepYears: "50" })), 5);
});

test("plusieurs chaînes : chacune son suivi, ses sessions et ses chiffres ; un seul jeton d'application (une application, celle du Connecteur)", async () => {
  const a = mk({}, "a"), b = mk({ channel: "autre" }, "b");
  L.live("777", { viewer_count: 40, id: "A1" }); L.live("888", { viewer_count: 900, id: "B1", game_name: "Chess", game_id: "5" });
  for (const m of [0, 2, 4]) { await tick(a, m); await tick(b, m); }
  L.offline("777"); L.offline("888");
  for (const m of [6, 8, 10]) { await tick(a, m); await tick(b, m); }
  const [sa] = await sessionsOf(a), [sb] = await sessionsOf(b);
  assert.deepEqual([sa.peakViewers, sa.segments[0].game], [40, "Zelda"]);
  assert.deepEqual([sb.peakViewers, sb.segments[0].game], [900, "Chess"]);
  assert.equal(L.tw.log.filter((c) => c.path === "/oauth2/token").length, 1);
  assert.equal(byMetric(await stat(a)).peak_viewers.id, "twitch-channel:a:peak_viewers");
  assert.equal(byMetric(await stat(b)).peak_viewers.id, "twitch-channel:b:peak_viewers");
  assert.equal(byMetric(await stat(b)).peak_viewers.value, 900);
});

// ── Erreurs : jamais de mesure fausse ──────────────────────────────────────────────────────────────────────────────────────────────

test("429 : aucune mesure, le direct en cours n'est pas fermé, et plus aucune requête pendant la pause (Connecteur : 60 s sans Retry-After)", async () => {
  const ctx = mk();
  for (const m of [0, 2, 4]) { L.live("777", { viewer_count: 30 }); await tick(ctx, m); }
  const before = (await sessionsOf(ctx))[0];
  L.state.fail.streams = 429;
  await tick(ctx, 6);
  assert.equal((await live.trackingState(ctx)).lastError.code, "rate");
  const n = L.log.length;
  assert.deepEqual(await helix.streamNow(client()), { error: "rate" });
  assert.equal(L.log.length, n, "pendant la pause, Twitch n'est pas rappelé");
  const after = (await sessionsOf(ctx))[0];
  assert.deepEqual([after.open, after.samples, after.lastMeasureAt], [true, before.samples, before.lastMeasureAt], "rien n'a été écrit");
  delete L.state.fail.streams;
  await tick(ctx, 8);   // 2 minutes plus tard : la pause est finie, le direct continue
  assert.equal((await sessionsOf(ctx))[0].samples, before.samples + 1);
  assert.equal((await live.trackingState(ctx)).lastError, null);
});

test("401 : le jeton est renouvelé une fois puis la mesure est prise ; un 401 persistant ou une panne réseau n'écrivent rien", async () => {
  const ctx = mk();
  L.live("777", { viewer_count: 12 });
  L.state.failOnce.streams = 401;
  await tick(ctx, 0);
  assert.equal(L.tw.log.filter((c) => c.path === "/oauth2/token").length, 2, "nouveau jeton après le 401");
  assert.equal((await sessionsOf(ctx))[0].samples, 1);
  L.state.fail.streams = 401;
  await tick(ctx, 2);
  assert.equal((await live.trackingState(ctx)).lastError.code, "auth");
  L.state.fail.streams = "throw";
  await tick(ctx, 4);
  assert.equal((await live.trackingState(ctx)).lastError.code, "network");
  L.state.fail.streams = 500;
  await tick(ctx, 6);
  const s = (await sessionsOf(ctx))[0];
  assert.deepEqual([s.open, s.samples], [true, 1]);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.days), 1, "une seule mesure brute");
  delete L.state.fail.streams;
  L.live("777", { viewer_count: 20 });
  await tick(ctx, 20);   // 14 minutes après la dernière mesure : le trou est compté à part
  const t = (await sessionsOf(ctx))[0];
  assert.deepEqual([t.samples, t.coveredSec, t.gapSec, t.approximate], [2, 0, 1200, true]);
});

test("une réponse sans nombre de spectateurs valide est une erreur, pas un zéro", async () => {
  const ctx = mk();
  L.live("777", { viewer_count: "beaucoup" });
  await tick(ctx, 0);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.sessions), 0);
  assert.equal((await live.trackingState(ctx)).lastError.code, "network");
});

test("followers illisibles (non connectée, 429) : les spectateurs sont mesurés, les followers restent « inconnus » (null), jamais 0 ni inventés", async () => {
  const ctx = mk();   // pas de connexion de compte
  L.live("777", { viewer_count: 30 });
  for (const m of [0, 2, 4]) await tick(ctx, m);
  L.offline();
  for (const m of [6, 8, 10]) await tick(ctx, m);
  const [s] = await sessionsOf(ctx);
  assert.deepEqual([s.peakViewers, s.followersStart, s.followersEnd, s.followersGained, s.segments[0].followersPerHour], [30, null, null, null, null]);
  assert.equal(L.tw.log.filter((c) => c.path === "/helix/channels/followers").length, 0, "pas de connexion : aucun appel followers");
  const items = byMetric(await stat(ctx));
  assert.equal(items.followers_gained.error, "auth"); assert.ok(!("value" in items.followers_gained));
  assert.equal(items.peak_viewers.value, 30);
  // connectée mais Twitch répond 429 aux followers
  const c2 = mk({}, "c2"); await L.connect(C.ctx);
  L.tw.state.rateLimited = true;
  L.live("777", { viewer_count: 5 });
  await tick(c2, 60);
  assert.deepEqual([(await sessionsOf(c2))[0].followersStart, (await sessionsOf(c2))[0].samples], [null, 1]);
});

test("followers : relevés à l'ouverture, au changement de jeu et à la fermeture, sinon au plus toutes les 10 minutes", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  for (let m = 0; m <= 30; m += 2) { L.live("777", { viewer_count: 10 }); await tick(ctx, m); }
  const reads = L.tw.log.filter((c) => c.path === "/helix/channels/followers");
  assert.equal(reads.length, 4, "à 0, 10, 20 et 30 minutes");
});

// ── Volumes et purge ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function days(ctx, n, { base = 0 } = {}) {
  for (let d = base; d < base + n; d++) {
    const at = d * 1440, start = new Date(T0 + at * MIN).toISOString();
    for (const m of [0, 2]) { L.live("777", { id: `S${d}`, started_at: start, viewer_count: 10 + d }); await tick(ctx, at + m); }
    L.offline();
    for (const m of [4, 6, 8]) await tick(ctx, at + m);
  }
}
test("volume borné : mesures brutes 90 jours puis supprimées, résumés gardés (5 ans par défaut) ; un direct en cours n'est jamais purgé", async () => {
  const ctx = mk();
  await days(ctx, 130);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.days), 91, "90 jours + aujourd'hui");
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.sessions), 130, "tous les résumés");
  const [oldest] = (await live.listSessions(ctx, { limit: 200 })).sessions.slice(-1);
  assert.equal(oldest.peakViewers, 10);
});

test("conservation réglable : 30 jours de détail et 1 an de résumés", async () => {
  const ctx = mk({ rawDays: "30", keepYears: "1" });
  await days(ctx, 400);
  assert.equal(await ctx.api.store.count(live.COLLECTIONS.days), 31);
  const n = await ctx.api.store.count(live.COLLECTIONS.sessions);
  assert.ok(n >= 364 && n <= 366, `résumés d'un an : ${n}`);
});

test("taille d'un document : une mesure brute ≈ 35 octets, un résumé de direct à deux jeux ≈ 1 à 2 Ko", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  for (let m = 0; m <= 118; m += 2) { L.live("777", { viewer_count: 123, game_id: m < 60 ? "1" : "509658", game_name: m < 60 ? "Zelda" : "Just Chatting" }); await tick(ctx, m); }
  const day = (await ctx.api.store.list(live.COLLECTIONS.days))[0].data;
  assert.equal(day.points.length, 60);
  assert.ok(JSON.stringify(day).length / 60 < 45, `${JSON.stringify(day).length / 60} octets par mesure`);
  const sess = (await ctx.api.store.list(live.COLLECTIONS.sessions))[0].data;
  assert.ok(JSON.stringify(sess).length < 2500, `${JSON.stringify(sess).length} octets`);
  assert.equal(live.MAX_DAY_POINTS, 1500); assert.equal(live.MAX_SESSIONS, 3000); assert.equal(live.MAX_SEGMENTS, 40);
});

test("« Effacer les mesures » : tout part (directs, mesures, listes, état), le suivi repart de zéro ; une confirmation est demandée", async () => {
  const ctx = mk();
  await simpleLive(ctx);
  assert.ok(await ctx.api.store.count(live.COLLECTIONS.sessions) > 0);
  const panel = await def.adminPanel(ctx);
  const erase = panel.find((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "eraseLive"));
  assert.ok(erase.rowActions[0].confirm && erase.rowActions[0].danger);
  const r = await def.adminActions.eraseLive(ctx);
  assert.equal(r.ok, fr.live_erased);
  for (const c of Object.values(live.COLLECTIONS)) assert.equal(await ctx.api.store.count(c), 0, c);
  assert.equal(await live.trackingSince(ctx), null);
});

// ── Vidéos et clips ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("vidéos : pagination bornée à 300 (3 pages), seuls les types connus et les adresses Twitch, cache 30 minutes, durées lues", async () => {
  const ctx = mk();
  L.state.videos = Array.from({ length: 450 }, (_, i) => video(i + 1, i === 4 ? { type: "weird" } : i === 5 ? { url: "javascript:alert(1)" } : {}));
  await tick(ctx, 0);
  assert.equal(L.calls("videos").length, 3);
  const lists = await live.readLists(ctx);
  assert.ok(lists.videos.items.length <= 300 && lists.videos.items.length >= 296);
  assert.ok(lists.videos.items.every((v) => ["archive", "highlight", "upload"].includes(v.type) && /^https:\/\/www\.twitch\.tv\//.test(v.url)));
  assert.equal(lists.videos.items.find((v) => v.id === "v1").durationSec, 2 * 3600 + 3 * 60 + 4);
  await tick(ctx, 4); await tick(ctx, 28);
  assert.equal(L.calls("videos").length, 3, "pas de nouvelle série avant 30 minutes");
  await tick(ctx, 32);
  assert.equal(L.calls("videos").length, 6);
});

test("clips : 100 au plus, titre, vues, date, jeu (noms résolus en un seul appel), adresses Twitch seulement", async () => {
  const ctx = mk();
  L.state.clips = [...Array.from({ length: 130 }, (_, i) => clip(i + 1)), clip(999, { url: "https://evil.example/x" })];
  await tick(ctx, 0);
  assert.equal(L.calls("clips").length, 1); assert.match(L.calls("clips")[0].search, /first=100/);
  assert.equal(L.calls("games").length, 1);
  const { clips } = await live.readLists(ctx);
  assert.equal(clips.items.length, 100);
  assert.deepEqual(new Set(clips.items.map((c) => c.game)), new Set(["Zelda", "Just Chatting"]));
});

test("vidéos : erreur de Twitch = on garde les dernières vues connues, datées, et on réessaie dans 5 minutes", async () => {
  const ctx = mk();
  L.state.videos = [video(1), video(2)];
  await tick(ctx, 0);
  const first = (await live.readLists(ctx)).videos;
  L.state.fail.videos = 503;
  await tick(ctx, 32);
  const lists = await live.readLists(ctx);
  assert.equal(lists.videos.error, "network"); assert.equal(lists.videos.items.length, 2); assert.equal(lists.videos.at, first.at);
  const out = await def.mcp.twitch_videos(ctx, {});
  assert.equal(out.problem, "network"); assert.match(out.note, /last known/); assert.equal(out.videos.length, 2);
  delete L.state.fail.videos;
  await tick(ctx, 38);
  assert.equal((await live.readLists(ctx)).videos.error, undefined);
});

// ── Outils MCP ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("twitch_streams : derniers directs avec unités claires, période, limite bornée, jeux ; réponse vide explicite", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  assert.match((await def.mcp.twitch_streams(ctx, {})).note, /Streams: none measured since|just been switched on|none/);
  await simpleLive(ctx);
  const out = await def.mcp.twitch_streams(ctx, { days: 7, limit: 5000 });
  assert.equal(out.count, 1); assert.equal(out.period.days, 7);
  const s = out.streams[0];
  assert.deepEqual([s.durationMinutes, s.peakViewers, s.averageViewers, s.viewerHours, s.followersGained, s.approximate, s.ongoing], [9, 50, 25, 3.3, 6, false, false]);
  assert.equal(s.games[0].game, "Zelda");
  assert.match(out.units, /minutes/);
  // période sans direct : réponse vide expliquée
  const none = await def.mcp.twitch_streams(ctx, { since: "2030-01-01" });
  assert.equal(none.count, 0); assert.match(none.note, /none measured since/); assert.match(none.note, /only while the channel is live/);
  // bornes
  assert.equal((await def.mcp.twitch_streams(ctx, { days: -4, limit: 0 })).period.days, 1);
  assert.equal((await def.mcp.twitch_streams(ctx, { days: 999999 })).period.days, 3650);
});

test("twitch_games : tri (défaut followers par heure), nombre de directs, followers par heure nul sous 1 h", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  const followersAt = (m) => (m <= 60 ? 100 + Math.floor(m / 2) : 130 + Math.floor((m - 60) / 6));
  for (let m = 0; m <= 118; m += 2) {
    L.tw.state.followers = followersAt(m);
    L.live("777", m < 60 ? { viewer_count: 100, game_id: "1", game_name: "Zelda" } : { viewer_count: 300, game_id: "509658", game_name: "Just Chatting" });
    await tick(ctx, m);
  }
  L.offline();
  for (const m of [120, 122, 124]) { L.tw.state.followers = followersAt(m); await tick(ctx, m); }
  const out = await def.mcp.twitch_games(ctx, {});
  assert.deepEqual(out.games.map((g) => g.game), ["Zelda", "Just Chatting"]);
  assert.deepEqual([out.games[0].streams, out.games[0].hoursLive, out.games[0].averageViewers, out.games[0].followersGained, out.games[0].followersPerHour], [1, 1, 100, 30, 30]);
  assert.equal(out.games[1].followersPerHour, null);
  assert.equal((await def.mcp.twitch_games(ctx, { sort: "average_viewers" })).games[0].game, "Just Chatting");
  assert.equal((await def.mcp.twitch_games(ctx, { sort: "n'importe quoi" })).sort, "followers_per_hour");
  assert.equal((await def.mcp.twitch_games(ctx, { limit: 1 })).games.length, 1);
  assert.match((await def.mcp.twitch_games(mk({}, "vide"), {})).note, /Games: none/);
});

test("twitch_videos : tri par vues par défaut, filtre de type et de période, clips, limite bornée, réponse vide explicite", async () => {
  const ctx = mk();
  assert.match((await def.mcp.twitch_videos(ctx, {})).note, /Tracking has just been switched on|switched on/);
  L.state.videos = Array.from({ length: 30 }, (_, i) => video(i + 1, { type: ["archive", "highlight", "upload"][i % 3] }));
  L.state.clips = Array.from({ length: 5 }, (_, i) => clip(i + 1));
  await tick(ctx, 0);
  const all = await def.mcp.twitch_videos(ctx, { limit: 500 });
  assert.ok(all.count <= 100 && all.count === 30);
  const views = all.videos.map((v) => v.views);
  assert.deepEqual(views, [...views].sort((a, b) => b - a));
  assert.ok(all.videos.every((v) => v.type && v.url && v.durationMinutes === 123.1 && v.publishedAt));
  assert.ok((await def.mcp.twitch_videos(ctx, { type: "highlight" })).videos.every((v) => v.type === "highlight"));
  assert.equal((await def.mcp.twitch_videos(ctx, { days: 5 })).count, 5);
  const byDate = (await def.mcp.twitch_videos(ctx, { sort: "date" })).videos;
  assert.equal(byDate[0].title, "Vidéo 1");
  const clips = await def.mcp.twitch_videos(ctx, { type: "clip" });
  assert.equal(clips.count, 5); assert.ok(clips.videos.every((c) => c.game));
  assert.match((await def.mcp.twitch_videos(ctx, { type: "upload", days: 1 })).note, /No video found/);
});

test("aucun secret ni jeton nulle part : panneau, chiffres, outils MCP, état et journaux", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  await simpleLive(ctx);
  L.state.videos = [video(1)]; L.state.clips = [clip(1)];
  await tick(ctx, 40);
  const dump = JSON.stringify([await def.adminPanel(ctx), await stat(ctx), await def.mcp.twitch_streams(ctx, {}), await def.mcp.twitch_games(ctx, {}), await def.mcp.twitch_videos(ctx, {}), await live.trackingState(ctx)]);
  for (const secret of ["SEC-RET", "app_tok", "at_user", "rt_user", "Bearer"]) assert.ok(!dump.includes(secret), secret);
  const code = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(code));
});

// ── Chiffres de synthèse (social.stat) ───────────────────────────────────────────────────────────────────────────────────────────────

async function twoHourLive(ctx, { lose = false } = {}) {
  const followersAt = (m) => (lose ? 100 - Math.floor(m / 20) : m <= 60 ? 100 + Math.floor(m / 2) : 130 + Math.floor((m - 60) / 6));
  for (let m = 0; m <= 118; m += 2) {
    L.tw.state.followers = followersAt(m);
    L.live("777", { viewer_count: m < 60 ? 100 : 200 + (m === 90 ? 40 : 0), game_id: m < 60 ? "1" : "509658", game_name: m < 60 ? "Zelda" : "Just Chatting" });
    await tick(ctx, m);
  }
  L.offline();
  for (const m of [120, 122, 124]) { L.tw.state.followers = followersAt(m); await tick(ctx, m); }
}

test("social.stat : cinq chiffres de période (30 jours glissants), entiers ≥ 0, durées en MINUTES, contrat valide, id stable, libellés fr/en", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  await twoHourLive(ctx);
  const items = await stat(ctx);
  assert.deepEqual(problemsOfList(items, { module: "twitch-channel", platform: "twitch" }), []);
  const m = byMetric(items);
  assert.deepEqual(Object.keys(m).sort(), ["avg_viewers", "followers", "followers_gained", "hours_streamed", "hours_watched", "peak_viewers"]);
  assert.deepEqual([m.avg_viewers.value, m.peak_viewers.value, m.hours_streamed.value, m.hours_watched.value, m.followers_gained.value], [150, 240, 118, 17680, 40]);
  assert.equal(m.followers.value, 140);
  assert.equal(m.hours_streamed.id, "twitch-channel:tw:hours_streamed");
  assert.equal(m.avg_viewers.asOf, new Date(T0 + 124 * MIN).toISOString());
  assert.match(m.hours_streamed.label, /minutes/); assert.match(m.hours_watched.label, /minutes/);
  for (const k of ["avg_viewers", "peak_viewers", "hours_streamed", "hours_watched", "followers_gained"]) { assert.ok(fr[`stat_${k}`] && en[`stat_${k}`]); assert.match(fr[`stat_${k}`], /30 jours/); assert.match(en[`stat_${k}`], /30 days/); assert.ok(fr[`stat_${k}`].length <= 120); }
  const en2 = fakeCtx({ key: "tw", locale: "en", messages: en, settings: settings() });
  en2.api.store = ctx.api.store;
  assert.match(byMetric(await stat(en2)).avg_viewers.label, /Average viewers/);
});

test("social.stat : directs commencés dans les 30 derniers jours seulement ; gain de followers jamais négatif dans le chiffre, mais vrai dans le détail", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  await twoHourLive(ctx, { lose: true });
  assert.equal(byMetric(await stat(ctx)).followers_gained.value, 0);
  assert.equal((await sessionsOf(ctx))[0].followersGained, -6);
  // 40 jours plus tard : le direct sort des 30 jours glissants
  L.at(40 * 1440); const late = byMetric(await stat(ctx));
  assert.deepEqual([late.hours_streamed.value, late.peak_viewers.value, late.avg_viewers.value], [0, 0, 0]);
});

test("social.stat : plusieurs directs → moyenne pondérée sur tout le temps mesuré, pic maximum, sommes", async () => {
  const ctx = mk();
  await days(ctx, 3);   // directs de 2 mesures : 10, 11, 12 spectateurs, 2 minutes chacun
  const m = byMetric(await stat(ctx));
  assert.deepEqual([m.avg_viewers.value, m.peak_viewers.value, m.hours_streamed.value], [11, 12, 6]);
  assert.equal(m.hours_watched.value, Math.round((10 * 120 + 11 * 120 + 12 * 120) / 60));
});

test("social.stat : sans durée de suivi aucun chiffre de direct ; followers_gained absent si on ne compte pas les followers", async () => {
  const ctx = mk({ statsFollowers: false });
  assert.deepEqual(await stat(ctx), [], "pas encore de première mesure");
  await tick(ctx, 0);
  assert.deepEqual(Object.keys(byMetric(await stat(ctx))).sort(), ["avg_viewers", "hours_streamed", "hours_watched", "peak_viewers"]);
});

// ── Panneau « Mes directs », textes ───────────────────────────────────────────────────────────────────────────────────────────────

test("panneau « Mes directs » : phrase d'honnêteté, suivi actif depuis, derniers directs, meilleur jeu, vidéos les plus vues ; tableaux de 2 colonnes (lisibles sur téléphone)", async () => {
  const ctx = mk(); await L.connect(C.ctx);
  L.state.videos = [video(1, { view_count: 10 }), video(2, { view_count: 999 })]; L.state.clips = [clip(1)];
  await twoHourLive(ctx);
  const blocks = await def.adminPanel(ctx);
  const text = JSON.stringify(blocks);
  assert.match(text, /Mesuré par votre site toutes les 2 minutes quand vous êtes en direct, à partir du jour où ce suivi a été activé : Twitch ne fournit pas l'historique\./);
  assert.match(text, /Suivi actif depuis le 15 octobre 2026/);
  assert.match(text, /Le jeu qui vous fait gagner le plus de followers/); assert.match(text, /Zelda/); assert.match(text, /30 followers par heure/);
  const videos = blocks.find((b) => b.type === "table" && b.columns[0] === "Vidéo");
  assert.match(videos.rows[0][0], /Vidéo 2/); assert.match(videos.rows[0][1], /999 vues/);
  assert.ok(blocks.filter((b) => b.type === "table" && !b.rowActions).every((b) => b.columns.length <= 2));
  const lives = blocks.find((b) => b.type === "table" && b.columns[0] === "Direct");
  assert.match(lives.rows[0][1], /150 spectateurs en moyenne/); assert.match(lives.rows[0][1], /\+40 followers/);
  // en direct : une bannière
  L.live("777", { viewer_count: 321 }); await tick(ctx, 200);
  assert.match(JSON.stringify(await def.adminPanel(ctx)), /Vous êtes en direct : 321 spectateurs/);
});

test("panneau : Twitch en panne = message simple ; pas connecté = on dit comment compter les followers par jeu", async () => {
  const ctx = mk();
  L.state.fail.streams = 500; await tick(ctx, 0);
  const text = JSON.stringify(await def.adminPanel(ctx));
  assert.match(text, /Twitch ne répond pas pour le moment/); assert.match(text, /connectez votre chaîne Twitch/);
  assert.match(text, /arrivent dans quelques minutes/);
});

test("mots simples : aucun jargon dans les textes de « Mes directs » (fr et en), i18n complète, toutes les clés utilisées existent", () => {
  const JARGON = /\b(m[ée]trique|metric|[ée]chantillon|sample|polling|poll|api|helix|json|token|jeton|oauth|scope|endpoint|http|requ[êe]te|request|cache|collection|storage|stockage)\b/i;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  const keys = Object.keys(fr).filter((k) => /^(live_|stat_(avg|peak|hours|followers_gained)|col_(live|result|game|video|clip|views)|type_|dur_)/.test(k));
  assert.ok(keys.length > 30);
  for (const k of keys) for (const [l, d] of [["fr", fr], ["en", en]]) assert.ok(!JARGON.test(d[k]), `${l}.${k} : « ${d[k]} »`);
  const code = ["index", "connect", "helix", "handover", "live", "analytics"].map((f) => fs.readFileSync(`${DIR}/${f}.mjs`, "utf8")).join("\n");
  for (const m of code.matchAll(/\bt\("([a-zA-Z_]+)"/g)) assert.ok(m[1] in fr, m[1]);
  for (const m of code.matchAll(/\bt\(!?[a-z]*\s*\?\s*"([a-zA-Z_]+)"\s*:\s*[a-z.]*\s*\?\s*"([a-zA-Z_]+)"\s*:\s*"([a-zA-Z_]+)"/g)) for (const k of m.slice(1)) assert.ok(k in fr, k);
  for (const k of ["type_archive", "type_highlight", "type_upload", "live_videosPending", "live_videosError", "live_videosNone", "live_bestNone", "live_needConnect"]) assert.ok(fr[k] && en[k], k);
  // l'honnêteté sur la limite est dite en mode simple, en toutes lettres
  assert.match(fr.live_honest, /Twitch ne fournit pas l'historique/); assert.match(en.live_honest, /does not provide the history/);
  assert.ok(manifest.settings.find((s) => s.key === "trackStats").help.fr.includes("toutes les 2 minutes"));
  for (const s of manifest.settings.filter((x) => ["liveEveryMinutes", "rawDays", "keepYears"].includes(x.key))) for (const v of [s.label.fr, s.label.en, s.help.fr, s.help.en]) assert.ok(!JARGON.test(v), v);
});

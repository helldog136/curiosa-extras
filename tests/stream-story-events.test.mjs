// Story d'annonce 2.1.0 : « Pour quoi veux-tu une story ? » — les événements de TOUTES les sources (l'agenda de streams, vidéos et directs programmés, planning d'une chaîne…), remis dans un seul
// contrat, dédoublonnés, triés à la minute près (fuseaux et heure d'été compris), paginés ; sources en panne ; outils pour l'IA. Aucun réseau : les sources sont des doubles.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8")), fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const E = await import("../modules/stream-story/events.mjs");
const P = await import("../modules/stream-story/pure.mjs");
const tools = await import("../modules/stream-story/mcp.mjs");

const SITE = "https://site.example.test";
const NOW = Date.UTC(2026, 9, 22, 12, 0);   // jeudi 22 octobre 2026, 12:00 UTC
const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000, DAY = 86_400_000;
const YT = { kind: "youtube", label: "YouTube" }, TW = { kind: "twitch", label: "Twitch" }, CAL = { kind: "calendar", label: "Planning" };
const raw = (id, title, ms, extra = {}) => ({ id, title, start: iso(ms), type: "stream", ...extra });
const clean = (r, source, zone) => E.cleanEvent(r, source, { fallbackZone: zone ?? "UTC" });

/* ───────────── Le contrat d'un événement ───────────── */

test("contrat : un événement valide garde id, titre, début UTC, fuseau, type, lien et image ; tout ce qui est inutilisable est écarté sans exception", () => {
  const e = clean({ id: "youtube:AbC_123-xyz", title: "  Ma   première\n du soir ", start: "2026-10-24T18:30:00+02:00", end: "2026-10-24T20:00:00Z", timezone: "Europe/Brussels", type: "premiere", url: "https://www.youtube.com/watch?v=x", image: "https://i.ytimg.com/vi/x/hq.jpg", games: ["Hades", "", 12, "A", "B", "C"] }, YT);
  assert.equal(e.id, "youtube:AbC_123-xyz"); assert.equal(e.title, "Ma première du soir");
  assert.equal(e.start, "2026-10-24T16:30:00.000Z", "le début est ramené en UTC"); assert.equal(e.end, "2026-10-24T20:00:00.000Z");
  assert.equal(e.timezone, "Europe/Brussels"); assert.equal(e.type, "premiere"); assert.equal(e.source, "youtube"); assert.equal(e.sourceLabel, "YouTube");
  assert.equal(e.url, "https://www.youtube.com/watch?v=x"); assert.equal(e.image, "https://i.ytimg.com/vi/x/hq.jpg"); assert.deepEqual(e.games, ["Hades", "A", "B"], "3 jeux au plus, sans vide ni nombre");
  for (const bad of [null, undefined, "x", 3, [], {}, { id: "a" }, { id: "a b", start: iso(NOW) }, { id: "", start: iso(NOW) }, { id: "x".repeat(101), start: iso(NOW) }, { id: "<b>", start: iso(NOW) }, { id: "ok", start: "pas une date" }, { id: "ok", start: 5 },
    { id: "ok", start: "1969-01-01T00:00:00Z" }, { id: "ok", start: "2150-01-01T00:00:00Z" }, { id: "ok", start: iso(NOW), status: "cancelled" }]) assert.equal(clean(bad, CAL), null, JSON.stringify(bad));
  const odd = clean({ id: "o1", title: "T".repeat(200), start: iso(NOW), timezone: "Pas/UnFuseau", type: "bizarre", url: "http://insecure.example/x", image: "javascript:alert(1)" }, TW);
  assert.equal(odd.title.length, 80); assert.equal(odd.timezone, "", "fuseau inconnu : rien"); assert.equal(odd.type, "event", "type inconnu : « événement »"); assert.equal(odd.url, "", "http refusé"); assert.equal(odd.image, "", "javascript: refusé");
  assert.equal(clean({ id: "o2", start: iso(NOW), url: "https://user:pw@evil.example/" }, TW).url, "", "pas d'identifiants dans une adresse");
});

test("contrat : une journée entière est ancrée à minuit du fuseau (heure d'été comprise) ; la source est nettoyée", () => {
  const paris = (day) => clean({ id: `d${day}`, title: "Jour", start: `${day}T00:00:00Z`, allDay: true, day, timezone: "Europe/Paris" }, CAL);
  assert.equal(paris("2026-10-24").start, "2026-10-23T22:00:00.000Z", "avant le passage à l'heure d'hiver : UTC+2");
  assert.equal(paris("2026-10-25").start, "2026-10-24T22:00:00.000Z", "le jour du changement d'heure commence à minuit d'été");
  assert.equal(paris("2026-10-26").start, "2026-10-25T23:00:00.000Z", "le lendemain : UTC+1");
  assert.equal(paris("2027-03-28").start, "2027-03-27T23:00:00.000Z", "le jour du passage à l'heure d'été commence à minuit d'hiver");
  assert.equal(paris("2027-03-29").start, "2027-03-28T22:00:00.000Z");
  assert.equal(paris("2026-10-25").allDay, true); assert.equal(paris("2026-10-25").day, "2026-10-25");
  assert.deepEqual(E.cleanSource({ kind: "You Tube!", label: "  Ma   chaîne\n" }, { kind: "other", label: "x" }), { kind: "other", label: "Ma chaîne" });
  assert.deepEqual(E.cleanSource({ kind: "twitch", label: "T".repeat(90) }), { kind: "twitch", label: "T".repeat(40) });
  assert.deepEqual(E.cleanSource(null, { kind: "calendar", label: "Planning" }), { kind: "calendar", label: "Planning" });
});

test("réponse d'une source : état ok / à régler / en panne ; une réponse illisible est une panne, jamais une exception ; 100 événements au plus, sans identifiant en double", () => {
  const a = E.readAnswer({ ok: true, source: YT, state: "ok", note: "Un mot", events: [raw("y:1", "A", NOW + H), raw("y:1", "A bis", NOW + 2 * H), { id: "mauvais id" }, raw("y:2", "B", NOW + 3 * H)] }, { kind: "other", label: "?" });
  assert.deepEqual([a.kind, a.state, a.note, a.events.map((e) => e.id)], ["youtube", "ok", "Un mot", ["y:1", "y:2"]]);
  assert.equal(E.readAnswer({ source: YT, state: "setup", message: "Ajoutez votre clé." }, {}).state, "setup");
  assert.equal(E.readAnswer({ source: YT, state: "n'importe quoi", events: [] }, {}).state, "ok", "un état inconnu est lu comme « ok » (la liste, elle, est vérifiée une à une)");
  for (const garbage of [null, undefined, "ça va", 42, [], [raw("x", "y", NOW)]]) { const r = E.readAnswer(garbage, { kind: "other", label: "Autre" }); assert.equal(r.state, "down"); assert.deepEqual(r.events, []); }
  const many = E.readAnswer({ source: YT, events: Array.from({ length: 1000 }, (_, i) => raw(`y:${i}`, `V${i}`, NOW + i * H)) }, {});
  assert.equal(many.events.length, 100, "100 événements au plus par source");
  assert.equal(E.readAnswer({ source: YT, message: "m".repeat(999), note: "n".repeat(999), events: [] }, {}).message.length, 240);
});

/* ───────────── Agréger, trier, dédoublonner ───────────── */

const agg = (...lists) => E.aggregate(lists, NOW);
const evs = (source, rows, zone) => rows.map((r) => clean(r, source, zone)).filter(Boolean);

test("tri : à la minute près, sur l'instant UTC, quel que soit le fuseau annoncé ; l'ordre d'arrivée des sources n'y change rien", () => {
  const brussels = evs(CAL, [raw("c:1", "Brussels 20:31", Date.UTC(2026, 9, 24, 18, 31), { timezone: "Europe/Brussels" })]);
  const tokyo = evs(TW, [raw("t:1", "Tokyo 03:30", Date.UTC(2026, 9, 24, 18, 30), { timezone: "Asia/Tokyo" })]);   // 03:30 le lendemain à Tokyo, mais 1 minute AVANT l'autre
  const ny = evs(YT, [raw("y:1", "New York 14:29", Date.UTC(2026, 9, 24, 18, 29), { timezone: "America/New_York" })]);
  const want = ["y:1", "t:1", "c:1"];
  for (const order of [[brussels, tokyo, ny], [ny, tokyo, brussels], [tokyo, brussels, ny]]) assert.deepEqual(agg(...order).map((e) => e.id), want);
});

test("heure d'été : deux « 2 h 30 » d'une nuit de changement d'heure restent dans l'ordre ; une journée entière passe avant les heures de ce jour", () => {
  const night = evs(CAL, [
    raw("c:late", "Rediffusion", Date.UTC(2026, 9, 25, 1, 30), { timezone: "Europe/Paris" }),    // 02:30 heure d'hiver (la deuxième fois)
    raw("c:early", "Direct de nuit", Date.UTC(2026, 9, 25, 0, 30), { timezone: "Europe/Paris" }), // 02:30 heure d'été (la première fois)
    { id: "c:day", title: "Marathon", start: "2026-10-25T00:00:00Z", allDay: true, day: "2026-10-25", timezone: "Europe/Paris" },
  ]);
  const out = agg(night);
  assert.deepEqual(out.map((e) => e.id), ["c:day", "c:early", "c:late"]);
  assert.equal(P.formatTime(out[1].startMs, "Europe/Paris", "fr"), "2 h 30"); assert.equal(P.formatTime(out[2].startMs, "Europe/Paris", "fr"), "2 h 30", "même heure sur l'horloge, deux instants différents");
  assert.equal(out[2].startMs - out[1].startMs, H);
  const spring = agg(evs(CAL, [raw("s:1", "Avant", Date.UTC(2027, 2, 28, 0, 59), { timezone: "Europe/Paris" }), raw("s:2", "Après", Date.UTC(2027, 2, 28, 1, 0), { timezone: "Europe/Paris" })]).map((e) => ({ ...e })), []);
  assert.deepEqual(spring.map((e) => P.formatTime(e.startMs, "Europe/Paris", "fr")), ["1 h 59", "3 h"], "l'heure qui n'existe pas (2 h 30) est sautée");
});

test("tri : à la même minute, l'agenda passe d'abord, puis le titre, puis l'identifiant — toujours le même ordre", () => {
  const at = NOW + DAY;
  const out = agg(evs(YT, [raw("y:1", "Zèbre", at)]), evs(CAL, [raw("c:2", "Alpha", at + 20 * 60_000), raw("c:1", "Beta", at)]), evs(TW, [raw("t:1", "Zèbre 2", at, { url: "https://www.twitch.tv/x" })]));
  assert.deepEqual(out.map((e) => e.id), ["c:1", "t:1", "y:1", "c:2"]);
  assert.deepEqual(agg(evs(YT, [raw("y:1", "Zèbre", at)]), evs(CAL, [raw("c:1", "Beta", at)])).map((e) => e.id), ["c:1", "y:1"]);
});

test("passé : un événement commencé depuis plus de 3 h est écarté, sauf s'il dure encore ; commencé depuis moins de 3 h, il reste", () => {
  const out = agg(evs(CAL, [raw("p:old", "Fini", NOW - 5 * H), raw("p:run", "En cours", NOW - 5 * H, { end: iso(NOW + H) }), raw("p:late", "En retard", NOW - H), raw("p:next", "À venir", NOW + H)]));
  assert.deepEqual(out.map((e) => e.id), ["p:run", "p:late", "p:next"]);
});

test("doublons : le même événement vu par deux sources n'en fait qu'un (agenda d'abord), avec les autres sources et leurs identifiants ; les faux jumeaux restent séparés", () => {
  const at = Date.UTC(2026, 9, 24, 18, 30);
  const out = agg(
    evs(CAL, [raw("calendar:aaa", "Soirée Zelda — Épisode 3", at)]),
    evs(TW, [raw("twitch:me:bbb", "SOIREE ZELDA - épisode 3 !", at + 5 * 60_000, { games: ["The Legend of Zelda"], url: "https://www.twitch.tv/me" })]),
    evs(YT, [raw("youtube:ccc", "Soirée Zelda", at + 10 * 60_000, { type: "live", url: "https://www.youtube.com/watch?v=ccc" }), raw("youtube:ddd", "Live", at), raw("youtube:eee", "Soirée Zelda — Épisode 3", at + 30 * 60_000)]),
  );
  const zelda = out.find((e) => e.id === "calendar:aaa");
  assert.ok(zelda, "l'agenda garde la main");
  assert.deepEqual(zelda.alsoIn.map((s) => s.kind), ["twitch", "youtube"]); assert.deepEqual(zelda.ids, ["calendar:aaa", "twitch:me:bbb", "youtube:ccc"]);
  assert.deepEqual(zelda.games, ["The Legend of Zelda"], "le jeu manquant est repris d'une autre source"); assert.equal(zelda.url, "https://www.twitch.tv/me");
  assert.deepEqual(out.map((e) => e.id), ["calendar:aaa", "youtube:ddd", "youtube:eee"], "« Live » (trop court pour fusionner) et celui de 30 minutes plus tard restent séparés");
  assert.equal(E.findEvent(out, { id: "youtube:ccc" }).id, "calendar:aaa", "l'identifiant d'une source fusionnée retrouve l'événement");
  assert.equal(E.findEvent(out, { id: "inconnu" }), null);
  // même lien : fusionnés même avec des titres différents
  const byLink = agg(evs(YT, [raw("youtube:v1", "Titre A", at, { url: "https://x.example/e" })]), evs(TW, [raw("twitch:m:1", "Tout autre titre", at + 60_000, { url: "https://x.example/e" })]));
  assert.equal(byLink.length, 1);
  // une journée entière ne fusionne qu'avec une journée entière du même jour
  const days = agg(evs(CAL, [{ id: "c:d1", title: "Convention", start: "2026-10-24T00:00:00Z", allDay: true, day: "2026-10-24" }]), evs(YT, [{ id: "y:d1", title: "Convention", start: "2026-10-24T00:00:00Z", allDay: true, day: "2026-10-24" }, raw("y:d2", "Convention", at)]));
  assert.deepEqual(days.map((e) => e.id), ["c:d1", "y:d2"]);
});

test("doublons : deux fiches d'une même source ne fusionnent que si elles sont identiques ; un identifiant en double n'apparaît qu'une fois", () => {
  const at = NOW + DAY;
  const out = agg(evs(CAL, [raw("c:1", "Stream du soir", at), raw("c:2", "Stream du soir", at + 5 * 60_000), raw("c:3", "Stream du soir", at)]));
  assert.deepEqual(out.map((e) => e.id), ["c:1", "c:2"], "même titre et même minute : une seule ; cinq minutes plus tard dans la même source : deux séances");
});

test("bornes : 500 événements entrent, 200 sortent (les plus proches) ; une recherche et un filtre de source ne cherchent que dans cette liste", () => {
  const many = (kind, n, offset) => evs({ kind, label: kind }, Array.from({ length: n }, (_, i) => raw(`${kind}:${i}`, `Événement ${kind} ${i}`, NOW + (i * 5 + offset) * 60_000)));
  const out = agg(many("calendar", 100, 1), many("twitch", 100, 2), many("youtube", 100, 3), many("alpha", 100, 4), many("beta", 100, 5));
  assert.equal(out.length, E.LIMITS.total); assert.equal(E.LIMITS.total, 200);
  assert.ok(out.every((e, i) => i === 0 || out[i - 1].startMs <= e.startMs), "triés");
  assert.equal(out[0].id, "calendar:0");
  assert.deepEqual(E.filterEvents(out, { source: "twitch" }).every((e) => e.source === "twitch"), true);
  assert.equal(E.filterEvents(out, { q: "ÉVÉNEMENT alpha 7" }).length > 0, true, "majuscules et accents ne comptent pas");
  assert.equal(E.filterEvents(out, { q: "zzzz" }).length, 0);
  assert.equal(E.filterEvents(out, { source: "n'importe quoi ../" }).length, out.length, "un type de source invalide ne filtre rien");
  assert.equal(E.cleanQuery("x".repeat(500)).length, 80);
});

test("recherche : le titre, le jeu, le nom de la source (et des sources qui parlent aussi de l'événement)", () => {
  const at = NOW + DAY;
  const out = agg(evs(CAL, [raw("c:1", "Soirée détente", at, { games: ["Stardew Valley"] })]), evs(TW, [raw("t:1", "Soirée détente", at + 60_000)]), evs(YT, [raw("y:1", "Autre chose", at + 2 * H)]));
  assert.deepEqual(E.filterEvents(out, { q: "stardew" }).map((e) => e.id), ["c:1"]);
  assert.deepEqual(E.filterEvents(out, { q: "twitch" }).map((e) => e.id), ["c:1"], "l'événement fusionné se trouve aussi par la source qui en parle");
  assert.deepEqual(E.filterEvents(out, { source: "twitch" }).map((e) => e.id), ["c:1"]);
  assert.deepEqual(E.filterEvents(out, { q: "soiree detente", source: "youtube" }).map((e) => e.id), []);
});

/* ───────────── Pagination ───────────── */

const big = (n) => evs(CAL, Array.from({ length: n }, (_, i) => raw(`c:${i}`, `Stream ${i}`, NOW + (i + 1) * 10 * 60_000)));

test("pagination : 20 par défaut, 50 au plus, un curseur opaque ; on parcourt tout sans trou ni doublon ; 200 au plus au total", () => {
  const all = agg(big(190));
  assert.equal(all.length, 190);
  const first = E.pageOf(all, {});
  assert.equal(first.items.length, 20); assert.ok(first.next);
  assert.equal(E.pageOf(all, { limit: 5000 }).items.length, 50, "50 au plus par page, même si on en demande 5000");
  for (const bad of [0, -3, "abc", null, undefined, 2.7]) assert.ok(E.pageOf(all, { limit: bad }).items.length >= 1);
  const seen = []; let cursor = "", pages = 0;
  do { const p = E.pageOf(all, { cursor, limit: 50 }); seen.push(...p.items.map((e) => e.id)); cursor = p.next ?? ""; pages++; } while (cursor && pages < 20);
  assert.equal(pages, 4); assert.equal(seen.length, 190); assert.equal(new Set(seen).size, 190, "aucun doublon");
  assert.deepEqual(seen, all.map((e) => e.id), "dans l'ordre");
  assert.equal(E.pageOf(all, { cursor: first.next, limit: 50 }).items[0].id, "c:20");
  assert.equal(E.pageOf(all.slice(0, 20), { limit: 20 }).next, null, "dernière page : pas de curseur");
  assert.equal(E.pageOf([], {}).items.length, 0);
});

test("pagination : un curseur illisible redonne la première page ; un événement disparu entre deux pages ne fait ni sauter ni répéter", () => {
  const all = agg(big(60));
  for (const bad of ["", "x", "!!!", "e30", Buffer.from("{}").toString("base64url"), "a".repeat(400), 12, null]) assert.equal(E.pageOf(all, { cursor: bad, limit: 10 }).items[0].id, "c:0", String(bad));
  const p1 = E.pageOf(all, { limit: 10 });
  const without = all.filter((e) => e.id !== "c:9");   // le dernier de la page 1 vient d'être supprimé de l'agenda
  const p2 = E.pageOf(without, { cursor: p1.next, limit: 10 });
  assert.equal(p2.items[0].id, "c:10", "on reprend après son heure");
  const inserted = agg(big(60), evs(YT, [raw("y:new", "Nouveau", NOW + 5 * 10 * 60_000 + 1000)]));
  assert.equal(E.pageOf(inserted, { cursor: p1.next, limit: 10 }).items[0].id, "c:10", "un ajout avant le curseur ne décale rien");
});

/* ───────────── Les sources branchées : chargement, pannes, cache ───────────── */

const SLOT = (id, title, ms, extra = {}) => ({ id, title, start: iso(ms), end: iso(ms + H), allDay: false, games: [], status: "confirmed", timezone: "Europe/Brussels", ...extra });
const ytAnswer = (events, extra = {}) => ({ ok: true, source: YT, state: "ok", note: "Seuls les directs et premières publics sont visibles.", events, ...extra });
const twAnswer = (events, extra = {}) => ({ ok: true, source: TW, state: "ok", events, ...extra });
const NEXT = (h) => NOW + h * H;
let clock;
const mk = (extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE,
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }], ...extra,
});
const withSources = ({ calendar = [], yt, tw, extra = {} } = {}) => (src.resetEvents(), mk({
  topics: { "planning.slot": () => calendar },
  serviceInstances: { "event.source": [
    ...(yt ? [{ instance: "yt", name: "Ma chaîne", methods: { upcoming: yt } }] : []),
    ...(tw ? [{ instance: "tw", name: "Mon Twitch", methods: { upcoming: tw } }] : []),
  ] }, ...extra,
}));
const timing0 = { ...src.timing };
let keepAlive;   // les attentes bornées du module ne retiennent pas le processus (c'est voulu) : le test, lui, doit rester vivant tant qu'une source « trou noir » est en cours
beforeEach(() => { keepAlive = setInterval(() => {}, 100); src.resetEvents(); Object.assign(src.timing, timing0, { collectMs: 150, providersMs: 150, sourceMs: 200, eventsMs: 600, coverMs: 150, authMs: 300, routeMs: 800 }); });
afterEach(() => { clearInterval(keepAlive); Object.assign(src.timing, timing0); src.resetEvents(); });
const load = (ctx, o = {}) => src.loadEvents(ctx, { now: Date.now(), ...o });

test("toutes les sources : l'agenda, YouTube et Twitch sont rassemblés, triés, avec l'état de chacune", async () => {
  const t = Date.now();
  const ctx = withSources({
    calendar: [SLOT("s1", "Stream du jeudi", t + 3 * H, { games: ["Hades"] }), SLOT("s2", "Stream du samedi", t + 50 * H)],
    yt: () => ytAnswer([raw("youtube:v1", "Première : le clip", t + 5 * H, { type: "premiere" }), raw("youtube:v2", "Direct anniversaire", t + 20 * H, { type: "live" })]),
    tw: () => twAnswer([raw("twitch:me:s1", "Stream du jeudi", t + 3 * H + 120_000, { games: ["Hades"] }), raw("twitch:me:s2", "Surprise du vendredi", t + 30 * H)]),
  });
  const r = await load(ctx, { now: t });
  assert.deepEqual(r.events.map((e) => [e.source, e.title]), [["calendar", "Stream du jeudi"], ["youtube", "Première : le clip"], ["youtube", "Direct anniversaire"], ["twitch", "Surprise du vendredi"], ["calendar", "Stream du samedi"]]);
  assert.deepEqual(r.events[0].alsoIn.map((s) => s.kind), ["twitch"], "le stream annoncé par l'agenda ET par Twitch n'apparaît qu'une fois");
  assert.deepEqual(r.sources.map((s) => [s.kind, s.state, s.count]), [["calendar", "ok", 2], ["twitch", "ok", 2], ["youtube", "ok", 2]]);
  assert.equal(r.sources.find((s) => s.kind === "youtube").note, "Seuls les directs et premières publics sont visibles.");
  assert.equal(r.sources.find((s) => s.kind === "calendar").label, "Planning", "le nom de l'agenda vient des phrases du module");
  assert.ok(ctx.calls.services.every(([name, method]) => name === "event.source" && method === "upcoming"));
  const asked = ctx.calls.services[0][2];
  assert.equal(asked.limit, 100); assert.ok(Date.parse(asked.to) - Date.parse(asked.from) <= 91 * DAY, "période bornée à 90 jours");
});

test("id stable : le même événement garde le même identifiant d'un chargement à l'autre, même si le titre de l'agenda change ; l'ancienne clé d'un stream reste valable", async () => {
  const t = Date.now();
  const slot = (title) => SLOT("slot-42", title, t + 10 * H);
  const a = await load(withSources({ calendar: [slot("Ancien titre")] }), { now: t }), b = await load(withSources({ calendar: [slot("Nouveau titre")] }), { now: t + 1 });
  assert.equal(a.events[0].id, b.events[0].id); assert.match(a.events[0].id, /^calendar:[a-z0-9]{1,20}$/);
  assert.equal(a.events[0].legacyKey, P.streamKeyOf({ id: "slot-42", start: iso(t + 10 * H), title: "Ancien titre" }), "l'ancienne clé de story_next_streams");
  assert.equal(E.findEvent(a.events, { key: a.events[0].legacyKey }).id, a.events[0].id);
  assert.ok(P.EVENT_ID.test(a.events[0].id));
});

test("une source en panne : message poli, les autres sources répondent quand même ; l'état « à régler » garde la phrase de la source", async () => {
  const t = Date.now();
  const down = withSources({ calendar: [SLOT("s1", "Stream", t + 3 * H)], yt: () => { throw new Error("secret-token-xyz"); }, tw: () => twAnswer([raw("twitch:me:1", "Surprise", t + 4 * H)]) });
  const r = await load(down, { now: t });
  assert.deepEqual(r.events.map((e) => e.id).length, 2, "l'agenda et Twitch sont là");
  const yt = r.sources.find((s) => s.kind === "other" || s.label === "Ma chaîne");
  assert.equal(yt.state, "down"); assert.ok(!JSON.stringify(r).includes("secret-token-xyz"), "jamais le message d'une panne");
  const setup = withSources({ yt: () => ({ ok: true, source: YT, state: "setup", message: "Ajoutez votre clé YouTube dans Réglages.", events: [] }) });
  const s = (await load(setup, { now: t })).sources.find((x) => x.kind === "youtube");
  assert.deepEqual([s.state, s.message, s.count], ["setup", "Ajoutez votre clé YouTube dans Réglages.", 0]);
  const garbage = withSources({ yt: () => "du texte", tw: () => ({ events: "pas une liste" }) });
  const g = await load(garbage, { now: t });
  assert.deepEqual(g.events, []); assert.equal(g.sources.find((x) => x.label === "Ma chaîne").state, "down");
  src.resetEvents();
  const gone = mk({ topics: { "planning.slot": () => { throw new Error("agenda cassé"); } } });
  const c = await load(gone, { now: t });
  assert.deepEqual([c.sources[0].kind, c.sources[0].state, c.events.length], ["calendar", "down", 0], "un agenda qui plante est une source en panne, pas une erreur");
});

test("YouTube sans date programmée : la source répond « ok » avec zéro événement et sa note ; rien n'est inventé", async () => {
  const t = Date.now();
  const r = await load(withSources({ yt: () => ytAnswer([]) }), { now: t });
  assert.deepEqual(r.events, []); assert.deepEqual(r.sources.map((s) => [s.kind, s.state, s.count]), [["calendar", "ok", 0], ["youtube", "ok", 0]]);
  const noDate = withSources({ yt: () => ytAnswer([{ id: "youtube:nodate", title: "Vidéo sans date", type: "premiere" }, { id: "youtube:bad", title: "Date cassée", start: "demain soir" }, raw("youtube:ok", "Avec date", t + H)]) });
  assert.deepEqual((await load(noDate, { now: t })).events.map((e) => e.id), ["youtube:ok"], "sans début lisible, l'événement est écarté");
});

test("dernière liste connue : une source qui ne répond plus est remplacée par sa dernière liste pendant 15 minutes seulement, et le dit", async () => {
  const t = Date.now();
  let up = true;
  const ctx = withSources({ yt: () => { if (!up) throw new Error("coupé"); return ytAnswer([raw("youtube:v1", "Première", t + 5 * H)]); } });
  assert.equal((await load(ctx, { now: t })).events.length, 1);
  up = false;
  const cached = await load(ctx, { now: t + 20_000 });
  assert.deepEqual([cached.events.length, cached.sources.find((s) => s.kind === "youtube").state], [1, "ok"], "dans les 45 s : la mémoire, sans rien redemander");
  const stale = await load(ctx, { now: t + 50_000 });
  const y = stale.sources.find((s) => s.kind === "youtube");
  assert.deepEqual([stale.events.map((e) => e.id), y.state, y.stale], [["youtube:v1"], "down", true], "la source ne répond pas : sa dernière liste est montrée, et marquée");
  const later = await load(ctx, { now: t + 16 * 60_000 });
  assert.deepEqual(later.events, [], "au-delà de 15 minutes, plus de liste périmée");
  assert.equal(later.sources.find((s) => s.label === "Ma chaîne").state, "down");
  up = true;
  const back = await load(ctx, { now: t + 17 * 60_000 });
  assert.deepEqual([back.events.length, back.sources.find((s) => s.kind === "youtube").state], [1, "ok"], "dès qu'elle répond, tout revient");
});

test("cache : la liste est gardée 45 s (une seule demande aux sources), « Réessayer » ne passe outre qu'après 5 s, deux demandes simultanées partagent le même travail, aucun minuteur de fond", async () => {
  const t = Date.now();
  let calls = 0;
  const ctx = withSources({ yt: async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return ytAnswer([raw("youtube:v1", "Première", t + 5 * H)]); } });
  const [a, b] = await Promise.all([load(ctx, { now: t }), load(ctx, { now: t })]);
  assert.equal(calls, 1, "un seul appel pour deux demandes en même temps"); assert.equal(a.events.length, b.events.length);
  await load(ctx, { now: t + 10_000 }); assert.equal(calls, 1, "dans les 45 s : la mémoire");
  await load(ctx, { now: t + 3000, force: true }); assert.equal(calls, 1, "« Réessayer » avant 5 s : la mémoire");
  await load(ctx, { now: t + 6000, force: true }); assert.equal(calls, 2, "« Réessayer » après 5 s : on redemande");
  await load(ctx, { now: t + 60_000 }); assert.equal(calls, 3, "au-delà de 45 s : on redemande");
  const code = ["sources.mjs", "events.mjs", "index.mjs"].map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")).join("\n");
  assert.ok(!/setInterval\s*\(/.test(code), "aucun minuteur de fond");
  assert.ok(!/\bfetch\s*\(/.test(code.replace(/images\.fetchImage/g, "")), "aucun appel réseau direct dans les fichiers des événements");
});

test("trou noir : une source qui ne répond JAMAIS ne bloque ni les autres ni la page ; la demande suivante repart de zéro", async () => {
  const t = Date.now(), never = () => new Promise(() => {});
  let hang = true;
  const ctx = withSources({ calendar: [SLOT("s1", "Stream", t + 3 * H)], yt: () => (hang ? never() : ytAnswer([raw("youtube:v1", "Première", t + 5 * H)])), tw: () => twAnswer([raw("twitch:me:1", "Surprise", t + 4 * H)]) });
  const t0 = Date.now();
  const r = await load(ctx, { now: t });
  assert.ok(Date.now() - t0 < 1500, "borné");
  assert.deepEqual(r.events.map((e) => e.source), ["calendar", "twitch"]);
  assert.equal(r.sources.find((s) => s.label === "Ma chaîne").state, "down");
  hang = false;
  const again = await load(ctx, { now: t + 60_000 });
  assert.deepEqual(again.events.map((e) => e.source), ["calendar", "twitch", "youtube"], "aucune promesse restée en attente");
  // la liste des fournisseurs elle-même ne répond jamais
  const blind = withSources({ calendar: [SLOT("s1", "Stream", t + 3 * H)] }); blind.api.services.providers = never;
  src.resetEvents();
  const b = await load(blind, { now: t });
  assert.deepEqual(b.events.map((e) => e.source), ["calendar"]);
  // tout est muet : la liste entière répond quand même dans son délai
  const mute = withSources({ yt: never, tw: never }); mute.api.topics.collect = never;
  src.resetEvents();
  const t1 = Date.now(), m = await load(mute, { now: t });
  assert.ok(Date.now() - t1 < 1500); assert.deepEqual(m.events, []); assert.ok(m.sources.every((s) => s.state === "down"));
});

test("sources en trop : dix fournisseurs au plus sont interrogés ; la liste ne dépasse jamais 200 événements", async () => {
  const t = Date.now();
  const many = Array.from({ length: 30 }, (_, i) => ({ instance: `p${i}`, name: `Source ${i}`, methods: { upcoming: () => ({ ok: true, source: { kind: `s${i}`, label: `Source ${i}` }, events: Array.from({ length: 100 }, (_, j) => raw(`s${i}:${j}`, `E ${i}/${j}`, t + (j * 30 + i) * 60_000)) }) } }));
  const ctx = mk({ topics: { "planning.slot": () => [] }, serviceInstances: { "event.source": many } });
  const r = await load(ctx, { now: t });
  assert.equal(ctx.calls.services.length, 10, "10 sources au plus"); assert.equal(r.events.length, 200);
});

/* ───────────── Les routes de la page ───────────── */

const route = (ctx, name, token, search = "") => def.routes[name](new Request(`${SITE}/m/story/${name}${search}`, { headers: token === undefined ? {} : { "x-story-token": token } }), ctx);
const sample = (t) => withSources({
  calendar: Array.from({ length: 60 }, (_, i) => SLOT(`s${i}`, `Stream ${i}`, t + (i + 1) * 2 * H, { games: i % 7 === 0 ? ["Hades"] : [] })),
  yt: () => ytAnswer([raw("youtube:v1", "Première du clip", t + 5 * H + 30 * 60_000, { type: "premiere", url: "https://www.youtube.com/watch?v=v1" })]),
  tw: () => twAnswer([raw("twitch:me:1", "Surprise du vendredi", t + 7 * H, { type: "stream" })]),
});

test("route events : sans jeton, rien ; avec jeton, une page (20 par défaut, 50 au plus), un curseur, la recherche, le filtre de source, l'événement déjà choisi", async () => {
  const t = Date.now(), ctx = sample(t), token = await data.mintToken(ctx);
  assert.equal((await route(ctx, "events", undefined)).status, 401); assert.equal((await route(ctx, "events", "mauvais")).status, 401);
  assert.equal((await def.routes.events(new Request(`${SITE}/m/story/events`, { method: "POST", headers: { "x-story-token": token } }), ctx)).status, 405);
  const r1 = await (await route(ctx, "events", token)).json();
  assert.equal(r1.ok, true); assert.equal(r1.items.length, 20); assert.ok(r1.next); assert.equal(r1.total, 62); assert.equal(r1.totalAll, 62);
  assert.deepEqual(r1.sources.map((s) => [s.kind, s.state, s.count]), [["calendar", "ok", 60], ["twitch", "ok", 1], ["youtube", "ok", 1]]);
  assert.ok(r1.items.every((e) => !("ids" in e)), "la page ne reçoit que ce dont elle a besoin");
  assert.equal(JSON.stringify(r1).includes("x-story-token"), false);
  const huge = await (await route(ctx, "events", token, "?limit=99999")).json(); assert.equal(huge.items.length, 50);
  const seen = []; let cursor = "";
  for (let i = 0; i < 5; i++) { const p = await (await route(ctx, "events", token, `?limit=50${cursor ? `&cursor=${cursor}` : ""}`)).json(); seen.push(...p.items.map((e) => e.id)); cursor = p.next; if (!cursor) break; }
  assert.equal(seen.length, 62); assert.equal(new Set(seen).size, 62);
  const q = await (await route(ctx, "events", token, `?q=${encodeURIComponent("PREMIÈRE clip")}`)).json();
  assert.deepEqual(q.items.map((e) => e.id), ["youtube:v1"]); assert.equal(q.total, 1); assert.equal(q.totalAll, 62, "le total sans filtre sert aux messages de la page");
  const tw = await (await route(ctx, "events", token, "?source=twitch")).json(); assert.deepEqual(tw.items.map((e) => e.source), ["twitch"]);
  const picked = await (await route(ctx, "events", token, `?id=${encodeURIComponent("calendar:inconnu")}`)).json(); assert.equal(picked.selected, null);
  const some = r1.items[3];
  const sel = await (await route(ctx, "events", token, `?limit=1&id=${encodeURIComponent(some.id)}`)).json();
  assert.equal(sel.selected.id, some.id); assert.equal(sel.items.length, 1);
  const legacy = await (await route(ctx, "events", token, `?key=${encodeURIComponent(r1.items[0].legacyKey)}`)).json(); assert.equal(legacy.selected.id, r1.items[0].id);
  const evil = await (await route(ctx, "events", token, `?id=${encodeURIComponent("../../etc")}&key=${encodeURIComponent("<x>")}&source=${encodeURIComponent("'; drop")}&cursor=%00&q=${"%C3%A9".repeat(300)}`)).json();
  assert.equal(evil.ok, true); assert.equal(evil.selected, null);
});

test("route events : toutes les sources muettes → la page reçoit l'état de chacune, sans erreur", async () => {
  const t = Date.now(), never = () => new Promise(() => {});
  const ctx = withSources({ yt: never, tw: never }); ctx.api.topics.collect = never;
  const token = await data.mintToken(ctx), t0 = Date.now();
  const res = await route(ctx, "events", token);
  assert.equal(res.status, 200); const body = await res.json();
  assert.deepEqual([body.ok, body.items, body.total, body.sources.every((s) => s.state === "down")], [true, [], 0, true]);
  assert.ok(Date.now() - t0 < 1500); assert.ok(t);
});

test("route cover : la jaquette d'un seul jeu, bornée ; sans clé, le dit ; une adresse d'un hôte inconnu est refusée", async () => {
  const COVER = "https://media.rawg.io/media/games/abc/abcdef0123456789.jpg";
  const ctx = withSources({ extra: { rawgCover: { status: "found", url: COVER } } }), token = await data.mintToken(ctx);
  const ok = await (await route(ctx, "cover", token, `?game=${encodeURIComponent("Hades")}`)).json();
  assert.deepEqual([ok.ok, ok.cover, ok.coverState], [true, COVER, ""]); assert.deepEqual(ctx.calls.rawg, ["Hades"], "un seul jeu demandé");
  const alien = withSources({ extra: { rawgCover: { status: "found", url: "https://evil.example/c.jpg" } } });
  assert.equal((await (await route(alien, "cover", await data.mintToken(alien), "?game=Hades")).json()).cover, "");
  const none = withSources({ extra: { rawgConfigured: false } }), t2 = await data.mintToken(none);
  assert.equal((await (await route(none, "cover", t2, "?game=Hades")).json()).coverState, "no_key");
  const down = withSources({ extra: { rawgCover: { status: "unreachable", url: null } } });
  assert.equal((await (await route(down, "cover", await data.mintToken(down), "?game=Hades")).json()).coverState, "down");
  assert.equal((await (await route(ctx, "cover", token)).json()).cover, "", "sans nom de jeu : rien");
  assert.equal((await route(ctx, "cover", undefined, "?game=Hades")).status, 401);
});

/* ───────────── Les réglages d'une demande ───────────── */

test("réglages : l'événement choisi (identifiant + source) est mémorisé dans la demande ; un identifiant douteux est écarté ; un modèle ne garde pas l'événement", () => {
  const c = P.cleanConfig({ eventId: "youtube:AbC_1-x", eventSource: "youtube", streamKey: "abc" });
  assert.deepEqual([c.eventId, c.eventSource, c.streamKey], ["youtube:AbC_1-x", "youtube", "abc"]);
  for (const bad of [{ eventId: "a b", eventSource: "youtube" }, { eventId: "ok", eventSource: "You Tube" }, { eventId: "ok" }, { eventSource: "youtube" }, { eventId: "<script>", eventSource: "x" }, { eventId: "x".repeat(101), eventSource: "x" }, { eventId: 5, eventSource: "x" }]) {
    const d = P.cleanConfig(bad); assert.deepEqual([d.eventId, d.eventSource], ["", ""], JSON.stringify(bad));
  }
  assert.deepEqual([P.DEFAULT_CONFIG.eventId, P.DEFAULT_CONFIG.eventSource], ["", ""]);
  const base = P.cleanConfig({ eventId: "calendar:z1", eventSource: "calendar" });
  assert.equal(P.cleanConfig({ style: "poster" }, base).eventId, "calendar:z1", "sans mention, la valeur de départ est reprise");
  assert.equal(P.cleanConfig({ eventId: "", eventSource: "" }, base).eventId, "", "…sauf si on l'efface");
});

test("modèle : l'événement n'est jamais enregistré dans un modèle (c'est toujours « celui du moment »)", async () => {
  const ctx = mk();
  const saved = await data.saveModel(ctx, { name: "Soirée", config: P.cleanConfig({ style: "poster", eventId: "youtube:v1", eventSource: "youtube", streamKey: "abc" }) });
  assert.ok(saved.ok);
  const m = (await data.readModels(ctx))[0];
  assert.deepEqual([m.config.eventId, m.config.eventSource, m.config.streamKey], ["", "", ""]);
});

/* ───────────── Les outils pour l'IA ───────────── */

test("story_events : la liste des événements de toutes les sources, par pages, avec l'état de chaque source ; lecture seule", async () => {
  const t = Date.now(), ctx = sample(t);
  const r = await def.mcp.story_events(ctx, {});
  assert.equal(r.state, "ok"); assert.equal(r.events.length, 20); assert.ok(r.next); assert.equal(r.total, 62);
  assert.deepEqual(Object.keys(r.events[0]).sort(), ["alsoIn", "allDay", "games", "id", "image", "source", "sourceLabel", "start", "timezone", "title", "type", "url"].sort());
  assert.deepEqual(r.sources.map((s) => [s.source, s.state, s.count]), [["calendar", "ok", 60], ["twitch", "ok", 1], ["youtube", "ok", 1]]);
  assert.ok(r.sources.find((s) => s.source === "youtube").note);
  const p2 = await def.mcp.story_events(ctx, { cursor: r.next, limit: 50 });
  assert.equal(p2.events[0].id !== r.events[0].id, true); assert.equal(p2.events.length, 42);
  const only = await def.mcp.story_events(ctx, { source: "youtube" }); assert.deepEqual(only.events.map((e) => e.id), ["youtube:v1"]);
  assert.equal(only.events[0].url, "https://www.youtube.com/watch?v=v1");
  const none = await def.mcp.story_events(withSources({}), {}); assert.deepEqual([none.state, none.events], ["empty", []]);
  const never = () => new Promise(() => {}), slow = withSources({ yt: never }); slow.api.topics.collect = never;
  const s = await def.mcp.story_events(slow, {}); assert.equal(s.state, "slow");
  const d = manifest.mcp.find((x) => x.name === "story_events"); assert.equal(d.readOnly, true); assert.ok(d.name.length <= 31);
  assert.deepEqual(Object.keys(d.input.properties).sort(), ["cursor", "limit", "q", "source"]);
});

test("story_prepare avec un événement : l'identifiant est vérifié, mémorisé avec sa source ; compatible avec les anciens arguments", async () => {
  const t = Date.now(), ctx = sample(t);
  const events = (await def.mcp.story_events(ctx, { source: "youtube" })).events;
  const out = await def.mcp.story_prepare(ctx, { event: events[0].id, style: "poster", text: "Venez" });
  assert.equal(out.ok, true); assert.equal(out.prepared.stream, "event"); assert.deepEqual(out.prepared.event, { id: "youtube:v1", title: "Première du clip", source: "YouTube" });
  const pid = new URL(out.link).searchParams.get("prep"), prep = await data.readPrep(ctx, pid);
  assert.deepEqual([prep.config.eventId, prep.config.eventSource, prep.config.style], ["youtube:v1", "youtube", "poster"]);
  const cal = (await def.mcp.story_events(ctx, { source: "calendar", limit: 1 })).events[0];
  const p2 = await data.readPrep(ctx, new URL((await def.mcp.story_prepare(ctx, { event: cal.id })).link).searchParams.get("prep"));
  assert.equal(p2.config.eventSource, "calendar"); assert.match(p2.config.streamKey, /^[a-z0-9]{1,20}$/, "la clé d'un stream d'agenda est aussi remplie (anciens liens)");
  // anciens arguments : inchangés
  const old = await def.mcp.story_next_streams(ctx);
  assert.deepEqual(Object.keys(old.streams[0]).sort(), ["allDay", "games", "key", "start", "timezone", "title"], "story_next_streams n'a pas changé");
  const viaKey = await def.mcp.story_prepare(ctx, { stream: old.streams[0].key });
  assert.equal(viaKey.prepared.stream, old.streams[0].key);
  const viaKeyPrep = await data.readPrep(ctx, new URL(viaKey.link).searchParams.get("prep"));
  assert.deepEqual([viaKeyPrep.config.eventId, viaKeyPrep.config.streamKey], ["", old.streams[0].key]);
  const manual = await data.readPrep(ctx, new URL((await def.mcp.story_prepare(ctx, { streamTitle: "À la main", streamDate: "2026-12-01" })).link).searchParams.get("prep"));
  assert.deepEqual([manual.config.eventId, manual.manual.title], ["", "À la main"]);
});

test("story_prepare avec un événement : les erreurs sont claires et ne divulguent rien", async () => {
  const t = Date.now(), ctx = sample(t);
  await assert.rejects(def.mcp.story_prepare(ctx, { event: "youtube:nexiste:pas" }), (e) => e.expose === true && /story_events/.test(e.message) && /youtube:nexiste:pas/.test(e.message));
  await assert.rejects(def.mcp.story_prepare(ctx, { event: "pas un identifiant!" }), (e) => e.expose === true && /story_events/.test(e.message));
  await assert.rejects(def.mcp.story_prepare(ctx, { event: 12 }), (e) => e.expose === true);
  await assert.rejects(def.mcp.story_prepare(ctx, { event: "youtube:v1", stream: "abc" }), (e) => e.expose === true && /only one/.test(e.message));
  await assert.rejects(def.mcp.story_prepare(ctx, { event: "youtube:v1", streamTitle: "x", streamDate: "2026-12-01" }), (e) => e.expose === true);
  const never = () => new Promise(() => {}), mute = withSources({ yt: never, tw: never }); mute.api.topics.collect = never;
  await assert.rejects(def.mcp.story_prepare(mute, { event: "youtube:v1" }), (e) => e.expose === true && /did not answer/.test(e.message));
  assert.throws(() => tools.strictPrepare({ event: "calendar:x" }, { models: [], tz: "UTC", events: [] }), /No upcoming event/);
});

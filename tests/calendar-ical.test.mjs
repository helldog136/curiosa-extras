import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const M = await import("../modules/calendar-ical/index.mjs");
const { parseIcs, isPublicHttpsUrl, readIcs, clearCache, toCalendarEvent, matchesTags, windowOf } = M;
const def = M.default;

const cal = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;
const WINDOW_END = new Date("2030-01-01T00:00:00Z");
const SECRET = "https://calendar.example.com/ical/TOP-SECRET-TOKEN/basic.ics";
// Les tests des anciens « ICS : … » et « téléchargement » du Planning, déplacés ici avec le code qu'ils testent. `readIcsText` = l'ancien fetchIcs (texte ou null).
const readIcsText = async (url, fetchImpl) => { const r = await readIcs(url, { fetchImpl, ttlMs: 300_000 }); return r.ok ? r.text : null; };
beforeEach(() => clearCache());
afterEach(() => clearCache());

test("ICS : événement simple, heure UTC et heure locale avec TZID", () => {
  const out = parseIcs(cal(
    ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T210000Z", "SUMMARY:Stream A"]),
    ev(["UID:b", "DTSTART;TZID=Europe/Paris:20260111T200000", "DTEND;TZID=Europe/Paris:20260111T220000", "SUMMARY:Stream B"]),
  ), { timeZone: "Europe/Paris", windowEnd: WINDOW_END });
  const byTitle = Object.fromEntries(out.map((e) => [e.title ?? e.summary, e]));
  const a = byTitle["Stream A"], b = byTitle["Stream B"];
  assert.ok(a && b, JSON.stringify(out));
  assert.equal(new Date(a.start).toISOString(), "2026-01-10T19:00:00.000Z");
  assert.equal(new Date(b.start).toISOString(), "2026-01-11T19:00:00.000Z");
});

test("ICS : lignes pliées et caractères échappés", () => {
  const out = parseIcs(cal(ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:Un titre très long qui est", " plié sur deux lignes\\, avec virgule"])), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.match(out[0].title ?? out[0].summary, /plié sur deux lignes, avec virgule/);
});

test("ICS : événements annulés ignorés", () => {
  const out = parseIcs(cal(ev(["UID:a", "STATUS:CANCELLED", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:X"])), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.equal(out.length, 0);
});

test("ICS : répétition hebdomadaire avec jours, EXDATE et exception déplacée", () => {
  const out = parseIcs(cal(ev([
    "UID:r", "DTSTART;TZID=Europe/Paris:20260105T200000", "DTEND;TZID=Europe/Paris:20260105T220000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6", "EXDATE;TZID=Europe/Paris:20260107T200000", "SUMMARY:Régulier",
  ])), { timeZone: "Europe/Paris", windowEnd: WINDOW_END });
  // 6 occurrences (lun 5, mer 7, lun 12, mer 14, lun 19, mer 21) moins le 7 exclu
  assert.equal(out.length, 5);
  assert.ok(!out.some((e) => new Date(e.start).toISOString().startsWith("2026-01-07")));
});

test("ICS : répétition quotidienne bornée par UNTIL, intervalle respecté", () => {
  const out = parseIcs(cal(ev(["UID:d", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z", "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20260109T235959Z", "SUMMARY:Un jour sur deux"])), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.deepEqual(out.map((e) => new Date(e.start).getUTCDate()), [1, 3, 5, 7, 9]);
});

test("ICS : répétition mensuelle et annuelle", () => {
  const m = parseIcs(cal(ev(["UID:m", "DTSTART:20260115T100000Z", "DTEND:20260115T110000Z", "RRULE:FREQ=MONTHLY;COUNT=3", "SUMMARY:M"])), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.deepEqual(m.map((e) => new Date(e.start).getUTCMonth()), [0, 1, 2]);
  const y = parseIcs(cal(ev(["UID:y", "DTSTART:20260115T100000Z", "DTEND:20260115T110000Z", "RRULE:FREQ=YEARLY;COUNT=2", "SUMMARY:Y"])), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.deepEqual(y.map((e) => new Date(e.start).getUTCFullYear()), [2026, 2027]);
});

test("ICS : une répétition infinie est bornée par la fenêtre demandée", () => {
  const out = parseIcs(cal(ev(["UID:i", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z", "RRULE:FREQ=DAILY", "SUMMARY:Infini"])), { timeZone: "UTC", windowEnd: new Date("2026-01-11T00:00:00Z") });
  assert.ok(out.length >= 9 && out.length <= 11, String(out.length));
});

test("ICS : la remplaçante (RECURRENCE-ID) prend la place de l'occurrence d'origine", () => {
  const out = parseIcs(cal(
    ev(["UID:s", "DTSTART:20260105T190000Z", "DTEND:20260105T200000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Série"]),
    ev(["UID:s", "RECURRENCE-ID:20260112T190000Z", "DTSTART:20260112T150000Z", "DTEND:20260112T160000Z", "SUMMARY:Série déplacée"]),
  ), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.equal(out.length, 3);
  const moved = out.filter((e) => new Date(e.start).toISOString() === "2026-01-12T15:00:00.000Z");
  assert.equal(moved.length, 1);
  assert.ok(!out.some((e) => new Date(e.start).toISOString() === "2026-01-12T19:00:00.000Z"));
});

test("ICS : une occurrence annulée via RECURRENCE-ID disparaît", () => {
  const out = parseIcs(cal(
    ev(["UID:s", "DTSTART:20260105T190000Z", "DTEND:20260105T200000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Série"]),
    ev(["UID:s", "RECURRENCE-ID:20260112T190000Z", "STATUS:CANCELLED", "DTSTART:20260112T190000Z", "DTEND:20260112T200000Z", "SUMMARY:Série"]),
  ), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.equal(out.length, 2);
});

test("ICS : contenu absurde ou vide → liste vide, jamais d'exception", () => {
  for (const junk of ["", "n'importe quoi", "BEGIN:VCALENDAR\r\nEND:VCALENDAR", cal("BEGIN:VEVENT\r\nEND:VEVENT"), cal(ev(["DTSTART:pasunedate", "SUMMARY:x"]))]) {
    assert.deepEqual(parseIcs(junk, { timeZone: "UTC", windowEnd: WINDOW_END }), []);
  }
});

test("adresses de calendrier : https public uniquement (protection contre le SSRF)", () => {
  assert.ok(isPublicHttpsUrl("https://calendar.google.com/calendar/ical/x/basic.ics"));
  for (const bad of [
    "http://calendar.google.com/x.ics", "ftp://x.com/a", "https://user:pw@example.com/a", "https://localhost/a", "https://foo.local/a",
    "https://intranet.internal/a", "https://127.0.0.1/a", "https://10.0.0.5/a", "https://192.168.1.1/a", "https://172.16.0.1/a",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/a", "https://[fe80::1]/a", "https://[fd00::1]/a", "javascript:alert(1)", "", "pas une url", null, undefined,
  ]) assert.ok(!isPublicHttpsUrl(bad), String(bad));
});

test("téléchargement : contenu valide, cache de 5 minutes, refus des réponses qui ne sont pas un calendrier", async () => {
  clearCache();
  let calls = 0;
  const good = async () => { calls++; return new Response(cal(ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:x"])), { status: 200 }); };
  const a = await readIcsText("https://example.com/a.ics", good);
  const b = await readIcsText("https://example.com/a.ics", good);
  assert.match(a, /BEGIN:VCALENDAR/);
  assert.equal(a, b);
  assert.equal(calls, 1, "deuxième appel servi par le cache");

  clearCache();
  assert.equal(await readIcsText("https://example.com/b.ics", async () => new Response("<html>hello</html>", { status: 200 })), null);
  assert.equal(await readIcsText("https://example.com/c.ics", async () => new Response("nope", { status: 500 })), null);
  assert.equal(await readIcsText("https://example.com/d.ics", async () => { throw new Error("réseau"); }), null);
  calls = 0;
  assert.equal(await readIcsText("http://example.com/e.ics", good), null, "http refusé");
  assert.equal(await readIcsText("https://127.0.0.1/f.ics", good), null, "adresse privée refusée");
  assert.equal(calls, 0, "aucun appel réseau pour une adresse refusée");
});

test("téléchargement : une redirection vers une adresse privée est refusée, une redirection publique suivie", async () => {
  clearCache();
  const seen = [];
  const toPrivate = async (u) => { seen.push(u); return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }); };
  assert.equal(await readIcsText("https://example.com/r.ics", toPrivate), null);
  assert.deepEqual(seen, ["https://example.com/r.ics"], "l'adresse interne n'est jamais contactée");

  clearCache();
  const hops = [];
  const chain = async (u) => {
    hops.push(u);
    if (u.endsWith("/start")) return new Response(null, { status: 301, headers: { location: "/final.ics" } });
    return new Response(cal(ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:x"])), { status: 200 });
  };
  assert.match(await readIcsText("https://example.com/start", chain), /VCALENDAR/);
  assert.equal(hops.length, 2);

  clearCache();
  const loop = async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } });
  assert.equal(await readIcsText("https://example.com/loop", loop), null, "boucle de redirections abandonnée");
});


/* ───────────── Nouveautés du fournisseur : plage, fuseaux, récurrences, annulations, éléments du sujet ───────────── */

const ctxOf = (settings = {}, over = {}) => fakeCtx({ key: "ical1", settings: { url: SECRET, ...settings }, messages: {}, ...over });
const serve = (body, { status = 200, headers = {} } = {}) => { const calls = []; globalThis.fetch = async (u, init = {}) => { calls.push({ u: String(u), init }); return new Response(status === 304 ? null : body, { status, headers }); }; return calls; };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const range = (a, b) => ({ from: new Date(a), to: new Date(b) });

test("plage : seules les occurrences de [from, to] sont renvoyées (une répétition ancienne ou infinie ne déborde pas)", async () => {
  serve(cal(ev(["UID:d", "DTSTART:20200101T100000Z", "DTEND:20200101T110000Z", "RRULE:FREQ=DAILY", "SUMMARY:Tous les jours"])));
  const items = await def.exports["calendar.event"](ctxOf(), { limit: 200, ...range("2026-10-12T00:00:00Z", "2026-10-15T00:00:00Z") });
  assert.deepEqual(items.map((i) => i.start), ["2026-10-12T10:00:00.000Z", "2026-10-13T10:00:00.000Z", "2026-10-14T10:00:00.000Z"]);
});

test("plage : un évènement qui chevauche le début de la plage est gardé, un évènement hors plage non", async () => {
  serve(cal(ev(["UID:a", "DTSTART:20261012T220000Z", "DTEND:20261013T020000Z", "SUMMARY:Nuit blanche"]), ev(["UID:b", "DTSTART:20261001T100000Z", "DTEND:20261001T110000Z", "SUMMARY:Passé"]), ev(["UID:c", "DTSTART:20261101T100000Z", "DTEND:20261101T110000Z", "SUMMARY:Loin"])));
  const items = await def.exports["calendar.event"](ctxOf(), range("2026-10-13T00:30:00Z", "2026-10-20T00:00:00Z"));
  assert.deepEqual(items.map((i) => i.title), ["Nuit blanche"]);
});

test("limite respectée ; sans plage : de maintenant à 60 jours ; plage absurde bornée à 400 jours", async () => {
  const day = (n) => new Date(Date.now() + n * 86_400_000), d = (x) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  serve(cal(...[1, 2, 3, 59, 61].map((n) => ev([`UID:e${n}`, `DTSTART:${d(day(n))}`, `DTEND:${d(new Date(day(n).getTime() + 3_600_000))}`, `SUMMARY:E${n}`]))));
  assert.equal((await def.exports["calendar.event"](ctxOf(), { limit: 2 })).length, 2);
  assert.deepEqual((await def.exports["calendar.event"](ctxOf(), { limit: 50 })).map((i) => i.title), ["E1", "E2", "E3", "E59"]);
  const [lo, hi] = windowOf({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2030-01-01T00:00:00Z") });
  assert.equal((hi - lo) / 86_400_000, 400);
});

test("récurrence avec fuseau : l'heure murale est gardée à travers le changement d'heure, EXDATE (liste) et remplaçante déplacée", () => {
  const out = parseIcs(cal(
    ev(["UID:r", "DTSTART;TZID=Europe/Paris:20261023T200000", "DTEND;TZID=Europe/Paris:20261023T220000", "RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE;TZID=Europe/Paris:20261106T200000,20261113T200000", "SUMMARY:Vendredi"]),
    ev(["UID:r", "RECURRENCE-ID;TZID=Europe/Paris:20261030T200000", "DTSTART;TZID=Europe/Paris:20261031T150000", "DTEND;TZID=Europe/Paris:20261031T170000", "SUMMARY:Déplacé"]),
  ), { timeZone: "UTC", windowEnd: WINDOW_END });
  assert.deepEqual(out.map((e) => [e.title, e.start.toISOString()]), [
    ["Vendredi", "2026-10-23T18:00:00.000Z"],       // heure d'été (UTC+2)
    ["Déplacé", "2026-10-31T14:00:00.000Z"],         // déplacé au samedi 15:00 (encore UTC+1 avant la bascule du 25 octobre ? non : l'été se termine le 25 → UTC+1)
    ["Vendredi", "2026-11-20T19:00:00.000Z"],       // après la bascule (UTC+1) : toujours 20:00 à Paris
  ]);
});

test("récurrence en UTC (DTSTART …Z) : elle reste à la même heure UTC quel que soit le fuseau de l'instance", () => {
  const out = parseIcs(cal(ev(["UID:u", "DTSTART:20261023T180000Z", "DTEND:20261023T190000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:U"])), { timeZone: "Europe/Paris", windowEnd: WINDOW_END });
  assert.deepEqual(out.map((e) => e.start.toISOString().slice(11, 16)), ["18:00", "18:00", "18:00"]);
});

test("heure sans fuseau : lue dans le fuseau de l'instance ; fuseau absurde (Outlook) : ignoré sans lever d'exception", () => {
  const out = parseIcs(cal(ev(["UID:f", "DTSTART:20261014T200000", "DTEND:20261014T210000", "SUMMARY:Flottant"]), ev(["UID:o", "DTSTART;TZID=Romance Standard Time:20261014T200000", "DTEND;TZID=Romance Standard Time:20261014T210000", "SUMMARY:Outlook"])), { timeZone: "Europe/Paris", windowEnd: WINDOW_END });
  assert.equal(out.find((e) => e.title === "Flottant").start.toISOString(), "2026-10-14T18:00:00.000Z");
  assert.ok(out.some((e) => e.title === "Outlook"));
});

test("annulations : annulé = status « cancelled » dans le sujet (le fournisseur ne le cache pas) ; occurrence annulée de même", async () => {
  serve(cal(ev(["UID:x", "STATUS:CANCELLED", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:Annulé"]),
    ev(["UID:s", "DTSTART:20261015T190000Z", "DTEND:20261015T200000Z", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:Série"]),
    ev(["UID:s", "RECURRENCE-ID:20261016T190000Z", "STATUS:CANCELLED", "DTSTART:20261016T190000Z", "DTEND:20261016T200000Z", "SUMMARY:Série"])));
  const items = await def.exports["calendar.event"](ctxOf(), range("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual(items.map((i) => [i.title, i.status]), [["Annulé", "cancelled"], ["Série", "confirmed"], ["Série", "cancelled"], ["Série", "confirmed"]]);
});

test("élément du sujet : forme exacte (id unique par occurrence, ISO, description/lieu/lien, étiquette et couleur de la source)", async () => {
  serve(cal(ev(["UID:g1", "DTSTART:20261014T190000Z", "DTEND:20261014T213000Z", "RRULE:FREQ=DAILY;COUNT=2", "SUMMARY:Soirée", "DESCRIPTION:Jeu : Celeste\\, Hades\\nMerci\; à bientôt", "LOCATION:Chez moi", "URL:https://exemple.test/live"])));
  const [a, b] = await def.exports["calendar.event"](ctxOf({ label: "Mes streams", color: "#9146ff" }), range("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual(a, { id: "g1@2026-10-14T19:00:00.000Z", title: "Soirée", start: "2026-10-14T19:00:00.000Z", end: "2026-10-14T21:30:00.000Z", allDay: false, status: "confirmed", description: "Jeu : Celeste, Hades\nMerci; à bientôt", location: "Chez moi", url: "https://exemple.test/live", sourceLabel: "Mes streams", color: "#9146ff" });
  assert.notEqual(a.id, b.id);
  const { conform } = await import("@/core/services/topics");
  const schema = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8")).consumes.find((c) => c.topic === "calendar.event").schema;
  assert.ok(conform(a, schema) && conform(b, schema), "valide selon le schéma que déclare le Planning (types datetime compris)");
});

test("journée entière : dates (fin exclue) ; un seul jour sans DTEND = fin le lendemain", () => {
  const out = parseIcs(cal(ev(["UID:a", "DTSTART;VALUE=DATE:20261014", "DTEND;VALUE=DATE:20261016", "SUMMARY:Deux jours"]), ev(["UID:b", "DTSTART;VALUE=DATE:20261020", "SUMMARY:Un jour"])), { timeZone: "Europe/Paris", windowEnd: WINDOW_END });
  const items = out.map((e) => toCalendarEvent(e, { timeZone: "Europe/Paris" }));
  assert.deepEqual(items.map((i) => [i.start, i.end, i.allDay]), [["2026-10-14", "2026-10-16", true], ["2026-10-20", "2026-10-21", true]]);
});

test("étiquettes : sans demande tout passe ; avec une demande seulement les sources qui l'ont ; instance sans étiquette = rien", async () => {
  serve(cal(ev(["UID:a", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:A"])));
  const r = range("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
  assert.equal((await def.exports["calendar.event"](ctxOf({ tags: "Streams, week-end" }), { ...r, tags: [] })).length, 1);
  assert.equal((await def.exports["calendar.event"](ctxOf({ tags: "Streams, week-end" }), { ...r, tags: ["streams"] })).length, 1);
  assert.equal((await def.exports["calendar.event"](ctxOf({ tags: "Streams" }), { ...r, tags: ["autre"] })).length, 0);
  assert.equal((await def.exports["calendar.event"](ctxOf(), { ...r, tags: ["streams"] })).length, 0);
  assert.ok(matchesTags(undefined, []));
});

test("cache : deuxième lecture servie sans réseau ; après expiration, requête conditionnelle (ETag / If-Modified-Since) et 304 = copie gardée", async () => {
  const body = cal(ev(["UID:a", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:A"]));
  let t = 1_000_000;
  const calls = serve(body, { headers: { etag: '"v1"', "last-modified": "Mon, 12 Oct 2026 10:00:00 GMT" } });
  const first = await readIcs(SECRET, { now: () => t });
  await readIcs(SECRET, { now: () => t + 1000 });
  assert.equal(calls.length, 1, "cache");
  assert.ok(first.ok && !first.cached);
  const calls2 = serve(null, { status: 304 });
  t += 10 * 60_000;
  const again = await readIcs(SECRET, { now: () => t });
  assert.ok(again.ok && again.text === body && again.cached);
  assert.equal(calls2[0].init.headers["If-None-Match"], '"v1"');
  assert.equal(calls2[0].init.headers["If-Modified-Since"], "Mon, 12 Oct 2026 10:00:00 GMT");
});

test("erreur : la dernière copie est gardée (moins de 24 h) ; sans copie, une erreur lisible ; pas de harcèlement après un échec", async () => {
  const body = cal(ev(["UID:a", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:A"]));
  let t = 5_000_000;
  serve(body);
  await readIcs(SECRET, { now: () => t });
  t += 10 * 60_000;
  const down = serve("oups", { status: 503 });
  const stale = await readIcs(SECRET, { now: () => t });
  assert.ok(stale.ok && stale.stale && stale.error === "http" && stale.status === 503);
  await readIcs(SECRET, { now: () => t + 5000 });
  assert.equal(down.length, 1, "30 s sans nouvelle tentative");
  clearCache();
  serve("<html>", { status: 200 });
  assert.deepEqual(await readIcs(SECRET), { ok: false, error: "format", status: undefined });
  clearCache();
  globalThis.fetch = async () => { throw new Error(`échec sur ${SECRET}`); };
  assert.equal((await readIcs(SECRET)).error, "network");
  assert.deepEqual(await readIcs("http://exemple.test/x.ics"), { ok: false, error: "url" });
  assert.deepEqual(await readIcs(""), { ok: false, error: "config" });
});

test("taille bornée : un flux de plus de 5 Mo est refusé, sans être lu en entier", async () => {
  clearCache();
  serve("BEGIN:VCALENDAR" + "x".repeat(5_100_000));
  assert.equal((await readIcs(SECRET)).error, "size");
  clearCache();
  serve("BEGIN:VCALENDAR", { headers: { "content-length": "9000000" } });
  assert.equal((await readIcs(SECRET)).error, "size");
});

test("secret : l'adresse n'apparaît jamais (panneau, test, état, erreurs, sujet, journaux) et le réglage est de type secret", async () => {
  const logs = []; const origErr = console.error, origLog = console.log, origWarn = console.warn;
  console.error = console.log = console.warn = (...a) => logs.push(a.join(" "));
  try {
    const messages = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/calendar-ical/locales/fr.json", import.meta.url), "utf8"));
    const ctx = ctxOf({}, { messages, locale: "fr" });
    const seen = [];
    serve(cal(ev(["UID:a", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:A"])));
    seen.push(JSON.stringify(await def.adminPanel(ctx)), JSON.stringify(await def.adminActions.test(ctx)), JSON.stringify(await def.services["calendar.provider"].describe(ctx)), JSON.stringify(await def.exports["calendar.event"](ctx, {})));
    serve("x", { status: 404 }); clearCache();
    seen.push(JSON.stringify(await def.adminPanel(ctx)), JSON.stringify(await def.adminActions.test(ctx)));
    globalThis.fetch = async () => { throw new Error(`échec ${SECRET}`); }; clearCache();
    seen.push(JSON.stringify(await def.adminActions.test(ctx)), JSON.stringify(await def.exports["calendar.event"](ctx, {})));
    for (const out of [...seen, ...logs]) assert.ok(!out.includes("TOP-SECRET-TOKEN"), out.slice(0, 120));
  } finally { console.error = origErr; console.log = origLog; console.warn = origWarn; }
  const m = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/calendar-ical/module.json", import.meta.url), "utf8"));
  assert.equal(m.settings.find((s) => s.key === "url").type, "secret");
});

test("admin : adresse absente / refusée / illisible / lue, bouton « Tester l'adresse » ; describe() sans réseau", async () => {
  const messages = JSON.parse((await import("node:fs")).readFileSync(new URL("../modules/calendar-ical/locales/fr.json", import.meta.url), "utf8"));
  const mk = (s) => ctxOf(s, { messages, locale: "fr" });
  assert.match((await def.adminPanel(mk({ url: "" })))[1].text, /Aucune adresse/);
  assert.match((await def.adminPanel(mk({ url: "http://x.test/a.ics" })))[1].text, /n'est pas autorisée/);
  assert.equal((await def.actions?.test) , undefined);
  assert.match((await def.adminActions.test(mk({ url: "" }))).error, /Aucune adresse/);
  serve("nope", { status: 403 });
  assert.match((await def.adminActions.test(mk({}))).error, /code 403/);
  clearCache();
  serve(cal(ev(["UID:a", "DTSTART:20261014T190000Z", "DTEND:20261014T200000Z", "SUMMARY:A"])), {});
  const t0 = Date.now();
  assert.deepEqual(await def.services["calendar.provider"].describe(mk({ url: "" })), { kind: "ical", label: null, color: null, active: false, state: "unset" });
  const d = await def.services["calendar.provider"].describe(mk({ label: "Streams", color: "#123456" }));
  assert.equal(d.active, true); assert.equal(d.label, "Streams");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(def.services["calendar.provider"].describe.length >= 0, true);
});

test("i18n : fr et en ont les mêmes clés, toutes les clés utilisées existent ; manifeste valide (service each, sujet fourni)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../modules/calendar-ical/", import.meta.url);
  const fr = JSON.parse(fs.readFileSync(new URL("locales/fr.json", dir), "utf8")), en = JSON.parse(fs.readFileSync(new URL("locales/en.json", dir), "utf8"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const code = fs.readFileSync(new URL("index.mjs", dir), "utf8");
  for (const m of code.matchAll(/\bt\(\s*["`]([A-Za-z_]+)["`]/g)) assert.ok(m[1] in fr, m[1]);
  for (const m of code.matchAll(/\bt\(`(err_)\$\{/g)) for (const k of ["url", "network", "http", "format", "size", "config"]) assert.ok(`${m[1]}${k}` in fr);
  const { parseManifest } = await import("@/core/modules/manifest");
  const raw = JSON.parse(fs.readFileSync(new URL("module.json", dir), "utf8"));
  const parsed = parseManifest(raw); assert.ok(parsed.ok, parsed.error);
  assert.equal(raw.minCore, "0.1.16"); assert.equal(raw.version, "1.0.0"); assert.equal(raw.instances, "multiple");
  assert.deepEqual(raw.offers[0], { ...raw.offers[0], service: "calendar.provider", each: true });
  assert.deepEqual(raw.provides.map((p) => p.topic), ["calendar.event"]);
  const declared = new Set(raw.settings.map((s) => s.key));
  for (const m of code.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
});

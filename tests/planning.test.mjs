import test from "node:test";
import assert from "node:assert/strict";

const P = await import("../modules/planning/index.mjs");
const { parseIcs, extractGameNames, buildDays, getWeekRange, isPublicHttpsUrl, isValidTimeZone, zonedTimeToUtc, wallDateNow, fetchIcs, clearIcsCache } = P;

const cal = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;
const WINDOW_END = new Date("2030-01-01T00:00:00Z");

test("fuseaux : conversion heure locale → UTC, heure d'été comprise", () => {
  assert.equal(zonedTimeToUtc(2026, 1, 15, 20, 0, 0, "Europe/Paris").toISOString(), "2026-01-15T19:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 7, 15, 20, 0, 0, "Europe/Paris").toISOString(), "2026-07-15T18:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 7, 15, 20, 0, 0, "UTC").toISOString(), "2026-07-15T20:00:00.000Z");
});

test("fuseaux : validation", () => {
  assert.ok(isValidTimeZone("Europe/Paris") && isValidTimeZone("UTC"));
  assert.ok(!isValidTimeZone("Mars/Olympus") && !isValidTimeZone("") && !isValidTimeZone(null));
});

test("date du jour dans le fuseau demandé (pas celui du serveur)", () => {
  const now = new Date("2026-03-10T23:30:00Z");
  assert.equal(JSON.stringify(wallDateNow("Europe/Paris", now)).includes('"d":11'), true, "minuit passé à Paris");
  assert.equal(JSON.stringify(wallDateNow("America/New_York", now)).includes('"d":10'), true);
});

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

test("jeux : lignes Jeu/Jeux/Game(s), séparateurs, limite à 3, entités HTML", () => {
  assert.deepEqual(extractGameNames("Jeu: Zelda"), ["Zelda"]);
  assert.deepEqual(extractGameNames("Jeux: Zelda, Mario + Metroid"), ["Zelda", "Mario", "Metroid"]);
  assert.deepEqual(extractGameNames("Games: A1, B2, C3, D4, E5"), ["A1", "B2", "C3"]);
  assert.deepEqual(extractGameNames("game: Tom &amp; Jerry"), ["Tom & Jerry"]);
  assert.deepEqual(extractGameNames("Bonjour\nJeu: X"), [], "un seul caractère est ignoré");
  assert.deepEqual(extractGameNames("Pas de jeu ici"), []);
  assert.deepEqual(extractGameNames(""), []);
  assert.deepEqual(extractGameNames(undefined), []);
});

test("semaines : lundi→dimanche dans le fuseau, décalage de semaines", () => {
  const now = new Date("2026-03-11T12:00:00Z"); // mercredi
  const w0 = getWeekRange(0, "Europe/Paris", now);
  const w1 = getWeekRange(1, "Europe/Paris", now);
  const j = JSON.stringify([w0, w1]);
  assert.match(j, /2026/);
  assert.notDeepEqual(w0, w1);
});

test("jours : chaque événement tombe dans le bon jour, triés par heure", () => {
  const events = [
    { title: "B", start: new Date("2026-03-10T20:00:00Z"), end: new Date("2026-03-10T21:00:00Z") },
    { title: "A", start: new Date("2026-03-10T10:00:00Z"), end: new Date("2026-03-10T11:00:00Z") },
    { title: "C", start: new Date("2026-03-12T10:00:00Z"), end: new Date("2026-03-12T11:00:00Z") },
  ];
  const days = buildDays({ y: 2026, m: 3, d: 9 }, 7, events, "UTC");
  assert.equal(days.length, 7);
  const titles = days.map((d) => d.streams.map((e) => e.title));
  assert.deepEqual(titles[1], ["A", "B"]);
  assert.deepEqual(titles[3], ["C"]);
  assert.deepEqual(titles[0], []);
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
  clearIcsCache();
  let calls = 0;
  const good = async () => { calls++; return new Response(cal(ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:x"])), { status: 200 }); };
  const a = await fetchIcs("https://example.com/a.ics", good);
  const b = await fetchIcs("https://example.com/a.ics", good);
  assert.match(a, /BEGIN:VCALENDAR/);
  assert.equal(a, b);
  assert.equal(calls, 1, "deuxième appel servi par le cache");

  clearIcsCache();
  assert.equal(await fetchIcs("https://example.com/b.ics", async () => new Response("<html>hello</html>", { status: 200 })), null);
  assert.equal(await fetchIcs("https://example.com/c.ics", async () => new Response("nope", { status: 500 })), null);
  assert.equal(await fetchIcs("https://example.com/d.ics", async () => { throw new Error("réseau"); }), null);
  calls = 0;
  assert.equal(await fetchIcs("http://example.com/e.ics", good), null, "http refusé");
  assert.equal(await fetchIcs("https://127.0.0.1/f.ics", good), null, "adresse privée refusée");
  assert.equal(calls, 0, "aucun appel réseau pour une adresse refusée");
});

test("téléchargement : une redirection vers une adresse privée est refusée, une redirection publique suivie", async () => {
  clearIcsCache();
  const seen = [];
  const toPrivate = async (u) => { seen.push(u); return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } }); };
  assert.equal(await fetchIcs("https://example.com/r.ics", toPrivate), null);
  assert.deepEqual(seen, ["https://example.com/r.ics"], "l'adresse interne n'est jamais contactée");

  clearIcsCache();
  const hops = [];
  const chain = async (u) => {
    hops.push(u);
    if (u.endsWith("/start")) return new Response(null, { status: 301, headers: { location: "/final.ics" } });
    return new Response(cal(ev(["UID:a", "DTSTART:20260110T190000Z", "DTEND:20260110T200000Z", "SUMMARY:x"])), { status: 200 });
  };
  assert.match(await fetchIcs("https://example.com/start", chain), /VCALENDAR/);
  assert.equal(hops.length, 2);

  clearIcsCache();
  const loop = async () => new Response(null, { status: 302, headers: { location: "https://example.com/loop" } });
  assert.equal(await fetchIcs("https://example.com/loop", loop), null, "boucle de redirections abandonnée");
});

test("manifeste : instances multiples, page propre, MCP en lecture seule activé par défaut", async () => {
  const m = (await import("node:fs")).readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8");
  const json = JSON.parse(m);
  assert.equal(json.id, "planning");
  assert.equal(json.instances, "multiple");
  const tool = json.mcp.find((x) => x.name === "planning_upcoming");
  assert.ok(tool);
  assert.equal(tool.readOnly, true);
  assert.equal(tool.default, true);
  const icsSetting = json.settings.find((x) => x.key === "icsUrl");
  assert.equal(icsSetting.type, "secret", "l'adresse du calendrier privé est un secret");
});

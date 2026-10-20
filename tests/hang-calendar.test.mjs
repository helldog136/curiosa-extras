// Agendas et Planning : un agenda en ligne, un module ou un sujet qui ne répond JAMAIS (« trou noir » : la demande ignore même le signal d'abandon) ne doit
// ni bloquer une page, ni laisser une demande partagée retenir tout le monde, ni mémoriser un résultat arrivé trop tard.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const HUNG = Symbol("hung");
const within = (p, ms = 2000) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});

const ical = await import("../modules/calendar-ical/index.mjs");
const { readIcs, clearCache, timing } = ical;
const planning = await import("../modules/planning/index.mjs");
const SECRET = "https://calendar.example.com/ical/TOP-SECRET-TOKEN/basic.ics";
const CAL = (title = "Soirée") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20991010T190000Z\r\nDTEND:20991010T210000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const saved = { ...timing }, savedPlanning = { ...planning.timing };
const realFetch = globalThis.fetch;
afterEach(() => { Object.assign(timing, saved); Object.assign(planning.timing, savedPlanning); globalThis.fetch = realFetch; clearCache(); });

test("agenda en ligne : un serveur muet ne retient personne au-delà de la borne ; la demande partagée est retirée et un serveur qui revient est relu", async () => {
  Object.assign(timing, { totalMs: 150 });
  clearCache();
  let calls = 0, t = 1_000_000;
  const mute = () => { calls++; return blackHole(); };
  const t0 = Date.now();
  const all = await within(Promise.all([1, 2, 3].map(() => readIcs(SECRET, { fetchImpl: mute, now: () => t }))));
  assert.notEqual(all, HUNG, "trois visiteurs en même temps : aucun n'attend sans fin");
  assert.ok(all.every((r) => r.ok === false && r.error === "network"), JSON.stringify(all));
  assert.equal(calls, 1, "ils partagent UNE demande");
  assert.ok(Date.now() - t0 < 700);
  // la demande en cours a été retirée : après la pause d'après-échec, on retente et un serveur revenu est relu
  assert.equal((await within(readIcs(SECRET, { fetchImpl: mute, now: () => t + 5_000 }))).error, "network", "pas de harcèlement pendant 30 s");
  assert.equal(calls, 1);
  const back = await within(readIcs(SECRET, { fetchImpl: async () => new Response(CAL(), { status: 200 }), now: () => t + 60_000 }));
  assert.equal(back.ok, true);
  assert.match(back.text, /Soirée/);
});

test("agenda en ligne : le résultat d'une lecture abandonnée, arrivé plus tard, n'est jamais rangé", async () => {
  Object.assign(timing, { totalMs: 100 });
  clearCache();
  const t = 5_000_000;
  // une réponse sans flux (lue d'un bloc) ne regarde jamais le signal d'abandon : seul le garde « abandonné » empêche de la ranger
  const late = async () => { await new Promise((r) => setTimeout(r, 300)); return { status: 200, ok: true, headers: new Headers(), body: null, text: async () => CAL("Arrivé trop tard") }; };
  assert.equal((await within(readIcs(SECRET, { fetchImpl: late, now: () => t }))).ok, false);
  await new Promise((r) => setTimeout(r, 450));   // la lecture abandonnée se termine en arrière-plan
  const after = await within(readIcs(SECRET, { fetchImpl: async () => { throw new Error("réseau"); }, now: () => t + 120_000 }));
  assert.equal(after.ok, false, "aucune copie n'a été gardée : il n'y a pas de « dernière copie » à servir");
});

test("agenda en ligne : des redirections lentes, ou un corps qui arrive au compte-gouttes, sont bornés ensemble", async () => {
  Object.assign(timing, { totalMs: 150 });
  clearCache();
  let n = 0;
  const slow = async () => { await new Promise((r) => setTimeout(r, 60)); n++; return new Response(null, { status: 302, headers: { location: `https://example.com/r${n}.ics` } }); };
  const t0 = Date.now();
  assert.equal((await within(readIcs("https://example.com/redirects.ics", { fetchImpl: slow }))).error, "network");
  assert.ok(Date.now() - t0 < 600);
  clearCache();
  const drip = async () => {
    const enc = new TextEncoder();
    let timer;
    const body = new ReadableStream({ start(c) { c.enqueue(enc.encode("BEGIN:VCALENDAR\r\n")); timer = setInterval(() => c.enqueue(enc.encode("X-FILL:remplissage\r\n")), 15); }, cancel() { clearInterval(timer); } });
    return new Response(body, { status: 200 });
  };
  const t1 = Date.now();
  assert.equal((await within(readIcs("https://example.com/drip.ics", { fetchImpl: drip }))).error, "network");
  assert.ok(Date.now() - t1 < 600, "le compte-gouttes est coupé à la borne");
});

test("agenda en ligne : si l'agenda se tait après une lecture réussie, la dernière copie est servie tout de suite", async () => {
  Object.assign(timing, { totalMs: 150 });
  clearCache();
  let t = 9_000_000;
  assert.equal((await readIcs(SECRET, { fetchImpl: async () => new Response(CAL(), { status: 200 }), ttlMs: 60_000, now: () => t })).ok, true);
  t += 10 * 60_000;   // le délai de validité est passé
  const t0 = Date.now();
  const r = await within(readIcs(SECRET, { fetchImpl: blackHole, ttlMs: 60_000, now: () => t }));
  assert.ok(r.ok && r.stale && /Soirée/.test(r.text), JSON.stringify({ ok: r.ok, stale: r.stale }));
  assert.ok(Date.now() - t0 < 600);
});

test("agenda en ligne : le sujet, l'administration et « Tester l'adresse » reviennent toujours, même si l'agenda ne répond jamais", async () => {
  Object.assign(timing, { totalMs: 150 });
  clearCache();
  globalThis.fetch = blackHole;
  const ctx = () => fakeCtx({ key: "ical1", settings: { url: SECRET, timezone: "UTC" }, messages: { adminStatus: "Votre agenda", adminSaved: "Adresse enregistrée ({host})", err_network: "Injoignable", adminNotSet: "-", testBtn: "Tester", allDay: "-", untitled: "-" }, locale: "fr" });
  const slots = await within(ical.default.exports["planning.slot"](ctx(), { limit: 10 }));
  assert.deepEqual(slots, []);
  const panel = await within(ical.default.adminPanel(ctx()));
  assert.notEqual(panel, HUNG);
  assert.ok(!JSON.stringify(panel).includes("TOP-SECRET-TOKEN"));
  clearCache();
  const test_ = await within(ical.default.adminActions.test(ctx()));
  assert.notEqual(test_, HUNG);
  assert.equal(test_.error, "Injoignable");
});

test("planning : un sujet « planning.slot » qui ne répond jamais ne bloque ni la page, ni les morceaux d'accueil, ni l'administration, ni MCP, ni l'image", async () => {
  planning.timing.collectMs = 120;
  const def = planning.default;
  const mk = () => fakeCtx({ settings: { days: 7, timezone: "UTC" }, topics: { "planning.slot": blackHole }, messages: { title: "Planning", intro: "i", none: "Rien", noStream: "Rien de prévu", adminStatus: "Vos streams", adminNoSlots: "Rien à afficher", nextUp: "Prochain", nextTitle: "Prochains", daysTitle: "Jours", noneToday: "—" }, locale: "fr", rawgConfigured: false });
  const t0 = Date.now();
  const page = await within(def.page(mk()));
  assert.notEqual(page, HUNG);
  assert.equal(page.blocks.filter((b) => b.type === "heading").length, 7, "une page normale, jours vides");
  for (const [name, call] of [["next", () => def.sections.next(mk(), {})], ["upcoming", () => def.sections.upcoming(mk(), {})], ["days", () => def.sections.days(mk(), {})], ["admin", () => def.adminPanel(mk())], ["mcp", () => def.mcp.planning_upcoming(mk(), {})]]) {
    const r = await within(call());
    assert.notEqual(r, HUNG, name);
  }
  const png = mk();
  const res = await within(def.routes.image(new Request("https://x.test/m/planning/image"), png));
  assert.notEqual(res, HUNG);
  assert.equal(res.status, 404, "pas de rendu d'une semaine qu'on n'a pas pu lire");
  assert.ok(Date.now() - t0 < 4000);
});

test("planning : une lecture lente mais qui aboutit dans la borne est utilisée normalement", async () => {
  planning.timing.collectMs = 400;
  const def = planning.default;
  const soon = new Date(Date.now() + 2 * 3_600_000);
  const slow = async () => { await new Promise((r) => setTimeout(r, 80)); return [{ id: "1", title: "Lent mais là", start: soon.toISOString(), end: new Date(soon.getTime() + 3_600_000).toISOString(), allDay: false, games: [] }]; };
  const ctx = fakeCtx({ settings: { days: 7, timezone: "UTC" }, topics: { "planning.slot": slow }, messages: { nextTitle: "Prochains" }, locale: "fr", rawgConfigured: false });
  const out = await def.mcp.planning_upcoming(ctx, {});
  assert.deepEqual(out.map((s) => s.title), ["Lent mais là"]);
});

test("bot Twitch : un agenda qui ne répond jamais ne retient pas la commande « !planning » (pas de prochain stream annoncé)", async () => {
  const sources = await import("../modules/twitch-bot/sources.mjs");
  const saved2 = { ...sources.timing };
  try {
    sources.timing.collectMs = 120;
    sources.resetSources();
    const ctx = fakeCtx({ key: "bot1", instances: [{ key: "agenda", module: "calendar-ical", basePath: null, name: "Agenda" }], topics: { "planning.slot": blackHole } });
    const r = await within(sources.planning(ctx));
    assert.notEqual(r, HUNG);
    assert.deepEqual(r, { installed: true, next: null });
  } finally { Object.assign(sources.timing, saved2); sources.resetSources(); }
});

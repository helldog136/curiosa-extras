// Le Planning LIT le sujet `planning.slot` sans connaître ses fournisseurs : plusieurs agendas fusionnés et triés, doublons écartés, journées entières, annulés, fuseau
// d'affichage, demande de période, aucun agenda. Horloge simulée : aucun test ne dépend de l'heure du jour.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const NOW = Date.parse("2026-10-14T10:00:00Z");   // mercredi
mock.timers.enable({ apis: ["Date"], now: NOW });
after(() => mock.timers.reset());

const mod = await import("../modules/planning/index.mjs");
const def = mod.default;
const { toSlots, displayZone } = mod;
const fr = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"));
const H = 3_600_000;
const at = (h) => new Date(NOW + h * H).toISOString();
const item = (id, h, over = {}) => ({ id, title: `T-${id}`, start: at(h), end: at(h + 1), ...over });

/** Un Planning branché sur des sources : `sources` = liste de listes de créneaux (un fournisseur chacune). Le faux cœur appelle la fonction avec { limit, from, to } comme le vrai. */
function planning({ sources = [], settings = {}, locale = "fr", over = {} } = {}) {
  const seen = [];
  const ctx = fakeCtx({ settings: { days: 7, ...settings }, messages: fr, locale, rawgConfigured: false, topics: { "planning.slot": (o) => { seen.push(o); return sources.flat(); } }, ...over });
  return { ctx, seen };
}

test("collecte : demande le sujet « planning.slot » sur la fenêtre affichée (jours réglés) avec une limite ; les agendas sont fusionnés et triés par début", async () => {
  const { ctx, seen } = planning({ sources: [[item("a2", 30), item("a1", 5)], [item("b1", 10)]], settings: { days: 3 } });
  const html = (await def.sections.upcoming(ctx, { count: 10 }))[1].html;
  assert.equal(seen.length, 1);
  assert.ok(seen[0].from instanceof Date && seen[0].to instanceof Date && seen[0].limit >= 100);
  assert.ok(Math.abs(seen[0].from.getTime() - (NOW - 24 * H)) < 1000, "à partir d'hier : un stream commencé hier soir et encore en cours reste visible");
  assert.ok(Math.abs(seen[0].to.getTime() - (NOW + 30 * 86_400_000)) < 1000);
  await def.page(ctx);
  assert.ok(Math.abs((seen.at(-1).to - NOW) / 86_400_000 - 3) < 0.01, "la page demande exactement les jours réglés");
  assert.deepEqual([...html.matchAll(/T-(\w+)/g)].map((m) => m[1]), ["a1", "b1", "a2"]);
});

test("deux agendas qui annoncent le même stream (même titre, mêmes heures) → un seul ; deux streams différents au même moment → les deux", async () => {
  const { ctx } = planning({ sources: [[item("a", 5, { title: "Même" })], [item("b", 5, { title: "Même" }), item("c", 5, { title: "Autre" })]] });
  const html = (await def.sections.upcoming(ctx, { count: 10 }))[1].html;
  assert.equal((html.match(/Même/g) ?? []).length, 1);
  assert.equal((html.match(/Autre/g) ?? []).length, 1);
});

test("jeux : ceux que donne l'agenda (3 au plus), jamais lus dans un texte ; sur la carte, la liste et le tableau de l'administration", async () => {
  const { ctx } = planning({ sources: [[item("a", 3, { games: ["Celeste", "Hades", "Hollow Knight", "Quatrième"] })]] });
  const card = (await def.sections.next(ctx, {}))[1].html;
  assert.match(card, /Jeu : Celeste, Hades, Hollow Knight</);
  assert.ok(!card.includes("Quatrième"));
  const { ctx: c2 } = planning({ sources: [[item("a", 3, { title: "Jeu: Zelda dans le titre", description: "Jeu: Zelda" })]] });
  assert.ok(!(await def.sections.next(c2, {}))[1].html.includes("class=\"cpl-games\""), "aucun jeu deviné du titre ni d'une description");
  const rows = (await def.adminPanel(ctx)).find((b) => b.type === "table").rows;
  assert.equal(rows[0][3], "Celeste, Hades, Hollow Knight");
});

test("annulés : fournis par l'agenda, cachés par défaut, montrés (barrés) seulement avec une apparence qui sait les montrer et l'option cochée", async () => {
  const sources = [[item("ok", 3), item("x", 5, { status: "cancelled", title: "Annulé ici" })]];
  const base = await def.page(planning({ sources }).ctx);
  assert.ok(!JSON.stringify(base).includes("Annulé ici"));
  const shown = (await def.page(planning({ sources, settings: { appearance: "classic", showCancelled: true } }).ctx)).blocks.find((b) => b.type === "html").html;
  assert.ok(shown.includes("Annulé ici"));
  const hidden = (await def.page(planning({ sources, settings: { appearance: "classic" } }).ctx)).blocks.find((b) => b.type === "html").html;
  assert.ok(!hidden.includes("Annulé ici"));
  assert.ok(!JSON.stringify(await def.mcp.planning_upcoming(planning({ sources }).ctx, {})).includes("Annulé ici"), "MCP : jamais d'annulé");
});

test("journée entière : la date donnée par l'agenda fait foi, dans le fuseau d'affichage, quel que soit le fuseau de l'agenda", () => {
  const raw = [{ id: "j", title: "Férié", start: "2026-10-14T22:00:00.000Z", end: "2026-10-15T22:00:00.000Z", allDay: true, day: "2026-10-15", timezone: "Europe/Paris" }];
  for (const [tz, s, e] of [["Europe/Paris", "2026-10-14T22:00:00.000Z", "2026-10-15T22:00:00.000Z"], ["America/Montreal", "2026-10-15T04:00:00.000Z", "2026-10-16T04:00:00.000Z"], ["UTC", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z"]]) {
    const [slot] = toSlots(raw, tz);
    assert.deepEqual([slot.start.toISOString(), slot.end.toISOString(), slot.allDay], [s, e, true], tz);
  }
  const [two] = toSlots([{ ...raw[0], end: "2026-10-16T22:00:00.000Z" }], "UTC");
  assert.equal((two.end - two.start) / 86_400_000, 2, "la durée en jours est gardée");
  const [noDay] = toSlots([{ id: "n", title: "x", start: "2026-10-15T00:00:00.000Z", allDay: true }], "UTC");
  assert.equal((noDay.end - noDay.start) / 86_400_000, 1, "sans date ni fin : un jour");
});

test("créneaux absurdes : début illisible écarté seul, fin avant le début corrigée, jeux nettoyés, rien ne lève", () => {
  const out = toSlots([null, 42, "x", {}, { title: "t" }, { title: "sans début", start: "nope" }, { id: "a", title: "ok", start: "2026-10-14T10:00:00Z", end: "2026-10-14T09:00:00Z", games: ["  Celeste ", 3, "", null, "B", "C", "D"] }, { id: "b", title: 7, start: "2026-10-14T11:00:00Z" }], "UTC");
  assert.deepEqual(out.map((s) => [s.uid, s.title]), [["a", "ok"], ["b", "7"]]);
  assert.equal((out[0].end - out[0].start), H, "fin avant le début : une heure");
  assert.deepEqual(out[0].games, ["Celeste", "B", "C"]);
  assert.deepEqual(toSlots(undefined, "UTC"), []);
});

test("fuseau d'affichage : celui des réglages, sinon le plus courant parmi les agendas, sinon UTC ; un nom inconnu est ignoré", () => {
  const z = (t) => ({ timezone: t });
  assert.equal(displayZone("Europe/Brussels", [z("Asia/Tokyo")]), "Europe/Brussels");
  assert.equal(displayZone("", [z("Europe/Paris"), z("America/Montreal"), z("Europe/Paris")]), "Europe/Paris");
  assert.equal(displayZone(undefined, [z("Asia/Tokyo")]), "Asia/Tokyo");
  assert.equal(displayZone("Mars/Olympe", [z("Pas/UnFuseau")]), "UTC");
  assert.equal(displayZone("", []), "UTC");
  assert.equal(displayZone("", [z("Europe/Paris"), z("Asia/Tokyo")]), "Europe/Paris", "à égalité, le premier");
});

test("page : sans réglage, l'intitulé « heure … » et les heures suivent le fuseau des agendas ; avec le réglage, c'est lui", async () => {
  const sources = [[item("a", 2, { timezone: "Europe/Paris" })]];
  const auto = await def.page(planning({ sources }).ctx);
  assert.match(auto.blocks[0].text, /\(?Europe\/Paris\)?|Europe\/Paris/);
  const forced = await def.page(planning({ sources, settings: { timezone: "America/Montreal" } }).ctx);
  assert.match(forced.blocks[0].text, /America\/Montreal/);
  assert.ok(!def.page.toString().includes("icsUrl"));
});

test("aucun agenda : rien d'affiché à la place des streams, jamais d'erreur ; le visiteur voit « pas de stream planifié », l'administration explique quoi faire (FR et EN)", async () => {
  for (const locale of ["fr", "en"]) {
    const en = JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/en.json", import.meta.url), "utf8"));
    const { ctx } = planning({ sources: [], locale, over: { messages: locale === "fr" ? fr : en } });
    const card = (await def.sections.next(ctx, {}))[1].html;
    assert.match(card, /cpl-empty-t">/);
    assert.ok(card.includes((locale === "fr" ? fr : en).noStream.replace(/'/g, "&#39;")));
    const admin = await def.adminPanel(ctx);
    const msg = admin.find((b) => b.type === "markdown").text;
    assert.equal(msg, (locale === "fr" ? fr : en).adminNoSlots);
    assert.match(msg, locale === "fr" ? /Agenda en ligne.*Streams saisis à la main/ : /Online calendar.*Hand-written streams/);
    assert.match(msg, /\/admin\/extensions/, "un lien vers les extensions");
    assert.deepEqual(await def.mcp.planning_upcoming(ctx, {}), []);
  }
});

test("le sujet demandé est borné : 200 créneaux au plus, période toujours valide pour le cœur (même 60 jours, même semaine 8 de l'image)", async () => {
  const { ctx, seen } = planning({ sources: [[item("a", 3)]], settings: { days: 500 } });
  await def.page(ctx);
  await def.routes.image(new Request("https://x.test/m/planning/image?week=8"), ctx);
  assert.ok(seen.length >= 2 && seen.every((o) => o.limit === 200));
  for (const o of seen) assert.ok((o.to - o.from) / 86_400_000 <= 400 && o.from < o.to, JSON.stringify(o));
});

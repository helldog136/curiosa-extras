import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const mod = await import("../modules/planning/index.mjs");
const def = mod.default;
const URL_OK = "https://calendar.example.com/ical/secret-token/basic.ics";

const ics = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const hours = (n) => new Date(Date.now() + n * 3_600_000);
const vevent = (uid, start, end, summary, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${ics(start)}`, `DTEND:${ics(end)}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"].join("\r\n");
const calendar = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;

const messages = { nextUp: "Prochain stream", daysTitle: "Cette semaine", noneToday: "—", title: "Planning", intro: "Prochains {days} jours ({tz})", none: "Rien", notConfigured: "Pas configuré", nextTitle: "Prochains streams", allDay: "Toute la journée",
  adminStatus: "État", adminNotSet: "Adresse absente", badUrl: "Adresse refusée", adminHint: "…{hint}", adminError: "Illisible", adminOk: "{n} sur {days} jours", adminNext: "À venir", refresh: "Rafraîchir", refreshed: "Rafraîchi",
  date: "Date", time: "Heure", slot: "Créneau", games: "Jeux" };
const ctxWith = (settings = {}, over = {}) => fakeCtx({ settings: { icsUrl: URL_OK, days: 7, timezone: "UTC", ...settings }, messages, locale: "fr", ...over });

const realFetch = globalThis.fetch;
let fetched;
const serve = (body, status = 200) => { fetched = []; globalThis.fetch = async (u) => { fetched.push(String(u)); return new Response(body, { status }); }; };
beforeEach(() => { mod.clearIcsCache(); fetched = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("section « prochains streams » : lignes triées, jeux en italique, limitée au nombre demandé", async () => {
  serve(calendar(
    vevent("1", hours(5), hours(6), "Premier", ["DESCRIPTION:Jeu: Zelda\\, Mario"]),
    vevent("2", hours(30), hours(31), "Deuxième"),
    vevent("3", hours(50), hours(51), "Troisième"),
  ));
  const blocks = await def.sections.upcoming(ctxWith(), { count: 2 });
  assert.equal(blocks[0].type, "heading");
  const lines = blocks[1].text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Premier/);
  assert.match(lines[0], /_Zelda, Mario_/);
  assert.match(lines[1], /Deuxième/);
});

test("section : rien à afficher → aucun bloc (la section disparaît de l'accueil), adresse absente ou refusée aussi", async () => {
  serve(calendar());
  assert.equal(await def.sections.upcoming(ctxWith(), {}), null);
  assert.equal(await def.sections.upcoming(ctxWith({ icsUrl: "" }), {}), null);
  for (const bad of ["http://calendar.example.com/x.ics", "https://127.0.0.1/x.ics", "https://localhost/x.ics"]) {
    fetched = []; serve(calendar(vevent("1", hours(2), hours(3), "X")));
    assert.equal(await def.sections.upcoming(ctxWith({ icsUrl: bad }), {}), null, bad);
    assert.deepEqual(fetched, [], "aucun appel réseau vers une adresse refusée");
  }
});

test("section : le nombre demandé est borné entre 1 et 20, valeur absurde → 5", async () => {
  serve(calendar(...Array.from({ length: 30 }, (_, i) => vevent(String(i), hours(i + 1), hours(i + 2), `S${i}`))));
  const n = async (count) => (await def.sections.upcoming(ctxWith(), { count }))[1].text.split("\n").length;
  assert.equal(await n(999), 20);
  assert.equal(await n(0), 5);
  assert.equal(await n("abc"), 5);
  assert.equal(await n(1), 1);
});

test("section : les titres d'événements ne peuvent pas injecter de mise en forme ni de balises", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "<script>alert(1)</script> **gras** [x](javascript:y)")));
  const text = (await def.sections.upcoming(ctxWith(), {}))[1].text;
  assert.ok(!text.includes("<script>"), text);
  assert.ok(text.includes("\\<script\\>"));
  assert.ok(text.includes("\\*\\*gras\\*\\*"));
  assert.ok(!/(^|[^\\])\]\(/.test(text), "aucun lien Markdown actif : " + text);
});

test("section : un événement déjà terminé n'apparaît pas, un événement en cours si", async () => {
  serve(calendar(vevent("old", hours(-5), hours(-4), "Terminé"), vevent("now", hours(-1), hours(1), "EnCours")));
  const text = (await def.sections.upcoming(ctxWith(), {}))[1].text;
  assert.ok(text.includes("EnCours") && !text.includes("Terminé"));
});

test("page : non configurée → message, calendrier illisible → message, jamais d'exception", async () => {
  const page = await def.page(ctxWith({ icsUrl: "" }));
  assert.deepEqual(page.blocks, [{ type: "markdown", text: "Pas configuré" }]);
  serve("<html>erreur</html>");
  assert.deepEqual((await def.page(ctxWith())).blocks, [{ type: "markdown", text: "Pas configuré" }]);
  serve("nope", 500);
  mod.clearIcsCache();
  assert.equal((await def.page(ctxWith())).title, "Planning");
});

test("page : un bloc par jour (titre + liste), « Rien » pour les jours vides, nombre de jours borné", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "Dans deux heures")));
  const page = await def.page(ctxWith({ days: 3 }));
  assert.match(page.blocks[0].text, /Prochains 3 jours \(UTC\)/);
  const headings = page.blocks.filter((b) => b.type === "heading");
  assert.equal(headings.length, 3);
  assert.ok(page.blocks.some((b) => b.type === "markdown" && b.text === "*Rien*"));
  assert.ok(page.blocks.some((b) => b.type === "markdown" && b.text.includes("Dans deux heures")));
  assert.equal((await def.page(ctxWith({ days: 500 }))).blocks.filter((b) => b.type === "heading").length, 60);
  assert.equal((await def.page(ctxWith({ days: -3 }))).blocks.filter((b) => b.type === "heading").length, 1, "valeur négative → au moins 1 jour");
  assert.equal((await def.page(ctxWith({ days: "abc" }))).blocks.filter((b) => b.type === "heading").length, 7, "valeur absurde → 7 jours");
});

test("page : un fuseau invalide retombe sur UTC sans casser", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "X")));
  const page = await def.page(ctxWith({ timezone: "Mars/Olympus" }));
  assert.match(page.blocks[0].text, /UTC/);
});

test("export « planning.slot » : éléments au format attendu, limite respectée", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "A", ["DESCRIPTION:Jeu: Doom"]), vevent("2", hours(4), hours(5), "B"), vevent("3", hours(6), hours(7), "C")));
  const items = await def.exports["planning.slot"](ctxWith(), { locale: "fr", limit: 2, tags: [] });
  assert.equal(items.length, 2);
  assert.deepEqual(Object.keys(items[0]).sort(), ["allDay", "end", "games", "start", "text", "title"]);
  assert.equal(items[0].text, "Doom");
  assert.equal(items[1].text, undefined);
  assert.ok(!Number.isNaN(Date.parse(items[0].start)));
  assert.deepEqual(await def.exports["planning.slot"](ctxWith({ icsUrl: "" }), { locale: "fr", limit: 5, tags: [] }), []);
});

test("export « planning.slot » : conforme au schéma déclaré par un consommateur (titre texte, dates texte)", async () => {
  const { conform } = await import("@/core/services/topics");
  serve(calendar(vevent("1", hours(2), hours(3), "A")));
  const [item] = await def.exports["planning.slot"](ctxWith(), { locale: "fr", limit: 5, tags: [] });
  const schema = [{ key: "title", type: "string", required: true }, { key: "start", type: "string" }, { key: "end", type: "string" }, { key: "allDay", type: "boolean" }];
  assert.ok(conform(item, schema));
});

test("MCP planning_upcoming : renvoie les créneaux, erreur lisible si le calendrier n'est pas utilisable, jours bornés", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "A"), vevent("2", hours(24 * 20), hours(24 * 20 + 1), "Loin")));
  const out = await def.mcp.planning_upcoming(ctxWith(), {});
  assert.deepEqual(out.map((s) => s.title), ["A"], "7 jours par défaut");
  assert.deepEqual((await def.mcp.planning_upcoming(ctxWith(), { days: 30 })).map((s) => s.title), ["A", "Loin"]);
  await assert.rejects(() => def.mcp.planning_upcoming(ctxWith({ icsUrl: "" }), {}), (e) => e.expose === true && /not configured/.test(e.message));
});

test("MCP : ne révèle jamais l'adresse secrète du calendrier", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "A")));
  const out = JSON.stringify(await def.mcp.planning_upcoming(ctxWith(), {}));
  assert.ok(!out.includes("secret-token"));
  const panel = JSON.stringify(await def.adminPanel(ctxWith()));
  assert.ok(!panel.includes("secret-token"), "l'admin n'affiche qu'un indice de la fin de l'adresse");
});

test("admin : état selon la configuration, tableau des prochains créneaux, bouton de rafraîchissement", async () => {
  assert.match((await def.adminPanel(ctxWith({ icsUrl: "" })))[1].text, /absente/);
  assert.match((await def.adminPanel(ctxWith({ icsUrl: "http://x.test/a.ics" })))[1].text, /refusée/);
  serve("<html>");
  const broken = await def.adminPanel(ctxWith());
  assert.ok(broken.some((b) => b.type === "markdown" && /Illisible/.test(b.text)));
  assert.ok(broken.some((b) => b.type === "adminForm" && b.action === "refresh"));
  mod.clearIcsCache();
  serve(calendar(vevent("1", hours(2), hours(3), "A", ["DESCRIPTION:Jeu: Zelda"])));
  const ok = await def.adminPanel(ctxWith());
  const table = ok.find((b) => b.type === "table");
  assert.equal(table.rows.length, 1);
  assert.deepEqual([table.rows[0][2], table.rows[0][3]], ["A", "Zelda"]);
  assert.ok(ok.some((b) => b.type === "adminForm" && b.action === "refresh"));
});

test("admin : « rafraîchir » vide le cache et le prochain affichage recharge l'adresse", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "Ancien")));
  await def.sections.upcoming(ctxWith(), {});
  await def.sections.upcoming(ctxWith(), {});
  assert.equal(fetched.length, 1, "mis en cache");
  assert.deepEqual(await def.adminActions.refresh(ctxWith(), {}), { ok: "Rafraîchi" });
  serve(calendar(vevent("1", hours(2), hours(3), "Nouveau")));
  assert.match((await def.sections.upcoming(ctxWith(), {}))[1].text, /Nouveau/);
});

test("déclarations : tout ce que le manifeste annonce est implémenté, et réciproquement", async () => {
  const fs = await import("node:fs");
  const { parseManifest } = await import("@/core/modules/manifest");
  const raw = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const parsed = parseManifest(raw);
  assert.ok(parsed.ok, parsed.error);
  const m = parsed.manifest;
  assert.deepEqual(m.sections.map((s) => s.id).sort(), Object.keys(def.sections).sort());
  assert.deepEqual(m.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(m.provides.map((p) => p.topic).sort(), Object.keys(def.exports).sort());
  assert.equal(typeof def.page, "function");
  assert.equal(typeof def.adminPanel, "function");
  for (const lang of ["en", "fr"]) {
    const dict = JSON.parse(fs.readFileSync(new URL(`../modules/planning/locales/${lang}.json`, import.meta.url), "utf8"));
    for (const k of Object.keys(messages)) assert.ok(k in dict, `${lang}: clé « ${k} » manquante`);
  }
  const en = Object.keys(JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/en.json", import.meta.url), "utf8"))).sort();
  const fr = Object.keys(JSON.parse(fs.readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8"))).sort();
  assert.deepEqual(en, fr);
  const settingKeys = new Set(m.settings.map((s) => s.key));
  for (const k of ["icsUrl", "days", "timezone"]) assert.ok(settingKeys.has(k), k);
});

test("morceau « prochain stream » : le premier créneau à venir, rien s'il n'y en a pas", async () => {
  serve(calendar(vevent("1", hours(30), hours(31), "Plus tard"), vevent("2", hours(3), hours(4), "Bientôt", ["DESCRIPTION:Jeu: Zelda"])));
  const blocks = await def.sections.next(ctxWith(), {});
  assert.equal(blocks[0].type, "heading");
  assert.match(blocks[1].text, /Bientôt/);
  assert.match(blocks[1].text, /_Zelda_/);
  assert.ok(!blocks[1].text.includes("Plus tard"));
  serve(calendar());
  mod.clearIcsCache();
  assert.equal(await def.sections.next(ctxWith(), {}), null);
  assert.equal(await def.sections.next(ctxWith({ icsUrl: "" }), {}), null);
});

test("morceau « prochains jours » : un jour par ligne, nombre de jours borné de 1 à 7, jours vides signalés", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "Aujourd'hui peut-être")));
  const lines = async (count, settings) => (await def.sections.days(ctxWith(settings), { count }))[1].text.split("\n");
  assert.equal((await lines(3)).length, 3);
  assert.equal((await lines(99)).length, 7);
  assert.equal((await lines(0)).length, 3, "valeur absurde → 3");
  assert.equal((await lines(1)).length, 1);
  assert.ok((await lines(7)).some((l) => l.endsWith("· —")), "jour sans stream");
  assert.ok((await lines(7)).join("\n").includes("peut-être"), "le stream apparaît dans son jour");
  assert.equal(await def.sections.days(ctxWith({ icsUrl: "" }), {}), null);
});

test("morceaux du planning : tailles naturelles recommandées pour l'accueil fluide", async () => {
  const fs = await import("node:fs");
  const m = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const size = Object.fromEntries(m.sections.map((s) => [s.id, s.size]));
  assert.deepEqual([size.next, size.days, size.upcoming], ["small", "medium", "large"]);
});

test("image PNG de la semaine : route qui passe par ctx.api.png, créneaux de la semaine, titres tronqués, cache 5 min, 404 sans calendrier", async () => {
  const today = new Date(); today.setUTCHours(10, 0, 0, 0);
  serve(calendar(vevent("1", today, new Date(today.getTime() + 3_600_000), "Soirée " + "x".repeat(200), ["DESCRIPTION:Jeu: Zelda"])));
  const c = ctxWith({}, { messages: { ...messages, imageTitle: "Planning", imageEmpty: "Rien", imageEmptyHint: "Bientôt" } });
  const res = await def.routes.image(new Request("https://x.test/m/planning/image"), c);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), "public, max-age=300");
  const spec = c.calls.png[0];
  assert.equal(spec.width, 900);
  const flat = JSON.stringify(spec.tree);
  assert.ok(flat.includes("Soirée"), "le créneau du jour est dans l'image");
  assert.ok(!flat.includes("x".repeat(100)), "titre tronqué");
  assert.equal(spec.tree.props.children[0].props.children[0].props.children[0].props.children[0], "Planning");
  // sans calendrier : 404, aucun rendu
  const none = ctxWith({ icsUrl: "" });
  assert.equal((await def.routes.image(new Request("https://x.test/m/planning/image"), none)).status, 404);
  assert.equal(none.calls.png.length, 0);
  // semaine vide : l'état vide (une seule boîte « Rien de prévu »)
  serve(calendar());
  const empty = ctxWith({}, { messages: { ...messages, imageTitle: "Planning", imageEmpty: "Rien", imageEmptyHint: "Bientôt" } });
  await def.routes.image(new Request("https://x.test/m/planning/image?week=2"), empty);
  assert.ok(JSON.stringify(empty.calls.png[0].tree).includes("Bientôt"));
});

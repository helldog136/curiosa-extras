// Planning : affichage des streams reçus du sujet `planning.slot` (page, morceaux d'accueil, image, MCP, admin). Les créneaux viennent de VRAIS fournisseurs
// (l'Agenda en ligne lit un agenda iCal fabriqué ici, sans réseau) : le Planning ne sait pas d'où ils viennent. Horloge simulée : aucun test ne dépend de l'heure du jour.
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { vevent, calendar, feedTopics } from "./helpers/icalFeed.mjs";

mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-14T10:00:00Z") });   // mercredi 14 octobre 2026, 10:00 UTC
after(() => mock.timers.reset());

const mod = await import("../modules/planning/index.mjs");
const def = mod.default;

const hours = (n) => new Date(Date.now() + n * 3_600_000);

const messages = { nextUp: "Prochain stream", daysTitle: "Cette semaine", noneToday: "—", title: "Planning", intro: "Prochains {days} jours ({tz})", none: "Rien", nextTitle: "Prochains streams", allDay: "Toute la journée",
  adminStatus: "État", adminNoSlots: "Rien à afficher", adminOk: "{n} sur {days} jours", adminNext: "À venir",
  date: "Date", time: "Heure", slot: "Créneau", games: "Jeux" };
const rows = (html) => html.split("<li ").slice(1);

let feed = "";   // l'agenda iCal « en ligne » du moment (texte)
const serve = (body) => { feed = body; };
const ctxWith = (settings = {}, over = {}) => fakeCtx({ settings: { days: 7, timezone: "UTC", ...settings }, topics: feedTopics(() => feed), messages, locale: "fr", rawgConfigured: false, ...over });
/** Même contexte, avec en plus le sujet `social.link` (le lien des réseaux, fourni par la Chaîne Twitch). */
const withSocial = (ctx, items) => { const orig = ctx.api.topics.collect; ctx.api.topics.collect = async (topic, o) => (topic === "social.link" ? (typeof items === "function" ? items() : items) : orig(topic, o)); return ctx; };

test("section « prochains streams » : lignes triées, jeux nommés, limitée au nombre demandé", async () => {
  serve(calendar(
    vevent("1", hours(5), hours(6), "Premier", ["DESCRIPTION:Jeu: Zelda\\, Mario"]),
    vevent("2", hours(30), hours(31), "Deuxième"),
    vevent("3", hours(50), hours(51), "Troisième"),
  ));
  const blocks = await def.sections.upcoming(ctxWith(), { count: 2 });
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[1].type, "html");
  const lines = rows(blocks[1].html);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Premier/);
  assert.match(lines[0], /Zelda, Mario/);
  assert.match(lines[1], /Deuxième/);
});

test("section : aucun stream (agenda vide, ou pas d'agenda du tout) → carte « pas de stream planifié », jamais d'erreur ni de bloc cassé", async () => {
  serve(calendar());
  const empty = await def.sections.upcoming(ctxWith(), {});
  assert.equal(empty[1].type, "html");
  assert.match(empty[1].html, /noStream/);
  serve("");   // pas d'agenda, ou agenda illisible : le planning ne le sait pas et n'a pas à le savoir
  assert.match((await def.sections.upcoming(ctxWith(), {}))[1].html, /noStream/);
  assert.match((await def.sections.next(ctxWith(), {}))[1].html, /noStream/);
});

test("section : le nombre demandé est borné entre 1 et 20, valeur absurde → 5", async () => {
  serve(calendar(...Array.from({ length: 30 }, (_, i) => vevent(String(i), hours(i + 1), hours(i + 2), `S${i}`))));
  const n = async (count) => rows((await def.sections.upcoming(ctxWith(), { count }))[1].html).length;
  assert.equal(await n(999), 20);
  assert.equal(await n(0), 5);
  assert.equal(await n("abc"), 5);
  assert.equal(await n(1), 1);
});

test("section : les titres d'événements ne peuvent pas injecter de mise en forme ni de balises", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "<script>alert(1)</script> **gras** [x](javascript:y)")));
  const html = (await def.sections.upcoming(ctxWith(), {}))[1].html;
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("section : un événement déjà terminé n'apparaît pas, un événement en cours si", async () => {
  serve(calendar(vevent("old", hours(-5), hours(-4), "Terminé"), vevent("now", hours(-1), hours(1), "EnCours")));
  const text = (await def.sections.upcoming(ctxWith(), {}))[1].html;
  assert.ok(text.includes("EnCours") && !text.includes("Terminé"));
  assert.match(text, /relLive/, "indication « en cours »");
});

test("page : sans stream (agenda vide ou absent) → une page normale, « Rien » chaque jour, jamais d'exception", async () => {
  for (const body of ["", "<html>erreur</html>", calendar()]) {
    serve(body);
    const page = await def.page(ctxWith({ days: 2 }));
    assert.equal(page.title, "Planning");
    assert.equal(page.blocks.filter((b) => b.type === "heading").length, 2);
    assert.equal(page.blocks.filter((b) => b.type === "markdown" && b.text === "*Rien*").length, 2);
  }
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

test("le Planning ne fournit plus `planning.slot` : il le LIT (le fournisseur est un agenda), et le schéma qu'il déclare accepte les créneaux des fournisseurs", async () => {
  const fs = await import("node:fs");
  const { conform } = await import("@/core/services/topics");
  const raw = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  assert.equal(raw.provides, undefined);
  assert.equal(def.exports, undefined);
  const schema = raw.consumes.find((c) => c.topic === "planning.slot").schema;
  serve(calendar(vevent("1", hours(2), hours(3), "A", ["DESCRIPTION:Jeu: Doom"]), "BEGIN:VEVENT\r\nUID:j\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\nSUMMARY:Journée\r\nEND:VEVENT"));
  const items = feedTopics(() => feed)["planning.slot"]({ limit: 50 });
  assert.equal(items.length, 2);
  for (const item of items) assert.ok(conform(item, schema), JSON.stringify(item));
});

test("MCP planning_upcoming : renvoie les créneaux (jours bornés), une liste vide sans agenda — jamais d'erreur", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "A", ["DESCRIPTION:Jeu: Doom"]), vevent("2", hours(24 * 20), hours(24 * 20 + 1), "Loin")));
  const out = await def.mcp.planning_upcoming(ctxWith(), {});
  assert.deepEqual(out.map((s) => [s.title, s.games]), [["A", ["Doom"]]], "7 jours par défaut");
  assert.deepEqual((await def.mcp.planning_upcoming(ctxWith(), { days: 30 })).map((s) => s.title), ["A", "Loin"]);
  assert.deepEqual(Object.keys(out[0]).sort(), ["allDay", "end", "games", "start", "title"]);
  serve("");
  assert.deepEqual(await def.mcp.planning_upcoming(ctxWith(), {}), []);
});

test("MCP et admin : rien de secret n'est connu du Planning (l'adresse d'un agenda reste dans l'Agenda en ligne)", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "A")));
  const out = JSON.stringify(await def.mcp.planning_upcoming(ctxWith(), {})) + JSON.stringify(await def.adminPanel(ctxWith()));
  assert.ok(!/https?:\/\/[^"]*\.ics|secret|token/i.test(out));
});

test("admin : sans stream → dit quoi faire (installer et régler un agenda) ; avec des streams → tableau des prochains créneaux ; plus aucun bouton « Actualiser »", async () => {
  serve("");
  const none = await def.adminPanel(ctxWith());
  assert.match(none[1].text, /Rien à afficher/);
  assert.ok(!none.some((b) => b.type === "adminForm"));
  const fr = (await import("node:fs")).readFileSync(new URL("../modules/planning/locales/fr.json", import.meta.url), "utf8");
  const msg = JSON.parse(fr).adminNoSlots;
  assert.match(msg, /Agenda en ligne/); assert.match(msg, /Streams saisis à la main/); assert.match(msg, /\(\/admin\/extensions\)/);
  serve(calendar(vevent("1", hours(2), hours(3), "A", ["DESCRIPTION:Jeu: Zelda"])));
  const ok = await def.adminPanel(ctxWith());
  const table = ok.find((b) => b.type === "table");
  assert.equal(table.rows.length, 1);
  assert.deepEqual([table.rows[0][2], table.rows[0][3]], ["A", "Zelda"]);
  assert.ok(!ok.some((b) => b.type === "adminForm" && b.action === "refresh"));
  assert.equal(def.adminActions, undefined);
});

test("déclarations : tout ce que le manifeste annonce est implémenté, et réciproquement ; le Planning lit le sujet sans le fournir ni dépendre d'un module", async () => {
  const fs = await import("node:fs");
  const { parseManifest } = await import("@/core/modules/manifest");
  const raw = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const parsed = parseManifest(raw);
  assert.ok(parsed.ok, parsed.error);
  const m = parsed.manifest;
  assert.deepEqual(m.sections.map((s) => s.id).sort(), Object.keys(def.sections).sort());
  assert.deepEqual(m.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(m.provides, [], "il ne fournit plus planning.slot");
  assert.ok(m.consumes.some((c) => c.topic === "planning.slot"));
  assert.deepEqual((m.requires ?? []).filter((r) => !r.optional), [], "aucune dépendance forte : sans agenda, il affiche « pas de stream planifié »");
  assert.deepEqual(m.seeds.map((x) => x.module), ["calendar-ical"]);
  assert.equal(m.dataVersion, 3); assert.deepEqual(Object.keys(def.migrations), ["2", "3"]);
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
  for (const k of ["days", "timezone", "channelUrl"]) assert.ok(settingKeys.has(k), k);
  assert.ok(!settingKeys.has("icsUrl"), "l'adresse d'avant n'est plus un réglage : elle est dans legacySettings, jamais affichée (à retirer en 0.3.0)");
  assert.equal(m.settings.find((s) => s.key === "channelUrl").optional, true);
  assert.equal(m.settings.find((s) => s.key === "timezone").default, undefined, "sans réglage, le fuseau des agendas est utilisé");
});
test("morceau « prochain stream » : le premier créneau à venir, carte vide s'il n'y en a pas (agenda vide ou absent)", async () => {
  serve(calendar(vevent("1", hours(30), hours(31), "Plus tard"), vevent("2", hours(3), hours(4), "Bientôt", ["DESCRIPTION:Jeu: Zelda"])));
  const blocks = await def.sections.next(ctxWith(), {});
  assert.equal(blocks[0].type, "heading");
  assert.match(blocks[1].html, /Bientôt/);
  assert.match(blocks[1].html, /Zelda/);
  assert.ok(!blocks[1].html.includes("Plus tard"));
  serve(calendar());
  assert.match((await def.sections.next(ctxWith(), {}))[1].html, /noStream/);
  serve("");
  assert.match((await def.sections.next(ctxWith(), {}))[1].html, /noStream/);
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
  serve("");
  assert.ok((await lines(2)).every((l) => l.endsWith("· —")), "sans agenda : des jours vides, jamais d'erreur");
});

test("morceaux du planning : tailles naturelles recommandées pour l'accueil fluide", async () => {
  const fs = await import("node:fs");
  const m = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  const size = Object.fromEntries(m.sections.map((s) => [s.id, s.size]));
  assert.deepEqual([size.next, size.days, size.upcoming], ["small", "medium", "large"]);
});

test("image PNG de la semaine : route qui passe par ctx.api.png, créneaux de la semaine, titres tronqués, cache 5 min, jamais d'image cassée sans agenda", async () => {
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
  // sans agenda (ou agenda vide) : l'état vide « rien de prévu », jamais une image cassée dans un panneau Twitch
  serve("");
  const none = ctxWith({}, { messages: { ...messages, imageTitle: "Planning", imageEmpty: "Rien", imageEmptyHint: "Bientôt" } });
  assert.equal((await def.routes.image(new Request("https://x.test/m/planning/image"), none)).status, 200);
  assert.ok(JSON.stringify(none.calls.png[0].tree).includes("Bientôt"));
  // l'état du cœur qui échoue (sujet indisponible) : 404 propre, aucun rendu
  const broken = ctxWith(); broken.api.topics.collect = async () => { throw new Error("boum"); };
  assert.equal((await def.routes.image(new Request("https://x.test/m/planning/image"), broken)).status, 404);
  assert.equal(broken.calls.png.length, 0);
  serve(calendar());
  const empty = ctxWith({}, { messages: { ...messages, imageTitle: "Planning", imageEmpty: "Rien", imageEmptyHint: "Bientôt" } });
  await def.routes.image(new Request("https://x.test/m/planning/image?week=2"), empty);
  assert.ok(JSON.stringify(empty.calls.png[0].tree).includes("Bientôt"));
});

/* ───────────── Cartes de l'accueil : « prochain stream » et « prochains streams » ───────────── */

const COVER = "https://media.example.test/celeste.jpg";
const withCovers = (over = {}) => ctxWith({}, { rawgConfigured: true, rawgCover: { status: "found", url: COVER }, ...over });
const next = async (ctx, ...ev) => { serve(calendar(...ev)); return (await def.sections.next(ctx, {}))[1].html; };

test("carte « prochain stream » : article encadré, <time> sémantiques, titre, heure, jeu, indication relative", async () => {
  const html = await next(ctxWith(), vevent("1", hours(3.5), hours(5), "Cap48h", ["DESCRIPTION:Jeu: Zelda"]));
  assert.match(html, /<article class="cpl-card">/);
  assert.equal((html.match(/<time /g) ?? []).length, 1);
  assert.match(html, /<time class="cpl-hour" datetime="\d{4}-\d\d-\d\dT[\d:.]+Z">\d\d:\d\d<\/time>/);
  assert.match(html, /<h3 class="cpl-title">Cap48h<\/h3>/);
  assert.match(html, /cpl-games">gamesLabel Zelda</);
  assert.match(html, /cpl-badge">rel(Hours|Tomorrow)</, "« dans 3 h », ou « demain » quand l'événement passe minuit : le test ne dépend plus de l'heure d'exécution");
  assert.ok(!html.includes("<img"), "sans jaquette : aucune image");
  assert.ok(!html.includes("cpl-btn\""), "sans lien de chaîne : pas de bouton");
});

test("carte « prochain stream » : avec jaquette (alt lisible, dimensions, chargement différé), sans jaquette si RAWG ne répond pas", async () => {
  const ev = vevent("1", hours(2), hours(3), "Soirée", ["DESCRIPTION:Jeu: Celeste"]);
  const html = await next(withCovers(), ev);
  assert.match(html, new RegExp(`<img src="${COVER.replace(/\./g, "\\.")}" alt="coverAlt" loading="lazy" width="120" height="160">`));
  const none = await next(withCovers({ rawgCover: { status: "none", url: null } }), ev);
  assert.ok(!none.includes("<img") && /cpl-games/.test(none));
});

test("carte « prochain stream » : bouton vers la chaîne seulement avec une adresse https valide", async () => {
  const ev = vevent("1", hours(2), hours(3), "X");
  const ok = await next(ctxWith({ channelUrl: "https://twitch.tv/helldog136" }), ev);
  assert.match(ok, /<a class="cpl-btn" href="https:\/\/twitch\.tv\/helldog136" target="_blank" rel="noopener noreferrer">watch<\/a>/);
  for (const bad of ["javascript:alert(1)", "http://twitch.tv/x", "https://x.tv/a\"onmouseover=\"y", ""]) assert.ok(!(await next(ctxWith({ channelUrl: bad }), ev)).includes("cpl-btn\""), bad);
});

test("carte « prochain stream » : plusieurs streams le même jour → les autres listés dans la carte, un autre jour → absent", async () => {
  // Les deux premiers streams doivent tomber le MÊME jour (UTC) quelle que soit l'heure du test : on part de midi, au moins 2 h plus tard.
  const noon = new Date(); noon.setUTCHours(12, 0, 0, 0); if (noon.getTime() - Date.now() < 2 * 3_600_000) noon.setUTCDate(noon.getUTCDate() + 1);
  const at = (h) => new Date(noon.getTime() + h * 3_600_000);
  const html = await next(ctxWith(), vevent("1", at(0), at(1), "Premier"), vevent("2", at(0.5), at(1.5), "Deuxieme"), vevent("3", at(80), at(81), "Lointain"));
  assert.match(html, /cpl-also">alsoToday <time[^>]*>[\d:]+<\/time> Deuxieme</);
  assert.ok(!html.includes("Lointain"));
});

test("carte : échappement HTML des titres, jeux, et adresses — aucune injection", async () => {
  const evil = '<img src=x onerror=alert(1)> "q" \'s\' &amp;';
  const ev = vevent("1", hours(2), hours(3), evil, [`DESCRIPTION:Jeu: <b>Jeu</b> "x"`]);
  for (const html of [await next(withCovers({ rawgCover: { status: "found", url: 'https://x.test/a.jpg" onerror="alert(1)' } }), ev), (await (async () => { serve(calendar(ev)); return (await def.sections.upcoming(withCovers(), {}))[1].html; })())]) {
    assert.ok(!/<img src=x/.test(html) && !html.includes("<b>Jeu</b>"), html);
    assert.ok(!/ onerror="/.test(html.replace(/&quot;/g, "")), html);
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &#39;s&#39; &amp;amp;"));
  }
});

test("carte : états vides — calendrier vide : carte soignée avec lien vers le planning ; sans page publique : pas de lien", async () => {
  serve(calendar());
  const withPage = (await def.sections.next(ctxWith({}, { basePath: "planning" }), {}))[1].html;
  assert.match(withPage, /cpl-empty-t">noStream</);
  assert.match(withPage, /<a class="cpl-link" href="\/planning">fullPlanning<\/a>/);
  const noPage = (await def.sections.upcoming(ctxWith({}, { basePath: null }), {}))[1].html;
  assert.match(noPage, /noStream/);
  assert.ok(!noPage.includes("<a "));
});

test("carte « prochains streams » : une ligne par stream avec tuile de jour, <time>, jaquette, indications relatives", async () => {
  serve(calendar(vevent("1", hours(1), hours(2), "A", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", hours(1.2), hours(2), "B"), vevent("3", hours(30), hours(31), "C")));
  const html = (await def.sections.upcoming(withCovers(), { count: 5 }))[1].html;
  const list = rows(html);
  assert.equal(list.length, 3);
  assert.match(list[0], /cpl-tile" datetime="[^"]+"><span class="cpl-tw">[^<]+<\/span><span class="cpl-td">\d+<\/span>/);
  assert.match(list[0], /<img class="cpl-thumb"[^>]+alt="coverAlt"/);
  assert.ok(!list[1].includes("<img"), "un stream sans jeu n'a pas de jaquette");
  assert.match(list[0], /cpl-badge">rel(Hours?|Minutes|Today|Tomorrow)</, "dans 1 h, ou « aujourd'hui » / « demain » quand le stream passe minuit : le test ne dépend pas de l'heure d'exécution");
  assert.match(html, /<a class="cpl-link" href="\/fake">fullPlanning<\/a>/);
});

test("indications relatives : en cours, dans X min / h, aujourd'hui, demain, dans N jours, rien au-delà d'une semaine", () => {
  const t = (k, v) => (v ? `${k}:${v.n}` : k);
  const now = new Date("2026-10-10T10:00:00Z");
  const slot = (startH, endH, extra = {}) => ({ start: new Date(now.getTime() + startH * 3_600_000), end: new Date(now.getTime() + endH * 3_600_000), allDay: false, ...extra });
  const rel = (s) => mod.relativeLabel(s, now, "UTC", t);
  assert.equal(rel(slot(-1, 1)), "relLive");
  assert.equal(rel(slot(0.5, 2)), "relMinutes:30");
  assert.equal(rel(slot(3, 4)), "relHours:3");
  assert.equal(rel(slot(13, 14)), "relToday");
  assert.equal(rel(slot(15, 16)), "relTomorrow");
  assert.equal(rel(slot(24 * 4 + 1, 24 * 4 + 2)), "relDays:4");
  assert.equal(rel(slot(24 * 9, 24 * 9 + 1)), null);
  assert.equal(rel(slot(13, 14, { allDay: true })), "relToday");
  assert.equal(mod.relativeLabel(slot(15, 16), now, "Pacific/Auckland", t), "relTomorrow", "le jour se compte dans le fuseau du site");
});

test("carte : aucune couleur codée en dur (hors secours de var()), tout passe par les variables de thème, pas d'animation sans prefers-reduced-motion", async () => {
  const html = await next(withCovers(), vevent("1", hours(2), hours(3), "X", ["DESCRIPTION:Jeu: Celeste"]));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const themed = css.replace(/\.cpl-ph\{[^}]*\}/, "");   // seul le visuel de repli (mauve Twitch, couleur de marque fixe) a des couleurs propres
  const noFallbacks = themed.replace(/var\((--v-[\w-]+),[^()]*(?:\([^()]*\)[^()]*)*\)/g, "var($1)");
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(noFallbacks), "couleur en dur : " + noFallbacks.match(/#[0-9a-f]{3,8}\b/i));
  assert.ok(!/\brgba?\(|\bhsla?\(/i.test(css));
  assert.match(css.match(/\.cpl-ph\{[^}]*\}/)[0], /#9146ff/i, "mauve Twitch du repli");
  for (const v of ["--v-surface", "--v-line", "--v-fg", "--v-muted", "--v-accent", "--v-accent-fg", "--v-gradient", "--v-accent2", "--v-accent2-fg"]) assert.ok(css.includes(`var(${v}`), v);
  assert.match(css, /\[data-accent2\] \.cpl-btn/);
  assert.ok(!/style="[^"]*#[0-9a-f]{3,8}/i.test(html), "aucun style en ligne coloré en dur");
  if (/transition|animation/.test(css)) assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{[^}]*(transition|animation)/);
  assert.ok(!/animation/.test(css));
});

test("carte : le texte est celui de la langue courante (clés du module) et les deux langues ont les nouvelles clés", async () => {
  const fs = await import("node:fs");
  for (const lang of ["en", "fr"]) {
    const dict = JSON.parse(fs.readFileSync(new URL(`../modules/planning/locales/${lang}.json`, import.meta.url), "utf8"));
    for (const k of ["relLive", "relToday", "relTomorrow", "relHours", "relMinutes", "relDays", "coverAlt", "gamesLabel", "alsoToday", "watch", "fullPlanning", "noStream", "noStreamHint"]) assert.ok(dict[k], `${lang}: ${k}`);
  }
});

/* ───────────── Stream sans jeu : logo du site sur fond mauve Twitch ───────────── */

const brandOf = (over = {}) => ({ name: "Helldog136", tagline: "", about: "", logo: "https://cdn.example.test/logo.png", logos: [], contactEmail: "", colors: [], font: { key: "sans", name: "S", stack: "sans-serif" }, defaultLocale: "fr", locales: ["fr"], ...over });
const noGame = vevent("1", hours(3), hours(4), "Cap48h caritatif");

test("sans jeu : le titre est le titre principal, aucune ligne « jeu » vide, aucun appel RAWG, visuel de repli à la place de la jaquette", async () => {
  const ctx = withCovers({ brand: brandOf() });
  const html = await next(ctx, noGame);
  assert.match(html, /<h3 class="cpl-title">Cap48h caritatif<\/h3>/);
  assert.ok(!html.includes("class=\"cpl-games\"") && !html.includes("undefined") && !html.includes("gamesLabel"));
  assert.match(html, /<span class="cpl-ph" aria-hidden="true">/);
  assert.deepEqual(ctx.calls.rawg, []);
});

test("sans jeu : logo principal sur un disque blanc ; variante « fond sombre » (logo clair) posée directement sur le mauve", async () => {
  const plain = await next(ctxWith({}, { brand: brandOf() }), noGame);
  assert.match(plain, /cpl-ph-disc"><img src="https:\/\/cdn\.example\.test\/logo\.png" alt=""/);
  const dark = await next(ctxWith({}, { brand: brandOf({ logos: [{ kind: "wide", src: "/w.png" }, { kind: "squareDark", src: "/clair.svg" }] }) }), noGame);
  assert.match(dark, /<span class="cpl-ph" aria-hidden="true"><img src="\/clair\.svg" alt=""/);
  assert.ok(!dark.includes("cpl-ph-disc\""));
});

test("sans jeu : sans logo → initiale du nom du site ; marque illisible ou adresse dangereuse → jamais injectée", async () => {
  assert.match(await next(ctxWith({}, { brand: brandOf({ logo: null }) }), noGame), /cpl-ph" aria-hidden="true"><span>H<\/span>/);
  assert.match(await next(ctxWith({}, { brand: brandOf({ logo: null, name: "" }) }), noGame), /<span>▶<\/span>/);
  for (const logo of ["javascript:alert(1)", "http://x/y.png", "//evil/x.png", 'https://x/a"onerror="y']) {
    const html = await next(ctxWith({}, { brand: brandOf({ logo }) }), noGame);
    assert.ok(!html.includes("<img"), logo);
  }
  const broken = ctxWith({}, {}); broken.api.brand = async () => { throw new Error("boum"); };
  assert.match(await next(broken, noGame), /cpl-ph/);
  const evil = await next(ctxWith({}, { brand: brandOf({ logo: null, name: "<b>x" }) }), noGame);
  assert.ok(evil.includes("<span>&lt;</span>") && !evil.includes("<b>"));
});

test("sans jeu : la liste « prochains streams » garde la même mise en page (vignette de repli) ; un stream avec jeu garde sa jaquette", async () => {
  serve(calendar(noGame, vevent("2", hours(5), hours(6), "Avec", ["DESCRIPTION:Jeu: Celeste"])));
  const list = rows((await def.sections.upcoming(withCovers({ brand: brandOf() }), {}))[1].html);
  assert.match(list[0], /cpl-ph cpl-ph-s/);
  assert.ok(!/class="cpl-games"|undefined/.test(list[0]));
  assert.match(list[1], /cpl-thumb/);
  assert.ok(!list[1].includes("cpl-ph"));
});

test("page publique : un jour qui mêle streams avec et sans jeu → vignette de repli pour ceux sans jeu ; jour sans aucune jaquette → texte comme avant", async () => {
  // Les deux streams doivent tomber le MÊME jour quelle que soit l'heure du test (sinon ils sont rangés dans deux jours) : on part de midi UTC, au moins 2 h plus tard.
  const noon = new Date(); noon.setUTCHours(12, 0, 0, 0); if (noon.getTime() - Date.now() < 2 * 3_600_000) noon.setUTCDate(noon.getUTCDate() + 1);
  const at = (h) => new Date(noon.getTime() + h * 3_600_000);
  serve(calendar(vevent("1", at(0), at(1), "Avec", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", at(0.5), at(1.5), "Sans <b>jeu</b>")));
  const page = await def.page(withCovers({ brand: brandOf() }));
  const html = page.blocks.filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.match(html, /cpl-ph cpl-ph-s/);
  assert.ok(html.includes("Sans &lt;b&gt;jeu&lt;/b&gt;") && !html.includes("<b>jeu"));
  serve(calendar(noGame));
  const plainPage = await def.page(withCovers({ brand: brandOf() }));
  assert.ok(!plainPage.blocks.some((b) => b.type === "html"));
});

test("carte « prochain stream » : le lien de la chaîne vient d'abord de la Chaîne Twitch (sujet social.link), l'ancien réglage sert de repli", async () => {
  const fs = await import("node:fs");
  const m = JSON.parse(fs.readFileSync(new URL("../modules/planning/module.json", import.meta.url), "utf8"));
  assert.ok(m.consumes.some((c) => c.topic === "social.link"));
  const ev = vevent("1", hours(2), hours(3), "X");
  const withTopic = withSocial(ctxWith({ channelUrl: "https://twitch.tv/ancien" }), [{ label: "YouTube", url: "https://youtube.com/@x", icon: "youtube" }, { label: "Twitch · neuf", url: "https://twitch.tv/neuf", icon: "twitch" }]);
  assert.match(await next(withTopic, ev), /href="https:\/\/twitch\.tv\/neuf"/);
  const noTwitch = withSocial(ctxWith({ channelUrl: "https://twitch.tv/ancien" }), [{ label: "YouTube", url: "https://youtube.com/@x", icon: "youtube" }]);
  assert.match(await next(noTwitch, ev), /href="https:\/\/twitch\.tv\/ancien"/);
  const broken = withSocial(ctxWith({ channelUrl: "https://twitch.tv/ancien" }), () => { throw new Error("boom"); });
  assert.match(await next(broken, ev), /href="https:\/\/twitch\.tv\/ancien"/);
  const unsafe = withSocial(ctxWith(), [{ icon: "twitch", url: "javascript:alert(1)" }]);
  assert.ok(!(await next(unsafe, ev)).includes("cpl-btn\""));
});

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
const rows = (html) => html.split("<li ").slice(1);
const ctxWith = (settings = {}, over = {}) => fakeCtx({ settings: { icsUrl: URL_OK, days: 7, timezone: "UTC", ...settings }, messages, locale: "fr", rawgConfigured: false, ...over });

const realFetch = globalThis.fetch;
let fetched;
const serve = (body, status = 200) => { fetched = []; globalThis.fetch = async (u) => { fetched.push(String(u)); return new Response(body, { status }); }; };
beforeEach(() => { mod.clearIcsCache(); fetched = []; });
afterEach(() => { globalThis.fetch = realFetch; });

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

test("section : calendrier lisible mais vide → carte « pas de stream planifié » ; adresse absente ou refusée → aucun bloc (la section disparaît)", async () => {
  serve(calendar());
  const empty = await def.sections.upcoming(ctxWith(), {});
  assert.equal(empty[1].type, "html");
  assert.match(empty[1].html, /noStream/);
  assert.equal(await def.sections.upcoming(ctxWith({ icsUrl: "" }), {}), null);
  for (const bad of ["http://calendar.example.com/x.ics", "https://127.0.0.1/x.ics", "https://localhost/x.ics"]) {
    fetched = []; serve(calendar(vevent("1", hours(2), hours(3), "X")));
    assert.equal(await def.sections.upcoming(ctxWith({ icsUrl: bad }), {}), null, bad);
    assert.deepEqual(fetched, [], "aucun appel réseau vers une adresse refusée");
  }
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
  assert.match((await def.sections.upcoming(ctxWith(), {}))[1].html, /Nouveau/);
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
  for (const k of ["icsUrl", "days", "timezone", "channelUrl"]) assert.ok(settingKeys.has(k), k);
});

test("morceau « prochain stream » : le premier créneau à venir, carte vide s'il n'y en a pas, rien si pas d'agenda", async () => {
  serve(calendar(vevent("1", hours(30), hours(31), "Plus tard"), vevent("2", hours(3), hours(4), "Bientôt", ["DESCRIPTION:Jeu: Zelda"])));
  const blocks = await def.sections.next(ctxWith(), {});
  assert.equal(blocks[0].type, "heading");
  assert.match(blocks[1].html, /Bientôt/);
  assert.match(blocks[1].html, /Zelda/);
  assert.ok(!blocks[1].html.includes("Plus tard"));
  serve(calendar());
  mod.clearIcsCache();
  assert.match((await def.sections.next(ctxWith(), {}))[1].html, /noStream/);
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

/* ───────────── Cartes de l'accueil : « prochain stream » et « prochains streams » ───────────── */

const COVER = "https://media.example.test/celeste.jpg";
const withCovers = (over = {}) => ctxWith({}, { rawgConfigured: true, rawgCover: { status: "found", url: COVER }, ...over });
const next = async (ctx, ...ev) => { serve(calendar(...ev)); mod.clearIcsCache(); return (await def.sections.next(ctx, {}))[1].html; };

test("carte « prochain stream » : article encadré, <time> sémantiques, titre, heure, jeu, indication relative", async () => {
  const html = await next(ctxWith(), vevent("1", hours(3.5), hours(5), "Cap48h", ["DESCRIPTION:Jeu: Zelda"]));
  assert.match(html, /<article class="cpl-card">/);
  assert.equal((html.match(/<time /g) ?? []).length, 1);
  assert.match(html, /<time class="cpl-hour" datetime="\d{4}-\d\d-\d\dT[\d:.]+Z">\d\d:\d\d<\/time>/);
  assert.match(html, /<h3 class="cpl-title">Cap48h<\/h3>/);
  assert.match(html, /cpl-games">gamesLabel Zelda</);
  assert.match(html, /cpl-badge">relHours</, "dans 3 h");
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
  const html = await next(ctxWith(), vevent("1", hours(1), hours(2), "Premier"), vevent("2", hours(1.5), hours(2.5), "Deuxieme"), vevent("3", hours(80), hours(81), "Lointain"));
  assert.match(html, /cpl-also">alsoToday <time[^>]*>[\d:]+<\/time> Deuxieme</);
  assert.ok(!html.includes("Lointain"));
});

test("carte : échappement HTML des titres, jeux, et adresses — aucune injection", async () => {
  const evil = '<img src=x onerror=alert(1)> "q" \'s\' &amp;';
  const ev = vevent("1", hours(2), hours(3), evil, [`DESCRIPTION:Jeu: <b>Jeu</b> "x"`]);
  for (const html of [await next(withCovers({ rawgCover: { status: "found", url: 'https://x.test/a.jpg" onerror="alert(1)' } }), ev), (await (async () => { serve(calendar(ev)); mod.clearIcsCache(); return (await def.sections.upcoming(withCovers(), {}))[1].html; })())]) {
    assert.ok(!/<img src=x/.test(html) && !html.includes("<b>Jeu</b>"), html);
    assert.ok(!/ onerror="/.test(html.replace(/&quot;/g, "")), html);
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &#39;s&#39; &amp;amp;"));
  }
});

test("carte : états vides — calendrier vide : carte soignée avec lien vers le planning ; sans page publique : pas de lien", async () => {
  serve(calendar()); mod.clearIcsCache();
  const withPage = (await def.sections.next(fakeCtx({ settings: { icsUrl: URL_OK, timezone: "UTC" }, messages, locale: "fr", basePath: "planning" }), {}))[1].html;
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
  assert.match(list[0], /cpl-badge">relHours?|cpl-badge">relMinutes/);
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
  serve(calendar(vevent("1", hours(2), hours(3), "Avec", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", hours(2.5), hours(3.5), "Sans <b>jeu</b>")));
  const page = await def.page(withCovers({ brand: brandOf() }));
  const html = page.blocks.filter((b) => b.type === "html").map((b) => b.html).join("");
  assert.match(html, /cpl-ph cpl-ph-s/);
  assert.ok(html.includes("Sans &lt;b&gt;jeu&lt;/b&gt;") && !html.includes("<b>jeu"));
  mod.clearIcsCache(); serve(calendar(noGame));
  const plainPage = await def.page(withCovers({ brand: brandOf() }));
  assert.ok(!plainPage.blocks.some((b) => b.type === "html"));
});

/* ───────────── Aide à la saisie : tutoriel d'admin et SKILL.md ───────────── */

const fsMod = await import("node:fs");
const locale = (lang) => JSON.parse(fsMod.readFileSync(new URL(`../modules/planning/locales/${lang}.json`, import.meta.url), "utf8"));
const realCtx = (lang = "fr", over = {}, opts = {}) => fakeCtx({ settings: { icsUrl: URL_OK, days: 7, timezone: "Europe/Brussels", ...over }, messages: locale(lang), locale: lang, rawgConfigured: false, ...opts });

test("tutoriel : bloc repliable « Comment remplir mon agenda Google ? » + bouton de téléchargement, ajoutés après l'état du calendrier", async () => {
  serve(calendar(vevent("1", hours(2), hours(3), "X")));
  const blocks = await def.adminPanel(realCtx("fr", {}, { key: "planning" }));
  assert.equal(blocks[0].type, "heading", "l'état du calendrier reste en tête");
  const html = blocks.at(-1).html;
  assert.equal(blocks.at(-1).type, "html");
  assert.match(html, /<details><summary>Comment remplir mon agenda Google \?<\/summary>/);
  assert.match(html, /href="\/m\/planning\/skill\?lang=fr" download="SKILL\.md">Télécharger le skill pour mon IA</);
  for (const needle of ["Jeu :", "Europe/Brussels", "Intégrer l&#39;agenda", "Adresse secrète au format iCal", "Toute la journée", "Fuseau horaire"]) assert.ok(html.includes(needle), needle);
  assert.ok(!html.includes("secret-token"), "jamais l'adresse du calendrier");
  // Même contenu sans calendrier réglé
  const none = await def.adminPanel(realCtx("fr", { icsUrl: "" }));
  assert.match(none.at(-1).html, /<details>/);
  const en = (await def.adminPanel(realCtx("en"))).at(-1).html;
  assert.match(en, /How do I fill in my Google Calendar\?/);
  assert.match(en, /Download the skill for my AI/);
});

test("tutoriel : aucune clé de texte manquante ou en trop dans la page rendue (aucune clé brute affichée)", async () => {
  for (const lang of ["fr", "en"]) {
    const html = (await def.adminPanel(realCtx(lang))).at(-1).html;
    assert.ok(!/>tuto[A-Z]\w+</.test(html) && !/>skill[A-Z]\w+</.test(html), lang);
  }
});

test("tutoriel : l'exemple suivi à la lettre est bien lu par le module (titre, jeu, heure) ; sans ligne « Jeu : », aucun jeu", async () => {
  // Événement tel que Google l'exporte pour l'exemple du tutoriel : titre, lieu vide, description « Jeu : Celeste », 21:00 → 23:30 (heure de Bruxelles).
  const ical = calendar(["BEGIN:VEVENT", "UID:ex1", "DTSTART;TZID=Europe/Brussels:20991010T210000", "DTEND;TZID=Europe/Brussels:20991010T233000", "SUMMARY:Soirée découverte", "LOCATION:", "DESCRIPTION:Jeu : Celeste", "END:VEVENT"].join("\r\n"),
    ["BEGIN:VEVENT", "UID:ex2", "DTSTART;TZID=Europe/Brussels:20991017T140000", "DTEND;TZID=Europe/Brussels:20991018T140000", "SUMMARY:Cap48h", "DESCRIPTION:Merci à toutes et à tous !\\nJeu en vrac : pas une ligne Jeu", "END:VEVENT"].join("\r\n"));
  const ev = mod.parseIcs(ical, { timeZone: "Europe/Brussels", windowEnd: new Date("2100-01-01T00:00:00Z") });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].title, "Soirée découverte");
  assert.deepEqual(mod.extractGameNames(ev[0].description), ["Celeste"]);
  assert.equal(ev[0].start.toISOString(), "2099-10-10T19:00:00.000Z", "21:00 à Bruxelles (été)");
  assert.equal((ev[0].end - ev[0].start) / 60_000, 150);
  assert.deepEqual(mod.extractGameNames(ev[1].description), [], "pas de ligne « Jeu : » = pas de jeu");
  for (const [d, names] of [["Jeu : AA, BB + CC", ["AA", "BB", "CC"]], ["Jeu: AA\\nJeu: BB", ["AA", "BB"]], ["Game : Zelda", ["Zelda"]], ["Notes\\nJeu : Celeste", ["Celeste"]], ["Je joue à Celeste", []], ["Jeu : x", []]]) assert.deepEqual(mod.extractGameNames(d.replace(/\\n/g, "\n")), names, d);
  // Toute la journée : affichée sans heure ni jaquette ; annulé : retiré ; lieu : ignoré.
  const more = mod.parseIcs(calendar(["BEGIN:VEVENT", "UID:a", "DTSTART;VALUE=DATE:20991010", "DTEND;VALUE=DATE:20991011", "SUMMARY:Journée", "END:VEVENT", "BEGIN:VEVENT", "UID:c", "DTSTART:20991012T100000Z", "DTEND:20991012T110000Z", "SUMMARY:Annulé", "STATUS:CANCELLED", "END:VEVENT"].join("\r\n")), { timeZone: "UTC", windowEnd: new Date("2100-01-01T00:00:00Z") });
  assert.deepEqual(more.map((e) => [e.title, e.allDay]), [["Journée", true]]);
});

test("SKILL.md : en-tête YAML valide (name, description), règles exactes, fuseau et nom du site réels, exemples, liste de contrôle, interdits", async () => {
  const md = await mod.skillMarkdown(realCtx("fr", {}, { site: { name: "Helldog136", tagline: "", logo: null } }));
  const m = md.match(/^---\nname: ([a-z0-9-]+)\ndescription: (".*")\n---\n\n# /);
  assert.ok(m, md.slice(0, 300));
  assert.equal(m[1], "agenda-planning-streams");
  const desc = JSON.parse(m[2]);
  assert.ok(desc.includes("Helldog136") && desc.includes("Europe/Brussels") && !desc.includes("{"));
  for (const needle of ["## Rôle", "## Quand l'utiliser", "## Règles de remplissage", "`Jeu : `", "aucune** ligne `Jeu :`", "Europe/Brussels", "## Modèle d'une entrée", "**Stream de jeu**", "**Événement caritatif, sans jeu**", "**Stream récurrent**", "## Liste de contrôle", "## À ne jamais faire", "Inventer ou deviner un jeu", "Mettre une heure sans fuseau", "## Informations à demander à l'humain", "Helldog136"]) assert.ok(md.includes(needle), needle);
  assert.ok(!/\{(site|tz)\}/.test(md), "aucune variable non remplacée");
  const en = await mod.skillMarkdown(realCtx("en"));
  assert.match(en, /^---\nname: stream-schedule-calendar\n/);
  assert.ok(en.includes("Game: Celeste") && en.includes("never guesses the game"));
});

test("SKILL.md : les exemples respectent le parseur du module (jeu lu pour l'exemple de jeu, aucun jeu pour l'exemple caritatif)", async () => {
  const md = await mod.skillMarkdown(realCtx("fr"));
  const blocksOf = [...md.matchAll(/```\n([\s\S]*?)```/g)].map((x) => x[1]);
  const desc = (b) => (b.match(/^Description : (.*)$/m) ?? [])[1] ?? "";
  const byTitle = (t) => blocksOf.find((b) => b.includes(`Titre :       ${t}`));
  assert.deepEqual(mod.extractGameNames(desc(byTitle("Soirée découverte"))), ["Celeste"]);
  assert.deepEqual(mod.extractGameNames(desc(byTitle("Cap48h : stream caritatif"))), []);
  assert.deepEqual(mod.extractGameNames(desc(byTitle("Jeudi détente"))), ["Hades", "Celeste"]);
  // Le modèle : « Jeu : <nom du jeu> » n'est lu que s'il est rempli (≥ 2 caractères) — jamais un jeu fantôme « <nom du jeu> » à l'écran.
  assert.ok(blocksOf.length >= 4);
});

test("SKILL.md : aucune donnée secrète (adresse iCal, clé), nom de site hostile neutralisé, jamais d'exception", async () => {
  const evil = 'Site"\nname: pirate\n---\n`x` <script>alert(1)</script>';
  const md = await mod.skillMarkdown(realCtx("fr", { icsUrl: "https://calendar.example.com/ical/TOP-SECRET-TOKEN/basic.ics" }, { site: { name: evil, tagline: "", logo: null } }));
  assert.ok(!md.includes("TOP-SECRET-TOKEN") && !md.includes("calendar.example.com"));
  assert.ok(!md.includes("<script>") && !md.includes("`x`"));
  assert.equal(md.split("\n---\n")[0].split("\n").length, 3, "l'en-tête ne contient que --- / name / description : pas d'injection de clé YAML");
  assert.ok(!/^name: pirate/m.test(md));
  const broken = realCtx("fr"); broken.api.site = async () => { throw new Error("boum"); };
  assert.match(await mod.skillMarkdown(broken), /ce site/);
  const badTz = await mod.skillMarkdown(realCtx("fr", { timezone: "Pas/UnFuseau" }));
  assert.ok(badTz.includes("UTC") && !badTz.includes("Pas/UnFuseau"));
});

test("route de téléchargement : SKILL.md en pièce jointe (GET/HEAD seulement), type Markdown, sans secret", async () => {
  const ctx = realCtx("fr", { icsUrl: "https://calendar.example.com/ical/TOP-SECRET-TOKEN/basic.ics" });
  const res = await def.routes.skill(new Request("https://example.test/m/planning/skill?lang=fr"), ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="SKILL.md"');
  assert.match(res.headers.get("content-type"), /^text\/markdown; charset=utf-8/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const text = await res.text();
  assert.ok(text.startsWith("---\nname: ") && !text.includes("TOP-SECRET-TOKEN"));
  assert.equal((await def.routes.skill(new Request("https://example.test/x", { method: "HEAD" }), ctx)).status, 200);
  for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await def.routes.skill(new Request("https://example.test/x", { method, body: "a" }), ctx)).status, 405, method);
});

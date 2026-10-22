// Compte à rebours — le module : manifeste, événements, administration, page, accueil, source OBS, routes, outils pour les assistants.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { validateIcs } from "./helpers/countdownIcs.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";

const DIR = new URL("../modules/countdown", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifest = readJson("module.json");
const FR = readJson("locales/fr.json");
const EN = readJson("locales/en.json");
const mod = (await import("../modules/countdown/index.mjs")).default;
const M = await import("../modules/countdown/model.mjs");
const T = await import("../modules/countdown/time.mjs");
const Z = await import("../modules/countdown/zones.mjs");

let seq = 0;
const doc = (o = {}) => ({ uid: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, slug: `evt-${seq}`, rev: 1, title: `Événement ${seq}`, allDay: false, date: "2099-06-01", time: "21:00", tz: "Europe/Paris", endDate: "", endTime: "", description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z", ...o });
/** Un événement dont le début est à `ms` d'ici (en heure universelle, à la minute près : prenez des écarts de plus de 2 minutes). */
const inMs = (ms, o = {}) => { const d = new Date(Date.now() + ms); return doc({ date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), tz: "UTC", ...o }); };
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const ctxFor = (rows = [], o = {}) => fakeCtx({
  key: `cd${++seq}`, basePath: "countdown", moduleId: "countdown", name: "Compte à rebours", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"],
  messages: FR, siteUrl: "https://example.test", settings: { keep: "1d", timezone: "Europe/Paris", showSeconds: true, overlayEndMinutes: 5 }, rows: { events: rows }, ...o,
});
const stored = (ctx) => ctx.dumpStore().filter((r) => r.collection === "events").map((r) => ({ id: r.id, ...r.data }));
const html = (blocks) => blocks.filter((b) => b.type === "html").map((b) => b.html).join("\n");

// ── Manifeste ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("manifeste : valide, widget avec page, droits, outils pour les assistants, première installation", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const m = r.manifest;
  assert.equal(m.id, "countdown");
  assert.equal(m.version, "1.0.0");
  assert.equal(m.minCore, "0.2.5");
  assert.equal(m.apiVersion, 2);
  assert.equal(m.type, "widget");
  assert.equal(m.page, true);
  assert.equal(m.basePath, "countdown");
  assert.deepEqual(m.name, { fr: "Compte à rebours", en: "Countdown" });
  assert.deepEqual(m.tabs.map((t) => t.id), ["use"]);
  assert.deepEqual(m.sections.map((s) => s.id), ["featured", "upcoming"]);
  assert.deepEqual(m.onboarding, { home: { section: "featured" } });
  assert.deepEqual(m.rights.map((x) => x.id), ["events.edit", "events.delete"]);
  assert.ok(m.rights.every((x) => x.default.editor === false), "un éditeur n'a ces droits que si le propriétaire les lui donne");
});

test("manifeste : sections, routes, outils MCP déclarés = implémentés ; permissions = ce que fait le code", () => {
  const source = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  assert.deepEqual(manifest.sections.map((s) => s.id).sort(), Object.keys(mod.sections).sort());
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(mod.mcp).sort());
  assert.deepEqual(Object.keys(mod.routes).sort(), ["ics", "live.js", "now", "state"]);
  assert.deepEqual(Object.keys(mod.slots), ["layout.head"]);
  assert.deepEqual(Object.keys(mod.adminActions).sort(), ["cleanup", "create", "feature", "remove", "save"]);
  const used = { slots: mod.slots, sections: mod.sections, pages: mod.page, routes: mod.routes, storage: source.includes("ctx.api.store"), overlay: mod.overlay, mcp: mod.mcp, admin: mod.adminPanel };
  assert.deepEqual([...manifest.permissions].sort(), Object.entries(used).filter(([, v]) => v).map(([k]) => k).sort());
  assert.ok(!/\bfetch\s*\(|ctx\.api\.net|setInterval|node:fs|child_process|\beval\(|new Function/.test(source.replace(/win\.fetch\(/g, "")), "aucun appel réseau du serveur, aucun minuteur de fond");
  assert.ok(!source.includes("tasks:"), "aucune tâche en arrière-plan");
});

test("manifeste : outils MCP — descriptions utiles, écritures jamais accordées d'office, suppression marquée destructive", () => {
  const by = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.equal(by.events_list.readOnly, true);
  for (const name of ["event_create", "event_update", "event_set_featured"]) assert.ok(!by[name].readOnly && !by[name].default && !by[name].destructive, name);
  assert.equal(by.event_delete.destructive, true);
  assert.equal(by.event_delete.default, false);
  for (const a of manifest.mcp) { assert.ok(a.description.length > 60, a.name); assert.ok(`countdown-instance__${a.name}`.length <= 64); }
  assert.ok(/not a regular stream/i.test(by.event_create.description), "dit où ne pas l'utiliser (les streams réguliers)");
});

test("manifeste : réglages — valeurs par défaut sensées, liste de fuseaux = celle du code, couleur qui suit le thème", () => {
  const defaults = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]));
  assert.deepEqual(defaults, { timezone: "Europe/Paris", timezoneOther: undefined, keep: "1d", endMessage: undefined, pageTitle: undefined, showSeconds: true, overlayLook: "dark", overlayPosition: "top-center", overlaySize: "m", overlayAccent: "theme:accent", overlayEndMinutes: 5 });
  const tz = manifest.settings.find((s) => s.key === "timezone");
  assert.deepEqual(tz.options.map((o) => o.value), Z.ZONES.map((z) => z[0]));
  assert.ok(tz.options.length <= 50);
  assert.deepEqual(tz.options.map((o) => o.label.fr), Z.zoneOptions("fr").map((o) => o.label));
  assert.deepEqual(tz.options.map((o) => o.label.en), Z.zoneOptions("en").map((o) => o.label));
  for (const z of Z.ZONES) assert.ok(T.isValidZone(z[0]), z[0]);
  assert.equal(new Set(Z.ZONES.map((z) => z[0])).size, Z.ZONES.length);
  for (const k of ["overlayLook", "overlayPosition", "overlaySize", "overlayAccent", "overlayEndMinutes"]) assert.equal(manifest.settings.find((s) => s.key === k).group, "appearance", k);
  assert.ok(manifest.settings.find((s) => s.key === "timezoneOther").advanced, "le fuseau libre est réservé au mode avancé");
});

test("textes : français et anglais alignés, toutes les clés utilisées existent, aucune phrase vide", () => {
  assert.deepEqual(Object.keys(FR).sort(), Object.keys(EN).sort());
  for (const k of Object.keys(FR)) {
    assert.ok(FR[k].trim() && EN[k].trim(), k);
    assert.deepEqual([...FR[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...EN[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `variables de ${k}`);
  }
  const code = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  for (const m of code.matchAll(/ctx\.t\(\s*"([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in FR, `clé « ${m[1]} » absente`);
  for (const k of ["err_title", "err_date", "err_time", "err_zone", "err_end_time", "err_end_before", "err_link", "err_image", "err_keep"]) assert.ok(k in FR, k);
  for (const k of M.KEEP_KEYS) assert.ok(`keep_${k}` in FR, k);
  for (const u of ["unit_d", "unit_h", "unit_m", "unit_s"]) assert.equal(FR[u].split("|").length, 2, u);
});

test("textes : les messages d'erreur donnent un exemple et disent quoi faire", () => {
  for (const k of ["err_date", "err_time", "err_zone", "err_link", "err_title"]) assert.match(FR[k], /exemple/i, k);
  assert.match(FR.err_zone, /Asia\/Tokyo/);
  assert.match(FR.err_time, /21:00/);
});

// ── Événements : ce qu'on garde et ce qu'on refuse ──────────────────────────────────────────────────────────────────

const build = (values, o = {}) => M.buildEvent(values, { zone: "Europe/Paris", now: Date.UTC(2026, 9, 22), ...o });
const good = { title: "Sortie du jeu", date: "2026-11-14", time: "21h30" };

test("événement : le strict nécessaire suffit, tout le reste a une valeur sensée", () => {
  const r = build(good);
  assert.ok(r.ok);
  assert.deepEqual({ ...r.data, uid: "x" }, {
    uid: "x", slug: "sortie-du-jeu", rev: 1, title: "Sortie du jeu", allDay: false, date: "2026-11-14", time: "21:30", tz: "Europe/Paris", endDate: "", endTime: "",
    description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
  });
  assert.match(r.data.uid, /^[0-9a-f-]{36}$/);
});

test("événement : chaque erreur est rattachée à son champ", () => {
  const err = (values) => build({ ...good, ...values }).errors;
  assert.deepEqual(err({ title: "   " }), { title: "err_title" });
  assert.deepEqual(err({ date: "2026-02-30" }), { date: "err_date" });
  assert.deepEqual(err({ date: "" }), { date: "err_date" });
  assert.deepEqual(err({ time: "25h" }), { time: "err_time" });
  assert.deepEqual(err({ time: "" }), { time: "err_time" });
  assert.deepEqual(err({ tzOther: "Mars/Olympus" }), { tzOther: "err_zone" });
  assert.deepEqual(err({ tz: "+01:00" }), { tz: "err_zone" });
  assert.deepEqual(err({ endDate: "2026-11-15" }), { endTime: "err_end_time" });
  assert.deepEqual(err({ endDate: "2026-11-14", endTime: "20:00" }), { endDate: "err_end_before" });
  assert.deepEqual(err({ endLink: "javascript:alert(1)" }), { endLink: "err_link" });
  assert.deepEqual(err({ image: "javascript:alert(1)" }), { image: "err_image" });
  assert.deepEqual(err({ keep: "toujours" }), { keep: "err_keep" });
  assert.deepEqual(Object.keys(err({ title: "", date: "x", time: "x" })).sort(), ["date", "time", "title"], "plusieurs erreurs d'un coup, pour tout corriger en une fois");
});

test("événement : journée entière sans heure ; la fin ne peut pas précéder le début", () => {
  const r = build({ title: "Anniversaire", date: "2026-11-14", allDay: "on" });
  assert.ok(r.ok);
  assert.equal(r.data.time, "");
  assert.equal(r.data.allDay, true);
  assert.ok(!build({ title: "Convention", date: "2026-11-14", allDay: "on", endDate: "2026-11-13" }).ok);
  assert.ok(build({ title: "Convention", date: "2026-11-14", allDay: "on", endDate: "2026-11-16" }).ok);
  assert.ok(build({ ...good, endDate: "2026-11-14", endTime: "23:00" }).ok);
});

test("événement : fuseau choisi, fuseau libre (qui l'emporte), majuscules rétablies", () => {
  assert.equal(build({ ...good, tz: "Asia/Tokyo" }).data.tz, "Asia/Tokyo");
  assert.equal(build({ ...good, tz: "Asia/Tokyo", tzOther: "asia/kolkata" }).data.tz, "Asia/Kolkata");
  assert.equal(build(good).data.tz, "Europe/Paris", "sans choix : le fuseau du site");
});

test("événement : l'heure qui n'existe pas ou qui existe deux fois est signalée", () => {
  const gap = build({ title: "Nuit", date: "2026-03-29", time: "02:30" });
  assert.ok(gap.ok);
  assert.equal(gap.note, "gap");
  assert.deepEqual(gap.shifted, { h: 3, mi: 30 });
  assert.equal(build({ title: "Nuit", date: "2026-10-25", time: "02:30" }).note, "fold");
  assert.equal(build(good).note, "");
});

test("événement : textes nettoyés et bornés, liens sûrs seulement", () => {
  const r = build({ ...good, title: `  ${"A".repeat(200)}‮\n\tfin `, description: "x".repeat(2000), where: "L".repeat(500), endMessage: "M".repeat(500), endLinkLabel: "B".repeat(200), endLink: "https://example.org/a b" });
  assert.equal(r.ok, false, "une adresse avec espace est refusée");
  const ok = build({ ...good, title: `  ${"A".repeat(200)}‮\n\tfin `, description: "x".repeat(2000), where: "L".repeat(500), endMessage: "M".repeat(500), endLinkLabel: "B".repeat(200), endLink: "https://example.org/a" });
  assert.equal(ok.data.title.length, 80);
  assert.ok(!/[‮\n\t]/.test(ok.data.title));
  assert.equal(ok.data.description.length, 600);
  assert.equal(ok.data.where.length, 120);
  assert.equal(ok.data.endMessage.length, 140);
  assert.equal(ok.data.endLinkLabel.length, 40);
  for (const good of ["https://example.org/x", "http://example.org", "mailto:a@example.org", "/contact", "/contact?x=1"]) assert.equal(M.safeHref(good), good);
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.test/x", "ftp://x.test", "https://", "vbscript:x", "https://a.test/\u0000", " https://a.test/x y"]) assert.equal(M.safeHref(bad), "", bad);
  assert.equal(M.safeImage("/uploads/a.png"), "/uploads/a.png");
  assert.equal(M.safeImage("https://cdn.example.org/a.png"), "https://cdn.example.org/a.png");
  for (const bad of ["http://cdn.example.org/a.png", "data:image/svg+xml,<svg>", "javascript:1", "//x.test/a.png", "/a.png\"onerror=\"x", "/a b.png"]) assert.equal(M.safeImage(bad), "", bad);
});

test("noms courts : lisibles, uniques, jamais « page » (réservé à la pagination)", () => {
  assert.equal(M.slugify("Sortie du jeu !"), "sortie-du-jeu");
  assert.equal(M.slugify("Été à Ñandú — Édition spéciale"), "ete-a-nandu-edition-speciale");
  assert.equal(M.slugify("日本語🎂"), "evenement");
  assert.equal(M.slugify("a".repeat(100)).length, 40);
  assert.equal(M.uniqueSlug("Sortie", new Set()), "sortie");
  assert.equal(M.uniqueSlug("Sortie", new Set(["sortie"])), "sortie-2");
  assert.equal(M.uniqueSlug("Sortie", new Set(["sortie", "sortie-2"])), "sortie-3");
  assert.notEqual(M.uniqueSlug("Page", new Set()), "page");
  assert.ok(M.isSlug("sortie-2") && !M.isSlug("../x") && !M.isSlug("A") && !M.isSlug("") && !M.isSlug("a".repeat(61)));
});

test("lecture : un document abîmé disparaît sans casser les autres", () => {
  const bad = [null, {}, { data: null }, { id: "x", data: { title: "T", date: "2026-13-40", time: "10:00", tz: "UTC" } }, { id: "x", data: { title: "T", date: "2026-11-14", time: "10:00", tz: "Mars/Olympus" } }, { id: "x", data: { title: "", date: "2026-11-14", time: "10:00", tz: "UTC" } }, { id: "x", data: { title: "T", date: "2026-11-14", time: "dix heures", tz: "UTC" } }];
  for (const row of bad) assert.equal(M.read(row), null, JSON.stringify(row));
  const r = M.read({ id: "x", data: { title: "T", date: "2026-11-14", time: "10:00", tz: "UTC", keep: "pour toujours", endLink: "javascript:x", image: "javascript:x", uid: "<script>", slug: "../x" } });
  assert.equal(r.keep, "");
  assert.equal(r.endLink, "");
  assert.equal(r.image, "");
  assert.equal(r.uid, "x");
  assert.equal(r.slug, "t");
});

// ── Administration ──────────────────────────────────────────────────────────────────────────────────────────────────

const run = (ctx, name, values = {}) => mod.adminActions[name](ctx, values);

test("créer : un nom, un jour, une heure suffisent ; l'événement apparaît à l'écran", async () => {
  const ctx = ctxFor();
  const r = await run(ctx, "create", { title: "Sortie du jeu", date: "2099-11-14", time: "21:00", tz: "Europe/Paris" });
  assert.equal(r.ok, FR.created);
  assert.equal(r.redirect, "?");
  const [e] = stored(ctx);
  assert.equal(e.title, "Sortie du jeu");
  assert.equal(e.tz, "Europe/Paris");
  const panel = await mod.adminPanel(ctx, { query: {} });
  const table = panel.find((b) => b.type === "table");
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][0], "Sortie du jeu");
  assert.match(table.rows[0][1], /Samedi 14 novembre 2099 à 21 h \(heure d’Europe centrale\)/);
  assert.match(table.rows[0][2], /À la une · À venir · dans \d+ jours/);
});

test("créer : l'erreur s'affiche sous le champ fautif, avec un exemple, et rien n'est enregistré", async () => {
  const ctx = ctxFor();
  const r = await run(ctx, "create", { title: "", date: "demain", time: "bientôt", tz: "Europe/Paris" });
  assert.equal(r.ok, undefined);
  assert.equal(r.error, undefined);
  assert.deepEqual(Object.keys(r.errors).sort(), ["date", "time", "title"]);
  assert.equal(r.errors.time, FR.err_time);
  assert.equal(stored(ctx).length, 0);
  const tz = await run(ctx, "create", { title: "X", date: "2099-01-01", time: "10:00", tzOther: "Mars/Olympus" });
  assert.deepEqual(Object.keys(tz.errors), ["tzOther"]);
});

test("créer sur une nuit de changement d'heure : accepté, avec une explication claire", async () => {
  const ctx = ctxFor();
  const r = await run(ctx, "create", { title: "Nuit", date: "2099-03-29", time: "02:30", tz: "Europe/Paris" });
  assert.match(r.ok, /Événement ajouté\./);
  assert.match(r.ok, /n’existe pas ce jour-là/);
  assert.match(r.ok, /3 h 30/);
  const fold = await run(ctx, "create", { title: "Nuit 2", date: "2099-10-25", time: "02:30", tz: "Europe/Paris" });
  assert.match(fold.ok, /existe deux fois/);
});

test("créer un événement déjà passé : accepté, prévenu", async () => {
  const r = await run(ctxFor(), "create", { title: "Hier", date: "2020-01-01", time: "10:00", tz: "UTC" });
  assert.match(r.ok, /déjà passé/);
});

test("modifier : même identifiant d'agenda, même nom court, révision +1 ; le reste est conservé", async () => {
  const ctx = ctxFor();
  await run(ctx, "create", { title: "Sortie", date: "2099-11-14", time: "21:00", tz: "Europe/Paris", description: "Ne sera pas gardée en création rapide" });
  const first = stored(ctx)[0];
  const r = await run(ctx, "save", { id: first.id, title: "Sortie reportée", date: "2099-11-21", time: "20:00", tz: "Europe/Paris", description: "Nouvelle date", endMessage: "On y est !", endLinkLabel: "Regarder", endLink: "https://example.org/live", keep: "7d" });
  assert.equal(r.ok, FR.saved);
  const e = stored(ctx)[0];
  assert.equal(e.uid, first.uid, "l'UID d'agenda ne change jamais");
  assert.equal(e.slug, "sortie", "l'adresse de la page ne change pas quand on renomme");
  assert.equal(e.rev, 2);
  assert.equal(e.createdAt, first.createdAt);
  assert.equal(e.title, "Sortie reportée");
  assert.equal(e.keep, "7d");
  assert.equal(stored(ctx).length, 1);
  assert.deepEqual(Object.keys((await run(ctx, "save", { id: "inconnu", title: "x", date: "2099-01-01", time: "10:00" }))), ["error"]);
});

test("à la une : un seul à la fois, quel que soit le chemin (case du formulaire ou bouton)", async () => {
  const ctx = ctxFor();
  for (const [t, d] of [["A", "2099-01-01"], ["B", "2099-02-01"], ["C", "2099-03-01"]]) await run(ctx, "create", { title: t, date: d, time: "10:00", tz: "UTC", featured: t === "A" ? "on" : "" });
  const flags = () => Object.fromEntries(stored(ctx).map((e) => [e.title, e.featured]));
  assert.deepEqual(flags(), { A: true, B: false, C: false });
  const b = stored(ctx).find((e) => e.title === "B");
  assert.match((await run(ctx, "feature", { id: b.id })).ok, /« B » est maintenant à la une/);
  assert.deepEqual(flags(), { A: false, B: true, C: false });
  const c = stored(ctx).find((e) => e.title === "C");
  await run(ctx, "save", { id: c.id, title: "C", date: "2099-03-01", time: "10:00", tz: "UTC", featured: "on" });
  assert.deepEqual(flags(), { A: false, B: false, C: true });
  assert.ok((await run(ctx, "feature", { id: "inconnu" })).error);
});

test("supprimer et faire le ménage : seulement ce qu'on désigne", async () => {
  const ctx = ctxFor([inMs(-3 * DAY, { title: "Vieux", slug: "vieux" }), inMs(-4 * DAY, { title: "Très vieux", slug: "tres-vieux" }), inMs(3 * DAY, { title: "Futur", slug: "futur" })]);
  const panel = await mod.adminPanel(ctx, { query: {} });
  assert.equal(panel.filter((b) => b.type === "table").length, 2, "une liste des événements affichés, une des masqués");
  const cleanup = panel.find((b) => b.type === "adminForm" && b.action === "cleanup");
  assert.match(cleanup.submitLabel, /Supprimer ces 2 événements masqués/);
  assert.match((await run(ctx, "cleanup")).ok, /2 événement\(s\) supprimé\(s\)/);
  assert.deepEqual(stored(ctx).map((e) => e.title), ["Futur"]);
  assert.equal((await run(ctx, "remove", { id: stored(ctx)[0].id })).ok, FR.removed);
  assert.equal(stored(ctx).length, 0);
  assert.ok((await run(ctx, "remove", { id: "inconnu" })).error);
});

test("plafond : 100 événements au plus, avec un message qui dit quoi faire", async () => {
  const ctx = ctxFor(Array.from({ length: M.MAX_EVENTS }, (_, i) => doc({ title: `E${i}`, slug: `e${i}`, date: "2099-01-01" })));
  const r = await run(ctx, "create", { title: "De trop", date: "2099-01-01", time: "10:00", tz: "UTC" });
  assert.match(r.error, /100 événements/);
  assert.match(r.error, /Événements masqués/);
  assert.equal(stored(ctx).length, 100);
});

test("droits : sans le droit de modifier ou de supprimer, rien ne se passe et le panneau n'offre pas les boutons", async () => {
  const rows = [doc({ title: "Futur", slug: "futur" })];
  const ctx = ctxFor(rows);
  ctx.can = (right) => right === "events.edit";
  assert.equal((await run(ctx, "remove", { id: stored(ctx)[0].id })).error, FR.denied);
  assert.equal((await run(ctx, "cleanup")).error, FR.denied);
  assert.equal(stored(ctx).length, 1);
  assert.ok((await run(ctx, "create", { title: "X", date: "2099-01-01", time: "10:00", tz: "UTC" })).ok);
  const labels = (await mod.adminPanel(ctx, { query: {} })).filter((b) => b.type === "table").flatMap((b) => b.rowActions.map((a) => a.label));
  assert.ok(labels.includes("Modifier") && !labels.includes("Supprimer"));
  const none = ctxFor(rows);
  none.can = () => false;
  assert.equal((await run(none, "create", { title: "X", date: "2099-01-01", time: "10:00" })).error, FR.denied);
  assert.equal((await run(none, "save", { id: "r1" })).error, FR.denied);
  assert.equal((await run(none, "feature", { id: "r1" })).error, FR.denied);
  const panel = await mod.adminPanel(none, { query: {} });
  assert.ok(!panel.some((b) => b.type === "adminForm"), "pas de formulaire pour qui ne peut pas modifier");
});

test("panneau : formulaire court au départ, complet pour modifier, pré-rempli pour réutiliser", async () => {
  const ctx = ctxFor([inMs(5 * DAY, { title: "Futur", slug: "futur", description: "Texte", endMessage: "Go", featured: true }), inMs(-9 * DAY, { title: "Passé", slug: "passe", description: "Ancien" })]);
  const names = (blocks) => blocks.find((b) => b.type === "adminForm" && ["create", "save"].includes(b.action)).fields.map((f) => f.name);
  const quick = await mod.adminPanel(ctx, { query: {} });
  assert.deepEqual(names(quick), ["title", "date", "time", "allDay", "tz", "featured"], "cinq champs et une case : rien d'autre au départ");
  assert.ok(quick.some((b) => b.type === "markdown" && /Modifier/.test(b.text)), "un mot explique où trouver les autres options");
  const id = stored(ctx).find((e) => e.slug === "futur").id;
  const edit = await mod.adminPanel(ctx, { query: { edit: id } });
  const form = edit.find((b) => b.type === "adminForm" && b.action === "save");
  assert.ok(names(edit).includes("endMessage") && names(edit).includes("keep") && names(edit).includes("endLink"));
  assert.equal(form.fields.find((f) => f.name === "title").value, "Futur");
  assert.equal(form.fields.find((f) => f.name === "description").value, "Texte");
  assert.equal(form.fields.find((f) => f.name === "id").kind, "hidden");
  assert.equal(form.cancelHref, "?");
  assert.ok(edit.some((b) => b.type === "markdown" && /Londres : .* · New York : .* · Tokyo : /.test(b.text)), "aperçu chez les visiteurs");
  const copies = edit.filter((b) => b.type === "copy").map((b) => b.text);
  assert.ok(copies.some((t) => t === "https://example.test/countdown/futur"));
  assert.ok(copies.some((t) => t.startsWith("https://example.test/m/") && t.endsWith("/ics?e=futur")));
  assert.ok(copies.some((t) => /^https:\/\/example\.test\/overlays\/.+\?e=futur$/.test(t)));
  const oldId = stored(ctx).find((e) => e.slug === "passe").id;
  const reuse = await mod.adminPanel(ctx, { query: { copy: oldId } });
  const copyForm = reuse.find((b) => b.type === "adminForm" && b.action === "create");
  assert.equal(copyForm.fields.find((f) => f.name === "title").value, "Passé");
  assert.equal(copyForm.fields.find((f) => f.name === "description").value, "Ancien");
  assert.equal(copyForm.fields.find((f) => f.name === "date").value, "", "la date est à redonner");
  assert.equal(copyForm.fields.find((f) => f.name === "featured").value, "");
  const missing = await mod.adminPanel(ctx, { query: { edit: "nope" } });
  assert.ok(missing.some((b) => b.type === "banner" && b.text === FR.notFound));
});

test("panneau : la liste des fuseaux contient celui de l'événement même s'il n'est pas dans la liste habituelle", async () => {
  const ctx = ctxFor([doc({ title: "Loin", slug: "loin", tz: "Pacific/Chatham" })]);
  const id = stored(ctx)[0].id;
  const form = (await mod.adminPanel(ctx, { query: { edit: id } })).find((b) => b.action === "save");
  assert.equal(form.fields.find((f) => f.name === "tzOther").value, "Pacific/Chatham", "écrit dans « autre fuseau »");
  assert.ok(form.fields.find((f) => f.name === "tz").options.length >= Z.ZONES.length);
});

test("panneau : sans événement, une phrase d'accueil et un formulaire ; sans bruit", async () => {
  const panel = await mod.adminPanel(ctxFor(), { query: {} });
  assert.ok(panel.some((b) => b.type === "markdown" && b.text === FR.emptyAdmin));
  assert.ok(panel.some((b) => b.type === "adminForm"));
  assert.ok(!panel.some((b) => b.type === "table" || b.type === "download"));
});

test("panneau : réglages — l'explication « où l'afficher » est dans l'onglet des réglages", async () => {
  const panel = await mod.adminPanel(ctxFor(), { query: {} });
  const hint = panel.find((b) => b.tab === "settings");
  assert.match(hint.text, /Accueil/);
  assert.match(hint.text, /OBS/);
});

// ── Page publique ───────────────────────────────────────────────────────────────────────────────────────────────────

test("page : à la une d'abord, puis les suivants par date ; le message de fin pour celui dont l'heure vient de passer", async () => {
  const ctx = ctxFor([inMs(10 * DAY, { title: "Plus tard", slug: "plus-tard" }), inMs(2 * DAY, { title: "Bientôt", slug: "bientot" }), inMs(5 * DAY, { title: "Au milieu", slug: "milieu" }), inMs(-3 * HOUR, { title: "Vient de commencer", slug: "commence", endMessage: "C’est en ligne !", endLink: "https://example.org/live", endLinkLabel: "Regarder" })]);
  const page = await mod.page(ctx, { segments: [] });
  assert.equal(page.title, "Compte à rebours");
  const h = html(page.blocks);
  const order = ["Bientôt", "Au milieu", "Plus tard", "Vient de commencer"].map((t) => h.indexOf(`>${t}<`) !== -1 ? h.indexOf(`>${t}<`) : h.indexOf(t));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "ordre : à venir par date, puis ceux qui ont commencé");
  assert.match(h, /vcd--big/);
  assert.match(h, /Prochain rendez-vous/);
  assert.match(h, /C’est en ligne !/);
  assert.match(h, /href="https:\/\/example\.org\/live"[^>]*>Regarder</);
  assert.match(h, /Ajouter à mon agenda/);
});

test("page : sans JavaScript, chaque carte donne la date et l'heure dans le fuseau de l'événement et le nom de ce fuseau", async () => {
  const ctx = ctxFor([doc({ title: "Lancement", slug: "lancement", date: "2099-11-14", time: "21:00", tz: "Asia/Tokyo" })]);
  const h = html((await mod.page(ctx, { segments: [] })).blocks);
  assert.match(h, /<p class="vcd-when" data-vcd-event="">Samedi 14 novembre 2099 à 21 h \(heure normale du Japon\)<\/p>/);
  assert.match(h, /<noscript>|data-vcd-local="" hidden/, "la phrase locale est cachée tant que le script n'a pas tourné");
});

test("page : un événement a sa page, avec description, lieu, image et lien de retour", async () => {
  const ctx = ctxFor([inMs(3 * DAY, { title: "Grande convention", slug: "convention", description: "Trois jours\nde jeux", where: "Hall 4", image: "/uploads/affiche.png" })]);
  const page = await mod.page(ctx, { segments: ["convention"] });
  assert.equal(page.title, "Grande convention");
  assert.match(page.description, /heure d’Europe centrale|UTC/);
  const h = html(page.blocks);
  assert.match(h, /Trois jours\nde jeux/);
  assert.match(h, /<strong>Lieu :<\/strong> Hall 4/);
  assert.match(h, /<img class="vcd-img" src="\/uploads\/affiche\.png"/);
  assert.ok(page.blocks.some((b) => b.type === "links" && b.items[0].href === "/countdown"));
  assert.ok(!/<h3 class="vcd-title"/.test(h), "le titre est déjà celui de la page");
});

test("page : introuvable (404) pour un événement masqué, inconnu ou un chemin étrange", async () => {
  const ctx = ctxFor([inMs(-3 * DAY, { slug: "vieux" }), inMs(3 * DAY, { slug: "futur" })]);
  for (const segments of [["vieux"], ["inconnu"], ["a", "b"], ["page"], ["page", "0"], ["page", "2"], ["page", "x"], ["Futur!"], ["..", "x"]]) {
    const page = await mod.page(ctx, { segments });
    assert.equal(page.notFound, true, JSON.stringify(segments));
  }
  assert.notEqual((await mod.page(ctx, { segments: ["futur"] })).notFound, true);
});

test("page : sans événement, une phrase aimable ; titre réglable ; pagination par chemin", async () => {
  const empty = await mod.page(ctxFor(), { segments: [] });
  assert.equal(empty.blocks[0].text, FR.empty);
  const titled = await mod.page(ctxFor([], { settings: { pageTitle: "Mes rendez-vous" } }), { segments: [] });
  assert.equal(titled.title, "Mes rendez-vous");
  const many = ctxFor(Array.from({ length: 45 }, (_, i) => inMs((i + 1) * DAY, { title: `E${i}`, slug: `e${i}` })));
  const p1 = await mod.page(many, { segments: [] });
  const p3 = await mod.page(many, { segments: ["page", "3"] });
  assert.equal((html(p1.blocks).match(/<article/g) ?? []).length, M.PER_PAGE);
  assert.equal((html(p3.blocks).match(/<article/g) ?? []).length, 5);
  assert.deepEqual(p1.blocks.at(-1).items.map((l) => l.href), ["/countdown/page/2"]);
  assert.deepEqual(p3.blocks.at(-1).items.map((l) => l.href), ["/countdown/page/2"]);
  assert.equal((await mod.page(many, { segments: ["page", "4"] })).notFound, true);
});

test("page : en anglais, les phrases sont en anglais (et les liens gardent le préfixe de langue)", async () => {
  const ctx = ctxFor([inMs(3 * DAY, { title: "Launch", slug: "launch" })], { locale: "en", messages: EN });
  const page = await mod.page(ctx, { segments: [] });
  const h = html(page.blocks);
  assert.equal(page.title, "Countdown");
  assert.match(h, /Next date/);
  assert.match(h, /Add to my calendar/);
  assert.match(h, /\(UTC|Greenwich|GMT/);
  assert.match(h, /See the event page/);
  assert.match(h, /href="\/en\/countdown\/launch"/);
});

test("disparition : évaluée à la lecture, sans minuteur — le même stockage donne un autre affichage à un autre moment", async () => {
  const start = Date.now() + 10 * MIN;
  const d = new Date(start);
  const row = doc({ title: "Passager", slug: "passager", date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), tz: "UTC", keep: "1h" });
  const ctx = ctxFor([row]);
  const at = async (now) => M.visible(await M.readAll(ctx, now)).map((v) => v.phase);
  const startMs = M.view(M.read({ id: "x", data: row }), "1d", 0).startMs;
  assert.deepEqual(await at(startMs - 1), ["upcoming"]);
  assert.deepEqual(await at(startMs + 59 * MIN), ["started"]);
  assert.deepEqual(await at(startMs + 60 * MIN), []);
  assert.equal(ctx.calls.writes.length, 0, "lire ne modifie jamais rien");
});

// ── Accueil ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("accueil : le compte à rebours à la une — choisi, sinon le prochain ; rien du tout quand il n'y en a pas", async () => {
  const none = await mod.sections.featured(ctxFor(), {});
  assert.equal(none, null, "la section disparaît");
  const auto = ctxFor([inMs(9 * DAY, { title: "Loin", slug: "loin" }), inMs(2 * DAY, { title: "Proche", slug: "proche" })]);
  assert.match(html(await mod.sections.featured(auto, {})), /Proche/);
  const chosen = ctxFor([inMs(9 * DAY, { title: "Loin", slug: "loin", featured: true }), inMs(2 * DAY, { title: "Proche", slug: "proche" })]);
  const h = html(await mod.sections.featured(chosen, {}));
  assert.match(h, /Loin/);
  assert.ok(!/Proche/.test(h));
  assert.match(h, /href="\/countdown\/loin"/);
  const hiddenChosen = ctxFor([inMs(-5 * DAY, { title: "Fini", slug: "fini", featured: true }), inMs(2 * DAY, { title: "Proche", slug: "proche" })]);
  assert.match(html(await mod.sections.featured(hiddenChosen, {})), /Proche/, "un choix périmé retombe sur le prochain");
});

test("accueil : après l'heure, la section montre le message de fin jusqu'à la disparition, puis laisse la place", async () => {
  const live = ctxFor([inMs(-2 * HOUR, { title: "En cours", slug: "en-cours" })]);
  const h = html(await mod.sections.featured(live, {}));
  assert.match(h, /C’est maintenant/);
  assert.match(h, /<div class="vcd-end" data-vcd-end="">/);
  const over = ctxFor([inMs(-2 * DAY, { title: "Fini", slug: "fini" })]);
  assert.equal(await mod.sections.featured(over, {}), null);
});

test("accueil : les prochains événements — nombre réglable, sans répéter celui qui est à la une", async () => {
  const ctx = ctxFor(Array.from({ length: 6 }, (_, i) => inMs((i + 1) * DAY, { title: `E${i + 1}`, slug: `e${i + 1}` })));
  const titles = (blocks) => [...html(blocks).matchAll(/class="vcd-title"><a [^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(titles(await mod.sections.upcoming(ctx, { count: 3 })), ["E2", "E3", "E4"]);
  assert.deepEqual(titles(await mod.sections.upcoming(ctx, { count: 2, skipFeatured: false })), ["E1", "E2"]);
  assert.equal(titles(await mod.sections.upcoming(ctx, {})).length, 3, "3 par défaut");
  assert.equal(titles(await mod.sections.upcoming(ctx, { count: 999 })).length, 5, "10 au plus, et il n'en reste que 5");
  assert.equal(titles(await mod.sections.upcoming(ctx, { count: "abc" })).length, 3);
  assert.equal(await mod.sections.upcoming(ctxFor([inMs(DAY, { slug: "seul" })]), { count: 3 }), null, "un seul événement : déjà à la une");
  const out = await mod.sections.upcoming(ctx, { count: 2 });
  assert.equal(out[0].type, "heading");
  assert.deepEqual(out.at(-1).items, [{ label: "Voir tous les comptes à rebours", href: "/countdown" }]);
});

test("accueil et page : sans page publique (aucun chemin), aucun lien cassé", async () => {
  const ctx = ctxFor([inMs(2 * DAY, { slug: "a" }), inMs(3 * DAY, { slug: "b" }), inMs(4 * DAY, { slug: "c" })], { basePath: null });
  const f = html(await mod.sections.featured(ctx, {}));
  assert.ok(!/href="\/?countdown|href="null/.test(f));
  const up = await mod.sections.upcoming(ctx, {});
  assert.ok(!up.some((b) => b.type === "links"));
});

// ── Sécurité des textes ─────────────────────────────────────────────────────────────────────────────────────────────

const EVIL = `</script><img src=x onerror=alert(1)><script>alert(2)</script>"'&`;

test("aucun texte saisi n'est jamais rendu tel quel (page, accueil, source OBS, script)", async () => {
  const evil = inMs(2 * DAY, { title: EVIL.slice(0, 80), slug: "evil", description: EVIL, where: EVIL, endMessage: EVIL, endLinkLabel: EVIL, endLink: "https://example.org/?a=1&b=\"2\"", image: "/uploads/x.png" });
  const ctx = ctxFor([evil], { settings: { endMessage: EVIL, pageTitle: EVIL, keep: "1d", timezone: "Europe/Paris" }, name: EVIL });
  const outputs = [
    html((await mod.page(ctx, { segments: [] })).blocks),
    html((await mod.page(ctx, { segments: ["evil"] })).blocks),
    html(await mod.sections.featured(ctx, {})),
    html(await mod.sections.upcoming(ctxFor([evil, inMs(3 * DAY, { slug: "z" })], { name: EVIL }), { skipFeatured: false })),
  ];
  const ov = await mod.overlay(ctx, { query: new URLSearchParams() });
  outputs.push(ov.html, ov.css);
  for (const out of outputs) {
    assert.ok(!/<img src=x|<script>alert/i.test(out), out.slice(0, 200));
    assert.ok(!/<(?:img|script)\b[^>]*onerror/i.test(out));
    assert.ok(!out.includes("</script>"), "aucune fin de script littérale dans un texte");
  }
  assert.ok(!/<\/script/i.test(ov.script), "ni dans le script de la source OBS");
  assert.ok(!/<!--/.test(ov.script));
  const page = await mod.page(ctx, { segments: [] });
  assert.equal(page.title, EVIL, "le titre est une donnée : la page l'échappe elle-même");
});

test("un lien dangereux saisi n'est jamais repris, même s'il était déjà dans le stockage", async () => {
  const ctx = ctxFor([inMs(-2 * HOUR, { slug: "x", endLink: "javascript:alert(1)", endLinkLabel: "Cliquez", image: "javascript:alert(1)" })]);
  const h = html((await mod.page(ctx, { segments: [] })).blocks) + html((await mod.page(ctx, { segments: ["x"] })).blocks);
  assert.ok(!/javascript:/i.test(h));
  assert.ok(!/Cliquez/.test(h), "pas de bouton sans adresse valide");
});

// ── Source navigateur pour OBS ──────────────────────────────────────────────────────────────────────────────────────

const initialOf = (o) => JSON.parse(o.script.match(/bootOverlay\(window,document,(\{.*\})\);\n\}\)\(\);$/s)[1]);

test("OBS : fond transparent, sobre ; l'événement à la une est déjà dans la page (pas d'attente)", async () => {
  const ctx = ctxFor([inMs(2 * DAY, { title: "Plus tard", slug: "p" }), inMs(HOUR, { title: "Bientôt", slug: "b" })]);
  const o = await mod.overlay(ctx, { query: new URLSearchParams() });
  assert.equal(o.title, "Compte à rebours");
  assert.match(o.css, /html,body\{margin:0;background:transparent!important;overflow:hidden\}/);
  assert.ok(!/<(h1|img|a) /.test(o.html), "pas d'habillage");
  assert.ok(!o.html.includes("Bientôt"), "le HTML est statique : aucun texte saisi");
  const cfg = initialOf(o);
  assert.equal(cfg.initial.event.title, "Bientôt");
  assert.equal(cfg.initial.event.slug, "b");
  assert.equal(cfg.stateUrl, `/m/${ctx.instance.key}/state?lang=fr`);
  assert.equal(cfg.secs, true);
  assert.equal(cfg.poll, 30_000);
  assert.equal(cfg.initial.event.message, "C’est parti !");
  assert.ok(Math.abs(cfg.initial.now - Date.now()) < 5_000);
});

test("OBS : un événement précis par son nom (?e=), sinon la une ; un nom inconnu ou masqué ne montre rien", async () => {
  const ctx = ctxFor([inMs(2 * DAY, { title: "Plus tard", slug: "plus-tard" }), inMs(HOUR, { title: "Bientôt", slug: "bientot" }), inMs(-3 * DAY, { title: "Vieux", slug: "vieux" })]);
  const of = async (q) => initialOf(await mod.overlay(ctx, { query: new URLSearchParams(q) }));
  assert.equal((await of("e=plus-tard")).initial.event.title, "Plus tard");
  assert.equal((await of("e=plus-tard")).stateUrl, `/m/${ctx.instance.key}/state?lang=fr&e=plus-tard`);
  assert.equal((await of("e=inconnu")).initial.event, null);
  assert.equal((await of("e=vieux")).initial.event, null);
  assert.equal((await of("e=%3Cscript%3E")).initial.event.title, "Bientôt", "un nom invalide est ignoré : on montre la une");
  assert.equal((await of("e=%3Cscript%3E")).stateUrl.includes("script"), false);
});

test("OBS : après l'heure, le message reste le temps réglé, puis la source passe à l'événement suivant", async () => {
  const ctx = ctxFor([inMs(-2 * MIN, { title: "Juste parti", slug: "parti", endMessage: "Go !" }), inMs(DAY, { title: "Demain", slug: "demain" })]);
  const first = initialOf(await mod.overlay(ctx, { query: new URLSearchParams() }));
  assert.equal(first.initial.event.title, "Juste parti");
  assert.equal(first.initial.event.message, "Go !");
  const startMs = first.initial.event.start;
  assert.equal(first.initial.event.hideAt, startMs + 5 * MIN, "5 minutes par défaut");
  const late = ctxFor([inMs(-6 * MIN, { title: "Parti il y a longtemps", slug: "p" }), inMs(DAY, { title: "Demain", slug: "demain" })]);
  assert.equal(initialOf(await mod.overlay(late, { query: new URLSearchParams() })).initial.event.title, "Demain");
  const long = ctxFor([inMs(-6 * MIN, { title: "Encore là", slug: "p" })], { settings: { keep: "1d", overlayEndMinutes: 30 } });
  assert.equal(initialOf(await mod.overlay(long, { query: new URLSearchParams() })).initial.event.title, "Encore là");
});

test("OBS : sans événement, une page vide et transparente", async () => {
  const o = await mod.overlay(ctxFor(), { query: new URLSearchParams() });
  assert.equal(initialOf(o).initial.event, null);
  assert.match(o.html, /id="vco"[^>]*hidden/);
});

test("OBS : style, place, taille, couleur — valeurs sensées, valeurs absurdes ignorées (aucune injection de style)", async () => {
  const css = async (settings) => (await mod.overlay(ctxFor([], { settings: { keep: "1d", ...settings } }), { query: new URLSearchParams() })).css;
  const base = await css({});
  assert.match(base, /top:2\.5vmin;left:50%;transform:translateX\(-50%\)/);
  assert.match(base, /font-size:22px/);
  assert.match(base, /--vco-accent:#e8a23b/, "la couleur du thème du site");
  assert.match(await css({ overlayPosition: "bottom-right", overlaySize: "l", overlayAccent: "#112233" }), /bottom:2\.5vmin;right:2\.5vmin[^}]*font-size:32px[^}]*--vco-accent:#112233/);
  for (const evil of ["red;}body{display:none", "url(javascript:1)", "#12345", 5, null]) assert.match(await css({ overlayAccent: evil }), /--vco-accent:#e8a23b/, String(evil));
  assert.match(await css({ overlayPosition: "x;}body{display:none" }), /top:2\.5vmin;left:50%/);
  const look = async (v) => (await mod.overlay(ctxFor([], { settings: { overlayLook: v } }), { query: new URLSearchParams() })).html.match(/vco--(\w+)/)[1];
  assert.equal(await look("light"), "light");
  assert.equal(await look("bare"), "bare");
  assert.equal(await look("bizarre"), "dark");
  assert.match(base, /prefers-reduced-motion:no-preference\)\{\.vco-box\{animation/, "l'apparition est animée seulement si la personne ne demande pas moins de mouvement");
  assert.match(base, /prefers-reduced-motion:reduce\)\{\.vco \*\{animation:none!important/);
});

test("OBS : les secondes suivent le réglage", async () => {
  const o = await mod.overlay(ctxFor([], { settings: { showSeconds: false } }), { query: new URLSearchParams() });
  assert.equal(initialOf(o).secs, false);
});

// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const get = (route, ctx, q = "", init) => mod.routes[route](new Request(`https://example.test/m/${ctx.instance.key}/${route}${q}`, init), ctx);

test("route state : ce que demande la source OBS — même choix que la page, jamais d'écriture, jamais mis en cache", async () => {
  const ctx = ctxFor([inMs(HOUR, { title: "Bientôt", slug: "bientot" }), inMs(3 * DAY, { title: "Loin", slug: "loin" })]);
  const res = await get("state", ctx);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.event.title, "Bientôt");
  assert.ok(Math.abs(body.now - Date.now()) < 5_000);
  assert.equal((await (await get("state", ctx, "?e=loin")).json()).event.title, "Loin");
  assert.equal((await (await get("state", ctx, "?e=nope")).json()).event, null);
  assert.equal(ctx.calls.writes.length, 0);
  assert.equal((await get("state", ctx, "", { method: "POST" })).status, 405);
  assert.equal((await get("state", ctx, "", { method: "DELETE" })).status, 405);
});

test("route now : l'heure du serveur, sans cache ; limite de demandes par visiteur", async () => {
  const ctx = ctxFor();
  const res = await get("now", ctx);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(Math.abs((await res.json()).now - Date.now()) < 5_000);
  assert.equal((await get("now", ctx, "", { method: "PUT" })).status, 405);
  let last;
  for (let i = 0; i < 130; i++) last = await get("now", ctx, "", { headers: { "x-forwarded-for": "198.51.100.4" } });
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("retry-after"), "60");
});

test("route live.js : le script des visiteurs, gardé longtemps, jamais exécuté côté serveur ; même empreinte partout", async () => {
  const a = await get("live.js", ctxFor());
  assert.equal(a.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(a.headers.get("cache-control"), /immutable/);
  assert.equal(a.headers.get("x-content-type-options"), "nosniff");
  const text = await a.text();
  assert.ok(text.startsWith('(function(){"use strict";if(window.__vcdOn)return;'));
  assert.ok(text.length < 20_000, `script léger (${text.length} octets)`);
  assert.ok(!/localStorage|sessionStorage|document\.cookie|XMLHttpRequest|navigator\.sendBeacon|innerHTML|document\.write/.test(text), "ni suivi, ni stockage, ni HTML injecté");
  assert.equal((await get("live.js", ctxFor(), "", { method: "POST" })).status, 405);
});

test("emplacement d'en-tête : le script n'est chargé que s'il y a des événements, avec une empreinte qui change avec le code", async () => {
  assert.equal(await mod.slots["layout.head"](ctxFor()), null);
  const ctx = ctxFor([inMs(DAY, { slug: "a" })]);
  const [block] = await mod.slots["layout.head"](ctx);
  assert.equal(block.type, "head");
  assert.equal(block.tags.length, 1);
  assert.match(block.tags[0].src, new RegExp(`^/m/${ctx.instance.key}/live\\.js\\?v=[0-9a-f]{10}$`));
  assert.equal(block.tags[0].defer, true);
  const [again] = await mod.slots["layout.head"](ctxFor([inMs(DAY, { slug: "b" })]));
  assert.equal(again.tags[0].src.split("?v=")[1], block.tags[0].src.split("?v=")[1], "même code, même empreinte");
});

// ── Vie privée et volume ────────────────────────────────────────────────────────────────────────────────────────────

test("vie privée : lire une page, l'accueil, le fichier d'agenda ou la source OBS n'écrit rien et ne garde aucune adresse", async () => {
  const ctx = ctxFor([inMs(DAY, { title: "A", slug: "a" })]);
  const before = JSON.stringify(ctx.dumpStore());
  await mod.page(ctx, { segments: [] });
  await mod.page(ctx, { segments: ["a"] });
  await mod.sections.featured(ctx, {});
  await mod.sections.upcoming(ctx, {});
  await mod.overlay(ctx, { query: new URLSearchParams() });
  await get("ics", ctx, "?e=a", { headers: { "x-forwarded-for": "203.0.113.77", "user-agent": "Mozilla" } });
  await get("state", ctx, "", { headers: { "x-forwarded-for": "203.0.113.77" } });
  await get("now", ctx, "", { headers: { "x-forwarded-for": "203.0.113.77" } });
  assert.equal(ctx.calls.writes.length, 0);
  assert.equal(JSON.stringify(ctx.dumpStore()), before);
  assert.equal(manifest.privacy, undefined, "aucune donnée de visiteur : rien à déclarer");
  assert.equal(ctx.calls.mail.length, 0);
});

test("volume : 100 événements — la page, l'accueil et la source OBS lisent une seule fois, avec une borne", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => inMs((i + 3) * HOUR, { title: `E${i}`, slug: `e${i}` }));
  const ctx = ctxFor(rows);
  const reads = [];
  const list = ctx.api.store.list;
  ctx.api.store = { ...ctx.api.store, list: (c, o) => { reads.push(o?.limit); return list(c, o); } };
  const started = performance.now();
  await mod.page(ctx, { segments: [] });
  await mod.sections.featured(ctx, {});
  await mod.sections.upcoming(ctx, {});
  await mod.overlay(ctx, { query: new URLSearchParams() });
  assert.deepEqual(reads, [120, 120, 120, 120]);
  assert.ok(performance.now() - started < 1500, "rapide");
});

test("sauvegarde lisible : un tableau et un fichier d'agenda, tableur protégé contre les formules", async () => {
  const ctx = ctxFor([doc({ title: "=HYPERLINK(\"http://x\")", slug: "a", description: "+cmd|' /C calc'!A0", where: "@SUM(1)", date: "2099-11-14", time: "21:00" }), doc({ title: "Normal, avec \"guillemets\"", slug: "b", date: "2099-12-01", time: "10:00", allDay: false })]);
  const files = await mod.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["events.csv", "events.ics"]);
  const csv = files[0].content;
  assert.ok(csv.startsWith('"title","date","time"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
  assert.ok(csv.includes(`"'+cmd|' /C calc'!A0"`));
  assert.ok(csv.includes(`"'@SUM(1)"`));
  assert.ok(csv.includes('"Normal, avec ""guillemets"""'));
  assert.equal(validateIcs(files[1].content).length, 2);
  assert.equal((await mod.backup.readable(ctxFor()))[0].content.trim().split("\r\n").length, 1, "sans événement : seulement les titres des colonnes");
});

test("téléchargement de l'administration : un fichier d'agenda complet, ligne par ligne", async () => {
  const ctx = ctxFor([inMs(DAY, { slug: "a", title: "Un" }), inMs(-3 * DAY, { slug: "b", title: "Deux" })]);
  let text = "";
  for await (const chunk of mod.adminDownloads.calendar.generate(ctx)) text += chunk;
  assert.deepEqual(validateIcs(text).map((e) => e.summary).sort(), ["Deux", "Un"], "les événements masqués y sont aussi : c'est une sauvegarde");
  assert.equal(mod.adminDownloads.calendar.filename(), "evenements.ics");
});

// ── Outils pour les assistants (MCP) ────────────────────────────────────────────────────────────────────────────────

const valid = (name, args) => {
  try { return { ok: true, value: validateArgs(manifest.mcp.find((a) => a.name === name).input, args) }; } catch (e) { return { ok: false, message: e.message }; }
};

test("assistants : créer un événement lointain avec son fuseau — l'heure universelle exacte est rendue", async () => {
  assert.equal(valid("event_create", { title: "Sortie", date: "2099-07-14", time: "20:00", timezone: "Asia/Kolkata" }).ok, true);
  const ctx = ctxFor();
  const r = await mod.mcp.event_create(ctx, { title: "Sortie", date: "2099-07-14", time: "20:00", timezone: "Asia/Kolkata", end_message: "Go", keep: "3d", featured: true });
  assert.equal(r.ok, true);
  assert.equal(r.event.starts_at_utc, "2099-07-14T14:30:00.000Z");
  assert.equal(r.event.timezone, "Asia/Kolkata");
  assert.equal(r.event.state, "upcoming");
  assert.equal(r.event.keep, "3d");
  assert.equal(r.event.featured, true);
  assert.equal(r.event.name, "sortie");
  assert.deepEqual(r.notes, []);
});

test("assistants : changement d'heure signalé ; erreurs lisibles (messages exposés), sans détail interne", async () => {
  const ctx = ctxFor();
  const r = await mod.mcp.event_create(ctx, { title: "Nuit", date: "2099-03-29", time: "02:30", timezone: "Europe/Paris" });
  assert.equal(r.event.warning, "This time does not exist on that day (clocks go forward): the next valid time is used.");
  assert.match(r.notes[0], /n’existe pas/);
  await assert.rejects(() => mod.mcp.event_create(ctx, { title: "X", date: "2099-02-30", time: "10:00" }), (e) => e.expose === true && /Choisissez un jour/.test(e.message));
  await assert.rejects(() => mod.mcp.event_create(ctx, { title: "X", date: "2099-01-01", time: "10:00", timezone: "Mars/Olympus" }), (e) => e.expose === true && /Asia\/Tokyo/.test(e.message));
  await assert.rejects(() => mod.mcp.event_update(ctx, { id: "inconnu", title: "Y" }), (e) => e.expose === true);
  await assert.rejects(() => mod.mcp.event_delete(ctx, { id: "inconnu" }), (e) => e.expose === true);
});

test("assistants : modifier ne change que ce qui est donné ; mettre à la une ; supprimer", async () => {
  const ctx = ctxFor();
  const a = (await mod.mcp.event_create(ctx, { title: "A", date: "2099-07-14", time: "20:00", timezone: "Asia/Tokyo", description: "Texte", location: "Twitch" })).event;
  const b = (await mod.mcp.event_create(ctx, { title: "B", date: "2099-08-14", time: "20:00" })).event;
  const upd = await mod.mcp.event_update(ctx, { id: a.id, date: "2099-07-15" });
  assert.equal(upd.event.date, "2099-07-15");
  assert.equal(upd.event.time, "20:00");
  assert.equal(upd.event.timezone, "Asia/Tokyo", "le fuseau est conservé");
  assert.equal(upd.event.description, "Texte");
  assert.equal(upd.event.location, "Twitch");
  assert.equal(stored(ctx).find((e) => e.id === a.id).uid, stored(ctx).find((e) => e.id === a.id).uid);
  assert.equal(stored(ctx).find((e) => e.id === a.id).rev, 2);
  assert.equal((await mod.mcp.event_set_featured(ctx, { id: b.id })).ok, true);
  const list = await mod.mcp.events_list(ctx, {});
  assert.deepEqual(list.map((e) => e.title), ["A", "B"]);
  assert.equal(list.find((e) => e.title === "B").featured, true);
  assert.equal(list.find((e) => e.title === "B").shown_first, true);
  assert.equal((await mod.mcp.event_delete(ctx, { id: a.id })).ok, true);
  assert.deepEqual((await mod.mcp.events_list(ctx, {})).map((e) => e.title), ["B"]);
});

test("assistants : la liste ne montre que ce que voient les visiteurs, sauf demande explicite pour les masqués", async () => {
  const ctx = ctxFor([inMs(DAY, { title: "Futur", slug: "f" }), inMs(-3 * DAY, { title: "Masqué", slug: "m" })]);
  assert.deepEqual((await mod.mcp.events_list(ctx, {})).map((e) => e.title), ["Futur"]);
  const all = await mod.mcp.events_list(ctx, { include_hidden: true });
  assert.deepEqual(all.map((e) => e.title), ["Futur", "Masqué"]);
  assert.equal(all[1].state, "hidden");
  assert.ok(all.every((e) => !("uid" in e) && !JSON.stringify(e).includes("@curiosa")));
});

test("assistants : les arguments inconnus ou trop longs sont refusés par le schéma", () => {
  for (const [name, bad] of [["event_create", { title: "x".repeat(81), date: "2099-01-01" }], ["event_create", { title: "x", date: "2099-01-01", surprise: 1 }], ["event_create", { date: "2099-01-01" }], ["event_create", { title: "x", date: "2099-01-01", keep: "toujours" }], ["event_update", { title: "x" }], ["event_delete", {}]]) {
    const r = valid(name, bad);
    assert.equal(r.ok, false, `${name} ${JSON.stringify(bad)}`);
  }
  assert.equal(valid("event_create", { title: "x", date: "2099-01-01" }).ok, true);
});

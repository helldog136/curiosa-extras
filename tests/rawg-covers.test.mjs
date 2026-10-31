// Jaquettes RAWG : recherche, rattrapage des suggestions sans image (module game-suggestions), jaquettes du planning. Aucun accès au réseau : `fetch` est injecté.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { parseManifest } from "@/core/modules/manifest";
import { feedTopics } from "./helpers/icalFeed.mjs";

const gsMod = await import("../modules/game-suggestions/index.mjs");
const gs = gsMod.default;
const plMod = await import("../modules/planning/index.mjs");
const pl = plMod.default;
const readJson = (p) => JSON.parse(fs.readFileSync(new URL(`../modules/${p}`, import.meta.url), "utf8"));
const gsMsg = readJson("game-suggestions/locales/fr.json");
const plMsg = readJson("planning/locales/fr.json");

const IMG = "https://media.rawg.io/media/games/x.jpg";
const NOW = Date.parse("2026-03-10T12:00:00Z");
const DAY = 86_400_000;
let n = 0;

/** Faux service du cœur : answers = { titre: statut | { status, url } | Error } ; `configured` réglable à la volée ; `calls` = les titres demandés. */
const service = (answers = {}, state = { configured: true }) => {
  const calls = [];
  return {
    calls, state,
    configured: async () => state.configured,
    cover: async (title) => {
      calls.push(title);
      const a = answers[title] ?? "none";
      if (a instanceof Error) throw a;
      return typeof a === "string" ? { status: a, url: a === "found" ? IMG : null } : a;
    },
  };
};
/** Contexte de game-suggestions : le service RAWG du cœur est le seul moyen d'obtenir une jaquette (aucun `fetch` direct). */
const gsCtx = (svc = service()) => { const c = fakeCtx({ key: `gs${++n}`, basePath: "suggestions", messages: gsMsg, settings: {}, locale: "fr" }); c.api.rawg = svc; return c; };
const addGame = (c, title, extra = {}) => c.api.store.add("games", { title, status: "proposed", replayVotes: 0, coverUrl: null, ...extra });
const game = async (c, id) => (await c.api.store.get(id)).data;
const run = (c, opts = {}) => gsMod.catchUpCovers(c, { now: NOW, pauseMs: 0, ...opts });
const noDirectFetch = () => { const orig = globalThis.fetch; let direct = 0; globalThis.fetch = async () => { direct++; throw new Error("pas de réseau direct"); }; return { count: () => direct, restore: () => { globalThis.fetch = orig; } }; };

/* ───────────── game-suggestions : le module ne parle jamais à RAWG lui-même ───────────── */

test("game-suggestions : aucun appel direct à RAWG (ni adresse, ni fetch, ni clé lue) dans le code", () => {
  const src = fs.readFileSync(new URL("../modules/game-suggestions/index.mjs", import.meta.url), "utf8");
  assert.ok(!/api\.rawg\.io|fetch\(|fetchImpl|ctx\.setting\("rawgApiKey"\)|createHash/.test(src));
  assert.ok(!("lookupCover" in gsMod) && !("fetchCover" in gsMod), "plus de recherche directe exportée");
});

/* ───────────── game-suggestions : rattrapage ───────────── */

test("rattrapage : les suggestions sans jaquette (migrées ou restaurées) la reçoivent ; celles qui en ont déjà ne sont pas redemandées", async () => {
  const svc = service({ Celeste: "found", "Inconnu Total": "none" });
  const c = gsCtx(svc);
  const a = await addGame(c, "Celeste");
  const b = await addGame(c, "Hades", { coverUrl: IMG.replace("x.", "h.") });
  const d = await addGame(c, "Inconnu Total");
  const r = await run(c);
  assert.deepEqual([r.status, r.found, r.none, r.left, r.missing], ["done", 1, 1, 0, 2]);
  assert.equal((await game(c, a)).coverUrl, IMG);
  assert.equal((await game(c, a)).coverResult, "found");
  assert.equal((await game(c, b)).coverUrl, IMG.replace("x.", "h."));
  assert.equal((await game(c, d)).coverUrl, null);
  assert.equal((await game(c, d)).coverResult, "none");
  assert.equal((await game(c, d)).coverCheckedAt, new Date(NOW).toISOString());
  assert.deepEqual([...svc.calls].sort(), ["Celeste", "Inconnu Total"]);
  assert.equal((await run(gsCtx())).status, "nothing", "rien de manquant : rien à faire");
});

test("rattrapage : aucune clé n'est lue, enregistrée ni journalisée (le module ne la voit jamais)", async () => {
  const c = gsCtx(service({ Celeste: "found" }));
  await addGame(c, "Celeste");
  await run(c);
  const all = JSON.stringify([...(await c.api.store.list("games")), ...(await c.api.store.list("state"))]);
  assert.ok(!/key|clé|SECRET/i.test(JSON.stringify(await c.api.store.list("state"))), "l'état gardé ne contient ni clé ni empreinte");
  assert.ok(!all.includes("keyFp"));
});

test("rattrapage après restauration : tout vient des données de l'instance (aucune mémoire du module), même avec un autre contexte et une autre date", async () => {
  const c = gsCtx(service({ Inconnu: "found" }));
  const id = await addGame(c, "Inconnu", { coverCheckedAt: new Date(NOW - 1 * DAY).toISOString(), coverResult: "none", coverKey: "pas-la-clé", coverTries: 3 });
  // Données restaurées : essai fait à une autre « époque » → on réessaie tout de suite ; le compteur repart de zéro.
  assert.equal((await run(c)).found, 1);
  assert.equal((await game(c, id)).coverTries, 1);
  // Mêmes données relues par un « nouveau processus » (aucun état gardé en mémoire entre les appels) : pas de nouvelle demande avant le délai.
  const quiet = service({ Rien: "found" });
  const c2 = gsCtx(quiet);
  const id2 = await addGame(c2, "Rien", { coverCheckedAt: new Date(NOW).toISOString(), coverResult: "none", coverKey: "core", coverTries: 1 });
  await run(c2, { now: NOW + 1 * DAY });
  assert.equal(quiet.calls.length, 0, "moins de 3 jours après l'essai : RAWG n'est pas redemandé");
  await run(c2, { now: NOW + 3 * DAY });
  assert.equal((await game(c2, id2)).coverUrl, IMG, "après 3 jours : nouvel essai");
});

test("pas de marteau : délais croissants entre essais (3, 7, 14, 30 jours), plafond de 5 essais, aucun passage ne dépasse 5 titres", async () => {
  const svc = service({});
  const c = gsCtx(svc);
  const id = await addGame(c, "Introuvable");
  let t = NOW;
  await run(c, { now: t });                                     // essai 1
  const waits = [3, 7, 14, 30];
  for (const w of waits) {
    const before = svc.calls.length;
    await run(c, { now: t + w * DAY - 1000 });                  // trop tôt
    assert.equal(svc.calls.length, before, `pas de demande ${w} j - 1 s après le précédent essai`);
    t += w * DAY;
    await run(c, { now: t });                                   // à l'heure
    assert.equal(svc.calls.length, before + 1, `une demande après ${w} jours`);
  }
  assert.equal((await game(c, id)).coverTries, 5);
  const calls = svc.calls.length;
  await run(c, { now: t + 400 * DAY });
  assert.equal(svc.calls.length, calls, "plafond atteint : la tâche renonce");
  // Le bouton de l'admin peut quand même réessayer.
  await run(c, { now: t + 400 * DAY, force: true });
  assert.equal(svc.calls.length, calls + 1);
  // Par passage : 5 titres au plus.
  const fb = service({});
  const big = gsCtx(fb);
  for (let i = 0; i < 12; i++) await addGame(big, `Jeu ${i}`);
  const r = await run(big);
  assert.equal(fb.calls.length, 5);
  assert.equal(r.left, 7);
  assert.equal((await run(big)).left, 2, "le passage suivant prend les cinq suivants (les essayés passent après)");
  assert.equal(fb.calls.length, 10);
});

test("clé absente : message clair, aucune demande, rien de modifié", async () => {
  const svc = service({ Celeste: "found" }, { configured: false });
  const c = gsCtx(svc);
  const id = await addGame(c, "Celeste");
  assert.equal((await run(c)).status, "no_key");
  assert.equal(svc.calls.length, 0);
  assert.equal((await game(c, id)).coverCheckedAt, undefined, "pas marqué « essayé » : il le sera dès qu'une clé existe");
  const res = await gs.adminActions.findCovers(c);
  assert.match(res.error, /Aucune clé RAWG/);
  assert.ok(!res.ok);
  assert.match(JSON.stringify(await gs.adminPanel(c)), /aucune clé RAWG/);
});

test("panne réseau ou 5xx (« injoignable ») : on s'arrête sans rien marquer ni lever d'erreur", async () => {
  for (const answer of ["unreachable", new Error("réseau coupé")]) {
    const svc = service({ A: answer, B: answer });
    const c = gsCtx(svc);
    const ids = [await addGame(c, "A"), await addGame(c, "B")];
    const r = await run(c);
    assert.equal(r.status, "down");
    assert.equal(svc.calls.length, 1);
    for (const id of ids) assert.equal((await game(c, id)).coverResult, undefined, "une panne n'est pas « sans résultat » et ne consomme pas un essai");
  }
});

test("titres trouvés avant une panne sont gardés ; le bilan du bouton le dit", async () => {
  const c = gsCtx(service({ B: "found", A: new Error("coupure") }));
  await addGame(c, "A"); await new Promise((r) => setTimeout(r, 2)); await addGame(c, "B");
  const r = await run(c, { force: true });                      // le plus récent (B) est traité en premier
  assert.equal(r.found + r.none, 1);
  assert.equal(r.status, "down");
  assert.match((await gs.adminActions.findCovers(c)).error, /injoignable|Déjà trouvées/);
});

test("bouton « Rechercher les jaquettes manquantes » : bilan en langage simple (trouvées / sans résultat / reste à faire), ignore les délais", async () => {
  const c = gsCtx(service({ Celeste: "found" }));
  await addGame(c, "Celeste");
  await addGame(c, "Zzz", { coverCheckedAt: new Date().toISOString(), coverResult: "none", coverKey: "autre", coverTries: 1 });
  const guard = noDirectFetch();
  try {
    const res = await gs.adminActions.findCovers(c);
    assert.match(res.ok, /1 jaquette\(s\) trouvée\(s\), 1 sans résultat/);
    assert.ok(!res.error);
    assert.match((await gs.adminActions.findCovers(gsCtx())).ok, /Toutes les suggestions ont une jaquette/);
    const many = gsCtx(); for (let i = 0; i < 30; i++) await addGame(many, `J${i}`);
    assert.match((await gs.adminActions.findCovers(many)).ok, /Il en reste 5 à essayer/);
    assert.equal(guard.count(), 0);
  } finally { guard.restore(); }
});

test("tâche planifiée déclarée, sans erreur sur une instance vide ; une erreur de RAWG ne la fait jamais échouer", async () => {
  assert.ok(gs.tasks.covers.everyMinutes >= 1 && typeof gs.tasks.covers.run === "function");
  await gs.tasks.covers.run(gsCtx());
  const c = gsCtx(service({ A: new Error("hors ligne") })); await addGame(c, "A");
  await gs.tasks.covers.run(c);
  assert.equal((await game(c, (await c.api.store.list("games"))[0].id)).coverUrl, null);
});

test("admin : colonne jaquette, compteur des manquantes, bouton ; rien d'affiché si tout est complet", async () => {
  const c = gsCtx();
  await addGame(c, "Avec", { coverUrl: IMG }); await addGame(c, "Sans");
  const blocks = await gs.adminPanel(c);
  assert.ok(!blocks.some((b) => b.type === "banner" || b.type === "suggestInstall"), "clé présente : aucun bandeau");
  assert.ok(blocks.some((b) => b.type === "table"));
  const form = blocks.find((b) => b.type === "adminForm" && b.action === "findCovers");
  assert.ok(form);
  assert.equal(form.submitLabel, "Rechercher les jaquettes manquantes");
  const table = blocks.find((b) => b.type === "table");
  assert.deepEqual(table.rows.map((r) => r[2]).sort(), ["—", "✓"]);
  assert.equal(table.rows.length, table.rowIds.length);
  const full = gsCtx(); await addGame(full, "Avec", { coverUrl: IMG });
  assert.ok(!(await gs.adminPanel(full)).some((b) => b.type === "adminForm" && b.action === "findCovers"));
});

test("admin : clé RAWG absente → bandeau en tête, même sans suggestion sans image, avec la proposition d'installer « Jaquettes de jeux » (ou le lien vers lui s'il est là) ; clé présente → aucun bandeau", async () => {
  const svc = service({}, { configured: false });
  const c = gsCtx(svc);
  await addGame(c, "Avec", { coverUrl: IMG });
  const blocks = await gs.adminPanel(c);
  assert.equal(blocks[0].type, "banner");
  assert.equal(blocks[0].tone, "warning");
  assert.match(blocks[0].text, /Aucune clé RAWG/);
  assert.equal(blocks[1].type, "suggestInstall");
  assert.equal(blocks[1].service, "game.cover");
  svc.state.configured = true;
  assert.ok(!(await gs.adminPanel(c)).some((b) => b.type === "banner"));
  const nosvc = fakeCtx({ key: "gsx", messages: gsMsg, settings: {}, locale: "fr" }); delete nosvc.api.rawg;
  assert.equal((await gs.adminPanel(nosvc))[0].type, "banner", "cœur sans service : comme sans clé, jamais d'exception");
});

test("game-suggestions : manifeste valide, version et données montées, permission rawg, clé RAWG du module seulement en legacySettings (secret, jamais affichée), textes fr/en alignés", () => {
  const m = readJson("game-suggestions/module.json");
  assert.ok(parseManifest(m).ok);
  assert.equal(m.version, "1.6.0");
  assert.equal(m.minCore, "0.5.0");   // 0.2.10 : lit `ambiguous` (lien « Ce n'est pas le bon jeu ? ») ; le service game.cover est un besoin facultatif, l'ancienne interface sert de repli
  assert.equal(m.dataVersion, 2);
  assert.ok(!m.settings.some((s) => s.key === "rawgApiKey"), "plus de champ visible");
  assert.deepEqual(m.legacySettings, [{ key: "rawgApiKey", secret: true }]);
  assert.deepEqual(m.permissions, ["pages", "routes", "storage", "admin", "mcp", "rawg"]);
  assert.deepEqual(Object.keys(readJson("game-suggestions/locales/fr.json")).sort(), Object.keys(readJson("game-suggestions/locales/en.json")).sort());
});

test("game-suggestions chargé comme le fait le cœur : la tâche et la migration sont reconnues", async () => {
  const { manifest, definition } = await loadModule("modules/game-suggestions");
  assert.ok(parseManifest(manifest).ok);
  assert.equal(typeof definition.tasks.covers.run, "function");
  assert.equal(typeof definition.migrations[manifest.dataVersion], "function");
});

/* ───────────── game-suggestions : migration de la clé RAWG du module (legacySettings) ───────────── */

const SECRET = "SECRET-RAWG-KEY-9f3a";
const migCtx = (legacy, svc = service()) => { const c = fakeCtx({ key: `gs${++n}`, migration: true, legacy, messages: gsMsg, settings: {}, locale: "fr" }); c.api.rawg = svc; return c; };

test("migration 2 : le site a sa clé → l'ancienne clé du module est effacée ; rejouée, elle ne fait rien de plus ; la valeur n'est ni lue pour l'usage ni journalisée", async () => {
  const c = migCtx({ rawgApiKey: SECRET });
  await gs.migrations[2](c);
  assert.deepEqual(c.calls.legacyCleared, ["rawgApiKey"]);
  await gs.migrations[2](c);
  assert.deepEqual(c.calls.legacyCleared, ["rawgApiKey"], "rejeu : rien de plus");
  assert.ok(!JSON.stringify([c.calls, await c.api.store.list("games"), await c.api.store.list("state")]).includes(SECRET));
});

test("migration 2 : le site n'a pas encore sa clé → l'ancienne reste (rien n'est perdu), inutilisée ; la tâche l'efface dès que la clé du site existe", async () => {
  const svc = service({}, { configured: false });
  const c = migCtx({ rawgApiKey: SECRET }, svc);
  await gs.migrations[2](c);
  assert.deepEqual(c.calls.legacyCleared, []);
  const guard = noDirectFetch();
  try {
    await addGame(c, "Celeste");
    await gs.tasks.covers.run(c);
    assert.equal(guard.count(), 0, "la clé du module n'est jamais utilisée pour appeler RAWG");
    assert.deepEqual(c.calls.legacyCleared, [], "toujours pas de clé sur le site : on garde");
    svc.state.configured = true;
    await gs.tasks.covers.run(c);
    assert.deepEqual(c.calls.legacyCleared, ["rawgApiKey"]);
  } finally { guard.restore(); }
});

test("migration 2 : aucune ancienne clé, clé vide, cœur sans legacy, service qui plante → ne fait rien et ne lève jamais", async () => {
  for (const legacy of [{ rawgApiKey: "" }, { rawgApiKey: "   " }, { rawgApiKey: null }, {}]) {
    const c = migCtx(legacy); await gs.migrations[2](c); assert.deepEqual(c.calls.legacyCleared, [], JSON.stringify(legacy));
  }
  const plain = fakeCtx({ migration: true, settings: {} }); assert.equal(plain.legacy, undefined);
  await gs.migrations[2](plain);
  const boom = migCtx({ rawgApiKey: SECRET }, { configured: async () => { throw new Error("boum"); }, cover: async () => ({ status: "none", url: null }) });
  await gs.migrations[2](boom);
  assert.deepEqual(boom.calls.legacyCleared, []);
});

test("service du cœur : les cinq statuts sont traduits ; https seulement ; une exception du service ne remonte jamais", async () => {
  const c = gsCtx(service({ A: "found", B: "none", C: "no-key", D: "refused", E: "unreachable", F: { status: "found", url: "http://x/y.jpg" }, G: new Error("boum"), H: { status: "inconnu", url: null } }));
  const got = {};
  for (const t of "ABCDEFGH") got[t] = (await gsMod.coverFor(c, t)).status;
  assert.deepEqual(got, { A: "found", B: "none", C: "no_key", D: "denied", E: "down", F: "none", G: "down", H: "down" });
  assert.equal((await gsMod.coverFor(c, "A")).url, IMG);
  assert.equal(await gsMod.hasKey(c), true);
  c.api.rawg.state.configured = false;
  assert.equal(await gsMod.hasKey(c), false);
});

test("service de jaquettes : clé absente → message clair qui renvoie vers « Jaquettes de jeux », aucune recherche, rien de marqué ; dès que la clé existe, tout est de nouveau dû", async () => {
  const svc = service({ Inconnu: "none", Celeste: "found" }, { configured: false });
  const c = gsCtx(svc);
  const a = await addGame(c, "Celeste");
  const b = await addGame(c, "Inconnu", { coverCheckedAt: new Date(NOW - DAY).toISOString(), coverResult: "none", coverKey: "core", coverTries: 2 });
  assert.equal((await run(c)).status, "no_key");
  assert.equal(svc.calls.length, 0);
  const res = await gs.adminActions.findCovers(c);
  assert.match(res.error, /Aucune clé RAWG/); assert.match(res.error, /Jaquettes de jeux/);
  assert.match(JSON.stringify(await gs.adminPanel(c)), /suggestInstall/);
  svc.state.configured = true;                                   // l'administrateur saisit la clé dans Réglages
  const r = await run(c, { now: NOW + 60_000 });
  assert.equal(r.found, 1);
  assert.equal((await game(c, a)).coverUrl, IMG);
  assert.equal((await game(c, b)).coverTries, 1, "essai immédiat malgré le délai : la situation a changé");
});

test("service du cœur : clé refusée → signalée à part, pause 24 h, reprise après (ou au clic) ; rien n'est marqué « sans résultat »", async () => {
  const svc = service({ A: "refused", B: "refused" });
  const c = gsCtx(svc);
  const ids = [await addGame(c, "A"), await addGame(c, "B")];
  assert.equal((await run(c)).status, "denied");
  assert.equal(svc.calls.length, 1);
  for (const id of ids) assert.equal((await game(c, id)).coverResult, undefined);
  assert.equal((await run(c, { now: NOW + 3_600_000 })).status, "denied");
  assert.equal(svc.calls.length, 1, "pause : aucune nouvelle demande");
  const msg = await gs.adminActions.findCovers(c);
  assert.match(msg.error, /refuse la clé/); assert.ok(!/sans résultat/.test(msg.error));
  assert.equal(svc.calls.length, 2, "le bouton passe outre la pause");
  assert.match(JSON.stringify(await gs.adminPanel(c)), /refuse la clé/);
  svc.cover = async () => ({ status: "found", url: IMG });       // clé corrigée
  assert.equal((await run(c, { now: Date.now() + 25 * 3_600_000 })).found, 2);   // le clic a eu lieu « maintenant » (horloge réelle)
});

test("service du cœur : « injoignable » ne marque rien et ne compte pas comme un essai ; « aucun résultat » suit le calendrier 3/7/14/30 jours", async () => {
  const svc = service({ A: "unreachable" });
  const c = gsCtx(svc);
  const id = await addGame(c, "A");
  assert.equal((await run(c)).status, "down");
  assert.deepEqual([(await game(c, id)).coverCheckedAt, (await game(c, id)).coverTries], [undefined, undefined]);
  svc.cover = async () => ({ status: "none", url: null });
  await run(c, { now: NOW + 1000 });
  assert.equal((await game(c, id)).coverTries, 1);
  const calls = []; svc.cover = async (t) => { calls.push(t); return { status: "none", url: null }; };
  await run(c, { now: NOW + 2 * DAY }); assert.equal(calls.length, 0);
  await run(c, { now: NOW + 1000 + 3 * DAY }); assert.equal(calls.length, 1);
  assert.match((await gs.adminActions.findCovers(c)).ok, /sans résultat/);
});

test("service du cœur : suggestion envoyée → jaquette du service ; panne → la tâche la rattrape", async () => {
  const svc = service({ Celeste: "found", Panne: "unreachable" });
  const c = gsCtx(svc);
  const send = (title) => { const fd = new FormData(); fd.set("title", title); return gs.routes.suggest(new Request("https://x.test/m/k/suggest", { method: "POST", body: fd, headers: { "x-forwarded-for": `6.6.${++n}.1` } }), c); };
  await send("Celeste"); await send("Panne");
  const by = Object.fromEntries((await c.api.store.list("games")).map((r) => [r.data.title, r.data]));
  assert.equal(by.Celeste.coverUrl, IMG); assert.equal(by.Panne.coverUrl, null); assert.equal(by.Panne.coverCheckedAt, undefined);
  svc.cover = async () => ({ status: "found", url: IMG });
  await gs.tasks.covers.run(c);
  assert.equal((await c.api.store.list("games")).find((r) => r.data.title === "Panne").data.coverUrl, IMG);
});

/* ───────────── planning (service RAWG du cœur) ───────────── */

const URL_OK = "https://calendar.example.com/ical/secret-token/basic.ics";
const ics = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const hours = (h) => new Date(Date.now() + h * 3_600_000);
const vevent = (uid, start, summary, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${ics(start)}`, `DTEND:${ics(new Date(start.getTime() + 3_600_000))}`, `SUMMARY:${summary}`, ...extra, "END:VEVENT"].join("\r\n");
const calendar = (...ev) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
let feed = "";   // l'agenda iCal « en ligne » du moment : lu par l'Agenda en ligne, jamais par le Planning
const plCtx = (svc, settings = {}, over = {}) => { const c = fakeCtx({ settings: { days: 7, timezone: "UTC", ...settings }, topics: feedTopics(() => feed), messages: plMsg, locale: "fr", ...over }); if (svc) c.api.rawg = svc; else delete c.api.rawg; return c; };
const realFetch = globalThis.fetch;
/** Le Planning ne fait aucun appel réseau : tout `fetch` (RAWG en direct, agenda) ferait échouer le test. */
const calendarOnly = (ical) => { feed = ical; globalThis.fetch = async (u) => { throw new Error(`le planning ne parle pas au réseau : ${u}`); }; };
afterEach(() => { globalThis.fetch = realFetch; });

test("planning : la jaquette du jeu apparaît sur la page publique (image à gauche, texte échappé) ; sans jaquette le rendu texte d'avant", async () => {
  calendarOnly(calendar(vevent("1", hours(2), "Soirée <b>", ["DESCRIPTION:Jeu: Celeste\\, Hades"])));
  const html = (await pl.page(plCtx(service({ Celeste: "found", Hades: "none" })))).blocks.find((b) => b.type === "html")?.html ?? "";
  assert.ok(html.includes(`src="${IMG}"`) && html.includes("width=\"44\"") && html.includes("height=\"58\""));
  assert.equal((html.match(/<img /g) ?? []).length, 1, "Hades est inconnu de RAWG : omis");
  assert.ok(html.includes("Soirée &lt;b&gt;") && !html.includes("<b>"));
  assert.ok(html.includes("Celeste, Hades"), "les noms des jeux restent affichés");
  assert.ok(!(await pl.page(plCtx(service({ Celeste: "none" })))).blocks.some((b) => b.type === "html"));
});

test("planning : sections « prochain stream » et « prochains streams » avec jaquette", async () => {
  calendarOnly(calendar(vevent("1", hours(2), "Bientôt", ["DESCRIPTION:Jeu: Celeste"]), vevent("2", hours(30), "Plus tard")));
  const c = plCtx(service({ Celeste: "found" }));
  const next = await pl.sections.next(c, {});
  assert.ok(next[1].type === "html" && next[1].html.includes(IMG));
  const up = await pl.sections.upcoming(c, { count: 5 });
  assert.ok(up[1].html.includes(IMG) && up[1].html.includes("Plus tard"));
});

test("planning : clé non configurée, cœur sans service ou « toute la journée » → aucune recherche, rendu texte inchangé", async () => {
  const cal = calendar(vevent("1", hours(2), "Soirée", ["DESCRIPTION:Jeu: Celeste"]));
  calendarOnly(cal);
  const off = service({ Celeste: "found" }, { configured: false });
  assert.ok((await pl.page(plCtx(off))).blocks.some((b) => b.type === "markdown" && /_Celeste_/.test(b.text)));
  assert.equal(off.calls.length, 0);
  assert.ok((await pl.page(plCtx(null))).blocks.some((b) => b.type === "markdown" && /_Celeste_/.test(b.text)), "cœur sans ctx.api.rawg : pas d'erreur");
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  const allDay = ["BEGIN:VEVENT", "UID:9", `DTSTART;VALUE=DATE:${ics(day).slice(0, 8)}`, "SUMMARY:Férié", "DESCRIPTION:Jeu: Celeste", "END:VEVENT"].join("\r\n");
  calendarOnly(calendar(allDay)); 
  const on = service({ Celeste: "found" }); await pl.page(plCtx(on));
  assert.equal(on.calls.length, 0);
});

test("planning : un service qui plante ou répond n'importe quoi ne casse jamais la page", async () => {
  calendarOnly(calendar(vevent("1", hours(2), "Soirée", ["DESCRIPTION:Jeu: A\\, B\\, C"])));
  const svc = service({ A: new Error("boum"), B: { status: "found", url: "javascript:alert(1)" }, C: { status: "found", url: "http://x/y.jpg" } });
  const blocks = (await pl.page(plCtx(svc))).blocks;
  assert.ok(!blocks.some((b) => b.type === "html"));
  const broken = service(); broken.configured = async () => { throw new Error("boum"); };
  assert.ok((await pl.page(plCtx(broken))).blocks.length > 0);
});

test("planning : panneau d'admin — clé absente (avec lien), clé refusée, RAWG injoignable, jeux inconnus : chaque cas a son message", async () => {
  const cal = calendar(vevent("1", hours(2), "S", ["DESCRIPTION:Jeu: Celeste\\, Fantôme"]));
  const text = async (svc) => JSON.stringify(await pl.adminPanel(plCtx(svc)));
  calendarOnly(cal);
  const none = await text(service({}, { configured: false })); assert.match(none, /Aucune clé RAWG/); assert.match(none, /Jaquettes de jeux/); assert.match(none, /suggestInstall/);
  assert.match(await text(service({ Celeste: "refused", "Fantôme": "refused" })), /RAWG refuse la clé/);
  assert.match(await text(service({ Celeste: "unreachable", "Fantôme": "unreachable" })), /RAWG est injoignable/);
  const ok = await text(service({ Celeste: "found" }));
  assert.match(ok, /1 jaquette\(s\) trouvée\(s\) pour 2 jeu/); assert.match(ok, /RAWG ne connaît pas : Fantôme/); assert.ok(ok.includes(IMG));
});

test("planning : image PNG avec jaquettes (https, 3 par stream au plus), sans jaquette le nom du jeu, repli sans jaquettes si le rendu échoue", async () => {
  const today = new Date(); today.setUTCHours(10, 0, 0, 0);
  const cal = calendar(vevent("1", today, "Soirée", ["DESCRIPTION:Jeu: A1\\, B2\\, C3\\, D4"]));
  calendarOnly(cal);
  const c = plCtx(service({ A1: "found", B2: "found", C3: "found", D4: "found" }));
  await pl.routes.image(new Request("https://x.test/m/planning/image"), c);
  const flat = JSON.stringify(c.calls.png[0].tree);
  assert.equal((flat.match(/"type":"img"/g) ?? []).length, 3, "trois jaquettes au plus");
  assert.ok(flat.includes(IMG));
  assert.equal(c.calls.png[0].width, 900);
  const bare = plCtx(service({}, { configured: false })); await pl.routes.image(new Request("https://x.test/m/planning/image"), bare);
  const flatBare = JSON.stringify(bare.calls.png[0].tree);
  assert.ok(!flatBare.includes('"type":"img"') && flatBare.includes("A1, B2, C3"));
  const flaky = plCtx(service({ A1: "found" })); const png = flaky.api.png; let first = true;
  flaky.api.png = async (spec) => { if (first) { first = false; throw new Error("image illisible"); } return png(spec); };
  const res = await pl.routes.image(new Request("https://x.test/m/planning/image"), flaky);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.ok(!JSON.stringify(flaky.calls.png[0].tree).includes('"type":"img"'));
});

test("planning : hauteur de l'image — 150 px par jour, 270 px dès qu'un jour a deux streams (comme l'ancien site) ; état vide compact", async () => {
  const today = new Date(); today.setUTCHours(10, 0, 0, 0);
  calendarOnly(calendar(vevent("1", today, "Un")));
  const one = plCtx(); await pl.routes.image(new Request("https://x.test/m/planning/image"), one);
  const h1 = one.calls.png[0].height;
  calendarOnly(calendar(vevent("1", today, "Un"), vevent("2", new Date(today.getTime() + 3_600_000), "Deux")));
  const two = plCtx(); await pl.routes.image(new Request("https://x.test/m/planning/image"), two);
  assert.equal(two.calls.png[0].height - h1, 7 * (270 - 150));
  calendarOnly(calendar());
  const empty = plCtx(); await pl.routes.image(new Request("https://x.test/m/planning/image"), empty);
  assert.equal(empty.calls.png[0].height, 32 * 2 + 100 + 16 + 220 + 50 + 24);
});

test("planning : plus de réglage de clé, permission rawg déclarée (pas de storage), version montée, textes alignés", () => {
  const m = readJson("planning/module.json");
  assert.ok(parseManifest(m).ok);
  assert.equal(m.version, "2.5.0");
  assert.ok(!m.settings.some((s) => s.key === "rawgApiKey"));
  assert.ok(m.permissions.includes("rawg") && !m.permissions.includes("storage"));
  assert.deepEqual(Object.keys(readJson("planning/locales/fr.json")).sort(), Object.keys(readJson("planning/locales/en.json")).sort());
  const src = fs.readFileSync(new URL("../modules/planning/index.mjs", import.meta.url), "utf8");
  assert.ok(!/api\.rawg\.io|rawgApiKey/.test(src), "aucun appel direct à RAWG ni clé dans le module");
  for (const x of src.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(x[1] in readJson("planning/locales/en.json"), x[1]);
});

test("avec le double officiel du cœur (options rawgConfigured / rawgCover, appels dans ctx.calls.rawg) : jaquette, clé absente, clé refusée", async () => {
  const mk = (opts) => fakeCtx({ key: `gs${++n}`, basePath: "suggestions", messages: gsMsg, settings: {}, locale: "fr", ...opts });
  const ok = mk({ rawgCover: { status: "found", url: IMG } });
  const id = await addGame(ok, "Celeste");
  assert.equal((await run(ok)).found, 1);
  assert.equal((await game(ok, id)).coverUrl, IMG);
  assert.deepEqual(ok.calls.rawg, ["Celeste"]);
  const nokey = mk({ rawgConfigured: false, rawgCover: { status: "no-key", url: null } });
  await addGame(nokey, "X");
  assert.equal((await run(nokey)).status, "no_key");
  assert.deepEqual(nokey.calls.rawg, []);
  const refused = mk({ rawgCover: { status: "refused", url: null } });
  await addGame(refused, "X");
  assert.equal((await run(refused)).status, "denied");
});

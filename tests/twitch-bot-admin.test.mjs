// Bot Twitch 1.6.0 : l'administration refaite selon docs/ERGONOMIE-ADMIN.md. Un seul tableau de commandes (colonne d'origine, interrupteur dans la ligne, recherche en direct, filtres),
// un formulaire de trois champs visibles (le reste sous « Plus d'options »), UN contrôle de période pour les commandes et les timers, des timers sur le même modèle, le journal
// avec recherche et un petit bouton « Vider » confirmé, et plus aucune trace de l'import Nightbot. Le script de la page (adminkit.client.js) est testé pour ses fonctions pures ;
// ses effets dans un navigateur sont vérifiés par tests/visual (captures regardées).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { world, say, fr, en, C, SRC, S, entry, link, NOW } from "./helpers/botWorld.mjs";
import { ownerWorld } from "./helpers/ownerSet.mjs";
import { htmlOf, rowsOf, byName, pills, configOf, formOfBlocks, plain } from "./helpers/ui.mjs";

const DIR = new URL("../modules/twitch-bot", import.meta.url).pathname;
const A = await import("../modules/twitch-bot/admin.mjs");
const P = await import("../modules/twitch-bot/period.mjs");
const KIT = await import("../modules/twitch-bot/adminkit.mjs");
const TA = await import("../modules/twitch-bot/timersAdmin.mjs");
const T = await import("../modules/twitch-bot/timers.mjs");
const def = (await import("../modules/twitch-bot/index.mjs")).default;
const client = createRequire(import.meta.url)("../modules/twitch-bot/adminkit.client.js");
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));

const owner = await ownerWorld();
const page = await A.panel(owner.ctx, { query: {} });
const rows = rowsOf(htmlOf(page, "commands"));
const R = (name) => byName(rows, `!${name}`);

/* ───────────── Le tableau unique ───────────── */

test("liste : UN tableau de 35 commandes, colonnes Commande / Réponse / Origine / Actif / action ; plus de titres de groupe ni de tableaux séparés", () => {
  assert.equal(rows.length, 35);
  const html = htmlOf(page, "commands");
  assert.deepEqual([...html.matchAll(/<th scope="col"[^>]*>(?:<span class="ck-sr">)?([^<]+)/g)].map((m) => m[1]), [fr.col_command, fr.col_answer, fr.col_origin, fr.col_active, fr.col_action]);
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.equal(page.filter((b) => b.type === "table" && !b.tab).length, 0, "plus de tableau du cœur pour les commandes, les partenaires ni les réseaux");
  assert.equal(page.filter((b) => b.type === "heading" && !b.tab).length, 0, "plus de titre de page : la ligne d'état du haut le dit ; les autres titres sont dans leur bloc");
  for (const old of [fr.kind_custom, "Pas encore activée", "Toute prête", "Activer / désactiver", "Configurer"]) assert.ok(!JSON.stringify(page).includes(old), `plus de « ${old} »`);
  const counts = Object.fromEntries(pills(html).filter((p) => p.key === "origin").map((p) => [p.val, p.count]));
  assert.deepEqual(counts, { all: 35, custom: 26, builtin: 6, partner: 3 });
  const st = Object.fromEntries(pills(html).filter((p) => p.key === "state").map((p) => [p.val, p.count]));
  assert.deepEqual(st, { all: 35, on: 19, off: 13, hidden: 3 });
});

test("lignes : l'origine est une colonne écrite (pastille), le rôle n'apparaît que s'il est restreint, aperçu sur une ligne complet en info-bulle", () => {
  assert.equal(R("tip").cells.org, fr.origin_custom);
  assert.equal(R("playing").cells.org, fr.origin_builtin);
  assert.equal(R("tesla").cells.org, fr.origin_partner);
  assert.match(R("tip").html, /<span class="ck-origin custom">La vôtre<\/span>/);
  assert.match(R("tesla").html, /<span class="ck-origin partner">Partenaire<\/span>/);
  assert.ok(R("so").cells.name.includes(fr.role_mods), "restreinte à la modération : le rôle est dit");
  for (const n of ["tip", "discord", "playing"]) assert.ok(!/Tout le monde|ck-chipr/.test(R(n).html), `${n} : le rôle par défaut n'est jamais répété`);
  assert.match(R("alive").cells.name, /!alive !a-live/);
  assert.match(R("playing").cells.name, /!playing !queljeu/);
  assert.match(R("tip").html, /<span class="ck-ell" title="Un petit don aide à garder la chaîne en vie\.">/);
  assert.ok(!/<td class="c-ans">[^]*?<br/.test(R("tip").html), "une seule ligne");
  assert.equal(R("trade-republic").attrs.origin, "partner");
});

test("tri : activées d'abord puis ordre alphabétique, stable", async () => {
  const names = rows.map((r) => r.cells.name.split(" ")[0]);
  const on = rows.filter((r) => r.html.includes('aria-checked="true"')).map((r) => r.cells.name.split(" ")[0]);
  assert.deepEqual(names.slice(0, on.length), on, "toutes les activées en premier");
  const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b, "fr"));
  assert.deepEqual(on, sorted(on));
  const off = names.slice(on.length);
  assert.deepEqual(off, sorted(off));
  const again = rowsOf(htmlOf(await A.panel(owner.ctx, { query: {} }), "commands")).map((r) => r.cells.name);
  assert.deepEqual(again, rows.map((r) => r.cells.name), "même ordre à chaque affichage");
});

test("interrupteur : un vrai interrupteur dans chaque ligne (état courant), aucun bouton « Activer / désactiver », un seul bouton par ligne", () => {
  for (const r of rows) {
    assert.match(r.html, /role="switch" aria-checked="(true|false)" aria-label="Activer la commande !/, r.cells.name);
    assert.match(r.html, /data-ck-act="toggle" data-ck-id="(custom|builtin|partner|network|group):/);
    assert.equal((r.html.match(/class="ck-btn small"/g) ?? []).length, 1, `${r.cells.name} : un seul bouton`);
  }
  assert.equal(R("tip").html.includes('aria-checked="true"'), true);
  assert.equal(R("alive").html.includes('aria-checked="false"'), true);
  assert.deepEqual(rows.map((r) => r.attrs.state).filter((s, i, a) => a.indexOf(s) === i).sort(), ["hidden", "off", "on"]);
});

test("commande masquée ou produite ailleurs : l'état dit pourquoi ; le bouton renvoie vers la page qui la produit (partenaire), « Modifier » pour les prêtes et les vôtres", () => {
  assert.equal(R("followers").attrs.state, "hidden");
  assert.match(R("followers").cells.sw, /Masquée : followers absents/);
  assert.match(R("followers").html, new RegExp(`title="${fr.why_followers_absent.replace(/[«»]/g, ".")}`.slice(0, 40)));
  assert.match(R("planning").cells.sw, /Masquée : pas d'agenda/);
  assert.match(R("reseaux").cells.sw, /Masquée : aucun réseau activé/);
  assert.match(R("tesla").html, /href="\/admin\/entries\/p2#panel-bot-chat-command"[^>]*>Ouvrir la fiche du partenaire →<\/a>/);
  assert.ok(!R("tesla").html.includes(">Modifier<"));
  assert.match(R("tip").html, /href="\?edit=custom%3A[^"]+#edit"[^>]*>Modifier<\/a>/);
  assert.match(R("playing").html, /href="\?edit=builtin%3Ajeu#edit"[^>]*>Modifier<\/a>/);
});

test("partenaires et réseaux sans commande : pas de lignes « Pas encore activée » ; un bouton « Ajouter… » avec recherche et une phrase d'état", async () => {
  const none = await ownerWorld({ sponsors: [entry("p1", "a", "A"), entry("p2", "b", "B")] });
  const blocks = await A.panel(none.ctx, { query: {} });
  const add = blocks.find((b) => b.type === "html" && b.html.includes('class="ck-add"'));
  const text = plain(add.html);
  assert.match(text, /Ajouter une commande pour un partenaire ou un réseau/);
  assert.match(text, /6 réseaux n'ont pas encore de commande\./);
  assert.match(add.html, /data-ck-q/, "avec recherche");
  const items = rowsOf(add.html);
  assert.equal(items.length, 6, "les 6 réseaux (les partenaires ont déjà leur commande dans ce jeu : 2 fiches) ");
  assert.match(items[0].html, /href="\?edit=network%3A/);
  const fresh = world({ sponsors: [entry("p1", "a", "A"), entry("p2", "b", "B"), entry("p3", "c", "C")], links: [link("y", "youtube-channel", "YouTube", "https://youtube.com/@e")] });
  const s = plain((await A.panel(fresh.ctx, { query: {} })).find((b) => b.type === "html" && b.html.includes('class="ck-add"')).html);
  assert.match(s, /3 partenaires et 1 réseau n'ont pas encore de commande\./);
  assert.ok(!(await A.panel(world().ctx, { query: {} })).some((b) => b.type === "html" && b.html.includes('class="ck-add"')), "rien à ajouter : pas de bouton");
  assert.deepEqual(rowsOf(htmlOf(await A.panel(fresh.ctx, { query: {} }), "commands")).filter((r) => r.attrs.origin !== "builtin"), [], "ni partenaire ni réseau non activé dans le tableau");
});

/* ───────────── La recherche en direct (fonctions du script de la page) ───────────── */

const hit = (q, filter = {}) => rows.filter((r) => client.rowPasses({ hay: r.attrs.hay, origin: r.attrs.origin, state: r.attrs.state }, { q, ...filter }, { state: { hidden: ["hidden", "missing"] } })).map((r) => r.cells.name.split(" ")[0]);

test("recherche en direct : « disc » donne 1 résultat ; insensible à la casse et aux accents ; cherche dans le nom, les autres noms, la réponse et l'état", () => {
  assert.deepEqual(hit("disc"), ["!discord"]);
  assert.deepEqual(hit("DISC"), ["!discord"], "casse");
  assert.ok(hit("de").includes("!dé") && hit("DÉ").includes("!dé") && hit("dé").includes("!dé"), "accents : « de », « DÉ » et « dé » trouvent « !dé »");
  assert.ok(hit("elephant").length === 0 && client.matches("Éléphant", "elephant") && client.matches("elephant", "ÉLÉPHANT"));
  assert.deepEqual(hit("a-live"), ["!alive"], "autre nom");
  assert.deepEqual(hit("queljeu"), ["!playing"]);
  assert.deepEqual(hit("boutique.example"), ["!boutique"], "texte de la réponse");
  assert.deepEqual(hit("moustaches rigueur"), ["!movember"], "plusieurs mots : tous doivent être présents");
  assert.equal(hit("désactivée").length, 13, "l'état");
  assert.deepEqual(hit("masquée").sort(), ["!followers", "!planning", "!reseaux"]);
  assert.ok(hit("!ti").includes("!tip") && hit("modération").includes("!so"), "préfixe et rôle");
  assert.equal(hit("").length, 35, "recherche vide : tout");
});

test("recherche : « Aucun résultat » dit quoi faire ; filtres par origine et par état se combinent avec la recherche", () => {
  assert.deepEqual(hit("zzzzzz"), []);
  const html = htmlOf(page, "commands");
  assert.match(html, /data-ck-empty hidden><p>Aucun résultat\.<\/p><button type="button" class="ck-btn" data-ck-clear>Effacer la recherche<\/button>/);
  assert.match(html, /<input type="search" data-ck-q placeholder="Un nom, un mot de la réponse…"/);
  assert.match(html, /<span>Rechercher<\/span>/, "libellé visible « Rechercher » au-dessus de la liste");
  assert.equal(hit("", { origin: "partner" }).length, 3);
  assert.equal(hit("", { origin: "custom", state: "off" }).length, 12);
  assert.equal(hit("e", { origin: "custom", state: "on" }).every((n) => R(n.slice(1)).attrs.state === "on"), true);
  assert.equal(hit("", { state: "hidden" }).length, 3, "masquées : masquée ou en pause");
  assert.equal(hit("", { origin: "all", state: "all" }).length, 35);
});

test("recherche présente même avec peu de commandes (R15) ; sans JavaScript la liste reste complète et lisible", async () => {
  const small = await A.panel(world().ctx, { query: {} });
  const html = htmlOf(small, "commands");
  assert.match(html, /data-ck-q/);
  assert.equal(rowsOf(html).length, 6, "les six commandes toutes prêtes, toutes dans la page");
  assert.match(html, /class="ck-tools ck-js"/, "recherche et pastilles n'apparaissent qu'avec le script");
  assert.ok(KIT.CSS.includes(".ck-js{display:none}"), "sans script : cachées ; la liste, elle, est toujours là");
});

/* ───────────── Le formulaire d'une commande ───────────── */

const REPEATED = /utilisateur|jeton|webhook|identifiant|payload|JSON|\bAPI\b|\bcache\b|OAuth|slug/i;
function lint(form, cfg, where) {
  const visible = new Set(cfg.layout.filter((x) => !x.more).flatMap((x) => (x.f ? [x.f] : x.seg ? [x.seg] : x.sentence ? x.sentence.tokens.filter((t) => t.f).map((t) => t.f) : x.period ? [x.period.field] : [])));
  const folded = new Set(cfg.layout.filter((x) => x.more).flatMap((x) => x.more.items.flatMap((i) => (i.f ? [i.f] : i.sentence ? i.sentence.tokens.filter((t) => t.f).map((t) => t.f) : i.period ? [i.period.field] : []))));
  for (const f of form.fields.filter((x) => x.kind !== "hidden")) {
    assert.ok(f.label.length <= 60 && !/:\s*$/.test(f.label), `${where} : libellé « ${f.label} »`);
    assert.ok(!REPEATED.test(f.label) && !REPEATED.test(f.help ?? ""), `${where} : mot technique dans « ${f.label} »`);
    assert.ok((f.help ?? "").length <= 60, `${where} : aide trop longue « ${f.help} »`);
    assert.ok(visible.has(f.name) || folded.has(f.name), `${where} : le champ ${f.name} est rangé`);
  }
  return { visible, folded };
}

test("formulaire d'une commande : 3 champs visibles (Nom, Ce que le bot répond, Qui peut l'utiliser) ; tout le reste sous « Plus d'options »", async () => {
  const b = await A.panel(owner.ctx, { query: { new: "1" } });
  const form = formOfBlocks(b, "create"), cfg = configOf(b);
  const { visible, folded } = lint(form, cfg, "nouvelle commande");
  assert.deepEqual([...visible], ["name", "text", "role"]);
  assert.deepEqual([...folded].sort(), ["aliases", "cdGlobal", "cdUser", "period"]);
  assert.deepEqual(form.fields.filter((f) => f.kind !== "hidden").slice(0, 3).map((f) => f.label), ["Nom", "Ce que le bot répond", "Qui peut l'utiliser"]);
  assert.deepEqual(form.fields.find((f) => f.name === "role").options.map((o) => o.label), ["Tout le monde", "Personnes abonnées", "Modération", "Vous seulement"]);
  const more = cfg.layout.find((x) => x.more).more;
  assert.deepEqual([more.title, more.open], ["Plus d'options", false]);
  assert.deepEqual(more.items.map((i) => i.f ?? Object.keys(i)[0]), ["aliases", "sentence", "period"]);
  assert.equal(form.submitLabel, "Créer la commande");
  assert.equal(b.some((x) => x.type === "adminForm" && x.action === "create") && (await A.panel(owner.ctx, { query: {} })).some((x) => x.action === "create"), false, "sans « Nouvelle commande », pas de formulaire en bas de page");
  const key = `custom:${(await C.loadConfig(owner.ctx)).data.custom.find((c) => c.name === "alive").id}`;
  const e = await A.panel(owner.ctx, { query: { edit: key } });
  lint(formOfBlocks(e, "save"), configOf(e), "modifier");
  assert.equal(formOfBlocks(e, "save").fields.find((f) => f.name === "aliases").value, "a-live");
  assert.equal(formOfBlocks(e, "save").submitLabel, "Enregistrer la commande");
});

test("attentes : UNE phrase « Attendre [ ] s entre deux réponses, et [ ] s pour une même personne » ; le champ vide dit sa valeur", async () => {
  const cfg = configOf(await A.panel(owner.ctx, { query: { new: "1" } }));
  const s = cfg.layout.find((x) => x.more).more.items.find((x) => x.sentence).sentence;
  assert.deepEqual(s.tokens.map((t) => (typeof t === "string" ? t : t.f)), ["Attendre", "cdGlobal", "s entre deux réponses, et", "cdUser", "s pour une même personne"]);
  assert.deepEqual(s.tokens.filter((t) => t.f).map((t) => [t.ph, t.min, t.max]), [["20", 0, 3600], ["60", 0, 3600]]);
  assert.equal(s.hint, "Vide : 20 s entre deux réponses, 60 s par personne.");
  const b = await A.panel(owner.ctx, { query: { new: "1" } });
  assert.equal(formOfBlocks(b, "create").fields.find((f) => f.name === "cdGlobal").help, "Vide : 20 s");
});

test("l'aperçu de la réponse : valeurs du moment pour les morceaux simples, morceaux à insérer d'un clic ; le texte d'aperçu est rempli côté page", async () => {
  const cfg = configOf(await A.panel(owner.ctx, { query: { new: "1" } }));
  const pv = cfg.layout.find((x) => x.f === "text").preview;
  assert.equal(pv.samples.jeu, "Zelda");
  assert.equal(pv.samples.titre, "Soirée détente");
  assert.deepEqual(pv.chips.map((c) => c.label).slice(0, 3), ["Pseudo", "Jeu", "Titre"]);
  assert.equal(client.previewText("Bienvenue sur {jeu}, {titre} {calcul 2+3}", pv.samples), "Bienvenue sur Zelda, Soirée détente {calcul 2+3}");
});

/* ───────────── Le contrôle de période ───────────── */

test("période : texte ↔ période pour tous les cas (toujours, chaque année, à cheval sur l'année, une fois avec années)", () => {
  const rt = (text) => client.periodToText(client.parsePeriodText(text));
  assert.equal(client.parsePeriodText(""), null, "toujours active");
  assert.equal(P.periodToText(null), "");
  assert.equal(rt("01/11 - 30/11"), "01/11 - 30/11");
  assert.deepEqual(client.parsePeriodText("1/11 - 30/11"), { yearly: true, from: { d: 1, m: 11 }, to: { d: 30, m: 11 } });
  const wrap = client.parsePeriodText("15/12 - 15/01");
  assert.equal(wrap.yearly, true);
  assert.equal(client.periodProblem(wrap, P.DAYS_IN_MONTH), null, "à cheval sur l'année : valide chaque année");
  assert.equal(P.isOpen(P.parsePeriodText("15/12 - 15/01").value, Date.parse("2026-01-10T10:00:00Z")), true);
  assert.equal(P.isOpen(P.parsePeriodText("15/12 - 15/01").value, Date.parse("2026-02-10T10:00:00Z")), false);
  const once = client.parsePeriodText("01/11/2026 - 30/11/2026");
  assert.deepEqual([once.yearly, once.from.y, once.to.y], [false, 2026, 2026]);
  assert.equal(rt("01/11/2026 - 30/11/2026"), "01/11/2026 - 30/11/2026");
  assert.equal(client.parsePeriodText("n'importe quoi"), "bad");
  for (const t of ["", "01/11 - 30/11", "15/12 - 15/01", "01/11/2026 - 30/11/2026", "29/02 - 01/03"]) {
    const p = P.parsePeriodText(t);
    assert.equal(p.ok, true, t);
    assert.equal(P.periodToText(p.value), t ? client.periodToText(client.parsePeriodText(t)) : "", `${t} : le serveur et la page écrivent la même chose`);
  }
});

test("période : les erreurs sont dites avec un exemple, la même chose côté page et côté serveur", () => {
  const dim = P.DAYS_IN_MONTH;
  assert.deepEqual(client.periodProblem(client.parsePeriodText("31/02 - 01/03"), dim), { key: "nodate", day: 31, month: 2 });
  assert.equal(client.periodProblem({ yearly: true, from: { d: 0, m: 0 }, to: { d: 1, m: 1 } }, dim).key, "incomplete");
  assert.equal(client.periodProblem({ yearly: false, from: { d: 1, m: 11 }, to: { d: 2, m: 11, y: 2026 } }, dim).key, "year");
  assert.equal(client.periodProblem(client.parsePeriodText("30/11/2026 - 01/11/2026"), dim).key, "order");
  const ctx = world().ctx;
  assert.equal(P.periodError(ctx, P.parsePeriodText("31/02 - 01/03")), "Le 31 février n'existe pas. Exemple : 28 février.");
  assert.equal(P.periodError(ctx, P.parsePeriodText("31/04 - 01/05")), "Le 31 avril n'existe pas. Exemple : 30 avril.");
  assert.match(P.periodError(ctx, P.parsePeriodText("30/11/2026 - 01/11/2026")), /Exemple : du 1er novembre 2026 au 30 novembre 2026/);
  assert.match(P.periodError(ctx, P.parsePeriodText("xx")), /Exemple : du 1er novembre au 30 novembre/);
  const cfg = P.periodControl(ctx, null);
  assert.equal(client.fill(cfg.text.eNodate, { day: 31, month: "février", example: "28 février" }), "Le 31 février n'existe pas. Exemple : 28 février.", "la même phrase côté page");
});

test("période : un seul contrôle, des textes et quatre raccourcis (Tout novembre, Tout septembre, Cet été, Noël) ; la phrase d'aperçu ; les années seulement hors « Chaque année »", () => {
  const ctx = world().ctx;
  const c = P.periodControl(ctx, P.readPeriod({ yearly: true, from: { m: 11, d: 1 }, to: { m: 11, d: 30 } }), "Europe/Paris");
  assert.equal(c.field, "period");
  assert.deepEqual(c.shortcuts.map((s) => s.label), ["Tout novembre", "Tout septembre", "Cet été", "Noël"]);
  assert.deepEqual(c.shortcuts[0], { label: "Tout novembre", from: [11, 1], to: [11, 30] });
  assert.deepEqual([c.text.always, c.text.range, c.text.yearly, c.text.from, c.text.to], ["Toujours active", "Seulement pendant une période", "Chaque année", "Du", "au"]);
  const words = (x, withYear) => client.dateWords(x, c, withYear);
  assert.equal(client.fill(c.text.phraseYearly, { from: words({ d: 1, m: 11 }), to: words({ d: 30, m: 11 }) }), "Active du 1er novembre au 30 novembre, chaque année");
  assert.equal(client.fill(c.text.phraseOnce, { from: words({ d: 1, m: 11, y: 2026 }, true), to: words({ d: 30, m: 11, y: 2026 }, true) }), "Active du 1er novembre 2026 au 30 novembre 2026, une seule fois");
  assert.equal(c.text.utc, "", "fuseau réglé : pas de remarque");
  assert.match(P.periodControl(ctx, null, "UTC").text.utc, /heure UTC/);
  const en_ = P.periodControl(world({ locale: "en" }).ctx, null);
  assert.deepEqual(en_.shortcuts.map((s) => s.label), ["All of November", "All of September", "This summer", "Christmas"]);
  const src = fs.readFileSync(`${DIR}/adminkit.client.js`, "utf8");
  assert.match(src, /yc\.addEventListener\("change"/, "case « Chaque année »");
  assert.match(src, /dFrom\.type = "date"/, "sans « Chaque année » : deux sélecteurs de date complets");
});

test("le même contrôle de période sert aux commandes et aux timers", async () => {
  const cmd = configOf(await A.panel(owner.ctx, { query: { new: "1" } })).layout.find((x) => x.more).more.items.find((x) => x.period).period;
  const tim = configOf(await A.panel(owner.ctx, { query: { tab: "timers", timerNew: "1" } })).layout.find((x) => x.more).more.items.find((x) => x.period).period;
  assert.deepEqual(cmd, tim);
  const src = fs.readFileSync(`${DIR}/timersAdmin.mjs`, "utf8") + fs.readFileSync(`${DIR}/commandsUi.mjs`, "utf8");
  assert.equal((src.match(/F\.periodLayout/g) ?? []).length, 2, "un seul composant, appelé des deux côtés");
});

/* ───────────── Timers ───────────── */

test("timers : tableau avec recherche, interrupteur, lignes régulières ; formulaire de 5 champs visibles au plus, période repliée", async () => {
  const { ctx } = world();
  await T.saveTimer(ctx, {}, { name: "Rappel du Discord", text: "Rejoignez le Discord.", minutes: 20, lines: 5, when: "live", enabled: true });
  await T.saveTimer(ctx, {}, { name: "Hydratation", text: "Pensez à boire.", minutes: 30, lines: 3, when: "always", enabled: false });
  const b = await A.panel(ctx, { query: { tab: "timers" } });
  const html = htmlOf(b, "timers"), r = rowsOf(html);
  assert.equal(r.length, 2);
  assert.match(html, /data-ck-q/);
  assert.match(r[0].html, /role="switch" aria-checked="true"[^>]*data-ck-act="timerToggle"/);
  assert.match(r[1].html, /aria-checked="false"/);
  assert.deepEqual(r.map((x) => x.attrs.state), ["on", "off"]);
  assert.equal((r[0].html.match(/class="ck-btn small/g) ?? []).length, 2, "au plus deux actions visibles : Modifier et Envoyer maintenant");
  assert.match(r[1].cells.org, /30 min · 3 lignes · Toujours/);
  assert.ok(!/En direct seulement/.test(r[0].html), "la valeur ordinaire n'est pas répétée");
  const nb = await A.panel(ctx, { query: { tab: "timers", timerNew: "1" } });
  const cfg = configOf(nb), form = formOfBlocks(nb, "timerCreate");
  const { visible } = lint(form, cfg, "timer");
  assert.deepEqual([...visible], ["name", "text", "minutes", "lines", "when"]);
  assert.ok(visible.size <= 5);
  assert.deepEqual(cfg.layout.find((x) => x.more).more.items.map((i) => Object.keys(i)[0]), ["period"]);
  assert.deepEqual(form.fields.find((f) => f.name === "when").options.map((o) => o.label), ["En direct seulement", "Toujours"]);
  assert.equal(form.submitLabel, "Ajouter le timer");
  const sentence = cfg.layout.find((x) => x.sentence).sentence;
  assert.deepEqual(sentence.tokens.map((t) => (typeof t === "string" ? t : t.f)), ["Toutes les", "minutes", "minutes, après au moins", "lines", "lignes de chat"]);
  const ro = world({ can: false });
  await T.saveTimer(ro.ctx, {}, { name: "R", text: "x", minutes: 5, lines: 0, when: "live", enabled: true });
  const rr = rowsOf(htmlOf(await A.panel(ro.ctx, { query: { tab: "timers" } }), "timers"))[0];
  assert.match(rr.html, /disabled/);
  assert.ok(!rr.html.includes("Modifier"), "sans le droit : lecture seule");
});

test("timers : état vide qui dit quoi faire ; créer et activer par l'interrupteur", async () => {
  const { ctx } = world();
  const empty = plain((await A.panel(ctx, { query: { tab: "timers" } })).filter((b) => b.tab === "timers").map((b) => b.html ?? "").join(""));
  assert.match(empty, /Vous n'avez pas encore de timer\./);
  assert.match(empty, /Nouveau timer/);
  const x = { name: "Rappel", text: "Suivez la chaîne.", minutes: "10", lines: "2", when: "live", period: "" };
  assert.deepEqual(await TA.actions.timerCreate.run(ctx, x), { ok: fr.tm_created });
  const id = (await C.loadConfig(ctx)).data.timers[0].id;
  assert.equal((await C.loadConfig(ctx)).data.timers[0].enabled, true);
  assert.match((await TA.actions.timerToggle.run(ctx, { id })).ok, /désactivé/);
  assert.equal((await C.loadConfig(ctx)).data.timers[0].enabled, false);
  assert.equal((await TA.actions.timerSave.run(ctx, { ...x, id, text: "Nouveau texte.", period: "01/11 - 30/11" })).redirect, "?tab=timers");
  const t0 = (await C.loadConfig(ctx)).data.timers[0];
  assert.deepEqual([t0.enabled, t0.text, t0.period.yearly], [false, "Nouveau texte.", true], "enregistrer ne touche pas à l'état");
});

/* ───────────── Journal ───────────── */

test("journal : bouton « Vider le journal » petit et secondaire dans l'en-tête, confirmation qui dit ce qui sera perdu ; recherche et filtre Répondu / Pas répondu ; intro d'une ligne", async () => {
  const { ctx } = world({ settings: { cooldownGlobal: 0, cooldownUser: 0 } });
  for (let i = 0; i < 4; i++) await say(ctx, "!jeu", { chatterId: String(i), login: `u${i}` }, NOW + i * 2000);
  await C.saveCommand(ctx, { kind: "builtin", id: "titre" }, { role: "mods" }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  await say(ctx, "!titre", { login: "curieux" }, NOW + 50_000);
  const b = await A.panel(ctx, { query: {} });
  const html = htmlOf(b, "log");
  assert.match(html, /<div class="ck-head"><h2 class="ck-title">Ce que le bot a fait récemment<\/h2><button type="button" class="ck-btn small ck-js" data-ck-act="clearLog" data-ck-confirm="Les 5 dernières lignes seront effacées\."/);
  assert.ok(!/ck-btn primary|ck-danger/.test(html.match(/<div class="ck-head">.*?<\/div>/)[0]), "ni bouton principal ni rouge d'emblée");
  assert.ok(!b.some((x) => x.type === "adminForm" && x.action === "clearLog"), "plus de cadre à part avec un gros bouton");
  assert.deepEqual(pills(html).map((p) => [p.val, p.count]), [["all", 5], ["sent", 4], ["not", 1]]);
  assert.equal(pills(html)[1].label, "Répondu");
  assert.equal(pills(html)[2].label, "Pas répondu");
  assert.match(html, /data-ck-q placeholder="Une personne, une commande…"/);
  assert.ok(fr.log_help.length <= 60, "l'intro tient sur une ligne");
  assert.ok(client.rowPasses({ hay: rowsOf(html)[0].attrs.hay, result: "refused" }, { q: "curieux", result: "not" }, { result: { not: ["refused", "error"] } }));
  assert.equal(rowsOf(html).filter((r) => client.rowPasses({ hay: r.attrs.hay, result: r.attrs.result }, { q: "", result: "sent" }, {})).length, 4);
  assert.deepEqual(await A.actions.clearLog(ctx), { ok: fr.log_cleared });
});

/* ───────────── Retrait de l'import Nightbot ───────────── */

test("import Nightbot : plus aucune trace (écran, analyseur, droit, outils, textes, stockage) ; les outils de commandes et de timers restent avec leurs périodes", () => {
  for (const f of ["nightbot.mjs", "importAdmin.mjs"]) assert.equal(fs.existsSync(`${DIR}/${f}`), false, f);
  assert.ok(!manifest.rights.some((r) => /nightbot/i.test(r.id)), "plus de droit nightbot.import");
  assert.deepEqual(manifest.mcp.map((m) => m.name), ["bot_commands_list", "bot_command_create", "bot_command_update", "rewards_list", "reward_create", "reward_simulate", "reward_update", "timers_list", "timer_create", "timer_update"]);
  for (const k of ["bot_command_create", "bot_command_update", "timer_create", "timer_update"]) for (const p of ["activeFrom", "activeUntil", "yearly"]) assert.ok(manifest.mcp.find((m) => m.name === k).input.properties[p], `${k}.${p}`);
  assert.ok(manifest.mcp.find((m) => m.name === "bot_command_update").input.properties.clearPeriod);
  assert.ok(!/nightbot/i.test(JSON.stringify([manifest.description, manifest.privacy, manifest.rights, manifest.mcp])), "plus un mot sur l'import dans le manifeste");
  for (const l of [fr, en]) assert.deepEqual(Object.keys(l).filter((k) => /^nb_/.test(k)), []);
  for (const f of fs.readdirSync(DIR).filter((x) => /\.(mjs|json)$/.test(x) && x !== "module.json")) {
    const src = fs.readFileSync(`${DIR}/${f}`, "utf8");
    assert.ok(!/nightbot_import|nightbot\.import|importAdmin|nb_link|\?import=1/.test(src), `${f} : aucune trace de l'import`);
    if (f !== "index.mjs") assert.ok(!src.includes("botImport"), `${f} : le stockage de l'import n'existe plus`);
  }
  const readme = fs.readFileSync(`${DIR}/README.md`, "utf8");
  assert.ok(!/## Importer depuis Nightbot|nightbot_import/.test(readme));
  assert.match(readme, /## Si vous venez de Nightbot/);
  assert.match(readme, /Demandez à votre assistant IA de recréer vos commandes.*`bot_command_create`, `timer_create`/s);
  assert.match(readme, /\| `\$\(user\)`, `\$\(touser\)`, `\$\(count\)` \| `\{utilisateur\}`/, "le tableau de correspondance des variables reste");
});

test("page : plus de lien d'import ; un ancien « ?import=1 » ne casse rien", async () => {
  const b = await A.panel(owner.ctx, { query: { import: "1" } });
  assert.ok(!JSON.stringify(b).includes("Nightbot") && !JSON.stringify(b).includes("import=1"));
  assert.equal(rowsOf(htmlOf(b, "commands")).length, 35, "la page habituelle");
  assert.equal(def.adminActions, A.actions);
  for (const k of ["nightbotAnalyse", "nightbotApply", "nightbotCancel"]) assert.equal(A.actions[k], undefined);
});

test("migration des données 5 : un ancien brouillon d'import est effacé sans erreur, aucune commande ni aucun timer n'est touché ; sans brouillon, rien ne se passe ; rejouable", async () => {
  const { ctx } = world();
  await T.saveTimer(ctx, {}, { name: "Rappel", text: "Texte.", minutes: 5, lines: 0, when: "live", enabled: true });
  await C.saveCommand(ctx, { kind: "custom" }, { name: "merch", text: "Boutique", enabled: true }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  await ctx.api.store.add("botImport", { rows: [{ i: 0, kind: "command", name: "x", text: "y" }], at: Date.now() });
  const before = structuredClone((await C.loadConfig(ctx)).data);
  assert.equal(typeof def.migrations[5], "function");
  await def.migrations[5](ctx);
  assert.equal((await ctx.api.store.list("botImport", { limit: 5 })).length, 0);
  assert.deepEqual((await C.loadConfig(ctx)).data, before, "aucune commande perdue");
  await def.migrations[5](ctx);
  assert.deepEqual((await C.loadConfig(ctx)).data, before);
  assert.equal(manifest.dataVersion, 5);
  const none = world();
  await def.migrations[5](none.ctx);
});

/* ───────────── Règles de l'ergonomie, en général ───────────── */

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("pastilles d'origine : contraste AA (4,5:1) en clair comme en sombre ; le mot est toujours écrit (jamais la couleur seule)", () => {
  for (const mode of ["light", "dark"]) for (const [origin, [bg, fg]] of Object.entries(KIT.PALETTE[mode])) assert.ok(contrast(bg, fg) >= 4.5, `${mode}/${origin} : ${contrast(bg, fg).toFixed(2)}`);
  const surface = { light: "#ffffff", dark: "#1e1d26" };
  for (const mode of ["light", "dark"]) for (const [origin, [bg]] of Object.entries(KIT.PALETTE[mode])) assert.ok(contrast(bg, surface[mode]) >= 1.04, `${mode}/${origin} se distingue du fond`);
  for (const o of ["custom", "builtin", "partner", "network"]) assert.ok(fr[`origin_${o}`] && en[`origin_${o}`]);
  assert.ok(KIT.CSS.includes('prefers-color-scheme:dark'), "sombre aussi");
});

test("réglages du manifeste : au plus 7 réglages simples par onglet, le reste en avancé (R5)", () => {
  const per = {};
  for (const s of manifest.settings) if (!s.advanced) per[s.tab ?? "settings"] = (per[s.tab ?? "settings"] ?? 0) + 1;
  for (const [tab, n] of Object.entries(per)) assert.ok(n <= 7, `${tab} : ${n}`);
});

test("FR et EN : mêmes textes d'interface, mêmes {variables} ; vouvoiement ; aucune majuscule criée, aucun point d'exclamation dans les textes de l'écran", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  const ui = Object.entries(fr).filter(([k]) => /^(origin|filter|search|col|note|add_|f_|wait|more_|chip|per_f|per_title|per_mode|per_sc|log_help|tm_f|tm_note|tm_intro|sw_|summary_help|new_open|save_btn|act_open)/.test(k));
  for (const [k, v] of ui) {
    assert.ok(!/!/.test(v), `${k} : point d'exclamation`);
    assert.ok(!/(?<![\p{L}])(tu|ton|ta|tes|toi|veuillez)(?![\p{L}])/iu.test(v), `${k} : vouvoiement`);
    assert.ok(!/\b[A-ZÉÈ]{4,}\b/.test(v), `${k} : majuscules`);
    assert.ok(v.split(/\s+/).length <= 20 || /^\{|,/.test(k), `${k} : phrase trop longue`);
  }
});

test("le script de la page : sert par la route du module, sans réseau ni eval, documenté ; la page ne dépend de lui que pour s'améliorer", async () => {
  const res = def.routes.kit();
  assert.equal(res.headers.get("content-type"), "application/javascript; charset=utf-8");
  const body = await res.text();
  assert.equal(body, fs.readFileSync(`${DIR}/adminkit.client.js`, "utf8"));
  assert.ok(!/\beval\(|new Function|XMLHttpRequest|importScripts|document\.write/.test(body));
  assert.match(body, /^\/\*\n \* Curiosa — petit script de page/);
  const boot = KIT.bootstrap(world().ctx).html;
  assert.match(boot, /\/m\/bot\/kit\?v=[0-9a-f]{10}/);
  assert.match(boot, /onload="/);
  assert.ok(!/<script/i.test(boot), "le cœur n'exécute pas les balises script d'un bloc : une image démarre le script");
  assert.ok(Object.keys(manifest).includes("version") && manifest.version === "1.7.0");
});

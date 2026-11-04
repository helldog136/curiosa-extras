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
  const visible = new Set(cfg.layout.filter((x) => !x.more).flatMap((x) => (x.f ? [x.f] : x.seg ? [x.seg] : x.sentence ? x.sentence.tokens.filter((t) => t.f).map((t) => t.f) : [])));
  const folded = new Set(cfg.layout.filter((x) => x.more).flatMap((x) => x.more.items.flatMap((i) => (i.nested ? i.nested.items.flatMap((n) => (n.seg ? [n.seg] : n.sentence ? n.sentence.tokens.filter((t) => t.f).map((t) => t.f) : [])) : i.f ? [i.f] : i.seg ? [i.seg] : i.sentence ? i.sentence.tokens.filter((t) => t.f).map((t) => t.f) : []))));
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
  assert.deepEqual([...folded].sort(), ["aliases", "cdGlobal", "cdUser", "period", "repeatEvery", "repeatLines", "repeatOn", "repeatWhen", "timerOnly"]);
  assert.deepEqual(form.fields.filter((f) => f.kind !== "hidden").slice(0, 3).map((f) => f.label), ["Nom", "Ce que le bot répond", "Qui peut l'utiliser"]);
  assert.deepEqual(form.fields.find((f) => f.name === "role").options.map((o) => o.label), ["Tout le monde", "Personnes abonnées", "Modération", "Vous seulement"]);
  const more = cfg.layout.find((x) => x.more).more;
  assert.deepEqual([more.title, more.open], ["Plus d'options", false]);
  assert.deepEqual(more.items.map((i) => i.f ?? Object.keys(i)[0]), ["aliases", "sentence", "period", "repeatOn", "repeatEvery", "nested", "timerOnly"], "le bloc « Répéter automatiquement » est rangé sous Plus d'options, jamais avec les champs du chemin court");
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

test("période : le champ NATIF du cœur (un seul champ), rangé sous « Plus d'options » pour les commandes ET les timers ; aucun contrôle maison", async () => {
  // un timer n'a plus de formulaire : il se règle sur la page d'une commande, où le même champ de période sert
  const pw = world();   // un monde à part : le monde partagé garde ses 35 commandes
  await C.saveCommand(pw.ctx, { kind: "custom" }, { name: "periodique", text: "Texte", repeat: { minutes: 10 } }, { src: await SRC.gather(pw.ctx, "emma"), t: pw.ctx.t, prefix: "!" });
  const pid = (await C.loadConfig(pw.ctx)).data.custom.find((c) => c.name === "periodique").id;
  const cmdBlocks = await A.panel(owner.ctx, { query: { new: "1" } }), timBlocks = await A.panel(pw.ctx, { query: { tab: "use", edit: `custom:${pid}`, repeat: "1" } });
  for (const [blocks, action] of [[cmdBlocks, "create"], [timBlocks, "save"]]) {
    const field = formOfBlocks(blocks, action).fields.find((f) => f.name === "period");
    assert.deepEqual([field.kind, field.label, field.value], ["period", "Limiter dans le temps", ""], "champ `period` du cœur, vide : toujours active");
    assert.ok(field.help.length <= 60 && !/:\s*$/.test(field.label), field.help);
    assert.equal(field.openEnded, undefined, "deux dates, comme avant : le moteur du module ne connaît pas les périodes ouvertes");
    const item = configOf(blocks).layout.find((x) => x.more).more.items.find((x) => x.f === "period");
    assert.deepEqual(item, { f: "period", label: "Limiter dans le temps" }, "rangé dans le panneau replié, avec son libellé");
    assert.equal(JSON.stringify(configOf(blocks)).includes("shortcuts"), false, "plus de puces fixes");
  }
  const src = fs.readFileSync(`${DIR}/timersAdmin.mjs`, "utf8") + fs.readFileSync(`${DIR}/commandsUi.mjs`, "utf8") + fs.readFileSync(`${DIR}/formsUi.mjs`, "utf8");
  assert.ok(!/periodLayout|periodControl|SHORTCUTS/.test(src + fs.readFileSync(`${DIR}/period.mjs`, "utf8")), "le code du contrôle maison a disparu");
  const script = fs.readFileSync(`${DIR}/adminkit.client.js`, "utf8");
  assert.ok(!/periodControl|parsePeriodText|periodToText|dateWords|ck-period|dFrom|yc\.addEventListener/.test(script), "le script de la page ne contient plus de contrôle de période");
  assert.ok(!/ck-sel|ck-date|ck-phrase|ck-range|ck-check|ck-err\b/.test(KIT.CSS), "ni son style");
  for (const k of Object.keys(fr)) assert.ok(!/^per_(sc|mode|from|to|yearly|day|month|date|phrase|always|utc)/.test(k), `${k} : texte du contrôle maison à retirer`);
  for (const text of [JSON.stringify(fr), JSON.stringify(en)]) assert.ok(!/Tout novembre|Tout septembre|Cet été|All of November|This summer|Chaque année|Every year/.test(text), "plus de puces fixes dans les textes");
});

test("période : l'aide du champ dit le fuseau (UTC quand aucun n'est réglé), courte, en français et en anglais", async () => {
  const help = async (w) => formOfBlocks(await A.panel(w.ctx, { query: { new: "1" } }), "create").fields.find((f) => f.name === "period").help;
  assert.equal(await help(world({ settings: { timezone: "UTC" } })), "Vide : toujours active. Dates en heure UTC (voir Réglages).");
  assert.equal(await help(world()), "Vide : toujours active. Fuseau Europe/Paris.");
  assert.equal(await help(world({ locale: "en", settings: { timezone: "UTC" } })), "Empty: always active. Dates in UTC time (see Settings).");
  assert.equal(await help(world({ locale: "en" })), "Empty: always active. Time zone Europe/Paris.");
});

test("période : les erreurs du serveur sont dites avec un exemple (sous le champ)", () => {
  const ctx = world().ctx;
  assert.equal(P.periodError(ctx, P.parsePeriodValue("02-31/03-01")), "Le 31 février n'existe pas. Exemple : 28 février.");
  assert.equal(P.periodError(ctx, P.parsePeriodValue("04-31/05-01")), "Le 31 avril n'existe pas. Exemple : 30 avril.");
  assert.match(P.periodError(ctx, P.parsePeriodValue("2026-11-30/2026-11-01")), /Exemple : du 1er novembre 2026 au 30 novembre 2026/);
  assert.match(P.periodError(ctx, P.parsePeriodValue("xx")), /Exemple : du 1er novembre au 30 novembre/);
  assert.match(P.periodError(ctx, P.parsePeriodValue("1999-11-01/2026-11-30")), /date complète, avec l'année\. Exemple : 1er novembre 2026/);
});

test("le contrôle de période sert à toute commande, y compris celles qui se répètent (il n'existe plus de formulaire de timer)", async () => {
  const src = fs.readFileSync(`${DIR}/timersAdmin.mjs`, "utf8");
  assert.ok(!/periodLayout|periodField|timerSave|timerCreate/.test(src), "un timer se règle sur la page de la commande");
});

/* ───────────── Timers (le bloc « Répéter automatiquement » d'une commande) ───────────── */

test("page d'une commande : « Répéter automatiquement » est sous Plus d'options (ouvert par le lien de l'onglet Timers), l'interrupteur et UNE durée ; l'ancien timer n'a plus de formulaire", async () => {
  const { ctx } = world();
  await C.saveCommand(ctx, { kind: "custom" }, { name: "discord", text: "Rejoignez le Discord.", repeat: { minutes: 20, lines: 4, when: "always" } }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  const key = `custom:${(await C.loadConfig(ctx)).data.custom[0].id}`;
  const closed = await A.panel(ctx, { query: { edit: key } });
  const open = await A.panel(ctx, { query: { tab: "use", edit: key, repeat: "1" } });
  assert.equal(configOf(closed).layout.find((x) => x.more).more.open, false);
  assert.equal(configOf(open).layout.find((x) => x.more).more.open, true, "le lien « Modifier » de l'onglet Timers ouvre le bloc");
  const form = formOfBlocks(open, "save"), cfg = configOf(open);
  const { visible } = lint(form, cfg, "répétition");
  assert.deepEqual([...visible], ["name", "text", "role"], "le chemin court ne change pas");
  const f = Object.fromEntries(form.fields.map((x) => [x.name, x]));
  assert.deepEqual([f.repeatOn.kind, f.repeatOn.value, f.repeatEvery.kind, f.repeatEvery.value, f.repeatEvery.min, f.repeatEvery.max], ["switch", "on", "duration", 1200, 60, 86400]);
  assert.match(f.repeatEvery.example, /minutes/);
  assert.deepEqual([f.repeatLines.value, f.repeatWhen.value], [4, "always"]);
  assert.ok(open.some((b) => b.type === "table" && b.rowActions?.[0]?.action === "timerRemove"), "retirer le timer : séparé, avec confirmation");
  const rm = open.find((b) => b.type === "table" && b.rowActions?.[0]?.action === "timerRemove").rowActions[0];
  assert.match(rm.confirm, /La commande reste/);
  const more = configOf(open).layout.find((x) => x.more).more.items;
  assert.equal(more.find((i) => i.f === "repeatEvery").showWhen, "repeatOn", "éteint : seul l'interrupteur se voit");
  assert.equal(more.find((i) => i.nested).showWhen, "repeatOn");
  assert.equal(more.find((i) => i.nested).nested.title, "Conditions", "minimum de messages et direct/toujours : repliés");
  assert.equal(formOfBlocks(open, "save").submitLabel, "Enregistrer la commande");
  const fresh_ = world();
  await C.saveCommand(fresh_.ctx, { kind: "custom" }, { name: "libre", text: "Libre" }, { src: await SRC.gather(fresh_.ctx, "emma"), t: fresh_.ctx.t, prefix: "!" });
  const k2 = `custom:${(await C.loadConfig(fresh_.ctx)).data.custom[0].id}`;
  const intent = await A.panel(fresh_.ctx, { query: { tab: "use", edit: k2, repeat: "1" } });
  assert.equal(formOfBlocks(intent, "save").submitLabel, "Ajouter ce timer", "un seul bouton principal, verbe précis");
  assert.equal(formOfBlocks(intent, "save").fields.find((x) => x.name === "repeatOn").value, "on", "venu d'« Ajouter un timer » : l'interrupteur est déjà allumé");
  assert.ok(!intent.some((b) => b.type === "table" && b.rowActions?.[0]?.action === "timerRemove"), "rien à retirer tant qu'il n'y a pas de timer");
});

test("liste des commandes : une commande réservée au timer porte la pastille écrite « Timer seulement » (et seulement elle, R14), montre son titre et reste modifiable", async () => {
  const { ctx } = world();
  const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  await C.saveCommand(ctx, { kind: "custom" }, { name: "merch", text: "Boutique" }, env);
  await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: "tx1", name: "rappel", title: "Rappel du Discord", aliases: [], text: "Le Discord !", role: "everyone", enabled: true, cdGlobal: null, cdUser: null, timerOnly: true, repeat: { minutes: 15, lines: 5, when: "live", enabled: true } }); return { ok: true }; });
  const b = await A.panel(ctx, { query: {} });
  const html = htmlOf(b, "commands"), rows = rowsOf(html);
  const timer = rows.find((r) => r.cells.name.startsWith("Rappel du Discord"));
  assert.ok(timer && timer.attrs.origin === "timer");
  assert.match(timer.cells.org, /^Timer seulement$/);
  assert.equal((html.match(/ck-origin timer/g) ?? []).length, 1);
  assert.match(timer.html, /href="\?edit=custom%3Atx1#edit"/);
  assert.ok(pills(html).some((p) => p.key === "origin" && p.val === "timer" && p.label === "Timer seulement" && p.count === 1));
  const e = await A.panel(ctx, { query: { edit: "custom:tx1" } });
  assert.ok(!configOf(e).layout.some((x) => x.seg === "role"), "personne à qui la permettre : pas de choix du rôle");
  // dans le chat, personne ne peut la taper
  const out = await say(ctx, "!rappel", { login: "curieux" }, NOW);
  assert.equal(out.handled, false);
  // retirer le timer d'une commande « seulement pour le timer » : DEUX choix confirmés, aucun silencieux
  const acts = e.find((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "timerKeep")).rowActions;
  assert.deepEqual(acts.map((a) => a.action), ["remove", "timerKeep"]);
  assert.match(acts[0].confirm, /n'existe que pour ce timer/);
  assert.match(acts[1].confirm, /devient une commande du chat.*Tout le monde pourra la taper avec !rappel/);
  assert.ok(!e.some((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "timerRemove")));
  assert.equal(e.filter((b) => b.type === "table" && b.rowActions?.some((a) => a.action === "remove")).length, 1, "un seul bloc de suppression");
  assert.equal((await TA.actions.timerRemove.run(ctx, { id: "custom:tx1" })).error, ctx.t("rep_choose"), "jamais de passage silencieux dans le chat");
  assert.equal((await C.loadConfig(ctx)).data.custom.find((c) => c.id === "tx1").timerOnly, true);
  assert.equal((await say(ctx, "!rappel", { login: "curieux" }, NOW + 1000)).handled, false);
  assert.match((await TA.actions.timerKeep.run(ctx, { id: "custom:tx1" })).ok, /utilisable dans le chat/);
  const kept = (await C.loadConfig(ctx)).data.custom.find((c) => c.id === "tx1");
  assert.deepEqual([kept.timerOnly, kept.repeat], [undefined, undefined]);
  assert.equal((await say(ctx, "!rappel", { login: "curieux" }, NOW + 60_000)).result, "sent");
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
  await C.mutate(ctx, (cfg) => { cfg.timers.push({ id: "told", name: "Rappel", text: "Texte.", minutes: 5, lines: 0, when: "live", enabled: true }); return { ok: true }; });
  await C.saveCommand(ctx, { kind: "custom" }, { name: "merch", text: "Boutique", enabled: true }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  await ctx.api.store.add("botImport", { rows: [{ i: 0, kind: "command", name: "x", text: "y" }], at: Date.now() });
  const before = structuredClone((await C.loadConfig(ctx)).data);
  assert.equal(typeof def.migrations[5], "function");
  await def.migrations[5](ctx);
  assert.equal((await ctx.api.store.list("botImport", { limit: 5 })).length, 0);
  assert.deepEqual((await C.loadConfig(ctx)).data, before, "aucune commande perdue");
  await def.migrations[5](ctx);
  assert.deepEqual((await C.loadConfig(ctx)).data, before);
  assert.equal(manifest.dataVersion, 6);
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
  const ui = Object.entries(fr).filter(([k]) => /^(origin|filter|search|col|note|add_|f_|wait|more_|chip|per_f|per_title|log_help|tm_f|tm_note|tm_intro|sw_|summary_help|new_open|save_btn|act_open)/.test(k));
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
  assert.ok(Object.keys(manifest).includes("version") && manifest.version === "1.10.1");
});

/* ───────────── "Started by": the timer and the chat | the timer only ───────────── */

const HELP_KEYS = ["timer", "both"].flatMap((k) => ["named_every", "every", "named", "plain"].map((c) => `th_${k}_${c}`));
// The configuration the page receives (what `timerOnlyHelp` builds), for the pure function of the page script.
const pickSpec = (lang) => { const L = lang === "en" ? en : fr; return { prefix: "!", first: L.th_first, everyMin: L.rep_every_m, everyHour: L.rep_every_h, texts: Object.fromEntries(HELP_KEYS.map((k) => [k.slice(3), L[k]])) }; };

test("Started by: a two-choice segmented control on the same stored field, with no fixed help line, in both languages", async () => {
  for (const lang of ["fr", "en"]) {
    const L = lang === "en" ? en : fr;
    const { ctx } = world(lang === "en" ? { locale: "en" } : {});
    const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
    await C.saveCommand(ctx, { kind: "custom" }, { name: "movember", text: "Hello", repeat: { minutes: 15, lines: 5, when: "live", enabled: true }, timerOnly: true }, env);
    await C.saveCommand(ctx, { kind: "custom" }, { name: "regular", text: "Hello", repeat: { minutes: 15, lines: 5, when: "live", enabled: true } }, env);
    const list = (await C.loadConfig(ctx)).data.custom;
    for (const [name, value] of [["movember", "on"], ["regular", "off"]]) {
      const b = await A.panel(ctx, { query: { edit: `custom:${list.find((c) => c.name === name).id}` } });
      const f = formOfBlocks(b, "save").fields.find((x) => x.name === "timerOnly");
      assert.deepEqual([f.kind, f.value, f.label, f.help], ["segmented", value, L.f_timer_only, undefined], `${lang} ${name}: no switch, no fixed help`);
      assert.deepEqual(f.options, [{ value: "off", label: L.f_timer_only_both }, { value: "on", label: L.f_timer_only_timer }]);
      assert.ok(f.label.length <= 60 && !/:\s*$/.test(f.label));
      const spec = configOf(b).stateHelp;
      assert.deepEqual([spec.field, spec.on, spec.nameField, spec.everyField, spec.prefix, spec.first], ["timerOnly", "repeatOn", "name", "repeatEvery", "!", L.th_first]);
      assert.deepEqual(Object.keys(spec.texts).sort(), HELP_KEYS.map((k) => k.slice(3)).sort());
      assert.equal(spec.texts.timer_named_every, L.th_timer_named_every);
      assert.deepEqual(configOf(b).layout.find((x) => x.more).more.items.find((i) => i.f === "timerOnly").label, L.pill_timer_only, "the summary of More options names it");
    }
    const t = await A.panel(ctx, { query: { tab: "timers", timerAdd: "1" } });
    const nf = formOfBlocks(t, "timerNew").fields.find((x) => x.name === "timerOnly");
    assert.deepEqual([nf.kind, nf.value, nf.folded, nf.help], ["segmented", "off", true, undefined]);
    assert.equal(configOf(t).stateHelp.on, null, "a new timer always repeats: no switch to follow");
  }
  assert.ok(!("f_timer_only_help" in en) && !("f_timer_only_help" in fr), "the fixed line is gone");
});

test("Started by: the stored value does not change (same field, same meaning, 'on' = the timer only)", async () => {
  const { ctx } = world();
  const base = { name: "rappel", text: "Hello", role: "everyone", aliases: "", repeatOn: "on", repeatEvery: "900", repeatLines: "5", repeatWhen: "live" };
  assert.equal((await A.actions.create(ctx, { ...base, timerOnly: "on" })).ok, ctx.t("created"));
  const one = () => C.loadConfig(ctx).then((c) => c.data.custom.find((x) => x.name === "rappel"));
  assert.equal((await one()).timerOnly, true);
  assert.equal((await A.actions.save(ctx, { ...base, key: `custom:${(await one()).id}`, timerOnly: "off" })).ok, ctx.t("saved"));
  assert.equal((await one()).timerOnly, undefined, "the timer and the chat: the field is simply not stored");
  assert.equal((await A.actions.save(ctx, { ...base, key: `custom:${(await one()).id}`, timerOnly: "on" })).ok, ctx.t("saved"));
  assert.equal((await one()).timerOnly, true);
  await C.saveCommand(ctx, { kind: "custom" }, { name: "plain", text: "Hello" }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  const plain_ = (await C.loadConfig(ctx)).data.custom.find((x) => x.name === "plain");
  const bad = await A.actions.save(ctx, { key: `custom:${plain_.id}`, name: "plain", text: "Hello", role: "everyone", repeatEvery: "900", timerOnly: "on" });
  assert.ok(bad.errors?.timerOnly, "the timer only without a repeat is still refused, under the choice");
});

test("Started by: the line under the choice follows the choice, the name and the interval; never a sentence that contradicts the state", () => {
  for (const lang of ["fr", "en"]) {
    const L = lang === "en" ? en : fr, spec = pickSpec(lang);
    const only = client.stateHelpText(spec, { timerOnly: true, repeating: true, name: "movember", seconds: 900 });
    const both = client.stateHelpText(spec, { timerOnly: false, repeating: true, name: "movember", seconds: 900 });
    assert.notEqual(only, both);
    const nothing = lang === "en" ? /does nothing/ : /ne fait rien/, anyone = lang === "en" ? /Anyone can also type it/ : /Le chat peut aussi la taper/;
    assert.match(only, nothing); assert.doesNotMatch(only, anyone);
    assert.match(both, anyone); assert.doesNotMatch(both, nothing);
    assert.ok(only.includes(lang === "en" ? "every 15 min" : "toutes les 15 min") && both.includes(lang === "en" ? "every 15 min" : "toutes les 15 min"));
    assert.ok(only.length <= 60 && both.length <= 60, `${lang}: one line`);
    // no repeat: it explains nothing misleading, whatever the choice
    for (const timerOnly of [true, false]) assert.equal(client.stateHelpText(spec, { timerOnly, repeating: false, name: "movember", seconds: 900 }), L.th_first);
    // the name comes from the form as typed; empty name or no interval: still true and short
    assert.ok(client.stateHelpText(spec, { timerOnly: true, repeating: true, name: "movember", seconds: 900 }).includes("!movember") || lang === "fr");
    assert.equal(client.stateHelpText(spec, { timerOnly: true, repeating: true, name: "", seconds: 900 }), L.th_timer_every.replace("{every}", L.rep_every_m.replace("{min}", "15")));
    assert.equal(client.stateHelpText(spec, { timerOnly: false, repeating: true, name: "ab", seconds: null }), L.th_both_named.replace("{name}", "!ab"));
    assert.equal(client.stateHelpText(spec, { timerOnly: false, repeating: true, name: "", seconds: 30 }), L.th_both_plain, "an interval that is not whole minutes is not announced");
    assert.match(client.stateHelpText(spec, { timerOnly: true, repeating: true, name: "x", seconds: 7200 }), lang === "en" ? /every 2 h/ : /toutes les 2 h/);
    // a very long name never pushes the line past one line: it is left out
    const long = client.stateHelpText(spec, { timerOnly: false, repeating: true, name: "unetresgrandenomdecommandequiremplitlaligne", seconds: 900 });
    assert.ok(long.length <= 60 && !long.includes("unetres"), `${lang}: ${long}`);
    // the fallbacks without a name always fit one line (the named ones are only used when they fit)
    for (const k of HELP_KEYS.filter((x) => !x.includes("named"))) assert.ok(L[k].replace("{every}", L.rep_every_h.replace("{h}", "24")).length <= 60, `${lang} ${k}`);
  }
});

test("Started by: FR and EN have the same keys and the same {variables}; neutral, formal, short", () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of ["f_timer_only", "f_timer_only_both", "f_timer_only_timer", "th_first", ...HELP_KEYS]) {
    assert.ok(en[k] && fr[k], k);
    assert.equal(vars(en[k]), vars(fr[k]), k);
    for (const L of [en, fr]) assert.ok(!/[!]|Veuillez|\bkey\b|clé/.test(L[k]) && L[k].split(/\s+/).length <= 20 && !L[k].endsWith(":"), `${k}: ${L[k]}`);
  }
  assert.equal(vars(en.th_timer_named_every), "every,name");
});

// Bot Twitch 1.12.0 : les commandes, les timers, les récompenses et leurs actions s'éditent dans une FENÊTRE au-dessus de la page (`presentation: "dialog"`, cœur 0.6.7) et leurs listes sont
// des tableaux du cœur (recherche en direct, pastilles de filtre, interrupteur dans la ligne, menu « ⋯ »). Un seul tableau de commandes (colonne d'origine écrite, R30), un formulaire de trois
// champs visibles (le reste sous « Plus d'options »), UN contrôle de période, le journal avec recherche et un petit bouton « Vider » confirmé. Le script de la page (adminkit.client.js)
// ne sert plus qu'au journal, aux listes repliées et aux boutons d'action ; ses fonctions pures sont testées ici, ses effets dans un navigateur par tests/visual (captures regardées).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { searchText, rowPasses } from "@/core/adminkit/search";
import { world, say, fr, en, C, SRC, S, entry, link, NOW } from "./helpers/botWorld.mjs";
import { ownerWorld } from "./helpers/ownerSet.mjs";
import { htmlOf, rowsOf, pills, formOfBlocks, plain, cellOf, tableOf, tableRow, rowId, dialogsOf, shownFields, foldedFields } from "./helpers/ui.mjs";
import { assertAdminPageErgonomics } from "./helpers/ergonomics.mjs";

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
const list = tableOf(page, fr.col_command);
const R = (name) => tableRow(list, `!${name}`);
const nameOf = (r) => cellOf(r[0]).split(" ")[0];
const commandsTable = (blocks) => tableOf(blocks, fr.col_command);

/* ───────────── Le tableau unique ───────────── */

test("liste : UN tableau du cœur de 35 commandes, colonnes Commande / Réponse / Origine / Actif ; plus de HTML écrit à la main, de titres de groupe ni de tableaux séparés", () => {
  assert.equal(list.rows.length, 35);
  assert.deepEqual(list.columns, [fr.col_command, fr.col_answer, fr.col_origin, fr.col_active]);
  assert.equal(page.filter((b) => b.type === "table" && !b.tab && b.columns[0] === fr.col_command).length, 1);
  assert.equal(page.filter((b) => b.type === "table" && !b.tab).length, 1, "plus de tableau séparé pour les partenaires ni les réseaux");
  assert.equal(htmlOf(page, "commands"), "", "plus de liste écrite à la main : c'est un tableau du cœur");
  assert.equal(list.rowIds.length, 35);
  assert.ok(list.rowIds.every((id) => /^(custom|builtin|partner|network|group):/.test(id)), "la clé de la commande identifie la ligne");
  assert.deepEqual(page.filter((b) => b.type === "heading" && !b.tab).map((b) => b.text), [fr.summary_title], "un titre : celui de la liste ; la ligne d'état du haut dit le reste");
  for (const old of [fr.kind_custom, "Pas encore activée", "Toute prête", "Activer / désactiver", "Configurer"]) assert.ok(!JSON.stringify(page).includes(old), `plus de « ${old} »`);
  assert.deepEqual([list.searchable, list.searchPlaceholder, list.truncate], [true, fr.search_commands, [0, 1]], "recherche en direct dès le départ, textes longs coupés (R15, R16)");
  assert.deepEqual(list.filters.map((f) => f.column), [2, 3], "pastilles d'origine et d'état");
  const count = (col) => Object.fromEntries([...new Set(list.rows.map((r) => cellOf(r[col])))].map((v) => [v, list.rows.filter((r) => cellOf(r[col]) === v).length]));
  assert.deepEqual(count(2), { [fr.origin_custom]: 26, [fr.origin_builtin]: 6, [fr.origin_partner]: 3 });
  assert.deepEqual(count(3), { [fr.state_on]: 19, [fr.state_off]: 13, [fr.state_hidden]: 3 });
  assert.equal(list.rows.every((r) => r.length === 4), true);
});

test("lignes : l'origine est une colonne écrite (pastille colorée), le rôle n'apparaît que s'il est restreint, texte complet en info-bulle", () => {
  assert.deepEqual(R("tip")[2], { text: fr.origin_custom, badge: "accent" });
  assert.deepEqual(R("playing")[2], { text: fr.origin_builtin, badge: "neutral" });
  assert.deepEqual(R("tesla")[2], { text: fr.origin_partner, badge: "ok" });
  assert.ok(cellOf(R("so")[0]).includes(fr.role_mods), "restreinte à la modération : le rôle est dit");
  for (const n of ["tip", "discord", "playing"]) assert.ok(!cellOf(R(n)[0]).includes("Tout le monde") && !cellOf(R(n)[0]).includes("("), `${n} : le rôle par défaut n'est jamais répété`);
  assert.equal(cellOf(R("alive")[0]), "!alive · !a-live");
  assert.equal(cellOf(R("playing")[0]), "!playing · !queljeu");
  assert.deepEqual(R("tip")[1], { text: "Un petit don aide à garder la chaîne en vie.", title: "Un petit don aide à garder la chaîne en vie." });
  assert.equal(R("alive")[0].title, "!alive  !a-live", "tous les noms dans l'info-bulle");
});

test("tri : activées d'abord puis ordre alphabétique, stable", async () => {
  const names = list.rows.map(nameOf);
  const on = list.rows.filter((r) => r[3].switch.on).map(nameOf);
  assert.deepEqual(names.slice(0, on.length), on, "toutes les activées en premier");
  const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b, "fr"));
  assert.deepEqual(on, sorted(on));
  const off = names.slice(on.length);
  assert.deepEqual(off, sorted(off));
  const again = commandsTable(await A.panel(owner.ctx, { query: {} })).rows.map(nameOf);
  assert.deepEqual(again, names, "même ordre à chaque affichage");
});

test("interrupteur : un vrai interrupteur du cœur dans chaque ligne (état courant), aucun bouton « Activer / désactiver » ; au plus deux actions visibles, « Supprimer » dans le menu", () => {
  for (const [i, r] of list.rows.entries()) {
    const sw = r[3].switch;
    assert.equal(sw.action, "toggle", nameOf(r));
    assert.match(sw.label, /^Activer la commande !/, nameOf(r));
    assert.equal(typeof sw.on, "boolean");
    assert.ok(sw.onText && sw.offText === fr.state_off, "le texte à côté de l'interrupteur dit l'état");
    assert.ok(/^(custom|builtin|partner|network|group):/.test(list.rowIds[i]));
  }
  assert.equal(R("tip")[3].switch.on, true);
  assert.equal(R("alive")[3].switch.on, false);
  assert.deepEqual(list.rowActions, [{ label: fr.act_edit, href: "?tab=use&edit={id}", presentation: "dialog" }, { label: fr.delete_btn, action: "remove", confirm: fr.delete_row_confirm, danger: true }]);
  assert.deepEqual(list.rowActions.filter((a) => !a.danger && !a.inMenu).length, 1, "une seule action visible, la suppression est dans « ⋯ »");
});

test("commande masquée ou produite ailleurs : l'état dit pourquoi ; « Modifier » ouvre une fenêtre (la commande d'un partenaire : une fenêtre dont le bouton mène à sa fiche)", async () => {
  assert.equal(cellOf(R("followers")[3]), fr.state_hidden);
  assert.equal(R("followers")[3].switch.onText, "Masquée : followers absents");
  assert.equal(R("followers")[3].title, fr.why_followers_absent);
  assert.equal(R("planning")[3].switch.onText, "Masquée : pas d'agenda");
  assert.equal(R("reseaux")[3].switch.onText, "Masquée : aucun réseau activé");
  assert.ok(!JSON.stringify(list.rows).includes(">Modifier<"));
  // une commande à vous : la fenêtre « Modifier » ; une commande prête : la sienne aussi
  for (const n of ["tip", "playing"]) {
    const w = dialogsOf(await A.panel(owner.ctx, { query: { edit: rowId(list, R(n)) } }));
    assert.equal(w.length, 1, n);
    assert.deepEqual([w[0].action, w[0].title, w[0].submitLabel, w[0].cancelHref], ["save", `Modifier la commande !${n}`, fr.save_btn, "?tab=use"]);
  }
  // une commande de partenaire : le titre le dit, le seul bouton ouvre sa fiche (R30)
  const stub = dialogsOf(await A.panel(owner.ctx, { query: { edit: rowId(list, R("tesla")) } }))[0];
  assert.deepEqual([stub.action, stub.title, stub.submitLabel, stub.fields.map((f) => f.name)], ["openPartner", "!tesla se règle dans la fiche du partenaire", fr.act_open_partner, ["id"]]);
  assert.deepEqual(await A.actions.openPartner(owner.ctx, { id: rowId(list, R("tesla")) }), { ok: fr.act_open_partner, redirect: "/admin/entries/p2#panel-bot-chat-command" });
  // une commande qui n'existe plus : une phrase, pas de fenêtre
  const gone = await A.panel(owner.ctx, { query: { edit: "custom:nexistepas" } });
  assert.equal(dialogsOf(gone).length, 0);
  assert.ok(gone.some((b) => b.type === "banner" && b.text === fr.edit_unknown));
});

test("partenaires et réseaux sans commande : pas de lignes « Pas encore activée » ; un bouton « Ajouter… » avec recherche et une phrase d'état", async () => {
  const none = await ownerWorld({ sponsors: [entry("p1", "a", "A"), entry("p2", "b", "B")] });
  const blocks = await A.panel(none.ctx, { query: {} });
  const add = blocks.find((b) => !b.tab && b.type === "html" && b.html.includes('class="ck-add"'));
  const text = plain(add.html);
  assert.match(text, /Ajouter une commande pour un partenaire ou un réseau/);
  assert.match(text, /6 réseaux n'ont pas encore de commande\./);
  assert.match(add.html, /data-ck-q/, "avec recherche");
  const items = rowsOf(add.html);
  assert.equal(items.length, 6, "les 6 réseaux (les partenaires ont déjà leur commande dans ce jeu : 2 fiches) ");
  assert.match(items[0].html, /href="\?tab=use&amp;edit=network%3A/);
  const fresh = world({ sponsors: [entry("p1", "a", "A"), entry("p2", "b", "B"), entry("p3", "c", "C")], links: [link("y", "youtube-channel", "YouTube", "https://youtube.com/@e")] });
  const s = plain((await A.panel(fresh.ctx, { query: {} })).find((b) => !b.tab && b.type === "html" && b.html.includes('class="ck-add"')).html);
  assert.match(s, /3 partenaires et 1 réseau n'ont pas encore de commande\./);
  assert.ok(!(await A.panel(world().ctx, { query: {} })).some((b) => !b.tab && b.type === "html" && b.html.includes('class="ck-add"')), "rien à ajouter : pas de bouton");
  assert.deepEqual(commandsTable(await A.panel(fresh.ctx, { query: {} })).rows.filter((r) => cellOf(r[2]) !== fr.origin_builtin), [], "ni partenaire ni réseau non activé dans le tableau");
  // un réseau sans commande : « Ajouter » ouvre la fenêtre de sa proposition (nom, texte), enregistrée en l'activant
  const net = dialogsOf(await A.panel(none.ctx, { query: { edit: "network:twitch-channel" } }));
  assert.equal(net.length, 0, "sans réseau de ce nom : pas de fenêtre");
  SRC.resetSources();
  const key = (await A.context(none.ctx, { declare: false })).sources.networks.items[0].key;
  const open = dialogsOf(await A.panel(none.ctx, { query: { edit: `network:${key}` } }))[0];
  assert.equal(open.action, "save");
  assert.equal(open.fields.find((f) => f.name === "enabled")?.value, "on", "une proposition pas encore enregistrée s'active en l'enregistrant");
  assert.match(open.fields.find((f) => f.name === "text").help, /^L'adresse vient du réseau /);
});

/* ───────────── La recherche en direct (la règle du cœur, appliquée aux cellules du tableau) ───────────── */

// Comme TableView : le texte cherché d'une ligne est tout ce qui est affiché (texte et info-bulle de chaque cellule) ; les pastilles filtrent sur le texte de leur colonne.
const hay = (r) => searchText(r.flatMap((c) => [cellOf(c), typeof c === "object" ? c.title : undefined]));
const hit = (q, pill = {}) => list.rows.filter((r) => rowPasses({ haystack: hay(r), f0: cellOf(r[2]), f1: cellOf(r[3]) }, q, pill)).map(nameOf);

test("recherche en direct : « disc » donne 1 résultat ; insensible à la casse et aux accents ; cherche dans le nom, les autres noms, la réponse et l'état", () => {
  assert.deepEqual(hit("disc"), ["!discord"]);
  assert.deepEqual(hit("DISC"), ["!discord"], "casse");
  assert.ok(hit("de").includes("!dé") && hit("DÉ").includes("!dé") && hit("dé").includes("!dé"), "accents : « de », « DÉ » et « dé » trouvent « !dé »");
  assert.equal(hit("elephant").length, 0);
  assert.deepEqual(hit("a-live"), ["!alive"], "autre nom");
  assert.deepEqual(hit("queljeu"), ["!playing"]);
  assert.deepEqual(hit("boutique.example"), ["!boutique"], "texte de la réponse");
  assert.deepEqual(hit("moustaches rigueur"), ["!movember"], "plusieurs mots : tous doivent être présents");
  assert.equal(hit("désactivée").length, 13, "l'état");
  assert.deepEqual(hit("masquée").sort(), ["!followers", "!planning", "!reseaux"]);
  assert.ok(hit("!ti").includes("!tip") && hit("modération").includes("!so"), "préfixe et rôle");
  assert.equal(hit("").length, 35, "recherche vide : tout");
});

test("recherche : aucun résultat se voit ; les pastilles d'origine et d'état se combinent avec la recherche", () => {
  assert.deepEqual(hit("zzzzzz"), []);
  assert.equal(hit("", { f0: fr.origin_partner }).length, 3);
  assert.equal(hit("", { f0: fr.origin_custom, f1: fr.state_off }).length, 12);
  assert.equal(hit("e", { f0: fr.origin_custom, f1: fr.state_on }).every((n) => R(n.slice(1))[3].switch.on), true);
  assert.equal(hit("", { f1: fr.state_hidden }).length, 3);
  assert.equal(hit("", { f0: "all", f1: "all" }).length, 35);
});

test("recherche présente même avec peu de commandes (R15) ; les six commandes prêtes sont toutes dans la page", async () => {
  const small = commandsTable(await A.panel(world().ctx, { query: {} }));
  assert.equal(small.searchable, true);
  assert.equal(small.rows.length, 6);
});

/* ───────────── La fenêtre d'une commande ───────────── */

test("fenêtre d'une commande : 3 champs visibles (Nom, Ce que le bot répond, Qui peut l'utiliser) ; tout le reste sous « Plus d'options » ; un seul bouton principal", async () => {
  const b = await A.panel(owner.ctx, { query: { new: "1" } });
  const form = formOfBlocks(b, "create");
  assert.deepEqual([form.presentation, form.title, form.submitLabel, form.cancelHref], ["dialog", fr.new_title, "Créer la commande", "?tab=use"]);
  assert.deepEqual(shownFields(form).map((f) => f.name), ["name", "text", "role"]);
  assert.deepEqual(foldedFields(form).map((f) => f.name).sort(), ["aliases", "cdGlobal", "cdUser", "mediaVisual", "period", "repeatEvery", "repeatLines", "repeatOn", "repeatWhen", "timerOnly"]);
  assert.deepEqual(shownFields(form).map((f) => f.label), ["Nom", "Ce que le bot répond", "Qui peut l'utiliser"]);
  assert.deepEqual([form.fields.find((f) => f.name === "role").kind, form.fields.find((f) => f.name === "role").options.map((o) => o.label)], ["segmented", ["Tout le monde", "Personnes abonnées", "Modération", "Vous seulement"]], "2 à 4 choix : des boutons côte à côte (R19)");
  assert.equal(form.fields.find((f) => f.name === "text").example, "Rejoignez-nous sur Discord, {utilisateur}.");
  assert.equal(b.some((x) => x.type === "adminForm" && x.action === "create") && (await A.panel(owner.ctx, { query: {} })).some((x) => x.action === "create"), false, "sans « Nouvelle commande », pas de fenêtre");
  assert.deepEqual(b.filter((x) => !x.tab && x.type === "links").map((x) => x.items), [[{ label: fr.new_open, href: "?tab=use&new=1", presentation: "dialog" }, { label: fr.word_new_open, href: "?tab=use&new=word", presentation: "dialog" }, { label: fr.word_ex_btn, href: "?tab=use&new=word&example=1", presentation: "dialog" }]], "le bouton « Nouvelle commande » ouvre la fenêtre");
  const key = `custom:${(await C.loadConfig(owner.ctx)).data.custom.find((c) => c.name === "alive").id}`;
  const e = await A.panel(owner.ctx, { query: { edit: key } });
  const save = formOfBlocks(e, "save");
  assert.equal(save.fields.find((f) => f.name === "aliases").value, "a-live");
  assert.equal(save.submitLabel, "Enregistrer la commande");
  assert.equal(foldedFields(save).some((f) => (f.value ?? "") !== "" && f.value !== "0" && f.value !== "off"), true, "un autre nom est réglé : « Plus d'options » s'ouvre d'office");
  assertAdminPageErgonomics(b); assertAdminPageErgonomics(e);   // R3, R4, R9, R10, R11, R14, R15, R17 sur les vraies pages
});

test("attentes : deux nombres bornés avec leur unité, le champ vide dit sa valeur par défaut", async () => {
  const form = formOfBlocks(await A.panel(owner.ctx, { query: { new: "1" } }), "create");
  const wait = (n) => form.fields.find((f) => f.name === n);
  assert.deepEqual([wait("cdGlobal").kind, wait("cdGlobal").unit, wait("cdGlobal").min, wait("cdGlobal").max, wait("cdGlobal").placeholder, wait("cdGlobal").help], ["number", "secondes", 0, 3600, "20", "Vide : 20 s"]);
  assert.deepEqual([wait("cdUser").placeholder, wait("cdUser").help, wait("cdUser").label], ["60", "Vide : 60 s", "Attente pour une même personne"]);
  assert.ok(!wait("cdGlobal").label.includes("("), "l'unité est écrite à droite du champ, pas dans le libellé");
});

test("le texte de la réponse : un exemple et, dans la bulle d'aide, les morceaux disponibles pour ce genre de commande ; plus d'aperçu ni de morceaux à insérer (le cœur n'a pas ce contrôle dans une fenêtre)", async () => {
  const text = (blocks) => formOfBlocks(blocks, "create").fields.find((f) => f.name === "text");
  assert.match(text(await A.panel(owner.ctx, { query: { new: "1" } })).help, /Morceaux qui se remplissent tout seuls : \{utilisateur\}/);
  SRC.resetSources();
  const net = (await A.context(owner.ctx, { declare: false })).sources.networks.items[0];
  const nf = formOfBlocks(await A.panel(owner.ctx, { query: { edit: `network:${net.key}` } }), "save").fields.find((f) => f.name === "text");
  assert.match(nf.help, new RegExp(`^L'adresse vient du réseau ${net.name}\\. Morceaux`));
  assert.match(nf.help, /\{reseau\}/);
  assert.ok(!fs.readFileSync(`${DIR}/formsUi.mjs`, "utf8").includes("textExtras"), "le code de l'aperçu a disparu");
});

/* ───────────── Le contrôle de période ───────────── */

test("période : le champ NATIF du cœur (un seul champ), rangé sous « Plus d'options » pour les commandes ET les timers ; aucun contrôle maison", async () => {
  // un timer n'a plus de formulaire à lui : il se règle dans la fenêtre d'une commande, où le même champ de période sert
  const pw = world();   // un monde à part : le monde partagé garde ses 35 commandes
  await C.saveCommand(pw.ctx, { kind: "custom" }, { name: "periodique", text: "Texte", repeat: { minutes: 10 } }, { src: await SRC.gather(pw.ctx, "emma"), t: pw.ctx.t, prefix: "!" });
  const pid = (await C.loadConfig(pw.ctx)).data.custom.find((c) => c.name === "periodique").id;
  const cmdBlocks = await A.panel(owner.ctx, { query: { new: "1" } }), timBlocks = await A.panel(pw.ctx, { query: { tab: "timers", edit: `custom:${pid}`, repeat: "1" } });
  for (const [blocks, action] of [[cmdBlocks, "create"], [timBlocks, "save"]]) {
    const field = formOfBlocks(blocks, action).fields.find((f) => f.name === "period");
    assert.deepEqual([field.kind, field.label, field.value, field.folded], ["period", "Limiter dans le temps", "", true], "champ `period` du cœur, vide : toujours active ; rangé dans le panneau replié");
    assert.ok(field.help.length <= 60 && !/:\s*$/.test(field.label), field.help);
    assert.equal(field.openEnded, undefined, "deux dates, comme avant : le moteur du module ne connaît pas les périodes ouvertes");
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
  assert.ok(!/periodLayout|periodField|timerSave|timerCreate/.test(src), "un timer se règle dans la fenêtre de la commande");
});

/* ───────────── Timers (le bloc « Répéter automatiquement » d'une commande) ───────────── */

test("fenêtre d'une commande : « Répéter automatiquement » est sous Plus d'options (ouvert quand un timer est réglé), l'interrupteur et UNE durée ; plus de bloc « retirer » dans la fenêtre", async () => {
  const { ctx } = world();
  await C.saveCommand(ctx, { kind: "custom" }, { name: "discord", text: "Rejoignez le Discord.", repeat: { minutes: 20, lines: 4, when: "always" } }, { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" });
  const key = `custom:${(await C.loadConfig(ctx)).data.custom[0].id}`;
  const open = await A.panel(ctx, { query: { tab: "timers", edit: key, repeat: "1" } });
  const form = formOfBlocks(open, "save");
  assert.deepEqual(shownFields(form).map((f) => f.name), ["name", "text", "role"], "le chemin court ne change pas");
  assert.deepEqual([form.tab, form.cancelHref, form.title, form.submitLabel], ["timers", "?tab=timers", "Modifier le timer !discord", "Enregistrer le timer"], "ouverte depuis l'onglet Timers : la liste des timers reste derrière");
  const f = Object.fromEntries(form.fields.map((x) => [x.name, x]));
  assert.deepEqual([f.repeatOn.kind, f.repeatOn.value, f.repeatEvery.kind, f.repeatEvery.value, f.repeatEvery.min, f.repeatEvery.max], ["switch", "on", "duration", 1200, 60, 86400]);
  assert.match(f.repeatEvery.example, /minutes/);
  assert.deepEqual([f.repeatLines.value, f.repeatLines.unit, f.repeatWhen.kind, f.repeatWhen.value], [4, "messages", "segmented", "always"]);
  assert.ok(Object.values(f).filter((x) => x.folded).length >= 5 && ["repeatOn", "repeatEvery", "repeatLines", "repeatWhen", "timerOnly"].every((n) => f[n].folded), "tout est replié");
  assert.ok(!open.some((b) => b.type === "table" && b.rowActions?.some((a) => ["timerRemove", "timerKeep"].includes(a.action))), "retirer un timer est dans le menu de sa ligne (onglet Timers)");
  // venu d'« Ajouter ce timer » (commande sans timer) : l'interrupteur est déjà allumé, un seul bouton principal avec un verbe précis
  const fresh_ = world();
  await C.saveCommand(fresh_.ctx, { kind: "custom" }, { name: "libre", text: "Libre" }, { src: await SRC.gather(fresh_.ctx, "emma"), t: fresh_.ctx.t, prefix: "!" });
  const k2 = `custom:${(await C.loadConfig(fresh_.ctx)).data.custom[0].id}`;
  const intent = formOfBlocks(await A.panel(fresh_.ctx, { query: { tab: "use", edit: k2, repeat: "1" } }), "save");
  assert.equal(intent.submitLabel, "Ajouter ce timer");
  assert.equal(intent.fields.find((x) => x.name === "repeatOn").value, "on");
  // sans timer et sans intention : rien de réglé, « Plus d'options » reste fermé
  const plain_ = formOfBlocks(await A.panel(fresh_.ctx, { query: { edit: k2 } }), "save");
  assert.equal(foldedFields(plain_).some((x) => (x.value ?? "") !== "" && x.value !== "0" && x.value !== "off"), false);
  assert.equal(plain_.submitLabel, "Enregistrer la commande");
  // le formulaire envoyé vide (rien de réglé) ne crée aucun timer ; allumer l'interrupteur sans rien d'autre prend les valeurs par défaut
  const body = { key: k2, name: "libre", text: "Libre", role: "everyone", repeatEvery: "", repeatLines: "", repeatWhen: "", timerOnly: "off" };
  assert.equal((await A.actions.save(fresh_.ctx, body)).ok, fresh_.ctx.t("saved"));
  assert.equal((await C.loadConfig(fresh_.ctx)).data.custom[0].repeat ?? null, null, "aucun timer");
  assert.equal((await A.actions.save(fresh_.ctx, { ...body, repeatOn: "on" })).ok, fresh_.ctx.t("saved"));
  assert.deepEqual((await C.loadConfig(fresh_.ctx)).data.custom[0].repeat, { minutes: 15, lines: 5, when: "live", enabled: true }, "quinze minutes, cinq messages, en direct : les valeurs dites dans l'aide");
});

test("liste des commandes : une commande réservée au timer porte la pastille écrite « Timer seulement » (et seulement elle, R14), montre son titre et reste modifiable", async () => {
  const { ctx } = world();
  const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
  await C.saveCommand(ctx, { kind: "custom" }, { name: "merch", text: "Boutique" }, env);
  await C.mutate(ctx, (cfg) => { cfg.custom.push({ id: "tx1", name: "rappel", title: "Rappel du Discord", aliases: [], text: "Le Discord !", role: "everyone", enabled: true, cdGlobal: null, cdUser: null, timerOnly: true, repeat: { minutes: 15, lines: 5, when: "live", enabled: true } }); return { ok: true }; });
  const b = await A.panel(ctx, { query: {} });
  const t = commandsTable(b);
  const timer = t.rows.find((r) => cellOf(r[0]).startsWith("Rappel du Discord"));
  assert.ok(timer);
  assert.deepEqual(timer[2], { text: "Timer seulement", badge: "info" });
  assert.equal(t.rows.filter((r) => cellOf(r[2]) === "Timer seulement").length, 1, "la pastille n'est que sur cette ligne");
  assert.equal(t.rowIds[t.rows.indexOf(timer)], "custom:tx1");
  const e = await A.panel(ctx, { query: { edit: "custom:tx1" } });
  const form = formOfBlocks(e, "save");
  assert.ok(!form.fields.some((x) => x.name === "role"), "personne à qui la permettre : pas de choix du rôle");
  assert.equal(form.fields.find((x) => x.name === "timerOnly").value, "on");
  // dans le chat, personne ne peut la taper
  const out = await say(ctx, "!rappel", { login: "curieux" }, NOW);
  assert.equal(out.handled, false);
  // « Supprimer le timer » d'une commande « seulement pour le timer » : la commande n'existe que pour lui, elle part avec lui (la confirmation de la ligne le dit)
  const tab = await A.panel(ctx, { query: { tab: "timers" } });
  const tt = tableOf(tab.filter((x) => x.tab === "timers"), fr.col_command);
  const del = tt.rowActions.find((a) => a.action === "timerDelete");
  assert.deepEqual([del.danger, del.confirm], [true, fr.tm_delete_confirm]);
  assert.match(del.confirm, /commande créée seulement pour lui est supprimée avec lui.*toute autre commande reste/);
  assert.equal((await TA.actions.timerDelete.run(ctx, { id: "custom:tx1" })).ok, fr.tm_deleted_cmd);
  assert.equal((await C.loadConfig(ctx)).data.custom.find((c) => c.id === "tx1"), undefined, "jamais de passage silencieux dans le chat : elle n'existe plus");
  assert.equal((await say(ctx, "!rappel", { login: "curieux" }, NOW + 1000)).handled, false);
  assert.equal((await C.loadConfig(ctx)).data.custom.find((c) => c.name === "merch").name, "merch", "les autres commandes ne bougent pas");
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
  assert.deepEqual(manifest.mcp.map((m) => m.name), ["bot_commands_list", "bot_command_create", "bot_command_update", "rewards_list", "reward_create", "reward_simulate", "reward_update", "timers_list", "timer_create", "timer_update", "collaboration_mode_set"]);
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
  assert.equal(commandsTable(b).rows.length, 35, "la page habituelle");
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
  assert.ok(Object.keys(manifest).includes("version") && manifest.version === "1.20.0");
});

/* ───────────── "Started by": the timer and the chat | the timer only ───────────── */

test("Started by: a two-choice segmented control on the same stored field, folded under More options, with no fixed help line, in both languages", async () => {
  for (const lang of ["fr", "en"]) {
    const L = lang === "en" ? en : fr;
    const { ctx } = world(lang === "en" ? { locale: "en" } : {});
    const env = { src: await SRC.gather(ctx, "emma"), t: ctx.t, prefix: "!" };
    await C.saveCommand(ctx, { kind: "custom" }, { name: "movember", text: "Hello", repeat: { minutes: 15, lines: 5, when: "live", enabled: true }, timerOnly: true }, env);
    await C.saveCommand(ctx, { kind: "custom" }, { name: "regular", text: "Hello", repeat: { minutes: 15, lines: 5, when: "live", enabled: true } }, env);
    const list_ = (await C.loadConfig(ctx)).data.custom;
    for (const [name, value] of [["movember", "on"], ["regular", ""]]) {
      const b = await A.panel(ctx, { query: { edit: `custom:${list_.find((c) => c.name === name).id}` } });
      const f = formOfBlocks(b, "save").fields.find((x) => x.name === "timerOnly");
      assert.deepEqual([f.kind, f.value, f.label, f.help, f.folded], ["segmented", value, L.f_timer_only, undefined, true], `${lang} ${name}: no switch, no fixed help, folded`);
      assert.deepEqual(f.options, [{ value: "", label: L.f_timer_only_both }, { value: "on", label: L.f_timer_only_timer }]);
      assert.ok(f.label.length <= 60 && !/:\s*$/.test(f.label));
    }
    const t = await A.panel(ctx, { query: { tab: "timers", timerAdd: "1" } });
    const nf = formOfBlocks(t, "timerNew").fields.find((x) => x.name === "timerOnly");
    assert.deepEqual([nf.kind, nf.value, nf.folded, nf.help], ["segmented", "", true, undefined]);
  }
  assert.ok(!("f_timer_only_help" in en) && !("f_timer_only_help" in fr), "the fixed line is gone");
  assert.ok(!Object.keys(fr).some((k) => /^th_/.test(k)), "the lines written by the page script are gone with it");
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

test("Started by: FR and EN have the same keys and the same {variables}; neutral, formal, short", () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of ["f_timer_only", "f_timer_only_both", "f_timer_only_timer"]) {
    assert.ok(en[k] && fr[k], k);
    assert.equal(vars(en[k]), vars(fr[k]), k);
    for (const L of [en, fr]) assert.ok(!/[!]|Veuillez|\bkey\b|clé/.test(L[k]) && L[k].split(/\s+/).length <= 20 && !L[k].endsWith(":"), `${k}: ${L[k]}`);
  }
});

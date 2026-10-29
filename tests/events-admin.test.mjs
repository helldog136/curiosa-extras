// Événements : l'administration (le parcours d'Emma), les erreurs sous le champ, les droits, les types et les gabarits, l'import et l'export.
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent, addType, A, rows } from "./helpers/eventsKit.mjs";

const act = (ctx, name, values) => def.adminActions[name].run(ctx, values);
const FIELD_KINDS = new Set(["text", "textarea", "email", "url", "number", "date", "select", "hidden", "image", "checkbox", "file"]);
const forms = (blocks) => blocks.filter((b) => b.type === "adminForm");
const field = (form, name) => form.fields.find((f) => f.name === name);

test("premier passage : le choix d'un modèle de départ, puis le petit formulaire (titre, date, heure, lieu, texte)", async () => {
  const ctx = ctxFor();
  const blocks = await A.panel(ctx, { query: {} });
  const [starter, quick] = forms(blocks);
  assert.equal(starter.action, "chooseStarter");
  assert.deepEqual(field(starter, "starter").options.map((o) => o.value), ["association", "solo", "empty"]);
  assert.match(field(starter, "starter").options[0].label, /^Association \/ collectif$/);
  assert.match(field(starter, "starter").help, /événement, atelier, formation, masterclass, rencontre/);
  assert.match(field(starter, "starter").options[2].label, /^Vide/);
  assert.equal(quick.action, "quickAdd");
  assert.deepEqual(quick.fields.map((f) => f.name), ["title", "date", "time", "place", "text", "publish"]);
  assert.equal(field(quick, "publish").value, "on");
  assert.equal(field(quick, "date").kind, "date");
  assert.ok(!quick.fields.some((f) => f.required), "pas de blocage du navigateur : les erreurs s'affichent sous le champ");
  assert.ok(blocks.some((b) => b.type === "markdown" && /\*\*Europe\/Paris\*\*/.test(b.text)));
  assert.ok(blocks.some((b) => b.type === "heading" && b.text === "Mes rendez-vous"));
});

test("parcours d'Emma : un modèle, un premier rendez-vous, une erreur volontaire corrigée, puis « plus d'options »", async () => {
  const ctx = ctxFor();
  const started = await act(ctx, "chooseStarter", { starter: "association" });
  assert.match(started.ok, /5 types ajoutés/);
  assert.equal(forms(await A.panel(ctx, { query: {} })).filter((f) => f.action === "chooseStarter" && /Par où commencer/.test(f.title)).length, 0);
  const bad = await act(ctx, "quickAdd", { title: "  ", date: "bientôt", time: "14h", place: "Salle", text: "" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["date", "title"]);
  assert.match(bad.errors.title, /Écrivez un titre\. Exemple/);
  assert.match(bad.errors.date, /2026-11-14|14\/11\/2026/);
  assert.equal(bad.error, undefined);
  assert.equal(rows(ctx, "ev_events").length, 0);
  const good = await act(ctx, "quickAdd", { title: "Atelier d'initiation", date: "2031-03-15", time: "14h", place: "Salle des fêtes", text: "Venez !", publish: "on" });
  assert.match(good.ok, /Ajouté et publié/);
  const [ev] = rows(ctx, "ev_events");
  assert.deepEqual([ev.status, ev.time, ev.type], ["published", "14:00", ""]);
  assert.match(good.redirect, /^\?edit=/);
  const edit = await A.panel(ctx, { query: { edit: ev.id } });
  assert.equal(forms(edit).length, 1);
  assert.deepEqual(field(forms(edit)[0], "type").options.map((o) => o.value), ["", "event", "workshop", "training", "masterclass", "meetup"]);
  assert.ok(edit.some((b) => b.type === "links" && b.items.some((i) => /more=1/.test(i.href))));
  const more = await A.panel(ctx, { query: { edit: ev.id, more: "1" } });
  assert.deepEqual(forms(more).map((f) => f.title), ["Modifier le rendez-vous", "Fin, fuseau et coordonnées", "Programme et personnes invitées", "Image, inscription et vidéo", "Après le rendez-vous : photos et vidéo", "Répéter ce rendez-vous"]);
  const e1 = await act(ctx, "saveEvent", { id: ev.id, section: "program", program: "Accueil sans heure", speakers: "" });
  assert.match(e1.errors.program, /Ligne 1 : commencez par l'heure\. Exemple : 14:30/);
  const ok = await act(ctx, "saveEvent", { id: ev.id, section: "program", program: "14:00 Accueil\n15:00 Atelier", speakers: "Camille | Illustratrice | /equipe/camille" });
  assert.match(ok.ok, /Enregistré/);
  assert.equal(rows(ctx, "ev_events")[0].program.length, 2);
});

test("erreurs : chacune sous son champ, avec un exemple", async () => {
  const ctx = ctxFor();
  await act(ctx, "quickAdd", { title: "A", date: "2031-03-15", time: "14:00" });
  const id = rows(ctx, "ev_events")[0].id;
  const t = await act(ctx, "saveEvent", { id, section: "where", endDate: "", endTime: "13:00", tz: "", lat: "50", lng: "" });
  assert.match(t.errors.endTime, /La fin doit venir après le début/);
  assert.match(t.errors.lng, /latitude ET la longitude/i);
  const m = await act(ctx, "saveEvent", { id, section: "media", image: "ftp://x", signupUrl: "oups", seatsLeft: "x", seatsTotal: "", videoUrl: "https://example.org/a.html" });
  assert.deepEqual(Object.keys(m.errors).sort(), ["image", "seatsLeft", "signupUrl", "videoUrl"]);
  assert.match(m.errors.signupUrl, /https:\/\/www\.example\.org\/inscription/);
  assert.match((await act(ctx, "saveEvent", { id: "n-existe-pas", section: "essential", title: "x", date: "2031-03-15" })).error, /n'existe plus/);
  assert.match((await act(ctx, "repeat", { id, every: "week", count: "", until: "" })).errors.count, /nombre de rendez-vous/);
  assert.match((await act(ctx, "repeat", { id, every: "week", count: "1" })).errors.count, /au moins 2/);
  assert.match((await act(ctx, "repeat", { id, every: "week", until: "2031-01-01" })).errors.until, /après la date/);
  assert.match((await act(ctx, "repeat", { id, every: "week", count: "5" })).ok, /5 rendez-vous/);
  assert.match((await act(ctx, "repeat", { id, every: "week", count: "5" })).error, /déjà/);
});

test("liste : à venir / passés / brouillons / tous, recherche, 25 par page, boutons", async () => {
  const ctx = ctxFor();
  await addType(ctx);
  for (let i = 0; i < 30; i++) await addEvent(ctx, { title: `Futur ${i}`, date: "2032-01-01", type: "atelier" });
  await addEvent(ctx, { title: "Passé", date: "2020-01-01" });
  await addEvent(ctx, { title: "Brouillon rare", date: "2032-03-01", status: "draft" });
  const table = (blocks) => blocks.find((b) => b.type === "table" && b.columns.length === 4);
  const first = table(await A.panel(ctx, { query: {} }));
  assert.equal(first.rows.length, 25);
  assert.deepEqual(first.columns, ["Titre", "Date", "Type", "État"]);
  assert.deepEqual(first.rowActions.map((a) => a.label), ["Modifier", "Publier / retirer", "Dupliquer", "Supprimer"]);
  assert.equal(first.rowActions[3].danger, true); assert.ok(first.rowActions[3].confirm);
  assert.equal(table(await A.panel(ctx, { query: { page: "2" } })).rows.length, 6);
  assert.deepEqual(table(await A.panel(ctx, { query: { show: "past" } })).rows.map((r) => r[0]), ["Passé"]);
  assert.deepEqual(table(await A.panel(ctx, { query: { show: "draft" } })).rows.map((r) => r[0]), ["Brouillon rare"]);
  assert.equal(table(await A.panel(ctx, { query: { show: "all", page: "2" } })).rows.length, 7);
  assert.deepEqual(table(await A.panel(ctx, { query: { q: "rare", show: "all" } })).rows.map((r) => r[0]), ["Brouillon rare"]);
  assert.ok((await A.panel(ctx, { query: { q: "zzzz" } })).some((b) => b.type === "markdown" && /Aucun rendez-vous ne correspond/.test(b.text)));
  assert.equal((await act(ctx, "search", { show: "past", q: " mot & co " })).redirect, "?show=past&q=mot%20%26%20co");
  const tabs = (await A.panel(ctx, { query: {} })).find((b) => b.type === "links" && b.items.length === 4);
  assert.match(tabs.items[0].label, /À venir \(31\)/); assert.match(tabs.items[2].label, /Brouillons \(1\)/);
  const small = ctxFor();
  await addEvent(small, { title: "Un seul" });
  assert.ok(!forms(await A.panel(small, { query: {} })).some((f) => f.action === "search"), "pas de recherche pour une courte liste");
});

test("actions sur un rendez-vous : publier / retirer, dupliquer (brouillon), supprimer", async () => {
  const ctx = ctxFor();
  const id = await addEvent(ctx, { title: "Soirée", date: "2031-05-01" });
  assert.match((await act(ctx, "toggle", { id })).ok, /remis en brouillon/);
  assert.equal(rows(ctx, "ev_events")[0].status, "draft");
  assert.match((await act(ctx, "toggle", { id })).ok, /est publié/);
  const d = await act(ctx, "duplicate", { id });
  assert.match(d.ok, /brouillon/); assert.match(d.redirect, /^\?edit=/);
  assert.ok(rows(ctx, "ev_events").some((r) => r.title === "Soirée (copie)" && r.status === "draft"));
  assert.match((await act(ctx, "remove", { id })).ok, /supprimé/);
  assert.equal(rows(ctx, "ev_events").length, 1);
  assert.match((await act(ctx, "remove", { id })).error, /n'existe plus/);
  assert.match((await act(ctx, "toggle", { id: "../x" })).error, /n'existe plus/);
});

test("types : ajouter, modifier, monter, supprimer ; nom par langue du site ; erreurs sous le champ", async () => {
  const ctx = ctxFor();
  assert.match((await act(ctx, "saveType", { id: "", name_fr: "Atelier", name_en: "Workshop", color: "teal", icon: "🛠️" })).ok, /Type ajouté/);
  assert.match((await act(ctx, "saveType", { id: "", name_fr: "", name_en: "", color: "teal" })).errors.name_fr, /Donnez un nom/);
  assert.match((await act(ctx, "saveType", { id: "", name_fr: "ATELIER", color: "rose" })).errors.name_fr, /porte déjà ce nom/);
  assert.match((await act(ctx, "saveType", { id: "", name_fr: "Autre", color: "rouge-flashy" })).errors.color, /couleur/);
  await act(ctx, "saveType", { id: "", name_fr: "Rencontre", name_en: "Meetup", color: "accent2" });
  const [a, b] = rows(ctx, "ev_types");
  assert.match((await act(ctx, "typeUp", { id: b.id })).ok, /Ordre changé/);
  assert.match((await act(ctx, "typeUp", { id: b.id })).error, /déjà au bout/);
  assert.match((await act(ctx, "removeType", { id: a.id })).ok, /Type supprimé/);
  const blocks = await A.panel(ctx, { query: { type: b.id } });
  const typeForm = forms(blocks).find((f) => f.action === "saveType");
  assert.equal(field(typeForm, "name_fr").value, "Rencontre"); assert.equal(typeForm.title, "Modifier le type");
  assert.ok(typeForm.fields.find((f) => f.name === "color").options.some((o) => o.value === "accent" && /thème/.test(o.label)));
  assert.ok(blocks.filter((x) => x.tab === "more").length >= 5);
});

test("fichiers : export téléchargeable, import avec « vérifier d'abord », rapport lisible après le rechargement", async () => {
  const ctx = ctxFor();
  const csv = "titre;date;heure\nAtelier A;15/03/2031;14h\nSans date;;\nBon;2031-04-01;\n";
  assert.match((await act(ctx, "importCsv", { file: "", dry: "on" })).errors.file, /Choisissez un fichier/);
  assert.match((await act(ctx, "importCsv", { file: "foo,bar\n1,2", dry: "on" })).errors.file, /colonnes/);
  assert.match((await act(ctx, "importCsv", { file: csv, dry: "on" })).ok, /2 lignes sur 3 sont prêtes/);
  assert.equal(rows(ctx, "ev_events").length, 0);
  const shown = (await A.panel(ctx, { query: {} })).filter((b) => b.tab === "more");
  assert.ok(shown.some((b) => b.type === "heading" && /Rapport de vérification/.test(b.text)));
  const rep = shown.find((b) => b.type === "table" && b.columns[0] === "Ligne");
  assert.deepEqual(rep.columns, ["Ligne", "Colonne", "Ce qu'il faut corriger"]);
  assert.deepEqual(rep.rows[0].slice(0, 2), ["3", "date"]); assert.match(rep.rows[0][2], /Choisissez une date/);
  assert.match((await act(ctx, "importCsv", { file: csv, publish: "on" })).ok, /2 rendez-vous ajoutés sur 3 lignes/);
  assert.deepEqual(rows(ctx, "ev_events").map((r) => r.status), ["published", "published"]);
  assert.match((await act(ctx, "importCsv", { file: csv, publish: "on" })).ok, /2 existaient déjà/);
  const dl = def.adminDownloads.events;
  let out = "";
  for await (const chunk of dl.generate(ctx)) out += chunk;
  assert.match(out, /Atelier A/);
  assert.equal(dl.contentType, "text/csv");
  const panel = await A.panel(ctx, { query: {} });
  assert.equal(panel.find((b) => b.type === "adminForm" && b.action === "importCsv").fields.find((f) => f.kind === "file").maxBytes, 5_000_000);
  assert.ok(panel.some((b) => b.type === "download" && b.name === "events" && b.tab === "more"));
});

test("droits : sans « events.edit », on lit mais on n'écrit pas — ni formulaire, ni bouton ; chaque action l'exige", async () => {
  const ro = ctxFor({}, { rights: [] });
  await addEvent(ro, { title: "Visible" });
  const blocks = await A.panel(ro, { query: {} });
  assert.equal(forms(blocks).length, 0);
  assert.ok(blocks.some((b) => b.type === "markdown" && /droit/.test(b.text)));
  const table = blocks.find((b) => b.type === "table" && b.columns.length === 4);
  assert.deepEqual(table.rowActions, []);
  assert.equal(forms(await A.panel(ro, { query: { edit: table.rowIds[0] } })).length, 0);
  for (const [name, a] of Object.entries(def.adminActions)) assert.equal(a.right, "events.edit", name);
});

test("blocs : seuls des blocs et des champs connus du cœur, onglets existants", async () => {
  const ctx = ctxFor();
  await act(ctx, "chooseStarter", { starter: "solo" });
  await act(ctx, "quickAdd", { title: "Un", date: "2031-03-15" });
  await act(ctx, "quickAdd", { title: "Passé", date: "2020-03-15" });
  const id = rows(ctx, "ev_events")[0].id;
  for (const query of [{}, { edit: id }, { edit: id, more: "1" }, { show: "all" }, { show: "past" }]) {
    for (const b of await A.panel(ctx, { query })) {
      assert.ok(["heading", "markdown", "table", "adminForm", "links", "banner", "download", "suggestInstall"].includes(b.type), b.type);
      assert.ok([undefined, "more"].includes(b.tab), `onglet ${b.tab}`);
      if (b.type === "adminForm") for (const f of b.fields) { assert.ok(FIELD_KINDS.has(f.kind ?? "text"), `${f.name} : ${f.kind}`); assert.ok(f.label); }
      if (b.type === "links") for (const l of b.items) assert.match(l.href, /^\//);
    }
  }
  assert.equal(await A.badge(ctx), 0);
  await def.mcp.agenda_create_event(ctx, { title: "Brouillon IA", date: "2031-06-01" });
  assert.equal(await A.badge(ctx), 1);
});

// Carte : l'administration (formulaires, erreurs sous le champ, droits, ordre, types, gabarits, villes), l'import de fichier progressif, l'export, l'assistant IA, la sauvegarde.
import test from "node:test";
import assert from "node:assert/strict";
import { manifest, def, data, ctxFor, addPlace, html, page, rows, csvio, text, has, templates } from "./helpers/mapKit.mjs";

const A = def.adminActions;
const run = (name, ctx, values) => A[name].run(ctx, values);
const SERIOUS = "https://www.google.com/maps/place/X/@12.30,34.50,17z/data=!3d12.3456!4d34.5678";
const place = async (ctx, extra = {}) => run("savePlace", ctx, { name: "Studio du Centre", type: "", mapLink: SERIOUS, address: "1 rue A", description: "Texte", hours: "9 h–18 h", url: "https://www.exemple.org", published: "on", ...extra });
const byType = (blocks, type) => blocks.filter((b) => b.type === type);

test("panneau : lieux et outils, blocs bien formés, chaque action visée existe et a un droit", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await place(ctx);
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.ok(blocks.filter((b) => b.tab === "tools").length > 5 && blocks.filter((b) => !b.tab).length > 4);
  for (const b of blocks) {
    if (b.tab) assert.equal(b.tab, "tools");
    if (b.action) assert.ok(A[b.action], `action « ${b.action} »`);
    for (const ra of b.rowActions ?? []) if (ra.action) assert.ok(A[ra.action], ra.action);
    if (b.type === "download") assert.ok(def.adminDownloads[b.name]);
  }
  assert.deepEqual(byType(blocks, "adminForm").map((f) => f.action).filter((a) => a !== "filter"), ["savePlace", "saveType", "applyTemplate", "saveCity", "importCsv"]);
  const everything = JSON.stringify(blocks).toLowerCase();
  for (const jargon of ["json", "endpoint", "slug", "payload", "latlng"]) assert.ok(!everything.includes(jargon), jargon);
  assert.equal(await def.adminBadge(ctx), 0);
});

test("instance sans crochet de création : le jeu de départ est posé au premier usage, une seule fois", async () => {
  const ctx = ctxFor();
  const blocks = await def.adminPanel(ctx, { query: {} });
  assert.deepEqual((await data.world(ctx)).types.map((t) => t.id), ["place", "event"]);
  assert.ok(byType(blocks, "adminForm").find((f) => f.action === "savePlace").fields.some((f) => f.name === "type"));
  for (const t of (await data.world(ctx)).types) await run("removeType", ctx, { id: t.rowId });
  await def.adminPanel(ctx, { query: {} });
  assert.equal((await data.world(ctx)).types.length, 0, "supprimés à dessein : ils ne reviennent pas");
});

test("ajouter un lieu : le lien de carte donne la position, l'adresse reste du texte, brouillon ou publié selon le droit", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const r = await place(ctx);
  assert.ok(r.ok && /Position lue : 12\.3456, 34\.5678/.test(r.ok), r.ok ?? JSON.stringify(r));
  const [p] = rows(ctx, "map_places");
  assert.equal(p.lat, 12.3456); assert.equal(p.lng, 34.5678);
  assert.equal(p.status, "published"); assert.equal(p.type, "place"); assert.equal(p.by, "admin");
  assert.match(p.code, /^p[a-z0-9]{8}$/);
  assert.equal(p.mapLink, undefined, "le lien collé n'est pas gardé");
  assert.ok((await html(ctx)).includes("Studio du Centre"));
  const editor = ctxFor({}, { rights: ["edit"] });
  await def.hooks.onInstanceCreate(editor);
  has((await place(editor)).ok, /droit de publier/);
  assert.equal(rows(editor, "map_places")[0].status, "draft");
  assert.ok(!(await html(editor)).includes("Studio du Centre"));
  const r3 = await run("savePlace", ctx, { name: "Autre", type: "place", mapLink: "", lat: "-12,5", lng: "30.25", published: "" });
  assert.ok(r3.ok); assert.equal(rows(ctx, "map_places").at(-1).status, "draft"); assert.equal(rows(ctx, "map_places").at(-1).lat, -12.5);
  assert.equal(await def.adminBadge(ctx), 0, "un brouillon écrit par l'équipe n'attend personne");
});

test("erreurs : chaque erreur est sous son champ, avec un exemple et ce qu'il faut faire ; rien n'est enregistré", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const bad = async (values, field, re) => {
    const r = await run("savePlace", ctx, { type: "place", ...values });
    assert.ok(r.errors && r.errors[field], `${field} : ${JSON.stringify(r)}`);
    has(r.errors[field], re, `${field} : « ${r.errors[field]} »`);
    assert.equal(r.error, undefined);
  };
  await bad({ name: "  ", mapLink: SERIOUS }, "name", /Écrivez un nom\. Exemple/);
  await bad({ name: "A", mapLink: "" }, "mapLink", /collez un lien de carte/);
  await bad({ name: "A", mapLink: "https://maps.app.goo.gl/AbC" }, "mapLink", /raccourci.*copiez l'adresse complète/);
  await bad({ name: "A", mapLink: "une rue au hasard" }, "mapLink", /Google Maps, OpenStreetMap ou Plans/);
  await bad({ name: "A", mapLink: "", lat: "abc", lng: "4" }, "lat", /Exemple : 12\.3456/);
  await bad({ name: "A", mapLink: "", lat: "95", lng: "4" }, "lat", /−90 à 90/);
  await bad({ name: "A", mapLink: "", lat: "10", lng: "200" }, "lng", /−180 à 180/);
  await bad({ name: "A", mapLink: "", lat: "0", lng: "0" }, "lng", /0, 0/);
  await bad({ name: "A", mapLink: SERIOUS, url: "www.exemple.org" }, "url", /https:\/\/www\.exemple\.org/);
  await bad({ name: "A", mapLink: SERIOUS, url: "javascript:alert(1)" }, "url", /adresse complète/);
  await bad({ name: "A", mapLink: SERIOUS, type: "inconnu" }, "type", /Types possibles : place, event/);
  assert.equal(rows(ctx, "map_places").length, 0);
  const en = ctxFor({}, { locale: "en" });
  await def.hooks.onInstanceCreate(en);
  const r = await run("savePlace", en, { name: "", mapLink: "", type: "place" });
  has(r.errors.name, /Write a name\. Example/); has(r.errors.mapLink, /paste a map link/);
});

test("modifier un lieu : la position reste si aucun lien n'est collé, un lieu publié par un éditeur sans droit reste publié, aucune écriture sur une autre ligne", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await place(ctx);
  const [p] = rows(ctx, "map_places");
  assert.ok((await run("savePlace", ctx, { id: p.id, name: "Renommé", type: "event", mapLink: "", lat: String(p.lat), lng: String(p.lng), address: "Nouvelle", description: "", hours: "", url: "", published: "on" })).ok);
  const q = rows(ctx, "map_places")[0];
  assert.equal(q.name, "Renommé"); assert.equal(q.type, "event"); assert.equal(q.lat, 12.3456); assert.equal(q.code, p.code, "le code ne change jamais");
  const editor = ctxFor({}, { rights: ["edit"] });
  editor.api.store = ctx.api.store; editor.instance.key = ctx.instance.key; data.invalidate(ctx);
  await run("savePlace", editor, { id: p.id, name: "Retouché", type: "event", mapLink: "", lat: "12.3456", lng: "34.5678", published: "" });
  assert.equal(rows(ctx, "map_places")[0].status, "published"); assert.equal(rows(ctx, "map_places")[0].name, "Retouché");
  assert.ok((await run("savePlace", ctx, { id: "r99999", name: "x", type: "event", lat: "1", lng: "2" })).error);
  const typeRow = [...ctx.api.store.rows.values()].find((r2) => r2.collection === "map_types");
  assert.ok((await run("savePlace", ctx, { id: typeRow.id, name: "x", type: "event", lat: "1", lng: "2" })).error);
  assert.ok((await run("removePlace", ctx, { id: typeRow.id })).error);
  assert.equal(rows(ctx, "map_types").length, 2, "le type est intact");
});

test("supprimer, déplacer (haut/bas), borne de 5000 lieux", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  for (const n of ["A", "B", "C"]) await place(ctx, { name: n, mapLink: `12.${n.charCodeAt(0)}, 34.5` });
  const order = async () => (await data.world(ctx)).places.map((p) => p.name);
  const idOf = async (n) => (await data.world(ctx)).places.find((p) => p.name === n).rowId;
  assert.deepEqual(await order(), ["A", "B", "C"]);
  await run("moveDown", ctx, { id: await idOf("A") });
  assert.deepEqual(await order(), ["B", "A", "C"]);
  await run("moveUp", ctx, { id: await idOf("C") });
  assert.deepEqual(await order(), ["B", "C", "A"]);
  assert.ok((await run("moveUp", ctx, { id: await idOf("B") })).error);
  assert.ok((await run("moveDown", ctx, { id: await idOf("A") })).error);
  const h = await html(ctx);
  assert.ok(h.indexOf(">B<") < h.indexOf(">C<") && h.indexOf(">C<") < h.indexOf(">A<"));
  for (const r of ctx.api.store.rows.values()) if (r.collection === "map_places") r.data.pos = 7;
  data.invalidate(ctx);
  await run("moveDown", ctx, { id: await idOf("B") });
  assert.equal(new Set((await data.world(ctx)).places.map((p) => p.pos)).size, 3);
  await run("removePlace", ctx, { id: await idOf("B") });
  assert.equal(rows(ctx, "map_places").length, 2);
  await ctx.api.store.addMany("map_places", Array.from({ length: 4998 }, (_, i) => ({ data: { code: `pz${String(i).padStart(7, "0")}`, name: `L${i}`, type: "place", lat: 1 + (i % 80), lng: 2 + (i % 170) / 2, status: "draft", pos: i + 10 } })));
  data.invalidate(ctx);
  has((await place(ctx, { name: "De trop" })).error, /5000 lieux/);
});

test("publier les brouillons d'un coup, seulement avec le droit de publier", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  for (let i = 0; i < 3; i++) await place(ctx, { name: `B${i}`, mapLink: `12.${i + 1}, 34.5`, published: "" });
  assert.equal(def.adminActions.publishDrafts.right, "publish");
  has((await run("publishDrafts", ctx, { scope: "all" })).ok, /3 lieux publiés/);
  assert.equal((await data.world(ctx)).places.filter((p) => p.status === "published").length, 3);
  assert.ok(!(await def.adminPanel(ctx, { query: {} })).some((b) => b.action === "publishDrafts"), "plus de brouillon : plus de bouton");
});

test("liste de l'administration : recherche, état, type, pagination par 50 ; modifier un lieu préremplit le formulaire", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  for (let i = 0; i < 60; i++) await addPlace(ctx, { name: i === 7 ? "Cherché" : `Lieu ${i}`, status: i % 3 === 0 ? "draft" : "published", type: i % 2 ? "event" : "place" });
  const list = async (query) => byType(await def.adminPanel(ctx, { query }), "table").find((t) => t.columns.length === 3 && t.rowActions?.some((a) => a.action === "moveUp"));
  assert.equal((await list({})).rows.length, 50);
  assert.equal((await list({ page: "2" })).rows.length, 10);
  assert.deepEqual((await list({ q: "cherche" })).rows.map((r) => r[0]), ["Cherché"]);
  assert.equal((await list({ state: "draft" })).rows.length, 20);
  assert.equal((await list({ type: "event" })).rows.length, 30);
  assert.equal((await run("filter", ctx, { q: "Lieu 1", state: "published", type: "event" })).redirect, "?q=Lieu%201&state=published&type=event");
  assert.ok(!(await run("filter", ctx, { q: "<x>", state: "x", type: "../.." })).redirect.includes("<"));
  const target = (await data.world(ctx)).places[3];
  const form = byType(await def.adminPanel(ctx, { query: { edit: target.rowId } }), "adminForm")[0];
  assert.equal(form.action, "savePlace");
  assert.equal(form.fields.find((f) => f.name === "name").value, target.name);
  assert.equal(form.fields.find((f) => f.name === "lat").value, String(target.lat));
  assert.equal(form.fields.find((f) => f.name === "mapLink").value, "");
  assert.ok(form.cancelHref);
});

test("types : ajouter (identifiant unique), modifier, ordonner, supprimer seulement s'ils ne servent à rien ; limite de 30", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  assert.deepEqual((await data.world(ctx)).types.map((t) => t.id), ["place", "event"]);
  assert.ok((await run("saveType", ctx, { name_fr: "Bonne adresse", name_en: "Good address", sym: "⭐" })).ok);
  await run("saveType", ctx, { name_fr: "Bonne adresse", name_en: "", sym: "" });
  assert.deepEqual((await data.world(ctx)).types.map((t) => t.id), ["place", "event", "bonne-adresse", "bonne-adresse-2"]);
  has((await run("saveType", ctx, { name_fr: "", name_en: "" })).errors.name_fr, /Écrivez au moins un nom\. Exemple/);
  const t = (await data.world(ctx)).types[2];
  assert.equal(t.names.en, "Good address"); assert.equal(t.sym, "⭐");
  await run("saveType", ctx, { id: t.rowId, name_fr: "Adresse", name_en: "Address", sym: "📌" });
  const edited = (await data.world(ctx)).types[2];
  assert.equal(edited.id, "bonne-adresse", "l'identifiant ne change jamais"); assert.equal(edited.names.fr, "Adresse");
  await run("typeUp", ctx, { id: edited.rowId });
  assert.deepEqual((await data.world(ctx)).types.map((x) => x.id).slice(0, 3), ["place", "bonne-adresse", "event"]);
  assert.ok((await run("typeUp", ctx, { id: (await data.world(ctx)).types[0].rowId })).error);
  await addPlace(ctx, { type: "event" });
  const ev = (await data.world(ctx)).types.find((x) => x.id === "event");
  has((await run("removeType", ctx, { id: ev.rowId })).error, /lieux utilisent le type « Événement »/);
  assert.ok((await run("removeType", ctx, { id: edited.rowId })).ok);
  await addPlace(ctx, { name: "Orphelin", type: "disparu" });
  assert.ok((await html(ctx)).includes("Orphelin"), "un lieu dont le type a disparu est quand même montré");
  for (let i = 0; i < 40; i++) await run("saveType", ctx, { name_fr: `Type ${i}`, name_en: "" });
  assert.equal((await data.world(ctx)).types.length, 30);
  has((await run("saveType", ctx, { name_fr: "Trop", name_en: "" })).error, /30 types/);
});

test("gabarits : un clic range les types ; les types de départ inutilisés sont remplacés, les vôtres jamais touchés ; idempotent", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await def.hooks.onInstanceCreate(ctx);
  assert.deepEqual((await data.world(ctx)).types.map((t) => t.id), ["place", "event"]);
  await run("saveType", ctx, { name_fr: "Mon type", name_en: "" });
  assert.ok((await run("applyTemplate", ctx, { template: "community" })).ok);
  const ids = (await data.world(ctx)).types.map((t) => t.id);
  assert.ok(["studio", "address", "event", "mon-type"].every((x) => ids.includes(x)) && !ids.includes("place"), ids.join(","));
  await run("applyTemplate", ctx, { template: "community" });
  assert.equal((await data.world(ctx)).types.length, ids.length, "rejouer ne duplique rien");
  await addPlace(ctx, { type: "event" });
  await run("applyTemplate", ctx, { template: "shop" });
  const after = (await data.world(ctx)).types.map((t) => t.id);
  assert.ok(after.includes("event"), "utilisé : gardé");
  assert.ok(!after.includes("studio") && !after.includes("address"), "inutilisés : retirés");
  assert.ok(["shop", "pickup", "fair", "mon-type"].every((x) => after.includes(x)));
  assert.ok((await run("applyTemplate", ctx, { template: "../x" })).ok);
  for (const [id, tpl] of Object.entries(templates.TEMPLATES)) {
    assert.ok(tpl.types.length >= 2 && tpl.types.length <= 5, id);
    for (const t of tpl.types) { assert.match(t.id, /^[a-z0-9-]+$/); assert.ok(t.fr && t.en && t.sym, `${id}/${t.id}`); }
  }
  assert.equal(templates.DEFAULT_TEMPLATE, "basic");
});

test("villes pour « Près de moi » : ajout par lien de carte ou par nombres, modification, suppression, affichées dans la page", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await addPlace(ctx, { name: "A" });
  assert.ok(!(await html(ctx)).includes("data-cm-city"));
  assert.ok((await run("saveCity", ctx, { name: "Villeneuve", mapLink: "https://www.openstreetmap.org/#map=12/12.5/34.5", lat: "", lng: "" })).ok);
  assert.ok((await run("saveCity", ctx, { name: "Ancienville", mapLink: "", lat: "-20,5", lng: "40.25" })).ok);
  const bad = await run("saveCity", ctx, { name: "", mapLink: "", lat: "", lng: "" });
  has(bad.errors.name, /Exemple : Villeneuve/); assert.ok(bad.errors.mapLink);
  has(await html(ctx), /<option value="0" data-lat="-20.5" data-lng="40.25">Ancienville<\/option><option value="1" data-lat="12.5" data-lng="34.5">Villeneuve<\/option>/);
  const c = (await data.world(ctx)).cities[0];
  await run("saveCity", ctx, { id: c.rowId, name: "Zoé-ville", mapLink: "", lat: String(c.lat), lng: String(c.lng) });
  assert.deepEqual((await data.world(ctx)).cities.map((x) => x.name), ["Villeneuve", "Zoé-ville"]);
  await run("removeCity", ctx, { id: (await data.world(ctx)).cities[0].rowId });
  assert.equal((await data.world(ctx)).cities.length, 1);
  assert.ok((await run("removeCity", ctx, { id: "nope" })).error);
  for (let i = 0; i < 110; i++) await run("saveCity", ctx, { name: `V${i}`, mapLink: "", lat: "10", lng: "20" });
  assert.equal((await data.world(ctx)).cities.length, 100);
});

const csv = (n, extra = () => "") => ["nom;type;latitude;longitude;adresse;description;horaires;site web", ...Array.from({ length: n }, (_, i) => `Lieu ${i + 1};${i % 2 ? "Événement" : "place"};${10 + (i % 50) / 10};${20 + (i % 70) / 10};${i} rue A;"Description ${i}, avec virgule";9 h;https://www.exemple.org/${i}${extra(i)}`)].join("\r\n");

test("import : colonnes en français, point-virgule, brouillons par défaut, compte rendu, doublons ignorés", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const r = await run("importCsv", ctx, { file: csv(5), draft: "on", from: "1" });
  assert.ok(r.ok && /5 lieux importés/.test(r.ok)); assert.equal(r.redirect, "?tab=tools");
  const placed = rows(ctx, "map_places");
  assert.equal(placed.length, 5);
  assert.ok(placed.every((p) => p.status === "draft" && p.by === "import"));
  assert.equal(placed[1].type, "event", "le type est reconnu par son nom");
  assert.equal(placed[0].desc, "Description 0, avec virgule");
  assert.equal(await def.adminBadge(ctx), 5);
  await run("importCsv", ctx, { file: csv(5), draft: "on", from: "1" });
  assert.equal(rows(ctx, "map_places").length, 5);
  const rep = await csvio.lastReport(ctx);
  assert.deepEqual({ added: rep.added, duplicates: rep.duplicates, failed: rep.failed }, { added: 0, duplicates: 5, failed: 0 });
  const pub = ctxFor(); await def.hooks.onInstanceCreate(pub);
  await run("importCsv", pub, { file: csv(2), from: "1" });
  assert.ok(rows(pub, "map_places").every((p) => p.status === "published"));
  const ed = ctxFor({}, { rights: ["edit"] }); await def.hooks.onInstanceCreate(ed);
  await run("importCsv", ed, { file: csv(2), from: "1" });
  assert.ok(rows(ed, "map_places").every((p) => p.status === "draft"));
});

test("import : 500 lignes à la fois, le compte rendu dit par où reprendre, la reprise finit le travail sans doublon", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const file = csv(1200);
  const r1 = await run("importCsv", ctx, { file, draft: "on", from: "1" });
  assert.equal(rows(ctx, "map_places").length, 500);
  assert.equal(r1.redirect, "?tab=tools&importFrom=501");
  const rep = await csvio.lastReport(ctx);
  assert.deepEqual({ added: rep.added, from: rep.from, to: rep.to, total: rep.total, remaining: rep.remaining }, { added: 500, from: 1, to: 500, total: 1200, remaining: 700 });
  const blocks = await def.adminPanel(ctx, { query: { importFrom: "501" } });
  assert.equal(blocks.find((b) => b.action === "importCsv").fields.find((f) => f.name === "from").value, "501");
  has(JSON.stringify(blocks), /Il reste 700 lignes/);
  assert.equal((await run("importCsv", ctx, { file, draft: "on", from: "501" })).redirect, "?tab=tools&importFrom=1001");
  assert.equal((await run("importCsv", ctx, { file, draft: "on", from: "1001" })).redirect, "?tab=tools");
  assert.equal(rows(ctx, "map_places").length, 1200);
  assert.equal(new Set(rows(ctx, "map_places").map((p) => p.code)).size, 1200);
  has((await run("importCsv", ctx, { file, from: "5000" })).errors.from, /1200 lignes de données/);
  await run("importCsv", ctx, { file, draft: "on", from: "400" });
  assert.equal(rows(ctx, "map_places").length, 1200);
});

test("import : lignes refusées expliquées avec leur numéro, type inconnu, lien de carte à la place des nombres, fichier mal formé, bornes", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  const file = ["name,type,map link,address", `Bon,place,"${SERIOUS}",1 rue`, "Sans position,place,,x", "Type inconnu,martien,\"12.5, 34.5\",x", ",place,\"12.5, 34.5\",x", "Raccourci,place,https://maps.app.goo.gl/AbC,x", "=CMD(),place,\"13.5, 34.5\",=1+1", "Bon aussi,,\"geo:14.5,34.5\","].join("\n");
  assert.ok((await run("importCsv", ctx, { file, draft: "on", from: "1" })).ok);
  const rep = await csvio.lastReport(ctx);
  assert.deepEqual({ added: rep.added, failed: rep.failed }, { added: 3, failed: 4 });
  has(rep.problems[0], /^Ligne 2 : /); has(rep.problems[1], /^Ligne 3 : .*Types possibles/); has(rep.problems[2], /^Ligne 4 : .*nom/); has(rep.problems[3], /^Ligne 5 : .*raccourci/);
  assert.deepEqual(rows(ctx, "map_places").map((p) => p.name).sort(), ["=CMD()", "Bon", "Bon aussi"].sort());
  assert.equal(rows(ctx, "map_places").find((p) => p.name === "Bon aussi").type, "place");
  has((await run("importCsv", ctx, { file: "", text: "" })).errors.file, /Choisissez un fichier/);
  has((await run("importCsv", ctx, { file: "nom,lat,lng" })).errors.file, /ne contient aucune ligne/);
  has((await run("importCsv", ctx, { file: "titre,x\nA,1" })).errors.file, /colonne « nom »|position/);
  has((await run("importCsv", ctx, { file: "nom,x\nA,1" })).errors.file, /Il manque la position/);
  has((await run("importCsv", ctx, { file: "x".repeat(2_100_000) })).errors.file, /trop gros/);
  assert.ok((await run("importCsv", ctx, { file: "", text: "nom,lat,lng\nCollé,10,20" })).ok);
  const full = ctxFor(); await def.hooks.onInstanceCreate(full);
  await full.api.store.addMany("map_places", Array.from({ length: 4990 }, (_, i) => ({ data: { code: `pf${String(i).padStart(7, "0")}`, name: `Plein ${i}`, type: "place", lat: 1 + (i % 80), lng: 2 + (i % 170) / 2, status: "draft", pos: i + 1 } })));
  data.invalidate(full);
  await run("importCsv", full, { file: csv(30), draft: "on" });
  assert.equal(rows(full, "map_places").length, 5000);
  const frep = await csvio.lastReport(full);
  assert.equal(frep.full, true); assert.equal(frep.added, 10);
});

test("export : tous les lieux de l'équipe, formules neutralisées, et le fichier exporté se réimporte à l'identique", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await addPlace(ctx, { name: "=BOOM()", type: "event", lat: -12.5, lng: 30.25, address: "1 rue, \"A\"", desc: "ligne 1\nligne 2", hours: "9 h", url: "https://www.exemple.org" });
  await addPlace(ctx, { name: "Normal", lat: 45.123456, lng: -1.5, status: "draft" });
  const exported = await csvio.exportText(ctx);
  assert.ok(exported.startsWith("﻿name,type,lat,lng,address,description,hours,url\r\n"));
  assert.ok(exported.includes(`"'=BOOM()"`)); assert.ok(exported.includes(",-12.5,30.25,"));
  const lines = [];
  for await (const l of def.adminDownloads.places.generate(ctx)) lines.push(l);
  assert.equal(lines.join(""), exported);
  const other = ctxFor(); await def.hooks.onInstanceCreate(other);
  assert.ok((await run("importCsv", other, { file: exported, draft: "on", from: "1" })).ok);
  assert.deepEqual(rows(other, "map_places").map((p) => p.name).sort(), ["=BOOM()", "Normal"].sort());
  const boom = rows(other, "map_places").find((p) => p.name === "=BOOM()");
  assert.deepEqual({ type: boom.type, lat: boom.lat, lng: boom.lng, address: boom.address, desc: boom.desc, hours: boom.hours, url: boom.url }, { type: "event", lat: -12.5, lng: 30.25, address: '1 rue, "A"', desc: "ligne 1\nligne 2", hours: "9 h", url: "https://www.exemple.org" });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["places.csv", "types.csv", "cities.csv"]);
  assert.equal(files[0].content, exported);
  has(files[1].content, /id,fr,en,symbol,rank/);
});

test("assistant IA : lit les lieux et les types ; propose un lieu en BROUILLON seulement ; erreurs lisibles ; doublon refusé ; 200 brouillons au plus", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await place(ctx, { name: "Existant" });
  await addPlace(ctx, { name: "Autre", status: "draft" });
  const list = await def.mcp.map_places_list(ctx, { limit: 1 });
  assert.equal(list.total, 2); assert.equal(list.items.length, 1); assert.equal(list.next, "1");
  assert.deepEqual(Object.keys(list.items[0]).sort(), ["addedBy", "address", "description", "hours", "id", "lat", "lng", "name", "status", "type", "url"]);
  assert.equal((await def.mcp.map_places_list(ctx, { limit: 1, cursor: "1" })).next, null);
  assert.equal((await def.mcp.map_places_list(ctx, { status: "published" })).items.length, 1);
  assert.equal((await def.mcp.map_places_list(ctx, { q: "autre" })).items[0].name, "Autre");
  assert.equal((await def.mcp.map_places_list(ctx, { cursor: "zz" })).items.length, 2);
  assert.deepEqual((await def.mcp.map_types_list(ctx)).types.map((t) => t.id), ["place", "event"]);
  const add = await def.mcp.map_place_add(ctx, { name: "Idée de l'assistant", type: "Event", lat: 11.5, lng: 22.5, description: "<script>x</script>" });
  assert.equal(add.created, true); assert.equal(add.status, "draft");
  const row = rows(ctx, "map_places").find((p) => p.name === "Idée de l'assistant");
  assert.equal(row.status, "draft"); assert.equal(row.by, "assistant"); assert.equal(row.type, "event");
  assert.ok(!(await html(ctx)).includes("Idée de l'assistant"));
  assert.equal((await page(ctx, ["p", row.code])).notFound, true);
  assert.equal(await def.adminBadge(ctx), 1);
  assert.equal((await def.mcp.map_place_add(ctx, { name: "Idée de l'assistant", lat: 11.5, lng: 22.5 })).created, false, "doublon");
  await assert.rejects(def.mcp.map_place_add(ctx, { name: "", lat: 1, lng: 2 }), (e) => e.expose === true && /name:/.test(e.message));
  await assert.rejects(def.mcp.map_place_add(ctx, { name: "Sans position" }), (e) => e.expose === true && /mapLink/.test(e.message));
  await assert.rejects(def.mcp.map_place_add(ctx, { name: "x", mapLink: "https://maps.app.goo.gl/x" }), (e) => e.expose === true && /raccourci/.test(e.message));
  await assert.rejects(def.mcp.map_place_add(ctx, { name: "x", lat: 1, lng: 2, type: "inconnu" }), (e) => e.expose === true && /type:/.test(e.message));
  assert.equal((await def.mcp.map_place_add(ctx, { name: "Par lien", mapLink: "https://www.openstreetmap.org/#map=17/12.5/34.5" })).created, true);
  assert.ok(!Object.keys(manifest.mcp.find((a) => a.name === "map_place_add").input.properties).some((k) => /publish|status|draft/.test(k)));
  for (let i = 0; i < 205; i++) { try { await def.mcp.map_place_add(ctx, { name: `A${i}`, lat: 10 + i / 100, lng: 20 }); } catch (e) { has(e.message, /Too many drafts/); break; } }
  assert.equal(rows(ctx, "map_places").filter((p) => p.by === "assistant").length, 200);
  await run("publishDrafts", ctx, {});
  assert.equal((await def.mcp.map_place_add(ctx, { name: "Encore", lat: 1.5, lng: 2.5 })).created, true);
});

test("assistant IA : le texte qu'il écrit est affiché échappé une fois publié, et aucun outil ne touche aux lieux d'autres modules", async () => {
  const ctx = ctxFor();
  await def.hooks.onInstanceCreate(ctx);
  await def.mcp.map_place_add(ctx, { name: "<b>Gras</b>", lat: 1.5, lng: 2.5, description: "<img src=x onerror=1>" });
  await run("publishDrafts", ctx, {});
  assert.ok(!/<b>Gras|<img/.test((await html(ctx)).replace(/data-cfg="[^"]*"/, "")));
  assert.ok(Object.keys(def.mcp).every((k) => !/hide|external|publish|delete|remove/.test(k)));
});

test("cycle de vie : l'instance neuve a un gabarit neutre, la suppression vide la mémoire ; rien ne tourne en arrière-plan", async () => {
  const ctx = ctxFor();
  assert.equal(def.tasks, undefined);
  await def.hooks.onInstanceCreate(ctx);
  assert.equal((await data.world(ctx)).types.length, 2);
  await addPlace(ctx, { name: "A" });
  await def.hooks.onInstanceDelete(ctx);
  ctx.api.store = (await import("./helpers/mapKit.mjs")).fullStore();
  assert.equal((await data.world(ctx)).places.length, 0, "une instance recréée sous la même clé n'hérite de rien");
  assert.ok(text.LIMITS.places === 5000 && text.LIMITS.importRows === 500 && text.LIMITS.markers === 200);
});

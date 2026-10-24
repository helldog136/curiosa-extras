// Événements : écritures (créer, modifier, dupliquer, répéter, types, gabarits), import et export de fichier tableur, bornes.
import test from "node:test";
import assert from "node:assert/strict";
import { M, D, O, CSV, TPL, ctxFor, addType, rows } from "./helpers/eventsKit.mjs";

const make = (ctx, v = {}) => O.createEvent(ctx, { title: "Atelier de dessin", date: "2031-03-15", time: "14:00", ...v });

test("créer : en cinq champs, publié ou en brouillon ; un titre + un jour donnent une adresse lisible et unique", async () => {
  const ctx = ctxFor();
  const a = await make(ctx, { place: "Salle des fêtes", text: "Venez nombreux.", status: "published" });
  assert.equal(a.ok, true);
  const b = await make(ctx, { status: "draft" });
  const [x, y] = rows(ctx, "ev_events");
  assert.equal(x.status, "published"); assert.ok(x.publishedAt);
  assert.equal(y.status, "draft"); assert.equal(y.publishedAt, null);
  assert.equal(x.slug, "atelier-de-dessin-2031-03-15");
  assert.equal(y.slug, "atelier-de-dessin-2031-03-15-2");
  assert.match(x.slug, /^[a-z0-9-]+$/);
  assert.equal(b.ok, true);
  assert.deepEqual([x.rev, x.by], [1, "admin"]);
});

test("créer en même temps : aucun doublon d'adresse (une écriture à la fois par agenda)", async () => {
  const ctx = ctxFor();
  const results = await Promise.all(Array.from({ length: 12 }, () => make(ctx)));
  assert.ok(results.every((r) => r.ok));
  assert.equal(new Set(rows(ctx, "ev_events").map((r) => r.slug)).size, 12);
});

test("modifier : seuls les champs envoyés changent ; la version augmente ; un événement inconnu est refusé", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx, { place: "Salle A", status: "published" });
  const r = await O.updateEvent(ctx, id, { place: "Salle B" }, { sections: ["essential"] });
  assert.equal(r.ok, true);
  const row = rows(ctx, "ev_events")[0];
  assert.equal(row.place, "Salle B"); assert.equal(row.title, "Atelier de dessin"); assert.equal(row.time, "14:00");
  assert.equal(row.rev, 2);
  assert.equal(row.slug, "atelier-de-dessin-2031-03-15", "l'adresse ne change jamais");
  assert.equal((await O.updateEvent(ctx, "inconnu", { place: "x" })).missing, true);
  const bad = await O.updateEvent(ctx, id, { date: "n'importe quoi" }, { sections: ["essential"] });
  assert.equal(bad.ok, false);
  assert.equal(rows(ctx, "ev_events")[0].date, "2031-03-15");
});

test("sections : programme, intervenants, média, après l'événement", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx);
  assert.equal((await O.updateEvent(ctx, id, { program: "14:00 Accueil\n15:00 Atelier", speakers: "Camille | Illustratrice" }, { sections: ["program"] })).ok, true);
  assert.equal((await O.updateEvent(ctx, id, { image: "/uploads/a.png", imageAlt: "Affiche", signupUrl: "https://example.org/inscription", seatsLeft: "8", seatsTotal: "20", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, { sections: ["media"] })).ok, true);
  assert.equal((await O.updateEvent(ctx, id, { albumId: "a1", albumLink: "https://example.org/photos", videoId: "v1" }, { sections: ["after"] })).ok, true);
  assert.equal((await O.updateEvent(ctx, id, { endDate: "2031-03-16", endTime: "10:00", lat: "50,8466", lng: "4.3528", tz: "europe/london" }, { sections: ["where"] })).ok, true);
  const r = rows(ctx, "ev_events")[0];
  assert.equal(r.program.length, 2); assert.equal(r.speakers[0].name, "Camille");
  assert.deepEqual([r.seatsLeft, r.seatsTotal, r.image, r.albumId, r.videoId, r.lat, r.lng, r.tz], [8, 20, "/uploads/a.png", "a1", "v1", 50.8466, 4.3528, "Europe/London"]);
});

test("publier, retirer, supprimer, dupliquer (copie en brouillon, sans série ni album)", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx, { status: "published", seatsTotal: "20", seatsLeft: "3" });
  await O.updateEvent(ctx, id, { albumId: "a1" }, { sections: ["after"] });
  await O.updateEvent(ctx, id, { state: "cancelled" }, { sections: ["essential"] });
  assert.equal((await O.setStatus(ctx, id, "draft")).ok, true);
  assert.equal(rows(ctx, "ev_events")[0].status, "draft");
  assert.equal((await O.setStatus(ctx, id, "published")).ok, true);
  assert.equal((await O.setStatus(ctx, id, "n'importe quoi")).ok, false);
  const copy = await O.duplicateEvent(ctx, id, "(copie)");
  assert.equal(copy.ok, true);
  const c = rows(ctx, "ev_events").find((r) => r.id === copy.id);
  assert.deepEqual([c.title, c.status, c.state, c.albumId, c.series, c.seatsLeft], ["Atelier de dessin (copie)", "draft", "ok", "", "", 20]);
  assert.equal((await O.removeEvent(ctx, id)).ok, true);
  assert.equal(rows(ctx, "ev_events").length, 1);
  assert.equal((await O.removeEvent(ctx, id)).ok, false);
});

test("répéter : la suite est écrite d'un coup, avec la même heure sur place été comme hiver", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx, { date: "2031-03-22", time: "21:00", status: "published", endDate: "2031-03-22", endTime: "23:00" });
  const r = await O.repeatEvent(ctx, id, { every: "week", count: 4 });
  assert.deepEqual([r.ok, r.count], [true, 4]);
  const list = rows(ctx, "ev_events").sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(list.map((e) => e.date), ["2031-03-22", "2031-03-29", "2031-04-05", "2031-04-12"]);
  assert.equal(new Set(list.map((e) => e.series)).size, 1);
  assert.ok(list.every((e) => e.series && e.time === "21:00" && e.status === "published"));
  const data = await D.load(ctx, { fresh: true });
  const utc = (date) => new Date(data.events.find((e) => e.date === date).startMs).toISOString().slice(11, 16);
  assert.equal(utc("2031-03-22"), "20:00"); assert.equal(utc("2031-04-05"), "19:00");
  assert.equal((await O.repeatEvent(ctx, id, { every: "week", count: 3 })).error, "already");
  assert.equal((await O.repeatEvent(ctx, "inconnu", { every: "week", count: 3 })).error, "missing");
});

test("répéter : bornes (100 au plus, 3 ans au plus, 2000 événements en tout)", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx);
  assert.equal((await O.repeatEvent(ctx, id, { every: "week", count: 101 })).error, "count");
  assert.equal((await O.repeatEvent(ctx, id, { every: "week" })).error, "need");
  assert.equal((await O.repeatEvent(ctx, id, { every: "week", until: "2031-03-15" })).error, "none");
  const r = await O.repeatEvent(ctx, id, { every: "week", count: 100 });
  assert.equal(r.count, 100);
  assert.equal(rows(ctx, "ev_events").length, 100);
  const full = ctxFor();
  for (let i = 0; i < 1999; i++) await full.api.store.add("ev_events", M.toDoc(M.blank({ title: `E${i}`, slug: `e${i}`, date: "2031-01-01", status: "published" })));
  const one = await make(full);
  assert.equal(one.ok, true, "le 2000e passe");
  assert.equal((await make(full)).full, true, "le 2001e est refusé");
  assert.equal((await O.repeatEvent(full, one.id, { every: "week", count: 3 })).error, "full");
});

test("appliquer à la série : titre, lieu, texte… changent chez les suivants, jamais les dates ni les places restantes", async () => {
  const ctx = ctxFor();
  const { id } = await make(ctx, { date: "2031-05-01", place: "Salle A", seatsLeft: "5" });
  await O.repeatEvent(ctx, id, { every: "week", count: 3 });
  const data = await D.load(ctx, { fresh: true });
  const second = data.events.find((e) => e.date === "2031-05-08");
  await O.updateEvent(ctx, second.id, { seatsLeft: "1" }, { sections: ["media"] });
  const r = await O.updateEvent(ctx, id, { place: "Salle B", title: "Nouveau titre" }, { sections: ["essential"], toSeries: true });
  assert.equal(r.series, 2);
  const after = rows(ctx, "ev_events").sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(after.map((e) => [e.title, e.place, e.date]), [["Nouveau titre", "Salle B", "2031-05-01"], ["Nouveau titre", "Salle B", "2031-05-08"], ["Nouveau titre", "Salle B", "2031-05-15"]]);
  assert.equal(after[1].seatsLeft, 1);
  const noSeries = await O.updateEvent(ctx, second.id, { place: "Salle C" }, { sections: ["essential"] });
  assert.equal(noSeries.series, 0);
  assert.equal(rows(ctx, "ev_events").find((e) => e.date === "2031-05-15").place, "Salle B");
});

test("types : nom par langue, couleur du thème ou de la palette, icône ; nom en double refusé ; 30 au plus", async () => {
  const ctx = ctxFor();
  const a = await O.saveType(ctx, null, { names: { fr: "Atelier", en: "Workshop" }, color: "teal", icon: "🛠️" });
  assert.equal(a.ok, true);
  const [t] = rows(ctx, "ev_types");
  assert.deepEqual([t.key, t.names.en, t.color, t.icon], ["workshop", "Workshop", "teal", "🛠️"]);
  assert.equal((await O.saveType(ctx, null, { names: { fr: "atelier" }, color: "teal" })).errors.name.code, "typeDuplicate");
  assert.equal((await O.saveType(ctx, null, { names: {}, color: "teal" })).errors.name.code, "typeNameRequired");
  assert.equal((await O.saveType(ctx, null, { names: { fr: "X" }, color: "<script>" })).errors.color.code, "colorBad");
  assert.equal((await O.saveType(ctx, a.id, { names: { fr: "Atelier créatif", en: "Creative workshop" }, color: "accent", icon: "<b>" })).ok, true);
  const t2 = rows(ctx, "ev_types")[0];
  assert.equal(t2.key, "workshop", "l'identifiant ne change jamais quand on renomme");
  assert.equal(t2.icon, "b");
  for (let i = 0; i < 29; i++) await O.saveType(ctx, null, { names: { fr: `Type ${i}` }, color: "slate" });
  assert.equal((await O.saveType(ctx, null, { names: { fr: "Un de trop" }, color: "slate" })).full, true);
});

test("types : monter, descendre, supprimer ; un événement dont le type a disparu n'a plus de type", async () => {
  const ctx = ctxFor();
  const a = await O.saveType(ctx, null, { names: { fr: "A" }, color: "teal" });
  const b = await O.saveType(ctx, null, { names: { fr: "B" }, color: "rose" });
  assert.equal((await O.moveType(ctx, b.id, -1)).ok, true);
  assert.deepEqual((await D.load(ctx, { fresh: true })).types.map((t) => t.names.fr), ["B", "A"]);
  assert.equal((await O.moveType(ctx, b.id, -1)).ok, false);
  await make(ctx, { type: "A" });
  assert.equal(rows(ctx, "ev_events")[0].type, "a");
  await O.removeType(ctx, a.id);
  const data = await D.load(ctx, { fresh: true });
  assert.equal(data.typeByKey.has("a"), false);
  assert.equal(data.events.length, 1);
});

test("gabarits : « Association / collectif », « Créateur seul » et « Vide » ; aucun n'est obligatoire ; deux fois = rien de plus", async () => {
  const ctx = ctxFor();
  const loc = ["fr", "en"];
  const r = await O.applyStarter(ctx, "association", loc);
  assert.deepEqual([r.ok, r.added], [true, 5]);
  const types = rows(ctx, "ev_types");
  assert.deepEqual(types.map((t) => t.names.fr), ["Événement", "Atelier", "Formation", "Masterclass", "Rencontre"]);
  assert.deepEqual(types.map((t) => t.pos), [1, 2, 3, 4, 5]);
  assert.ok(types.every((t) => t.names.en && TPL.COLOR_KEYS.includes(t.color)));
  assert.equal((await O.applyStarter(ctx, "association", loc)).added, 0);
  assert.equal((await O.applyStarter(ctx, "solo", loc)).added, 2);
  const ctx2 = ctxFor();
  assert.equal((await O.applyStarter(ctx2, "empty", loc)).added, 0);
  assert.equal(rows(ctx2, "ev_types").length, 0);
  assert.equal((await D.readMeta(ctx2)).starter, "empty");
  assert.equal((await O.applyStarter(ctx2, "inconnu", loc)).ok, false);
});

const FILE = `titre;date;heure;lieu;type;texte;publication
Atelier A;15/03/2031;14h;Salle A;Atelier;"Une ligne
et une deuxième";publié
Conférence B;2031-04-02;;Salle B;Conférence;Texte;brouillon
Sans date;;;;;;
Trop tard;32/13/2031;10h;;;;
`;

test("import : « vérifier d'abord » ne touche à rien et dit quelle ligne et quelle colonne corriger", async () => {
  const ctx = ctxFor();
  const rep = await CSV.importCsv(ctx, FILE, { dry: true });
  assert.deepEqual([rep.total, rep.valid, rep.created], [4, 2, 0]);
  assert.deepEqual(rep.errors.map((e) => [e.line, e.field, e.column, e.code]), [[4, "date", "date", "dateRequired"], [5, "date", "date", "dateBad"]]);
  assert.deepEqual(rep.newTypes.sort(), ["Atelier", "Conférence"]);
  assert.equal(ctx.dumpStore().length, 0);
});

test("import : les bonnes lignes passent, les types inconnus sont créés, un deuxième import ne crée aucun doublon", async () => {
  const ctx = ctxFor();
  const rep = await CSV.importCsv(ctx, FILE, { dry: false });
  assert.deepEqual([rep.created, rep.errors.length], [2, 2]);
  const ev = rows(ctx, "ev_events").sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(ev.map((e) => [e.title, e.date, e.time, e.status, e.type, e.by]), [["Atelier A", "2031-03-15", "14:00", "published", "atelier", "import"], ["Conférence B", "2031-04-02", "", "draft", "conference", "import"]]);
  assert.equal(ev[0].text, "Une ligne\net une deuxième");
  assert.deepEqual(rows(ctx, "ev_types").map((t) => t.names.fr), ["Atelier", "Conférence"]);
  const again = await CSV.importCsv(ctx, FILE, { dry: false });
  assert.deepEqual([again.created, again.duplicates], [0, 2]);
  assert.equal(rows(ctx, "ev_events").length, 2);
  const pub = await CSV.importCsv(ctxFor(), "title,date\nSans colonne publication,2031-01-02\n", { dry: false, publish: true });
  assert.equal(pub.created, 1);
});

test("import : séparateur « , » « ; » ou tabulation, accents, guillemets, colonnes inconnues signalées, fichier sans colonnes utiles", async () => {
  assert.deepEqual(CSV.parseCsv("a,b\n1,2").rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(CSV.parseCsv("a\tb\n\"x\"\"y\"\t2").rows, [["a", "b"], ['x"y', "2"]]);
  assert.equal(CSV.parseCsv("﻿a;b\n1;2").rows[0][0], "a");
  const ctx = ctxFor();
  const rep = await CSV.importCsv(ctx, "Titre,Date,Couleur préférée\nÉté en fête,2031-06-21,bleu\n", { dry: true });
  assert.deepEqual([rep.valid, rep.unknownColumns], [1, ["Couleur préférée"]]);
  assert.equal((await CSV.importCsv(ctx, "foo,bar\n1,2\n", { dry: true })).noTitleColumn, true);
  assert.equal((await CSV.importCsv(ctx, "", { dry: true })).empty, true);
});

test("import : 2000 lignes au plus lues, et jamais plus de 2000 événements au total", async () => {
  const ctx = ctxFor();
  const big = `title,date\n${Array.from({ length: 2100 }, (_, i) => `Rendez-vous ${i},2031-02-${String(1 + (i % 27)).padStart(2, "0")}`).join("\n")}\n`;
  const rep = await CSV.importCsv(ctx, big, { dry: false });
  assert.equal(rep.truncated, true);
  assert.equal(rep.created, 2000);
  assert.equal(rows(ctx, "ev_events").length, 2000);
  const more = await CSV.importCsv(ctx, "title,date\nUn de trop,2031-03-01\n", { dry: false });
  assert.equal(more.full, true); assert.equal(more.created, 0);
});

test("export : relisible par l'import, cellules neutralisées contre les formules de tableur", async () => {
  const ctx = ctxFor();
  await addType(ctx);
  await make(ctx, { title: "=1+1", place: "@Salle", type: "atelier", program: "14:00 Accueil", speakers: "Camille | Illustratrice", text: "ligne 1\nligne 2" });
  let out = "";
  for await (const line of CSV.exportLines(ctx)) out += line;
  assert.ok(out.startsWith("﻿"));
  assert.match(out, /"'=1\+1"/);
  assert.match(out, /"'@Salle"/);
  assert.equal(out.split("\r\n")[0].split(",").length, CSV.COLUMNS.length);
  const ctx2 = ctxFor();
  await addType(ctx2);
  const rep = await CSV.importCsv(ctx2, out, { dry: false });
  assert.equal(rep.created, 1);
  const e = rows(ctx2, "ev_events")[0];
  assert.deepEqual([e.program.length, e.speakers.length, e.text, e.type], [1, 1, "ligne 1\nligne 2", "atelier"]);
});

test("détails : l'horaire inexistant ou en double est signalé", async () => {
  const ctx = ctxFor();
  assert.deepEqual((await make(ctx, { date: "2031-03-30", time: "02:30" })).notes, ["gap"]);
  assert.deepEqual((await make(ctx, { date: "2031-10-26", time: "02:30" })).notes, ["fold"]);
});

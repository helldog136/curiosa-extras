// Événements : manifeste, temps (changements d'heure, répétitions), modèle (programme, intervenants, relecture tolérante) et neutralité.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { validateArgs } from "@/core/services/mcp/validate";
import { DIR, manifest, def, index, T, X, M, O, TPL, ctxFor, messages } from "./helpers/eventsKit.mjs";

test("manifeste : valide, et le code fait ce que module.json annonce", () => {
  const r = parseManifest(manifest);
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.equal(r.manifest.id, "events");
  assert.equal(manifest.version, "1.0.2");
  assert.equal(manifest.minCore, "0.2.6");
  assert.equal(index.VERSION, manifest.version, "VERSION doit suivre la version du manifeste");
  assert.equal(manifest.instances, "multiple", "deux agendas possibles : un public, un de formations");
  assert.deepEqual(manifest.sections.map((s) => s.id), Object.keys(def.sections));
  assert.deepEqual(manifest.mcp.map((a) => a.name).sort(), Object.keys(def.mcp).sort());
  assert.deepEqual(Object.keys(def.routes).sort(), ["feed.ics", "find", "ics"]);
  assert.deepEqual(Object.keys(def.services["event.source"]), ["upcoming"]);
  assert.deepEqual(manifest.tabs.map((t) => t.id), ["use", "more"], "un seul onglet ajouté");
});

test("manifeste : permissions = capacités utilisées ; rien de superflu", () => {
  const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  const used = { slots: !!def.slots, routes: !!def.routes, storage: src.includes("ctx.api.store"), sections: !!def.sections, pages: !!def.page, mcp: !!def.mcp, admin: !!def.adminPanel, topics: !!def.exports, mail: src.includes("ctx.api.mail"), rawg: src.includes("ctx.api.rawg") };
  assert.deepEqual([...manifest.permissions].sort(), Object.keys(used).filter((k) => used[k]).sort());
  assert.ok(!src.includes("fetch("), "aucun appel réseau direct");
  assert.ok(!src.includes("x-forwarded-for"), "l'adresse du visiteur n'est pas lue dans les en-têtes : ctx.api.visitor.fingerprint");
  assert.ok(!src.includes("setInterval"), "aucun minuteur de fond");
});

test("offres et besoins : event.source offert (une réponse par instance, lecture seule), albums et vidéos facultatifs, lieux publiés", () => {
  const offer = manifest.offers.find((o) => o.service === "event.source");
  assert.deepEqual([offer.version, offer.each, offer.readOnly], [1, true, ["upcoming"]], "même déclaration que les autres fournisseurs");
  assert.ok(offer.label.fr && offer.label.en);
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.optional]), [["gallery.albums", true], ["videos.library", true]], "tout lien est facultatif");
  assert.deepEqual(manifest.provides.map((p) => p.topic), ["map.place"]);
  assert.equal(manifest.consumes, undefined);
});

test("droit events.edit : chaque action d'écriture l'exige, et il est déclaré", () => {
  assert.deepEqual(manifest.rights.map((r) => r.id), ["events.edit"]);
  assert.equal(manifest.rights[0].default.editor, false);
  for (const [name, a] of Object.entries(def.adminActions)) assert.equal(a.right, "events.edit", `${name} : droit « events.edit »`);
  assert.equal(def.adminDownloads.events.right, "events.edit");
  assert.ok(Object.keys(def.adminActions).length >= 12);
});

test("assistant : noms courts, lectures accordées d'office, écritures JAMAIS d'office, rien de destructif, arguments valides", () => {
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(byName).sort(), ["agenda_create_event", "agenda_get_event", "agenda_list_events", "agenda_list_types", "agenda_update_event"]);
  for (const name of Object.keys(byName)) assert.ok(`some-instance-key__${name}`.length <= 64 && name.length <= 40, name);
  for (const n of ["agenda_list_events", "agenda_get_event", "agenda_list_types"]) assert.equal(byName[n].readOnly, true, n);
  for (const n of ["agenda_create_event", "agenda_update_event"]) { assert.equal(byName[n].readOnly, undefined); assert.notEqual(byName[n].default, true, `${n} : écriture éteinte d'office`); assert.equal(byName[n].destructive, undefined); }
  assert.ok(!Object.keys(byName).some((n) => /publish|delete|remove/.test(n)), "l'assistant ne publie ni ne supprime");
  const ok = validateArgs(byName.agenda_create_event.input, { title: "Atelier", date: "2031-03-15", program: ["14:00 Accueil"], seats_left: 12, repeat_every: "week", repeat_count: 4 });
  assert.ok(ok.ok !== false, JSON.stringify(ok));
  assert.throws(() => validateArgs(byName.agenda_create_event.input, { title: "x", date: "2031-03-15", nope: 1 }), /unexpected argument/, "un argument inconnu est refusé");
});

test("textes : FR et EN identiques en clés, aucune clé vide, et chaque clé utilisée existe", () => {
  const fr = messages("fr"), en = messages("en");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort(), "parité exacte");
  for (const [k, v] of Object.entries({ ...fr, ...en })) assert.ok(String(v).trim(), k);
  for (const k of Object.keys(fr)) assert.deepEqual((fr[k].match(/\{[a-z]+\}/gi) ?? []).sort(), (en[k].match(/\{[a-z]+\}/gi) ?? []).sort(), `${k} : mêmes variables`);
  const src = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs")).map((f) => fs.readFileSync(`${DIR}/${f}`, "utf8")).join("\n");
  const used = new Set();
  for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*[a-z.A-Z()]+\s*\?\s*"([A-Za-z0-9_]+)"\s*:\s*(?:[a-z.A-Z()=" ]+\?\s*"([A-Za-z0-9_]+)"\s*:\s*)?"([A-Za-z0-9_]+)"/g)) [m[1], m[2], m[3]].filter(Boolean).forEach((k) => used.add(k));
  for (const k of used) assert.ok(k in fr, `clé « ${k} » absente des textes`);
  for (const prefix of ["err_", "color_", "state_", "stateOpt_", "show_", "every_", "starter_", "note_"]) assert.ok(Object.keys(fr).some((k) => k.startsWith(prefix)), prefix);
});

test("neutralité : le code ne connaît ni « formation », ni « masterclass », ni « association », ni région (seuls les gabarits et les textes en parlent)", () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && f !== "templates.mjs").concat(["scripts/events.js"]);
  for (const f of files) {
    const src = fs.readFileSync(`${DIR}/${f}`, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/formation|masterclass|association|asbl|belgi|bruxelles|brussels|atelier|workshop/i.test(src), `${f} : mot propre à un public`);
  }
  for (const m of [messages("fr"), messages("en")]) for (const [k, v] of Object.entries(m).filter(([k]) => !k.startsWith("starter_"))) assert.ok(!/formation|masterclass|asbl|belgi|bruxelles|brussels/i.test(v), `${k} : ${v}`);
  assert.deepEqual(TPL.STARTER_KEYS, ["association", "solo", "empty"]);
  assert.deepEqual(TPL.STARTERS.association.types.map((t) => t.names.fr), ["Événement", "Atelier", "Formation", "Masterclass", "Rencontre"]);
  assert.deepEqual(TPL.STARTERS.solo.types.map((t) => t.names.fr), ["Live spécial", "Sortie", "Rencontre"]);
  assert.deepEqual(TPL.STARTERS.empty.types, []);
  for (const t of Object.values(TPL.STARTERS).flatMap((s) => s.types)) assert.ok(TPL.COLOR_KEYS.includes(t.color) && t.names.fr && t.names.en);
  assert.ok(!fs.readFileSync(`${DIR}/module.json`, "utf8").match(/belgi|bruxelles|brussels|asbl/i));
});

test("aucun fichier ne charge un voisin sans la version du fichier principal (mise à jour à chaud)", () => {
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith(".mjs"))) {
    const code = fs.readFileSync(`${DIR}/${f}`, "utf8");
    assert.ok(!/^\s*(import|export)\b[^\n]*\bfrom\s+["']\.\.?\//m.test(code), `${f} : import statique d'un fichier voisin (sans ?v=)`);
    for (const m of code.matchAll(/import\(\s*[`"']\.\/([a-z]+\.mjs)([^)]*)\)/g)) assert.ok(m[2].includes("${q}"), `${f} : import de ${m[1]} sans la version`);
  }
});

test("temps : changement d'heure de printemps (heure inexistante) et d'automne (heure en double)", () => {
  const gap = T.zonedToUtc(2031, 3, 30, 2, 30, "Europe/Paris");
  assert.equal(gap.kind, "gap");
  assert.equal(new Date(gap.ms).toISOString(), "2031-03-30T01:30:00.000Z", "l'heure d'après : 3 h 30 d'été");
  const fold = T.zonedToUtc(2031, 10, 26, 2, 30, "Europe/Paris");
  assert.equal(fold.kind, "fold");
  assert.equal(new Date(fold.ms).toISOString(), "2031-10-26T00:30:00.000Z", "la première fois : heure d'été");
  assert.equal(T.zonedToUtc(2031, 7, 1, 21, 0, "Europe/Paris").kind, "ok");
  assert.equal(new Date(T.zonedToUtc(2031, 1, 15, 21, 0, "Europe/Paris").ms).toISOString(), "2031-01-15T20:00:00.000Z");
  assert.equal(new Date(T.zonedToUtc(2031, 7, 15, 21, 0, "America/New_York").ms).toISOString(), "2031-07-16T01:00:00.000Z");
  assert.equal(new Date(T.zonedToUtc(2031, 7, 15, 21, 0, "Asia/Kolkata").ms).toISOString(), "2031-07-15T15:30:00.000Z");
});

test("temps : lecture tolérante des dates et des heures tapées à la main", () => {
  assert.equal(T.readDate("2031-03-15"), "2031-03-15");
  assert.equal(T.readDate("15/03/2031"), "2031-03-15");
  assert.equal(T.readDate("5.3.2031"), "2031-03-05");
  for (const bad of ["", "30/02/2031", "2031-13-01", "demain", "1999-01-01", "2031-3"]) assert.equal(T.readDate(bad), null, bad);
  assert.equal(T.readTime("21h"), "21:00");
  assert.equal(T.readTime("21h30"), "21:30");
  assert.equal(T.readTime("9:05 pm"), "21:05");
  assert.equal(T.readTime("12am"), "00:00");
  for (const bad of ["", "25:00", "12:60", "tard", "0 pm"]) assert.equal(T.readTime(bad), null, bad);
  assert.equal(T.addMonths("2031-01-31", 1), "2031-02-28");
  assert.equal(T.addMonths("2032-01-31", 1), "2032-02-29");
  assert.equal(T.addMonths("2031-11-15", 3), "2032-02-15");
  assert.equal(T.isoWithOffset(Date.UTC(2031, 6, 1, 19), "Europe/Paris"), "2031-07-01T21:00:00+02:00");
  assert.equal(T.isoWithOffset(Date.UTC(2031, 0, 1, 19), "Asia/Kolkata"), "2031-01-02T00:30:00+05:30");
});

test("temps : l'heure en toutes lettres, en français et en anglais", () => {
  assert.equal(T.clockText(21, 0, "fr"), "21 h");
  assert.equal(T.clockText(21, 30, "fr"), "21 h 30");
  assert.equal(T.clockText(0, 0, "fr"), "minuit");
  assert.equal(T.clockText(12, 0, "fr"), "midi");
  assert.equal(T.clockText(21, 0, "en"), "9 pm");
  assert.equal(T.clockText(9, 5, "en"), "9:05 am");
  assert.equal(T.clockText(12, 0, "en"), "noon");
  assert.equal(T.clockText(21, 5, "de"), "21:05");
});

test("temps : les semaines d'un mois (lundi ou dimanche en premier)", () => {
  const weeks = T.monthWeeks(2031, 3, 1);
  assert.equal(weeks[0][0].date, "2031-02-24");
  assert.equal(weeks[0][5].date, "2031-03-01");
  assert.equal(weeks[0][5].inMonth, true);
  assert.equal(weeks[0][4].inMonth, false);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(T.monthWeeks(2031, 3, 0)[0][0].date, "2031-02-23");
  assert.equal(T.shiftMonth("2031-01", -1), "2030-12");
  assert.equal(T.shiftMonth("2031-12", 1), "2032-01");
  assert.equal(T.parseMonth("2031-13"), null);
});

test("programme : une ligne par créneau, heures souples, erreurs avec le numéro de ligne", () => {
  const ok = M.parseProgram("14h-15h30 Accueil | café offert\n\n16:00 Atelier de dessin\n17:00–18:00 Goûter");
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.items.map((s) => [s.time, s.end, s.title, s.text]), [["14:00", "15:30", "Accueil", "café offert"], ["16:00", "", "Atelier de dessin", ""], ["17:00", "18:00", "Goûter", ""]]);
  assert.equal(M.programText(ok.items).split("\n")[0], "14:00-15:30 Accueil | café offert");
  assert.deepEqual(M.parseProgram("Accueil sans heure").errors, [{ line: 1, code: "badSlot" }]);
  assert.deepEqual(M.parseProgram("16:00-15:00 À l'envers").errors, [{ line: 1, code: "slotEnd" }]);
  assert.equal(M.parseProgram(Array.from({ length: 50 }, (_, i) => `1${i % 10}:00 Créneau ${i}`).join("\n")).errors[0].code, "tooMany");
});

test("intervenants : nom, rôle et lien facultatif (https ou page du site, jamais javascript:)", () => {
  const r = M.parseSpeakers("Camille Dupont | Illustratrice | /equipe/camille\nLéo Martin | Auteur | https://example.org/leo\nSans rôle");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.items.map((s) => [s.name, s.role, s.link]), [["Camille Dupont", "Illustratrice", "/equipe/camille"], ["Léo Martin", "Auteur", "https://example.org/leo"], ["Sans rôle", "", ""]]);
  assert.equal(M.parseSpeakers("Mal | Rôle | javascript:alert(1)").errors[0].code, "badSpeakerLink");
  assert.equal(M.parseSpeakers("Mal | Rôle | mailto:a@example.org").errors[0].code, "badSpeakerLink");
  assert.equal(M.parseSpeakers(" | rôle seul").errors[0].code, "badSpeaker");
});

test("répétition : chaque semaine, toutes les deux semaines, chaque mois ; 100 au plus ; 3 ans au plus", () => {
  assert.deepEqual(M.repeatDates("2031-03-01", { every: "week", count: 3 }).dates, ["2031-03-01", "2031-03-08", "2031-03-15"]);
  assert.deepEqual(M.repeatDates("2031-03-01", { every: "fortnight", count: 3 }).dates, ["2031-03-01", "2031-03-15", "2031-03-29"]);
  assert.deepEqual(M.repeatDates("2031-01-31", { every: "month", count: 4 }).dates, ["2031-01-31", "2031-02-28", "2031-03-31", "2031-04-30"]);
  assert.deepEqual(M.repeatDates("2031-03-01", { every: "week", until: "2031-03-20" }).dates, ["2031-03-01", "2031-03-08", "2031-03-15"]);
  assert.equal(M.repeatDates("2031-03-01", { every: "week", count: 100 }).dates.length, 100);
  assert.equal(M.repeatDates("2031-03-01", { every: "week", count: 101 }).why, "count");
  assert.equal(M.repeatDates("2031-03-01", { every: "week" }).why, "need");
  assert.equal(M.repeatDates("2031-03-01", { every: "week", until: "2031-02-01" }).why, "until");
  assert.equal(M.repeatDates("2031-03-01", { every: "yearly", count: 3 }).why, "rule");
  const long = M.repeatDates("2031-03-01", { every: "week", until: "2040-01-01" });
  assert.equal(long.dates.length, 100);
  assert.equal(long.cut, true);
  const month = M.repeatDates("2031-03-01", { every: "month", count: 100 });
  assert.ok(month.dates.length <= 37 && month.cut, "jamais plus de 3 ans");
});

test("relecture tolérante : une ligne abîmée ne fait jamais planter, et ne sort jamais telle quelle", () => {
  const junk = M.read({ id: "x1", createdAt: "pas une date", data: { title: "<script>alert(1)</script>", date: "30/02/2031", time: "25:61", tz: "Mars/Phobos", status: 7, state: "?", type: "A B<", lat: "x", image: "javascript:alert(1)", signupUrl: "javascript:alert(1)", videoUrl: "data:text/html,x", seatsLeft: -4, program: "oops", speakers: [null, 5, { name: "" }], albumId: "a b", series: "../" } }, "Europe/Paris");
  assert.equal(junk.broken, true);
  assert.equal(junk.status, "draft");
  assert.equal(junk.state, "ok");
  assert.equal(junk.image, ""); assert.equal(junk.signupUrl, ""); assert.equal(junk.videoUrl, "");
  assert.equal(junk.seatsLeft, null); assert.deepEqual(junk.program, []); assert.deepEqual(junk.speakers, []);
  assert.equal(junk.zone, "Europe/Paris");
  assert.equal(junk.type, "ab");
  assert.equal(junk.albumId, "");
  assert.equal(M.read(null, "Nope/Nope").zone, "UTC");
  assert.equal(M.read({ id: "y", data: { title: "Ok", date: "2031-03-15" } }, "Europe/Paris").broken, false);
});

test("durées : une journée entière, plusieurs jours, une fin explicite, deux heures par défaut", () => {
  const day = M.times({ date: "2031-03-15", time: "", endDate: "", endTime: "" }, "Europe/Paris");
  assert.equal(day.allDay, true); assert.equal(day.lastDay, "2031-03-15");
  assert.equal(day.endMs - day.startMs, 24 * 3_600_000);
  const multi = M.times({ date: "2031-03-15", time: "", endDate: "2031-03-17", endTime: "" }, "Europe/Paris");
  assert.equal(multi.lastDay, "2031-03-17");
  const timed = M.times({ date: "2031-03-15", time: "14:00", endDate: "", endTime: "" }, "Europe/Paris");
  assert.equal(timed.endMs - timed.startMs, 2 * 3_600_000);
  const night = M.times({ date: "2031-03-15", time: "22:00", endDate: "2031-03-16", endTime: "02:00" }, "Europe/Paris");
  assert.equal(night.endMs - night.startMs, 4 * 3_600_000);
  assert.equal(night.lastDay, "2031-03-16");
});

test("vérifications : chaque erreur est un code attaché à son champ ; rien n'est écrit quand il y en a une", async () => {
  const ctx = ctxFor();
  const bad = async (values) => (await O.createEvent(ctx, values)).errors;
  assert.equal((await bad({ title: "", date: "2031-03-15" })).title.code, "titleRequired");
  assert.equal((await bad({ title: "A", date: "" })).date.code, "dateRequired");
  assert.equal((await bad({ title: "A", date: "bientôt" })).date.code, "dateBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", time: "tard" })).time.code, "timeBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", time: "14:00", endTime: "13:00" })).endTime.code, "endBefore");
  assert.equal((await bad({ title: "A", date: "2031-03-15", endDate: "2031-03-14" })).endDate.code, "endBefore");
  assert.equal((await bad({ title: "A", date: "2031-03-15", tz: "Mars/Phobos" })).tz.code, "zoneBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", lat: "91", lng: "4" })).lat.code, "latBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", lat: "50" })).lng.code, "coordPair");
  assert.equal((await bad({ title: "A", date: "2031-03-15", signupUrl: "javascript:alert(1)" })).signupUrl.code, "urlBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", image: "data:image/png;base64,AAAA" })).image.code, "imageBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", videoUrl: "https://example.org/page.html" })).videoUrl.code, "videoBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", seatsLeft: "beaucoup" })).seatsLeft.code, "countBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", seatsLeft: "30", seatsTotal: "20" })).seatsLeft.code, "seatsOver");
  assert.equal((await bad({ title: "A", date: "2031-03-15", type: "inconnu" })).type.code, "typeBad");
  assert.equal((await bad({ title: "A", date: "2031-03-15", program: "sans heure" })).program.code, "programLine");
  assert.equal(ctx.dumpStore().length, 0, "aucune écriture");
  for (const lang of ["fr", "en"]) {
    const m = messages(lang);
    for (const code of ["titleRequired", "typeBad", "dateRequired", "dateBad", "timeBad", "endBefore", "zoneBad", "latBad", "lngBad", "coordPair", "imageBad", "urlBad", "countBad", "seatsOver", "videoBad", "pickBad", "programLine", "slotEnd", "speakerLine", "speakerLink", "typeNameRequired", "typeDuplicate", "countRule", "repeatNeed", "fileEmpty"]) assert.ok(m[`err_${code}`], `${lang} ${code}`);
  }
  assert.match(messages("fr").err_dateBad, /2026-11-14|14\/11\/2026/);
  assert.match(messages("en").err_urlBad, /https:\/\//);
  assert.equal(X.LIMITS.events, 2000);
});

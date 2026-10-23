// Compte à rebours — le fichier « Ajouter à mon agenda » : validé par un lecteur STRICT écrit à part (tests/helpers/countdownIcs.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseIcs, validateIcs, unescapeText } from "./helpers/countdownIcs.mjs";

const M = await import("../modules/countdown/model.mjs");
const I = await import("../modules/countdown/ics.mjs");
const mod = (await import("../modules/countdown/index.mjs")).default;

const doc = (o = {}) => ({ uid: "0f8fad5b-d9cb-469f-a165-70867728950e", slug: "sortie", rev: 1, title: "Sortie du jeu", allDay: false, date: "2026-11-14", time: "21:00", tz: "Europe/Paris", endDate: "", endTime: "", description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-02T09:30:15.000Z", ...o });
const view = (o) => M.view(M.read({ id: "r1", data: doc(o) }), "1d", 0);
const ics = (o, url = "https://example.test/countdown/sortie") => I.buildCalendar([view(o)], { urlFor: () => url });
const one = (o, url) => validateIcs(ics(o, url))[0];

test("un événement simple : tous les champs obligatoires, heures en heure universelle", () => {
  const ev = one({});
  assert.equal(ev.summary, "Sortie du jeu");
  assert.equal(ev.start, Date.UTC(2026, 10, 14, 20, 0), "21 h à Paris en novembre = 20 h universelle");
  assert.equal(ev.end - ev.start, 3_600_000, "une heure par défaut");
  assert.equal(ev.allDay, false);
  assert.equal(ev.status, "CONFIRMED");
  assert.equal(ev.url, "https://example.test/countdown/sortie");
});

test("UID stable : le même événement garde le même UID à chaque téléchargement et après modification", () => {
  const a = ics({}), b = ics({});
  assert.equal(a, b, "deux téléchargements successifs : fichiers identiques");
  const edited = one({ title: "Sortie du jeu (nouvelle date)", rev: 2, updatedAt: "2026-10-05T10:00:00.000Z", date: "2026-11-21" });
  assert.equal(edited.uid, one({}).uid);
  assert.equal(one({}).uid, "0f8fad5b-d9cb-469f-a165-70867728950e@curiosa");
  assert.equal(edited.sequence, 2, "SEQUENCE monte à chaque modification : les agendas déjà abonnés se mettent à jour");
  assert.equal(one({}).sequence, 1);
  assert.notEqual(one({ uid: "aaaaaaaa-0000-4000-8000-000000000001" }).uid, one({}).uid, "deux événements : deux UID");
});

test("DTSTAMP et LAST-MODIFIED : la dernière modification, en heure universelle", () => {
  const ev = one({});
  assert.equal(ev.stamp, Date.UTC(2026, 9, 2, 9, 30, 15));
  assert.equal(ev.lastModified, ev.stamp);
  assert.match(ics({}), /DTSTAMP:20261002T093015Z\r\n/);
});

test("échappements : virgule, point-virgule, barre oblique, retours à la ligne — et rien de plus", () => {
  const ev = one({ title: "Anniversaire; gâteau, bougies \\o/", description: "Ligne 1\nLigne 2, avec virgule; et point-virgule\r\nLigne 3 \\ fin", where: "Salle A, 1er étage; entrée B" });
  assert.equal(ev.summary, "Anniversaire; gâteau, bougies \\o/");
  assert.equal(ev.description, "Ligne 1\nLigne 2, avec virgule; et point-virgule\nLigne 3 \\ fin");
  assert.equal(ev.location, "Salle A, 1er étage; entrée B");
  const raw = ics({ title: "a;b,c\\d" });
  assert.match(raw, /SUMMARY:a\\;b\\,c\\\\d\r\n/);
  assert.equal(I.escapeText("x\r\ny\rz\nw"), "x\\ny\\nz\\nw");
  assert.equal(I.escapeText("a\u0007b\u0000c"), "abc", "les caractères de contrôle disparaissent");
});

test("pliage : jamais plus de 75 octets par ligne, même avec des accents et des émojis, et le texte se relit à l'identique", () => {
  const title = "Grande soirée d'anniversaire 🎂🎉 avec ça et là des caractères accentués éèêëàùûç, œuvres, ñ, 日本語のタイトルも一緒に".slice(0, 80);
  const description = `${"Très long texte avec des émojis 🎮🕹️ et des accents é à ù, ".repeat(9)}fin.`;
  const where = "Café-théâtre « Le Ñandú » — 12, rue de l'Écluse; 1000 Ville 🏰".repeat(2).slice(0, 120);
  const text = ics({ title, description, where });
  for (const line of text.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `ligne trop longue (${line.length} car.)`);
  assert.ok(text.split("\r\n").some((l) => l.startsWith(" ")), "il y a bien eu du pliage");
  const ev = validateIcs(text)[0];
  assert.equal(ev.summary, title);
  assert.equal(ev.description, description);
  assert.equal(ev.location, where);
});

test("pliage : un caractère de plusieurs octets n'est jamais coupé en deux, à toutes les positions", () => {
  for (let pad = 0; pad < 8; pad++) {
    const line = `SUMMARY:${"a".repeat(60 + pad)}${"é🎂日".repeat(12)}`;
    const folded = I.fold(line);
    for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.equal(folded.replace(/\r\n /g, ""), line);
    const bytes = new TextEncoder().encode(folded.replace(/\r\n /g, ""));
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  assert.equal(I.fold("SHORT:x"), "SHORT:x");
});

test("journée entière : dates sans heure, fin exclusive (le lendemain du dernier jour)", () => {
  const ev = one({ allDay: true, time: "", date: "2026-11-14", endDate: "2026-11-16" });
  assert.equal(ev.allDay, true);
  assert.equal(ev.start, Date.UTC(2026, 10, 14));
  assert.equal(ev.end, Date.UTC(2026, 10, 17), "trois jours : 14, 15, 16");
  assert.match(ics({ allDay: true, time: "", date: "2026-12-31" }), /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
});

test("avec une fin donnée : DTEND = cette fin, dans le fuseau de l'événement", () => {
  const ev = one({ date: "2026-03-28", time: "20:00", endDate: "2026-03-29", endTime: "04:00" });
  assert.equal(ev.start, Date.UTC(2026, 2, 28, 19, 0));
  assert.equal(ev.end, Date.UTC(2026, 2, 29, 2, 0), "04:00 d'été = 02:00 universelle : entre 20 h et 4 h il ne s'écoule que 7 heures cette nuit-là");
});

test("changement d'heure : l'instant du fichier est celui de la vraie heure d'été ou d'hiver", () => {
  assert.equal(one({ date: "2026-03-29", time: "02:30" }).start, Date.UTC(2026, 2, 29, 1, 30), "heure qui n'existe pas → 03:30");
  assert.equal(one({ date: "2026-10-25", time: "02:30" }).start, Date.UTC(2026, 9, 25, 0, 30), "heure qui existe deux fois → la première");
  assert.equal(one({ date: "2026-07-01", time: "12:00", tz: "Asia/Tokyo" }).start, Date.UTC(2026, 6, 1, 3, 0));
  assert.equal(one({ date: "2026-07-01", time: "12:00", tz: "America/St_Johns" }).start, Date.UTC(2026, 6, 1, 14, 30));
});

test("propriétés facultatives absentes quand elles sont vides, URL seulement si c'est une adresse complète", () => {
  const t = ics({}, "");
  assert.ok(!/DESCRIPTION|LOCATION|^URL/m.test(t));
  assert.ok(!/^URL/m.test(ics({}, "javascript:alert(1)")));
  assert.ok(!/^URL/m.test(ics({}, "/countdown/sortie")));
  assert.match(ics({}, "https://example.test/c/x"), /^URL:https:\/\/example\.test\/c\/x\r\n/m);
});

test("plusieurs événements dans un même fichier (sauvegarde) : tous valides, UID différents", () => {
  const text = I.buildCalendar([view({}), view({ uid: "bbbbbbbb-0000-4000-8000-000000000002", title: "Autre", slug: "autre" })]);
  const list = validateIcs(text);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].uid, list[1].uid);
});

test("le lecteur strict refuse bien les fichiers fautifs (sinon ces tests ne prouveraient rien)", () => {
  const good = ics({});
  assert.doesNotThrow(() => validateIcs(good));
  assert.throws(() => parseIcs(good.replaceAll("\r\n", "\n")), /CRLF/);
  assert.throws(() => parseIcs(good.replace("SUMMARY:", `SUMMARY:${"x".repeat(100)}`)), /75/);
  assert.throws(() => validateIcs(good.replace(/UID:.*\r\n/, "")), /UID/);
  assert.throws(() => validateIcs(good.replace(/DTSTAMP:.*\r\n/, "")), /DTSTAMP/);
  assert.throws(() => validateIcs(good.replace("END:VEVENT\r\n", "")), /VEVENT|END|non fermé/);
  assert.throws(() => validateIcs(good.replace("SUMMARY:Sortie du jeu", "SUMMARY:a,b")), /protégé/);
  assert.throws(() => validateIcs(good.replace("SUMMARY:Sortie du jeu", "SUMMARY:a\\qb")), /échappement/);
  assert.throws(() => validateIcs(good.replace(/DTEND:.*\r\n/, "DTEND:20200101T000000Z\r\n")), /DTEND doit venir après/);
  assert.throws(() => validateIcs(good.replace(/DTSTART:(\d{8}T\d{6})Z/, "DTSTART:$1")), /invalide/);
  assert.throws(() => unescapeText("fin\\"), /échappement|undefined/);
});

// ── Par la vraie route ─────────────────────────────────────────────────────────────────────────────────────────────

const ctxWith = (rows, extra = {}) => fakeCtx({ key: "cd", basePath: "countdown", moduleId: "countdown", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], siteUrl: "https://example.test", settings: { keep: "1d" }, rows: { events: rows }, ...extra });
const ask = (ctx, url, init) => mod.routes.ics(new Request(`https://example.test/m/cd/ics${url}`, init), ctx);

test("route .ics : en-têtes, nom de fichier, contenu valide, adresse complète de la page", async () => {
  const future = doc({ date: "2099-06-01", time: "21:00", slug: "gros-lancement", title: "Gros lancement" });
  const res = await ask(ctxWith([future]), "?e=gros-lancement");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="gros-lancement.ics"');
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const ev = validateIcs(await res.text())[0];
  assert.equal(ev.summary, "Gros lancement");
  assert.equal(ev.url, "https://example.test/countdown/gros-lancement");
});

test("route .ics : introuvable, masqué ou mal écrit → 404 sans détail ; écriture refusée ; HEAD sans corps", async () => {
  const past = doc({ date: "2020-01-01", time: "10:00", slug: "vieux" });
  const ctx = ctxWith([past, doc({ date: "2099-01-01", slug: "futur" })]);
  for (const q of ["", "?e=", "?e=vieux", "?e=inconnu", "?e=../../etc", "?e=A%00B", "?e=" + "a".repeat(200)]) {
    const res = await ask(ctx, q);
    assert.equal(res.status, 404, q);
    assert.equal(await res.text(), "Not found");
  }
  assert.equal((await ask(ctx, "?e=futur", { method: "POST" })).status, 405);
  const head = await ask(ctx, "?e=futur", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("route .ics : trop de demandes d'un même visiteur → 429, sans garder son adresse", async () => {
  const ctx = ctxWith([doc({ date: "2099-01-01" })], { key: "cdlimit" });
  let last;
  for (let i = 0; i < 70; i++) last = await ask(ctx, "?e=sortie", { headers: { "x-forwarded-for": "203.0.113.9" } });
  assert.equal(last.status, 429);
  const other = await ask(ctx, "?e=sortie", { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert.equal(other.status, 200, "un autre visiteur n'est pas touché");
  assert.ok(!JSON.stringify(ctx.dumpStore()).includes("203.0.113"), "aucune adresse n'est écrite dans le stockage");
});

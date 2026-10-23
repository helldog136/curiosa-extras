// Compte à rebours — l'heure : changement d'heure belge (mêmes règles que Paris, Berlin, Amsterdam…), fuseaux lointains,
// heures qui n'existent pas ou qui existent deux fois, phrases « chez vous ». Les valeurs attendues sont calculées À LA MAIN
// (instants universels écrits en dur), jamais avec le code testé.
import test from "node:test";
import assert from "node:assert/strict";

const T = await import("../modules/countdown/time.mjs");
const M = await import("../modules/countdown/model.mjs");

const utc = (...a) => Date.UTC(...a);
const at = (y, mo, d, h, mi, tz) => T.zonedToUtc(y, mo, d, h, mi, tz);
const PARIS = "Europe/Paris"; // Belgique, France, Allemagne, Pays-Bas… : une seule règle d'heure d'été

// ── Passage à l'heure d'été (dimanche 29 mars 2026 : à 01:00 universelle, 02:00 devient 03:00) ───────────────────────

test("heure d'été : avant, après, et le trou de la nuit", () => {
  assert.deepEqual(at(2026, 3, 29, 1, 59, PARIS), { ms: utc(2026, 2, 29, 0, 59), kind: "ok" }); // 01:59 hiver (+1)
  assert.deepEqual(at(2026, 3, 29, 3, 0, PARIS), { ms: utc(2026, 2, 29, 1, 0), kind: "ok" }); // 03:00 été (+2)
  const gap = at(2026, 3, 29, 2, 30, PARIS); // 02:30 n'existe pas
  assert.equal(gap.kind, "gap");
  assert.equal(gap.ms, utc(2026, 2, 29, 1, 30), "comme les agendas : on prend l'heure d'après (03:30 d'été)");
  assert.deepEqual(gap.shifted, { h: 3, mi: 30 });
});

test("heure d'hiver (dimanche 25 octobre 2026) : une heure qui existe deux fois prend la première", () => {
  assert.deepEqual(at(2026, 10, 25, 1, 59, PARIS), { ms: utc(2026, 9, 24, 23, 59), kind: "ok" }); // encore l'été (+2)
  assert.deepEqual(at(2026, 10, 25, 3, 0, PARIS), { ms: utc(2026, 9, 25, 2, 0), kind: "ok" }); // déjà l'hiver (+1)
  const fold = at(2026, 10, 25, 2, 30, PARIS);
  assert.equal(fold.kind, "fold");
  assert.equal(fold.ms, utc(2026, 9, 25, 0, 30), "la première fois (heure d'été)");
});

test("le même '20 h' ne vaut pas le même instant avant et après le changement d'heure", () => {
  const winter = at(2026, 3, 28, 20, 0, PARIS).ms; // samedi, hiver : 19:00 universelle
  const summer = at(2026, 3, 29, 20, 0, PARIS).ms; // dimanche, été : 18:00 universelle
  assert.equal(winter, utc(2026, 2, 28, 19, 0));
  assert.equal(summer, utc(2026, 2, 29, 18, 0));
  assert.equal(summer - winter, 23 * 3_600_000, "entre deux « 20 h » consécutifs il ne s'écoule que 23 heures cette nuit-là");
  const night = at(2026, 10, 24, 20, 0, PARIS).ms;
  assert.equal(at(2026, 10, 25, 20, 0, PARIS).ms - night, 25 * 3_600_000, "et 25 heures à l'automne");
});

test("toute l'année 2026 : midi est +1 en hiver, +2 en été, et la bascule tombe aux bons jours", () => {
  for (let day = 0; day < 365; day++) {
    const d = new Date(Date.UTC(2026, 0, 1 + day));
    const [y, mo, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const r = at(y, mo, dd, 12, 0, PARIS);
    const summer = d >= new Date(Date.UTC(2026, 2, 29)) && d < new Date(Date.UTC(2026, 9, 25));
    assert.equal(r.kind, "ok");
    assert.equal(r.ms, Date.UTC(y, mo - 1, dd, summer ? 10 : 11, 0), `${y}-${mo}-${dd}`);
  }
});

test("chaque quart d'heure des deux nuits de changement : l'ordre est respecté et rien n'est perdu", () => {
  for (const [mo, d] of [[3, 29], [10, 25]]) {
    let previous = -Infinity;
    const kinds = {};
    for (let h = 0; h < 5; h++) for (const mi of [0, 15, 30, 45]) {
      const r = at(2026, mo, d, h, mi, PARIS);
      kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      if (r.kind !== "gap") { assert.ok(r.ms >= previous, `${mo}/${d} ${h}:${mi} ne recule pas`); previous = r.ms; } // une heure inexistante est repoussée après le trou : elle peut dépasser la suivante
      if (r.kind === "ok") { const p = T.zoneParts(r.ms, PARIS); assert.deepEqual([p.h, p.mi], [h, mi], "relu sur le mur : même heure"); }
    }
    if (mo === 3) assert.equal(kinds.gap, 4, "quatre quarts d'heure n'existent pas au printemps (02:00–02:45)");
    else assert.equal(kinds.fold, 4, "quatre quarts d'heure existent deux fois à l'automne");
  }
});

// ── Fuseaux lointains ───────────────────────────────────────────────────────────────────────────────────────────────

test("fuseaux lointains : demi-heures, hémisphère sud, ligne de changement de date", () => {
  assert.equal(at(2026, 11, 14, 21, 0, "Asia/Kolkata").ms, utc(2026, 10, 14, 15, 30), "Inde : +5:30, jamais d'heure d'été");
  assert.equal(at(2026, 11, 14, 21, 0, "America/St_Johns").ms, utc(2026, 10, 15, 0, 30), "Terre-Neuve en hiver : -3:30");
  assert.equal(at(2026, 7, 14, 21, 0, "America/St_Johns").ms, utc(2026, 6, 14, 23, 30), "Terre-Neuve en été : -2:30");
  assert.equal(at(2026, 12, 31, 23, 59, "Pacific/Kiritimati").ms, utc(2026, 11, 31, 9, 59), "Kiribati : +14, déjà dans l'année suivante pour la moitié du monde");
  assert.equal(at(2026, 6, 15, 12, 0, "Pacific/Pago_Pago").ms, utc(2026, 5, 15, 23, 0), "Samoa américaines : -11");
  assert.equal(at(2026, 12, 25, 8, 0, "Australia/Sydney").ms, utc(2026, 11, 24, 21, 0), "Sydney en été austral : +11");
  assert.equal(at(2026, 6, 25, 8, 0, "Australia/Sydney").ms, utc(2026, 5, 24, 22, 0), "Sydney en hiver austral : +10");
});

test("hémisphère sud : Auckland change d'heure au printemps AUSTRAL (septembre) et à l'automne austral (avril)", () => {
  const gap = at(2026, 9, 27, 2, 30, "Pacific/Auckland");
  assert.equal(gap.kind, "gap");
  assert.equal(gap.ms, utc(2026, 8, 26, 14, 30), "03:30 d'été austral (+13)");
  const fold = at(2026, 4, 5, 2, 30, "Pacific/Auckland");
  assert.equal(fold.kind, "fold");
  assert.equal(fold.ms, utc(2026, 3, 4, 13, 30), "la première fois : encore +13");
});

test("Lord Howe : l'heure d'été n'y décale que de 30 minutes", () => {
  const gap = at(2026, 10, 4, 2, 15, "Australia/Lord_Howe");
  assert.equal(gap.kind, "gap");
  assert.equal(gap.ms, utc(2026, 9, 3, 15, 45));
  assert.deepEqual(gap.shifted, { h: 2, mi: 45 });
  assert.equal(at(2026, 10, 4, 2, 30, "Australia/Lord_Howe").kind, "ok");
});

test("États-Unis : le changement d'heure n'a pas lieu le même jour qu'en Europe", () => {
  const gap = at(2026, 3, 8, 2, 30, "America/Los_Angeles");
  assert.equal(gap.kind, "gap");
  assert.equal(gap.ms, utc(2026, 2, 8, 10, 30), "03:30 PDT");
  const fold = at(2026, 11, 1, 1, 30, "America/Los_Angeles");
  assert.equal(fold.kind, "fold");
  assert.equal(fold.ms, utc(2026, 10, 1, 8, 30), "la première fois : PDT (-7)");
  assert.equal(at(2026, 3, 8, 2, 30, PARIS).kind, "ok", "le 8 mars, Paris n'a rien d'étrange");
});

test("minuit qui n'existe pas (changement d'heure à minuit) : une journée entière commence à l'heure suivante", () => {
  const r = at(2026, 3, 8, 0, 0, "America/Havana");
  assert.equal(r.kind, "gap");
  assert.deepEqual(r.shifted, { h: 1, mi: 0 });
});

test("l'heure universelle (UTC) ne bouge jamais", () => {
  for (const mo of [1, 4, 7, 10]) assert.equal(at(2026, mo, 15, 12, 0, "UTC").ms, utc(2026, mo - 1, 15, 12, 0));
});

// ── Noms de fuseaux et textes saisis ─────────────────────────────────────────────────────────────────────────────────

test("noms de fuseaux : seuls les vrais noms officiels passent, jamais un décalage ni un texte libre", () => {
  for (const ok of ["Europe/Paris", "UTC", "America/Argentina/Buenos_Aires", "Asia/Kolkata", "Etc/GMT-1"]) assert.equal(T.isValidZone(ok), true, ok);
  for (const bad of ["", "+01:00", "-05:00", "GMT+1", "Europe/Nowhere", "../etc/passwd", "Europe/Paris; DROP TABLE", "Europe Paris", "x".repeat(80), "Z", null, undefined, 42, {}]) assert.equal(T.isValidZone(bad), false, String(bad));
  assert.equal(T.canonicalZone("europe/paris"), "Europe/Paris", "les majuscules officielles sont rétablies");
  assert.equal(T.canonicalZone("nope/x"), "");
});

test("heures tapées à la main : toutes les façons courantes, et rien d'absurde", () => {
  const ok = { "21:00": [21, 0], "21h": [21, 0], "21h30": [21, 30], "21 h 30": [21, 30], "21H30": [21, 30], "9pm": [21, 0], "9 pm": [21, 0], "9:30pm": [21, 30], "9:30 PM": [21, 30], "12am": [0, 0], "12pm": [12, 0], "0:05": [0, 5], "07:05": [7, 5], "23.59": [23, 59], "  8h  ": [8, 0] };
  for (const [raw, [h, mi]] of Object.entries(ok)) assert.deepEqual(T.parseTimeText(raw), { h, mi }, raw);
  for (const bad of ["", "abc", "24:00", "25h", "21:60", "13pm", "0pm", "9:5", "21h5", "21:00:00", "-1:00", "midi", "9 heures", null, undefined]) assert.equal(T.parseTimeText(bad), null, String(bad));
});

test("jours : seuls les jours qui existent vraiment", () => {
  assert.deepEqual(T.parseDate("2026-02-28"), { y: 2026, mo: 2, d: 28 });
  assert.deepEqual(T.parseDate("2028-02-29"), { y: 2028, mo: 2, d: 29 }, "année bissextile");
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "1999-12-31", "2101-01-01", "26-01-01", "2026/01/01", "", null]) assert.equal(T.parseDate(bad), null, String(bad));
  assert.equal(T.addDays("2026-03-31", 1), "2026-04-01");
  assert.equal(T.addDays("2026-12-31", 1), "2027-01-01");
});

// ── Ce qu'un événement devient ───────────────────────────────────────────────────────────────────────────────────────

const stored = (o = {}) => ({ uid: "u1", slug: "sortie", rev: 1, title: "Sortie", allDay: false, date: "2026-03-29", time: "03:30", tz: PARIS, endDate: "", endTime: "", description: "", where: "", endMessage: "", endLinkLabel: "", endLink: "", keep: "", featured: false, image: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o });
const seen = (o, now = 0, keep = "1d") => M.view(M.read({ id: "r1", data: stored(o) }), keep, now);

test("un événement est gardé avec son fuseau : l'instant se calcule à la lecture", () => {
  assert.equal(seen({ date: "2026-03-28", time: "20:00" }).startMs, utc(2026, 2, 28, 19, 0));
  assert.equal(seen({ date: "2026-03-30", time: "20:00" }).startMs, utc(2026, 2, 30, 18, 0));
  const gap = seen({ date: "2026-03-29", time: "02:30" });
  assert.equal(gap.note, "gap");
  assert.deepEqual(gap.shifted, { h: 3, mi: 30 });
  assert.equal(seen({ date: "2026-10-25", time: "02:30" }).note, "fold");
  assert.equal(seen({ date: "2026-11-14", time: "21:00" }).note, "");
});

test("états : à venir, l'heure est passée, masqué — selon le délai choisi (évalué à la lecture)", () => {
  const start = utc(2026, 10, 14, 20, 0);
  const o = { date: "2026-11-14", time: "21:00", keep: "6h" };
  assert.equal(seen(o, start - 1).phase, "upcoming");
  assert.equal(seen(o, start).phase, "started", "à l'heure pile : c'est parti");
  assert.equal(seen(o, start + 6 * 3_600_000 - 1).phase, "started");
  assert.equal(seen(o, start + 6 * 3_600_000).phase, "hidden", "6 heures plus tard : disparu");
  assert.equal(seen({ ...o, keep: "never" }, start + 10 * 365 * 86_400_000).phase, "started", "« jamais » ne disparaît jamais");
  assert.equal(seen({ ...o, keep: "" }, start + 24 * 3_600_000 - 1, "1d").phase, "started", "sans choix propre, le réglage du site s'applique");
  assert.equal(seen({ ...o, keep: "" }, start + 24 * 3_600_000, "1d").phase, "hidden");
  assert.equal(seen({ ...o, keep: "" }, start + 24 * 3_600_000, "3d").phase, "started");
});

test("avec une fin donnée, le délai se compte depuis la fin (une convention de trois jours reste affichée)", () => {
  const o = { date: "2026-11-13", time: "10:00", endDate: "2026-11-15", endTime: "18:00", keep: "1d" };
  const v = seen(o, 0);
  assert.equal(v.endMs, utc(2026, 10, 15, 17, 0));
  assert.equal(seen(o, utc(2026, 10, 14, 12, 0)).phase, "started", "en plein milieu : le message de fin est là");
  assert.equal(seen(o, v.endMs + 24 * 3_600_000).phase, "hidden");
  assert.equal(seen(o, v.endMs + 24 * 3_600_000 - 1).phase, "started");
});

test("journée entière : minuit dans le fuseau de l'événement, fin = lendemain du dernier jour", () => {
  const v = seen({ allDay: true, time: "", date: "2026-11-14", tz: "Asia/Tokyo" });
  assert.equal(v.startMs, utc(2026, 10, 13, 15, 0), "00:00 à Tokyo = 15:00 la veille en heure universelle");
  assert.deepEqual(v.endForCalendar, { allDay: true, date: "2026-11-15" });
  const multi = seen({ allDay: true, time: "", date: "2026-11-14", endDate: "2026-11-16" });
  assert.equal(multi.endForCalendar.date, "2026-11-17", "trois jours : le 14, le 15 et le 16");
  assert.equal(multi.endMs, utc(2026, 10, 16, 23, 0), "le 17 à minuit à Paris (+1)");
});

// ── Compte à rebours pendant le changement d'heure ──────────────────────────────────────────────────────────────────

test("le temps qui reste est le vrai temps écoulé, même à travers un changement d'heure", () => {
  const target = at(2026, 3, 29, 12, 0, PARIS).ms; // dimanche midi (été)
  const sat = at(2026, 3, 28, 12, 0, PARIS).ms; // samedi midi (hiver)
  assert.deepEqual(T.breakdown(target - sat), { S: 23 * 3600, d: 0, h: 23, m: 0, s: 0 }, "samedi midi → dimanche midi : 23 h seulement");
  const fall = at(2026, 10, 25, 12, 0, PARIS).ms;
  assert.equal(T.breakdown(fall - at(2026, 10, 24, 12, 0, PARIS).ms).h, 1, "25 h à l'automne : 1 jour et 1 heure");
  assert.equal(T.breakdown(fall - at(2026, 10, 24, 12, 0, PARIS).ms).d, 1);
});

test("découpage : arrondi vers le haut, jamais négatif", () => {
  assert.deepEqual(T.breakdown(0), { S: 0, d: 0, h: 0, m: 0, s: 0 });
  assert.equal(T.breakdown(-5000).S, 0);
  assert.equal(T.breakdown(1).s, 1, "à 1 ms de l'heure on lit encore « 1 »");
  assert.equal(T.breakdown(1000).s, 1);
  assert.equal(T.breakdown(1001).s, 2);
  assert.deepEqual(T.breakdown(((3 * 24 + 4) * 60 + 12) * 60_000 + 59_000), { S: 3 * 86400 + 4 * 3600 + 12 * 60 + 59, d: 3, h: 4, m: 12, s: 59 });
});

test("le prochain réveil tombe exactement sur le prochain changement affiché", () => {
  for (const rem of [1, 999, 1000, 1001, 59_999, 60_000, 3_600_000, 90_061_234]) {
    const d = T.nextDelay(rem, true);
    assert.ok(d >= 1 && d <= 1000, `${rem} → ${d}`);
    assert.notEqual(T.breakdown(rem).S, T.breakdown(rem - d).S, "à ce moment-là l'affichage a changé");
    if (d > 1) assert.equal(T.breakdown(rem).S, T.breakdown(rem - d + 1).S, "et une milliseconde avant il n'avait pas changé");
  }
  for (const rem of [60_000, 60_001, 125_000, 3_600_000, 90_061_234]) {
    const d = T.nextDelay(rem, false);
    assert.ok(d >= 1 && d <= 60_001, `${rem} → ${d}`);
    const before = T.breakdown(rem), after = T.breakdown(rem - d);
    assert.notEqual(`${before.d}/${before.h}/${before.m}`, `${after.d}/${after.h}/${after.m}`, `sans secondes (${rem}) : la minute affichée change`);
    const early = T.breakdown(rem - d + 1);
    assert.equal(`${before.d}/${before.h}/${before.m}`, `${early.d}/${early.h}/${early.m}`, "et une milliseconde avant elle n'avait pas changé");
  }
  for (const rem of [1, 30_000, 59_000]) assert.equal(T.nextDelay(rem, false), rem, "dans la dernière minute, sans secondes, rien ne change avant l'heure elle-même");
  assert.equal(T.nextDelay(0, true), 0);
  assert.equal(T.nextDelay(-5, false), 0);
});

// ── « Chez vous » ───────────────────────────────────────────────────────────────────────────────────────────────────

const FR = { today: "aujourd’hui", tomorrow: "demain", at: "à", local: "{when} chez vous" };
const EN = { today: "today", tomorrow: "tomorrow", at: "at", local: "{when}, your time" };

test("chez vous : l'écart entre Paris et New York est de 5 h quelques semaines, puis de 6 h (changements d'heure décalés)", () => {
  const march20 = at(2026, 3, 20, 20, 0, PARIS).ms; // Paris +1, New York déjà en heure d'été (-4)
  const march30 = at(2026, 3, 30, 20, 0, PARIS).ms; // Paris +2, New York -4
  const now = utc(2026, 2, 18, 12, 0);
  assert.equal(T.linesFor(march20, now, PARIS, "America/New_York", "fr", FR, false).local, "Vendredi à 15 h chez vous");
  assert.equal(T.linesFor(march30, utc(2026, 2, 28, 12, 0), PARIS, "America/New_York", "fr", FR, false).local, "Lundi à 14 h chez vous");
});

test("chez vous : aujourd'hui, demain, le jour de la semaine, puis la date complète", () => {
  const target = at(2026, 11, 14, 21, 0, PARIS).ms; // 20:00 universelle, samedi
  const line = (now, viewer = "UTC", lang = "fr", L = FR) => T.linesFor(target, now, PARIS, viewer, lang, L, false).local;
  assert.equal(line(utc(2026, 10, 14, 8, 0)), "Aujourd’hui à 20 h chez vous");
  assert.equal(line(utc(2026, 10, 13, 8, 0)), "Demain à 20 h chez vous");
  assert.equal(line(utc(2026, 10, 10, 8, 0)), "Samedi à 20 h chez vous");
  assert.equal(line(utc(2026, 9, 1, 8, 0)), "Samedi 14 novembre à 20 h chez vous");
  assert.equal(line(utc(2025, 9, 1, 8, 0)), "Samedi 14 novembre 2026 à 20 h chez vous", "l'année est dite quand ce n'est pas l'année en cours");
  assert.equal(line(utc(2026, 10, 10, 8, 0), "UTC", "en", EN), "Saturday at 8 pm, your time");
  assert.equal(line(utc(2026, 10, 13, 8, 0), "UTC", "en", EN), "Tomorrow at 8 pm, your time");
});

test("chez vous : le jour change selon le fuseau du visiteur (Tokyo est déjà le lendemain, Honolulu encore la veille)", () => {
  const target = at(2026, 11, 14, 21, 0, PARIS).ms; // samedi 21 h à Paris
  const now = utc(2026, 10, 1, 8, 0);
  assert.equal(T.linesFor(target, now, PARIS, "Asia/Tokyo", "fr", FR, false).local, "Dimanche 15 novembre à 5 h chez vous");
  assert.equal(T.linesFor(target, now, PARIS, "Pacific/Honolulu", "fr", FR, false).local, "Samedi 14 novembre à 10 h chez vous");
  assert.equal(T.linesFor(target, now, PARIS, "Pacific/Kiritimati", "fr", FR, false).local, "Dimanche 15 novembre à 10 h chez vous");
  assert.equal(T.linesFor(target, now, PARIS, "Asia/Kolkata", "fr", FR, false).local, "Dimanche 15 novembre à 1 h 30 chez vous");
  assert.equal(T.linesFor(target, now, PARIS, "America/St_Johns", "en", EN, false).local, "Saturday, November 14 at 4:30 pm, your time");
});

test("sans JavaScript : la date et l'heure dans le fuseau de l'événement, avec le nom du fuseau", () => {
  const target = at(2026, 11, 14, 21, 0, PARIS).ms;
  assert.deepEqual(T.linesFor(target, 0, PARIS, "", "fr", FR, false), { event: "Samedi 14 novembre 2026 à 21 h (heure d’Europe centrale)", local: "" });
  assert.deepEqual(T.linesFor(target, 0, PARIS, "", "en", EN, false), { event: "Saturday, November 14, 2026 at 9 pm (Central European Time)", local: "" });
  assert.match(T.linesFor(at(2026, 11, 14, 21, 0, "Asia/Tokyo").ms, 0, "Asia/Tokyo", "", "fr", FR, false).event, /^Samedi 14 novembre 2026 à 21 h \(heure normale du Japon\)$/);
});

test("même heure que l'événement : une seule phrase, sans répétition", () => {
  const target = at(2026, 11, 14, 21, 0, PARIS).ms;
  const r = T.linesFor(target, utc(2026, 10, 1), PARIS, "Europe/Berlin", "fr", FR, false);
  assert.equal(r.event, "");
  assert.equal(r.local, "Samedi 14 novembre à 21 h chez vous");
});

test("journée entière : la date seule, aucune conversion d'heure", () => {
  const target = at(2026, 11, 14, 0, 0, "Asia/Tokyo").ms;
  assert.deepEqual(T.linesFor(target, 0, "Asia/Tokyo", "America/New_York", "fr", FR, true), { event: "Samedi 14 novembre 2026", local: "" });
});

test("l'heure en toutes lettres : minuit, midi, demi-heures, anglais, autres langues", () => {
  assert.equal(T.clockText(0, 0, "fr"), "minuit");
  assert.equal(T.clockText(12, 0, "fr"), "midi");
  assert.equal(T.clockText(0, 5, "fr"), "0 h 05");
  assert.equal(T.clockText(21, 30, "fr-BE"), "21 h 30");
  assert.equal(T.clockText(0, 0, "en"), "midnight");
  assert.equal(T.clockText(12, 0, "en"), "noon");
  assert.equal(T.clockText(13, 5, "en"), "1:05 pm");
  assert.equal(T.clockText(9, 0, "en"), "9 am");
  assert.equal(T.clockText(21, 5, "de"), "21:05");
});

test("pluriels : le français met 0 et 1 au singulier", () => {
  assert.equal(T.plural(0, ["jour", "jours"], "fr"), "jour");
  assert.equal(T.plural(1, ["jour", "jours"], "fr"), "jour");
  assert.equal(T.plural(2, ["jour", "jours"], "fr"), "jours");
  assert.equal(T.plural(0, ["day", "days"], "en"), "days");
  assert.equal(T.plural(1, ["day", "days"], "en"), "day");
});

test("phrase pour lecteur d'écran", () => {
  const L = { d: ["jour", "jours"], h: ["heure", "heures"], m: ["minute", "minutes"], and: "et", srIn: "Dans {list}", lessMin: "Dans moins d’une minute" };
  assert.equal(T.srText(T.breakdown(((3 * 24 + 4) * 60 + 12) * 60_000), L, "fr"), "Dans 3 jours, 4 heures et 12 minutes");
  assert.equal(T.srText(T.breakdown(2 * 3_600_000), L, "fr"), "Dans 2 heures");
  assert.equal(T.srText(T.breakdown(30_000), L, "fr"), "Dans moins d’une minute");
});

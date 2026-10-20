// Story d'annonce 1.0.0 — les règles pures (pseudos, réglages, dates, compte à rebours, streams, lignes, co-streamers, couleurs), exécutées aussi dans un `vm` vierge :
// le même fichier tourne sur le serveur, dans la page de l'éditeur et ici. Aucun réseau, aucune horloge : « maintenant » est toujours donné.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const P = await import("../modules/stream-story/pure.mjs");
const TZ = "Europe/Brussels";
const at = (iso) => Date.parse(iso);

/* ───────────── Les formats : une seule table ───────────── */

test("formats : exactement deux, dans UNE table (id, largeur, hauteur, marges, zones) : Vertical 1080×1920 et Passeport 1080×1350", () => {
  assert.deepEqual(P.FORMATS.map((f) => [f.id, f.width, f.height]), [["vertical", 1080, 1920], ["passeport", 1080, 1350]]);
  const v = P.formatOf("vertical"), p = P.formatOf("passeport");
  assert.deepEqual(v.margins, { top: 250, bottom: 340, left: 64, right: 64 }, "Instagram cache ≈ 250 px en haut et ≈ 340 px en bas d'une story");
  assert.deepEqual(p.margins, { top: 60, bottom: 60, left: 64, right: 64 });
  assert.deepEqual(P.safeArea("vertical"), { x: 64, y: 250, w: 952, h: 1330 });
  assert.deepEqual(P.safeArea("passeport"), { x: 64, y: 60, w: 952, h: 1230 });
  // la grille du profil recadre un 4:5 au centre en 3:4 : 1012 px de large visibles, soit 34 px perdus de chaque côté ; la zone sûre est plus prudente
  assert.deepEqual(p.zones.map((z) => [z.id, z.x, z.w]), [["grid", 0, 34], ["grid", 1046, 34]]);
  assert.ok(p.margins.left >= 34 && p.margins.right >= 34);
  assert.equal(p.width - 2 * 34, 1012);
  assert.deepEqual(v.zones.map((z) => [z.id, z.y, z.h]), [["ui", 0, 250], ["ui", 1580, 340]]);
  assert.equal(P.formatOf("inconnu").id, "vertical", "un format inconnu retombe sur le vertical");
  for (const f of P.FORMATS) for (const z of f.zones) assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= f.width && z.y + z.h <= f.height);
  assert.ok(!P.FORMATS.some((f) => f.width > f.height), "pas de paysage");
});

/* ───────────── Pseudos et textes ───────────── */

test("pseudos : comme Twitch (4 à 25 caractères, a-z 0-9 _), @pseudo et adresses twitch.tv reconnus, messages distincts", () => {
  for (const ok of ["emma_live", "@Emma_Live", "  EMMA_live ", "https://twitch.tv/emma_live", "twitch.tv/Emma_Live/about", "abcd", "a".repeat(25)]) assert.ok(P.normalizeLogin(ok).login, ok);
  for (const bad of ["abc", "a".repeat(26), "emma live", "emma-live", "émma_live", "<b>x</b>", "emma_live!", "https://example.org/emma_live", "javascript:alert(1)"]) assert.equal(P.normalizeLogin(bad).error, "invalid", bad);
  assert.equal(P.normalizeLogin("").error, "empty"); assert.equal(P.normalizeLogin(null).error, "empty");
  assert.equal(P.normalizeLogin("https://twitch.tv/videos/12").error, "not_channel");
});

test("textes : une ligne sans caractère de contrôle ; une phrase libre de 3 lignes au plus, coupée à 140 ; jamais de HTML interprété (c'est du texte)", () => {
  assert.equal(P.oneLine("  a \n\t b\u0000c  ", 10), "a b c");
  assert.equal([...P.oneLine("😀".repeat(50), 10)].length, 10, "jamais au milieu d'un emoji");
  assert.equal(P.freeText("a\r\n\r\nb  c\n\n\nd\ne", 50), "a\n\nb c");
  assert.equal(P.freeText("\n\n  x  \n\n", 50), "x");
  assert.equal([...P.freeText("é".repeat(300), 140)].length, 140);
  assert.equal(P.freeText("<img src=x onerror=alert(1)>", 140), "<img src=x onerror=alert(1)>", "gardé tel quel : il sera dessiné avec fillText, jamais écrit dans une page");
  assert.equal(P.safeImageUrl("javascript:alert(1)"), ""); assert.equal(P.safeImageUrl("data:image/png;base64,AAAA"), ""); assert.equal(P.safeImageUrl("//evil.test/x.png"), "");
  assert.equal(P.safeImageUrl("/uploads/a.png"), "/uploads/a.png"); assert.equal(P.safeImageUrl("https://x.test/a.png"), "https://x.test/a.png"); assert.equal(P.safeImageUrl("http://x.test/a.png"), "");
});

/* ───────────── Les réglages d'une génération ───────────── */

test("réglages : valeurs inconnues écartées, durée de 5 à 15 (entiers), éléments et co-streamers bornés, ne lève jamais", () => {
  const d = P.cleanConfig({});
  assert.deepEqual([d.style, d.format, d.duration, d.lang], ["neon", "vertical", 15, "fr"]);
  assert.deepEqual(d.elements, P.ELEMENTS);
  for (const [raw, want] of [[3, 5], [4.4, 5], [5, 5], [9.6, 10], [15, 15], [99, 15], ["12", 12], ["abc", 15], [null, 15]]) assert.equal(P.cleanConfig({ duration: raw }).duration, want, String(raw));
  assert.equal(P.cleanConfig({ style: "<script>", format: "paysage" }).style, "neon");
  assert.equal(P.cleanConfig({ format: "paysage" }).format, "vertical", "le paysage n'existe pas");
  assert.deepEqual(P.cleanConfig({ elements: ["title", "bidon", "text", "title"] }).elements, ["title", "text"]);
  assert.deepEqual(P.cleanConfig({ costreamers: ["Alice_TV", "alice_tv", "x", "@bob_x", 12, null, "carl_99", "dave_live", "eve_play", "fay_games", "gus_stream", "hank_play"] }).costreamers, ["alice_tv", "bob_x", "carl_99", "dave_live", "eve_play", "fay_games"], "6 au plus, sans doublon ni pseudo invalide");
  assert.equal([...P.cleanConfig({ text: "x".repeat(500) }).text].length, 140);
  for (const junk of [null, undefined, 5, "x", [], () => 1]) assert.doesNotThrow(() => P.cleanConfig(junk));
  assert.equal(P.cleanConfig({ streamKey: "a/b" }).streamKey, "");
  assert.equal(P.cleanConfig({ lang: "de" }).lang, "fr");
});

/* ───────────── Dates, heures et compte à rebours ───────────── */

const cd = (start, now, extra = {}) => P.countdownText({ startMs: at(start), nowMs: at(now), tz: TZ, lang: "fr", ...extra });

test("compte à rebours (français) : « Dans 45 min », « Dans 2 h 15 », « Ce soir à 19 h 30 », « Aujourd'hui à 14 h », « Demain à 19 h 30 », « Dans 4 jours », « C'est maintenant »", () => {
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T16:45:00Z"), "Dans 45 min");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T15:15:00Z"), "Dans 2 h 15");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T14:30:00Z"), "Dans 3 h");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T09:00:00Z"), "Ce soir à 19 h 30");
  assert.equal(cd("2026-10-22T12:00:00Z", "2026-10-22T05:00:00Z"), "Aujourd'hui à 14 h");
  assert.equal(cd("2026-10-23T17:30:00Z", "2026-10-22T09:00:00Z"), "Demain à 19 h 30");
  assert.equal(cd("2026-10-26T17:30:00Z", "2026-10-22T09:00:00Z"), "Dans 4 jours");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T17:30:20Z"), "C'est maintenant");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T19:00:00Z"), "C'est maintenant", "commencé depuis moins de 3 h");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T23:00:00Z"), "", "fini depuis plus de 3 h : rien");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T17:00:00Z"), "Dans 30 min");
  assert.equal(cd("2026-10-22T17:30:00Z", "2026-10-22T16:30:30Z"), "Dans 60 min", "juste sous l'heure : en minutes");
});

test("compte à rebours : minuit et fuseau (le « soir » et « demain » se lisent sur l'horloge du stream), anglais, journée entière, entrées absurdes", () => {
  // 23 h 30 à Bruxelles = 21 h 30 UTC (heure d'été) : « Ce soir » ; 00 h 30 le lendemain = « Demain »
  assert.equal(cd("2026-10-22T21:30:00Z", "2026-10-22T08:00:00Z"), "Ce soir à 23 h 30");
  assert.equal(cd("2026-10-22T22:30:00Z", "2026-10-22T08:00:00Z"), "Demain à 0 h 30");
  const en = (start, now, extra = {}) => P.countdownText({ startMs: at(start), nowMs: at(now), tz: TZ, lang: "en", ...extra });
  assert.equal(en("2026-10-22T17:30:00Z", "2026-10-22T09:00:00Z"), "Tonight at 7:30 PM");
  assert.equal(en("2026-10-23T17:30:00Z", "2026-10-22T09:00:00Z"), "Tomorrow at 7:30 PM");
  assert.equal(en("2026-10-22T17:30:00Z", "2026-10-22T15:15:00Z"), "In 2h 15m");
  assert.equal(en("2026-10-22T17:30:00Z", "2026-10-22T16:45:00Z"), "In 45 min");
  assert.equal(en("2026-10-26T17:30:00Z", "2026-10-22T09:00:00Z"), "In 4 days");
  assert.equal(cd("2026-10-22T00:00:00Z", "2026-10-22T08:00:00Z", { allDay: true }), "Aujourd'hui");
  assert.equal(cd("2026-10-22T22:00:00Z", "2026-10-22T08:00:00Z", { allDay: true }), "Demain", "le 23 octobre commence à 22 h UTC à Bruxelles");
  assert.equal(cd("2026-10-27T23:00:00Z", "2026-10-22T08:00:00Z", { allDay: true }), "Dans 6 jours");
  assert.equal(P.countdownText({ startMs: NaN, nowMs: 0, tz: TZ, lang: "fr" }), "");
  assert.equal(P.countdownText({ startMs: 1, nowMs: 2, tz: "Mars/Phobos", lang: "fr" }), "");
  // changement d'heure (le 25 octobre 2026 à 3 h → 2 h) : « demain 19 h 30 » reste 19 h 30
  assert.equal(cd("2026-10-25T18:30:00Z", "2026-10-24T09:00:00Z"), "Demain à 19 h 30");
});

test("jour et heure : « Jeudi 22 octobre », « 19 h 30 » (« 19 h » pile), anglais « 7:30 PM » ; le jour d'un stream tard le soir reste le bon", () => {
  const s = at("2026-10-22T17:30:00Z");
  assert.equal(P.formatDay(s, TZ, "fr"), "Jeudi 22 octobre");
  assert.equal(P.formatTime(s, TZ, "fr"), "19 h 30"); assert.equal(P.formatTime(at("2026-10-22T17:00:00Z"), TZ, "fr"), "19 h"); assert.equal(P.formatTime(at("2026-10-21T22:05:00Z"), TZ, "fr"), "0 h 05");
  assert.match(P.formatDay(s, TZ, "en"), /^Thursday,? 22 October$/); assert.equal(P.formatTime(s, TZ, "en"), "7:30 PM"); assert.equal(P.formatTime(at("2026-10-22T10:00:00Z"), TZ, "en"), "12:00 PM");
  assert.equal(P.formatTime(at("2026-10-21T22:00:00Z"), TZ, "en"), "12:00 AM");
  assert.equal(P.isoDay(at("2026-10-22T22:30:00Z"), TZ), "2026-10-23", "22 h 30 UTC = 0 h 30 le lendemain à Bruxelles");
  assert.equal(P.zonedToUtc(2026, 10, 22, 19, 30, TZ), at("2026-10-22T17:30:00Z"));
  assert.equal(P.zonedToUtc(2026, 12, 24, 20, 0, TZ), at("2026-12-24T19:00:00Z"), "heure d'hiver");
  assert.deepEqual(P.countdownParts(at("2026-10-22T17:30:00Z"), at("2026-10-22T10:00:00Z")), { days: 0, hours: 7, minutes: 30, started: false });
  assert.deepEqual(P.countdownParts(at("2026-10-25T10:01:00Z"), at("2026-10-22T10:00:00Z")), { days: 3, hours: 0, minutes: 1, started: false });
  assert.equal(P.countdownParts(at("2027-10-22T10:00:00Z"), at("2026-10-22T10:00:00Z")).days, 99);
  assert.equal(P.countdownParts(1, 2).started, true);
});

/* ───────────── Les streams ───────────── */

test("streams : annulés et illisibles écartés, passés écartés (sauf commencé depuis moins de 3 h), doublons fusionnés, triés, bornés ; journée entière lue par sa date ; fuseau de l'agenda gardé", () => {
  const now = at("2026-10-22T10:00:00Z");
  const items = [
    { id: "b", title: "Plus tard", start: "2026-10-25T18:00:00Z", timezone: TZ, games: ["Zelda", " ", 5, "Hades", "A", "B"] },
    { id: "a", title: "Demain", start: "2026-10-23T18:00:00Z", timezone: TZ },
    { id: "a2", title: "Demain", start: "2026-10-23T18:00:00Z", timezone: TZ },
    { id: "c", title: "Annulé", start: "2026-10-24T18:00:00Z", status: "cancelled" },
    { id: "d", title: "Hier", start: "2026-10-21T18:00:00Z" },
    { id: "e", title: "En cours", start: "2026-10-22T08:30:00Z", end: "2026-10-22T12:00:00Z" },
    { id: "f", title: "Commencé il y a 5 h", start: "2026-10-22T05:00:00Z" },
    { id: "g", title: "Illisible", start: "demain" }, null, "x", { title: "Sans début" },
    { id: "h", title: "Toute la journée", start: "2026-10-26T00:00:00Z", end: "2026-10-27T00:00:00Z", allDay: true, day: "2026-10-26", timezone: TZ },
    { id: "i", title: "<b>Gras</b>\u0000", start: "2026-10-28T18:00:00Z" },
  ];
  const out = P.upcomingStreams(items, now, TZ);
  assert.deepEqual(out.map((s) => s.title), ["En cours", "Demain", "Plus tard", "Toute la journée", "<b>Gras</b>"]);
  assert.deepEqual(out[2].games, ["Zelda", "Hades", "A"], "3 jeux au plus, des textes seulement");
  const all = out.find((s) => s.allDay);
  assert.equal(all.startMs, at("2026-10-25T23:00:00Z"), "le 26 octobre à minuit, heure de Bruxelles (heure d'hiver depuis la veille)");
  assert.equal(all.day, "2026-10-26");
  assert.equal(out[1].timezone, TZ); assert.equal(out[4].timezone, "", "sans fuseau d'agenda : le fuseau est choisi par la page");
  assert.ok(out.every((s) => /^[a-z0-9]{1,20}$/.test(s.key)) && new Set(out.map((s) => s.key)).size === out.length, "chaque stream a sa clé courte");
  assert.equal(P.upcomingStreams(Array.from({ length: 50 }, (_, i) => ({ id: `${i}`, title: `S${i}`, start: new Date(now + (i + 1) * 3_600_000).toISOString() })), now).length, 12, "12 au plus");
  assert.deepEqual(P.upcomingStreams("nimporte quoi", now), []); assert.deepEqual(P.upcomingStreams(undefined, now), []);
});

test("stream saisi à la main : titre, jour, heure (facultative) ; un 31 février, une heure 25:00 ou un titre vide sont refusés avec leur raison", () => {
  const ok = P.manualStream({ title: "  Ma soirée \n spéciale ", date: "2026-10-22", time: "19:30" }, TZ);
  assert.equal(ok.title, "Ma soirée spéciale"); assert.equal(ok.startMs, at("2026-10-22T17:30:00Z")); assert.equal(ok.allDay, false); assert.equal(ok.manual, true);
  const day = P.manualStream({ title: "Marathon", date: "2026-10-22", time: "" }, TZ);
  assert.equal(day.allDay, true); assert.equal(day.day, "2026-10-22"); assert.equal(day.startMs, at("2026-10-21T22:00:00Z"));
  assert.equal(P.manualStream({ title: "", date: "2026-10-22" }, TZ).error, "title");
  assert.equal(P.manualStream({ title: "x", date: "2026-02-31", time: "10:00" }, TZ).error, "date");
  assert.equal(P.manualStream({ title: "x", date: "demain" }, TZ).error, "date");
  assert.equal(P.manualStream({ title: "x", date: "2026-10-22", time: "25:00" }, TZ).error, "time");
  assert.equal(P.manualStream({ title: "x", date: "2026-10-22", time: "10:99" }, TZ).error, "time");
  assert.equal(P.manualStream({ title: "x".repeat(200), date: "2026-10-22", time: "10:00" }, TZ).title.length, 80);
});

test("contenu de la vidéo : chaque élément n'apparaît que s'il est choisi ET qu'il a de quoi s'afficher ; le texte personnalisé est gardé tel quel", () => {
  const stream = { title: "Soirée", startMs: at("2026-10-22T17:30:00Z"), allDay: false, games: ["Hades", "Zelda"], timezone: TZ };
  const base = { stream, coStreamers: [{ login: "alice_tv", name: "Alice" }, { login: "bob_x", name: "" }], site: { name: "Emma Live" }, nowMs: at("2026-10-22T09:00:00Z"), tz: TZ };
  const all = P.buildContent({ ...P.DEFAULT_CONFIG, text: "Venez !", costreamers: ["alice_tv", "bob_x"] }, base);
  assert.deepEqual([all.title, all.dayLine, all.timeLine, all.countdown, all.game, all.brand, all.text], ["Soirée", "Jeudi 22 octobre", "19 h 30", "Ce soir à 19 h 30", "Hades", "Emma Live", "Venez !"]);
  assert.deepEqual(all.costreamers, [{ login: "alice_tv", name: "Alice" }, { login: "bob_x", name: "bob_x" }]);
  assert.deepEqual(all.parts, { days: 0, hours: 8, minutes: 30, started: false });
  const some = P.buildContent({ ...P.DEFAULT_CONFIG, elements: ["title", "brand"], channelName: "  Ma chaîne " }, base);
  assert.deepEqual([some.title, some.dayLine, some.countdown, some.game, some.brand, some.costreamers.length], ["Soirée", "", "", "", "Ma chaîne", 0]);
  const none = P.buildContent(P.DEFAULT_CONFIG, { ...base, stream: null });
  assert.deepEqual([none.title, none.dayLine, none.countdown, none.game, none.brand], ["", "", "", "", "Emma Live"], "sans stream : seulement le logo et le nom");
  const allDay = P.buildContent(P.DEFAULT_CONFIG, { ...base, stream: { ...stream, allDay: true, startMs: at("2026-10-22T22:00:00Z") } });
  assert.equal(allDay.timeLine, ""); assert.equal(allDay.parts, null);
  assert.equal(P.buildContent({ ...P.DEFAULT_CONFIG, text: "<script>alert(1)</script>" }, base).text, "<script>alert(1)</script>");
});

test("nom de fichier : annonce-2026-10-22-vertical.mp4 / -passeport.mp4 (announcement-… en anglais) ; .webm pour le repli ; jour lu sur l'horloge du stream", () => {
  const a = { startMs: at("2026-10-22T17:30:00Z"), tz: TZ, lang: "fr", ext: "mp4" };
  assert.equal(P.fileName({ ...a, format: "vertical" }), "annonce-2026-10-22-vertical.mp4");
  assert.equal(P.fileName({ ...a, format: "passeport" }), "annonce-2026-10-22-passeport.mp4");
  assert.equal(P.fileName({ ...a, format: "vertical", lang: "en", ext: "webm" }), "announcement-2026-10-22-vertical.webm");
  assert.equal(P.fileName({ ...a, format: "../x", ext: "exe" }), "annonce-2026-10-22-vertical.mp4", "jamais un nom ou une extension venus d'ailleurs");
  assert.equal(P.fileName({ startMs: NaN, tz: TZ, format: "vertical", lang: "fr", ext: "mp4", nowMs: at("2026-10-20T10:00:00Z") }), "annonce-2026-10-20-vertical.mp4");
});

/* ───────────── Lignes, pastilles, couleurs ───────────── */

const measure = (s) => [...s].length * 10;

test("découpage en lignes : retours voulus respectés, mots jamais coupés si possible, mot géant coupé, « … » au-delà du plafond, tout tient dans la largeur", () => {
  assert.deepEqual(P.wrapText(measure, "un deux trois quatre cinq", 100, 5), ["un deux", "trois", "quatre", "cinq"]);
  assert.deepEqual(P.wrapText(measure, "a\nb\n\nc", 100, 5), ["a", "b", "", "c"]);
  assert.deepEqual(P.wrapText(measure, "x".repeat(25), 100, 5), ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"], "un mot plus large qu'une ligne est coupé");
  const long = P.wrapText(measure, "mot ".repeat(40), 100, 3);
  assert.equal(long.length, 3); assert.ok(long[2].endsWith("…")); assert.ok(long.every((l) => measure(l) <= 100));
  assert.deepEqual(P.wrapText(measure, "", 100), []); assert.deepEqual(P.wrapText(measure, "   ", 100), []);
  for (const t of ["Un titre vraiment très long qui doit passer à la ligne proprement", "😀".repeat(30), "a".repeat(80), "mot\n\n\n\nmot"]) for (const l of P.wrapText(measure, t, 120, 4)) assert.ok(measure(l) <= 120, `${t.slice(0, 10)} → « ${l} »`);
  assert.equal(P.ellipsize(measure, "court", 100), "court"); assert.equal(P.ellipsize(measure, "x".repeat(30), 100), "xxxxxxxxx…");
  assert.ok(Math.abs(P.solveScale((u) => 1000 * u, 500) - 0.5) < 0.001); assert.equal(P.solveScale((u) => 100 * u, 500), 1); assert.equal(P.solveScale((u) => 1e9 * u, 5, 1, 0.3), 0.3);
});

test("co-streamers : de 0 à 6 pastilles dans la zone, sans se toucher, jamais plus de 6 ; initiales de secours", () => {
  const box = { x: 64, y: 1100, w: 952, h: 400 };
  assert.deepEqual(P.layoutCostreamers(0, box), []);
  for (let n = 1; n <= 8; n++) {
    const cells = P.layoutCostreamers(n, box);
    assert.equal(cells.length, Math.min(n, 6));
    for (const c of cells) {
      assert.ok(c.d >= 36 && c.d <= 190, `diamètre ${c.d}`);
      assert.ok(c.cx - c.d / 2 >= box.x - 0.01 && c.cx + c.d / 2 <= box.x + box.w + 0.01, `${n} : dans la largeur`);
      assert.ok(c.cy - c.d / 2 >= box.y - 0.01 && c.labelY <= box.y + box.h + 0.01, `${n} : dans la hauteur`);
      assert.ok(c.labelW >= c.d && c.labelW <= box.w);
    }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(Math.hypot(cells[i].cx - cells[j].cx, cells[i].cy - cells[j].cy) >= (cells[i].d + cells[j].d) / 2, `${n} : ${i} et ${j} ne se touchent pas`);
  }
  const tiny = P.layoutCostreamers(6, { x: 64, y: 900, w: 952, h: 190 });
  assert.ok(tiny.every((c) => c.d >= 36 && c.cy + c.d / 2 <= 1090 + 60), "une zone basse : les pastilles rétrécissent mais restent lisibles");
  assert.equal(P.initials("Alice Martin"), "AM"); assert.equal(P.initials("zoe_live"), "ZL"); assert.equal(P.initials(""), "?"); assert.equal(P.initials("émile"), "É");
});

test("couleurs : lisibilité garantie (texte blanc ou noir selon le fond, couleur trop pâle assombrie), mouvements bornés, hasard reproductible", () => {
  assert.equal(P.readableOn("#ffffff"), "#111111"); assert.equal(P.readableOn("#101018"), "#ffffff");
  for (const [c, bg] of [["#ffee88", "#ffffff"], ["#222222", "#101010"], ["#7c5cff", "#101010"], ["nimporte quoi", "#ffffff"]]) assert.ok(P.contrast(P.ensureContrast(c, bg, 4.5), bg) >= 4.5, `${c} sur ${bg}`);
  assert.equal(P.toHex(P.parseHex("#abc")), "#aabbcc"); assert.equal(P.parseHex("zzz"), null);
  assert.equal(P.mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(P.rgba("#ff0000", 2), "rgba(255,0,0,1)");
  for (const f of [P.easeOutCubic, P.easeInOutCubic, P.easeOutBack]) { assert.ok(Math.abs(f(0)) < 1e-9); assert.ok(Math.abs(f(1) - 1) < 1e-9); }
  assert.equal(P.progress(5, 2, 2), 1); assert.equal(P.progress(1, 2, 2), 0); assert.equal(P.progress(3, 2, 2), 0.5);
  const a = P.seeded(7), b = P.seeded(7); assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(P.seeded(7)(), P.seeded(8)());
});

/* ───────────── Le même fichier dans un vm vierge ───────────── */

test("vm vierge : pure.mjs s'exécute tel quel, sans Node ni navigateur (seulement Intl), et donne les mêmes résultats", () => {
  const code = fs.readFileSync(`${DIR}/pure.mjs`, "utf8").replace(/^export /gm, "");
  assert.ok(!/^\s*import\s/m.test(code), "aucun import : le fichier est autonome");
  const run = (expr) => vm.runInContext(`${code}\n;(${expr})`, vm.createContext({ Intl, Date, Math, Number, String, Array, Object, Set, Map, JSON, RegExp, parseInt, isFinite }));
  assert.equal(run(`countdownText({ startMs: ${at("2026-10-22T17:30:00Z")}, nowMs: ${at("2026-10-22T09:00:00Z")}, tz: "Europe/Brussels", lang: "fr" })`), "Ce soir à 19 h 30");
  assert.equal(run(`normalizeLogin("@Emma_Live").login`), "emma_live");
  assert.equal(JSON.stringify(run(`wrapText((s) => s.length * 10, "un deux trois", 70, 3)`)), JSON.stringify(P.wrapText((s) => s.length * 10, "un deux trois", 70, 3)));
  assert.equal(JSON.stringify(run(`cleanConfig({ duration: 99, style: "poster" })`)), JSON.stringify(P.cleanConfig({ duration: 99, style: "poster" })));
  assert.equal(run(`FORMATS.length`), 2);
});

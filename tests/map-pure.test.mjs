// Carte : les calculs, essayés SANS navigateur : lecture d'un lien de carte ou de coordonnées, fichiers CSV, projection Web Mercator, distance (haversine),
// regroupement en grappes, cadrage, tuiles ; et les contraintes du script de page (3 fichiers au plus, 32 Ko chacun, aucune adresse extérieure autre que les tuiles).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { DIR, geo, text } from "./helpers/mapKit.mjs";

const load = (file) => {
  const src = fs.readFileSync(`${DIR}/scripts/${file}`, "utf8");
  const sandbox = { module: { exports: {} }, Math, Intl, Date, Object, Array, Number, String, JSON, isFinite };
  vm.runInNewContext(src, sandbox, { filename: file });
  return sandbox.module.exports;
};
const M = load("map-engine.js");
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} ≠ ${b} (±${eps})`);
const plain = (v) => JSON.parse(JSON.stringify(v)); // les objets du bac à sable n'ont pas les prototypes de ce processus

test("position : deux nombres, avec virgule ou point, lettres de direction, degrés-minutes-secondes", () => {
  for (const [input, lat, lng] of [
    ["12.3456, 34.5678", 12.3456, 34.5678], ["12,3456 34,5678", 12.3456, 34.5678], ["12.3456;34.5678", 12.3456, 34.5678], ["(12.3456, -34.5678)", 12.3456, -34.5678],
    ["12.3456 N, 34.5678 E", 12.3456, 34.5678], ["12.3456 S 34.5678 W", -12.3456, -34.5678], ["N 12.3456 E 34.5678", 12.3456, 34.5678],
    ["-12.5,-34.5", -12.5, -34.5], ["50°51'01.1\"N 4°21'06.1\"E", 50.850306, 4.351694], ["33°52'00\"S 151°12'00\"E", -33.866667, 151.2],
  ]) {
    const r = geo.readPosition(input);
    assert.equal(r.ok, true, input);
    near(r.lat, lat, 1e-5, input); near(r.lng, lng, 1e-5, input);
  }
});

test("position : liens Google Maps, OpenStreetMap, Apple Plans, Waze, Bing, geo:", () => {
  const cases = [
    ["https://www.google.com/maps/place/Studio/@12.30,34.50,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d12.3456!4d34.5678", 12.3456, 34.5678, "pin"],
    ["https://www.google.com/maps/@12.3456,34.5678,15z", 12.3456, 34.5678, "view"],
    ["https://maps.google.com/?q=12.3456,34.5678", 12.3456, 34.5678],
    ["https://www.google.com/maps/search/12.3456,+34.5678", 12.3456, 34.5678],
    ["https://www.google.com/maps/search/?api=1&query=12.3456%2C34.5678", 12.3456, 34.5678],
    ["https://www.openstreetmap.org/#map=17/12.3456/34.5678", 12.3456, 34.5678, "view"],
    ["https://www.openstreetmap.org/?mlat=12.34&mlon=34.56#map=16/12.99/34.99", 12.34, 34.56, "pin"],
    ["https://osm.org/go/abc?lat=12.5&lon=34.5", 12.5, 34.5],
    ["https://maps.apple.com/?ll=12.3456,34.5678&q=Studio", 12.3456, 34.5678],
    ["https://maps.apple.com/?address=Rue&coordinate=12.3456,34.5678", 12.3456, 34.5678],
    ["https://waze.com/ul?ll=12.3456%2C34.5678&navigate=yes", 12.3456, 34.5678],
    ["https://www.bing.com/maps?cp=12.3456~34.5678&lvl=15", 12.3456, 34.5678],
    ["geo:12.3456,34.5678?z=15", 12.3456, 34.5678],
    ["Voici le lieu : https://www.google.com/maps/@12.3456,34.5678,15z merci", 12.3456, 34.5678],
    ["www.google.com/maps/@12.3456,34.5678,15z", 12.3456, 34.5678],
  ];
  for (const [input, lat, lng, from] of cases) {
    const r = geo.readPosition(input);
    assert.equal(r.ok, true, input);
    near(r.lat, lat, 1e-6, input); near(r.lng, lng, 1e-6, input);
    if (from) assert.equal(r.from, from, input);
  }
});

test("position : le repère posé l'emporte sur le centre de la vue ; liens raccourcis, textes sans position et nombres impossibles sont refusés avec une raison", () => {
  const r = geo.readPosition("https://www.google.com/maps/place/X/@1.0,2.0,17z/data=!3d12.5!4d34.5");
  near(r.lat, 12.5, 1e-9); near(r.lng, 34.5, 1e-9);
  assert.deepEqual(geo.readPosition("https://maps.app.goo.gl/AbCdEf"), { ok: false, reason: "short" });
  assert.deepEqual(geo.readPosition("https://goo.gl/maps/xyz"), { ok: false, reason: "short" });
  assert.deepEqual(geo.readPosition(""), { ok: false, reason: "empty" });
  assert.deepEqual(geo.readPosition("   "), { ok: false, reason: "empty" });
  assert.equal(geo.readPosition("une rue au hasard").reason, "none");
  assert.equal(geo.readPosition("https://example.org/page").reason, "none");
  assert.equal(geo.readPosition("190, 20").reason, "range");
  assert.equal(geo.readPosition("javascript:alert(1)").ok, false);
  assert.equal(geo.readPosition("0, 0").ok, false, "le point (0, 0) est presque toujours une erreur");
  assert.equal(geo.readPosition("x".repeat(100_000)).ok, false, "un texte énorme est borné");
});

test("position d'un formulaire : le lien collé gagne ; sinon latitude et longitude, avec une erreur au bon champ", () => {
  assert.deepEqual(geo.positionFromForm({ link: "12.5, 34.5", lat: "1", lng: "2" }), { ok: true, lat: 12.5, lng: 34.5, fromLink: true });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "12,5", lng: " 34.5 " }), { ok: true, lat: 12.5, lng: 34.5 });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "", lng: "" }), { ok: false, field: "mapLink", reason: "missing" });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "abc", lng: "4" }), { ok: false, field: "lat", reason: "number" });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "12", lng: "xyz" }), { ok: false, field: "lng", reason: "number" });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "91", lng: "4" }), { ok: false, field: "lat", reason: "range" });
  assert.deepEqual(geo.positionFromForm({ link: "", lat: "10", lng: "181" }), { ok: false, field: "lng", reason: "range" });
  assert.equal(geo.positionFromForm({ link: "", lat: "0", lng: "0" }).reason, "zero");
  assert.equal(geo.positionFromForm({ link: "https://maps.app.goo.gl/x", lat: "", lng: "" }).reason, "short");
});

test("CSV : virgule, point-virgule, tabulation, guillemets doublés, retour à la ligne dans une cellule, BOM, lignes vides", () => {
  assert.deepEqual(text.parseCsv('a,b\n1,2\n').rows, [["a", "b"], ["1", "2"]]);
  assert.equal(text.parseCsv("a;b\n1;2").delimiter, ";");
  assert.equal(text.parseCsv("a\tb\n1\t2").delimiter, "\t");
  assert.deepEqual(text.parseCsv('﻿nom,desc\r\n"Dupont, Jean","il dit ""oui""\nsur deux lignes"\r\n\r\n').rows, [["nom", "desc"], ["Dupont, Jean", 'il dit "oui"\nsur deux lignes']]);
  assert.deepEqual(text.parseCsv("a,b\n,\n1,2").rows, [["a", "b"], ["", ""], ["1", "2"]]);
  assert.equal(text.parseCsv("a,b\n".repeat(50_000), { maxRows: 100 }).rows.length, 100, "borné");
  assert.equal(text.parseCsv(Array.from({ length: 100 }, (_, i) => i).join(",") + "\n1").rows[0].length, 40, "cellules par ligne bornées");
});

test("cellule CSV : guillemets doublés, formule neutralisée", () => {
  assert.equal(text.cell('dit "oui"'), '"dit ""oui"""');
  for (const f of ["=SOMME(A1)", "+1", "-1", "@x"]) assert.equal(text.cell(f), `"'${f}"`);
});

test("projection Web Mercator : valeurs connues, aller-retour, bornes du monde", () => {
  assert.deepEqual(plain(M.project(0, 0, 0)), { x: 128, y: 128 });
  near(M.project(0, 180, 0).x, 256, 1e-9); near(M.project(0, -180, 0).x, 0, 1e-9);
  near(M.project(M.MAXLAT, 0, 0).y, 0, 1e-6); near(M.project(-M.MAXLAT, 0, 0).y, 256, 1e-6);
  assert.equal(M.worldSize(3), 2048);
  for (const [lat, lng, z] of [[12.3456, 34.5678, 10], [-33.8688, 151.2093, 14], [51.5, -0.12, 18], [-84, 179.9, 5], [0.0001, -0.0001, 19]]) {
    const p = M.project(lat, lng, z), u = M.unproject(p.x, p.y, z);
    near(u.lat, lat, 1e-7, "lat"); near(u.lng, lng, 1e-7, "lng");
  }
  assert.ok(Number.isFinite(M.project(90, 0, 4).y)); assert.ok(Number.isFinite(M.project(-90, 0, 4).y));
  near(M.project(0, 1, 10).x - M.project(0, 0, 10).x, 256 * 1024 / 360, 1e-9);
});

test("distance (haversine) : valeurs connues, symétrie, zéro, antipodes, petite distance", () => {
  near(M.haversine(48.8566, 2.3522, 51.5074, -0.1278), 343.5, 1.5, "Paris–Londres");
  near(M.haversine(40.7128, -74.006, 34.0522, -118.2437), 3936, 10, "New York–Los Angeles");
  near(M.haversine(0, 0, 0, 1), 111.19, 0.05, "un degré à l'équateur");
  assert.equal(M.haversine(12.3, 45.6, 12.3, 45.6), 0);
  near(M.haversine(1, 2, 3, 4), M.haversine(3, 4, 1, 2), 1e-9);
  near(M.haversine(0, 0, 0, 180), Math.PI * 6371.0088, 0.01, "antipodes");
  near(M.haversine(12, 179.9999, 12, -179.9999), 0.0218, 0.001, "de l'autre côté de la ligne de changement de date");
  near(M.haversine(12.3456, 34.5678, 12.3456 + 0.009, 34.5678), 1, 0.01, "environ 1 km par 0,009°");
  near(text.haversineKm(48.8566, 2.3522, 51.5074, -0.1278), M.haversine(48.8566, 2.3522, 51.5074, -0.1278), 1e-9);
});

test("tuiles : adresse, le monde se répète en largeur, pas de tuile hors du monde en hauteur", () => {
  const tpl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  assert.equal(M.tileUrl(tpl, 3, 2, 5), "https://tile.openstreetmap.org/3/2/5.png");
  assert.equal(M.tileUrl(tpl, 3, -1, 5), "https://tile.openstreetmap.org/3/7/5.png");
  assert.equal(M.tileUrl(tpl, 3, 9, 5), "https://tile.openstreetmap.org/3/1/5.png");
  assert.equal(M.tileUrl(tpl, 3, 2, -1), null);
  assert.equal(M.tileUrl(tpl, 3, 2, 8), null);
});

test("regroupement : tous les points sont comptés une fois, jamais plus de 200 marqueurs, plus le zoom est fort plus il y a de marqueurs", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pts = Array.from({ length: 5000 }, () => [10 + rnd() * 2, 20 + rnd() * 2, `c${seed}`]);
  const counts = [];
  for (const z of [4, 6, 8, 10, 12, 14, 16, 18]) {
    const g = M.cluster(pts, z, { max: 200 });
    assert.ok(g.length <= 200, `zoom ${z} : ${g.length} marqueurs`);
    assert.equal(g.reduce((a, c) => a + c.n, 0), 5000, `zoom ${z} : tous les points`);
    assert.equal(new Set(g.flatMap((c) => c.ids)).size, 5000, "aucun point en double");
    for (const c of g) { assert.equal(c.ids.length, c.n); assert.ok(c.lat >= 10 && c.lat <= 12 && c.lng >= 20 && c.lng <= 22); }
    counts.push(g.length);
  }
  assert.ok(counts[counts.length - 1] >= counts[0], "le regroupement diminue quand on zoome");
  const few = M.cluster([[10, 20], [30, 40], [-20, 100]], 6, {});
  assert.equal(few.length, 3); assert.ok(few.every((c) => c.n === 1));
  const twin = M.cluster([[10, 20], [10, 20]], 18, {});
  assert.equal(twin.length, 1); assert.equal(twin[0].n, 2);
  const p0 = M.project(10, 20, 10);
  const zone = M.cluster([[10, 20], [11, 21]], 10, { bounds: { x0: p0.x - 50, y0: p0.y - 50, x1: p0.x + 50, y1: p0.y + 50 } });
  assert.equal(zone.length, 1); assert.equal(zone[0].ids[0], 0);
  assert.equal(M.cluster([[NaN, 1], [100, 1], [1, 500], [null, null], [], [5, 5]], 5, {}).reduce((a, c) => a + c.n, 0), 1);
  assert.equal(M.cluster([], 5, {}).length, 0);
});

test("regroupement stable : une grille fixée au monde, le même point reste dans la même case quand la vue bouge", () => {
  const pts = [[12.3456, 34.5678], [12.3457, 34.5679], [12.4, 34.6]];
  const a = M.cluster(pts, 12, {}), b = M.cluster(pts, 12, { bounds: { x0: 0, y0: 0, x1: 1e9, y1: 1e9 } });
  assert.deepEqual(plain(a.map((c) => c.ids)), plain(b.map((c) => c.ids)));
});

test("cadrage : un point → zoom 15 ; plusieurs → tout est visible ; aucun → le monde", () => {
  assert.deepEqual(plain(M.fit([[12.5, 34.5]], 800, 600, {})), { lat: 12.5, lng: 34.5, zoom: 15 });
  const pts = [[10, 20], [12, 24], [11, 22]];
  const f = M.fit(pts, 800, 600, { pad: 40 });
  for (const p of pts) {
    const c = M.project(f.lat, f.lng, f.zoom), q = M.project(p[0], p[1], f.zoom);
    assert.ok(Math.abs(q.x - c.x) <= 400 - 40 + 1 && Math.abs(q.y - c.y) <= 300 - 40 + 1, "le point est dans la vue");
  }
  assert.equal(M.fit(pts, 800, 600, { pad: 40, maxZoom: f.zoom + 1 }).zoom, f.zoom, "c'est bien le plus fort zoom possible");
  assert.equal(M.fit([], 800, 600, {}).zoom, 1);
  assert.equal(M.fit([[0, 0], [60, 170]], 100, 100, { minZoom: 2 }).zoom, 2, "jamais sous le zoom minimal");
});

test("près de moi : dans le rayon, du plus proche au plus lointain, ordre stable à distance égale", () => {
  const pts = [[12.31, 34.5], [12.3, 34.5], [12.5, 34.5], [12.3, 34.51], [20, 40]];
  const r = M.within(pts, 12.3, 34.5, 30);
  assert.deepEqual([...r.map((x) => x.i)], [1, 3, 0, 2]);
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].d <= x.d));
  assert.equal(M.within(pts, 12.3, 34.5, 5).length, 3);
  assert.equal(M.within(pts, 12.3, 34.5, 0.1).length, 1);
  assert.equal(M.within(pts, 12.3, 34.5).length, 5, "sans rayon : tous, triés");
  assert.equal(M.within([], 1, 1, 10).length, 0);
});

test("distance affichée : mètres, kilomètres avec une décimale, kilomètres entiers, selon la langue", () => {
  assert.equal(M.formatDistance(0.85, "fr"), "850 m");
  assert.equal(M.formatDistance(0.004, "fr"), "10 m");
  assert.equal(M.formatDistance(3.24, "fr"), "3,2 km");
  assert.equal(M.formatDistance(3.24, "en"), "3.2 km");
  assert.equal(M.formatDistance(42.4, "fr"), "42 km");
  assert.match(M.formatDistance(1234.5, "en"), /^1,235 km$/);
});

test("scripts : 2 fichiers (3 au plus), moins de 32 Ko chacun (le moteur sous 25 Ko), noms valides, pas de lien symbolique", () => {
  const dir = `${DIR}/scripts`;
  const files = fs.readdirSync(dir);
  assert.deepEqual(files.sort(), ["map-engine.js", "map-page.js"]);
  for (const f of files) {
    const st = fs.lstatSync(`${dir}/${f}`);
    assert.ok(st.isFile() && !st.isSymbolicLink(), f);
    assert.ok(st.size <= 32 * 1024, `${f} : ${st.size} octets`);
    assert.match(f, /^[a-z0-9][a-z0-9._-]{0,62}\.js$/);
  }
  assert.ok(fs.statSync(`${dir}/map-engine.js`).size <= 25 * 1024, "le moteur tient sous 25 Ko");
});

test("scripts : aucune adresse extérieure à part le lien de l'attribution, pas d'eval, pas de stockage de position, aucun réglage de Referer sur les tuiles", () => {
  for (const f of ["map-engine.js", "map-page.js"]) {
    const src = fs.readFileSync(`${DIR}/scripts/${f}`, "utf8");
    for (const u of [...src.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0])) assert.match(u, /^https:\/\/www\.openstreetmap\.org\/copyright$/, `${f} : adresse inattendue ${u}`);
    assert.ok(!/\beval\s*\(|new Function|document\.write|importScripts|XMLHttpRequest|sendBeacon|WebSocket/.test(src), f);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), `${f} : rien n'est gardé dans le navigateur (la position non plus)`);
    assert.ok(!/referrerPolicy|referrerpolicy|no-referrer/i.test(src), `${f} : le Referer par défaut doit rester (règle d'usage d'OpenStreetMap)`);
  }
  const engine = fs.readFileSync(`${DIR}/scripts/map-engine.js`, "utf8");
  assert.match(engine, /openstreetmap\.org\/copyright/);
  assert.match(engine, /cm-attr/);
});

test("scripts : la position ne part jamais vers le serveur", () => {
  const src = fs.readFileSync(`${DIR}/scripts/map-page.js`, "utf8");
  const calls = [...src.matchAll(/getJson\(([^;]*?)\)\s*[.;]/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, "points, fiche, liste");
  for (const c of calls) assert.ok(!/origin|coords|latitude|longitude|pos\./.test(c), `appel réseau suspect : ${c}`);
  assert.equal([...src.matchAll(/\bfetch\(/g)].length, 1, "un seul endroit fait des requêtes");
  assert.ok(!/method:\s*["']POST/i.test(src));
  assert.match(src, /getCurrentPosition/);
});

// Événements : le petit script de la page (scripts/events.js) — l'heure chez le visiteur en toutes lettres, la vidéo après un clic. Exécuté dans de vrais fuseaux.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { DIR, manifest, ctxFor, addEvent, html } from "./helpers/eventsKit.mjs";

const run = (tz, input) => {
  const r = spawnSync(process.execPath, [new URL("./helpers/eventsClientRun.mjs", import.meta.url).pathname], { input: JSON.stringify(input), env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const CFG_FR = { lang: "fr", today: "aujourd'hui", tomorrow: "demain", at: "à", local: "{when} chez vous", slot: "{time} chez vous", video: "Vidéo YouTube" };
const CFG_EN = { lang: "en", today: "today", tomorrow: "tomorrow", at: "at", local: "{when} where you live", slot: "{time} where you live", video: "YouTube video" };
const START = Date.UTC(2031, 10, 14, 20);
const local = { id: "l", attrs: { "data-ev-local": "", "data-start": String(START), "data-tz": "Europe/Paris" }, hidden: true };

test("le script est un vrai fichier du dossier scripts/ (32 Ko au plus), sans eval, sans requête, sans minuteur", () => {
  const code = fs.readFileSync(`${DIR}/scripts/events.js`, "utf8");
  assert.ok(Buffer.byteLength(code) <= 32 * 1024);
  assert.ok(!/\beval\s*\(|new Function|fetch\s*\(|XMLHttpRequest|setInterval|setTimeout|localStorage|document\.cookie/.test(code));
  assert.ok(!/formation|masterclass|association/i.test(code));
  assert.equal(manifest.minCore, "0.2.6");
});

test("visiteur dans un autre fuseau : phrase en toutes lettres en français et en anglais", () => {
  const fr = run("America/New_York", { cfg: CFG_FR, elements: [local] });
  assert.equal(fr.viewerTz, "America/New_York");
  assert.deepEqual([fr.elements[0].hidden, fr.elements[0].text], [false, "Vendredi 14 novembre à 15 h chez vous"]);
  assert.equal(run("America/New_York", { cfg: CFG_EN, elements: [local] }).elements[0].text, "Friday, November 14 at 3 pm where you live");
  assert.equal(run("Asia/Tokyo", { cfg: CFG_FR, elements: [local] }).elements[0].text, "Samedi 15 novembre à 5 h chez vous");
  assert.equal(run("Asia/Kolkata", { cfg: CFG_FR, elements: [local] }).elements[0].text, "Samedi 15 novembre à 1 h 30 chez vous");
});

test("visiteur à la même heure que l'événement : rien n'est affiché de plus", () => {
  for (const tz of ["Europe/Paris", "Europe/Berlin", "Europe/Brussels"]) {
    const r = run(tz, { cfg: CFG_FR, elements: [local] });
    assert.deepEqual([r.elements[0].hidden, r.elements[0].text], [true, ""], tz);
  }
});

test("créneaux du programme : l'heure chez le visiteur seulement quand elle diffère", () => {
  const slot = (id, utc) => ({ id, attrs: { "data-ev-slot": String(utc), "data-tz": "Europe/Paris" }, hidden: true });
  const r = run("America/Los_Angeles", { cfg: CFG_FR, elements: [slot("s1", Date.UTC(2031, 10, 14, 20)), slot("s2", Date.UTC(2031, 10, 14, 21, 30))] });
  assert.deepEqual(r.elements.map((e) => [e.hidden, e.text]), [[false, "midi chez vous"], [false, "13 h 30 chez vous"]]);
  assert.equal(run("Europe/Paris", { cfg: CFG_FR, elements: [slot("s1", START)] }).elements[0].hidden, true);
});

test("heure d'été : l'heure de l'événement et celle du visiteur suivent chacune leurs propres règles", () => {
  const ny = { id: "n", attrs: { "data-ev-local": "", "data-start": String(Date.UTC(2031, 6, 5, 0)), "data-tz": "America/New_York" }, hidden: true };
  assert.equal(run("Europe/Paris", { cfg: CFG_FR, elements: [ny] }).elements[0].text, "Samedi 5 juillet à 2 h chez vous");
});

test("vidéo : un clic charge le lecteur YouTube (sans cookie) ; avant le clic, rien", () => {
  const box = { id: "v", attrs: { "data-ev-yt": "dQw4w9WgXcQ" }, link: true };
  assert.equal(run("UTC", { cfg: CFG_FR, elements: [box] }).elements[0].child, null);
  const after = run("UTC", { cfg: CFG_FR, elements: [box], click: "v" });
  assert.equal(after.elements[0].clicked, true);
  assert.equal(after.elements[0].child.tag, "iframe");
  const bad = run("UTC", { cfg: CFG_FR, elements: [{ id: "v", attrs: { "data-ev-yt": "../../evil" }, link: true }], click: "v" });
  assert.equal(bad.elements[0].clicked, false);
  assert.equal(bad.elements[0].child, null);
});

test("page : la ligne « chez vous » est cachée sans le script, et les phrases viennent de la page dans la langue du visiteur", async () => {
  const ctx = ctxFor({}, { locale: "en" });
  await addEvent(ctx, { slug: "e", title: "Evening", date: "2031-11-14", time: "21:00" });
  const h = await html(ctx, ["e", "e"]);
  const cfg = JSON.parse(/data-ev-cfg="([^"]*)"/.exec(h)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  assert.deepEqual([cfg.lang, cfg.today, cfg.local, cfg.at], ["en", "today", "{when} where you live", "at"]);
  assert.match(h, /data-ev-local[^>]*hidden/);
});

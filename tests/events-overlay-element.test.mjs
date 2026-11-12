// Événements 1.3.0 : l'ÉLÉMENT « Prochain événement » des pages d'overlay (cœur 0.5.0, docs/OVERLAY-ELEMENTS.md).
// Au repos (rien à venir) RIEN n'est dessiné ; avec des données : titre, jour et heure dans la langue, délai, lieu si l'option le permet ; vie privée : jamais un brouillon,
// un événement annulé ou reporté, un lien d'inscription, un intervenant ni des coordonnées.
import test from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "@/core/modules/manifest";
import { parseAddress, finalAddress } from "@/core/overlays/address";
import { def, ctxFor, addEvent, manifest, messages } from "./helpers/eventsKit.mjs";

const EL = await import("../modules/events/element.mjs");
const NOW = Date.UTC(2031, 2, 10, 10, 0, 0);   // 10 mars 2031, 11 h à Paris
const q = (o = {}) => new URLSearchParams(Object.entries({ "ov-fit": "fluid", "ov-w": "900", "ov-h": "300", "ov-text": "light", "ov-surface": "transparent", "ov-corners": "round", ...o }));
const STYLE = { text: "light", background: "transparent", corners: "round" };
const route = (ctx, name, query = q(), method = "GET") => def.routes[name](new Request(`https://example.org/m/x/${name}?${query}`, { method, headers: { "x-forwarded-for": "203.0.113.9" } }), ctx);

test("manifeste : valide, 1.3.0, un élément fluide « next » qui suit le style, avec exemple ; options minimales et textes FR/EN", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(manifest.overlayElements.map((e) => [e.id, e.fit, e.followsStyle, e.demo]), [["next", "fluid", true, true]]);
  assert.deepEqual(Object.keys(def.overlayElements), ["next"]);
  const e = manifest.overlayElements[0];
  assert.ok(e.label.fr && e.label.en && e.description.fr && e.description.en);
  assert.ok(e.options.length <= 5 && e.options.every((o) => o.type === "boolean" && o.default === true && o.label.fr && o.label.en && o.label.fr.length <= 60 && !/[:]$/.test(o.label.fr)));
  assert.ok(e.ratios.min <= 400 / 600 && e.ratios.max >= 1600 / 400);
  const fr = messages("fr"), en = messages("en");
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of ["ovTitle", "ovNow", "ovToday", "ovTomorrow", "ovInDays", "ovDemoTitle", "ovDemoPlace"]) assert.ok(fr[k] && en[k], k);
  assert.ok(!/!/.test(JSON.stringify([e.description, e.options.map((o) => o.label)])));
});

test("adresse : un chemin du site accepté par le cœur, la langue suit, aucun secret ; les options passent dans l'adresse finale", async () => {
  const ctx = ctxFor();
  const a = await def.overlayElements.next(ctx, { lang: "en" });
  assert.equal(a.url, "/m/" + ctx.instance.key + "/element?lang=en");
  assert.ok(parseAddress(a));
  assert.equal((await def.overlayElements.next(ctx, {})).url, `/m/${ctx.instance.key}/element`);
  const f = new URL(`https://x.test${finalAddress(parseAddress(a), { decl: manifest.overlayElements[0], layout: { iframeW: 900, iframeH: 300 }, style: STYLE, options: { title: true, delay: false, place: true }, lang: "en" })}`).searchParams;
  assert.deepEqual([f.get("opt-delay"), f.get("opt-place"), f.get("ov-fit")], ["0", "1", "fluid"]);
});

test("au repos : rien à venir (agenda vide, événements passés, brouillons, annulés, reportés) → aucun événement, la page ne dessine rien", async () => {
  const ctx = ctxFor();
  assert.deepEqual(await EL.dataFor(ctx, q(), NOW), { state: "ok", event: null });
  await addEvent(ctx, { title: "Passé", date: "2020-01-01" });
  await addEvent(ctx, { title: "Brouillon", date: "2031-04-01", status: "draft" });
  await addEvent(ctx, { title: "Annulé", date: "2031-04-02", state: "cancelled" });
  await addEvent(ctx, { title: "Reporté", date: "2031-04-03", state: "postponed" });
  assert.equal((await EL.dataFor(ctx, q(), NOW)).event, null);
  const h = await (await route(ctx, "element")).text();
  assert.match(h, /id="ev"[^>]*\shidden>/, "le cadre est caché au départ");
  assert.match(h, /if \(!d \|\| d\.state !== "ok" \|\| !d\.event\) return;/, "le script ne dessine rien sans événement");
  assert.ok(!/Passé|Brouillon|Annulé|Reporté/.test(h));
});

test("avec des données : le prochain événement publié, jour et heure dans la langue, délai et lieu", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Plus tard", date: "2031-06-01", place: "Ailleurs" });
  await addEvent(ctx, { title: "Atelier des étoiles", date: "2031-03-13", time: "20:30", place: "Salle des étoiles" });
  const d = await EL.dataFor(ctx, q(), NOW);
  assert.equal(d.event.title, "Atelier des étoiles");
  assert.match(d.event.when, /jeu\./i); assert.match(d.event.when, /13/); assert.match(d.event.when, /20/);
  assert.equal(d.event.delay, "Dans 3 jours"); assert.equal(d.event.place, "Salle des étoiles");
  const en = ctxFor({}, { locale: "en" });
  await addEvent(en, { title: "Star workshop", date: "2031-03-11", time: "18:00" });
  const e = await EL.dataFor(en, q(), NOW);
  assert.equal(e.event.delay, "Tomorrow"); assert.match(e.event.when, /Tue|Mar/);
  assert.equal(e.event.place, undefined, "pas de lieu quand l'événement n'en a pas");
  const day = ctxFor(); await addEvent(day, { title: "Ce soir", date: "2031-03-10", time: "20:00" });
  assert.equal((await EL.dataFor(day, q(), NOW)).event.delay, "Aujourd'hui");
  const now = ctxFor(); await addEvent(now, { title: "En ce moment", date: "2031-03-10", time: "10:00" });
  assert.equal((await EL.dataFor(now, q(), NOW)).event.delay, "En cours");
});

test("options : délai et lieu masqués à la demande ; une valeur inconnue prend le défaut", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Atelier", date: "2031-03-13", time: "20:30", place: "Salle des étoiles" });
  const d = (await EL.dataFor(ctx, q({ "opt-delay": "0", "opt-place": "0" }), NOW)).event;
  assert.deepEqual(Object.keys(d).sort(), ["title", "when"]);
  const odd = (await EL.dataFor(ctx, q({ "opt-delay": "peut-être", "opt-inconnue": "1" }), NOW)).event;
  assert.ok(odd.delay && odd.place);
  assert.deepEqual(EL.readOptions(q({ "opt-title": "0" })), { title: false, place: true, delay: true });
});

test("vie privée : seuls titre, jour/heure, délai et lieu sortent (ni lien d'inscription, ni intervenant, ni coordonnées, ni texte, ni identifiant)", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Atelier", date: "2031-03-13", time: "20:30", place: "Salle", lat: 48.85, lng: 2.35, text: "Texte secret du programme", signupUrl: "https://inscription.example/secret", speakers: [{ name: "Camille", role: "x", link: "" }], seatsLeft: 3, image: "/media/x.webp" });
  const json = JSON.stringify(await EL.dataFor(ctx, q(), NOW));
  for (const bad of ["secret", "inscription.example", "Camille", "48.85", "2.35", "media", "seats"]) assert.ok(!json.includes(bad), bad);
  const page = await (await route(ctx, "element")).text();
  assert.ok(!page.includes("inscription.example") && !page.includes("Texte secret"));
});

test("mode test : un événement d'exemple (noms inventés) sans rien lire ; même sans agenda", async () => {
  const ctx = ctxFor();
  const d = await EL.dataFor(ctx, q({ "ov-demo": "1" }), NOW);
  assert.equal(d.event.title, "Atelier découverte"); assert.equal(d.event.delay, "Dans 3 jours"); assert.equal(d.event.place, "Salle des étoiles");
  assert.equal(ctx.dumpStore().length, 0, "rien n'est écrit");
  const h = await (await route(ctx, "element", q({ "ov-demo": "1" }))).text();
  assert.match(h, /"demo":true/);
});

test("page : suit le style par les jetons --ov-* (avec repli), attributs data-ov-part, aucun skin du site ni chargement tiers, politique de sécurité propre, texte écrit par textContent", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: '<img src=x onerror=alert(1)>', date: "2031-03-13", time: "20:30" });
  const res = await route(ctx, "element", q({ "ov-text": "dark", "ov-surface": "soft", "ov-corners": "square" }));
  const h = await res.text();
  assert.match(h, /:root\{--ov-fg:#111111;--ov-surface:rgba\(255,255,255,\.7\);--ov-radius:0px/);
  assert.match(h, /var\(--ov-fg,#fff\)/); assert.match(h, /data-ov-region="element"/);
  for (const part of ["panel", "title", "name", "text", "badge"]) assert.ok(h.includes(`data-ov-part="${part}"`), part);
  assert.ok(!/--sk-|data-skin-|https?:\/\//.test(h.replace(/<\/?[^>]*>/g, (t) => t)), "ni skin du site ni adresse tierce");
  assert.ok(!h.includes("<img src=x onerror"), "le titre est dans des données JSON échappées, pas dans le HTML");
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'.*connect-src 'self'/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const noStyle = await (await route(ctx, "element", new URLSearchParams())).text();
  assert.ok(!noStyle.includes("--ov-fg:#"), "sans style reçu : les replis de la feuille s'appliquent");
});

test("routes : GET seulement ; plusieurs lecteurs lisent la même chose sans rien retenir ; les données sont du JSON sans cache", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Atelier", date: "2031-03-13", time: "20:30" });
  assert.equal((await route(ctx, "element", q(), "POST")).status, 405);
  assert.equal((await route(ctx, "element-data", q(), "POST")).status, 405);
  const reads = await Promise.all(Array.from({ length: 5 }, async () => (await route(ctx, "element-data")).json()));
  assert.equal(new Set(reads.map((r) => JSON.stringify(r.event))).size, 1);
  const r = await route(ctx, "element-data");
  assert.match(r.headers.get("content-type"), /json/); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(ctx.dumpStore().filter((x) => !x.collection.startsWith("ev_")).length, 0, "aucune mémoire par lecteur");
});

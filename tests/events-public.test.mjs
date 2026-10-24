// Événements : la page publique (liste, filtres, recherche, pages, calendrier, rétrospective, fiche), les routes, la sécurité de ce qui s'affiche.
import test from "node:test";
import assert from "node:assert/strict";
import { def, ctxFor, addEvent, addType, page, html, get, D, ICS } from "./helpers/eventsKit.mjs";

const XSS = '<img src=x onerror=alert(1)>"\'<script>alert(1)</script>';
/** Les noms d'attributs de toutes les balises d'un HTML (en respectant les guillemets : un texte échappé dans une valeur n'est pas un attribut). */
const attrNames = (h) => [...h.matchAll(/<([a-z][a-z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/gi)].flatMap((m) => [...m[2].matchAll(/\s+([^\s=>]+)(?:="[^"]*")?/g)].map((a) => a[1]));
const count = (s, re) => (s.match(re) ?? []).length;

test("liste : les prochains, du plus proche au plus lointain ; les brouillons et les événements passés n'y sont pas", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Dans trois ans", date: "2031-09-01" });
  await addEvent(ctx, { title: "Dans deux ans", date: "2031-03-01" });
  await addEvent(ctx, { title: "Brouillon secret", date: "2031-04-01", status: "draft" });
  await addEvent(ctx, { title: "Déjà passé", date: "2020-01-01" });
  const p = await page(ctx);
  assert.equal(p.title, "Agenda");
  const h = p.blocks[0].html;
  assert.ok(h.indexOf("Dans deux ans") > 0 && h.indexOf("Dans deux ans") < h.indexOf("Dans trois ans"));
  assert.ok(!h.includes("Brouillon secret") && !h.includes("Déjà passé"));
  assert.deepEqual(p.scripts, ["events.js"]);
  assert.match(h, /<time class="ev-badge" datetime="2031-03-01">/);
});

test("liste : état vide poli, jamais une page cassée ; le mot du site vient des réglages", async () => {
  const ctx = ctxFor();
  assert.match(await html(ctx), /Rien de prévu pour l(?:'|&#39;)instant/);
  const custom = ctxFor({ wordMany: "Ateliers", wordOne: "Atelier", intro: "Bienvenue **chez nous**." });
  await addEvent(custom, { title: "Le premier" });
  const h = await html(custom);
  assert.match(h, /Chercher parmi les ateliers/);
  assert.match(h, /<strong>chez nous<\/strong>/);
  const en = ctxFor({}, { locale: "en" });
  assert.match(await html(en), /Nothing planned for now/);
  assert.match(await html(en), /Search the events/);
});

test("liste : filtre par type, recherche par mots (accents ignorés), pages de 12", async () => {
  const ctx = ctxFor();
  await addType(ctx, { key: "atelier", names: { fr: "Atelier" }, color: "teal" });
  await addType(ctx, { key: "rencontre", names: { fr: "Rencontre" }, color: "amber", pos: 2 });
  await addEvent(ctx, { title: "Dessin d'été", type: "atelier", date: "2031-06-01", place: "Parc" });
  await addEvent(ctx, { title: "Café-rencontre", type: "rencontre", date: "2031-06-02", text: "Parlons de l'ÉTÉ" });
  const all = await html(ctx);
  assert.equal(count(all, /class="ev-card /g), 2);
  assert.match(all, /<ul class="ev-chips"/);
  const only = await html(ctx, ["t", "atelier"]);
  assert.equal(count(only, /class="ev-card /g), 1);
  assert.match(only, /Dessin d&#39;été/);
  assert.match(only, /aria-current="true"/);
  assert.equal(count(await html(ctx, ["q", "ete"]), /class="ev-card /g), 2);
  assert.equal(count(await html(ctx, ["t", "atelier", "q", "parc"]), /class="ev-card /g), 1);
  assert.match(await html(ctx, ["q", "zzz"]), /Aucun résultat pour ce filtre/);
  for (let i = 0; i < 30; i++) await addEvent(ctx, { title: `Série ${i}`, date: "2032-01-01" });
  assert.equal(count(await html(ctx), /class="ev-card /g), 12);
  const p2 = await html(ctx, ["p", "2"]);
  assert.equal(count(p2, /class="ev-card /g), 12);
  assert.match(p2, /Page 2 sur 3/);
  assert.match(p2, /rel="prev" href="\/agenda"/);
  assert.match(p2, /rel="next" href="\/agenda\/p\/3"/);
  assert.equal((await page(ctx, ["p", "9"])).notFound, true);
});

test("liste : jusqu'à 50 par page au choix de la propriétaire, jamais plus", async () => {
  const ctx = ctxFor({ perPage: 500 });
  for (let i = 0; i < 60; i++) await addEvent(ctx, { title: `E${i}`, date: "2032-01-01" });
  assert.equal(count(await html(ctx), /class="ev-card /g), 50);
});

test("adresses : seules les adresses connues répondent, tout le reste est introuvable (jamais une erreur)", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Un", slug: "un" });
  for (const bad of [["x"], ["t"], ["t", "a b"], ["p", "0"], ["p", "abc"], ["q", ""], ["e"], ["e", "inconnu"], ["e", "UN", "x"], ["cal", "2031-13"], ["cal", "x"], ["past", "p", "1x"], ["t", "a", "t", "b"], ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], ["../etc/passwd"]]) {
    assert.equal((await page(ctx, bad)).notFound, true, JSON.stringify(bad));
  }
  assert.ok(!(await page(ctx, ["cal", "2031-03"])).notFound);
  assert.ok(!(await page(ctx, ["past"])).notFound);
});

test("calendrier : un tableau lisible (légende, jours, liens), les événements au bon jour, plusieurs jours sur chacun", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Marché", date: "2031-03-15", time: "10:00" });
  await addEvent(ctx, { title: "Festival", date: "2031-03-20", time: "", endDate: "2031-03-22" });
  await addEvent(ctx, { title: "Annulé !", date: "2031-03-10", state: "cancelled" });
  await addEvent(ctx, { title: "Caché", date: "2031-03-11", status: "draft" });
  await addEvent(ctx, { title: "Autre mois", date: "2031-04-15" });
  const p = await page(ctx, ["cal", "2031-03"]);
  const h = p.blocks[0].html;
  assert.match(h, /<caption class="ev-sr">Calendrier de Mars 2031<\/caption>/);
  assert.equal(count(h, /<th scope="col">/g), 7);
  assert.match(h, /<abbr title="lundi">lun\.<\/abbr>/);
  assert.equal(count(h, /Festival/g), 3);
  assert.match(h, /10 h Marché/);
  assert.match(h, /Annulé !.*\(Annulé\)/s);
  assert.ok(!h.includes("Caché") && !h.includes("Autre mois"));
  assert.match(h, /rel="prev" href="\/agenda\/cal\/2031-02"/);
  assert.match(h, /rel="next" href="\/agenda\/cal\/2031-04"/);
  assert.match(h, /href="\/agenda\/cal">Revenir à ce mois-ci/);
  assert.equal(h.includes("<script"), false);
  const sunday = ctxFor({ weekStart: "0" });
  assert.match((await html(sunday, ["cal", "2031-03"])), /<abbr title="dimanche">dim\.<\/abbr><\/th><th scope="col"><abbr title="lundi">/);
  assert.match(await html(ctx, ["cal", "2031-05"]), /Rien de prévu ce mois-ci/);
});

test("calendrier : le mois en cours par défaut, filtre par type conservé en changeant de mois", async () => {
  const ctx = ctxFor();
  await addType(ctx);
  const h = await html(ctx, ["cal", "t", "atelier"]);
  assert.match(h, /<table class="ev-cal">/);
  assert.match(h, /href="\/agenda\/cal\/\d{4}-\d{2}\/t\/atelier"/);
});

test("rétrospective : les passés y passent seuls, du plus récent au plus ancien, sans les annulés", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { title: "Vieux", date: "2020-01-10" });
  await addEvent(ctx, { title: "Récent", date: "2020-06-10", albumLink: "https://example.org/photos" });
  await addEvent(ctx, { title: "Annulé passé", date: "2020-07-10", state: "cancelled" });
  await addEvent(ctx, { title: "Futur", date: "2031-01-10" });
  const p = await page(ctx, ["past"]);
  assert.equal(p.title, "Rétrospective");
  const h = p.blocks[0].html;
  assert.ok(h.indexOf("Récent") < h.indexOf("Vieux"));
  assert.ok(!h.includes("Annulé passé") && !h.includes("Futur"));
  assert.match(h, /Photos et souvenirs/);
  assert.equal((await page(ctxFor({ pastTitle: "Souvenirs" }), ["past"])).title, "Souvenirs");
  const off = ctxFor({ showPast: false });
  assert.equal((await page(off, ["past"])).notFound, true);
  assert.ok(!(await html(off)).includes("/agenda/past"));
});

test("fiche : titre, date et heure dans le fuseau du site avec le nom du fuseau, lieu, type, ajout à l'agenda", async () => {
  const ctx = ctxFor();
  await addType(ctx, { key: "atelier", names: { fr: "Atelier" }, color: "teal", icon: "🛠️" });
  await addEvent(ctx, { title: "Soirée jeux", slug: "soiree", date: "2031-11-14", time: "21:00", endTime: "23:30", place: "Maison des jeux", type: "atelier", lat: 50.85, lng: 4.35, text: "Une **belle** soirée.\n\n- un jeu\n- deux jeux" });
  const p = await page(ctx, ["e", "soiree"]);
  assert.equal(p.title, "Soirée jeux");
  const h = p.blocks[0].html;
  assert.match(h, /Vendredi 14 novembre 2031, de 21 h à 23 h 30 \(heure d.Europe centrale\)/);
  assert.match(h, /<time datetime="2031-11-14T21:00:00\+01:00">/);
  assert.match(h, /Maison des jeux/);
  assert.match(h, /openstreetmap\.org\/\?mlat=50\.850000&amp;mlon=4\.350000/);
  assert.match(h, /<strong>belle<\/strong>/);
  assert.match(h, /<li>un jeu<\/li>/);
  assert.match(h, /🛠️/);
  assert.match(h, /href="\/m\/agenda\d+\/ics\?e=soiree" download>Ajouter à mon agenda/);
  assert.match(h, /data-ev-local data-start="\d+" data-tz="Europe\/Paris" hidden/);
  const en = ctxFor({}, { locale: "en", defaultLocale: "fr" });
  await addEvent(en, { title: "Games night", slug: "g", date: "2031-11-14", time: "21:00" });
  assert.match(await html(en, ["e", "g"]), /Friday, November 14, 2031 at 9 pm \(Central European (Standard )?Time\)/);
});

test("fiche : un autre fuseau pour l'événement, une journée entière, plusieurs jours", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "ny", title: "À New York", date: "2031-07-04", time: "20:00", tz: "America/New_York" });
  await addEvent(ctx, { slug: "jour", title: "Journée", date: "2031-07-04", time: "" });
  await addEvent(ctx, { slug: "multi", title: "Festival", date: "2031-07-04", time: "", endDate: "2031-07-06" });
  const ny = await html(ctx, ["e", "ny"]);
  assert.match(ny, /Vendredi 4 juillet 2031 à 20 h \(heure de l.Est nord-américain\)/);
  assert.match(ny, /data-tz="America\/New_York"/);
  const jour = await html(ctx, ["e", "jour"]);
  assert.match(jour, /Vendredi 4 juillet 2031<\/time>/);
  assert.ok(!jour.includes("data-ev-local"));
  assert.match(await html(ctx, ["e", "multi"]), /Du vendredi 4 juillet au dimanche 6 juillet 2031/);
});

test("fiche : programme en créneaux, intervenants avec lien facultatif, heure locale par créneau", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "p", title: "Journée", date: "2031-06-10", time: "09:00", program: [{ time: "09:00", end: "10:00", title: "Accueil", text: "café" }, { time: "10:30", end: "", title: "Atelier" }], speakers: [{ name: "Camille", role: "Illustratrice", link: "/equipe/camille" }, { name: "Léo", role: "", link: "" }] });
  const h = await html(ctx, ["e", "p"]);
  assert.match(h, /<h2 class="ev-h">Programme<\/h2>/);
  assert.match(h, /9 h – 10 h/);
  assert.match(h, /<small>café<\/small>/);
  assert.equal(count(h, /data-ev-slot="\d+" data-tz="Europe\/Paris"/g), 2);
  assert.match(h, /<h2 class="ev-h">Intervenants<\/h2>/);
  assert.match(h, /<a href="\/equipe\/camille">Camille<\/a><span>Illustratrice<\/span>/);
  assert.match(h, /<strong>Léo<\/strong>/);
});

test("fiche : inscription (lien externe), places restantes, complet, annulé, reporté, passé", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "ok", title: "Ouvert", date: "2031-06-10", signupUrl: "https://example.org/inscription", seatsLeft: 4, seatsTotal: 20 });
  const ok = await html(ctx, ["e", "ok"]);
  assert.match(ok, /Il reste 4 places sur 20/);
  assert.match(ok, /<a class="ev-btn ev-btn-main" href="https:\/\/example\.org\/inscription" rel="noopener noreferrer">S&#39;inscrire<\/a>/);
  await addEvent(ctx, { slug: "un", title: "Presque", date: "2031-06-10", seatsLeft: 1 });
  assert.match(await html(ctx, ["e", "un"]), /Il reste 1 place</);
  await addEvent(ctx, { slug: "full", title: "Plein", date: "2031-06-10", signupUrl: "https://example.org/x", seatsLeft: 0 });
  const full = await html(ctx, ["e", "full"]);
  assert.match(full, /Complet/); assert.ok(!full.includes("S&#39;inscrire"));
  await addEvent(ctx, { slug: "full2", title: "Plein 2", date: "2031-06-10", state: "full", signupUrl: "https://example.org/x" });
  assert.match(await html(ctx, ["e", "full2"]), /Complet/);
  await addEvent(ctx, { slug: "off", title: "Annulé", date: "2031-06-10", state: "cancelled", signupUrl: "https://example.org/x" });
  const off = await html(ctx, ["e", "off"]);
  assert.match(off, /ev-banner-danger/); assert.ok(!off.includes("S&#39;inscrire") && !off.includes("Ajouter à mon agenda"));
  assert.match(off, /"eventStatus":"https:\/\/schema\.org\/EventCancelled"/);
  await addEvent(ctx, { slug: "post", title: "Reporté", date: "2031-06-10", state: "postponed" });
  assert.match(await html(ctx, ["e", "post"]), /ev-banner-warn/);
  await addEvent(ctx, { slug: "old", title: "Terminé", date: "2020-06-10", signupUrl: "https://example.org/x" });
  const old = await html(ctx, ["e", "old"]);
  assert.match(old, /Ce rendez-vous a déjà eu lieu/); assert.ok(!old.includes("S&#39;inscrire"));
  const list = await html(ctx);
  assert.match(list, /ev-chip-danger">Annulé/); assert.match(list, /ev-chip-warn">Reporté/); assert.match(list, /Il reste 4 places sur 20/);
});

test("fiche : vidéo YouTube seulement après le clic (lien simple sans script), fichier vidéo du site", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "yt", title: "Avec vidéo", date: "2031-06-10", videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  const h = await html(ctx, ["e", "yt"]);
  assert.match(h, /<div class="ev-video" data-ev-yt="dQw4w9WgXcQ"><a class="ev-btn" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.ok(!/<iframe/i.test(h));
  assert.ok(!/youtube-nocookie/.test(h));
  assert.match(h, /YouTube ne reçoit rien tant que vous n&#39;avez pas cliqué/);
  await addEvent(ctx, { slug: "mp4", title: "Fichier", date: "2031-06-10", videoUrl: "/uploads/film.mp4" });
  assert.match(await html(ctx, ["e", "mp4"]), /<video controls preload="none" src="\/uploads\/film\.mp4">/);
});

test("fiche : données pour les moteurs de recherche (Event), bornées et sans balise cassée", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "ld", title: `Titre ${XSS}`, date: "2031-06-10", time: "20:00", place: "Salle", lat: 50.1, lng: 4.2, image: "/uploads/a.png", text: "</script><b>x</b>", speakers: [{ name: "Camille", role: "", link: "" }] });
  const h = await html(ctx, ["e", "ld"]);
  const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(h);
  assert.ok(m);
  assert.ok(!m[1].includes("</script"));
  const doc = JSON.parse(m[1]);
  assert.equal(doc["@type"], "Event");
  assert.equal(doc.startDate, "2031-06-10T20:00:00+02:00");
  assert.equal(doc.eventStatus, "https://schema.org/EventScheduled");
  assert.deepEqual([doc.location.name, doc.location.geo.latitude], ["Salle", 50.1]);
  assert.equal(doc.image[0], "https://example.test/uploads/a.png");
  assert.deepEqual(doc.performer, [{ "@type": "Person", name: "Camille" }]);
  assert.match(doc.url, /^https:\/\/example\.test\/agenda\/e\/ld$/);
  assert.equal(count(h, /<script type="application\/ld\+json">/g), 1);
});

test("fiche : un brouillon, un jour illisible ou une adresse inconnue = introuvable", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "brouillon", title: "Secret", status: "draft" });
  await ctx.api.store.add("ev_events", { title: "Cassé", slug: "casse", status: "published", date: "pas une date" });
  D.drop(ctx);
  assert.equal((await page(ctx, ["e", "brouillon"])).notFound, true);
  assert.equal((await page(ctx, ["e", "casse"])).notFound, true);
  assert.equal((await page(ctx, ["e", "rien"])).notFound, true);
  assert.ok(!(await html(ctx)).includes("Cassé"));
});

test("sécurité : tout ce qui vient d'un texte est échappé, les liens dangereux ne sortent jamais", async () => {
  const ctx = ctxFor({ wordMany: XSS, intro: XSS });
  await addType(ctx, { key: "x", names: { fr: XSS }, color: "teal", icon: "<b>" });
  await addEvent(ctx, { slug: "xss", title: XSS, type: "x", place: XSS, text: `${XSS}\n[clic](javascript:alert(1))\n[ok](https://example.org)`, date: "2031-06-10", imageAlt: XSS, image: "/uploads/a.png", signupUrl: "https://example.org/a", program: [{ time: "10:00", end: "", title: XSS, text: XSS }], speakers: [{ name: XSS, role: XSS, link: "https://example.org/p" }] });
  for (const segs of [[], ["e", "xss"], ["cal", "2031-06"], ["past"], ["q", "x"]]) {
    const out = await page(ctx, segs);
    const h = out.blocks?.[0]?.html ?? "";
    assert.ok(!/<img src=x/.test(h) && !/<script>alert/.test(h), JSON.stringify(segs));
    assert.ok(!/href="javascript:/i.test(h));
    assert.deepEqual(attrNames(h).filter((n) => /^on/i.test(n)), [], JSON.stringify(segs));
  }
  const fiche = await html(ctx, ["e", "xss"]);
  assert.match(fiche, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(fiche, /<a href="https:\/\/example\.org" rel="noopener noreferrer">ok<\/a>/);
  assert.ok(!(await page(ctx, ["e", "xss"])).description.includes("<"));
});

test("route find : la recherche sans JavaScript renvoie vers la page, dont l'adresse est construite par le module (jamais une redirection ouverte)", async () => {
  const ctx = ctxFor();
  const to = async (query) => { const r = await def.routes.find(get("find", query), ctx); assert.equal(r.status, 303); return r.headers.get("location"); };
  assert.equal(await to("q=Dessin+%C3%A9t%C3%A9&t=atelier&v=list"), "/agenda/t/atelier/q/dessin-ete");
  assert.equal(await to("v=past&q=photos"), "/agenda/past/q/photos");
  assert.equal(await to("v=cal&m=2031-03&t=x"), "/agenda/cal/2031-03/t/x");
  assert.equal(await to(""), "/agenda");
  assert.equal(await to("q=&v=nimportequoi"), "/agenda");
  for (const evil of ["https://evil.example/", "//evil.example", "javascript:alert(1)", "/\\evil"]) {
    for (const p of ["q", "t", "v", "m", "next", "redirect", "url", "return"]) {
      const loc = await to(`${p}=${encodeURIComponent(evil)}`);
      assert.match(loc, /^\/agenda(\/|$)/, `${p}=${evil} → ${loc}`);
    }
  }
  assert.equal((await def.routes.find(get("find", "", { method: "POST" }), ctx)).status, 405);
  assert.equal((await def.routes.find(get("find", "q=a"), ctxFor({}, { locale: "en" }))).headers.get("location"), "/en/agenda/q/a");
});

test("route ics : un fichier d'agenda valide pour un événement publié, rien pour les autres", async () => {
  const ctx = ctxFor();
  await addType(ctx, { key: "atelier", names: { fr: "Atelier" } });
  await addEvent(ctx, { slug: "un", title: "Soirée, avec; virgule", date: "2031-11-14", time: "21:00", place: "Salle", lat: 50.1, lng: 4.2, type: "atelier", text: "Texte", program: [{ time: "21:00", end: "22:00", title: "Accueil", text: "" }] });
  await addEvent(ctx, { slug: "brouillon", title: "Caché", status: "draft" });
  const r = await def.routes.ics(get("ics", "e=un"), ctx);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/calendar/);
  assert.match(r.headers.get("content-disposition"), /attachment; filename="un\.ics"/);
  const body = await r.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n") && body.endsWith("END:VCALENDAR\r\n"));
  assert.ok(body.includes("SUMMARY:Soirée\\, avec\\; virgule"));
  assert.match(body, /DTSTART:20311114T200000Z/); assert.match(body, /DTEND:20311114T220000Z/);
  assert.match(body, /LOCATION:Salle/); assert.match(body, /GEO:50\.1;4\.2/); assert.match(body, /CATEGORIES:Atelier/);
  assert.match(body, /DESCRIPTION:Texte\\n\\n21:00-22:00 Accueil/);
  assert.match(body, /URL:https:\/\/example\.test\/agenda\/e\/un/);
  for (const line of body.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `ligne trop longue : ${line}`);
  assert.equal(await (await def.routes.ics(get("ics", "e=un"), ctx)).text(), body);
  assert.equal((await def.routes.ics(get("ics", "e=brouillon"), ctx)).status, 404);
  assert.equal((await def.routes.ics(get("ics", "e=%2e%2e%2f"), ctx)).status, 404);
  assert.equal((await def.routes.ics(get("ics", ""), ctx)).status, 404);
  assert.equal((await def.routes.ics(get("ics", "e=un", { method: "POST" }), ctx)).status, 405);
});

test("route ics : un événement annulé est écrit « CANCELLED », une journée entière est une date", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "a", title: "Annulé", date: "2031-11-14", time: "", endDate: "2031-11-15", state: "cancelled" });
  const body = await (await def.routes.ics(get("ics", "e=a"), ctx)).text();
  assert.match(body, /STATUS:CANCELLED/);
  assert.match(body, /DTSTART;VALUE=DATE:20311114/); assert.match(body, /DTEND;VALUE=DATE:20311116/);
  assert.equal(ICS.escapeText("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
});

test("route feed.ics : les événements à venir (100 au plus), coupée par un réglage", async () => {
  const ctx = ctxFor();
  for (let i = 0; i < 120; i++) await addEvent(ctx, { title: `E${i}`, date: "2032-01-01" });
  await addEvent(ctx, { title: "Passé", date: "2020-01-01" });
  await addEvent(ctx, { title: "Brouillon", date: "2032-02-01", status: "draft" });
  const body = await (await def.routes["feed.ics"](get("feed.ics"), ctx)).text();
  assert.equal(count(body, /BEGIN:VEVENT/g), 100);
  assert.ok(!body.includes("Passé") && !body.includes("Brouillon"));
  const off = ctxFor({ subscribe: false });
  assert.equal((await def.routes["feed.ics"](get("feed.ics"), off)).status, 404);
  assert.ok(!(await html(off)).includes("feed.ics"));
  assert.match(await html(ctx), /feed\.ics/);
});

test("routes : limite de débit par visiteur (429), jamais l'adresse en clair", async () => {
  const ctx = ctxFor();
  await addEvent(ctx, { slug: "un", title: "Un" });
  let blocked = 0;
  for (let i = 0; i < 80; i++) if ((await def.routes.ics(get("ics", "e=un", { ip: "198.51.100.9" }), ctx)).status === 429) blocked++;
  assert.ok(blocked >= 15, `limité : ${blocked}`);
  assert.equal((await def.routes.ics(get("ics", "e=un", { ip: "198.51.100.77" }), ctx)).status, 200);
});

test("accueil : la section des prochains rendez-vous (3 par défaut, 10 au plus), invisible quand il n'y en a pas", async () => {
  const ctx = ctxFor();
  assert.equal(await def.sections.next(ctx, {}), null);
  for (let i = 0; i < 12; i++) await addEvent(ctx, { title: `R${i}`, date: `2032-01-${String(i + 1).padStart(2, "0")}` });
  await addEvent(ctx, { title: "Annulé", date: "2031-12-01", state: "cancelled" });
  const three = (await def.sections.next(ctx, {}))[0].html;
  assert.equal(count(three, /class="ev-card ev-home"/g), 3);
  assert.ok(!three.includes("Annulé"));
  assert.equal(count((await def.sections.next(ctx, { count: 50 }))[0].html, /class="ev-card ev-home"/g), 10);
  assert.match(three, /Voir tous les événements/);
});

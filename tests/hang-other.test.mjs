// Planning (calendrier) et Statistiques de la communauté : un réseau ou un module qui ne répond jamais ne doit pas bloquer la page ni laisser un verrou fermé.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});

test("planning : le téléchargement du calendrier a une borne globale (même avec des redirections lentes ou un serveur muet)", async () => {
  const P = await import("../modules/planning/index.mjs");
  const timing = P.icsTiming ?? {};   // (avant le correctif ce réglage n'existait pas : le test doit alors échouer sur le blocage lui-même)
  const saved = { ...timing };
  try {
    Object.assign(timing, { totalMs: 150 });
    P.clearIcsCache();
    assert.equal(await within(P.fetchIcs("https://example.com/mute.ics", blackHole)), null);
    // trois redirections de 60 ms : chacune passerait seule, l'ensemble dépasse la borne
    let n = 0;
    const slow = async () => { await new Promise((r) => setTimeout(r, 60)); n++; return new Response(null, { status: 302, headers: { location: `https://example.com/r${n}.ics` } }); };
    const t0 = Date.now();
    assert.equal(await within(P.fetchIcs("https://example.com/redirects.ics", slow)), null);
    assert.ok(Date.now() - t0 < 600);
    // tout répond : inchangé
    const ok = await P.fetchIcs("https://example.com/ok.ics", async () => new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", { status: 200 }));
    assert.match(ok, /BEGIN:VCALENDAR/);
  } finally { Object.assign(timing, saved); P.clearIcsCache(); }
});

test("community-stats : un module de réseau qui ne répond jamais fait échouer le passage proprement, sans laisser le verrou « busy »", async () => {
  const DIR = new URL("../modules/community-stats", import.meta.url).pathname;
  const fr = JSON.parse(fs.readFileSync(`${DIR}/locales/fr.json`, "utf8"));
  const { collectNow, limits } = await import("../modules/community-stats/collect.mjs");
  const lim = limits ?? {};
  const saved = { ...lim };
  try {
    Object.assign(lim, { collectMs: 100 });
    let hang = true;
    const NOW = Date.parse("2026-10-14T10:00:00Z");
    const ctx = fakeCtx({ key: "community-stats", locale: "fr", locales: ["fr", "en"], messages: fr, settings: {}, topics: { "social.stat": () => (hang ? blackHole() : []) } });
    const r = await within(collectNow(ctx, { now: NOW, force: true }));
    assert.notEqual(r, HUNG, "le passage ne doit pas attendre indéfiniment");
    assert.equal(r.status, "failed");
    hang = false;
    const again = await within(collectNow(ctx, { now: NOW + 5 * 60_000, force: true }));
    assert.notEqual(again, HUNG);
    assert.equal(again.status, "done", "le verrou est libre : le passage suivant a lieu");
  } finally { Object.assign(lim, saved); }
});

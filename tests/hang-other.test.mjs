// Statistiques de la communauté : un réseau ou un module qui ne répond jamais ne doit pas bloquer la page ni laisser un verrou fermé. (Les agendas et le Planning : hang-calendar.test.mjs.)
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});

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

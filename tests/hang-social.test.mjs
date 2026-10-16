// Bluesky, Mastodon, GitHub, Discord, Reddit : un réseau « trou noir » (un fetch qui ne se termine jamais) ne doit pas laisser une promesse partagée bloquer tous les appels suivants.
// Avant le correctif : la demande en cours restait dans `pending` pour toujours ; « social.stat » (donc la collecte des statistiques de la communauté) ne répondait plus jusqu'au redémarrage.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const root = new URL("../modules/", import.meta.url).pathname;
const SETTINGS = { bluesky: { profile: "nom.bsky.social" }, mastodon: { profile: "https://mastodon.example/@nom" }, github: { profile: "helldog" }, discord: { profile: "abcDEF" }, reddit: { profile: "https://www.reddit.com/r/mon_sub" } };
const OK = { bluesky: { followersCount: 120, postsCount: 45, handle: "nom.bsky.social" }, mastodon: { followers_count: 77, statuses_count: 1500, acct: "nom" }, github: { login: "helldog", followers: 9, public_repos: 3 }, discord: { approximate_member_count: 321, guild: { name: "X" } }, reddit: { data: { subscribers: 4321, display_name_prefixed: "r/mon_sub" } } };
const realFetch = globalThis.fetch;
const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

for (const id of Object.keys(SETTINGS)) {
  test(`${id} : un appel qui ne se termine jamais rend une erreur « network » dans le délai, puis la demande suivante repart de zéro`, async () => {
    const mod = await import(`../modules/${id}/index.mjs`);
    const timing = mod.timing ?? {};   // (avant le correctif ce réglage n'existait pas : le test doit alors échouer sur le blocage lui-même)
    const saved = { ...timing };
    try {
      mod.resetCache?.();
      Object.assign(timing, { sharedMs: 120 });
      const ctx = fakeCtx({ key: "inst", locale: "fr", messages: JSON.parse(fs.readFileSync(`${root}${id}/locales/fr.json`, "utf8")), name: "Mon compte", settings: SETTINGS[id], siteUrl: "https://site.example" });
      const stat = () => mod.default.exports["social.stat"](ctx, { locale: "fr", limit: 50, tags: [] });
      globalThis.fetch = blackHole;
      const [a, b] = await Promise.all([within(stat()), within(stat())]);   // deux demandes simultanées partagent la même
      for (const r of [a, b]) { assert.notEqual(r, HUNG, "ne doit pas attendre indéfiniment"); assert.ok(r.length && r.every((x) => x.error === "network" && x.value === undefined), JSON.stringify(r)); }
      globalThis.fetch = async () => new Response(JSON.stringify(OK[id]), { status: 200, headers: { "content-type": "application/json" } });
      mock.timers.enable({ apis: ["Date"], now: Date.now() + 3 * 3_600_000 });   // l'erreur retenue quelques minutes est périmée
      const c = await within(stat());
      assert.notEqual(c, HUNG, "ne doit plus attendre l'ancienne promesse");
      assert.ok(c.length && c.every((x) => !x.error && Number.isInteger(x.value)), JSON.stringify(c));
    } finally { Object.assign(timing, saved); }
  });
}

// Chaîne YouTube : un réseau « trou noir » (une réponse qui ne vient jamais) ne doit jamais bloquer la page d'accueil.
// Depuis la 1.2.0, tout passe par ctx.api.net (délai dur) et par le service youtube.api (borne dure côté module) : ces tests vérifient les bornes de bout en bout.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { makeConnector, connectorApi } from "./helpers/fakeYoutube.mjs";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch, netReplies } = kit;
const DIR = new URL("../modules/youtube-channel", import.meta.url).pathname;
const mod = await import("../modules/youtube-channel/index.mjs");
const def = mod.default;
const CH = "UC" + "a".repeat(22);
const realFetch = globalThis.fetch;
const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const timing = mod.timing;
const saved = { ...timing };
beforeEach(() => { mod.resetCache(); connectorApi.resetState(); Object.assign(timing, { requestMs: 60_000, serviceMs: 60_000, shortsMs: 150, concurrency: 4 }); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(timing, saved); });

const ctx = (settings = {}, opts = {}) => fakeCtx({ key: "yt", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), settings: { channelId: CH, ...settings }, ...opts });
const ids = Array.from({ length: 15 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
const entry = (id, i) => `<entry><yt:videoId>${id}</yt:videoId><title>Video ${i}</title><published>${new Date(Date.now() - (i + 1) * 3_600_000).toISOString()}</published><media:group><media:community><media:statistics views="${1000 - i}"/></media:community></media:group></entry>`;
const FEED = `<feed>${ids.map(entry).join("")}</feed>`;
/** Le flux répond ; les contrôles « Short » (HEAD) passent par `head(id)`. */
function mockYoutube(head) {
  const log = { heads: [], inflight: 0, maxInflight: 0 };
  globalThis.fetch = fakeFetch({
    "*": async (url) => {
      if (url.includes("/feeds/videos.xml")) return { text: FEED };
      const m = /shorts\/([\w-]+)/.exec(url);
      if (m) {
        log.heads.push(m[1]); log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
        try { return await head(m[1]); } finally { log.inflight--; }
      }
      return { status: 404, text: "" };
    },
  });
  return log;
}
const blackHole = () => new Promise(() => {});

test("feed.item : des contrôles « Short » qui ne répondent jamais n'empêchent pas la réponse (borne globale), limités à 4 à la fois", async () => {
  const log = mockYoutube(blackHole);
  const t0 = Date.now();
  const items = await within(def.exports["feed.item"](ctx(), { limit: 20 }));
  assert.notEqual(items, HUNG, "le fil d'annonces ne doit pas attendre YouTube indéfiniment");
  assert.equal(items.length, 15, "sans réponse de YouTube, les vidéos comptent comme classiques (comportement d'avant en cas d'erreur)");
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(log.heads.length <= 4 && log.maxInflight <= 4, `au plus 4 contrôles à la fois, vu ${log.maxInflight}`);
});

test("feed.item : « inconnu » est retenu une minute : la visite suivante ne refait aucun contrôle", async () => {
  const log = mockYoutube(blackHole);
  await within(def.exports["feed.item"](ctx(), { limit: 20 }));
  const before = log.heads.length;
  const t0 = Date.now();
  const again = await within(def.exports["feed.item"](ctx(), { limit: 20 }), 800);
  assert.notEqual(again, HUNG);
  assert.equal(log.heads.length, before, "aucun nouvel appel HEAD");
  assert.ok(Date.now() - t0 < 100, "réponse immédiate");
});

test("vidéo mise en avant : bornée aussi quand YouTube ne répond pas à « Short ou non »", async () => {
  mockYoutube(blackHole);
  const blocks = await within(def.sections.featured(ctx()));
  assert.notEqual(blocks, HUNG);
  assert.match(blocks[0].html, /vid00000000/, "la plus vue des récentes, comptée comme classique");
});

test("quand tout répond : même résultat qu'avant, un seul contrôle par vidéo pendant 10 minutes, en parallèle", async () => {
  const shorts = new Set([ids[1], ids[4]]);
  timing.shortsMs = 5000;
  const log = mockYoutube(async (id) => { await new Promise((r) => setTimeout(r, 5)); return { status: shorts.has(id) ? 200 : 303, text: "" }; });
  const items = await def.exports["feed.item"](ctx(), { limit: 20 });
  assert.deepEqual(items.map((x) => x.id), ids.filter((i) => !shorts.has(i)).map((i) => `yt:${i}`), "les Shorts sont retirés, l'ordre est conservé");
  assert.equal(log.heads.length, 15);
  assert.ok(log.maxInflight > 1 && log.maxInflight <= 4, `parallèle et plafonné : ${log.maxInflight}`);
  await def.exports["feed.item"](ctx(), { limit: 20 });
  await def.exports["maze.poster"](ctx(), { limit: 20 });
  assert.equal(log.heads.length, 15, "le résultat est gardé : aucun nouvel appel");
});

test("chiffres de la chaîne : un fournisseur de youtube.api qui ne répond jamais rend « network » dans la borne et ne bloque pas la suite", async () => {
  timing.serviceMs = 150;
  const hung = ctx({ trackStats: true }, { services: { "youtube.api": { channels: blackHole } } });
  const r = await within(def.exports["social.stat"](hung, { limit: 10 }));
  assert.notEqual(r, HUNG);
  assert.ok(r.every((i) => i.error === "network"));
});

test("chiffres de la chaîne : YouTube muet (trou noir) derrière le vrai connecteur → réponse bornée, puis tout repart quand YouTube revient", async () => {
  connectorApi.LIMITS.timeoutMs = 600;
  try {
    globalThis.fetch = fakeFetch({ "*": netReplies.silence() });
    const c = makeConnector();
    const me = ctx({ trackStats: true }, { services: c.services });
    const t0 = Date.now();
    const r = await within(def.exports["social.stat"](me, { limit: 10 }), 3000);
    assert.notEqual(r, HUNG);
    assert.ok(Date.now() - t0 < 2000);
    assert.ok(r.every((i) => i.error === "network"), JSON.stringify(r));
  } finally { connectorApi.LIMITS.timeoutMs = 8000; }
});

test("lecture du flux : une réponse qui ne vient jamais est bornée par le délai (et par le temps restant d'une page publique)", async () => {
  Object.assign(timing, { requestMs: 200 });
  globalThis.fetch = fakeFetch({ "*": netReplies.silence() });
  assert.deepEqual(await within(mod.viaFeed(ctx(), CH)), []);
  Object.assign(timing, { requestMs: 60_000 });
  const page = ctx({}, { netBudgetMs: 800 });
  const t0 = Date.now();
  assert.equal(await within(def.sections.featured(page), 3000), null);
  assert.ok(Date.now() - t0 < 1500, "dans le temps de la page");
});

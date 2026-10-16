// Chaîne YouTube 1.1.2 : un réseau « trou noir » (un fetch qui ne se termine jamais) ne doit plus bloquer la page d'accueil.
// Avant le correctif : « Short ou non » interrogeait YouTube vidéo par vidéo, en série, sans mémoire (15 vidéos × 5 s = 75 s), et les chiffres partagés pouvaient rester bloqués.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/youtube-channel", import.meta.url).pathname;
const mod = await import("../modules/youtube-channel/index.mjs");
const def = mod.default;
const CH = "UC" + "a".repeat(22);
const realFetch = globalThis.fetch;
const HUNG = Symbol("hung");
const within = (p, ms = 1500) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), ms); })]).finally(() => clearTimeout(t)); };
const blackHole = () => new Promise(() => {});
const timing = mod.timing ?? {};   // (avant le correctif ce réglage n'existait pas : les tests doivent alors échouer sur le blocage lui-même)
const saved = { ...timing };
beforeEach(() => { mod.resetCache(); Object.assign(timing, { requestMs: 60_000, sharedMs: 60_000, shortsMs: 150, concurrency: 4 }); });
afterEach(() => { globalThis.fetch = realFetch; Object.assign(timing, saved); mock.timers.reset(); });

const ctx = (settings = {}) => fakeCtx({ key: "yt", messages: JSON.parse(fs.readFileSync(`${DIR}/locales/en.json`, "utf8")), settings: { channelId: CH, ...settings } });
const ids = Array.from({ length: 15 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
const entry = (id, i) => `<entry><yt:videoId>${id}</yt:videoId><title>Video ${i}</title><published>${new Date(Date.now() - (i + 1) * 3_600_000).toISOString()}</published><media:group><media:community><media:statistics views="${1000 - i}"/></media:community></media:group></entry>`;
const FEED = `<feed>${ids.map(entry).join("")}</feed>`;
/** Le flux répond ; les contrôles « Short » (HEAD) passent par `head(id)`. */
function mockYoutube(head) {
  const log = { heads: [], inflight: 0, maxInflight: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/feeds/videos.xml")) return { ok: true, status: 200, text: async () => FEED };
    const m = /shorts\/([\w-]+)/.exec(u);
    if (m) {
      log.heads.push(m[1]); log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
      try { return await head(m[1]); } finally { log.inflight--; }
    }
    return { ok: false, status: 404 };
  };
  return log;
}

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
  const log = mockYoutube(async (id) => { await new Promise((r) => setTimeout(r, 5)); return { ok: shorts.has(id), status: shorts.has(id) ? 200 : 303 }; });
  const items = await def.exports["feed.item"](ctx(), { limit: 20 });
  assert.deepEqual(items.map((x) => x.id), ids.filter((i) => !shorts.has(i)).map((i) => `yt:${i}`), "les Shorts sont retirés, l'ordre est conservé");
  assert.equal(log.heads.length, 15);
  assert.ok(log.maxInflight > 1 && log.maxInflight <= 4, `parallèle et plafonné : ${log.maxInflight}`);
  await def.exports["feed.item"](ctx(), { limit: 20 });
  await def.exports["maze.poster"](ctx(), { limit: 20 });
  assert.equal(log.heads.length, 15, "le résultat est gardé : aucun nouvel appel");
});

test("chiffres de la chaîne : un appel qui ne se termine jamais rend « network » et ne bloque pas la suite", async () => {
  timing.sharedMs = 150;
  globalThis.fetch = blackHole;
  const key = "KEY";
  const r = await within(mod.channelStats(CH, key));
  assert.notEqual(r, HUNG);
  assert.equal(r.error, "network");
  await new Promise((res) => setTimeout(res, 30));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [{ statistics: { subscriberCount: "10", videoCount: "3", viewCount: "99" } }] }) });
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 120_000 });   // l'erreur retenue une minute est périmée
  const ok = await within(mod.channelStats(CH, key));
  assert.notEqual(ok, HUNG, "ne doit plus attendre l'ancienne promesse");
  assert.equal(ok.stats?.followers, 10);
});

test("lecture du flux : un corps de réponse qui ne se termine jamais est borné par la borne dure", async () => {
  Object.assign(timing, { requestMs: 25 });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: blackHole });
  assert.deepEqual(await within(mod.viaFeed(CH)), []);
  globalThis.fetch = blackHole;
  assert.deepEqual(await within(mod.viaFeed(CH)), []);
});

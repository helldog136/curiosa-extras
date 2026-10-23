import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

// Cœur 0.2.6 : les limites de débit comptent par ctx.api.visitor.fingerprint(request, portée), jamais par un en-tête d'adresse lu par le module.
// Ces tests échouent sur l'ancien code : il lisait X-Forwarded-For lui-même et ignorait l'empreinte du cœur.

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const manifest = (p) => JSON.parse(read(`${p}/module.json`));
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

const contact = (await import("../modules/contact-form/index.mjs")).default;
const games = (await import("../modules/game-suggestions/index.mjs")).default;
const book = (await import("../examples/guestbook/index.mjs")).default;

/** Remplace l'empreinte du cœur par un double espion : le visiteur est désigné par l'en-tête « x-test-visitor » (aucune adresse en jeu). */
function spy(ctx) {
  const calls = [];
  ctx.api.visitor = { fingerprint: (request, scope) => { calls.push({ request, scope }); return `fp|${scope}|${request.headers.get("x-test-visitor") ?? "?"}`; } };
  return calls;
}
const form = (url, fields, who, extra = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  // Chaque envoi annonce une adresse différente : seule l'empreinte du cœur doit compter.
  return new Request(url, { method: "POST", body: fd, headers: { "x-test-visitor": who, "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...extra } });
};

for (const [id, dir] of [["contact-form", "modules/contact-form"], ["game-suggestions", "modules/game-suggestions"], ["guestbook", "examples/guestbook"]]) {
  test(`${id} : ne lit aucun en-tête d'adresse et exige le cœur 0.2.6`, () => {
    assert.doesNotMatch(read(`${dir}/index.mjs`), /x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip/i);
    assert.match(read(`${dir}/index.mjs`), /visitor\.fingerprint\(/);
    assert.ok(cmp(manifest(dir).minCore, "0.2.6") >= 0, `minCore ${manifest(dir).minCore}`);
  });
}

test("contact-form : la limite suit l'empreinte du cœur (portée « envoi »), pas l'en-tête", async () => {
  const saved = [];
  const c = fakeCtx({ services: { "contact.store": { add: async (a) => { saved.push(a); return { id: `c${saved.length}`, created: true }; } } } });
  const calls = spy(c);
  const ok = { name: "Alice", email: "alice@example.org", message: "Bonjour" };
  const who = `v${Date.now()}`;
  for (let i = 0; i < 5; i++) assert.equal((await contact.routes.send(form("https://x.test/s", ok, who), c)).status, 200);
  assert.equal((await contact.routes.send(form("https://x.test/s", ok, who), c)).status, 429, "même empreinte = même visiteur, quelle que soit l'adresse annoncée");
  assert.equal((await contact.routes.send(form("https://x.test/s", ok, `${who}-autre`), c)).status, 200, "autre empreinte = autre visiteur");
  assert.ok(calls.length >= 7 && calls.every((k) => k.scope === "envoi" && k.request instanceof Request));
});

test("game-suggestions : suggestions et votes comptent par empreinte du cœur, chacun dans sa portée", async () => {
  const c = fakeCtx({ key: "fpgs", basePath: "suggestions", settings: { rateLimit: 2 } });
  const calls = spy(c);
  const suggest = (who, title) => games.routes.suggest(form("https://x.test/m/k/suggest", { title }, who), c);
  assert.equal((await suggest("s1", "A")).status, 200);
  assert.equal((await suggest("s1", "B")).status, 200);
  assert.equal((await suggest("s1", "C")).status, 429);
  assert.equal((await suggest("s2", "D")).status, 200);
  const played = await c.api.store.add("games", { title: "Jeu", status: "already_played", replayVotes: 0 });
  const vote = (who) => games.routes.vote(form("https://x.test/m/k/vote", { id: played }, who), c);
  for (let i = 0; i < 3; i++) assert.equal((await vote("v1")).status, 303);
  assert.equal((await vote("v1")).status, 429, "3 votes par mois et par empreinte");
  assert.deepEqual([...new Set(calls.map((k) => k.scope))].sort(), ["suggest", "vote"]);
});

test("livre d'or : la limite suit l'empreinte du cœur (portée « sign »)", async () => {
  const c = fakeCtx({ key: "fpgb", basePath: "guestbook", moduleId: "guestbook", locale: "en", settings: { rateLimit: 2 } });
  const calls = spy(c);
  const sign = (who) => book.routes.sign(form("https://x.test/m/x/sign", { name: "Ada", message: "Salut" }, who), c);
  assert.equal((await sign("g1")).status, 200);
  assert.equal((await sign("g1")).status, 200);
  assert.equal((await sign("g1")).status, 429);
  assert.equal((await sign("g2")).status, 200);
  assert.ok(calls.length === 4 && calls.every((k) => k.scope === "sign"));
});

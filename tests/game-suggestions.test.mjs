import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/game-suggestions", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const mod = await import("../modules/game-suggestions/index.mjs");
const def = mod.default;
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
let n = 0;
const ctx = (settings = {}) => { const c = fakeCtx({ key: `gs${++n}`, basePath: "suggestions", messages: readJson("locales/en.json"), settings }); delete c.api.rawg; return c; };   // ancien comportement (réglage du module) ; le service du cœur est testé dans rawg-covers.test.mjs
const formReq = (url, fields, headers = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return new Request(url, { method: "POST", body: fd, headers }); };
const suggest = (c, fields, ip = "1.1.1.1") => def.routes.suggest(formReq("https://x.test/m/k/suggest", fields, { "x-forwarded-for": ip }), c);
const add = (c, data) => c.api.store.add("games", { title: "Jeu", status: "proposed", replayVotes: 0, ...data });

test("manifeste valide, réglages déclarés, parité en/fr, clés ctx.t statiques existantes, actions MCP implémentées", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  const en = readJson("locales/en.json");
  assert.deepEqual(Object.keys(readJson("locales/fr.json")).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, m[1]);
  for (const s of ["proposed", "planned", "accepted", "rejected", "already_played", "finished"]) assert.ok(`status_${s}` in en);
  for (const a of manifestJson.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
});

test("suggestion : enregistrée « proposé », texte nettoyé et borné ; titre vide, spam de liens, piège à robots", async () => {
  const c = ctx();
  assert.equal((await suggest(c, { title: "  Hollow\u0007   Knight ", name: "Alice", note: "Super jeu" })).status, 200);
  const [g] = await c.api.store.list("games");
  assert.deepEqual([g.data.title, g.data.status, g.data.submitterName, g.data.replayVotes], ["Hollow Knight", "proposed", "Alice", 0]);
  assert.equal((await suggest(c, { title: "   " })).status, 400);
  assert.equal((await suggest(c, { title: "X", note: "http://a.io http://b.io" })).status, 400);
  const bot = await suggest(c, { title: "Bot", website: "spam.io" });
  assert.equal(bot.status, 200);
  assert.equal(await c.api.store.count("games"), 1, "le robot n'a rien enregistré");
  assert.equal((await suggest(c, { title: "x".repeat(500) }).then(() => c.api.store.list("games")))[0].data.title.length, 100);
});

test("suggestion : limite par heure et par visiteur", async () => {
  const c = ctx({ rateLimit: 2 });
  assert.equal((await suggest(c, { title: "A" }, "9.9.9.9")).status, 200);
  assert.equal((await suggest(c, { title: "B" }, "9.9.9.9")).status, 200);
  assert.equal((await suggest(c, { title: "C" }, "9.9.9.9")).status, 429);
  assert.equal((await suggest(c, { title: "D" }, "8.8.8.8")).status, 200, "un autre visiteur n'est pas touché");
});

test("jaquette RAWG : https seulement, jamais d'erreur ; sans clé, aucune requête", async () => {
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, json: async () => ({ results: [{ background_image: "https://media.rawg.io/x.jpg" }] }) }; };
  const c = ctx({ rawgApiKey: "K" });
  await suggest(c, { title: "Celeste" });
  assert.equal((await c.api.store.list("games"))[0].data.coverUrl, "https://media.rawg.io/x.jpg");
  assert.ok(calls[0].includes("search=Celeste") && calls[0].includes("key=K"));
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [{ background_image: "javascript:alert(1)" }] }) });
  assert.equal(await mod.fetchCover("X", "K"), null);
  globalThis.fetch = async () => { throw new Error("réseau"); };
  assert.equal(await mod.fetchCover("X", "K"), null);
  calls.length = 0; globalThis.fetch = async (u) => { calls.push(u); return { ok: false }; };
  const c2 = ctx(); await suggest(c2, { title: "Sans clé" });
  assert.equal(calls.length, 0);
  assert.equal((await c2.api.store.list("games"))[0].data.coverUrl, null);
});

test("vote « rejoue-le » : seulement sur un jeu déjà joué, 3 par mois (cookie et adresse), redirection vers la page", async () => {
  const c = ctx();
  const played = await add(c, { status: "already_played" });
  const planned = await add(c, { status: "planned" });
  const vote = (id, cookie = "", ip = "2.2.2.2") => def.routes.vote(formReq("https://x.test/m/k/vote", { id }, { ...(cookie ? { cookie } : {}), "x-forwarded-for": ip }), c);
  assert.equal((await vote(planned)).status, 404, "pas de vote sur un jeu non joué");
  assert.equal((await vote("inconnu")).status, 404);
  let cookie = "";
  for (let i = 0; i < 3; i++) {
    const res = await vote(played, cookie);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/suggestions");
    cookie = res.headers.get("set-cookie").split(";")[0];
  }
  assert.equal((await vote(played, cookie)).status, 429, "4e vote refusé (cookie)");
  assert.equal((await vote(played, "", "2.2.2.2")).status, 429, "cookie effacé : la mémoire par adresse retient");
  assert.equal((await c.api.store.get(played)).data.replayVotes, 3);
  assert.equal((await vote(played, "", "3.3.3.3")).status, 303, "un autre visiteur peut voter");
  assert.match((await def.routes.vote(new Request("https://x.test", { method: "GET" }), c)).status.toString(), /405/);
});

test("page : rejetés cachés, filtre par statut, texte échappé, 404 pour un statut inconnu ; bouton de vote seulement sur « déjà joué »", async () => {
  const c = ctx();
  await add(c, { title: "<b>Piège</b>", status: "proposed", note: "<script>x</script>" });
  await add(c, { title: "Rejeté", status: "rejected" });
  await add(c, { title: "Déjà", status: "already_played" });
  const html = (await def.page(c, { segments: [] })).blocks.find((b) => b.type === "html").html;
  assert.ok(!html.includes("Rejeté") && !html.includes("<script>") && !html.includes("<b>Piège"));
  assert.match(html, /&lt;b&gt;Piège/);
  assert.equal((html.match(/\/vote"/g) ?? []).length, 1);
  const only = (await def.page(c, { segments: ["already_played"] })).blocks.find((b) => b.type === "html").html;
  assert.ok(only.includes("Déjà") && !only.includes("Piège"));
  assert.equal((await def.page(c, { segments: ["rejected"] })).notFound, true);
  assert.equal((await def.page(c, { segments: ["a", "b"] })).notFound, true);
});

test("admin et MCP : changement de statut, suppression, liste filtrée ; statut invalide refusé", async () => {
  const c = ctx();
  const id = await add(c, { title: "Zelda" });
  assert.equal((await def.adminActions.status_finished(c, { id })).ok, "Status updated.");
  assert.equal((await c.api.store.get(id)).data.status, "finished");
  assert.ok((await def.adminActions.status_planned(c, { id: "nope" })).error);
  assert.deepEqual((await def.mcp.game_suggestions_list(c, { status: "finished" })).map((g) => g.title), ["Zelda"]);
  assert.deepEqual(await def.mcp.game_suggestions_list(c, { status: "planned" }), []);
  await assert.rejects(def.mcp.game_suggestions_set_status(c, { id, status: "nimporte" }), /invalid status/);
  await def.mcp.game_suggestions_set_status(c, { id, status: "rejected" });
  assert.equal((await c.api.store.get(id)).data.status, "rejected");
  await def.adminActions.remove(c, { id });
  assert.equal(await c.api.store.count("games"), 0);
  const blocks = await def.adminPanel(c);
  assert.equal(blocks[1].type, "table");
});

test("sauvegarde lisible : CSV avec cellules neutralisées", async () => {
  const c = ctx();
  await add(c, { title: "=HYPERLINK(\"x\")", submitterName: "Al" });
  const [file] = await def.backup.readable(c);
  assert.equal(file.path, "games.csv");
  assert.match(file.content, /"'=HYPERLINK/);
});

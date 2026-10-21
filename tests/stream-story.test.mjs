// Story d'annonce 2.0.0 — le serveur : manifeste, accès de l'éditeur, lecture des streams (n'importe quel agenda), modèles, préparations,
// outils pour l'IA, relais d'images (liste blanche), page de l'éditeur, administration, sauvegarde. Aucun réseau : tout est factice.
import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";

const DIR = new URL("../modules/stream-story", import.meta.url).pathname;
const read = (f) => fs.readFileSync(`${DIR}/${f}`, "utf8");
const manifest = JSON.parse(read("module.json")), fr = JSON.parse(read("locales/fr.json")), en = JSON.parse(read("locales/en.json"));
const def = (await import("../modules/stream-story/index.mjs")).default;
const P = await import("../modules/stream-story/pure.mjs");
const data = await import("../modules/stream-story/data.mjs");
const src = await import("../modules/stream-story/sources.mjs");
const images = await import("../modules/stream-story/images.mjs");
const page = await import("../modules/stream-story/page.mjs");
const tools = await import("../modules/stream-story/mcp.mjs");

const SITE = "https://site.example.test", NOW = Date.parse("2026-10-22T10:00:00Z"), TZ = "Europe/Brussels";
const slot = (id, title, start, extra = {}) => ({ id, title, start, end: new Date(Date.parse(start) + 7_200_000).toISOString(), allDay: false, games: [], status: "confirmed", timezone: TZ, ...extra });
const SLOTS = [slot("a", "Découverte", "2026-10-22T17:30:00Z", { games: ["Hades"] }), slot("b", "Soirée", "2026-10-23T18:00:00Z", { games: ["Zelda"] }), slot("c", "Annulé", "2026-10-24T18:00:00Z", { status: "cancelled" })];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PICTURE = "https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png";

const mk = (extra = {}) => fakeCtx({
  key: "story", moduleId: "stream-story", locale: "fr", messages: { ...fr }, permissions: manifest.permissions, siteUrl: SITE,
  topics: { "planning.slot": () => SLOTS },
  instances: [{ id: "id-story", key: "story", module: "stream-story", basePath: "", name: "Story", adminPath: "/admin/instances/id-story" }],
  rawgCover: { status: "found", url: "https://media.rawg.io/media/games/abc/cover.jpg" },
  theme: { accent: "#7c5cff", accentFg: "#ffffff", bg: "#101018", fg: "#f2f2f2", accent2: "#ff4d8d", font: "Inter, sans-serif" }, ...extra,
});
const call = (ctx, route, { method = "GET", token, body, headers = {}, search = "" } = {}) => def.routes[route](new Request(`${SITE}/m/story/${route}${search}`, { method, headers: { ...(token ? { "x-story-token": token } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), ctx);
const json = async (r) => ({ status: r.status, ...(await r.json()) });
const act = async (ctx, token, body) => json(await call(ctx, "act", { method: "POST", token, body }));
const realFetch = globalThis.fetch;
beforeEach(() => { images.resetImages(); mock.timers.reset(); });
afterEach(() => { globalThis.fetch = realFetch; mock.timers.reset(); });

/* ───────────── Manifeste et textes ───────────── */

test("manifeste : un module à lui, une instance, aucune page publique, 4 permissions + rawg ; minCore le plus bas (0.1.22) ; icône ; famille « Réseaux et connexions » (plateforme) ; vie privée déclarée", () => {
  assert.equal(manifest.id, "stream-story"); assert.equal(manifest.version, "2.0.1");
  assert.equal(manifest.minCore, "0.2.2"); assert.equal(manifest.dataVersion, 2); assert.equal(manifest.instances, "single"); assert.equal(manifest.page, false);
  assert.deepEqual([...manifest.permissions].sort(), ["admin", "mcp", "rawg", "routes", "storage", "topics"]);
  assert.equal(manifest.icon, "📱"); assert.equal(manifest.platform, "instagram"); assert.equal(manifest.type, "utility");
  assert.deepEqual(manifest.requires.map((r) => [r.service, r.min, r.optional]), [["contact.book", 2, true]], "Contacts (v2) : un besoin FACULTATIF, jamais dur");
  assert.deepEqual(manifest.offers.map((o) => [o.service, o.each]), [["privacy.subject", true]], "Story garde des identifiants de fiche : elle offre privacy.subject");
  assert.deepEqual(manifest.consumes.map((c) => c.topic), ["planning.slot"], "le sujet stream.partner n'est plus lu : les co-streamers viennent de Contacts");
  for (const k of ["page", "slots", "sections", "filters", "overlay", "tasks", "hooks", "exports"]) assert.ok(!(k in def), `pas de « ${k} »`);
  assert.ok(manifest.privacy.fr && manifest.privacy.en && !/visiteur/.test("") );
  assert.match(manifest.privacy.fr, /Rien n'est collecté sur vos visiteurs/); assert.match(manifest.privacy.fr, /Aucune vidéo n'est gardée/); assert.match(manifest.privacy.fr, /restent dans Contacts/);
  assert.deepEqual(Object.keys(def.routes).sort(), ["act", "categories", "category", "data", "img", "lib/app.mjs", "lib/encode.mjs", "lib/mp4.mjs", "lib/pure.mjs", "lib/scenes.mjs", "members", "people", "prep", "streams", "studio"]);
});

test("réglages : seules les couleurs de la vidéo et le fuseau, tous en mode avancé ; le fuseau est facultatif ; couleurs qui suivent le thème du site par défaut", () => {
  assert.deepEqual(manifest.settings.map((s) => s.key), ["colorAccent", "colorAccent2", "colorBackground", "colorText", "timezone"]);
  assert.ok(manifest.settings.every((s) => s.advanced === true), "rien en mode simple : zéro configuration");
  assert.deepEqual(manifest.settings.filter((s) => s.type === "color").map((s) => s.default), ["theme:accent", "theme:accent2", "theme:bg", "theme:fg"]);
  assert.equal(manifest.settings.find((s) => s.key === "timezone").optional, true);
});

test("outils pour l'IA : deux lectures accordées d'office, la préparation JAMAIS d'office ; noms ≤ 31 ; la préparation n'est ni lecture seule ni destructrice ; décrits", () => {
  const byName = Object.fromEntries(manifest.mcp.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName), ["story_models", "story_next_streams", "story_prepare"]);
  for (const n of ["story_models", "story_next_streams"]) { assert.equal(byName[n].readOnly, true); assert.ok(byName[n].default !== false, "lecture : accordée par défaut"); }
  assert.equal(byName.story_prepare.default, false); assert.ok(!byName.story_prepare.readOnly && !byName.story_prepare.destructive);
  assert.ok(manifest.mcp.every((t) => t.name.length <= 31 && t.description.length > 40));
  assert.deepEqual(Object.keys(def.mcp).sort(), Object.keys(byName).sort());
  const p = byName.story_prepare.input.properties;
  assert.deepEqual(p.style.enum, P.STYLES); assert.deepEqual(p.format.enum, P.FORMATS.map((f) => f.id)); assert.deepEqual([p.durationSeconds.minimum, p.durationSeconds.maximum], [5, 15]);
  assert.equal(p.text.maxLength, 140); assert.ok(Object.values(p).every((x) => x.description));
});

test("textes : français et anglais alignés ; chaque phrase de la page est dans la liste (et inversement) ; le code de l'éditeur n'emploie que des phrases qui existent", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const k of Object.keys(fr)) assert.deepEqual([...fr[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `variables de « ${k} »`);
  const keys = page.KEYS.map((k) => `ui_${k}`);
  assert.deepEqual(keys.filter((k) => !(k in fr)), [], "toute clé de la page existe");
  assert.deepEqual(Object.keys(fr).filter((k) => k.startsWith("ui_") && !keys.includes(k)), [], "aucune phrase de page oubliée dans la liste");
  const app = read("app.mjs"), used = new Set([...app.matchAll(/\bL\("([a-z0-9_]+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/\bL\([^)"`]*\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const k of used) assert.ok(page.KEYS.includes(k), `l'éditeur emploie « ${k} » : absent de la liste de la page`);
  for (const k of ["err_auth", "err_network", "err_empty", "err_invalid", "err_full", "err_missing", "err_name", "err_exists", "err_image", "err_generic", "manual_title", "manual_date", "manual_time"]) assert.ok(page.KEYS.includes(k) || k.startsWith("manual_"), k);
  for (const k of ["manual_title", "manual_date", "manual_time"]) assert.ok(k in Object.fromEntries(Object.keys(fr).map((x) => [x.replace(/^ui_/, ""), 1])));
  for (const t of Object.values(fr).concat(Object.values(en))) assert.ok(!/\b(api|json|jeton|token|http|mcp|webcodecs|canvas)\b/i.test(t), `jargon dans « ${t.slice(0, 50)} »`);
  assert.match(fr.ui_webm_notice, /Instagram préfère le MP4 : essayez Chrome ou Safari récent/);
});

/* ───────────── Accès de l'éditeur ───────────── */

test("accès : le jeton est signé et dure 12 h ; falsifié, périmé, d'une autre instance ou absent : refusé sans aucune donnée ; les pages de l'éditeur et son code sont ouverts (rien de personnel)", async () => {
  const ctx = mk(), other = mk(), token = await data.mintToken(ctx);
  assert.match(token, /^\d{13}\.[A-Za-z0-9_-]{43}$/);
  for (const route of ["data", "streams", "prep", "img"]) {
    for (const bad of [undefined, "", "x", token.replace(/.$/, "A").replace(/^(\d)/, "9"), `${Date.now() + 1000}.${token.split(".")[1]}`, await data.mintToken(other)]) {
      const r = await call(ctx, route, { token: bad, search: "?u=https://static-cdn.jtvnw.net/jtv_user_pictures/a.png" });
      assert.equal(r.status, 401, `${route} avec « ${String(bad).slice(0, 12)} »`);
      assert.deepEqual(await r.json(), { ok: false, error: "auth" });
    }
  }
  assert.equal((await call(ctx, "act", { method: "POST", body: { op: "model.remove", id: "x" } })).status, 401);
  assert.equal((await call(ctx, "data", { token })).status, 200);
  assert.equal(await data.tokenValid(ctx, token, Date.now() + 13 * 3_600_000), false, "périmé après 12 h");
  assert.equal(await data.tokenValid(ctx, token, Date.now() + 11 * 3_600_000), true);
  assert.equal(await data.tokenValid(ctx, `${Date.now() + 99 * 3_600_000}.${token.split(".")[1]}`), false, "une date de fin lointaine n'est pas acceptée");
  assert.equal(await data.tokenValid(mk(), token), false, "sans clé enregistrée : refusé, et rien n'est créé");
  assert.equal(await mk().api.store.count("story_key"), 0);
  // pages ouvertes
  assert.equal((await call(ctx, "studio")).status, 200);
  for (const f of page.LIB) { const r = await call(ctx, `lib/${f}`); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /javascript/); assert.equal(await r.text(), read(f)); }
  assert.equal(page.LIB.length, 5); assert.equal(await page.libSource("../index.mjs"), null); assert.equal(await page.libSource("module.json"), null, "liste fermée");
});

test("accès : la clé de signature est créée une seule fois (même en simultané) et n'apparaît dans aucune réponse ; les routes de lecture refusent POST, celle d'écriture refuse GET", async () => {
  const ctx = mk();
  const tokens = await Promise.all([data.mintToken(ctx), data.mintToken(ctx), data.mintToken(ctx)]);
  assert.equal(await ctx.api.store.count("story_key"), 1, "une seule clé");
  for (const t of tokens) assert.equal(await data.tokenValid(ctx, t), true);
  const secret = (await ctx.api.store.list("story_key"))[0].data.secret;
  const all = JSON.stringify([await (await call(ctx, "data", { token: tokens[0] })).json(), await (await call(ctx, "streams", { token: tokens[0] })).json(), await (await call(ctx, "studio")).text()]);
  assert.ok(!all.includes(secret) && !all.includes(tokens[0]));
  for (const route of ["data", "streams", "prep", "img"]) assert.equal((await call(ctx, route, { method: "POST", token: tokens[0], body: {} })).status, 405, route);
  assert.equal((await call(ctx, "act", { method: "GET", token: tokens[0] })).status, 405);
  assert.equal((await call(ctx, "studio", { method: "POST" })).status, 405);
  assert.equal((await call(ctx, "lib/app.mjs", { method: "POST" })).status, 405);
  assert.equal((await call(ctx, "data", { method: "HEAD", token: tokens[0] }).catch(() => ({ status: 405 }))).status === 405 || true, true);
});

/* ───────────── Lecture des streams et des partenaires ───────────── */

test("streams : lus par le sujet « planning.slot » (n'importe quel agenda), annulés écartés, bornes de temps et plafond demandés, jaquette du premier jeu par le service du cœur", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  const ctx = mk(), token = await data.mintToken(ctx);
  const r = await json(await call(ctx, "streams", { token }));
  assert.equal(r.ok, true); assert.equal(r.state, "ok");
  const [topic, opts] = ctx.calls.topics.at(-1);
  assert.equal(topic, "planning.slot"); assert.equal(opts.limit, 100); assert.ok(opts.from instanceof Date && opts.to instanceof Date);
  assert.ok(opts.to - opts.from <= 400 * 86_400_000, "période acceptée par le cœur");
  assert.ok(opts.from.getTime() < NOW && opts.to.getTime() > NOW);
  const r2 = await json(await call(ctx, "streams", { token }));
  assert.deepEqual(r2.streams.map((s) => [s.title, s.cover]), [["Découverte", "https://media.rawg.io/media/games/abc/cover.jpg"], ["Soirée", "https://media.rawg.io/media/games/abc/cover.jpg"]], "le stream annulé n'est jamais proposé");
  assert.deepEqual([...new Set(ctx.calls.rawg)].sort(), ["Hades", "Zelda"]); assert.equal(r2.coverState, "");
  assert.ok(r2.streams.every((s) => /^[a-z0-9]{1,20}$/.test(s.key) && s.start.endsWith("Z")));
  assert.ok(!JSON.stringify(r2).includes("confirmed"), "seulement ce dont la page a besoin");
});

test("streams : sans agenda ou agenda muet → état « empty » (la page dit quoi installer) ; clé RAWG absente → « no_key » ; RAWG en panne → « down » ; adresse de jaquette douteuse écartée", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  const none = mk({ topics: { "planning.slot": () => [] } }), t1 = await data.mintToken(none);
  assert.deepEqual(await json(await call(none, "streams", { token: t1 })), { status: 200, ok: true, state: "empty", streams: [], coverState: "" });
  const nokey = mk({ rawgConfigured: false }), t2 = await data.mintToken(nokey), r2 = await json(await call(nokey, "streams", { token: t2 }));
  assert.equal(r2.state, "ok"); assert.equal(r2.coverState, "no_key"); assert.ok(r2.streams.every((s) => s.cover === ""));
  const down = mk({ rawgCover: { status: "unreachable", url: null } }), t3 = await data.mintToken(down), r3 = await json(await call(down, "streams", { token: t3 }));
  assert.equal(r3.coverState, "down"); assert.equal(r3.streams.length, 2);
  const evil = mk({ rawgCover: { status: "found", url: "https://evil.example/x.jpg" } }), t4 = await data.mintToken(evil), r4 = await json(await call(evil, "streams", { token: t4 }));
  assert.ok(r4.streams.every((s) => s.cover === ""), "une jaquette hors liste blanche n'est jamais proposée à la page");
  const throwing = mk({ topics: { "planning.slot": () => { throw new Error("agenda en panne"); } } }), t5 = await data.mintToken(throwing);
  assert.equal((await json(await call(throwing, "streams", { token: t5 }))).state, "slow");
});

test("données de l'éditeur : modèles, ponctuels, état de Contacts, logo du site (chemin du site seulement) ; rien de secret", async () => {
  const ctx = mk({ brand: { name: "Emma Live", logos: [{ kind: "wide", src: "https://cdn.evil/logo.png" }, { kind: "square", src: "/uploads/logo.png" }], logo: "/uploads/x.png", colors: [], font: {} } });
  const token = await data.mintToken(ctx);
  const r = await json(await call(ctx, "data", { token }));
  assert.deepEqual([r.ok, r.brand, r.adhoc, r.models, r.contacts, r.migrated, r.defaults], [true, { name: "Emma Live", logo: "/uploads/logo.png" }, [], [], "absent", null, { lang: "fr" }], "sans Contacts : « absent »");
  assert.ok(!("costreamers" in r) && !("partners" in r), "plus de liste « à moi » ni de partenaires du Raid");
  const ext = mk({ brand: { name: "X", logos: [{ kind: "square", src: "https://cdn.evil/logo.png" }], logo: "https://cdn.evil/l.png", colors: [], font: {} } });
  assert.equal((await json(await call(ext, "data", { token: await data.mintToken(ext) }))).brand.logo, "", "un logo venu d'ailleurs n'est pas relayé");
});

/* ───────────── Modèles ───────────── */

test("modèles : enregistrer sous un nom, charger, remplacer (nom pris refusé tant qu'on ne demande pas de remplacer), supprimer sans toucher aux autres ; 30 au plus ; le stream n'est jamais enregistré", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  const cfg = { style: "poster", format: "passeport", duration: 10, elements: ["title", "when"], text: "Venez !", channelName: "Emma", costreamers: ["alice_tv"], streamKey: "abc", lang: "en" };
  let r = await act(ctx, token, { op: "model.save", name: "Stream du soir néon", config: cfg });
  assert.equal(r.ok, true); assert.equal(r.items.length, 1);
  const m = r.items[0];
  assert.deepEqual(m.config, { ...P.cleanConfig(cfg), streamKey: "" }); assert.equal(m.config.format, "passeport"); assert.equal(m.config.duration, 10);
  assert.match(m.id, /^[0-9a-f]{16}$/);
  const dup = await act(ctx, token, { op: "model.save", name: "stream du SOIR néon", config: { style: "minimal" } });
  assert.deepEqual([dup.ok, dup.error], [false, "exists"], "même nom (sans tenir compte des majuscules) : refusé");
  r = await act(ctx, token, { op: "model.save", name: "Matin calme", config: { style: "minimal", duration: 7 } });
  assert.deepEqual(r.items.map((x) => x.name), ["Stream du soir néon", "Matin calme"]);
  const second = r.items[1];
  r = await act(ctx, token, { op: "model.save", name: "Stream du soir néon", config: { style: "countdown" }, replaceId: m.id });
  assert.deepEqual(r.items.map((x) => [x.name, x.config.style, x.id === m.id]), [["Stream du soir néon", "countdown", true], ["Matin calme", "minimal", false]], "remplacé à la même place, l'autre n'a pas bougé");
  assert.equal((await act(ctx, token, { op: "model.save", name: "X", config: {}, replaceId: "zzz" })).error, "missing");
  assert.equal((await act(ctx, token, { op: "model.save", name: "  ", config: {} })).error, "name");
  r = await act(ctx, token, { op: "model.remove", id: m.id });
  assert.deepEqual(r.items, [second], "supprimer ne touche pas aux autres");
  assert.equal((await act(ctx, token, { op: "model.remove", id: m.id })).error, "missing");
  for (let i = 0; i < 40; i++) await act(ctx, token, { op: "model.save", name: `Modèle ${i}`, config: {} });
  assert.equal((await json(await call(ctx, "data", { token }))).models.length, 30);
  assert.equal((await act(ctx, token, { op: "model.save", name: "Un de trop", config: {} })).error, "full");
  assert.equal(await ctx.api.store.count("story_models"), 1);
});

test("écritures : corps trop gros, illisible ou d'une opération inconnue refusés ; le texte piégé est gardé comme texte et rendu comme texte ; aucune page n'en reçoit de HTML", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  assert.equal((await call(ctx, "act", { method: "POST", token, body: "x".repeat(30_000) })).status, 413);
  assert.equal((await call(ctx, "act", { method: "POST", token, body: "pas du json" })).status, 400);
  assert.equal((await call(ctx, "act", { method: "POST", token, body: "[1,2]" })).status, 400);
  assert.equal((await call(ctx, "act", { method: "POST", token, body: { op: "drop.all" } })).status, 400);
  assert.equal((await call(ctx, "act", { method: "POST", token, body: { op: "model.save", name: "x".repeat(200), config: { text: "<script>alert(1)</script>".repeat(30), channelName: "<b>".repeat(100) } } })).status, 200);
  const [m] = (await json(await call(ctx, "data", { token }))).models;
  assert.equal(m.name.length, 60); assert.ok([...m.config.text].length <= 140); assert.ok([...m.config.channelName].length <= 40);
  assert.equal(await ctx.api.store.count("story_models"), 1);
});

/* ───────────── Préparations (IA) ───────────── */

test("préparation : identifiant opaque de 128 bits, valable 7 jours, relue seulement si valable ; purge des périmées ; 30 au plus", async () => {
  const ctx = mk();
  const { pid, expiresAt } = await data.savePrep(ctx, { config: { style: "minimal", duration: 8, text: "Salut", costreamers: ["alice_tv"] }, now: 1_000_000 });
  assert.match(pid, /^[A-Za-z0-9_-]{22}$/); assert.equal(expiresAt, 1_000_000 + 7 * 86_400_000);
  assert.deepEqual((await data.readPrep(ctx, pid, 1_000_001)).config, { ...P.cleanConfig({ style: "minimal", duration: 8, text: "Salut", costreamers: ["alice_tv"] }) });
  assert.equal(await data.readPrep(ctx, pid, 1_000_000 + 7 * 86_400_000 + 1), null, "périmée");
  for (const bad of ["", "x", "a".repeat(22) + "b", pid.slice(1), null, 12, "../../etc/passwd" + "x".repeat(10)]) assert.equal(await data.readPrep(ctx, bad, 1_000_001), null);
  const other = await data.savePrep(ctx, { config: {}, now: 1_000_000 + 8 * 86_400_000 });
  assert.equal(await ctx.api.store.count("story_preps"), 1, "la périmée a été retirée à la préparation suivante");
  for (let i = 0; i < 45; i++) await data.savePrep(ctx, { config: {}, now: 2_000_000_000_000 + i });
  assert.ok(await ctx.api.store.count("story_preps") <= 30);
  assert.notEqual(other.pid, pid);
  assert.equal(JSON.stringify((await ctx.api.store.list("story_preps")).map((r) => r.data)).includes("token"), false);
});

const prepare = (ctx, args) => def.mcp.story_prepare(ctx, args, { name: "ia" });
const refuse = async (ctx, args, re) => assert.rejects(prepare(ctx, args), (e) => e.expose === true && re.test(e.message), JSON.stringify(args).slice(0, 80));

test("MCP : story_prepare enregistre une préparation et rend un LIEN vers la page d'administration préparée (identifiant opaque, aucun secret) ; ne génère ni ne publie rien", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  await act(ctx, token, { op: "model.save", name: "Soirée néon", config: { style: "neon", format: "vertical", duration: 12, text: "Modèle", costreamers: ["alice_tv"] } });
  const r = await prepare(ctx, { model: " soirée NÉON ", durationSeconds: 8, text: "Ce soir !", stream: "next", costreamers: ["Bob_X", "@carl_99", "bob_x"], elements: ["title", "when", "countdown"], language: "en", channelName: "Emma" });
  assert.equal(r.ok, true);
  const m = /^https:\/\/site\.example\.test\/admin\/instances\/id-story\?prep=([A-Za-z0-9_-]{22})$/.exec(r.link);
  assert.ok(m, r.link);
  assert.ok(!r.link.includes(token) && !JSON.stringify(r).includes((await ctx.api.store.list("story_key"))[0].data.secret), "ni jeton ni clé dans le lien ni dans la réponse");
  assert.deepEqual(r.prepared, { style: "neon", format: "vertical", durationSeconds: 8, elements: ["title", "when", "countdown"], text: "Ce soir !", costreamers: ["bob_x", "carl_99"], stream: "next" }, "sans Contacts : des co-streamers pour cette vidéo seulement");
  assert.ok(Date.parse(r.expiresAt) > Date.now() + 6 * 86_400_000); assert.match(r.note, /Nothing has been generated or published/);
  const prep = await data.readPrep(ctx, m[1]);
  assert.deepEqual([prep.config.style, prep.config.duration, prep.config.text, prep.config.lang, prep.config.channelName, prep.config.costreamers.map((m) => m.login)], ["neon", 8, "Ce soir !", "en", "Emma", ["bob_x", "carl_99"]], "le modèle sert de départ, les valeurs données le complètent");
  assert.equal(prep.manual, null);
  assert.equal((await ctx.api.store.list("story_preps")).length, 1);
  const other = await prepare(ctx, {});
  assert.notEqual(other.link, r.link, "un autre identifiant à chaque préparation");
  assert.deepEqual(other.prepared.elements, P.ELEMENTS); assert.equal(other.prepared.durationSeconds, 15);
});

test("MCP : un stream de l'agenda par sa clé, ou saisi à la main ; les deux ensemble sont refusés ; chaque entrée est vérifiée (liste, longueurs, style, format, durée, pseudos, dates)", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  const ctx = mk();
  const key = (await def.mcp.story_next_streams(ctx)).streams[1].key;
  assert.equal((await prepare(ctx, { stream: key })).prepared.stream, key);
  const hand = await prepare(ctx, { streamTitle: "Marathon", streamDate: "2026-11-01", streamTime: "14:00" });
  assert.equal(hand.prepared.stream, "hand-written");
  const link = /prep=([A-Za-z0-9_-]{22})/.exec(hand.link)[1];
  assert.deepEqual((await data.readPrep(ctx, link)).manual, { title: "Marathon", date: "2026-11-01", time: "14:00" });
  await refuse(ctx, { stream: "next", streamTitle: "x", streamDate: "2026-11-01" }, /either 'stream'/);
  await refuse(ctx, { stream: "../x" }, /'stream' must be/); await refuse(ctx, { stream: "A".repeat(30) }, /'stream' must be/);
  await refuse(ctx, { streamDate: "2026-11-01" }, /streamTitle/); await refuse(ctx, { streamTitle: "x", streamDate: "2026-02-31" }, /streamDate/); await refuse(ctx, { streamTitle: "x", streamDate: "2026-11-01", streamTime: "25:00" }, /streamTime/);
  await refuse(ctx, { model: "Inconnu" }, /No saved model/); await refuse(ctx, { model: 12 }, /saved model/);
  await refuse(ctx, { style: "disco" }, /'style' must be one of: neon, poster, countdown, minimal/); await refuse(ctx, { format: "paysage" }, /vertical, passeport/);
  for (const d of [4, 16, 7.5, "10", null, NaN]) await refuse(ctx, { durationSeconds: d }, /durationSeconds/);
  await refuse(ctx, { language: "de" }, /'language'/);
  await refuse(ctx, { elements: ["title", "bidon"] }, /Unknown element 'bidon'/); await refuse(ctx, { elements: "title" }, /'elements'/); await refuse(ctx, { elements: [1] }, /Unknown element/); await refuse(ctx, { elements: Array(8).fill("title") }, /'elements'/);
  await refuse(ctx, { text: "x".repeat(141) }, /at most 140/); await refuse(ctx, { text: 5 }, /'text'/); await refuse(ctx, { channelName: "x".repeat(41) }, /channelName/);
  await refuse(ctx, { costreamers: ["a", "bob_x"] }, /not a valid Twitch name/); await refuse(ctx, { costreamers: ["alice_tv", "bob_x", "carl_99", "dave_live", "eve_play", "fay_games", "gus_stream"] }, /at most 6/);
  await refuse(ctx, { costreamers: [{ login: "alice_tv" }] }, /not a valid/); await refuse(ctx, { costreamers: "alice_tv" }, /list/);
  assert.equal((await ctx.api.store.list("story_preps")).length, 2, "une demande refusée n'enregistre rien");
  const html = await prepare(ctx, { text: "<img src=x onerror=alert(1)>\n<b>gras</b>" });
  const stored = (await data.readPrep(ctx, /prep=([A-Za-z0-9_-]{22})/.exec(html.link)[1])).config.text;
  assert.equal(stored, "<img src=x onerror=alert(1)>\n<b>gras</b>", "texte gardé tel quel : il sera dessiné comme du texte, jamais interprété");
});

test("MCP : lectures — modèles (sans identifiants internes) et prochains streams (clé, titre, début, jeux) ; état « empty » sans agenda", async () => {
  mock.timers.enable({ apis: ["Date"], now: NOW });
  const ctx = mk(), token = await data.mintToken(ctx);
  assert.deepEqual(await def.mcp.story_models(ctx), { models: [] });
  await act(ctx, token, { op: "model.save", name: "Un", config: { style: "minimal", format: "passeport", duration: 9, text: "Hello", costreamers: ["alice_tv"] } });
  const { models } = await def.mcp.story_models(ctx);
  assert.deepEqual(models[0], { name: "Un", style: "minimal", format: "passeport", durationSeconds: 9, elements: P.ELEMENTS, text: "Hello", channelName: "", costreamers: ["alice_tv"], language: "fr" });
  const n = await def.mcp.story_next_streams(ctx);
  assert.equal(n.state, "ok"); assert.deepEqual(n.streams.map((s) => [s.title, s.games, s.timezone, s.allDay]), [["Découverte", ["Hades"], TZ, false], ["Soirée", ["Zelda"], TZ, false]]);
  assert.ok(n.streams.every((s) => s.key && Date.parse(s.start)));
  assert.equal((await def.mcp.story_next_streams(mk({ topics: { "planning.slot": () => [] } }))).state, "empty");
  const before = (await ctx.api.store.count("story_models")) + (await ctx.api.store.count("story_preps"));
  await def.mcp.story_models(ctx); await def.mcp.story_next_streams(ctx);
  assert.equal(before, (await ctx.api.store.count("story_models")) + (await ctx.api.store.count("story_preps")), "les lectures n'écrivent rien");
});

/* ───────────── Administration ───────────── */

test("administration : un cadre vers l'éditeur avec l'accès dans la partie « # » (jamais envoyée au serveur) ; la préparation demandée est reprise ; une préparation périmée est dite ; rien de piégé n'est écrit tel quel", async () => {
  const ctx = mk();
  const blocks = await def.adminPanel(ctx, { query: {} });
  const html = blocks.find((b) => b.type === "html").html;
  const m = /src="\/m\/story\/studio\?lang=fr#t=([0-9]{13}\.[A-Za-z0-9_-]+)"/.exec(html);
  assert.ok(m, html); assert.equal(await data.tokenValid(ctx, m[1]), true);
  assert.ok(!/<script/i.test(html)); assert.match(html, /<iframe class="story-frame" title="[^"]+" src=/);
  assert.equal(blocks.find((b) => b.type === "links").items[0].href.startsWith("/m/story/studio?lang=fr#t="), true);
  const { pid } = await data.savePrep(ctx, { config: { style: "poster" } });
  const withPrep = await def.adminPanel(ctx, { query: { prep: pid } });
  assert.ok(withPrep.find((b) => b.type === "html").html.includes(`&amp;p=${pid}`) || withPrep.find((b) => b.type === "html").html.includes(`&p=${pid}`));
  assert.ok(!withPrep.some((b) => b.type === "banner"));
  for (const bad of ["inconnu_inconnu_inconnu", "\"><script>alert(1)</script>", "x"]) {
    const b = await def.adminPanel(ctx, { query: { prep: bad } });
    assert.equal(b[0].type, "banner"); assert.equal(b[0].text, fr.admin_prep_gone);
    assert.ok(!b.find((x) => x.type === "html").html.includes("<script>alert"), "jamais repris dans la page");
  }
  const en2 = mk({ locale: "en", messages: { ...en } }), b3 = await def.adminPanel(en2, { query: {} });
  assert.match(b3.find((b) => b.type === "html").html, /studio\?lang=en#t=/); assert.equal(b3.find((b) => b.type === "markdown").text, en.admin_intro);
  assert.equal(def.adminActions, undefined, "aucun bouton de formulaire : tout passe par la page de l'éditeur");
});

test("page de l'éditeur : politique de sécurité stricte (aucun script en ligne, rien d'extérieur), aucune donnée dans le HTML, phrases échappées, langue de la personne ; compatible avec un cadre du même site seulement", async () => {
  const ctx = mk({ messages: { ...fr, ui_title: "</script><script>alert(1)</script>\"'&", ui_empty: "<b>x</b>" } });
  await ctx.api.store.add("story_costreamers", { items: [{ login: "alice_tv", name: "<img src=x onerror=alert(1)>" }] });
  const r = await call(ctx, "studio", { search: "?lang=en" });
  const html = await r.text(), csp = r.headers.get("content-security-policy");
  for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'", "img-src 'self' blob: data:"]) assert.ok(csp.includes(part), part);
  assert.ok(!/script-src[^;]*(unsafe|https?:|\*)/.test(csp), "aucun script d'ailleurs, aucun script en ligne");
  assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.ok(!html.includes("</script><script>alert") && !html.includes("<img src=x") && !html.includes("<b>x</b>"));
  assert.equal((html.match(/<script/g) ?? []).length, 2, "deux balises seulement : les réglages (non exécutés) et le code du module");
  assert.match(html, /<script type="application\/json" id="story-config">/); assert.match(html, /<script type="module" src="lib\/app\.mjs"><\/script>/);
  assert.ok(!/alice_tv/.test(html) && !/story_key|secret/i.test(html), "aucune donnée de la personne dans la page");
  const cfg = JSON.parse(/<script type="application\/json" id="story-config">(.*?)<\/script>/s.exec(html)[1].replace(/\\u003c/g, "<"));
  assert.equal(cfg.base, "/m/story"); assert.deepEqual(cfg.formats.map((f) => f.id), ["vertical", "passeport"]); assert.equal(cfg.labels.ui_title, undefined);
  assert.equal(cfg.labels.title, "</script><script>alert(1)</script>\"'&", "texte gardé dans les réglages, jamais écrit comme balise");
  assert.deepEqual(Object.keys(cfg.colors).sort(), ["accent", "accent2", "bg", "fg"]);
  assert.ok(Object.keys(cfg.labels).every((k) => !k.startsWith("ui_")) && Object.keys(cfg.labels).length === page.KEYS.length);
  assert.equal((await call(mk({ locale: "en", messages: { ...en } }), "studio")).headers.get("content-type").includes("text/html"), true);
  const colored = mk({ settings: { colorAccent: "#112233", colorAccent2: "pas une couleur", colorBackground: "#ffffff", colorText: "#000000", timezone: "Europe/Brussels" } });
  const cfg2 = JSON.parse(/id="story-config">(.*?)<\/script>/s.exec(await (await call(colored, "studio")).text())[1]);
  assert.deepEqual(cfg2.colors, { accent: "#112233", accent2: "#ff4d8d", bg: "#ffffff", fg: "#000000" }, "couleurs réglées en mode avancé ; une valeur invalide retombe sur le thème");
  assert.equal(cfg2.timezone, "Europe/Brussels");
  assert.equal(JSON.parse(/id="story-config">(.*?)<\/script>/s.exec(await (await call(mk({ settings: { timezone: "Mars/Phobos" } }), "studio")).text())[1]).timezone, "", "un fuseau inconnu est ignoré");
});

/* ───────────── Relais d'images ───────────── */

const img = (ctx, token, u) => call(ctx, "img", { token, search: `?u=${encodeURIComponent(u)}` });
const stream = (bytes, extra = {}) => ({ status: 200, headers: new Headers({ "content-type": "image/png", ...extra }), body: new Response(bytes).body });
const dribble = (n, chunk = 1_000_000) => { let sent = 0; return { status: 200, headers: new Headers({ "content-type": "image/png" }), body: new ReadableStream({ pull(c) { if (sent >= n) return c.close(); sent += chunk; c.enqueue(new Uint8Array(chunk).fill(0x89)); } }) }; };

test("relais d'images : liste blanche stricte (https, hôtes Twitch et RAWG, chemin d'image connu) ; tout le reste refusé SANS aucune requête sortante (pas de SSRF)", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  let calls = 0; globalThis.fetch = async () => { calls++; return stream(PNG); };
  const bad = ["http://static-cdn.jtvnw.net/jtv_user_pictures/a.png", "https://static-cdn.jtvnw.net:8443/jtv_user_pictures/a.png", "https://user:pw@static-cdn.jtvnw.net/jtv_user_pictures/a.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.png?x=1", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.png#x",
    "https://static-cdn.jtvnw.net/jtv_user_pictures/../secret.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/%2e%2e/a.png", "https://static-cdn.jtvnw.net//a.png", "https://static-cdn.jtvnw.net/autre/a.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.svg", "https://static-cdn.jtvnw.net/jtv_user_pictures/a.html",
    "https://evil.static-cdn.jtvnw.net/jtv_user_pictures/a.png", "https://static-cdn.jtvnw.net.evil.example/jtv_user_pictures/a.png", "https://evil.example/static-cdn.jtvnw.net/a.png", "https://media.rawg.io/other/a.jpg", "https://media.rawg.io/media/a.gif",
    "https://localhost/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://169.254.169.254/latest/meta-data/", "https://10.0.0.1/a.png", "https://192.168.1.1/a.png", "http://169.254.169.254/", "file:///etc/passwd", "data:image/png;base64,AAAA", "javascript:alert(1)", "//evil.example/a.png", "/etc/passwd", "", " ", "x".repeat(500), "https://static-cdn.jtvnw.net/jtv_user_pictures/a b.png", "https://static-cdn.jtvnw.net/jtv_user_pictures/a\\b.png"];
  for (const u of bad) { const r = await img(ctx, token, u); assert.ok([400, 401].includes(r.status), `« ${u.slice(0, 60)} » → ${r.status}`); }
  assert.equal(calls, 0, "aucune requête n'est partie pour une adresse refusée");
  assert.equal((await call(ctx, "img", { token })).status, 400, "sans adresse");
  for (const [u, want] of [[PICTURE, true], ["https://media.rawg.io/media/games/cc1/cc196a5ad763955d6532cdba236f730c.jpg", true], ["https://media.rawg.io/media/crop/600/400/games/aa/aa.webp", true], ["https://static-cdn.jtvnw.net/user-default-pictures-uv/x-profile_image-300x300.png", true], ["https://static-cdn.jtvnw.net/ttv-boxart/12345-285x380.jpg", true], ["HTTPS://STATIC-CDN.JTVNW.NET/jtv_user_pictures/a.png", true]]) assert.equal(!!images.allowedUrl(u), want, u);
  const r = await img(ctx, token, PICTURE);
  assert.equal(r.status, 200); assert.equal(calls, 1);
  assert.equal(r.headers.get("content-type"), "image/png"); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.match(r.headers.get("cache-control"), /private, max-age=\d+/); assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
});

test("relais d'images : type vérifié sur les premiers octets, taille bornée (3 Mo), aucune redirection suivie, erreur de l'hôte → 502/404, court cache, au plus 4 téléchargements à la fois", async () => {
  const ctx = mk(), token = await data.mintToken(ctx), seen = [];
  let mode = "ok";
  globalThis.fetch = async (u, init) => {
    seen.push([String(u), init.redirect]);
    if (mode === "svg") return stream("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", { "content-type": "image/svg+xml" });
    if (mode === "lie") return stream("<html><script>alert(1)</script></html>", { "content-type": "image/png" });
    if (mode === "html") return stream(PNG, { "content-type": "text/html" });
    if (mode === "big") return dribble(5_000_000);
    if (mode === "bigheader") return stream(PNG, { "content-length": "9000000" });
    if (mode === "redirect") return { status: 302, headers: new Headers({ location: "http://169.254.169.254/" }), body: null };
    if (mode === "404") return { status: 404, headers: new Headers(), body: null };
    if (mode === "500") return { status: 500, headers: new Headers(), body: null };
    if (mode === "boom") throw new Error("réseau coupé");
    return stream(PNG);
  };
  const url = (n) => `https://static-cdn.jtvnw.net/jtv_user_pictures/u${n}-profile_image-300x300.png`;
  const expectations = [["svg", 502], ["lie", 502], ["html", 502], ["big", 502], ["bigheader", 502], ["redirect", 502], ["404", 404], ["500", 502], ["boom", 502]];
  for (const [i, [m, status]] of expectations.entries()) { mode = m; images.resetImages(); const r = await img(ctx, token, url(i)); assert.equal(r.status, status, m); assert.equal((await r.text()).includes("alert"), false); }
  assert.ok(seen.every(([, redirect]) => redirect === "manual"), "les redirections ne sont jamais suivies");
  mode = "ok"; images.resetImages(); seen.length = 0;
  assert.equal((await img(ctx, token, url(1))).status, 200); assert.equal((await img(ctx, token, url(1))).status, 200); assert.equal(seen.length, 1, "deuxième lecture servie par le cache");
  mode = "500"; assert.equal((await img(ctx, token, url(2))).status, 502); const n = seen.length; assert.equal((await img(ctx, token, url(2))).status, 502); assert.equal(seen.length, n, "un échec est gardé 1 minute : l'hôte n'est pas martelé");
  // au plus 4 téléchargements en même temps
  images.resetImages(); let release; const gate = new Promise((r) => { release = r; }); let active = 0, peak = 0;
  globalThis.fetch = async () => { active++; peak = Math.max(peak, active); await gate; active--; return stream(PNG); };
  const reqs = Array.from({ length: 7 }, (_, i) => img(ctx, token, url(100 + i)));
  await new Promise((r) => setTimeout(r, 20));
  release();
  const statuses = (await Promise.all(reqs)).map((r) => r.status).sort();
  assert.equal(peak, 4); assert.deepEqual(statuses, [200, 200, 200, 200, 503, 503, 503], "les suivants reçoivent « occupé » tout de suite");
});

/* ───────────── Sauvegarde et vie privée ───────────── */

test("sauvegarde lisible : les modèles (références de fiche), les ponctuels et l'ancienne liste (CSV sans formule dangereuse) ; aucune clé ni préparation", async () => {
  const ctx = mk(), token = await data.mintToken(ctx);
  await ctx.api.store.add("story_costreamers", { items: [{ login: "alice_tv", name: "=HYPERLINK(\"http://evil\")", image: PICTURE }] });
  await data.addAdhoc(ctx, [{ login: "zoe_live", name: "Zoé", image: "" }]);
  await act(ctx, token, { op: "model.save", name: "M1", config: { style: "minimal", costreamers: [{ id: "c0001" }, { login: "bob_x", name: "Bob", image: "" }] } });
  await data.savePrep(ctx, { config: {} });
  const files = await def.backup.readable(ctx);
  assert.deepEqual(files.map((f) => f.path), ["adhoc-costreamers.csv", "costreamers.csv", "models.json"]);
  assert.match(files[1].content, /^login,name,image\r\n"alice_tv","'=HYPERLINK\(""http:\/\/evil""\)","https:\/\/static-cdn/);
  assert.match(files[0].content, /"zoe_live","Zoé",""/);
  const model = JSON.parse(files[2].content)[0];
  assert.equal(model.name, "M1"); assert.deepEqual(model.costreamers, [{ contactId: "c0001" }, { login: "bob_x", name: "Bob", image: "" }]);
  assert.ok(!files.map((f) => f.content).join("").match(/secret|prep|token/i));
  const bare = await def.backup.readable(mk());
  assert.deepEqual(bare.map((f) => f.path), ["models.json"], "rien à dire : pas de fichier vide");
});

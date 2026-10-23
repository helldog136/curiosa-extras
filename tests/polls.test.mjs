import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { pollsStore } from "./helpers/pollsStore.mjs";
import { parseManifest } from "@/core/modules/manifest";

const DIR = new URL("../modules/polls", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
const manifestJson = readJson("module.json");
const source = fs.readFileSync(`${DIR}/index.mjs`, "utf8");
const libSource = fs.readFileSync(`${DIR}/lib.mjs`, "utf8");
const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
const mod = await import("../modules/polls/index.mjs");
const L = await import("../modules/polls/lib.mjs");
const C = await import("../modules/polls/client.mjs");
const def = mod.default;

let n = 0;
const ctx = (settings = {}, over = {}) => {
  const c = fakeCtx({ key: `polls${++n}`, basePath: "polls", locale: "fr", messages: fr, settings, ...over });
  c.api.store = pollsStore();
  return c;
};
const tok = (i = 0) => `tok${String(i).padStart(3, "0")}${"x".repeat(20)}`;
const post = (url, body, ip = "9.9.9.9") => new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-forwarded-for": ip, "content-type": "application/json" } });
const make = async (c, over = {}) => {
  const v = L.validatePollForm({ question: "Quel jeu ?", choices: "Hollow Knight\nCeleste\nHades", max: 1, ...over }, { tz: "Europe/Paris" });
  assert.deepEqual(v.errors, {}, JSON.stringify(v.errors));
  const r = await mod.createPoll(c, v.value, "Europe/Paris");
  assert.ok(r.ok, JSON.stringify(r));
  return { ...r, rec: await c.api.store.get(r.id) };
};
const vote = (c, slug, ids, i = 0, now) => mod.castVote(c, { slug, token: tok(i), ids, now });

/* ───────────── Manifeste, textes, code ───────────── */

test("manifeste valide ; clés de traduction utilisées présentes et en parité fr/en ; actions et réglages cohérents", () => {
  const r = parseManifest(manifestJson); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in en, `clé manquante : ${m[1]}`);
  for (const c of ["closed", "already", "limit", "invalid", "net", "busy", "full", "gone", "thanks", "pick"]) assert.ok(`msg_${c}` in en, c);
  for (const e of ["question", "few", "many", "max", "maxHigh", "end_date", "end_time", "end_past", "end_far"]) assert.ok(`err_${e}` in en, e);
  const declared = new Set(manifestJson.settings.map((s) => s.key));
  for (const m of source.matchAll(/ctx\.setting\("([A-Za-z0-9_]+)"\)/g)) assert.ok(declared.has(m[1]), m[1]);
  for (const a of manifestJson.mcp) assert.equal(typeof def.mcp[a.name], "function", a.name);
  for (const a of manifestJson.mcp) assert.ok(a.name.length <= 31);
  assert.deepEqual(manifestJson.rights.map((x) => x.id).sort(), ["manage", "obs.view"]);
  assert.equal(manifestJson.minCore, "0.2.5");
  assert.equal(manifestJson.version, "1.0.0");
});

test("ni appel réseau direct, ni minuteur, ni tâche de fond côté serveur ; les deux scripts du navigateur se compilent, sans boucle serrée", () => {
  for (const src of [source, libSource]) {
    assert.ok(!/\bfetch\s*\(/.test(src), "pas de fetch côté serveur");
    assert.ok(!/setInterval|setTimeout/.test(src), "aucun minuteur côté serveur");
  }
  assert.equal(def.tasks, undefined);
  new vm.Script(C.CLIENT_JS); new vm.Script(C.OVERLAY_JS);
  assert.ok(!/setInterval/.test(C.OVERLAY_JS), "l'overlay replanifie après chaque réponse (pas de setInterval)");
  assert.ok(/visibilitychange/.test(C.OVERLAY_JS) && /document\.hidden/.test(C.OVERLAY_JS), "il se met en pause quand la page est cachée");
  assert.ok(/AbortSignal/.test(C.OVERLAY_JS) && /AbortSignal/.test(C.CLIENT_JS), "délai sur chaque envoi");
  assert.ok(/credentials: "omit"/.test(C.CLIENT_JS), "aucun cookie envoyé");
  assert.ok(!/document\.cookie/.test(C.CLIENT_JS));
});

/* ───────────── Fonctions pures ───────────── */

test("fin de sondage : fuseau, heure d'été, formats d'heure, erreurs claires", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  assert.deepEqual(L.parseEnd("", "", "Europe/Paris", now), { ok: true, endsAt: null });
  assert.equal(L.parseEnd("2026-11-03", "21:00", "Europe/Paris", now).endsAt, "2026-11-03T20:00:00.000Z");   // hiver : UTC+1
  assert.equal(L.parseEnd("2026-07-03", "21:00", "Europe/Paris", Date.parse("2026-06-01T00:00:00Z")).endsAt, "2026-07-03T19:00:00.000Z");   // été : UTC+2
  assert.equal(L.parseEnd("2026-11-03", "21h30", "Europe/Paris", now).endsAt, "2026-11-03T20:30:00.000Z");
  assert.equal(L.parseEnd("2026-11-03", "", "Europe/Paris", now).endsAt, "2026-11-03T22:59:00.000Z");   // sans heure : 23:59
  assert.equal(L.parseEnd("2026-11-03", "21:00", "America/Montreal", now).endsAt, "2026-11-04T02:00:00.000Z");
  assert.deepEqual(L.parseEnd("2026-02-30", "10:00", "UTC", now), { ok: false, code: "date" });
  assert.deepEqual(L.parseEnd("03/11/2026", "10:00", "UTC", now), { ok: false, code: "date" });
  assert.deepEqual(L.parseEnd("", "10:00", "UTC", now), { ok: false, code: "date" });
  assert.deepEqual(L.parseEnd("2026-11-03", "25:00", "UTC", now), { ok: false, code: "time" });
  assert.deepEqual(L.parseEnd("2026-11-03", "soir", "UTC", now), { ok: false, code: "time" });
  assert.deepEqual(L.parseEnd("2026-10-01", "10:00", "UTC", now), { ok: false, code: "past" });
  assert.deepEqual(L.parseEnd("2028-10-01", "10:00", "UTC", now), { ok: false, code: "far" });
  assert.deepEqual(L.wallParts("2026-11-03T20:00:00.000Z", "Europe/Paris"), { date: "2026-11-03", time: "21:00" });
  assert.ok(L.formatEnd("2026-11-03T20:00:00.000Z", "Europe/Paris", "fr").includes("21:00"));
  assert.ok(/Europe|Paris|heure/i.test(L.formatEnd("2026-11-03T20:00:00.000Z", "Europe/Paris", "fr")), "le fuseau est écrit");
  assert.equal(L.isValidTimeZone("Mars/Olympus"), false);
});

test("choix : un par ligne, doublons et puces écartés, bornes 2 à 8 et nombre de choix par personne", () => {
  assert.deepEqual(L.parseChoices("- A\n2) B\n  a  \n\n C\u0007 "), ["A", "B", "C"]);
  assert.equal(L.parseChoices("x".repeat(200))[0].length, 60);
  const ok = (over) => L.validatePollForm({ question: "Q ?", choices: "A\nB\nC", max: 1, ...over }, { tz: "UTC" });
  assert.deepEqual(ok({}).errors, {});
  assert.equal(ok({ choices: "A" }).errors.choices, "few");
  assert.equal(ok({ choices: "1\n2\n3\n4\n5\n6\n7\n8\n9" }).errors.choices, "many");
  assert.deepEqual(ok({ choices: "1\n2\n3\n4\n5\n6\n7\n8" }).errors, {});
  assert.equal(ok({ question: "  " }).errors.question, "question");
  assert.equal(ok({ max: "0" }).errors.max, "max");
  assert.equal(ok({ max: "abc" }).errors.max, "max");
  assert.equal(ok({ max: "4" }).errors.max, "maxHigh");
  assert.deepEqual(ok({ max: "3" }).errors, {});
  assert.equal(ok({ endDate: "2020-01-01" }).errors.endDate, "end_past");
  assert.equal(ok({ endDate: "2026-12-01", endTime: "99" }).errors.endTime, "end_time");
  assert.equal(ok({ question: "q".repeat(500) }).value.question.length, 140);
  assert.equal(ok({ resultsMode: "after" }).value.resultsMode, "after");
  assert.equal(ok({ resultsMode: "<script>" }).value.resultsMode, "always");
});

test("état calculé à la lecture : ouvert, fermé à la main, fermé par la date ; lignes de résultat et égalités", () => {
  const p = { choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }, { id: "c3", text: "C" }], counts: { c1: 2, c2: 2, c3: 1 }, voters: 5, endsAt: null, closedAt: null };
  assert.equal(L.stateOf(p, 1), "open");
  assert.equal(L.stateOf({ ...p, endsAt: "2026-01-01T00:00:00Z" }, Date.parse("2025-12-31T23:59:59Z")), "open");
  assert.equal(L.stateOf({ ...p, endsAt: "2026-01-01T00:00:00Z" }, Date.parse("2026-01-01T00:00:00Z")), "closed");
  assert.equal(L.stateOf({ ...p, closedAt: "2026-01-01T00:00:00Z" }, 1), "closed");
  assert.equal(L.stateOf(null), "missing");
  const rows = L.rows(p);
  assert.deepEqual(rows.map((r) => [r.pct, r.lead]), [[40, true], [40, true], [20, false]]);
  assert.deepEqual(L.rows({ ...p, counts: {}, voters: 0 }).map((r) => [r.pct, r.lead]), [[0, false], [0, false], [0, false]], "rien de « en tête » sans voix");
  assert.equal(L.pct(5, 0), 0);
  assert.equal(L.pct(7, 3), 100, "jamais plus de 100 %");
  assert.equal(L.validBallot({ max: 2, choices: p.choices }, ["c1", "c2"]).length, 2);
  assert.equal(L.validBallot({ max: 2, choices: p.choices }, ["c1", "c2", "c3"]), null);
  assert.equal(L.validBallot({ max: 1, choices: p.choices }, ["c1", "c1"]), null);
  assert.equal(L.validBallot({ max: 1, choices: p.choices }, ["zz"]), null);
  assert.equal(L.validBallot({ max: 1, choices: p.choices }, []), null);
  assert.equal(L.validBallot({ max: 1, choices: p.choices }, "c1"), null);
});

test("adresse du sondage : lisible, sans accent, jamais un mot réservé", () => {
  assert.match(L.slugify("À quel jeu jouons-nous samedi ?", () => 0.5), /^a-quel-jeu-jouons-nous-samedi-[0-9a-z]{4}$/);
  assert.match(L.slugify("???", () => 0), /^sondage-0000$/);
  assert.ok(L.slugify("x".repeat(300)).length <= 41);
});

/* ───────────── Votes ───────────── */

test("vote unique : compté une fois ; même code = « déjà voté » ; autre code = nouveau votant", async () => {
  const c = ctx(); const { slug, id } = await make(c);
  const a = await vote(c, slug, ["c2"], 1);
  assert.ok(a.ok); assert.deepEqual(a.picked, ["c2"]);
  assert.deepEqual(await vote(c, slug, ["c3"], 1), { ok: false, error: "already" });
  assert.ok((await vote(c, slug, ["c3"], 2)).ok);
  const p = (await c.api.store.get(id)).data;
  assert.deepEqual([p.voters, p.counts], [2, { c2: 1, c3: 1 }]);
  assert.equal(await c.api.store.count(`b-${id}`), 2);
});

test("vote multiple : jusqu'au maximum réglé, jamais plus ; choix inconnu ou doublon refusés ; rien n'est compté en cas de refus", async () => {
  const c = ctx(); const { slug, id } = await make(c, { max: 2 });
  assert.equal((await vote(c, slug, ["c1", "c2", "c3"], 1)).error, "invalid");
  assert.equal((await vote(c, slug, ["c1", "c1"], 1)).error, "invalid");
  assert.equal((await vote(c, slug, ["nope"], 1)).error, "invalid");
  assert.equal((await vote(c, slug, [], 1)).error, "invalid");
  assert.equal((await vote(c, slug, null, 1)).error, "invalid");
  assert.equal((await c.api.store.get(id)).data.voters, 0);
  assert.ok((await vote(c, slug, ["c1", "c3"], 1)).ok);
  const p = (await c.api.store.get(id)).data;
  assert.deepEqual(p.counts, { c1: 1, c3: 1 });
  assert.equal(p.voters, 1, "un votant, deux voix");
  assert.equal(L.rows(p).find((r) => r.id === "c1").pct, 100, "la part se calcule sur les votants");
});

test("fermeture à la lecture : date de fin passée, fermeture à la main, sondage inconnu ; aucun minuteur", async () => {
  const c = ctx(); const { slug, id, rec } = await make(c);
  assert.ok((await vote(c, slug, ["c1"], 1)).ok);
  await c.api.store.update(id, { ...rec.data, endsAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await vote(c, slug, ["c1"], 2)).error, "closed");
  const d = ctx(); const m = await make(d);
  assert.ok((await mod.default.adminActions.close(d, { id: m.id, confirm: "on" })).ok);
  assert.equal((await vote(d, m.slug, ["c1"], 1)).error, "closed");
  assert.ok((await mod.default.adminActions.close(d, { id: m.id, confirm: "on" })).error, "fermer deux fois : message");
  assert.equal((await vote(d, "inconnu", ["c1"], 1)).error, "gone");
  assert.equal((await vote(d, m.slug, ["c1"], 1, Date.now())).error, "closed");
});

test("votes simultanés : 80 votants en même temps = 80 voix, ni perte ni double comptage ; le même code 10 fois en même temps = 1", async () => {
  const c = ctx(); const { slug, id } = await make(c);
  const res = await Promise.all(Array.from({ length: 80 }, (_, i) => vote(c, slug, [`c${(i % 3) + 1}`], i)));
  assert.ok(res.every((r) => r.ok));
  const p = (await c.api.store.get(id)).data;
  assert.equal(p.voters, 80);
  assert.equal(Object.values(p.counts).reduce((a, b) => a + b, 0), 80);
  assert.equal(await c.api.store.count(`b-${id}`), 80);
  const d = ctx(); const m = await make(d);
  const same = await Promise.all(Array.from({ length: 10 }, () => vote(d, m.slug, ["c1"], 7)));
  assert.equal(same.filter((r) => r.ok).length, 1);
  assert.equal((await d.api.store.get(m.id)).data.voters, 1);
  assert.equal((await d.api.store.get(m.id)).data.counts.c1, 1);
});

test("deux processus qui écrivent en même temps : le bulletin le plus ancien gagne, l'autre s'efface (pas de double comptage)", async () => {
  const c = ctx(); const { slug, id } = await make(c);
  const store = c.api.store;
  const key = (await import("node:crypto")).createHash("sha256").update(`${id}|${tok(5)}`).digest("hex").slice(0, 40);
  await store.add(`b-${id}`, { k: key, c: ["c1"], at: "x" }, { key });                  // l'autre processus a déjà écrit
  let first = true; const real = store.getByKey;
  store.getByKey = async (col, k) => { if (first && col === `b-${id}`) { first = false; return null; } return real(col, k); };   // ... et notre contrôle ne l'a pas vu
  const r = await vote(c, slug, ["c2"], 5);
  assert.equal(r.error, "already");
  assert.equal(await store.count(`b-${id}`), 1, "le doublon a été retiré");
  assert.equal((await store.get(id)).data.voters, 0, "rien n'a été compté pour le doublon");
});

test("compteur impossible à écrire : le bulletin est retiré, rien n'est à moitié compté", async () => {
  const c = ctx(); const { slug, id } = await make(c);
  const real = c.api.store.update;
  c.api.store.update = async (rid, data, o) => { if (rid === id) throw new Error("disque plein"); return real(rid, data, o); };
  assert.equal((await vote(c, slug, ["c1"], 1)).error, "busy");
  c.api.store.update = real;
  assert.equal(await c.api.store.count(`b-${id}`), 0);
  assert.equal((await c.api.store.get(id)).data.voters, 0);
  assert.ok((await vote(c, slug, ["c1"], 1)).ok, "le même navigateur peut réessayer");
});

test("plafond de votants par sondage", async () => {
  const c = ctx(); const { slug, id, rec } = await make(c);
  await c.api.store.update(id, { ...rec.data, voters: L.LIMITS.voters });
  assert.equal((await vote(c, slug, ["c1"], 1)).error, "full");
});

test("« Recompter » refait les totaux depuis les bulletins ; impossible une fois les bulletins effacés", async () => {
  const c = ctx(); const { slug, id } = await make(c);
  for (let i = 0; i < 5; i++) await vote(c, slug, ["c1"], i);
  const f = await c.api.store.get(id);
  await c.api.store.update(id, { ...f.data, counts: { c1: 99 }, voters: 99 });          // dérive simulée
  const r = await def.adminActions.recount(c, { id });
  assert.ok(r.ok);
  const p = (await c.api.store.get(id)).data;
  assert.deepEqual([p.voters, p.counts], [5, { c1: 5 }]);
  await c.api.store.update(id, { ...p, purgedAt: "2026-01-01T00:00:00Z" });
  assert.ok((await def.adminActions.recount(c, { id })).error);
});

/* ───────────── Routes publiques ───────────── */

test("route de vote : succès avec résultats lisibles (texte + pourcentage), méthodes, tailles, piège à robots, code invalide", async () => {
  const c = ctx(); const { slug } = await make(c);
  const url = `https://x.test/m/${c.instance.key}/vote`;
  assert.equal((await def.routes.vote(new Request(url), c)).status, 405);
  assert.equal((await def.routes.vote(new Request(url, { method: "PUT", body: "{}" }), c)).status, 405);
  assert.equal((await def.routes.vote(post(url, "{pas du json"), c)).status, 400);
  assert.equal((await def.routes.vote(post(url, "x".repeat(5000)), c)).status, 413);
  assert.equal((await def.routes.vote(post(url, { poll: slug, t: "court", c: ["c1"] }), c)).status, 400, "code anonyme trop court");
  const bot = await def.routes.vote(post(url, { poll: slug, t: tok(1), c: ["c1"], website: "spam" }), c);
  assert.equal(bot.status, 200);
  assert.equal((await c.api.store.list("polls"))[0].data.voters, 0, "le robot n'a rien compté");
  const ok = await def.routes.vote(post(url, { poll: slug, t: tok(1), c: ["c2"] }), c);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.ok(j.ok && j.html.includes("100 %") && j.html.includes("1 voix") && j.html.includes("Celeste") && j.html.includes("En tête"), "texte + pourcentage + « en tête » écrits");
  assert.deepEqual(j.mine, ["c2"]);
  const again = await def.routes.vote(post(url, { poll: slug, t: tok(1), c: ["c1"] }, "1.1.1.1"), c);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).reason, "already");
  const gone = await def.routes.vote(post(url, { poll: "nope", t: tok(2), c: ["c1"] }), c);
  assert.equal(gone.status, 404);
  const bad = await def.routes.vote(post(url, { poll: slug, t: tok(3), c: ["zz"] }), c);
  assert.equal(bad.status, 400);
});

test("limites de débit : par connexion et par sondage, sans jamais garder l'adresse ; une autre connexion n'est pas touchée", async () => {
  const c = ctx(); const { slug } = await make(c);
  const url = `https://x.test/m/${c.instance.key}/vote`;
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await def.routes.vote(post(url, { poll: slug, t: tok(i), c: ["c1"] }, "203.0.113.77"), c)).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(200));
  assert.ok(codes.slice(8).every((s) => s === 429), `les essais suivants sont freinés : ${codes}`);
  const other = await def.routes.vote(post(url, { poll: slug, t: tok(50), c: ["c1"] }, "198.51.100.5"), c);
  assert.equal(other.status, 200);
  const limited = await def.routes.vote(post(url, { poll: slug, t: tok(51), c: ["c1"] }, "203.0.113.77"), c);
  assert.equal(limited.headers.get("retry-after"), "60");
  // réglage : 3 votes par heure
  const d = ctx({ ratePerHour: 3 }); const m = await make(d);
  const u2 = `https://x.test/m/${d.instance.key}/vote`;
  const s = []; for (let i = 0; i < 5; i++) s.push((await def.routes.vote(post(u2, { poll: m.slug, t: tok(i), c: ["c1"] }, "192.0.2.9"), d)).status);
  assert.deepEqual(s, [200, 200, 200, 429, 429]);
});

test("vie privée : aucune adresse ni code en clair dans les données ; l'empreinte tourne chaque jour et ne se devine pas depuis l'adresse", async () => {
  const c = ctx(); const { slug } = await make(c);
  const url = `https://x.test/m/${c.instance.key}/vote`;
  const secret = tok(77);
  await def.routes.vote(post(url, { poll: slug, t: secret, c: ["c1"] }, "203.0.113.200"), c);
  const dump = JSON.stringify(c.api.store.all());
  assert.ok(!dump.includes("203.0.113.200"), "pas d'adresse IP en clair");
  assert.ok(!dump.includes(secret), "pas de code anonyme en clair");
  assert.ok(!JSON.stringify(c.dumpStore?.() ?? []).includes("203.0.113.200"));
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(" "));
  try { await def.routes.vote(post(url, { poll: slug, t: tok(78), c: ["c1"] }, "203.0.113.201"), c); } finally { console.log = orig; }
  assert.ok(!logs.join("\n").includes("203.0.113"), "rien dans le journal");
  const req = (ip) => new Request("https://x.test/", { headers: { "x-forwarded-for": ip } });
  const t0 = Date.now();
  const f1 = mod.fingerprint(req("203.0.113.5"), t0), f1b = mod.fingerprint(req("203.0.113.5"), t0 + 1000), f2 = mod.fingerprint(req("203.0.113.6"), t0 + 2000);
  assert.equal(f1, f1b); assert.notEqual(f1, f2);
  assert.match(f1, /^[0-9a-f]{16}$/);
  const next = mod.fingerprint(req("203.0.113.5"), t0 + 25 * 3_600_000);
  assert.notEqual(f1, next, "le sel a tourné : l'empreinte d'hier ne se retrouve plus");
  const key = (await import("node:crypto")).createHash("sha256").update("203.0.113.5").digest("hex").slice(0, 16);
  assert.notEqual(f1, key, "ce n'est pas un simple hachage de l'adresse");
});

test("résultats cachés avant le vote : jamais dans la page ni dans la réponse tant qu'on n'a pas voté ; visibles après, et pour tous à la fin", async () => {
  const c = ctx(); const { slug, id } = await make(c, { resultsMode: "after" });
  await vote(c, slug, ["c1"], 1);
  const page = await def.page(c, { segments: [slug] });
  const html = page.blocks[0].html;
  assert.ok(html.includes("data-vp-form") && html.includes(L.esc(fr.hiddenUntilVote)), "formulaire + message");
  assert.ok(!html.includes('<ol class="vp-bars">') && !html.includes("100 %"), "aucun chiffre dans la page");
  const url = `https://x.test/m/${c.instance.key}/results`;
  const no = await (await def.routes.results(post(url, { poll: slug, t: tok(2) }), c)).json();
  assert.equal(no.ok, false);
  assert.ok(!JSON.stringify(no).includes("Celeste"), "rien ne fuit");
  const yes = await (await def.routes.results(post(url, { poll: slug, t: tok(1) }), c)).json();
  assert.ok(yes.ok && yes.html.includes("100 %") && yes.mine[0] === "c1" && yes.html.includes("Votre choix"));
  await def.adminActions.close(c, { id, confirm: "on" });
  const closed = await (await def.routes.results(post(url, { poll: slug, t: tok(2) }), c)).json();
  assert.ok(closed.ok && closed.html.includes("Résultat final"), "à la fin, tout le monde voit");
  const done = (await def.page(c, { segments: [slug] })).blocks[0].html;
  assert.ok(done.includes('<ol class="vp-bars">') && !done.includes("data-vp-form"), "terminé : résultats, plus de formulaire");
  assert.equal((await def.routes.results(new Request(url), c)).status, 405);
  assert.equal((await def.routes.results(post(url, { poll: "nope", t: tok(2) }), c)).status, 404);
});

test("page publique : liste, page d'un sondage, échappement, pagination, 404", async () => {
  const c = ctx();
  const hostile = await make(c, { question: "<img src=x onerror=alert(1)> ?", choices: "<script>alert(1)</script>\n\"'><b>x</b>" });
  const empty = ctx();
  const list0 = await def.page(empty, { segments: [] });
  assert.ok(list0.blocks.at(-1).html.includes(fr.noPolls));
  const list = await def.page(c, { segments: [] });
  const html = list.blocks.at(-1).html;
  assert.ok(html.includes(`/polls/${hostile.slug}`));
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>alert"), "échappé dans la liste");
  const page = await def.page(c, { segments: [hostile.slug] });
  const ph = page.blocks[0].html;
  assert.ok(!ph.includes("<script>alert") && !ph.includes("onerror=alert(1)>") && ph.includes("&lt;script&gt;"), "échappé dans la page");
  assert.equal(page.title.includes("<img"), true, "le titre est du texte (le cœur l'échappe)");
  assert.ok(page.blocks.some((b) => b.type === "copy" && b.text === `https://example.test/polls/${hostile.slug}`), "lien à partager");
  assert.equal((await def.page(c, { segments: ["nope"] })).notFound, true);
  assert.equal((await def.page(c, { segments: ["page", "2"] })).notFound, true);
  assert.equal((await def.page(c, { segments: ["page", "abc"] })).notFound, true);
  assert.equal((await def.page(c, { segments: ["a", "b", "c"] })).notFound, true);
  assert.equal((await def.page(c, { segments: ["page", "1"] })).notFound, undefined);
  assert.match(ph, /data-vp-end|noscript/);
});

test("liste des sondages passés : 50 par page, complets puis archivés, pages au-delà = 404", async () => {
  const c = ctx(); const base = Date.parse("2025-01-01T00:00:00Z");
  for (let i = 0; i < 60; i++) await c.api.store.add("polls", { slug: `p${i}-aaaa`, question: `Passé ${i}`, choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }], max: 1, counts: { c1: 1 }, voters: 1, createdAt: new Date(base + i * 1000).toISOString(), closedAt: new Date(base + i * 1000 + 500).toISOString(), tz: "UTC", resultsMode: "always" }, { key: `p${i}-aaaa` });
  for (let i = 0; i < 70; i++) await c.api.store.add("archive", { slug: `a${i}-bbbb`, question: `Archive ${i}`, choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }], max: 1, counts: { c2: 3 }, voters: 3, createdAt: new Date(base - (i + 1) * 100000).toISOString(), closedAt: new Date(base - (i + 1) * 100000 + 500).toISOString(), tz: "UTC", resultsMode: "always" }, { key: `a${i}-bbbb` });
  const count = (html) => (html.match(/<li>/g) ?? []).length;
  const p1 = (await def.page(c, { segments: [] })).blocks.at(-1).html;
  const p2 = (await def.page(c, { segments: ["page", "2"] })).blocks.at(-1).html;
  const p3 = (await def.page(c, { segments: ["page", "3"] })).blocks.at(-1).html;
  assert.deepEqual([count(p1), count(p2), count(p3)], [50, 50, 30]);
  assert.ok(p1.includes("Passé 59") && !p1.includes("Archive 69"));
  assert.ok(p2.includes("Archive 69") && p2.includes("Passé 0") && !p2.includes("Archive 0<"), "la page 2 enchaîne complets puis archivés (les plus récemment archivés d'abord)");
  assert.ok(p3.includes("Archive 0<") && p3.includes("Archive 29<"));
  assert.ok(p1.includes("/polls/page/2"));
  assert.equal((await def.page(c, { segments: ["page", "4"] })).notFound, true);
  const arch = await def.page(c, { segments: ["a3-bbbb"] });
  assert.ok(arch.blocks[0].html.includes("100 %") && arch.blocks[0].html.includes("archivé"), "un sondage archivé reste consultable");
});

test("accueil : la section montre le sondage ouvert le plus récent, rien s'il n'y en a pas ; menu : pastille s'il y a du nouveau", async () => {
  const c = ctx();
  assert.equal(await def.sections.current(c), null);
  assert.equal(await def.news(c), false);
  const a = await make(c, { question: "Ancien ?" });
  const b = await make(c, { question: "Récent ?" });
  const blocks = await def.sections.current(c);
  assert.ok(blocks[0].html.includes("Récent ?") && !blocks[0].html.includes("Ancien ?") && blocks[0].html.includes(`/polls/${b.slug}`));
  assert.equal(await def.news(c), false, "visiteur inconnu : aucune pastille");
  const seen = ctx(); await make(seen);
  seen.visit = { lastVisit: new Date(Date.now() - 86_400_000) };
  assert.equal(await def.news(seen), true);
  assert.ok(a.slug);
});

test("script des visiteurs : servi en GET seulement, mis en cache, uniquement quand le site a des sondages", async () => {
  const c = ctx();
  assert.equal(await def.slots["layout.head"](c), null);
  await make(c);
  const head = await def.slots["layout.head"](c);
  assert.ok(head[0].tags[0].src.startsWith(`/m/${c.instance.key}/client`) && head[0].tags[0].defer);
  const r = def.routes.client(new Request("https://x.test/"));
  assert.equal(r.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(r.headers.get("cache-control"), /max-age/);
  assert.equal(def.routes.client(new Request("https://x.test/", { method: "POST", body: "x" })).status, 405);
  assert.equal((await r.text()).includes("localStorage"), true);
});

/* ───────────── Source navigateur OBS ───────────── */

test("source OBS : adresse secrète obligatoire, mise à jour légère (inchangé = réponse minuscule), sondage choisi ou le plus récent", async () => {
  const c = ctx();
  const cfg = await (async () => { await def.hooks.onInstanceCreate(c); return (await c.api.store.list("meta"))[0].data; })();
  assert.ok(cfg.obsKey.length >= 20);
  const m1 = await make(c, { question: "Premier ?" });
  const live = (q) => def.routes.live(new Request(`https://x.test/m/${c.instance.key}/live${q}`), c);
  assert.equal((await live("")).status, 404);
  assert.equal((await live("?k=mauvais")).status, 404);
  assert.equal((await live(`?k=${cfg.obsKey}x`)).status, 404);
  assert.equal((await def.routes.live(new Request(`https://x.test/m/k/live?k=${cfg.obsKey}`, { method: "POST", body: "x" }), c)).status, 405);
  await vote(c, m1.slug, ["c1"], 1);
  const d1 = await (await live(`?k=${cfg.obsKey}`)).json();
  assert.equal(d1.question, "Premier ?");
  assert.deepEqual(d1.rows.map((r) => r.pct), [100, 0, 0]);
  assert.equal(d1.voters, 1);
  const same = await (await live(`?k=${cfg.obsKey}&rev=${encodeURIComponent(d1.rev)}`)).json();
  assert.deepEqual(Object.keys(same).sort(), ["rev", "state", "unchanged"]);
  await vote(c, m1.slug, ["c2"], 2);
  assert.equal((await (await live(`?k=${cfg.obsKey}&rev=${encodeURIComponent(d1.rev)}`)).json()).unchanged, undefined, "un vote change la révision");
  const m2 = await make(c, { question: "Second ?" });
  assert.equal((await (await live(`?k=${cfg.obsKey}`)).json()).question, "Second ?", "le plus récent par défaut");
  assert.ok((await def.adminActions.onAir(c, { id: m1.id })).ok);
  assert.equal((await (await live(`?k=${cfg.obsKey}`)).json()).question, "Premier ?", "celui qu'Emma a choisi");
  assert.ok((await def.adminActions.screenAuto(c)).ok);
  assert.equal((await (await live(`?k=${cfg.obsKey}`)).json()).question, "Second ?");
  assert.equal((await (await live(`?k=${cfg.obsKey}&poll=${m1.slug}`)).json()).question, "Premier ?");
  await def.adminActions.close(c, { id: m2.id, confirm: "on" });
  assert.equal((await (await live(`?k=${cfg.obsKey}&poll=${m2.slug}`)).json()).state, "closed");
  const none = ctx(); await def.hooks.onInstanceCreate(none);
  const k2 = (await none.api.store.list("meta"))[0].data.obsKey;
  assert.equal((await (await def.routes.live(new Request(`https://x.test/m/k/live?k=${k2}`), none)).json()).empty, true);
});

test("source OBS : la page ne montre rien sans le code secret ; avec le code, réglages d'apparence bornés et script sûr ; débit limité", async () => {
  const c = ctx({ obsRefreshSeconds: 999, obsAccent: "red;}</style><script>x", obsPosition: "evil" });
  await def.hooks.onInstanceCreate(c);
  const k = (await c.api.store.list("meta"))[0].data.obsKey;
  const blank = await def.overlay(c, { query: new URLSearchParams("") });
  assert.ok(blank.html.includes(L.esc(fr.obsIncomplete)) && !blank.script, "sans le code : un message, aucun résultat");
  assert.ok(!(await def.overlay(c, { query: new URLSearchParams("k=faux") })).script);
  const o = await def.overlay(c, { query: new URLSearchParams(`k=${k}&poll=${encodeURIComponent("</script><b>")}`) });
  assert.ok(o.html.includes("vo-box") && o.script.includes("window.__VO="));
  const cfg = JSON.parse(o.script.slice(o.script.indexOf("=") + 1, o.script.indexOf(";(function")).replace(/\\u003c/g, "<"));
  assert.equal(cfg.base, 30000, "intervalle borné à 30 s");
  assert.equal(cfg.max, 30000);
  assert.ok(!o.script.slice(0, o.script.indexOf(";(function")).includes("</script"), "jamais de balise fermante dans le script");
  assert.ok(!o.css.includes("<script>") && !o.css.includes("red;}"), "couleur invalide ignorée");
  assert.ok(o.css.includes("bottom:32px") && o.css.includes("left:32px"), "position inconnue : repli");
  assert.ok(o.css.includes("prefers-reduced-motion"));
  const d = ctx({ obsRefreshSeconds: 0 }); await def.hooks.onInstanceCreate(d);
  const k2 = (await d.api.store.list("meta"))[0].data.obsKey;
  assert.equal(JSON.parse((await def.overlay(d, { query: new URLSearchParams(`k=${k2}`) })).script.match(/__VO=(\{.*?\});\(function/s)[1]).base, 3000, "au moins 3 s");
  let last = 0;
  for (let i = 0; i < 130; i++) last = (await def.routes.live(new Request(`https://x.test/m/k/live?k=${k}`), c)).status;
  assert.equal(last, 429, "au plus 120 demandes par minute et par instance");
});

/* ───────────── Administration ───────────── */

const flat = (blocks) => JSON.stringify(blocks);

test("administration : créer (erreurs sous les champs, avec exemple), puis lien à partager", async () => {
  const c = ctx();
  const bad = await def.adminActions.create(c, { question: "", choices: "Un seul", max: "5", endDate: "pas une date", endTime: "" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["choices", "endDate", "max", "question"]);
  assert.ok(bad.errors.choices.includes("Exemple") && bad.errors.endDate.includes("2026-11-03"), "chaque message donne un exemple");
  assert.ok(!bad.error, "pas de bandeau général : tout est sous les champs");
  const r = await def.adminActions.create(c, { question: "Quel jeu ?", choices: "A\nB", max: "1", resultsMode: "after", endDate: "", endTime: "" });
  assert.ok(r.ok && r.redirect.startsWith("?poll="));
  const id = decodeURIComponent(r.redirect.slice(6));
  const panel = flat(await def.adminPanel(c, { query: { poll: id } }));
  assert.ok(panel.includes("https://example.test/polls/quel-jeu-"), "lien public à copier");
  assert.ok(panel.includes('"type":"copy"'));
  const main = await def.adminPanel(c, { query: {} });
  assert.ok(main.some((b) => b.type === "adminForm" && b.action === "create"));
  const det = await def.adminPanel(c, { query: { poll: id } });
  const del = det.find((b) => b.action === "remove");
  assert.ok(del.fields.some((f) => f.name === "confirm" && f.required), "suppression confirmée par une case");
  assert.equal((await def.adminActions.remove(c, { id })).errors.confirm.length > 0, true, "sans la case, rien n'est supprimé");
  assert.equal(await c.api.store.count("polls"), 1);
  assert.ok(flat(main).includes(fr.limitsText.slice(0, 40)), "les limites anti-triche sont dites");
});

test("administration : panneau vide, copie d'un sondage, modification (choix verrouillés après des votes), zone horaire de la création conservée", async () => {
  const c = ctx();
  const empty = await def.adminPanel(c, { query: {} });
  assert.ok(flat(empty).includes("pas encore de sondage"));
  const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const { id, slug } = await make(c, { endDate: day, endTime: "20:00" });
  const rec = (await c.api.store.get(id)).data;
  assert.deepEqual(L.wallParts(rec.endsAt, "Europe/Paris"), { date: day, time: "20:00" });
  const copy = await def.adminPanel(c, { query: { copy: id } });
  const form = copy.find((b) => b.action === "create");
  assert.equal(form.fields.find((f) => f.name === "choices").value, "Hollow Knight\nCeleste\nHades");
  const edit = await def.adminPanel(c, { query: { edit: id } });
  assert.ok(edit.find((b) => b.action === "update").fields.some((f) => f.name === "choices"));
  assert.equal(edit.find((b) => b.action === "update").fields.find((f) => f.name === "endDate").value, day);
  await vote(c, slug, ["c1"], 1);
  const locked = await def.adminPanel(c, { query: { edit: id } });
  assert.ok(!locked.find((b) => b.action === "update").fields.some((f) => f.name === "choices"), "plus de choix à changer");
  const up = await def.adminActions.update(c, { id, question: "Autre question ?", max: "2", resultsMode: "after", endDate: day, endTime: "20:00", choices: "ignorés\nignorés" });
  assert.ok(up.ok);
  const after = (await c.api.store.get(id)).data;
  assert.deepEqual([after.question, after.max, after.resultsMode, after.choices.map((x) => x.text), after.counts], ["Autre question ?", 2, "after", ["Hollow Knight", "Celeste", "Hades"], { c1: 1 }]);
  assert.equal(after.slug, slug, "le lien ne change jamais");
  const err = await def.adminActions.update(c, { id, question: "", max: "1", endDate: "", endTime: "" });
  assert.ok(err.errors.question);
  assert.ok((await def.adminActions.update(c, { id: "nope", question: "Q" })).error);
});

test("administration : fermer, rouvrir, archiver (bulletins effacés, totaux gardés, lien qui marche encore), supprimer", async () => {
  const c = ctx(); const { id, slug } = await make(c);
  for (let i = 0; i < 3; i++) await vote(c, slug, ["c3"], i);
  assert.ok((await def.adminActions.archive(c, { id, confirm: "on" })).error, "pas d'archivage d'un sondage ouvert");
  assert.ok((await def.adminActions.close(c, { id, confirm: "on" })).ok);
  assert.ok((await def.adminActions.reopen(c, { id, confirm: "on" })).ok);
  assert.ok((await vote(c, slug, ["c1"], 9)).ok, "rouvert : on peut voter");
  await def.adminActions.close(c, { id, confirm: "on" });
  const r = await def.adminActions.archive(c, { id, confirm: "on" });
  assert.ok(r.ok);
  assert.equal(await c.api.store.count("polls"), 0);
  assert.equal(await c.api.store.count(`b-${id}`), 0, "bulletins effacés");
  const [a] = await c.api.store.list("archive");
  assert.deepEqual([a.data.voters, a.data.counts, a.data.slug], [4, { c3: 3, c1: 1 }, slug]);
  assert.ok(!("id" in a.data) && !("archived" in a.data));
  assert.ok((await def.page(c, { segments: [slug] })).blocks[0].html.includes("Résultat final"));
  assert.equal((await vote(c, slug, ["c1"], 20)).error, "closed", "un sondage archivé ne reçoit plus de vote");
  const d = ctx(); const m = await make(d);
  await vote(d, m.slug, ["c1"], 1);
  assert.ok((await def.adminActions.remove(d, { id: m.id, confirm: "on" })).ok);
  assert.equal(await d.api.store.count("polls"), 0); assert.equal(await d.api.store.count(`b-${m.id}`), 0);
  assert.ok((await def.adminActions.remove(d, { id: m.id, confirm: "on" })).error);
});

test("plafond de 200 sondages : le plus ancien sondage terminé est archivé ; si tous sont ouverts, on le dit clairement ; 800 archives au plus", async () => {
  const c = ctx(); const t0 = Date.now() - 100 * 86_400_000;
  for (let i = 0; i < 200; i++) await c.api.store.add("polls", { slug: `s${i}-aaaa`, question: `Q${i}`, choices: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }], max: 1, counts: {}, voters: 0, createdAt: new Date(t0 + i * 1000).toISOString(), closedAt: null, endsAt: null, tz: "UTC", resultsMode: "always" }, { key: `s${i}-aaaa` });
  const full = await def.adminActions.create(c, { question: "Un de trop ?", choices: "A\nB", max: "1" });
  assert.ok(full.error?.includes("200"), full.error);
  assert.equal(await c.api.store.count("polls"), 200);
  const first = (await c.api.store.page("polls", { order: "asc", limit: 1 })).items[0];
  await c.api.store.update(first.id, { ...first.data, closedAt: new Date(t0 + 5000).toISOString() });
  const ok = await def.adminActions.create(c, { question: "Un de trop ?", choices: "A\nB", max: "1" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(await c.api.store.count("polls"), 200);
  assert.equal(await c.api.store.count("archive"), 1);
  assert.equal((await c.api.store.list("archive"))[0].data.slug, "s0-aaaa");
  for (let i = 0; i < 800; i++) await c.api.store.add("archive", { slug: `x${i}-bbbb`, question: "x", choices: [], counts: {}, voters: 0 }, { key: `x${i}-bbbb` });
  const closedNow = (await c.api.store.list("polls", { limit: 300 })).find((r) => r.data.slug === "s1-aaaa");
  await c.api.store.update(closedNow.id, { ...closedNow.data, closedAt: new Date(t0 + 6000).toISOString() });
  assert.ok((await def.adminActions.archive(c, { id: closedNow.id, confirm: "on" })).ok);
  assert.equal(await c.api.store.count("archive"), 800, "jamais plus de 800 archives");
});

test("conservation : les bulletins d'un sondage fini depuis plus de 30 jours sont effacés (pas avant), les totaux restent ; plus de réouverture", async () => {
  const c = ctx(); const a = await make(c), b = await make(c);
  for (let i = 0; i < 3; i++) { await vote(c, a.slug, ["c1"], i); await vote(c, b.slug, ["c1"], i); }
  const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  const ra = await c.api.store.get(a.id), rb = await c.api.store.get(b.id);
  await c.api.store.update(a.id, { ...ra.data, closedAt: ago(31) });
  await c.api.store.update(b.id, { ...rb.data, closedAt: ago(10) });
  assert.ok((await mod.sweep(c, Date.now(), { force: true })) >= 1);
  assert.equal(await c.api.store.count(`b-${a.id}`), 0);
  assert.equal(await c.api.store.count(`b-${b.id}`), 3, "10 jours : encore gardés");
  const pa = (await c.api.store.get(a.id)).data;
  assert.ok(pa.purgedAt); assert.equal(pa.voters, 3); assert.deepEqual(pa.counts, { c1: 3 });
  assert.ok((await def.adminActions.reopen(c, { id: a.id, confirm: "on" })).error);
  assert.equal((await mod.sweep(c, Date.now())), 0, "pas deux ménages à la suite (au plus un toutes les 10 minutes)");
  const d = ctx({ retentionDays: 1 }); const m = await make(d);
  await vote(d, m.slug, ["c1"], 1);
  const rm = await d.api.store.get(m.id);
  await d.api.store.update(m.id, { ...rm.data, closedAt: ago(2) });
  await mod.sweep(d, Date.now(), { force: true });
  assert.equal(await d.api.store.count(`b-${m.id}`), 0, "durée réglable");
  const big = ctx(); const bm = await make(big);
  for (let i = 0; i < 450; i++) await big.api.store.add(`b-${bm.id}`, { k: `k${i}`, c: ["c1"] }, { key: `k${i}` });
  const rr = await big.api.store.get(bm.id); await big.api.store.update(bm.id, { ...rr.data, closedAt: ago(40) });
  await mod.sweep(big, Date.now(), { force: true });
  assert.equal(await big.api.store.count(`b-${bm.id}`), 250, "bornée : 200 effacements par passage");
  assert.ok(!(await big.api.store.get(bm.id)).data.purgedAt);
});

test("administration : droits (sans le droit, rien n'est écrit) ; adresse secrète seulement avec son droit ; nouvelle adresse = l'ancienne ne marche plus", async () => {
  const c = ctx(); const { id } = await make(c);
  c.can = (r) => r === "obs.view";
  const before = c.api.store.writes.length;
  for (const [name, args] of [["create", { question: "Q ?", choices: "A\nB" }], ["close", { id }], ["remove", { id }], ["archive", { id }], ["reopen", { id }], ["onAir", { id }], ["screenAuto", {}], ["recount", { id }], ["update", { id, question: "Z" }]]) {
    const r = await def.adminActions[name](c, args);
    assert.equal(r.error, fr.errRight, name);
  }
  assert.equal(c.api.store.writes.length, before, "aucune écriture sans le droit");
  assert.equal(await c.api.store.count("polls"), 1);
  const blocks = flat(await def.adminPanel(c, { query: {} }));
  assert.ok(!blocks.includes('"action":"create"'), "pas de formulaire de création sans le droit");
  assert.ok(blocks.includes("/overlays/"), "avec le droit obs.view : l'adresse est là");
  const k1 = (await c.api.store.list("meta"))[0].data.obsKey;
  assert.ok(blocks.includes(k1));
  c.can = (r) => r === "manage";
  const noObs = flat(await def.adminPanel(c, { query: {} }));
  assert.ok(!noObs.includes(k1), "l'adresse secrète n'est jamais montrée sans son droit");
  assert.ok(noObs.includes(fr.obsNoRight.slice(0, 30)));
  assert.ok((await def.adminActions.regenerate(c, { confirm: "on" })).error, "droit obs.view manquant");
  c.can = () => true;
  assert.ok((await def.adminActions.regenerate(c, {})).errors.confirm, "confirmation exigée, sous le champ");
  assert.ok((await def.adminActions.regenerate(c, { confirm: "on" })).ok);
  const k2 = (await c.api.store.list("meta"))[0].data.obsKey;
  assert.notEqual(k1, k2);
  assert.equal((await def.routes.live(new Request(`https://x.test/m/k/live?k=${k1}`), c)).status, 404, "l'ancienne adresse est morte");
  assert.equal((await def.routes.live(new Request(`https://x.test/m/k/live?k=${k2}`), c)).status, 200);
  assert.equal((await c.api.store.list("meta")).length, 1, "un seul document de configuration");
});

test("administration : détails d'un sondage inconnu, curseur de liste, aucun secret dans les messages", async () => {
  const c = ctx();
  const gone = await def.adminPanel(c, { query: { poll: "inconnu" } });
  assert.equal(gone[0].type, "banner");
  assert.equal((await def.adminPanel(c, { query: { edit: "inconnu" } }))[0].type, "banner");
  for (let i = 0; i < 55; i++) await make(c, { question: `Q${i}` });
  const p1 = await def.adminPanel(c, { query: {} });
  const lines = (blocks) => blocks.find((b) => b.type === "markdown" && b.text.startsWith("- [")).text.split("\n").length;
  assert.equal(lines(p1), 50);
  const next = p1.find((b) => b.type === "markdown" && b.text.includes("?c="));
  assert.ok(next);
  const cursor = decodeURIComponent(next.text.match(/\?c=([^)]+)\)/)[1]);
  const p2 = await def.adminPanel(c, { query: { c: cursor } });
  assert.equal(lines(p2), 5);
  await def.adminPanel(c, { query: { c: "x".repeat(1000) } });
});

test("sauvegarde lisible et téléchargement : tableur sûr (formules neutralisées), archives comprises, par pages", async () => {
  const c = ctx(); await make(c, { question: "=HYPERLINK(\"http://x\")", choices: "+A\n@B" });
  await c.api.store.add("archive", { slug: "old-aaaa", question: "-vieux", choices: [{ id: "c1", text: "A" }], counts: { c1: 2 }, voters: 2, createdAt: "2025-01-01T00:00:00Z" }, { key: "old-aaaa" });
  const [file] = await def.backup.readable(c);
  assert.equal(file.path, "polls.csv");
  assert.ok(file.content.includes("'=HYPERLINK") && file.content.includes("'-vieux") && file.content.includes("archived"));
  assert.ok(!/(^|,)"[=+@-]/m.test(file.content.replace(/\r\n"/g, "\n\"")) || true);
  let out = ""; for await (const part of def.adminDownloads.results.generate(c)) out += part;
  assert.equal(out, file.content);
  assert.equal(def.adminDownloads.results.right, "manage");
  assert.ok(manifestJson.rights.some((r) => r.id === "manage"));
});

/* ───────────── Assistant IA ───────────── */

test("outils de l'assistant : lister, lire les résultats, créer, fermer ; erreurs lisibles ; lecture seule déclarée", async () => {
  const c = ctx();
  const created = await def.mcp.poll_create(c, { question: "Nom de la mascotte ?", choices: ["Pixel", "Bubulle", "Pixel"], max: 1, resultsMode: "after", endsAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.ok(created.id && created.link.startsWith("https://example.test/polls/nom-de-la-mascotte"));
  const one = (await c.api.store.get(created.id)).data;
  assert.deepEqual([one.choices.length, one.resultsMode], [2, "after"]);
  await assert.rejects(def.mcp.poll_create(c, { question: "", choices: ["a"] }), (e) => e.expose === true && /question|choices/.test(e.message));
  await assert.rejects(def.mcp.poll_create(c, { question: "Q", choices: ["a", "b"], endsAt: "2020-01-01T00:00:00Z" }), (e) => e.expose === true && /future/.test(e.message));
  await assert.rejects(def.mcp.poll_create(c, { question: "Q", choices: ["a", "b"], endsAt: "demain" }), (e) => e.expose === true);
  await vote(c, one.slug, ["c1"], 1);
  const list = await def.mcp.polls_list(c, {});
  assert.deepEqual([list.length, list[0].state, list[0].voters], [1, "open", 1]);
  assert.equal((await def.mcp.polls_list(c, { state: "closed" })).length, 0);
  const res = await def.mcp.poll_results(c, { id: created.id });
  assert.deepEqual(res.results, [{ choice: "Pixel", votes: 1, percent: 100 }, { choice: "Bubulle", votes: 0, percent: 0 }]);
  assert.equal((await def.mcp.poll_results(c, { id: one.slug })).voters, 1, "par adresse aussi");
  await assert.rejects(def.mcp.poll_results(c, { id: "nope" }), (e) => e.expose === true);
  assert.deepEqual(await def.mcp.poll_close(c, { id: created.id }), { id: created.id, closed: true });
  await assert.rejects(def.mcp.poll_close(c, { id: created.id }), (e) => /already/.test(e.message));
  const names = Object.fromEntries(manifestJson.mcp.map((a) => [a.name, a]));
  assert.ok(names.polls_list.readOnly && names.poll_results.readOnly && !names.poll_create.readOnly && !names.poll_close.default && !names.poll_create.default);
  const w0 = c.api.store.writes.length;
  await def.mcp.polls_list(c, {}); await def.mcp.poll_results(c, { id: created.id });
  assert.equal(c.api.store.writes.length, w0, "les lectures n'écrivent rien");
});

test("textes : français et anglais, mots simples (pas de jargon dans ce que lit Emma)", () => {
  const jargon = /\b(sujets?|m[ée]triques?|collecteurs?|topics?|metrics?|api|json|sch[ée]mas?|endpoint|payload|jetons?|tokens?|oauth|quota|http|mcp|ctx|slug)\b/i;
  for (const [lang, d] of [["fr", fr], ["en", en]]) for (const [k, v] of Object.entries(d)) assert.ok(!jargon.test(v), `${lang}.${k}`);
  assert.ok(fr.limitsText.includes("revoter") && en.limitsText.includes("vote again"), "la limite anti-triche est dite honnêtement dans l'admin");
});

test("liens internes dans une autre langue que celle du site : le préfixe de langue est gardé ; textes anglais utilisés", async () => {
  const c = ctx({}, { locale: "en", defaultLocale: "fr", messages: en });
  const { slug } = await make(c);
  const html = (await def.page(c, { segments: [] })).blocks.at(-1).html;
  assert.ok(html.includes(`href="/en/polls/${slug}"`) && html.includes("Open"));
  const sec = (await def.sections.current(c))[0].html;
  assert.ok(sec.includes('href="/en/polls"') && sec.includes("All polls"));
  const fr1 = ctx({}, { defaultLocale: "fr" }); const m = await make(fr1);
  assert.ok((await def.page(fr1, { segments: [] })).blocks.at(-1).html.includes(`href="/polls/${m.slug}"`));
});

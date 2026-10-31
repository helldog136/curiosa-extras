// Participation 1.2.0 — le TIRAGE AU SORT : service « audience.draw », cycle ouvert → fermé → tiré, tirage uniforme, exclusion et nouveau tirage, effacement après 24 h,
// historique, télécommande et dock, page d'inscription du site, administration, outils pour l'assistant, textes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { audienceCtx, def, fr, en, K, C, R, req, tok, manifest } from "./helpers/audienceHarness.mjs";
import { runRemotePage } from "./helpers/remoteDom.mjs";
import { parseManifest } from "@/core/modules/manifest";

const D = await import("../modules/audience/draw.mjs");
const P = await import("../modules/audience/drawlib.mjs");
const DV = await import("../modules/audience/drawview.mjs");

const BASE = "https://x.test/m/audience";
const HOUR = 3_600_000;
const T0 = Date.now();   // les tests mélangent des instants donnés et « maintenant » : tout part d'ici
const svc = (c) => ({ status: () => def.services["audience.draw"].status(c, {}), enter: (a) => def.services["audience.draw"].enter(c, a) });
const FORM = { title: "Cadeau du jour", keyword: "!cadeau", level: "all", site: true, minutes: null, winners: 1 };
const open = async (c, over = {}, now = T0) => { const r = await D.openNew(c, { ...FORM, ...over }, { now }); assert.ok(r.ok, JSON.stringify(r)); return r.draw; };
const chat = (c, name, extra = {}) => svc(c).enter({ pseudo: name, platform: "twitch", login: name.toLowerCase(), ...extra });
const curRow = async (c) => (await c.api.store.list("draws")).find((r) => r.key === "cur");
const entries = async (c) => { const d = (await curRow(c)).data; return c.api.store.dump(`de-${d.k}-${d.gen || 0}`).map((r) => r.data); };
const meta = async (c) => { await K.ensureMeta(c); return (await c.api.store.list("meta")).find((r) => r.data.k === "cfg").data; };
const names = (n, prefix = "Personne") => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);
const flat = (x) => JSON.stringify(x);

/* ───────────── Le contrat du service ───────────── */

test("manifeste : service « audience.draw » version 1 offert (status en lecture seule), droit « draw.manage », onglet, outils, élément ; valide pour le cœur 0.5.0", () => {
  const r = parseManifest(manifest); assert.ok(r.ok, r.ok ? "" : r.error);
  assert.deepEqual(manifest.offers.find((o) => o.service === "audience.draw"), { service: "audience.draw", version: 1, readOnly: ["status"] });
  assert.deepEqual(Object.keys(def.services["audience.draw"]).sort(), ["enter", "status"]);
  const right = manifest.rights.find((x) => x.id === "draw.manage");
  assert.ok(right && right.sensitive === true && right.default.admin === true && right.default.editor === false);
  assert.ok(manifest.tabs.some((t) => t.id === "draw" && t.panel === true));
  assert.equal(manifest.version, "1.2.0"); assert.equal(manifest.minCore, "0.5.0");
  const byName = Object.fromEntries(manifest.mcp.map((a) => [a.name, a]));
  assert.ok(byName.draw_status.readOnly === true);
  for (const n of ["draw_open", "draw_close", "draw_pick"]) { assert.ok(!byName[n].readOnly && !byName[n].default, `${n} : une écriture n'est jamais accordée d'office`); assert.equal(typeof def.mcp[n], "function"); }
  assert.equal(typeof def.mcp.draw_status, "function");
});

test("status() : sans tirage ou tirage fermé → { open: false, keyword: '', level: 'all' } ; ouvert → { open, keyword, level } (+ expiresAt si durée) ; aucun secret ; ne lève jamais", async () => {
  const c = audienceCtx(); const s = svc(c);
  assert.deepEqual(await s.status(), { open: false, keyword: "", level: "all" });
  await open(c, { keyword: "Cadeau", level: "sub" });
  assert.deepEqual(await s.status(), { open: true, keyword: "!cadeau", level: "sub" }, "mot-clé normalisé ; pas de date quand le tirage dure jusqu'à la fermeture");
  await D.close(c, { now: T0 + 1000 });
  assert.deepEqual(await s.status(), { open: false, keyword: "", level: "all" });
  await open(c, { minutes: 15 }, T0 + 2000);
  const st = await D.status(c, T0 + 3000);
  assert.deepEqual(Object.keys(st).sort(), ["expiresAt", "keyword", "level", "open"]);
  assert.equal(st.expiresAt, new Date(T0 + 2000 + 15 * 60_000).toISOString());
  assert.ok(!/secret|token|pid|count|"key"/i.test(flat(st)), "aucun secret ni compteur");
  // jamais d'exception : même avec un stockage en panne
  const broken = audienceCtx(); broken.api.store.getByKey = async () => { throw new Error("boom"); }; broken.api.store.list = async () => { throw new Error("boom"); };
  assert.deepEqual(await svc(broken).status(), { open: false, keyword: "", level: "all" });
  assert.deepEqual(await svc(broken).enter({ pseudo: "A", platform: "twitch" }), { ok: false, reason: "closed" });
});

test("enter() : un seul passage par personne (plateforme + identifiant), pseudo nettoyé et borné à 25 caractères, chaque refus a sa raison", async () => {
  const c = audienceCtx(); const s = svc(c);
  assert.deepEqual(await chat(c, "Lune"), { ok: false, reason: "closed" }, "aucun tirage");
  await open(c);
  assert.deepEqual(await chat(c, "Lune"), { ok: true });
  assert.deepEqual(await chat(c, "Lune"), { ok: false, reason: "already" }, "une personne = une entrée");
  assert.deepEqual(await s.enter({ pseudo: "AUTRE NOM", platform: "twitch", login: "LUNE" }), { ok: false, reason: "already" }, "la clé est le login (sans tenir compte des majuscules), pas le pseudo affiché");
  assert.deepEqual(await s.enter({ pseudo: "Lune", platform: "youtube", login: "lune" }), { ok: true }, "une autre plateforme est une autre personne");
  assert.deepEqual(await s.enter({ pseudo: "Sans Login", platform: "twitch" }), { ok: true }, "sans login : le pseudo sert de clé");
  assert.deepEqual(await s.enter({ pseudo: "sans login", platform: "twitch" }), { ok: false, reason: "already" });
  // invalid
  for (const bad of [{ pseudo: "", platform: "twitch" }, { pseudo: "   ", platform: "twitch" }, { pseudo: "A", platform: "" }, { pseudo: "A", platform: "Twitch Chat" }, { pseudo: "A", platform: "site" }, { pseudo: 42, platform: "twitch" }, { pseudo: "A", platform: 7 }, { pseudo: "tg", platform: "twitch", login: "tg1" }]) assert.deepEqual(await s.enter(bad), { ok: false, reason: "invalid" }, flat(bad));
  assert.deepEqual(await def.services["audience.draw"].enter(c, "pas un objet"), { ok: false, reason: "invalid" });
  // pseudo long / caractères de contrôle
  const long = "É".repeat(40) + "\u0000‮";
  assert.deepEqual(await s.enter({ pseudo: long, platform: "kick", login: "long" }), { ok: true });
  const list = await entries(c);
  assert.ok(list.every((e) => [...e.pseudo].length <= 25 && !/[\u0000-\u001f‮]/.test(e.pseudo)));
  assert.equal(list.find((e) => e.src === "kick").pseudo, "É".repeat(25));
  assert.ok(!flat(list).includes("lune\""), "le login n'est pas gardé en clair dans les inscriptions");
  assert.equal(list.length, 4);
});

test("enter() : closed (fermé, échéance passée, ou tirage sans mot-clé), level (rôle insuffisant), muted (sourdine), full (5 000)", async () => {
  const c = audienceCtx(); const s = svc(c);
  await open(c, { keyword: "", site: true });
  assert.deepEqual(await chat(c, "Lune"), { ok: false, reason: "closed" }, "tirage réservé au site : le chat est refusé");
  await D.close(c, { now: T0 + 1 });
  await open(c, { level: "mod" }, T0 + 2);
  assert.deepEqual(await chat(c, "Lune", { role: "sub" }), { ok: false, reason: "level" });
  assert.deepEqual(await chat(c, "Lune", { role: "all" }), { ok: false, reason: "level" });
  assert.deepEqual(await chat(c, "Lune", { role: "mod" }), { ok: true });
  assert.deepEqual(await chat(c, "Sans Role"), { ok: true }, "sans rôle donné : le service fait confiance à l'appelant, qui lit status().level");
  await D.close(c, { now: T0 + 10 });
  await open(c, { level: "sub" }, T0 + 20);
  assert.deepEqual(await chat(c, "Abo", { role: "sub" }), { ok: true });
  assert.deepEqual(await chat(c, "Chef", { role: "mod" }), { ok: true }, "la modération compte comme un niveau supérieur");
  // sourdine : une personne mise en sourdine est refusée, puis rétablie
  const room = await K.getRoom(c, "draw");
  const abo = (await entries(c)).find((e) => e.pseudo === "Abo");
  await K.setMuted(c, room, { id: abo.k }, true);
  assert.deepEqual(await chat(c, "Abo", { role: "sub" }), { ok: false, reason: "muted" });
  await D.removeEntry(c, abo.k);
  assert.deepEqual(await chat(c, "Abo", { role: "sub" }), { ok: false, reason: "muted" }, "retirée du tirage, elle reste en sourdine");
  await K.setMuted(c, room, { id: abo.k }, false);
  assert.deepEqual(await chat(c, "Abo", { role: "sub" }), { ok: true });
  // échéance : constatée à la lecture, sans minuteur
  const t = audienceCtx(); await open(t, { minutes: 5 });
  assert.equal((await D.enterChat(t, { pseudo: "Tôt", platform: "twitch" }, T0 + 4 * 60_000)).ok, true);
  assert.deepEqual(await D.enterChat(t, { pseudo: "Tard", platform: "twitch" }, T0 + 5 * 60_000), { ok: false, reason: "closed" });
  assert.deepEqual(await D.status(t, T0 + 5 * 60_000), { open: false, keyword: "", level: "all" });
  assert.equal((await curRow(t)).data.status, "closed", "la fermeture est inscrite à la lecture");
  assert.equal((await curRow(t)).data.closedAt, new Date(T0 + 5 * 60_000).toISOString(), "à l'heure prévue, pas à l'heure de la lecture");
  // complet
  const f = audienceCtx(); await open(f);
  const row = await curRow(f); await f.api.store.update(row.id, { ...row.data, count: P.DRAW.maxEntries - 1 }, { key: "cur" });
  assert.deepEqual(await chat(f, "Dernière"), { ok: true });
  assert.deepEqual(await chat(f, "Trop"), { ok: false, reason: "full" });
  assert.equal(P.DRAW.maxEntries, 5000);
});

test("enter() : des dizaines d'appels en même temps ne créent jamais de doublon ni de dépassement", async () => {
  const c = audienceCtx(); await open(c);
  const calls = [...names(40), ...names(40)].map((n) => chat(c, n));
  const res = await Promise.all(calls);
  assert.equal(res.filter((r) => r.ok).length, 40); assert.equal(res.filter((r) => r.reason === "already").length, 40);
  assert.equal((await curRow(c)).data.count, 40); assert.equal((await entries(c)).length, 40);
});

/* ───────────── Le cycle ───────────── */

test("cycle : ouvert → fermé → tiré ; un seul tirage ouvert à la fois ; nouveau tirage = l'ancien va à l'historique ; rouvrir tant que personne n'est tiré", async () => {
  const c = audienceCtx();
  assert.deepEqual(await D.close(c), { ok: false, error: "none" });
  await open(c); for (const n of names(5)) await chat(c, n);
  assert.deepEqual(await D.openNew(c, FORM, { now: T0 + 1 }), { ok: false, error: "already_open" });
  assert.equal(P.stateOf((await curRow(c)).data, T0 + 1), "open");
  assert.deepEqual(await D.close(c, { now: T0 + 2 }), { ok: true });
  assert.deepEqual(await D.close(c, { now: T0 + 3 }), { ok: false, error: "not_open" });
  assert.equal((await D.current(c, T0 + 3)).status, "closed");
  assert.deepEqual(await chat(c, "Tard"), { ok: false, reason: "closed" });
  assert.deepEqual(await D.reopen(c, { now: T0 + 4 }), { ok: true }, "fermé par erreur : on rouvre, les inscriptions sont gardées");
  assert.equal((await D.current(c, T0 + 5)).count, 5);
  const pick = await D.pick(c, { now: T0 + 6 });
  assert.ok(pick.ok && pick.winners.length === 1, "tirer ferme tout seul un tirage ouvert");
  const d = await D.current(c, T0 + 7); assert.equal(d.status, "drawn"); assert.equal(P.stateOf(d, T0 + 7), "drawn");
  assert.deepEqual(await D.reopen(c, { now: T0 + 8 }), { ok: false, error: "cannot_reopen" });
  assert.deepEqual(await D.openNew(c, { ...FORM, title: "Deuxième" }, { now: T0 + 9 }).then((r) => r.ok), true, "tiré : un nouveau tirage est possible");
  const rows = await c.api.store.list("draws");
  assert.equal(rows.filter((r) => r.key === "cur").length, 1, "un seul tirage en cours");
  assert.equal((await D.history(c, T0 + 10)).length, 1);
  assert.deepEqual((await D.history(c, T0 + 10))[0].winners, pick.winners);
  assert.deepEqual((await entries(c)), [], "le nouveau tirage repart sans inscription");
});

test("bornes et validation du formulaire : titre, mot-clé, niveau, site, minutes 1 à 120, personnes 1 à 10, au moins un moyen de s'inscrire", () => {
  const ok = (v) => P.validateForm({ title: "T", keyword: "", site: true, ...v });
  assert.deepEqual(ok({}).errors, {});
  assert.equal(ok({ keyword: "!Cadeau" }).value.keyword, "!cadeau"); assert.equal(ok({ keyword: "cadeau" }).value.keyword, "!cadeau"); assert.equal(ok({ keyword: "  !  CADEAU " }).value.keyword, "!cadeau");
  assert.equal(ok({ keyword: "" }).value.keyword, ""); assert.equal(ok({ keyword: "!!x" }).value.keyword, "!x");
  for (const kw of ["deux mots", "a/b", "<b>", "x".repeat(31), "!"]) { const r = P.validateForm({ title: "T", keyword: kw, site: true }); if (kw === "!") assert.equal(r.value.keyword, ""); else assert.equal(r.errors.keyword, "kw_invalid", kw); }
  assert.equal(ok({ title: "" }).errors.title, "title_empty"); assert.equal(ok({ title: "x".repeat(61) }).errors.title, "title_long"); assert.deepEqual(ok({ title: "x".repeat(60) }).errors, {});
  assert.equal(ok({ level: "vip" }).errors.level, "level_invalid"); for (const l of ["all", "sub", "mod"]) assert.deepEqual(ok({ level: l }).errors, {});
  for (const m of ["0", "121", "-1", "1.5", "abc", "1e2"]) assert.equal(ok({ minutes: m }).errors.minutes, "minutes_invalid", m);
  for (const m of ["1", "120", "", null, undefined]) assert.deepEqual(ok({ minutes: m }).errors, {}, String(m));
  assert.equal(ok({ minutes: "" }).value.minutes, null);
  for (const w of ["0", "11", "x"]) assert.equal(ok({ winners: w }).errors.winners, "winners_invalid", w);
  assert.equal(ok({ winners: "10" }).value.winners, 10); assert.equal(ok({}).value.winners, 1);
  assert.equal(P.validateForm({ title: "T", keyword: "", site: false }).errors.site, "no_way", "ni chat ni site : rien à faire");
  assert.deepEqual(P.validateForm({ title: "T", keyword: "!a", site: "0" }).errors, {});
  assert.equal(P.validateForm({ title: "T", site: "peut-être" }).errors.site, "site_invalid");
  assert.equal(P.DRAW.minutesMax, 120); assert.equal(P.DRAW.winnersMax, 10); assert.equal(P.DRAW.history, 20); assert.equal(P.DRAW.pageSize, 50); assert.equal(P.DRAW.maxPseudo, 25);
});

test("un tirage « jusqu'à ce que je ferme » se ferme tout seul au bout de 48 h (constaté à la lecture) ; status() ne donne alors pas de date", async () => {
  const c = audienceCtx(); await open(c);
  assert.equal((await D.status(c, T0 + 47 * HOUR)).open, true); assert.equal("expiresAt" in await D.status(c, T0 + 47 * HOUR), false);
  assert.equal((await D.status(c, T0 + 48 * HOUR)).open, false);
  assert.equal((await curRow(c)).data.closedAt, new Date(T0 + 48 * HOUR).toISOString());
});

/* ───────────── Le tirage ───────────── */

test("tirage uniforme : chaque personne a la même chance (graine fixée : suite reproductible ; crypto.randomInt : écart borné) ; jamais de Math.random", async () => {
  const pool = Array.from({ length: 8 }, (_, i) => i);
  const count = async (rnd, n) => { const hits = new Array(8).fill(0); for (let i = 0; i < n; i++) hits[(await P.drawFrom(pool, 1, rnd)).picked[0]]++; return hits; };
  // graine : la même graine donne la même suite
  const a = await count(P.seeded(42), 4000), b = await count(P.seeded(42), 4000);
  assert.deepEqual(a, b, "reproductible");
  const chi = (hits, n) => hits.reduce((s, h) => s + (h - n / 8) ** 2 / (n / 8), 0);
  assert.ok(chi(a, 4000) < 24.3, `khi² de la suite graine : ${chi(a, 4000).toFixed(1)} (seuil 24,3 pour 7 degrés, p = 0,001)`);
  // le vrai hasard (crypto.randomInt) : 8 000 tirages, écart borné très large (≈ 7 écarts-types) pour ne jamais faire échouer la CI à tort
  const real = await count(undefined, 8000);
  for (const h of real) assert.ok(Math.abs(h - 1000) < 7 * Math.sqrt(8000 * (1 / 8) * (7 / 8)), `effectifs : ${real}`);
  // plusieurs personnes d'un coup : toutes différentes
  for (let i = 0; i < 50; i++) { const { picked } = await P.drawFrom(pool, 5, undefined); assert.equal(new Set(picked).size, 5); }
  // plus de personnes demandées que disponibles : on tire ce qu'il y a
  assert.equal((await P.drawFrom([1, 2], 10)).picked.length, 2);
  // une personne écartée (sourdine entre-temps) ne compte pas parmi les tirées
  const r = await P.drawFrom([1, 2, 3, 4], 2, P.seeded(1), async (x) => x !== 2);
  assert.equal(r.picked.length, 2); assert.ok(!r.picked.includes(2));
  const src = ["draw.mjs", "drawlib.mjs", "drawview.mjs"].map((f) => fs.readFileSync(new URL(`../modules/audience/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/Math\.random/.test(src), "le hasard d'un tirage ne vient jamais de Math.random");
  assert.match(fs.readFileSync(new URL("../modules/audience/drawlib.mjs", import.meta.url), "utf8"), /import \{[^}]*randomInt[^}]*\} from "node:crypto"/);
  assert.match(fs.readFileSync(new URL("../modules/audience/drawlib.mjs", import.meta.url), "utf8"), /randomInt\(m\)/);
});

test("pick() sur un vrai tirage : exclusion des personnes déjà tirées, plusieurs d'un coup, jusqu'à épuisement ; la graine d'essai donne un résultat reproductible", async () => {
  const c = audienceCtx(); await open(c, { winners: 3 });
  for (const n of names(7)) await chat(c, n);
  const first = await D.pick(c, { now: T0 + 1 });
  assert.ok(first.ok); assert.equal(first.winners.length, 3, "le nombre réglé pour ce tirage"); assert.equal(first.left, 4);
  const second = await D.pick(c, { count: 3, now: T0 + 2 });
  const third = await D.pick(c, { count: 10, now: T0 + 3 });
  const all = [...first.winners, ...second.winners, ...third.winners];
  assert.equal(all.length, 7); assert.equal(new Set(all).size, 7, "personne n'est tiré deux fois");
  assert.deepEqual(third.winners.length, 1);
  assert.deepEqual(await D.pick(c, { now: T0 + 4 }), { ok: false, error: "empty" });
  assert.equal(D.eligibleLeft(await D.current(c, T0 + 5)), 0);
  // reproductible avec une graine
  const mk = async () => { const x = audienceCtx(); await open(x); for (const n of names(20)) await chat(x, n); return x; };
  const [x, y] = [await mk(), await mk()];
  const rx = await D.pick(x, { count: 5, rnd: P.seeded(7), now: T0 + 1 }), ry = await D.pick(y, { count: 5, rnd: P.seeded(7), now: T0 + 1 });
  assert.deepEqual(rx.winners, ry.winners);
  // aucune inscription : refus clair
  const e = audienceCtx(); await open(e); assert.deepEqual(await D.pick(e), { ok: false, error: "empty" });
  assert.deepEqual(await D.pick(audienceCtx()), { ok: false, error: "none" });
});

test("re-tirage : « tirer une autre personne » écarte la personne absente pour de bon et en tire une autre ; les gagnants s'accumulent ; l'historique ne garde que les présents", async () => {
  const c = audienceCtx(); await open(c);
  for (const n of names(4)) await chat(c, n);
  const a = await D.pick(c, { now: T0 + 1 }); const d1 = await D.current(c, T0 + 2);
  const absent = d1.picked[0];
  const r = await D.redraw(c, { pid: absent.k, now: T0 + 3 });
  assert.ok(r.ok); assert.notEqual(r.winners[0], a.winners[0]);
  const d2 = await D.current(c, T0 + 4);
  assert.equal(d2.picked.find((w) => w.k === absent.k).absent, true);
  assert.deepEqual(D.latestBatch(d2).map((w) => w.pseudo), r.winners, "à l'écran : la nouvelle personne seulement");
  // on peut tirer jusqu'à épuisement, la personne absente n'est jamais re-tirée
  const rest = await D.pick(c, { count: 10, now: T0 + 5 });
  assert.ok(!rest.winners.includes(a.winners[0])); assert.equal(rest.winners.length, 2);
  assert.deepEqual(await D.redraw(c, { pid: "0".repeat(40) }), { ok: false, error: "gone" });
  // retirer une personne tirée la retire aussi des gagnants
  const d3 = await D.current(c, T0 + 6); const w = d3.picked.find((x) => !x.absent);
  assert.ok((await D.removeEntry(c, w.k, { now: T0 + 7 })).ok);
  assert.ok(!(await D.current(c, T0 + 8)).picked.some((x) => x.k === w.k));
  await D.openNew(c, { ...FORM, title: "Suivant" }, { now: T0 + 9 });
  const h = (await D.history(c, T0 + 10))[0];
  assert.ok(!h.winners.includes(a.winners[0]), "la personne absente n'est pas dans l'historique");
});

test("une personne mise en sourdine après son inscription est écartée du tirage sans compter", async () => {
  const c = audienceCtx(); await open(c);
  for (const n of names(6)) await chat(c, n);
  const room = await K.getRoom(c, "draw");
  const list = await entries(c);
  for (const e of list.slice(0, 5)) await K.setMuted(c, room, { id: e.k }, true);
  const r = await D.pick(c, { count: 3, now: T0 + 1 });
  assert.equal(r.winners.length, 1); assert.equal(r.winners[0], list[5].pseudo);
  assert.equal((await D.current(c, T0 + 2)).count, 1, "les personnes écartées sont retirées de la liste");
});

test("« Vider le tirage » : inscriptions et gagnants effacés, réglages et état gardés, l'ancienne liste part à l'effacement ; « Retirer cette personne » (avec ou sans sourdine)", async () => {
  const c = audienceCtx(); await open(c);
  for (const n of names(5)) await chat(c, n);
  await D.pick(c, { now: T0 + 1 });
  const before = await D.current(c, T0 + 2);
  const r = await D.clear(c, { now: T0 + 3 }); assert.deepEqual(r, { ok: true, removed: 5 });
  const after = await D.current(c, T0 + 4);
  assert.equal(after.count, 0); assert.deepEqual(after.picked, []); assert.equal(after.title, before.title); assert.equal(after.keyword, before.keyword); assert.equal(after.status, "closed", "tiré → fermé");
  assert.deepEqual(await entries(c), []);
  await D.sweep(c, T0 + 5);
  assert.equal(c.api.store.dump(`de-${before.k}-0`).length, 0, "l'ancienne liste est effacée");
  assert.deepEqual(await D.clear(audienceCtx()), { ok: false, error: "none" });
  // retirer
  const e = audienceCtx(); await open(e); for (const n of names(3)) await chat(e, n);
  const [p1, p2] = await entries(e);
  assert.ok((await D.removeEntry(e, p1.k)).ok); assert.equal((await D.current(e)).count, 2);
  assert.deepEqual(await D.removeEntry(e, p1.k), { ok: false, error: "gone" }); assert.deepEqual(await D.removeEntry(e, "pas-un-id"), { ok: false, error: "gone" });
  assert.deepEqual(await chat(e, p1.pseudo), { ok: true }, "retirée sans sourdine : elle peut se réinscrire");
  assert.ok((await D.removeEntry(e, p2.k, { mute: true })).ok);
  assert.deepEqual(await chat(e, p2.pseudo), { ok: false, reason: "muted" }, "retirée avec sourdine : refusée");
});

/* ───────────── Effacement après 24 h, historique ───────────── */

test("les inscriptions sont effacées 24 h après la fermeture (à la lecture) ; la sourdine reste ; l'historique garde titre, date, gagnants, nombre", async () => {
  const c = audienceCtx(); await open(c);
  for (const n of names(6)) await chat(c, n);
  const room = await K.getRoom(c, "draw"); const list = await entries(c);
  const won = await D.pick(c, { now: T0 + HOUR });
  await K.setMuted(c, room, { id: list[0].k }, true);   // en sourdine APRÈS le tirage : elle garde sa fiche quand la liste est effacée
  const closedAt = Date.parse((await D.current(c, T0 + HOUR)).closedAt);
  // juste avant : tout est là
  const before = await D.current(c, closedAt + 24 * HOUR - 1);
  assert.equal(before.purged, false); assert.equal((await D.entriesPage(c, before, null)).items.length, 6);
  assert.equal((await K.getRoom(c, "draw")).count, 6);
  // à 24 h : la lecture constate, la liste n'est plus lisible, l'état ne change pas
  const at = closedAt + 24 * HOUR;
  const after = await D.current(c, at);
  assert.equal(after.purged, true); assert.equal(after.count, 0); assert.equal(after.total, 6); assert.equal(after.status, "drawn");
  assert.deepEqual((await D.entriesPage(c, after, null)).items, []);
  assert.deepEqual(await D.pick(c, { now: at + 1 }), { ok: false, error: "gone" });
  assert.deepEqual(await D.reopen(c, { now: at + 1 }), { ok: false, error: "cannot_reopen" });
  // le ménage efface les lignes, par tranches, ainsi que la fiche des personnes (sauf sourdine)
  let removed = 0; for (let i = 0; i < 5; i++) removed += await D.sweep(c, at + 10);
  assert.ok(removed >= 6);
  assert.equal(c.api.store.dump(`de-${after.k}-0`).length, 0, "plus aucune inscription gardée");
  const left = c.api.store.dump("p-" + room.id + "-0").map((r) => r.data).filter((r) => !r.n);
  assert.deepEqual(left.map((r) => r.k), [list[0].k], "seule la personne en sourdine garde sa fiche (sa sourdine)");
  assert.equal((await K.getRoom(c, "draw")).count, 1);
  assert.deepEqual((await D.history(c, at + 20))[0], { title: FORM.title, at: new Date(closedAt).toISOString(), winners: won.winners, participants: 6 });
  assert.equal((await D.status(c, at)).open, false);
});

test("historique : 20 tirages au plus (les plus anciens s'effacent), du plus récent au plus ancien ; un tirage ouvert n'y est pas", async () => {
  const c = audienceCtx();
  for (let i = 1; i <= 23; i++) { await open(c, { title: `Tirage ${i}` }, T0 + i * 1000); await chat(c, "Lune" + i); await D.pick(c, { now: T0 + i * 1000 + 1 }); }
  await open(c, { title: "En cours" }, T0 + 30_000);
  const h = await D.history(c, T0 + 31_000);
  assert.equal(h.length, 20); assert.equal(h[0].title, "Tirage 23"); assert.equal(h.at(-1).title, "Tirage 4"); assert.ok(!h.some((x) => x.title === "En cours"));
  assert.ok((await c.api.store.list("draws")).length <= 21, "borné : l'historique et le tirage en cours");
  assert.deepEqual(h[0].winners, ["Lune23"]); assert.equal(h[0].participants, 1);
});

/* ───────────── Télécommande et dock ───────────── */

const press = async (c, key, action) => { const r = await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: key, panel: "audience", action }), c); return [r.status, await r.json()]; };
const state = async (c, key) => (await (await def.routes["remote-state"](req(`${BASE}/remote-state?k=${key}`), c)).json());
const dispatcher = (c) => async (url, init) => { const name = new URL(url).pathname.split("/").pop(); return def.routes[name](req(url, init.body ? JSON.parse(init.body) : undefined, { method: init.method }), c); };

test("télécommande : le panneau « Tirage au sort » a trois boutons, suit l'état, et chaque geste passe par la même logique (journal « Télécommande »)", async () => {
  const c = audienceCtx(); const key = (await meta(c)).remoteKey;
  let panel = (await state(c, key)).panels.find((p) => p.id === "audience");
  assert.equal(panel.title, fr.drawRemoteTitle);
  assert.deepEqual(panel.buttons.map((b) => [b.id, b.label, b.disabled, !!b.confirm]), [["draw-open", "Ouvrir le tirage", false, false], ["draw-close", "Fermer", true, true], ["draw-pick", "Tirer une personne au sort", true, true]]);
  assert.equal(panel.state.text, fr.drawRemoteNone);
  let [status, body] = await press(c, key, "draw-open"); assert.deepEqual([status, body.ok, body.message], [200, true, fr.drawOkOpened]);
  assert.equal((await D.current(c)).title, fr.drawDefaultTitle, "première ouverture : réglages simples (titre, site oui, sans chat)");
  for (const n of names(4)) await D.enterSite(c, { token: tok(+n.slice(-3)), name: n, conn: { forwarded: "1.1.1.1" } }, def.services["audience.session"].join.bind(null));
  panel = (await state(c, key)).panels.find((p) => p.id === "audience");
  assert.equal(panel.state.tone, "live"); assert.ok(panel.state.text.includes("Inscriptions : 4")); assert.equal(panel.buttons[0].disabled, true);
  [status, body] = await press(c, key, "draw-open"); assert.deepEqual([status, body.ok, body.error], [400, false, "already_open"]);
  [status, body] = await press(c, key, "draw-pick"); assert.deepEqual([status, body.ok], [200, true]); assert.match(body.message, /tirée au sort : /);
  panel = (await state(c, key)).panels.find((p) => p.id === "audience");
  assert.equal(panel.state.tone, "done"); assert.ok(panel.state.text.includes("tirage fait"));
  assert.equal(panel.buttons[0].confirm, fr.drawOpenConfirm, "ouvrir à la place d'un tirage fait : « cliquez encore »");
  [status, body] = await press(c, key, "draw-open"); assert.ok(body.ok);
  assert.equal((await D.current(c)).count, 0, "un nouveau tirage, mêmes réglages");
  [status, body] = await press(c, key, "draw-pick"); assert.deepEqual([status, body.ok, body.error, body.message], [400, false, "empty", fr.drawErrEmpty]);
  [status, body] = await press(c, key, "draw-close"); assert.ok(body.ok); assert.equal((await D.current(c)).status, "closed");
  [status, body] = await press(c, key, "draw-close"); assert.deepEqual([body.ok, body.error], [false, "not_open"]);
  [status, body] = await press(c, key, "draw-reopen"); assert.deepEqual([status, body.error], [400, "invalid"]);
  const log = (await c.api.store.list("audit")).map((x) => x.data);
  assert.ok(log.some((l) => l.who === "remote" && l.what === "draw.new") && log.some((l) => l.who === "remote" && l.what === "draw.pick" && l.detail) && log.some((l) => l.who === "remote" && l.what === "draw.close"));
  assert.ok(!flat(log).includes(key), "l'adresse secrète n'est jamais dans le journal");
  const bad = await def.routes["remote-press"](req(`${BASE}/remote-press`, { k: "mauvaise", panel: "audience", action: "draw-pick" }), c);
  assert.equal(bad.status, 404, "sans la bonne adresse : rien ne bouge");
});

test("télécommande : « Ouvrir le tirage » rouvre un tirage fermé par erreur (sans personne tirée), sinon en ouvre un nouveau avec les mêmes réglages", async () => {
  const c = audienceCtx(); const key = (await meta(c)).remoteKey;
  await open(c, { title: "Mon titre", keyword: "!x", level: "sub", minutes: 30, winners: 2 });
  await chat(c, "Lune", { role: "sub" }); await D.close(c, { now: T0 + 1 });
  assert.equal((await state(c, key)).panels.at(-1).buttons[0].confirm, "", "rouvrir ne demande pas de confirmation");
  const [, b] = await press(c, key, "draw-open"); assert.equal(b.message, fr.drawOkReopened);
  assert.equal((await D.current(c)).count, 1);
  await D.pick(c, { now: T0 + 2 });
  await press(c, key, "draw-open");
  const d = await D.current(c); assert.deepEqual([d.title, d.keyword, d.level, d.winners, d.site], ["Mon titre", "!x", "sub", 2, true]); assert.equal(d.count, 0);
  assert.equal((await state(c, key)).panels.at(-1).buttons[2].label, "Tirer 2 personnes au sort", "plusieurs personnes : le bouton le dit");
});

test("dock : les trois boutons sont là sans autre travail (40 px, une colonne), « Fermer » et « Tirer » demandent de cliquer encore, le tirage se fait", async () => {
  const c = audienceCtx(); const key = (await meta(c)).remoteKey;
  const html = await (await def.routes.remote(req(`${BASE}/remote?k=${key}&dock=1`), c)).text();
  const page = runRemotePage(html, { dispatch: dispatcher(c) }); await page.advance(10);
  const btns = () => page.root.all("button").filter((b) => !b.className.includes("ar-mini")).map((b) => b.textContent);
  assert.deepEqual(btns().slice(0, 3), ["Ouvrir le tirage", "Fermer", "Tirer une personne au sort"]);
  assert.equal(page.root.all("h2")[0].textContent, fr.drawRemoteTitle);
  const [bOpen] = page.root.all("button"); bOpen.click(); await page.advance(10);
  assert.equal((await D.current(c)).status, "open", "un clic suffit pour ouvrir");
  for (const i of [1, 2]) assert.ok((await D.enterSite(c, { token: tok(i), name: `Personne${i}x`, conn: { forwarded: "1.1.1.1" } }, def.services["audience.session"].join)).ok);
  await page.advance(20_000);
  const [, bClose, bPick] = page.root.all("button");
  assert.equal(bClose.disabled, false);
  bPick.click(); await page.advance(10);
  assert.ok(page.root.all("button")[2].textContent.includes(fr.dockAgain), "« cliquez encore » (et non « touchez »)");
  assert.equal((await D.current(c)).status, "open", "un premier clic ne tire personne");
  page.root.all("button")[2].click(); await page.advance(10);
  assert.equal((await D.current(c)).status, "drawn"); assert.equal((await D.current(c)).picked.length, 1);
  assert.ok(page.toast.textContent.includes("tirée au sort"), page.toast.textContent);
  assert.ok(html.includes(".ar-dock .ar-btn{min-height:40px"));
});

/* ───────────── La page d'inscription du site ───────────── */

const join = (c) => def.services["audience.session"].join;
const enterSite = (c, i, name, ip = "7.7.7.7", extra = {}) => def.routes["draw-enter"](req(`${BASE}/draw-enter`, { t: tok(i), name, ...extra }, { ip }), c);
const meSite = (c, i, ip = "7.7.7.7") => def.routes["draw-me"](req(`${BASE}/draw-me`, { t: tok(i) }, { ip }), c);

test("page publique : /participation/tirage dit l'état (aucun tirage, fermé, chat seulement, ouvert) ; formulaire clair ; aucun cookie ; les anciennes pages ne changent pas", async () => {
  const c = audienceCtx();
  const html = async (cc = c) => (await def.page(cc, { segments: ["tirage"] })).blocks[0].html;
  let h = await html(); assert.ok(h.includes(fr.drawStateNone.replace(/'/g, "&#39;")) && h.includes("data-aud-draw") && h.includes("<form data-aud-form novalidate hidden>"), "pas de tirage : formulaire caché");
  await open(c, { site: false, keyword: "!cadeau" });
  h = await html(); assert.ok(h.includes("tapez !cadeau dans le chat") || h.includes("!cadeau"), "chat seulement : le mot est donné"); assert.ok(h.includes("<form data-aud-form novalidate hidden>"));
  await D.close(c, { now: Date.now() }); await open(c, { site: true, title: "Mon <b>tirage</b>", keyword: "" }, Date.now());
  h = await html(); assert.ok(h.includes("<form data-aud-form novalidate>") && h.includes(fr.drawJoin) && h.includes("Mon &lt;b&gt;tirage&lt;/b&gt;"), "titre échappé"); assert.ok(!h.includes("Mon <b>"));
  assert.ok(h.includes('autocomplete="nickname"') && h.includes('name="website"'), "champ pseudo et piège à robots");
  assert.ok(!/cookie/i.test(h) && ![...(await enterSite(c, 1, "Lune-Rousse")).headers.keys()].some((k) => /cookie/i.test(k)), "aucun cookie");
  for (const code of ["closed", "no_site", "already", "muted", "full", "pseudo_short", "pseudo_taken", "limit", "net"]) assert.ok(h.includes(`data-m-${code}="`), code);
  assert.equal((await def.page(c, { segments: ["autre"] })).notFound, true); assert.equal((await def.page(c, { segments: [] })).blocks[0].html.includes("data-aud-draw"), false, "la page Participation reste la même");
  assert.equal(C.CLIENT_REV, 2);
});

test("inscription depuis le site : pseudo vérifié (mêmes règles), une seule fois par navigateur, sourdine, tirage fermé ou réservé au chat, limites, piège à robots", async () => {
  const c = audienceCtx(); await open(c, { site: true });
  let r = await enterSite(c, 1, "Lune-Rousse"); let b = await r.json(); assert.deepEqual([r.status, b.ok, b.pseudo, b.count], [200, true, "Lune-Rousse", 1]);
  r = await enterSite(c, 1, "Lune-Rousse"); b = await r.json(); assert.deepEqual([r.status, b.error], [409, "already"]);
  r = await enterSite(c, 1, "Autre Pseudo"); b = await r.json(); assert.deepEqual([r.status, b.error], [409, "already"], "une inscription par navigateur, même avec un autre pseudo");
  assert.equal((await D.current(c)).count, 1);
  // erreurs de pseudo : sous le champ, avec les mêmes codes que la page Participation
  for (const [name, code, st] of [["ab", "pseudo_short", 400], ["x".repeat(30), "pseudo_long", 400], ["<b>Lune</b>", "pseudo_chars", 400], ["administrateur", "pseudo_banned", 400], ["lune rousse", "pseudo_taken", 409], ["", "pseudo_short", 400]]) {
    r = await enterSite(c, 50, name); b = await r.json(); assert.deepEqual([r.status, b.ok, b.error], [st, false, code], name);
  }
  assert.equal((await D.current(c)).count, 1, "un pseudo refusé n'inscrit personne");
  // sourdine
  const room = await K.getRoom(c, "draw");
  assert.equal((await enterSite(c, 2, "Sera Muet")).status, 200);
  await K.setMuted(c, room, { id: (await K.findParticipant(c, room, tok(2))).data.k }, true);
  await D.removeEntry(c, (await K.findParticipant(c, room, tok(2))).data.k);
  r = await enterSite(c, 2, "Sera Muet"); b = await r.json(); assert.deepEqual([r.status, b.error], [403, "muted"]);
  // routes : méthode, forme
  assert.equal((await def.routes["draw-enter"](req(`${BASE}/draw-enter`, undefined, { method: "GET" }), c)).status, 405);
  assert.equal((await def.routes["draw-enter"](req(`${BASE}/draw-enter`, "pas du json"), c)).status, 400);
  assert.equal((await def.routes["draw-enter"](req(`${BASE}/draw-enter`, { t: "court", name: "Lune-Rousse" }), c)).status, 400);
  assert.equal((await def.routes["draw-enter"](req(`${BASE}/draw-enter`, { t: tok(3), name: 42 }), c)).status, 400);
  assert.equal((await def.routes["draw-enter"](req(`${BASE}/draw-enter`, "x".repeat(5000)), c)).status, 413);
  b = await (await enterSite(c, 4, "Robot Ravi", "7.7.7.7", { website: "http://spam" })).json(); assert.deepEqual(b, { ok: true, pseudo: null }); assert.equal((await D.current(c)).count, 1, "le piège à robots ne crée rien");
  // fermé / chat seulement
  await D.close(c, { now: Date.now() });
  r = await enterSite(c, 5, "Trop Tard"); b = await r.json(); assert.deepEqual([r.status, b.error], [400, "closed"]);
  await open(c, { site: false, keyword: "!x" }, Date.now());
  r = await enterSite(c, 5, "Trop Tard"); b = await r.json(); assert.deepEqual([r.status, b.error], [400, "no_site"]);
  assert.equal(JSON.stringify((await c.api.store.list("rooms")).map((x) => x.data)).includes("Trop Tard"), false);
});

test("inscription depuis le site : limites par connexion (30 par heure) et globale ; pas de code ni d'adresse dans les données ; « me » dit si on participe déjà", async () => {
  const c = audienceCtx(); await open(c, { site: true });
  let last; for (let i = 0; i < 32; i++) last = await enterSite(c, 100 + i, `Nom ${i}`, "5.5.5.5");
  assert.equal(last.status, 429); assert.equal((await last.json()).error, "limit"); assert.ok(last.headers.get("retry-after"));
  assert.equal((await enterSite(c, 300, "Autre Connexion", "5.5.5.6")).status, 200, "une autre connexion n'est pas freinée");
  const me = await (await meSite(c, 300, "5.5.5.6")).json(); assert.deepEqual([me.ok, me.open, me.site, me.in, me.pseudo], [true, true, true, true, "Autre Connexion"]);
  const nobody = await (await meSite(c, 999, "5.5.5.6")).json(); assert.deepEqual([nobody.in, nobody.pseudo], [false, null]);
  assert.equal((await def.routes["draw-me"](req(`${BASE}/draw-me`, { t: "bad" }), c)).status, 400);
  const dump = flat(c.api.store.all().map((r) => r.data));
  assert.ok(!dump.includes(tok(300)) && !dump.includes("5.5.5.6") && !dump.includes("5.5.5.5"), "ni code de navigateur ni adresse de connexion dans les données");
  assert.ok(!/"(ip|email|mail|login)"/i.test(dump));
});

/** Un navigateur factice juste assez grand pour la page d'inscription : le VRAI script de la page (CLIENT_JS) tourne contre les VRAIES routes. */
function runDrawPage(html, dispatch) {
  const attrs = {}; for (const m of /<section class="au" data-aud-draw ([^>]*)>/.exec(html)[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const node = (extra = {}) => ({ hidden: false, textContent: "", value: "", disabled: false, attrs: {}, listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; }, focus() {}, ...extra });
  const nodes = { form: node(), name: node(), err: node({ hidden: true }), ok: node({ hidden: true }), state: node({ textContent: "" }), count: node(), title: node(), btn: node({ textContent: "Je participe" }), hp: node() };
  const pick = { "[data-aud-form]": nodes.form, "[data-aud-name]": nodes.name, "[data-aud-err]": nodes.err, "[data-aud-ok]": nodes.ok, "[data-aud-state]": nodes.state, "[data-aud-count]": nodes.count, "[data-aud-title]": nodes.title };
  nodes.form.querySelector = (s) => (s === "button[type=submit]" ? nodes.btn : s === "input[name=website]" ? nodes.hp : null);
  const el = node({ getAttribute: (k) => attrs[k] ?? null, querySelector: (s) => pick[s] ?? null });
  const store = {};
  const win = {
    document: { querySelectorAll: (s) => (s === "[data-aud-draw]" ? [el] : []) }, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => delete store[k] },
    crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) & 255; return b; } }, btoa: (s) => Buffer.from(s, "binary").toString("base64"), AbortSignal, encodeURIComponent, Uint8Array, String, JSON, Date,
    fetch: async (url, init) => { const r = await dispatch(new URL(url, "https://x.test").href, init); return { status: r.status, json: () => r.json() }; },
  };
  win.window = win; vm.runInContext(C.CLIENT_JS, vm.createContext(win));
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  return { nodes, store, flush, submit: async (name) => { nodes.name.value = name; nodes.form.listeners.submit({ preventDefault() {} }); await flush(); } };
}

test("page publique (script du navigateur) : « Vous participez ! » après l'inscription, erreurs SOUS le champ avec un exemple, déjà inscrit à l'ouverture de la page, aucune mémoire hors du code anonyme", async () => {
  const c = audienceCtx(); await open(c, { site: true, title: "Cadeau" });
  const html = (await def.page(c, { segments: ["tirage"] })).blocks[0].html;
  const dispatch = async (url, init) => def.routes[new URL(url).pathname.split("/").pop()](req(url, JSON.parse(init.body), { ip: "6.6.6.6" }), c);
  const p = runDrawPage(html, dispatch); await p.flush();
  assert.equal(p.nodes.form.hidden, false, "ouvert : le formulaire est là");
  assert.equal(p.nodes.count.textContent, "0 personnes inscrites");
  await p.submit("ab");
  assert.equal(p.nodes.err.hidden, false); assert.match(p.nodes.err.textContent, /trop court.*Exemple : Lune-Rousse/); assert.equal(p.nodes.name.attrs["aria-invalid"], "true");
  await p.submit("administrateur"); assert.equal(p.nodes.err.textContent, fr.pm_pseudo_banned);
  await p.submit("Lune-Rousse");
  assert.equal(p.nodes.err.hidden, true); assert.equal(p.nodes.state.textContent, "Vous participez !"); assert.equal(p.nodes.form.hidden, true);
  assert.equal(p.nodes.count.textContent, "1 personne inscrite");
  assert.deepEqual(Object.keys(p.store), ["aud-id"], "rien d'autre que le code anonyme déjà utilisé par Participation");
  // la même personne revient : « Vous participez ! » dès l'ouverture
  const again = runDrawPage(html, dispatch); await again.flush();
  assert.equal(again.nodes.state.textContent, "Vous participez !"); assert.equal(again.nodes.form.hidden, true);
  // tirage fermé : plus de formulaire
  await D.close(c, { now: Date.now() });
  const closed = runDrawPage(html, dispatch); await closed.flush();
  assert.equal(closed.nodes.form.hidden, true); assert.equal(closed.nodes.state.textContent, fr.drawStateClosed);
});

/* ───────────── Administration ───────────── */

const adminOf = async (c, query = {}) => (await def.adminPanel(c, { query })).filter((b) => b.tab === "draw");

test("administration : onglet « Tirage au sort » (formulaire, gestes, 50 personnes par page, historique, adresse de l'écran) ; sans le droit « draw.manage », rien", async () => {
  const c = audienceCtx();
  let blocks = await adminOf(c);
  assert.ok(blocks.some((b) => b.type === "adminForm" && b.action === "drawNew"), "nouveau tirage proposé");
  const form = blocks.find((b) => b.action === "drawNew");
  assert.deepEqual(form.fields.map((f) => f.name), ["title", "keyword", "level", "site", "minutes", "winners"]);
  assert.deepEqual(form.fields.find((f) => f.name === "level").options.map((o) => o.value), ["all", "sub", "mod"]);
  await open(c, { site: true }); for (const n of names(120)) await chat(c, n);
  blocks = await adminOf(c);
  assert.ok(blocks.some((b) => b.action === "drawClose") && blocks.some((b) => b.action === "drawPick") && !blocks.some((b) => b.action === "drawNew") && blocks.some((b) => b.action === "drawClear"));
  const table = blocks.find((b) => b.type === "table" && b.columns[0] === fr.colPseudo && b.rowIds);
  assert.equal(table.rows.length, 50, "50 par page"); assert.equal(table.rowIds.length, 50);
  assert.deepEqual(table.rowActions.map((a) => a.label), ["Retirer cette personne", "Retirer et mettre en sourdine"]); assert.ok(table.rowActions.every((a) => a.confirm && a.danger));
  const next = blocks.find((b) => b.type === "markdown" && /c=/.test(b.text)); assert.ok(next);
  const cursor = decodeURIComponent(/c=([^)]*)\)/.exec(next.text)[1]);
  const p2 = (await adminOf(c, { c: cursor })).find((b) => b.rowIds); assert.equal(p2.rows.length, 50);
  const p3 = (await adminOf(c, { c: String(100) })).find((b) => b.rowIds); assert.equal(p3.rows.length, 20);
  assert.ok(flat(blocks).includes(`${c.api.siteUrl}/participation/tirage`), "l'adresse de la page d'inscription est donnée");
  const screen = blocks.find((b) => b.type === "copy" && b.label === fr.drawScreenAddress);
  assert.equal(screen.text, `${c.api.siteUrl}/overlays/${c.instance.key}?k=${await D.screenKey(c)}`);
  // sans le droit : aucune liste de pseudos, aucune adresse, aucun formulaire
  const noRight = flat(await adminOf(audienceCtx({ can: (r) => r === "moderate" })));
  assert.ok(noRight.includes(fr.drawNoRight) && !noRight.includes("adminForm") && !noRight.includes("overlays/"));
  for (const k of ["drawNew", "drawClose", "drawReopen", "drawPick", "drawRedraw", "drawClear", "drawRemove", "drawRemoveMute", "drawKeyRegen"]) {
    const r = await def.adminActions[k](audienceCtx({ can: (x) => x === "moderate" }), { title: "T", id: "x" });
    assert.deepEqual(r, { error: fr.errRight }, `${k} : refusé sans le droit`);
  }
  assert.ok(manifest.rights.find((x) => x.id === "draw.manage"));
});

test("administration : actions (nouveau tirage avec erreurs sous les champs, fermer, tirer, tirer une autre personne, retirer, vider, changer l'adresse) et journal « qui a décidé quoi »", async () => {
  const c = audienceCtx(); const A = def.adminActions;
  let r = await A.drawNew(c, { title: "", keyword: "deux mots", level: "all", site: "1", minutes: "999", winners: "11" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["keyword", "minutes", "title", "winners"]);
  assert.match(r.errors.minutes, /Exemple : 15/); assert.match(r.errors.keyword, /Exemple : !cadeau/); assert.match(r.errors.title, /Exemple : Cadeau du jour/);
  r = await A.drawNew(c, { title: "T", keyword: "", site: "0", level: "all", minutes: "", winners: "1" }); assert.match(r.errors.site, /Exemple/);
  r = await A.drawNew(c, { title: "Gros lot", keyword: "Lot", level: "sub", site: "1", minutes: "20", winners: "2" }); assert.deepEqual(r, { ok: fr.okDrawNew });
  assert.deepEqual((await A.drawNew(c, { title: "Bis", site: "1" })), { error: fr.drawErrAlreadyOpen });
  for (const n of names(6)) await chat(c, n, { role: "sub" });
  r = await A.drawPick(c, { count: "0" }); assert.match(r.errors.count, /Exemple : 1/);
  r = await A.drawPick(c, { count: "2" }); assert.ok(r.ok.startsWith("Tirage fait.")); assert.equal((await D.current(c)).picked.length, 2);
  const d = await D.current(c);
  assert.deepEqual(await A.drawClose(c, {}), { error: fr.drawErrNotOpen });
  r = await A.drawRedraw(c, { id: d.picked[0].k }); assert.ok(r.ok);
  r = await A.drawRemove(c, { id: (await entries(c))[0].k }); assert.deepEqual(r, { ok: fr.okDrawRemoved });
  r = await A.drawRemoveMute(c, { id: (await entries(c)).find((e) => !e.won).k }); assert.deepEqual(r, { ok: fr.okDrawRemovedMuted });
  assert.deepEqual(await A.drawClear(c, { confirm: "" }), { errors: { confirm: fr.errConfirm } });
  r = await A.drawClear(c, { confirm: "on" }); assert.ok(r.ok.startsWith("Tirage vidé"));
  const before = await D.screenKey(c);
  assert.deepEqual(await A.drawKeyRegen(c, { confirm: "" }), { errors: { confirm: fr.errConfirm } });
  assert.deepEqual(await A.drawKeyRegen(c, { confirm: "on" }), { ok: fr.okDrawKey }); assert.notEqual(await D.screenKey(c), before);
  const log = (await c.api.store.list("audit")).map((x) => x.data);
  for (const what of ["draw.new", "draw.pick", "draw.redraw", "draw.remove", "mute", "draw.clear", "draw.key"]) assert.ok(log.some((l) => l.who === "admin" && l.what === what), what);
  const text = await (async () => { const blocks = await def.adminPanel(c, { query: {} }); return flat(blocks.filter((b) => b.tab === "people")); })();
  assert.ok(text.includes("Tirage au sort fait") && text.includes("Nouveau tirage"), "le journal (onglet Salles) lit ces lignes en clair");
  assert.ok(!flat(log).includes(await D.screenKey(c)), "le code de l'écran n'est jamais dans le journal");
});

/* ───────────── Outils pour l'assistant ───────────── */

test("outils de l'assistant : draw_status (lecture, jamais la liste des inscrits), draw_open / draw_close / draw_pick (écritures), erreurs claires, journal « Assistant IA »", async () => {
  const c = audienceCtx();
  let s = await def.mcp.draw_status(c); assert.equal(s.state, "none"); assert.deepEqual(s.winners, []); assert.equal(s.participants, 0);
  await assert.rejects(def.mcp.draw_open(c, { title: "" }), (e) => e.expose && /invalid: title/.test(e.message));
  await assert.rejects(def.mcp.draw_open(c, { title: "T", keyword: "", site: false }), (e) => e.expose && /site/.test(e.message));
  const o = await def.mcp.draw_open(c, { title: "Cadeau", keyword: "cadeau", minutes: 10, winners: 2 }); assert.deepEqual([o.opened, o.keyword], [true, "!cadeau"]); assert.ok(o.closesAt);
  await assert.rejects(def.mcp.draw_open(c, { title: "Bis" }), (e) => e.expose && /already open/.test(e.message));
  for (const n of names(4)) await chat(c, n);
  s = await def.mcp.draw_status(c); assert.deepEqual([s.state, s.participants, s.keyword, s.level, s.siteSignup], ["open", 4, "!cadeau", "all", true]);
  assert.ok(!flat(s).includes("Personne001"), "la liste des inscrits n'est pas donnée à l'assistant");
  assert.deepEqual(await def.mcp.draw_close(c), { closed: true });
  await assert.rejects(def.mcp.draw_close(c), (e) => e.expose);
  const pk = await def.mcp.draw_pick(c, {}); assert.equal(pk.winners.length, 2);
  s = await def.mcp.draw_status(c); assert.deepEqual([s.state, s.winners.length], ["drawn", 2]);
  await def.mcp.draw_pick(c, { count: 10 }); await assert.rejects(def.mcp.draw_pick(c, {}), (e) => e.expose && /nobody left/.test(e.message));
  const log = (await c.api.store.list("audit")).map((x) => x.data);
  assert.ok(log.filter((l) => l.who === "assistant").map((l) => l.what).includes("draw.pick"));
});

/* ───────────── Textes, vie privée, bornes ───────────── */

test("textes du tirage : parité EXACTE FR/EN (mêmes clés, mêmes variables), toutes les clés utilisées existent, vouvoiement, mots simples", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const vars = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(fr)) assert.equal(vars(fr[k]), vars(en[k]), k);
  const code = ["index", "draw", "drawview", "remote"].map((f) => fs.readFileSync(new URL(`../modules/audience/${f}.mjs`, import.meta.url), "utf8")).join("\n");
  for (const m of code.matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) assert.ok(m[1] in fr, `clé manquante : ${m[1]}`);
  for (const lv of P.LEVELS) assert.ok(`drawLevel_${lv}` in fr);
  for (const st of ["open", "closed", "drawn"]) assert.ok(`drawState_${st}` in fr);
  for (const e of ["title_empty", "title_long", "kw_invalid", "level_invalid", "site_invalid", "minutes_invalid", "winners_invalid", "no_way"]) assert.ok(`drawErr_${e}` in fr && fr[`drawErr_${e}`].length > 10, e);
  for (const e of ["closed", "no_site", "already", "muted", "full"]) assert.ok(`dm_${e}` in fr);
  for (const w of ["new", "close", "reopen", "pick", "redraw", "remove", "clear", "key"]) assert.ok(`what_draw_${w}` in fr);
  const mine = Object.entries(fr).filter(([k]) => /^(draw|okDraw|dm_|what_draw)/.test(k)).map(([, v]) => v).join(" ");
  assert.ok(!/\b(tu|ton|ta|tes|toi)\b/i.test(mine), "vouvoiement");
  assert.ok(!/\b(gagnant|gagnante|participant|participants|vainqueur|utilisateur|visiteur)\b/i.test(mine), "pas de mot qui suppose un genre");
  for (const k of ["drawErr_minutes_invalid", "drawErr_kw_invalid", "drawErr_title_empty", "drawErr_winners_invalid", "drawErr_no_way"]) assert.match(fr[k], /Exemple/, `${k} : un exemple sous le champ`);
  assert.ok(!/<[a-z!/]/i.test(mine), "du texte, pas du HTML");
});

test("vie privée et bornes : rien de plus que le pseudo (aucun login en clair, aucune adresse) ; les inscriptions et la liste d'attente d'effacement sont bornées", async () => {
  const c = audienceCtx(); await open(c);
  await chat(c, "Lune", { login: "lune_secrete_42" });
  const dump = flat(c.api.store.all().map((r) => r.data));
  assert.ok(!dump.includes("lune_secrete_42"), "le login n'est jamais gardé"); assert.ok(dump.includes("Lune"));
  const entry = (await entries(c))[0]; assert.deepEqual(Object.keys(entry).sort(), ["at", "k", "pseudo", "src"], "une inscription = pseudo, origine, date, identifiant brouillé");
  assert.match(entry.k, /^[0-9a-f]{40}$/);
  for (let i = 0; i < 130; i++) { await D.clear(c); }
  assert.ok(((await c.api.store.list("meta")).find((r) => r.data.k === "draw-cfg").data.queue).length <= P.DRAW.queue, "file d'effacement bornée");
  assert.equal(P.DRAW.openMaxMs, 48 * HOUR); assert.equal(P.DRAW.purgeMs, 24 * HOUR); assert.equal(P.DRAW.showMs, 20_000);
});

test("aucun minuteur de fond ni appel réseau dans le code du tirage ; les nouveaux fichiers sont chargés avec ?v= (mise à jour à chaud)", () => {
  for (const f of ["draw", "drawlib"]) {
    const src = fs.readFileSync(new URL(`../modules/audience/${f}.mjs`, import.meta.url), "utf8");
    assert.ok(!/setInterval|setTimeout|\bfetch\s*\(/.test(src), `${f} : pas de minuteur, pas de réseau`);
  }
  for (const f of ["draw", "drawlib", "drawview", "remote", "index"]) {
    const src = fs.readFileSync(new URL(`../modules/audience/${f}.mjs`, import.meta.url), "utf8");
    assert.ok(!/from "\.\//.test(src), `${f} : aucun import statique voisin`);
  }
  assert.doesNotThrow(() => new vm.Script(C.CLIENT_JS)); assert.doesNotThrow(() => new vm.Script(DV.OVERLAY_JS));
});

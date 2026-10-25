// Soutiens — le cœur du module : les fournisseurs (Patreon par interrogation avec un faux fetch, Ko-fi par notification vérifiée, fichier importé), l'accord personnel,
// la page publique (rien sans accord, rien d'autre qu'un pseudo), les bornes et la liste blanche des serveurs. Aucun réseau réel.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, reset, kit, def, P, R, D, S, O, V, Routes, htmlOf, formRequest, seedByFile } from "./helpers/supporters-world.mjs";
import { fakePatreon, kofiRequest } from "./helpers/fakePatreon.mjs";

beforeEach(() => reset());
afterEach(() => reset());

const page = (ctx, ...segments) => def.page(ctx, { segments });
const peopleOf = async (ctx) => [...(await D.snapshot(ctx, { fresh: true })).people.values()].map((r) => r.data);
const T = { a: { id: 11, title: "Petit", cents: 7100191 }, b: { id: 12, title: "Moyen", cents: 7200193 }, c: { id: 13, title: "Grand", cents: 7300197 } };
const M = (id, name, status = "active_patron", tiers = [11], since = "2025-02-03T10:00:00.000+00:00") => ({ id, name, status, since, tiers });

/* ───────────── Les petites fonctions ───────────── */

test("pseudo : accepté seulement s'il est court, sans lien ni adresse ni signe de balisage", () => {
  assert.deepEqual(P.checkPseudo("Luna42"), { ok: true, value: "Luna42" });
  assert.deepEqual(P.checkPseudo("  Élodie   la  rêveuse "), { ok: true, value: "Élodie la rêveuse" });
  assert.equal(P.checkPseudo("a").error, "short");
  assert.equal(P.checkPseudo("x".repeat(41)).error, "long");
  assert.equal(P.checkPseudo("visitez https://pub.example/x").error, "link");
  assert.equal(P.checkPseudo("www.example.com").error, "link");
  assert.equal(P.checkPseudo("luna@example.test").error, "email");
  assert.equal(P.checkPseudo("<b>Luna</b>").error, "chars");
  assert.equal(P.checkPseudo("!!! ???").error, "chars");
  assert.equal(P.checkPseudo("Lu‮na").value, "Luna", "les caractères de direction sont retirés");
});

test("un libellé qui ressemble à un montant est reconnu", () => {
  for (const s of ["5 €", "$10", "10 euros", "EUR 5", "3,50 EUR"]) assert.equal(P.looksLikeAmount(s), true, s);
  for (const s of ["Grand soutien", "Niveau 3", "Patron"]) assert.equal(P.looksLikeAmount(s), false, s);
});

test("jetons d'accord : stables, propres à la personne, changent avec la génération, jamais de majuscule", () => {
  const a = P.consentToken("secret", "aaaaaaaaaaaa", 0);
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(P.consentToken("secret", "aaaaaaaaaaaa", 0), a);
  assert.notEqual(P.consentToken("secret", "aaaaaaaaaaaa", 1), a);
  assert.notEqual(P.consentToken("secret", "bbbbbbbbbbbb", 0), a);
  assert.notEqual(P.consentToken("autre", "aaaaaaaaaaaa", 0), a);
  assert.equal(P.sameSecret("x", "x"), true);
  assert.equal(P.sameSecret("x", "y"), false);
});

test("dates : seulement le jour est gardé ; actif = statut actif ET (si la plateforme n'envoie que des événements) un dernier signe récent", () => {
  assert.equal(P.dayOf("2025-02-03T23:59:59+05:00"), "2025-02-03");
  assert.equal(P.dayOf("pas une date"), null);
  assert.equal(P.dayOf("1970-01-01"), null);
  const now = Date.parse("2026-03-01T12:00:00Z");
  assert.equal(P.isActive({ status: "active", last: "2026-02-20" }, { expires: true }, 40, now), true);
  assert.equal(P.isActive({ status: "active", last: "2025-12-01" }, { expires: true }, 40, now), false);
  assert.equal(P.isActive({ status: "active", last: "2020-01-01" }, { expires: false }, 40, now), true);
  assert.equal(P.isActive({ status: "ended", last: "2026-02-20" }, { expires: true }, 40, now), false);
});

test("montrable = accord + pseudo approuvé + pas caché + actif ; chaque condition manquante suffit à cacher", () => {
  const prov = { expires: false };
  const ok = { status: "active", consent: { pseudo: "Luna" }, approved: true, hidden: false };
  assert.equal(P.isShown(ok, prov, 40), true);
  assert.equal(P.isShown({ ...ok, consent: null }, prov, 40), false, "pas d'accord");
  assert.equal(P.isShown({ ...ok, approved: false }, prov, 40), false, "pas relu");
  assert.equal(P.isShown({ ...ok, hidden: true }, prov, 40), false, "caché");
  assert.equal(P.isShown({ ...ok, status: "ended" }, prov, 40), false, "arrêté");
  assert.equal(P.consentState({ consent: { pseudo: "Luna" }, approved: false }), "pending");
  assert.equal(P.consentState({}), "none");
});

/* ───────────── La table des fournisseurs et la liste blanche ───────────── */

test("table des fournisseurs : chaque entrée est complète (FR + EN), a un mode connu, et la liste des options du manifeste est exactement la table", async () => {
  const { manifest } = await import("./helpers/supporters-world.mjs");
  const opts = manifest.settings.find((s) => s.key === "provider").options.map((o) => o.value);
  assert.deepEqual([...opts].sort(), [...R.PROVIDER_IDS].sort(), "ajouter une plateforme = une entrée de la table + une option du réglage");
  for (const [id, p] of Object.entries(R.PROVIDERS)) {
    assert.equal(p.id, id);
    assert.ok(["pull", "push", "file"].includes(p.mode), id);
    assert.ok(p.label.fr && p.label.en && p.what.fr && p.what.en, `${id} : textes FR+EN`);
    assert.ok(p.steps.fr.length > 0 && p.steps.fr.length === p.steps.en.length, `${id} : étapes alignées`);
    assert.ok(Array.isArray(p.hosts));
    if (p.mode === "pull") { assert.equal(typeof p.pull, "function"); assert.ok(p.hosts.length > 0 && p.secret.fr && p.secret.en); }
    if (p.mode === "push") { assert.equal(typeof p.verify, "function"); assert.equal(typeof p.parseEvent, "function"); assert.equal(p.hosts.length, 0, "une plateforme qui notifie n'est jamais appelée"); }
    if (p.mode === "file") assert.equal(typeof p.parseRows, "function");
    for (const h of p.hosts) assert.match(h, /^[a-z0-9.-]+\.[a-z]{2,}$/, "hôte exact, sans schéma ni chemin");
  }
});

test("liste blanche : seul l'hôte exact du fournisseur, en https, sans compte ni port", () => {
  const p = R.PROVIDERS.patreon;
  assert.equal(R.hostAllowed(p, "https://www.patreon.com/api/oauth2/v2/campaigns"), true);
  for (const bad of ["http://www.patreon.com/x", "https://patreon.com/x", "https://www.patreon.com.evil.example/x", "https://evil.example/www.patreon.com", "https://user:pw@www.patreon.com/x", "https://www.patreon.com:8443/x", "//www.patreon.com/x", "ftp://www.patreon.com", "pas une adresse"]) assert.equal(R.hostAllowed(p, bad), false, bad);
  assert.equal(R.hostAllowed(R.PROVIDERS.kofi, "https://ko-fi.com/x"), false, "Ko-fi n'a aucun hôte autorisé : on ne l'appelle jamais");
});

test("réseau fermé : un fournisseur dont la liste blanche ne contient pas l'hôte ne part jamais (aucun appel)", async () => {
  const { ctx } = makeWorld();
  const fake = { id: "x", hosts: ["api.example.test"] };
  const f = kit.fakeFetch({ "*": { json: {} } });
  await kit.withFakeFetch({ "*": { json: {} } }, async () => {
    const r = await R.getJson(ctx, { ...fake, hosts: ["evil.example"] }, "/p", {}, "t");
    assert.equal(r.ok, true, "hôte propre au fournisseur : permis");
    const blocked = await R.getJson(ctx, { id: "y", hosts: [] }, "/p", {}, "t");
    assert.deepEqual(blocked, { ok: false, code: "blocked" });
  });
  void f;
  assert.equal(ctx.calls.net.length, 1, "seul l'appel permis est parti");
  assert.equal(new URL(ctx.calls.net[0].url).hostname, "evil.example", "l'hôte vient de la table, jamais d'une réponse");
});

/* ───────────── Patreon : interrogation ───────────── */

test("Patreon : actualiser lit les membres actifs, leur palier (rang, jamais le montant) et la date de début ; nouveaux soutiens cachés et sans accord", async () => {
  const { ctx } = makeWorld();
  const pat = fakePatreon({ tiers: [T.a, T.b, T.c], members: [M(1, "Ada Lovelace", "active_patron", [12]), M(2, "Bob", "former_patron", []), M(3, "Chloé", "active_patron", [11, 13]), M(4, "Suiveur", null, [])] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => {
    const r = await S.refresh(ctx, { force: true });
    assert.equal(r.ok, true);
    assert.equal(r.count, 3, "un simple abonné (statut vide) n'est pas un soutien");
    assert.equal(r.added, 2);
  });
  const people = await peopleOf(ctx);
  const ada = people.find((p) => p.k === "patreon:1");
  assert.equal(ada.status, "active");
  assert.equal(ada.since, "2025-02-03", "seulement le jour");
  assert.deepEqual(ada.tiers, ["patreon:12"]);
  assert.equal(people.find((p) => p.k === "patreon:2"), undefined, "un ancien membre jamais connu actif n'est pas gardé (conservation minimale)");
  assert.equal(people.length, 2);
  for (const p of people) { assert.equal(p.hidden, false); assert.equal(p.consent, null); assert.equal(p.approved, false); }
  const tiers = [...(await D.snapshot(ctx, { fresh: true })).tiers.values()].map((r) => r.data);
  assert.deepEqual(tiers.map((t) => [t.name, t.rank]).sort((a, b) => a[1] - b[1]), [["Petit", 1], ["Moyen", 2], ["Grand", 3]], "rang du plus bas au plus haut");
  const dump = JSON.stringify(ctx.dumpStore());
  for (const secret of ["7100191", "7200193", "7300197", "must-never-be-read", "amount", "cents", "tok-creator"]) assert.ok(!dump.includes(secret), `« ${secret} » ne doit jamais être gardé`);
  assert.ok(pat.calls.every((c) => new URL(c.url).hostname === "www.patreon.com"));
  assert.ok(pat.calls.every((c) => !/email/i.test(c.url)), "aucune adresse e-mail n'est demandée");
});

test("Patreon : jamais le jeton dans l'adresse, toujours dans l'en-tête ; les pages sont suivies par curseur et bornées", async () => {
  const { ctx } = makeWorld();
  const members = Array.from({ length: 450 }, (_, i) => M(i + 1, `Membre ${i + 1}`));
  const pat = fakePatreon({ tiers: [T.a], members, pageSize: 200 });
  await kit.withFakeFetch({ "*": pat.reply }, async () => { const r = await S.refresh(ctx, { force: true }); assert.equal(r.count, 450); });
  assert.equal(pat.calls.length, 1 + 3, "une demande de campagne + trois pages de 200");
  assert.ok(pat.calls.every((c) => !c.url.includes("tok-creator")));
  assert.equal((await peopleOf(ctx)).length, 450);
});

test("Patreon : trop de membres → on lit les 2 000 premiers, on le dit (partiel) et PERSONNE n'est déclaré arrêté à tort", async () => {
  const { ctx } = makeWorld();
  const members = Array.from({ length: 2100 }, (_, i) => M(i + 1, `M${i + 1}`));
  const pat = fakePatreon({ tiers: [T.a], members });
  await kit.withFakeFetch({ "*": pat.reply }, async () => {
    const r = await S.refresh(ctx, { force: true });
    assert.equal(r.ok, true); assert.equal(r.partial, true); assert.equal(r.count, 2000);
  });
  // Un membre au-delà de la limite, connu avant : il ne doit pas être arrêté.
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.equal([...snap.people.values()].filter((r) => r.data.status === "ended").length, 0);
});

test("Patreon : quelqu'un qui n'est plus dans la liste complète passe à « arrêté », garde son accord, et revient actif s'il reprend", async () => {
  const { ctx } = makeWorld();
  const pat = fakePatreon({ tiers: [T.a], members: [M(1, "Ada"), M(2, "Bob")] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => { await S.refresh(ctx, { force: true }); });
  const bob = (await peopleOf(ctx)).find((p) => p.k === "patreon:2");
  await D.withLock(ctx, async () => { const r = (await D.snapshot(ctx, { fresh: true })).byPid.get(bob.pid); await ctx.api.store.update(r.id, { ...r.data, consent: { pseudo: "Bobby", at: "2026-01-01" }, approved: true }); });
  pat.state.members = [M(1, "Ada")];
  await kit.withFakeFetch({ "*": pat.reply }, async () => { const r = await S.refresh(ctx, { force: true }); assert.equal(r.ended, 1); });
  let b = (await peopleOf(ctx)).find((p) => p.k === "patreon:2");
  assert.equal(b.status, "ended"); assert.equal(b.consent.pseudo, "Bobby");
  pat.state.members = [M(1, "Ada"), M(2, "Bob")];
  await kit.withFakeFetch({ "*": pat.reply }, async () => { await S.refresh(ctx, { force: true }); });
  b = (await peopleOf(ctx)).find((p) => p.k === "patreon:2");
  assert.equal(b.status, "active"); assert.equal(b.consent.pseudo, "Bobby", "son accord n'a pas bougé");
});

test("Patreon : les pannes sont dites en mots simples, rien n'est perdu, le jeton n'apparaît nulle part", async () => {
  const { ctx } = makeWorld();
  const pat = fakePatreon({ tiers: [T.a], members: [M(1, "Ada")] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => { await S.refresh(ctx, { force: true }); });
  const cases = [
    [(s) => { s.token = "autre"; }, "token"],
    [(s) => { s.token = "tok-creator"; s.status = 403; }, "scope"],
    [(s) => { s.status = 404; }, "none"],
    [(s) => { s.status = 503; }, "unreachable"],
    [(s) => { s.status = null; s.fail = true; }, "unreachable"],
    [(s) => { s.fail = false; s.garbage = true; }, "unreadable"],
    [(s) => { s.garbage = false; s.campaigns = []; }, "none"],
    [(s) => { s.campaigns = [{ id: "111", type: "campaign" }]; s.status = 429; }, "busy"],   // en dernier : le client réseau du cœur met l'hôte en pause après un 429
  ];
  for (const [mutate, code] of cases) {
    reset();
    mutate(pat.state);
    await kit.withFakeFetch({ "*": pat.reply }, async () => {
      const r = await S.refresh(ctx, { force: true });
      assert.deepEqual([r.ok, r.code], [false, code], code);
    });
    const people = await peopleOf(ctx);
    assert.equal(people.length, 1, "les soutiens connus restent");
  }
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.ok(!JSON.stringify(ctx.calls.netLog).includes("tok-creator"), "le jeton n'est pas dans le journal réseau");
  void snap;
});

test("Patreon : sans clé, rien ne part ; avec un délai de repos, pas de nouvel appel ; après une panne, pause avant de réessayer (sauf demande explicite)", async () => {
  const w = makeWorld({ settings: { accessToken: "" } });
  assert.deepEqual(await S.refresh(w.ctx, { force: true }), { ok: false, code: "no_token" });
  assert.equal(w.ctx.calls.net.length, 0);
  const { ctx } = makeWorld();
  const pat = fakePatreon({ tiers: [T.a], members: [M(1, "Ada")] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => {
    await S.refresh(ctx);
    const n = pat.calls.length;
    const again = await S.refresh(ctx);
    assert.equal(again.cached, true); assert.equal(pat.calls.length, n, "données fraîches : aucun appel");
    pat.state.status = 503;
    const down = await S.refresh(ctx, { force: true });
    assert.equal(down.code, "unreachable");
    const n2 = pat.calls.length;
    const soft = await S.refresh(ctx);
    assert.equal(soft.cached, true); assert.equal(soft.code, "unreachable"); assert.equal(pat.calls.length, n2, "pause après une panne");
  });
});

test("ouvrir la page publique lance une actualisation si les données sont vieilles, sans la faire attendre, et sans minuteur de fond", async () => {
  const { ctx } = makeWorld();
  const pat = fakePatreon({ tiers: [T.a], members: [M(1, "Ada")] });
  await kit.withFakeFetch({ "*": pat.reply }, async () => {
    const p = await page(ctx);
    assert.ok(p.blocks.length > 0);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await peopleOf(ctx)).length, 1, "l'actualisation lancée par la visite a abouti");
    const n = pat.calls.length;
    await page(ctx); await new Promise((r) => setTimeout(r, 30));
    assert.equal(pat.calls.length, n, "au plus une fois par délai");
  });
  assert.equal(def.tasks, undefined, "aucune tâche planifiée");
  const fs = await import("node:fs");
  const dir = new URL("../modules/supporters/", import.meta.url).pathname;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".mjs"))) assert.ok(!/setInterval/.test(fs.readFileSync(dir + f, "utf8")), `${f} : pas de minuteur périodique`);
});

/* ───────────── Ko-fi : notification entrante ───────────── */

const kofiWorld = (extra = {}) => makeWorld({ settings: { provider: "kofi", accessToken: "kofi-verify-token", ...extra } });

test("Ko-fi : un don vérifié crée un soutien actif, caché et sans accord ; ni e-mail ni montant ne sont gardés", async () => {
  const { ctx } = kofiWorld();
  const res = await def.routes.kofi(kofiRequest(), ctx);
  assert.equal(res.status, 200);
  const people = await peopleOf(ctx);
  assert.equal(people.length, 1);
  const p = people[0];
  assert.deepEqual([p.provider, p.status, p.hidden, p.consent, p.approved, p.name], ["kofi", "active", false, null, false, "Jo Example"]);
  assert.match(p.k, /^kofi:[a-f0-9]{20}$/, "empreinte irréversible, pas l'adresse");
  const dump = JSON.stringify(ctx.dumpStore());
  for (const secret of ["jo@example.test", "3.00", "EUR", "kofi-verify-token", "Merci", "txid", "22222222"]) assert.ok(!dump.includes(secret), `« ${secret} » ne doit pas être gardé`);
});

test("Ko-fi : mauvais jeton → 401 sans rien écrire ; un autre fournisseur ou aucune clé → 404 ; méthode autre que POST → 405 ; corps énorme → 413", async () => {
  const { ctx } = kofiWorld();
  assert.equal((await def.routes.kofi(kofiRequest({}, { token: "faux-jeton-123" }), ctx)).status, 401);
  assert.equal((await peopleOf(ctx)).length, 0);
  assert.equal((await def.routes.kofi(new Request("https://site.example.test/m/soutiens/kofi"), ctx)).status, 405);
  assert.equal((await def.routes.kofi(new Request("https://site.example.test/m/soutiens/kofi", { method: "POST", body: "x".repeat(30_000) }), ctx)).status, 413);
  assert.equal((await def.routes.kofi(new Request("https://site.example.test/m/soutiens/kofi", { method: "POST", body: "data=pas-du-json" }), ctx)).status, 400);
  const other = makeWorld({ settings: { provider: "patreon" } });
  assert.equal((await def.routes.kofi(kofiRequest(), other.ctx)).status, 404);
  const none = kofiWorld({ accessToken: "" });
  assert.equal((await def.routes.kofi(kofiRequest(), none.ctx)).status, 404);
  assert.equal((await peopleOf(none.ctx)).length, 0);
});

test("Ko-fi : un jeton vide dans le message ne passe jamais, même si la clé enregistrée est courte ou vide", async () => {
  const w = kofiWorld({ accessToken: "x" });
  assert.equal((await def.routes.kofi(kofiRequest({}, { token: "x" }), w.ctx)).status, 401, "une clé de moins de 8 caractères n'est jamais acceptée");
  const empty = kofiWorld();
  assert.equal((await def.routes.kofi(kofiRequest({ verification_token: "" }, { token: "" }), empty.ctx)).status, 401);
});

test("Ko-fi : la même notification rejouée n'est comptée qu'une fois ; la même personne qui redonne reste un seul soutien", async () => {
  const { ctx } = kofiWorld();
  await def.routes.kofi(kofiRequest(), ctx);
  await def.routes.kofi(kofiRequest(), ctx);
  await def.routes.kofi(kofiRequest({ message_id: "33333333-3333-4333-8333-333333333333" }), ctx);
  assert.equal((await peopleOf(ctx)).length, 1);
  await def.routes.kofi(kofiRequest({ message_id: "44444444-4444-4444-8444-444444444444", email: "autre@example.test", from_name: "Jo Example" }), ctx);
  assert.equal((await peopleOf(ctx)).length, 2, "une autre adresse est une autre personne");
});

test("Ko-fi : un abonnement avec palier crée le palier ; commande de boutique et commission sont ignorées ; le don s'éteint tout seul après la durée réglée", async () => {
  const { ctx } = kofiWorld();
  await def.routes.kofi(kofiRequest({ type: "Subscription", is_subscription_payment: true, tier_name: "Gold Club", message_id: "55555555-5555-4555-8555-555555555555" }), ctx);
  assert.equal((await def.routes.kofi(kofiRequest({ type: "Shop Order", message_id: "66666666-6666-4666-8666-666666666666" }), ctx)).status, 200);
  assert.equal((await def.routes.kofi(kofiRequest({ type: "Commission", message_id: "77777777-7777-4777-8777-777777777777" }), ctx)).status, 200);
  const snap = await D.snapshot(ctx, { fresh: true });
  assert.equal(snap.people.size, 1);
  assert.deepEqual([...snap.tiers.values()].map((r) => r.data.name), ["Gold Club"]);
  const p = [...snap.people.values()][0].data;
  assert.equal(p.tiers.length, 1);
  const prov = R.PROVIDERS.kofi;
  assert.equal(P.isActive(p, prov, 40), true);
  assert.equal(P.isActive({ ...p, last: "2020-01-01" }, prov, 40), false, "un don ancien ne garde pas quelqu'un actif");
});

test("Ko-fi : limite de débit (par visiteur et globale) et pause après trop de mauvais jetons ; aucun journal du contenu", async () => {
  const { ctx } = kofiWorld();
  let last = 200;
  for (let i = 0; i < 125; i++) last = (await def.routes.kofi(kofiRequest({ message_id: `m-${i}` }), ctx)).status;
  assert.equal(last, 429, "plus de 120 notifications par minute d'un même visiteur : pause");
  reset();
  let status = 0;
  for (let i = 0; i < 13; i++) status = (await def.routes.kofi(kofiRequest({}, { token: "mauvais-jeton-1" }), ctx)).status;
  assert.equal(status, 429, "des essais ratés à la chaîne : pause");
  assert.deepEqual(ctx.calls.net, [], "aucun appel réseau : le site ne contacte jamais Ko-fi");
});

/* ───────────── Fichier importé ───────────── */

test("fichier : lit les colonnes en français ou en anglais, plusieurs séparateurs, guillemets ; relire le même fichier ne crée pas de doublon ni de réécriture", async () => {
  const { ctx } = makeWorld({ settings: { provider: "csv" } });
  const csv = 'nom;palier;depuis;statut\n"Ada; la grande";Or;2025-01-05;actif\nBob;Argent;2024-12-24;actif\n;Argent;2025-01-01;actif\nCléo;Or;n\'importe quoi;actif\nZoé;Or;2025-01-01;arrêté\n';
  const r = await O.importText(ctx, csv);
  assert.equal(r.ok, true); assert.equal(r.added, 2, "Zoé, arrêtée et inconnue, n'est pas gardée"); assert.equal(r.skipped.length, 2);
  assert.deepEqual(r.skipped.map((s) => s.why).sort(), ["date", "name"]);
  const before = ctx.calls.writes.length;
  const again = await O.importText(ctx, csv);
  assert.equal(again.added, 0); assert.equal(again.updated, 0, "rien n'a changé : rien n'est réécrit");
  assert.deepEqual(ctx.calls.writes.slice(before).filter((w) => w.collection === "people"), []);
  assert.equal((await peopleOf(ctx)).length, 2);
  assert.equal((await O.importText(ctx, "name,tier,since\nDora,Gold,2025-03-01\n")).added, 1);
  assert.equal((await O.importText(ctx, "Name\tStatus\nElio\tyes\n")).added, 1);
  const stop = await O.importText(ctx, "Name\tStatus\nElio\tno\n");
  assert.equal(stop.updated, 1);
  assert.equal((await peopleOf(ctx)).find((p) => p.name === "Elio").status, "ended");
});

test("fichier : erreurs claires (vide, sans titres, sans colonne des noms, trop de lignes, trop gros) ; formules de tableur sans effet ; « remplacer » arrête les absents", async () => {
  const { ctx } = makeWorld({ settings: { provider: "csv" } });
  assert.equal((await O.importText(ctx, "")).code, "empty");
  assert.equal((await O.importText(ctx, "nom\n")).code, "nohead");
  assert.equal((await O.importText(ctx, "palier;depuis\nOr;2025-01-01")).code, "noname");
  assert.equal((await O.importText(ctx, "nom\n" + Array.from({ length: 1001 }, (_, i) => `n${i}`).join("\n"))).code, "many");
  assert.equal((await O.importText(ctx, "nom\n" + "x".repeat(310_000))).code, "big");
  assert.equal((await O.importText(ctx, "nom;palier\n;Or")).code, "norows");
  await O.importText(ctx, "nom\n=HYPERLINK(\"http://pub.example\")\nAda\nBob");
  assert.equal((await peopleOf(ctx)).length, 3, "une cellule qui commence par = est du texte comme un autre");
  const r = await O.importText(ctx, "nom\nAda", { replace: true });
  assert.equal(r.ended, 2);
  assert.deepEqual((await peopleOf(ctx)).filter((p) => p.status === "active").map((p) => p.name), ["Ada"]);
});

/* ───────────── L'accord personnel ───────────── */

async function oneSupporter(over = {}) {
  const w = makeWorld(over);
  await seedByFile(w.ctx, ["Ada Lovelace;Or;2025-01-05"]);
  const p = (await peopleOf(w.ctx))[0];
  const link = await O.consentLink(w.ctx, p.pid);
  const token = link.path.split("/").pop();
  return { ...w, p, link, token };
}
const post = (ctx, fields) => def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", fields), ctx);

test("lien d'accord : /soutiens/moi/<numéro>/<jeton>, en minuscules, stable, remplacé sur demande (l'ancien cesse de marcher)", async () => {
  const { ctx, p, link, token } = await oneSupporter();
  assert.equal(link.path, `/soutiens/moi/${p.pid}/${token}`);
  assert.equal(link.url, `https://site.example.test${link.path}`);
  assert.equal(link.path, link.path.toLowerCase());
  assert.equal((await O.consentLink(ctx, p.pid)).path, link.path, "stable");
  const renewed = await O.consentLink(ctx, p.pid, { renew: true });
  assert.notEqual(renewed.path, link.path);
  assert.equal((await page(ctx, "moi", p.pid, token)).notFound, true, "l'ancien lien ne marche plus");
  assert.ok(!(await page(ctx, "moi", p.pid, renewed.path.split("/").pop())).notFound);
});

test("page d'accord : un lien inventé, d'une autre personne ou mal formé donne la même page introuvable (aucune indication)", async () => {
  const { ctx, p, token } = await oneSupporter();
  for (const segs of [["moi", p.pid, "0".repeat(32)], ["moi", "0".repeat(12), token], ["moi", p.pid, "zz"], ["moi", p.pid], ["moi"], ["moi", p.pid, token, "pirate"], ["moi", p.pid, token, "e-x"], ["autre"], ["page", "0"], ["page", "99"]]) {
    const r = await page(ctx, ...segs);
    assert.equal(r.notFound, true, segs.join("/"));
  }
  const ok = await page(ctx, "moi", p.pid, token);
  const html = htmlOf(ok);
  assert.ok(!html.includes("Ada") && !html.includes("Lovelace"), "la page d'accord ne montre pas le nom");
  assert.ok(html.includes('action="/m/soutiens/consent"'));
  assert.ok(html.includes('name="agree"') && html.includes('name="website"'));
});

test("accord : il faut cocher la case ET un pseudo valide ; chaque erreur revient sous le bon champ ; rien n'est enregistré avant", async () => {
  const { ctx, p, token } = await oneSupporter();
  const go = async (fields) => { const r = await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", ...fields }); return r.headers.get("location"); };
  const base = `/soutiens/moi/${p.pid}/${token}`;
  assert.equal(await go({ pseudo: "Luna42" }), `${base}/e-agree`);
  assert.equal(await go({ pseudo: "L", agree: "yes" }), `${base}/e-short`);
  assert.equal(await go({ pseudo: "https://pub.example", agree: "yes" }), `${base}/e-link`);
  assert.equal(await go({ pseudo: "luna@example.test", agree: "yes" }), `${base}/e-email`);
  assert.equal((await peopleOf(ctx))[0].consent, null, "aucune de ces tentatives n'a enregistré quoi que ce soit");
  const err = htmlOf(await page(ctx, "moi", p.pid, token, "e-short"));
  assert.match(err, /id="sp-pseudo-e"[^>]*role="alert"/);
  assert.match(err, /aria-invalid="true"/);
  const agree = htmlOf(await page(ctx, "moi", p.pid, token, "e-agree"));
  assert.match(agree, /id="sp-agree-e"/);
});

test("accord : avec relecture (réglage par défaut) le pseudo attend l'approbation ; la page publique ne montre rien jusque-là", async () => {
  const { ctx, p, token } = await oneSupporter();
  const r = await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), `/soutiens/moi/${p.pid}/${token}/ok-pending`);
  assert.equal(P.consentState((await peopleOf(ctx))[0]), "pending");
  assert.ok(!htmlOf(await page(ctx)).includes("Luna42"), "pas relu : rien de public");
  assert.equal((await O.setApproval(ctx, p.pid, true)).ok, true);
  const html = htmlOf(await page(ctx));
  assert.ok(html.includes("Luna42"));
  assert.ok(!html.includes("Ada") && !html.includes("Lovelace") && !html.includes("Or"), "ni le vrai nom ni le nom du palier de la plateforme");
});

test("accord sans relecture (réglage décoché) : le pseudo apparaît tout de suite ; changer de pseudo repasse en relecture seulement si la relecture est demandée", async () => {
  const { ctx, p, token } = await oneSupporter({ settings: { review: false } });
  const r = await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.ok(r.headers.get("location").endsWith("/ok-shown"));
  assert.ok(htmlOf(await page(ctx)).includes("Luna42"));
  const strict = await oneSupporter();
  await post(strict.ctx, { pid: strict.p.pid, t: strict.token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  await O.setApproval(strict.ctx, strict.p.pid, true);
  await post(strict.ctx, { pid: strict.p.pid, t: strict.token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.equal(P.consentState((await peopleOf(strict.ctx))[0]), "approved", "même pseudo : toujours approuvé");
  await post(strict.ctx, { pid: strict.p.pid, t: strict.token, loc: "fr", act: "accept", pseudo: "Luna43", agree: "yes" });
  assert.equal(P.consentState((await peopleOf(strict.ctx))[0]), "pending", "autre pseudo : à relire");
  assert.ok(!htmlOf(await page(strict.ctx)).includes("Luna43"));
});

test("retrait : la personne disparaît de la page immédiatement, sur le même lien ; la propriétaire peut refuser un pseudo, cacher, et oublier", async () => {
  const { ctx, p, token } = await oneSupporter({ settings: { review: false } });
  await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.ok(htmlOf(await page(ctx)).includes("Luna42"));
  const left = await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "withdraw" });
  assert.ok(left.headers.get("location").endsWith("/left"));
  D.forget(ctx);
  assert.ok(!htmlOf(await page(ctx)).includes("Luna42"));
  assert.equal((await peopleOf(ctx))[0].consent, null);
  await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.equal((await O.setHidden(ctx, p.pid, true)).ok, true);
  D.forget(ctx);
  assert.ok(!htmlOf(await page(ctx)).includes("Luna42"), "caché par la propriétaire, malgré l'accord");
  assert.equal((await O.setHidden(ctx, p.pid, false)).ok, true);
  D.forget(ctx);
  assert.ok(htmlOf(await page(ctx)).includes("Luna42"));
  assert.equal((await O.setApproval(ctx, p.pid, false)).ok, true, "refus du pseudo");
  assert.equal((await peopleOf(ctx))[0].consent, null);
  assert.equal((await O.setApproval(ctx, p.pid, true)).code, "no_consent", "rien à approuver sans pseudo choisi par la personne");
  assert.equal((await O.forget(ctx, p.pid)).ok, true);
  assert.equal((await peopleOf(ctx)).length, 0);
});

test("accord : piège à robots, méthode, limites, corps énorme, lien invalide → aucune écriture, aucun détail", async () => {
  const { ctx, p, token } = await oneSupporter({ settings: { review: false } });
  const bot = await post(ctx, { pid: p.pid, t: token, loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes", website: "http://spam.example" });
  assert.equal(bot.status, 303); assert.ok(!bot.headers.get("location").includes("/moi/"));
  assert.equal((await peopleOf(ctx))[0].consent, null, "un robot ne fait rien");
  assert.equal((await def.routes.consent(new Request("https://site.example.test/m/soutiens/consent"), ctx)).status, 405);
  assert.equal((await def.routes.consent(new Request("https://site.example.test/m/soutiens/consent", { method: "POST", body: "x".repeat(6000), headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "6000" } }), ctx)).status, 413);
  assert.equal((await post(ctx, { pid: p.pid, t: "0".repeat(32), act: "accept", pseudo: "Luna42", agree: "yes" })).status, 404);
  assert.equal((await post(ctx, { pid: "zzz", t: token, act: "accept" })).status, 404);
  let status = 0;
  for (let i = 0; i < 45; i++) status = (await post(ctx, { pid: p.pid, t: "0".repeat(32), act: "accept" })).status;
  assert.equal(status, 429, "trop d'essais d'un même visiteur : pause");
});

test("accord : la langue est gardée dans la redirection ; une langue inconnue retombe sur la langue par défaut", async () => {
  const { ctx, p, token } = await oneSupporter();
  const en = await post(ctx, { pid: p.pid, t: token, loc: "en", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.equal(en.headers.get("location"), `/en/soutiens/moi/${p.pid}/${token}/ok-pending`);
  const bad = await post(ctx, { pid: p.pid, t: token, loc: "../../evil", act: "accept", pseudo: "Luna42", agree: "yes" });
  assert.equal(bad.headers.get("location"), `/soutiens/moi/${p.pid}/${token}/ok-pending`);
});

/* ───────────── La page publique ───────────── */

test("page publique : regroupe sous le libellé choisi (jamais le nom de la plateforme), le palier le plus haut d'abord, sans libellé → groupe général ; aucun montant ni date ni nom", async () => {
  const w = makeWorld({ settings: { provider: "csv", review: false } });
  await O.importText(w.ctx, "nom;palier;depuis\nAda;Or;2025-01-01\nBob;Argent;2025-02-02\nCléo;Bronze;2025-03-03\nDora;;2025-04-04");
  const snap = await D.snapshot(w.ctx, { fresh: true });
  const keyOf = (name) => [...snap.tiers.values()].find((t) => t.data.name === name).data.k;
  await O.tierLabel(w.ctx, keyOf("Or"), { fr: "Mécène", en: "Patron" }, 3);
  await O.tierLabel(w.ctx, keyOf("Argent"), { fr: "Grand soutien" }, 2);
  const who = new Map();
  for (const p of await peopleOf(w.ctx)) {
    const link = await O.consentLink(w.ctx, p.pid); who.set(p.name, { pid: p.pid, token: link.path.split("/").pop() });
  }
  Routes.resetLimits();
  for (const [name, pseudo] of [["Ada", "Ada_la_bleue"], ["Bob", "Bobby"], ["Cléo", "Cleo"], ["Dora", "Dodo"]]) { const x = who.get(name); await post(w.ctx, { pid: x.pid, t: x.token, loc: "fr", act: "accept", pseudo, agree: "yes" }); }
  D.forget(w.ctx);
  const html = htmlOf(await page(w.ctx));
  const order = ["Mécène", "Ada_la_bleue", "Grand soutien", "Bobby", "Soutiens", "Cleo", "Dodo"].map((s) => html.indexOf(s));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `ordre inattendu : ${order}`);
  for (const forbidden of ["Argent", "Bronze", "Or<", "2025", "Lovelace", "€"]) assert.ok(!html.includes(forbidden), `« ${forbidden} » ne doit pas être public`);
  const en = makeWorld({ settings: { provider: "csv", review: false }, locale: "en" });
  void en;
});

test("page publique : un libellé qui ressemble à un montant n'est jamais montré, même saisi avant par un autre chemin", async () => {
  const w = makeWorld({ settings: { provider: "csv", review: false } });
  await O.importText(w.ctx, "nom;palier\nAda;Or");
  const snap = await D.snapshot(w.ctx, { fresh: true });
  const t = [...snap.tiers.values()][0];
  assert.equal((await O.tierLabel(w.ctx, t.data.k, { fr: "5 € par mois" })).code, "amount");
  await w.ctx.api.store.update(t.id, { ...t.data, label: { fr: "5 € par mois" } });
  D.forget(w.ctx);
  const p = (await peopleOf(w.ctx))[0];
  const x = await O.consentLink(w.ctx, p.pid);
  await post(w.ctx, { pid: p.pid, t: x.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "Ada", agree: "yes" });
  const html = htmlOf(await page(w.ctx));
  assert.ok(html.includes("Ada") && !html.includes("€"));
});

test("page publique : le pseudo est échappé ; vide = message aimable ; pagination bornée ; aucune balise de script, d'image ni d'adresse extérieure", async () => {
  const w = makeWorld({ settings: { provider: "csv", review: false, pageSize: 6 } });
  assert.match(htmlOf(await page(w.ctx)), /sp-empty/);
  await O.importText(w.ctx, "nom\n" + Array.from({ length: 15 }, (_, i) => `Personne ${String(i).padStart(2, "0")}`).join("\n"));
  for (const p of await peopleOf(w.ctx)) { Routes.resetLimits(); const x = await O.consentLink(w.ctx, p.pid); await post(w.ctx, { pid: p.pid, t: x.path.split("/").pop(), loc: "fr", act: "accept", pseudo: `Pseudo ${p.name.slice(-2)}`, agree: "yes" }); }
  D.forget(w.ctx);
  const p1 = await page(w.ctx);
  assert.equal((htmlOf(p1).match(/<li class="sp-chip">/g) ?? []).length, 6);
  assert.match(htmlOf(p1), /href="\/soutiens\/page\/2"/);
  const p3 = await page(w.ctx, "page", "3");
  assert.equal((htmlOf(p3).match(/<li class="sp-chip">/g) ?? []).length, 3);
  assert.equal((await page(w.ctx, "page", "4")).notFound, true);
  for (const html of [htmlOf(p1), htmlOf(p3)]) assert.ok(!/<script|<img|<iframe|https?:\/\//i.test(html), "aucun tiers chargé chez le visiteur");
  // Pseudo hostile : impossible d'y mettre du balisage (refusé à la saisie) ; s'il était déjà là, il est échappé.
  const first = (await peopleOf(w.ctx))[0];
  const snap = await D.snapshot(w.ctx, { fresh: true });
  const rec = snap.byPid.get(first.pid);
  await w.ctx.api.store.update(rec.id, { ...rec.data, consent: { pseudo: '<img src=x onerror=alert(1)>"', at: "2026-01-01" }, approved: true });
  D.forget(w.ctx);
  const evil = htmlOf(await page(w.ctx));
  assert.ok(!evil.includes("<img src=x") && evil.includes("&lt;img src=x"));
});

test("page publique : éteinte par le réglage « page publique » (le cœur répond 404 : pageSetting) ; l'intro vient de la propriétaire ; le titre est réglable", async () => {
  const { manifest } = await import("./helpers/supporters-world.mjs");
  assert.equal(manifest.pageSetting, "publicPage");
  const setting = manifest.settings.find((s) => s.key === "publicPage");
  assert.deepEqual([setting.type, setting.default], ["boolean", false], "éteinte par défaut");
  const w = makeWorld({ settings: { provider: "csv", title: "Nos mécènes", intro: "Merci **vraiment**." } });
  const r = await page(w.ctx);
  assert.equal(r.title, "Nos mécènes");
  assert.equal(r.blocks[0].type, "markdown");
  const d = makeWorld({ settings: { provider: "csv" } });
  assert.equal((await page(d.ctx)).title, "Merci à nos soutiens");
  const e = makeWorld({ settings: { provider: "csv" }, locale: "en" });
  assert.equal((await page(e.ctx)).title, "Thank you to our supporters");
});

test("service « supporters.public » : seulement les pseudos montrables, avec le libellé, 50 par page, jamais un nom ni un identifiant de fiche", async () => {
  const w = makeWorld({ settings: { provider: "csv", review: false } });
  await O.importText(w.ctx, "nom;palier\n" + Array.from({ length: 60 }, (_, i) => `P${i}`).join("\n") + "\nSans accord");
  for (const p of await peopleOf(w.ctx)) { if (p.name === "Sans accord") continue; Routes.resetLimits(); const x = await O.consentLink(w.ctx, p.pid); await post(w.ctx, { pid: p.pid, t: x.path.split("/").pop(), loc: "fr", act: "accept", pseudo: `Pseudo-${p.name}`, agree: "yes" }); }
  D.forget(w.ctx);
  const svc = def.services["supporters.public"];
  const a = await svc.list(w.ctx, {});
  assert.equal(a.ok, true); assert.equal(a.items.length, 50); assert.ok(a.next);
  const b = await svc.list(w.ctx, { cursor: a.next });
  assert.equal(b.items.length, 10); assert.equal(b.next, null);
  assert.deepEqual(Object.keys(a.items[0]).sort(), ["id", "pseudo", "tier"]);
  const all = [...a.items, ...b.items];
  assert.ok(all.every((i) => i.pseudo.startsWith("Pseudo-")) && !all.some((i) => /Sans accord/.test(JSON.stringify(i))));
  assert.equal((await svc.list(w.ctx, { limit: 9999 })).items.length, 50);
  assert.equal((await svc.list(w.ctx, { cursor: "../../x" })).items.length, 50, "curseur illisible : départ au début");
});

/* ───────────── Passage à l'échelle ───────────── */

test("échelle : 3 000 soutiens importés d'un coup (3 lots), page publique et administration rapides, bornes tenues", async () => {
  const w = makeWorld({ settings: { provider: "csv", review: false } });
  const t0 = Date.now();
  for (let k = 0; k < 3; k++) {
    const r = await O.importText(w.ctx, "nom;palier\n" + Array.from({ length: 1000 }, (_, i) => `Membre ${k}-${i};Niveau ${i % 3}`).join("\n"));
    assert.equal(r.ok, true); assert.equal(r.added, 1000);
  }
  assert.equal((await peopleOf(w.ctx)).length, 3000);
  const r = await page(w.ctx);
  assert.ok(r.blocks.length > 0);
  assert.ok(Date.now() - t0 < 20_000, `trop lent : ${Date.now() - t0} ms`);
  const panel = await Admin_panel(w.ctx);
  assert.ok(panel.some((b) => b.type === "table" && b.rows.length <= 25), "25 lignes au plus par page d'administration");
});

async function Admin_panel(ctx) { const { Admin } = await import("./helpers/supporters-world.mjs"); return Admin.panel(ctx, { query: {} }); }

test("échelle : plafond de 5 000 soutiens (le reste est refusé et dit), sans rien casser", async () => {
  const w = makeWorld({ settings: { provider: "csv" } });
  let added = 0, full = false;
  for (let k = 0; k < 6 && !full; k++) { const r = await O.importText(w.ctx, "nom\n" + Array.from({ length: 1000 }, (_, i) => `M${k}-${i}`).join("\n")); added += r.added; full = r.full; }
  assert.equal(added, 5000); assert.equal(full, true);
});

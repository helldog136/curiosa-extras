// Soutiens — l'administration (assistant de connexion, liste, écran d'une personne, paliers, import, nettoyage) et les outils pour l'assistant IA.
// Mots simples FR + EN, erreurs sous le champ concerné, aucun secret affiché, droits respectés, écritures de l'assistant jamais accordées d'office.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, reset, kit, def, manifest, P, R, D, S, O, Admin, Mcp, Routes, fr, en, formRequest } from "./helpers/supporters-world.mjs";
import { fakePatreon, kofiRequest } from "./helpers/fakePatreon.mjs";

beforeEach(() => reset());
afterEach(() => reset());

const peopleOf = async (ctx) => [...(await D.snapshot(ctx, { fresh: true })).people.values()].map((r) => r.data);
const text = (blocks) => JSON.stringify(blocks);
const find = (blocks, type, pred = () => true) => blocks.filter((b) => b.type === type && pred(b));

/* ───────────── L'assistant de connexion ───────────── */

test("assistant : Patreon → étapes numérotées en mots simples, état de la clé (jamais sa valeur), bouton « Vérifier et actualiser », santé du service", async () => {
  const { ctx } = makeWorld();
  const blocks = await Admin.panel(ctx, { query: {} });
  const steps = find(blocks, "markdown", (b) => /^\*\*\d\.\*\*/.test(b.text));
  assert.equal(steps.length, R.PROVIDERS.patreon.steps.fr.length);
  assert.ok(steps[0].text.startsWith("**1.**"));
  assert.ok(text(blocks).includes(fr.tokenSaved));
  assert.ok(!text(blocks).includes("tok-creator"), "la clé secrète n'est jamais affichée");
  assert.ok(find(blocks, "adminForm", (b) => b.action === "refresh").length === 1);
  assert.deepEqual(find(blocks, "netHealth")[0].items[0].host, "www.patreon.com");
  const en_ = makeWorld({ locale: "en" });
  assert.ok(text(await Admin.panel(en_.ctx, { query: {} })).includes("Creator's Access Token"));
});

test("assistant : Ko-fi → l'adresse à coller s'affiche sous la bonne étape (bouton copier) ; aucun bouton d'actualisation (la plateforme prévient seule)", async () => {
  const { ctx } = makeWorld({ settings: { provider: "kofi", accessToken: "kofi-verify-token" } });
  const blocks = await Admin.panel(ctx, { query: {} });
  const copy = find(blocks, "copy")[0];
  assert.equal(copy.text, "https://site.example.test/m/soutiens/kofi");
  const idx = blocks.indexOf(copy);
  assert.match(blocks[idx - 1].text, /^\*\*2\./, "juste sous l'étape 2");
  assert.equal(find(blocks, "adminForm", (b) => b.action === "refresh").length, 0);
  assert.ok(text(blocks).includes(fr.noEventYet));
  await def.routes.kofi(kofiRequest(), ctx);
  D.forget(ctx);
  assert.ok(!text(await Admin.panel(ctx, { query: {} })).includes(fr.noEventYet));
});

test("assistant : fichier → étapes du fichier ; sans clé la bannière dit quoi faire et mène aux réglages ; page éteinte dite", async () => {
  const f = makeWorld({ settings: { provider: "csv", accessToken: "", publicPage: false } });
  const blocks = await Admin.panel(f.ctx, { query: {} });
  assert.ok(!find(blocks, "banner").some((b) => b.text === fr.needToken), "un import n'a pas besoin de clé");
  assert.ok(find(blocks, "banner").some((b) => b.text === fr.pageOff));
  const p = makeWorld({ settings: { accessToken: "" } });
  const ban = find(await Admin.panel(p.ctx, { query: {} }), "banner").find((b) => b.text === fr.needToken);
  assert.equal(ban.href, "?tab=settings");
});

test("assistant : « Vérifier et actualiser » avec une erreur volontaire (mauvaise clé) → message en mots simples ; puis avec la bonne clé → succès chiffré", async () => {
  const { ctx, settings } = makeWorld();
  const pat = fakePatreon({ tiers: [{ id: 1, title: "A", cents: 100 }], members: [{ id: 1, name: "Ada", status: "active_patron", since: "2025-01-01", tiers: [1] }] });
  settings.accessToken = "mauvaise-cle";
  await kit.withFakeFetch({ "*": pat.reply }, async () => {
    const bad = await Admin.actions.refresh.run(ctx, {});
    assert.equal(bad.error, fr.sync_token);
    assert.ok(!JSON.stringify(bad).includes("mauvaise-cle"), "la clé n'est jamais renvoyée");
    D.forget(ctx);
    const blocks = await Admin.panel(ctx, { query: {} });
    assert.ok(find(blocks, "banner").some((b) => b.text === fr.sync_token), "l'erreur reste visible dans l'assistant");
    settings.accessToken = "tok-creator";
    const good = await Admin.actions.refresh.run(ctx, {});
    assert.match(good.ok, /1 soutiens lus \(1 nouveaux, 0 arrêtés\)/);
    D.forget(ctx);
    assert.ok(!find(await Admin.panel(ctx, { query: {} }), "banner").some((b) => b.text === fr.sync_token));
  });
  const enCtx = makeWorld({ locale: "en", settings: { accessToken: "x" } });
  await kit.withFakeFetch({ "*": pat.reply }, async () => { assert.equal((await Admin.actions.refresh.run(enCtx.ctx, {})).error, en.sync_token); });
});

test("assistant : toutes les erreurs de plateforme ont une phrase simple dans les deux langues, et aucune ne contient de jargon ni d'identifiant", () => {
  for (const code of ["token", "scope", "none", "busy", "unreachable", "unreadable", "blocked", "not_pull", "partial"]) {
    for (const loc of [fr, en]) {
      const t = loc[`sync_${code}`];
      assert.ok(t && t.length > 20, code);
      assert.ok(!/\b(HTTP|401|403|404|429|500|JSON|API|OAuth|token|bearer|exception|null|undefined)\b/i.test(t), `${code} : ${t}`);
    }
  }
});

/* ───────────── La liste, l'écran d'une personne ───────────── */

async function listWorld(over = {}) {
  const w = makeWorld({ settings: { provider: "csv", ...over } });
  await O.importText(w.ctx, "nom;palier;depuis\nAda;Or;2025-01-01\nBob;Argent;2025-02-02\nCléo;Or;2025-03-03");
  return { ...w, people: await peopleOf(w.ctx) };
}

test("liste : 25 par page, recherche, filtres, état lisible ; jamais de montant ; les actions de ligne mènent à l'écran de la personne", async () => {
  const w = makeWorld({ settings: { provider: "csv" } });
  await O.importText(w.ctx, "nom;palier\n" + Array.from({ length: 60 }, (_, i) => `Personne ${String(i).padStart(2, "0")};Or`).join("\n"));
  const blocks = await Admin.panel(w.ctx, { query: {} });
  const table = find(blocks, "table", (b) => b.columns[0] === fr.colPerson)[0];
  assert.equal(table.rows.length, 25);
  assert.deepEqual(table.rowActions, [{ label: fr.open, href: "?p={id}" }]);
  assert.ok(table.rows.every((r) => r[3] === fr.dsNoConsent && r[2] === fr.stActive));
  const p3 = find(await Admin.panel(w.ctx, { query: { page: "3" } }), "table", (b) => b.columns[0] === fr.colPerson)[0];
  assert.equal(p3.rows.length, 10);
  const found = find(await Admin.panel(w.ctx, { query: { q: "personne 07" } }), "table", (b) => b.columns[0] === fr.colPerson)[0];
  assert.deepEqual(found.rows.map((r) => r[0]), ["Personne 07"]);
  const none = await Admin.panel(w.ctx, { query: { q: "introuvable" } });
  assert.ok(text(none).includes(fr.listNone));
  const redirect = await Admin.actions.search(w.ctx, { q: "Ada", filter: "active" });
  assert.equal(redirect.redirect, "?filter=active&q=Ada");
  assert.equal((await Admin.actions.search(w.ctx, { q: "x", filter: "../pirate" })).redirect, "?filter=all&q=x");
});

test("liste : filtres « sans réponse », « à relire », « arrêtés » ; l'état de chaque ligne dit ce que le public voit", async () => {
  const { ctx, people } = await listWorld({ review: true });
  const [ada, bob, cleo] = people;
  const link = await O.consentLink(ctx, ada.pid);
  Routes.resetLimits();
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: ada.pid, t: link.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" }), ctx);
  await O.setHidden(ctx, cleo.pid, true);
  await O.importText(ctx, "nom;statut\nBob;arrêté");
  const rowsFor = async (filter) => find(await Admin.panel(ctx, { query: { filter } }), "table", (b) => b.columns[0] === fr.colPerson)[0]?.rows ?? [];
  assert.deepEqual((await rowsFor("pending")).map((r) => [r[0], r[3]]), [["Ada", fr.dsPending.replace("{pseudo}", "Luna42")]]);
  assert.deepEqual((await rowsFor("ended")).map((r) => r[0]), ["Bob"]);
  assert.deepEqual((await rowsFor("waiting")).map((r) => r[0]), ["Cléo"]);
  assert.equal((await rowsFor("all")).find((r) => r[0] === "Cléo")[3], fr.dsHidden);
  void bob;
});

test("écran d'une personne : lien d'accord à copier, approuver / refuser, cacher, oublier ; réservé au droit de gérer ; nouveau lien invalide l'ancien", async () => {
  const { ctx, people } = await listWorld({ review: true });
  const [ada] = people;
  const blocks = await Admin.panel(ctx, { query: { p: ada.pid } });
  const copy = find(blocks, "copy")[0];
  assert.match(copy.text, new RegExp(`^https://site\\.example\\.test/soutiens/moi/${ada.pid}/[a-f0-9]{32}$`));
  assert.ok(find(blocks, "adminForm", (b) => b.action === "personHide").length === 1);
  assert.equal(find(blocks, "adminForm", (b) => b.action === "personApprove").length, 0, "rien à approuver tant que la personne n'a pas choisi");
  Routes.resetLimits();
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: ada.pid, t: copy.text.split("/").pop(), loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" }), ctx);
  const withPending = await Admin.panel(ctx, { query: { p: ada.pid } });
  assert.equal(find(withPending, "adminForm", (b) => b.action === "personApprove").length, 2);
  assert.ok(text(withPending).includes("Luna42"));
  const ok = await Admin.actions.personApprove.run(ctx, { pid: ada.pid, approve: "1" });
  assert.equal(ok.ok, fr.approved);
  const renew = await Admin.actions.personRenew.run(ctx, { pid: ada.pid });
  assert.equal(renew.ok, fr.linkRenewed);
  const after = find(await Admin.panel(ctx, { query: { p: ada.pid } }), "copy")[0];
  assert.notEqual(after.text, copy.text);
  assert.equal((await Admin.actions.personForget.run(ctx, { id: ada.pid })).ok, fr.forgotten);
  assert.ok(text(await Admin.panel(ctx, { query: { p: ada.pid } })).includes(fr.personGone));
  assert.equal((await Admin.actions.personApprove.run(ctx, { pid: "0".repeat(12), approve: "1" })).error, fr.personGone);
});

test("écran d'une personne : sans le droit de gérer, on voit mais on ne change rien (pas de lien d'accord) ; chaque action d'écriture déclare son droit", async () => {
  const { ctx, people } = await listWorld({}); 
  const ro = { ...ctx, can: (r) => r !== "people.manage" };
  const blocks = await Admin.panel(ro, { query: { p: people[0].pid } });
  assert.equal(find(blocks, "copy").length, 0);
  assert.ok(text(blocks).includes(fr.noRight));
  for (const [name, a] of Object.entries(Admin.actions)) if (name !== "search") assert.ok(typeof a === "object" && a.right, `${name} déclare son droit`);
  const rights = manifest.rights.map((r) => r.id);
  for (const a of Object.values(Admin.actions)) if (typeof a === "object") assert.ok(rights.includes(a.right), a.right);
  for (const r of manifest.rights) assert.deepEqual(r.default, { admin: true, editor: false }, "jamais accordé d'office aux éditeurs");
});

/* ───────────── Les paliers et les modèles ───────────── */

test("paliers : libellé public par langue ; erreurs sous le champ (trop long, montant, niveau illisible) avec un exemple ; sans libellé → groupe général", async () => {
  const { ctx, people } = await listWorld();
  const snap = await D.snapshot(ctx, { fresh: true });
  const k = [...snap.tiers.values()].find((t) => t.data.name === "Or").data.k;
  const screen = await Admin.panel(ctx, { query: { tier: k } });
  const form = find(screen, "adminForm")[0];
  assert.deepEqual(form.fields.map((f) => f.name), ["k", "label_fr", "label_en", "rank"], "le niveau est réglable pour une plateforme sans montants");
  const tooLong = await Admin.actions.tierSave.run(ctx, { k, label_fr: "x".repeat(41) });
  assert.deepEqual(Object.keys(tooLong.errors), ["label_fr"]);
  assert.match(tooLong.errors.label_fr, /40 lettres/);
  const amount = await Admin.actions.tierSave.run(ctx, { k, label_en: "5 € a month" });
  assert.deepEqual(amount.errors, { label_en: fr.errLabelAmount });
  const rank = await Admin.actions.tierSave.run(ctx, { k, rank: "trois" });
  assert.deepEqual(rank.errors, { rank: fr.errRank });
  assert.equal((await Admin.actions.tierSave.run(ctx, { k, label_fr: "Mécène", label_en: "Patron", rank: "3" })).ok, fr.tierSaved);
  D.forget(ctx);
  const table = find(await Admin.panel(ctx, { query: {} }), "table", (b) => b.columns[0] === fr.colTierName)[0];
  assert.deepEqual(table.rows.find((r) => r[0] === "Or"), ["Or", "Mécène"]);
  assert.ok(table.rows.some((r) => r[1] === fr.tierNoLabel));
  const patreon = makeWorld();
  await kit.withFakeFetch({ "*": fakePatreon({ tiers: [{ id: 1, title: "A", cents: 100 }], members: [{ id: 1, name: "Ada", status: "active_patron", tiers: [1] }] }).reply }, async () => { await S.refresh(patreon.ctx, { force: true }); });
  const ps = await Admin.panel(patreon.ctx, { query: { tier: "patreon:1" } });
  assert.deepEqual(find(ps, "adminForm")[0].fields.map((f) => f.name), ["k", "label_fr", "label_en"], "chez Patreon le niveau vient de la plateforme : pas de champ à remplir");
  void people;
});

test("modèles de départ : trois niveaux, numérotés, ou aucun libellé ; appliqués du palier le plus bas au plus haut, dans les langues du site, jamais un montant", async () => {
  const w = makeWorld({ settings: { provider: "csv" } });
  await O.importText(w.ctx, "nom;palier\nA;Un\nB;Deux\nC;Trois\nD;Quatre\nE;Cinq");
  const snap = await D.snapshot(w.ctx, { fresh: true });
  const k = (n) => [...snap.tiers.values()].find((t) => t.data.name === n).data.k;
  for (const [i, n] of ["Un", "Deux", "Trois", "Quatre", "Cinq"].entries()) await O.tierLabel(w.ctx, k(n), {}, i + 1);
  assert.equal((await Admin.actions.tierTemplate.run(w.ctx, { template: "three" })).ok, "Libellés appliqués à 5 paliers.");
  const after = [...(await D.snapshot(w.ctx, { fresh: true })).tiers.values()].map((r) => r.data).sort((a, b) => a.rank - b.rank);
  assert.deepEqual(after.map((t) => t.label.fr), ["Soutien", "Soutien", "Grand soutien", "Grand soutien", "Mécène"]);
  assert.deepEqual(after.map((t) => t.label.en), ["Supporter", "Supporter", "Big supporter", "Big supporter", "Patron"]);
  await Admin.actions.tierTemplate.run(w.ctx, { template: "levels" });
  assert.deepEqual([...(await D.snapshot(w.ctx, { fresh: true })).tiers.values()].map((r) => r.data).sort((a, b) => a.rank - b.rank).map((t) => t.label.fr), ["Niveau 1", "Niveau 2", "Niveau 3", "Niveau 4", "Niveau 5"]);
  await Admin.actions.tierTemplate.run(w.ctx, { template: "none" });
  assert.ok([...(await D.snapshot(w.ctx, { fresh: true })).tiers.values()].every((r) => Object.keys(r.data.label).length === 0));
  assert.deepEqual((await Admin.actions.tierTemplate.run(w.ctx, { template: "../x" })).errors, { template: fr.errTemplate });
  for (const id of O.TEMPLATE_IDS) assert.ok(fr[`tpl_${id}`] && en[`tpl_${id}`]);
});

/* ───────────── Import ───────────── */

test("import : erreurs sous le bon champ avec un exemple ; réussite chiffrée ; la zone de texte marche sans fichier", async () => {
  const { ctx } = makeWorld({ settings: { provider: "csv" } });
  assert.deepEqual(Object.keys((await Admin.actions.importFile.run(ctx, { file: "", paste: "" })).errors), ["file"]);
  const noName = await Admin.actions.importFile.run(ctx, { file: "palier;depuis\nOr;2025-01-01", paste: "" });
  assert.deepEqual(noName.errors, { file: fr.errImportName });
  const pasteErr = await Admin.actions.importFile.run(ctx, { file: "", paste: "palier\nOr" });
  assert.deepEqual(Object.keys(pasteErr.errors), ["paste"]);
  const head = await Admin.actions.importFile.run(ctx, { file: "nom\n", paste: "" });
  assert.match(head.errors.file, /nom;palier/);
  const many = await Admin.actions.importFile.run(ctx, { file: "nom\n" + "x\n".repeat(1100), paste: "" });
  assert.match(many.errors.file, /1000 au plus/);
  const ok = await Admin.actions.importFile.run(ctx, { file: "", paste: "nom;palier\nAda;Or\nBob;Or" });
  assert.equal(ok.ok, "Import terminé : 2 nouveaux, 0 mis à jour, 0 arrêtés.");
  const skipped = await Admin.actions.importFile.run(ctx, { file: "nom;depuis\nCléo;n'importe quoi", paste: "" });
  assert.deepEqual(Object.keys(skipped.errors), ["file"], "aucune ligne utilisable");
  const part = await Admin.actions.importFile.run(ctx, { file: "nom;depuis\nCléo;2025-01-01\nDora;pas une date", paste: "" });
  assert.match(part.ok, /1 lignes ignorées \(la première : ligne 3\)/);
  const form = find(await Admin.panel(ctx, { query: {} }), "adminForm", (b) => b.action === "importFile")[0];
  assert.deepEqual(form.fields.map((f) => [f.name, f.kind]), [["file", "file"], ["paste", "textarea"], ["replace", "checkbox"]]);
});

test("nettoyage : les soutiens arrêtés depuis trop longtemps sont oubliés, pas les autres ; la durée est réglable et bornée", async () => {
  const { ctx } = makeWorld({ settings: { provider: "csv", keepDays: 100 } });
  await O.importText(ctx, "nom\nVieux\nRécent\nActif");
  const snap = await D.snapshot(ctx, { fresh: true });
  const set = async (name, over) => { const r = [...snap.people.values()].find((x) => x.data.name === name); await ctx.api.store.update(r.id, { ...r.data, ...over }); };
  await set("Vieux", { status: "ended", last: "2020-01-01", first: "2020-01-01" });
  await set("Récent", { status: "ended", last: P.dayOf(Date.now() - 5 * 86_400_000) });
  D.forget(ctx);
  assert.equal((await Admin.actions.tidy.run(ctx)).ok, "1 anciens soutiens oubliés.");
  assert.deepEqual((await peopleOf(ctx)).map((p) => p.name).sort(), ["Actif", "Récent"]);
  assert.equal((await Admin.actions.tidy.run(ctx)).ok, fr.tidyNothing);
  assert.equal(S.knobs({ setting: (k) => ({ keepDays: 5, activeDays: 99999, cacheMinutes: 0 })[k] }).keepDays, 30);
  assert.equal(S.knobs({ setting: (k) => ({ keepDays: 5, activeDays: 99999, cacheMinutes: 0 })[k] }).activeDays, 400);
  assert.equal(S.knobs({ setting: () => "abc" }).cacheMs, 360 * 60_000);
});

/* ───────────── Assistant IA (MCP) ───────────── */

test("MCP : chaque outil déclaré est implémenté, ≤ 64 caractères avec le préfixe d'instance, lecture seule marquée, écritures jamais accordées d'office, la suppression est destructive", () => {
  const names = manifest.mcp.map((m) => m.name);
  assert.deepEqual([...names].sort(), Object.keys(Mcp.default).sort());
  for (const m of manifest.mcp) {
    assert.ok(`soutiens-de-demonstration__${m.name}`.length <= 64, m.name);
    if (m.readOnly) assert.ok(!m.destructive);
    else assert.notEqual(m.default, true, `${m.name} : une écriture n'est jamais accordée d'office`);
  }
  assert.deepEqual(manifest.mcp.filter((m) => m.readOnly).map((m) => m.name).sort(), ["supporters_list", "supporters_status"]);
  assert.equal(manifest.mcp.find((m) => m.name === "supporters_forget").destructive, true);
  assert.ok(!names.some((n) => /pseudo|consent_set|accept/.test(n)), "aucun outil n'écrit un pseudo à la place de la personne");
});

test("MCP : état et liste sans montant ni e-mail ; le nom n'est donné que tant que la personne n'est pas rangée dans Contacts", async () => {
  const { ctx, people } = await listWorld();
  const st = await Mcp.default.supporters_status(ctx);
  assert.deepEqual([st.provider, st.state, st.counts.active, st.counts.nicknamesShown], ["csv", "ok", 3, 0]);
  assert.equal(st.tiers.length, 2);
  const list = await Mcp.default.supporters_list(ctx, {});
  assert.equal(list.total, 3);
  assert.ok(list.supporters.every((s) => s.consent === "none" && s.hidden === false && s.filed === false && s.name));
  assert.ok(!JSON.stringify([st, list]).match(/@|€|amount|cents/));
  const filtered = await Mcp.default.supporters_list(ctx, { filter: "pending" });
  assert.equal(filtered.total, 0);
  void people;
  const nokey = makeWorld({ settings: { accessToken: "" } });
  assert.deepEqual([(await Mcp.default.supporters_status(nokey.ctx)).state, (await Mcp.default.supporters_status(nokey.ctx)).reason], ["setup", "no_key"]);
});

test("MCP : écritures = mêmes règles que l'administration ; on ne peut pas approuver sans pseudo choisi par la personne ; libellés sans montant", async () => {
  const { ctx, people } = await listWorld({ review: true });
  const [ada] = people;
  await assert.rejects(Mcp.default.supporters_approve(ctx, { pid: ada.pid }), /nickname/);
  await assert.rejects(Mcp.default.supporters_hide(ctx, { pid: "zzz" }), /pid is required/);
  await assert.rejects(Mcp.default.supporters_hide(ctx, { pid: "0".repeat(12) }), /No such supporter/);
  const l = await Mcp.default.supporters_consent_link(ctx, { pid: ada.pid });
  assert.match(l.path, new RegExp(`^/soutiens/moi/${ada.pid}/[a-f0-9]{32}$`));
  const l2 = await Mcp.default.supporters_consent_link(ctx, { pid: ada.pid, renew: true });
  assert.notEqual(l.path, l2.path);
  Routes.resetLimits();
  await def.routes.consent(formRequest("https://site.example.test/m/soutiens/consent", { pid: ada.pid, t: l2.path.split("/").pop(), loc: "fr", act: "accept", pseudo: "Luna42", agree: "yes" }), ctx);
  assert.deepEqual(await Mcp.default.supporters_approve(ctx, { pid: ada.pid }), { pid: ada.pid, approved: true });
  assert.deepEqual(await Mcp.default.supporters_hide(ctx, { pid: ada.pid }), { pid: ada.pid, hidden: true });
  const st = await Mcp.default.supporters_status(ctx);
  const tier = st.tiers.find((x) => x.platformName === "Or");
  await assert.rejects(Mcp.default.supporters_tier_label(ctx, { tier: tier.key, label: "5 euros" }), /amount/);
  await assert.rejects(Mcp.default.supporters_tier_label(ctx, { tier: "inconnu", label: "x" }), /Unknown tier/);
  assert.deepEqual(await Mcp.default.supporters_tier_label(ctx, { tier: tier.key, label: "Mécène", locale: "fr" }), { saved: true, tier: tier.key, locale: "fr" });
  assert.equal((await Mcp.default.supporters_status(ctx)).tiers.find((x) => x.key === tier.key).publicLabels.fr, "Mécène");
  assert.deepEqual(await Mcp.default.supporters_forget(ctx, { pid: ada.pid }), { forgotten: true, pid: ada.pid });
  await assert.rejects(Mcp.default.supporters_refresh(ctx), /does not need a refresh/);
});

test("MCP : actualiser sans clé ou avec une plateforme en panne répond par une erreur lisible, sans secret", async () => {
  const none = makeWorld({ settings: { accessToken: "" } });
  await assert.rejects(Mcp.default.supporters_refresh(none.ctx), /No secret key/);
  const { ctx } = makeWorld();
  const pat = fakePatreon({}); pat.state.status = 503;
  await kit.withFakeFetch({ "*": pat.reply }, async () => { await assert.rejects(Mcp.default.supporters_refresh(ctx), (e) => /unreachable/.test(e.message) && !/tok-creator/.test(e.message) && e.expose === true); });
  pat.state.status = null; pat.state.members = [{ id: 1, name: "Ada", status: "active_patron", tiers: [] }];
  await kit.withFakeFetch({ "*": pat.reply }, async () => { assert.deepEqual(await Mcp.default.supporters_refresh(ctx), { refreshed: true, count: 1, added: 1, ended: 0, partial: false }); });
});

/* ───────────── Mobile d'abord, langues, secrets ───────────── */

test("panneau : FR et EN complets, parité exacte, et aucune clé de traduction ne s'affiche telle quelle dans aucun écran", async () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const loc of [fr, en]) for (const [k, v] of Object.entries(loc)) assert.ok(typeof v === "string" && v.trim(), k);
  for (const locale of ["fr", "en"]) {
    const w = makeWorld({ locale, settings: { provider: "csv" } });
    await O.importText(w.ctx, "nom;palier\nAda;Or");
    const p = (await peopleOf(w.ctx))[0];
    const tier = (await D.snapshot(w.ctx, { fresh: true })).tiers.keys().next().value;
    for (const q of [{}, { p: p.pid }, { tier }, { filter: "pending" }, { q: "zzz" }]) {
      const s = text(await Admin.panel(w.ctx, { query: q }));
      for (const key of Object.keys(fr)) assert.ok(!s.includes(`"${key}"`), `${locale} : la clé « ${key} » s'affiche telle quelle`);
    }
    const page = text(await def.page(w.ctx, { segments: [] }));
    const me = text(await def.page(w.ctx, { segments: ["moi", p.pid, (await O.consentLink(w.ctx, p.pid)).path.split("/").pop()] }));
    for (const key of Object.keys(fr)) assert.ok(!page.includes(`>${key}<`) && !me.includes(`>${key}<`), key);
  }
});

test("secrets : la clé de la plateforme est un réglage « secret » ; aucun champ de formulaire du module ne la demande ; elle n'est ni dans le stockage, ni dans les blocs, ni dans les réponses", async () => {
  const s = manifest.settings.find((x) => x.key === "accessToken");
  assert.equal(s.type, "secret");
  assert.ok(!manifest.settings.some((x) => x.type !== "secret" && /token|secret|key|clé|jeton/i.test(x.key)), "aucun autre réglage ne ressemble à un secret");
  const { ctx } = makeWorld({ settings: { provider: "kofi", accessToken: "kofi-verify-token" } });
  await def.routes.kofi(kofiRequest(), ctx);
  const everything = text([await Admin.panel(ctx, { query: {} }), ctx.dumpStore(), await Mcp.default.supporters_status(ctx), await Mcp.default.supporters_list(ctx, {})]);
  assert.ok(!everything.includes("kofi-verify-token"));
  const fields = JSON.stringify(Object.values(Admin.actions).length);
  void fields;
  const all = text(await Admin.panel(ctx, { query: {} }));
  assert.ok(!/"kind":"(password|secret)"/.test(all) && !all.includes('"name":"accessToken"'));
});

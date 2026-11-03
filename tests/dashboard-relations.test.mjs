// Tableau de bord du cœur (clé `dashboard`) : Contacts, Partenariats, Streams saisis à la main et Boîte à idées (la pastille en double).
// Ce que ces tests tiennent : déclarations valides (mêmes fonctions que le cœur), sobres et dans les mots de la personne ;
// chaque tâche compte exactement ce qui attend une action, avec le même calcul que l'administration ; réponse rapide, bornée, sans réseau ;
// la pastille du menu n'existe plus là où une tâche dit la même chose.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseManifest } from "@/core/modules/manifest";
import { rightsCatalogue, systemRights } from "@/core/auth/rights";
import { moduleTasks, moduleActions, resetDashboardMemo } from "@/core/dashboard/modules";
import { dashboardIssues, parseTaskCount, resolveHref, DASHBOARD_LIMITS } from "@/core/dashboard/spec";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { memStore } from "./helpers/contactsStore.mjs";

const D = await import("../modules/contacts/data.mjs");

const MODULES = ["contacts", "partnerships", "calendar-manual", "idea-box"];
const loaded = Object.fromEntries(await Promise.all(MODULES.map(async (id) => [id, await loadModule(`modules/${id}`)])));
const messages = (id, lang) => JSON.parse(fs.readFileSync(new URL(`../modules/${id}/locales/${lang}.json`, import.meta.url), "utf8"));

// Mots que la personne ne doit pas lire (règle R9 du dépôt) : jamais dans un libellé du tableau de bord.
const FORBIDDEN = /\b(cl[ée]s?|slug|instances?|topics?|sujets?|tokens?|jetons?|webhooks?|eventsub|routes?|services?|identifiants?|payload|api|json|cache|hash|sse|oauth)\b/i;
const wordsOf = (decl) => [
  ...(decl.tasks ?? []).map((x) => x.label), ...(decl.quickActions ?? []).map((x) => x.label),
  ...(decl.cards ?? []).flatMap((x) => [x.title, x.empty].filter(Boolean)),
];

test("chaque déclaration est valide pour le cœur : forme, droits déclarés, liens d'administration, fr et en", () => {
  for (const id of MODULES) {
    const { manifest } = loaded[id];
    const parsed = parseManifest(manifest);
    assert.ok(parsed.ok, `${id} : ${parsed.ok ? "" : parsed.error}`);
    assert.ok(manifest.dashboard, `${id} déclare quelque chose au tableau de bord`);
    assert.deepEqual(dashboardIssues(manifest.dashboard, (manifest.rights ?? []).map((r) => r.id)), [], id);
  }
});

test("sobriété : au plus 3 éléments par extension, libellés courts dans les mots de la personne, ton neutre", () => {
  for (const id of MODULES) {
    const decl = loaded[id].manifest.dashboard;
    const count = (decl.tasks?.length ?? 0) + (decl.quickActions?.length ?? 0) + (decl.cards?.length ?? 0);
    assert.ok(count >= 1 && count <= 3, `${id} : ${count} éléments`);
    for (const text of wordsOf(decl)) {
      for (const lang of ["fr", "en"]) {
        const s = text[lang];
        assert.ok(s && s.length <= 60, `${id} ${lang} : « ${s} » (60 caractères au plus)`);
        assert.ok(!/!/.test(s) && !/[:：]\s*$/.test(s) && !/veuillez/i.test(s) && s !== s.toUpperCase(), `${id} ${lang} : « ${s} »`);
        assert.ok(s.split(/\s+/).length <= 20, `${id} ${lang} : phrase trop longue`);
        if (lang === "fr") assert.ok(!FORBIDDEN.test(s), `${id} : mot de code dans « ${s} »`);
      }
    }
  }
});

test("une tâche mène à l'écran qui règle la chose ; chaque tâche déclarée a sa fonction, et inversement", () => {
  for (const id of MODULES) {
    const { manifest, definition } = loaded[id];
    const rights = new Set((manifest.rights ?? []).map((r) => r.id));
    for (const task of manifest.dashboard.tasks ?? []) {
      assert.match(task.href, /^\?tab=use/, `${id} ${task.id} : lien vers l'onglet de l'extension`);
      assert.ok(resolveHref(task.href, { id: "i1", key: "k" })?.startsWith("/admin/instances/i1?tab=use"), task.id);
      if (task.right) assert.ok(rights.has(task.right), `${id} : droit ${task.right} déclaré`);
      for (const lang of ["fr", "en"]) assert.match(task.label[lang], / \(\{n\}\)$/, "le nombre est entre parenthèses à la fin : le libellé se lit aussi bien pour 1 que pour 12");
      assert.equal(typeof definition.dashboard?.tasks?.[task.id], "function", `${id} : fonction ${task.id}`);
    }
    for (const fn of Object.keys(definition.dashboard?.tasks ?? {})) assert.ok(manifest.dashboard.tasks.some((t) => t.id === fn), `${id} : ${fn} est déclarée`);
  }
});

test("la pastille du menu a disparu là où une tâche dit la même chose (sinon la ligne s'afficherait deux fois)", () => {
  for (const id of ["contacts", "idea-box"]) {
    assert.equal(loaded[id].definition.adminBadge, undefined, id);
    assert.ok(loaded[id].manifest.dashboard.tasks.length >= 1, id);
  }
});

const noNetwork = async (fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("le tableau de bord ne doit jamais appeler le réseau"); };
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const timed = async (fn) => { const t0 = Date.now(); const out = await noNetwork(fn); assert.ok(Date.now() - t0 < DASHBOARD_LIMITS.timeoutMs, "plus rapide que le délai du cœur"); return out; };

// ── Contacts ─────────────────────────────────────────────────────────────────────────────────────────

const contactsCtx = (opts = {}) => {
  const c = fakeCtx({ moduleId: "contacts", key: `contacts-d${Math.random().toString(36).slice(2, 8)}`, locale: "fr", messages: messages("contacts", "fr"), ...opts });
  c.api.store = memStore();
  return c;
};

test("Contacts : les fiches « à vérifier » comptent (messages du formulaire), les autres non", async () => {
  const def = loaded.contacts.definition;
  const ctx = contactsCtx();
  assert.equal(parseTaskCount(await def.dashboard.tasks.review(ctx)), 0, "carnet vide : la ligne disparaît");
  const store = def.services["contact.store"];
  await store.add(ctx, { name: "Alice", email: "alice@example.org", message: "Bonjour", source: "contact-form" });
  await store.add(ctx, { name: "Alice", email: "alice@example.org", message: "Encore", source: "contact-form" });   // même e-mail : une seule fiche
  await store.add(ctx, { name: "Bastien", email: "bastien@example.org", message: "Salut", source: "contact-form" });
  await def.services["contact.book"].create(ctx, { name: "Claire", accounts: [{ network: "twitch", handle: "claire_live" }] });   // fiche créée par la personne : rien à vérifier
  assert.equal(await timed(() => def.dashboard.tasks.review(ctx)), 2);
  assert.equal(loaded.contacts.manifest.dashboard.tasks[0].href, "?tab=use&review=1");
});

test("Contacts : un carnet qui ne répond pas rend 0 en moins d'une seconde et demie, sans bloquer le tableau de bord", async () => {
  const def = loaded.contacts.definition;
  const store = memStore();
  const ctx = contactsCtx();
  ctx.api.store = store;
  ctx.__contactsTest = { indexWaitMs: 80, buildMaxMs: 150, storeCallMs: 60, lockWaitMs: 80, lockHoldMs: 120 };
  await def.services["contact.store"].add(ctx, { name: "Alice", email: "alice@example.org", message: "Bonjour", source: "contact-form" });
  D.forgetIndex(ctx);                 // la reconstruction de l'index repart de la lecture qui ne répond pas
  store.faults.hang.add("page");
  const t0 = Date.now();
  assert.equal(await def.dashboard.tasks.review(ctx), 0);
  assert.ok(Date.now() - t0 < DASHBOARD_LIMITS.timeoutMs, "borné");
  store.faults.hang.delete("page");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await def.dashboard.tasks.review(ctx), 1, "à l'affichage suivant, l'index est prêt et la tâche apparaît");
});

// ── Partenariats ───────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const partnersCtx = (settings = {}) => fakeCtx({ locale: "fr", messages: messages("partnerships", "fr"), settings });

test("Partenariats : « à relancer » = message envoyé sans nouvelle depuis le délai, comme le ⏰ du tableau", async () => {
  const def = loaded.partnerships.definition;
  const run = (ctx) => def.dashboard.tasks["follow-up"](ctx);
  const ctx = partnersCtx({ followUpDays: 10 });
  assert.equal(parseTaskCount(await run(ctx)), 0);
  const quiet = await ctx.api.store.add("partners", { brand: "Alpha", status: "envoye" });
  const recent = await ctx.api.store.add("partners", { brand: "Beta", status: "envoye" });
  await ctx.api.store.add("partners", { brand: "Gamma", status: "discussion" });       // seul « envoyé » se relance
  await ctx.api.store.add("partners", { brand: "Delta", status: "sans_reponse" });
  await ctx.api.store.add("journal", { partnerId: quiet, date: isoDaysAgo(40), text: "x" });
  await ctx.api.store.add("journal", { partnerId: recent, date: isoDaysAgo(2), text: "y" });
  assert.equal(await timed(() => run(ctx)), 1);
  // Le même nombre que l'outil de l'assistant, qui utilise le même calcul que le tableau d'administration.
  const listed = await def.mcp.partners_list(ctx, {});
  assert.equal(listed.filter((p) => p.followUpDue).length, 1);
  await ctx.api.store.add("journal", { partnerId: quiet, date: isoDaysAgo(1), text: "relancé" });
  assert.equal(await run(ctx), 0, "une nouvelle note dans le journal annule la relance");
  const strict = partnersCtx({ followUpDays: 1 });
  const p = await strict.api.store.add("partners", { brand: "Epsilon", status: "envoye" });
  await strict.api.store.add("journal", { partnerId: p, date: isoDaysAgo(3), text: "x" });
  assert.equal(await run(strict), 1, "le délai du réglage « relance après n jours » est respecté");
});

test("Partenariats : sans message envoyé, le journal n'est même pas lu ; mille fiches restent dans le délai", async () => {
  const def = loaded.partnerships.definition;
  const ctx = partnersCtx();
  const reads = [];
  const list = ctx.api.store.list.bind(ctx.api.store);
  ctx.api.store.list = (collection, opts) => { reads.push(collection); return list(collection, opts); };
  await ctx.api.store.add("partners", { brand: "Alpha", status: "a_contacter" });
  assert.equal(await def.dashboard.tasks["follow-up"](ctx), 0);
  assert.deepEqual(reads, ["partners"]);
  await ctx.api.store.addMany("partners", Array.from({ length: 1000 }, (_, i) => ({ data: { brand: `Marque ${i}`, status: i % 2 ? "envoye" : "discussion" } })));
  await ctx.api.store.addMany("journal", Array.from({ length: 1000 }, (_, i) => ({ data: { partnerId: `inconnu-${i}`, date: isoDaysAgo(1), text: "x" } })));
  const n = await timed(() => def.dashboard.tasks["follow-up"](ctx));
  assert.ok(Number.isInteger(n) && n >= 0);
});

// ── Streams saisis à la main ───────────────────────────────────────────────────────────────────────────

test("Streams saisis à la main : un bouton « Programmer un stream » vers l'écran de l'extension, sans code", () => {
  const { manifest, definition } = loaded["calendar-manual"];
  assert.equal(definition.dashboard, undefined, "une action rapide n'appelle aucun code");
  assert.equal(manifest.dashboard.tasks, undefined); assert.equal(manifest.dashboard.cards, undefined);
  const [action, ...others] = manifest.dashboard.quickActions;
  assert.equal(others.length, 0);
  assert.deepEqual([action.label.fr, action.label.en, action.right], ["Programmer un stream", "Schedule a stream", undefined]);
  assert.equal(resolveHref(action.href, { id: "i9", key: "streams" }), "/admin/instances/i9?tab=use");
  assert.ok(manifest.tabs.some((t) => t.id === "use"), "l'onglet visé existe");
});

// ── Boîte à idées ─────────────────────────────────────────────────────────────────────────────────────

test("Boîte à idées : la tâche et la carte restent ce qu'elles étaient, seule la pastille en double est retirée", () => {
  const { manifest, definition } = loaded["idea-box"];
  assert.deepEqual(manifest.dashboard.tasks.map((t) => [t.id, t.right]), [["review", "ideas.moderate"]]);
  assert.deepEqual(manifest.dashboard.cards.map((c) => c.id), ["top"]);
  assert.deepEqual(Object.keys(definition.dashboard.tasks), ["review"]);
  assert.deepEqual(Object.keys(definition.dashboard.cards), ["top"]);
});

// ── De bout en bout, avec les vraies fonctions du cœur ─────────────────────────────────────────────────

const CATALOGUE = rightsCatalogue(MODULES.map((id) => ({ moduleId: id, name: loaded[id].manifest.name, rights: loaded[id].manifest.rights ?? [] })));
const viewer = (level) => ({ id: "u1", email: "a@b.c", name: "A", level, roles: [level], rights: new Set(systemRights(level, CATALOGUE)), locale: null, advanced: false, totp: true, passkeys: 0, twoFactor: true, needsTwoFactor: false, mustChangePassword: false });

test("le cœur affiche ces lignes : libellés remplis (même pour 1), liens complets, droits respectés, une rédaction ne voit rien", async () => {
  const book = contactsCtx();
  await loaded.contacts.definition.services["contact.store"].add(book, { name: "Alice", email: "alice@example.org", message: "Bonjour", source: "contact-form" });
  const pipeline = partnersCtx({ followUpDays: 5 });
  const p = await pipeline.api.store.add("partners", { brand: "Alpha", status: "envoye" });
  await pipeline.api.store.add("journal", { partnerId: p, date: isoDaysAgo(30), text: "x" });
  const contexts = { contacts: book, partnerships: pipeline };
  const list = MODULES.map((id) => {
    const parsed = parseManifest(loaded[id].manifest); assert.ok(parsed.ok);
    return { instance: { id: `i-${id}`, key: id, moduleId: id, names: { fr: id }, descriptions: {} }, mod: { manifest: parsed.manifest, def: loaded[id].definition, locales: {}, row: {} } };
  });
  const env = (user) => ({ viewer: user, locale: "fr", defaultLocale: "fr", active: async () => list, contextFor: async (a) => contexts[a.mod.manifest.id] ?? fakeCtx({}) });
  resetDashboardMemo();
  const tasks = await moduleTasks(env(viewer("admin")));
  assert.deepEqual(tasks.map((t) => [t.label, t.href]).sort(), [
    ["Contacts à vérifier (1)", "/admin/instances/i-contacts?tab=use&review=1"],
    ["Partenaires à relancer (1)", "/admin/instances/i-partnerships?tab=use"],
  ]);
  const actions = await moduleActions(env(viewer("admin")));
  assert.deepEqual(actions.map((a) => [a.label, a.href]), [["Programmer un stream", "/admin/instances/i-calendar-manual?tab=use"]]);
  resetDashboardMemo();
  assert.deepEqual(await moduleTasks(env(viewer("editor"))), []);
  assert.deepEqual(await moduleActions(env(viewer("editor"))), []);
});

// Tableau de bord du cœur (clé `dashboard`) : Blog, Pages, Témoignages, Suggestions de jeux, Événements.
// Ce que ces tests tiennent : les déclarations sont valides (mêmes fonctions que le cœur), sobres et dans les mots de la personne ;
// chaque tâche compte exactement ce qui attend une action ; la réponse est rapide, bornée et ne touche jamais le réseau ;
// la pastille du menu n'existe plus là où une tâche dit la même chose (sinon la même ligne s'afficherait deux fois).
import test from "node:test";
import assert from "node:assert/strict";
import { parseManifest } from "@/core/modules/manifest";
import { dashboardIssues, parseTaskCount, resolveHref, DASHBOARD_LIMITS } from "@/core/dashboard/spec";
import { loadModule } from "./helpers/moduleLoader.mjs";
import { fakeCtx } from "./helpers/fakeCtx.mjs";
import { ctxFor as testimonialsCtx, seed as seedReview } from "./helpers/testimonials.mjs";
import { ctxFor as eventsCtx, addEvent, def as eventsDef } from "./helpers/eventsKit.mjs";

const MODULES = ["blog", "pages", "testimonials", "game-suggestions", "events"];
const loaded = Object.fromEntries(await Promise.all(MODULES.map(async (id) => [id, await loadModule(`modules/${id}`)])));

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
    const rights = (manifest.rights ?? []).map((r) => r.id);
    assert.deepEqual(dashboardIssues(manifest.dashboard, rights), [], id);
  }
});

test("sobriété : au plus 3 éléments par extension, libellés courts dans les mots de la personne, ton neutre", () => {
  for (const id of MODULES) {
    const decl = loaded[id].manifest.dashboard;
    const count = (decl.tasks?.length ?? 0) + (decl.quickActions?.length ?? 0) + (decl.cards?.length ?? 0);
    assert.ok(count >= 1 && count <= 3, `${id} : ${count} éléments`);
    assert.ok((decl.tasks?.length ?? 0) <= 3 && (decl.quickActions?.length ?? 0) <= 1 && (decl.cards?.length ?? 0) <= 1, id);
    for (const text of wordsOf(decl)) {
      for (const lang of ["fr", "en"]) {
        const s = text[lang];
        assert.ok(s && s.length <= 60, `${id} ${lang} : « ${s} » (60 caractères au plus)`);
        assert.ok(!/[:!]/.test(s) && !/veuillez/i.test(s) && s !== s.toUpperCase(), `${id} ${lang} : « ${s} »`);
        assert.ok(s.split(/\s+/).length <= 20, `${id} ${lang} : phrase trop longue`);
        if (lang === "fr") assert.ok(!FORBIDDEN.test(s), `${id} : mot de code dans « ${s} »`);
      }
    }
  }
});

test("une tâche mène à l'écran qui règle la chose et demande le droit qui permet de la régler", () => {
  for (const id of MODULES) {
    const { manifest } = loaded[id];
    const rights = new Set((manifest.rights ?? []).map((r) => r.id));
    for (const task of manifest.dashboard.tasks ?? []) {
      assert.match(task.href, /^\?tab=use/, `${id} ${task.id} : lien vers l'onglet de l'extension`);
      assert.ok(resolveHref(task.href, { id: "i1", key: "k" })?.startsWith("/admin/instances/i1?tab=use"), task.id);
      if (task.right) assert.ok(rights.has(task.right), `${id} : droit ${task.right} déclaré`);
      assert.match(task.label.fr, /^\{n\} /, "le nombre vient en premier");
      assert.equal(typeof loaded[id].definition.dashboard?.tasks?.[task.id], "function", `${id} : fonction ${task.id}`);
    }
    for (const fn of Object.keys(loaded[id].definition.dashboard?.tasks ?? {})) assert.ok(manifest.dashboard.tasks.some((t) => t.id === fn), `${id} : ${fn} est déclarée`);
  }
  assert.equal(loaded.testimonials.manifest.dashboard.tasks[0].right, "reviews.moderate");
  assert.equal(loaded.events.manifest.dashboard.tasks[0].right, "events.edit");
});

test("Blog et Pages : un bouton « Créer » vers l'écran d'ajout du cœur, sans code ni droit particulier", () => {
  for (const [id, fr, en] of [["blog", "Écrire un article", "Write an article"], ["pages", "Ajouter une page", "Add a page"]]) {
    const { manifest, definition } = loaded[id];
    assert.equal(definition.dashboard, undefined, "une action rapide n'appelle aucun code");
    const [action, ...others] = manifest.dashboard.quickActions;
    assert.equal(others.length, 0); assert.equal(manifest.dashboard.tasks, undefined); assert.equal(manifest.dashboard.cards, undefined);
    assert.deepEqual([action.label.fr, action.label.en, action.right], [fr, en, undefined]);
    assert.equal(resolveHref(action.href, { id: "i1", key: "mon-blog" }), "/admin/entries/new?c=mon-blog");
  }
});

// ── Ce que chaque tâche compte ────────────────────────────────────────────────────────────────────────

const noNetwork = async (fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("le tableau de bord ne doit jamais appeler le réseau"); };
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const timed = async (fn) => { const t0 = Date.now(); const out = await noNetwork(fn); assert.ok(Date.now() - t0 < DASHBOARD_LIMITS.timeoutMs, "plus rapide que le délai du cœur"); return out; };

test("Témoignages : seuls les avis en attente comptent, la pastille du menu a disparu", async () => {
  const def = loaded.testimonials.definition;
  assert.equal(def.adminBadge, undefined);
  const ctx = testimonialsCtx({ locale: "fr" });
  assert.equal(parseTaskCount(await def.dashboard.tasks.pending(ctx)), 0, "rien à faire : la ligne disparaît");
  for (const status of ["pending", "pending", "approved", "rejected"]) await seedReview(ctx, { status });
  assert.equal(await timed(() => def.dashboard.tasks.pending(ctx)), 2);
  assert.equal(await def.dashboard.tasks.pending(testimonialsCtx({ locale: "fr" })), 0, "chaque instance a ses avis");
});

test("Témoignages : trois cents avis se comptent bien avant le délai du cœur", async () => {
  const def = loaded.testimonials.definition;
  const ctx = testimonialsCtx({ locale: "fr" });
  await Promise.all(Array.from({ length: 300 }, (_, i) => seedReview(ctx, { status: i % 3 === 0 ? "pending" : "approved", name: `Personne ${i}` })));
  assert.equal(await timed(() => def.dashboard.tasks.pending(ctx)), 100);
});

test("Suggestions de jeux : seules les propositions des visiteurs encore « proposées » sont à traiter", async () => {
  const { definition: def, manifest } = loaded["game-suggestions"];
  assert.equal(def.adminBadge, undefined);
  const ctx = fakeCtx({ key: "gsdash", basePath: "suggestions", settings: {}, locale: "fr" });
  assert.equal(await def.dashboard.tasks.proposed(ctx), 0);
  const add = (data) => ctx.api.store.add("games", { title: "Jeu", status: "proposed", replayVotes: 0, ...data });
  await add({}); await add({ origin: "visitor" });
  await add({ origin: "admin" });                       // ajouté par la personne elle-même : rien à trier
  await add({ status: "planned" }); await add({ status: "rejected" }); await add({ status: "finished", origin: "visitor" });
  await add({ status: "inconnu" });                     // un statut illisible est lu « proposée », comme dans le tableau
  assert.equal(await timed(() => def.dashboard.tasks.proposed(ctx)), 3);
  assert.equal(manifest.dashboard.tasks[0].id, "proposed");
  assert.equal(manifest.dashboard.tasks[0].right, undefined, "ouvrir la page de l'extension suffit");
});

test("Suggestions de jeux : deux mille lignes restent dans le délai, sans aucune demande de jaquette", async () => {
  const def = loaded["game-suggestions"].definition;
  const ctx = fakeCtx({ key: "gsdash2", basePath: "suggestions", settings: {}, locale: "fr" });
  const many = Array.from({ length: 2000 }, (_, i) => ({ data: { title: `Jeu ${i}`, status: i % 4 === 0 ? "proposed" : "planned", replayVotes: 0 } }));
  await ctx.api.store.addMany("games", many);
  assert.equal(await timed(() => def.dashboard.tasks.proposed(ctx)), 500);
  assert.equal(ctx.calls.rawg?.length ?? 0, 0);
});

test("Événements : seuls les brouillons préparés par l'assistant sont à relire, la pastille du menu a disparu", async () => {
  assert.equal(eventsDef.adminBadge, undefined);
  const ctx = eventsCtx({});
  assert.equal(await eventsDef.dashboard.tasks.review(ctx), 0);
  await addEvent(ctx, { title: "Publié", status: "published" });
  await addEvent(ctx, { title: "Mon brouillon", status: "draft" });             // un brouillon écrit par la personne : rien à relire
  await eventsDef.mcp.agenda_create_event(ctx, { title: "Brouillon préparé", date: "2031-06-01" });
  assert.equal(await timed(() => eventsDef.dashboard.tasks.review(ctx)), 1);
  assert.equal(loaded.events.manifest.dashboard.tasks[0].href, "?tab=use&show=draft", "l'onglet « brouillons » de la liste existe");
});

test("aucune réponse ne contient de donnée personnelle : un nombre, et des libellés fixes", async () => {
  const ctx = testimonialsCtx({ locale: "fr" });
  await seedReview(ctx, { status: "pending", name: "Camille Secrète", email: "camille@example.org" });
  const answer = await loaded.testimonials.definition.dashboard.tasks.pending(ctx);
  assert.equal(typeof answer, "number");
  for (const id of MODULES) assert.ok(!/@|camille/i.test(JSON.stringify(loaded[id].manifest.dashboard)));
});

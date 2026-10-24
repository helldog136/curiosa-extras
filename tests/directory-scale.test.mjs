// Annuaire — le passage à l'échelle : un faux Contacts de 5 000 fiches (double fakeContactBook), lectures par paquets de 500, mémoire bornée, mémoire à expiration courte,
// reconstruction partagée, recherche sans accents rapide, parcours complet par curseur sans doublon ni trou, Contacts lent ou muet. Aucun réseau.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
import { makeWorld, reset, restore, publish, page, htmlOf, P, C, D, Dir, def } from "./helpers/directory-world.mjs";

beforeEach(() => reset({ callMs: 5000, buildMs: 20000 }));
afterEach(() => restore());

const N = 5000;
const FIRST = ["Hélène", "Élodie", "Anaïs", "Zoé", "Léa", "Marc", "Jean", "Rémi", "Sofia", "Noé"];
const LAST = ["Martin", "Dupont", "Lambert", "Rossi", "Müller", "O'Neil", "Garcia", "Janssens", "Peeters", "Lefèvre"];
const CATS = ["Créateurs", "Bénévoles", "Invités", "Partenaires"];

/** 5 000 fiches : 4 catégories qui se recouvrent, quelques organisations, des fiches « à relire » et « à ne pas montrer ». */
function bigBook() {
  const book = fakeContactBook();
  const cats = CATS.map((c) => book.seedCategory(c));
  const hide = book.seedCategory("Ne pas montrer");
  for (let i = 0; i < N; i++) {
    const own = [cats[i % 4]];
    if (i % 7 === 0) own.push(cats[(i + 1) % 4]);
    if (i % 250 === 0) own.push(hide);
    book.seedContact({ name: `${FIRST[i % 10]} ${LAST[Math.trunc(i / 10) % 10]} ${i}`, categoryIds: own, ...(i % 50 === 0 ? { kind: "org" } : {}), ...(i % 400 === 1 ? { status: "to_review" } : {}), accounts: i % 3 === 0 ? [{ network: "twitch", handle: `streamer_${i}` }] : [] });
  }
  return { book, cats, hide };
}

/** Compte les appels à Contacts. */
function spy(book) {
  const log = [];
  const svc = book.services["contact.book"];
  for (const m of ["list", "resolve", "categories", "categoriesResolve"]) { const orig = svc[m]; svc[m] = (a) => { log.push({ m, a }); return orig(a); }; }
  return log;
}
const labels = (cats) => cats.map((id, i) => ({ id, label: CATS[i] }));

test("5 000 personnes : lues par paquets de 500, une seule fois chacune par catégorie, recherche et pages rapides, aucune lecture de plus tant que la mémoire est fraîche", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, labels(cats));
  const log = spy(book);
  let t0 = performance.now();
  const first = htmlOf(await page(ctx));
  const buildMs = performance.now() - t0;
  const lists = log.filter((l) => l.m === "list");
  assert.ok(lists.every((l) => l.a.limit === 500), "toujours par paquets de 500");
  assert.ok(lists.length <= 16, `au plus ~16 lectures pour 4 catégories de ~1 250 fiches, vu ${lists.length}`);
  assert.ok(buildMs < 4000, `première construction rapide (${Math.round(buildMs)} ms)`);
  const view = Dir.getView(ctx, await C.getModel(ctx), await D.readData(ctx));
  assert.ok(view.entries.length > 4900 && view.entries.length < N, `${view.entries.length} personnes visibles`);
  assert.ok(first.includes("personnes"));
  const before = log.length;
  t0 = performance.now();
  for (let i = 0; i < 200; i++) await page(ctx);
  assert.equal(log.length, before, "200 visites : aucune lecture de plus de Contacts");
  assert.ok((performance.now() - t0) / 200 < 25, "page d'accueil < 25 ms en moyenne");
  t0 = performance.now();
  for (const q of ["helene", "ELODIE dupont", "müller", "o'neil 17", "zzzz"]) for (let i = 0; i < 40; i++) await page(ctx, "q", q);
  assert.ok((performance.now() - t0) / 200 < 40, `recherche < 40 ms en moyenne (${Math.round((performance.now() - t0) / 200)} ms)`);
  const hits = htmlOf(await page(ctx, "q", "helene"));
  assert.ok(Number(/(\d+) personnes sur/.exec(hits)[1]) > 100, "Hélène sans accent trouve Hélène");
});

test("parcours complet par curseur de toute la liste : 50 par page, aucun doublon, aucun trou, mêmes résultats dans les trois ordres", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, cats.map((id) => ({ id, label: "" })));
  const view = Dir.getView(ctx, await C.getModel(ctx), await D.readData(ctx));
  for (const sort of ["az", "new", "mix"]) {
    const seen = [];
    let cursor = "", guard = 0;
    do {
      const q = Dir.query(view, { sort, cursor, perPage: 50 });
      assert.ok(q.rows.length <= 50);
      seen.push(...q.rows.map((e) => e.hash));
      cursor = q.next ?? "";
    } while (cursor && ++guard < 500);
    assert.equal(seen.length, view.entries.length, sort);
    assert.equal(new Set(seen).size, view.entries.length, `${sort} : aucun doublon`);
  }
  const p1 = Dir.query(view, { perPage: 50 });
  const p2 = Dir.query(view, { perPage: 50, cursor: p1.next });
  assert.deepEqual(Dir.query(view, { perPage: 50, cursor: p2.prev }).rows.map((e) => e.hash), p1.rows.map((e) => e.hash));
  assert.equal(p2.prev, "", "depuis la deuxième page, « précédent » = la première (sans curseur)");
});

test("filtre par catégories, recherche et tri se combinent sur 5 000 fiches ; l'ordre alphabétique ignore accents et majuscules", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, labels(cats));
  const view = Dir.getView(ctx, await C.getModel(ctx), await D.readData(ctx));
  const all = Dir.query(view, { perPage: 50 }).count;
  const one = Dir.query(view, { cats: ["createurs"], perPage: 50 });
  const two = Dir.query(view, { cats: ["createurs", "benevoles"], perPage: 50 });
  assert.ok(one.count > 800 && one.count < all);
  assert.ok(two.count > one.count && two.count < all, "plusieurs catégories = l'une OU l'autre");
  const combo = Dir.query(view, { cats: ["createurs"], q: "elodie", perPage: 50 });
  assert.ok(combo.count > 0 && combo.count < one.count);
  assert.ok(combo.all.every((e) => e.catSlugs.includes("createurs") && e.fname.includes("elodie")));
  const az = Dir.query(view, { perPage: 50 }).rows.map((e) => e.fname);
  assert.deepEqual(az, [...az].sort(), "ordre alphabétique sans accents");
});

test("mémoire bornée : au-delà de la limite, les premiers sont gardés, l'administration est prévenue ; une catégorie trop grosse est coupée", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, cats.map((id) => ({ id, label: "" })));
  const saved = { ...P.LIMITS };
  try {
    P.LIMITS.indexMax = 700;
    P.LIMITS.perCategory = 500;
    const model = await C.getModel(ctx);
    assert.equal(model.state, "ok");
    assert.ok(model.people.size <= 700, `${model.people.size} en mémoire`);
    assert.equal(model.truncated, true);
    assert.ok(model.problems.some((p) => p.type === "truncated"));
    assert.ok(JSON.stringify(await def.adminPanel(ctx, { query: {} })).includes("seules les premières sont montrées"));
  } finally { Object.assign(P.LIMITS, saved); }
});

test("reconstruction partagée : dix visites en même temps = une seule lecture de Contacts ; mémoire périmée = une nouvelle lecture", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, cats.map((id) => ({ id, label: "" })));
  const log = spy(book);
  await Promise.all(Array.from({ length: 10 }, () => page(ctx)));
  assert.ok(log.filter((l) => l.m === "list").length <= 16, "une seule reconstruction pour dix visites simultanées");
  C.timing.freshMs = 0;
  const again = log.length;
  await page(ctx);
  assert.ok(log.length > again, "la mémoire a expiré : on relit");
});

test("Contacts lent : on garde l'ancienne liste sans faire attendre la visite, et la reconstruction finit seule", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, cats.map((id) => ({ id, label: "" })));
  assert.ok(htmlOf(await page(ctx)).includes("personnes"));
  const svc = book.services["contact.book"];
  const orig = svc.list;
  svc.list = async (a) => { await new Promise((r) => setTimeout(r, 400)); return orig(a); };
  C.timing.freshMs = 0; C.timing.staleWaitMs = 100;
  const t0 = performance.now();
  const html = htmlOf(await page(ctx));
  assert.ok(performance.now() - t0 < 350, "la visite n'attend pas la reconstruction");
  assert.ok(html.includes("personnes"), "la dernière liste connue");
  await new Promise((r) => setTimeout(r, 4500));
  assert.ok(htmlOf(await page(ctx, "q", "helene")).includes("sur"), "après la reconstruction tout marche");
});

test("aucun minuteur de fond, aucune écriture pendant une visite", async () => {
  const { book, cats } = bigBook();
  const { ctx } = makeWorld({ book });
  await publish(ctx, cats.map((id) => ({ id, label: "" })));
  const writes = ctx.calls.writes.length;
  await page(ctx); await page(ctx, "q", "marc"); await page(ctx, "print");
  assert.equal(ctx.calls.writes.length, writes, "lire ne modifie jamais rien");
  assert.equal(typeof def.tasks, "undefined");
});

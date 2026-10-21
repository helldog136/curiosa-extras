// SUITE DE CONTRAT du service « contact.book » version 2 (Contacts 2.0). Contrat expliqué : tests/contract/README.md.
// Elle vérifie chaque méthode, ses bornes et ses codes d'erreur, et les invariants (idempotence par compte, pagination sans doublon ni trou,
// catégories fusionnées / supprimées, règle de la photo, fusion et effacement qui préviennent les « privacy.subject »).
//
// Elle tourne contre N'IMPORTE QUEL fournisseur : le double (tests/contact-book-fake.test.mjs) et le vrai module. Pour le VRAI module Contacts 2.0,
// créez un test (par ex. tests/contacts-v2-contract.test.mjs) :
//
//   import { runContactBookContract } from "./contract/contactBook.contract.mjs";
//   import { fakeCtx } from "./helpers/fakeCtx.mjs";
//   const def = (await import("../modules/contacts/index.mjs")).default;
//   runContactBookContract(async ({ rights, privacySubjects, privacyTimeoutMs, maxContacts }) => {
//     const ctx = fakeCtx({ moduleId: "contacts", key: "contacts", serviceInstances: { "privacy.subject": privacySubjects } });
//     ctx.can = (r) => rights.includes(r);                       // le cœur 0.2.0 ne donne ctx.can qu'au « create » d'un choice (personne connectée)
//     // privacyTimeoutMs / maxContacts : le module doit permettre de les raccourcir en test (option interne, jamais un réglage visible).
//     const svc = def.services["contact.book"];
//     return {
//       methods: Object.fromEntries(Object.keys(svc).map((m) => [m, (args) => svc[m](ctx, args)])),
//       admin: { renameCategory, mergeCategories, deleteCategory, setManualPhoto, removeAccount, deleteContact },  // les gestes d'admin de Contacts, liés à ctx
//       supports: { maxContacts: true },                          // false si le plafond ne peut pas être abaissé en test (le cas est alors sauté)
//     };
//   });
//
// Règles de la suite : elle ne prépare les données QUE par les méthodes du service (upsertByAccount, create, createCategory, setAccountProfile) et par
// les six gestes d'admin ci-dessus ; elle ne suppose jamais la forme d'un identifiant ; aucun nom de personne ou de site réel.
import nodeTest from "node:test";
import assert from "node:assert/strict";

export const NETWORKS = ["twitch", "youtube", "tiktok", "instagram", "discord", "x", "bluesky", "mastodon", "web", "other"];
export const METHODS = ["get", "resolve", "find", "create", "update", "note", "accounts", "search", "list", "categories", "categoriesResolve", "createCategory", "setAccountProfile", "upsertByAccount", "merge", "import", "erase"];
export const READ_ONLY = ["get", "resolve", "find", "accounts", "search", "list", "categories", "categoriesResolve"];
const CREATE = "categories.create";

/** Table de normalisation : [réseau, saisie, pseudo attendu]. Toutes les saisies d'une même ligne désignent le MÊME compte. */
export const SAME_ACCOUNT = [
  ["twitch", ["Streamer_One", "@streamer_one", "https://www.twitch.tv/STREAMER_ONE/", "twitch.tv/streamer_one?ref=x"], "streamer_one"],
  ["youtube", ["@ChannelOne", "https://www.youtube.com/@channelone", "youtube.com/@CHANNELONE/videos"], "@channelone"],
  ["youtube", ["UCabcdefghijklmnopqrstuv", "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"], "UCabcdefghijklmnopqrstuv"],
  ["tiktok", ["@Dancer.one", "https://www.tiktok.com/@dancer.one"], "dancer.one"],
  ["instagram", ["Photo.One", "@photo.one", "https://instagram.com/photo.one/"], "photo.one"],
  ["x", ["@Poster_1", "https://twitter.com/poster_1", "x.com/POSTER_1"], "poster_1"],
  ["bluesky", ["sky", "@sky.bsky.social", "https://bsky.app/profile/Sky.bsky.social"], "sky.bsky.social"],
  ["mastodon", ["@Toot@Social.Example", "toot@social.example", "https://social.example/@toot"], "toot@social.example"],
  ["discord", ["@Gamer.One", "gamer.one"], "gamer.one"],
  ["web", ["https://www.Example.test/about/", "example.test/about", "http://example.test/about"], "example.test/about"],
  ["other", ["Some Forum  User", "some forum user"], null],
];
export const BAD_HANDLES = [["twitch", "a b"], ["twitch", "abc"], ["twitch", "https://twitch.tv/directory"], ["youtube", "https://www.youtube.com/watch?v=x"], ["x", "this_is_way_too_long_for_x"], ["mastodon", "nobody"], ["web", "not a url"], ["instagram", ""]];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const sorted = (a) => [...a].sort();

/**
 * makeProvider(opts) → { methods, admin, supports? } (ou une promesse). Appelé une fois PAR TEST, avec un carnet vide.
 *   opts.rights            droits de la personne pour qui les appels sont faits ([] = appel de service ordinaire)
 *   opts.privacySubjects   fournisseurs « privacy.subject » : [{ instance, name, methods: { export, erase, remap } }]
 *   opts.privacyTimeoutMs  attente maximale par fournisseur (la suite passe 150 ms)
 *   opts.maxContacts       plafond du carnet abaissé pour le test du plafond (si supports.maxContacts)
 * `test` : le `test` de node:test (par défaut) ; `prefix` : préfixe des noms de test.
 */
export function runContactBookContract(makeProvider, { test = nodeTest, prefix = "contact.book v2" } = {}) {
  const make = async (o = {}) => {
    const p = await makeProvider({ rights: [], privacySubjects: [], privacyTimeoutMs: 150, ...o });
    const call = async (m, args) => {
      const fn = p.methods[m];
      assert.equal(typeof fn, "function", `méthode ${m} absente`);
      const r = await fn(args);
      assert.ok(isObj(r) && typeof r.ok === "boolean", `${m} : { ok: boolean, … } attendu, reçu ${JSON.stringify(r)}`);
      return r;
    };
    const ok = async (m, args) => { const r = await call(m, args); assert.equal(r.ok, true, `${m}(${JSON.stringify(args)}) → ${JSON.stringify(r)}`); return r; };
    const fails = async (m, args, error) => { const r = await call(m, args); assert.deepEqual([r.ok, r.error], [false, error], `${m}(${JSON.stringify(args)}) → ${JSON.stringify(r)}`); return r; };
    const admin = Object.fromEntries(Object.entries(p.admin ?? {}).map(([k, fn]) => [k, async (...a) => fn(...a)]));
    return { p, call, ok, fails, admin };
  };
  /** Un carnet avec le droit de créer des catégories, et une catégorie créée. */
  const withCategory = async (label = "Team", o = {}) => {
    const t = await make({ rights: [CREATE], ...o });
    const c = await t.ok("createCategory", { label });
    return { ...t, cat: c.id };
  };
  /** Tout parcourir avec le curseur ; vérifie la borne de chaque page. */
  const walk = async (t, method, args, limit) => {
    const out = [];
    let cursor, pages = 0;
    do {
      const r = await t.ok(method, { ...args, limit, ...(cursor ? { cursor } : {}) });
      assert.ok(Array.isArray(r.items) && r.items.length <= limit, `${method} : au plus ${limit} éléments`);
      assert.ok(r.next === null || (typeof r.next === "string" && r.next.length > 0 && r.next.length <= 500), `${method} : next = texte ≤ 500 ou null`);
      out.push(...r.items);
      cursor = r.next;
      assert.ok(++pages < 10_000, "pagination sans fin");
    } while (cursor);
    return { items: out, pages };
  };

  test(`${prefix} : toutes les méthodes existent, aucune ne lève, toutes répondent { ok, … } même avec des arguments absurdes`, async () => {
    const t = await make();
    for (const m of METHODS) assert.equal(typeof t.p.methods[m], "function", m);
    for (const m of READ_ONLY) assert.match(m, /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/, `${m} : un nom déclarable dans « readOnly » et comme source d'un « choice »`);
    for (const m of METHODS) for (const junk of [undefined, null, "x", 42, [], { ids: "nope" }, { id: { $ne: 1 } }]) {
      const r = await t.call(m, junk);
      if (r.ok === false) assert.equal(typeof r.error, "string", `${m}(${JSON.stringify(junk)}) : code d'erreur`);
    }
  });

  test(`${prefix} : upsertByAccount crée une fiche par compte, et le MÊME compte (toute forme d'écriture) rend la MÊME fiche`, async () => {
    const t = await make();
    for (const [network, inputs, handle] of SAME_ACCOUNT) {
      const first = await t.ok("upsertByAccount", { network, handle: inputs[0], source: "test-suite" });
      assert.equal(first.created, true, `${network} ${inputs[0]}`);
      assert.equal(typeof first.id, "string");
      for (const input of inputs.slice(1)) {
        const again = await t.ok("upsertByAccount", { network, handle: input, source: "test-suite" });
        assert.deepEqual([again.created, again.id], [false, first.id], `${network} « ${input} » = « ${inputs[0]} »`);
      }
      const card = (await t.ok("get", { id: first.id })).contact;
      assert.equal(card.accounts.length, 1);
      assert.equal(card.accounts[0].network, network);
      if (handle) assert.equal(card.accounts[0].handle, handle, `${network} : pseudo normalisé`);
      assert.equal(card.name.length > 0, true, "nom par défaut : le pseudo");
    }
    // Un même pseudo sur deux réseaux = deux comptes, deux fiches (rien n'est deviné).
    const a = await t.ok("upsertByAccount", { network: "twitch", handle: "same_name", source: "test-suite" });
    const b = await t.ok("upsertByAccount", { network: "instagram", handle: "same_name", source: "test-suite" });
    assert.notEqual(a.id, b.id);
  });

  test(`${prefix} : upsertByAccount — validations exactes, rien n'est écrit en cas d'erreur`, async () => {
    const t = await make();
    await t.fails("upsertByAccount", { network: "myspace", handle: "x", source: "test-suite" }, "invalid_network");
    for (const [network, handle] of BAD_HANDLES) await t.fails("upsertByAccount", { network, handle, source: "test-suite" }, "invalid_handle");
    await t.fails("upsertByAccount", { network: "twitch", handle: "valid_one" }, "invalid");                         // source obligatoire
    await t.fails("upsertByAccount", { network: "twitch", handle: "valid_one", source: "Not A Module" }, "invalid");
    await t.fails("upsertByAccount", { network: "twitch", handle: "valid_one", source: "test-suite", categoryId: "unknown-category" }, "not_found");
    assert.deepEqual((await t.ok("list", {})).items, [], "aucune fiche créée");
  });

  test(`${prefix} : upsertByAccount — nom donné à la création seulement, catégorie ajoutée, note ajoutée une seule fois (migration rejouée)`, async () => {
    const t = await withCategory("Raid targets");
    const r = await t.ok("upsertByAccount", { network: "twitch", handle: "night_owl", name: "Night Owl", source: "test-suite", note: "Raids on Fridays." });
    const again = await t.ok("upsertByAccount", { network: "twitch", handle: "NIGHT_OWL", name: "Other Name", categoryId: t.cat, source: "test-suite", note: "Raids on Fridays." });
    assert.deepEqual([again.created, again.id], [false, r.id]);
    const card = (await t.ok("get", { id: r.id })).contact;
    assert.equal(card.name, "Night Owl", "le nom d'une fiche existante n'est jamais écrasé");
    assert.deepEqual(card.categoryIds, [t.cat]);
    assert.equal(card.notes.filter((n) => n.text === "Raids on Fridays.").length, 1, "même note, même source : pas de doublon");
    assert.equal(card.kind, "person");
    assert.equal(card.status, "active");
  });

  test(`${prefix} : get / resolve — forme v2 (kind, orgId, orgName, categoryIds, accounts sans e-mail ni téléphone), alias « organisation », compatibilité v1`, async () => {
    const t = await make();
    const p = await t.ok("create", { name: "Ada Example", email: "ADA@example.test", phone: "+00 000", role: "Producer", organisation: "Acme Studio" });
    assert.equal(p.created, true);
    const card = (await t.ok("get", { id: p.id })).contact;
    for (const k of ["id", "kind", "name", "role", "organisation", "orgId", "orgName", "email", "phone", "status", "source", "createdAt", "categoryIds", "accounts", "notes", "others", "relation"]) assert.ok(k in card, `get.contact.${k}`);
    assert.deepEqual([card.kind, card.email, card.organisation, card.orgName], ["person", "ada@example.test", "Acme Studio", "Acme Studio"]);
    const org = (await t.ok("get", { id: card.orgId })).contact;
    assert.deepEqual([org.kind, org.name], ["org", "Acme Studio"], "le texte « organisation » trouve ou crée la fiche organisation");
    const p2 = await t.ok("create", { name: "Bob Example", organisation: "  acme   STUDIO " });
    assert.equal((await t.ok("get", { id: p2.id })).contact.orgId, card.orgId, "même organisation (casse, espaces) = même fiche");
    // Comptes : jamais d'e-mail ni de téléphone dedans.
    await t.ok("upsertByAccount", { network: "twitch", handle: "ada_live", source: "test-suite" });
    const r = await t.ok("resolve", { ids: [p.id, "missing-id", p.id] });
    assert.deepEqual(r.contacts.map((c) => c.id), [p.id]);
    assert.deepEqual(r.missing, ["missing-id"]);
    for (const c of r.contacts) for (const a of c.accounts) { assert.ok(!("email" in a) && !("phone" in a)); }
    await t.fails("resolve", { ids: Array.from({ length: 101 }, (_, i) => `id${i}`) }, "invalid");
    await t.fails("get", { id: "missing-id" }, "not_found");
  });

  test(`${prefix} : v1 conservée — find, create (dédoublonnage), update (email_taken), note`, async () => {
    const t = await make();
    const a = await t.ok("create", { name: "Hélène Martin", organisation: "Acme" });
    assert.equal((await t.ok("create", { name: "helene  MARTIN", organisation: "ACME" })).id, a.id);
    const b = await t.ok("create", { name: "Carl", email: "carl@example.test" });
    assert.deepEqual([(await t.ok("create", { name: "Other", email: "CARL@example.test" })).matchedBy], ["email"]);
    await t.fails("create", { name: "" }, "name_required");
    await t.fails("create", { name: "X", email: "nope" }, "invalid_email");
    const f = await t.ok("find", { q: "helene" });
    assert.deepEqual(f.contacts.map((c) => c.id), [a.id], "recherche v1 sans accents");
    await t.fails("update", { id: a.id, email: "carl@example.test" }, "email_taken");
    await t.fails("update", { id: a.id }, "nothing_to_update");
    await t.ok("update", { id: a.id, role: "Agent" });
    await t.ok("note", { id: b.id, text: "Met at the fair.", author: "test-suite" });
    await t.fails("note", { id: b.id, text: "   " }, "text_required");
    assert.equal((await t.ok("get", { id: b.id })).contact.notes[0].text, "Met at the fair.");
  });

  test(`${prefix} : accounts — par réseau, filtres ids / catégorie, pagination complète sans doublon ni trou (1 001 comptes, pages de 500)`, async () => {
    const t = await withCategory("Friends");
    const ids = [];
    for (let i = 0; i < 1001; i++) {
      const r = await t.ok("upsertByAccount", { network: "twitch", handle: `chan_${String(i).padStart(4, "0")}`, source: "test-suite", ...(i % 3 === 0 ? { categoryId: t.cat } : {}) });
      ids.push(r.id);
    }
    await t.ok("upsertByAccount", { network: "youtube", handle: "@not_twitch", source: "test-suite" });
    const all = await walk(t, "accounts", { network: "twitch" }, 500);
    assert.equal(all.pages, 3);
    assert.equal(all.items.length, 1001);
    assert.equal(new Set(all.items.map((x) => x.id)).size, 1001, "aucun doublon");
    assert.deepEqual(sorted(all.items.map((x) => x.id)), sorted(ids), "aucun trou");
    for (const x of all.items) { assert.equal(typeof x.name, "string"); assert.match(x.handle, /^chan_\d{4}$/); }
    const big = await t.ok("accounts", { network: "twitch", limit: 100000 });
    assert.equal(big.items.length, 500, "limit ramenée à 500");
    const inCat = await walk(t, "accounts", { network: "twitch", categoryId: t.cat }, 200);
    assert.equal(inCat.items.length, 334);
    const some = await t.ok("accounts", { network: "twitch", ids: [ids[5], ids[7], "missing-id"] });
    assert.deepEqual(sorted(some.items.map((x) => x.id)), sorted([ids[5], ids[7]]));
    await t.fails("accounts", { network: "twitch", ids: Array.from({ length: 501 }, (_, i) => `id${i}`) }, "invalid");
    await t.fails("accounts", { network: "myspace" }, "invalid_network");
    await t.fails("accounts", {}, "invalid_network");
    await t.fails("accounts", { network: "twitch", categoryId: "unknown-category" }, "not_found");
    assert.deepEqual(await t.ok("accounts", { network: "twitch", cursor: "%%%garbage%%%" }).then((r) => [r.items, r.next]), [[], null], "curseur illisible : page vide, jamais d'exception");
  });

  test(`${prefix} : accounts / list — une fiche créée PENDANT le parcours n'entraîne ni doublon ni trou dans ce qui existait`, async () => {
    const t = await make();
    for (let i = 0; i < 25; i++) await t.ok("upsertByAccount", { network: "twitch", handle: `early_${String(i).padStart(2, "0")}`, source: "test-suite" });
    const first = await t.ok("accounts", { network: "twitch", limit: 10 });
    await t.ok("upsertByAccount", { network: "twitch", handle: "late_comer", source: "test-suite" });
    const rest = await walk(t, "accounts", { network: "twitch", cursor: first.next }, 10);
    const handles = [...first.items, ...rest.items].map((x) => x.handle);
    assert.equal(new Set(handles).size, handles.length);
    for (let i = 0; i < 25; i++) assert.ok(handles.includes(`early_${String(i).padStart(2, "0")}`));
    const l1 = await t.ok("list", { limit: 7 });
    const lr = await walk(t, "list", { cursor: l1.next }, 7);
    assert.equal(new Set([...l1.items, ...lr.items].map((c) => c.id)).size, 26);
  });

  test(`${prefix} : list — pagination (≤ 500), filtres catégorie et kind, forme de « resolve »`, async () => {
    const t = await withCategory("Press");
    for (let i = 0; i < 12; i++) await t.ok("upsertByAccount", { network: "x", handle: `writer_${i}`, source: "test-suite", ...(i < 4 ? { categoryId: t.cat } : {}) });
    await t.ok("create", { name: "Org Example", kind: "org" });
    const all = await walk(t, "list", {}, 5);
    assert.equal(all.items.length, 13);
    for (const c of all.items) for (const k of ["id", "kind", "name", "categoryIds", "accounts"]) assert.ok(k in c, k);
    assert.equal((await walk(t, "list", { categoryId: t.cat }, 500)).items.length, 4);
    assert.deepEqual((await walk(t, "list", { kind: "org" }, 500)).items.map((c) => c.name), ["Org Example"]);
    assert.equal((await t.ok("list", { limit: 9999 })).items.length, 13);
    await t.fails("list", { kind: "robot" }, "invalid");
    await t.fails("list", { categoryId: "unknown-category" }, "not_found");
  });

  test(`${prefix} : search — sans accents ni casse, par pseudo (avec ou sans @), filtres réseau / kind, ≤ 30 résultats, le plus exact d'abord`, async () => {
    const t = await make();
    const helene = await t.ok("upsertByAccount", { network: "twitch", handle: "lena_plays", name: "Hélène Dupré", source: "test-suite" });
    await t.ok("upsertByAccount", { network: "bluesky", handle: "lena.example.test", name: "Another Lena", source: "test-suite" });
    const org = await t.ok("create", { name: "Écurie Example", kind: "org" });
    let r = await t.ok("search", { q: "helene dupre" });
    assert.deepEqual(r.items.map((x) => x.id), [helene.id]);
    for (const k of ["id", "name", "kind", "accounts"]) assert.ok(k in r.items[0], k);
    r = await t.ok("search", { q: "@LENA_PLAYS" });
    assert.equal(r.items[0].id, helene.id, "pseudo exact en premier");
    r = await t.ok("search", { q: "lena", network: "bluesky" });
    assert.deepEqual(r.items.map((x) => x.name), ["Another Lena"]);
    assert.ok(r.items[0].accounts.every((a) => a.network === "bluesky"), "avec network, seuls les comptes de ce réseau");
    assert.deepEqual((await t.ok("search", { q: "ecurie", kind: "org" })).items.map((x) => x.id), [org.id]);
    assert.deepEqual((await t.ok("search", { q: "" })).items, []);
    assert.ok(Array.isArray((await t.ok("search", { q: "l".repeat(5000) })).items), "texte trop long : coupé à 100, pas d'erreur");
    for (let i = 0; i < 40; i++) await t.ok("upsertByAccount", { network: "tiktok", handle: `many_${i}`, source: "test-suite" });
    assert.equal((await t.ok("search", { q: "many", limit: 999 })).items.length, 30);
    await t.fails("search", { q: "x", network: "myspace" }, "invalid_network");
  });

  test(`${prefix} : createCategory — droit « ${CREATE} » exigé, doublon (casse, accents) rend l'existant, étiquette 1 à 100 caractères`, async () => {
    const denied = await make({ rights: [] });
    await denied.fails("createCategory", { label: "Partners" }, "denied");
    assert.deepEqual((await denied.ok("categories", {})).items, [], "refus : rien n'est créé");
    const t = await make({ rights: [CREATE] });
    const c = await t.ok("createCategory", { label: "  Cible   de raid " });
    assert.equal(c.label, "Cible de raid");
    assert.equal(typeof c.id, "string");
    const dup = await t.fails("createCategory", { label: "CIBLE DE RAÏD" }, "duplicate");
    assert.equal(dup.id, c.id, "duplicate donne l'id de l'existant (le cœur le sélectionne)");
    await t.fails("createCategory", { label: "" }, "invalid");
    await t.fails("createCategory", { label: "x".repeat(101) }, "invalid");
    await t.fails("createCategory", {}, "invalid");
  });

  test(`${prefix} : categories — forme « list » d'un choice (id, label) + name, color, icon ; recherche q ; pagination`, async () => {
    const t = await make({ rights: [CREATE] });
    for (const l of ["Zeta", "alpha", "Émeraude", "Beta"]) await t.ok("createCategory", { label: l });
    const r = await t.ok("categories", {});
    assert.deepEqual(r.items.map((x) => x.label), ["alpha", "Beta", "Émeraude", "Zeta"], "ordre alphabétique sans accents ni casse");
    for (const x of r.items) { assert.equal(x.label, x.name); assert.match(x.color, /^#[0-9a-f]{6}$/); assert.ok(x.icon === null || typeof x.icon === "string"); }
    assert.equal(r.next, null);
    assert.deepEqual((await t.ok("categories", { q: "emer" })).items.map((x) => x.label), ["Émeraude"]);
    const pages = await walk(t, "categories", {}, 3);
    assert.equal(pages.items.length, 4);
  });

  test(`${prefix} : categoriesResolve — actuelle (renommée : même id), fusionnée → moved (chaîne repliée), supprimée → missing ; ≤ 50 ids`, async () => {
    const t = await make({ rights: [CREATE] });
    let a, b, c, d;
    const made = [];
    for (const label of ["A", "B", "C", "D"]) made.push((await t.ok("createCategory", { label })).id);
    [a, b, c, d] = made;
    await t.admin.renameCategory(a, "A renamed");
    await t.admin.mergeCategories(c, b);   // b → c
    await t.admin.mergeCategories(d, c);   // c → d, donc b → d
    const x = await t.ok("upsertByAccount", { network: "twitch", handle: "tagged_one", source: "test-suite", categoryId: b });
    assert.deepEqual((await t.ok("get", { id: x.id })).contact.categoryIds, [d], "un id fusionné est suivi à l'écriture");
    const del = (await t.ok("createCategory", { label: "Gone" })).id;
    await t.ok("upsertByAccount", { network: "twitch", handle: "tagged_two", source: "test-suite", categoryId: del });
    await t.admin.deleteCategory(del);
    const r = await t.ok("categoriesResolve", { ids: [a, b, c, del, "unknown-category"] });
    assert.deepEqual(r.items.map((i) => [i.id, i.label]), [[a, "A renamed"]]);
    assert.deepEqual(r.moved, { [b]: d, [c]: d });
    assert.deepEqual(sorted(r.missing), sorted([del, "unknown-category"]));
    const two = (await t.ok("list", {})).items.find((i) => i.accounts[0]?.handle === "tagged_two");
    assert.deepEqual(two.categoryIds, [], "supprimer une catégorie la retire des fiches, ne supprime aucune fiche");
    assert.equal((await walk(t, "accounts", { network: "twitch", categoryId: b }, 50)).items.length, 1, "filtre par un id fusionné : suivi");
    await t.fails("accounts", { network: "twitch", categoryId: del }, "not_found");
    await t.fails("categoriesResolve", { ids: Array.from({ length: 51 }, (_, i) => `k${i}`) }, "invalid");
    await t.fails("categoriesResolve", {}, "invalid");
  });

  test(`${prefix} : setAccountProfile — cache daté (displayName, avatar https, abonnés) ; plus ancien ignoré ; validations`, async () => {
    const t = await make();
    const r = await t.ok("upsertByAccount", { network: "twitch", handle: "cached_one", source: "test-suite" });
    const at = new Date(Date.now() - 60_000).toISOString();
    await t.ok("setAccountProfile", { id: r.id, accountId: r.accountId, displayName: "Cached One", avatar: "https://cdn.example.test/a.png", followers: 1200, source: "test-suite", at });
    let acc = (await t.ok("get", { id: r.id })).contact.accounts[0];
    assert.deepEqual([acc.displayName, acc.avatar, acc.followers], ["Cached One", "https://cdn.example.test/a.png", 1200]);
    const older = await t.ok("setAccountProfile", { id: r.id, accountId: r.accountId, followers: 5, source: "test-suite", at: new Date(Date.now() - 3_600_000).toISOString() });
    assert.equal(older.stale, true);
    acc = (await t.ok("get", { id: r.id })).contact.accounts[0];
    assert.equal(acc.followers, 1200, "une donnée plus ancienne ne remplace pas la plus récente");
    const item = (await t.ok("accounts", { network: "twitch" })).items[0];
    assert.deepEqual([item.displayName, item.avatar], ["Cached One", "https://cdn.example.test/a.png"]);
    const other = await t.ok("upsertByAccount", { network: "twitch", handle: "other_one", source: "test-suite" });
    const now = new Date().toISOString();
    await t.fails("setAccountProfile", { id: r.id, accountId: other.accountId, source: "test-suite", at: now }, "not_found");
    await t.fails("setAccountProfile", { id: r.id, accountId: r.accountId, avatar: "http://cdn.example.test/a.png", source: "test-suite", at: now }, "invalid");
    await t.fails("setAccountProfile", { id: r.id, accountId: r.accountId, followers: -1, source: "test-suite", at: now }, "invalid");
    await t.fails("setAccountProfile", { id: r.id, accountId: r.accountId, source: "test-suite" }, "invalid");
    await t.fails("setAccountProfile", { id: r.id, accountId: r.accountId, source: "test-suite", at: new Date(Date.now() + 3_600_000).toISOString() }, "invalid");
    await t.fails("setAccountProfile", { id: r.id, accountId: r.accountId, at: now }, "invalid");
  });

  test(`${prefix} : photo — manuelle > compte à la plus grosse communauté > Twitch > YouTube > Bluesky`, async () => {
    const t = await make();
    const at = new Date(Date.now() - 1000).toISOString();
    const add = async (network, handle) => (await t.ok("upsertByAccount", { network, handle, source: "test-suite" }));
    const base = await add("bluesky", "photo.example.test");
    await t.ok("merge", { keep: base.id, drop: (await add("youtube", "@photo_yt")).id });
    const tw = await add("twitch", "photo_tw");
    await t.ok("merge", { keep: base.id, drop: tw.id });
    const accs = (await t.ok("get", { id: base.id })).contact.accounts;
    const accOf = (n) => accs.find((a) => a.network === n).id;
    const photo = async () => (await t.ok("get", { id: base.id })).contact.photo;
    assert.equal(await photo(), null, "aucune image connue : pas de photo");
    for (const n of ["bluesky", "youtube", "twitch"]) await t.ok("setAccountProfile", { id: base.id, accountId: accOf(n), avatar: `https://cdn.example.test/${n}.png`, source: "test-suite", at });
    assert.equal((await photo()).url, "https://cdn.example.test/twitch.png", "sans abonnés connus : Twitch d'abord");
    await t.ok("setAccountProfile", { id: base.id, accountId: accOf("bluesky"), followers: 900, source: "test-suite", at: new Date().toISOString() });
    await t.ok("setAccountProfile", { id: base.id, accountId: accOf("youtube"), followers: 50, source: "test-suite", at: new Date().toISOString() });
    const p = await photo();
    assert.deepEqual([p.url, p.source, p.accountId], ["https://cdn.example.test/bluesky.png", "bluesky", accOf("bluesky")], "la plus grosse communauté connue l'emporte");
    await t.admin.setManualPhoto(base.id, "https://cdn.example.test/manual.png");
    assert.deepEqual(await photo(), { url: "https://cdn.example.test/manual.png", source: "manual" });
    const r = await t.ok("resolve", { ids: [base.id] });
    assert.equal(r.contacts[0].photo.url, "https://cdn.example.test/manual.png", "resolve donne la même photo que get");
  });

  test(`${prefix} : merge — tout passe sur la fiche gardée, l'ancien id est « moved », les privacy.subject sont prévenus (muet = listé, borné)`, async () => {
    const seen = [];
    const good = { instance: "good-module", name: "Good", methods: { remap: async (a) => { seen.push(a); return { updated: 2 }; }, erase: async () => ({ removed: 0 }), export: async () => ({ label: "Good", data: {} }) } };
    const mute = { instance: "mute-module", name: "Mute", methods: { remap: () => new Promise(() => {}), erase: () => new Promise(() => {}), export: () => new Promise(() => {}) } };
    const t = await withCategory("Crew", { privacySubjects: [good, mute] });
    const keep = await t.ok("upsertByAccount", { network: "twitch", handle: "keeper_one", source: "test-suite", note: "Keep note." });
    const drop = await t.ok("upsertByAccount", { network: "youtube", handle: "@keeper_one", source: "test-suite", categoryId: t.cat, note: "Drop note." });
    await t.ok("update", { id: drop.id, email: "keeper@example.test" });
    const started = Date.now();
    const r = await t.ok("merge", { keep: keep.id, drop: drop.id });
    assert.ok(Date.now() - started < 2000, "un fournisseur muet ne bloque pas la fusion (borne par fournisseur)");
    assert.deepEqual(sorted(r.remapped.map((x) => `${x.module}:${x.ok}`)), ["good-module:true", "mute-module:false"]);
    assert.deepEqual(seen, [{ from: drop.id, to: keep.id }]);
    const card = (await t.ok("get", { id: keep.id })).contact;
    assert.deepEqual(sorted(card.accounts.map((a) => a.network)), ["twitch", "youtube"]);
    assert.deepEqual(card.categoryIds, [t.cat]);
    assert.equal(card.email, "keeper@example.test", "un champ vide de la fiche gardée est complété");
    assert.deepEqual(sorted(card.notes.map((n) => n.text)), ["Drop note.", "Keep note."]);
    const g = await t.fails("get", { id: drop.id }, "not_found");
    assert.equal(g.movedTo, keep.id);
    const res = await t.ok("resolve", { ids: [drop.id] });
    assert.deepEqual([res.contacts, res.missing, res.moved], [[], [], { [drop.id]: keep.id }]);
    assert.equal((await t.ok("upsertByAccount", { network: "youtube", handle: "@keeper_one", source: "test-suite" })).id, keep.id, "le compte repris pointe vers la fiche gardée");
    await t.fails("merge", { keep: keep.id, drop: keep.id }, "invalid");
    await t.fails("merge", { keep: keep.id, drop: "missing-id" }, "not_found");
    const org = await t.ok("create", { name: "Some Org", kind: "org" });
    await t.fails("merge", { keep: keep.id, drop: org.id }, "invalid");
  });

  test(`${prefix} : erase — confirmation exigée, chaque privacy.subject efface (muet = listé), la fiche disparaît, les catégories restent`, async () => {
    const asked = [];
    const sub = { instance: "ref-module", name: "Refs", methods: { erase: async (a) => { asked.push(a); return { removed: 3 }; }, remap: async () => ({ updated: 0 }), export: async () => ({ label: "Refs", data: {} }) } };
    const mute = { instance: "mute-module", name: "Mute", methods: { erase: () => new Promise(() => {}) } };
    const t = await withCategory("Kept", { privacySubjects: [sub, mute] });
    const x = await t.ok("upsertByAccount", { network: "twitch", handle: "to_forget", source: "test-suite", categoryId: t.cat });
    await t.fails("erase", { id: x.id }, "confirm_required");
    assert.equal(asked.length, 0, "sans confirmation, personne n'est appelé");
    const r = await t.ok("erase", { id: x.id, confirm: true });
    assert.deepEqual(asked, [{ contactId: x.id }]);
    assert.deepEqual(sorted(r.modules.map((m) => `${m.module}:${m.ok}`)), ["mute-module:false", "ref-module:true"]);
    await t.fails("get", { id: x.id }, "not_found");
    assert.equal((await t.ok("upsertByAccount", { network: "twitch", handle: "to_forget", source: "test-suite" })).created, true, "le compte est libéré");
    assert.equal((await t.ok("categories", {})).items.length, 1);
    await t.fails("erase", { id: "missing-id", confirm: true }, "not_found");
  });

  test(`${prefix} : import — ≤ 1 000 lignes ; ajoutées / déjà là / refusées avec leur numéro de ligne`, async () => {
    const t = await make();
    await t.ok("upsertByAccount", { network: "twitch", handle: "already_here", source: "test-suite" });
    const r = await t.ok("import", { rows: [
      { name: "New Person", email: "new@example.test", accounts: [{ network: "x", handle: "@new_person" }] },
      { name: "Dup", accounts: [{ network: "twitch", handle: "ALREADY_HERE" }] },
      { name: "Bad", accounts: [{ network: "twitch", handle: "a b" }] },
      { email: "nameless@example.test" },
      "not a row",
    ] });
    assert.deepEqual([r.added, r.existing], [1, 1]);
    assert.deepEqual(r.invalid, [{ line: 3, reason: "invalid_handle" }, { line: 4, reason: "name_required" }, { line: 5, reason: "invalid" }]);
    assert.equal((await t.ok("search", { q: "new_person", network: "x" })).items.length, 1);
    await t.fails("import", { rows: Array.from({ length: 1001 }, () => ({ name: "x" })) }, "invalid");
  });

  test(`${prefix} : plafond du carnet — too_many, rien n'est écrit`, async (ctx) => {
    const probe = await makeProvider({ rights: [], privacySubjects: [], privacyTimeoutMs: 150, maxContacts: 3 });
    if (probe.supports && probe.supports.maxContacts === false) { ctx.skip("le fournisseur ne permet pas d'abaisser le plafond en test"); return; }
    const t = await make({ maxContacts: 3 });
    for (let i = 0; i < 3; i++) await t.ok("upsertByAccount", { network: "twitch", handle: `cap_${i}_xx`, source: "test-suite" });
    await t.fails("upsertByAccount", { network: "twitch", handle: "cap_over", source: "test-suite" }, "too_many");
    await t.fails("create", { name: "Over" }, "too_many");
    assert.equal((await t.ok("upsertByAccount", { network: "twitch", handle: "cap_0_xx", source: "test-suite" })).created, false, "un compte connu reste trouvé");
    assert.equal((await t.ok("list", {})).items.length, 3);
  });
}

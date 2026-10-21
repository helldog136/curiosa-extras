// SUITE DE CONTRAT de l'extension « contact.curate » v1 de Contacts (texte : tests/contract-ext/README.md). Elle tourne contre N'IMPORTE QUEL fournisseur.
//   runContactCurateContract(makeProvider, { prefix })
// makeProvider() → { book: { …méthodes de contact.book (pour préparer les données, avec le droit de créer une catégorie) }, curate: { …méthodes de contact.curate }, admin: { mergeCategories(keep, drop), deleteCategory(id) } }
// La suite ne prépare les données que par `book` (upsertByAccount, create, createCategory, setAccountProfile) et les gestes d'admin ci-dessus.
import nodeTest from "node:test";
import assert from "node:assert/strict";

export const CURATE_METHODS = ["lookupAccounts", "searchAccounts", "addAccount", "removeCategory"];
export const CURATE_READ_ONLY = ["lookupAccounts", "searchAccounts"];
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

export function runContactCurateContract(makeProvider, { test = nodeTest, prefix = "contact.curate v1" } = {}) {
  const t = (name, fn) => test(`${prefix} : ${name}`, async () => fn(await makeProvider()));
  const cat = async (p, label) => (await p.book.createCategory({ label })).id;
  const person = async (p, name, extra = {}) => { const r = await p.book.create({ name, ...extra }); assert.equal(r.ok, true); return r.id; };
  const tw = async (p, handle, extra = {}) => { const r = await p.book.upsertByAccount({ network: "twitch", handle, source: "contract", ...extra }); assert.equal(r.ok, true); return r; };
  const everyoneAnswers = (p) => { for (const m of CURATE_METHODS) assert.equal(typeof p.curate[m], "function", m); };

  t("les quatre méthodes existent et répondent { ok } sans lever, même pour des arguments absurdes", async (p) => {
    everyoneAnswers(p);
    for (const m of CURATE_METHODS) for (const bad of [undefined, null, 5, "x", [], {}, { handles: "x" }, { id: {} }]) {
      const r = await p.curate[m](bad);
      assert.ok(isObj(r) && typeof r.ok === "boolean", `${m}(${JSON.stringify(bad)})`);
      if (!r.ok) assert.equal(typeof r.error, "string");
    }
  });

  t("lookupAccounts : connus, inconnus et invalides, dans l'ordre reçu ; toutes les écritures d'un pseudo désignent le même compte", async (p) => {
    const a = await tw(p, "streamer_one"); const b = await tw(p, "streamer_two");
    const r = await p.curate.lookupAccounts({ network: "twitch", handles: ["https://www.twitch.tv/STREAMER_ONE/", "@nobody_here", "ab", "Streamer_Two", 42] });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 5);
    assert.deepEqual(r.items.map((x) => x.input), ["https://www.twitch.tv/STREAMER_ONE/", "@nobody_here", "ab", "Streamer_Two", ""]);
    assert.equal(r.items[0].id, a.id); assert.equal(r.items[0].accountId, a.accountId); assert.equal(r.items[0].handle, "streamer_one");
    assert.equal(r.items[1].id, null); assert.equal(r.items[1].handle, "nobody_here"); assert.equal(r.items[1].error, undefined);
    assert.equal(r.items[2].error, "invalid_handle");
    assert.equal(r.items[3].id, b.id);
    assert.equal(r.items[4].error, "invalid_handle");
    assert.ok(r.items.every((x) => !("inCategory" in x)), "inCategory seulement avec categoryId");
  });

  t("lookupAccounts : inCategory, hasProfile, catégorie fusionnée suivie, inconnue → not_found, plafond de 200", async (p) => {
    const c1 = await cat(p, "Liste A"), c2 = await cat(p, "Liste B");
    const a = await tw(p, "in_the_list", { categoryId: c1 }); await tw(p, "not_in_list");
    assert.equal((await p.book.setAccountProfile({ id: a.id, accountId: a.accountId, displayName: "Alpha", source: "contract", at: new Date().toISOString() })).ok, true);
    let r = await p.curate.lookupAccounts({ network: "twitch", categoryId: c1, handles: ["in_the_list", "not_in_list", "never_seen"] });
    assert.deepEqual(r.items.map((x) => x.inCategory), [true, false, undefined]);
    assert.deepEqual(r.items.map((x) => x.hasProfile), [true, false, undefined]);
    assert.equal((await p.admin.mergeCategories(c2, c1)).ok, true);
    r = await p.curate.lookupAccounts({ network: "twitch", categoryId: c1, handles: ["in_the_list"] });
    assert.equal(r.ok, true); assert.equal(r.items[0].inCategory, true, "l'ancien identifiant est suivi");
    assert.deepEqual(await p.curate.lookupAccounts({ network: "twitch", categoryId: "no-such-category", handles: ["x_x_x_x"] }), { ok: false, error: "not_found" });
    assert.equal((await p.curate.lookupAccounts({ network: "twitch", handles: Array.from({ length: 200 }, (_, i) => `name_${String(i).padStart(4, "0")}`) })).items.length, 200);
    assert.deepEqual(await p.curate.lookupAccounts({ network: "twitch", handles: Array.from({ length: 201 }, (_, i) => `name_${i}`) }), { ok: false, error: "invalid" });
    assert.deepEqual(await p.curate.lookupAccounts({ network: "nope", handles: [] }), { ok: false, error: "invalid_network" });
  });

  t("addAccount : le compte rejoint la fiche existante, sans doublon, rejouable ; un compte pris refuse avec l'autre fiche", async (p) => {
    const id = await person(p, "Alice Martin");
    const before = (await p.book.list({ limit: 500 })).items.length;
    const r = await p.curate.addAccount({ id, network: "twitch", handle: "https://twitch.tv/Alice_TV" });
    assert.equal(r.ok, true); assert.equal(r.existed, false); assert.equal(typeof r.accountId, "string");
    assert.equal((await p.book.list({ limit: 500 })).items.length, before, "aucune fiche de plus");
    const card = (await p.book.get({ id })).contact;
    assert.deepEqual(card.accounts.filter((x) => x.network === "twitch").map((x) => x.handle), ["alice_tv"]);
    assert.equal(card.name, "Alice Martin", "le nom n'est jamais touché");
    assert.deepEqual(await p.curate.addAccount({ id, network: "twitch", handle: "alice_tv" }), { ok: true, accountId: r.accountId, existed: true });
    // upsertByAccount retrouve CETTE fiche
    assert.equal((await tw(p, "alice_tv")).id, id);
    const other = await person(p, "Bob");
    const taken = await p.curate.addAccount({ id: other, network: "twitch", handle: "alice_tv" });
    assert.deepEqual(taken, { ok: false, error: "taken", id });
    assert.equal((await p.curate.addAccount({ id: other, network: "twitch", handle: "a b" })).error, "invalid_handle");
    assert.equal((await p.curate.addAccount({ id: other, network: "nope", handle: "bobby" })).error, "invalid_network");
    assert.equal((await p.curate.addAccount({ id: "no-such", network: "twitch", handle: "bobby" })).error, "not_found");
    assert.equal((await p.curate.addAccount({ network: "twitch", handle: "bobby" })).error, "invalid");
  });

  t("removeCategory : retire seulement cette catégorie ; la fiche et ses comptes restent ; rejouable ; fusionnée suivie", async (p) => {
    const c1 = await cat(p, "Cible A"), c2 = await cat(p, "Cible B"), c3 = await cat(p, "Cible C");
    const a = await tw(p, "member_one", { categoryId: c1 });
    await tw(p, "member_one", { categoryId: c2 });
    assert.deepEqual((await p.book.get({ id: a.id })).contact.categoryIds.sort(), [c1, c2].sort());
    assert.deepEqual(await p.curate.removeCategory({ id: a.id, categoryId: c1 }), { ok: true, removed: true });
    const card = (await p.book.get({ id: a.id })).contact;
    assert.deepEqual(card.categoryIds, [c2]);
    assert.equal(card.accounts.length, 1);
    assert.deepEqual(await p.curate.removeCategory({ id: a.id, categoryId: c1 }), { ok: true, removed: false });
    assert.deepEqual(await p.curate.removeCategory({ id: a.id, categoryId: c3 }), { ok: true, removed: false }, "jamais dedans");
    assert.equal((await p.admin.mergeCategories(c3, c2)).ok, true);
    assert.deepEqual(await p.curate.removeCategory({ id: a.id, categoryId: c2 }), { ok: true, removed: true }, "l'ancien identifiant est suivi");
    assert.deepEqual((await p.book.get({ id: a.id })).contact.categoryIds, []);
    assert.equal((await p.book.get({ id: a.id })).ok, true, "la fiche existe toujours");
    assert.deepEqual(await p.curate.removeCategory({ id: a.id, categoryId: "no-such" }), { ok: false, error: "not_found" });
    assert.deepEqual(await p.curate.removeCategory({ id: "no-such", categoryId: c1 }), { ok: false, error: "not_found" });
    assert.deepEqual(await p.curate.removeCategory({ id: a.id }), { ok: false, error: "invalid" });
  });

  t("searchAccounts : nom, pseudo ou nom affiché ; réseau et catégorie filtrés ; le plus exact d'abord ; pages sans doublon ni trou", async (p) => {
    const c1 = await cat(p, "Dedans");
    await tw(p, "anna_live", { name: "Anna", categoryId: c1 });
    await tw(p, "annabelle_tv", { name: "Annabelle", categoryId: c1 });
    await tw(p, "joanna_xx", { name: "Joanna" });
    await p.book.upsertByAccount({ network: "youtube", handle: "@anna_yt", name: "Anna Y", source: "contract" });
    const all = await p.curate.searchAccounts({ network: "twitch", q: "anna" });
    assert.equal(all.ok, true);
    assert.deepEqual(all.items.map((x) => x.handle), ["anna_live", "annabelle_tv", "joanna_xx"], "exact, début de mot, contenu");
    assert.ok(all.items.every((x) => typeof x.id === "string" && typeof x.accountId === "string" && typeof x.name === "string"));
    assert.deepEqual((await p.curate.searchAccounts({ network: "twitch", q: "ANNA", categoryId: c1 })).items.map((x) => x.handle), ["anna_live", "annabelle_tv"]);
    assert.deepEqual((await p.curate.searchAccounts({ network: "youtube", q: "anna" })).items.map((x) => x.handle), ["@anna_yt"]);
    assert.deepEqual((await p.curate.searchAccounts({ network: "twitch", q: "@anna_live" })).items.map((x) => x.handle), ["anna_live"]);
    assert.deepEqual(await p.curate.searchAccounts({ network: "twitch", q: "" }), { ok: true, items: [], next: null });
    // pages
    for (let i = 0; i < 7; i++) await tw(p, `paged_${String(i).padStart(3, "0")}`, { name: `Paged ${i}` });
    const seen = []; let cursor = null, pages = 0;
    do { const r = await p.curate.searchAccounts({ network: "twitch", q: "paged", limit: 3, cursor }); assert.ok(r.items.length <= 3); seen.push(...r.items.map((x) => x.handle)); cursor = r.next; pages++; } while (cursor && pages < 10);
    assert.equal(pages, 3); assert.equal(new Set(seen).size, 7); assert.equal(seen.length, 7);
    assert.deepEqual(await p.curate.searchAccounts({ network: "twitch", q: "paged", cursor: "garbage!" }), { ok: true, items: [], next: null });
    assert.equal((await p.curate.searchAccounts({ network: "twitch", q: "paged", limit: 9999 })).items.length, 7, "limit ramenée à 50");
    assert.deepEqual(await p.curate.searchAccounts({ network: "twitch", q: "x", categoryId: "no-such" }), { ok: false, error: "not_found" });
    assert.deepEqual(await p.curate.searchAccounts({ network: "nope", q: "x" }), { ok: false, error: "invalid_network" });
  });
}

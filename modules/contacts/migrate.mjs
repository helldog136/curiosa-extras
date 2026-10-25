// Contacts — migration des données 1 → 2 (Contacts 1.1.1 → 2.0.0). À RETIRER EN PHASE 3 (avec `minFrom` 0.2.0 côté cœur).
//
//   1. Le texte « organisation » d'une personne devient une FICHE organisation (une par nom : majuscules, accents et espaces ignorés) et la
//      personne garde son lien (`orgId`). Le texte disparaît de la fiche (le nom vit dans la fiche organisation).
//   2. Les fiches gardent LEURS identifiants (les liens de Partenariats restent valables) ; elles reçoivent `kind: "person"`, des listes vides de
//      comptes et de catégories, et la clé « e:<e-mail> » (recherche exacte par e-mail).
//   3. Les notes (collection `notes`, champ `contactId`) reçoivent la clé = id de la fiche (`listByKey`). Mise à jour EN PLACE : chaque note
//      garde son id (clé d'idempotence = l'id de l'ancienne note), aucune copie, donc rien à supprimer ni de doublon possible.
//   4. « Autres canaux » (`others`) est gardé tel quel ; l'admin le montre en lecture avec « Ajouter comme compte ».
//
// Rejouable : une deuxième passe ne crée rien (organisations retrouvées par leur nom, fiches déjà converties sautées, notes déjà rangées).
// Vérification avant de finir : même nombre de personnes, même nombre de notes, toutes rangées ; sinon la migration lève une erreur et le cœur
// remet l'instance exactement dans son état d'avant (« Réessayer »). Lecture par pages de 1 000 : jamais tout le carnet en mémoire.
// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { fold, clean } = await import(`./networks.mjs${v}`);
const { forgetIndex, touchStamp, emailKey, validEmail, ORG_NAME_MAX, idOk, storeHasKeys } = await import(`./data.mjs${v}`);

const isV1Person = (d) => d && typeof d.name === "string" && (d.kind === undefined || "organisation" in d);
async function* pages(store, collection) {
  let cursor = null;
  do {
    const p = await store.page(collection, { limit: 1000, order: "asc", cursor });
    yield p.items ?? [];
    cursor = p.next ?? null;
  } while (cursor);
}

export async function migrateTo2(ctx, { log = () => {} } = {}) {
  const store = ctx.api.store;
  forgetIndex(ctx);
  // Passe A : ce qui existe (organisations déjà créées par une passe précédente) et ce qu'il faut créer.
  const orgs = new Map(); // nom replié → id
  const wanted = new Map(); // nom replié → nom tel qu'écrit la première fois
  let persons = 0, notesBefore = 0;
  for await (const items of pages(store, "orgs")) for (const r of items) if (typeof r.data?.name === "string") { const k = fold(r.data.name); if (!orgs.has(k)) orgs.set(k, r.id); }
  for await (const items of pages(store, "contacts")) {
    for (const r of items) {
      const d = r.data;
      if (!d || typeof d.name !== "string") continue;
      persons++;
      const text = clean(d.organisation, ORG_NAME_MAX);
      if (isV1Person(d) && text && !wanted.has(fold(text))) wanted.set(fold(text), text);
    }
  }
  for await (const items of pages(store, "notes")) notesBefore += items.length;
  // Organisations manquantes : par paquets (une transaction par paquet de 5 000).
  const missing = [...wanted].filter(([k]) => !orgs.has(k));
  for (let i = 0; i < missing.length; i += 5000) {
    const chunk = missing.slice(i, i + 5000);
    const rows = chunk.map(([, name]) => ({ data: { kind: "org", name, status: "active", source: "migration", role: "", email: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null } }));
    const ids = typeof store.addMany === "function" ? await store.addMany("orgs", rows) : await (async () => { const out = []; for (const r of rows) out.push(await store.add("orgs", r.data)); return out; })();
    chunk.forEach(([k], j) => orgs.set(k, ids[j]));
  }
  // Passe B : les personnes de la 1.x prennent la forme 2.0 (mêmes ids).
  let converted = 0;
  for await (const items of pages(store, "contacts")) {
    for (const r of items) {
      const d = r.data;
      if (!isV1Person(d)) continue;
      const { organisation, ...rest } = d;
      const text = clean(organisation, ORG_NAME_MAX);
      const email = typeof rest.email === "string" && validEmail(rest.email.toLowerCase()) ? rest.email.toLowerCase() : "";
      const data = {
        ...rest, kind: "person", email, orgId: text ? orgs.get(fold(text)) ?? null : idOk(rest.orgId) ? rest.orgId : null,
        categoryIds: Array.isArray(rest.categoryIds) ? rest.categoryIds : [], accounts: Array.isArray(rest.accounts) ? rest.accounts : [], photo: rest.photo ?? null,
        role: rest.role ?? "", phone: rest.phone ?? "", others: rest.others ?? "", relation: rest.relation ?? "",
      };
      await store.update(r.id, data, { key: emailKey(email) });
      converted++;
    }
  }
  // Passe C : chaque note rangée sous l'id de sa fiche (sur place). Un stockage sans clés (faux contexte ancien) lit `contactId` directement.
  const hasKeys = storeHasKeys(ctx);
  let keyed = 0, notesAfter = 0;
  for await (const items of pages(store, "notes")) {
    for (const n of items) {
      notesAfter++;
      const cid = n.data?.contactId;
      if (!idOk(cid)) continue;
      if (hasKeys && n.key !== cid) { await store.update(n.id, n.data, { key: cid }); keyed++; }
    }
  }
  // Vérification des comptes avant de déclarer la migration réussie.
  let personsAfter = 0, v1Left = 0, notesUnkeyed = 0;
  for await (const items of pages(store, "contacts")) for (const r of items) { if (typeof r.data?.name === "string") personsAfter++; if (isV1Person(r.data)) v1Left++; }
  for await (const items of pages(store, "notes")) for (const n of items) if (hasKeys && idOk(n.data?.contactId) && n.key !== n.data.contactId) notesUnkeyed++;
  if (personsAfter !== persons || v1Left || notesAfter !== notesBefore || notesUnkeyed) {
    throw new Error(`contacts migration check failed: persons ${persons}→${personsAfter}, left ${v1Left}, notes ${notesBefore}→${notesAfter}, unkeyed ${notesUnkeyed}`);
  }
  await touchStamp(ctx);
  const report = { persons, converted, orgsCreated: missing.length, notes: notesAfter, notesKeyed: keyed };
  log(report);
  return report;
}

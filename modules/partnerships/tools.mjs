// Partenariats — les outils MCP : fiches, journal, et liens vers des contacts (jamais d'écriture dans le carnet : c'est le rôle de Contacts).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, CLOSED, DAY, fail, clip, today, validDate, safeUrl, cleanPartner, parseCsv, importPartners, all, lastActivity, followUpDue, fmt } = await import(`./data.mjs${v}`);
const { CONTACTS, MAX_LINKS, ID_MAX, esc, idOk, linksOf, person, book, bookAvailable, resolveLinks, setLinks } = await import(`./contacts-link.mjs${v}`);
// MIGRATION TEMPORAIRE — à supprimer en 1.5.0 : seul `unmergedFor` (merge.mjs) vient de la fusion.
const { mergeState, unmergedFor } = await import(`./merge.mjs${v}`);

export default {
  // ── Actions MCP (déclarées dans module.json) ────────────────────────────────────
  // Les PERSONNES sont dans le module Contacts : ici on ne fait que rattacher / détacher (partner_link_contact, partner_unlink_contact).
  // `partner_delete` est IMPLÉMENTÉE mais déclarée `default: false` : un jeton ne l'a que si un administrateur la lui accorde dans l'admin
  // (API & MCP → Accès du jeton). Elle ne supprime jamais une personne du carnet.
  mcp: {
    async partners_list(ctx, a) {
      const [partners, journal] = await Promise.all([all(ctx, "partners"), all(ctx, "journal")]);
      const q = String(a.q ?? "").toLowerCase();
      return partners
        .filter((p) => (!a.status || p.data.status === a.status) && (!q || JSON.stringify({ ...p.data, contactIds: undefined }).toLowerCase().includes(q)))
        .map((p) => ({ id: p.id, brand: p.data.brand, status: p.data.status, chances: p.data.chances ?? null, lastActivity: fmt(lastActivity(p, journal)), followUpDue: followUpDue(ctx, p, journal) }));
    },
    async partner_get(ctx, a) {
      const p = await ctx.api.store.get(a.id);
      if (!p || p.data.brand === undefined) throw fail("partnership not found");
      const journal = await all(ctx, "journal");
      const ids = linksOf(p);
      const links = await resolveLinks(ctx, ids);
      const { contactIds: _ignored, ...fields } = p.data;
      const out = { id: p.id, ...fields, journal: journal.filter((j) => j.data.partnerId === p.id).map((j) => ({ id: j.id, ...j.data })), contactIds: ids };
      if (!links.available) {
        out.contactsAvailable = false;
        out.contacts = ids.map((id) => ({ id, name: null, role: null, email: null, unavailable: true }));
      } else {
        out.contactsAvailable = true;
        out.contacts = [...links.cards.map(person), ...links.missing.map((id) => ({ id, name: null, role: null, email: null, missing: true }))];
      }
      Object.assign(out, unmergedFor(await mergeState(ctx), p.id)); // MIGRATION TEMPORAIRE — à supprimer en 1.5.0
      return out;
    },
    async partner_create(ctx, a, actor) {
      if (!String(a.brand ?? "").trim()) throw fail("brand is required");
      const id = await ctx.api.store.add("partners", { ...cleanPartner({ ...a, status: a.status ?? "a_contacter" }), updatedBy: `agent:${actor.name}` });
      return { id };
    },
    async partner_update(ctx, a, actor) {
      const { id, ...fields } = a;
      const row = await ctx.api.store.get(id);
      if (!row) throw fail("partnership not found");
      if (fields.brand !== undefined && !String(fields.brand).trim()) throw fail("brand cannot be empty");
      await ctx.api.store.update(id, { ...cleanPartner(fields, row.data), updatedBy: `agent:${actor.name}` });
      return { id, updated: Object.keys(fields) };
    },
    async partner_log(ctx, a, actor) {
      if (!(await ctx.api.store.get(a.id))) throw fail("partnership not found");
      if (!String(a.text ?? "").trim()) throw fail("text is required");
      const entry = await ctx.api.store.add("journal", { partnerId: a.id, date: validDate(a.date), author: `agent:${actor.name}`, text: clip(a.text, 5000), link: safeUrl(a.link) });
      return { id: entry };
    },
    // Rattacher une personne DÉJÀ dans le carnet Contacts à une fiche (idempotent). Pour une nouvelle personne : la créer dans Contacts d'abord.
    async partner_link_contact(ctx, a) {
      const p = idOk(a.id) ? await ctx.api.store.get(a.id) : null;
      if (!p || p.data.brand === undefined) throw fail("partnership not found");
      if (!idOk(a.contact_id)) throw fail("contact_id is required");
      const got = await book(ctx, "resolve", { ids: [a.contact_id] });
      if (got.unavailable) throw fail("the Contacts module is not available (enable it to link people)");
      if (!got.ok || !got.contacts.length) throw fail("contact not found in the Contacts module (create it there first)");
      const ids = linksOf(p);
      const already = ids.includes(a.contact_id);
      if (!already) {
        if (ids.length >= MAX_LINKS) throw fail("too many linked contacts on this partnership");
        await setLinks(ctx, p, [...ids, a.contact_id], "agent");
      }
      return { id: p.id, linked: !already, contact: person(got.contacts[0]), contactIds: already ? ids : [...ids, a.contact_id] };
    },
    // Détacher : la fiche n'y fait plus référence ; la personne reste dans le carnet Contacts (jamais supprimée ici).
    async partner_unlink_contact(ctx, a) {
      const p = idOk(a.id) ? await ctx.api.store.get(a.id) : null;
      if (!p || p.data.brand === undefined) throw fail("partnership not found");
      const ids = linksOf(p);
      if (!ids.includes(a.contact_id)) return { id: p.id, unlinked: false, contactIds: ids };
      const next = ids.filter((id) => id !== a.contact_id);
      await setLinks(ctx, p, next, "agent");
      return { id: p.id, unlinked: true, contactIds: next };
    },
    async partner_delete(ctx, a) {
      if (!(await ctx.api.store.get(a.id))) throw fail("partnership not found");
      for (const collection of ["journal", "contacts"]) for (const r of await all(ctx, collection)) if (r.data.partnerId === a.id) await ctx.api.store.remove(r.id);
      await ctx.api.store.remove(a.id);
      return { deleted: a.id };
    },
  },
};

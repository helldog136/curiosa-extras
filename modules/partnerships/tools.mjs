// Partnerships: the MCP tools: files, journal, and links to contacts (never a write in the address book: that is the role of Contacts).
const v = new URL(import.meta.url).search; // the module version propagates to the neighbouring files (otherwise the old code would stay cached after an update)
const { STATUSES, CLOSED, DAY, fail, clip, today, validDate, safeUrl, cleanPartner, parseCsv, importPartners, all, lastActivity, followUpDue, fmt, deletePartnerRecord } = await import(`./data.mjs${v}`);
const { CONTACTS, MAX_LINKS, ID_MAX, esc, idOk, linksOf, person, book, bookAvailable, resolveLinks, healLinks, setLinks } = await import(`./contacts-link.mjs${v}`);

export default {
  // ── MCP actions (declared in module.json) ────────────────────────────────────
  // PEOPLE live in the Contacts module: here we only attach / detach (partner_link_contact, partner_unlink_contact).
  // `partner_delete` is declared `default: false` and destructive: a token has it only if an administrator grants it in the admin
  // (API & MCP → token access). It never deletes a person of the address book.
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
      let ids = linksOf(p);
      const links = await resolveLinks(ctx, ids);
      if (Object.keys(links.moved).length) { await healLinks(ctx, p, links.moved); ids = linksOf(p); }
      const { contactIds: _ignored, ...fields } = p.data;
      const out = { id: p.id, ...fields, journal: journal.filter((j) => j.data.partnerId === p.id).map((j) => ({ id: j.id, ...j.data })), contactIds: ids };
      if (!links.available) {
        out.contactsAvailable = false;
        out.contacts = ids.map((id) => ({ id, name: null, role: null, email: null, unavailable: true }));
      } else {
        out.contactsAvailable = true;
        out.contacts = [...links.cards.map(person), ...links.missing.map((id) => ({ id, name: null, role: null, email: null, missing: true }))];
      }
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
    // Attach a person ALREADY in the Contacts address book to a file (idempotent). For a new person: create them in Contacts first.
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
    // Detach: the file no longer refers to them; the person stays in the Contacts address book (never deleted here).
    async partner_unlink_contact(ctx, a) {
      const p = idOk(a.id) ? await ctx.api.store.get(a.id) : null;
      if (!p || p.data.brand === undefined) throw fail("partnership not found");
      const ids = linksOf(p);
      if (!ids.includes(a.contact_id)) return { id: p.id, unlinked: false, contactIds: ids };
      const next = ids.filter((id) => id !== a.contact_id);
      await setLinks(ctx, p, next, "agent");
      return { id: p.id, unlinked: true, contactIds: next };
    },
    // Permanent, and off by default. Same function as the admin window: the file and its journal go; people in Contacts are never touched.
    async partner_delete(ctx, a) {
      const r = await deletePartnerRecord(ctx, a.id);
      if (!r) throw fail("partnership not found");
      return { deleted: a.id, journalEntries: r.journal, contactLinks: r.contacts };
    },
  },
};

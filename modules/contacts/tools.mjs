// Contacts — les outils MCP pour les assistants.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, SOURCES, FIELDS, MAX_CONTACTS, ID_MAX, fail, clean, validEmail, contacts, notesOf, cleanContact, addNote, key, sameEmail, sameNameOrg, isCard, idOf, card, summary } = await import(`./book.mjs${v}`);

export default {
  mcp: {
    async contacts_list(ctx, args) {
      const q = clean(args?.search, 100).toLowerCase();
      return (await contacts(ctx))
        .filter((c) => (!args?.status || c.data.status === args.status) && (!q || [c.data.name, c.data.organisation, c.data.email].some((x) => String(x ?? "").toLowerCase().includes(q))))
        .slice(0, Math.min(100, Math.max(1, Math.trunc(Number(args?.limit)) || 30))).map(summary);
    },
    async contact_get(ctx, args) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row || row.data.name === undefined) throw fail("contact not found");
      return { ...summary(row), others: row.data.others || null, relation: row.data.relation || null, notes: (await notesOf(ctx, row.id)).map((n) => ({ id: n.id, date: n.data.date, author: n.data.author, text: n.data.text })) };
    },
    async contact_create(ctx, args) {
      if (!clean(args?.name, 120)) throw fail("name required");
      const id = await ctx.api.store.add("contacts", { ...cleanContact(args), status: "active", source: "agent" });
      return { id };
    },
    async contact_update(ctx, args, actor) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row) throw fail("contact not found");
      await ctx.api.store.update(row.id, { ...cleanContact(args, row.data), updatedBy: actor?.name });
      return { id: row.id };
    },
    async contact_note(ctx, args, actor) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row || !clean(args?.text, 5000)) throw fail("contact not found or empty note");
      await addNote(ctx, row.id, args.text, actor?.name || "agent");
      return { id: row.id };
    },
    async contact_delete(ctx, args) {
      const row = typeof args?.id === "string" ? await ctx.api.store.get(args.id) : null;
      if (!row) throw fail("contact not found");
      for (const n of await notesOf(ctx, row.id)) await ctx.api.store.remove(n.id);
      await ctx.api.store.remove(row.id);
      return { id: row.id, deleted: true };
    },
  },
};

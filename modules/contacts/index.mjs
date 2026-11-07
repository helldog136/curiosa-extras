// Contacts: community module of Curiosa, THE private address book of the site (people AND organisations, accounts on the networks, categories, notes, photo),
// provider of the services "contact.store" (contact form) and "contact.book" v2 (the other modules).
//
// ONE OWNER: a person exists once, here. The other modules (Raid, Story...) only keep card identifiers and read name, handle and photo through
// the service; they offer "privacy.subject" so that a merge or an erasure warns them.
//
// Files: networks.mjs (networks, normalisation, photo), data.mjs (storage + bounded in-memory index), book.mjs (rules), subjects.mjs (calls to
// "privacy.subject"), service.mjs (services), admin.mjs + ui.mjs (administration), tools.mjs (MCP). No conversion code any more (see docs/MIGRATIONS.md).
// Batch K2: csv.mjs + import.mjs + import-admin.mjs (CSV import with a preview, in batches), export.mjs + downloads.mjs (full streamed export), dedupe.mjs +
// dedupe-admin.mjs (duplicates and merge), privacy.mjs + privacy-admin.mjs (export and erasure of one person), photos.mjs (refresh the photo, only
// when a person opens the card or clicks), nav.mjs + messages.mjs (sections and error sentences).
const v = new URL(import.meta.url).search; // the module version is passed on to the neighbouring files (otherwise the old code would stay cached after an update)
const { default: service } = await import(`./service.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { getIndex, readMany, card } = await import(`./book.mjs${v}`);
const { default: downloads } = await import(`./downloads.mjs${v}`);

const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

export default {
  ...service, // services
  ...admin, // dashboard, adminPanel, adminActions
  ...tools, // mcp
  adminDownloads: downloads, // « contacts » (tout le carnet), « template », « importReport », « person » : servis par le cœur, droit « exporter le carnet »
  migrations: {
    // Empty marker. The 1.x → 2.0 conversion (organisations as cards, notes keyed by card) was removed in 2.5.0: `dataFloor` is 2, so data still in
    // version 1 is set aside instead of being marked up to date; the bridge is the tag v1.50.0 (Contacts 2.4.1). See docs/MIGRATIONS.md. The kit rule
    // `data.version` wants one entry per `dataVersion` above 1; this one never runs on data that is already in version 2.
    2: async () => {},
  },
  backup: {
    // Sauvegarde lisible : contacts.csv (fiches) et notes.csv (notes, avec l'id de leur fiche). Lu par pages ; 100 000 fiches au plus.
    async readable(ctx) {
      const idx = await getIndex(ctx, { waitMs: 60_000 });
      const lines = [["id", "added", "kind", "status", "source", "name", "role", "organisation", "email", "phone", "accounts", "categories", "others", "relation"].map(cell).join(",")];
      const catName = (id) => idx.cats.get(id)?.name ?? "";
      for (let i = 0; i < idx.list.length; i += 500) {
        const ids = idx.list.slice(i, i + 500).map((e) => e.id);
        const recs = await readMany(ctx, ids);
        for (const id of ids) {
          const r = recs.get(id);
          if (!r) continue;
          const c = card(ctx, idx, r);
          lines.push([c.id, c.createdAt, c.kind, c.status, c.source, c.name, c.role, c.orgName, c.email, c.phone, c.accounts.map((a) => `${a.network}:${a.handle}`).join(" "), c.categoryIds.map(catName).join(" | "), r.data.others, r.data.relation].map(cell).join(","));
        }
      }
      const notes = [["contact", "date", "author", "text"].map(cell).join(",")];
      let cursor = null, pages = 0;
      do {
        const p = await ctx.api.store.page("notes", { limit: 1000, order: "asc", cursor });
        for (const n of p.items ?? []) notes.push([n.data?.contactId, n.data?.date, n.data?.author, n.data?.text].map(cell).join(","));
        cursor = p.next ?? null;
      } while (cursor && ++pages < 1000);
      const BOM = "\uFEFF";
      return [{ path: "contacts.csv", content: `${BOM}${lines.join("\r\n")}\r\n` }, { path: "notes.csv", content: `${BOM}${notes.join("\r\n")}\r\n` }];
    },
  },
};

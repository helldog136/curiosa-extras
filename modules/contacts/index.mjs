// Contacts — module communautaire de Curiosa : LE carnet d'adresses privé du site (personnes ET organisations, comptes sur les réseaux,
// catégories, notes, photo), fournisseur des services « contact.store » (formulaire de contact) et « contact.book » v2 (les autres modules).
//
// UN SEUL PROPRIÉTAIRE : une personne n'existe qu'une fois, ici. Les autres modules (Partenariats, Raid, Story…) ne gardent que des identifiants
// de fiche et lisent nom, pseudo et photo par le service ; ils offrent « privacy.subject » pour qu'une fusion ou un effacement les prévienne.
//
// Fichiers : networks.mjs (réseaux, normalisation, photo), data.mjs (stockage + index mémoire borné), book.mjs (règles), subjects.mjs (appel des
// « privacy.subject »), service.mjs (services), admin.mjs + ui.mjs (administration), tools.mjs (MCP), migrate.mjs (données 1 → 2).
// Lot K2 : csv.mjs + import.mjs + import-admin.mjs (import CSV avec aperçu, par lots), export.mjs + downloads.mjs (export complet en flux), dedupe.mjs +
// dedupe-admin.mjs (doublons et fusion), privacy.mjs + privacy-admin.mjs (export et effacement d'une personne), photos.mjs (rafraîchir la photo, seulement
// quand une personne ouvre la fiche ou clique), nav.mjs + messages.mjs (sections et phrases d'erreur).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { default: service } = await import(`./service.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { migrateTo2 } = await import(`./migrate.mjs${v}`);
const { getIndex, readMany, card } = await import(`./book.mjs${v}`);
const { default: downloads } = await import(`./downloads.mjs${v}`);

const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

export default {
  ...service, // services
  ...admin, // adminBadge, adminPanel, adminActions
  ...tools, // mcp
  adminDownloads: downloads, // « contacts » (tout le carnet), « template », « importReport », « person » : servis par le cœur, droit « exporter le carnet »
  migrations: {
    // 1.x → 2.0 : organisations en fiches, notes rangées par fiche (clé), identifiants conservés. À retirer en phase 3.
    2: async (ctx) => { await migrateTo2(ctx); },
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

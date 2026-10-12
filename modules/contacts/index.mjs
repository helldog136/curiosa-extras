// Contacts — module communautaire de Curiosa : un carnet d'adresses privé, et le fournisseur du service « contact.store ».
//
// Le formulaire de contact du site (ou tout autre module qui `requires` ce service) y range ce qu'il reçoit : un contact « à vérifier » dont la
// note est le message. Un assistant (MCP) peut ensuite se renseigner sur la personne, compléter la fiche et la passer « active », ou la supprimer
// si c'est du spam. Aucune page publique.
//
// UN SEUL CARNET : une personne n'existe qu'une fois, ici. Les autres modules (Partenariats…) ne gardent que des références (identifiants) et
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { contacts } = await import(`./book.mjs${v}`);
const { default: service } = await import(`./service.mjs${v}`);
const { default: admin } = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);

export default {
  ...service, // services
  ...admin, // adminBadge, adminPanel, adminActions
  ...tools, // mcp
  backup: {
    async readable(ctx) {
      const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
      const list = await contacts(ctx), notes = await ctx.api.store.list("notes", { limit: 1000 });
      const rows = list.map((c) => [c.id, c.createdAt.toISOString(), c.data.status, c.data.source, c.data.name, c.data.role, c.data.organisation, c.data.email, c.data.phone, c.data.others, c.data.relation, notes.filter((n) => n.data.contactId === c.id).map((n) => `${n.data.date} ${n.data.text}`).join("\n---\n")].map(cell).join(","));
      return [{ path: "contacts.csv", content: `\uFEFF${[["id", "added", "status", "source", "name", "role", "organisation", "email", "phone", "others", "relation", "notes"].map(cell).join(","), ...rows].join("\r\n")}\r\n` }];
    },
  },
};

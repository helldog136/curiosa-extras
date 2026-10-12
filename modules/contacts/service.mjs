// Contacts — les services offerts aux autres modules (« contact.store » pour le formulaire, « contact.book » pour lire/écrire le carnet).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, SOURCES, FIELDS, MAX_CONTACTS, ID_MAX, fail, clean, validEmail, contacts, notesOf, cleanContact, addNote, key, sameEmail, sameNameOrg, isCard, idOf, card, summary } = await import(`./book.mjs${v}`);

export default {
  services: {
    "contact.store": {
      async add(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const name = clean(a.name, FIELDS.name), email = clean(a.email, FIELDS.email).toLowerCase();
        if (!name) throw fail("name required");
        const source = SOURCES.includes(a.source) ? a.source : "manual";
        const known = email && validEmail(email) ? (await contacts(ctx)).find((c) => c.data.email === email) : null;
        let id = known?.id, created = false;
        if (!known) {
          if ((await ctx.api.store.count("contacts")) >= MAX_CONTACTS) throw fail("too many contacts");
          id = await ctx.api.store.add("contacts", { ...cleanContact({ name, email, organisation: a.organisation, phone: a.phone }), status: "to_review", source });
          created = true;
        }
        if (a.message) await addNote(ctx, id, `${ctx.t("formNote")}\n\n${clean(a.message, 5000, true)}`, source);
        return { id, created };
      },
    },

    // SERVICE « contact.book » : le carnet pour les autres modules (lecture ET écriture). Chaque méthode valide ses entrées, ne lève pas d'erreur
    // (le cœur ne transmettrait que « failed ») et répond { ok: true, … } ou { ok: false, error: "<code>" }. Codes : invalid, not_found,
    // name_required, invalid_email, email_taken, text_required, nothing_to_update, too_many.
    "contact.book": {
      // Une fiche complète (notes comprises, les 50 dernières) : { ok, contact }.
      async get(ctx, args) {
        const row = idOf(args?.id) ? await ctx.api.store.get(args.id) : null;
        if (!isCard(row)) return { ok: false, error: "not_found" };
        const notes = (await notesOf(ctx, row.id)).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date))).slice(0, 50);
        return { ok: true, contact: { ...card(ctx, row), others: row.data.others || null, relation: row.data.relation || null, notes: notes.map((n) => ({ date: n.data.date, author: n.data.author, text: n.data.text })) } };
      },
      // Plusieurs fiches d'un coup, en résumé (100 identifiants au plus) : { ok, contacts, missing }. Sert à afficher des références.
      async resolve(ctx, args) {
        if (!Array.isArray(args?.ids) || args.ids.length > 100) return { ok: false, error: "invalid" };
        const ids = [...new Set(args.ids.map(idOf).filter(Boolean))];
        const rows = await Promise.all(ids.map((id) => ctx.api.store.get(id)));
        return { ok: true, contacts: rows.filter(isCard).map((r) => card(ctx, r)), missing: ids.filter((id, i) => !isCard(rows[i])) };
      },
      // Recherche (tous les critères donnés se cumulent) : email exact (casse ignorée), name / organisation exacts (casse, accents et espaces ignorés), q = morceau de nom, d'organisation ou d'e-mail.
      async find(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const email = clean(a.email, FIELDS.email).toLowerCase();
        if (email && !validEmail(email)) return { ok: false, error: "invalid_email" };
        const q = key(a.q), name = key(a.name), org = key(a.organisation);
        const limit = Math.min(100, Math.max(1, Math.trunc(Number(a.limit)) || 20));
        const found = (await contacts(ctx)).filter((c) => (!email || c.data.email === email) && (!name || key(c.data.name) === name) && (!org || key(c.data.organisation) === org) && (!q || [c.data.name, c.data.organisation, c.data.email].some((x) => key(x).includes(q))));
        return { ok: true, total: found.length, contacts: found.slice(0, limit).map((c) => card(ctx, c)) };
      },
      // Crée la fiche (statut « active » sauf si `status` est donné, source « partnerships » par défaut) — OU renvoie celle qui existe déjà (règle de dédoublonnage ci-dessus, rien n'est modifié) : { ok, id, created, matchedBy?, contact }.
      async create(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const name = clean(a.name, FIELDS.name);
        if (!name) return { ok: false, error: "name_required" };
        const email = clean(a.email, FIELDS.email).toLowerCase();
        if (email && !validEmail(email)) return { ok: false, error: "invalid_email" };
        const all = await contacts(ctx);
        const known = email ? sameEmail(all, email) : sameNameOrg(all, name, a.organisation);
        if (known.length) {
          const first = known.sort((x, y) => x.createdAt - y.createdAt)[0];
          return { ok: true, id: first.id, created: false, matchedBy: email ? "email" : "name+organisation", contact: card(ctx, first) };
        }
        if (all.length >= MAX_CONTACTS) return { ok: false, error: "too_many" };
        const source = SOURCES.includes(a.source) ? a.source : "partnerships";
        const id = await ctx.api.store.add("contacts", { ...cleanContact({ ...a, name, email }), status: STATUSES.includes(a.status) ? a.status : "active", source });
        if (a.note) await addNote(ctx, id, a.note, source);
        return { ok: true, id, created: true, contact: card(ctx, await ctx.api.store.get(id)) };
      },
      // Corrige des champs (seuls ceux fournis changent ; "" vide un champ facultatif) : { ok, contact }. Un e-mail déjà porté par une autre fiche est refusé (pas de doublon).
      async update(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const row = idOf(a.id) ? await ctx.api.store.get(a.id) : null;
        if (!isCard(row)) return { ok: false, error: "not_found" };
        const given = Object.keys(FIELDS).filter((k) => a[k] !== undefined);
        if (!given.length) return { ok: false, error: "nothing_to_update" };
        if (a.name !== undefined && !clean(a.name, FIELDS.name)) return { ok: false, error: "name_required" };
        if (a.email !== undefined) {
          const email = clean(a.email, FIELDS.email).toLowerCase();
          if (email && !validEmail(email)) return { ok: false, error: "invalid_email" };
          const other = email && (await contacts(ctx)).find((c) => c.id !== row.id && c.data.email === email);
          if (other) return { ok: false, error: "email_taken", id: other.id };
        }
        await ctx.api.store.update(row.id, cleanContact(Object.fromEntries(given.map((k) => [k, a[k]])), row.data));
        return { ok: true, contact: card(ctx, await ctx.api.store.get(row.id)) };
      },
      // Ajoute une note datée (5 000 caractères au plus) : { ok, id }. `author` (60 caractères) dit d'où elle vient.
      async note(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const row = idOf(a.id) ? await ctx.api.store.get(a.id) : null;
        if (!isCard(row)) return { ok: false, error: "not_found" };
        if (!clean(a.text, 5000)) return { ok: false, error: "text_required" };
        await addNote(ctx, row.id, a.text, clean(a.author, 60) || "module");
        return { ok: true, id: row.id };
      },
    },
  },
};

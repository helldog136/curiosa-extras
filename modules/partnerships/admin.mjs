// Partnerships: the admin interface: overview, partner page (journal, linked contacts), and the windows to add, edit and delete.
const v = new URL(import.meta.url).search; // the module version propagates to the neighbouring files (otherwise the old code would stay cached after an update)
const { STATUSES, CLOSED, DAY, fail, clip, today, validDate, safeUrl, cleanPartner, parseCsv, importPartners, all, lastActivity, followUpDue, fmt, deletePartnerRecord, deletionPreview } = await import(`./data.mjs${v}`);
const { CONTACTS, MAX_LINKS, ID_MAX, esc, idOk, linksOf, person, book, bookAvailable, resolveLinks, healLinks, setLinks } = await import(`./contacts-link.mjs${v}`);

export default {
  // ── Core dashboard: "n partners to follow up" ─────────────────────────────────────────────────
  // Same computation as the ⏰ of the overview (`followUpDue`: message sent, no news for "follow up after n days"). Storage reads only,
  // like the admin (1,000 files and 1,000 journal lines at most), never the network nor the address book; the journal is read only if a message was sent.
  dashboard: {
    tasks: {
      async "follow-up"(ctx) {
        const partners = await all(ctx, "partners");
        if (!partners.some((p) => p.data.status === "envoye")) return 0;
        const journal = await all(ctx, "journal");
        return partners.filter((p) => followUpDue(ctx, p, journal)).length;
      },
    },
  },

  // ── Admin panel ───────────────────────────────────────────────────────────────
  // Forms (new partner, edit, delete, journal entry) open in a WINDOW above the page (`presentation: "dialog"`, core 0.6.7): the module tabs stay what they are, tabs of the
  // whole module, and the list keeps its search, filter and place. The window is returned only when the address asks for it (`?new=1`, `?edit=<id>`, `?delete=<id>`,
  // `?partner=<id>&log=1`); the action answers `{ ok }` and the core closes the window.
  async adminPanel(ctx, { query }) {
    const t = ctx.t;
    const [partners, journal, hasBook] = await Promise.all([all(ctx, "partners"), all(ctx, "journal"), bookAvailable(ctx)]);
    const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`s_${s}`) }));
    const blocks = [{ type: "markdown", text: `*${t("private")}*` }];
    const byId = (id) => (typeof id === "string" && id ? partners.find((p) => p.id === id) : undefined);
    const open = byId(query.partner);
    const back = open ? `?partner=${open.id}` : "?"; // where a window returns when it closes

    // The edit window: four fields in sight, the rare ones under "More options" (the core summarises what is already filled in there).
    const partnerForm = (p) => ({
      type: "adminForm",
      presentation: "dialog",
      action: "savePartner",
      title: p ? `${t("edit")} — ${p.data.brand}` : t("add"),
      submitLabel: t(p ? "saveSubmit" : "addSubmit"),
      cancelHref: back,
      fields: [
        { name: "id", kind: "hidden", value: p?.id ?? "" },
        { name: "brand", label: t("brand"), required: true, example: t("exBrand"), value: p?.data.brand ?? "" },
        { name: "status", label: t("status"), kind: "select", options: statusOptions, value: p?.data.status ?? "a_contacter" },
        { name: "chances", label: t("chances"), kind: "number", min: 0, max: 100, step: 1, unit: "%", value: String(p?.data.chances ?? "") },
        { name: "url", label: t("url"), kind: "url", example: t("exUrl"), value: p?.data.url ?? "" },
        { name: "sector", label: t("sector"), folded: true, example: t("exSector"), value: p?.data.sector ?? "" },
        { name: "country", label: t("country"), folded: true, example: t("exCountry"), value: p?.data.country ?? "" },
        { name: "contact", label: t("contact"), folded: true, help: t("contactHelp"), example: t("exContact"), value: p?.data.contact ?? "" },
        { name: "logo", label: t("logo"), kind: "image", folded: true, value: p?.data.logo ?? "" },
        { name: "products", label: t("products"), kind: "textarea", folded: true, example: t("exProducts"), value: p?.data.products ?? "" },
        { name: "benefits", label: t("benefits"), kind: "textarea", folded: true, example: t("exBenefits"), value: p?.data.benefits ?? "" },
        { name: "brief", label: t("brief"), kind: "textarea", folded: true, example: t("exBrief"), value: p?.data.brief ?? "" },
        { name: "mail", label: t("mail"), kind: "textarea", folded: true, value: p?.data.mail ?? "" },
        { name: "source", label: t("source"), folded: true, example: t("exSource"), value: p?.data.source ?? "" },
      ],
    });

    // The deletion window: says what is lost (counts) and what is not (the people in Contacts), and asks for a tick: nothing is deleted by opening it.
    const deleteForm = async (p) => {
      const { journal: n, contacts: k } = await deletionPreview(ctx, p);
      return {
        type: "adminForm",
        presentation: "dialog",
        action: "deletePartner",
        title: t("deleteTitle", { brand: p.data.brand }),
        submitLabel: t("deleteSubmit"),
        cancelHref: back,
        fields: [
          { name: "id", kind: "hidden", value: p.id },
          { name: "confirm", kind: "checkbox", required: true, label: t(`deleteConfirm${count(n)}`, { n }), help: t(`deleteKeep${count(k)}`, { n: k }) },
        ],
      };
    };

    const journalForm = (p) => ({
      type: "adminForm",
      presentation: "dialog",
      action: "addJournal",
      title: `${t("journalAdd")} — ${p.data.brand}`,
      submitLabel: t("journalAdd"),
      cancelHref: back,
      fields: [{ name: "partnerId", kind: "hidden", value: p.id }, { name: "date", label: t("date"), kind: "date", value: today() }, { name: "text", label: t("text"), kind: "textarea", required: true, example: t("exNote") }, { name: "link", label: t("link"), kind: "url", example: t("exLink") }],
    });

    // The window the address asks for, if any.
    const dialogs = [];
    if (query.new) dialogs.push(partnerForm(null));
    else if (byId(query.edit)) dialogs.push(partnerForm(byId(query.edit)));
    else if (byId(query.delete)) dialogs.push(await deleteForm(byId(query.delete)));
    else if (open && query.log) dialogs.push(journalForm(open));
    blocks.push(...dialogs);

    // Banner: Contacts module absent.
    const notices = [];
    if (!hasBook) notices.push({ type: "markdown", text: `**⚠ ${t("noBookTitle")}** ${t("noBookText")}` });

    // Partner page: details, journal, linked contacts, deletion
    if (open) {
      const d = open.data;
      const mine = journal.filter((j) => j.data.partnerId === open.id).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
      const lines = [d.status && `**${t("status")}** : ${t(`s_${d.status}`)}${followUpDue(ctx, open, journal) ? ` ⏰ ${t("followUp")}` : ""}`, d.chances != null && `**${t("chances")}** : ${d.chances} %`, d.url && `**${t("url")}** : ${d.url}`, d.sector && `**${t("sector")}** : ${d.sector}`, d.country && `**${t("country")}** : ${d.country}`, d.contact && `**${t("contact")}** : ${d.contact}`, d.products && `**${t("products")}** : ${d.products}`, d.benefits && `**${t("benefits")}** : ${d.benefits}`, d.brief && `**${t("brief")}** :\n\n${d.brief}`].filter(Boolean);
      return [
        ...blocks,
        ...notices,
        { type: "markdown", text: `[${t("back")}](?)` },
        { type: "heading", text: d.brand },
        { type: "markdown", text: lines.join("\n\n") },
        { type: "links", items: [{ label: t("editPartner"), href: `?partner=${open.id}&edit=${open.id}`, presentation: "dialog" }] },
        { type: "heading", text: t("journal") },
        { type: "links", items: [{ label: t("journalNew"), href: `?partner=${open.id}&log=1`, presentation: "dialog" }] },
        { type: "table", columns: [t("date"), t("author"), t("text")], rows: mine.map((j) => [j.data.date, j.data.author, j.data.text + (j.data.link ? `\n${j.data.link}` : "")]), rowIds: mine.map((j) => j.id), searchable: true, truncate: [2], rowActions: [{ label: t("delete"), action: "deleteJournal", confirm: t("confirmJournal"), danger: true }] },
        ...(await contactsSection(ctx, open, hasBook)),
        // Apart, last, and named: what is lost and what stays (R3, R24).
        { type: "heading", text: t("dangerTitle") },
        { type: "markdown", text: t("dangerText") },
        { type: "links", items: [{ label: t("deleteBtn"), href: `?partner=${open.id}&delete=${open.id}`, presentation: "dialog" }] },
      ];
    }

    // Overview: sorted by urgency (discussion > accepted > sent > to contact > published > closed)
    const rank = (s) => ({ discussion: 0, accepte: 1, envoye: 2, a_contacter: 3, publie: 4 })[s] ?? 5;
    const sorted = [...partners].sort((a, b) => rank(a.data.status) - rank(b.data.status) || String(a.data.brand).localeCompare(String(b.data.brand)));
    blocks.push(
      ...notices,
      { type: "heading", text: `${t("overview")} (${partners.filter((p) => !CLOSED.has(p.data.status)).length})` },
      { type: "links", items: [{ label: t("addBtn"), href: "?new=1", presentation: "dialog" }] },
      sorted.length
        ? {
            type: "table",
            columns: [t("brand"), t("status"), t("chances"), t("lastActivity"), t("followUpHead")],
            rows: sorted.map((p) => [p.data.brand, t(`s_${p.data.status}`), p.data.chances != null ? `${p.data.chances} %` : "", fmt(lastActivity(p, journal)), followUpDue(ctx, p, journal) ? `⏰ ${t("followUp")}` : ""]),
            rowIds: sorted.map((p) => p.id),
            searchable: true,
            filters: [{ column: 1 }],
            truncate: [0],
            rowActions: [{ label: t("open"), href: "?partner={id}" }, { label: t("edit"), href: "?edit={id}", presentation: "dialog" }, { label: t("deleteBtn"), href: "?delete={id}", presentation: "dialog", danger: true, inMenu: true }],
          }
        : { type: "markdown", text: t("none") },
      { type: "adminForm", action: "importPartners", title: t("importTitle"), submitLabel: t("importSubmit"), fields: [{ name: "csv", label: t("importCsv"), kind: "textarea", required: true }] },
      { type: "markdown", text: t("importHelp") },
    );
    return blocks;
  },

  adminActions: {
    async savePartner(ctx, v) {
      if (!clip(v.brand, 120)) return { error: ctx.t("brandRequired") };
      if (v.id) {
        const row = await ctx.api.store.get(v.id);
        if (!row) return { error: ctx.t("notFound") };
        await ctx.api.store.update(v.id, { ...cleanPartner(v, row.data), updatedBy: "admin" });
        return { ok: ctx.t("saved") };
      }
      await ctx.api.store.add("partners", { ...cleanPartner({ ...v, status: v.status || "a_contacter" }), updatedBy: "admin" });
      return { ok: ctx.t("saved") };
    },
    async importPartners(ctx, v) {
      const r = await importPartners(ctx, v.csv);
      if (r.error) return { error: ctx.t(r.error === "noBrand" ? "importNoBrand" : "importEmpty") };
      return { ok: ctx.t("importDone", { created: r.created, completed: r.completed, skipped: r.skipped }) };
    },
    // Deletes the file and its journal: NEVER a person of the Contacts module, only the reference goes away. Needs the tick of the confirmation window.
    async deletePartner(ctx, v) {
      if (v.confirm !== "on") return { error: ctx.t("deleteTick") };
      const r = await deletePartnerRecord(ctx, v.id);
      if (!r) return { error: ctx.t("notFound") };
      return { ok: ctx.t("deletedPartner", { brand: r.brand }), redirect: "?" };
    },
    async addJournal(ctx, v) {
      if (!(await ctx.api.store.get(v.partnerId)) || !clip(v.text, 5000)) return { error: ctx.t("notFound") };
      await ctx.api.store.add("journal", { partnerId: v.partnerId, date: validDate(v.date), author: "admin", text: clip(v.text, 5000), link: safeUrl(v.link) });
      return { ok: ctx.t("saved") };
    },
    async deleteJournal(ctx, v) {
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted") };
    },

    // LINK an existing contact of the Contacts module (picked in the list, or found by name / email).
    async linkContact(ctx, v) {
      const partner = idOk(v.partnerId) ? await ctx.api.store.get(v.partnerId) : null;
      if (!partner || partner.data.brand === undefined) return { error: ctx.t("notFound") };
      if (!(await bookAvailable(ctx))) return { error: ctx.t("noBookText") };
      let target = clip(v.contactId, ID_MAX);
      if (!target) {
        const q = clip(v.search, 120);
        if (!q) return { error: ctx.t("linkChoose") };
        const found = await book(ctx, "find", { q, limit: 6 });
        if (!found.ok) return { error: ctx.t("noBookText") };
        if (!found.contacts.length) return { error: ctx.t("linkNone", { q }) };
        if (found.contacts.length > 1) return { error: ctx.t("linkSeveral", { names: found.contacts.map((c) => `${c.name}${c.email ? ` <${c.email}>` : ""}`).join(" ; ") }) };
        target = found.contacts[0].id;
      }
      const got = await book(ctx, "resolve", { ids: [target] });
      if (!got.ok) return { error: ctx.t("noBookText") };
      if (!got.contacts.length) return { error: ctx.t("linkMissing") };
      const ids = linksOf(partner);
      if (ids.includes(target)) return { ok: ctx.t("linkAlready", { name: got.contacts[0].name }) };
      if (ids.length >= MAX_LINKS) return { error: ctx.t("linkTooMany") };
      await setLinks(ctx, partner, [...ids, target], "admin");
      return { ok: ctx.t("linkDone", { name: got.contacts[0].name }) };
    },
    // CREATE a person in Contacts (through the service, no duplicate) then link them.
    async createContact(ctx, v) {
      const partner = idOk(v.partnerId) ? await ctx.api.store.get(v.partnerId) : null;
      if (!partner || partner.data.brand === undefined) return { error: ctx.t("notFound") };
      if (!clip(v.name, 120)) return { error: ctx.t("contactNameRequired") };
      if (!(await bookAvailable(ctx))) return { error: ctx.t("noBookText") };
      const res = await book(ctx, "create", { name: v.name, role: v.role, organisation: v.organisation, email: v.email, phone: v.phone, source: "partnerships" });
      if (res.unavailable) return { error: ctx.t("noBookText") };
      if (!res.ok) return { error: ctx.t(res.error === "invalid_email" ? "contactBadEmail" : "contactFailed") };
      const ids = linksOf(partner);
      if (!ids.includes(res.id)) {
        if (ids.length >= MAX_LINKS) return { error: ctx.t("linkTooMany") };
        await setLinks(ctx, partner, [...ids, res.id], "admin");
      }
      return { ok: ctx.t(res.created ? "contactCreated" : "contactExisting", { name: res.contact.name }) };
    },
    // UNLINK: the person stays in the address book. The row id is "partner~contact".
    async unlinkContact(ctx, v) {
      const [partnerId, contactId] = String(v.id ?? "").split("~");
      const partner = idOk(partnerId) ? await ctx.api.store.get(partnerId) : null;
      if (!partner || !idOk(contactId)) return { error: ctx.t("notFound") };
      await setLinks(ctx, partner, linksOf(partner).filter((id) => id !== contactId), "admin");
      return { ok: ctx.t("unlinked") };
    },
  }
};

// ── Page pieces ──────────────────────────────────────────────────────────────────────────────────────
/** "Contacts" section of a partner page: linked people (resolved by the service), link / create / unlink. */
async function contactsSection(ctx, partner, hasBook) {
  const t = ctx.t;
  let ids = linksOf(partner);
  const links = await resolveLinks(ctx, ids);
  if (Object.keys(links.moved).length) { await healLinks(ctx, partner, links.moved); ids = linksOf(partner); } // a person merged into another: the link follows
  const out = [{ type: "heading", text: t("contacts") }];
  const rows = [], rowIds = [];
  if (!links.available) for (const id of ids) { rows.push([t("unavailableName"), "", `(${id})`, ""]); rowIds.push(`${partner.id}~${id}`); }
  else {
    for (const c of links.cards) { rows.push([c.name, c.role ?? "", c.email ?? "", c.phone ?? ""]); rowIds.push(`${partner.id}~${c.id}`); }
    for (const id of links.missing) { rows.push([t("missingName"), "", `(${id})`, ""]); rowIds.push(`${partner.id}~${id}`); }
  }
  if (!hasBook && ids.length) out.push({ type: "markdown", text: t("linksKept", { n: ids.length }) });
  if (rows.length) {
    out.push({ type: "table", columns: [t("name"), t("role"), t("email"), t("phone")], rows, rowIds, rowActions: [{ label: t("unlink"), action: "unlinkContact" }] });
    const open = links.cards.map((c) => `[${esc(c.name)}](${c.adminPath})`);
    if (open.length) out.push({ type: "markdown", text: `${t("openInContacts")} → ${open.join(" · ")}` });
  } else out.push({ type: "markdown", text: t("noLinkedContacts") });

  if (hasBook) {
    const linked = new Set(ids);
    const found = await book(ctx, "find", { limit: 200 });
    const options = found.ok ? found.contacts.filter((c) => !linked.has(c.id)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((c) => ({ value: c.id, label: `${c.name}${c.organisation ? ` — ${c.organisation}` : ""}${c.email ? ` (${c.email})` : ""}` })) : [];
    out.push(
      { type: "adminForm", action: "linkContact", title: t("linkTitle"), submitLabel: t("linkSubmit"), fields: [{ name: "partnerId", kind: "hidden", value: partner.id }, { name: "contactId", label: t("linkPick"), kind: "select", options: [{ value: "", label: t("linkPickNone") }, ...options] }, { name: "search", label: t("linkSearch"), help: t("linkSearchHelp"), example: t("exSearch") }] },
      { type: "adminForm", action: "createContact", title: t("contactAdd"), submitLabel: t("contactAdd"), fields: [{ name: "partnerId", kind: "hidden", value: partner.id }, { name: "name", label: t("name"), required: true }, { name: "role", label: t("role") }, { name: "organisation", label: t("organization") }, { name: "email", label: t("email"), kind: "email", help: t("contactAddHelp") }, { name: "phone", label: t("phone") }] },
    );
  }
  return out;
}

/** Picks the text variant for a count: none, one, several (the language files have `…0`, `…1` and `…N`). */
const count = (n) => (n === 0 ? "0" : n === 1 ? "1" : "N");

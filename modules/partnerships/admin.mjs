// Partenariats — l'interface d'administration : vue d'ensemble, fiche (journal, contacts liés), page de fusion.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, CLOSED, DAY, fail, clip, today, validDate, safeUrl, cleanPartner, parseCsv, importPartners, all, lastActivity, followUpDue, fmt } = await import(`./data.mjs${v}`);
const { CONTACTS, MAX_LINKS, ID_MAX, esc, idOk, linksOf, person, book, bookAvailable, resolveLinks, setLinks } = await import(`./contacts-link.mjs${v}`);
const { key, mergeState, planMerge, countPlan, reportLine, runMerge, undoMerge, loadLegacy, legacyBackup } = await import(`./merge.mjs${v}`);

export default {
  // ── Panneau d'admin ───────────────────────────────────────────────────────────
  async adminPanel(ctx, { query }) {
    const t = ctx.t;
    const [partners, journal, state, hasBook] = await Promise.all([all(ctx, "partners"), all(ctx, "journal"), mergeState(ctx), bookAvailable(ctx)]);
    const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`s_${s}`) }));
    const blocks = [{ type: "markdown", text: `*${t("private")}*` }];
    const brandOf = (id) => partners.find((p) => p.id === id)?.data.brand ?? "";

    const partnerForm = (p) => ({
      type: "adminForm",
      action: "savePartner",
      title: p ? `${t("edit")} — ${p.data.brand}` : t("add"),
      submitLabel: t("save"),
      cancelHref: p ? `?partner=${p.id}` : undefined,
      fields: [
        { name: "id", kind: "hidden", value: p?.id ?? "" },
        { name: "brand", label: t("brand"), required: true, value: p?.data.brand ?? "" },
        { name: "status", label: t("status"), kind: "select", options: statusOptions, value: p?.data.status ?? "a_contacter" },
        { name: "chances", label: t("chances"), kind: "number", value: String(p?.data.chances ?? "") },
        { name: "url", label: t("url"), kind: "url", value: p?.data.url ?? "" },
        { name: "sector", label: t("sector"), value: p?.data.sector ?? "" },
        { name: "country", label: t("country"), value: p?.data.country ?? "" },
        { name: "contact", label: t("contact"), help: t("contactHelp"), value: p?.data.contact ?? "" },
        { name: "logo", label: t("logo"), kind: "image", value: p?.data.logo ?? "" },
        { name: "products", label: t("products"), kind: "textarea", value: p?.data.products ?? "" },
        { name: "benefits", label: t("benefits"), kind: "textarea", value: p?.data.benefits ?? "" },
        { name: "brief", label: t("brief"), kind: "textarea", value: p?.data.brief ?? "" },
        { name: "mail", label: t("mail"), kind: "textarea", value: p?.data.mail ?? "" },
        { name: "source", label: t("source"), value: p?.data.source ?? "" },
      ],
    });

    // Bandeaux : module Contacts absent, fusion à faire / à finir.
    const notices = [];
    if (!hasBook) notices.push({ type: "markdown", text: `**⚠ ${t("noBookTitle")}** ${t("noBookText")}` });
    if (!state.meta && state.items.length) notices.push({ type: "markdown", text: `**📇 ${t("bannerTitle")}** ${t("bannerText", { n: state.items.length })} [${t("bannerLink")}](?merge=1)` });
    else if (state.meta && state.pending.length) notices.push({ type: "markdown", text: `**📇 ${t("pendingTitle")}** ${t("pendingText", { n: state.pending.length })} [${t("pendingLink")}](?merge=1)` });

    // Modification d'une fiche
    const editing = query.edit && partners.find((p) => p.id === query.edit);
    if (editing) return [...blocks, partnerForm(editing)];

    // Fusion des contacts
    if (query.merge) return [...blocks, ...(await mergePage(ctx, state, hasBook, brandOf))];

    // Fiche détaillée : journal + contacts liés
    const open = query.partner && partners.find((p) => p.id === query.partner);
    if (open) {
      const d = open.data;
      const mine = journal.filter((j) => j.data.partnerId === open.id).sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)));
      const lines = [d.status && `**${t("status")}** : ${t(`s_${d.status}`)}${followUpDue(ctx, open, journal) ? ` ⏰ ${t("followUp")}` : ""}`, d.chances != null && `**${t("chances")}** : ${d.chances}`, d.url && `**${t("url")}** : ${d.url}`, d.sector && `**${t("sector")}** : ${d.sector}`, d.country && `**${t("country")}** : ${d.country}`, d.contact && `**${t("contact")}** : ${d.contact}`, d.products && `**${t("products")}** : ${d.products}`, d.benefits && `**${t("benefits")}** : ${d.benefits}`, d.brief && `**${t("brief")}** :\n\n${d.brief}`].filter(Boolean);
      return [
        ...blocks,
        ...notices,
        { type: "markdown", text: `[${t("back")}](?)` },
        { type: "heading", text: d.brand },
        { type: "markdown", text: lines.join("\n\n") },
        { type: "table", columns: [t("edit")], rows: [[d.brand]], rowIds: [open.id], rowActions: [{ label: t("edit"), href: "?edit={id}" }, { label: t("delete"), action: "deletePartner", confirm: t("confirm"), danger: true }] },
        { type: "heading", text: t("journal") },
        { type: "table", columns: [t("date"), t("author"), t("text")], rows: mine.map((j) => [j.data.date, j.data.author, j.data.text + (j.data.link ? `\n${j.data.link}` : "")]), rowIds: mine.map((j) => j.id), rowActions: [{ label: t("delete"), action: "deleteJournal", confirm: t("confirm"), danger: true }] },
        { type: "adminForm", action: "addJournal", title: t("journalAdd"), submitLabel: t("journalAdd"), fields: [{ name: "partnerId", kind: "hidden", value: open.id }, { name: "date", label: t("date"), kind: "date", value: today() }, { name: "text", label: t("text"), kind: "textarea", required: true }, { name: "link", label: t("link"), kind: "url" }] },
        ...(await contactsSection(ctx, open, state, hasBook)),
      ];
    }

    // Vue d'ensemble : triée par urgence (discussion > accepté > envoyé > à contacter > publié > clos)
    const rank = (s) => ({ discussion: 0, accepte: 1, envoye: 2, a_contacter: 3, publie: 4 })[s] ?? 5;
    const sorted = [...partners].sort((a, b) => rank(a.data.status) - rank(b.data.status) || String(a.data.brand).localeCompare(String(b.data.brand)));
    blocks.push(
      ...notices,
      { type: "heading", text: `${t("overview")} (${partners.filter((p) => !CLOSED.has(p.data.status)).length})` },
      sorted.length
        ? { type: "table", columns: [t("brand"), t("status"), t("chances"), t("lastActivity")], rows: sorted.map((p) => [p.data.brand, `${t(`s_${p.data.status}`)}${followUpDue(ctx, p, journal) ? " ⏰" : ""}`, p.data.chances != null ? `${p.data.chances} %` : "", fmt(lastActivity(p, journal))]), rowIds: sorted.map((p) => p.id), rowActions: [{ label: t("open"), href: "?partner={id}" }, { label: t("edit"), href: "?edit={id}" }] }
        : { type: "markdown", text: t("none") },
      partnerForm(null),
      { type: "adminForm", action: "importPartners", title: t("importTitle"), submitLabel: t("importSubmit"), fields: [{ name: "csv", label: t("importCsv"), kind: "textarea", required: true }] },
      { type: "markdown", text: t("importHelp") },
    );
    if (state.meta) blocks.push({ type: "markdown", text: `*${t("mergeFooter", { date: String(state.meta.data.at).slice(0, 10) })}* [${t("mergeFooterLink")}](?merge=1)` });
    return blocks;
  },

  adminActions: {
    async savePartner(ctx, v) {
      if (!clip(v.brand, 120)) return { error: ctx.t("brandRequired") };
      if (v.id) {
        const row = await ctx.api.store.get(v.id);
        if (!row) return { error: ctx.t("notFound") };
        await ctx.api.store.update(v.id, { ...cleanPartner(v, row.data), updatedBy: "admin" });
        return { ok: ctx.t("saved"), redirect: `?partner=${v.id}` };
      }
      const id = await ctx.api.store.add("partners", { ...cleanPartner({ ...v, status: v.status || "a_contacter" }), updatedBy: "admin" });
      return { ok: ctx.t("saved"), redirect: `?partner=${id}` };
    },
    async importPartners(ctx, v) {
      const r = await importPartners(ctx, v.csv);
      if (r.error) return { error: ctx.t(r.error === "noBrand" ? "importNoBrand" : "importEmpty") };
      return { ok: ctx.t("importDone", { created: r.created, completed: r.completed, skipped: r.skipped }) };
    },
    // Supprime la fiche et son journal (et, avant la fusion, ses anciens contacts) — JAMAIS une personne du module Contacts : seule la référence disparaît.
    async deletePartner(ctx, v) {
      for (const collection of ["journal", "contacts"]) for (const r of await all(ctx, collection)) if (r.data.partnerId === v.id) await ctx.api.store.remove(r.id);
      await ctx.api.store.remove(v.id);
      return { ok: ctx.t("deleted"), redirect: "?" };
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

    // LIER un contact existant du module Contacts (choisi dans la liste, ou trouvé par nom / e-mail).
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
    // CRÉER une personne dans Contacts (via le service, sans doublon) puis la lier.
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
    // DÉLIER : la personne reste dans le carnet. L'identifiant de ligne est « fiche~contact ».
    async unlinkContact(ctx, v) {
      const [partnerId, contactId] = String(v.id ?? "").split("~");
      const partner = idOk(partnerId) ? await ctx.api.store.get(partnerId) : null;
      if (!partner || !idOk(contactId)) return { error: ctx.t("notFound") };
      await setLinks(ctx, partner, linksOf(partner).filter((id) => id !== contactId), "admin");
      return { ok: ctx.t("unlinked") };
    },

    // FUSION avec le module Contacts (voir runMerge) : aperçu sur la page, exécution sur confirmation.
    async mergeRun(ctx) {
      const r = await runMerge(ctx);
      if (r.error) return { error: ctx.t(r.error) };
      return { ok: reportLine(ctx.t, r.report), redirect: "?merge=1" };
    },
    async mergeUndo(ctx) {
      return (await undoMerge(ctx)) ? { ok: ctx.t("mergeUndone"), redirect: "?merge=1" } : { error: ctx.t("notFound") };
    },
    // Un contact ambigu : « c'est cette personne » (id de ligne « ancien~contact ») ou « ne pas reprendre ».
    async mergeResolve(ctx, v) {
      const [legacyId, contactId] = String(v.id ?? "").split("~");
      const state = await mergeState(ctx);
      const item = state.meta && state.pending.find((i) => i.id === legacyId);
      const partner = item?.partnerId ? await ctx.api.store.get(item.partnerId) : null;
      if (!item || !idOk(contactId)) return { error: ctx.t("notFound") };
      const got = await book(ctx, "resolve", { ids: [contactId] });
      if (!got.ok || !got.contacts.length) return { error: ctx.t(got.unavailable ? "noBookText" : "linkMissing") };
      const meta = state.meta.data;
      if (partner && partner.data.brand !== undefined) {
        const ids = linksOf(partner);
        if (!ids.includes(contactId)) {
          if (ids.length >= MAX_LINKS) return { error: ctx.t("linkTooMany") };
          await setLinks(ctx, partner, [...ids, contactId], "merge");
          (meta.added[partner.id] ??= []).push(contactId);
        }
      }
      meta.mapping[item.id] = contactId;
      await ctx.api.store.update(state.meta.id, meta);
      return { ok: ctx.t("saved"), redirect: "?merge=1" };
    },
    async mergeDismiss(ctx, v) {
      const state = await mergeState(ctx);
      const item = state.meta && state.pending.find((i) => i.id === String(v.id ?? ""));
      if (!item) return { error: ctx.t("notFound") };
      state.meta.data.dismissed.push(item.id);
      await ctx.api.store.update(state.meta.id, state.meta.data);
      return { ok: ctx.t("saved"), redirect: "?merge=1" };
    },
  }
};

// ── Morceaux de page ──────────────────────────────────────────────────────────────────────────────────────
/** Section « Contacts » d'une fiche : personnes liées (résolues par le service), lier / créer / délier, anciens contacts pas encore repris. */
async function contactsSection(ctx, partner, state, hasBook) {
  const t = ctx.t;
  const ids = linksOf(partner);
  const links = await resolveLinks(ctx, ids);
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
    if (open.length) out.push({ type: "markdown", text: `${t("openInContacts")} ${open.join(" · ")}` });
  } else out.push({ type: "markdown", text: t("noLinkedContacts") });

  // Anciens contacts de cette fiche, pas encore repris dans Contacts (lecture seule).
  const old = state.pending.filter((i) => i.partnerId === partner.id);
  if (old.length) {
    out.push({ type: "heading", text: t(state.meta ? "oldPendingTitle" : "oldTitle") });
    out.push({ type: "markdown", text: t(state.meta ? "oldPendingHelp" : "oldHelp") });
    out.push({ type: "table", columns: [t("name"), t("role"), t("email"), t("phone")], rows: old.map((i) => [i.name + (i.status === "to_review" ? ` (${t("toReview")})` : ""), i.role, i.email || i.rawEmail, i.phone]) });
  }
  if (hasBook) {
    const linked = new Set(ids);
    const found = await book(ctx, "find", { limit: 200 });
    const options = found.ok ? found.contacts.filter((c) => !linked.has(c.id)).sort((a, b) => key(a.name).localeCompare(key(b.name))).map((c) => ({ value: c.id, label: `${c.name}${c.organisation ? ` — ${c.organisation}` : ""}${c.email ? ` (${c.email})` : ""}` })) : [];
    out.push(
      { type: "adminForm", action: "linkContact", title: t("linkTitle"), submitLabel: t("linkSubmit"), fields: [{ name: "partnerId", kind: "hidden", value: partner.id }, { name: "contactId", label: t("linkPick"), kind: "select", options: [{ value: "", label: t("linkPickNone") }, ...options] }, { name: "search", label: t("linkSearch"), help: t("linkSearchHelp") }] },
      { type: "adminForm", action: "createContact", title: t("contactAdd"), submitLabel: t("contactAdd"), fields: [{ name: "partnerId", kind: "hidden", value: partner.id }, { name: "name", label: t("name"), required: true }, { name: "role", label: t("role") }, { name: "organisation", label: t("organization") }, { name: "email", label: t("email"), kind: "email", help: t("contactAddHelp") }, { name: "phone", label: t("phone") }] },
    );
  }
  return out;
}

/** Page « Fusionner mes contacts avec le module Contacts » : aperçu exact, confirmation, bilan, cas ambigus, annulation. */
async function mergePage(ctx, state, hasBook, brandOf) {
  const t = ctx.t;
  const out = [{ type: "markdown", text: `[${t("back")}](?)` }, { type: "heading", text: t("mergeTitle") }];
  if (!hasBook) return [...out, { type: "markdown", text: `**⚠ ${t("noBookTitle")}** ${t("noBookText")}` }];
  if (!state.items.length) return [...out, { type: "markdown", text: t("mergeNothing") }];
  out.push({ type: "markdown", text: t("mergeIntro") });

  let plan = [];
  try { plan = await planMerge(ctx, state.pending); } catch { return [...out, { type: "markdown", text: `**⚠ ${t("noBookTitle")}** ${t("noBookText")}` }]; }
  const n = countPlan(plan);
  if (state.meta?.data.report) {
    const r = state.meta.data.report;
    out.push({ type: "markdown", text: `**${t("mergeLast", { date: String(state.meta.data.at).slice(0, 10) })}** ${reportLine(t, r)}` });
  }
  if (state.pending.length) {
    const todo = n.link + n.create + n.same;
    if (!state.meta || todo) out.push(
      { type: "heading", text: t("mergePreview") },
      { type: "table", columns: [t("mergeWhat"), t("mergeCount")], rows: [
        [t("mergeTotal"), String(n.total)],
        [t("mergeLink"), String(n.link)],
        [t("mergeCreate"), String(n.create)],
        ...(n.same ? [[t("mergeSame"), String(n.same)]] : []),
        [t("mergeAmbiguous"), String(n.ambiguous)],
        ...(state.items.length > state.pending.length ? [[t("mergeSettled"), String(state.items.length - state.pending.length)]] : []),
      ] },
    );
    const ambiguous = plan.filter((p) => p.kind === "ambiguous");
    if (ambiguous.length) {
      const cells = (p) => [`${p.item.name || "—"}${p.item.email ? `\n${p.item.email}` : ""}`, brandOf(p.item.partnerId) || "—", t(`why_${p.reason}`), p.candidates.map((c) => `${c.name}${c.email ? ` <${c.email}>` : ""}${c.organisation ? ` — ${c.organisation}` : ""}`).join("\n") || "—"];
      const columns = [t("mergeAmbContact"), t("mergeAmbPartner"), t("mergeAmbWhy"), t("mergeAmbCandidates")];
      out.push({ type: "heading", text: t("mergeAmbTitle", { n: ambiguous.length }) }, { type: "markdown", text: t(state.meta ? "mergeAmbHelpAfter" : "mergeAmbHelp") });
      if (state.meta) {
        const single = ambiguous.filter((p) => p.candidates.length === 1), others = ambiguous.filter((p) => p.candidates.length !== 1);
        if (single.length) out.push({ type: "table", columns, rows: single.map(cells), rowIds: single.map((p) => `${p.item.id}~${p.candidates[0].id}`), rowActions: [{ label: t("mergeResolve"), action: "mergeResolve" }, { label: t("mergeDismiss"), action: "mergeDismiss", confirm: t("mergeDismissConfirm") }] });
        if (others.length) out.push({ type: "table", columns, rows: others.map(cells), rowIds: others.map((p) => p.item.id), rowActions: [{ label: t("mergeDismiss"), action: "mergeDismiss", confirm: t("mergeDismissConfirm") }] });
      } else out.push({ type: "table", columns, rows: ambiguous.map(cells) });
    }
    if (todo || !state.meta) out.push({ type: "heading", text: t("mergeRunTitle") }, { type: "markdown", text: t("mergeRunHelp") });
    out.push(todo || !state.meta
      ? { type: "table", columns: [t("mergeRunTitle")], rows: [[t("mergeRunSummary", { link: n.link, create: n.create, same: n.same, ambiguous: n.ambiguous })]], rowIds: ["merge"], rowActions: [{ label: t("mergeRunButton"), action: "mergeRun", confirm: t("mergeConfirm", { link: n.link, create: n.create, same: n.same, ambiguous: n.ambiguous }) }] }
      : { type: "markdown", text: `*${t("mergeNothingToDo")}*` });
  } else out.push({ type: "markdown", text: `✅ ${t("mergeAllDone")}` });
  if (state.meta) {
    out.push({ type: "heading", text: t("mergeUndoTitle") }, { type: "markdown", text: t("mergeUndoHelp") });
    out.push({ type: "table", columns: [t("mergeUndoTitle")], rows: [[t("mergeUndoRow")]], rowIds: ["undo"], rowActions: [{ label: t("mergeUndoButton"), action: "mergeUndo", confirm: t("mergeUndoConfirm"), danger: true }] });
  }
  return out;
}

// Partenariats — la fusion de l'ancien carnet avec le module Contacts : lecture de l'ancien carnet, plan (aperçu), exécution, annulation.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { STATUSES, CLOSED, DAY, fail, clip, today, validDate, safeUrl, cleanPartner, parseCsv, importPartners, all, lastActivity, followUpDue, fmt } = await import(`./data.mjs${v}`);
const { CONTACTS, MAX_LINKS, ID_MAX, esc, idOk, linksOf, person, book, bookAvailable, resolveLinks, setLinks } = await import(`./contacts-link.mjs${v}`);

// ── Ancien carnet de ce module et fusion avec Contacts ────────────────────────────────────────────────────────
export const key = (v) => clip(String(v ?? ""), 400).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
export const tokens = (v) => key(v).split(/[^a-z0-9]+/).filter(Boolean);
/** Deux noms peuvent désigner la même personne : identiques, ou l'un contient tous les mots de l'autre (« Marie » / « Marie Dupont »). */
export const compatibleNames = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return true;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  return small.every((w) => big.includes(w));
};
export const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Un ancien contact (de la collection « contacts » ou de sa copie « legacyContacts »), remis en forme. */
export function legacyItem(r, archived) {
  const d = r.data;
  const email = clip(d.email, 200).toLowerCase();
  return {
    id: archived ? String(d._legacyId ?? r.id) : r.id,
    partnerId: clip(d.partnerId, ID_MAX),
    name: clip(d.name, 120), email: validEmail(email) ? email : "", rawEmail: validEmail(email) ? "" : clip(d.email, 200),
    organisation: clip(d.organisation ?? d.organization, 200), role: clip(d.role, 120), phone: clip(d.phone, 60), relation: clip(d.relation, 300), notes: clip(d.notes, 5000),
    status: d.status === "to_review" ? "to_review" : "active",
    at: archived && d._createdAt ? Date.parse(d._createdAt) || 0 : r.createdAt.getTime(),
  };
}
export async function loadLegacy(ctx) {
  const [old, kept] = await Promise.all([all(ctx, "contacts"), all(ctx, "legacyContacts")]);
  const keptIds = new Set(kept.map((r) => String(r.data._legacyId ?? "")));
  return [...kept.map((r) => legacyItem(r, true)), ...old.filter((r) => !keptIds.has(r.id)).map((r) => legacyItem(r, false))].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
export const EMPTY_META = () => ({ kind: "contactsMerge", at: "", mapping: {}, added: {}, created: [], dismissed: [], report: null });
export async function loadMeta(ctx) {
  const rows = await all(ctx, "meta");
  const r = rows.find((x) => x.data?.kind === "contactsMerge");
  return r ? { id: r.id, data: { ...EMPTY_META(), ...r.data } } : null;
}
export const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** Où en est la fusion : tous les anciens contacts, l'état enregistré, et ceux qui restent à traiter. */
export async function mergeState(ctx) {
  const [items, meta] = await Promise.all([loadLegacy(ctx), loadMeta(ctx)]);
  const settled = (i) => !!meta && (has(meta.data.mapping, i.id) || meta.data.dismissed.includes(i.id));
  return { items, meta, pending: items.filter((i) => !settled(i)) };
}

/**
 * PLAN de fusion (ne modifie rien) : pour chaque ancien contact, que ferait-on ?
 *   link       la personne est déjà dans Contacts (même e-mail, sans tenir compte des majuscules ; sans e-mail : même nom + même organisation) → on la LIE ;
 *   create     personne inconnue → on la CRÉE dans Contacts, puis on la lie ;
 *   same       la même personne figure sur une autre fiche partenaire et sera créée une fois → on la lie aussi ;
 *   ambiguous  doute (même e-mail mais nom différent, même nom avec une autre organisation ou un autre e-mail, plusieurs candidats, nom manquant)
 *              → on ne touche à rien, la liste est montrée au propriétaire.
 */
export async function planMerge(ctx, items) {
  const plan = [], planned = [];
  const find = async (args) => {
    const r = await book(ctx, "find", { ...args, limit: 100 });
    if (!r.ok) throw Object.assign(new Error("contacts unavailable"), { unavailable: true });
    return r.contacts;
  };
  for (const item of items) {
    const ambiguous = (reason, candidates = []) => plan.push({ item, kind: "ambiguous", reason, candidates });
    if (!item.name) { ambiguous("incomplete"); continue; }
    if (item.email) {
      const found = await find({ email: item.email });
      if (found.length) {
        const same = found.find((c) => compatibleNames(c.name, item.name));
        if (same) plan.push({ item, kind: "link", contact: same }); else ambiguous("email_other_name", found);
        continue;
      }
      const twin = planned.find((p) => p.email === item.email);
      if (twin) { if (compatibleNames(twin.name, item.name)) plan.push({ item, kind: "same", with: twin.itemId }); else ambiguous("email_other_name"); continue; }
      const byName = (await find({ name: item.name })).filter((c) => key(c.organisation) === key(item.organisation) && c.email);
      if (byName.length) { ambiguous("same_name_other_email", byName); continue; }
    } else {
      const found = await find({ name: item.name });
      const exact = found.filter((c) => key(c.organisation) === key(item.organisation));
      if (exact.length === 1) { plan.push({ item, kind: "link", contact: exact[0] }); continue; }
      if (exact.length > 1) { ambiguous("several", exact); continue; }
      if (found.length) { ambiguous("same_name_other_org", found); continue; }
      const twin = planned.find((p) => !p.email && key(p.name) === key(item.name));
      if (twin) { if (key(twin.org) === key(item.organisation)) plan.push({ item, kind: "same", with: twin.itemId }); else ambiguous("same_name_other_org"); continue; }
    }
    plan.push({ item, kind: "create" });
    planned.push({ itemId: item.id, email: item.email, name: item.name, org: item.organisation });
  }
  return plan;
}
export const countPlan = (plan) => ({ total: plan.length, link: plan.filter((p) => p.kind === "link").length, create: plan.filter((p) => p.kind === "create").length, same: plan.filter((p) => p.kind === "same").length, ambiguous: plan.filter((p) => p.kind === "ambiguous").length });

export const reportLine = (t, r) => t("mergeReport", { link: r.link, created: r.created, same: r.same, ambiguous: r.ambiguous, failed: r.failed });

/** Exécute la fusion. Ordre de sûreté : 1) COPIE de l'ancien carnet (legacyContacts), vérifiée ; 2) création/liaison, une personne à la fois (chaque pas est rejouable) ;
 * 3) seulement ensuite, retrait des originaux. Relançable : seuls les contacts non réglés sont repris. */
export async function runMerge(ctx) {
  const state = await mergeState(ctx);
  if (!state.items.length) return { error: "mergeNothing" };
  if (!(await bookAvailable(ctx))) return { error: "mergeUnavailable" };
  let plan;
  try { plan = await planMerge(ctx, state.pending); } catch { return { error: "mergeUnavailable" }; }

  const kept = new Set((await all(ctx, "legacyContacts")).map((r) => String(r.data._legacyId ?? "")));
  const originals = await all(ctx, "contacts");
  for (const r of originals) if (!kept.has(r.id)) await ctx.api.store.add("legacyContacts", { ...r.data, _legacyId: r.id, _createdAt: r.createdAt.toISOString() });
  const copied = new Set((await all(ctx, "legacyContacts")).map((r) => String(r.data._legacyId ?? "")));
  if (!originals.every((r) => copied.has(r.id))) return { error: "mergeCopyFailed" };

  const meta = state.meta?.data ?? EMPTY_META();
  const partners = new Map((await all(ctx, "partners")).map((p) => [p.id, p]));
  const made = new Map();
  const r = { total: plan.length, link: 0, created: 0, same: 0, ambiguous: 0, failed: 0 };
  const link = async (item, contactId) => {
    const partner = partners.get(item.partnerId);
    if (partner) {
      const ids = linksOf(partner);
      if (!ids.includes(contactId)) {
        if (ids.length >= MAX_LINKS) return false;
        await setLinks(ctx, partner, [...ids, contactId], "merge");
        (meta.added[partner.id] ??= []).push(contactId);
      }
    }
    meta.mapping[item.id] = contactId;
    made.set(item.id, contactId);
    return true;
  };
  const brandOf = (item) => partners.get(item.partnerId)?.data.brand ?? "";
  try {
    for (const step of plan) {
      const { item } = step;
      if (step.kind === "ambiguous") { r.ambiguous++; continue; }
      if (step.kind === "same") {
        const target = made.get(step.with);
        if (target && (await link(item, target))) r.same++; else r.failed++;
        continue;
      }
      const extra = [item.relation && `${ctx.t("relation")} : ${item.relation}`, item.notes, item.rawEmail && `${ctx.t("email")} : ${item.rawEmail}`].filter(Boolean).join("\n");
      if (step.kind === "link") {
        const c = step.contact;
        const diff = [item.role && item.role !== c.role && `${ctx.t("role")} : ${item.role}`, item.phone && item.phone !== c.phone && `${ctx.t("phone")} : ${item.phone}`, item.organisation && item.organisation !== c.organisation && `${ctx.t("organization")} : ${item.organisation}`, extra].filter(Boolean).join("\n");
        if (diff) await book(ctx, "note", { id: c.id, author: "partnerships", text: `${ctx.t("mergeNoteIntro", { brand: brandOf(item) })}\n\n${diff}` });
        if (await link(item, c.id)) r.link++; else r.failed++;
        continue;
      }
      const res = await book(ctx, "create", { name: item.name, email: item.email, role: item.role, organisation: item.organisation, phone: item.phone, relation: item.relation, status: item.status, source: "partnerships", note: `${ctx.t("mergeNoteIntro", { brand: brandOf(item) })}${item.notes || item.rawEmail ? `\n\n${[item.notes, item.rawEmail && `${ctx.t("email")} : ${item.rawEmail}`].filter(Boolean).join("\n")}` : ""}` });
      if (!res.ok) { r.failed++; continue; }
      if (res.created) meta.created.push(res.id);
      if (await link(item, res.id)) { if (res.created) r.created++; else r.link++; } else r.failed++;
    }
  } finally {
    meta.at = new Date().toISOString();
    meta.report = { ...r, at: meta.at };
    if (state.meta) await ctx.api.store.update(state.meta.id, meta); else await ctx.api.store.add("meta", meta);
  }
  for (const o of originals) await ctx.api.store.remove(o.id);
  return { report: r };
}

/** Annule la fusion : retire des fiches les liens POSÉS PAR LA FUSION et remet l'ancien carnet à sa place. Les personnes créées dans Contacts y restent (rien n'y est supprimé). */
export async function undoMerge(ctx) {
  const meta = await loadMeta(ctx);
  if (!meta) return false;
  for (const [partnerId, added] of Object.entries(meta.data.added)) {
    const partner = await ctx.api.store.get(partnerId);
    if (!partner) continue;
    const ids = linksOf(partner).filter((id) => !added.includes(id));
    await ctx.api.store.update(partnerId, { ...partner.data, contactIds: ids, updatedBy: "merge-undo" });
  }
  const archive = await all(ctx, "legacyContacts");
  const present = new Set((await all(ctx, "contacts")).map((r) => r.id));
  for (const r of archive) {
    const { _legacyId, _createdAt, ...data } = r.data;
    if (!present.has(_legacyId)) await ctx.api.store.add("contacts", data);
  }
  for (const r of archive) await ctx.api.store.remove(r.id);
  await ctx.api.store.remove(meta.id);
  return true;
}


/** Sauvegarde lisible : l'ancien carnet de contacts (avant ou après la fusion), à relire sans le framework. */
export async function legacyBackup(ctx) {
  const items = await loadLegacy(ctx);
  if (!items.length) return [];
  const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const partners = new Map((await all(ctx, "partners")).map((p) => [p.id, p.data.brand]));
  const head = ["id", "partner", "name", "role", "organisation", "email", "phone", "relation", "notes", "status"];
  const rows = items.map((i) => [i.id, partners.get(i.partnerId) ?? i.partnerId, i.name, i.role, i.organisation, i.email || i.rawEmail, i.phone, i.relation, i.notes, i.status].map(cell).join(","));
  return [{ path: "legacy-contacts.csv", content: `\uFEFF${[head.map(cell).join(","), ...rows].join("\r\n")}\r\n` }];
}

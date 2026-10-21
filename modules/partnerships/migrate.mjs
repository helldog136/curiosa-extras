// MIGRATION À RETIRER EN PHASE 3 (maintenance, deux semaines après la sortie de « Contacts 2.0 »).
// Partenariats ne porte plus de carnet de contacts : les personnes sont dans Contacts. Ce fichier reprend, UNE FOIS, ce que le carnet de la version
// précédente contenait encore (collection « contacts », ou sa copie « legacyContacts » laissée par l'écran de fusion de la 1.x) :
//   • cas SÛRS (mêmes règles que l'ancien écran de fusion : même e-mail, ou même nom + même organisation) → la personne est créée dans Contacts, ou liée si elle y est déjà ;
//   • cas DOUTEUX (même e-mail mais autre nom, même nom avec une autre organisation ou un autre e-mail, plusieurs candidats, nom manquant) → une fiche Contacts
//     « à vérifier », avec la note « Repris de Partenariats : à vérifier » ; jamais fusionnée avec une fiche existante ;
//   • les identifiants de fiches (`contactIds`) déjà présents ne sont pas touchés ; la copie « legacyContacts » reste INERTE (jamais relue une fois la reprise finie).
// Elle ne perd rien : les originaux ne sont retirés qu'après une copie vérifiée ET le dernier cas réglé ; sans Contacts 2 (absent, trop ancien, muet),
// rien n'est écrit et la reprise recommence à la prochaine ouverture de l'administration. Rejouable : un cas réglé est noté, Contacts ne crée jamais deux fois la même personne.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { clip, readAll } = await import(`./data.mjs${v}`);
const { MAX_LINKS, ID_MAX, linksOf, setLinks, book, timing } = await import(`./contacts-link.mjs${v}`);

export const key = (x) => clip(String(x ?? ""), 400).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
export const tokens = (x) => key(x).split(/[^a-z0-9]+/).filter(Boolean);
/** Deux noms peuvent désigner la même personne : identiques, ou l'un contient tous les mots de l'autre (« Marie » / « Marie Dupont »). */
export const compatibleNames = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return true;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  return small.every((w) => big.includes(w));
};
export const validEmail = (x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Une personne du carnet d'avant (collection « contacts » ou sa copie « legacyContacts »), remise en forme. */
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
  const [old, kept] = await Promise.all([readAll(ctx, "contacts"), readAll(ctx, "legacyContacts")]);
  const keptIds = new Set(kept.map((r) => String(r.data._legacyId ?? "")));
  return [...kept.map((r) => legacyItem(r, true)), ...old.filter((r) => !keptIds.has(r.id)).map((r) => legacyItem(r, false))].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

// L'état de la reprise : le document « contactsMerge » de la collection « meta » (déjà écrit par l'écran de fusion de la 1.x : `mapping` = ancien id → fiche Contacts,
// `dismissed` = laissés de côté). La 2.0 y ajoute `v2` = { done, at, report, failed }.
export const EMPTY_META = () => ({ kind: "contactsMerge", at: "", mapping: {}, added: {}, created: [], dismissed: [], report: null });
export const EMPTY_REPORT = () => ({ link: 0, created: 0, check: 0, failed: 0, unlinked: 0 });
export async function loadMeta(ctx) {
  const rows = await ctx.api.store.list("meta", { limit: 50 });
  const r = rows.find((x) => x.data?.kind === "contactsMerge");
  return r ? { id: r.id, data: { ...EMPTY_META(), ...r.data } } : null;
}
export async function migrationState(ctx) {
  const [items, meta] = await Promise.all([loadLegacy(ctx), loadMeta(ctx)]);
  const failed = new Set(meta?.data.v2?.failed ?? []);
  const settled = (i) => !!meta && (has(meta.data.mapping, i.id) || meta.data.dismissed.includes(i.id) || failed.has(i.id));
  return { items, meta, pending: items.filter((i) => !settled(i)) };
}
/** Reste-t-il quelque chose à faire ? (lecture légère : sans ancien carnet ni reprise en cours, aucune collection n'est lue en entier.) */
export async function migrationDue(ctx) {
  const meta = await loadMeta(ctx);
  if (meta?.data.v2?.done) return false;
  if (meta) return true;
  return (await ctx.api.store.count("contacts")) > 0;
}

/** Contacts 2 répond-il, avec les méthodes de la v2 ? (absent, trop ancien ou muet → non.) */
export async function bookReady(ctx) {
  const r = await book(ctx, "categories", { limit: 1 });
  return r.ok === true;
}

class Unavailable extends Error {}
const need = (res) => { if (!res.ok && res.unavailable) throw new Unavailable("contacts unavailable"); return res; };

/**
 * Ce qu'on fait d'UNE personne (ne modifie rien) :
 *   link   déjà dans Contacts (même e-mail, ou sans e-mail : même nom + même organisation) → on la lie ;
 *   create personne inconnue → on la crée ;
 *   check  doute → fiche « à vérifier », jamais fusionnée avec une fiche existante.
 */
export async function planItem(ctx, item) {
  const find = async (args) => need(await book(ctx, "find", { ...args, limit: 100 })).contacts ?? [];
  if (!item.name) return { kind: "check", reason: "incomplete" };
  if (item.email) {
    const found = await find({ email: item.email });
    if (found.length) {
      const same = found.find((c) => compatibleNames(c.name, item.name));
      return same ? { kind: "link", contact: same } : { kind: "check", reason: "email_other_name" };
    }
    const byName = (await find({ name: item.name })).filter((c) => key(c.organisation) === key(item.organisation) && c.email);
    if (byName.length) return { kind: "check", reason: "same_name_other_email" };
    return { kind: "create" };
  }
  const found = await find({ name: item.name });
  const exact = found.filter((c) => key(c.organisation) === key(item.organisation));
  if (exact.length === 1) return { kind: "link", contact: exact[0] };
  if (exact.length > 1) return { kind: "check", reason: "several" };
  if (found.length) return { kind: "check", reason: "same_name_other_org" };
  return { kind: "create" };
}

/** Copie les originaux (collection « contacts ») dans « legacyContacts », puis vérifie. Rejouable ; ne retire rien. */
async function archiveOriginals(ctx) {
  const originals = await readAll(ctx, "contacts");
  if (!originals.length) return true;
  const kept = new Set((await readAll(ctx, "legacyContacts")).map((r) => String(r.data._legacyId ?? "")));
  for (const r of originals) if (!kept.has(r.id)) await ctx.api.store.add("legacyContacts", { ...r.data, _legacyId: r.id, _createdAt: r.createdAt.toISOString() });
  const copied = new Set((await readAll(ctx, "legacyContacts")).map((r) => String(r.data._legacyId ?? "")));
  return originals.every((r) => copied.has(r.id));
}

const running = new Set();

/**
 * Lance (ou reprend) la reprise. Ne lève jamais. Rend { state: "none" | "done" | "waiting" | "busy" | "error", pending, report }.
 *   waiting : Contacts 2 absent, trop ancien, muet, ou temps imparti écoulé ; ce qui est réglé est noté, le reste attend la prochaine ouverture.
 */
export async function runMigration(ctx) {
  const guard = String(ctx.instance?.key ?? "partnerships");
  if (running.has(guard)) return { state: "busy" };
  running.add(guard);
  try { return await run(ctx); } catch { return { state: "error" }; } finally { running.delete(guard); }
}

async function run(ctx) {
  const t = typeof ctx.t === "function" ? ctx.t : (k) => k;
  const started = Date.now();
  const state = await migrationState(ctx);
  if (state.meta?.data.v2?.done) return { state: "done", report: state.meta.data.v2.report };
  if (!state.items.length && !state.meta) return { state: "none" };
  const meta = state.meta?.data ?? EMPTY_META();
  meta.v2 = { done: false, at: "", failed: [], ...meta.v2, report: { ...EMPTY_REPORT(), ...meta.v2?.report } };
  let metaId = state.meta?.id ?? null;
  const save = async () => { if (metaId) await ctx.api.store.update(metaId, meta); else metaId = await ctx.api.store.add("meta", meta); };
  const waiting = () => ({ state: "waiting", pending: left, report: meta.v2.report });
  let left = state.pending.length;

  if (state.pending.length) {
    if (!(await bookReady(ctx))) return waiting(); // rien n'est écrit : Contacts 2 n'est pas (encore) là
    if (!(await archiveOriginals(ctx))) return { state: "error", pending: left };
    const partners = new Map();
    const partnerOf = async (id) => {
      if (!id) return null;
      if (!partners.has(id)) { const p = await ctx.api.store.get(id); partners.set(id, p && p.data.brand !== undefined ? p : null); }
      return partners.get(id);
    };
    const r = meta.v2.report;
    let sinceSave = 0;
    try {
      for (const item of state.pending) {
        if (Date.now() - started > timing.budgetMs) break;
        const partner = await partnerOf(item.partnerId);
        const brand = partner?.data.brand ?? "";
        const out = await settle(ctx, t, item, brand);
        if (out.error) { meta.v2.failed.push(item.id); r.failed++; left--; sinceSave++; continue; }
        if (out.check) r.check++; else if (out.created) r.created++; else r.link++;
        if (partner) {
          const ids = linksOf(partner);
          if (!ids.includes(out.id)) {
            if (ids.length >= MAX_LINKS) r.unlinked++;
            else await setLinks(ctx, partner, [...ids, out.id], "migration");
          }
        }
        meta.mapping[item.id] = out.id;
        left--;
        if (++sinceSave >= 25) { await save(); sinceSave = 0; }
      }
    } catch (e) {
      if (!(e instanceof Unavailable)) { await save().catch(() => {}); throw e; }
    }
    meta.at = new Date().toISOString();
    await save();
    if (left > 0) return waiting();
  }

  // Tout est réglé : on retire les originaux (la copie vérifiée reste, inerte), puis on marque la fin.
  if (!(await archiveOriginals(ctx))) return { state: "error", pending: 0 };
  for (const o of await readAll(ctx, "contacts")) await ctx.api.store.remove(o.id);
  meta.v2.done = true;
  meta.v2.at = new Date().toISOString();
  await save();
  return { state: "done", report: meta.v2.report };
}

/** Règle UNE personne : { id } (fiche Contacts), avec created / check, ou { error }. Lève Unavailable si Contacts ne répond plus (la reprise s'arrête là). */
async function settle(ctx, t, item, brand) {
  const plan = await planItem(ctx, item);
  const lines = (...parts) => parts.filter(Boolean).join("\n");
  const intro = t("migNoteIntro", { brand });
  if (plan.kind === "link") {
    const c = plan.contact;
    const extra = lines(item.relation && `${t("relation")} : ${item.relation}`, item.notes, item.rawEmail && `${t("email")} : ${item.rawEmail}`);
    const diff = lines(item.role && item.role !== c.role && `${t("role")} : ${item.role}`, item.phone && item.phone !== c.phone && `${t("phone")} : ${item.phone}`, item.organisation && item.organisation !== c.organisation && `${t("organization")} : ${item.organisation}`, extra);
    if (diff) need(await book(ctx, "note", { id: c.id, author: "partnerships", text: `${intro}\n\n${diff}` }));
    return { id: c.id };
  }
  if (plan.kind === "create") {
    const extra = lines(item.notes, item.rawEmail && `${t("email")} : ${item.rawEmail}`);
    const res = need(await book(ctx, "create", { name: item.name, email: item.email, role: item.role, organisation: item.organisation, phone: item.phone, relation: item.relation, status: item.status, source: "partnerships", note: extra ? `${intro}\n\n${extra}` : intro }));
    return res.ok ? { id: res.id, created: res.created === true } : { error: res.error };
  }
  // Doute : une fiche « à vérifier », SANS l'e-mail (qui pourrait rattacher la personne à quelqu'un d'autre) ; l'e-mail est dans la note.
  const detail = lines(t("migNoteCheck"), brand && t("migNoteBrand", { brand }), t(`check_${plan.reason}`), item.email && `${t("email")} : ${item.email}`, item.rawEmail && `${t("email")} : ${item.rawEmail}`, item.relation && `${t("relation")} : ${item.relation}`, item.notes);
  const name = clip(item.name || item.email || item.rawEmail || item.organisation || item.phone || t("migUnnamed"), 120);
  const res = need(await book(ctx, "create", { name, role: item.role, organisation: item.organisation, phone: item.phone, status: "to_review", source: "partnerships", note: detail }));
  if (!res.ok) return { error: res.error };
  if (!res.created) need(await book(ctx, "note", { id: res.id, author: "partnerships", text: detail })); // elle existait déjà (même nom et organisation) : on la signale, sans la modifier
  return { id: res.id, check: true };
}

/** Ce que l'administration montre : une phrase si des personnes attendent Contacts 2, un bilan pendant 30 jours si des fiches sont à vérifier. Lance la reprise si elle est due. */
export async function migrationNotices(ctx) {
  const t = ctx.t;
  try {
    const due = await migrationDue(ctx);
    if (due) {
      const r = await runMigration(ctx);
      if (r.state === "waiting" || r.state === "error") return [{ type: "banner", tone: "warning", text: t("migWaiting", { n: r.pending ?? 0 }) }];
    }
    const meta = await loadMeta(ctx);
    const v2 = meta?.data.v2;
    if (v2?.done && v2.report?.check > 0 && Date.now() - Date.parse(v2.at) < 30 * 86_400_000) return [{ type: "markdown", text: `**${t("migDoneTitle")}** ${t("migDoneText", { n: v2.report.check })}` }];
  } catch { /* jamais d'erreur dans le panneau */ }
  return [];
}

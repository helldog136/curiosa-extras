// Contacts — « tout ce que le site sait de cette personne » (export) et son effacement (RGPD).
//
// Contacts est le SEUL appelant des modules « privacy.subject » (voir subjects.mjs : un appel borné à 8 s par module, tous en parallèle). Un module muet ou
// en panne est listé « n'a pas répondu à temps » ; il ne retarde jamais les autres au-delà de sa propre borne et ne fait jamais échouer l'opération.
//   export  → un fichier JSON : la fiche (avec e-mail et téléphone si la personne qui télécharge y a droit), ses notes, puis ce que chaque module garde.
//   erase   → `erase` du carnet : chaque module efface ses références, PUIS la fiche et ses notes disparaissent ; le bilan dit module par module ce qui s'est passé.
const v = new URL(import.meta.url).search;
const B = await import(`./book.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const S = await import(`./subjects.mjs${v}`);

export const MODULE_EXPORT_MAX = 1_048_576; // 1 Mo par module (le contrat)

/** La fiche complète de la personne, telle qu'elle sort dans l'export. Jamais de secret : une fiche n'en contient pas. */
export async function personRecord(ctx, id, { withContact }) {
  const r = await B.get(ctx, { id });
  if (!r.ok) return null;
  const c = r.contact, d = r.record.data, idx = r.index;
  const notes = [];
  for await (const n of D.allNotes(ctx, id)) { notes.push({ date: n.data.date, author: n.data.author, text: n.data.text }); if (notes.length >= 5000) break; }
  notes.reverse();
  return {
    id: c.id, kind: c.kind, name: c.name, role: c.role, organisation: c.orgName, status: c.status, source: c.source, createdAt: c.createdAt, relation: d.relation || null, others: d.others || null,
    ...(withContact ? { email: c.email, phone: c.phone } : {}),
    categories: c.categoryIds.map((k) => idx.cats.get(k)?.name).filter(Boolean),
    accounts: c.accounts.map((a) => ({ network: a.network, handle: a.handle, url: a.url, ...(a.displayName ? { displayName: a.displayName } : {}), ...(Number.isInteger(a.followers) ? { followers: a.followers } : {}) })),
    photo: d.photo ?? null, notes,
  };
}

/** Ce que chaque module garde sur la personne : [{ module, name, ok, label?, data?, timeout? }]. Une réponse trop grosse est refusée. */
export async function moduleExports(ctx, id) {
  const res = await S.callSubjects(ctx, "export", { contactId: id });
  return res.map((r) => {
    if (!r.ok) return { module: r.module, name: r.name, ok: false, ...(r.timeout ? { timeout: true } : {}) };
    let size = Infinity;
    try { size = JSON.stringify(r.value.data).length; } catch { /* circulaire : refusé */ }
    return size > MODULE_EXPORT_MAX ? { module: r.module, name: r.name, ok: false, tooLarge: true } : { module: r.module, name: r.name, ok: true, label: String(r.value.label).slice(0, 120), data: r.value.data };
  });
}

/** Le fichier JSON de l'export, morceau par morceau (le cœur le sert au fil de l'eau). */
export async function* exportPerson(ctx, id, { withContact }) {
  const person = await personRecord(ctx, id, { withContact });
  if (!person) { yield JSON.stringify({ error: "not_found" }); return; }
  yield `{\n"generatedAt": ${JSON.stringify(new Date().toISOString())},\n"contacts": ${JSON.stringify(person, null, 1)},\n"modules": [\n`;
  const mods = await moduleExports(ctx, id);
  let first = true;
  for (const m of mods) { yield `${first ? "" : ",\n"}${JSON.stringify(m, null, 1)}`; first = false; }
  yield "\n]\n}\n";
}

/** Les modules qui garderont ou effaceront quelque chose (leurs noms), sans rien leur demander : pour dire à la personne ce qui va se passer. */
export async function knownModules(ctx) {
  try {
    const list = await D.within(ctx.api.services.providers(S.SUBJECT), 3000, "providers");
    return (Array.isArray(list) ? list : []).slice(0, 50).map((p) => String(p?.name ?? p?.key ?? "?"));
  } catch { return []; }
}

/** Le bilan de l'effacement : la phrase par module (effacé N · rien à effacer · n'a pas répondu à temps). */
export function bilan(ctx, modules) {
  return modules.map((m) => ({
    module: m.module, name: m.name, ok: m.ok,
    text: !m.ok ? ctx.t("eraseSilent", { name: m.name }) : (m.removed ?? 0) > 0 ? ctx.t((m.removed ?? 0) === 1 ? "eraseRemovedOne" : "eraseRemovedMany", { name: m.name, count: m.removed }) : ctx.t("eraseNothing", { name: m.name }),
  }));
}

/** Efface la personne partout (confirmation déjà prise par l'écran). Rend { ok, modules: bilan } ; le bilan est gardé 30 jours SANS le nom de la personne. */
export async function erasePerson(ctx, id) {
  const r = await B.erase(ctx, { id, confirm: true });
  if (!r.ok) return r;
  const lines = bilan(ctx, r.modules);
  const store = ctx.api.store;
  await store.add("reports", { kind: "erase", at: new Date().toISOString(), modules: lines.map((l) => ({ name: l.name, ok: l.ok, text: l.text })) }, { key: "erase" });
  // On ne garde que les 20 derniers bilans.
  const old = await D.listByKey(ctx, "reports", "erase", { limit: 100 });
  for (const x of (old.items ?? []).slice(20)) await store.remove(x.id);
  return { ok: true, modules: lines };
}
export async function reports(ctx) {
  const p = await D.listByKey(ctx, "reports", "erase", { limit: 20 });
  return (p.items ?? []).map((r) => ({ id: r.id, ...r.data }));
}

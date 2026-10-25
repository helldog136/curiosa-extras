// Soutiens — les gestes de la propriétaire, écrits UNE fois pour l'administration ET pour l'assistant IA (outils MCP) : même règles, mêmes bornes.
// Aucun geste ici ne rend quelqu'un public sans son accord : montrer = accord de la personne (pseudo choisi par elle) + relecture + pas caché + soutien actif.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const S = await import(`./sync.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const { LIMITS, clean, pidOk } = P;

const find = async (ctx, pid) => (pidOk(pid) ? (await D.snapshot(ctx, { fresh: true })).byPid.get(pid) ?? null : null);

/** Le chemin (et l'adresse complète) du lien d'accord d'une personne. `renew` : un nouveau lien, l'ancien cesse de marcher. */
export async function consentLink(ctx, pid, { renew = false } = {}) {
  return D.withLock(ctx, async () => {
    const rec = await find(ctx, pid);
    if (!rec) return { ok: false, code: "unknown" };
    const secret = await D.secretOf(ctx);
    let data = rec.data;
    if (renew) { data = { ...data, gen: (Number(data.gen) || 0) + 1 }; await ctx.api.store.update(rec.id, data); }
    const base = ctx.instance.basePath ? `/${String(ctx.instance.basePath).replace(/^\/+|\/+$/g, "")}` : "";
    const path = `${base}/moi/${pid}/${P.consentToken(secret, pid, data.gen)}`;
    return { ok: true, path, url: `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${path}`, renewed: !!renew };
  });
}

async function change(ctx, pid, fn) {
  const done = await D.withLock(ctx, async () => {
    const rec = await find(ctx, pid);
    if (!rec) return null;
    const before = rec.data;
    const next = fn({ ...before });
    await ctx.api.store.update(rec.id, next);
    return { before, after: next };
  });
  if (!done) return { ok: false, code: "unknown" };
  return { ok: true, ...done };
}

/** Cacher (ou remontrer) un soutien. Remontrer ne suffit jamais : il faut aussi son accord approuvé. */
export async function setHidden(ctx, pid, hidden) {
  const r = await change(ctx, pid, (p) => ({ ...p, hidden: hidden === true }));
  if (r.ok && hidden === true) await C.protectWall(ctx, r.before);
  return r.ok ? { ok: true } : r;
}

/** Approuver ou refuser le pseudo choisi par la personne. Refuser efface son accord (elle peut en proposer un autre sur son lien). */
export async function setApproval(ctx, pid, approve) {
  const r = await change(ctx, pid, (p) => {
    if (!p.consent?.pseudo) return p;
    return approve ? { ...p, approved: true } : { ...p, consent: null, approved: false };
  });
  if (!r.ok) return r;
  if (!r.before.consent?.pseudo) return { ok: false, code: "no_consent" };
  if (!approve) await C.protectWall(ctx, r.before);
  return { ok: true };
}

/** Oublier un soutien : tout ce que le module garde sur la personne disparaît (la fiche de Contacts n'est pas touchée). */
export async function forget(ctx, pid) {
  const rec = await find(ctx, pid);
  if (!rec) return { ok: false, code: "unknown" };
  await C.protectWall(ctx, rec.data);
  await D.withLock(ctx, async () => { const f = await find(ctx, pid); if (f) await D.removePerson(ctx, f); });
  return { ok: true };
}

/** Importer un texte (fichier ou liste collée). → { ok: true, added, updated, ended, skipped } | { ok: false, code, field }. */
export async function importText(ctx, text, { replace = false } = {}) {
  const provider = R.PROVIDERS.csv;
  const parsed = provider.parseRows(text);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  if (!parsed.rows.length) return { ok: false, code: "norows", skipped: parsed.skipped };
  const out = await S.applyRows(ctx, provider, parsed.rows, { replace });
  return { ...out, skipped: parsed.skipped };
}

/** Ranger les soutiens dans Contacts (et, si la catégorie du mur est réglée, la mettre à jour). À n'appeler QUE depuis une action protégée par le droit `contacts.file`. */
export async function fileContacts(ctx) {
  const cat = await C.categoryOf(ctx, "category", [ctx.t("defaultCategory"), ctx.t("defaultCategoryOther")]);
  if (cat.state !== "ok") return { ok: false, code: `cat_${cat.state}` };
  const res = await C.fileSupporters(ctx, cat.id, { platformLabel: R.say(ctx, R.providerOf(ctx).label) });
  let wall = null;
  if (clean(ctx.setting("wallCategory"), 120)) {
    const w = await C.categoryOf(ctx, "wallCategory", []);
    if (w.state === "ok") {
      const { activeDays } = S.knobs(ctx);
      wall = await C.syncWall(ctx, w.id, (p) => P.isShown(p, S.providerOfPerson(ctx, p), activeDays), { allowAdd: true });
    } else wall = { stopped: `cat_${w.state}` };
  }
  return { ...res, wall, category: cat.label };
}

/** Les libellés publics d'un palier (par langue ; vide = retiré). Refuse ce qui ressemble à un montant. */
export async function tierLabel(ctx, k, texts) {
  for (const [loc, text] of Object.entries(texts)) {
    if ([...text].length > LIMITS.label) return { ok: false, code: "long", field: loc };
    if (P.looksLikeAmount(text)) return { ok: false, code: "amount", field: loc };
  }
  return D.setTierLabel(ctx, k, texts);
}

/** Les modèles de départ pour les libellés (gabarits) : appliqués aux paliers du plus bas au plus haut. */
export const TEMPLATES = {
  three: { fr: ["Soutien", "Grand soutien", "Mécène"], en: ["Supporter", "Big supporter", "Patron"] },
  levels: { fr: (i) => `Niveau ${i}`, en: (i) => `Level ${i}` },
  none: null,
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export async function applyTemplate(ctx, id) {
  if (!TEMPLATE_IDS.includes(id)) return { ok: false, code: "unknown" };
  return D.withLock(ctx, async () => {
    const snap = await D.snapshot(ctx, { fresh: true });
    const tiers = [...snap.tiers.values()].sort((a, b) => (a.data.rank ?? 0) - (b.data.rank ?? 0));
    const n = tiers.length;
    let changed = 0;
    for (const [i, t] of tiers.entries()) {
      let label = {};
      const tpl = TEMPLATES[id];
      if (tpl) {
        for (const loc of ctx.locales) {
          const lang = loc === "fr" ? "fr" : "en";
          if (id === "three") { const words = tpl[lang]; const idx = n <= 1 ? 0 : n === 2 ? (i === 0 ? 0 : 2) : Math.min(2, Math.floor((i * 3) / n)); label[loc] = words[idx]; }
          else label[loc] = tpl[lang](i + 1);
        }
      }
      await ctx.api.store.update(t.id, { ...t.data, label }); changed++;
    }
    return { ok: true, changed };
  });
}

/** Nettoyage à la demande : oublie les soutiens arrêtés depuis trop longtemps. */
export async function tidy(ctx) {
  const { keepDays, activeDays } = S.knobs(ctx);
  return D.withLock(ctx, async () => ({ ok: true, removed: await D.purge(ctx, await D.snapshot(ctx, { fresh: true }), { keepDays, activeDays, expiresOf: (p) => !!R.PROVIDERS[p?.provider]?.expires }) }));
}

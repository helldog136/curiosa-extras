// Annuaire — ce que le module GARDE, et rien d'autre. Les personnes (noms, photos, comptes, catégories) restent dans Contacts : elles se relisent à chaque construction (voir contacts.mjs).
//   dir_config   : UN document — { template, vocab, cats: [{ slug, catId, label }], team: [{ contactId, role }] }
//                  cats  = les catégories PUBLIQUES, dans l'ordre choisi (catId = l'identifiant de la catégorie dans Contacts, null tant qu'une catégorie de départ n'est pas reliée) ;
//                  team  = l'équipe, dans l'ordre choisi, avec le titre affiché de chacune (un texte par langue) ;
//                  vocab = les mots de départ d'un gabarit (les Réglages les remplacent).
//   dir_profiles : un document par fiche — { contactId, bio, city, geo, hidden } : la présentation courte écrite ICI (Contacts n'a pas de champ public pour cela),
//                  la ville montrée et ses coordonnées arrondies (pour la carte, avec consentement), et « masquer dans cet annuaire ».
// Toujours rattaché à une fiche par son numéro, jamais un nom, une photo, un compte, un e-mail ni un téléphone.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { LIMITS, clean, idOk, roundGeo, slugOk, slugify, textsOf } = await import(`./pure.mjs${v}`);

export const CONFIG = "dir_config";
export const PROFILES = "dir_profiles";
export const READ_TTL_MS = 30_000;

const memo = new Map();   // instance → { at, gen, config, configId, profiles: Map(contactId → profil) }
const gens = new Map();   // instance → compteur augmenté à chaque écriture (sert à invalider la vue construite)
const chains = new Map(); // instance → fin de la file des écritures (une à la fois : jamais deux lectures-écritures qui s'écrasent)
export const forgetData = (ctx) => { if (ctx) memo.delete(ctx.instance.id); else memo.clear(); };
export const generation = (ctx) => gens.get(ctx.instance.id) ?? 0;
const bump = (ctx) => { gens.set(ctx.instance.id, generation(ctx) + 1); memo.delete(ctx.instance.id); };

/** Une écriture à la fois par annuaire. */
export function locked(ctx, fn) {
  const id = ctx.instance.id;
  const run = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(id, run.catch(() => {}));
  if (chains.size > 50) for (const k of chains.keys()) { if (chains.size <= 40) break; if (k !== id) chains.delete(k); }
  return run;
}

async function readAll(ctx, collection, max) {
  const out = [];
  let cursor = null;
  do {
    const page = typeof ctx.api.store.page === "function"
      ? await ctx.api.store.page(collection, { limit: Math.min(1000, Math.max(1, max - out.length)), cursor, order: "asc" })
      : { items: await ctx.api.store.list(collection, { limit: Math.min(max, 10000) }), next: null };
    out.push(...page.items);
    cursor = page.next;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

/* ───────────── La configuration ───────────── */

export const blankConfig = () => ({ template: "", vocab: {}, cats: [], team: [] });

/** Une configuration lue du stockage → une configuration valide et bornée (un document abîmé ne casse rien). */
export function normalizeConfig(raw) {
  const out = blankConfig();
  if (!raw || typeof raw !== "object") return out;
  out.template = typeof raw.template === "string" ? clean(raw.template, 30) : "";
  if (raw.vocab && typeof raw.vocab === "object") {
    for (const [l, words] of Object.entries(raw.vocab).slice(0, 12)) {
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l) || !words || typeof words !== "object") continue;
      const w = {};
      for (const k of ["title", "noun", "nouns", "team"]) { const t = clean(words[k], 60); if (t) w[k] = t; }
      if (Object.keys(w).length) out.vocab[l] = w;
    }
  }
  const slugs = new Set(), catIds = new Set();
  for (const c of Array.isArray(raw.cats) ? raw.cats : []) {
    if (out.cats.length >= LIMITS.cats) break;
    if (!c || typeof c !== "object" || !slugOk(c.slug) || slugs.has(c.slug)) continue;
    const catId = idOk(c.catId) && !catIds.has(c.catId) ? c.catId : null;
    slugs.add(c.slug);
    if (catId) catIds.add(catId);
    out.cats.push({ slug: c.slug, catId, label: textsOf(c.label, LIMITS.label) });
  }
  const seen = new Set();
  for (const m of Array.isArray(raw.team) ? raw.team : []) {
    if (out.team.length >= LIMITS.team) break;
    if (!m || !idOk(m.contactId) || seen.has(m.contactId)) continue;
    seen.add(m.contactId);
    out.team.push({ contactId: m.contactId, role: textsOf(m.role, LIMITS.role) });
  }
  return out;
}

async function load(ctx, fresh) {
  const hit = memo.get(ctx.instance.id);
  if (!fresh && hit && Date.now() - hit.at < READ_TTL_MS) return hit;
  const gen = generation(ctx);
  const docs = await readAll(ctx, CONFIG, 5);
  const first = docs[0];
  const config = normalizeConfig(first?.data);
  const profiles = new Map();
  for (const r of await readAll(ctx, PROFILES, LIMITS.profiles + 50)) {
    const d = r.data;
    if (!idOk(d?.contactId) || profiles.has(d.contactId)) continue;
    profiles.set(d.contactId, { id: r.id, bio: textsOf(d.bio, LIMITS.bio, true), city: clean(d.city, LIMITS.city), geo: d.geo && roundGeo(d.geo.lat, d.geo.lng) ? roundGeo(d.geo.lat, d.geo.lng) : null, hidden: d.hidden === true });
  }
  const value = { at: Date.now(), gen, config, configId: first?.id ?? null, profiles };
  if (gen === generation(ctx)) memo.set(ctx.instance.id, value); // une écriture arrivée pendant la lecture : on ne garde pas une lecture périmée
  return value;
}

/** { config, profiles: Map(contactId → { id, bio, city, geo, hidden }), gen } ; ne lève pas pour des documents abîmés. */
export async function readData(ctx, { fresh = false } = {}) {
  const v2 = await load(ctx, fresh);
  return { config: v2.config, profiles: v2.profiles, gen: v2.gen };
}

/** Change la configuration : `mutate(config)` la modifie sur place et rend { ok, ... }. Rien n'est écrit si `ok` est faux. */
export function updateConfig(ctx, mutate) {
  return locked(ctx, async () => {
    const cur = await load(ctx, true);
    const config = structuredClone(cur.config);
    const result = await mutate(config);
    if (!result || result.ok === false) return result ?? { ok: false, code: "invalid" };
    const next = normalizeConfig(config);
    if (cur.configId) await ctx.api.store.update(cur.configId, next); else await ctx.api.store.add(CONFIG, next);
    bump(ctx);
    return result;
  });
}

/* ───────────── Les catégories publiques ───────────── */

/** Une adresse libre pour une catégorie : son premier libellé, sinon « categorie » ; jamais deux identiques ; stable ensuite. */
export function freeSlug(config, text) {
  const base = slugify(text, 30) || "categorie";
  const used = new Set(config.cats.map((c) => c.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`.slice(0, 40);
}

/** Rend publiques ces catégories de Contacts : [{ catId, label }] (label = nom dans Contacts, point de départ du libellé public). Rend { ok, added, full }. */
export function addCategories(ctx, items) {
  return updateConfig(ctx, (config) => {
    let added = 0, full = false;
    const have = new Set(config.cats.map((c) => c.catId).filter(Boolean));
    for (const it of items) {
      if (!idOk(it?.catId) || have.has(it.catId)) continue;
      if (config.cats.length >= LIMITS.cats) { full = true; break; }
      const label = clean(it.label, LIMITS.label);
      config.cats.push({ slug: freeSlug(config, label), catId: it.catId, label: label ? { [ctx.defaultLocale]: label } : {} });
      have.add(it.catId); added++;
    }
    return { ok: true, added, full };
  });
}

export const removeCategory = (ctx, slug) => updateConfig(ctx, (config) => {
  const n = config.cats.length;
  config.cats = config.cats.filter((c) => c.slug !== slug);
  return { ok: config.cats.length < n };
});

/** Monte (-1) ou descend (+1) une catégorie ou un membre d'équipe. */
function moveIn(list, index, dir) {
  const j = index + (dir < 0 ? -1 : 1);
  if (index < 0 || j < 0 || j >= list.length) return false;
  [list[index], list[j]] = [list[j], list[index]];
  return true;
}
export const moveCategory = (ctx, slug, dir) => updateConfig(ctx, (config) => ({ ok: moveIn(config.cats, config.cats.findIndex((c) => c.slug === slug), dir) }));
export const setCategoryLabel = (ctx, slug, label) => updateConfig(ctx, (config) => {
  const c = config.cats.find((x) => x.slug === slug);
  if (!c) return { ok: false, code: "gone" };
  c.label = textsOf(label, LIMITS.label);
  return { ok: true };
});
/** Relie une catégorie de départ (sans catégorie de Contacts) à une catégorie de Contacts. */
export const bindCategory = (ctx, slug, catId) => updateConfig(ctx, (config) => {
  const c = config.cats.find((x) => x.slug === slug);
  if (!c || !idOk(catId)) return { ok: false, code: "gone" };
  if (config.cats.some((x) => x.catId === catId && x.slug !== slug)) return { ok: false, code: "duplicate" };
  c.catId = catId;
  return { ok: true };
});
/** Une catégorie fusionnée dans Contacts : on suit (ancien → actuel). Si la catégorie qui reste est déjà publique ailleurs dans la liste, l'entrée devenue doublon est retirée. */
export const followCategories = (ctx, moved) => updateConfig(ctx, (config) => {
  let n = 0;
  for (const c of [...config.cats]) {
    const to = c.catId ? moved[c.catId] : null;
    if (!idOk(to) || to === c.catId) continue;
    if (config.cats.some((x) => x !== c && x.catId === to)) config.cats = config.cats.filter((x) => x !== c);
    else c.catId = to;
    n++;
  }
  return { ok: n > 0, followed: n };
});

/* ───────────── L'équipe ───────────── */

export const addTeamMember = (ctx, contactId, role) => updateConfig(ctx, (config) => {
  if (!idOk(contactId)) return { ok: false, code: "invalid" };
  const roleTexts = textsOf(role, LIMITS.role);
  const have = config.team.find((m) => m.contactId === contactId);
  if (have) { have.role = roleTexts; return { ok: true, updated: true }; }
  if (config.team.length >= LIMITS.team) return { ok: false, code: "too_many" };
  config.team.push({ contactId, role: roleTexts });
  return { ok: true };
});
export const removeTeamMember = (ctx, contactId) => updateConfig(ctx, (config) => {
  const n = config.team.length;
  config.team = config.team.filter((m) => m.contactId !== contactId);
  return { ok: config.team.length < n };
});
export const moveTeamMember = (ctx, contactId, dir) => updateConfig(ctx, (config) => ({ ok: moveIn(config.team, config.team.findIndex((m) => m.contactId === contactId), dir) }));

/* ───────────── Les fiches publiques ───────────── */

/** Change la fiche publique d'une personne : `patch` = { bio?, city?, geo?, hidden? } ; une fiche sans rien est retirée. Rend { ok } ou { ok: false, code: "too_many" | "invalid" }. */
export function patchProfile(ctx, contactId, patch) {
  return locked(ctx, async () => {
    if (!idOk(contactId)) return { ok: false, code: "invalid" };
    const cur = await load(ctx, true);
    const old = cur.profiles.get(contactId);
    const next = {
      contactId,
      bio: patch.bio !== undefined ? textsOf(patch.bio, LIMITS.bio, true) : old?.bio ?? {},
      city: patch.city !== undefined ? clean(patch.city, LIMITS.city) : old?.city ?? "",
      geo: patch.geo !== undefined ? (patch.geo ? roundGeo(patch.geo.lat, patch.geo.lng) : null) : old?.geo ?? null,
      hidden: patch.hidden !== undefined ? patch.hidden === true : old?.hidden === true,
    };
    if (!next.city) next.geo = null; // pas de ville, pas de coordonnées
    const empty = !Object.keys(next.bio).length && !next.city && !next.geo && !next.hidden;
    if (empty) { if (old) await ctx.api.store.remove(old.id); bump(ctx); return { ok: true, removed: !!old }; }
    if (old) await ctx.api.store.update(old.id, next);
    else {
      if (cur.profiles.size >= LIMITS.profiles) return { ok: false, code: "too_many" };
      await ctx.api.store.add(PROFILES, next);
    }
    bump(ctx);
    return { ok: true };
  });
}

/* ───────────── Vie privée : tout ce que le module sait d'une fiche ───────────── */

/** Ce qui vise cette fiche : sa fiche publique et sa place dans l'équipe. */
export async function referencesOf(ctx, contactId) {
  const data = await readData(ctx, { fresh: true });
  return { profile: data.profiles.get(contactId) ?? null, team: data.config.team.find((m) => m.contactId === contactId) ?? null };
}

/** Efface tout ce qui vise cette fiche ; rend le nombre de documents retirés (la place dans l'équipe compte pour un). */
export function eraseReferences(ctx, contactId) {
  return locked(ctx, async () => {
    let removed = 0;
    for (const r of await readAll(ctx, PROFILES, LIMITS.profiles + 50)) if (r.data?.contactId === contactId) { await ctx.api.store.remove(r.id); removed++; }
    const cur = await load(ctx, true);
    if (cur.config.team.some((m) => m.contactId === contactId)) {
      const config = { ...cur.config, team: cur.config.team.filter((m) => m.contactId !== contactId) };
      if (cur.configId) await ctx.api.store.update(cur.configId, config);
      removed++;
    }
    bump(ctx);
    return removed;
  });
}

/** Une fiche en a absorbé une autre : sa fiche publique et sa place dans l'équipe passent sur `to` (ce qui existe déjà pour `to` n'est jamais écrasé). Rend le nombre de documents changés. */
export function remapReferences(ctx, from, to) {
  return locked(ctx, async () => {
    let updated = 0;
    const cur = await load(ctx, true);
    let targetHas = cur.profiles.has(to);
    for (const r of await readAll(ctx, PROFILES, LIMITS.profiles + 50)) {
      if (r.data?.contactId !== from) continue;
      if (targetHas) await ctx.api.store.remove(r.id); else { await ctx.api.store.update(r.id, { ...r.data, contactId: to }); targetHas = true; }
      updated++;
    }
    const mFrom = cur.config.team.find((m) => m.contactId === from);
    if (mFrom && cur.configId) {
      const team = cur.config.team.some((m) => m.contactId === to) ? cur.config.team.filter((m) => m.contactId !== from) : cur.config.team.map((m) => (m.contactId === from ? { ...m, contactId: to } : m));
      await ctx.api.store.update(cur.configId, { ...cur.config, team });
      updated++;
    }
    bump(ctx);
    return updated;
  });
}

/** Les numéros de fiche gardés (fiches publiques et équipe), sans doublon : de quoi vérifier qu'ils existent encore chez Contacts. */
export async function keptIds(ctx) {
  const data = await readData(ctx, { fresh: true });
  return [...new Set([...data.profiles.keys(), ...data.config.team.map((m) => m.contactId)])];
}

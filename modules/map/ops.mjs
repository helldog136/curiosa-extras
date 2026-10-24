// Carte : les écritures partagées par l'administration, l'import de fichier et l'assistant IA (une seule façon d'ajouter ou de changer un lieu).
// Tout ce qui arrive est traité comme non fiable : on nettoie, on valide, on borne. Rien n'est publié par l'assistant : ses lieux restent des brouillons.
// Les fichiers voisins sont importés avec la même « version » que celui-ci.

const q = new URL(import.meta.url).search;
const { clean, fold, slugify, safeHref, LIMITS } = await import(new URL(`./text.mjs${q}`, import.meta.url).href);
const { positionFromForm } = await import(new URL(`./geo.mjs${q}`, import.meta.url).href);
const { C, world, invalidate, locked, newCode, nextPos, getRow, renumber } = await import(new URL(`./data.mjs${q}`, import.meta.url).href);

/** Brouillons que l'assistant peut laisser en attente de relecture (au-delà, il doit attendre que l'équipe les traite). */
export const ASSISTANT_DRAFTS = 200;

/**
 * Valide les champs d'un lieu. `values` : textes (formulaire, fichier ou assistant). Rend { ok: true, value } ou { ok: false, errors: { champ: message } }.
 * Les messages disent quoi faire, avec un exemple, et sont traduits.
 */
export function checkPlace(ctx, values, types) {
  const errors = {};
  const name = clean(values.name, LIMITS.name);
  if (!name) errors.name = ctx.t("errName");
  let type = String(values.type ?? "").trim();
  if (type) {
    const wanted = fold(type);
    const hit = types.find((t) => t.id === type.toLowerCase() || Object.values(t.names).some((n) => fold(n) === wanted) || t.id === slugify(type));
    if (!hit) errors.type = ctx.t("errType", { types: types.map((t) => t.id).join(", ") || "-" });
    else type = hit.id;
  } else if (types.length) type = types[0].id;
  const pos = positionFromForm({ link: values.mapLink, lat: values.lat, lng: values.lng });
  if (!pos.ok) errors[pos.field] = ctx.t(`errPos_${pos.reason}`);
  const url = clean(values.url, LIMITS.url);
  if (url && !/^https?:\/\/[^\s<>"'`\\]{3,}$/i.test(url)) errors.url = ctx.t("errUrl");
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name, type, lat: pos.lat, lng: pos.lng, fromLink: !!pos.fromLink,
      address: clean(values.address, LIMITS.address), desc: clean(values.description ?? values.desc, LIMITS.desc, true),
      hours: clean(values.hours, LIMITS.hours, true), url: url ? safeHref(url) ?? "" : "",
    },
  };
}

/** Clé de comparaison pour reconnaître un doublon : même nom, même endroit (à 1 mètre près). */
export const dupKey = (name, lat, lng) => `${fold(name)}|${lat.toFixed(5)}|${lng.toFixed(5)}`;

/** Ajoute un lieu (« brouillon » ou « publié »). Rend { ok: true, code, rowId } ou { ok: false, reason: "full" | "drafts" }. `by` : "admin", "import" ou "assistant". */
export async function addPlace(ctx, value, { status = "draft", by = "admin" } = {}) {
  return locked(ctx, async () => {
    invalidate(ctx);
    const w = await world(ctx);
    if (w.places.length >= LIMITS.places) return { ok: false, reason: "full" };
    if (by === "assistant" && w.places.filter((p) => p.by === "assistant" && p.status === "draft").length >= ASSISTANT_DRAFTS) return { ok: false, reason: "drafts" };
    const code = newCode(new Set(w.places.map((p) => p.code)));
    const rowId = await ctx.api.store.add(C.places, {
      code, name: value.name, type: value.type, lat: value.lat, lng: value.lng, address: value.address, desc: value.desc, hours: value.hours, url: value.url,
      status: status === "published" ? "published" : "draft", pos: nextPos(w.places), by,
    });
    invalidate(ctx);
    return { ok: true, code, rowId };
  });
}

/** Change un lieu (tous ses champs saisis). Rend { ok: true } ou { ok: false, reason: "missing" }. */
export async function updatePlace(ctx, rowId, value, status) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, rowId, "place");
    if (!row) return { ok: false, reason: "missing" };
    const d = row.data;
    await ctx.api.store.update(rowId, {
      ...d, name: value.name, type: value.type, lat: value.lat, lng: value.lng, address: value.address, desc: value.desc, hours: value.hours, url: value.url,
      status: status ?? (d.status === "published" ? "published" : "draft"),
    });
    invalidate(ctx);
    return { ok: true };
  });
}

export async function setStatus(ctx, rowId, status) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, rowId, "place");
    if (!row) return false;
    if (row.data.status !== status) await ctx.api.store.update(rowId, { ...row.data, status });
    invalidate(ctx);
    return true;
  });
}

export async function removePlace(ctx, rowId) {
  return locked(ctx, async () => {
    const row = await getRow(ctx, rowId, "place");
    if (!row) return false;
    await ctx.api.store.remove(rowId);
    invalidate(ctx);
    return true;
  });
}

/** Échange le rang d'une ligne (lieu, type) avec sa voisine dans l'ordre complet (haut ou bas). `pick` choisit la liste dans les données de l'instance. */
export async function moveRow(ctx, pick, rowId, dir) {
  return locked(ctx, async () => {
    invalidate(ctx);
    let list = pick(await world(ctx));
    // deux lignes au même rang ne s'échangent pas : on remet d'abord les rangs en 1..n
    if (new Set(list.map((x) => x.pos)).size !== list.length) { await renumber(ctx, list); invalidate(ctx); list = pick(await world(ctx)); }
    const at = list.findIndex((x) => x.rowId === rowId);
    const to = at + (dir < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= list.length) return false;
    const [ra, rb] = await Promise.all([ctx.api.store.get(list[at].rowId), ctx.api.store.get(list[to].rowId)]);
    if (!ra || !rb) return false;
    await ctx.api.store.update(list[at].rowId, { ...ra.data, pos: list[to].pos });
    await ctx.api.store.update(list[to].rowId, { ...rb.data, pos: list[at].pos });
    invalidate(ctx);
    return true;
  });
}
export const movePlace = (ctx, rowId, dir) => moveRow(ctx, (w) => w.places, rowId, dir);
export const moveType = (ctx, rowId, dir) => moveRow(ctx, (w) => w.types, rowId, dir);

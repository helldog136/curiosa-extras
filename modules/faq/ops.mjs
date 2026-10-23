// Questions fréquentes : les écritures partagées par l'administration et par l'assistant IA.
// Toutes supposent d'être appelées DANS `locked(ctx, …)` (une écriture à la fois par instance).
// Règle de fond : l'assistant IA n'a accès qu'à `createDraft` et `updateDraft` ; seul `publishRow` (humain) rend une réponse visible.

import { C, getRow, loadItems, loadAsked, loadThemes, siblings, nextPos, uniqueSlug } from "./data.mjs";
import { LIMITS, fold } from "./text.mjs";

/** Un thème désigné par son identifiant ou par son nom (accents et majuscules ignorés). `null` si aucun ne correspond. */
export function resolveTheme(themes, ref) {
  const wanted = String(ref ?? "").trim();
  if (!wanted) return null;
  const byId = themes.find((t) => t.id === wanted);
  if (byId) return byId;
  const key = fold(wanted);
  return themes.find((t) => Object.values(t.names).some((n) => fold(n) === key)) ?? null;
}

/** Ce qui est écrit dans une question : au moins une langue complète pour la publier. */
export const complete = (tr) => Object.values(tr ?? {}).some((v) => v?.q && v?.a);

/** Crée une question. Renvoie l'identifiant, ou `null` si le plafond est atteint. */
export async function createRow(ctx, { tr, theme = "", status = "draft", by = "admin", from = "", source = "" }) {
  const items = await loadItems(ctx);
  if (items.length >= LIMITS.items) return null;
  const first = tr[ctx.defaultLocale]?.q || Object.values(tr).map((v) => v.q).find(Boolean) || "";
  const pos = nextPos(siblings(items, theme));
  const data = { slug: uniqueSlug(items, first), theme, pos, status, tr, y: 0, n: 0, by };
  if (from) data.from = from;
  if (source) data.source = String(source).slice(0, 60);
  return ctx.api.store.add(C.items, data);
}

/** Relie une question reçue à son brouillon (elle reste dans la boîte jusqu'à la publication). */
export async function linkAsked(ctx, askedId, itemId) {
  const row = await getRow(ctx, askedId, "asked");
  if (row) await ctx.api.store.update(askedId, { ...row.data, status: "drafted", draft: itemId });
}

/** Rend une question visible (à la fin de son thème) et vide la boîte de la question reçue qui lui correspond. Renvoie `false` si elle n'est pas publiable. */
export async function publishRow(ctx, id) {
  const row = await getRow(ctx, id, "item");
  if (!row) return false;
  if (!complete(row.data.tr)) return false;
  const items = await loadItems(ctx);
  const theme = typeof row.data.theme === "string" ? row.data.theme : "";
  const wasPublished = row.data.status === "published";
  await ctx.api.store.update(id, { ...row.data, status: "published", pos: wasPublished ? row.data.pos : nextPos(siblings(items, theme)) });
  for (const a of await loadAsked(ctx)) if (a.draft === id) await ctx.api.store.remove(a.id);
  return true;
}

/** Supprime une question ; la question reçue qui s'y rattachait redevient « à traiter ». */
export async function deleteRow(ctx, id) {
  await ctx.api.store.remove(id);
  for (const a of await loadAsked(ctx)) {
    if (a.draft !== id) continue;
    const row = await getRow(ctx, a.id, "asked");
    if (row) await ctx.api.store.update(a.id, { ...row.data, status: "new", draft: "" });
  }
}

/** Les thèmes dans l'ordre, pour un menu. */
export const themeList = (ctx) => loadThemes(ctx);

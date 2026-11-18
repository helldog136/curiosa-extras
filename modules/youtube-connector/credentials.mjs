// Les codes d'accès du Connecteur : UN document `credential` dans le stockage de l'instance (jamais affiché, jamais renvoyé par un service) :
//   apiKey              le code d'accès YouTube ; oauthClientId / oauthClientSecret : le client Google du compte YouTube (facultatif) ;
//   carried             les champs repris d'un autre module (`adopt`) : « Oublier » n'efface que ceux-là.
// Avant la 1.5, ces trois valeurs étaient des réglages du module (devenus `legacySettings`, migrés ici une fois : voir migrateSettings) et le document ne contenait que la clé reprise.
export const COLLECTION = "credential";
export const FIELDS = ["apiKey", "oauthClientId", "oauthClientSecret"];
const text = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

async function docOf(ctx) {
  const rows = await ctx.api.store.list(COLLECTION, { limit: 5 });
  return rows.find((r) => FIELDS.some((f) => text(r.data?.[f]))) ?? null;
}
/** { id, apiKey, oauthClientId, oauthClientSecret, carried } ; les champs absents sont "". Un document d'avant la 1.5 ne contient qu'une clé reprise. */
export async function read(ctx) {
  const doc = await docOf(ctx);
  const d = doc?.data ?? {};
  const carried = Array.isArray(d.carried) ? d.carried.filter((f) => FIELDS.includes(f)) : text(d.apiKey) ? ["apiKey"] : [];
  return { id: doc?.id ?? null, apiKey: text(d.apiKey), oauthClientId: text(d.oauthClientId), oauthClientSecret: text(d.oauthClientSecret), carried: carried.filter((f) => text(d[f])) };
}
/** Écrit les champs donnés ; `carried: true` les note « repris », sinon ils sont « à vous ». Un champ "" est effacé ; sans plus rien, le document disparaît. */
export async function save(ctx, patch, { carried = false } = {}) {
  const cur = await read(ctx);
  const next = { apiKey: cur.apiKey, oauthClientId: cur.oauthClientId, oauthClientSecret: cur.oauthClientSecret };
  const flags = new Set(cur.carried);
  for (const [k, v] of Object.entries(patch)) {
    if (!FIELDS.includes(k)) continue;
    next[k] = text(v);
    if (carried && next[k]) flags.add(k); else flags.delete(k);
  }
  const data = { ...Object.fromEntries(Object.entries(next).filter(([, v]) => v)), carried: [...flags].filter((f) => next[f]).sort(), at: new Date().toISOString() };
  const rows = await ctx.api.store.list(COLLECTION, { limit: 5 });
  for (const extra of rows.filter((r) => r.id !== cur.id)) await ctx.api.store.remove(extra.id);
  if (!FIELDS.some((f) => next[f])) { if (cur.id) await ctx.api.store.remove(cur.id); return; }
  if (cur.id) await ctx.api.store.update(cur.id, data); else await ctx.api.store.add(COLLECTION, data);
}
/** Oublie les valeurs reprises d'un autre module ; ce qui a été saisi ici reste. */
export async function forgetCarried(ctx) {
  const cur = await read(ctx);
  if (!cur.carried.length) return;
  await save(ctx, Object.fromEntries(cur.carried.map((f) => [f, ""])));
}
/**
 * Migration (données en version 2) : les trois réglages d'avant passent dans le document (« à vous ») ; la clé que le document contenait déjà était reprise.
 * Rejouable : un réglage n'est effacé qu'après l'écriture.
 */
export async function migrateSettings(ctx) {
  const get = async (k) => { try { return text(await ctx.legacy?.get(k)); } catch { return ""; } };
  const own = { apiKey: await get("apiKey"), oauthClientId: await get("oauthClientId"), oauthClientSecret: await get("oauthClientSecret") };
  const patch = Object.fromEntries(Object.entries(own).filter(([, v]) => v));
  const cur = await read(ctx);
  if (cur.id && !Array.isArray((await docOf(ctx))?.data?.carried)) await save(ctx, {}, {});   // fixe `carried` sur un document d'avant
  if (Object.keys(patch).length) await save(ctx, patch);
  for (const k of Object.keys(own)) { try { if (ctx.legacy && (await ctx.legacy.get(k)) !== null) await ctx.legacy.clear(k); } catch { /* clé absente */ } }
}

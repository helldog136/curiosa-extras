// Contacts — l'appel des modules « privacy.subject » (contrat 11.4) : export, effacement, fusion d'une fiche.
// Contacts est le SEUL appelant : il demande à chaque fournisseur (Raid, Story, Partenariats…), un par un via `call(…, { provider })`,
// avec une attente bornée PAR fournisseur (8 s ; raccourcie en test). Un module muet, en panne ou absent est listé `ok: false` dans le bilan,
// sans retarder les autres au-delà de sa propre borne et sans jamais faire échouer l'opération.
// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { within, privacyMs } = await import(`./data.mjs${v}`);

export const SUBJECT = "privacy.subject";
const okShape = (method, v) => {
  if (!v || typeof v !== "object") return false;
  if (method === "export") return typeof v.label === "string" && "data" in v;
  const k = method === "erase" ? "removed" : "updated";
  return Number.isInteger(v[k]) && v[k] >= 0;
};

/**
 * Appelle `method` chez tous les fournisseurs. Rend [{ module, name, ok, value?, timeout? }] (un élément par fournisseur, dans l'ordre de `providers()`).
 * `module` = la clé de l'instance fournisseuse (identifiant stable), `name` = son nom lisible (pour la phrase « … n'a pas répondu »).
 */
export async function callSubjects(ctx, method, args) {
  const services = ctx.api?.services;
  if (!services || typeof services.providers !== "function") return [];
  let providers = [];
  try { providers = await within(services.providers(SUBJECT), privacyMs(ctx), "providers"); } catch { return []; }
  if (!Array.isArray(providers)) return [];
  const ms = privacyMs(ctx);
  return Promise.all(providers.slice(0, 50).map(async (p) => {
    const module = String(p?.key ?? p?.id ?? "?"), name = String(p?.name ?? module);
    try {
      const r = await within(services.call(SUBJECT, method, args, { provider: p.id }), ms, "privacy.subject");
      return r?.ok && okShape(method, r.value) ? { module, name, ok: true, value: r.value } : { module, name, ok: false };
    } catch (e) {
      return { module, name, ok: false, ...(e?.code === "busy" ? { timeout: true } : {}) };
    }
  }));
}

// Contacts — l'ajout rapide d'une personne : quelles plateformes proposer, et laquelle était la dernière choisie.
//
// Les plateformes proposées viennent de ce que le site sait déjà faire, jamais d'une liste figée :
//   1. celles dont le CONNECTEUR est installé (Twitch par le service `twitch.api`, YouTube par `youtube.api` : deux besoins facultatifs du module, jamais obligatoires) ;
//   2. celles qui ont déjà au moins un compte dans le carnet (la même liste que les filtres de la liste des contacts) ;
//   3. si ni l'un ni l'autre : les plateformes les plus courantes, avec une phrase qui renvoie vers l'ajout manuel.
// Aucun appel externe ici : la présence d'un connecteur se lit par `ctx.api.services.providers` (borné à 2 s, une panne vaut « absent »).
// La dernière plateforme choisie est gardée dans le stockage du module (collection « meta », clé « quick »), pas dans le navigateur : elle suit la personne d'un appareil à l'autre.
const v = new URL(import.meta.url).search;
const N = await import(`./networks.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const Ph = await import(`./photos.mjs${v}`);

/** Ordre d'affichage (Twitch d'abord) des plateformes de l'ajout rapide ; « Site web », « Mastodon » et « Autre » restent à l'ajout manuel. */
export const QUICK = ["twitch", "youtube", "instagram", "tiktok", "discord", "x", "bluesky"];
const META_KEY = "quick";

/** { list: [réseaux dans l'ordre], connectors: [réseaux dont le connecteur est là], fallback: true si rien n'est installé ni utilisé }. */
export async function quickNetworks(ctx, idx) {
  const present = await Promise.all(Object.entries(Ph.SERVICE_OF).map(async ([net, svc]) => ((await Ph.hasProvider(ctx, svc)) ? net : null)));
  const connectors = present.filter(Boolean);
  const used = new Set();
  for (const e of idx.list) if (e.a) for (const k of D.keysOf(e)) used.add(k.slice(0, k.indexOf(":")));
  const wanted = new Set([...connectors, ...QUICK.filter((n) => used.has(n))]);
  const list = QUICK.filter((n) => wanted.has(n));
  return list.length ? { list, connectors, fallback: false } : { list: [...QUICK], connectors, fallback: true };
}

/** La dernière plateforme choisie (null si aucune, ou si le stockage ne répond pas : ce n'est qu'un confort). */
export async function lastNetwork(ctx) {
  try {
    const r = await D.within(ctx.api.store.getByKey("meta", META_KEY), 3000, "quick");
    return QUICK.includes(r?.data?.network) ? r.data.network : null;
  } catch { return null; }
}
export async function rememberNetwork(ctx, network) {
  if (!QUICK.includes(network)) return;
  try {
    const st = ctx.api.store;
    const r = await D.within(st.getByKey("meta", META_KEY), 3000, "quick");
    if (r?.data?.network === network) return;
    if (!r || (await st.update(r.id, { network }, { key: META_KEY })) === false) await st.add("meta", { network }, { key: META_KEY });
  } catch { /* un confort : jamais une raison d'échouer */ }
}

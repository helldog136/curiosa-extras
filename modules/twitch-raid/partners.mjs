// Les partenaires, proposés aux autres modules sous le sujet `stream.partner` (par exemple « Story d'annonce », qui s'en sert pour montrer des co-streamers) :
// le pseudo, le nom et la photo. Depuis la 2.0, TOUT vient de Contacts (la liste de raid, voir source.mjs ; la photo de la fiche, choisie par Contacts) :
// plus aucun appel à Twitch ici. JAMAIS de note, d'adresse ni de secret. Ce sujet disparaîtra quand Story lira Contacts elle-même (Story 2.0).
// Règles : la liste est celle du dock (gardée 30 s, bornée) ; les photos sont lues en UN appel `resolve` (100 fiches au plus), borné à `timing.photoMs` ;
// si Contacts ne répond pas, les partenaires sont rendus sans photo, et sans liste si Contacts n'a pas de liste à donner.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const source = await import(`./source.mjs${v}`);
const { httpsUrl } = await import(`./pure.mjs${v}`);

export const timing = { photoMs: 3000 };

/** Les partenaires au format du sujet : [{ id, login, title (nom), image? }], 100 au plus. Ne lève jamais. */
export async function partnerItems(ctx, limit = 100) {
  const n = Math.max(0, Math.min(100, Math.floor(Number(limit)) || 100));
  const src = await source.targets(ctx);
  if (src.state !== "ok" || !n) return [];
  const list = src.partners.slice(0, n);
  const ids = [...new Set(list.map((p) => p.contactId).filter(Boolean))];
  const photos = new Map();
  if (ids.length) {
    const r = await source.ask(ctx, "resolve", { ids }, timing.photoMs);
    if (r.ok && Array.isArray(r.value.contacts)) for (const c of r.value.contacts) if (c && httpsUrl(c.photo?.url)) photos.set(c.id, c.photo.url);
  }
  // `image` n'est présent que s'il y a une photo : une adresse vide n'est pas valable pour le cœur, qui écarterait tout l'élément
  return list.map((p) => {
    const image = photos.get(p.contactId) ?? p.avatar;
    return { id: p.login, login: p.login, title: p.name || p.login, ...(image ? { image } : {}) };
  });
}

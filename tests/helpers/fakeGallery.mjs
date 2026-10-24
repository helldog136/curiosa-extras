// Faux fournisseur du service « gallery.albums » (version 1, lecture seule), pour les modules qui le CONSOMMENT (événements : lier une rétrospective ; vidéos ; annuaire).
//   list({ limit?, cursor?, q? }) → { ok: true, albums: [{ id, title, cover?, count, url }], next? }
//   get(id)                       → { ok: true, album: { id, title, count, url, cover? } | null }
// À donner à `fakeCtx({ services: fakeGalleryAlbums({ albums, mode }) })` (un fournisseur) ou à `serviceInstances` (plusieurs, voir `fakeGalleryInstances`).
//   mode "ok"      : répond normalement
//   mode "empty"   : aucun album
//   mode "down"    : le fournisseur lève une erreur
//   mode "busy"    : répond { ok: false, error: "busy" } (le contrat des services du carnet d'adresses)
//   mode "slow"    : ne répond jamais (le consommateur doit avoir son propre délai)
//   mode "garbage" : une réponse illisible (texte, nombres, formes inattendues)
// `readAlbums` est la lecture PRUDENTE que doit faire un consommateur : absent / en panne / lent / illisible se terminent par un état clair, jamais une exception.

export const ALBUM = { id: "c1abc", title: "Soirée de printemps", cover: "https://example.org/m/gallery/img?b=c1cover", count: 24, url: "https://example.org/galeries/soiree-de-printemps" };

export function fakeGalleryAlbums({ albums = [ALBUM], mode = "ok" } = {}) {
  const guard = (fn) => async (args) => {
    if (mode === "down") throw new Error("le fournisseur est tombé");
    if (mode === "busy") return { ok: false, error: "busy" };
    if (mode === "slow") return new Promise(() => {});
    if (mode === "garbage") return ["pas", "un", "objet"];
    if (mode === "garbage-fields") return { ok: true, albums: [null, 42, { id: 7, title: {}, count: "beaucoup", url: "javascript:alert(1)" }, { id: "ok1", title: "Valable", count: 3, url: "/galeries/valable" }], album: "texte" };
    return fn(args);
  };
  const live = () => (mode === "empty" ? [] : albums);
  return {
    "gallery.albums": {
      list: guard((args) => {
        const q = String(args?.q ?? "").toLowerCase();
        const limit = Math.min(50, Math.max(1, Math.trunc(Number(args?.limit)) || 20));
        const from = Number(args?.cursor ?? 0) || 0;
        const all = live().filter((a) => !q || a.title.toLowerCase().includes(q));
        const out = { ok: true, albums: all.slice(from, from + limit) };
        if (from + limit < all.length) out.next = String(from + limit);
        return out;
      }),
      get: guard((args) => ({ ok: true, album: live().find((a) => a.id === (typeof args === "string" ? args : args?.id)) ?? null })),
    },
  };
}

/** Plusieurs instances de galerie (portfolio, événements) : pour `serviceInstances` de fakeCtx. */
export function fakeGalleryInstances(spec) {
  return { "gallery.albums": Object.entries(spec).map(([instance, opts]) => ({ instance, name: instance, methods: fakeGalleryAlbums(opts)["gallery.albums"] })) };
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms))]);
const okUrl = (u) => typeof u === "string" && (/^https?:\/\/[^\s<>"']{3,500}$/.test(u) || /^\/(?!\/)[^\s<>"']{0,300}$/.test(u));

/** Valide UN album du contrat ; renvoie l'album nettoyé ou null. */
export function cleanAlbum(a) {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(a.id) || typeof a.title !== "string" || !a.title.trim()) return null;
  if (!Number.isInteger(a.count) || a.count < 0 || !okUrl(a.url)) return null;
  const out = { id: a.id, title: a.title.slice(0, 200), count: a.count, url: a.url };
  if (a.cover !== undefined && okUrl(a.cover)) out.cover = a.cover;
  return out;
}

/**
 * La lecture que doit faire un consommateur (événements, vidéos, annuaire) : un seul état clair, aucune exception.
 *   state : "ok" | "absent" (aucun fournisseur) | "down" (en panne) | "slow" (pas de réponse à temps) | "unreadable" (réponse inutilisable)
 */
export async function readAlbums(ctx, args = {}, { timeoutMs = 2000, method = "list" } = {}) {
  let r;
  try { r = await withTimeout(ctx.api.services.call("gallery.albums", method, args), timeoutMs); } catch { return { state: "down", albums: [] }; }
  if (r?.timedOut) return { state: "slow", albums: [] };
  if (!r || r.ok !== true) return { state: r?.reason === "unavailable" ? "absent" : "down", albums: [] };
  const v = r.value;
  if (!v || typeof v !== "object" || Array.isArray(v)) return { state: "unreadable", albums: [] };
  if (v.ok !== true) return { state: "down", albums: [] };
  if (method === "get") { const album = cleanAlbum(v.album); return v.album === null ? { state: "ok", albums: [], album: null } : album ? { state: "ok", albums: [album], album } : { state: "unreadable", albums: [] }; }
  if (!Array.isArray(v.albums)) return { state: "unreadable", albums: [] };
  const albums = v.albums.map(cleanAlbum).filter(Boolean);
  if (v.albums.length && !albums.length) return { state: "unreadable", albums: [] };
  return { state: "ok", albums, next: typeof v.next === "string" && v.next.length <= 500 ? v.next : undefined };
}

// Vidéothèque — le lien FACULTATIF avec un module de galeries (service `gallery.albums`, lecture seule) : relier un album de photos à une vidéo (la rétrospective d'un événement).
// Le module marche très bien sans : l'album reste la propriété de la galerie, ici on ne garde que son numéro. Absent, en panne, lent ou illisible : la page de la vidéo
// s'affiche sans le lien (le dernier album connu est gardé en mémoire 24 h au plus), l'administration le dit en une phrase.
const v = new URL(import.meta.url).search;
const { clean } = await import(`./pure.mjs${v}`);

export const SERVICE = "gallery.albums";
export const timing = { waitMs: 3000, freshMs: 60_000, staleMs: 24 * 60 * 60_000 };
const memo = new Map(); // « instance|album » → { at, album }
export const resetAlbums = () => memo.clear();

const within = (p, ms) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r({ ok: false, reason: "slow" }), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

async function call(ctx, method, args) {
  if (typeof ctx.api?.services?.call !== "function") return { ok: false, reason: "unavailable" };
  try { return await within(Promise.resolve(ctx.api.services.call(SERVICE, method, args)), timing.waitMs); } catch { return { ok: false, reason: "failed" }; }
}
const absent = (r) => r.reason === "unavailable" || r.reason === "undeclared" || r.reason === "no_method";

/** Un lien sûr : un chemin du site ou une adresse https. */
const safeUrl = (u) => { const s = clean(u, 400); return /^\/(?!\/)[^\s"'<>\\]*$/.test(s) || /^https:\/\/[^\s"'<>\\]+$/.test(s) ? s : ""; };
function normAlbum(a) {
  if (!a || typeof a !== "object") return null;
  const id = clean(typeof a.id === "number" ? String(a.id) : a.id, 80), title = clean(a.title, 150), url = safeUrl(a.url);
  const count = Number.isFinite(Number(a.count)) ? Math.max(0, Math.min(1e6, Math.trunc(Number(a.count)))) : 0;
  return id && title && url ? { id, title, url, count } : null;
}

/** L'album relié : { state: "ok", album } · "gone" (la galerie ne le connaît plus) · "absent" (pas de galerie) · "down" (ne répond pas, illisible). */
export async function info(ctx, id) {
  const key = `${ctx.instance.key}|${id}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < timing.freshMs) return { state: "ok", album: hit.album };
  const r = await call(ctx, "get", { id });
  if (r.ok) {
    const val = r.value;
    if (val && typeof val === "object" && val.ok === true) {
      if (val.album === null) { memo.delete(key); return { state: "gone" }; }
      const album = normAlbum(val.album);
      if (album) { memo.set(key, { at: Date.now(), album }); return { state: "ok", album }; }
    }
  } else if (absent(r)) return { state: "absent" };
  if (hit && Date.now() - hit.at < timing.staleMs) return { state: "ok", album: hit.album };
  return { state: "down" };
}

/** Les albums à proposer dans l'administration (100 au plus, 2 pages de 50) : { state: "ok", albums } · "absent" · "down". */
export async function list(ctx, q = "") {
  const albums = [];
  let cursor;
  for (let i = 0; i < 2; i++) {
    const r = await call(ctx, "list", { limit: 50, ...(cursor ? { cursor } : {}), ...(q ? { q: clean(q, 100) } : {}) });
    if (!r.ok) return absent(r) ? { state: "absent" } : { state: "down" };
    const val = r.value;
    if (!val || typeof val !== "object" || val.ok !== true || !Array.isArray(val.albums)) return { state: "down" };
    for (const a of val.albums.slice(0, 50)) { const n = normAlbum(a); if (n) albums.push(n); }
    cursor = typeof val.next === "string" && val.next.length <= 500 ? val.next : "";
    if (!cursor) break;
  }
  return { state: "ok", albums };
}

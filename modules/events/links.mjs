// Événements : les liens FACULTATIFS avec d'autres services — les albums photo (service `gallery.albums`) et la bibliothèque de vidéos (service `videos.library`).
// Ces services peuvent être absents, en panne, lents ou répondre n'importe quoi : chaque appel est BORNÉ (quelques secondes), sa réponse est vérifiée champ par champ,
// et le résultat dit seulement « ok », « absent » (aucun module ne l'offre), « down » (il ne répond pas) ou « bad » (réponse illisible). Aucune exception ne sort d'ici.
// Une panne est retenue une minute : une page publique n'attend pas à chaque visite un service qui ne répond pas.
// Un album ou une vidéo appartient à son module : on ne garde ici que son identifiant, jamais son titre ni son adresse (on les relit, avec un cache court).
const q = new URL(import.meta.url).search;
const X = await import(`./text.mjs${q}`);

export const GALLERY = "gallery.albums";
export const VIDEOS = "videos.library";
/** Les délais (en millisecondes), dans un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 2500, cacheMs: 300_000, listMs: 30_000, failMs: 60_000 };
const ID = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Attend `p` au plus `ms` ; passé ce délai, rend `fallback` (et le résultat tardif n'est jamais utilisé). Le minuteur est effacé dès que la réponse est là. */
export function within(p, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(p).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

const failed = new Map();   // « instance|service » → l'heure de la dernière panne
const memo = new Map();     // « instance|clé » → { at, value }
const remember = (key, value) => { if (memo.size > 300) memo.clear(); memo.set(key, { at: Date.now(), value }); };
const recall = (key, ttl) => { const m = memo.get(key); return m && Date.now() - m.at < ttl ? m.value : undefined; };
/** Oublie tout ce qui concerne une instance (suppression de l'instance, ou tests). */
export function forgetLinks(ctx) {
  const prefix = ctx ? `${ctx.instance.key}|` : "";
  for (const k of [...failed.keys()]) if (k.startsWith(prefix)) failed.delete(k);
  for (const k of [...memo.keys()]) if (k.startsWith(prefix)) memo.delete(k);
}

async function ask(ctx, service, method, args) {
  const fk = `${ctx.instance.key}|${service}`;
  if (Date.now() - (failed.get(fk) ?? 0) < timing.failMs) return { state: "down" };
  let r;
  try {
    r = await within(ctx.api.services.call(service, method, args), timing.callMs, { ok: false, reason: "timeout" });
  } catch { r = { ok: false, reason: "failed" }; }
  if (!r?.ok) {
    if (r?.reason === "unavailable" || r?.reason === "undeclared" || r?.reason === "no_method") return { state: "absent" };
    failed.set(fk, Date.now());
    return { state: "down" };
  }
  const v = r.value;
  if (!v || typeof v !== "object" || Array.isArray(v) || v.ok !== true) { if (v && typeof v === "object" && v.ok === false) return { state: "down" }; return { state: "bad" }; }
  return { state: "ok", value: v };
}

const album = (a) => {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !ID.test(a.id)) return null;
  const url = X.safeHref(a.url);
  const title = X.clean(a.title, 120);
  if (!url || url.startsWith("mailto:") || !title) return null;
  return { id: a.id, title, url, count: Number.isFinite(a.count) ? Math.max(0, Math.min(1e6, Math.trunc(a.count))) : 0, cover: a.cover ? X.safeMedia(a.cover) ?? "" : "" };
};
const video = (a) => {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !ID.test(a.id)) return null;
  const url = X.safeHref(a.url);
  const title = X.clean(a.title, 120);
  if (!url || url.startsWith("mailto:") || !title) return null;
  return { id: a.id, title, url, thumb: a.thumb ? X.safeMedia(a.thumb) ?? "" : "" };
};

/** Une liste d'albums (au plus 50), pour que la personne en choisisse un. `{ state, albums }`. */
export async function albums(ctx, { q: search = "", limit = 50 } = {}) {
  const term = X.clean(search, 80);
  const key = `${ctx.instance.key}|albums|${term}|${limit}`;
  const hit = recall(key, timing.listMs);
  if (hit) return hit;
  const r = await ask(ctx, GALLERY, "list", { limit: Math.min(50, Math.max(1, limit)), ...(term ? { q: term } : {}) });
  if (r.state !== "ok") return { state: r.state, albums: [] };
  const list = (Array.isArray(r.value.albums) ? r.value.albums.slice(0, 50) : []).map(album).filter(Boolean);
  const out = { state: Array.isArray(r.value.albums) ? "ok" : "bad", albums: list, more: !!r.value.next };
  if (out.state === "ok") remember(key, out);
  return out;
}

/** Un album par son identifiant. `{ state, album }` (album vaut null quand il n'existe plus). */
export async function albumById(ctx, id) {
  if (!ID.test(String(id ?? ""))) return { state: "ok", album: null };
  const key = `${ctx.instance.key}|album|${id}`;
  const hit = recall(key, timing.cacheMs);
  if (hit) return hit;
  const r = await ask(ctx, GALLERY, "get", { id });
  if (r.state !== "ok") return { state: r.state, album: null };
  const out = { state: "ok", album: album(r.value.album) };
  if (r.value.album && !out.album) return { state: "bad", album: null };
  remember(key, out);
  return out;
}

/** Une liste de vidéos de la bibliothèque (au plus 50). `{ state, items }`. */
export async function videos(ctx, { q: search = "", limit = 50 } = {}) {
  const term = X.clean(search, 80);
  const key = `${ctx.instance.key}|videos|${term}|${limit}`;
  const hit = recall(key, timing.listMs);
  if (hit) return hit;
  const r = await ask(ctx, VIDEOS, "list", { limit: Math.min(50, Math.max(1, limit)), ...(term ? { q: term } : {}) });
  if (r.state !== "ok") return { state: r.state, items: [] };
  const out = { state: Array.isArray(r.value.items) ? "ok" : "bad", items: (Array.isArray(r.value.items) ? r.value.items.slice(0, 50) : []).map(video).filter(Boolean), more: !!r.value.next };
  if (out.state === "ok") remember(key, out);
  return out;
}

/** Une vidéo de la bibliothèque par son identifiant (le service n'a pas de lecture directe : on la cherche par un mot de son titre, gardé avec le choix). */
export async function videoById(ctx, id, hint = "") {
  if (!ID.test(String(id ?? ""))) return { state: "ok", item: null };
  const key = `${ctx.instance.key}|video|${id}`;
  const hit = recall(key, timing.cacheMs);
  if (hit) return hit;
  const r = await videos(ctx, { q: hint, limit: 50 });
  if (r.state !== "ok") return { state: r.state, item: null };
  const out = { state: "ok", item: r.items.find((v) => v.id === id) ?? null };
  remember(key, out);
  return out;
}

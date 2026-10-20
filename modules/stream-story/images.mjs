// Les images de la vidéo (photo de profil Twitch, jaquette du jeu) passent par le site lui-même : le navigateur ne peut dessiner dans son canvas, puis en faire une vidéo,
// qu'avec des images venues de la MÊME adresse que la page. Cette route est donc un petit relais, très serré :
//   - la personne ne donne JAMAIS d'adresse à relire librement : l'adresse doit être en https, sur un hôte de la liste blanche ci-dessous, sans port, sans identifiant,
//     sans paramètre, avec un chemin d'image connu ; aucune redirection n'est suivie ;
//   - taille bornée (3 Mo), temps borné (rien n'attend plus de `timing.totalMs`), type vérifié sur les premiers octets (jamais sur ce que l'hôte déclare) ;
//   - quelques secondes de cache en mémoire, et au plus quatre téléchargements en même temps : au-delà, « occupé » tout de suite.
export const timing = { fetchMs: 6000, totalMs: 8000, okMs: 10 * 60_000, failMs: 60_000 };
export const LIMITS = { bytes: 3 * 1024 * 1024, entries: 40, cacheBytes: 24 * 1024 * 1024, parallel: 4 };

/** Les seuls hôtes permis, et la forme du chemin permise pour chacun. */
export const HOSTS = {
  "static-cdn.jtvnw.net": /^\/(?:jtv_user_pictures|user-default-pictures-uv|ttv-boxart)\/[A-Za-z0-9_.\-/]{1,160}\.(?:png|jpe?g|webp)$/,
  "media.rawg.io": /^\/media\/[A-Za-z0-9_.\-/]{1,200}\.(?:png|jpe?g|webp)$/,
};

/** L'adresse (URL) si elle est permise, sinon null. */
export function allowedUrl(input) {
  if (typeof input !== "string" || input.length > 400 || /[\u0000- \u007f\\]/.test(input)) return null;
  let u;
  try { u = new URL(input); } catch { return null; }
  const rule = HOSTS[u.hostname];
  if (!rule || u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname.includes("..") || u.pathname.includes("//") || u.pathname.includes("%") || !rule.test(u.pathname)) return null;
  return u;
}

/** Le vrai type d'une image, lu dans ses premiers octets (jamais SVG ni autre chose). */
export function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const state = { cache: new Map(), inflight: new Map(), active: 0 };
export const resetImages = () => { state.cache.clear(); state.inflight.clear(); state.active = 0; };
const within = (p, ms, fallback) => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

async function download(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timing.fetchMs);
  timer.unref?.();
  try {
    const res = await fetch(url, { redirect: "manual", signal: ctl.signal, headers: { Accept: "image/png,image/jpeg,image/webp" } });
    if (res.status !== 200) return { ok: false, error: res.status === 404 ? "missing" : "upstream" };
    if (!String(res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return { ok: false, error: "type" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > LIMITS.bytes) return { ok: false, error: "big" };
    const reader = res.body?.getReader?.();
    if (!reader) return { ok: false, error: "upstream" };
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.bytes) { try { await reader.cancel(); } catch { /* déjà fermé */ } return { ok: false, error: "big" }; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    const type = sniff(bytes);
    return type ? { ok: true, bytes, type } : { ok: false, error: "type" };
  } catch { return { ok: false, error: "upstream" }; } finally { clearTimeout(timer); }
}

function remember(url, value) {
  const now = Date.now();
  state.cache.set(url, { value, until: now + (value.ok ? timing.okMs : timing.failMs) });
  let total = 0;
  for (const [k, e] of [...state.cache]) { if (e.until <= now) state.cache.delete(k); else total += e.value.bytes?.length ?? 0; }
  for (const k of state.cache.keys()) { if (state.cache.size <= LIMITS.entries && total <= LIMITS.cacheBytes) break; total -= state.cache.get(k).value.bytes?.length ?? 0; state.cache.delete(k); }
}

/** Rend { ok: true, bytes, type } ou { ok: false, error: "refused" | "busy" | "missing" | "upstream" | "type" | "big" | "slow" }. Ne lève jamais, n'attend jamais plus de `timing.totalMs`. */
export async function fetchImage(input) {
  const u = allowedUrl(input);
  if (!u) return { ok: false, error: "refused" };
  const key = u.href, hit = state.cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const pending = state.inflight.get(key);
  if (pending) return pending;
  if (state.active >= LIMITS.parallel) return { ok: false, error: "busy" };
  state.active++;
  const run = within(download(key), timing.totalMs, { ok: false, error: "slow" }).then((value) => { remember(key, value); return value; })
    .finally(() => { state.active = Math.max(0, state.active - 1); if (state.inflight.get(key) === run) state.inflight.delete(key); });
  state.inflight.set(key, run);
  return run;
}

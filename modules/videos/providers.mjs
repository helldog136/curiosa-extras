// Vidéothèque — les FOURNISSEURS de vidéos. Une table : une entrée par plateforme (aujourd'hui : YouTube seulement).
//
// Pour en ajouter un autre, on ajoute UNE entrée à `PROVIDERS` avec les mêmes fonctions :
//   label · parse(texte) → { ok, id } | { ok: false, why } · validId(id) · watchUrl(id) · embedUrl(id, { autoplay }) · thumbUrl(id) · oembedUrl(id) · thumbHosts · embedHosts
// Tout le reste du module ne manipule que `{ provider, ext }` : jamais une adresse libre. Les adresses (lecteur, miniature, titre) sont FABRIQUÉES ici à partir d'un identifiant
// vérifié caractère par caractère, donc rien de ce qu'une équipe ou un visiteur tape ne peut finir dans un cadre de lecture ni dans une requête.
// Il faut aussi : dire le service dans `privacy` (module.json), ajouter ses textes (locales) et l'hôte du lecteur à `embedHosts` (le script de page ne crée un lecteur que pour ces hôtes).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins
const { LIMITS, clean } = await import(`./pure.mjs${v}`);

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const isYtId = (id) => typeof id === "string" && YT_ID.test(id);
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

/** YouTube. Formats reconnus : watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/ — avec ou sans paramètres de suivi (ils sont jetés), avec ou sans « https:// ». */
const youtube = {
  label: "YouTube",
  thumbHosts: ["i.ytimg.com"],
  embedHosts: ["www.youtube-nocookie.com"],
  validId: isYtId,
  parse(input) {
    let text = clean(input, 500);
    if (!text || /\s/.test(text)) return { ok: false, why: "format" };
    if (!/^https?:\/\//i.test(text)) {
      if (!/^(?:www\.|m\.|music\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\//i.test(text)) return { ok: false, why: "format" };
      text = `https://${text}`;
    }
    let u;
    try { u = new URL(text); } catch { return { ok: false, why: "format" }; }
    if (u.username || u.password || u.port) return { ok: false, why: "format" };
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    let id = "";
    if (host === "youtu.be") id = parts[0] ?? "";
    else if (YT_HOSTS.has(host)) {
      if (parts[0] === "watch") id = u.searchParams.get("v") ?? "";
      else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1] ?? "";
      else if (parts[0] === "playlist") return { ok: false, why: "playlist" };
      else if (["channel", "c", "user"].includes(parts[0]) || parts[0]?.startsWith("@")) return { ok: false, why: "channel" };
      else return { ok: false, why: "format" };
    } else return { ok: false, why: "host" };
    return isYtId(id) ? { ok: true, id } : { ok: false, why: "id" };
  },
  watchUrl: (id) => (isYtId(id) ? `https://www.youtube.com/watch?v=${id}` : null),
  embedUrl: (id, { autoplay = false } = {}) => (isYtId(id) ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${autoplay ? "&autoplay=1" : ""}` : null),
  thumbUrl: (id) => (isYtId(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null),
  oembedUrl: (id) => (isYtId(id) ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}` : null),
};

export const PROVIDERS = { youtube };
export const providerOf = (item) => (item && typeof item.provider === "string" && Object.hasOwn(PROVIDERS, item.provider) ? PROVIDERS[item.provider] : null);
/** Le fournisseur qui reconnaît cette adresse (dans l'ordre de la table). `why` : la raison de la dernière tentative. */
export function parseAddress(input) {
  let last = { ok: false, why: "format" };
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const r = p.parse(input);
    if (r.ok) return { ok: true, provider: name, id: r.id };
    if (r.why !== "format" && r.why !== "host") last = r;
    else if (last.why === "format" || last.why === "host") last = r;
  }
  return last;
}

/** Le lecteur de cette vidéo (adresse à mettre dans le cadre), ou null. Seul point de fabrication, partout. */
export function embedSrc(item, opts) {
  const p = providerOf(item);
  return p && !item.noEmbed ? p.embedUrl(item.ext, opts) : null;
}

export const timing = { oembedMs: 5000, fetchMs: 4000 };

/** Titre d'une vidéo auprès du fournisseur (« oEmbed » : sans clé, borné par ctx.api.net). Ne lève jamais. state : ok | missing | private | down. */
export async function lookup(ctx, providerName, id) {
  const p = Object.hasOwn(PROVIDERS, providerName) ? PROVIDERS[providerName] : null;
  const url = p?.oembedUrl(id);
  if (!url || typeof ctx.api?.net?.request !== "function") return { state: "down" };
  let r;
  try { r = await ctx.api.net.request({ url, timeoutMs: timing.oembedMs, maxBytes: 64 * 1024, priority: "interactive" }); } catch { return { state: "down" }; }
  if (!r || r.ok !== true) return { state: "down" };
  if (r.status === 200 && r.json && typeof r.json === "object" && typeof r.json.title === "string") {
    const title = clean(r.json.title, LIMITS.title);
    return title ? { state: "ok", title } : { state: "down" };
  }
  if (r.status === 401 || r.status === 403) return { state: "private" };
  if (r.status === 404) return { state: "missing" };
  return { state: "down" };
}

// ── La miniature : copie gardée par le site ────────────────────────────────────────────────────────────────────────
// `ctx.api.net` ne rend que du texte ou du JSON : une image passe donc par un `fetch` très serré (même idiome que l'image du module de Story) —
// hôte de la liste, https, sans port, sans redirection, 64 Ko au plus, type vérifié sur les premiers octets, 4 s, 3 à la fois. Appelé seulement depuis l'administration.

const state = { active: 0 };
export const resetThumbs = () => { state.active = 0; };

/** Le vrai type d'une image, lu dans ses premiers octets (jamais SVG ni autre chose). */
export function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** { ok: true, bytes, type } ou { ok: false, why: "refused" | "busy" | "missing" | "upstream" | "type" | "big" }. Ne lève jamais. */
export async function downloadThumb(providerName, id) {
  const p = Object.hasOwn(PROVIDERS, providerName) ? PROVIDERS[providerName] : null;
  const href = p?.thumbUrl(id);
  let u;
  try { u = href ? new URL(href) : null; } catch { u = null; }
  if (!u || u.protocol !== "https:" || u.port || u.username || u.password || !p.thumbHosts.includes(u.hostname)) return { ok: false, why: "refused" };
  if (typeof fetch !== "function") return { ok: false, why: "upstream" };
  if (state.active >= 3) return { ok: false, why: "busy" };
  state.active++;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timing.fetchMs);
  timer.unref?.();
  try {
    const res = await fetch(u.href, { redirect: "manual", signal: ctl.signal, headers: { Accept: "image/jpeg,image/png,image/webp" } });
    if (res.status !== 200) return { ok: false, why: res.status === 404 ? "missing" : "upstream" };
    if (!String(res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return { ok: false, why: "type" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > LIMITS.thumbBytes) return { ok: false, why: "big" };
    const reader = res.body?.getReader?.();
    if (!reader) return { ok: false, why: "upstream" };
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.thumbBytes) { try { await reader.cancel(); } catch { /* déjà fermé */ } return { ok: false, why: "big" }; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let o = 0; for (const part of parts) { bytes.set(part, o); o += part.length; }
    const type = sniff(bytes);
    return type ? { ok: true, bytes, type } : { ok: false, why: "type" };
  } catch { return { ok: false, why: "upstream" }; } finally { clearTimeout(timer); state.active = Math.max(0, state.active - 1); }
}

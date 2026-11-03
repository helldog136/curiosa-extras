// Planning : la PHOTO d'un partenaire de stream. VIE PRIVÉE : le navigateur de la personne qui visite ne contacte JAMAIS Twitch (ni YouTube, ni Bluesky). C'est le SITE qui télécharge la
// photo publique du compte, une seule fois, la garde dans son propre stockage (`ctx.api.store`, donc dans la sauvegarde) et la sert depuis sa propre adresse (`/m/<clé>/photo/<repère>`).
// Règles reprises de « Story » (`stream-story/images.mjs`, mêmes hôtes d'avatars, mêmes bornes) ; le modèle est celui du guide de publication (« Images venant d'un service externe »).
//   - Aucune adresse ne vient de la personne qui visite : elle ne donne qu'un repère (16 caractères, empreinte du pseudo), l'adresse vient de la fiche de Contacts, revérifiée ici.
//   - https, hôte de la liste ci-dessous, chemin d'avatar connu, sans port, sans identifiant, sans paramètre, AUCUNE redirection suivie, 256 Ko au plus, type lu dans les premiers octets.
//   - Téléchargement PARESSEUX : il part quand le Planning résout un partenaire affichable (jamais depuis un minuteur), deux à la fois au plus, et un échec est simplement retenté
//     plus tard (en mémoire, 6 h) : la page montre alors les initiales, jamais une erreur.
//   - Rafraîchie au plus une fois par semaine ; effacée dès que la fiche n'est plus affichable (effacée, « à relire », « Ne pas montrer ») ou que Contacts disparaît ; oubliée après 30 jours
//     sans rafraîchissement ; 30 photos au plus. Une photo envoyée à la main dans Contacts (`/uploads/…`) vit déjà sur le site : elle est montrée telle quelle, sans copie.
import { createHash } from "node:crypto";

export const COLLECTION = "partnerPhotos";
export const LIMITS = { bytes: 256 * 1024, items: 30 };
export const timing = { fetchMs: 6000, refreshMs: 7 * 86_400_000, forgetMs: 30 * 86_400_000, retryMs: 6 * 3_600_000, sweepMs: 3_600_000, parallel: 2 };
/** Le réseau est un crochet : les essais le remplacent (aucun accès réel). */
export const hooks = { fetch: (url, init) => globalThis.fetch(url, init) };

// Hôtes d'AVATARS seulement : Twitch, YouTube, Bluesky (les trois réseaux dont Contacts lit la photo). Même liste que stream-story/images.mjs (un test les compare).
const GOOGLE_PHOTO = /^\/(?:(?:ytc|a)\/)?[A-Za-z0-9_-]{20,200}(?:=[A-Za-z0-9_-]{1,60})?$/;
export const HOSTS = {
  "static-cdn.jtvnw.net": /^\/(?:jtv_user_pictures|user-default-pictures-uv)\/[A-Za-z0-9_.\-/]{1,160}\.(?:png|jpe?g|webp)$/,
  "yt3.ggpht.com": GOOGLE_PHOTO,
  "yt3.googleusercontent.com": GOOGLE_PHOTO,
  "cdn.bsky.app": /^\/img\/avatar(?:_thumbnail)?\/plain\/did:plc:[a-z2-7]{24}\/[A-Za-z0-9]{8,120}@(?:jpeg|png|webp)$/,
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

/** D'où vient la photo d'une fiche (`contact.photo` = { url, source }) : { kind: "own", path } (déjà sur le site), { kind: "remote", url } (à copier), ou null (initiales). */
export function photoSource(photo) {
  const url = photo?.url;
  if (typeof url !== "string") return null;
  if (photo.source === "manual" && /^\/uploads\/[A-Za-z0-9._-]{1,120}$/.test(url) && !url.includes("..")) return { kind: "own", path: url };
  const u = allowedUrl(url);   // une photo choisie à la main sur un autre serveur n'est pas copiée : initiales
  return u ? { kind: "remote", url: u.href } : null;
}

/** Le repère public d'un pseudo : 16 caractères, jamais le pseudo lui-même. */
export const idOf = (login) => createHash("sha256").update(`planning-photo|${String(login)}`).digest("hex").slice(0, 16);
export const ID_RE = /^[0-9a-f]{16}$/;
export const routePath = (ctx, id) => `/m/${ctx.instance.key}/photo/${id}`;

/** Le réglage « Afficher la photo des partenaires » : oui sauf un « non » explicite. */
export function photosOn(ctx) {
  let v; try { v = ctx.setting?.("showPartnerPhotos"); } catch { v = undefined; }
  return !(v === false || v === "false" || v === 0 || v === "0" || v === "off");
}

const store = (ctx) => ctx.api.store;
async function readDoc(ctx, id) {
  try { const r = await store(ctx).getByKey(COLLECTION, id); return r && r.data && r.data.id === id && typeof r.data.b64 === "string" ? r : null; } catch { return null; }
}
export const hasPhoto = async (ctx, id) => (await readDoc(ctx, id)) !== null;
/** Efface la copie d'un pseudo (idempotent, ne lève jamais). */
export async function forget(ctx, id) {
  try { const r = await readDoc(ctx, id); if (r) await store(ctx).remove(r.id); } catch { /* rien */ }
}
/** Efface tout (réglage coupé, Contacts retiré). */
export async function forgetAll(ctx) {
  try { for (const r of await store(ctx).list(COLLECTION, { limit: 200 })) await store(ctx).remove(r.id); } catch { /* rien */ }
}
/** Oublie les copies de plus de 30 jours (une photo affichée est rafraîchie chaque semaine : une vieille copie n'est plus affichée). Au plus une fois par heure et par instance. */
const swept = new Map();
export async function sweep(ctx, now = Date.now()) {
  const k = ctx.instance?.key ?? "";
  if (now - (swept.get(k) ?? 0) < timing.sweepMs) return;
  swept.set(k, now);
  try { for (const r of await store(ctx).list(COLLECTION, { limit: 200 })) if (!(now - Number(r.data?.at) < timing.forgetMs)) await store(ctx).remove(r.id); } catch { /* rien */ }
}

async function download(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timing.fetchMs);
  timer.unref?.();
  try {
    const res = await hooks.fetch(url, { redirect: "manual", signal: ctl.signal, headers: { Accept: "image/png,image/jpeg,image/webp" } });
    if (res.status !== 200) return null;
    if (!String(res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > LIMITS.bytes) return null;
    const reader = res.body?.getReader?.();
    if (!reader) return null;
    const parts = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.bytes) { try { await reader.cancel(); } catch { /* déjà fermé */ } return null; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
    const type = sniff(bytes);
    return type ? { bytes, type } : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const pending = new Map();   // repère -> promesse en cours (une seule copie à la fois par pseudo)
const failed = new Map();    // repère -> instant du dernier échec (mémoire seulement)
export const resetPhotos = () => { pending.clear(); failed.clear(); swept.clear(); };
/** Attend les copies en cours (essais). */
export const settled = () => Promise.all([...pending.values()]);

async function save(ctx, id, login, src, got, now) {
  const all = await store(ctx).list(COLLECTION, { limit: 200 });
  const mine = all.find((r) => r.data?.id === id);
  const data = { id, login, type: got.type, b64: Buffer.from(got.bytes).toString("base64"), at: now, src };
  if (mine) { await store(ctx).update(mine.id, data, { key: id }); return; }
  // Plein : la plus ancienne copie fait place (30 au plus).
  const others = all.filter((r) => r.data?.id !== id).sort((a, b) => Number(a.data?.at) - Number(b.data?.at) || new Date(a.createdAt) - new Date(b.createdAt));
  for (const r of others.slice(0, Math.max(0, others.length - (LIMITS.items - 1)))) await store(ctx).remove(r.id);
  await store(ctx).add(COLLECTION, data, { key: id });
}

/** Lance la copie (sans l'attendre). Ne lève jamais, ne fait rien si une copie est en cours, si l'essai précédent a échoué il y a moins de 6 h ou si deux copies tournent déjà. */
function kick(ctx, id, login, url, now) {
  if (pending.has(id) || pending.size >= timing.parallel || now - (failed.get(id) ?? -Infinity) < timing.retryMs) return;
  const run = (async () => {
    const got = await download(url);
    if (!got) { failed.set(id, now); return; }
    failed.delete(id);
    await save(ctx, id, login, url, got, Date.now());
  })().catch(() => { failed.set(id, now); }).finally(() => { if (pending.get(id) === run) pending.delete(id); });
  pending.set(id, run);
}

/**
 * L'adresse de la photo à montrer pour un partenaire AFFICHABLE (l'appelant ne le demande jamais pour une autre fiche), ou null (initiales).
 * Photo du site : telle quelle. Sinon : la copie gardée si elle existe (et, si elle a plus d'une semaine ou vient d'une autre adresse, une nouvelle copie est lancée en même temps).
 */
export async function photoFor(ctx, login, source, now = Date.now()) {
  if (!source) return null;
  if (source.kind === "own") return source.path;
  const id = idOf(login);
  const doc = await readDoc(ctx, id);
  if (!doc || now - Number(doc.data.at) >= timing.refreshMs || doc.data.src !== source.url) kick(ctx, id, login, source.url, now);
  return doc ? routePath(ctx, id) : null;
}

/** La copie gardée pour ce repère : { login, type, bytes } ou null. */
export async function copyOf(ctx, id) {
  if (!ID_RE.test(String(id))) return null;
  const doc = await readDoc(ctx, id);
  if (!doc) return null;
  const type = ["image/jpeg", "image/png", "image/webp"].includes(doc.data.type) ? doc.data.type : null;
  const bytes = Buffer.from(String(doc.data.b64), "base64");
  if (!type || !bytes.length || bytes.length > LIMITS.bytes || sniff(bytes) !== type) return null;
  return { login: String(doc.data.login ?? ""), type, bytes };
}

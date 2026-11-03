// COPIE LOCALE DES JAQUETTES — VIE PRIVÉE : le navigateur de la personne qui visite ne contacte JAMAIS RAWG, Twitch ni Steam. C'est le SITE qui télécharge l'image choisie, la garde dans son propre
// stockage (`ctx.api.store`, donc dans la sauvegarde) et la sert depuis sa propre adresse (`/m/<clé>/cover/<repère>`). Même modèle que la photo des partenaires du Planning (planning/photos.mjs).
//   - Aucune adresse ne vient de la personne qui visite : elle ne donne qu'un repère (16 caractères, empreinte du titre) ; l'adresse vient de nos propres données, revérifiée ici (hosts.mjs, source par source).
//   - https, hôte de la source, chemin connu, sans port, identifiant ni paramètre, AUCUNE redirection suivie, 300 Ko au plus, type lu dans les premiers octets (PNG, JPEG ou WebP, jamais SVG).
//   - Téléchargement PARESSEUX : il part quand une jaquette est demandée et absente (jamais depuis un minuteur), trois à la fois au plus ; un échec est retenté plus tard (en mémoire : 1 h, puis 6 h, puis 24 h).
//   - Stockage : `coverMeta` (un petit document par jaquette, sans l'image) et `coverBytes` (l'image en base 64) ; 300 copies et 20 Mo au plus, la plus ancienne fait place.
//   - Rafraîchie PARESSEUSEMENT, quand elle est demandée et plus vieille que l'âge réglé (30 jours par défaut) : l'ancienne copie sert tant que la nouvelle n'est pas récupérée (une source en panne ne fait jamais
//     perdre une bonne copie). Seule exception : Twitch n'autorise à garder ses données que 24 heures (conditions des développeurs) ; une copie venue de Twitch plus vieille que ça n'est plus montrée.
import { createHash } from "node:crypto";

const q = new URL(import.meta.url).search;
const hosts = await import(new URL("./hosts.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const { COL } = fx;

export const LIMITS = { bytes: 300 * 1024, items: 300, total: 20 * 1024 * 1024 };
export const DAY = 86_400_000;
/** Âge de rafraîchissement : 30 jours par défaut, réglable de 1 à 365 jours (réglage avancé). Twitch : 24 heures, quoi qu'on règle. */
export const REFRESH_DEFAULT_DAYS = 30;
export const TWITCH_KEEP_MS = DAY;
export const timing = { fetchMs: 6000, parallel: 3, retryMs: [3_600_000, 6 * 3_600_000, DAY] };
/** Le réseau est un crochet : les essais le remplacent (aucun accès réel). */
export const hooks = { fetch: (url, init) => globalThis.fetch(url, init) };

export const idOf = (key) => createHash("sha256").update(`game-cover|${String(key)}`).digest("hex").slice(0, 16);
export const ID_RE = /^[0-9a-f]{16}$/;
export const routePath = (ctx, id) => `${String(ctx.api?.siteUrl ?? "").replace(/\/+$/, "")}/m/${ctx.instance.key}/cover/${id}`;

/** L'âge de rafraîchissement réglé (en millisecondes). */
export function refreshMs(ctx) {
  let v; try { v = Number(ctx.setting?.("refreshDays")); } catch { v = NaN; }
  const days = Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), 365) : REFRESH_DEFAULT_DAYS;
  return days * DAY;
}
/** Combien de temps une jaquette de cette source reste « bonne » avant d'être revérifiée : l'âge réglé, et 24 h pour Twitch. */
export const keepMs = (ctx, src) => (src === "twitch" ? Math.min(TWITCH_KEEP_MS, refreshMs(ctx)) : refreshMs(ctx));
/** Le réglage « Si la copie échoue, montrer l'image de la source » : NON par défaut (aucune ressource tierce chez le public). */
export function remoteFallbackOn(ctx) {
  let v; try { v = ctx.setting?.("remoteFallback"); } catch { v = undefined; }
  return v === true || v === "true" || v === 1 || v === "1" || v === "on";
}

/** Le vrai type d'une image, lu dans ses premiers octets (jamais SVG ni autre chose). */
export function sniff(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const store = (ctx) => ctx.api.store;
const isMeta = (d, id) => d && typeof d === "object" && d.id === id && hosts.isSource(d.src) && hosts.validPath(d.src, d.img) && typeof d.at === "number" && Number.isFinite(d.at) && Number.isSafeInteger(d.bytes) && d.bytes > 0;

/** { doc, meta } de ce repère, ou null (illisible = absent). */
async function readMeta(ctx, id) {
  try { const r = await store(ctx).getByKey(COL.meta, id); return r && isMeta(r.data, id) ? { doc: r, meta: r.data } : null; } catch { return null; }
}
/** Une copie existe-t-elle, et est-elle encore montrable ? */
export function usable(ctx, meta, now = Date.now()) {
  return !(meta.src === "twitch" && now - meta.at >= TWITCH_KEEP_MS);
}

/** Efface la copie d'un repère (idempotent, ne lève jamais). */
export function drop(ctx, id) {
  return fx.serial(async () => {
    try {
      for (const col of [COL.meta, COL.bytes]) { const r = await store(ctx).getByKey(col, id); if (r) await store(ctx).remove(r.id); }
    } catch { /* rien */ }
  });
}
export const dropForKey = (ctx, key) => drop(ctx, idOf(key));
/** Efface toutes les copies (« tout oublier »). */
export function dropAll(ctx) {
  return fx.serial(async () => {
    try { for (const col of [COL.meta, COL.bytes]) for (let g = 0; g < 10; g++) { const rows = await store(ctx).list(col, { limit: 200 }); if (!rows.length) break; for (const r of rows) await store(ctx).remove(r.id); } } catch { /* rien */ }
  }, 60_000);
}

/** Les copies (métadonnées seules) pour l'écran « Jaquettes gardées » : { id → meta }. 300 au plus. */
export async function allMeta(ctx) {
  const out = new Map();
  try { for (const r of await store(ctx).list(COL.meta, { limit: LIMITS.items + 50 })) if (r.data && ID_RE.test(String(r.data.id)) && isMeta(r.data, r.data.id)) out.set(r.data.id, r.data); } catch { /* un plus */ }
  return out;
}
export async function usage(ctx) {
  const all = [...(await allMeta(ctx)).values()];
  return { items: all.length, bytes: all.reduce((n, m) => n + m.bytes, 0) };
}

async function download(urls) {
  for (const url of urls) {
    const got = await downloadOne(url);
    if (got) return got;
  }
  return null;
}
async function downloadOne(url) {
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

const pending = new Map();   // repère -> promesse en cours (une seule copie à la fois par titre)
const failures = new Map();  // repère -> { n, at } (mémoire seulement)
export const resetCopies = () => { pending.clear(); failures.clear(); };
/** Attend les copies en cours (essais). */
export const settled = () => Promise.all([...pending.values()]);
const MAX_FAILURES = 500;
const noteFailure = (id, now) => {
  const n = Math.min((failures.get(id)?.n ?? 0) + 1, timing.retryMs.length);
  failures.delete(id);
  failures.set(id, { n, at: now });
  if (failures.size > MAX_FAILURES) failures.delete(failures.keys().next().value);
};
const waiting = (id, now) => { const f = failures.get(id); return !!f && now - f.at < timing.retryMs[f.n - 1]; };

/** Écrit la copie (métadonnées + octets) et fait de la place : 300 copies, 20 Mo. La plus ancienne part d'abord (une copie qui vient d'être écrite ne part jamais). */
function save(ctx, id, key, src, img, got, now) {
  return fx.serial(async () => {
    const meta = { id, key: String(key).slice(0, 160), src, img, type: got.type, bytes: got.bytes.length, at: now };
    const old = await store(ctx).getByKey(COL.meta, id);
    const oldBytes = await store(ctx).getByKey(COL.bytes, id);
    await store(ctx).add(COL.bytes, { id, b64: Buffer.from(got.bytes).toString("base64") }, { key: id });
    await store(ctx).add(COL.meta, meta, { key: id });
    if (oldBytes) await store(ctx).remove(oldBytes.id);
    if (old) await store(ctx).remove(old.id);
    const rows = (await store(ctx).list(COL.meta, { limit: LIMITS.items + 100 })).filter((r) => r.data?.id !== id && ID_RE.test(String(r.data?.id)));
    const sorted = rows.sort((a, b) => Number(a.data?.at) - Number(b.data?.at));
    let total = meta.bytes + rows.reduce((n, r) => n + (Number(r.data?.bytes) || 0), 0), count = rows.length + 1;
    for (const r of sorted) {
      if (count <= LIMITS.items && total <= LIMITS.total) break;
      const b = await store(ctx).getByKey(COL.bytes, r.data.id);
      if (b) await store(ctx).remove(b.id);
      await store(ctx).remove(r.id);
      total -= Number(r.data?.bytes) || 0; count--;
    }
  });
}

/** Lance la copie (sans l'attendre) et rend sa promesse, ou null si elle ne peut pas partir maintenant (déjà en cours, trois copies en cours, essai précédent raté trop récent). Ne lève jamais. */
function kick(ctx, id, key, src, img, now) {
  if (pending.has(id)) return pending.get(id);
  if (pending.size >= timing.parallel || waiting(id, now)) return null;
  const run = (async () => {
    const got = await download(hosts.copyCandidates(src, img));
    if (!got) { noteFailure(id, now); return false; }
    failures.delete(id);
    await save(ctx, id, key, src, img, got, Date.now());
    return true;
  })().catch(() => { noteFailure(id, now); return false; }).finally(() => { if (pending.get(id) === run) pending.delete(id); });
  pending.set(id, run);
  return run;
}

/**
 * Pour une jaquette choisie (source `src`, chemin `img`) du titre `key` : l'adresse à montrer, ou null (pas d'image pour le moment).
 *   - copie bonne : son adresse sur le site ; si elle a plus que l'âge réglé, ou vient d'un autre chemin (choix changé), une nouvelle copie est lancée en même temps (la bonne ancienne sert tant que la nouvelle manque) ;
 *   - aucune copie : on la télécharge ici, en attendant au plus `waitMs` (la page ne doit jamais attendre longtemps) ; si elle n'est pas prête, null (elle le sera à la prochaine demande) ;
 *   - Twitch : une copie de plus de 24 h n'est pas montrée (elle est redemandée).
 * Ne lève jamais.
 */
export async function ensure(ctx, key, src, img, { waitMs = 3_000, now = Date.now() } = {}) {
  try {
    const id = idOf(key);
    const have = await readMeta(ctx, id);
    const same = have && have.meta.src === src && have.meta.img === img;
    if (same && usable(ctx, have.meta, now)) {
      if (now - have.meta.at >= keepMs(ctx, src)) void kick(ctx, id, key, src, img, now);
      return routePath(ctx, id);
    }
    // Pas de copie utilisable. Une copie d'un AUTRE choix (la personne a changé de jaquette) ne sert pas : on télécharge la bonne.
    const run = kick(ctx, id, key, src, img, now);
    if (!run) return same && usable(ctx, have.meta, now) ? routePath(ctx, id) : null;
    let timer;
    const ok = await Promise.race([run, new Promise((r) => { timer = setTimeout(() => r(false), waitMs); timer.unref?.(); })]).finally(() => clearTimeout(timer));
    return ok ? routePath(ctx, id) : null;
  } catch { return null; }
}

/** La copie gardée pour ce repère : { type, bytes, meta, expired } ou null. `expired` : une copie Twitch de plus de 24 h (elle ne doit plus être montrée telle quelle). */
export async function copyOf(ctx, id, now = Date.now()) {
  if (!ID_RE.test(String(id))) return null;
  const have = await readMeta(ctx, id);
  if (!have) return null;
  let doc;
  try { doc = await store(ctx).getByKey(COL.bytes, id); } catch { return null; }
  if (!doc || typeof doc.data?.b64 !== "string") return null;
  const type = ["image/jpeg", "image/png", "image/webp"].includes(have.meta.type) ? have.meta.type : null;
  const bytes = Buffer.from(doc.data.b64, "base64");
  if (!type || !bytes.length || bytes.length > LIMITS.bytes || sniff(bytes) !== type) return null;
  return { type, bytes, meta: have.meta, expired: !usable(ctx, have.meta, now) };
}

/**
 * La réponse de la route publique `/m/<clé>/cover/<repère>` : l'image, ou un 404 identique (jamais d'erreur visible). Aucun témoin, aucun paramètre.
 * L'adresse rendue aux autres modules ne doit JAMAIS devenir un 404 pour un jeu connu (Suggestions de jeux la mémorise) :
 *   - copie due pour le renouvellement : l'ancienne est servie tout de suite, le renouvellement part en même temps (paresseux) ;
 *   - copie Twitch de plus de 24 h (conditions de Twitch) : elle n'est pas servie telle quelle, la route la REFAIT à la demande (6 s au plus) et sert la nouvelle ;
 *     si Twitch ne répond pas, l'ancienne est effacée (la règle des 24 h prime) et la réponse est un 404 propre : une image absente, jamais une erreur. Un repère inconnu : 404.
 */
const NOT_FOUND = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
export async function response(request, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  try {
    const id = ctx.params?.slug;
    let copy = await copyOf(ctx, id);
    if (!copy) return NOT_FOUND();
    const now = Date.now();
    if (copy.expired) {
      const m = copy.meta;
      const run = kick(ctx, id, m.key, m.src, m.img, now);
      let timer;
      const ok = run ? await Promise.race([run, new Promise((r) => { timer = setTimeout(() => r(false), timing.fetchMs); timer.unref?.(); })]).finally(() => clearTimeout(timer)) : false;
      copy = ok ? await copyOf(ctx, id) : null;
      if (!copy || copy.expired) { await drop(ctx, id); return NOT_FOUND(); }
    } else if (now - copy.meta.at >= keepMs(ctx, copy.meta.src)) {
      void kick(ctx, id, copy.meta.key, copy.meta.src, copy.meta.img, now);   // l'ancienne sert, la nouvelle est récupérée
    }
    return new Response(request.method === "HEAD" ? null : copy.bytes, { headers: { "Content-Type": copy.type, "Content-Length": String(copy.bytes.length), "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch { return NOT_FOUND(); }
}

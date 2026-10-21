// Ce que le module garde, et rien d'autre : les modèles nommés (avec, pour chaque co-streamer, l'identifiant de sa fiche de Contacts), la petite liste de ponctuels, les préparations venues d'une IA (courte durée de vie) et la clé qui signe
// les accès de l'éditeur. Aucun visiteur. Le stockage est propre à l'instance ; une liste = UN document (l'ordre est celui du tableau).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const images = await import(`./images.mjs${v}`);
const { LIMITS, oneLine, normalizeLogin, cleanConfig, safeImageUrl } = P;

const CO = "story_costreamers", ADHOC = "story_adhoc", MODELS = "story_models", PREPS = "story_preps", KEY = "story_key";
export const PREP_TTL_MS = 7 * 24 * 3600 * 1000, TOKEN_TTL_MS = 12 * 3600 * 1000, MAX_PREPS = 30;

async function readList(ctx, collection) {
  const doc = (await ctx.api.store.list(collection, { limit: 1 }))[0];
  return { doc, items: Array.isArray(doc?.data?.items) ? doc.data.items : [] };
}
async function writeList(ctx, collection, items) {
  const { doc } = await readList(ctx, collection);
  if (doc) await ctx.api.store.update(doc.id, { items }); else await ctx.api.store.add(collection, { items });
}

/* ───────────── Co-streamers ───────────── */
// Les co-streamers viennent de Contacts : un modèle (ou une préparation) ne garde que l'IDENTIFIANT de la fiche. Ce que Story garde lui-même, c'est :
//   - `story_adhoc` : une petite liste de « ponctuels » (20 au plus) : les personnes sans équivalent dans Contacts (reprises de l'ancienne liste quand Contacts ne pouvait pas les
//     accueillir). Jamais une fiche ;
//   - `story_costreamers` : l'ANCIENNE liste de la version 1, laissée telle quelle tant que la migration n'a pas pu la confier à Contacts (lue en repli, puis effacée à la fin).
// Migration « à retirer en phase 3 » : voir migrate.mjs.

/** Les adresses d'image gardées : seulement https (c'est le serveur qui les relit, via la liste blanche de images.mjs). */
const imageOf = (x) => { const u = safeImageUrl(x); return /^https:\/\//.test(u) ? u : ""; };
const cleanOld = (x) => {
  const n = normalizeLogin(x?.login);
  return n.login ? { login: n.login, name: oneLine(x?.name, LIMITS.displayName), image: imageOf(x?.image) } : null;
};
/** L'ancienne liste (version 1) : { docs, items }. Les doublons et les entrées mal formées sont écartés. */
export async function readLegacy(ctx) {
  const docs = await ctx.api.store.list(CO, { limit: 5 });
  const seen = new Set(), items = [];
  for (const doc of docs) for (const x of Array.isArray(doc?.data?.items) ? doc.data.items : []) { const m = cleanOld(x); if (m && !seen.has(m.login)) { seen.add(m.login); items.push(m); } }
  return { docs, items: items.slice(0, LIMITS.savedCostreamers) };
}
export async function removeLegacy(ctx) { for (const doc of await ctx.api.store.list(CO, { limit: 5 })) await ctx.api.store.remove(doc.id); }

const cleanAdhoc = (x) => {
  const m = P.cleanMember({ login: x?.login, name: x?.name, image: x?.image });
  const id = /^[a-z0-9]{6,24}$/.test(String(x?.id ?? "")) ? String(x.id) : "";
  return m && !m.id && id ? { id, login: m.login, name: m.name, image: m.image } : null;
};
export async function readAdhoc(ctx) {
  const seen = new Set(), out = [];
  for (const x of (await readList(ctx, ADHOC)).items) { const m = cleanAdhoc(x); if (m && !seen.has(P.memberKey(m))) { seen.add(P.memberKey(m)); out.push(m); } }
  return out.slice(0, LIMITS.adhoc);
}
/** Ajoute des ponctuels (sans doublon, 20 au plus). `entries` : [{ login, name, image }]. Rend { added, skipped }. */
export async function addAdhoc(ctx, entries) {
  const items = await readAdhoc(ctx), have = new Set(items.map((m) => P.memberKey(m)));
  let added = 0, skipped = 0;
  for (const raw of Array.isArray(entries) ? entries : []) {
    const m = P.cleanMember({ login: raw?.login, name: raw?.name, image: raw?.image });
    if (!m || m.id || have.has(P.memberKey(m)) || items.length >= LIMITS.adhoc) { skipped++; continue; }
    have.add(P.memberKey(m)); items.push({ id: randomBytes(8).toString("hex").slice(0, 12), ...m }); added++;
  }
  if (added) await writeList(ctx, ADHOC, items);
  return { added, skipped };
}
export async function removeAdhoc(ctx, id) {
  const items = await readAdhoc(ctx), rest = items.filter((x) => x.id !== String(id));
  if (rest.length === items.length) return { error: "missing" };
  await writeList(ctx, ADHOC, rest);
  return { ok: true, items: rest };
}
/**
 * Les ponctuels proposés dans l'éditeur : ceux de la petite liste, puis (en repli, tant que la migration n'a pas eu lieu) ceux de l'ancienne liste.
 * [{ id, login, name, image, legacy }] ; `id` vide pour un ancien (il ne s'efface pas : la migration s'en charge).
 */
export async function readPickable(ctx) {
  const adhoc = await readAdhoc(ctx), have = new Set(adhoc.map((m) => P.memberKey(m)));
  const legacy = (await readLegacy(ctx)).items.filter((m) => !have.has(P.memberKey(m))).map((m) => ({ id: "", ...m, legacy: true }));
  return [...adhoc.map((m) => ({ ...m, legacy: false })), ...legacy].slice(0, LIMITS.adhoc + LIMITS.savedCostreamers);
}

/** Remet une saisie « pour cette vidéo seulement » en ordre : { ok, entry } ou { error: "empty" | "image" }. L'image doit pouvoir être relayée (liste blanche), sinon elle est refusée. */
export function adhocEntry(input) {
  const m = P.cleanMember({ login: input?.login, name: input?.name, image: input?.image });
  if (!m || m.id) return { error: "empty" };
  const raw = typeof input?.image === "string" ? input.image.trim() : "";
  if (raw && (!m.image || !images.allowedUrl(m.image))) return { error: "image" };
  return { ok: true, entry: m };
}

/** Une configuration de vidéo prête à être gardée : remise en forme, et les photos de ponctuels qui ne pourraient pas être relayées sont retirées. */
export function tidyConfig(config) {
  const c = cleanConfig(config);
  return { ...c, costreamers: c.costreamers.map((m) => (m.id || !m.image || images.allowedUrl(m.image) ? m : { ...m, image: "" })) };
}

/**
 * Réécrit les co-streamers de TOUS les modèles et préparations : `change(entries)` rend les nouvelles entrées, ou null pour ne rien changer.
 * Rend le nombre de modèles et de préparations modifiés. Idempotent dès que `change` l'est.
 */
export async function rewriteMembers(ctx, change) {
  let touched = 0;
  const doc = (await ctx.api.store.list(MODELS, { limit: 1 }))[0];
  if (doc && Array.isArray(doc.data?.items)) {
    let changed = false;
    const items = doc.data.items.map((it) => {
      if (!it || typeof it !== "object" || !it.config || typeof it.config !== "object") return it;
      const next = change(cleanConfig(it.config).costreamers);
      if (!next) return it;
      changed = true; touched++;
      return { ...it, config: { ...it.config, costreamers: next } };
    });
    if (changed) await ctx.api.store.update(doc.id, { ...doc.data, items });
  }
  for (const row of await ctx.api.store.list(PREPS, { limit: 200 })) {
    if (!row.data?.config || typeof row.data.config !== "object") continue;
    const next = change(cleanConfig(row.data.config).costreamers);
    if (!next) continue;
    await ctx.api.store.update(row.id, { ...row.data, config: { ...row.data.config, costreamers: next } });
    touched++;
  }
  return touched;
}

/* ───────────── Ce que Story sait d'une fiche (privacy.subject) ───────────── */
// Contacts demande « tout ce que le site sait de cette personne » (export), l'effacement d'une fiche (erase) ou la fusion de deux fiches (remap). Story ne garde qu'un identifiant :
// chaque réponse compte ces références. Aucune exception, 0 pour un identifiant inconnu ; idempotent.
const validId = (x) => typeof x === "string" && /^[^\s\u0000-\u001f\u007f]{1,80}$/.test(x);
/** Les modèles et préparations qui montrent cette fiche : { models: [nom], preps: nombre }. */
export async function referencesOf(ctx, id) {
  if (!validId(id)) return { models: [], preps: 0 };
  const models = (await readList(ctx, MODELS)).items.filter((m) => m?.config && cleanConfig(m.config).costreamers.some((e) => e.id === id)).map((m) => oneLine(m.name, LIMITS.modelName));
  const preps = (await ctx.api.store.list(PREPS, { limit: 200 })).filter((r) => r.data?.config && cleanConfig(r.data.config).costreamers.some((e) => e.id === id)).length;
  return { models, preps };
}
export async function eraseReferences(ctx, id) {
  if (!validId(id)) return 0;
  let removed = 0;
  await rewriteMembers(ctx, (entries) => (entries.some((e) => e.id === id) ? (removed++, entries.filter((e) => e.id !== id)) : null));
  return removed;
}
export async function remapReferences(ctx, from, to) {
  if (!validId(from) || !validId(to) || from === to) return 0;
  let updated = 0;
  await rewriteMembers(ctx, (entries) => {
    if (!entries.some((e) => e.id === from)) return null;
    updated++;
    const out = [];
    for (const e of entries) { const m = e.id === from ? { id: to } : e; if (!out.some((x) => P.memberKey(x) === P.memberKey(m))) out.push(m); }
    return out;
  });
  return updated;
}

/* ───────────── Modèles nommés ───────────── */

const cleanModel = (x) => {
  const name = oneLine(x?.name, LIMITS.modelName), id = /^[a-z0-9]{6,24}$/.test(String(x?.id ?? "")) ? String(x.id) : "";
  return name && id ? { id, name, config: { ...cleanConfig(x.config), streamKey: "" } } : null;
};
export async function readModels(ctx) { return (await readList(ctx, MODELS)).items.map(cleanModel).filter(Boolean).slice(0, LIMITS.models); }
/** Enregistre un modèle sous un nom. Un nom déjà pris n'est remplacé que si `replaceId` le dit (la confirmation est demandée par la page). Rend { ok, items } ou { error: "name" | "exists" | "full" | "missing" }. */
export async function saveModel(ctx, { name, config, replaceId }) {
  const nm = oneLine(name, LIMITS.modelName);
  if (!nm) return { error: "name" };
  const items = await readModels(ctx), clash = items.findIndex((x) => x.name.toLowerCase() === nm.toLowerCase());
  const at = replaceId ? items.findIndex((x) => x.id === String(replaceId)) : -1;
  if (replaceId && at < 0) return { error: "missing" };
  if (clash >= 0 && clash !== at) return { error: "exists", id: items[clash].id };
  const entry = { id: at >= 0 ? items[at].id : randomBytes(8).toString("hex"), name: nm, config: { ...tidyConfig(config), streamKey: "" } };
  if (at >= 0) items[at] = entry; else { if (items.length >= LIMITS.models) return { error: "full" }; items.push(entry); }
  await writeList(ctx, MODELS, items);
  return { ok: true, items, id: entry.id };
}
export async function removeModel(ctx, id) {
  const items = await readModels(ctx), rest = items.filter((x) => x.id !== String(id));
  if (rest.length === items.length) return { error: "missing" };
  await writeList(ctx, MODELS, rest);
  return { ok: true, items: rest };
}

/* ───────────── Préparations (venues d'une IA) ───────────── */

const PID = /^[A-Za-z0-9_-]{22}$/;
/** Enregistre une préparation : un identifiant au hasard (rien d'autre n'est dans l'adresse), valable 7 jours. Les plus anciennes sont retirées au-delà de MAX_PREPS. */
export async function savePrep(ctx, { config, manual, now = Date.now() }) {
  const rows = await ctx.api.store.list(PREPS, { limit: 200 });
  const live = rows.filter((r) => Number(r.data?.expiresAt) > now);
  for (const r of rows) if (!live.includes(r)) await ctx.api.store.remove(r.id);
  const sorted = live.sort((a, b) => Number(a.data.expiresAt) - Number(b.data.expiresAt));
  while (sorted.length >= MAX_PREPS) await ctx.api.store.remove(sorted.shift().id);
  const pid = randomBytes(16).toString("base64url");
  await ctx.api.store.add(PREPS, { pid, config: tidyConfig(config), ...(manual ? { manual } : {}), createdAt: now, expiresAt: now + PREP_TTL_MS });
  return { pid, expiresAt: now + PREP_TTL_MS };
}
/** Relit une préparation encore valable : { config, manual } ou null (inconnue, expirée ou mal formée). Ne crée rien. */
export async function readPrep(ctx, pid, now = Date.now()) {
  if (typeof pid !== "string" || !PID.test(pid)) return null;
  const row = (await ctx.api.store.list(PREPS, { limit: 200 })).find((r) => r.data?.pid === pid);
  if (!row || !(Number(row.data.expiresAt) > now)) return null;
  const m = row.data.manual;
  const manual = m && typeof m === "object" ? { title: oneLine(m.title, LIMITS.title), date: String(m.date ?? "").slice(0, 10), time: String(m.time ?? "").slice(0, 5) } : null;
  return { config: cleanConfig(row.data.config), manual, expiresAt: Number(row.data.expiresAt) };
}

/* ───────────── L'accès de l'éditeur : un jeton signé, de courte durée ───────────── */
// La page de l'éditeur est servie par une route du module : le cœur ne dit pas à une route qui l'appelle. Le panneau d'administration (réservé aux administrateurs)
// y glisse donc un jeton signé (12 h) ; sans lui, les routes de données ne répondent rien d'utile. Il ne figure jamais dans une adresse envoyée au serveur (partie « # »).
const usableSecret = (r) => typeof r.data?.secret === "string" && r.data.secret.length >= 20;
const oldest = (rows) => rows.filter(usableSecret).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] ?? null;
async function secretOf(ctx, create) {
  let rows = await ctx.api.store.list(KEY, { limit: 20 });
  if (!oldest(rows)) {
    if (!create) return null;
    await ctx.api.store.add(KEY, { secret: randomBytes(32).toString("base64url") });
    rows = await ctx.api.store.list(KEY, { limit: 20 });
  }
  const keep = oldest(rows);
  if (create) for (const r of rows) if (r.id !== keep.id) { try { await ctx.api.store.remove(r.id); } catch { /* retiré à la prochaine lecture */ } }
  return keep.data.secret;
}
const sign = (secret, exp) => createHmac("sha256", secret).update(`story|${exp}`).digest("base64url");
export async function mintToken(ctx, now = Date.now()) {
  const exp = now + TOKEN_TTL_MS;
  return `${exp}.${sign(await secretOf(ctx, true), exp)}`;
}
/** Le jeton est-il valable ? Comparaison à temps constant. Ne crée rien. */
export async function tokenValid(ctx, token, now = Date.now()) {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,60})$/.exec(typeof token === "string" ? token : "");
  if (!m || Number(m[1]) < now || Number(m[1]) > now + TOKEN_TTL_MS + 60_000) return false;
  const secret = await secretOf(ctx, false);
  if (!secret) return false;
  const a = Buffer.from(sign(secret, m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && timingSafeEqual(a, b);
}

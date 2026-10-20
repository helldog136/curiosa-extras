// Ce que le module garde, et rien d'autre : la liste de co-streamers, les modèles nommés, les préparations venues d'une IA (courte durée de vie) et la clé qui signe
// les accès de l'éditeur. Aucun visiteur. Le stockage est propre à l'instance ; une liste = UN document (l'ordre est celui du tableau).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const { LIMITS, oneLine, normalizeLogin, cleanConfig, safeImageUrl } = P;

const CO = "story_costreamers", MODELS = "story_models", PREPS = "story_preps", KEY = "story_key";
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

/** Les adresses d'image gardées : seulement https (c'est le serveur qui les relit, via la liste blanche de images.mjs). */
const imageOf = (x) => { const u = safeImageUrl(x); return /^https:\/\//.test(u) ? u : ""; };
const cleanMember = (x) => {
  const n = normalizeLogin(x?.login);
  return n.login ? { login: n.login, name: oneLine(x?.name, LIMITS.displayName), image: imageOf(x?.image) } : null;
};
export async function readCostreamers(ctx) {
  const seen = new Set(), out = [];
  for (const x of (await readList(ctx, CO)).items) { const m = cleanMember(x); if (m && !seen.has(m.login)) { seen.add(m.login); out.push(m); } }
  return out.slice(0, LIMITS.savedCostreamers);
}
/** Ajoute ou met à jour un co-streamer. Rend { ok, items } ou { error: "empty" | "invalid" | "not_channel" | "full" }. */
export async function saveCostreamer(ctx, input, { originalLogin } = {}) {
  const n = normalizeLogin(input?.login);
  if (n.error) return { error: n.error };
  const items = await readCostreamers(ctx);
  const from = originalLogin ? items.findIndex((x) => x.login === String(originalLogin)) : items.findIndex((x) => x.login === n.login);
  const next = { login: n.login, name: oneLine(input?.name, LIMITS.displayName), image: imageOf(input?.image) };
  if (from >= 0) {
    if (items.some((x, i) => i !== from && x.login === n.login)) return { error: "dup" };
    items[from] = { ...next, image: input?.image === undefined ? items[from].image : next.image };
  } else {
    if (items.length >= LIMITS.savedCostreamers) return { error: "full" };
    items.push(next);
  }
  await writeList(ctx, CO, items);
  return { ok: true, items };
}
export async function removeCostreamer(ctx, login) {
  const items = await readCostreamers(ctx), rest = items.filter((x) => x.login !== String(login));
  if (rest.length === items.length) return { error: "missing" };
  await writeList(ctx, CO, rest);
  return { ok: true, items: rest };
}
/**
 * Reprend des partenaires (venus d'un autre module, par un sujet) SANS rien retirer ni écraser : les nouveaux sont ajoutés ; pour ceux qui sont déjà là, seule une image manquante est complétée.
 * `incoming` : [{ login, name, image }]. Rend { ok, added, updated, skipped, items }.
 */
export async function mergeCostreamers(ctx, incoming) {
  const items = await readCostreamers(ctx);
  let added = 0, updated = 0, skipped = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const m = cleanMember(raw);
    if (!m) { skipped++; continue; }
    const at = items.findIndex((x) => x.login === m.login);
    if (at >= 0) { if (!items[at].image && m.image) { items[at] = { ...items[at], image: m.image }; updated++; } else skipped++; }
    else if (items.length < LIMITS.savedCostreamers) { items.push(m); added++; } else skipped++;
  }
  if (added || updated) await writeList(ctx, CO, items);
  return { ok: true, added, updated, skipped, items };
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
  const entry = { id: at >= 0 ? items[at].id : randomBytes(8).toString("hex"), name: nm, config: { ...cleanConfig(config), streamKey: "" } };
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
  await ctx.api.store.add(PREPS, { pid, config: cleanConfig(config), ...(manual ? { manual } : {}), createdAt: now, expiresAt: now + PREP_TTL_MS });
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

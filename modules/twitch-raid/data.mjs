// Ce que le module garde : la liste des chaînes partenaires de la personne, et l'adresse secrète de son dock. Rien d'autre, aucun visiteur.
// Une liste = UN document (100 chaînes au plus) : l'ordre est celui du tableau, et il n'y a rien à recoller en cas de coupure.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { normalizeLogin, oneLine, splitList, MAX_PARTNERS } = await import(`./pure.mjs${v}`);

const LIST = "partners", DOCK = "dock";

/** La liste : [{ login, name, note }] dans l'ordre choisi. */
export async function readPartners(ctx) {
  const doc = (await ctx.api.store.list(LIST, { limit: 1 }))[0];
  const items = Array.isArray(doc?.data?.items) ? doc.data.items : [];
  return items.filter((x) => x && typeof x.login === "string").map((x) => ({ login: x.login, name: oneLine(x.name, 40), note: oneLine(x.note, 200) })).slice(0, MAX_PARTNERS);
}
async function writePartners(ctx, items) {
  const doc = (await ctx.api.store.list(LIST, { limit: 1 }))[0];
  const data = { items };
  if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(LIST, data);
}

/**
 * Ajoute des chaînes (texte collé). Rend { added: [login], dup: [login], bad: [{ text, error }], full: [login] } ; enregistre ce qui est valable.
 * Une erreur ne bloque pas le reste : on dit simplement ce qui n'a pas été ajouté, et pourquoi.
 */
export async function addPartners(ctx, text, { name = "", note = "" } = {}) {
  const items = await readPartners(ctx);
  const res = { added: [], dup: [], bad: [], full: [] };
  const known = new Set(items.map((x) => x.login));
  const tokens = splitList(text);
  for (const token of tokens) {
    const r = normalizeLogin(token);
    if (r.error) { res.bad.push({ text: oneLine(token, 60), error: r.error }); continue; }
    if (known.has(r.login)) { if (!res.dup.includes(r.login)) res.dup.push(r.login); continue; }
    if (items.length >= MAX_PARTNERS) { res.full.push(r.login); continue; }
    known.add(r.login);
    items.push({ login: r.login, name: tokens.length === 1 ? oneLine(name, 40) : "", note: tokens.length === 1 ? oneLine(note, 200) : "" });
    res.added.push(r.login);
  }
  if (res.added.length) await writePartners(ctx, items);
  return res;
}

/** Modifie une chaîne (pseudo, nom affiché, note). Rend { ok: true } ou { error: "missing" | "invalid" | "empty" | "not_channel" | "dup" }. */
export async function updatePartner(ctx, login, { newLogin, name, note }) {
  const items = await readPartners(ctx);
  const i = items.findIndex((x) => x.login === login);
  if (i < 0) return { error: "missing" };
  const r = normalizeLogin(newLogin ?? login);
  if (r.error) return { error: r.error };
  if (r.login !== login && items.some((x) => x.login === r.login)) return { error: "dup", login: r.login };
  items[i] = { login: r.login, name: oneLine(name, 40), note: oneLine(note, 200) };
  await writePartners(ctx, items);
  return { ok: true, login: r.login };
}

export async function removePartner(ctx, login) {
  const items = await readPartners(ctx);
  const next = items.filter((x) => x.login !== login);
  if (next.length === items.length) return { error: "missing" };
  await writePartners(ctx, next);
  return { ok: true };
}

/** Monte (-1) ou descend (+1) une chaîne dans la liste. */
export async function movePartner(ctx, login, delta) {
  const items = await readPartners(ctx);
  const i = items.findIndex((x) => x.login === login), j = i + delta;
  if (i < 0) return { error: "missing" };
  if (j < 0 || j >= items.length) return { ok: true, moved: false };
  [items[i], items[j]] = [items[j], items[i]];
  await writePartners(ctx, items);
  return { ok: true, moved: true };
}

/* ───────────── L'adresse secrète du dock ───────────── */

const newSecret = () => randomBytes(24).toString("base64url");   // 192 bits
const usable = (r) => typeof r.data?.secret === "string" && r.data.secret.length >= 20;
/** Le secret qui fait foi : le plus ancien (si deux demandes simultanées en ont créé chacune un). */
const oldest = (rows) => rows.filter(usable).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] ?? null;

/** La ligne du secret, créée au premier besoin ; les doublons éventuels sont retirés (la personne ne voit jamais deux secrets différents). */
async function secretRow(ctx) {
  let rows = await ctx.api.store.list(DOCK, { limit: 20 });
  if (!oldest(rows)) {
    if (rows.length) await ctx.api.store.update(rows[0].id, { secret: newSecret() }); else await ctx.api.store.add(DOCK, { secret: newSecret() });
    rows = await ctx.api.store.list(DOCK, { limit: 20 });
  }
  const keep = oldest(rows);
  for (const r of rows) if (r.id !== keep.id) { try { await ctx.api.store.remove(r.id); } catch { /* sera retiré à la prochaine lecture */ } }
  return keep;
}

export const dockSecret = async (ctx) => (await secretRow(ctx)).data.secret;

/** Une nouvelle adresse : l'ancienne cesse de fonctionner tout de suite. */
export async function renewSecret(ctx) {
  const row = await secretRow(ctx);
  const secret = newSecret();
  await ctx.api.store.update(row.id, { secret });
  return secret;
}

/** Le secret reçu est-il le bon ? Comparaison à temps constant (sur des empreintes de même longueur : la longueur ne fuit pas non plus). Ne crée rien. */
export async function secretMatches(ctx, given) {
  if (typeof given !== "string" || !given || given.length > 200) return false;
  const row = oldest(await ctx.api.store.list(DOCK, { limit: 20 }));
  if (!row) return false;
  const h = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(row.data.secret), h(given));
}

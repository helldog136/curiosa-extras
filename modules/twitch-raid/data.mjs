// Ce que le module garde (2.0) : l'adresse secrète de son dock, et rien sur les personnes. La liste des chaînes vit dans Contacts (une catégorie, voir source.mjs).
// L'ancienne liste propre au module (1.x, collection « partners », UN document) reste TELLE QUELLE après la migration vers Contacts (voir migrate.mjs) :
// une copie inerte que le module ne relit jamais pour faire son travail. Seules exceptions : la migration elle-même (qui la recopie dans Contacts) et
// les demandes de vie privée venues de Contacts (export, effacement d'une personne : voir privacy.mjs). À retirer en phase 3.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { normalizeLogin, oneLine, dedupe, MAX_PARTNERS } = await import(`./pure.mjs${v}`);

export const LEGACY = "partners", DOCK = "dock";

/** L'ancienne liste (1.x) : [{ login, name, note }] dans son ordre, nettoyée et bornée (2 000). Lecture seule. */
export async function readLegacy(ctx) {
  const doc = (await ctx.api.store.list(LEGACY, { limit: 1 }))[0];
  const items = Array.isArray(doc?.data?.items) ? doc.data.items : [];
  return dedupe(items.filter((x) => x && typeof x.login === "string").map((x) => ({ login: normalizeLogin(x.login).login ?? "", name: oneLine(x.name, 40), note: oneLine(x.note, 200) })).filter((x) => x.login)).slice(0, MAX_PARTNERS);
}

/** Vie privée : retire ces pseudos de l'ancienne copie (effacement d'une personne demandé dans Contacts). Rend le nombre de lignes retirées. */
export async function forgetLegacy(ctx, logins) {
  const wanted = new Set(logins);
  if (!wanted.size) return 0;
  const doc = (await ctx.api.store.list(LEGACY, { limit: 1 }))[0];
  const items = Array.isArray(doc?.data?.items) ? doc.data.items : [];
  const keep = items.filter((x) => !(x && typeof x.login === "string" && wanted.has(normalizeLogin(x.login).login)));
  if (keep.length === items.length) return 0;
  await ctx.api.store.update(doc.id, { ...doc.data, items: keep });
  return items.length - keep.length;
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

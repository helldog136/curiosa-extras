// CORRIGER UNE JAQUETTE — les opérations communes à l'écran d'administration, au service `game.cover` et aux outils de l'assistant (un seul chemin, donc les mêmes règles partout).
// Règles : le titre est borné (120 caractères) ; le choix d'un jeu se fait par son NUMÉRO RAWG et l'image vient de la réponse de RAWG (jamais d'une adresse envoyée par la personne) ;
// une image donnée à la main doit être une adresse `https://media.rawg.io/media/…` (rien n'est téléchargé : on garde l'adresse) ; au plus 1000 corrections ;
// une cadence limitée par personne (ou par jeton) pour les lectures chez RAWG comme pour les écritures.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);

const RATE = { read: { max: 30, perMs: 60_000 }, write: { max: 60, perMs: 60_000 } };
const hits = new Map();
/** Prend une place dans la cadence de cette personne ; faux si elle a trop demandé. Mémoire bornée (500 personnes ou jetons au plus). */
export function takeRate(who, kind, now = Date.now()) {
  const key = `${kind}:${String(who).slice(0, 80)}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE[kind].perMs);
  if (recent.length >= RATE[kind].max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > 500) hits.delete(hits.keys().next().value);
  return true;
}
export const resetRate = () => hits.clear();

/** Le titre tel qu'il sera gardé : nettoyé, jamais vide ni plus long que 120 caractères ; sinon null. */
export function checkTitle(input) {
  if (typeof input !== "string" || input.length > 400) return null;
  const title = rawg.cleanTitle(input, fx.MAX_FIX_TITLE + 1);
  return title && title.length <= fx.MAX_FIX_TITLE && titleKey(title) ? title : null;
}

/** Les jeux proposés pour ce titre (6 au plus), à la demande. */
export async function candidatesFor(ctx, who, title, search, opts) {
  if (!takeRate(who, "read")) return { status: "rate", candidates: [] };
  return rawg.candidates(ctx, title, search, opts);
}

const finish = (r) => (r.ok ? r : { ok: false, error: r.error });

/** « C'est ce jeu » : garde le jeu de numéro `rawgId` parmi les propositions de RAWG pour ce titre (ou pour `search`). → { ok: true, fix } | { ok: false, error } */
export async function chooseGame(ctx, who, rawTitle, rawgId, search) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!Number.isSafeInteger(rawgId) || rawgId <= 0) return { ok: false, error: "candidate" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const found = await rawg.candidates(ctx, title, search);
  if (found.status === "no-key" || found.status === "refused" || found.status === "unreachable") return { ok: false, error: found.status };
  const game = found.candidates.find((c) => c.id === rawgId);
  if (!game) return { ok: false, error: "candidate" };
  const img = fx.rawgImagePath(game.url);
  if (!img) return { ok: false, error: "image" };
  return finish(await fx.saveFix(ctx, title, { kind: "game", rawgId: game.id, name: game.name, img }));
}

/** « Aucune jaquette » : ce titre n'aura plus de jaquette. */
export async function chooseNone(ctx, who, rawTitle) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  return finish(await fx.saveFix(ctx, title, { kind: "none" }));
}

/** Une image de RAWG choisie à la main (adresse `https://media.rawg.io/media/…` uniquement). */
export async function chooseImage(ctx, who, rawTitle, address) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  const img = fx.rawgImagePath(typeof address === "string" ? address.trim() : "");
  if (!img) return { ok: false, error: "image" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  return finish(await fx.saveFix(ctx, title, { kind: "image", img }));
}

/** « Ce choix est bon » : garde le jeu actuellement trouvé pour ce titre, tel quel, et le retire de la liste. */
export async function confirmCurrent(ctx, who, rawTitle) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const key = titleKey(title);
  const entry = (await fx.readToCheck(ctx)).find((d) => d.key === key);
  if (entry) return finish(await fx.saveFix(ctx, entry.title, entry.rawgId ? { kind: "game", rawgId: entry.rawgId, name: entry.name, img: entry.img } : { kind: "image", img: entry.img, name: entry.name }));
  // Pas dans la liste (page ouverte à la main) : on garde ce que RAWG donne en ce moment.
  const now = await rawg.cover(ctx, title);
  if (now.status !== "found" || !now.url) return { ok: false, error: now.status === "none" ? "nothing" : now.status === "found" ? "image" : now.status };
  const img = fx.rawgImagePath(now.url);
  if (!img) return { ok: false, error: "image" };
  return finish(await fx.saveFix(ctx, title, now.id ? { kind: "game", rawgId: now.id, name: now.name ?? "", img } : { kind: "image", img, name: now.name }));
}

/** Oublie la correction d'un titre (clé normalisée) : le titre retrouve le choix automatique. */
export async function forget(ctx, who, key) {
  if (typeof key !== "string" || key.length > 160 || !takeRate(who, "write")) return false;
  return fx.forgetFix(ctx, key);
}
export async function forgetAll(ctx, who) {
  return takeRate(who, "write") ? fx.forgetAllFixes(ctx) : null;
}

/** Une ligne lisible du choix (titre et choix, jamais de secret). */
export const fixSummary = (f) => `${f.title} → ${f.kind === "none" ? "no cover" : f.kind === "image" ? "image" : `${f.name ?? ""} #${f.rawgId ?? ""}`}`.slice(0, 300);

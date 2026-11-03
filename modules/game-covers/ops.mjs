// CORRIGER UNE JAQUETTE — les opérations communes à l'écran d'administration, au service `game.cover` et aux outils de l'assistant (un seul chemin, donc les mêmes règles partout).
// Règles : le titre est borné (120 caractères) ; le choix d'un jeu se fait par sa SOURCE et son NUMÉRO chez elle et l'image vient de la réponse de la source (jamais d'une adresse envoyée par la personne) ;
// une image donnée à la main doit être une adresse `https://media.rawg.io/media/…` ; l'image choisie est copiée sur le site tout de suite (copies.mjs) ; au plus 1000 corrections ;
// une cadence limitée par personne (ou par jeton) pour les lectures chez RAWG comme pour les écritures.
const q = new URL(import.meta.url).search;
const { titleKey } = await import(new URL("./match.mjs" + q, import.meta.url).href);
const fx = await import(new URL("./fixes.mjs" + q, import.meta.url).href);
const rawg = await import(new URL("./rawg.mjs" + q, import.meta.url).href);
const hosts = await import(new URL("./hosts.mjs" + q, import.meta.url).href);
const chain = await import(new URL("./chain.mjs" + q, import.meta.url).href);
const copies = await import(new URL("./copies.mjs" + q, import.meta.url).href);

/** Une ligne au journal du cœur : le titre du jeu et le geste, jamais une clé ni une adresse. Ne lève jamais. */
const journal = (ctx, action, title, data) => fx.journal(ctx, action, title, data);

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

/** Les jeux proposés pour ce titre par toutes les sources disponibles (6 au plus par source), à la demande. */
export async function candidatesFor(ctx, who, title, search, opts) {
  if (!takeRate(who, "read")) return { status: "rate", candidates: [], sources: [] };
  return chain.candidates(ctx, title, search, opts);
}

/** Garde une copie de l'image choisie sans attendre longtemps ; un échec n'est jamais une erreur (elle sera refaite à la prochaine demande). */
const copyNow = (ctx, title, src, img) => copies.ensure(ctx, titleKey(title), src, img, { waitMs: 4_000 });

const finish = async (r, ctx, action) => {
  if (!r.ok) return { ok: false, error: r.error };
  await journal(ctx, action, r.fix.title);
  return r;
};

/** « C'est ce jeu » : garde le jeu de numéro `id` chez la source `src` (RAWG par défaut) parmi les propositions pour ce titre (ou pour `search`). → { ok: true, fix } | { ok: false, error } */
export async function chooseGame(ctx, who, rawTitle, id, search, src = "rawg") {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!hosts.isSource(src) || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: "candidate" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const found = await chain.candidates(ctx, title, search);
  if (found.status === "no-key" || found.status === "refused" || found.status === "unreachable") return { ok: false, error: found.status };
  const game = found.candidates.find((c) => c.source === src && c.id === id);
  if (!game) return { ok: false, error: "candidate" };
  const img = hosts.imagePath(src, game.url);
  if (!img) return { ok: false, error: "image" };
  const choice = src === "rawg" ? { kind: "game", rawgId: game.id, name: game.name, img } : { kind: "image", name: game.name, img, src, srcId: game.id };
  const done = await finish(await fx.saveFix(ctx, title, choice), ctx, "cover.game");
  if (done.ok) await copyNow(ctx, title, src, img);
  return done;
}

/** « Aucune jaquette » : ce titre n'aura plus de jaquette. */
export async function chooseNone(ctx, who, rawTitle) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  return finish(await fx.saveFix(ctx, title, { kind: "none" }), ctx, "cover.none");
}

/** Une image de RAWG choisie à la main (adresse `https://media.rawg.io/media/…` uniquement). */
export async function chooseImage(ctx, who, rawTitle, address) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  const img = fx.rawgImagePath(typeof address === "string" ? address.trim() : "");
  if (!img) return { ok: false, error: "image" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const done = await finish(await fx.saveFix(ctx, title, { kind: "image", img }), ctx, "cover.image");
  if (done.ok) await copyNow(ctx, title, "rawg", img);
  return done;
}

/** Le choix gardé tel quel : un jeu RAWG (kind « game »), sinon une image de la source (kind « image »). */
const asChoice = (e) => (e.src && e.src !== "rawg" ? { kind: "image", img: e.img, name: e.name, src: e.src, srcId: e.srcId }
  : e.rawgId ? { kind: "game", rawgId: e.rawgId, name: e.name ?? "", img: e.img } : { kind: "image", img: e.img, name: e.name });

/** « Ce choix est bon » : garde le jeu actuellement trouvé pour ce titre, tel quel, et le retire de la liste. */
export async function confirmCurrent(ctx, who, rawTitle) {
  const title = checkTitle(rawTitle);
  if (!title) return { ok: false, error: "title" };
  if (!takeRate(who, "write")) return { ok: false, error: "rate" };
  const key = titleKey(title);
  const keep = async (e) => {
    const done = await finish(await fx.saveFix(ctx, e.title, asChoice(e)), ctx, "cover.confirmed");
    if (done.ok) await copyNow(ctx, e.title, e.src ?? "rawg", e.img);
    return done;
  };
  const entry = (await fx.readToCheck(ctx)).find((d) => d.key === key);
  if (entry) return keep(entry);
  // Une jaquette que le site a trouvée toute seule (gardée dans le stockage) : on la garde telle quelle, sans interroger personne.
  const auto = await fx.autoFor(ctx, title);
  if (auto) return keep(auto);
  // Pas dans la liste (page ouverte à la main) : on garde ce que la chaîne de sources donne en ce moment.
  const now = await chain.cover(ctx, title);
  if (now.status !== "found" && now.status !== "unreachable") return { ok: false, error: now.status === "none" ? "nothing" : now.status };
  const fresh = await fx.autoFor(ctx, title);
  if (!fresh) return { ok: false, error: now.status === "unreachable" ? "unreachable" : "image" };
  return keep(fresh);
}

/** Oublie la correction d'un titre (clé normalisée) : le titre retrouve le choix automatique. */
export async function forget(ctx, who, key, title) {
  if (typeof key !== "string" || key.length > 160 || !takeRate(who, "write")) return false;
  const done = await fx.forgetFix(ctx, key);
  if (done) { await copies.dropForKey(ctx, key); await journal(ctx, "cover.forgotten", title ?? key); }
  return done;
}
/** Oublie un choix automatique (titre noté « à vérifier » et jaquette gardée toute seule) : le site cherchera de nouveau. */
export async function forgetAuto(ctx, who, key, title) {
  if (typeof key !== "string" || key.length > 160 || !takeRate(who, "write")) return false;
  const done = await fx.forgetTodo(ctx, key);
  if (done) { await copies.dropForKey(ctx, key); await journal(ctx, "cover.forgotten", title ?? key); }
  return done;
}
export async function forgetAll(ctx, who) {
  const n = takeRate(who, "write") ? await fx.forgetAllFixes(ctx) : null;
  if (n) await journal(ctx, "cover.cleared", "", { count: n });
  return n;
}

/** Une ligne lisible du choix (titre et choix, jamais de secret). */
export const fixSummary = (f) => `${f.title} → ${f.kind === "none" ? "no cover" : f.kind === "image" ? "image" : `${f.name ?? ""} #${f.rawgId ?? ""}`}`.slice(0, 300);

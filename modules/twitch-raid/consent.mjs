// CONSENTEMENT (2.2) : qui a le droit d'être MONTRÉ par la « Sélection du moment » (dock de sélection et page publique) ?
// Contacts possède les personnes. Une fiche est montrable si elle n'est PAS rangée dans la catégorie « Ne pas montrer » et si elle n'attend pas encore sa relecture
// (`status: "to_review"`, une fiche arrivée par un formulaire) : la même règle que le Mur des remerciements. Ce module ne recopie rien : il demande à Contacts (`resolve`,
// 100 fiches par appel) SEULEMENT pour les membres en direct (au plus quelques centaines), et se souvient du verdict 2 minutes, en mémoire.
// Règles :
//   - on échoue du côté de la prudence : une fiche que Contacts ne sait pas dire (inconnue, fusionnée, pas de fiche) n'est pas montrée ;
//   - la catégorie « Ne pas montrer » : le réglage `hide` (suivie après une fusion de catégories) ; sinon une catégorie qui s'appelle « Ne pas montrer » / « Do not show » ;
//     si Contacts ne peut pas dire laquelle c'est, on ne devine pas : `unverified` (l'appelant garde le dernier état connu ou ne montre rien) ;
//   - chaque appel à Contacts est borné, l'ensemble aussi ; rien n'est écrit sur le disque.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { fold, oneLine } = await import(`./pure.mjs${v}`);
const source = await import(`./source.mjs${v}`);

/** Les noms de catégorie reconnus d'office comme « ne pas montrer » quand aucune n'est choisie (comparés sans casse ni accents). */
export const HIDE_NAMES = ["ne pas montrer", "do not show"];
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { readMs: 4500, hideMs: 60_000, verdictMs: 120_000, staleMs: 10 * 60_000 };
const VERDICT_MAX = 5000, PAGE = 100;

const hideCache = new Map();      // instance|réglage → { value, until, at }
const verdicts = new Map();       // instance|catégorie cachée|fiche → { ok, until, at }
export const resetConsent = () => { hideCache.clear(); verdicts.clear(); };

const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;
const items = (value) => (Array.isArray(value?.items) ? value.items.filter((x) => x && isId(x.id)) : []);
const label = (x) => oneLine(x?.label ?? x?.name, 100);

/** Le réglage `hide` (une catégorie de Contacts), ou "". */
export const hideSetting = (ctx) => { const s = ctx.setting("hide"); return typeof s === "string" && isId(s.trim()) ? s.trim() : ""; };

async function readHide(ctx) {
  const raw = hideSetting(ctx);
  if (raw) {
    const r = await source.ask(ctx, "categoriesResolve", { ids: [raw] }, source.timing.callMs);
    if (!r.ok) return { state: "unverified" };
    const hit = items(r.value).find((k) => k.id === raw);
    if (hit) return { state: "ok", id: raw, how: "chosen", label: label(hit) };
    const to = r.value.moved && typeof r.value.moved === "object" ? r.value.moved[raw] : null;
    if (isId(to)) return { state: "ok", id: to, how: "chosen", label: "" };   // fusionnée dans une autre : on la suit
    return { state: "ok", id: null, how: "gone" };                            // supprimée : plus personne n'est caché par elle (l'administration le dit)
  }
  const found = await Promise.all(HIDE_NAMES.map((q) => source.ask(ctx, "categories", { q, limit: 20 }, source.timing.callMs)));
  if (found.some((r) => !r.ok)) return { state: "unverified" };
  for (const r of found) for (const k of items(r.value)) if (HIDE_NAMES.includes(fold(label(k)))) return { state: "ok", id: k.id, how: "named", label: label(k) };
  return { state: "ok", id: null, how: "none" };
}

/**
 * La catégorie « Ne pas montrer » : { state: "ok", id: string|null, how: "chosen" | "named" | "none" | "gone", label? } ou { state: "unverified" } (Contacts n'a pas pu le dire).
 * Gardée 1 minute ; si Contacts se tait, le dernier verdict connu sert jusqu'à 10 minutes.
 */
export async function hideCategory(ctx) {
  const k = `${ctx.instance.key}|${hideSetting(ctx)}`, now = Date.now(), hit = hideCache.get(k);
  if (hit && hit.until > now) return hit.value;
  const value = await readHide(ctx).catch(() => ({ state: "unverified" }));
  if (value.state === "ok") {
    if (hideCache.size >= 100) hideCache.delete(hideCache.keys().next().value);
    hideCache.set(k, { value, until: now + timing.hideMs, at: now });
    return value;
  }
  return hit && now - hit.at <= timing.staleMs ? hit.value : value;
}

/** Une fiche est-elle montrable ? (`card` : ce que Contacts rend pour une fiche) */
export const shown = (card, hideId) => !!card && card.status !== "to_review" && !(hideId && Array.isArray(card.categoryIds) && card.categoryIds.includes(hideId));

/**
 * Parmi ces fiches de Contacts, lesquelles peuvent être montrées ? Rend { state: "ok", allowed: Set d'ids, hide } ou { state: "unverified" } (la catégorie « Ne pas montrer » est
 * inconnue : on ne devine pas). Un verdict déjà connu (moins de 2 minutes) n'est pas redemandé ; si Contacts ne répond pas pour le reste, un ancien verdict (10 minutes
 * au plus) sert, et sans verdict la fiche n'est PAS montrée.
 */
export async function allowedContacts(ctx, ids) {
  const hide = await hideCategory(ctx);
  if (hide.state !== "ok") return { state: "unverified" };
  const prefix = `${ctx.instance.key}|${hide.id ?? ""}|`, now = Date.now();
  const want = [...new Set(ids.filter(isId))];
  const unknown = want.filter((id) => { const h = verdicts.get(prefix + id); return !h || h.until <= now; });
  const deadline = now + timing.readMs;
  for (let i = 0; i < unknown.length && Date.now() < deadline; i += PAGE) {
    const part = unknown.slice(i, i + PAGE);
    const r = await source.ask(ctx, "resolve", { ids: part }, Math.max(0, Math.min(source.timing.callMs, deadline - Date.now())));
    if (!r.ok) break;   // Contacts muet : on garde ce qu'on sait, le reste n'est pas montré
    const cards = new Map((Array.isArray(r.value.contacts) ? r.value.contacts : []).filter((c) => c && isId(c.id)).map((c) => [c.id, c]));
    const at = Date.now();
    for (const id of part) {
      if (verdicts.size >= VERDICT_MAX) verdicts.delete(verdicts.keys().next().value);
      verdicts.set(prefix + id, { ok: shown(cards.get(id), hide.id), until: at + timing.verdictMs, at });
    }
  }
  const allowed = new Set(), at = Date.now();
  for (const id of want) { const h = verdicts.get(prefix + id); if (h && h.ok && (h.until > at || at - h.at <= timing.staleMs)) allowed.add(id); }
  return { state: "ok", allowed, hide };
}

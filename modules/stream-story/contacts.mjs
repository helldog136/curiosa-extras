// Ce que « Story d'annonce » lit dans Contacts (service `contact.book`, version 2), et rien d'autre : Contacts possède les fiches (personnes, comptes, catégories, photos) ;
// Story n'en garde que des IDENTIFIANTS. Contacts est un besoin FACULTATIF : sans lui, Story marche avec la saisie « pour cette vidéo seulement ».
// Chaque appel est BORNÉ (`timing.bookMs`) : un Contacts qui ne répond jamais rend « slow » au bout de quelques secondes, jamais une attente sans fin. Rien ne lève.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const images = await import(`./images.mjs${v}`);
const { within, timing } = await import(`./sources.mjs${v}`);

export const SERVICE = "contact.book";
const SLOW = Symbol("slow");

/** Y a-t-il un Contacts (version 2) qui peut répondre ? Borné ; faux au moindre doute. */
export async function hasBook(ctx) {
  const list = await within(Promise.resolve().then(() => ctx.api.services.providers(SERVICE)), timing.providersMs, null);
  return Array.isArray(list) && list.length > 0;
}

/**
 * Un appel à Contacts. Rend { ok: true, value } (la réponse de Contacts, `ok: true` déjà vérifié) ou { ok: false, why } avec `why` :
 * "absent" (aucun Contacts), "slow" (pas de réponse à temps), "failed" (panne), ou le code d'erreur de Contacts ("invalid_network", "too_many", "not_found"…).
 */
export async function call(ctx, method, args, ms = timing.bookMs) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(SERVICE, method, args)), ms, SLOW);
  if (r === SLOW) return { ok: false, why: "slow" };
  if (!r || typeof r !== "object" || r.ok !== true) return { ok: false, why: r?.reason === "unavailable" || r?.reason === "undeclared" ? "absent" : "failed" };
  const value = r.value;
  if (!value || typeof value !== "object" || value.ok !== true) return { ok: false, why: typeof value?.error === "string" ? value.error : "failed" };
  return { ok: true, value };
}

/** L'état de Contacts pour l'éditeur : "ok" | "absent" | "slow". */
export const stateOf = (why) => (why === "absent" ? "absent" : why === "slow" ? "slow" : "failed");

/* ───────────── Ce qui est montré d'une fiche ───────────── */

const text = (x, max) => P.oneLine(x, max);
/** L'adresse de la photo, SEULEMENT si le relais d'images sait la servir (hôte de la liste blanche) ; sinon "" (la vidéo montre les initiales). */
export const photoOf = (contact) => images.allowedUrl(contact?.photo?.url)?.href ?? "";
/** Un compte, en pastille : { network, handle, label }. */
const badge = (a) => ({ network: P.NETWORKS.includes(a?.network) ? a.network : "other", handle: text(a?.handle, 80), label: text(a?.displayName || a?.handle, 60) });
/** Le pseudo montré d'une fiche : son compte Twitch d'abord, sinon son premier compte. */
const handleOf = (accounts) => (accounts.find((a) => a.network === "twitch") ?? accounts[0])?.handle ?? "";

function memberOf(contact) {
  const accounts = (Array.isArray(contact?.accounts) ? contact.accounts : []).slice(0, 10).map(badge);
  return { id: String(contact.id), name: text(contact.name, P.LIMITS.displayName), login: text(handleOf(accounts), P.LIMITS.handle), image: photoOf(contact), accounts };
}

/* ───────────── Chercher une personne ───────────── */

/**
 * La recherche à la saisie : `search({ q, network?, kind: "person" })`, puis `resolve` des identifiants trouvés pour la photo (Contacts reste propriétaire de la photo).
 * Rend { state: "ok" | "absent" | "slow" | "failed", items: [{ id, name, login, image, accounts }], error? }. Moins de 2 caractères : rien n'est demandé.
 * La recherche rend 30 résultats au plus (le contrat n'a pas de curseur) : la page les montre 10 par 10.
 */
export async function searchPeople(ctx, { q, network, limit = 30 } = {}) {
  const query = text(q, 100).replace(/^@/, "");
  if ([...query].length < 2) return { state: "ok", items: [] };
  if (network !== undefined && network !== "" && !P.NETWORKS.includes(network)) return { state: "ok", items: [], error: "invalid_network" };
  const r = await call(ctx, "search", { q: query, ...(network ? { network } : {}), kind: "person", limit: Math.max(1, Math.min(30, Math.trunc(Number(limit)) || 30)) });
  if (!r.ok) return r.why === "invalid_network" ? { state: "ok", items: [], error: "invalid_network" } : { state: stateOf(r.why), items: [] };
  const found = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && typeof x.id === "string").slice(0, 30);
  const photos = await resolveCards(ctx, found.map((x) => x.id));
  return {
    state: "ok",
    items: found.map((x) => {
      const card = photos.get(x.id), accounts = (Array.isArray(x.accounts) ? x.accounts : []).slice(0, 10).map(badge);
      return { id: x.id, name: text(x.name, P.LIMITS.displayName), login: text(handleOf(accounts), P.LIMITS.handle), image: card ? photoOf(card) : "", accounts };
    }),
  };
}

/** Les fiches (Map id → fiche) pour des identifiants, par paquets de 100 au plus ; en cas de panne : une Map vide (on montre alors les initiales). */
async function resolveCards(ctx, ids) {
  const out = new Map(), unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const r = await call(ctx, "resolve", { ids: unique.slice(i, i + 100) });
    if (!r.ok) return out;
    for (const c of Array.isArray(r.value.contacts) ? r.value.contacts : []) if (c && typeof c.id === "string") out.set(c.id, c);
  }
  return out;
}

/**
 * Les fiches des identifiants gardés dans un modèle : `resolve`. Une fiche fusionnée est suivie (`moved`) ; une fiche effacée est « missing ».
 * Rend { state, members: [{ ref, id, name, login, image, accounts, movedFrom? }], missing: [id] }. `ref` est l'identifiant demandé (pour retrouver l'entrée du modèle).
 */
export async function resolveMembers(ctx, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x))].slice(0, 100);
  if (!wanted.length) return { state: "ok", members: [], missing: [] };
  const first = await call(ctx, "resolve", { ids: wanted });
  if (!first.ok) return { state: stateOf(first.why), members: [], missing: [] };
  const cards = new Map((Array.isArray(first.value.contacts) ? first.value.contacts : []).filter((c) => c && typeof c.id === "string").map((c) => [c.id, c]));
  const moved = first.value.moved && typeof first.value.moved === "object" ? first.value.moved : {};
  const targets = [...new Set(Object.values(moved).filter((t) => typeof t === "string" && !cards.has(t)))].slice(0, 100);
  if (targets.length) {
    const again = await call(ctx, "resolve", { ids: targets });
    if (again.ok) for (const c of Array.isArray(again.value.contacts) ? again.value.contacts : []) if (c && typeof c.id === "string") cards.set(c.id, c);
  }
  const members = [], missing = [];
  for (const id of wanted) {
    const card = cards.get(id) ?? (typeof moved[id] === "string" ? cards.get(moved[id]) : undefined);
    if (card) members.push({ ref: id, ...memberOf(card), ...(card.id !== id ? { movedFrom: id } : {}) }); else missing.push(id);
  }
  return { state: "ok", members, missing };
}

/* ───────────── Une catégorie de Contacts ───────────── */

/** Les catégories, une page à la fois (curseur de Contacts). Rend { state, items: [{ id, label }], next }. */
export async function listCategories(ctx, { cursor, q } = {}) {
  const r = await call(ctx, "categories", { limit: 50, ...(typeof cursor === "string" && cursor ? { cursor: cursor.slice(0, 500) } : {}), ...(text(q, 100) ? { q: text(q, 100) } : {}) });
  if (!r.ok) return { state: stateOf(r.why), items: [], next: null };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((k) => k && typeof k.id === "string").slice(0, 50).map((k) => ({ id: k.id, label: text(k.label ?? k.name, 100) }));
  return { state: "ok", items, next: typeof r.value.next === "string" && r.value.next ? r.value.next : null };
}

/**
 * Les comptes d'une catégorie, une page à la fois : `accounts({ network, categoryId, cursor, limit })` (un élément par compte), puis `resolve` pour la photo. Une personne qui a
 * plusieurs comptes du même réseau n'est montrée qu'une fois. Rend { state, items: [{ id, name, login, image, accounts }], next, error? } ; catégorie disparue : error "not_found".
 */
export async function categoryPeople(ctx, { categoryId, cursor, limit = 20, network = "twitch" } = {}) {
  if (typeof categoryId !== "string" || !categoryId || categoryId.length > 80) return { state: "ok", items: [], next: null, error: "invalid" };
  if (!P.NETWORKS.includes(network)) return { state: "ok", items: [], next: null, error: "invalid_network" };
  const r = await call(ctx, "accounts", { network, categoryId, limit: Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 20)), ...(typeof cursor === "string" && cursor ? { cursor: cursor.slice(0, 500) } : {}) });
  if (!r.ok) return { state: r.why === "not_found" || r.why === "invalid" || r.why === "invalid_network" ? "ok" : stateOf(r.why), items: [], next: null, ...(["not_found", "invalid", "invalid_network"].includes(r.why) ? { error: r.why } : {}) };
  const rows = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && typeof x.id === "string");
  const seen = new Set(), picked = [];
  for (const x of rows) if (!seen.has(x.id)) { seen.add(x.id); picked.push(x); }
  const cards = await resolveCards(ctx, picked.map((x) => x.id));
  return {
    state: "ok",
    items: picked.map((x) => {
      const card = cards.get(x.id);
      if (card) return memberOf(card);
      return { id: x.id, name: text(x.name, P.LIMITS.displayName), login: text(x.handle, P.LIMITS.handle), image: images.allowedUrl(x.avatar)?.href ?? "", accounts: [badge({ network, handle: x.handle, displayName: x.displayName })] };
    }),
    next: typeof r.value.next === "string" && r.value.next ? r.value.next : null,
  };
}

/** La fiche qui porte un pseudo Twitch (pour les noms donnés par l'IA). Rend son identifiant ou "". Une seule recherche, bornée. */
export async function idOfTwitchLogin(ctx, login) {
  const r = await call(ctx, "search", { q: login, network: "twitch", kind: "person", limit: 5 });
  if (!r.ok) return "";
  for (const x of Array.isArray(r.value.items) ? r.value.items : []) {
    if (x && typeof x.id === "string" && (x.accounts ?? []).some((a) => a?.network === "twitch" && String(a.handle).toLowerCase() === login)) return x.id;
  }
  return "";
}

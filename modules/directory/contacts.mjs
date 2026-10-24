// Annuaire — ce que le module LIT dans Contacts (service `contact.book`, version 2), et rien d'autre. Contacts possède les fiches (noms, photos, comptes, catégories) :
// ce module n'en recopie rien dans son stockage ; il les relit et garde SEULEMENT en mémoire (jamais sur disque) le dernier annuaire construit :
//   1. une page publique très visitée ne dérange pas Contacts à chaque visite (reconstruction au plus toutes les 2 minutes) ;
//   2. si Contacts ne répond plus, la page garde le dernier annuaire connu (24 heures au plus), puis un message aimable.
// Contacts ne sait ni chercher dans une grande liste, ni filtrer par plusieurs catégories, ni trier : on lit donc chaque catégorie PUBLIQUE par paquets de 500 (curseur de Contacts),
// on réduit chaque fiche à ce qui s'affiche, et recherche / filtre / tri / pagination se font ici, sur un index en mémoire borné (voir directory.mjs).
// Chaque appel à Contacts est BORNÉ (aucune attente sans fin) et rien ne lève. La reconstruction est partagée : dix visiteurs en même temps = une seule lecture.
// « Ne pas montrer » (même règle que le mur des remerciements) : une catégorie de Contacts. Si Contacts ne peut pas dire QUI est caché, on ne publie rien de nouveau.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const { LIMITS, clean, fold, idOk } = P;

export const SERVICE = "contact.book";
export const timing = { callMs: 4000, providersMs: 1500, buildMs: 7000, staleWaitMs: 1200, buildBudgetMs: 25_000, freshMs: 120_000, staleMs: 24 * 3_600_000, adminFreshMs: 15_000 };
/** Les noms de catégorie reconnus d'office comme « ne pas montrer » quand aucune catégorie n'est choisie dans les réglages. */
export const HIDE_NAMES = ["ne pas montrer", "do not show"];

const SLOW = Symbol("slow");
export const within = (p, ms, fallback = SLOW) => { let t; return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };

/** Les fournisseurs de Contacts (borné) ; [] au moindre doute. */
export async function providers(ctx) {
  const list = await within(Promise.resolve().then(() => ctx.api.services.providers(SERVICE)), timing.providersMs, null);
  return Array.isArray(list) ? list : [];
}
export const hasBook = async (ctx) => (await providers(ctx)).length > 0;

/**
 * Un appel à Contacts. Rend { ok: true, value } (réponse de Contacts, `ok: true` déjà vérifié) ou { ok: false, why } : "absent" (aucun Contacts), "slow" (pas de réponse à temps),
 * "failed" (panne) ou le code d'erreur de Contacts ("not_found", "invalid"…).
 */
export async function call(ctx, method, args, ms = timing.callMs) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(SERVICE, method, args)), ms, SLOW);
  if (r === SLOW) return { ok: false, why: "slow" };
  if (!r || typeof r !== "object" || r.ok !== true) return { ok: false, why: r?.reason === "unavailable" || r?.reason === "undeclared" ? "absent" : "failed" };
  const value = r.value;
  if (!value || typeof value !== "object" || value.ok !== true) { const code = value?.["error"]; return { ok: false, why: typeof code === "string" ? code : "failed" }; }
  return { ok: true, value };
}

/* ───────────── Une fiche de Contacts → ce que l'annuaire en retient ───────────── */

/** Jamais d'e-mail, de téléphone, d'organisation, de note ni d'identifiant de compte. `keep` : les identifiants de catégorie qui comptent (publiques, caché, consentement, carte). */
export function reduceCard(c, keep, withRole = false) {
  const name = P.clean(c?.name, 120);
  const accounts = Array.isArray(c?.accounts) ? c.accounts : [];
  const photoAccount = c?.photo?.accountId ? accounts.find((a) => a?.id === c.photo.accountId) : null;
  const acc = photoAccount ?? accounts.find((a) => a?.network === "twitch") ?? accounts[0] ?? null;
  const nick = acc ? clean(acc.displayName || String(acc.handle ?? "").replace(/^@/, ""), 60) : "";
  return {
    id: String(c.id), kind: c?.kind === "org" ? "org" : "person", name, first: P.firstWord(name), nick, at: Date.parse(c?.createdAt) || 0,
    photo: P.photoOf(c?.photo), links: P.reduceLinks(accounts),
    cats: (Array.isArray(c?.categoryIds) ? c.categoryIds : []).filter((id) => keep.has(id)),
    ...(withRole ? { role: clean(c?.role, LIMITS.role) } : {}),
  };
}

/** Une fiche doit-elle rester hors de l'annuaire ? (cachée par l'interrupteur, ou arrivée par le formulaire et pas encore relue) */
export const isHidden = (card, hideId) => card?.status === "to_review" || (!!hideId && Array.isArray(card?.categoryIds) && card.categoryIds.includes(hideId));

/* ───────────── Les catégories : réglages et configuration ───────────── */

/**
 * Une catégorie nommée par un réglage (« ne pas montrer », « a accepté… »). Rend { state: "unset" } (rien de choisi), { state: "ok", id, label } , { state: "gone" } (supprimée dans Contacts)
 * ou { state: "unverified" } (Contacts n'a pas pu le dire). Une fusion est suivie.
 */
export async function settingCategory(ctx, key) {
  const raw = clean(ctx.setting(key), 120);
  if (!raw) return { state: "unset" };
  const r = await call(ctx, "categoriesResolve", { ids: [raw] });
  if (!r.ok) return { state: "unverified" };
  const items = Array.isArray(r.value.items) ? r.value.items : [];
  const item = items.find((k) => k?.id === raw);
  if (item) return { state: "ok", id: raw, label: clean(item.label ?? item.name, 100) };
  const to = r.value.moved && typeof r.value.moved === "object" ? r.value.moved[raw] : null;
  if (idOk(to)) return { state: "ok", id: to, label: clean(items.find((k) => k?.id === to)?.label, 100) };
  return { state: "gone" };
}

/** « Ne pas montrer » : le réglage, sinon une catégorie qui s'appelle ainsi, sinon personne n'est caché. Rend { state: "ok", id: string|null, how: "chosen" | "named" | "none" | "gone", label? } ou { state: "unverified" }. */
export async function hideCategory(ctx) {
  const set = await settingCategory(ctx, "hide");
  if (set.state === "ok") return { state: "ok", id: set.id, how: "chosen", label: set.label };
  if (set.state === "gone") return { state: "ok", id: null, how: "gone" };
  if (set.state === "unverified") return { state: "unverified" };
  const found = await Promise.all(HIDE_NAMES.map((q) => call(ctx, "categories", { q, limit: 20 })));
  if (found.some((r) => !r.ok)) return { state: "unverified" };
  for (const r of found) for (const k of Array.isArray(r.value.items) ? r.value.items : []) if (idOk(k?.id) && HIDE_NAMES.includes(fold(k.label ?? k.name))) return { state: "ok", id: k.id, how: "named", label: clean(k.label ?? k.name, 100) };
  return { state: "ok", id: null, how: "none" };
}

/** Les catégories publiques de la configuration → leur état dans Contacts (par paquets de 50). Rend { state: "ok", live: Map(slug → { id, name }), gone: [slug], moved: {ancien: actuel} } ou { state: "unverified" }. */
export async function resolveCats(ctx, cats) {
  const live = new Map(), gone = [], moved = {};
  const wanted = cats.filter((c) => idOk(c.catId));
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const r = await call(ctx, "categoriesResolve", { ids: batch.map((c) => c.catId) });
    if (!r.ok) return { state: "unverified" };
    const items = new Map((Array.isArray(r.value.items) ? r.value.items : []).filter((k) => idOk(k?.id)).map((k) => [k.id, k]));
    const mv = r.value.moved && typeof r.value.moved === "object" ? r.value.moved : {};
    for (const c of batch) {
      const k = items.get(c.catId);
      if (k) { live.set(c.slug, { id: c.catId, name: clean(k.label ?? k.name, 100) }); continue; }
      const to = idOk(mv[c.catId]) ? mv[c.catId] : null;
      if (to) {
        moved[c.catId] = to;
        const again = items.get(to) ?? null;
        live.set(c.slug, { id: to, name: clean(again?.label ?? again?.name, 100) });
      } else gone.push(c.slug);
    }
  }
  return { state: "ok", live, gone, moved };
}

/* ───────────── Lire une catégorie ───────────── */

/** Les fiches d'une catégorie, par paquets de 500 (curseur de Contacts), `perCategory` au plus. Rend { ok: true, cards: [fiche brute], truncated } ou { ok: false, why }. */
async function walk(ctx, categoryId, deadline) {
  const cards = [];
  let cursor = null, truncated = false;
  for (let page = 0; page < Math.ceil(LIMITS.perCategory / LIMITS.readPage); page++) {
    if (Date.now() > deadline) return { ok: false, why: "slow" };
    const r = await call(ctx, "list", { categoryId, limit: LIMITS.readPage, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return { ok: false, why: r.why };
    cards.push(...(Array.isArray(r.value.items) ? r.value.items : []));
    cursor = typeof r.value.next === "string" && r.value.next && r.value.next.length <= 500 ? r.value.next : null;
    if (!cursor) break;
  }
  if (cursor) truncated = true;
  return { ok: true, cards, truncated };
}

/* ───────────── Le modèle, et sa mémoire ───────────── */

const cache = new Map();      // instance → { sig, at, model } : le dernier modèle construit AVEC SUCCÈS (en mémoire seulement)
const inflight = new Map();   // instance → { sig, p } : la reconstruction en cours
export const resetModel = () => { cache.clear(); inflight.clear(); };
export const forgetModel = (ctx) => { cache.delete(ctx.instance.id); inflight.delete(ctx.instance.id); };
const settingsSig = (ctx, cfg) => JSON.stringify([cfg.cats.map((c) => c.catId), cfg.team.map((m) => m.contactId), clean(ctx.setting("hide"), 120), clean(ctx.setting("consent"), 120), clean(ctx.setting("mapConsent"), 120), ctx.setting("roleFromContacts") === true || ctx.setting("roleFromContacts") === "true"]);

async function build(ctx, cfg, previous) {
  if (!(await hasBook(ctx))) return { state: "absent" };
  if (!cfg.cats.some((c) => c.catId) && !cfg.team.length) return { state: "unready", reason: cfg.cats.length ? "unbound" : "no_categories" };
  const deadline = Date.now() + timing.buildBudgetMs;
  const withRole = ctx.setting("roleFromContacts") === true || ctx.setting("roleFromContacts") === "true";
  const [res, hide, consent, mapSet] = await Promise.all([resolveCats(ctx, cfg.cats), hideCategory(ctx), settingCategory(ctx, "consent"), settingCategory(ctx, "mapConsent")]);
  if (res.state !== "ok" || hide.state !== "ok" || consent.state === "unverified" || mapSet.state === "unverified") return { state: "slow" };
  const problems = [];
  for (const slug of res.gone) problems.push({ type: "gone", slug });
  for (const c of cfg.cats) if (!c.catId) problems.push({ type: "unbound", slug: c.slug });
  const consentId = consent.state === "ok" ? consent.id : null; // "gone" : personne ne passe (voir directory.mjs)
  const mapId = mapSet.state === "ok" ? mapSet.id : null;
  const keep = new Set([...[...res.live.values()].map((x) => x.id), ...(hide.id ? [hide.id] : []), ...(consentId ? [consentId] : []), ...(mapId ? [mapId] : [])]);

  // Les catégories, trois à la fois ; chaque personne n'est gardée qu'une fois.
  const seenCat = new Set();
  const entries = [...res.live.entries()].filter(([, cat]) => !seenCat.has(cat.id) && seenCat.add(cat.id)); // deux entrées sur la même catégorie de Contacts (après une fusion) : une seule lecture
  const walks = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (next < entries.length) { const [slug, cat] = entries[next++]; walks.set(slug, await walk(ctx, cat.id, deadline)); }
  }));
  const people = new Map();
  const byCat = new Map();
  let hiddenN = 0, failed = 0, truncated = false;
  const seenHidden = new Set();
  for (const [slug, cat] of entries) {
    const w = walks.get(slug);
    if (!w?.ok) {
      failed++;
      const old = previous?.byCat.get(cat.id);
      if (old && previous) { byCat.set(cat.id, old); for (const id of old) if (previous.people.has(id) && !people.has(id)) people.set(id, previous.people.get(id)); problems.push({ type: "stale", slug }); }
      else { byCat.set(cat.id, []); problems.push({ type: "slow", slug }); }
      continue;
    }
    if (w.truncated) { truncated = true; problems.push({ type: "truncated", slug }); }
    const ids = [];
    for (const c of w.cards) {
      if (!c || !idOk(c.id)) continue;
      if (isHidden(c, hide.id)) { if (!seenHidden.has(c.id)) { seenHidden.add(c.id); hiddenN++; } continue; }
      if (c.status !== undefined && c.status !== "active") continue;
      if (!people.has(c.id)) {
        if (people.size >= LIMITS.indexMax) { truncated = true; continue; }
        people.set(c.id, reduceCard(c, keep, withRole));
      }
      ids.push(c.id);
    }
    byCat.set(cat.id, ids);
  }
  // L'équipe : des fiches choisies une à une, qui peuvent n'être dans aucune catégorie publique.
  const teamIds = cfg.team.map((m) => m.contactId);
  const teamLook = await resolveCards(ctx, teamIds, { keep, withRole, hideId: hide.id });
  if (teamLook.state !== "ok" && teamIds.length && !previous) failed++;
  if (teamLook.state === "ok") for (const [id, card] of teamLook.cards) if (!people.has(id) && people.size < LIMITS.indexMax) people.set(id, card);
  const teamMoved = teamLook.state === "ok" ? teamLook.moved : {};
  const teamMissing = teamLook.state === "ok" ? teamLook.missing : [];
  const teamBlocked = teamLook.state === "ok" ? teamLook.blocked : [];
  if (teamLook.state !== "ok" && previous) for (const m of cfg.team) if (previous.people.has(m.contactId) && !people.has(m.contactId)) people.set(m.contactId, previous.people.get(m.contactId));
  if (failed && failed >= entries.length && !people.size) return { state: "slow" };
  return {
    state: "ok", people, byCat, live: res.live, moved: { ...res.moved, ...teamMoved }, problems, truncated, partial: failed > 0,
    hideId: hide.id, hideHow: hide.how, hideLabel: hide.label ?? "", hiddenN,
    consentId, consentState: consent.state, consentLabel: consent.label ?? "", mapId, mapState: mapSet.state, mapLabel: mapSet.label ?? "",
    teamMissing, teamBlocked,
  };
}

/**
 * Le modèle. Rend toujours un objet : { state: "ok", people, byCat, live, … , stale?, at } ou { state: "absent" | "unready" | "slow", reason? }.
 * `maxAgeMs` : au-delà, on reconstruit (public : 2 minutes ; administration : 15 secondes). Reconstruction trop lente ou en panne : le dernier modèle connu (moins de 24 h, mêmes réglages).
 * Avec un modèle connu, on n'attend que peu (`staleWaitMs`) : la reconstruction continue seule, la visite suivante la trouve.
 */
export async function getModel(ctx, { maxAgeMs = timing.freshMs, waitMs } = {}) {
  const id = ctx.instance.id, now = Date.now();
  const data = await D.readData(ctx);
  const sig = settingsSig(ctx, data.config);
  const hit = cache.get(id);
  const usable = hit && hit.sig === sig && now - hit.at < timing.staleMs;
  if (usable && now - hit.at < maxAgeMs) return { ...hit.model, at: hit.at };
  let run = inflight.get(id);
  if (!run || run.sig !== sig) {
    const p = build(ctx, data.config, usable ? hit.model : null).then((model) => {
      if (model.state === "ok") {
        cache.set(id, { sig, at: Date.now(), model });
        if (cache.size > LIMITS.models) cache.delete(cache.keys().next().value);
      }
      return model;
    }).catch(() => ({ state: "slow" })).finally(() => { if (inflight.get(id)?.p === p) inflight.delete(id); });
    run = { p, sig };
    inflight.set(id, run);
  }
  const wait = waitMs ?? (usable ? timing.staleWaitMs : timing.buildMs);
  const model = await within(run.p, wait, { state: "slow" });
  if (model.state === "ok") return { ...model, at: Date.now() };
  if (usable) return { ...hit.model, stale: true, at: hit.at };
  return model;
}

/* ───────────── Quelques fiches précises (équipe, administration) ───────────── */

/**
 * Les fiches pour des identifiants (par paquets de 100), en suivant les fusions. Rend { state: "ok" | "absent" | "slow" | "failed", cards: Map(id demandé → fiche réduite), missing: [id], blocked: [id], moved: { ancien: gardé } }.
 * `blocked` : fiches cachées (« ne pas montrer » ou à relire) : elles ne sont pas dans `cards`.
 */
export async function resolveCards(ctx, ids, { keep = new Set(), withRole = false, hideId = null } = {}) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter(idOk))];
  const out = new Map(), missing = [], blocked = [], moved = {};
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const r = await call(ctx, "resolve", { ids: batch });
    if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", cards: out, missing, blocked, moved };
    const byId = new Map((Array.isArray(r.value.contacts) ? r.value.contacts : []).filter((c) => c && idOk(c.id)).map((c) => [c.id, c]));
    const mv = r.value.moved && typeof r.value.moved === "object" ? r.value.moved : {};
    const extra = [...new Set(Object.values(mv).filter((t) => idOk(t) && !byId.has(t)))].slice(0, 100);
    if (extra.length) {
      const again = await call(ctx, "resolve", { ids: extra });
      if (again.ok) for (const c of Array.isArray(again.value.contacts) ? again.value.contacts : []) if (c && idOk(c.id)) byId.set(c.id, c);
    }
    for (const id of batch) {
      const card = byId.get(id) ?? (idOk(mv[id]) ? byId.get(mv[id]) : undefined);
      if (!card) { missing.push(id); continue; }
      if (card.id !== id) moved[id] = card.id;
      if (isHidden(card, hideId) || (card.status !== undefined && card.status !== "active")) { blocked.push(id); continue; }
      out.set(id, { ...reduceCard(card, keep, withRole), adminPath: typeof card.adminPath === "string" && card.adminPath.startsWith("/admin/") ? card.adminPath : "" });
    }
  }
  return { state: "ok", cards: out, missing, blocked, moved };
}

/**
 * Comme resolveCards, pour l'administration : applique « ne pas montrer » et garde les catégories qui comptent (consentement, carte). Rend { state, cards, missing, blocked, moved, mapId }.
 * Si Contacts ne peut pas dire qui est caché : { state: "slow" } (on n'enregistre rien dans le doute).
 */
export async function resolveForAdmin(ctx, ids) {
  const [hide, consent, mapSet] = await Promise.all([hideCategory(ctx), settingCategory(ctx, "consent"), settingCategory(ctx, "mapConsent")]);
  if (hide.state !== "ok" || consent.state === "unverified" || mapSet.state === "unverified") return { state: "slow", cards: new Map(), missing: [], blocked: [], moved: {}, mapId: null };
  const mapId = mapSet.state === "ok" ? mapSet.id : null;
  const keep = new Set([...(hide.id ? [hide.id] : []), ...(consent.state === "ok" ? [consent.id] : []), ...(mapId ? [mapId] : [])]);
  const r = await resolveCards(ctx, ids, { keep, hideId: hide.id });
  return { ...r, mapId };
}

/** Chercher une personne par son nom (administration). Rend { state, items: [{ id, name, kind }] } ; 2 lettres au moins. */
export async function searchPeople(ctx, q) {
  const text = clean(q, 100).replace(/^@/, "");
  if ([...text].length < 2) return { state: "ok", items: [] };
  const r = await call(ctx, "search", { q: text, limit: LIMITS.search });
  if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", items: [] };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && idOk(x.id)).slice(0, LIMITS.search).map((x) => ({ id: x.id, name: clean(x.name, 120), kind: x.kind === "org" ? "org" : "person" }));
  return { state: "ok", items };
}

/** Les catégories de Contacts, avec recherche (administration) : { state, items: [{ id, name }], next }. */
export async function listCategories(ctx, { q = "", cursor = null, limit = LIMITS.adminPage } = {}) {
  const r = await call(ctx, "categories", { limit, ...(clean(q, 100) ? { q: clean(q, 100) } : {}), ...(cursor ? { cursor } : {}) });
  if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", items: [], next: null };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((k) => idOk(k?.id)).map((k) => ({ id: k.id, name: clean(k.label ?? k.name, 100) }));
  return { state: "ok", items, next: typeof r.value.next === "string" && r.value.next.length <= 500 ? r.value.next : null };
}

/** Crée une catégorie dans Contacts au nom de la personne qui clique (droit « categories.create » de Contacts). Rend { ok: true, id } ou { ok: false, why: "denied" | ... }. */
export async function createCategory(ctx, label) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(SERVICE, "createCategory", { label: clean(label, 100) }, { asCaller: true })), timing.callMs, SLOW);
  if (r === SLOW) return { ok: false, why: "slow" };
  const value = r?.ok === true ? r.value : null;
  if (value?.ok === true && idOk(value.id)) return { ok: true, id: value.id };
  if (value?.error === "duplicate" && idOk(value.id)) return { ok: true, id: value.id };
  const code = value?.error;
  return { ok: false, why: typeof code === "string" ? code : "failed" };
}

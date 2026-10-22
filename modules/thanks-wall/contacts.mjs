// Mur des remerciements — ce que le module LIT dans Contacts (service `contact.book`, version 2), et rien d'autre. Contacts possède les fiches (noms, photos, catégories) :
// ce module n'en recopie rien dans son stockage ; il les relit, et garde SEULEMENT en mémoire (jamais sur disque) le dernier mur construit, quelques minutes, pour deux raisons :
//   1. une page publique très visitée ne dérange pas Contacts à chaque visite (le mur est reconstruit au plus toutes les 2 minutes) ;
//   2. si Contacts ne répond plus, la page garde le dernier mur connu (jusqu'à 24 heures), puis un message aimable.
// Chaque appel à Contacts est BORNÉ (aucune attente sans fin) et rien ne lève. La reconstruction est partagée : dix visiteurs en même temps = une seule lecture.
// « Ne pas montrer » : une catégorie de Contacts (voir hideCategory). Si Contacts ne peut pas dire QUI est caché, on ne publie rien de nouveau (on garde le dernier mur connu).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const P = await import(`./pure.mjs${v}`);
const { LIMITS, clean, fold, idOk } = P;

export const SERVICE = "contact.book";
export const timing = { callMs: 4000, providersMs: 1500, buildMs: 5500, freshMs: 120_000, staleMs: 24 * 3_600_000, adminFreshMs: 15_000 };
/** Les noms de catégorie reconnus d'office comme « ne pas montrer » quand aucune catégorie n'est choisie dans les réglages. */
export const HIDE_NAMES = ["ne pas montrer", "do not show"];
export const GROUP_KEYS = [["category", "groupTitle"], ["category2", "groupTitle2"], ["category3", "groupTitle3"], ["category4", "groupTitle4"], ["category5", "groupTitle5"], ["category6", "groupTitle6"]];

const SLOW = Symbol("slow");
export const within = (p, ms, fallback = SLOW) => { let t; return Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t)); };

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

/* ───────────── Les réglages : groupes et catégorie cachée ───────────── */

/**
 * Les groupes réglés (1 à 6) : [{ n, categoryId, label, title }] et les problèmes à dire : [{ n, problem }] avec `problem` ∈ "no_category" · "choose" · "gone" · "unverified" · "duplicate".
 * Le premier groupe suit la règle du cœur (`resolveChoice`) : une seule catégorie dans Contacts = elle est prise d'office.
 */
export async function groupConfigs(ctx) {
  const wanted = GROUP_KEYS.map(([key], i) => ({ n: i + 1, key })).filter(({ n, key }) => n === 1 || clean(ctx.setting(key), 120) !== "");
  const resolved = await Promise.all(wanted.map(async ({ n, key }) => {
    const r = typeof ctx.resolveChoice === "function" ? await within(ctx.resolveChoice(key), 3500, { status: "unverified" }) : { status: "unverified" };
    return { n, r: r && typeof r === "object" ? r : { status: "unverified" } };
  }));
  const groups = [], problems = [], seen = new Set();
  for (const { n, r } of resolved) {
    if (["chosen", "only"].includes(r.status) || (r.status === "missing" && r.id)) {
      if (!idOk(r.id)) { problems.push({ n, problem: "unverified" }); continue; }
      if (seen.has(r.id)) { problems.push({ n, problem: "duplicate" }); continue; }
      seen.add(r.id);
      const title = clean(ctx.setting(GROUP_KEYS[n - 1][1]), 80) || clean(r.label, 100);
      groups.push({ n, categoryId: r.id, label: clean(r.label, 100), title });
    } else problems.push({ n, problem: r.status === "none" ? "no_category" : r.status === "ambiguous" ? "choose" : r.status === "missing" ? "gone" : "unverified" });
  }
  return { groups, problems };
}

/**
 * La catégorie « ne pas montrer ». Rend { state: "ok", id: string|null, how: "chosen" | "named" | "none" | "gone", label? } ou { state: "unverified" } (Contacts n'a pas pu le dire).
 * Choisie dans les réglages : on suit une fusion de catégories (`moved`) ; supprimée : plus personne n'est caché (`gone`, dit à l'administration).
 * Pas choisie : une catégorie qui s'appelle « Ne pas montrer » (ou « Do not show ») fait l'affaire ; sinon personne n'est caché (`none`).
 */
export async function hideCategory(ctx) {
  const raw = clean(ctx.setting("hide"), 120);
  if (raw) {
    const r = await call(ctx, "categoriesResolve", { ids: [raw] });
    if (!r.ok) return { state: "unverified" };
    const items = Array.isArray(r.value.items) ? r.value.items : [];
    const item = items.find((k) => k?.id === raw);
    if (item) return { state: "ok", id: raw, how: "chosen", label: clean(item.label ?? item.name, 100) };
    const to = r.value.moved && typeof r.value.moved === "object" ? r.value.moved[raw] : null;
    if (idOk(to)) return { state: "ok", id: to, how: "chosen", label: clean(items.find((k) => k?.id === to)?.label, 100) };
    return { state: "ok", id: null, how: "gone" };
  }
  const found = await Promise.all(HIDE_NAMES.map((q) => call(ctx, "categories", { q, limit: 20 })));
  if (found.some((r) => !r.ok)) return { state: "unverified" };
  for (const r of found) for (const k of Array.isArray(r.value.items) ? r.value.items : []) if (idOk(k?.id) && HIDE_NAMES.includes(fold(k.label ?? k.name))) return { state: "ok", id: k.id, how: "named", label: clean(k.label ?? k.name, 100) };
  return { state: "ok", id: null, how: "none" };
}

/* ───────────── Lire un groupe ───────────── */

/** Une fiche doit-elle rester hors du mur ? (cachée par l'interrupteur, ou arrivée par le formulaire et pas encore relue par la propriétaire) */
export const isHidden = (card, hideId) => card?.status === "to_review" || (!!hideId && Array.isArray(card?.categoryIds) && card.categoryIds.includes(hideId));

/**
 * Les fiches d'une catégorie, par pages de 500 (curseur de Contacts), 1 000 au plus. Rend { ok: true, people, hidden, truncated } ou { ok: false, why }.
 * `people` : fiches réduites à ce qui s'affiche (voir pure.reduceCard), dans l'ordre de Contacts (la plus ancienne d'abord).
 */
export async function walkCategory(ctx, categoryId, hideId) {
  const people = [], seen = new Set();
  let hidden = 0, cursor = null, read = 0, truncated = false;
  for (let page = 0; page < Math.ceil(LIMITS.perGroup / 500); page++) {
    const r = await call(ctx, "list", { categoryId, limit: 500, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return { ok: false, why: r.why };
    const items = Array.isArray(r.value.items) ? r.value.items : [];
    for (const c of items) {
      if (!c || !idOk(c.id) || seen.has(c.id)) continue;
      seen.add(c.id); read++;
      if (isHidden(c, hideId)) { hidden++; continue; }
      people.push(P.reduceCard(c));
    }
    cursor = typeof r.value.next === "string" && r.value.next && r.value.next.length <= 500 ? r.value.next : null;
    if (!cursor) break;
    if (read >= LIMITS.perGroup) { truncated = true; break; }
  }
  if (cursor) truncated = true;
  return { ok: true, people, hidden, truncated };
}

/* ───────────── Le mur, et sa mémoire ───────────── */

const cache = new Map();      // instance → { sig, at, model } : le dernier mur construit AVEC SUCCÈS (en mémoire seulement)
const inflight = new Map();   // instance → promesse de la reconstruction en cours
export const resetWall = () => { cache.clear(); inflight.clear(); cards.clear(); };
const sigOf = (ctx) => JSON.stringify([...GROUP_KEYS.map(([k]) => clean(ctx.setting(k), 120)), clean(ctx.setting("hide"), 120)]);

async function build(ctx, previous) {
  if (!(await hasBook(ctx))) return { state: "absent" };
  const cfg = await groupConfigs(ctx);
  if (!cfg.groups.length) {
    // Rien à montrer parce que rien n'est réglé : on le dit. « unverified » (Contacts muet) n'est pas « rien n'est réglé ».
    const first = cfg.problems.find((p) => p.n === 1)?.problem;
    return first === "unverified" || !first ? { state: "slow", problems: cfg.problems } : { state: "unready", reason: first, problems: cfg.problems };
  }
  const hide = await hideCategory(ctx);
  if (hide.state !== "ok") return { state: "slow", problems: cfg.problems };
  const walks = await Promise.all(cfg.groups.map((g) => walkCategory(ctx, g.categoryId, hide.id)));
  const groups = [];
  let failed = 0;
  for (const [i, g] of cfg.groups.entries()) {
    const w = walks[i];
    if (w.ok) { groups.push({ ...g, people: w.people, hidden: w.hidden, truncated: w.truncated }); continue; }
    const old = previous?.groups?.find((x) => x.categoryId === g.categoryId);
    if (w.why === "not_found") { cfg.problems.push({ n: g.n, problem: "gone" }); continue; }
    failed++;
    if (old) groups.push({ ...old, n: g.n, title: g.title, label: g.label, stale: true }); else groups.push({ ...g, people: [], hidden: 0, truncated: false, problem: w.why === "absent" ? "absent" : "slow" });
  }
  if (failed && failed === cfg.groups.length && !groups.some((g) => g.people.length || g.stale)) return { state: "slow", problems: cfg.problems };
  return { state: "ok", groups, problems: cfg.problems, hideId: hide.id, hideHow: hide.how, hideLabel: hide.label ?? "", partial: failed > 0 };
}

/**
 * Le mur. Rend toujours un objet : { state: "ok", groups, problems, hideId, hideHow, stale?, at } ou { state: "absent" | "unready" | "slow", reason?, problems }.
 * `maxAgeMs` : au-delà, on reconstruit (public : 2 minutes ; administration : 15 secondes). Reconstruction trop lente ou en panne : le dernier mur connu (moins de 24 h, mêmes réglages).
 */
export async function getWall(ctx, { maxAgeMs = timing.freshMs, waitMs = timing.buildMs } = {}) {
  const id = ctx.instance.id, sig = sigOf(ctx), now = Date.now();
  const hit = cache.get(id);
  const usable = hit && hit.sig === sig && now - hit.at < timing.staleMs;
  if (usable && now - hit.at < maxAgeMs) return { ...hit.model, at: hit.at };
  let run = inflight.get(id);
  if (!run || run.sig !== sig) {
    const p = build(ctx, usable ? hit.model : null).then((model) => {
      if (model.state === "ok") { cache.set(id, { sig, at: Date.now(), model }); if (cache.size > 20) cache.delete(cache.keys().next().value); }
      return model;
    }).catch(() => ({ state: "slow" })).finally(() => { if (inflight.get(id)?.p === p) inflight.delete(id); });
    run = { p, sig };
    inflight.set(id, run);
  }
  const model = await within(run.p, waitMs, { state: "slow" });
  if (model.state === "ok") return { ...model, at: Date.now() };
  if (usable) return { ...hit.model, stale: true, at: hit.at };
  return model;
}

/* ───────────── Quelques fiches précises (mise à l'honneur, administration) ───────────── */

const cards = new Map();      // « instance|fiche » → { at, card | null, movedTo? } : la fiche relue il y a moins de 2 minutes (borné à 100)
const cardKey = (ctx, id) => `${ctx.instance.id}|${id}`;

/**
 * Les fiches pour des identifiants (par paquets de 100), en suivant les fusions. Rend { state: "ok" | "absent" | "slow" | "failed", cards: Map(id demandé → fiche réduite + { status, categoryIds }), missing: [id], moved: { ancien: gardé } }.
 */
export async function resolveCards(ctx, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter(idOk))];
  const out = new Map(), missing = [], moved = {};
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const r = await call(ctx, "resolve", { ids: batch });
    if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", cards: out, missing, moved };
    const byId = new Map((Array.isArray(r.value.contacts) ? r.value.contacts : []).filter((c) => c && idOk(c.id)).map((c) => [c.id, c]));
    const mv = r.value.moved && typeof r.value.moved === "object" ? r.value.moved : {};
    const extra = [...new Set(Object.values(mv).filter((t) => idOk(t) && !byId.has(t)))].slice(0, 100);
    if (extra.length) {
      const again = await call(ctx, "resolve", { ids: extra });
      if (again.ok) for (const c of Array.isArray(again.value.contacts) ? again.value.contacts : []) if (c && idOk(c.id)) byId.set(c.id, c);
    }
    for (const id of batch) {
      const card = byId.get(id) ?? (idOk(mv[id]) ? byId.get(mv[id]) : undefined);
      if (card) { out.set(id, { ...P.reduceCard(card), status: card.status, categoryIds: Array.isArray(card.categoryIds) ? card.categoryIds : [], adminPath: typeof card.adminPath === "string" && card.adminPath.startsWith("/admin/") ? card.adminPath : "" }); if (card.id !== id) moved[id] = card.id; }
      else missing.push(id);
    }
  }
  return { state: "ok", cards: out, missing, moved };
}

/**
 * Une fiche pour la page publique (la personne à l'honneur), avec le même secret que le mur : une personne cachée n'apparaît pas.
 * Rend { state: "ok", card: fiche réduite | null } ; Contacts muet : la dernière fiche connue (moins de 24 h), sinon { state: "slow", card: null }.
 */
export async function publicCard(ctx, id, hideId) {
  const key = cardKey(ctx, id), hit = cards.get(key), now = Date.now();
  if (hit && now - hit.at < timing.freshMs) return { state: "ok", card: hit.card };
  const r = await within(resolveCards(ctx, [id]), timing.callMs * 2, { state: "slow", cards: new Map() });
  if (r.state !== "ok") return hit && now - hit.at < timing.staleMs ? { state: "ok", card: hit.card, stale: true } : { state: "slow", card: null };
  const found = r.cards.get(id) ?? null;
  const card = found && !isHidden(found, hideId) ? found : null;
  cards.set(key, { at: Date.now(), card });
  if (cards.size > 100) for (const k of cards.keys()) { cards.delete(k); if (cards.size <= 80) break; }
  return { state: "ok", card };
}

/** Chercher une personne par son nom (administration). Rend { state, items: [{ id, name }] } ; 2 lettres au moins. */
export async function searchPeople(ctx, q) {
  const text = clean(q, 100).replace(/^@/, "");
  if ([...text].length < 2) return { state: "ok", items: [] };
  const r = await call(ctx, "search", { q: text, limit: LIMITS.search });
  if (!r.ok) return { state: r.why === "absent" || r.why === "slow" ? r.why : "failed", items: [] };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && idOk(x.id)).slice(0, LIMITS.search).map((x) => ({ id: x.id, name: clean(x.name, 120), kind: x.kind === "org" ? "org" : "person" }));
  return { state: "ok", items };
}

// LA LISTE DE RAID (2.0) : les comptes Twitch des fiches d'UNE catégorie de Contacts (service `contact.book` v2). Raid ne garde plus de liste à lui :
// il lit, il ne copie jamais (ni nom, ni pseudo, ni photo). Seule la SOURCE de la liste a changé : la logique du dock (live.mjs, search.mjs) est celle de la 1.3.
//
// Quelle catégorie ?
//   - le réglage « category » (un choix parmi les catégories de Contacts) : son id ; une catégorie FUSIONNÉE est suivie (`categoriesResolve` → `moved`),
//     une catégorie SUPPRIMÉE donne « category_gone » (l'administration dit : « La catégorie choisie n'existe plus, choisissez-en une ») ;
//   - rien de choisi : la catégorie qui s'appelle « Cible de raid » (ou « Raid target ») si elle existe, sinon l'UNIQUE catégorie de Contacts (comme le
//     cœur, qui masque alors le réglage), sinon « no_category » (aucune catégorie) ou « choose » (plusieurs, aucune ne s'appelle ainsi) ;
//   - pendant la migration (catégorie pas encore créée par la personne) : les fiches recopiées de l'ancienne liste, lues par leurs ids (voir migrate.mjs).
// Règles :
//   - chaque appel à Contacts est borné (`timing.callMs`), toute la lecture aussi (`timing.readMs`) ; pages de 500 (curseur), 10 000 comptes au plus ;
//   - le résultat est gardé 30 s et partagé (dix docks = une lecture), jamais une promesse sans expiration ;
//   - Contacts muet ou en panne : la dernière liste connue sert encore 10 minutes (le dock ne se vide pas pour une coupure), ensuite l'état est dit clairement.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { LOGIN, MAX_TARGETS, CONTACTS_PAGE, fold, oneLine, httpsUrl } = await import(`./pure.mjs${v}`);
const { within } = await import(`./streams.mjs${v}`);

export const BOOK = "contact.book";
export const PAGE = CONTACTS_PAGE;
/** Les noms de la catégorie par défaut (tous reconnus, quelle que soit la langue du site). */
export const DEFAULT_LABELS = ["Cible de raid", "Raid target"];
/** Les délais (en millisecondes). Un objet pour que les tests puissent les raccourcir. */
export const timing = { callMs: 4000, readMs: 4500, marginMs: 400, okMs: 30_000, failMs: 10_000, staleMs: 10 * 60_000 };
const CACHE_MAX = 50;

const state = { cache: new Map(), inflight: new Map(), good: new Map() };
export const resetSource = () => { for (const m of Object.values(state)) m.clear(); };

const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;
const left = (deadline) => Math.max(0, deadline - Date.now());
/** La valeur brute du réglage « category » (un id de catégorie de Contacts), ou "". */
export const categorySetting = (ctx) => { const s = ctx.setting("category"); return typeof s === "string" && isId(s.trim()) ? s.trim() : ""; };

/**
 * Un appel à Contacts, borné, qui ne lève jamais : { ok: true, value } ou { ok: false, why, error?, id? } (`id` : l autre fiche ou catégorie d une erreur « duplicate » ou « taken »).
 * `why` : "missing" (Contacts absent), "old" (Contacts trop ancien : méthode inconnue), "down" (muet, en panne), "error" (réponse { ok: false, error }).
 */
export async function ask(ctx, method, args, ms = timing.callMs, { service = BOOK, asCaller = false } = {}) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(service, method, args, asCaller ? { asCaller: true } : undefined)).catch(() => ({ ok: false, reason: "failed" })), Math.max(0, ms), null);
  if (!r) return { ok: false, why: "down" };
  if (!r.ok) return { ok: false, why: r.reason === "unavailable" || r.reason === "undeclared" ? "missing" : r.reason === "no_method" ? "old" : "down" };
  const val = r.value;
  if (!val || typeof val !== "object") return { ok: false, why: "down" };
  if (val.ok === false) return { ok: false, why: "error", error: typeof val.error === "string" ? val.error.slice(0, 40) : "invalid", ...(isId(val.id) ? { id: val.id } : {}) };
  return { ok: true, value: val };
}
export const CURATE = "contact.curate";
/** Un appel à l'extension « contact.curate » de Contacts (voir tests/contract-ext/README.md) : comme `ask`. Une méthode inconnue ou un service absent veut dire « Contacts trop ancien ». */
export const askCurate = (ctx, method, args, ms = timing.callMs) => ask(ctx, method, args, ms, { service: CURATE });
/** Un échec d'appel → l'état à dire. */
export const problemOf = (why) => (why === "missing" ? "contacts_missing" : why === "old" ? "contacts_old" : "contacts_down");
const labelOf = (x) => oneLine(x?.label ?? x?.name, 100);
const itemsOf = (value) => (Array.isArray(value?.items) ? value.items.filter((x) => x && isId(x.id)) : []);

/** Les noms de la catégorie par défaut, dans la langue du site d'abord. */
export function defaultLabels(ctx) {
  const mine = ctx.t("default_category");
  return [...new Set([mine && mine !== "default_category" ? mine : "", ...DEFAULT_LABELS].filter(Boolean))];
}

/** La catégorie « par défaut » si elle existe (nom exact, sans casse ni accents) : { id, label } ; null si elle n'existe pas ; { problem } si Contacts ne répond pas. */
export async function findDefaultCategory(ctx, deadline = Date.now() + timing.readMs) {
  for (const label of defaultLabels(ctx)) {
    const r = await ask(ctx, "categories", { q: label, limit: 50 }, Math.min(timing.callMs, left(deadline)));
    if (!r.ok) return { problem: r.why === "error" ? "contacts_down" : problemOf(r.why) };
    const hit = itemsOf(r.value).find((x) => fold(labelOf(x)) === fold(label));
    if (hit) return { id: hit.id, label: labelOf(hit) };
  }
  return null;
}

/**
 * La catégorie à lire : { id, label, how: "chosen" | "moved" | "default" | "only" } ou { problem: "category_gone" | "no_category" | "choose" | "contacts_…" }.
 * Ne lève jamais ; bornée par `deadline`.
 */
export async function resolveCategory(ctx, deadline = Date.now() + timing.readMs) {
  const raw = categorySetting(ctx);
  const ms = () => Math.min(timing.callMs, left(deadline));
  if (raw) {
    const r = await ask(ctx, "categoriesResolve", { ids: [raw] }, ms());
    if (!r.ok) return { problem: r.why === "error" ? "contacts_down" : problemOf(r.why) };
    const hit = itemsOf(r.value).find((x) => x.id === raw);
    if (hit) return { id: raw, label: labelOf(hit), how: "chosen" };
    const to = r.value.moved && typeof r.value.moved === "object" ? r.value.moved[raw] : null;
    if (isId(to)) {   // fusionnée dans une autre : on suit (Contacts replie déjà les chaînes de fusions)
      const r2 = await ask(ctx, "categoriesResolve", { ids: [to] }, ms());
      if (!r2.ok) return { problem: r2.why === "error" ? "contacts_down" : problemOf(r2.why) };
      const hit2 = itemsOf(r2.value).find((x) => x.id === to);
      return hit2 ? { id: to, label: labelOf(hit2), how: "moved" } : { problem: "category_gone" };
    }
    return { problem: "category_gone" };
  }
  const found = await findDefaultCategory(ctx, deadline);
  if (found?.problem) return found;
  if (found) return { ...found, how: "default" };
  const r = await ask(ctx, "categories", { limit: 2 }, ms());
  if (!r.ok) return { problem: r.why === "error" ? "contacts_down" : problemOf(r.why) };
  const items = itemsOf(r.value);
  if (items.length === 1 && !r.value.next) return { id: items[0].id, label: labelOf(items[0]), how: "only" };
  return { problem: items.length ? "choose" : "no_category" };
}

/** Le nom donné à la catégorie qu'on crée : dans la langue par défaut du site (ensuite, c'est une donnée de la personne, qui peut la renommer). */
export const DEFAULT_NAMES = { fr: "Cible de raid", en: "Raid target" };
export const defaultName = (ctx) => DEFAULT_NAMES[String(ctx.defaultLocale ?? "").slice(0, 2).toLowerCase()] ?? DEFAULT_NAMES.en;

/**
 * La liste de raid, créée si elle n'existe pas encore : { ok: true, id, label, how, created } ou { ok: false, problem }.
 * Une catégorie existante est TOUJOURS préférée (choisie, fusionnée, « Cible de raid », ou la seule de Contacts : c'est celle que lit le dock) ; `ownList` : sauf cette dernière (elle n'est pas faite pour ça).
 * La catégorie qui manque est créée,
 * avec les droits de la personne qui vient de cliquer (`asCaller`, cœur 0.2.4) : sans le droit ou sur un cœur plus ancien, problème « category_denied » (l'administration dit quoi faire).
 */
export async function ensureCategory(ctx, deadline = Date.now() + timing.readMs, { ownList = false } = {}) {
  const cat = await resolveCategory(ctx, deadline);
  if (!cat.problem && !(ownList && cat.how === "only")) return { ok: true, id: cat.id, label: cat.label, how: cat.how, created: false };
  if (cat.problem && cat.problem !== "no_category" && cat.problem !== "choose") return { ok: false, problem: cat.problem };
  const label = defaultName(ctx);
  const r = await ask(ctx, "createCategory", { label }, Math.min(timing.callMs, left(deadline)), { asCaller: true });
  if (r.ok && isId(r.value.id)) { resetSource(); return { ok: true, id: r.value.id, label: oneLine(r.value.label, 100) || label, how: "default", created: true }; }
  if (!r.ok && r.why === "error" && r.error === "duplicate" && isId(r.id)) return { ok: true, id: r.id, label, how: "default", created: false };
  if (!r.ok && r.why === "error") return { ok: false, problem: "category_denied" };
  return { ok: false, problem: r.ok ? "contacts_down" : problemOf(r.why) };
}

/** Tous les comptes Twitch d'une demande `accounts` (pages de 500, curseur), ajoutés à `out` ; { ok: true, truncated } ou l'échec. */
async function readPages(ctx, base, deadline, out) {
  let cursor = null, pages = 0;
  do {
    const r = await ask(ctx, "accounts", { ...base, network: "twitch", ...(cursor ? { cursor } : {}), limit: PAGE }, Math.min(timing.callMs, left(deadline)));
    if (!r.ok) return r;
    out.push(...(Array.isArray(r.value.items) ? r.value.items : []));
    cursor = typeof r.value.next === "string" && r.value.next ? r.value.next : null;
    if (++pages >= 1000) break;   // garde-fou : un curseur qui ne finirait jamais
  } while (cursor && out.length < MAX_TARGETS);
  return { ok: true, truncated: !!cursor };
}

/** Les comptes rendus par Contacts → la liste du dock : [{ login, name, contactId, avatar? }], sans doublon, 10 000 au plus. Aucune confiance : tout est vérifié et coupé. */
export function toPartners(items) {
  const out = [], seen = new Set();
  for (const it of items) {
    const login = typeof it?.handle === "string" ? it.handle.trim().toLowerCase() : "";
    if (!LOGIN.test(login) || seen.has(login)) continue;
    seen.add(login);
    const display = oneLine(it.displayName, 40), name = oneLine(it.name, 40);
    // Un nom de fiche qui n'est que le pseudo (fiche créée depuis un compte sans nom : Contacts lui donne le pseudo tel quel) ne vaut pas mieux que le nom affiché par Twitch : le dock prend alors celui de Twitch, comme en 1.3.
    out.push({ login, name: display || (name !== login ? name : ""), contactId: isId(it.id) ? it.id : null, ...(httpsUrl(it.avatar) ? { avatar: it.avatar } : {}) });
    if (out.length >= MAX_TARGETS) break;
  }
  return out;
}

/** La migration attend-elle encore la catégorie ? Les ids des fiches recopiées (voir migrate.mjs), sans lever. */
async function pendingIds(ctx) {
  try {
    const doc = (await ctx.api.store.list("contactsMigration", { limit: 1 }))[0];
    return Array.isArray(doc?.data?.pending) ? doc.data.pending.filter(isId) : [];
  } catch { return []; }
}

async function readTargets(ctx, deadline) {
  const cat = await resolveCategory(ctx, deadline);
  const items = [];
  if (cat.problem) {
    // Pas encore de catégorie (migration en cours) : les fiches recopiées de l'ancienne liste, lues par leurs ids, pour que le dock ne s'arrête pas.
    if (cat.problem !== "no_category" && cat.problem !== "choose") return { state: "problem", problem: cat.problem };
    const ids = await pendingIds(ctx);
    if (!ids.length) return { state: "problem", problem: cat.problem };
    let truncated = false;
    for (let i = 0; i < ids.length && items.length < MAX_TARGETS; i += PAGE) {
      const r = await readPages(ctx, { ids: ids.slice(i, i + PAGE) }, deadline, items);
      if (!r.ok) return { state: "problem", problem: r.why === "error" ? "contacts_down" : problemOf(r.why) };
      truncated ||= r.truncated;
    }
    return { state: "ok", partners: toPartners(items), category: null, awaiting: cat.problem, truncated };
  }
  const r = await readPages(ctx, { categoryId: cat.id }, deadline, items);
  if (!r.ok) return { state: "problem", problem: r.why === "error" ? (r.error === "not_found" ? "category_gone" : "contacts_down") : problemOf(r.why) };
  // Migration pas encore rangée dans la catégorie : les fiches recopiées sont lues EN PLUS (le dock reste complet jusqu'au clic « Ranger »).
  const ids = await pendingIds(ctx);
  let truncated = r.truncated;
  for (let i = 0; i < ids.length && items.length < MAX_TARGETS; i += PAGE) {
    const more = await readPages(ctx, { ids: ids.slice(i, i + PAGE) }, deadline, items);
    if (!more.ok) return { state: "problem", problem: more.why === "error" ? "contacts_down" : problemOf(more.why) };
    truncated ||= more.truncated;
  }
  return { state: "ok", partners: toPartners(items), category: { id: cat.id, label: cat.label, how: cat.how }, ...(ids.length ? { awaiting: "finish" } : {}), truncated: truncated || items.length > MAX_TARGETS };
}

/**
 * La liste de raid. Rend toujours un objet, sans lever ni attendre plus de `timing.readMs` (+ une marge) :
 *   { state: "ok", partners: [{ login, name, contactId, avatar? }], category: { id, label, how } | null, awaiting?, truncated, asOf, stale? }
 *   · { state: "problem", problem: "contacts_missing" | "contacts_old" | "contacts_down" | "category_gone" | "no_category" | "choose" }
 * `stale` : Contacts ne répond pas, c'est la dernière liste connue (10 minutes au plus) ; `staleFrom` dit pourquoi.
 */
export function targets(ctx) {
  const k = `${ctx.instance.key}|${categorySetting(ctx)}`;
  const hit = state.cache.get(k);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.value);
  const pending = state.inflight.get(k);
  if (pending) return pending;
  const deadline = Date.now() + timing.readMs;
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve({ state: "problem", problem: "contacts_down" }), timing.readMs + timing.marginMs); timer.unref?.(); });
  const work = Promise.resolve().then(() => readTargets(ctx, deadline)).catch(() => ({ state: "problem", problem: "contacts_down" }));
  const run = Promise.race([work, expiry]).then((value) => {
    const now = Date.now();
    if (value.state === "ok") { value = { ...value, asOf: now }; state.good.set(k, value); }
    else if (value.problem === "contacts_down") {
      const g = state.good.get(k);
      if (g && now - g.asOf <= timing.staleMs) value = { ...g, stale: true, staleFrom: value.problem };
    }
    if (state.cache.size >= CACHE_MAX) state.cache.delete(state.cache.keys().next().value);
    if (state.good.size > CACHE_MAX) state.good.delete(state.good.keys().next().value);
    state.cache.set(k, { value, until: now + (value.state === "ok" && !value.stale ? timing.okMs : timing.failMs) });
    return value;
  }).finally(() => { clearTimeout(timer); if (state.inflight.get(k) === run) state.inflight.delete(k); });
  state.inflight.set(k, run);
  return run;
}

/** L'adresse de la page de Contacts (filtrée sur la catégorie quand on la connaît), ou null. Bornée, sans lever. */
export async function contactsAdminPath(ctx, categoryId) {
  try {
    if (typeof ctx.api.services.providers !== "function") return null;
    const list = await within(Promise.resolve().then(() => ctx.api.services.providers(BOOK)).catch(() => []), timing.callMs, []);
    const p = (Array.isArray(list) ? list : []).find((x) => x?.master) ?? (Array.isArray(list) ? list[0] : null);
    if (!p || !isId(p.id) || !/^[A-Za-z0-9_.-]+$/.test(p.id)) return null;
    return `/admin/instances/${p.id}${isId(categoryId) ? `?category=${encodeURIComponent(categoryId)}` : ""}`;
  } catch { return null; }
}

// AJOUT RAPIDE d'une chaîne à la liste de raid, et son contraire (« Retirer »). Pour une personne qui n'est pas technicienne : un champ, un pseudo, c'est fait.
//
// Ce que ce fichier décide, et ce qu'il laisse aux autres :
//   - la liste est une CATÉGORIE de Contacts (voir source.mjs) ; Contacts garde les fiches, leurs noms et leurs photos : ici on ne copie jamais ni nom ni photo ;
//   - ajouter = trouver ou créer la fiche qui porte le compte Twitch (`upsertByAccount`, idempotent : jamais de doublon) et la ranger dans la catégorie ;
//   - la catégorie « Cible de raid » est créée toute seule au premier ajout (`ensureCategory`, avec les droits de la personne qui clique) ;
//   - le nom et la photo viennent de Twitch au moment de l'ajout (profiles.mjs, un seul appel pour 100 pseudos) et sont déposés dans la fiche (`setAccountProfile`) ;
//     une fiche qui a déjà un nom n'est jamais renommée ; sans Connecteur ou en panne, la fiche prend le pseudo comme nom ;
//   - retirer = sortir la fiche de CETTE catégorie (`removeCategory`) ; la fiche reste dans Contacts.
// Règles : chaque appel est borné et le travail d'un clic aussi (`timing.budgetMs`) ; un envoi en gros garde ce qui reste à faire (collection `batch`, 30 minutes au plus,
// un seul document) pour que « Continuer » reprenne sans rien refaire ; aucune boucle sans plafond (200 lignes par envoi) ; aucun minuteur de fond.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const pure = await import(`./pure.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const profiles = await import(`./profiles.mjs${v}`);
const { explainLogin, splitLines, oneLine, httpsUrl, CURSOR_MAX } = pure;

/** Les bornes (en millisecondes pour les délais ; chaque appel à Contacts a celle de source.mjs). Un objet pour que les tests puissent les raccourcir. */
export const timing = { budgetMs: 25_000, batchTtlMs: 30 * 60_000 };
export const MAX_LINES = 200;       // lignes d'un envoi en gros
export const LIST_PAGE = 50;        // chaînes par page dans la liste de Raid
export const SEARCH_STEP = 10;      // résultats de recherche par étape (« Voir plus »)
export const SEARCH_MAX = 30;       // le plus que Contacts rend pour une recherche (contrat contact.book : limit ≤ 30)
export const BATCH = "batch";
const SOURCE = "twitch-raid";
const CURSOR = new RegExp(`^[A-Za-z0-9_=-]{1,${CURSOR_MAX}}$`);
const isId = (x) => typeof x === "string" && x.length > 0 && x.length <= 80;
const left = (deadline) => Math.max(0, deadline - Date.now());

/** Une raison d'échec d'appel → l'état à dire (Contacts, ou son extension). `curate` : « méthode inconnue / service absent » veut dire « Contacts trop ancien ». */
const problem = (r, curate = false) => (r.why === "error" ? "contacts_down" : curate && r.why === "missing" ? "contacts_old" : source.problemOf(r.why));

/* ───────────── Chercher dans Contacts ───────────── */

/**
 * Chercher un nom (ou un morceau de pseudo) parmi TOUTES les fiches de Contacts : { ok: true, people: [{ id, name, twitch: [{ handle, inList }] }], more } ou { ok: false, problem }.
 * `people` sont dans l'ordre de Contacts (le plus proche d'abord) ; `twitch` est vide pour une personne qui n'a pas de chaîne Twitch ; `inList` : déjà dans la liste de raid.
 * `more` : il y a peut-être d'autres résultats à montrer (« Voir plus »), jusqu'à `SEARCH_MAX`.
 */
export async function findPeople(ctx, q, { limit = SEARCH_STEP, categoryId = null } = {}) {
  const text = oneLine(q, 100);
  const lim = Math.max(1, Math.min(SEARCH_MAX, Math.trunc(Number(limit)) || SEARCH_STEP));
  const r = await source.ask(ctx, "search", { q: text, limit: lim }, source.timing.callMs);
  if (!r.ok) return { ok: false, problem: problem(r) };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && isId(x.id)).slice(0, lim);
  const handles = [...new Set(items.flatMap((x) => (Array.isArray(x.accounts) ? x.accounts : []).filter((a) => a?.network === "twitch" && typeof a.handle === "string").map((a) => a.handle.toLowerCase())))].slice(0, 200);
  const inList = new Set();
  if (handles.length && isId(categoryId)) {
    const l = await source.askCurate(ctx, "lookupAccounts", { network: "twitch", handles, categoryId }, source.timing.callMs);
    if (l.ok) for (const it of Array.isArray(l.value.items) ? l.value.items : []) if (it?.inCategory === true && typeof it.handle === "string") inList.add(it.handle);
  }
  return {
    ok: true, more: items.length >= lim && lim < SEARCH_MAX,
    people: items.map((x) => ({
      id: x.id, name: oneLine(x.name, 120),
      twitch: [...new Set((Array.isArray(x.accounts) ? x.accounts : []).filter((a) => a?.network === "twitch" && typeof a.handle === "string").map((a) => a.handle.toLowerCase()))].map((handle) => ({ handle, inList: inList.has(handle) })),
    })),
  };
}

/* ───────────── Ajouter ───────────── */

/**
 * Ajoute ces chaînes à la liste de raid. `entries` : [{ login, name? }] (pseudos déjà vérifiés, sans doublon ; `name` : le nom que la personne a tapé, sinon celui de Twitch).
 * Travaille au plus `budgetMs` ; ce qui n'a pas pu être fait est rendu dans `remaining`. Ne lève jamais. Rend :
 *   { ok: false, problem } (Contacts absent / ancien / muet, catégorie impossible à créer…) ou
 *   { ok: true, category, added, joined, already, unknown: [pseudos que Twitch ne connaît pas], failed: [{ login, error }], remaining: [entrées], twitch: état de profiles.mjs, full, problem? }
 *   (`problem` : Contacts s'est arrêté de répondre en route ; ce qui reste est dans `remaining`, rien n'est perdu)
 *   `added` : fiches créées · `joined` : fiches qui existaient déjà dans Contacts et rejoignent la liste · `already` : déjà dans la liste.
 */
export async function addChannels(ctx, entries, { budgetMs = timing.budgetMs, wantedChannel = "" } = {}) {
  const deadline = Date.now() + budgetMs;
  const list = [];
  const seen = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    const login = typeof e?.login === "string" ? e.login : "";
    if (!pure.LOGIN.test(login) || seen.has(login)) continue;
    seen.add(login);
    list.push({ login, ...(oneLine(e.name, 120) ? { name: oneLine(e.name, 120) } : {}) });
    if (list.length >= MAX_LINES) break;
  }
  const out = { ok: true, category: null, added: 0, joined: 0, already: 0, unknown: [], failed: [], remaining: [], twitch: "none", full: false };
  if (!list.length) return out;
  const cat = await source.ensureCategory(ctx, deadline);
  if (!cat.ok) return { ok: false, problem: cat.problem };
  out.category = { id: cat.id, label: cat.label, created: cat.created };

  // Qui est déjà dans Contacts, qui est déjà dans la liste, qui a déjà un nom ou une photo.
  const lk = await source.askCurate(ctx, "lookupAccounts", { network: "twitch", handles: list.map((e) => e.login), categoryId: cat.id }, Math.min(source.timing.callMs, left(deadline)));
  if (!lk.ok) return { ok: false, problem: problem(lk, true) };
  const known = new Map();
  for (const it of Array.isArray(lk.value.items) ? lk.value.items : []) if (typeof it?.handle === "string") known.set(it.handle, it);

  // Le nom et la photo : un seul appel groupé à Twitch, pour ceux qui n'ont encore rien. Un échec n'arrête rien.
  const wantProfile = list.filter((e) => !known.get(e.login)?.hasProfile).map((e) => e.login);
  const pr = wantProfile.length ? await profiles.fetchProfiles(ctx, wantProfile, wantedChannel) : { state: "ok", byLogin: new Map(), asked: new Set() };
  out.twitch = wantProfile.length ? pr.state : "ok";

  for (let i = 0; i < list.length; i++) {
    const e = list[i], k = known.get(e.login), prof = pr.byLogin.get(e.login);
    if (Date.now() >= deadline) { out.remaining = list.slice(i); break; }
    if (!k?.id && pr.asked.has(e.login) && !prof) { out.unknown.push(e.login); continue; }   // Twitch a répondu et ne connaît pas ce pseudo : une faute de frappe, pas une fiche
    if (k?.id && k.inCategory === true) {
      out.already++;
      if (prof && !k.hasProfile && k.accountId) await putProfile(ctx, k.id, k.accountId, prof, deadline);
      continue;
    }
    const name = k?.id ? "" : e.name ?? prof?.name ?? "";
    const r = await source.ask(ctx, "upsertByAccount", { network: "twitch", handle: e.login, kind: "person", source: SOURCE, categoryId: cat.id, ...(name ? { name } : {}) }, Math.min(source.timing.callMs, left(deadline)));
    if (r.ok) {
      if (r.value.created) out.added++; else out.joined++;
      if (prof && (r.value.created || !k?.hasProfile) && isId(r.value.id) && isId(r.value.accountId)) await putProfile(ctx, r.value.id, r.value.accountId, prof, deadline);
      continue;
    }
    if (r.why === "error" && (r.error === "invalid_handle" || r.error === "invalid" || r.error === "invalid_network")) { out.failed.push({ login: e.login, error: "invalid" }); continue; }
    if (r.why === "error" && r.error === "too_many") { out.full = true; out.remaining = list.slice(i); break; }
    if (r.why === "error" && r.error === "not_found") { source.resetSource(); out.remaining = list.slice(i); out.failed.push({ login: e.login, error: "category_gone" }); break; }
    out.remaining = list.slice(i);
    out.problem = problem(r);
    break;
  }
  source.resetSource();
  return out;
}

/** Dépose le nom et la photo trouvés sur Twitch dans la fiche (Contacts reste propriétaire ; une donnée plus ancienne que la sienne est ignorée). Un échec n'est pas une erreur. */
async function putProfile(ctx, id, accountId, prof, deadline) {
  const args = { id, accountId, source: SOURCE, at: new Date().toISOString(), ...(prof.name ? { displayName: prof.name } : {}), ...(httpsUrl(prof.avatar) ? { avatar: prof.avatar } : {}) };
  if (!args.displayName && !args.avatar) return;
  await source.ask(ctx, "setAccountProfile", args, Math.min(source.timing.callMs, left(deadline)));
}

/** Ajoute le compte Twitch `login` à une fiche qui n'en a pas (jamais de doublon), puis la range dans la liste. Rend le même résultat que `addChannels`, plus `{ taken: { id, name } }` si ce pseudo est déjà sur une autre fiche. */
export async function attachChannel(ctx, contactId, login, opts = {}) {
  if (!isId(contactId) || !pure.LOGIN.test(login)) return { ok: false, problem: "invalid" };
  const deadline = Date.now() + (opts.budgetMs ?? timing.budgetMs);
  const r = await source.askCurate(ctx, "addAccount", { id: contactId, network: "twitch", handle: login }, source.timing.callMs);
  if (!r.ok) {
    if (r.why === "error" && r.error === "taken") {
      let name = "";
      if (isId(r.id)) { const g = await source.ask(ctx, "resolve", { ids: [r.id] }, source.timing.callMs); name = oneLine(g.ok && Array.isArray(g.value.contacts) ? g.value.contacts[0]?.name : "", 120); }
      return { ok: false, problem: "taken", taken: { id: isId(r.id) ? r.id : null, name } };
    }
    if (r.why === "error" && r.error === "not_found") return { ok: false, problem: "person_gone" };
    if (r.why === "error" && r.error === "too_many_accounts") return { ok: false, problem: "too_many_accounts" };
    if (r.why === "error" && (r.error === "invalid_handle" || r.error === "invalid")) return { ok: false, problem: "invalid" };
    return { ok: false, problem: problem(r, true) };
  }
  return addChannels(ctx, [{ login }], { ...opts, budgetMs: Math.max(1000, left(deadline)) });
}

/** Retire une fiche de la liste de raid (et d'elle seule : la fiche reste dans Contacts). Rend { ok: true, removed } ou { ok: false, problem }. */
export async function removeFromList(ctx, contactId) {
  if (!isId(contactId)) return { ok: false, problem: "invalid" };
  const cat = await source.resolveCategory(ctx);
  if (cat.problem) return { ok: false, problem: cat.problem };
  const r = await source.askCurate(ctx, "removeCategory", { id: contactId, categoryId: cat.id }, source.timing.callMs);
  source.resetSource();
  if (r.ok) return { ok: true, removed: r.value.removed === true, category: cat.label };
  if (r.why === "error" && r.error === "not_found") return { ok: true, removed: false, category: cat.label };   // déjà partie : rien à faire
  return { ok: false, problem: problem(r, true) };
}

/* ───────────── La liste, par pages ───────────── */

/**
 * Une page de la liste de raid : { ok: true, items: [{ id, handle, name, displayName? }], next } ou { ok: false, problem }. 50 par page, curseur opaque ;
 * avec un texte `q`, c'est la recherche de Contacts restreinte à la catégorie (nom, pseudo, nom affiché).
 */
export async function listPage(ctx, categoryId, { cursor = "", q = "" } = {}) {
  if (!isId(categoryId)) return { ok: true, items: [], next: null };
  const cur = typeof cursor === "string" && CURSOR.test(cursor) ? cursor : "";
  const text = oneLine(q, 100);
  const r = text
    ? await source.askCurate(ctx, "searchAccounts", { network: "twitch", q: text, categoryId, limit: LIST_PAGE, ...(cur ? { cursor: cur } : {}) }, source.timing.callMs)
    : await source.ask(ctx, "accounts", { network: "twitch", categoryId, limit: LIST_PAGE, ...(cur ? { cursor: cur } : {}) }, source.timing.callMs);
  if (!r.ok) return { ok: false, problem: r.why === "error" && r.error === "not_found" ? "category_gone" : problem(r, !!text) };
  const items = (Array.isArray(r.value.items) ? r.value.items : []).filter((x) => x && isId(x.id) && typeof x.handle === "string").slice(0, LIST_PAGE)
    .map((x) => ({ id: x.id, handle: x.handle.toLowerCase(), name: oneLine(x.name, 120), ...(oneLine(x.displayName, 120) ? { displayName: oneLine(x.displayName, 120) } : {}) }));
  return { ok: true, items, next: typeof r.value.next === "string" && CURSOR.test(r.value.next) ? r.value.next : null };
}

/* ───────────── Coller plusieurs lignes ───────────── */

/**
 * Lit le texte collé : une chaîne (pseudo ou lien) par ligne, 200 lignes au plus. Rend { logins: [{ login, line }] (sans doublon), invalid: [{ line, input, reason }], invalidCount, dups, total, over }.
 * `reason` : "chars" | "short" | "long" | "not_channel".
 */
export function parsePaste(text) {
  const { lines, total, over } = splitLines(text, MAX_LINES);
  const logins = [], invalid = [], seen = new Set();
  let invalidCount = 0, dups = 0;
  lines.forEach((raw, i) => {
    const r = explainLogin(raw);
    if (r.login) { if (seen.has(r.login)) dups++; else { seen.add(r.login); logins.push({ login: r.login, line: i + 1 }); } return; }
    invalidCount++;
    if (invalid.length < 50) invalid.push({ line: i + 1, input: oneLine(raw, 60), reason: r.error === "empty" ? "chars" : r.error });
  });
  return { logins, invalid, invalidCount, dups, total, over };
}

/** Le document de l'envoi en cours (un seul), ou null s'il n'y en a pas ou s'il est trop vieux (il est alors effacé). */
export async function readBatch(ctx) {
  try {
    const doc = (await ctx.api.store.list(BATCH, { limit: 1 }))[0];
    if (!doc) return null;
    const d = doc.data && typeof doc.data === "object" ? doc.data : {};
    if (!Number.isFinite(d.at) || Date.now() - d.at > timing.batchTtlMs || !Array.isArray(d.todo)) { await ctx.api.store.remove(doc.id).catch(() => {}); return null; }
    return { id: doc.id, ...d, todo: d.todo.filter((e) => e && pure.LOGIN.test(e.login)).slice(0, MAX_LINES) };
  } catch { return null; }
}
async function writeBatch(ctx, data) {
  const cur = (await ctx.api.store.list(BATCH, { limit: 1 }))[0];
  if (cur) await ctx.api.store.update(cur.id, data); else await ctx.api.store.add(BATCH, data);
}
export async function clearBatch(ctx) {
  try { for (const d of await ctx.api.store.list(BATCH, { limit: 5 })) await ctx.api.store.remove(d.id); } catch { /* sans importance */ }
}

/**
 * L'aperçu d'un envoi en gros : compte ce qui est nouveau, ce qui est déjà dans Contacts, ce qui est déjà dans la liste, ce qui est invalide — SANS rien écrire
 * dans Contacts. Garde ce qu'il reste à faire (pseudos seulement) 30 minutes. Rend { ok: true, batch } ou { ok: false, problem }.
 */
export async function previewBatch(ctx, text) {
  const p = parsePaste(text);
  const base = { at: Date.now(), total: p.total, invalid: p.invalid, invalidCount: p.invalidCount, dups: p.dups, news: 0, existing: 0, already: 0, applied: { added: 0, joined: 0, already: 0, unknown: 0, failed: 0 }, started: false };
  if (!p.logins.length) { await clearBatch(ctx); return { ok: true, batch: { ...base, todo: [] } }; }
  const cat = await source.resolveCategory(ctx);
  const catId = !cat.problem ? cat.id : null;   // pas encore de catégorie : tout est « nouveau pour la liste » (elle sera créée à la validation)
  const lk = await source.askCurate(ctx, "lookupAccounts", { network: "twitch", handles: p.logins.map((x) => x.login), ...(catId ? { categoryId: catId } : {}) }, source.timing.callMs);
  if (!lk.ok) return { ok: false, problem: problem(lk, true) };
  const byHandle = new Map((Array.isArray(lk.value.items) ? lk.value.items : []).filter((x) => typeof x?.handle === "string").map((x) => [x.handle, x]));
  const todo = [];
  for (const { login } of p.logins) {
    const k = byHandle.get(login);
    if (!k?.id) { base.news++; todo.push({ login }); } else if (k.inCategory === true) base.already++; else { base.existing++; todo.push({ login }); }
  }
  const batch = { ...base, todo };
  await writeBatch(ctx, batch);
  return { ok: true, batch };
}

/**
 * Valide l'envoi en gros : ajoute ce qu'il reste à faire, dans le temps d'un clic. S'il en reste, le document est mis à jour (« Continuer »). Idempotent : refaire ne double rien.
 * Rend { ok: true, batch, finished } (batch : les compteurs cumulés), ou { ok: false, problem } (Contacts, catégorie…).
 */
export async function applyBatch(ctx, opts = {}) {
  const b = await readBatch(ctx);
  if (!b || !b.todo.length) { await clearBatch(ctx); return { ok: false, problem: "no_batch" }; }
  const r = await addChannels(ctx, b.todo, opts);
  if (!r.ok) return r;
  const applied = { ...b.applied };
  applied.added += r.added; applied.joined += r.joined; applied.already += r.already; applied.unknown += r.unknown.length; applied.failed += r.failed.length;
  const next = { ...b, id: undefined, applied, started: true, todo: r.remaining.map((e) => ({ login: e.login })), twitch: r.twitch, full: r.full === true };
  delete next.id;
  const finished = !r.remaining.length || r.full;   // « plein » : inutile de garder le reste ; une panne de Contacts garde le reste pour « Continuer »
  if (finished) await clearBatch(ctx); else await writeBatch(ctx, next);
  return { ok: true, batch: next, finished, stopped: r.full ? "full" : r.problem ?? null, category: r.category, unknown: r.unknown.slice(0, 5) };
}

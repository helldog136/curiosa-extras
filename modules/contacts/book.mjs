// Contacts — le carnet : règles métier (fiches, comptes, organisations, catégories, notes, fusion, effacement).
// Utilisé par le service « contact.book » (service.mjs), l'administration (admin.mjs) et les outils MCP (tools.mjs). Chaque fonction rend
// { ok: true, … } ou { ok: false, error: "<code>" } et ne lève pas (sauf `Busy` : index ou stockage injoignable dans le temps imparti).
import { normalizeAccount, accountKey, pickPhoto, clean, fold, NETWORKS } from "./networks.mjs";
import {
  LIMITS, FIELDS, ORG_NAME_MAX, KINDS, STATUSES, PALETTE, idOk, validEmail, emailKey, maxContacts, getIndex, withLock, forgetIndex, readContact, readMany,
  latestNotes, allNotes, movedTarget, liveCategory, liveCategories, categoryView, indexPut, indexDrop, indexPutCategory, indexDropCategory,
  encCursor, decCursor, after, kindOf, getByKey, collectionOf, CARD_COLLECTIONS, keysOf, SEP,
} from "./data.mjs";
import { callSubjects } from "./subjects.mjs";

export { NETWORKS, KINDS, STATUSES, FIELDS, LIMITS };
export const RIGHT_CREATE_CATEGORY = "categories.create";
export const RIGHT_EMAIL_VIEW = "email.view";
export const RIGHT_EXPORT = "export";
const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const obj = (a) => (a && typeof a === "object" && !Array.isArray(a) ? a : null);
export const sourceOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v);
export const httpsUrl = (v) => typeof v === "string" && v.length <= 500 && /^https:\/\/[^\s/?#]+\.[^\s/?#]+(\/[^\s]*)?$/i.test(v);
const clampLimit = (v, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : def; };
const today = () => new Date().toISOString().slice(0, 10);
const newAccountId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const can = (ctx, right) => { try { return typeof ctx.can === "function" && ctx.can(right) === true; } catch { return false; } };

// ── Vues ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const accountView = (a) => ({ id: a.id, network: a.network, handle: a.handle, url: a.url ?? null, ...(a.displayName ? { displayName: a.displayName } : {}), ...(a.avatar ? { avatar: a.avatar } : {}), ...(Number.isInteger(a.followers) ? { followers: a.followers } : {}), ...(a.profileAt ? { profileAt: a.profileAt } : {}) });
export const accountsOf = (d) => (Array.isArray(d.accounts) ? d.accounts.filter((a) => a && NETWORKS.includes(a.network) && typeof a.handle === "string") : []);
export const orgOf = (idx, d) => (kindOf(d) === "person" && idOk(d.orgId) ? idx.byId.get(d.orgId) ?? null : null);
export const liveCategoryIds = (idx, ids) => [...new Set((Array.isArray(ids) ? ids : []).map((k) => liveCategory(idx, k)).filter(Boolean))];

/** La fiche telle que la voient les autres modules (get / resolve / list). Jamais d'e-mail ni de téléphone dans les comptes. */
export function card(ctx, idx, rec) {
  const d = rec.data, org = orgOf(idx, d), accounts = accountsOf(d);
  return {
    id: rec.id, kind: kindOf(d), name: d.name, role: d.role || null, organisation: org ? org.d : null, orgId: org ? org.id : null, orgName: org ? org.d : null,
    email: d.email || null, phone: d.phone || null, status: d.status, source: d.source ?? "manual", createdAt: new Date(rec.createdAt).toISOString(),
    categoryIds: liveCategoryIds(idx, d.categoryIds), accounts: accounts.map(accountView), photo: pickPhoto({ photo: d.photo, accounts }),
    adminPath: `/admin/instances/${ctx.instance.id}?contact=${encodeURIComponent(rec.id)}`,
  };
}
const noteView = (n) => ({ id: n.id, date: n.data.date, author: n.data.author, text: n.data.text });

// ── Lectures ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `get` du service, plus (pour l'admin et le MCP) `notes` avec leurs ids et le document lu (`record`). */
export async function get(ctx, a) {
  a = obj(a);
  if (!a || !idOk(a.id)) return err("not_found");
  const idx = await getIndex(ctx);
  const rec = idx.byId.has(a.id) ? await readContact(ctx, a.id) : null;
  if (!rec) { const to = await movedTarget(ctx, idx, a.id); return to ? err("not_found", { movedTo: to }) : err("not_found"); }
  const notes = (await latestNotes(ctx, rec.id)).map(noteView);
  return { ok: true, contact: { ...card(ctx, idx, rec), others: rec.data.others || null, relation: rec.data.relation || null, notes: notes.map(({ date, author, text }) => ({ date, author, text })) }, notes, record: rec, index: idx };
}

export async function resolve(ctx, a) {
  a = obj(a);
  if (!a || !Array.isArray(a.ids) || a.ids.length > LIMITS.resolve) return err("invalid");
  const idx = await getIndex(ctx);
  const ids = [...new Set(a.ids.filter(idOk))];
  const recs = await readMany(ctx, ids.filter((id) => idx.byId.has(id)));
  const moved = {}, missing = [];
  for (const id of ids) {
    if (recs.has(id)) continue;
    const to = await movedTarget(ctx, idx, id);
    if (to) moved[id] = to; else missing.push(id);
  }
  return { ok: true, contacts: ids.filter((id) => recs.has(id)).map((id) => card(ctx, idx, recs.get(id))), missing, moved };
}

/**
 * v1 : recherche exacte (e-mail, nom, organisation) ou par morceau de texte (nom, organisation, pseudo ; e-mail exact si le texte en est un). Plus récentes
 * d'abord. Comme en 1.x, seulement des PERSONNES (les organisations sont des fiches depuis la 2.0) ; `kind: "org"` cherche les organisations.
 */
export async function find(ctx, a) {
  a = obj(a) ?? {};
  const kind = a.kind === "org" ? 1 : 0;
  const email = clean(a.email, FIELDS.email).toLowerCase();
  if (email && !validEmail(email)) return err("invalid_email");
  const q = fold(clean(a.q, 400)), name = fold(clean(a.name, 400)), org = fold(clean(a.organisation, 400));
  const lim = clampLimit(a.limit, 100, 20);
  const idx = await getIndex(ctx);
  const emailId = email ? (await byEmail(ctx, idx, email))?.id ?? null : null;
  const qEmailId = q && validEmail(q) ? (await byEmail(ctx, idx, q))?.id ?? null : null;
  if (email && !emailId) return { ok: true, total: 0, contacts: [] };
  const orgName = (e) => (e.o ? idx.byId.get(e.o)?.n ?? "" : "");
  const bare = q.replace(/^@/, "");
  const hits = [];
  for (let i = idx.list.length - 1; i >= 0; i--) {
    const e = idx.list[i];
    if ((e.k & 1) !== kind) continue;
    if (email && e.id !== emailId) continue;
    if (name && e.n !== name) continue;
    if (org && orgName(e) !== org) continue;
    if (q && !(e.id === qEmailId || e.n.includes(q) || orgName(e).includes(q) || (e.a !== null && e.a.includes(bare) && keysOf(e).some((k) => k.slice(k.indexOf(":") + 1).replace(/^@/, "").includes(bare))))) continue;
    hits.push(e.id);
  }
  const page = hits.slice(0, lim);
  const recs = await readMany(ctx, page);
  return { ok: true, total: hits.length, contacts: page.filter((id) => recs.has(id)).map((id) => card(ctx, idx, recs.get(id))) };
}

/** Filtre de l'index : catégorie (suivie si fusionnée), kind, organisation, réseau, « à vérifier ». */
export function matcher(idx, { cat, kind, orgId, network, review }) {
  const netPrefix = network ? `${network}:` : null;
  return (e) => (!kind || (kind === "org" ? (e.k & 1) === 1 : (e.k & 1) === 0))
    && (!orgId || e.o === orgId)
    && (!review || (e.k & 2) === 2)
    && (!netPrefix || (e.a !== null && (e.a.startsWith(netPrefix) || e.a.includes(SEP + netPrefix))))
    && (!cat || (e.c ?? []).some((k) => k === cat || liveCategory(idx, k) === cat));
}

/** Une page de l'index (ordre de création), filtrée : { ids, next } (curseur opaque de la méthode `tag`). */
export function indexPage(idx, { cursor, limit, tag = "list", reverse = false, ...filter }) {
  const c = decCursor(cursor, tag);
  if (c.bad) return { ids: [], next: null };
  const ok = matcher(idx, filter);
  const ids = [];
  let last = null, more = false;
  if (!reverse) {
    for (let i = c.start ? 0 : after(idx.list, c.at[1], c.at[2]); i < idx.list.length; i++) {
      const e = idx.list[i];
      if (!ok(e)) continue;
      if (ids.length === limit) { more = true; break; }
      ids.push(e.id); last = e;
    }
  } else {
    for (let i = (c.start ? idx.list.length : after(idx.list, c.at[1], c.at[2]) - 1) - 1; i >= 0; i--) {
      const e = idx.list[i];
      if (!ok(e)) continue;
      if (ids.length === limit) { more = true; break; }
      ids.push(e.id); last = e;
    }
  }
  return { ids, next: more && last ? encCursor([tag, last.t, last.id, 0]) : null };
}

export async function list(ctx, a) {
  a = obj(a) ?? {};
  if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
  if (a.orgId !== undefined && !idOk(a.orgId)) return err("invalid");
  const idx = await getIndex(ctx);
  let cat = null;
  if (a.categoryId !== undefined && a.categoryId !== null) { cat = liveCategory(idx, a.categoryId); if (!cat) return err("not_found"); }
  const page = indexPage(idx, { cursor: a.cursor, limit: clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault), cat, kind: a.kind, orgId: a.orgId });
  const recs = await readMany(ctx, page.ids);
  return { ok: true, items: page.ids.filter((id) => recs.has(id)).map((id) => card(ctx, idx, recs.get(id))), next: page.next };
}

/** Un élément par COMPTE du réseau demandé (ordre de création des fiches, puis des comptes). Curseur : [« accounts », date, id de fiche, rang du compte]. */
export async function accounts(ctx, a) {
  a = obj(a);
  if (!a) return err("invalid");
  if (!NETWORKS.includes(a.network)) return err("invalid_network");
  if (a.ids !== undefined && (!Array.isArray(a.ids) || a.ids.length > LIMITS.accountIds)) return err("invalid");
  const idx = await getIndex(ctx);
  let cat = null;
  if (a.categoryId !== undefined && a.categoryId !== null) { cat = liveCategory(idx, a.categoryId); if (!cat) return err("not_found"); }
  const only = a.ids ? new Set(a.ids.filter(idOk)) : null;
  const lim = clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault);
  const c = decCursor(a.cursor, "accounts");
  if (c.bad) return { ok: true, items: [], next: null };
  const ok = matcher(idx, { cat, network: a.network });
  const prefix = `${a.network}:`;
  const want = []; // [entrée, rang du compte parmi ceux du réseau]
  let i = 0, skipUpTo = -1, more = false;
  if (!c.start) {
    const at = after(idx.list, c.at[1], c.at[2]);
    if (at > 0 && idx.list[at - 1].id === c.at[2]) { i = at - 1; skipUpTo = Number.isInteger(c.at[3]) ? c.at[3] : Infinity; } else i = at;
  }
  outer: for (; i < idx.list.length; i++, skipUpTo = -1) {
    const e = idx.list[i];
    if ((only && !only.has(e.id)) || !ok(e)) continue;
    const n = keysOf(e).filter((k) => k.startsWith(prefix)).length;
    for (let r = skipUpTo + 1; r < n; r++) {
      if (want.length === lim) { more = true; break outer; }
      want.push([e, r]);
    }
  }
  const recs = await readMany(ctx, [...new Set(want.map(([e]) => e.id))]);
  const items = [];
  for (const [e, r] of want) {
    const rec = recs.get(e.id);
    const acc = rec ? accountsOf(rec.data).filter((x) => x.network === a.network)[r] : null;
    if (!acc) continue;
    items.push({ id: e.id, accountId: acc.id, name: rec.data.name, handle: acc.handle, url: acc.url ?? null, ...(acc.displayName ? { displayName: acc.displayName } : {}), ...(acc.avatar ? { avatar: acc.avatar } : {}), ...(Number.isInteger(acc.followers) ? { followers: acc.followers } : {}) });
  }
  const last = want[want.length - 1];
  return { ok: true, items, next: more && last ? encCursor(["accounts", last[0].t, last[0].id, last[1]]) : null };
}

/** Score d'une entrée pour un texte replié (0 = exact, 1 = début d'un mot, 2 = contenu, -1 = absent). */
function scoreOf(idx, e, q) {
  const org = e.o ? idx.byId.get(e.o)?.n ?? "" : "";
  // Tri rapide sans allocation : la plupart des fiches ne contiennent pas le texte du tout.
  if (!e.n.includes(q) && !(e.a !== null && e.a.includes(q)) && !(e.h !== null && e.h.includes(q)) && !org.includes(q)) return -1;
  const handles = keysOf(e).map((k) => k.slice(k.indexOf(":") + 1));
  const texts = [e.n, ...handles, ...handles.map((h) => h.replace(/^@/, "")), ...(e.h ? e.h.split(SEP) : []), org];
  if (texts.some((t) => t === q)) return 0;
  if (texts.some((t) => t.startsWith(q) || t.split(/[\s._@-]/).some((w) => w.startsWith(q)))) return 1;
  if (texts.some((t) => t.includes(q))) return 2;
  return -1;
}
/** Recherche sans accents ni casse : nom, pseudos (avec ou sans @), noms affichés, organisation. Le plus exact d'abord. `q` déjà replié. */
export function searchIds(idx, { q, limit = LIMITS.search, offset = 0, ...filter }) {
  const scored = [];
  const ok = matcher(idx, filter);
  for (const e of idx.list) {
    if (!ok(e)) continue;
    const s = scoreOf(idx, e, q);
    if (s >= 0) scored.push([s, e]);
  }
  scored.sort((x, y) => x[0] - y[0] || (x[1].n < y[1].n ? -1 : x[1].n > y[1].n ? 1 : 0) || x[1].t - y[1].t);
  return { total: scored.length, ids: scored.slice(offset, offset + limit).map(([, e]) => e.id) };
}
export const searchKey = (q) => fold(clean(typeof q === "string" ? q.slice(0, LIMITS.q) : "", LIMITS.q)).replace(/^@/, "");
export async function search(ctx, a) {
  a = obj(a);
  if (!a) return err("invalid");
  if (a.network !== undefined && !NETWORKS.includes(a.network)) return err("invalid_network");
  if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
  const q = searchKey(a.q);
  const lim = clampLimit(a.limit, LIMITS.search, LIMITS.searchDefault);
  if (!q) return { ok: true, items: [] };
  const idx = await getIndex(ctx);
  const { ids } = searchIds(idx, { q, network: a.network, kind: a.kind, limit: lim });
  const recs = await readMany(ctx, ids);
  return {
    ok: true,
    items: ids.filter((id) => recs.has(id)).map((id) => {
      const d = recs.get(id).data;
      const accs = accountsOf(d).filter((x) => !a.network || x.network === a.network);
      return { id, name: d.name, kind: kindOf(d), accounts: accs.map((x) => ({ network: x.network, handle: x.handle, ...(x.displayName ? { displayName: x.displayName } : {}) })) };
    }),
  };
}

export async function categories(ctx, a) {
  a = obj(a) ?? {};
  const idx = await getIndex(ctx);
  const q = fold(typeof a.q === "string" ? a.q.slice(0, LIMITS.q) : "");
  const rows = liveCategories(idx).filter((k) => !q || fold(k.name).includes(q)).map((k) => [fold(k.name), k]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1].id < y[1].id ? -1 : 1));
  const lim = clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault);
  if (a.cursor !== undefined && a.cursor !== null && a.cursor !== "" && typeof a.cursor !== "string") return { ok: true, items: [], next: null };
  let from = 0;
  if (typeof a.cursor === "string" && a.cursor) {
    let at = null;
    try { const v = JSON.parse(Buffer.from(a.cursor, "base64url").toString("utf8")); if (Array.isArray(v) && v[0] === "categories" && typeof v[1] === "string" && typeof v[2] === "string") at = v; } catch { /* illisible */ }
    if (!at || a.cursor.length > LIMITS.cursor) return { ok: true, items: [], next: null };
    from = rows.findIndex(([f, k]) => f > at[1] || (f === at[1] && k.id > at[2]));
    if (from < 0) return { ok: true, items: [], next: null };
  }
  const page = rows.slice(from, from + lim);
  const last = page[page.length - 1];
  return { ok: true, items: page.map(([, k]) => categoryView(k)), next: from + lim < rows.length && last ? Buffer.from(JSON.stringify(["categories", last[0], last[1].id])).toString("base64url") : null };
}

export async function categoriesResolve(ctx, a) {
  a = obj(a);
  if (!a || !Array.isArray(a.ids) || a.ids.length > LIMITS.categoriesResolve) return err("invalid");
  const idx = await getIndex(ctx);
  const items = [], moved = {}, missing = [];
  for (const id of [...new Set(a.ids.filter(idOk))]) {
    const k = idx.cats.get(id);
    if (k && !k.movedTo && typeof k.name === "string") { items.push(categoryView(k)); continue; }
    const to = liveCategory(idx, id);
    if (to) moved[id] = to; else missing.push(id);
  }
  return { ok: true, items, moved, missing };
}

// ── Écritures (toujours sous le verrou de l'instance) ─────────────────────────────────────────────────────────────────────────────────────
export const isFull = (ctx, idx, extra = 1) => idx.list.length + extra > maxContacts(ctx);
const full = isFull;

/** La fiche (personne ou organisation) qui porte cet e-mail, ou null. */
async function byEmail(ctx, idx, email) {
  for (const c of CARD_COLLECTIONS) { const r = await getByKey(ctx, c, emailKey(email)); if (r && idx.byId.has(r.id)) return r; }
  return null;
}
/** Écrit une fiche existante (données complètes) et met l'index à jour. */
async function save(ctx, idx, rec, data) {
  const done = await ctx.api.store.update(rec.id, data, { key: emailKey(data.email || "") });
  if (done === false) throw Object.assign(new Error("contact vanished"), { code: "busy" });
  const next = { ...rec, data };
  indexPut(idx, next);
  return next;
}
/** Ajoute une fiche (données complètes) ; rend le document (avec sa date de création, relue). */
async function insert(ctx, idx, data) {
  const id = await ctx.api.store.add(collectionOf(data.kind), data, { key: emailKey(data.email || "") });
  const rec = (await ctx.api.store.get(id)) ?? { id, createdAt: new Date(), data };
  indexPut(idx, rec);
  return rec;
}
export function blankContact({ kind = "person", name, status = "active", source = "manual" }) {
  return { kind, name, status, source, role: "", email: "", phone: "", others: "", relation: "", orgId: null, categoryIds: [], accounts: [], photo: null };
}
async function addNoteTo(ctx, id, text, author) {
  const t = clean(text, LIMITS.note, true);
  if (!t) return false;
  await ctx.api.store.add("notes", { contactId: id, date: today(), author: clean(author, 60) || "module", text: t }, { key: id });
  return true;
}
/** Trouve ou crée la fiche organisation d'un texte (alias v1 « organisation »). "" → null ; carnet plein → null. */
async function orgFor(ctx, idx, text) {
  const name = clean(text, ORG_NAME_MAX);
  if (!name) return null;
  const known = idx.orgByName.get(fold(name));
  if (known) return known;
  if (full(ctx, idx)) return null;
  return (await insert(ctx, idx, blankContact({ kind: "org", name }))).id;
}
/** Le compte normalisé `n` sur les données `data` de la fiche `id` (déjà là, ajouté, ou refusé : autre fiche / fiche pleine). Modifie `data.accounts`. */
function attach(idx, id, data, n) {
  const key = accountKey(n.network, n.handle);
  const owner = idx.byAccount.get(key);
  if (owner && owner !== id) return { taken: owner };
  const accs = accountsOf(data);
  const here = accs.find((x) => accountKey(x.network, x.handle) === key);
  if (here) return { account: here, existed: true };
  if (accs.length >= LIMITS.accountsPerContact) return { fullAccounts: true };
  const account = { id: newAccountId(), network: n.network, handle: n.handle, url: n.url ?? null };
  data.accounts = [...accs, account];
  return { account };
}

/** v1 `create` (+ `kind`) : rend la fiche existante si elle existe déjà (même e-mail ; sinon même nom et même organisation ; une organisation : même nom). */
async function createLocked(ctx, idx, a, { defaultSource = "partnerships", extra } = {}) {
  const kind = KINDS.includes(a.kind) ? a.kind : "person";
  const name = clean(a.name, kind === "org" ? ORG_NAME_MAX : FIELDS.name);
  if (!name) return err("name_required");
  const email = clean(a.email, FIELDS.email).toLowerCase();
  if (email && !validEmail(email)) return err("invalid_email");
  let knownId = null, matchedBy = null;
  if (email) {
    const r = await byEmail(ctx, idx, email);
    if (r) [knownId, matchedBy] = [r.id, "email"];
  } else if (kind === "org") {
    const k = idx.orgByName.get(fold(name));
    if (k) [knownId, matchedBy] = [k, "name"];
  } else {
    const n = fold(name), orgKey = fold(clean(a.organisation, ORG_NAME_MAX));
    const hit = idx.list.find((e) => !(e.k & 1) && e.n === n && (e.o ? idx.byId.get(e.o)?.n ?? "" : "") === orgKey);
    if (hit) [knownId, matchedBy] = [hit.id, "name+organisation"];
  }
  if (knownId) {
    const rec = await readContact(ctx, knownId);
    if (rec) return { ok: true, id: knownId, created: false, matchedBy, contact: card(ctx, idx, rec) };
  }
  if (full(ctx, idx)) return err("too_many");
  const source = sourceOk(a.source) ? a.source : defaultSource;
  const data = { ...blankContact({ kind, name, status: STATUSES.includes(a.status) ? a.status : "active", source }), email, role: clean(a.role, FIELDS.role), phone: clean(a.phone, FIELDS.phone), others: clean(a.others, FIELDS.others, true), relation: clean(a.relation, FIELDS.relation) };
  if (kind === "person") data.orgId = await orgFor(ctx, idx, a.organisation);
  if (extra) extra(data);
  const rec = await insert(ctx, idx, data);
  if (a.note) await addNoteTo(ctx, rec.id, a.note, source);
  return { ok: true, id: rec.id, created: true, contact: card(ctx, idx, rec) };
}
export async function create(ctx, a, opts) {
  a = obj(a) ?? {};
  return withLock(ctx, async () => createLocked(ctx, await getIndex(ctx), a, opts));
}

/**
 * v1 `update` : seuls les champs donnés changent ; "" vide un champ facultatif ; `organisation` (texte) trouve ou crée l'organisation.
 * Comme en 1.x, le statut ne passe pas par le service (`allowStatus` : admin et MCP seulement).
 */
export async function update(ctx, a, { allowContact = true, allowStatus = false } = {}) {
  a = obj(a) ?? {};
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(a.id) && idx.byId.has(a.id) ? await readContact(ctx, a.id) : null;
    if (!rec) return err("not_found");
    const keys = [...Object.keys(FIELDS), "organisation", ...(allowStatus ? ["status"] : [])].filter((k) => a[k] !== undefined && (allowContact || (k !== "email" && k !== "phone")));
    if (!keys.length) return err("nothing_to_update");
    const data = { ...rec.data };
    const org = kindOf(data) === "org";
    if (a.name !== undefined && !clean(a.name, org ? ORG_NAME_MAX : FIELDS.name)) return err("name_required");
    if (a.email !== undefined && allowContact) {
      const email = clean(a.email, FIELDS.email).toLowerCase();
      if (email && !validEmail(email)) return err("invalid_email");
      if (email) { const other = await byEmail(ctx, idx, email); if (other && other.id !== rec.id) return err("email_taken", { id: other.id }); }
      data.email = email;
    }
    for (const k of Object.keys(FIELDS)) if (k !== "email" && a[k] !== undefined && (allowContact || k !== "phone")) data[k] = clean(a[k], k === "name" && org ? ORG_NAME_MAX : FIELDS[k], k === "others");
    if (a.organisation !== undefined && !org) data.orgId = await orgFor(ctx, idx, a.organisation);
    if (allowStatus && STATUSES.includes(a.status)) data.status = a.status;
    const saved = await save(ctx, idx, rec, data);
    return { ok: true, contact: card(ctx, idx, saved) };
  });
}

export async function note(ctx, a) {
  a = obj(a) ?? {};
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    if (!idOk(a.id) || !idx.byId.has(a.id)) return err("not_found");
    if (!clean(a.text, LIMITS.note)) return err("text_required");
    await addNoteTo(ctx, a.id, a.text, a.author);
    return { ok: true, id: a.id };
  });
}

const labelOf = (v) => { if (typeof v !== "string") return null; const l = v.replace(/\s+/g, " ").trim(); return l && l.length <= LIMITS.label ? l : null; };
const catByLabel = (idx, label) => liveCategories(idx).find((k) => fold(k.name) === fold(label));
/** Crée une catégorie. Droit « categories.create » exigé (`allowed` : décision déjà prise par l'appelant, par ex. l'action d'admin protégée par le cœur). */
export async function createCategory(ctx, a, { allowed } = {}) {
  if (!(allowed ?? can(ctx, RIGHT_CREATE_CATEGORY))) return err("denied");
  a = obj(a);
  const label = labelOf(a?.label);
  if (!label) return err("invalid");
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const known = catByLabel(idx, label);
    if (known) return err("duplicate", { id: known.id });
    const live = liveCategories(idx);
    if (live.length >= LIMITS.categories) return err("too_many");
    const data = { name: label, color: /^#[0-9a-f]{6}$/i.test(a.color ?? "") ? a.color.toLowerCase() : PALETTE[live.length % PALETTE.length], icon: typeof a.icon === "string" && a.icon.trim() && [...a.icon.trim()].length <= 4 ? a.icon.trim() : null };
    const id = await ctx.api.store.add("categories", data);
    indexPutCategory(idx, { id, data });
    return { ok: true, id, label };
  });
}

export async function setAccountProfile(ctx, a) {
  a = obj(a);
  if (!a || !sourceOk(a.source)) return err("invalid");
  const at = typeof a.at === "string" ? Date.parse(a.at) : NaN;
  if (Number.isNaN(at) || at > Date.now() + 5 * 60_000) return err("invalid");
  if (a.avatar !== undefined && a.avatar !== null && !httpsUrl(a.avatar)) return err("invalid");
  if (a.followers !== undefined && a.followers !== null && !(Number.isInteger(a.followers) && a.followers >= 0 && a.followers <= 1e10)) return err("invalid");
  if (a.displayName !== undefined && a.displayName !== null && typeof a.displayName !== "string") return err("invalid");
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(a.id) && idx.byId.has(a.id) ? await readContact(ctx, a.id) : null;
    const accs = rec ? accountsOf(rec.data) : [];
    const acc = idOk(a.accountId) ? accs.find((x) => x.id === a.accountId) : null;
    if (!acc) return err("not_found");
    if (acc.profileAt && Date.parse(acc.profileAt) > at) return { ok: true, stale: true };
    const next = { ...acc };
    if (a.displayName !== undefined) { const v = clean(a.displayName, FIELDS.name); if (v) next.displayName = v; else delete next.displayName; }
    if (a.avatar !== undefined) { if (a.avatar) next.avatar = a.avatar; else delete next.avatar; }
    if (a.followers !== undefined) { if (a.followers === null) delete next.followers; else next.followers = a.followers; }
    next.profileAt = new Date(at).toISOString();
    next.profileSource = a.source;
    await save(ctx, idx, rec, { ...rec.data, accounts: accs.map((x) => (x === acc ? next : x)) });
    return { ok: true };
  });
}

/** Même compte (toute forme d'écriture) = même fiche ; idempotent : nom existant jamais écrasé, même note de même source jamais doublée. */
export async function upsertByAccount(ctx, a) {
  a = obj(a);
  if (!a || !sourceOk(a.source)) return err("invalid");
  const n = normalizeAccount(a.network, a.handle);
  if (n.error) return err(n.error);
  if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    let cat = null;
    if (a.categoryId !== undefined && a.categoryId !== null) { cat = liveCategory(idx, a.categoryId); if (!cat) return err("not_found"); }
    const key = accountKey(n.network, n.handle);
    const ownerId = idx.byAccount.get(key);
    let rec = ownerId ? await readContact(ctx, ownerId) : null;
    const created = !rec;
    if (!rec) {
      if (full(ctx, idx)) return err("too_many");
      const kind = a.kind ?? "person";
      const data = blankContact({ kind, name: clean(a.name, kind === "org" ? ORG_NAME_MAX : FIELDS.name) || n.handle.slice(0, FIELDS.name), source: a.source });
      attach(idx, null, data, n);
      if (cat) data.categoryIds = [cat];
      rec = await insert(ctx, idx, data);
    } else if (cat) {
      const ids = liveCategoryIds(idx, rec.data.categoryIds);
      if (!ids.includes(cat) && ids.length < LIMITS.categoriesPerContact) rec = await save(ctx, idx, rec, { ...rec.data, categoryIds: [...ids, cat] });
    }
    const text = clean(a.note, LIMITS.note, true);
    if (text) {
      let seen = false;
      for await (const x of allNotes(ctx, rec.id)) if (x.data.text === text && x.data.author === a.source) { seen = true; break; }
      if (!seen) await addNoteTo(ctx, rec.id, text, a.source);
    }
    const acc = accountsOf(rec.data).find((x) => accountKey(x.network, x.handle) === key);
    return { ok: true, created, id: rec.id, accountId: acc.id };
  });
}

/** Ajoute un compte à une fiche (admin, MCP). Erreurs : invalid_network, invalid_handle, not_found, taken (+ id de l'autre fiche), too_many_accounts. */
export async function addAccount(ctx, { id, network, handle }) {
  const n = normalizeAccount(network, handle);
  if (n.error) return err(n.error);
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(id) && idx.byId.has(id) ? await readContact(ctx, id) : null;
    if (!rec) return err("not_found");
    const data = { ...rec.data };
    const r = attach(idx, rec.id, data, n);
    if (r.taken) return err("taken", { id: r.taken });
    if (r.fullAccounts) return err("too_many_accounts");
    if (!r.existed) await save(ctx, idx, rec, data);
    return { ok: true, accountId: r.account.id, existed: !!r.existed, account: accountView(r.account) };
  });
}
export async function removeAccount(ctx, id, accountId) {
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(id) && idx.byId.has(id) ? await readContact(ctx, id) : null;
    const accs = rec ? accountsOf(rec.data) : [];
    if (!accs.some((x) => x.id === accountId)) return err("not_found");
    await save(ctx, idx, rec, { ...rec.data, accounts: accs.filter((x) => x.id !== accountId) });
    return { ok: true };
  });
}
/** Photo choisie à la main (adresse https ; depuis l'admin, aussi une image envoyée sur le site : « /… ») ; `null` = revenir à la photo automatique. */
export async function setManualPhoto(ctx, id, url, { allowLocal = false } = {}) {
  if (url !== null && !httpsUrl(url) && !(allowLocal && typeof url === "string" && url.length <= 500 && /^\/[A-Za-z0-9._~/%-]+(#[\w=.,:-]*)?$/.test(url))) return err("invalid");
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(id) && idx.byId.has(id) ? await readContact(ctx, id) : null;
    if (!rec) return err("not_found");
    await save(ctx, idx, rec, { ...rec.data, photo: url });
    return { ok: true };
  });
}
/** Catégories d'une fiche : remplace la liste par les ids donnés (suivis s'ils ont été fusionnés, ignorés s'ils n'existent pas). */
export async function setCategories(ctx, id, categoryIds) {
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const rec = idOk(id) && idx.byId.has(id) ? await readContact(ctx, id) : null;
    if (!rec) return err("not_found");
    await save(ctx, idx, rec, { ...rec.data, categoryIds: liveCategoryIds(idx, categoryIds).slice(0, LIMITS.categoriesPerContact) });
    return { ok: true };
  });
}

/**
 * Admin : enregistre une fiche (création si `values.id` est vide). E-mail et téléphone seulement si `withContact` (droit « voir les e-mails et téléphones ») :
 * sans ce droit ils ne sont ni lus ni effacés. Erreurs avec `field` (le champ du formulaire concerné).
 */
export async function saveCard(ctx, values, { withContact }) {
  const v = obj(values) ?? {};
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const isNew = !v.id;
    const rec = isNew ? null : idOk(v.id) && idx.byId.has(v.id) ? await readContact(ctx, v.id) : null;
    if (!isNew && !rec) return err("not_found");
    const k = rec ? kindOf(rec.data) : KINDS.includes(v.kind) ? v.kind : "person";
    const name = clean(v.name, k === "org" ? ORG_NAME_MAX : FIELDS.name);
    if (!name) return err("name_required", { field: "name" });
    if (isNew && full(ctx, idx)) return err("too_many");
    const data = rec ? { ...rec.data } : blankContact({ kind: k, name, source: "manual" });
    data.name = name;
    if (withContact) {
      if (v.email !== undefined) {
        const email = clean(v.email, FIELDS.email).toLowerCase();
        if (email && !validEmail(email)) return err("invalid_email", { field: "email" });
        if (email) { const other = await byEmail(ctx, idx, email); if (other && other.id !== rec?.id) return err("email_taken", { field: "email", id: other.id }); }
        data.email = email;
      }
      if (v.phone !== undefined) data.phone = clean(v.phone, FIELDS.phone);
    }
    for (const f of ["role", "relation"]) if (v[f] !== undefined) data[f] = clean(v[f], FIELDS[f]);
    if (STATUSES.includes(v.status)) data.status = v.status;
    if (Array.isArray(v.categoryIds)) data.categoryIds = liveCategoryIds(idx, v.categoryIds).slice(0, LIMITS.categoriesPerContact);
    if (k === "person" && v.organisation !== undefined) {
      const text = clean(v.organisation, ORG_NAME_MAX);
      if (text && !idx.orgByName.has(fold(text)) && full(ctx, idx, isNew ? 2 : 1)) return err("too_many", { field: "organisation" });
      data.orgId = await orgFor(ctx, idx, text);
    }
    const saved = isNew ? await insert(ctx, idx, data) : await save(ctx, idx, rec, data);
    return { ok: true, id: saved.id };
  });
}

/**
 * Ce que la fusion de `drop` dans `keep` ferait, SANS rien écrire (l'aperçu de l'écran de fusion et la fusion elle-même passent par ici : elles ne peuvent pas diverger).
 * Rend { data: les données de la fiche gardée après fusion, filled: [champs complétés], status: bool (« vérifiée » reprise), accounts: [repris], skippedAccounts: [{ account, why }],
 * categories: [ids repris], org: bool (l'organisation de la fiche abandonnée est reprise), members: nombre de personnes de l'organisation qui passent sur la fiche gardée }.
 */
export function planMerge(idx, keep, drop) {
  const k = { ...keep.data }, d = drop.data;
  const filled = [];
  for (const f of ["email", "phone", "role", "others", "relation", "photo"]) if (!k[f] && d[f]) { k[f] = d[f]; filled.push(f); }
  let org = false;
  if (!k.orgId && d.orgId && d.orgId !== keep.id) { k.orgId = d.orgId; org = true; }
  const status = d.status === "active" && k.status !== "active";
  if (d.status === "active") k.status = "active";
  const before = liveCategoryIds(idx, k.categoryIds ?? []);
  k.categoryIds = liveCategoryIds(idx, [...(k.categoryIds ?? []), ...(d.categoryIds ?? [])]).slice(0, LIMITS.categoriesPerContact);
  const categories = k.categoryIds.filter((c) => !before.includes(c));
  const accs = accountsOf(k);
  const taken = [], skippedAccounts = [];
  for (const acc of accountsOf(d)) {
    const key = accountKey(acc.network, acc.handle);
    const owner = idx.byAccount.get(key);
    if (accs.some((x) => accountKey(x.network, x.handle) === key)) continue;
    if (accs.length >= LIMITS.accountsPerContact) { skippedAccounts.push({ account: acc, why: "full" }); continue; }
    if (owner && owner !== keep.id && owner !== drop.id) { skippedAccounts.push({ account: acc, why: "taken" }); continue; }
    accs.push(acc); taken.push(acc);
  }
  k.accounts = accs;
  const members = kindOf(d) === "org" ? idx.list.reduce((n, x) => n + (x.o === drop.id ? 1 : 0), 0) : 0;
  return { data: k, filled, status, accounts: taken, skippedAccounts, categories, org, members };
}

/** Fusion : tout passe sur la fiche gardée (comptes, catégories, notes, champs vides complétés, membres d'organisation), l'ancien id devient « moved ». */
export async function merge(ctx, a) {
  a = obj(a);
  if (!a || !idOk(a.keep) || !idOk(a.drop) || a.keep === a.drop) return err("invalid");
  const done = await withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const keep = idx.byId.has(a.keep) ? await readContact(ctx, a.keep) : null, drop = idx.byId.has(a.drop) ? await readContact(ctx, a.drop) : null;
    if (!keep || !drop) return err("not_found");
    if (kindOf(keep.data) !== kindOf(drop.data)) return err("invalid");
    const plan = planMerge(idx, keep, drop);
    // La fiche abandonnée sort de l'index (ses comptes et son e-mail se libèrent), puis la fiche gardée reçoit tout.
    indexDrop(idx, drop.id);
    await ctx.api.store.remove(drop.id);
    await save(ctx, idx, keep, plan.data);
    const notes = [];
    for await (const n of allNotes(ctx, drop.id)) notes.push(n);
    for (const n of notes) await ctx.api.store.update(n.id, { ...n.data, contactId: keep.id }, { key: keep.id });
    for (const e of idx.list.filter((x) => x.o === drop.id)) {
      const m = await readContact(ctx, e.id);
      if (m) await save(ctx, idx, m, { ...m.data, orgId: keep.id });
    }
    const old = await getByKey(ctx, "moved", drop.id);
    if (old) await ctx.api.store.update(old.id, { from: drop.id, to: keep.id }, { key: drop.id }); else await ctx.api.store.add("moved", { from: drop.id, to: keep.id }, { key: drop.id });
    return { ok: true, id: keep.id, notes: notes.length };
  });
  if (!done.ok) return done;
  const res = await callSubjects(ctx, "remap", { from: a.drop, to: a.keep });
  return { ok: true, id: done.id, notes: done.notes, remapped: res.map(({ module, name, ok }) => ({ module, name, ok })) };
}

/** Effacement : chaque « privacy.subject » efface ses références (borné, muet = listé), PUIS la fiche et ses notes disparaissent. */
export async function erase(ctx, a) {
  a = obj(a);
  if (!a || !idOk(a.id)) return err("invalid");
  const idx = await getIndex(ctx);
  if (!idx.byId.has(a.id)) return err("not_found");
  if (a.confirm !== true) return err("confirm_required");
  const res = await callSubjects(ctx, "erase", { contactId: a.id });
  const r = await deleteContact(ctx, a.id);
  if (!r.ok) return r;
  return { ok: true, modules: res.map(({ module, name, ok, value }) => ({ module, name, ok, ...(ok && Number.isInteger(value?.removed) ? { removed: value.removed } : {}) })) };
}
/** Supprime une fiche et ses notes (sans prévenir les autres modules : voir `erase`). Les personnes d'une organisation supprimée la perdent. */
export async function deleteContact(ctx, id) {
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    if (!idOk(id) || !idx.byId.has(id)) return err("not_found");
    const members = idx.list.filter((x) => x.o === id);
    await ctx.api.store.remove(id);
    indexDrop(idx, id);
    const notes = [];
    for await (const n of allNotes(ctx, id)) notes.push(n.id);
    for (const nid of notes) await ctx.api.store.remove(nid);
    for (const e of members) { const m = await readContact(ctx, e.id); if (m) await save(ctx, idx, m, { ...m.data, orgId: null }); }
    return { ok: true };
  });
}
export async function removeNote(ctx, noteId) {
  if (!idOk(noteId)) return err("not_found");
  const r = await ctx.api.store.get(noteId);
  if (!r || typeof r.data?.text !== "string" || !idOk(r.data?.contactId) || typeof r.data?.date !== "string") return err("not_found");
  await ctx.api.store.remove(noteId);
  return { ok: true, contactId: r.data.contactId };
}

/** Import de lignes (≤ 1 000) : champs de `create` + `accounts`, `categoryIds`, `note`. Rien n'est perdu en silence : chaque refus a son numéro de ligne. */
export async function importRows(ctx, a) {
  a = obj(a);
  if (!a || !Array.isArray(a.rows) || a.rows.length > LIMITS.importRows) return err("invalid");
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    let added = 0, existing = 0;
    const invalid = [];
    for (const [i, raw] of a.rows.entries()) {
      const line = i + 1;
      const row = obj(raw);
      if (!row) { invalid.push({ line, reason: "invalid" }); continue; }
      const accs = Array.isArray(row.accounts) ? row.accounts.slice(0, LIMITS.accountsPerContact).map((x) => normalizeAccount(obj(x)?.network, obj(x)?.handle)) : [];
      const bad = accs.find((x) => x.error);
      if (bad) { invalid.push({ line, reason: bad.error }); continue; }
      if (accs.some((n) => idx.byAccount.has(accountKey(n.network, n.handle)))) { existing++; continue; }
      if (full(ctx, idx)) { invalid.push({ line, reason: "too_many" }); continue; }
      const r = await createLocked(ctx, idx, { ...row, name: row.name || accs[0]?.handle, source: sourceOk(row.source) ? row.source : "import" }, {
        defaultSource: "import",
        extra: (data) => {
          for (const n of accs) attach(idx, null, data, n);
          data.categoryIds = liveCategoryIds(idx, row.categoryIds).slice(0, LIMITS.categoriesPerContact);
        },
      });
      if (!r.ok) { invalid.push({ line, reason: r.error }); continue; }
      if (!r.created) { existing++; continue; }
      added++;
    }
    return { ok: true, added, existing, invalid };
  });
}

// ── Catégories (gestes d'admin) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const catData = (k) => { const { id: _id, ...data } = k; return data; };
export async function renameCategory(ctx, id, label) {
  const l = labelOf(label);
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const k = idx.cats.get(id);
    if (!k || k.movedTo) return err("not_found");
    if (!l) return err("invalid");
    const other = catByLabel(idx, l);
    if (other && other.id !== id) return err("duplicate", { id: other.id });
    const data = { ...catData(k), name: l };
    await ctx.api.store.update(id, data);
    indexPutCategory(idx, { id, data });
    return { ok: true };
  });
}
/** Les fiches qui portent `from` (id stocké tel quel) : réécrites sans lui, avec `to` si donné. */
async function rewriteCategory(ctx, idx, from, to) {
  for (const e of idx.list.filter((x) => (x.c ?? []).includes(from))) {
    const rec = await readContact(ctx, e.id);
    if (!rec) continue;
    const ids = (rec.data.categoryIds ?? []).filter((x) => x !== from);
    if (to && !ids.includes(to)) ids.push(to);
    await save(ctx, idx, rec, { ...rec.data, categoryIds: ids.slice(0, LIMITS.categoriesPerContact) });
  }
}
/** « Mettre dans… » : les fiches de `drop` passent dans `keep` ; l'ancien id de `drop` est suivi (moved). Aucune fiche supprimée. */
export async function mergeCategories(ctx, keepId, dropId) {
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const keep = idx.cats.get(keepId), drop = idx.cats.get(dropId);
    if (!keep || keep.movedTo || !drop || drop.movedTo || keepId === dropId) return err("not_found");
    // La trace de fusion d'abord : une fiche pas encore réécrite suit déjà la catégorie gardée.
    const moved = { ...catData(drop), movedTo: keepId };
    await ctx.api.store.update(dropId, moved);
    indexPutCategory(idx, { id: dropId, data: moved });
    for (const t of [...idx.cats.values()]) if (t.movedTo === dropId) { const d = { ...catData(t), movedTo: keepId }; await ctx.api.store.update(t.id, d); indexPutCategory(idx, { id: t.id, data: d }); }
    await rewriteCategory(ctx, idx, dropId, keepId);
    return { ok: true };
  });
}
/** Supprime une catégorie : elle disparaît des fiches, AUCUNE fiche n'est supprimée. Ses anciens ids (fusions) deviennent « missing ». */
export async function deleteCategory(ctx, id) {
  return withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    const k = idx.cats.get(id);
    if (!k || k.movedTo) return err("not_found");
    await ctx.api.store.remove(id);
    indexDropCategory(idx, id);
    for (const t of [...idx.cats.values()]) if (t.movedTo === id) { await ctx.api.store.remove(t.id); indexDropCategory(idx, t.id); await rewriteCategory(ctx, idx, t.id, null); }
    await rewriteCategory(ctx, idx, id, null);
    return { ok: true };
  });
}

// ── « contact.store » (formulaire de contact) : inchangé depuis la 1.x ────────────────────────────────────────────────────────────────────
export const STORE_SOURCES = ["manual", "contact-form", "agent", "partnerships"];
export async function storeAdd(ctx, a, formNote) {
  a = obj(a) ?? {};
  const name = clean(a.name, FIELDS.name), email = clean(a.email, FIELDS.email).toLowerCase();
  if (!name) throw Object.assign(new Error("name required"), { expose: true });
  const source = STORE_SOURCES.includes(a.source) ? a.source : "manual";
  const r = await withLock(ctx, async () => {
    const idx = await getIndex(ctx);
    let id = null, created = false;
    if (email && validEmail(email)) { const k = await byEmail(ctx, idx, email); if (k) id = k.id; }
    if (!id) {
      if (full(ctx, idx)) return { full: true };
      const data = { ...blankContact({ name, status: "to_review", source }), email: validEmail(email) ? email : "", phone: clean(a.phone, FIELDS.phone) };
      data.orgId = await orgFor(ctx, idx, a.organisation);
      id = (await insert(ctx, idx, data)).id;
      created = true;
    }
    if (a.message) await addNoteTo(ctx, id, `${formNote}\n\n${clean(a.message, LIMITS.note, true)}`, source);
    return { id, created };
  });
  if (r.full) throw Object.assign(new Error("too many contacts"), { expose: true });
  return r;
}

export { byEmail, save, insert, orgFor, addNoteTo, attach, catByLabel, labelOf, getIndex, forgetIndex, readContact, readMany, latestNotes, liveCategories, categoryView, liveCategory };

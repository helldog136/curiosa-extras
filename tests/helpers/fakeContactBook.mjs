// DOUBLE EN MÉMOIRE du service « contact.book » version 2 (Contacts 2.0), plus « contact.store » (formulaire) et l'appel des « privacy.subject ».
// Contrat expliqué : tests/contract/README.md. Suite qui le vérifie : tests/contract/contactBook.contract.mjs (elle passe contre ce double ET contre le vrai module).
//
// Usage dans le test d'un module CONSOMMATEUR (Raid, Story, Partenariats…) :
//
//   import { fakeContactBook } from "./helpers/fakeContactBook.mjs";
//   import { fakeCtx } from "./helpers/fakeCtx.mjs";
//   const book = fakeContactBook();
//   const cat = book.seedCategory("Cible de raid");                                   // aides de préparation (synchrones, sans contrôle de droit)
//   const { id } = book.seedContact({ name: "Alice", accounts: [{ network: "twitch", handle: "alice_tv" }], categoryIds: [cat] });
//   const ctx = fakeCtx({ services: book.services });                                 // ctx.api.services.call("contact.book", "accounts", { network: "twitch" })
//   // Service « each » (privacy.subject) : branchez le consommateur pour que merge / erase l'appellent :
//   book.addPrivacySubject({ instance: "my-module", methods: { export: …, erase: …, remap: … } });
//   // Pannes : book.faults.hang.add("accounts") (ne répond jamais : testez votre attente bornée) ; book.faults.throw.add("search") (le cœur rend « failed »).
//   // Création à la volée d'un « choice » (le cœur appelle createCategory POUR la personne connectée) : book.asViewer(["categories.create"]).createCategory({ label })
//
// Fidélité : mêmes formes, bornes et codes d'erreur que le contrat ; chaque méthode répond { ok: true, … } ou { ok: false, error: "<code>" } et ne lève jamais
// (sauf panne injectée). Les identifiants sont opaques (ne supposez jamais leur forme). Le double ne fait AUCUN appel réseau.

// ── Constantes du contrat ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const NETWORKS = ["twitch", "youtube", "tiktok", "instagram", "discord", "x", "bluesky", "mastodon", "web", "other"];
export const KINDS = ["person", "org"];
export const STATUSES = ["to_review", "active"];
/** Bornes : listes paginées (500), résolutions (100 fiches, 50 catégories), recherche (30 résultats, 100 caractères), import (1 000 lignes). */
export const LIMITS = {
  page: 500, pageDefault: 100, resolve: 100, accountIds: 500, categoriesResolve: 50, search: 30, searchDefault: 10, q: 100, label: 100,
  importRows: 1000, maxContacts: 100_000, accountsPerContact: 20, categoriesPerContact: 50, categories: 500, notesShown: 50, note: 5000,
  cursor: 500, id: 80, privacyMs: 8000, exportBytes: 1_000_000,
};
export const FIELDS = { name: 120, role: 120, email: 200, phone: 60, others: 1000, relation: 300 };
const ORG_NAME_MAX = 200;
/** Ordre de repli de la photo automatique (quand aucun nombre d'abonnés n'est connu), puis les autres réseaux dans l'ordre du registre. */
export const PHOTO_ORDER = ["twitch", "youtube", "bluesky"];
/** Codes d'erreur possibles (toutes méthodes confondues). */
export const ERRORS = ["invalid", "invalid_network", "invalid_handle", "not_found", "name_required", "invalid_email", "email_taken", "text_required", "nothing_to_update", "too_many", "denied", "duplicate", "confirm_required"];
/** Méthodes du service « contact.book » v2 (v1 incluse). Lecture seule : READ_ONLY (déclarées `readOnly` dans le manifeste ; aucun nom avec un point, que le manifeste refuse). */
export const METHODS = ["get", "resolve", "find", "create", "update", "note", "accounts", "search", "list", "categories", "categoriesResolve", "createCategory", "setAccountProfile", "upsertByAccount", "merge", "import", "erase"];
export const READ_ONLY = ["get", "resolve", "find", "accounts", "search", "list", "categories", "categoriesResolve"];
export const RIGHT_CREATE_CATEGORY = "categories.create";

// ── Nettoyage et clés de comparaison ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const clean = (v, max, multiline = false) => {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
};
/** Clé de recherche : sans casse, sans accents, espaces réduits (« Hélène  MARTIN » = « helene martin »). */
export const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
export const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const obj = (a) => (a && typeof a === "object" && !Array.isArray(a) ? a : null);
const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.id;
const sourceOk = (v) => typeof v === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(v);
const httpsUrl = (v) => typeof v === "string" && v.length <= 500 && /^https:\/\/[^\s/?#]+\.[^\s/?#]+(\/[^\s]*)?$/i.test(v);
const err = (error, extra = {}) => ({ ok: false, error, ...extra });
const clampLimit = (v, max, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : def; };

// ── Registre des réseaux : un compte = (réseau, pseudo normalisé). Même compte = même fiche. ─────────────────────────────────────────────────────
const NOT_TWITCH = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const fromUrl = (s, hosts) => {
  const m = new RegExp(`^(?:https?://)?(?:www\\.|m\\.|mobile\\.)?(?:${hosts})/([^?#\\s]*)`, "i").exec(s);
  return m ? dec(m[1]).replace(/\/+$/, "") : null;
};

/**
 * Normalise un compte. Rend { network, handle, url } ou { error: "invalid_network" | "invalid_handle" }.
 *   twitch    pseudo, @pseudo, twitch.tv/pseudo → minuscules, [a-z0-9_]{4,25} (règle du Raid actuel)
 *   youtube   @nom, youtube.com/@nom → « @nom » en minuscules ; youtube.com/channel/UC… → l'identifiant de chaîne tel quel (sensible à la casse)
 *   tiktok    @nom, tiktok.com/@nom → minuscules, [a-z0-9._]{2,24}
 *   instagram nom, @nom, instagram.com/nom → minuscules, [a-z0-9._]{1,30}
 *   x         nom, @nom, x.com/nom, twitter.com/nom → minuscules, [a-z0-9_]{1,15}
 *   bluesky   nom.domaine, @nom.domaine, bsky.app/profile/nom.domaine → minuscules ; un nom sans point devient « nom.bsky.social » ; did:plc:… gardé tel quel
 *   mastodon  @nom@instance, nom@instance, https://instance/@nom → « nom@instance » en minuscules
 *   discord   nom d'utilisateur (minuscules, [a-z0-9_.]{2,32}) ; une invitation discord.gg/CODE → « invite/CODE » (code sensible à la casse)
 *   web       adresse http(s) → https://hôte/chemin (hôte en minuscules, sans www., sans / final ni #…) ; pseudo = hôte/chemin
 *   other     texte libre (200 caractères), comparé sans casse
 */
export function normalizeAccount(network, input) {
  if (!NETWORKS.includes(network)) return { error: "invalid_network" };
  let s = typeof input === "string" ? input.normalize("NFC").trim() : "";
  if (!s || s.length > 300) return { error: "invalid_handle" };
  const ok = (handle, url) => ({ network, handle, url });
  switch (network) {
    case "twitch": {
      const u = fromUrl(s, "twitch\\.tv");
      if (u !== null) s = u.split("/")[0]; else s = s.replace(/^@/, "");
      s = s.toLowerCase();
      return /^[a-z0-9_]{4,25}$/.test(s) && !NOT_TWITCH.has(s) ? ok(s, `https://www.twitch.tv/${s}`) : { error: "invalid_handle" };
    }
    case "youtube": {
      const u = fromUrl(s, "youtube\\.com");
      if (u !== null) {
        const ch = /^channel\/(UC[A-Za-z0-9_-]{22})$/.exec(u);
        if (ch) return ok(ch[1], `https://www.youtube.com/channel/${ch[1]}`);
        s = u.split("/")[0];
        if (!s.startsWith("@")) return { error: "invalid_handle" };
      }
      if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return ok(s, `https://www.youtube.com/channel/${s}`);
      s = `@${s.replace(/^@/, "").toLowerCase()}`;
      return /^@[a-z0-9._-]{3,30}$/.test(s) ? ok(s, `https://www.youtube.com/${s}`) : { error: "invalid_handle" };
    }
    case "tiktok": {
      const u = fromUrl(s, "tiktok\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]{2,24}$/.test(s) ? ok(s, `https://www.tiktok.com/@${s}`) : { error: "invalid_handle" };
    }
    case "instagram": {
      const u = fromUrl(s, "instagram\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9._]{1,30}$/.test(s) ? ok(s, `https://www.instagram.com/${s}`) : { error: "invalid_handle" };
    }
    case "x": {
      const u = fromUrl(s, "x\\.com|twitter\\.com");
      if (u !== null) s = u.split("/")[0];
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9_]{1,15}$/.test(s) ? ok(s, `https://x.com/${s}`) : { error: "invalid_handle" };
    }
    case "bluesky": {
      const u = fromUrl(s, "bsky\\.app");
      if (u !== null) { const m = /^profile\/([^/]+)$/.exec(u); if (!m) return { error: "invalid_handle" }; s = m[1]; }
      s = s.replace(/^@/, "");
      if (/^did:plc:[a-z2-7]{24}$/.test(s)) return ok(s, `https://bsky.app/profile/${s}`);
      s = s.toLowerCase();
      if (!s.includes(".")) s = `${s}.bsky.social`;
      return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(s) ? ok(s, `https://bsky.app/profile/${s}`) : { error: "invalid_handle" };
    }
    case "mastodon": {
      let m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})\/@([a-z0-9_]{1,30})\/?$/i.exec(s);
      let user, host;
      if (m) [user, host] = [m[2], m[1]];
      else { m = /^@?([a-z0-9_]{1,30})@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(s); if (!m) return { error: "invalid_handle" }; [user, host] = [m[1], m[2]]; }
      user = user.toLowerCase(); host = host.toLowerCase();
      return ok(`${user}@${host}`, `https://${host}/@${user}`);
    }
    case "discord": {
      const inv = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,32})\/?$/.exec(s);
      if (inv) return ok(`invite/${inv[1]}`, `https://discord.gg/${inv[1]}`);
      s = s.replace(/^@/, "").toLowerCase();
      return /^[a-z0-9_.]{2,32}$/.test(s) ? ok(s, null) : { error: "invalid_handle" };
    }
    case "web": {
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      let u;
      try { u = new URL(s); } catch { return { error: "invalid_handle" }; }
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return { error: "invalid_handle" };
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "");
      const handle = `${host}${path}${u.search}`;
      return handle.length <= 200 ? ok(handle, `https://${handle}`) : { error: "invalid_handle" };
    }
    default: { // other
      const t = clean(s, 200);
      return t ? ok(t, null) : { error: "invalid_handle" };
    }
  }
}
const accountKey = (network, handle) => `${network}:${network === "other" ? fold(handle) : handle}`;

// ── Photo : manuelle > compte à la plus grosse communauté (abonnés en cache daté) > Twitch > YouTube > Bluesky > autres réseaux ─────────────────────
/** Règle PURE, sans réseau : `contact` = { photo?: url manuelle, accounts: [{ id, network, avatar?, followers? }] }. Rend { url, source, accountId? } ou null. */
export function pickPhoto(contact) {
  if (contact?.photo) return { url: contact.photo, source: "manual" };
  const withAvatar = (contact?.accounts ?? []).filter((a) => a.avatar);
  if (!withAvatar.length) return null;
  const rank = (a) => { const i = PHOTO_ORDER.indexOf(a.network); return i >= 0 ? i : PHOTO_ORDER.length + NETWORKS.indexOf(a.network); };
  const counted = withAvatar.filter((a) => Number.isInteger(a.followers));
  const pool = counted.length ? counted : withAvatar;
  const best = [...pool].sort((a, b) => (counted.length ? b.followers - a.followers : 0) || rank(a) - rank(b))[0];
  return { url: best.avatar, source: best.network, accountId: best.id };
}

// ── Curseurs opaques ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const decCursor = (c, tag) => {
  if (c === undefined || c === null || c === "") return { start: true };
  if (typeof c !== "string" || c.length > LIMITS.cursor) return { bad: true };
  try { const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8")); return Array.isArray(v) && v[0] === tag ? { at: v } : { bad: true }; } catch { return { bad: true }; }
};
const PALETTE = ["#e8a23b", "#4f9dde", "#58b368", "#d1556b", "#9b6bd1", "#3bb3a8", "#c9853a", "#7a8794"];

/**
 * Crée un carnet vide. Options :
 *   rights            droits de la personne pour qui l'appel est fait (défaut [] : un appel de service ordinaire n'a AUCUN droit en cœur 0.2.0 ; voir asViewer)
 *   privacySubjects   fournisseurs « privacy.subject » : [{ instance, name?, methods: { export, erase, remap } }] (aussi : addPrivacySubject)
 *   privacyTimeoutMs  attente maximale par fournisseur (défaut 8 000 ms, contrat 11.4)
 *   maxContacts       plafond du carnet (défaut 100 000)
 *   now               horloge () => Date (défaut : l'heure réelle)
 */
export function fakeContactBook(opts = {}) {
  const limits = { ...LIMITS, maxContacts: opts.maxContacts ?? LIMITS.maxContacts, privacyMs: opts.privacyTimeoutMs ?? LIMITS.privacyMs };
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  const contacts = new Map();      // id → fiche (ordre d'insertion = ordre de création)
  const byAccount = new Map();     // clé de compte → id de fiche
  const movedContacts = new Map(); // id fusionné → id gardé (chaînes repliées)
  const categories = new Map();    // id → { id, name, color, icon }
  const movedCats = new Map();     // id fusionné → id gardé
  const privacy = [...(opts.privacySubjects ?? [])];
  const calls = [];
  const faults = { hang: new Set(), throw: new Set() };
  const next = (p) => `${p}${(++seq).toString(36).padStart(4, "0")}`;

  // ── lectures internes ──
  const orgOf = (c) => (c.orgId ? contacts.get(c.orgId) ?? null : null);
  const accountView = (a) => ({ id: a.id, network: a.network, handle: a.handle, url: a.url, ...(a.displayName ? { displayName: a.displayName } : {}), ...(a.avatar ? { avatar: a.avatar } : {}), ...(Number.isInteger(a.followers) ? { followers: a.followers } : {}), ...(a.profileAt ? { profileAt: a.profileAt } : {}) });
  const card = (c) => {
    const org = orgOf(c);
    return {
      id: c.id, kind: c.kind, name: c.name, role: c.role || null, organisation: org ? org.name : null, orgId: org ? org.id : null, orgName: org ? org.name : null,
      email: c.email || null, phone: c.phone || null, status: c.status, source: c.source, createdAt: c.createdAt.toISOString(),
      categoryIds: [...c.categoryIds], accounts: c.accounts.map(accountView), photo: pickPhoto(c), adminPath: `/admin/instances/id-contacts?contact=${c.id}`,
    };
  };
  const finalCat = (id) => { let cur = id, n = 0; while (movedCats.has(cur) && n++ < 1000) cur = movedCats.get(cur); return cur; };
  const catLookup = (id) => { if (!idOk(id)) return null; const f = finalCat(id); return categories.has(f) ? f : null; };
  const catView = (c) => ({ id: c.id, label: c.name, name: c.name, color: c.color, icon: c.icon });
  const nameKeyTaken = (key, exceptOrg) => [...contacts.values()].find((c) => c.kind === "org" && fold(c.name) === key && c.id !== exceptOrg);
  const full = () => contacts.size >= limits.maxContacts;

  // ── écritures internes ──
  function insert({ kind = "person", name, status = "active", source = "manual", email = "", phone = "", role = "", others = "", relation = "", orgId = null, photo = null }) {
    const id = next("c");
    const c = { id, kind, name, status, source, email, phone, role, others, relation, orgId, photo, categoryIds: [], accounts: [], notes: [], createdAt: new Date(now().getTime() + seq), seq };
    contacts.set(id, c);
    return c;
  }
  function attachAccount(c, n) {
    const key = accountKey(n.network, n.handle);
    const owner = byAccount.get(key);
    if (owner) return owner === c.id ? c.accounts.find((a) => accountKey(a.network, a.handle) === key) : null;
    if (c.accounts.length >= LIMITS.accountsPerContact) return null;
    const a = { id: next("a"), network: n.network, handle: n.handle, url: n.url, seq };
    c.accounts.push(a);
    byAccount.set(key, c.id);
    return a;
  }
  function addCategoryTo(c, catId) { if (!c.categoryIds.includes(catId) && c.categoryIds.length < LIMITS.categoriesPerContact) c.categoryIds.push(catId); }
  function addNote(c, text, author) {
    const t = clean(text, LIMITS.note, true);
    if (!t) return false;
    c.notes.push({ date: now().toISOString().slice(0, 10), author: clean(author, 60) || "module", text: t, seq: ++seq });
    return true;
  }
  /** Trouve ou crée la fiche organisation d'un texte (alias v1 « organisation »). "" → null. */
  function orgFor(text) {
    const name = clean(text, ORG_NAME_MAX);
    if (!name) return null;
    const known = nameKeyTaken(fold(name));
    if (known) return known.id;
    if (full()) return null;
    return insert({ kind: "org", name, status: "active", source: "manual" }).id;
  }
  function removeContact(id) {
    const c = contacts.get(id);
    if (!c) return;
    for (const a of c.accounts) byAccount.delete(accountKey(a.network, a.handle));
    contacts.delete(id);
    for (const other of contacts.values()) if (other.orgId === id) other.orgId = null;
    for (const [from, to] of movedContacts) if (to === id || from === id) movedContacts.delete(from);
  }
  function newCategory(label, { color, icon } = {}) {
    const id = next("k");
    categories.set(id, { id, name: label, color: /^#[0-9a-f]{6}$/i.test(color ?? "") ? color.toLowerCase() : PALETTE[categories.size % PALETTE.length], icon: typeof icon === "string" && icon.trim() && [...icon.trim()].length <= 4 ? icon.trim() : null });
    return id;
  }
  const catByLabel = (label) => [...categories.values()].find((k) => fold(k.name) === fold(label));
  const labelOf = (v) => { if (typeof v !== "string") return null; const l = v.replace(/\s+/g, " ").trim(); return l && l.length <= LIMITS.label ? l : null; };

  // Appel borné d'un fournisseur « privacy.subject » (un par un : un fournisseur muet ne retarde pas les autres au-delà de sa propre borne).
  async function callSubjects(method, args) {
    return Promise.all(privacy.map(async (p) => {
      const fn = p.methods?.[method];
      const module = p.instance;
      if (typeof fn !== "function") return { module, ok: false };
      let timer;
      const late = new Promise((r) => { timer = setTimeout(() => r({ module, ok: false, timeout: true }), limits.privacyMs); });
      try {
        return await Promise.race([Promise.resolve().then(() => fn(args)).then((value) => ({ module, ok: true, value }), () => ({ module, ok: false })), late]);
      } finally { clearTimeout(timer); }
    }));
  }

  // Pagination par curseur sur une liste déjà triée ; `keyOf(item)` = tuple comparable, `tag` = nom de la méthode (un curseur d'une autre méthode est illisible).
  function paginate(list, keyOf, tag, cursor, limit) {
    const c = decCursor(cursor, tag);
    if (c.bad) return { items: [], next: null };
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
    const from = c.start ? 0 : list.findIndex((x) => cmp(keyOf(x), c.at.slice(1)) > 0);
    if (from < 0) return { items: [], next: null };
    const items = list.slice(from, from + limit);
    const more = from + limit < list.length;
    return { items, next: more ? enc([tag, ...keyOf(items[items.length - 1])]) : null };
  }

  // ── Le service « contact.book » : méthodes (args, viewerRights) ──
  const book = {
    async get(a) {
      a = obj(a);
      const c = a && idOk(a.id) ? contacts.get(a.id) : null;
      if (!c) return a && movedContacts.has(a.id) ? err("not_found", { movedTo: movedContacts.get(a.id) }) : err("not_found");
      const notes = [...c.notes].sort((x, y) => y.date.localeCompare(x.date) || y.seq - x.seq).slice(0, LIMITS.notesShown).map(({ date, author, text }) => ({ date, author, text }));
      return { ok: true, contact: { ...card(c), others: c.others || null, relation: c.relation || null, notes } };
    },
    async resolve(a) {
      a = obj(a);
      if (!a || !Array.isArray(a.ids) || a.ids.length > LIMITS.resolve) return err("invalid");
      const ids = [...new Set(a.ids.filter(idOk))];
      const moved = {};
      for (const id of ids) if (!contacts.has(id) && movedContacts.has(id)) moved[id] = movedContacts.get(id);
      return { ok: true, contacts: ids.filter((id) => contacts.has(id)).map((id) => card(contacts.get(id))), missing: ids.filter((id) => !contacts.has(id) && !(id in moved)), moved };
    },
    async find(a) {
      a = obj(a) ?? {};
      const email = clean(a.email, FIELDS.email).toLowerCase();
      if (email && !validEmail(email)) return err("invalid_email");
      const q = fold(clean(a.q, 400)), name = fold(clean(a.name, 400)), org = fold(clean(a.organisation, 400));
      const limit = clampLimit(a.limit, 100, 20);
      const found = [...contacts.values()].filter((c) => {
        const orgName = orgOf(c)?.name ?? "";
        return (!email || c.email === email) && (!name || fold(c.name) === name) && (!org || fold(orgName) === org) && (!q || [c.name, orgName, c.email].some((x) => fold(x).includes(q)));
      });
      return { ok: true, total: found.length, contacts: found.slice(0, limit).map(card) };
    },
    async create(a) {
      a = obj(a) ?? {};
      const kind = KINDS.includes(a.kind) ? a.kind : "person";
      const name = clean(a.name, kind === "org" ? ORG_NAME_MAX : FIELDS.name);
      if (!name) return err("name_required");
      const email = clean(a.email, FIELDS.email).toLowerCase();
      if (email && !validEmail(email)) return err("invalid_email");
      const all = [...contacts.values()];
      let known;
      if (email) known = all.find((c) => c.email === email);
      else if (kind === "org") known = nameKeyTaken(fold(name));
      else {
        const orgKey = fold(clean(a.organisation, ORG_NAME_MAX));
        known = all.find((c) => c.kind === "person" && fold(c.name) === fold(name) && fold(orgOf(c)?.name ?? "") === orgKey);
      }
      if (known) return { ok: true, id: known.id, created: false, matchedBy: email ? "email" : kind === "org" ? "name" : "name+organisation", contact: card(known) };
      if (full()) return err("too_many");
      const source = sourceOk(a.source) ? a.source : "partnerships";
      const c = insert({
        kind, name, email, status: STATUSES.includes(a.status) ? a.status : "active", source,
        role: clean(a.role, FIELDS.role), phone: clean(a.phone, FIELDS.phone), others: clean(a.others, FIELDS.others, true), relation: clean(a.relation, FIELDS.relation),
      });
      if (kind === "person") c.orgId = orgFor(a.organisation);
      if (a.note) addNote(c, a.note, source);
      return { ok: true, id: c.id, created: true, contact: card(c) };
    },
    async update(a) {
      a = obj(a) ?? {};
      const c = idOk(a.id) ? contacts.get(a.id) : null;
      if (!c) return err("not_found");
      const keys = [...Object.keys(FIELDS), "organisation", "status"].filter((k) => a[k] !== undefined);
      if (!keys.length) return err("nothing_to_update");
      if (a.name !== undefined && !clean(a.name, FIELDS.name)) return err("name_required");
      let email;
      if (a.email !== undefined) {
        email = clean(a.email, FIELDS.email).toLowerCase();
        if (email && !validEmail(email)) return err("invalid_email");
        const other = email && [...contacts.values()].find((x) => x.id !== c.id && x.email === email);
        if (other) return err("email_taken", { id: other.id });
      }
      for (const k of Object.keys(FIELDS)) if (a[k] !== undefined) c[k] = k === "email" ? email : clean(a[k], k === "name" && c.kind === "org" ? ORG_NAME_MAX : FIELDS[k], k === "others");
      if (a.organisation !== undefined && c.kind === "person") c.orgId = orgFor(a.organisation);
      if (STATUSES.includes(a.status)) c.status = a.status;
      return { ok: true, contact: card(c) };
    },
    async note(a) {
      a = obj(a) ?? {};
      const c = idOk(a.id) ? contacts.get(a.id) : null;
      if (!c) return err("not_found");
      if (!clean(a.text, LIMITS.note)) return err("text_required");
      addNote(c, a.text, a.author);
      return { ok: true, id: c.id };
    },

    // ── v2 ──
    async accounts(a) {
      a = obj(a);
      if (!a) return err("invalid");
      if (!NETWORKS.includes(a.network)) return err("invalid_network");
      if (a.ids !== undefined && (!Array.isArray(a.ids) || a.ids.length > LIMITS.accountIds)) return err("invalid");
      let cat = null;
      if (a.categoryId !== undefined && a.categoryId !== null) { cat = catLookup(a.categoryId); if (!cat) return err("not_found"); }
      const only = a.ids ? new Set(a.ids.filter(idOk)) : null;
      const rows = [];
      for (const c of contacts.values()) {
        if (only && !only.has(c.id)) continue;
        if (cat && !c.categoryIds.includes(cat)) continue;
        for (const acc of [...c.accounts].sort((x, y) => x.seq - y.seq)) if (acc.network === a.network) rows.push({ c, acc });
      }
      const page = paginate(rows, (r) => [r.c.seq, r.acc.seq], "accounts", a.cursor, clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault));
      return {
        ok: true,
        items: page.items.map(({ c, acc }) => ({ id: c.id, accountId: acc.id, name: c.name, handle: acc.handle, url: acc.url, ...(acc.displayName ? { displayName: acc.displayName } : {}), ...(acc.avatar ? { avatar: acc.avatar } : {}), ...(Number.isInteger(acc.followers) ? { followers: acc.followers } : {}) })),
        next: page.next,
      };
    },
    async search(a) {
      a = obj(a);
      if (!a) return err("invalid");
      if (a.network !== undefined && !NETWORKS.includes(a.network)) return err("invalid_network");
      if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
      const q = fold(clean(a.q, LIMITS.q)).replace(/^@/, "");
      const limit = clampLimit(a.limit, LIMITS.search, LIMITS.searchDefault);
      if (!q) return { ok: true, items: [] };
      const scored = [];
      for (const c of contacts.values()) {
        if (a.kind && c.kind !== a.kind) continue;
        const accs = a.network ? c.accounts.filter((x) => x.network === a.network) : c.accounts;
        if (a.network && !accs.length) continue;
        const texts = [c.name, ...c.accounts.flatMap((x) => [x.handle, x.displayName ?? ""]), orgOf(c)?.name ?? ""].map(fold);
        const score = texts.some((t) => t === q) ? 0 : texts.some((t) => t.startsWith(q) || t.split(/[\s._@-]/).some((w) => w.startsWith(q))) ? 1 : texts.some((t) => t.includes(q)) ? 2 : -1;
        if (score >= 0) scored.push({ c, accs, score });
      }
      scored.sort((x, y) => x.score - y.score || fold(x.c.name).localeCompare(fold(y.c.name)) || x.c.seq - y.c.seq);
      return { ok: true, items: scored.slice(0, limit).map(({ c, accs }) => ({ id: c.id, name: c.name, kind: c.kind, accounts: accs.map((x) => ({ network: x.network, handle: x.handle, ...(x.displayName ? { displayName: x.displayName } : {}) })) })) };
    },
    async list(a) {
      a = obj(a) ?? {};
      if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
      let cat = null;
      if (a.categoryId !== undefined && a.categoryId !== null) { cat = catLookup(a.categoryId); if (!cat) return err("not_found"); }
      if (a.orgId !== undefined && !idOk(a.orgId)) return err("invalid");
      const rows = [...contacts.values()].filter((c) => (!cat || c.categoryIds.includes(cat)) && (!a.kind || c.kind === a.kind) && (!a.orgId || c.orgId === a.orgId));
      const page = paginate(rows, (c) => [c.seq], "list", a.cursor, clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault));
      return { ok: true, items: page.items.map(card), next: page.next };
    },
    async categories(a) {
      a = obj(a) ?? {};
      const q = fold(typeof a.q === "string" ? a.q.slice(0, LIMITS.q) : "");
      const rows = [...categories.values()].filter((k) => !q || fold(k.name).includes(q)).sort((x, y) => fold(x.name).localeCompare(fold(y.name)) || (x.id < y.id ? -1 : 1));
      const page = paginate(rows, (k) => [fold(k.name), k.id], "categories", a.cursor, clampLimit(a.limit, LIMITS.page, LIMITS.pageDefault));
      return { ok: true, items: page.items.map(catView), next: page.next };
    },
    async categoriesResolve(a) {
      a = obj(a);
      if (!a || !Array.isArray(a.ids) || a.ids.length > LIMITS.categoriesResolve) return err("invalid");
      const ids = [...new Set(a.ids.filter(idOk))];
      const items = [], moved = {}, missing = [];
      for (const id of ids) {
        if (categories.has(id)) { items.push(catView(categories.get(id))); continue; }
        const to = catLookup(id);
        if (to) moved[id] = to; else missing.push(id);
      }
      return { ok: true, items, moved, missing };
    },
    async createCategory(a, rights) {
      if (!rights.includes(RIGHT_CREATE_CATEGORY)) return err("denied");
      a = obj(a);
      const label = labelOf(a?.label);
      if (!label) return err("invalid");
      const known = catByLabel(label);
      if (known) return err("duplicate", { id: known.id });
      if (categories.size >= LIMITS.categories) return err("too_many");
      const id = newCategory(label, a);
      return { ok: true, id, label };
    },
    async setAccountProfile(a) {
      a = obj(a);
      if (!a || !sourceOk(a.source)) return err("invalid");
      const at = typeof a.at === "string" ? Date.parse(a.at) : NaN;
      if (Number.isNaN(at) || at > now().getTime() + 5 * 60_000) return err("invalid");
      if (a.avatar !== undefined && a.avatar !== null && !httpsUrl(a.avatar)) return err("invalid");
      if (a.followers !== undefined && a.followers !== null && !(Number.isInteger(a.followers) && a.followers >= 0 && a.followers <= 1e10)) return err("invalid");
      const c = idOk(a.id) ? contacts.get(a.id) : null;
      const acc = c && idOk(a.accountId) ? c.accounts.find((x) => x.id === a.accountId) : null;
      if (!acc) return err("not_found");
      if (acc.profileAt && Date.parse(acc.profileAt) > at) return { ok: true, stale: true };
      if (a.displayName !== undefined) acc.displayName = clean(a.displayName, FIELDS.name) || undefined;
      if (a.avatar !== undefined) acc.avatar = a.avatar || undefined;
      if (a.followers !== undefined) acc.followers = a.followers ?? undefined;
      acc.profileAt = new Date(at).toISOString();
      acc.profileSource = a.source;
      return { ok: true };
    },
    async upsertByAccount(a) {
      a = obj(a);
      if (!a || !sourceOk(a.source)) return err("invalid");
      const n = normalizeAccount(a.network, a.handle);
      if (n.error) return err(n.error);
      let cat = null;
      if (a.categoryId !== undefined && a.categoryId !== null) { cat = catLookup(a.categoryId); if (!cat) return err("not_found"); }
      if (a.kind !== undefined && !KINDS.includes(a.kind)) return err("invalid");
      const ownerId = byAccount.get(accountKey(n.network, n.handle));
      let c = ownerId ? contacts.get(ownerId) : null;
      const created = !c;
      if (!c) {
        if (full()) return err("too_many");
        const kind = a.kind ?? "person";
        c = insert({ kind, name: clean(a.name, kind === "org" ? ORG_NAME_MAX : FIELDS.name) || n.handle.slice(0, FIELDS.name), status: "active", source: a.source });
        attachAccount(c, n);
      }
      if (cat) addCategoryTo(c, cat);
      const note = clean(a.note, LIMITS.note, true);
      if (note && !c.notes.some((x) => x.text === note && x.author === a.source)) addNote(c, note, a.source);
      const acc = c.accounts.find((x) => accountKey(x.network, x.handle) === accountKey(n.network, n.handle));
      return { ok: true, created, id: c.id, accountId: acc.id };
    },
    async merge(a) {
      a = obj(a);
      if (!a || !idOk(a.keep) || !idOk(a.drop) || a.keep === a.drop) return err("invalid");
      const keep = contacts.get(a.keep), drop = contacts.get(a.drop);
      if (!keep || !drop) return err("not_found");
      if (keep.kind !== drop.kind) return err("invalid");
      for (const k of ["email", "phone", "role", "others", "relation", "photo"]) if (!keep[k] && drop[k]) keep[k] = drop[k];
      if (!keep.orgId && drop.orgId && drop.orgId !== keep.id) keep.orgId = drop.orgId;
      if (drop.status === "active") keep.status = "active";
      for (const k of drop.categoryIds) addCategoryTo(keep, k);
      const moving = drop.accounts;
      for (const acc of moving) byAccount.delete(accountKey(acc.network, acc.handle));
      drop.accounts = [];
      for (const acc of moving) {
        const key = accountKey(acc.network, acc.handle);
        if (byAccount.has(key) || keep.accounts.length >= LIMITS.accountsPerContact) continue;
        keep.accounts.push(acc);
        byAccount.set(key, keep.id);
      }
      keep.notes.push(...drop.notes);
      for (const other of contacts.values()) if (other.orgId === drop.id) other.orgId = keep.id;
      for (const [from, to] of [...movedContacts]) if (to === drop.id) movedContacts.set(from, keep.id);
      removeContact(drop.id);
      movedContacts.set(drop.id, keep.id);
      const res = await callSubjects("remap", { from: drop.id, to: keep.id });
      return { ok: true, id: keep.id, remapped: res.map(({ module, ok }) => ({ module, ok })) };
    },
    async import(a) {
      a = obj(a);
      if (!a || !Array.isArray(a.rows) || a.rows.length > LIMITS.importRows) return err("invalid");
      let added = 0, existing = 0;
      const invalid = [];
      for (const [i, raw] of a.rows.entries()) {
        const line = i + 1;
        const row = obj(raw);
        if (!row) { invalid.push({ line, reason: "invalid" }); continue; }
        const accs = Array.isArray(row.accounts) ? row.accounts.slice(0, LIMITS.accountsPerContact).map((x) => normalizeAccount(obj(x)?.network, obj(x)?.handle)) : [];
        const bad = accs.find((x) => x.error);
        if (bad) { invalid.push({ line, reason: bad.error }); continue; }
        if (accs.some((n) => byAccount.has(accountKey(n.network, n.handle)))) { existing++; continue; }
        if (full()) { invalid.push({ line, reason: "too_many" }); continue; }
        const r = await book.create({ ...row, name: row.name || accs[0]?.handle, source: sourceOk(row.source) ? row.source : "import", note: row.note });
        if (!r.ok) { invalid.push({ line, reason: r.error }); continue; }
        if (!r.created) { existing++; continue; }
        const c = contacts.get(r.id);
        for (const n of accs) attachAccount(c, n);
        for (const k of Array.isArray(row.categoryIds) ? row.categoryIds : []) { const f = catLookup(k); if (f) addCategoryTo(c, f); }
        added++;
      }
      return { ok: true, added, existing, invalid };
    },
    async erase(a) {
      a = obj(a);
      if (!a || !idOk(a.id)) return err("invalid");
      if (!contacts.has(a.id)) return err("not_found");
      if (a.confirm !== true) return err("confirm_required");
      const res = await callSubjects("erase", { contactId: a.id });
      removeContact(a.id);
      return { ok: true, modules: res.map(({ module, ok, value }) => ({ module, ok, ...(ok && Number.isInteger(value?.removed) ? { removed: value.removed } : {}) })) };
    },
  };

  // ── « contact.store » (formulaire de contact) : inchangé ──
  const store = {
    async add(a) {
      a = obj(a) ?? {};
      const name = clean(a.name, FIELDS.name), email = clean(a.email, FIELDS.email).toLowerCase();
      if (!name) throw Object.assign(new Error("name required"), { expose: true });
      const source = ["manual", "contact-form", "agent", "partnerships"].includes(a.source) ? a.source : "manual";
      const known = email && validEmail(email) ? [...contacts.values()].find((c) => c.email === email) : null;
      let c = known, created = false;
      if (!c) {
        if (full()) throw Object.assign(new Error("too many contacts"), { expose: true });
        c = insert({ name, email: validEmail(email) ? email : "", status: "to_review", source, phone: clean(a.phone, FIELDS.phone) });
        c.orgId = orgFor(a.organisation);
        created = true;
      }
      if (a.message) addNote(c, `Message from the contact form\n\n${clean(a.message, LIMITS.note, true)}`, source);
      return { id: c.id, created };
    },
  };

  // Enveloppe : journal des appels, pannes injectées (hang = jamais de réponse ; throw = exception, que le cœur traduit en « failed »).
  const wrap = (service, name, fn) => async (args) => {
    calls.push([service, name, structuredClone(args ?? null)]);
    if (faults.hang.has(name)) return new Promise(() => {});
    if (faults.throw.has(name)) throw new Error(`fault injected in ${name}`);
    return fn(args);
  };
  const methodsFor = (rights) => Object.fromEntries(Object.entries(book).map(([n, fn]) => [n, wrap("contact.book", n, (args) => fn(args, rights))]));
  const state = { rights: [...(opts.rights ?? [])] };
  const bookMethods = Object.fromEntries(METHODS.map((n) => [n, (args) => methodsFor(state.rights)[n](args)]));
  const storeMethods = { add: wrap("contact.store", "add", store.add) };

  return {
    /** À passer tel quel à fakeCtx({ services }) : { "contact.book": {…}, "contact.store": {…} }. */
    services: { "contact.book": bookMethods, "contact.store": storeMethods },
    /** Les méthodes de « contact.book » (args) => réponse. */
    methods: bookMethods,
    /** Les méthodes appelées POUR une personne de l'admin qui a ces droits (création à la volée d'un « choice ») : asViewer(["categories.create"]). */
    asViewer: (rights = []) => methodsFor([...rights]),
    /** Droits par défaut des appels (modifiable : book.rights = ["categories.create"]). */
    get rights() { return state.rights; },
    set rights(v) { state.rights = [...v]; },
    calls,
    faults,
    limits,
    addPrivacySubject: (p) => { privacy.push(p); },

    // ── Aides de préparation des tests (SYNCHRONES, sans contrôle de droit ; jamais exposées comme service) ──
    /** Une fiche : { kind?, name, email?, phone?, role?, organisation?, status?, source?, accounts?: [{ network, handle, displayName?, avatar?, followers? }], categoryIds?, photo? }. Rend { id, accountIds }. */
    seedContact(input) {
      const kind = input.kind ?? "person";
      const c = insert({ kind, name: clean(input.name, kind === "org" ? ORG_NAME_MAX : FIELDS.name) || "?", status: input.status ?? "active", source: input.source ?? "manual", email: (input.email ?? "").toLowerCase(), phone: input.phone ?? "", role: input.role ?? "", photo: input.photo ?? null });
      if (input.organisation) c.orgId = orgFor(input.organisation);
      const accountIds = [];
      for (const x of input.accounts ?? []) {
        const n = normalizeAccount(x.network, x.handle);
        if (n.error) throw new Error(`seedContact: ${x.network} « ${x.handle} » : ${n.error}`);
        const acc = attachAccount(c, n);
        if (!acc) throw new Error(`seedContact: compte déjà porté par une autre fiche : ${x.network} « ${x.handle} »`);
        for (const k of ["displayName", "avatar", "followers"]) if (x[k] !== undefined) acc[k] = x[k];
        if (x.displayName || x.avatar || x.followers !== undefined) acc.profileAt = now().toISOString();
        accountIds.push(acc.id);
      }
      for (const k of input.categoryIds ?? []) { const f = catLookup(k); if (!f) throw new Error(`seedContact: catégorie inconnue ${k}`); addCategoryTo(c, f); }
      return { id: c.id, accountIds };
    },
    seedCategory(label, extra = {}) { const known = catByLabel(label); return known ? known.id : newCategory(label, extra); },

    // ── Gestes de l'ADMIN de Contacts (pas des méthodes de service) : la suite de contrat s'en sert pour préparer les cas ──
    admin: {
      renameCategory(id, label) { const k = categories.get(id); const l = labelOf(label); if (!k) return err("not_found"); if (!l) return err("invalid"); const other = catByLabel(l); if (other && other.id !== id) return err("duplicate", { id: other.id }); k.name = l; return { ok: true }; },
      mergeCategories(keepId, dropId) {
        if (!categories.has(keepId) || !categories.has(dropId) || keepId === dropId) return err("not_found");
        for (const c of contacts.values()) if (c.categoryIds.includes(dropId)) { c.categoryIds = c.categoryIds.filter((x) => x !== dropId); addCategoryTo(c, keepId); }
        categories.delete(dropId);
        for (const [from, to] of movedCats) if (to === dropId) movedCats.set(from, keepId);
        movedCats.set(dropId, keepId);
        return { ok: true };
      },
      deleteCategory(id) {
        if (!categories.has(id)) return err("not_found");
        categories.delete(id);
        for (const c of contacts.values()) c.categoryIds = c.categoryIds.filter((x) => x !== id);
        for (const [from, to] of movedCats) if (to === id) movedCats.delete(from);
        return { ok: true };
      },
      setManualPhoto(id, url) { const c = contacts.get(id); if (!c) return err("not_found"); if (url !== null && !httpsUrl(url)) return err("invalid"); c.photo = url; return { ok: true }; },
      setCategories(id, categoryIds) { const c = contacts.get(id); if (!c) return err("not_found"); c.categoryIds = []; for (const k of categoryIds) { const f = catLookup(k); if (f) addCategoryTo(c, f); } return { ok: true }; },
      removeAccount(id, accountId) { const c = contacts.get(id); const acc = c?.accounts.find((x) => x.id === accountId); if (!acc) return err("not_found"); c.accounts = c.accounts.filter((x) => x !== acc); byAccount.delete(accountKey(acc.network, acc.handle)); return { ok: true }; },
      deleteContact(id) { if (!contacts.has(id)) return err("not_found"); removeContact(id); return { ok: true }; },
    },

    /** Lecture directe pour les assertions (copie). */
    dump: () => ({ contacts: [...contacts.values()].map((c) => structuredClone({ ...c, photo: c.photo })), categories: [...categories.values()].map((k) => ({ ...k })), movedContacts: Object.fromEntries(movedContacts), movedCategories: Object.fromEntries(movedCats) }),
  };
}

// ── Côté CONSOMMATEUR : un faux fournisseur « privacy.subject » pour les tests, et la vérification de forme des réponses ─────────────────────────
/**
 * Un module qui garde des RÉFÉRENCES à des fiches (ids) : export / erase / remap conformes au contrat 11.4. `refs` : Map contactId → nombre de références.
 *   const sub = fakePrivacySubject("my-module"); sub.refs.set(id, 2); book.addPrivacySubject(sub);
 */
export function fakePrivacySubject(instance = "consumer", { name = instance } = {}) {
  const refs = new Map();
  const seen = [];
  return {
    instance, name, refs, seen,
    methods: {
      async export(a) { const id = idOk(a?.contactId) ? a.contactId : null; seen.push(["export", id]); return { label: name, data: { references: id ? refs.get(id) ?? 0 : 0 } }; },
      async erase(a) { const id = idOk(a?.contactId) ? a.contactId : null; seen.push(["erase", id]); const n = id ? refs.get(id) ?? 0 : 0; if (id) refs.delete(id); return { removed: n }; },
      async remap(a) {
        const from = idOk(a?.from) ? a.from : null, to = idOk(a?.to) ? a.to : null;
        seen.push(["remap", from, to]);
        if (!from || !to || from === to) return { updated: 0 };
        const n = refs.get(from) ?? 0;
        if (n) { refs.set(to, (refs.get(to) ?? 0) + n); refs.delete(from); }
        return { updated: n };
      },
    },
  };
}

/** Problèmes de forme d'une réponse de « privacy.subject » (liste vide = conforme). method : "export" | "erase" | "remap". */
export function privacyReplyProblems(method, value) {
  const o = obj(value);
  if (!o) return ["réponse : objet attendu"];
  if (method === "export") {
    const p = [];
    if (typeof o.label !== "string" || !o.label.trim() || o.label.length > 200) p.push("export.label : texte non vide (≤ 200) attendu");
    if (!("data" in o)) p.push("export.data : absent");
    else { let size = Infinity; try { size = Buffer.byteLength(JSON.stringify(o.data) ?? "", "utf8"); } catch { p.push("export.data : non sérialisable en JSON"); } if (size > LIMITS.exportBytes) p.push(`export.data : ${size} octets > 1 Mo`); }
    return p;
  }
  const k = method === "erase" ? "removed" : method === "remap" ? "updated" : null;
  if (!k) return [`méthode inconnue ${method}`];
  return Number.isInteger(o[k]) && o[k] >= 0 ? [] : [`${method}.${k} : entier ≥ 0 attendu (reçu ${JSON.stringify(o[k])})`];
}

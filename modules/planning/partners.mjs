// Planning : les PARTENAIRES d'un stream (« Avec … »). Un créneau porte des pseudos Twitch (champ `partners` du sujet `planning.slot`) ; ici on les nettoie, puis on cherche
// dans Contacts (service `contact.book`, besoin facultatif) la fiche qui porte chaque pseudo. VIE PRIVÉE : seuls le NOM de la fiche et un lien vers la chaîne Twitch sortent d'ici,
// jamais un e-mail, un téléphone, une note ni une photo. Une fiche « à relire », une fiche de la catégorie « Ne pas montrer » et un pseudo inconnu ne sont jamais montrés (même règle
// que le Mur des remerciements et l'Annuaire). Aucun appel à Twitch : Contacts seul fait foi. Chaque appel à Contacts est borné ; rien ne lève. Rien n'est gardé sur disque :
// les réponses restent en mémoire 2 minutes (une page très visitée ne dérange pas Contacts), et 30 minutes au plus si Contacts ne répond plus.
const NOT_TWITCH = new Set(["videos", "directory", "downloads", "settings", "subscriptions", "friends", "wallet", "inventory", "drops", "prime", "turbo", "jobs", "store", "team", "popout", "embed", "moderator", "dashboard", "broadcast", "login", "signup", "search"]);
export const MAX_PARTNERS = 5;
const LOGIN_RE = /^[a-z0-9_]{4,25}$/;

/** « @Pseudo », « twitch.tv/pseudo », « https://www.twitch.tv/Pseudo/ » ou « pseudo » -> « pseudo » (minuscules, 4 à 25 lettres, chiffres ou _), sinon null. Même règle que Contacts. */
export function normalizeLogin(raw) {
  let s = String(raw ?? "").normalize("NFC").replace(/[​-‍﻿]/g, "").trim().replace(/^[<"'«“‘\s]+|[>"'»”’\s]+$/g, "").trim();
  if (!s || s.length > 300) return null;
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^?#\s/]*)/i.exec(s);
  s = (m ? m[1] : s.replace(/^@/, "")).toLowerCase();
  return LOGIN_RE.test(s) && !NOT_TWITCH.has(s) ? s : null;
}

/** Sépare une liste écrite à la main : virgule, point-virgule, retour à la ligne, « + », « & », « et » / « and ». */
export const splitList = (text) => String(text ?? "").slice(0, 1000).split(/[,;\n\r]+|\s+(?:\+|&|et|and)\s+/i).map((x) => x.trim()).filter(Boolean);

export const SERVICE = "contact.book";
export const HIDE_NAMES = ["ne pas montrer", "do not show"];
export const timing = { callMs: 4000, providersMs: 1500, freshMs: 120_000, staleMs: 30 * 60_000, maxLogins: 60, parallel: 5 };

/** Les pseudos d'un créneau (liste quelconque) : nettoyés, sans doublon, 5 au plus. */
export const loginsOf = (list) => [...new Set((Array.isArray(list) ? list : []).map(normalizeLogin).filter(Boolean))].slice(0, MAX_PARTNERS);

const SLOW = Symbol("slow");
const within = (p, ms) => { let t; return Promise.race([Promise.resolve(p).catch(() => SLOW), new Promise((r) => { t = setTimeout(() => r(SLOW), ms); })]).finally(() => clearTimeout(t)); };
const clean = (v, max) => String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const fold = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 80;

/** Un appel à Contacts : { ok: true, value } ou { ok: false, why } ("absent" · "slow" · "failed" · code d'erreur de Contacts). */
async function call(ctx, method, args) {
  const r = await within(Promise.resolve().then(() => ctx.api.services.call(SERVICE, method, args)), timing.callMs);
  if (r === SLOW) return { ok: false, why: "slow" };
  if (!r || typeof r !== "object" || r.ok !== true) return { ok: false, why: r?.reason === "unavailable" || r?.reason === "undeclared" ? "absent" : "failed" };
  const value = r.value;
  if (!value || typeof value !== "object" || value.ok !== true) return { ok: false, why: typeof value?.error === "string" ? value.error : "failed" };
  return { ok: true, value };
}

/** Contacts est-il installé ? Rend true, false, ou null (n'a pas répondu à temps). */
async function hasBook(ctx) {
  const list = await within(Promise.resolve().then(() => ctx.api.services.providers(SERVICE)), timing.providersMs);
  if (list === SLOW) return null;
  return Array.isArray(list) && list.length > 0;
}

/** La catégorie « Ne pas montrer » : { state: "ok", id: string|null } ou { state: "unverified" } (Contacts n'a pas pu le dire : on ne montre alors rien de nouveau). */
export async function hideCategory(ctx) {
  const raw = clean(ctx.setting?.("hide"), 120);
  if (raw) {
    const r = await call(ctx, "categoriesResolve", { ids: [raw] });
    if (!r.ok) return { state: "unverified" };
    const items = Array.isArray(r.value.items) ? r.value.items : [];
    if (items.some((k) => k?.id === raw)) return { state: "ok", id: raw };
    const to = r.value.moved && typeof r.value.moved === "object" ? r.value.moved[raw] : null;
    return { state: "ok", id: idOk(to) ? to : null };
  }
  const found = await Promise.all(HIDE_NAMES.map((q) => call(ctx, "categories", { q, limit: 20 })));
  if (found.some((r) => !r.ok)) return { state: "unverified" };
  for (const r of found) for (const k of Array.isArray(r.value.items) ? r.value.items : []) if (idOk(k?.id) && HIDE_NAMES.includes(fold(k.label ?? k.name))) return { state: "ok", id: k.id };
  return { state: "ok", id: null };
}

/** Une fiche peut-elle être montrée au public ? Active (relue), pas dans « Ne pas montrer », avec un nom. */
export const isShowable = (card, hideId) => !!card && card.status === "active" && !(hideId && Array.isArray(card.categoryIds) && card.categoryIds.includes(hideId)) && clean(card.name, 80) !== "";

const cache = new Map();   // « instance|pseudo » -> { at, v: { state: "shown" | "hidden" | "unknown", name? } }
export const resetPartners = () => cache.clear();
const keyOf = (ctx, login) => `${ctx.instance?.id ?? ctx.instance?.key ?? ""}|${String(ctx.setting?.("hide") ?? "")}|${login}`;

/** Cherche ces pseudos dans Contacts. Rend Map(pseudo -> { state, name? }) ; un pseudo absent de la Map = pas de réponse (rien n'est montré). */
async function lookup(ctx, logins) {
  const out = new Map();
  const book = await hasBook(ctx);
  if (book !== true) return { out, book: book === false ? "absent" : "busy" };
  const hide = await hideCategory(ctx);
  if (hide.state !== "ok") return { out, book: "busy" };
  const matches = new Map();   // pseudo -> [id]
  const queue = [...logins];
  await Promise.all(Array.from({ length: Math.min(timing.parallel, queue.length) }, async () => {
    for (let login = queue.shift(); login; login = queue.shift()) {
      const r = await call(ctx, "search", { q: login, network: "twitch", limit: 5 });
      if (!r.ok) continue;
      const ids = (Array.isArray(r.value.items) ? r.value.items : []).filter((i) => idOk(i?.id) && Array.isArray(i.accounts) && i.accounts.some((a) => a?.network === "twitch" && normalizeLogin(a.handle) === login)).map((i) => i.id);
      matches.set(login, [...new Set(ids)]);
    }
  }));
  const wanted = [...new Set([...matches.values()].flat())];
  const cards = new Map();
  let cardsOk = true;
  for (let i = 0; i < wanted.length; i += 100) {
    const r = await call(ctx, "resolve", { ids: wanted.slice(i, i + 100) });
    if (!r.ok) { cardsOk = false; break; }
    for (const c of Array.isArray(r.value.contacts) ? r.value.contacts : []) if (c && idOk(c.id)) cards.set(c.id, { status: c.status, name: c.name, categoryIds: c.categoryIds });   // rien d'autre n'est gardé
  }
  for (const [login, ids] of matches) {
    if (!ids.length) { out.set(login, { state: "unknown" }); continue; }
    if (!cardsOk) continue;
    const found = ids.map((id) => cards.get(id));
    if (found.some((c) => !c)) { out.set(login, { state: "unknown" }); continue; }
    const shown = found.filter((c) => isShowable(c, hide.id));
    out.set(login, shown.length === found.length ? { state: "shown", name: clean(shown[0].name, 80) } : { state: "hidden" });
  }
  return { out, book: "ok" };
}

/**
 * Pour des créneaux (champ `partners` = pseudos) : ajoute `people` = [{ name, url }] (seulement les personnes à montrer, dans l'ordre écrit) et rend le bilan pour l'administration :
 * { book: "none" | "ok" | "absent" | "busy", states: Map(pseudo -> "shown" | "hidden" | "unknown" | "busy"), names: Map(pseudo -> nom) }. Sans aucun pseudo : aucun appel à Contacts.
 */
export async function attachPartners(ctx, slots, now = Date.now()) {
  const all = [...new Set(slots.flatMap((s) => s.partners ?? []))].slice(0, timing.maxLogins);
  const info = { book: "none", states: new Map(), names: new Map() };
  for (const s of slots) s.people = [];
  if (!all.length) return info;
  const stale = all.filter((l) => { const h = cache.get(keyOf(ctx, l)); return !h || now - h.at >= timing.freshMs; });
  let book = "ok";
  if (stale.length) {
    const r = await lookup(ctx, stale);
    book = r.book;
    for (const [login, v] of r.out) cache.set(keyOf(ctx, login), { at: now, v });
    while (cache.size > 1000) cache.delete(cache.keys().next().value);
  }
  info.book = book;
  for (const l of all) {
    const h = cache.get(keyOf(ctx, l));
    const usable = h && now - h.at < (book === "ok" ? timing.freshMs : timing.staleMs);
    // Contacts absent : plus rien n'est montré (il a pu être retiré avec ses « Ne pas montrer »). Pas de réponse : la dernière réponse connue, 30 minutes au plus.
    if (usable && book !== "absent") { info.states.set(l, h.v.state); if (h.v.name) info.names.set(l, h.v.name); } else info.states.set(l, "busy");
  }
  for (const s of slots) s.people = (s.partners ?? []).filter((l) => info.states.get(l) === "shown").map((l) => ({ name: info.names.get(l), url: `https://www.twitch.tv/${l}` }));
  return info;
}

// Annuaire — l'annuaire tel que le voit un visiteur : qui est visible, sous quel nom, dans quelles catégories publiques, puis la RECHERCHE (sans accents), le FILTRE par catégories,
// le TRI (alphabétique, récents, au hasard stable) et la PAGINATION PAR CURSEUR. Tout se fait sur un index en mémoire (bornée : voir LIMITS.indexMax), jamais en relisant Contacts.
// Fonctions pures autour de `getView` : le modèle (contacts.mjs) et les données du module (data.mjs) entrent, une vue sort.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const { LIMITS, clean, fold, pickText } = P;

const cache = new WeakMap(); // modèle (sa liste de personnes) → { gen, sig, view } : la vue est refaite seulement si les données, les réglages ou le modèle changent

/** Les réglages qui changent la vue (noms montrés, rôle de Contacts). */
export const displaySig = (ctx) => JSON.stringify([ctx.setting("nameStyle") ?? "card", ctx.setting("roleFromContacts") === true || ctx.setting("roleFromContacts") === "true"]);

/**
 * La vue. `model` = contacts.getModel (state "ok"), `data` = data.readData. Rend
 * { entries (la grille), team, all (grille + équipe seule), bySlug, cats: [{ slug, id, label, name, count }], hiddenHere, noConsent, mapPlaces, sorted }.
 * Une personne est visible quand : elle est dans une catégorie publique OU dans l'équipe ; ET elle n'est pas masquée ici ; ET (si un consentement est réglé) elle a aussi cette catégorie.
 * « Ne pas montrer » et « à relire » ont déjà été écartés par contacts.mjs.
 */
export function getView(ctx, model, data) {
  const sig = displaySig(ctx);
  const hit = cache.get(model.people);
  if (hit && hit.gen === data.gen && hit.sig === sig) return hit.view;
  const view = makeView(ctx, model, data);
  cache.set(model.people, { gen: data.gen, sig, view });
  return view;
}

function makeView(ctx, model, data) {
  const style = P.NAME_STYLES.includes(ctx.setting("nameStyle")) ? ctx.setting("nameStyle") : "card";
  const cfg = data.config;
  const liveBySlug = new Map(cfg.cats.map((c) => [c.slug, model.live?.get(c.slug) ?? null]));
  const catOfId = new Map(); // id Contacts → slug
  for (const c of cfg.cats) { const l = liveBySlug.get(c.slug); if (l && !catOfId.has(l.id)) catOfId.set(l.id, c.slug); }
  const slugOrder = new Map(cfg.cats.map((c, i) => [c.slug, i]));
  const teamBy = new Map(cfg.team.map((m, i) => [m.contactId, { ...m, i }]));
  // Si une fiche d'équipe a été fusionnée dans Contacts, `moved` dit quelle fiche la remplace : on la retrouve.
  const movedTeam = new Map();
  for (const m of cfg.team) { const to = model.moved?.[m.contactId]; if (to) movedTeam.set(to, { ...m, i: teamBy.get(m.contactId).i }); }
  const entries = [], teamEntries = [], all = [], bySlug = new Map(), noConsent = [], hiddenHere = [];
  const catCount = new Map();
  const mapPlaces = [];
  const roleFromContacts = ctx.setting("roleFromContacts") === true || ctx.setting("roleFromContacts") === "true";
  for (const [id, p] of model.people) {
    const profile = data.profiles.get(id) ?? null;
    const catSlugs = p.cats.map((cid) => catOfId.get(cid)).filter(Boolean).sort((a, b) => slugOrder.get(a) - slugOrder.get(b));
    const member = teamBy.get(id) ?? movedTeam.get(id) ?? null;
    if (!catSlugs.length && !member) continue;
    if (profile?.hidden) { hiddenHere.push({ id, name: P.shownName(p, style) }); continue; }
    const consentOk = model.consentState === "unset" || (model.consentState === "ok" && p.cats.includes(model.consentId));
    if (!consentOk) { noConsent.push({ id, name: P.shownName(p, style) }); continue; }
    const name = P.shownName(p, style);
    const hash = P.personHash(id);
    const role = member ? (Object.keys(member.role).length ? member.role : roleFromContacts && p.role ? { [ctx.defaultLocale]: p.role } : {}) : {};
    const city = profile?.city ?? "";
    const e = {
      id, hash, slug: P.personSlug(name, hash), kind: p.kind, name, fname: fold(name), photo: p.photo, links: p.links, catSlugs, at: p.at,
      bio: profile?.bio ?? {}, city, geo: profile?.geo ?? null, role, isTeam: !!member, teamIndex: member ? member.i : -1, inGrid: catSlugs.length > 0,
      key: fold(`${name} ${p.nick} ${city} ${Object.values(role).join(" ")}`),
      mapOk: !!model.mapId && p.cats.includes(model.mapId) && !!profile?.geo && !!city,
    };
    if (bySlug.has(hash)) continue; // deux fiches au même identifiant public : la première gagne (une chance sur un million)
    bySlug.set(hash, e);
    all.push(e);
    if (e.inGrid) { entries.push(e); for (const s of catSlugs) catCount.set(s, (catCount.get(s) ?? 0) + 1); }
    if (member) teamEntries.push(e);
    if (e.mapOk) mapPlaces.push(e);
  }
  teamEntries.sort((a, b) => a.teamIndex - b.teamIndex);
  const cats = cfg.cats.map((c) => {
    const live = liveBySlug.get(c.slug);
    return { slug: c.slug, id: live?.id ?? null, label: c.label, name: live?.name ?? "", count: catCount.get(c.slug) ?? 0, bound: !!c.catId, live: !!live };
  });
  return { entries, team: teamEntries, all, bySlug, cats, hiddenHere, noConsent, mapPlaces, sorted: new Map(), style };
}

/** Le nom public d'une catégorie dans la langue de la page : le libellé de la propriétaire, sinon le nom dans Contacts. */
export const catLabel = (ctx, cat) => clean(pickText(cat.label, ctx.locale, ctx.defaultLocale), LIMITS.label) || cat.name || cat.slug;

/** La grille dans l'ordre demandé. `az` : par nom sans accents ; `new` : les plus récentes fiches d'abord ; `mix` : au hasard, mais le même toute la journée (pour parcourir plusieurs pages). */
export function sorted(view, mode, day = P.dayKey()) {
  const key = mode === "mix" ? `mix:${day}` : mode;
  let list = view.sorted.get(key);
  if (list) return list;
  list = [...view.entries];
  if (mode === "new") list.sort((a, b) => b.at - a.at || (a.hash < b.hash ? -1 : 1));
  else if (mode === "mix") { const k = new Map(list.map((e) => [e.hash, P.mixKey(e.hash, day)])); list.sort((a, b) => (k.get(a.hash) < k.get(b.hash) ? -1 : k.get(a.hash) > k.get(b.hash) ? 1 : 0)); }
  else list.sort((a, b) => (a.fname < b.fname ? -1 : a.fname > b.fname ? 1 : a.hash < b.hash ? -1 : 1));
  if (view.sorted.size >= 6) view.sorted.delete(view.sorted.keys().next().value);
  view.sorted.set(key, list);
  return list;
}

/**
 * Chercher, filtrer, trier, couper en pages. `opts` : { cats: [slug], q, sort, cursor, perPage }.
 * Rend { total (toute la grille), count (après recherche et filtre), rows (la page), next, prev (curseurs ; prev === "" : la première page), start }.
 * Plusieurs catégories = l'une OU l'autre. Une recherche sans tri choisi classe par pertinence (le nom commence par le mot, puis un mot du nom, puis ailleurs).
 */
export function query(view, opts = {}) {
  const perPage = P.int(opts.perPage, LIMITS.perPageDefault, 1, LIMITS.perPageMax);
  const catSet = new Set((opts.cats ?? []).slice(0, LIMITS.cats));
  const toks = P.tokens(opts.q);
  const mode = P.SORTS.includes(opts.sort) ? opts.sort : "az";
  let rows = sorted(view, mode, opts.day);
  if (catSet.size) rows = rows.filter((e) => e.catSlugs.some((s) => catSet.has(s)));
  if (toks.length) {
    const scored = [];
    for (const e of rows) { const s = P.score(e, toks); if (s !== null) scored.push([s, e]); }
    if (!opts.sort) scored.sort((a, b) => a[0] - b[0]); // tri stable : à pertinence égale, l'ordre alphabétique reste
    rows = scored.map((x) => x[1]);
  }
  const cur = P.readCursor(opts.cursor);
  let start = 0;
  if (cur) {
    if (rows[cur.pos - 1]?.hash === cur.hash) start = cur.pos;
    else { const i = rows.findIndex((e) => e.hash === cur.hash); start = i >= 0 ? i + 1 : 0; }
  }
  const page = rows.slice(start, start + perPage);
  const end = start + page.length;
  const next = end < rows.length && page.length ? P.cursorOf(end, page[page.length - 1].hash) : null;
  let prev = null;
  if (start > 0) { const ps = Math.max(0, start - perPage); prev = ps === 0 ? "" : P.cursorOf(ps, rows[ps - 1].hash); }
  return { total: view.entries.length, count: rows.length, rows: page, next, prev, start, perPage, all: rows };
}

/** Les autres personnes de la même catégorie : les voisines dans l'ordre alphabétique de la première catégorie publique de la personne (stable, jamais au hasard). */
export function neighbours(view, entry, n = LIMITS.same) {
  if (!entry.inGrid) return { slug: null, rows: [] };
  const slug = entry.catSlugs[0];
  const list = sorted(view, "az").filter((e) => e.catSlugs.includes(slug));
  const i = list.findIndex((e) => e.hash === entry.hash);
  const rows = [];
  for (let k = 1; k < list.length && rows.length < n; k++) rows.push(list[(i + k) % list.length]);
  return { slug, rows };
}

/* ───────────── L'adresse d'une page de liste ───────────── */

/**
 * Lit les segments d'une adresse de liste : c/<a+b> · q/<texte> · s/<az|new|mix> · after/<curseur> · photos (dans n'importe quel ordre, chacun une fois). Autre chose : null (page introuvable).
 * `slugs` : les adresses de catégories connues ; une catégorie inconnue donne null.
 */
export function parseList(segments, slugs) {
  const s = Array.isArray(segments) ? segments.filter((x) => x !== "") : [];
  const out = { cats: [], q: "", sort: "", cursor: "", photos: false };
  const seen = new Set();
  for (let i = 0; i < s.length;) {
    const k = s[i];
    if (seen.has(k)) return null;
    seen.add(k);
    if (k === "photos") { out.photos = true; i += 1; continue; }
    const val = s[i + 1];
    if (val === undefined) return null;
    if (k === "c") {
      const list = val.split("+").filter(Boolean);
      if (!list.length || list.length > LIMITS.cats || new Set(list).size !== list.length || !list.every((x) => P.slugOk(x) && slugs.has(x))) return null;
      out.cats = list;
    } else if (k === "q") {
      const q = clean(val, LIMITS.q);
      if (!q) return null;
      out.q = q;
    } else if (k === "s") { if (!P.SORTS.includes(val)) return null; out.sort = val; }
    else if (k === "after") { if (!P.readCursor(val)) return null; out.cursor = val; }
    else return null;
    i += 2;
  }
  return out;
}

/** Fabrique l'adresse canonique d'une page de liste (ordre fixe : c, q, s, photos, after) à partir de réglages déjà valides. */
export function listPath(base, o) {
  const parts = [];
  if (o.cats?.length) parts.push("c", o.cats.join("+"));
  if (o.q) parts.push("q", encodeURIComponent(clean(o.q, LIMITS.q).replace(/\//g, " ")));
  if (o.sort) parts.push("s", o.sort);
  if (o.photos) parts.push("photos");
  if (o.cursor) parts.push("after", o.cursor);
  return `${base}${parts.length ? `/${parts.join("/")}` : ""}` || "/";
}

// Santé du site — regarder ce que le site expose, UNIQUEMENT par ce que l'API des modules montre :
//   ctx.api.instances.list()  les rubriques du site (nom, chemin public, page d'administration)
//   ctx.api.entries.list()    les pages et articles publiés (titre, résumé, texte, image de couverture, adresse, langue demandée)
//   ctx.api.site() / brand()  le nom, l'accroche et l'adresse de contact du site
//   ctx.api.topics            les boutons des réseaux sociaux (sujet « social.link »), si le module y est abonné
// Rien n'est lu dans la base, rien n'est modifié. Ce que l'API ne montre pas est dit à part (voir « notChecked » dans view.mjs).
import { extractRefs, classifyHref, normalizePath, stripLocale, clip, hostKey, parseIgnoredHosts } from "./urls.mjs";

export const LIMITS = { instances: 40, entries: 200, links: 200, perHost: 25, items: 60, sources: 3, locales: 8 };

export const SEVERITY = { important: 0, advised: 1, info: 2 };
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const asArray = (v) => (Array.isArray(v) ? v : []);

/** Où le bouton « Corriger » mène : jamais ailleurs que dans l'administration. */
export function fixHref(f, defaultLocale) {
  if (!Array.isArray(f)) return null;
  const [kind, a, b] = f;
  if (kind === "e" && /^[A-Za-z0-9_-]{1,64}$/.test(String(a))) return `/admin/entries/${a}${b && b !== defaultLocale && /^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(b) ? `?locale=${b}` : ""}`;
  if (kind === "i" && /^\/admin\/instances\/[A-Za-z0-9_-]{1,64}$/.test(String(a))) return a;
  if (kind === "p" && ["/admin/settings#site", "/admin/navigation", "/admin/entries"].includes(a)) return a;
  return null;
}

class Groups {
  constructor() { this.map = new Map(); }
  add(id, loc, sev, item, weight = 1) {
    const key = `${id}|${loc ?? ""}`;
    let g = this.map.get(key);
    if (!g) { g = { id, loc: loc ?? null, sev, count: 0, items: [] }; this.map.set(key, g); }
    g.count += weight;
    if (g.items.length < LIMITS.items) g.items.push(item);
    return g;
  }
  list() { return [...this.map.values()]; }
}

/**
 * Lit le site. Ne lève jamais pour un module qui répond mal : il est noté dans `unreadable`.
 * options : { checkLinks, maxLinks, cursor (où reprendre dans la liste des liens), ignoredHosts }
 */
export async function scanSite(ctx, options = {}) {
  const defaultLocale = ctx.defaultLocale;
  const locales = [...new Set([defaultLocale, ...asArray(ctx.locales)])].slice(0, LIMITS.locales);
  const multi = locales.length > 1;
  let ownHost = "";
  try { ownHost = new URL(ctx.api.siteUrl).host; } catch { /* adresse du site illisible : les liens vers soi-même seront traités comme externes */ }

  const all = asArray(await ctx.api.instances.list({ locale: defaultLocale }).catch(() => []));
  const instances = all.filter((i) => i && i.key && i.key !== ctx.instance.key);
  const cutInstances = Math.max(0, instances.length - LIMITS.instances);
  const unreadable = [];
  const capped = [];
  const lists = new Map();   // clé de rubrique → Map(langue → entrées)
  for (const inst of instances.slice(0, LIMITS.instances)) {
    const perLocale = new Map();
    for (const loc of locales) {
      try {
        const rows = asArray(await ctx.api.entries.list({ instance: inst.key, locale: loc, limit: LIMITS.entries }));
        perLocale.set(loc, rows.filter((e) => e && typeof e === "object" && e.id));
      } catch { if (!unreadable.includes(inst.name)) unreadable.push(inst.name); }
    }
    lists.set(inst.key, { inst, perLocale });
    if ([...perLocale.values()].some((rows) => rows.length >= LIMITS.entries)) capped.push(inst.name);
  }

  // Les adresses de pages qui existent (toutes langues), pour repérer les liens vers une page disparue.
  const known = new Set();
  const completeBases = new Set();
  for (const { inst, perLocale } of lists.values()) {
    const base = inst.basePath ? `/${String(inst.basePath).toLowerCase()}` : null;
    const complete = !capped.includes(inst.name) && !unreadable.includes(inst.name) && (perLocale.get(defaultLocale)?.length ?? 0) > 0;
    if (base && complete) completeBases.add(base);
    for (const rows of perLocale.values()) for (const e of rows) if (e.path) known.add(stripLocale(normalizePath(e.path), locales));
  }

  const groups = new Groups();
  const pages = new Set();
  const stats = { instances: 0, pages: 0, images: 0, links: 0 };
  const candidates = new Map();   // adresse → { u, k, label, s: [{ f, w }] }
  let linkCount = 0;
  const addCandidate = (url, kind, label, source) => {
    linkCount++;
    let c = candidates.get(url);
    if (!c) { c = { u: url, k: kind, label: clip(label, 80), s: [] }; candidates.set(url, c); }
    if (kind === "image") c.k = "image";
    if (c.s.length < LIMITS.sources && source && !c.s.some((x) => JSON.stringify(x.f) === JSON.stringify(source.f))) c.s.push(source);
  };

  for (const { inst, perLocale } of lists.values()) {
    const base = perLocale.get(defaultLocale) ?? [];
    if (base.length) stats.instances++;
    const byId = new Map(base.map((e) => [e.id, e]));
    for (const loc of locales) {
      const rows = perLocale.get(loc);
      if (!rows) continue;
      const seenTitles = new Map();
      const where = inst.name;
      for (const e of rows) {
        const title = String(e.title ?? "").trim();
        const body = String(e.body ?? "");
        const summary = String(e.summary ?? "").trim();
        const ref = byId.get(e.id);
        const sameAsDefault = loc !== defaultLocale && ref && String(ref.title ?? "").trim() === title && String(ref.summary ?? "").trim() === summary && String(ref.body ?? "") === body;
        const fix = ["e", e.id, loc];
        const label = title || ctx.t("untitled");
        const hasOwnPage = !e.url && !e.code;

        if (loc === defaultLocale) pages.add(e.id);

        if (sameAsDefault) {
          // Le visiteur de cette langue voit le texte d'origine : soit la traduction manque, soit elle est identique (nom propre…).
          if ((body + summary).trim().length >= 20) groups.add("translation", loc, "advised", { k: `tr:${e.id}:${loc}`, t: label, w: where, d: ["same"], f: fix });
          continue;
        }
        if (!title) groups.add("title_empty", loc, "important", { k: `te:${e.id}:${loc}`, t: ctx.t("untitled"), w: where, f: fix });
        else if (title.length >= 3) { const key = norm(title); (seenTitles.get(key) ?? seenTitles.set(key, []).get(key)).push({ e, label, fix }); }
        if (hasOwnPage && title && !summary) groups.add("summary", loc, "advised", { k: `sum:${e.id}:${loc}`, t: label, w: where, f: fix });

        const refs = extractRefs(body);
        const missing = refs.images.filter((im) => im.alt === "").length;
        stats.images += refs.images.length;
        if (missing) groups.add("alt", loc, "important", { k: `alt:${e.id}:${loc}`, t: label, w: where, d: ["imgs", missing], f: fix }, missing);

        // Liens et images de ce texte.
        const src = { f: fix, w: label };
        for (const im of refs.images) {
          const c = classifyHref(im.src, ownHost);
          if (c?.kind === "external") addCandidate(c.url, "image", im.alt || label, src);
        }
        for (const l of refs.links) {
          const c = classifyHref(l.href, ownHost);
          if (!c) continue;
          if (c.kind === "external") addCandidate(c.url, "link", l.text || label, src);
          else {
            stats.links++;
            const path = stripLocale(c.path, locales);
            const segments = path.split("/").filter(Boolean);
            const first = `/${segments[0] ?? ""}`;
            if (segments.length >= 2 && completeBases.has(first) && !known.has(path)) {
              groups.add("internal", loc, "important", { k: `in:${e.id}:${loc}:${path}`, t: l.text ? clip(l.text, 80) : path, w: label, d: ["path", path], f: fix });
            }
          }
        }
        if (e.url) { const c = classifyHref(e.url, ownHost); if (c?.kind === "external") addCandidate(c.url, "link", title, { f: fix, w: label }); }
        for (const v of Object.values(e.fields && typeof e.fields === "object" ? e.fields : {})) {
          if (typeof v === "string" && /^https?:\/\//i.test(v)) { const c = classifyHref(v, ownHost); if (c?.kind === "external") addCandidate(c.url, "link", title, { f: fix, w: label }); }
        }
      }
      for (const list of seenTitles.values()) {
        if (list.length < 2) continue;
        for (const { e, label, fix } of list) groups.add("title_dup", loc, "advised", { k: `dup:${e.id}:${loc}`, t: label, w: where, d: ["dup", list.length], f: fix });
      }
      // Pas de version dans cette langue (possible quand le repli sur la langue d'origine est coupé).
      if (loc !== defaultLocale) {
        const present = new Set(rows.map((e) => e.id));
        for (const e of base) {
          if (present.has(e.id) || (String(e.body ?? "") + String(e.summary ?? "")).trim().length < 20) continue;
          groups.add("translation", loc, "advised", { k: `tr:${e.id}:${loc}`, t: String(e.title ?? "").trim() || ctx.t("untitled"), w: inst.name, d: ["absent"], f: ["e", e.id, defaultLocale] });
        }
      }
    }
  }
  stats.pages = pages.size;

  // Boutons des réseaux sociaux : ils sont des liens du site comme les autres.
  let social = [];
  try { social = asArray(await ctx.api.topics.collect("social.link", { limit: 50 })); } catch { /* pas abonné à ce sujet : tant pis */ }
  const adminOf = new Map(all.map((i) => [i.key, i.adminPath]));
  for (const s of social) {
    const c = classifyHref(s?.url, ownHost);
    if (c?.kind !== "external") continue;
    const adminPath = adminOf.get(s?.source?.instance);
    addCandidate(c.url, "link", s.label || hostKey(c.url), { f: adminPath ? ["i", adminPath] : ["p", "/admin/navigation"], w: s.source?.name || s.label || "" });
  }
  stats.links += linkCount;

  // Le site lui-même.
  try {
    const site = await ctx.api.site(defaultLocale);
    if (!String(site?.tagline ?? "").trim()) groups.add("home", null, "advised", { k: "home", t: ctx.t("home_name"), f: ["p", "/admin/settings#site"] });
  } catch { /* nom du site illisible : rien à dire */ }
  try {
    const brand = await ctx.api.brand(defaultLocale);
    if (!String(brand?.contactEmail ?? "").trim()) groups.add("contact", null, "info", { k: "contact", t: ctx.t("contact_name"), f: ["p", "/admin/settings#site"] });
  } catch { /* identité illisible : rien à dire */ }
  if (stats.pages === 0) groups.add("empty", null, "info", { k: "empty", t: ctx.t("empty_name"), f: ["p", "/admin/entries"] });

  // Les liens à visiter : une fenêtre de `maxLinks` (on reprend où la fois précédente s'est arrêtée), au plus `perHost` par site, répartis pour ne jamais frapper deux fois de suite le même.
  const ignoredHosts = options.ignoredHosts instanceof Set ? options.ignoredHosts : parseIgnoredHosts(options.ignoredHosts);
  const maxLinks = Math.min(LIMITS.links, Math.max(1, Math.trunc(Number(options.maxLinks)) || LIMITS.links));
  const everything = [...candidates.values()];
  const total = everything.length;
  const start = total > maxLinks ? Math.max(0, Math.trunc(Number(options.cursor)) || 0) % total : 0;
  const window = [];
  for (let i = 0; i < Math.min(total, maxLinks); i++) window.push(everything[(start + i) % total]);
  const perHost = new Map();
  const skipped = { host: 0, ignored: 0 };
  const byHost = new Map();
  const picked = [];
  for (const c of window) {
    const h = hostKey(c.u);
    if (ignoredHosts.has(h)) { skipped.ignored++; picked.push({ ...c, r: { st: "skipped", why: "ignored" } }); continue; }
    const n = perHost.get(h) ?? 0;
    if (n >= LIMITS.perHost) { skipped.host++; picked.push({ ...c, r: { st: "skipped", why: "perhost" } }); continue; }
    perHost.set(h, n + 1);
    (byHost.get(h) ?? byHost.set(h, []).get(h)).push(c);
  }
  const queues = [...byHost.values()];
  const links = [];
  while (queues.some((q) => q.length)) for (const q of queues) { const c = q.shift(); if (c) links.push(c); }
  return {
    groups: groups.list(),
    links: options.checkLinks === false ? [] : [...links, ...picked],   // les liens mis de côté (site à laisser tranquille, trop de liens vers le même site) portent déjà leur résultat `r`
    linkTotals: { found: total, from: total ? start : 0, count: window.length, window: total > maxLinks },
    stats: { ...stats, links: stats.links },
    notes: { capped, unreadable, cutInstances, multi, skipped },
    locales,
  };
}

// Annuaire — les outils pour l'assistant IA : LECTURE de l'annuaire public seulement (ce qu'un visiteur voit déjà : noms montrés, catégories publiques, titres de l'équipe, villes, adresses des fiches).
// Aucune écriture, ni dans l'annuaire ni dans Contacts : les fiches de Contacts se modifient avec les outils de Contacts.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const View = await import(`./view.mjs${v}`);
const Dir = await import(`./directory.mjs${v}`);
const { LIMITS, clean } = P;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const catNames = (ctx, view, e) => e.catSlugs.map((s) => view.cats.find((c) => c.slug === s)).filter(Boolean).map((c) => ({ slug: c.slug, label: Dir.catLabel(ctx, c) }));
const personOut = (ctx, st, e, detail = false) => ({
  slug: e.slug, name: e.name, kind: e.kind, url: `${View.baseOf(ctx)}/p/${e.slug}`,
  ...(P.pickText(e.role, ctx.locale, ctx.defaultLocale) ? { role: P.pickText(e.role, ctx.locale, ctx.defaultLocale) } : {}),
  ...(e.city ? { city: e.city } : {}), categories: catNames(ctx, st.view, e),
  ...(detail && st.display.bio && P.pickText(e.bio, ctx.locale, ctx.defaultLocale) ? { presentation: P.pickText(e.bio, ctx.locale, ctx.defaultLocale) } : {}),
  ...(detail && st.display.links !== "none" ? { links: e.links.map((l) => ({ network: l.n, url: l.u })) } : {}),
});
const ready = (ctx) => View.load(ctx, { maxAgeMs: 15_000, waitMs: 7000 });

export default {
  async directory_status(ctx) {
    const st = await ready(ctx);
    if (st.state !== "ok") return { state: st.state, ...(st.reason ? { reason: st.reason } : {}) };
    const { model, view } = st;
    return {
      state: "ok", visible: view.entries.length, team: view.team.length, ...(model.stale ? { lastKnownContent: true } : {}), ...(model.truncated ? { truncated: true } : {}), ...(model.partial ? { partial: true } : {}),
      hiddenByContacts: model.hiddenN, hiddenHere: view.hiddenHere.length, withoutConsent: view.noConsent.length, onMap: view.mapPlaces.length,
      categories: view.cats.map((c) => ({ slug: c.slug, label: Dir.catLabel(ctx, c), people: c.count })),
    };
  },
  async directory_categories(ctx) {
    const st = await ready(ctx);
    if (st.state !== "ok") return { state: st.state, categories: [] };
    return { state: "ok", categories: st.view.cats.map((c) => ({ slug: c.slug, label: Dir.catLabel(ctx, c), people: c.count })) };
  },
  async directory_search(ctx, args) {
    const st = await ready(ctx);
    if (st.state !== "ok") return { state: st.state, people: [] };
    const slugs = new Set(st.view.cats.map((c) => c.slug));
    const cats = (Array.isArray(args.categories) ? args.categories : []).map((s) => clean(s, 40)).filter((s) => slugs.has(s));
    const limit = P.int(args.limit, 20, 1, LIMITS.perPageMax);
    const q = Dir.query(st.view, { cats, q: clean(args.q, LIMITS.q), sort: P.SORTS.includes(args.sort) ? args.sort : "", cursor: typeof args.cursor === "string" ? args.cursor : "", perPage: limit });
    return { state: "ok", total: q.total, count: q.count, people: q.rows.map((e) => personOut(ctx, st, e)), next: q.next };
  },
  async directory_person(ctx, args) {
    const st = await ready(ctx);
    if (st.state !== "ok") return { state: st.state };
    const hash = P.hashOfSlug(clean(args.slug, 80));
    const e = hash ? st.view.bySlug.get(hash) : null;
    if (!e) throw fail("No such person in the public directory. Use directory_search to find a slug.");
    return { state: "ok", person: personOut(ctx, st, e, true) };
  },
  async directory_team(ctx) {
    const st = await ready(ctx);
    if (st.state !== "ok") return { state: st.state, team: [] };
    return { state: "ok", title: st.words.team, team: st.view.team.map((e) => personOut(ctx, st, e, true)) };
  },
};

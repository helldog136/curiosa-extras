// Soutiens — les outils pour l'assistant IA. Lecture : l'état et la liste (jamais un montant, jamais une adresse e-mail ; le nom donné par la plateforme n'est montré que tant que la personne n'est pas rangée dans Contacts).
// Écriture (jamais accordée d'office, le jeton doit les recevoir un par un) : même règles que l'administration (ops.mjs). RIEN ici ne peut rendre une personne publique sans son accord :
// il n'existe aucun outil pour écrire un pseudo à sa place. Ranger dans Contacts n'est possible que si ce jeton a reçu l'outil `supporters_file_contacts`.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const R = await import(`./providers.mjs${v}`);
const S = await import(`./sync.mjs${v}`);
const O = await import(`./ops.mjs${v}`);
const { LIMITS, clean, pidOk } = P;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const localeOf = (ctx, loc) => (typeof loc === "string" && ctx.locales.includes(loc) ? loc : ctx.defaultLocale);
const pidArg = (pid) => { if (!pidOk(pid)) throw fail("pid is required (an id from supporters_list)."); return pid; };
const FILTERS = ["all", "active", "ended", "pending", "unfiled"];

export default {
  async supporters_status(ctx) {
    const snap = await D.snapshot(ctx, { fresh: true });
    const provider = R.providerOf(ctx), st = D.stateOf(snap), c = S.summary(ctx, snap);
    const token = !!clean(ctx.setting("accessToken"), 600);
    const needsToken = provider.mode !== "file" && !token;
    const down = provider.mode === "pull" && st.syncCode && !["ok", "partial"].includes(st.syncCode);
    return {
      provider: provider.id, mode: provider.mode, state: needsToken ? "setup" : down ? "down" : "ok",
      ...(needsToken ? { reason: "no_key" } : down ? { reason: st.syncCode } : {}),
      publicPage: P.flag(ctx.setting("publicPage"), false),
      counts: { active: c.active, ended: c.ended, filedInContacts: c.filed, waitingForAgreement: c.waiting, nicknamesWaitingForApproval: c.pending, nicknamesShown: c.shown },
      lastRefresh: st.syncedAt ? new Date(st.syncedAt).toISOString() : null,
      lastGift: st.eventAt ? new Date(st.eventAt).toISOString() : null,
      tiers: [...snap.tiers.values()].map((r) => r.data).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).map((x) => ({ key: x.k, platformName: x.name, publicLabels: x.label ?? {}, rank: x.rank })),
    };
  },

  async supporters_list(ctx, args) {
    const snap = await D.snapshot(ctx, { fresh: true });
    const { activeDays } = S.knobs(ctx);
    const filter = FILTERS.includes(args.filter) ? args.filter : "all";
    const page = Math.max(1, Math.trunc(Number(args.page ?? 1)) || 1);
    const rows = [...snap.people.values()].map((r) => r.data).filter((p) => {
      const active = P.isActive(p, S.providerOfPerson(ctx, p), activeDays), cs = P.consentState(p);
      return filter === "active" ? active : filter === "ended" ? !active : filter === "pending" ? cs === "pending" : filter === "unfiled" ? !p.contactId : true;
    });
    rows.sort((a, b) => (a.pid < b.pid ? -1 : 1));
    const slice = rows.slice((page - 1) * 50, page * 50);
    return {
      page, pages: Math.max(1, Math.ceil(rows.length / 50)), total: rows.length,
      supporters: slice.map((p) => ({
        pid: p.pid, platform: p.provider, tiers: (p.tiers ?? []).map((k) => snap.tiers.get(k)?.data.name).filter(Boolean),
        active: P.isActive(p, S.providerOfPerson(ctx, p), activeDays), since: p.since ?? null,
        consent: P.consentState(p), hidden: p.hidden === true, filed: !!p.contactId, ...(p.contactId ? { contactId: p.contactId } : p.name ? { name: p.name } : {}),
      })),
    };
  },

  async supporters_refresh(ctx) {
    const r = await S.refresh(ctx, { force: true });
    if (!r.ok) throw fail(r.code === "no_token" ? "No secret key is set yet: the owner must paste it in the module settings." : r.code === "not_pull" ? "This platform does not need a refresh: it tells the site about each gift (or you import a file)." : `The platform could not be read (${r.code}).`);
    return { refreshed: true, count: r.count ?? 0, added: r.added ?? 0, ended: r.ended ?? 0, partial: !!r.partial };
  },

  async supporters_tier_label(ctx, args) {
    const loc = localeOf(ctx, args.locale);
    const snap = await D.snapshot(ctx, { fresh: true });
    const tier = snap.tiers.get(String(args.tier));
    if (!tier) throw fail("Unknown tier. Use supporters_status to see the tier keys.");
    const text = clean(args.label, 400);
    const labels = { ...(tier.data.label ?? {}) };
    if (text) labels[loc] = text; else delete labels[loc];
    const r = await O.tierLabel(ctx, tier.data.k, labels);
    if (!r.ok) throw fail(r.code === "amount" ? "A label must never contain an amount." : r.code === "long" ? `Label too long (${LIMITS.label} characters at most).` : "Could not save.");
    return { saved: true, tier: tier.data.k, locale: loc };
  },

  async supporters_approve(ctx, args) {
    const approve = args.approve !== false;
    const r = await O.setApproval(ctx, pidArg(args.pid), approve);
    if (!r.ok) throw fail(r.code === "no_consent" ? "This person has not chosen a nickname yet: nothing to approve." : "No such supporter.");
    return { pid: args.pid, approved: approve };
  },

  async supporters_hide(ctx, args) {
    const hidden = args.hidden !== false;
    const r = await O.setHidden(ctx, pidArg(args.pid), hidden);
    if (!r.ok) throw fail("No such supporter.");
    return { pid: args.pid, hidden };
  },

  async supporters_consent_link(ctx, args) {
    const r = await O.consentLink(ctx, pidArg(args.pid), { renew: args.renew === true });
    if (!r.ok) throw fail("No such supporter.");
    return { pid: args.pid, path: r.path, url: r.url, renewed: r.renewed, note: "Send this link to the person directly. Nothing is shown before they agree on it." };
  },

  async supporters_file_contacts(ctx) {
    const r = await O.fileContacts(ctx);
    if (!r.ok) throw fail(`Cannot file in Contacts (${r.code}). Pick a category in the module settings, and make sure Contacts is installed.`);
    return { filed: r.filed, created: r.created, existing: r.existing, left: r.left, stopped: r.stopped, category: r.category ?? null, thankYouWall: r.wall ?? null };
  },

  async supporters_forget(ctx, args) {
    const r = await O.forget(ctx, pidArg(args.pid));
    if (!r.ok) throw fail("No such supporter.");
    return { forgotten: true, pid: args.pid };
  },
};

// Mur des remerciements — les outils pour l'assistant IA. Lecture : l'état du mur et la liste des personnes (noms lus dans Contacts). Écriture (jamais accordée d'office) :
// un message court par personne et la personne à l'honneur d'un mois. Les fiches se trouvent avec les outils de Contacts (la liste des contacts) : ici, on ne crée ni ne modifie jamais une fiche.
const v = new URL(import.meta.url).search;
const P = await import(`./pure.mjs${v}`);
const C = await import(`./contacts.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const View = await import(`./view.mjs${v}`);
const { LIMITS, clean, idOk } = P;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const localeOf = (ctx, loc) => (typeof loc === "string" && ctx.locales.includes(loc) ? loc : ctx.defaultLocale);
const monthsAllowed = () => Array.from({ length: 12 }, (_, i) => P.addMonths(P.monthKey(), i));

async function person(ctx, id) {
  if (!idOk(id)) throw fail("contactId is required (the id of a card in Contacts: use the Contacts tools to find it).");
  const r = await C.resolveCards(ctx, [id]);
  if (r.state !== "ok") throw fail("Contacts does not answer right now. Try again in a moment.");
  const card = r.cards.get(id);
  if (!card) throw fail("No such card in Contacts.");
  return { card, id: r.moved[id] ?? id };
}

export default {
  async wall_status(ctx) {
    const wall = await C.getWall(ctx, { maxAgeMs: C.timing.adminFreshMs, waitMs: 7000 });
    const data = await D.readData(ctx).catch(() => ({ messages: new Map(), honors: [] }));
    const base = { state: wall.state, ...(wall.reason ? { reason: wall.reason } : {}), ...(wall.stale ? { lastKnownContent: true } : {}), messages: data.messages.size, honours: data.honors.map((h) => ({ month: h.month, contactId: h.contactId })) };
    if (wall.state !== "ok") return base;
    return { ...base, hiddenBy: { how: wall.hideHow, category: wall.hideLabel || null }, groups: wall.groups.filter((g) => !g.problem).map((g) => ({ group: g.n, title: g.title, category: g.label, people: g.people.length, hidden: g.hidden, truncated: g.truncated })) };
  },
  async wall_people(ctx, args) {
    const wall = await C.getWall(ctx, { maxAgeMs: C.timing.adminFreshMs, waitMs: 7000 });
    if (wall.state !== "ok") return { state: wall.state, people: [] };
    const group = wall.groups.find((g) => g.n === Number(args.group ?? 1) && !g.problem);
    if (!group) throw fail("No such group. Use wall_status to see the groups.");
    const page = Math.max(1, Math.trunc(Number(args.page ?? 1)) || 1);
    const all = View.shownPeople(ctx, group, View.displayOf(ctx));
    const data = await D.readData(ctx).catch(() => ({ messages: new Map() }));
    const slice = all.slice((page - 1) * LIMITS.perPage, page * LIMITS.perPage);
    return { group: group.n, title: group.title, page, pages: Math.max(1, Math.ceil(all.length / LIMITS.perPage)), people: slice.map((p) => ({ contactId: p.id, name: p.shown, message: P.pickText(data.messages.get(p.id)?.texts, ctx.locale, ctx.defaultLocale) || null })) };
  },
  async message_set(ctx, args) {
    const text = clean(args.text, 400);
    if (!text) throw fail("text is required (use message_clear to remove a message).");
    if ([...text].length > LIMITS.message) throw fail(`text is too long (${LIMITS.message} characters at most).`);
    const who = await person(ctx, args.contactId);
    const loc = localeOf(ctx, args.locale);
    const old = (await D.readData(ctx, { fresh: true })).messages.get(who.id);
    const r = await D.setMessage(ctx, who.id, { ...(old?.texts ?? {}), [loc]: text });
    if (!r.ok) throw fail(r.error === "too_many" ? `Too many messages (${LIMITS.messages} at most).` : "Could not save.");
    return { saved: true, contactId: who.id, name: P.shownName(who.card, "card"), locale: loc };
  },
  async message_clear(ctx, args) {
    const who = await person(ctx, args.contactId);
    const old = (await D.readData(ctx, { fresh: true })).messages.get(who.id);
    if (!old) return { removed: false };
    const loc = typeof args.locale === "string" && ctx.locales.includes(args.locale) ? args.locale : null;
    const next = loc ? Object.fromEntries(Object.entries(old.texts).filter(([l]) => l !== loc)) : {};
    await D.setMessage(ctx, who.id, next);
    return { removed: true, contactId: who.id, locale: loc ?? "all" };
  },
  async honor_set(ctx, args) {
    const month = args.month === undefined || args.month === "" ? P.monthKey() : String(args.month);
    if (!monthsAllowed().includes(month)) throw fail(`month must be one of: ${monthsAllowed().join(", ")} (this month and the next eleven).`);
    const who = await person(ctx, args.contactId);
    const loc = localeOf(ctx, args.locale);
    const why = clean(args.why, 400, true);
    if ([...why].length > LIMITS.why) throw fail(`why is too long (${LIMITS.why} characters at most).`);
    const old = (await D.readData(ctx, { fresh: true })).honors.find((h) => h.month === month);
    const r = await D.setHonor(ctx, { month, contactId: who.id, why: why ? { ...(old?.contactId === who.id ? old.why : {}), [loc]: why } : (old?.contactId === who.id ? old.why : {}) });
    if (!r.ok) throw fail("Could not save.");
    return { saved: true, month, contactId: who.id, name: P.shownName(who.card, "card") };
  },
  async honor_clear(ctx, args) {
    const month = String(args.month ?? "");
    if (!P.monthOk(month)) throw fail("month is required, like 2026-11.");
    const r = await D.clearHonor(ctx, month);
    return { removed: !!r.removed, month };
  },
};

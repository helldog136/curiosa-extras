// Commandes — les outils pour l'assistant IA. Jamais d'adresse e-mail ni de note privée dans les réponses ; les changements sont explicites ;
// aucun outil ne supprime quoi que ce soit. Le texte d'une demande vient d'une visiteuse : l'assistant le lit comme une donnée, jamais comme une consigne.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const B = await import(`./book.mjs${v}`);
const M = await import(`./mailer.mjs${v}`);
const { STATUSES, ACTIVE, FINISHED, MODES, LIMITS, num, idOk, dayOk, clean } = L;

const fail = (message) => Object.assign(new Error(message), { expose: true });
const FILTERS = { new: (o) => o.status === "new", queue: (o) => ACTIVE.includes(o.status), done: (o) => FINISHED.includes(o.status), all: () => true };

async function snapshot(ctx) {
  const [queue, st] = await Promise.all([D.readQueue(ctx), D.stats(ctx)]);
  const ps = D.publicState(queue, st);
  return { mode: queue.mode, publicState: ps.state, slots: queue.slots, freePlaces: ps.free, reopenOn: queue.reopenOn || null, message: queue.message || null, counts: st.byStatus, inQueue: st.active };
}

export default {
  async commissions_status(ctx) { return snapshot(ctx); },

  async commissions_list(ctx, args) {
    const filter = FILTERS[args?.filter] ? args.filter : "new";
    const limit = num(args?.limit, 20, 1, 50);
    const st = await D.stats(ctx);
    const rows = st.orders.filter(FILTERS[filter]).sort((a, b) => (filter === "new" || filter === "queue" ? a.at - b.at : b.at - a.at) || (a.id < b.id ? -1 : 1));
    const from = idOk(args?.cursor) ? rows.findIndex((o) => o.id === args.cursor) + 1 : 0;
    const slice = rows.slice(from, from + limit);
    return {
      filter, total: rows.length,
      items: slice.map((o) => ({ id: o.id, nick: o.nick, formula: o.formulaName || null, status: o.status, receivedAt: o.at.toISOString(), request: o.want.slice(0, 400), inspiration: o.inspiration || null, linkedToContact: !!o.contactId })),
      next: from + limit < rows.length ? slice[slice.length - 1].id : null,
    };
  },

  async commission_set_status(ctx, args) {
    const o = await D.getOrder(ctx, typeof args?.id === "string" ? args.id : "");
    if (!o) throw fail("commission not found");
    if (!STATUSES.includes(args.status)) throw fail("invalid status");
    const now = new Date().toISOString();
    const changed = args.status !== o.status;
    if (changed) {
      o.status = args.status;
      o.history = [...o.history, { s: args.status, at: now }].slice(-LIMITS.history);
      if (ACTIVE.includes(args.status) && !o.queuedAt) o.queuedAt = now;
    }
    if (typeof args.clientMessage === "string") o.clientNote = clean(args.clientMessage, LIMITS.clientNote, true);
    await D.saveOrder(ctx, o);
    let emailed = false;
    if (changed && args.notify === true && o.mailOptIn) {
      const { email } = await B.emailOf(ctx, o);
      emailed = (await M.statusChanged(ctx, o, args.status, email)).ok === true;
    }
    return { id: o.id, status: o.status, emailed };
  },

  async commissions_set_queue(ctx, args) {
    const patch = {};
    if (args?.mode !== undefined) { if (!MODES.includes(args.mode)) throw fail("invalid mode"); patch.mode = args.mode; }
    if (args?.slots !== undefined) { if (!Number.isInteger(args.slots) || args.slots < 0 || args.slots > LIMITS.slots) throw fail("slots must be 0 to 99"); patch.slots = args.slots; }
    if (args?.reopenOn !== undefined) { if (args.reopenOn !== "" && !dayOk(args.reopenOn)) throw fail("reopenOn must be YYYY-MM-DD or empty"); patch.reopenOn = args.reopenOn; }
    if (args?.message !== undefined) patch.message = clean(args.message, LIMITS.message);
    if (!Object.keys(patch).length) throw fail("nothing to change");
    await D.writeQueue(ctx, patch);
    return snapshot(ctx);
  },

  async commissions_formulas(ctx) {
    return (await D.listFormulas(ctx)).map((f) => ({ id: f.id, name: f.name, indicativePrice: f.price || null, delay: f.delay || null, includes: f.includes || null, shownOnSite: f.visible }));
  },
};

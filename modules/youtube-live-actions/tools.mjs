// Outils pour les assistants IA. Lecture (accordée d'office) : l'état, le journal, les règles. Écriture (jamais accordée d'office) : simuler un don.
// Aucun outil ne coupe ni ne reprend la maison (c'est le rôle du module Home Assistant), n'écrit une règle ou ne lit le chat.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const E = await import(`./engine.mjs${v}`);
const R = await import(`./rules.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const MONEY = (e) => (e.micros !== undefined ? { amount: e.micros / 1e6, currency: e.currency } : {});

export default {
  /** Lecture seule : ne fait AUCUN tour de lecture (ne demande rien à YouTube, n'écrit rien). */
  async youtube_live_status(ctx) {
    const o = await E.overview(ctx);
    return {
      readingNow: o.reading, pageOpen: o.open, status: o.state.status, live: !!o.state.chatId || o.state.noChat, liveTitle: o.state.title || null,
      lastReadAt: iso(o.state.lastPollAt), lastPageSeenAt: iso(o.state.lastBeatAt), lastError: o.state.error ? { code: o.state.error.code, at: iso(o.state.error.at), retryAt: iso(o.state.error.retryAt) } : null,
      limit: { usedPercent: Math.round(o.units) / 100, budgetPercent: o.s.budgetPercent, unitsToday: o.units },
      house: o.house.installed ? { enabled: o.house.enabled ?? null, paired: o.house.paired ?? null, seesYouLive: o.house.live ?? null, queued: o.house.queued ?? 0 } : { installed: false },
      rules: o.rules.length,
      note: "The chat is only read while a page of the module is open in a browser; nothing runs otherwise.",
    };
  },
  async youtube_live_journal(ctx, args) {
    const o = await E.overview(ctx);
    const limit = Math.min(50, Math.max(1, Math.trunc(Number(args?.limit)) || 20));
    return o.journal.slice(0, limit).map((l) => ({
      at: iso(l.at), kind: l.kind, ...(l.command ? { command: `!${l.command}` } : {}), ...(l.who && !l.test ? { who: l.who } : {}), ...MONEY(l), ...(l.count !== undefined ? { count: l.count } : {}),
      ...(l.rule ? { rule: l.rule } : {}), ...(l.key ? { action: l.key } : {}), ...(l.status ? { status: l.status } : {}), ...(l.reason ? { reason: l.reason } : {}), ...(l.code ? { code: l.code } : {}), ...(l.test ? { test: true } : {}),
    }));
  },
  async youtube_live_rules(ctx) {
    const o = await E.overview(ctx);
    return o.rules.map((r) => ({
      name: r.name, type: r.type, enabled: r.enabled !== false, action: r.action, cooldownSeconds: r.cooldownSec,
      ...(R.MONEY_TYPES.includes(r.type) ? { currency: r.currency, ...(r.currency !== "*" ? { minimum: (r.minMicros || 0) / 1e6 } : {}) } : {}), ...(r.type === "gift" ? { minimumGifts: r.minCount } : {}), ...(r.readMessage ? { readsMessage: true } : {}),
    }));
  },
  async youtube_action_simulate(ctx, args) {
    const r = await E.simulate(ctx, { type: args?.type, amount: args?.amount, currency: args?.currency, count: args?.count, text: args?.text });
    if (!r.ok) throw expose(r.code === "too_fast" ? "too fast: wait 3 seconds between two simulations" : r.code === "too_many" ? "too many simulations this hour (30 at most)" : r.code === "no_bridge" ? "the Home Assistant module is not installed" : `invalid input (${r.field ?? r.code})`);
    return { note: "Simulated through the same rules and the same bridge as a real donation. YouTube was not contacted. If the house is open, the action really plays at home.", results: r.lines.map((l) => ({ ...(l.rule ? { rule: l.rule } : {}), ...(l.key ? { action: l.key } : {}), status: l.status, ...(l.reason ? { reason: l.reason } : {}) })) };
  },
};

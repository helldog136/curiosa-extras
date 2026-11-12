// Twitch activity — module of Curiosa: the follows, subscriptions, gifts, bits, raids, stream start and end, hype trains of your channel, received from Twitch, kept in a journal,
// and offered to the other modules as the topic `twitch.event` (alerts, thanks wall, story…). Nothing here depends on those modules: they read the topic if they want to.
//
// Transport: the SIGNED WEBHOOK of EventSub (Twitch calls /m/<key>/webhook). Chosen over the WebSocket because a site restart or an update loses nothing that Twitch retries, there is no connection to keep
// alive in a server process that restarts, and the proven code (signature, replay protection, subscription repair) is the same as for the chat of the Twitch bot. See the README.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const webhook = await import(`./webhook.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const pub = await import(`./publish.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { ensureListening, stopListening } = await import(`./listen.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);

export default {
  routes: {
    // The address Twitch calls. Public by nature; only a request signed with our secret is accepted.
    webhook: async (request, ctx) => (await webhook.handle(request, ctx)).response,
  },
  tasks: {
    // Twitch cuts a subscription whose site did not answer often enough: check that ours exist and work, recreate them otherwise.
    listen: { everyMinutes: 5, run: async (ctx) => { await ensureListening(ctx, settingsOf(ctx)); } },
    // Old lines go (retention, tests, size cap).
    purge: { everyMinutes: 60, run: async (ctx) => { await st.purge(ctx, { retentionDays: settingsOf(ctx).retentionDays }); } },
  },
  exports: { [pub.TOPIC]: (ctx, opts) => pub.topicItems(ctx, opts) },
  async adminBadge(ctx) { const c = (await st.readState(ctx)).listen?.code; return c && !["listening", "pending", "nothing_on"].includes(c) ? 1 : 0; },
  adminPanel: admin.panel,
  adminActions: admin.actions,
  mcp: tools,
  hooks: {
    async onInstanceCreate(ctx) { try { await st.ensureSecret(ctx); } catch { /* created at the first check */ } },
    async onInstanceDelete(ctx) { await stopListening(ctx, settingsOf(ctx)); },
  },
};

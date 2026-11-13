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
const { stopListening, diagnose } = await import(`./listen.mjs${v}`);
const declareNow = (ctx) => diagnose(ctx, settingsOf(ctx), { declare: true });
const cycle = await import(`./cycle.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const dockapi = await import(`./dockapi.mjs${v}`);
const dock = await import(`./dock.mjs${v}`);
const kit = await import(`./dockkit.mjs${v}`);
const flag = await import(`./flag.mjs${v}`);

export default {
  routes: {
    // The address Twitch calls. Public by nature; only a request signed with our secret is accepted.
    webhook: async (request, ctx) => (await webhook.handle(request, ctx)).response,

    // The OBS dock (secret address `?k=…`, no session needed): the page, what it reads, what it can ask for. See dock.mjs and dockapi.mjs.
    async dock(request, ctx) {
      const m = await dockapi.secretMatches(ctx, dockapi.keyOf(request));
      if (m.limited) return new Response("Too many requests", { status: 429, headers: kit.jsonHeaders });
      if (!m.ok) return kit.deniedPage(ctx, ctx.t("dock_denied"), kit.wantsScheme(request.url));
      const k = encodeURIComponent(dockapi.keyOf(request));
      return dock.dockPage(ctx, { dataUrl: `/m/${ctx.instance.key}/dock-data?k=${k}&lang=${encodeURIComponent(ctx.locale)}`, actUrl: `/m/${ctx.instance.key}/dock-act?k=${k}&lang=${encodeURIComponent(ctx.locale)}`, scheme: kit.wantsScheme(request.url) });
    },
    async "dock-data"(request, ctx) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const m = await dockapi.secretMatches(ctx, dockapi.keyOf(request));
      if (m.limited) return new Response("{}", { status: 429, headers: kit.jsonHeaders });
      if (!m.ok) return new Response(JSON.stringify({ denied: true }), { status: 403, headers: kit.jsonHeaders });
      if (!st.allow(ctx, "dockData", { max: dockapi.LIMITS.dataPerMinute, windowMs: 60_000 })) return new Response("{}", { status: 429, headers: kit.jsonHeaders });
      const scope = new URL(request.url).searchParams.get("scope") ?? "day";
      return new Response(JSON.stringify(await dockapi.payload(ctx, { scope })), { headers: kit.jsonHeaders });
    },
    async "dock-act"(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      const m = await dockapi.secretMatches(ctx, dockapi.keyOf(request));
      if (m.limited) return new Response("{}", { status: 429, headers: kit.jsonHeaders });
      if (!m.ok) return new Response(JSON.stringify({ ok: false, code: "denied" }), { status: 403, headers: kit.jsonHeaders });
      const raw = await request.text();
      let body = null; try { body = raw.length <= 2000 ? JSON.parse(raw) : null; } catch { body = null; }
      return new Response(JSON.stringify(await dockapi.act(ctx, body)), { headers: kit.jsonHeaders });
    },
  },
  tasks: {
    // Every minute: check that our subscriptions exist and work (Twitch cuts a subscription whose site did not answer often enough), recreate them otherwise, catch up on what a gap
    // made us miss, and take the health of the listening (the owner is warned by e-mail when it is time). One list call to Twitch a minute when all is well.
    listen: { everyMinutes: 1, run: async (ctx) => { await cycle.check(ctx, settingsOf(ctx)); } },
    // Old lines go (retention, tests, size cap).
    purge: { everyMinutes: 60, run: async (ctx) => { await st.purge(ctx, { retentionDays: settingsOf(ctx).retentionDays }); } },
  },
  // The alerts overlay marks here the lines whose viewer text it hid or held (see flag.mjs). Optional on its side: without this module it simply does not mark.
  services: { "twitch.journal": { flag: (ctx, input) => flag.mark(ctx, input) } },
  exports: { [pub.TOPIC]: (ctx, opts) => pub.topicItems(ctx, opts) },
  async adminBadge(ctx) { const state = await st.readState(ctx); const c = state.listen?.code; return (c && !["listening", "pending", "nothing_on"].includes(c)) || state.health?.code === "silent" ? 1 : 0; },
  adminPanel: admin.panel,
  adminActions: admin.actions,
  mcp: tools,
  hooks: {
    async onInstanceCreate(ctx) {
      try { await st.ensureSecret(ctx); } catch { /* created at the first check */ }
      // The permissions of the types that are on are declared at once, not only when a page is opened (the connector adds them to its authorization).
      try { await declareNow(ctx); } catch { /* the minute check declares them */ }
    },
    async onInstanceDelete(ctx) { await stopListening(ctx, settingsOf(ctx)); },
  },
};

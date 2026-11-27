// Discord connector — a Curiosa module. THE module that talks to Discord for the site: it keeps the bot (application number, server number, secret code) in one place,
// shares one pause when Discord says "too many requests", and offers the service `discord.api` (version 1) to the other modules, which describe what they want
// (post a message, keep one up to date, open a private thread…) and never see a secret. REST only: no permanent connection, so no privileged intent.
//   discord.mjs  the only calls to Discord (ctx.api.net, one bucket per bot) ; service.mjs  the methods of the service ; health.mjs  does it work now ;
//   store.mjs    what is kept ; panel.mjs  the administration.
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const dc = await import(new URL(`./discord.mjs${version}`, import.meta.url).href);
const service = await import(new URL(`./service.mjs${version}`, import.meta.url).href);
const panel = await import(new URL(`./panel.mjs${version}`, import.meta.url).href);
const hl = await import(new URL(`./health.mjs${version}`, import.meta.url).href);

export const resetCache = () => { dc.resetDiscord(); hl.resetHealth(); service.resetLists(); store.resetQueues(); };

export default {
  services: { "discord.api": service.methods },
  adminPanel: (ctx, o) => panel.render(ctx, o),
  // Changing, testing or removing the bot, or deleting a kept message, needs the right `bot.manage` (the owner only by default): checked by the core, then again by the code.
  adminActions: Object.fromEntries(Object.entries(panel.actions).map(([name, run]) => [name, { right: panel.RIGHT, run }])),
  // Every 10 minutes: ask Discord whether the bot still works (and note the change of state in the central log).
  tasks: { check: { everyMinutes: 10, run: async (ctx) => { await hl.sweep(ctx); } } },
  // The red dot of the menu: the bot needs the owner (code refused, bot not on the server, permission missing). No network: what was last noted.
  async adminBadge(ctx) { const h = await store.healthOf(ctx); return h ? 1 : 0; },
  mcp: {
    async connector_discord_status(ctx) {
      const p = await hl.problem(ctx);
      const v = await hl.verify(ctx);
      const chosen = await store.allowedIds(ctx).catch(() => []);
      const state = p.state === "none" ? "notConfigured" : p.state === "ok" ? "configured" : "degraded";
      return {
        state, ...(p.state !== "none" && p.state !== "ok" ? { problem: p.state } : {}), ...(p.since ? { since: p.since } : {}),
        permissionsMissingOnServer: (v.missing ?? []).map((m) => ({ feature: m.feature, permission: m.permission })),
        ...(chosen.length ? { writesLimitedToChannels: chosen.length } : {}),
        ...(state === "configured" ? {} : { whatToDo: p.state === "rate" ? "Discord asked to wait: posting resumes by itself. Nothing to do." : p.state === "net" ? "Discord does not answer: it is tried again by itself. Open the Discord connector page and use Test the connection to check." : "Only the owner can fix this: open the Discord connector page in the admin. Until then no module can post to Discord." }),
      };
    },
  },
};

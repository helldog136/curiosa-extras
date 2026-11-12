// Twitch activity: a journal of events with invented names (written straight into the module's storage, as the webhook would).
export default async function (h) {
  const { ctx } = await h.ctxOf("twitch-events");
  // a fixed, made-up address for the OBS dock picture (the demo site is throw-away)
  const row = (await ctx.api.store.list("state", { limit: 1 }))[0];
  const now = h.NOW.getTime();
  // a made-up state for the pictures: live for hours without any event, and a catch-up after a gap
  const state = { ...(row?.data ?? {}), dockSecret: "demo-dock-address-0123456789abcdef", liveSince: now - 5 * 3_600_000, lastEventAt: now - 4 * 3_600_000, health: { code: "silent", since: now - 3_600_000 }, catchup: { at: now - 600_000, since: now - 3_600_000, follows: 2, subs: 1, skipped: [] }, okAt: now };
  if (row) await ctx.api.store.update(row.id, state); else await ctx.api.store.add("state", state);
  const t0 = h.NOW.getTime();
  const lines = [
    [2, { kind: "follow", name: "Camille", login: "camille" }], [6, { kind: "sub", name: "etoile_nord", login: "etoile_nord", tier: "1" }],
    [11, { kind: "cheer", name: "lune_douce", login: "lune_douce", amount: 500, text: "Cheer500 well played" }], [15, { kind: "gift", name: "pixel_renard", login: "pixel_renard", tier: "1", count: 5 }],
    [19, { kind: "raid", name: "sel_et_miel", login: "sel_et_miel", viewers: 42 }], [24, { kind: "resub", name: "brume_claire", login: "brume_claire", tier: "2", months: 12, streak: 12 }],
    [31, { kind: "hype_begin", level: 1, total: 600 }], [38, { kind: "hype_end", level: 3, total: 5400 }], [44, { kind: "follow", name: "vague_douce", login: "vague_douce" }],
    [52, { kind: "online", name: "Etoile Nord" }], [60, { kind: "follow", name: "petit_orage", login: "petit_orage" }], [75, { kind: "sub", name: "nova_pomme", login: "nova_pomme", tier: "1" }],
  ];
  for (const [min, ev] of lines.reverse()) {
    const at = t0 - min * 60_000, id = `demo-${min}`;
    await ctx.api.store.add("events", { id, at, receivedAt: at, source: "twitch", ...ev, ...(min === 11 ? { flag: { reason: "link", state: "hidden", at } } : {}) }, { key: id });
  }
}

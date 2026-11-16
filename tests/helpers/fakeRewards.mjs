// Faux Twitch pour les récompenses, au niveau du service `twitch.api` (méthode `request` du Connecteur) : récompenses personnalisées, échanges, abonnements aux évènements, chat.
//   const tw = fakeRewardsApi({ affiliate: true });    tw.request(args)  →  { ok, status, json } | { ok: false, error }
// Options : affiliate (faux = 403 « partner or affiliate »), rateLimited (429), down (réseau coupé), settleStatus (réponse forcée à la validation), max (nombre de récompenses permis, 50 chez Twitch).
// (twitch-events 1.12.0) `scopes`: the permissions of the channel's account, checked as the REAL connector does before any call (reading takes "read" or "manage",
// every write "manage"; missing → { ok: false, error: "scope" }); `foreign`: rewards made on Twitch by hand (listed, never manageable: `only_manageable_rewards`
// leaves them out, PATCH/DELETE answer 403 as Twitch does). Rewards have Twitch's full shape (recorded fields of Get Custom Reward).
/** A custom reward as Twitch returns it (every field of Get Custom Reward). */
export function twitchReward(r) {
  return {
    broadcaster_id: r.broadcaster_id ?? "100", broadcaster_login: "emma", broadcaster_name: "Emma", id: r.id, title: r.title, prompt: r.prompt ?? "", cost: r.cost,
    image: null, default_image: { url_1x: "https://static-cdn.jtvnw.net/custom-reward-images/default-1.png", url_2x: "https://static-cdn.jtvnw.net/custom-reward-images/default-2.png", url_4x: "https://static-cdn.jtvnw.net/custom-reward-images/default-4.png" },
    background_color: r.background_color ?? "#9147FF", is_enabled: r.is_enabled !== false, is_user_input_required: r.is_user_input_required === true,
    max_per_stream_setting: { is_enabled: false, max_per_stream: 0 }, max_per_user_per_stream_setting: { is_enabled: false, max_per_user_per_stream: 0 },
    global_cooldown_setting: { is_enabled: r.is_global_cooldown_enabled === true, global_cooldown_seconds: r.global_cooldown_seconds ?? 0 },
    is_paused: r.is_paused === true, is_in_stock: true, should_redemptions_skip_request_queue: r.should_redemptions_skip_request_queue === true,
    redemptions_redeemed_current_stream: null, cooldown_expires_at: null,
  };
}
export function fakeRewardsApi(opts = {}) {
  const s = { affiliate: true, rateLimited: false, down: false, max: 50, scopes: ["channel:read:redemptions", "channel:manage:redemptions"], ...opts };
  const api = { state: s, rewards: new Map(), settled: new Map(), log: [], subs: [], chat: [], lastSecret: null };
  for (const r of s.foreign ?? []) api.rewards.set(r.id, { ...twitchReward(r), manageable: false });
  let n = 0;
  const res = (status, json = null) => ({ ok: true, status, json });
  const first = (q, k) => [].concat(q?.[k] ?? [])[0];
  api.request = (a) => {
    // the connector checks the permission BEFORE anything leaves for Twitch: a refused call never reaches the log of Twitch
    if (String(a.path ?? "").startsWith("channel_points/custom_rewards")) {
      const can = (x) => s.scopes.includes(x);
      if (a.method === "GET" && !a.path.endsWith("/redemptions") ? !(can("channel:read:redemptions") || can("channel:manage:redemptions")) : !can("channel:manage:redemptions")) return { ok: false, error: "scope" };
    }
    api.log.push({ method: a.method, path: a.path, query: a.query, body: a.body, as: a.as, slot: a.slot });
    if (s.down) return { ok: false, error: "network" };
    if (s.rateLimited && a.path !== "chat/messages") return { ok: false, error: "rate" };
    if (a.path === "eventsub/subscriptions") {
      if (a.method === "GET") return res(200, { data: api.subs.filter((x) => !a.query?.type || x.type === first(a.query, "type")) });
      if (a.method === "DELETE") { api.subs = api.subs.filter((x) => x.id !== first(a.query, "id")); return res(204); }
      const sub = { id: `sub${++n}`, status: "enabled", type: a.body.type, condition: a.body.condition, transport: { method: "webhook", callback: a.body.transport.callback } };
      api.subs.push(sub); api.lastSecret = a.body.transport.secret;
      return res(202, { data: [sub] });
    }
    if (a.path === "chat/messages") { api.chat.push(a.body.message); return res(200, { data: [{ message_id: `m${++n}`, is_sent: true }] }); }
    if (!a.path.startsWith("channel_points/custom_rewards")) return { ok: false, error: "forbidden" };
    if (a.as !== "user" || (a.slot && a.slot !== "main")) return res(401, { message: "wrong token" });
    if (!s.affiliate) return res(403, { status: 403, message: "The broadcaster must have partner or affiliate status." });
    const bid = first(a.query, "broadcaster_id");
    if (a.path.endsWith("/redemptions")) {
      const id = first(a.query, "id"), status = a.body?.status;
      if (s.settleStatus) return res(s.settleStatus, { message: "forced" });
      if (!api.rewards.has(first(a.query, "reward_id"))) return res(404, { message: "reward not found" });
      if (api.settled.has(id)) return res(400, { message: "redemption already updated" });
      api.settled.set(id, status);
      return res(200, { data: [{ id, status }] });
    }
    if (a.method === "GET") {
      const only = first(a.query, "only_manageable_rewards") === "true", id = first(a.query, "id");
      return res(200, { data: [...api.rewards.values()].filter((r) => (!only || r.manageable !== false) && (!id || r.id === id)).map(({ manageable, ...r }) => r) });
    }
    if (a.method === "POST") {
      const b = a.body;
      if ([...api.rewards.values()].some((r) => r.title.toLowerCase() === b.title.toLowerCase())) return res(400, { message: "CREATE_CUSTOM_REWARD_DUPLICATE_REWARD" });
      if (api.rewards.size >= s.max) return res(400, { message: "CREATE_CUSTOM_REWARD_TOO_MANY_REWARDS" });
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const r = twitchReward({ id, broadcaster_id: bid, ...b });
      api.rewards.set(id, r);
      return res(200, { data: [r] });
    }
    const id = first(a.query, "id");
    if (!api.rewards.has(id)) return res(404, { message: "not found" });
    if (api.rewards.get(id).manageable === false) return res(403, { error: "Forbidden", status: 403, message: "The ID in the Client-Id header must match the client ID used to create the custom reward." });
    if (a.method === "PATCH") { api.rewards.set(id, { ...api.rewards.get(id), ...a.body }); return res(200, { data: [api.rewards.get(id)] }); }
    if (a.method === "DELETE") { api.rewards.delete(id); return res(204); }
    return res(400, {});
  };
  return api;
}

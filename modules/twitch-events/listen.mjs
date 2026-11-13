// The listening: which account serves, what is missing for it to work, and the subscriptions at Twitch (created, watched, recreated).
// The tokens are never here: everything goes through the service `twitch.api` of the Twitch connector. Nothing specific to Twitch is here either (see eventsub.mjs).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const es = await import(`./eventsub.mjs${v}`);
const st = await import(`./state.mjs${v}`);
const { resolveChannel, firstAccount, API } = await import(`./channel.mjs${v}`);

const ok = (r) => r.ok && r.value && r.value.ok !== false && r.value.error !== "other_channel";

/** An address Twitch can reach: https, a real domain name (not "localhost", an IP address or an internal name). */
export function isPublicSite(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  if (!h.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h);
}
export const callbackOf = (ctx) => `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${es.webhookPath(ctx.instance.key)}`;

/** A request to Twitch through the connector, for `channel`: { ok: true, status, json } or { ok: false, error }. */
export async function twitch(ctx, channel, req) {
  const all = await ctx.api.services.callAll(API, "request", { ...req, channel });
  const mine = all.find((r) => r.ok && r.value?.error !== "other_channel");
  if (!mine) return { ok: false, error: "network" };
  return mine.value;
}

/** Tells the connector which permissions the ENABLED types need for this channel (it adds them to its authorisations) — idempotent. */
export async function declareScopes(ctx, channel, enabled, { now = Date.now() } = {}) {
  const scopes = es.scopesFor(enabled);
  // The request is idempotent but it is a write at the connector: repeated only when the wish changed or every 30 minutes (the check runs every minute).
  const m = st.memoryOf(ctx), key = `${channel}|${scopes.join(",")}`;
  if (m.declared && m.declared.key === key && now - m.declared.at < 30 * 60_000) return;
  m.declared = { key, at: now };
  await ctx.api.services.callAll(API, "wantScopes", { channel, consumer: ctx.instance.key, slot: "main", scopes, returnTo: `/admin/instances/${ctx.instance.id}` });
}
const lacks = (acc, scopes) => scopes.filter((x) => !(acc?.scopes ?? []).includes(x));

/**
 * Where do we stand? Always { code, … }; "ready" when the account can serve, otherwise the FIRST thing to do:
 * no_channel · channel_unknown · slow (My Twitch channel mute) · creds_missing · need_connect · need_reconnect · site_private.
 * Ready: { code: "ready", channel, main, broadcasterId, enabled, need: [permissions of the enabled types], missing: [those not granted yet], blocked: [type ids that cannot start yet] }.
 * `declare`: also tell the connector what is needed (the admin page does; the webhook never does).
 */
export async function diagnose(ctx, s, { declare = true, now = Date.now() } = {}) {
  const picked = await resolveChannel(ctx, s.channel);
  if (picked.problem === "setup") return { code: "creds_missing", main: picked.account };
  if (picked.problem) return { code: picked.problem === "slow" ? "slow" : picked.problem };
  let main = await firstAccount(ctx, { channel: picked.channel });
  if (!main) return { code: "no_channel" };
  const state = await st.readState(ctx), enabled = st.enabledOf(state), need = es.scopesFor(enabled);
  if (declare && main.channel) { await declareScopes(ctx, main.channel, enabled, { now }); main = (await firstAccount(ctx, { channel: picked.channel })) ?? main; }
  const base = { channel: main.channel, main, enabled, need };
  if (!main.channel || !main.ready) return { code: "creds_missing", ...base };
  if (main.status === "none" || !main.userId) return { code: "need_connect", ...base };
  if (main.status === "reconnect") return { code: "need_reconnect", ...base };
  if (!isPublicSite(ctx.api.siteUrl)) return { code: "site_private", ...base };
  const missing = lacks(main, need);
  const blocked = es.TYPES.filter((t) => enabled[t.id] && lacks(main, t.scopes).length).map((t) => t.id);
  // The red box and the verdict only count the types the bot does not already cover (`optional`); the others still show their own state in their row.
  const blockedCore = blocked.filter((id) => !es.isOptional(id));
  const missingCore = lacks(main, es.scopesFor(Object.fromEntries(es.TYPES.filter((t) => enabled[t.id] && !t.optional).map((t) => [t.id, true]))));
  return { code: "ready", ...base, broadcasterId: main.userId, missing, missingCore, blocked, blockedCore };
}

const FAIL = { auth: "need_reconnect", scope: "need_more", config: "creds_missing", rate: "twitch_busy", network: "twitch_down" };
const RANK = { refused: 6, need_more: 6, need_reconnect: 6, twitch_down: 5, twitch_busy: 4, pending: 3, listening: 1 };
const worst = (a, b) => ((RANK[a] ?? 2) >= (RANK[b] ?? 2) ? a : b);

/**
 * Writes the result in the state: the global code and the code of each type. `since` keeps the date from which the code has been "listening".
 * `info[id]` = { since, reason } for a type that waits for Twitch. One log line per CHANGE of a type (no secret, no viewer data).
 */
async function note(ctx, code, types = {}, extra = {}, info = {}) {
  const now = Date.now();
  const changes = [];
  await st.updateState(ctx, (d) => {
    const before = d.listen ?? {}, was = d.types ?? {};
    d.listen = { code, at: now, ...(code === "listening" ? { since: before.code === "listening" && before.since ? before.since : now } : {}), ...extra };
    d.types = Object.fromEntries(es.TYPES.map((t) => {
      const c = types[t.id] ?? (code === "listening" ? "off" : code);
      if ((was[t.id]?.code ?? "off") !== c) changes.push([t.id, c]);
      return [t.id, { code: c, at: now, ...(info[t.id]?.since ? { since: info[t.id].since } : {}), ...(info[t.id]?.reason ? { reason: info[t.id].reason } : {}) }];
    }));
  });
  for (const [id, c] of changes) {
    try { await ctx.api.log?.write?.({ action: "type.state", target: id, data: { type: id, state: c, ...(info[id]?.reason ? { reason: info[id].reason } : {}) } }); } catch { /* the log never breaks a check */ }
  }
}
export const HEAL_MS = 3 * 60_000;       // a subscription pending longer than this is deleted and created again
const HEAL_AGAIN_MS = 15 * 60_000;       // …but only once in this time: after that it is reported, not hammered
const allCode = (code) => Object.fromEntries(es.TYPE_IDS.map((id) => [id, code]));

/**
 * Checks that the subscriptions exist and work; creates or recreates them as needed. Returns the noted state { code, types }.
 * Safe to call often (the scheduled task, the "Check" button). `renew`: starts again (deletes ours and changes the secret). `settle`: waits a few seconds for Twitch to verify the address.
 */
export async function ensureListening(ctx, s, { renew = false, settle = false, now = Date.now() } = {}) {
  const d = await diagnose(ctx, s, { now });
  if (d.code !== "ready") { await note(ctx, d.code, d.code === "creds_missing" || d.code === "need_connect" ? allCode(d.code) : {}); return { code: d.code }; }
  const callback = callbackOf(ctx);
  const secret = await st.ensureSecret(ctx, { renew });
  const info = {};
  const mark = (code, types, extra) => note(ctx, code, types, { missing: d.missingCore, ...extra }, info).then(() => ({ code, types }));
  // 1. Everything the application has at Twitch (pages of 100; ours are recognised by the callback address).
  const rows = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const list = await twitch(ctx, d.channel, es.listRequest(after));
    if (!list.ok) return mark(FAIL[list.error] ?? "twitch_down", allCode(FAIL[list.error] ?? "twitch_down"));
    if (list.status === 401 || list.status === 403) return mark("need_reconnect", allCode("need_reconnect"));
    rows.push(...(Array.isArray(list.json?.data) ? list.json.data : []));
    after = list.json?.pagination?.cursor;
    if (!after) break;
  }
  const startable = Object.fromEntries(es.TYPES.map((t) => [t.id, d.enabled[t.id] === true && !d.blocked.includes(t.id)]));
  const wanted = es.wantedSubs(startable, d.broadcasterId);
  const cls = es.classify(renew ? [] : rows, wanted, callback);
  const drop = renew ? rows.filter((r) => r?.transport?.callback === callback).map((r) => String(r.id)) : cls.stale;
  for (const id of drop) await twitch(ctx, d.channel, es.deleteRequest(id));
  // 2. Create what is missing; the state of each type is the worst state of its subscriptions.
  const types = {};
  const put = (typeId, code) => { types[typeId] = types[typeId] ? worst(types[typeId], code) : code; };
  for (const t of es.TYPES) { if (d.enabled[t.id] && d.blocked.includes(t.id)) types[t.id] = "need_more"; else if (!d.enabled[t.id]) types[t.id] = "off"; }
  let busy = false;
  for (const w of cls.wanted) {
    if (w.state === "enabled") { put(w.typeId, "listening"); continue; }
    if (w.state === "pending") {
      const s0 = await st.readState(ctx);
      // The age comes from Twitch (`created_at`), so a subscription made before a restart or by an older version still ages; ours is the fallback.
      const first = (s0.pendingSince ?? {})[w.type];
      const since = Number.isFinite(w.createdAt) ? w.createdAt : first ?? now;
      if (!Number.isFinite(w.createdAt) && !first) await st.updateState(ctx, (x) => { x.pendingSince = { ...(x.pendingSince ?? {}), [w.type]: now }; });
      const age = now - since, healedAt = (s0.healed ?? {})[w.type];
      const reason = w.elsewhere ? "elsewhere" : age < HEAL_MS ? "waiting" : s0.verifiedAt && now - s0.verifiedAt < 30 * 60_000 ? "unconfirmed" : "unreachable";
      if (age < HEAL_MS || (healedAt && now - healedAt < HEAL_AGAIN_MS)) { put(w.typeId, "pending"); info[w.typeId] = { since, reason }; continue; }
      await twitch(ctx, d.channel, es.deleteRequest(w.id));   // pending for 3 minutes: start again, once
      await st.updateState(ctx, (x) => { x.healed = { ...(x.healed ?? {}), [w.type]: now }; });
      try { await ctx.api.log?.write?.({ action: "type.recreated", target: w.typeId, data: { type: w.typeId, waitedMin: Math.round(age / 60_000), reason } }); } catch { /* the log never breaks a check */ }
    }
    if (busy) { put(w.typeId, "twitch_busy"); continue; }
    const made = await twitch(ctx, d.channel, es.createRequest(w, { callback, secret }));
    if (!made.ok) { put(w.typeId, FAIL[made.error] ?? "twitch_down"); busy = made.error === "rate"; continue; }
    const r = es.readCreate(made);
    if (r.ok || r.code === "exists") { put(w.typeId, "pending"); if (r.code === "exists") info[w.typeId] = { since: now, reason: "elsewhere" }; await st.updateState(ctx, (x) => { x.pendingSince = { ...(x.pendingSince ?? {}), [w.type]: Date.now() }; }); }
    else { put(w.typeId, r.code === "denied" ? "need_more" : r.code === "busy" ? "twitch_busy" : r.code === "refused" ? "refused" : "twitch_down"); busy = busy || r.code === "busy"; }
  }
  // 3. A person waiting in front of the screen: Twitch verifies the address right after accepting; a few seconds are enough for it to be "enabled".
  if (settle && Object.values(types).includes("pending")) {
    for (let i = 0; i < 4; i++) {
      await new Promise((go) => setTimeout(go, 600));
      const again = await twitch(ctx, d.channel, es.listRequest());
      if (!again.ok) break;
      const c2 = es.classify(again.json?.data, wanted, callback);
      if (c2.wanted.every((w) => w.state === "enabled")) { for (const w of c2.wanted) types[w.typeId] = "listening"; break; }
    }
  }
  let code = "listening";
  const on = Object.entries(types).filter(([, c]) => c !== "off");
  const core = on.filter(([id]) => !es.isOptional(id));
  const active = core.length ? core : on;   // a type the bot already covers never decides alone, unless it is all that is on
  if (!active.length) code = "nothing_on";
  else for (const [, c] of active) code = worst(code, c);
  if (code === "listening" && d.blockedCore.length) code = "need_more";
  await st.updateState(ctx, (x) => { if (code === "listening") delete x.pendingSince; });
  return mark(code, types);
}

/** Removes our subscriptions at Twitch and our permission requests (instance deleted). Never throws. */
export async function stopListening(ctx, s) {
  try {
    const d = await diagnose(ctx, s, { declare: false });
    if (!d.channel || !d.main?.userId) return;
    const callback = callbackOf(ctx);
    const list = await twitch(ctx, d.channel, es.listRequest());
    for (const x of list.ok ? (list.json?.data ?? []).filter((y) => y?.transport?.callback === callback) : []) await twitch(ctx, d.channel, es.deleteRequest(x.id));
    await ctx.api.services.callAll(API, "wantScopes", { channel: d.channel, consumer: ctx.instance.key, slot: "main", scopes: [] });
  } catch { /* at worst Twitch cuts the subscriptions by itself */ }
}

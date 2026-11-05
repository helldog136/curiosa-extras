// A measurable Twitch bot: the REAL twitch-bot and twitch-connector modules wired together over a fake Twitch (fakeTwitch.mjs, no network),
// with a configurable cost per primitive so that "where does the time go between a chat event and the reply" can be measured.
//   const w = await latencyWorld({ storeMs: 2, serviceMs: 3, helixMs: 60 });
//   const r = await w.say("!discord");           // { t0, ackAt, sentAt, doneAt, ... } (ms, performance.now())
// The delays model the production costs that an in-memory fake hides: a database round trip per store call (storeMs), the core building a provider
// context per service call (serviceMs), a cross-module topic read (topicMs) and a round trip to api.twitch.tv (helixMs).
// Every primitive call made by the bot is recorded as a span (label, start, end) in `w.spans`, so a test can count what happened BEFORE the reply.
import { performance } from "node:perf_hooks";
import { fakeCtx } from "./fakeCtx.mjs";
import { fakeTwitch } from "./fakeTwitch.mjs";
import { connector } from "./twitchConnector.mjs";
import { es, S, SRC, fr } from "./botWorld.mjs";
import fs from "node:fs";

const DIR = new URL("../../modules/twitch-bot", import.meta.url).pathname;
const manifest = JSON.parse(fs.readFileSync(`${DIR}/module.json`, "utf8"));
const webhook = await import("../../modules/twitch-bot/webhook.mjs");
const T = await import("../../modules/twitch-bot/timers.mjs");
const REDEEM = await import("../../modules/twitch-bot/redeem.mjs");
const REWARDS = await import("../../modules/twitch-bot/rewards.mjs");
const ACTIONS = await import("../../modules/twitch-bot/actions.mjs");
const C = await import("../../modules/twitch-bot/commands.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.now();
export { sleep };

/** Wraps every function of `obj` (one level) so that each call waits `ms` first and is recorded in `spans` with `label(name, args)`. */
function slow(obj, ms, label, spans, skip = [], extra = () => 0) {
  for (const [name, fn] of Object.entries(obj)) {
    if (typeof fn !== "function" || skip.includes(name)) continue;
    obj[name] = async (...args) => {
      const span = { label: label(name, args), t0: now(), t1: 0 };
      spans.push(span);
      try { const wait = (typeof ms === "function" ? ms() : ms) + extra(span.label); if (wait > 0) await sleep(wait); return await fn(...args); } finally { span.t1 = now(); }
    };
  }
}

const SECRET = "bench-secret";
export const BROADCASTER = "100";

/**
 * `commands`: custom commands of the bot configuration ([{ name, text }]).
 * `settings`: bot settings (cooldowns are 0 and the rate limit is the maximum by default so that every message can answer).
 * `streams`: what Twitch says about the channel (default: live, playing "Zelda").
 */
export async function latencyWorld({ storeMs = 0, serviceMs = 0, topicMs = 0, helixMs = 0, settings = {}, commands, streams, extraConnections = 0, slowTopics = {} } = {}) {
  S.resetMemory(); SRC.resetSources();
  const spans = [];
  const lat = { storeMs, serviceMs, topicMs, helixMs, streamsMs: 0, logMs: 0 };   // can be changed while a test runs (a slow Twitch, a slow database…)
  const tw = fakeTwitch({ userId: BROADCASTER, login: "emma", streams: streams ?? [{ login: "emma", name: "emma", title: "Soiree detente", game: "Zelda", viewers: 12 }] });
  const stamps = { chat: [], helix: 0, posting: 0, maxPosting: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const label = `${init.method ?? "GET"} ${u.pathname}`;
    const span = { label: `helix:${label}`, t0: now(), t1: 0 };
    spans.push(span);
    stamps.helix += 1;
    const isPost = label === "POST /helix/chat/messages";
    if (isPost) { stamps.posting += 1; stamps.maxPosting = Math.max(stamps.maxPosting, stamps.posting); }
    try {
      if (lat.helixMs > 0) await sleep(lat.helixMs);
      if (label === "GET /helix/streams" && lat.streamsMs > 0) await sleep(lat.streamsMs);
      const arrived = now();
      const res = await tw.fetch(url, init);
      if (label === "POST /helix/chat/messages" && res.status === 200) stamps.chat.push({ at: arrived, message: JSON.parse(init.body).message });   // only what Twitch accepted
      return res;
    } finally { span.t1 = now(); if (isPost) stamps.posting -= 1; }
  };
  const scopes = [...es.SCOPES.own, "channel:manage:redemptions"];
  tw.access.set("AT", { login: "emma", userId: BROADCASTER, scopes, valid: true });
  const conn = (channel, login, userId) => ({ slot: "main", channel, login, userId, access: "AT", refresh: "RT", expiresAt: Date.now() + 3_600_000, scopes, clientId: "cid", status: "ok", connectedAt: "2026-01-01T00:00:00Z" });
  const conns = [conn("emma", "emma", BROADCASTER)];
  for (let i = 0; i < extraConnections; i += 1) conns.push(conn(`autre${i}x`, `autre${i}x`, `9${i}`));
  const K = connector({ settings: { appClientId: "cid", appSecret: "SEC-RET" }, rows: { twitchConnections: conns, twitchChannels: [{ channel: "emma", redirectUri: null }] } });
  slow(K.ctx.api.store, () => lat.storeMs, (n) => `connector.store.${n}`, spans);

  // Chaine Twitch, reduced to what the bot reads: `channel` (no network) and `status` (a Helix GET /streams, cached 30 s like the real module).
  let liveCache = null;
  const liveMethods = {
    channel: async () => ({ channel: "emma", url: "https://twitch.tv/emma", configured: true, ready: true, missing: [] }),
    status: async () => {
      if (liveCache && liveCache.until > Date.now()) return liveCache.value;
      const r = await K.methods.request({ as: "app", method: "GET", path: "streams", query: { user_login: ["emma"] } });
      const s = r.ok ? r.json?.data?.[0] : null;
      const value = r.ok ? { configured: true, known: true, live: !!s, channel: "emma", ...(s ? { title: s.title, game: s.game_name ?? s.game, viewers: s.viewer_count, startedAt: s.started_at, displayName: "Emma" } : {}) } : { configured: true, known: false, live: false, channel: "emma", error: r.error };
      liveCache = { value, until: Date.now() + 30_000 };
      return value;
    },
  };
  const live = { instance: "emma", name: "emma", module: "twitch-channel", methods: liveMethods };

  const sponsors = [];
  const ctx = fakeCtx({
    key: "bot", moduleId: "twitch-bot", locale: "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: fr, logEvents: manifest.logEvents ?? [], siteUrl: "https://site.example.org",
    settings: { onlyWhenLive: true, timezone: "Europe/Paris", cooldownGlobal: 0, cooldownUser: 0, maxPer30s: 18, ...settings },
    topics: { "social.stat": [{ id: "x", platform: "twitch", account: "emma", metric: "followers", value: 1234 }], "planning.slot": [], "social.link": [], "ha.state": [], "ha.result": [] },
    instances: [{ key: "calendar", module: "calendar-manual", basePath: "calendar", name: "Calendar" }, { key: "sponsors", module: "sponsors", basePath: "sponsors", name: "Sponsors" }],
    services: {},
    serviceInstances: { "twitch.api": [K.instance], "twitch.live": [live] },
  });
  ctx.can = () => true;
  ctx.api.entries.list = async () => sponsors;
  slow(ctx.api.store, () => lat.storeMs, (n, a) => `store.${n}:${typeof a[0] === "string" ? a[0] : "id"}`, spans, [], (l) => (l.endsWith(":botLog") ? lat.logMs : 0));
  slow(ctx.api.services, () => lat.serviceMs, (n, a) => `svc:${a[0]}.${a[1] ?? ""}`, spans);
  slow(ctx.api.topics, () => lat.topicMs, (n, a) => `topics:${a[0]}`, spans, [], (l) => slowTopics[l.replace(/^topics:/, "")] ?? 0);
  slow(ctx.api.instances, () => lat.topicMs, (n) => `instances.${n}`, spans);
  slow(ctx.api.entries, () => lat.topicMs, (n) => `entries.${n}`, spans);

  // state + configuration
  await S.updateState(ctx, (d) => { d.secret = SECRET; d.sub = { code: "listening", at: Date.now() }; });
  const list = commands ?? [{ name: "discord", text: "Salut {utilisateur}, rejoignez-nous sur discord.example.org" }, { name: "quoi", text: "{utilisateur} : on joue a {jeu}" }];
  const cfg = C.emptyConfig();
  cfg.custom = list.map((c, i) => ({ id: `c${i}`, name: c.name, text: c.text, enabled: true, role: "everyone", aliases: [], ...(c.extra ?? {}) }));
  await ctx.api.store.add("botConfig", cfg);
  spans.length = 0;

  let seq = 0;
  const request = (event, type = "notification", subType = es.TYPE) => {
    const id = `msg-${++seq}-${Math.random().toString(36).slice(2)}`;
    const ts = new Date().toISOString();
    const body = JSON.stringify({ subscription: { type: subType }, event });
    return new Request("https://site.example.org/m/bot/webhook", { method: "POST", headers: { "twitch-eventsub-message-id": id, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-type": type, "twitch-eventsub-message-signature": es.sign(SECRET, id, ts, body) }, body });
  };
  const chatEvent = (text, who = "viewer1") => ({ message_id: `chat-${++seq}-${Math.random().toString(36).slice(2)}`, broadcaster_user_id: BROADCASTER, chatter_user_id: `u-${who}`, chatter_user_login: who, chatter_user_name: who, message: { text }, message_type: "text", badges: [] });

  /** Delivers one chat message to the webhook like Twitch would. Resolves once everything is done (or, with waitDone false, once the ack is back; then `r.finish`). */
  async function say(text, who = "viewer1", { waitDone = true } = {}) {
    const before = stamps.chat.length;
    const t0 = now();
    const out = await webhook.handle(request(chatEvent(text, who)), ctx);
    const r = { t0, ackAt: now(), status: out.response.status, sentAt: null, doneAt: null, sent: [], spansBefore: [] };
    const finish = out.done.then(() => { r.doneAt = now(); const mine = stamps.chat.slice(before).filter((m) => m.message.includes(who)); const sent = mine[0]; if (sent) r.sentAt = sent.at; r.sent = mine.map((m) => m.message); r.spansBefore = spans.filter((s) => s.t0 >= t0 && (r.sentAt === null || s.t0 <= r.sentAt)); return r; });
    if (waitDone) await finish; else r.finish = finish;
    return r;
  }
  const redemptionEvent = (reward, who = "viewer1", id = `red-${++seq}`) => ({ id, broadcaster_user_id: BROADCASTER, user_login: who, user_name: who, user_input: "", status: "unfulfilled", reward: { id: reward.tid, title: reward.title, cost: reward.cost, prompt: "" }, redeemed_at: new Date().toISOString() });
  async function redeem(reward, who) {
    const t0 = now();
    const out = await webhook.handle(request(redemptionEvent(reward, who), "notification", es.TYPE_REDEEM), ctx);
    const r = { t0, ackAt: now(), status: out.response.status };
    await out.done; r.doneAt = now();
    return r;
  }
  async function addReward(over = {}) {
    const doc = { tid: "tid-1", title: "Say hello", cost: 100, cooldown: 0, prompt: "", action: ACTIONS.BOT_ACTION, reply: "Hello {utilisateur}", needsInput: false, pause: null, gone: false, refused: null, ...over };
    const id = await ctx.api.store.add("reward", doc);
    return { id, ...doc };
  }

  const world = { lat, slowTopics, spans, stamps, tw, ctx, K, say, request, chatEvent, redeem, addReward, cfg, T, REDEEM, REWARDS, ACTIONS, C, webhook };
  world.expireChannel = () => { liveCache = null; };
  world.close = () => { globalThis.fetch = real; };
  world.reset = () => { S.resetMemory(); SRC.resetSources(); T.resetTimersMemory?.(); spans.length = 0; stamps.chat.length = 0; };
  return world;
}

/** Union length (ms) of the spans, so that two parallel calls are counted once. */
export function unionMs(spans) {
  const list = spans.filter((s) => s.t1 >= s.t0).map((s) => [s.t0, s.t1]).sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [a, b] of list) { if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
  if (cur) total += cur[1] - cur[0];
  return total;
}
export const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

/** The stage a bot-side span belongs to (only the outermost calls made by the bot: connector internals and Helix are nested inside them). */
export function stageOf(label) {
  if (label.startsWith("connector.") || label.startsWith("helix:")) return null;
  if (/^svc:twitch\.live\.status/.test(label)) return "live state (Helix GET /streams)";
  if (/^svc:twitch\.live\./.test(label) || /^svc:twitch\.api\.(account|wantScopes|connections)/.test(label)) return "account check (diagnose)";
  if (/^svc:twitch\.api\.request/.test(label)) return "send (connector, Helix POST)";
  if (/^svc:/.test(label)) return "other services";
  if (/^(topics|instances|entries)/.test(label)) return "other modules (planning, partners, networks, followers)";
  if (/^store\./.test(label)) return /botLog|botCounters|botTimers/.test(label) ? "journal, counters, timers" : /redeem|reward/.test(label) ? "rewards store" : "state and config reads";
  return "other";
}
export function stageTable(spans) {
  const by = new Map();
  for (const s of spans) { const k = stageOf(s.label); if (!k) continue; (by.get(k) ?? by.set(k, []).get(k)).push(s); }
  return [...by].map(([stage, list]) => ({ stage, calls: list.length, ms: unionMs(list) }));
}

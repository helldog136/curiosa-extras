// Everything that is specific to Twitch in "Twitch activity" lives in this file: the subscriptions we ask for, the signature of what Twitch sends,
// and the reading of each event into ONE normalised shape. If the Twitch documentation differs from what is written here, this file (and its tests) is where to fix it.
// Pure file: no knowledge of Curiosa (no ctx, no storage), no network request.
//
// VERIFIED against https://dev.twitch.tv/docs/eventsub/reference/ (read on 2026-11-12, quoted in the tests):
//   - channel.follow v2: condition { broadcaster_user_id, moderator_user_id } (the moderator may be the broadcaster), scope moderator:read:followers, event user_*, followed_at;
//   - channel.subscribe v1 (not the resubs): scope channel:read:subscriptions, event user_*, tier "1000" | "2000" | "3000", is_gift;
//   - channel.subscription.gift v1: user_* nullable (anonymous), total, tier, cumulative_total (nullable), is_anonymous;
//   - channel.subscription.message v1: user_*, tier, message.text, cumulative_months, streak_months (nullable), duration_months;
//   - channel.cheer v1: scope bits:read, is_anonymous, user_* nullable, message, bits;
//   - channel.raid v1: condition { to_broadcaster_user_id } (exactly one of from / to), no authorisation, from_broadcaster_user_*, viewers;
//   - stream.online / stream.offline v1: no authorisation, event id, broadcaster_user_*, type + started_at (online only);
//   - channel.hype_train.begin / progress / end: the page documents version 2 only, scope channel:read:hype_train, fields id, level, total, progress, goal, top_contributions[{user_*, type, total}],
//     started_at, expires_at, ended_at, cooldown_ends_at, all_time_high_level, is_shared_train, type "regular" | "golden_kappa" | "treasure";
//   - webhook transport: https on port 443, secret of 10 to 100 ASCII characters, HMAC-SHA256 over id + timestamp + raw body ("sha256=" prefix), message types notification /
//     webhook_callback_verification / revocation, delivery "at least once", revocation statuses user_removed / authorization_revoked / notification_failures_exceeded / version_removed.
// NOT VERIFIED (no live Twitch was available): the exact behaviour of an app access token for these subscriptions (the docs say "app access token where the broadcaster has granted that scope"),
// the number of failures before Twitch revokes a subscription, the redelivery schedule, and channel.channel_points_custom_reward_redemption.add (copied from Twitch bot: v1, condition broadcaster_user_id).
import { createHmac, timingSafeEqual } from "node:crypto";

/** Longest age (both ways) of a signed message before it is refused as a replay. */
export const MAX_AGE_MS = 10 * 60_000;
export const MAX_BODY = 100_000;

const FOLLOW = "moderator:read:followers", SUBS = "channel:read:subscriptions", BITS = "bits:read", HYPE = "channel:read:hype_train", REDEEM = "channel:read:redemptions";

/**
 * The kinds of alert a person can switch on or off ("types"), each with the subscriptions behind it and the Twitch permission it needs.
 * `default`: switched on for a new site (channel point alerts are off: Twitch bot already handles rewards).
 */
export const TYPES = [
  { id: "follow", default: true, scopes: [FOLLOW], subs: [{ type: "channel.follow", version: "2", cond: (b) => ({ broadcaster_user_id: b, moderator_user_id: b }) }], kinds: ["follow"] },
  { id: "sub", default: true, scopes: [SUBS], subs: [{ type: "channel.subscribe", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["sub"] },
  { id: "resub", default: true, scopes: [SUBS], subs: [{ type: "channel.subscription.message", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["resub"] },
  { id: "gift", default: true, scopes: [SUBS], subs: [{ type: "channel.subscription.gift", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["gift"] },
  { id: "cheer", default: true, scopes: [BITS], subs: [{ type: "channel.cheer", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["cheer"] },
  { id: "raid", default: true, scopes: [], subs: [{ type: "channel.raid", version: "1", cond: (b) => ({ to_broadcaster_user_id: b }) }], kinds: ["raid"] },
  { id: "online", default: true, scopes: [], subs: [{ type: "stream.online", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["online"] },
  { id: "offline", default: true, scopes: [], subs: [{ type: "stream.offline", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["offline"] },
  {
    id: "hype", default: true, scopes: [HYPE], kinds: ["hype_begin", "hype_progress", "hype_end"],
    subs: ["begin", "progress", "end"].map((p) => ({ type: `channel.hype_train.${p}`, version: "2", cond: (b) => ({ broadcaster_user_id: b }) })),
  },
  { id: "redeem", default: false, optional: true, scopes: [REDEEM], subs: [{ type: "channel.channel_points_custom_reward_redemption.add", version: "1", cond: (b) => ({ broadcaster_user_id: b }) }], kinds: ["redeem"] },
];
export const TYPE_IDS = TYPES.map((t) => t.id);
/** Types the Twitch bot already covers: their trouble never turns the whole page red. */
export const isOptional = (id) => TYPES.find((t) => t.id === id)?.optional === true;
export const typeOf = (id) => TYPES.find((t) => t.id === id) ?? null;
/** Every kind of event (what the journal and the topic carry) and the type (switch) it belongs to. */
export const KINDS = TYPES.flatMap((t) => t.kinds);
export const groupOf = (kind) => TYPES.find((t) => t.kinds.includes(kind))?.id ?? null;
export const DEFAULTS = Object.fromEntries(TYPES.map((t) => [t.id, t.default]));

/** The subscriptions wanted for the enabled types: [{ typeId, type, version, condition }]. */
export function wantedSubs(enabled, broadcasterId) {
  const b = String(broadcasterId);
  return TYPES.filter((t) => enabled[t.id] === true).flatMap((t) => t.subs.map((s) => ({ typeId: t.id, type: s.type, version: s.version, condition: s.cond(b) })));
}
/** The Twitch permissions needed by the enabled types. */
export const scopesFor = (enabled) => [...new Set(TYPES.filter((t) => enabled[t.id] === true).flatMap((t) => t.scopes))].sort();

/* ───────────── Signature and message headers ───────────── */

export const H = { id: "twitch-eventsub-message-id", type: "twitch-eventsub-message-type", signature: "twitch-eventsub-message-signature", timestamp: "twitch-eventsub-message-timestamp" };
const hex = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");
/** The expected signature ("sha256=…") for these three elements. */
export const sign = (secret, id, timestamp, rawBody) => `sha256=${hex(secret, `${id}${timestamp}${rawBody}`)}`;
const header = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? "";

/**
 * Checks a request from Twitch. { ok: true, id, type, timestamp } or { ok: false, reason: "secret" | "headers" | "signature" | "stale" }.
 * The comparison is constant-time; the timestamp must be within `maxAgeMs` of now (both ways), which is the replay protection.
 */
export function verify({ secret, headers, rawBody, now = Date.now(), maxAgeMs = MAX_AGE_MS }) {
  if (!secret || typeof secret !== "string") return { ok: false, reason: "secret" };
  const id = header(headers, H.id), type = header(headers, H.type), timestamp = header(headers, H.timestamp), got = header(headers, H.signature);
  if (!id || !type || !timestamp || !got || id.length > 200 || got.length > 200) return { ok: false, reason: "headers" };
  const expected = Buffer.from(sign(secret, id, timestamp, rawBody)), actual = Buffer.from(got);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "signature" };
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at) || Math.abs(now - at) > maxAgeMs) return { ok: false, reason: "stale" };
  return { ok: true, id, type, timestamp };
}

/* ───────────── Cleaning of strings from Twitch ───────────── */

/** Text from outside: normalised, without control or direction characters, spaces collapsed, bounded. Always rendered as plain text by consumers. */
export const clean = (v, max) => (typeof v === "string" ? v.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const login = (v) => { const s = clean(v, 40).toLowerCase(); return /^[a-z0-9_]{1,25}$/.test(s) ? s : ""; };
const int = (v, min = 0, max = 1_000_000_000) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const tierOf = (t) => ({ 1000: "1", 2000: "2", 3000: "3" })[String(t)] ?? null;
const ms = (v) => { const t = Date.parse(typeof v === "string" ? v : ""); return Number.isFinite(t) ? t : null; };
const NAME = 60, TEXT = 250;

/* ───────────── Reading the body ───────────── */

/** { kind: "challenge", challenge } | { kind: "revocation", status, type } | { kind: "event", subType, version, event } | { kind: "ignored" } | { kind: "invalid" }. */
export function parseBody(messageType, rawBody) {
  let json;
  try { json = JSON.parse(rawBody); } catch { return { kind: "invalid" }; }
  if (!json || typeof json !== "object") return { kind: "invalid" };
  if (messageType === "webhook_callback_verification") return typeof json.challenge === "string" && json.challenge.length <= 500 ? { kind: "challenge", challenge: json.challenge } : { kind: "invalid" };
  if (messageType === "revocation") return { kind: "revocation", status: clean(json.subscription?.status, 80), type: clean(json.subscription?.type, 80) };
  if (messageType === "notification") {
    const subType = clean(json.subscription?.type, 80);
    if (!subType || !json.event || typeof json.event !== "object") return { kind: "invalid" };
    return { kind: "event", subType, version: clean(json.subscription?.version, 10), event: json.event };
  }
  return { kind: "ignored" };
}

/**
 * One notification → the normalised event, or null (not one of ours, or unusable). Only public data is kept: display names, amounts, tiers, counts, the viewer's public message.
 * Shape: { kind, name?, login?, anonymous?, tier?, months?, streak?, count?, cumulative?, amount?, viewers?, text?, title?, level?, total?, goal?, progress?, trainType?, shared?, top?, gifted?, at }.
 * `deliveredAt`: the Twitch-Eventsub-Message-Timestamp, used when the event carries no date of its own.
 */
export function normalise(subType, event, deliveredAt) {
  if (!event || typeof event !== "object") return null;
  const e = event, at0 = ms(deliveredAt);
  const who = (anon = false) => (anon ? {} : { name: clean(e.user_name, NAME) || clean(e.user_login, NAME), login: login(e.user_login) });
  const out = (o, at) => ({ ...o, at: at ?? at0 ?? Date.now() });
  switch (subType) {
    case "channel.follow": { const o = who(); return o.name ? out({ kind: "follow", ...o }, ms(e.followed_at)) : null; }
    case "channel.subscribe": { const o = who(); return o.name ? out({ kind: "sub", ...o, tier: tierOf(e.tier), ...(e.is_gift === true ? { gifted: true } : {}) }) : null; }
    case "channel.subscription.message": {
      const o = who(); if (!o.name) return null;
      return out({ kind: "resub", ...o, tier: tierOf(e.tier), months: int(e.cumulative_months, 0, 10_000), streak: int(e.streak_months, 0, 10_000), text: clean(e.message?.text, TEXT) });
    }
    case "channel.subscription.gift": {
      const anon = e.is_anonymous === true || !e.user_name, n = int(e.total, 1, 10_000);
      if (!n) return null;
      return out({ kind: "gift", anonymous: anon, ...who(anon), tier: tierOf(e.tier), count: n, cumulative: int(e.cumulative_total, 0, 1_000_000) });
    }
    case "channel.cheer": {
      const anon = e.is_anonymous === true || !e.user_name, bits = int(e.bits, 1, 1_000_000_000);
      if (!bits) return null;
      return out({ kind: "cheer", anonymous: anon, ...who(anon), amount: bits, text: clean(e.message, TEXT) });
    }
    case "channel.raid": {
      const name = clean(e.from_broadcaster_user_name, NAME) || clean(e.from_broadcaster_user_login, NAME);
      return name ? out({ kind: "raid", name, login: login(e.from_broadcaster_user_login), viewers: int(e.viewers, 0, 10_000_000) ?? 0 }) : null;
    }
    case "stream.online": return out({ kind: "online", name: clean(e.broadcaster_user_name, NAME), login: login(e.broadcaster_user_login), streamType: clean(e.type, 20) || "live" }, ms(e.started_at));
    case "stream.offline": return out({ kind: "offline", name: clean(e.broadcaster_user_name, NAME), login: login(e.broadcaster_user_login) });
    case "channel.hype_train.begin": case "channel.hype_train.progress": case "channel.hype_train.end": {
      const phase = subType.split(".").pop();
      const top = (Array.isArray(e.top_contributions) ? e.top_contributions : []).slice(0, 3).map((c) => ({ name: clean(c?.user_name, NAME), kind: ["bits", "subscription", "other"].includes(c?.type) ? c.type : "other", total: int(c?.total, 0, 1_000_000_000) ?? 0 })).filter((c) => c.name);
      return out({
        kind: `hype_${phase}`, level: int(e.level, 1, 200) ?? 1, total: int(e.total, 0, 1_000_000_000) ?? 0, ...(phase !== "end" ? { goal: int(e.goal, 0, 1_000_000_000) ?? 0, progress: int(e.progress, 0, 1_000_000_000) ?? 0 } : {}),
        trainType: ["regular", "golden_kappa", "treasure"].includes(e.type) ? e.type : "regular", shared: e.is_shared_train === true, ...(top.length ? { top } : {}),
        ...(phase === "begin" && int(e.all_time_high_level, 0, 200) ? { bestLevel: int(e.all_time_high_level, 0, 200) } : {}),
      }, phase === "end" ? ms(e.ended_at) : phase === "begin" ? ms(e.started_at) : null);
    }
    case "channel.channel_points_custom_reward_redemption.add": {
      const o = who(); if (!o.name) return null;
      return out({ kind: "redeem", ...o, title: clean(e.reward?.title, 80), amount: int(e.reward?.cost, 0, 1_000_000_000) ?? 0, text: clean(e.user_input, 200) }, ms(e.redeemed_at));
    }
    default: return null;
  }
}

/* ───────────── Subscriptions (create, read, delete) ───────────── */

export const webhookPath = (instanceKey) => `/m/${instanceKey}/webhook`;
export const listRequest = (after) => ({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { first: 100, ...(after ? { after } : {}) } });
export const createRequest = ({ type, version, condition }, { callback, secret }) => ({ as: "app", method: "POST", path: "eventsub/subscriptions", body: { type, version, condition, transport: { method: "webhook", callback, secret } } });
export const deleteRequest = (id) => ({ as: "app", method: "DELETE", path: "eventsub/subscriptions", query: { id } });
const sameCondition = (a, b) => { const x = a ?? {}, y = b ?? {}, kx = Object.keys(x).sort(), ky = Object.keys(y).sort(); return kx.length === ky.length && kx.every((k, i) => k === ky[i] && String(x[k]) === String(y[k])); };

/**
 * Among the subscriptions of the Twitch application, which are ours (same callback address), and how is each wanted one doing?
 * Returns { wanted: [{ ...want, state: "enabled" | "pending" | "failed" | "missing", id?, status? }], stale: [ids to delete], total }.
 * `stale`: ours that nobody wants any more (type switched off, other channel), duplicates, and failed ones (Twitch cuts a subscription after repeated failures; it is recreated).
 */
export function classify(rows, wanted, callback) {
  const mine = (Array.isArray(rows) ? rows : []).filter((s) => s && s.transport?.method === "webhook" && s.transport?.callback === callback);
  const out = [], keepIds = new Set();
  for (const w of wanted) {
    const same = mine.filter((s) => s.type === w.type && String(s.version) === w.version && sameCondition(s.condition, w.condition));
    const good = same.find((s) => s.status === "enabled"), pending = same.find((s) => s.status === "webhook_callback_verification_pending");
    const keep = good ?? pending;
    // `elsewhere`: another subscription of the same application (another callback address, for instance the Twitch bot's) already covers this type and condition.
    const elsewhere = (Array.isArray(rows) ? rows : []).some((s) => s && s.transport?.callback !== callback && s.type === w.type && String(s.version) === w.version && sameCondition(s.condition, w.condition));
    if (keep) { keepIds.add(String(keep.id)); out.push({ ...w, state: good ? "enabled" : "pending", id: String(keep.id), status: String(keep.status), createdAt: Date.parse(keep.created_at) || null, ...(elsewhere ? { elsewhere } : {}) }); }
    else if (same.length) out.push({ ...w, state: "failed", status: String(same[0].status ?? "") });
    else out.push({ ...w, state: "missing", ...(elsewhere ? { elsewhere } : {}) });
  }
  return { wanted: out, stale: mine.filter((s) => !keepIds.has(String(s.id))).map((s) => String(s.id)), total: mine.length };
}

/** Why Twitch cut a subscription, as a code the page can explain. */
export function failureCode(status) {
  const s = String(status ?? "");
  if (/authorization_revoked|user_removed/.test(s)) return "revoked";
  if (/notification_failures_exceeded|webhook_callback_verification_failed/.test(s)) return "unreachable";
  return "other";
}

/** The answer to a creation: { ok: true, id } | { ok: false, code: "exists" | "denied" | "refused" | "busy" | "twitch", detail? }. */
export function readCreate(res) {
  if (res.status === 202 || res.status === 200) { const id = res.json?.data?.[0]?.id; return typeof id === "string" ? { ok: true, id } : { ok: false, code: "twitch" }; }
  if (res.status === 409) return { ok: false, code: "exists" };
  if (res.status === 401 || res.status === 403) return { ok: false, code: "denied" };
  if (res.status === 429) return { ok: false, code: "busy" };
  if (res.status >= 400 && res.status < 500) return { ok: false, code: "refused", detail: clean(res.json?.message, 200) };
  return { ok: false, code: "twitch" };
}

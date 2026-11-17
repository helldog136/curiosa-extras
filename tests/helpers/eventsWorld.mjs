// The fake world of the Twitch part of the alerts overlay (1.18.0, formerly the module Twitch activity): a site with the Twitch connector (channel "emma_test", user id 100)
// and a FAKE TWITCH that signs its deliveries exactly like the real one. `mod` is the overlay's module (index.mjs); the files of the Twitch part are in alerts-overlay/twitch/.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

const DIR = new URL("../../modules/alerts-overlay", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
export const manifest = readJson("module.json");
export const es = await import("../../modules/alerts-overlay/twitch/eventsub.mjs");
export const S = await import("../../modules/alerts-overlay/twitch/state.mjs");
export const W = await import("../../modules/alerts-overlay/twitch/webhook.mjs");
export const L = await import("../../modules/alerts-overlay/twitch/listen.mjs");
export const P = await import("../../modules/alerts-overlay/twitch/publish.mjs");
export const D = await import("../../modules/alerts-overlay/twitch/dockapi.mjs");
export const DK = await import("../../modules/alerts-overlay/twitch/dock.mjs");
export const DP = await import("../../modules/alerts-overlay/twitch/dockpure.mjs");
export const A = await import("../../modules/alerts-overlay/twitch/admin.mjs");
export const C = await import("../../modules/alerts-overlay/twitch/cycle.mjs");
export const CU = await import("../../modules/alerts-overlay/twitch/catchup.mjs");
export const HE = await import("../../modules/alerts-overlay/twitch/health.mjs");
export const O = await import("../../modules/alerts-overlay/twitch/settings.mjs");
export const AO = await import("../../modules/alerts-overlay/options.mjs");
export const mod = (await import("../../modules/alerts-overlay/index.mjs")).default;
/** (1.18.0) The queue of the overlay is this module's own (alerts-overlay/twitch.mjs): the dock no longer calls a service. */
export const TWO = await import("../../modules/alerts-overlay/twitch.mjs");
/** Seeds the queue of the overlay copy of `ctx`: `held` alerts waiting, the viewer `texts` flagged, the voice (`on` is the setting of the voice, `muted` the dock's switch). */
export async function seedQueue(ctx, { held = 0, texts = [], voice = null } = {}) {
  const s = await TWO.loadState(ctx);
  s.held = Array.from({ length: held }, (_, i) => ({ kind: "follow", message: `held ${i}`, queued: true, id: `h${i}` }));
  s.texts = texts.map((x) => ({ ...x }));
  if (voice) { s.ttsMuted = voice.muted === true; const cfg = await TWO.loadConfig(ctx); await TWO.saveConfig(ctx, { ...cfg, tts: { ...cfg.tts, on: voice.on === true } }); }
  return s;
}

export const NOW = Date.parse("2026-11-12T20:00:00Z");
export const B = "100";
const ALL = ["moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:hype_train", "channel:read:redemptions"];

/**
 * Twitch lists EVERY condition field of a type and fills the unused ones with "" (recorded shape, e.g. channel.raid { from_broadcaster_user_id: "", to_broadcaster_user_id: "100" }).
 * The fake does the same: a fake that stored the condition as sent hid the bug where raid and channel points never matched.
 */
export const FULL_CONDITION = {
  "channel.raid": ["from_broadcaster_user_id", "to_broadcaster_user_id"],
  "channel.channel_points_custom_reward_redemption.add": ["broadcaster_user_id", "reward_id"],
  "channel.follow": ["broadcaster_user_id", "moderator_user_id"],
};
export const twitchCondition = (type, c) => Object.fromEntries((FULL_CONDITION[type] ?? Object.keys(c)).map((k) => [k, c[k] === undefined ? "" : String(c[k])]));

/**
 * `o.scopes`: permissions granted to the account; `o.status`: "ok" | "reconnect" | "none"; `o.siteUrl`; `o.locale`; `o.settings`.
 * (1.18.0, for the upgrade tests) `o.key`, `o.moduleId`, `o.manifest`, `o.messages` (another module on the same site), `o.twFake` (the SAME fake Twitch as another world),
 * `o.keepMemory` (no reset of the in-memory states), `o.legacy` (settings of an older version, `ctx.legacy`).
 */
export function world(o = {}) {
  if (!o.keepMemory) { S.resetMemory(); P.forgetCache(); O.resetOptions(); AO.resetOptions(); TWO.resetTwitchState(); }
  const tw = o.twFake ?? { status: "ok", scopes: [...ALL], subs: [], calls: [], wants: [], links: [], createStatus: 202, listDown: false, seq: 0, ...o.tw };
  const man = o.manifest ?? manifest;
  const queue = { paused: false, held: 0, calls: [], voice: { on: false, muted: false }, texts: [], ...o.queue };
  const ctx = fakeCtx({
    key: o.key ?? "ev", moduleId: o.moduleId ?? "alerts-overlay", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: o.messages ?? ((o.locale ?? "fr") === "en" ? en : fr), ...(o.legacy ? { legacy: o.legacy } : {}),
    mailConfigured: o.mailConfigured !== false, settings: { retentionDays: 30, ...o.settings }, siteUrl: o.siteUrl ?? "https://site.example.org", timezone: "Europe/Paris", permissions: o.permissions ?? man.permissions, requires: man.requires, installedModules: o.installedModules, ...(o.person !== undefined ? { person: o.person } : {}), ...(o.uploads ? { uploads: o.uploads } : {}), logEvents: man.logEvents ?? [],
    ...(o.services ? { services: o.services } : {}),
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => (a?.channel && a.channel !== "emma_test" ? { ok: false, error: "other_channel" } : { ok: true, channel: "emma_test", ready: true, https: true, status: tw.status, login: "emma_test", userId: B, scopes: tw.scopes, adminPath: "/admin/instances/connector" }),
        status: () => ({ ready: true, missing: [] }),
        wantScopes: (a) => { tw.wants.push(a); return { ok: true }; },
        // Like the real connector: no link when it believes all is fine (it only knows what was declared with wantScopes) unless `force`; `scopes` add to what is wanted.
        connectLink: (a) => {
          tw.links.push(a);
          const wanted = [...new Set([...tw.wants.flatMap((w) => w.scopes ?? []), ...(a?.scopes ?? [])])].sort();
          const more = wanted.some((x) => !tw.scopes.includes(x));
          if (tw.status === "ok" && !more && a?.force !== true) return { ok: true, url: null, reason: "connected" };
          return { ok: true, url: `https://id.twitch.tv/oauth2/authorize?x=1&scope=${encodeURIComponent([...new Set([...tw.scopes, ...wanted])].sort().join(" "))}` };
        },
        request: (a) => {
          if (a.channel && a.channel !== "emma_test") return { ok: false, error: "other_channel" };
          tw.calls.push(a);
          if (a.path === "channels/followers") return tw.helixDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.followers ?? [], pagination: {} } };
          if (a.path === "subscriptions") return tw.helixDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subscribers ?? [], pagination: {}, total: (tw.subscribers ?? []).length } };
          // (1.12.0) the rewards of the channel: the fake Twitch of the rewards (fakeRewards.mjs) behind the connector's own permission check, with THIS account's permissions
          if (a.path.startsWith("channel_points/custom_rewards") && tw.rewardsApi) { tw.rewardsApi.state.scopes = tw.scopes; return tw.rewardsApi.request(a); }
          if (a.path !== "eventsub/subscriptions") return { ok: false, error: "forbidden" };
          if (a.method === "GET") return tw.listDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subs } };
          if (a.method === "DELETE") { const id = [].concat(a.query.id)[0]; tw.subs = tw.subs.filter((s) => s.id !== id); return { ok: true, status: 204, json: null }; }
          if (a.method === "POST") {
            if (tw.createStatus !== 202) return { ok: true, status: tw.createStatus, json: { error: "Error", status: tw.createStatus, message: tw.createMessage ?? "nope" } };
            const condition = twitchCondition(a.body.type, a.body.condition);
            // Twitch refuses a second subscription of the same application with the same type, version and condition (409), whatever the callback address.
            if (tw.subs.some((x) => x.type === a.body.type && String(x.version) === String(a.body.version) && JSON.stringify(x.condition) === JSON.stringify(condition))) return { ok: true, status: 409, json: { error: "Conflict", status: 409, message: "subscription already exists" } };
            const sub = { id: `sub${++tw.seq}`, status: tw.autoEnable && !(tw.neverVerify ?? []).includes(a.body.type) ? "enabled" : "webhook_callback_verification_pending", type: a.body.type, version: a.body.version, condition, transport: { method: "webhook", callback: a.body.transport.callback }, created_at: new Date(tw.clock?.() ?? Date.now()).toISOString(), cost: 1 };
            tw.subs.push(sub); tw.lastSecret = a.body.transport.secret;
            return { ok: true, status: 202, json: { data: [sub] } };
          }
          return { ok: false, error: "forbidden" };
        },
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { channel: () => ({ channel: "emma_test", ready: true }) } }],
      ...(o.extraServices ?? {}),
      ...(o.alerts ? { "alerts.queue": [{ instance: "alerts", name: "Alerts", methods: {
        state: () => ({ paused: queue.paused, held: queue.held, staged: 0 }),
        pause: () => { queue.calls.push("pause"); queue.paused = true; return { paused: true, held: queue.held }; },
        resume: () => { queue.calls.push("resume"); const released = queue.held; queue.paused = false; queue.held = 0; return { paused: false, released }; },
        clear: () => { queue.calls.push("clear"); const dropped = queue.held; queue.held = 0; return { cleared: true, dropped }; },
        // the voice and the texts of viewers exist only in an overlay of version 2 (`o.voice`)
        ...(o.voice ? {
          voice: () => ({ ...queue.voice, pending: queue.texts.length }),
          mute: (a) => { queue.calls.push(`mute:${a.muted}`); queue.voice.muted = a.muted === true; return { ...queue.voice }; },
          voiceOn: (a) => { queue.calls.push(`voiceOn:${a.on}`); queue.voice.on = a.on === true; return { ...queue.voice }; },
          stopSpeech: () => { queue.calls.push("stopSpeech"); return { stopped: true }; },
          skip: () => { queue.calls.push("skip"); return { skipped: true }; },
          texts: () => queue.texts.slice(),
          decide: (a) => { queue.calls.push(`decide:${a.action}:${a.id}`); const i = queue.texts.findIndex((x) => x.id === a.id); if (i < 0) return { ok: false, code: "unknown" }; queue.texts.splice(i, 1); return { ok: true, action: a.action }; },
        } : {}),
      } }] } : {}),
    },
    instances: o.instances ?? (o.alerts ? [{ id: "i1", key: "alerts", module: "alerts-overlay", name: "Alerts", adminPath: "/admin/instances/alerts" }] : []),
  });
  return { ctx, tw, queue };
}

/** A delivery from the fake Twitch, signed with the secret the module gave it. */
export async function deliver(ctx, subType, event, { id = `m-${Math.random().toString(36).slice(2)}`, at = NOW, version = "1", messageType = "notification", secret, badSig = false, now = NOW } = {}) {
  const sec = secret ?? (await S.readState(ctx)).secret;
  const body = JSON.stringify(messageType === "notification" ? { subscription: { id: "s1", type: subType, version, status: "enabled" }, event } : messageType === "revocation" ? { subscription: { id: "s1", type: subType, status: event } } : { challenge: event, subscription: { type: subType } });
  const ts = new Date(at).toISOString();
  const headers = { "twitch-eventsub-message-id": id, "twitch-eventsub-message-type": messageType, "twitch-eventsub-message-timestamp": ts, "twitch-eventsub-message-signature": badSig ? "sha256=00" : es.sign(sec, id, ts, body) };
  const r = await W.handle(new Request("https://site.example.org/m/ev/webhook", { method: "POST", headers, body }), ctx, { now });
  await r.done;
  return { status: r.response.status, text: await r.response.text(), id };
}

/** Events as Twitch sends them (invented names). */
export const EV = {
  follow: { user_id: "7", user_login: "etoile_nord", user_name: "Etoile_Nord", broadcaster_user_id: B, broadcaster_user_login: "emma_test", broadcaster_user_name: "Emma_Test", followed_at: "2026-11-12T19:59:00Z" },
  sub: { user_id: "8", user_login: "lune_douce", user_name: "Lune_Douce", broadcaster_user_id: B, tier: "2000", is_gift: false },
  giftedSub: { user_id: "9", user_login: "camille", user_name: "Camille", broadcaster_user_id: B, tier: "1000", is_gift: true },
  resub: { user_id: "8", user_login: "lune_douce", user_name: "Lune_Douce", broadcaster_user_id: B, tier: "1000", message: { text: "Thank you‮ <b>all</b>\u0007", emotes: [] }, cumulative_months: 12, streak_months: 6, duration_months: 1 },
  gift: { user_id: "7", user_login: "etoile_nord", user_name: "Etoile_Nord", broadcaster_user_id: B, total: 25, tier: "1000", cumulative_total: 100, is_anonymous: false },
  anonGift: { user_id: null, user_login: null, user_name: null, broadcaster_user_id: B, total: 5, tier: "1000", cumulative_total: null, is_anonymous: true },
  cheer: { is_anonymous: false, user_id: "7", user_login: "etoile_nord", user_name: "Etoile_Nord", broadcaster_user_id: B, message: "Cheer500 go", bits: 500 },
  raid: { from_broadcaster_user_id: "55", from_broadcaster_user_login: "lune_douce", from_broadcaster_user_name: "Lune_Douce", to_broadcaster_user_id: B, to_broadcaster_user_login: "emma_test", to_broadcaster_user_name: "Emma_Test", viewers: 120 },
  online: { id: "9001", broadcaster_user_id: B, broadcaster_user_login: "emma_test", broadcaster_user_name: "Emma_Test", type: "live", started_at: "2026-11-12T19:00:00Z" },
  offline: { broadcaster_user_id: B, broadcaster_user_login: "emma_test", broadcaster_user_name: "Emma_Test" },
  hypeBegin: { id: "h1", broadcaster_user_id: B, level: 1, total: 600, progress: 600, goal: 1800, top_contributions: [{ user_id: "7", user_login: "etoile_nord", user_name: "Etoile_Nord", type: "bits", total: 300 }], started_at: "2026-11-12T19:30:00Z", expires_at: "2026-11-12T19:35:00Z", all_time_high_level: 4, all_time_high_total: 9000, is_shared_train: false, type: "regular" },
  hypeProgress: (level) => ({ id: "h1", broadcaster_user_id: B, level, total: 600 * level, progress: 100, goal: 2000, top_contributions: [], started_at: "2026-11-12T19:30:00Z", expires_at: "2026-11-12T19:35:00Z", is_shared_train: false, type: "regular" }),
  // (1.12.0) a redemption as Twitch sends it (channel.channel_points_custom_reward_redemption.add v1): the reward with its id, title, cost and prompt
  redeem: (reward = { id: "92af127c-7326-4483-a52b-b0da0be61c01", title: "Hydrate", cost: 500, prompt: "Drink some water" }, input = "") => ({ id: "17fa2df1-ad76-4804-bfa5-a40ef63efe63", broadcaster_user_id: B, broadcaster_user_login: "emma_test", broadcaster_user_name: "Emma_Test", user_id: "8", user_login: "lune_douce", user_name: "Lune_Douce", user_input: input, status: "unfulfilled", reward, redeemed_at: "2026-11-12T19:59:30Z" }),
  hypeEnd: { id: "h1", broadcaster_user_id: B, level: 3, total: 5000, top_contributions: [], started_at: "2026-11-12T19:30:00Z", ended_at: "2026-11-12T19:40:00Z", cooldown_ends_at: "2026-11-12T20:40:00Z", is_shared_train: false, type: "regular" },
};
export const TYPES = { follow: "channel.follow", sub: "channel.subscribe", resub: "channel.subscription.message", gift: "channel.subscription.gift", cheer: "channel.cheer", raid: "channel.raid", online: "stream.online", offline: "stream.offline" };

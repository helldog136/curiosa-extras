// The fake world of Twitch activity: a site with the Twitch connector (channel "emma_test", user id 100) and a FAKE TWITCH that signs its deliveries exactly like the real one.
import fs from "node:fs";
import { fakeCtx } from "./fakeCtx.mjs";

const DIR = new URL("../../modules/twitch-events", import.meta.url).pathname;
const readJson = (p) => JSON.parse(fs.readFileSync(`${DIR}/${p}`, "utf8"));
export const fr = readJson("locales/fr.json"), en = readJson("locales/en.json");
export const manifest = readJson("module.json");
export const es = await import("../../modules/twitch-events/eventsub.mjs");
export const S = await import("../../modules/twitch-events/state.mjs");
export const W = await import("../../modules/twitch-events/webhook.mjs");
export const L = await import("../../modules/twitch-events/listen.mjs");
export const P = await import("../../modules/twitch-events/publish.mjs");
export const D = await import("../../modules/twitch-events/dockapi.mjs");
export const DK = await import("../../modules/twitch-events/dock.mjs");
export const DP = await import("../../modules/twitch-events/dockpure.mjs");
export const A = await import("../../modules/twitch-events/admin.mjs");
export const C = await import("../../modules/twitch-events/cycle.mjs");
export const CU = await import("../../modules/twitch-events/catchup.mjs");
export const HE = await import("../../modules/twitch-events/health.mjs");
export const mod = (await import("../../modules/twitch-events/index.mjs")).default;

export const NOW = Date.parse("2026-11-12T20:00:00Z");
export const B = "100";
const ALL = ["moderator:read:followers", "channel:read:subscriptions", "bits:read", "channel:read:hype_train", "channel:read:redemptions"];

/** `o.scopes`: permissions granted to the account; `o.status`: "ok" | "reconnect" | "none"; `o.siteUrl`; `o.locale`; `o.settings`. */
export function world(o = {}) {
  S.resetMemory(); P.forgetCache();
  const tw = { status: "ok", scopes: [...ALL], subs: [], calls: [], wants: [], createStatus: 202, listDown: false, seq: 0, ...o.tw };
  const queue = { paused: false, held: 0, calls: [], voice: { on: false, muted: false }, texts: [], ...o.queue };
  const ctx = fakeCtx({
    key: "ev", moduleId: "twitch-events", locale: o.locale ?? "fr", defaultLocale: "fr", locales: ["fr", "en"], messages: (o.locale ?? "fr") === "en" ? en : fr,
    mailConfigured: o.mailConfigured !== false, settings: { retentionDays: 30, ...o.settings }, siteUrl: o.siteUrl ?? "https://site.example.org", timezone: "Europe/Paris", permissions: manifest.permissions,
    serviceInstances: {
      "twitch.api": [{ instance: "emma", name: "emma", methods: {
        account: (a) => (a?.channel && a.channel !== "emma_test" ? { ok: false, error: "other_channel" } : { ok: true, channel: "emma_test", ready: true, https: true, status: tw.status, login: "emma_test", userId: B, scopes: tw.scopes, adminPath: "/admin/instances/connector" }),
        status: () => ({ ready: true, missing: [] }),
        wantScopes: (a) => { tw.wants.push(a); return { ok: true }; },
        connectLink: () => ({ ok: true, url: "https://id.twitch.tv/oauth2/authorize?x=1" }),
        request: (a) => {
          if (a.channel && a.channel !== "emma_test") return { ok: false, error: "other_channel" };
          tw.calls.push(a);
          if (a.path === "channels/followers") return tw.helixDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.followers ?? [], pagination: {} } };
          if (a.path === "subscriptions") return tw.helixDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subscribers ?? [], pagination: {}, total: (tw.subscribers ?? []).length } };
          if (a.path !== "eventsub/subscriptions") return { ok: false, error: "forbidden" };
          if (a.method === "GET") return tw.listDown ? { ok: false, error: "network" } : { ok: true, status: 200, json: { data: tw.subs } };
          if (a.method === "DELETE") { const id = [].concat(a.query.id)[0]; tw.subs = tw.subs.filter((s) => s.id !== id); return { ok: true, status: 204, json: null }; }
          if (a.method === "POST") {
            if (tw.createStatus !== 202) return { ok: true, status: tw.createStatus, json: { message: "nope" } };
            const sub = { id: `sub${++tw.seq}`, status: tw.autoEnable ? "enabled" : "webhook_callback_verification_pending", type: a.body.type, version: a.body.version, condition: a.body.condition, transport: { method: "webhook", callback: a.body.transport.callback } };
            tw.subs.push(sub); tw.lastSecret = a.body.transport.secret;
            return { ok: true, status: 202, json: { data: [sub] } };
          }
          return { ok: false, error: "forbidden" };
        },
      } }],
      "twitch.live": [{ instance: "emma", name: "emma", methods: { channel: () => ({ channel: "emma_test", ready: true }) } }],
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
    instances: o.alerts ? [{ id: "i1", key: "alerts", module: "alerts-overlay", name: "Alerts", adminPath: "/admin/instances/alerts" }] : [],
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
  hypeEnd: { id: "h1", broadcaster_user_id: B, level: 3, total: 5000, top_contributions: [], started_at: "2026-11-12T19:30:00Z", ended_at: "2026-11-12T19:40:00Z", cooldown_ends_at: "2026-11-12T20:40:00Z", is_shared_train: false, type: "regular" },
};
export const TYPES = { follow: "channel.follow", sub: "channel.subscribe", resub: "channel.subscription.message", gift: "channel.subscription.gift", cheer: "channel.cheer", raid: "channel.raid", online: "stream.online", offline: "stream.offline" };

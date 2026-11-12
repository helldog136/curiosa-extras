// Which Twitch channel of the site this module serves. The setting "channel" is a CHOICE among the instances of My Twitch channel (service `twitch.live`); with a single channel the core
// hides the setting and resolves it itself. This file turns that choice into a Twitch login, which the Twitch connector (service `twitch.api`) then uses (`account({ channel })`).
// Every wait is bounded: a slow neighbour never holds up the admin page or the webhook.
export const LIVE = "twitch.live", API = "twitch.api";
export const timing = { choiceMs: 3500, callMs: 2500 };
const LOGIN = /^[a-z0-9_]{3,25}$/;
const text = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, "").trim().slice(0, 200) : "");
export const loginOf = (v) => { const s = text(v).toLowerCase().replace(/^@/, ""); return LOGIN.test(s) ? s : ""; };

function within(p, ms, fallback) {
  let t;
  return Promise.race([Promise.resolve().then(() => p).catch(() => fallback), new Promise((r) => { t = setTimeout(() => r(fallback), ms); t.unref?.(); })]).finally(() => clearTimeout(t));
}
async function choice(ctx) {
  if (typeof ctx.resolveChoice !== "function") return { status: "unverified" };
  const r = await within(ctx.resolveChoice("channel"), timing.choiceMs, null);
  return r && typeof r === "object" && typeof r.status === "string" ? r : { status: "unverified" };
}
async function channelOfInstance(ctx, id) {
  if (!id) return null;
  const r = await within(ctx.api.services.call(LIVE, "channel", {}, { provider: id }), timing.callMs, null);
  return r?.ok && r.value && typeof r.value === "object" ? loginOf(r.value.channel) : null;
}
async function allChannels(ctx) {
  if (typeof ctx.api.services.callAll !== "function") return [];
  const answers = await within(ctx.api.services.callAll(LIVE, "channel", {}), timing.callMs, []);
  return (Array.isArray(answers) ? answers : []).filter((r) => r?.ok && r.value).map((r) => ({ channel: loginOf(r.value.channel), ready: r.value.ready === true })).filter((x) => x.channel);
}
/** The answer of the Twitch connector to `method(args)`, or null (absent, mute, failing). Bounded, never throws. */
export async function firstAnswer(ctx, method, args, ms = timing.callMs) {
  if (typeof ctx.api.services.callAll !== "function") {
    const r = await within(ctx.api.services.call(API, method, args), ms, null);
    return r?.ok && r.value && typeof r.value === "object" && r.value.ok !== false ? r.value : null;
  }
  const answers = await within(ctx.api.services.callAll(API, method, args), ms, null);
  const r = (Array.isArray(answers) ? answers : []).find((x) => x?.ok && x.value && typeof x.value === "object" && x.value.ok !== false && x.value.error !== "other_channel");
  return r ? r.value : null;
}
export const firstAccount = (ctx, args, ms = timing.callMs) => firstAnswer(ctx, "account", args, ms);

/** { channel } or { problem: "no_channel" | "channel_unknown" | "slow" | "setup" (with `account`) }. Never throws. */
export async function resolveChannel(ctx, wanted = ctx.setting("channel")) {
  const raw = text(wanted);
  const r = await choice(ctx);
  if ((r.status === "chosen" || r.status === "only") && r.id) {
    const c = await channelOfInstance(ctx, r.id);
    return c ? { channel: c } : { problem: c === null ? "slow" : "no_channel" };
  }
  if (raw) {
    const login = loginOf(raw);
    if (login && (await allChannels(ctx)).some((x) => x.channel === login)) return { channel: login };
    return { problem: r.status === "unverified" ? "slow" : "channel_unknown" };
  }
  const all = await allChannels(ctx);
  const first = all.find((x) => x.ready) ?? all[0];
  if (first) return { channel: first.channel };
  const acc = await firstAccount(ctx, {});
  const known = acc ? loginOf(acc.channel) : "";
  if (known) return { channel: known };
  if (!acc) return { problem: "no_channel" };
  const st = await firstAnswer(ctx, "status", {});
  return st?.ready === true ? { problem: "no_channel" } : { problem: "setup", account: acc };
}

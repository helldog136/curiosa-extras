// Health: is the listening really working, and does the owner know when it is not? Reuses what the site already has: the badge of the administration (adminBadge), the status of
// the assistant (twitch_events_status) and the e-mail to the owner (`ctx.api.mail`, "owner"): nothing new is built. The mail is sent once per problem (again after 24 hours if it is
// still there), only for something that WORKED before (a fresh install is not a "problem"), and once more when everything is back. A short problem makes no noise (grace delay).
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files (otherwise the old code would stay cached after an update)
const st = await import(`./state.mjs${v}`);

export const GRACE_MS = { default: 10 * 60_000, twitch_down: 30 * 60_000, slow: 30 * 60_000, need_more: 24 * 3_600_000, silent: 0 };
export const REPEAT_MS = 24 * 3_600_000;
const PROBLEMS = ["need_reconnect", "need_connect", "creds_missing", "site_private", "refused", "twitch_down", "twitch_busy", "no_channel", "channel_unknown", "slow", "need_more", "revoked"];

/** Live for a while without any event: the stream is probably quiet, but also what a dropped listening looks like. `silentHours` 0 = never. */
export function silent(state, { silentHours }, now = Date.now()) {
  if (!silentHours || typeof state.liveSince !== "number" || !state.liveSince) return false;
  return now - Math.max(state.lastEventAt ?? 0, state.liveSince) > silentHours * 3_600_000;
}
/** The one code that describes the situation now: a problem of the listening, "silent", or "ok". */
export function assess(state, s, now = Date.now()) {
  const code = state.listen?.code ?? "unknown";
  if (PROBLEMS.includes(code)) return code;
  if (code === "listening" && silent(state, s, now)) return "silent";
  return "ok";
}

/**
 * Updates `state.health` and sends the mail when it is time. Returns { code, mailed: "problem" | "back" | null, mail: "sent" | "off" | "failed" | null }. Never throws.
 * `mail`: "off" = no mail server set up (the page then says so).
 */
export async function run(ctx, s, now = Date.now()) {
  const out = { code: "ok", mailed: null, mail: null };
  try {
    const state = await st.readState(ctx);
    const code = assess(state, s, now);
    out.code = code;
    const worked = !!state.okAt;
    const problem = code !== "ok" && (worked || code === "silent");
    const h = state.health ?? null;
    if (!problem) {
      if (h?.notified) { out.mailed = "back"; out.mail = await send(ctx, s, "back", { since: h.since }, now); }
      if (h) await st.updateState(ctx, (x) => { delete x.health; });
      return out;
    }
    const same = h && h.code === code;
    const since = same ? h.since : now;
    const due = now - since >= (GRACE_MS[code] ?? GRACE_MS.default) && (!h?.notified || h.notified.code !== code || now - h.notified.at >= REPEAT_MS);
    let notified = same ? h.notified ?? null : null;
    if (due && s.healthMail) {
      out.mailed = "problem"; out.mail = await send(ctx, s, "problem", { code, since }, now);
      if (out.mail === "sent") notified = { code, at: now };
    }
    await st.updateState(ctx, (x) => { x.health = { code, since, ...(notified ? { notified } : {}), ...(out.mail && out.mail !== "sent" ? { mail: out.mail } : {}) }; });
  } catch { /* the health never breaks the listening */ }
  return out;
}

const fmt = (ctx, at) => new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone });
/** One mail to the owner of the site. */
async function send(ctx, s, kind, info, now) {
  let configured = false;
  try { configured = typeof ctx.api.mail?.configured === "function" ? await ctx.api.mail.configured() : false; } catch { configured = false; }
  if (!configured) return "off";
  const link = `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/admin/instances/${ctx.instance.id}`;
  const t = ctx.t;
  const what = kind === "problem" ? (info.code === "silent" ? t("health_silent", { n: s.silentHours }) : t(`listen_${info.code}`, { detail: "" })) : "";
  const subject = t(kind === "problem" ? "mail_subject_problem" : "mail_subject_back");
  const text = kind === "problem" ? t("mail_body_problem", { what, since: fmt(ctx, info.since), link }) : t("mail_body_back", { since: fmt(ctx, info.since ?? now), link });
  try { const r = await ctx.api.mail.send({ to: "owner", subject, text }); return r === false || r?.ok === false ? "failed" : "sent"; } catch { return "failed"; }
}

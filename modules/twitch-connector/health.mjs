// Health of the connected Twitch accounts: does the authorization still WORK, not only "does a token exist".
//
// A connection document carries `health: { state, since, checkedAt, missing?, need?, reason?, notified? }`:
//   state   "ok" | "renew" (Twitch no longer accepts the authorization: revoked, expired, password changed, application changed)
//           | "scopes" (the authorization works but lacks a permission a module needs) | "app" (Twitch refuses the application ID or secret)
//   need    permissions that a module tried to use and found missing (kept until a new authorization grants them)
// The state is established by REAL calls and recorded at the first sign of trouble:
//   - verify()  asks Twitch (validate endpoint, refresh when needed): when a settings page opens, from the periodic task, and when a module reports a failure;
//   - record()  is called by the request path (helix.mjs) when a call is refused: 401 twice, refresh refused, permission missing.
// Every state CHANGE writes one line to the site log (no secret, no viewer data). The owner is told by e-mail once per problem after a grace delay and once when
// all is back, never when the setting is off. Nothing here ever throws into a caller; no token leaves this module.
const v = new URL(import.meta.url).search; // the version of the module spreads to the neighbour files
const oauth = await import(`./oauth.mjs${v}`);
const store = await import(`./store.mjs${v}`);

/** Milliseconds, in an object so that tests can shorten them. cacheMs: a check younger than this is reused (page opens); reportMs: same, when a module reports a failure. */
export const timing = { cacheMs: 60_000, reportMs: 10_000 };
export const SWEEP_MS = 10 * 60_000;     // the periodic task re-checks an account at most this often
export const GRACE_MS = 10 * 60_000;     // the owner is mailed only once the problem lasted this long
export const MAIL_RETRY_MS = 60 * 60_000; // a mail that failed is tried again after this long
const PROBLEMS = new Set(["renew", "scopes", "app"]);
export const isProblem = (state) => PROBLEMS.has(state);

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);
const uniq = (list) => [...new Set(list)].sort();

/** The health of a connection document, in the shape services and pages read: { state, since, checkedAt, missing, reason }. */
export function viewOf(doc) {
  const h = doc?.health ?? {};
  const state = isProblem(h.state) ? h.state : doc?.status === "reconnect" ? "renew" : "ok";
  return { state, since: h.since ?? null, checkedAt: h.checkedAt ?? null, missing: [...(h.missing ?? [])], reason: h.reason ?? null };
}

/** Plain words for a list of permissions ("see your followers, see your paying subscribers"). */
export function scopeWords(ctx, list) {
  return (list ?? []).map((s) => { const key = `scope_${String(s).replace(/[^a-z_]/g, "_")}`; const w = ctx.t(key); return w === key ? String(s) : w; }).join(", ");
}

async function writeLog(ctx, doc, prev, next) {
  try {
    const bad = isProblem(next.state);
    await ctx.api.log?.write?.({
      action: bad ? "connection.problem" : "connection.back", target: doc.login ?? "", level: bad ? (next.state === "renew" ? "error" : "warn") : "info",
      data: { state: next.state, ...(bad && next.missing?.length ? { missing: next.missing.join(" ") } : {}), ...(!bad ? { was: prev.state } : {}) },
    });
  } catch { /* the log never breaks a call */ }
}

/**
 * Records what is now known about a connection. `next`: { state, missing?, need?, reason?, scopes? } (`scopes`: the permissions Twitch really grants).
 * Writes the document only when something changed, and one log line when the state changed. Returns the new health, or null when the account is gone.
 */
export function record(ctx, docId, next, now = Date.now()) {
  // one at a time per connection: two parallel requests that fail together must not write the same transition (and the same log line) twice
  const run = (chains.get(docId) ?? Promise.resolve()).then(() => recordNow(ctx, docId, next, now));
  const tail = run.catch(() => {});
  chains.set(docId, tail);
  tail.then(() => { if (chains.get(docId) === tail) chains.delete(docId); });
  return run;
}
const chains = new Map();
async function recordNow(ctx, docId, next, now) {
  try {
    const entry = await ctx.api.store.get(docId);
    const d = entry?.data;
    if (!d) return null;
    const prev = d.health ?? { state: d.status === "reconnect" ? "renew" : "ok" };
    const same = prev.state === next.state;
    const health = { state: next.state, since: same && prev.since ? prev.since : now, checkedAt: now };
    if (next.missing?.length) health.missing = uniq(next.missing);
    const need = uniq(next.need ?? prev.need ?? []);
    if (need.length) health.need = need;
    if (next.reason) health.reason = next.reason;
    if (prev.notified && (same || next.state === "ok")) health.notified = prev.notified;   // kept: a recovery is mailed once, then cleared
    if (same) for (const k of ["mailTry", "mail"]) if (prev[k] !== undefined) health[k] = prev[k];
    const status = next.state === "renew" ? "reconnect" : d.status === "reconnect" && next.state !== "renew" ? "ok" : d.status;
    const data = { ...d, health, status, ...(Array.isArray(next.scopes) ? { scopes: [...next.scopes] } : {}) };
    const unchanged = JSON.stringify({ ...data, health: { ...health, checkedAt: 0 } }) === JSON.stringify({ ...d, health: { ...(d.health ?? {}), checkedAt: 0 } });
    // a check that finds nothing new only refreshes its date, and not on every call
    if (!unchanged || !d.health?.checkedAt || now - d.health.checkedAt > 5 * 60_000) await ctx.api.store.update(docId, data);
    if (!same && (isProblem(next.state) || isProblem(prev.state))) await writeLog(ctx, d, prev, health);
    return health;
  } catch { return null; }
}

/** A module found a permission missing: remember it, so that the page asks for it and the state says it. */
export async function noteScope(ctx, docId, missing, now = Date.now()) {
  const entry = await ctx.api.store.get(docId).catch(() => null);
  if (!entry?.data || viewOf(entry.data).state === "renew") return null;   // a refused authorization is the bigger news
  const need = uniq([...(entry.data.health?.need ?? []), ...missing]);
  return record(ctx, docId, { state: "scopes", missing: need.filter((s) => !(entry.data.scopes ?? []).includes(s)), need }, now);
}

/**
 * Asks Twitch whether the authorization of `entry` ({ id, data }) works and which permissions it grants. `userToken(ctx, creds, id, usedAccess?)` is the token
 * logic of helix.mjs (passed in, to keep the two files independent). Result: the health ({ state, ... }) or { unknown: true, state } when Twitch could not be reached
 * (nothing is recorded: a network failure is not a verdict).
 */
export async function verify(ctx, creds, entry, { userToken, force = false, maxAge = timing.cacheMs, now = Date.now() } = {}) {
  const d = entry.data;
  const known = viewOf(d);
  if (!force && d.health?.checkedAt && now - d.health.checkedAt < maxAge) return known;
  const unknown = () => ({ unknown: true, state: known.state, since: known.since, checkedAt: known.checkedAt, missing: known.missing, reason: known.reason });
  const renew = (reason) => record(ctx, entry.id, { state: "renew", reason }, now);
  const needed = uniq([...(await store.wantedScopes(ctx, d.channel, d.slot)), ...(d.health?.need ?? [])]);

  const reconnect = d.status === "reconnect";
  // refused for good earlier: no refresh any more, but the access token may still be valid (a wrong mark heals itself)
  let t = reconnect ? (d.access && d.clientId === creds.clientId ? { token: d.access } : { error: "auth" }) : await userToken(ctx, creds, entry.id);
  const handled = (e) => (e === "network" || e === "rate" ? unknown() : e === "config" ? record(ctx, entry.id, { state: "app", reason: "refused" }, now) : renew(d.clientId !== creds.clientId ? "app_changed" : "revoked"));
  if (t.error) return handled(t.error);
  let who = await oauth.validate(ctx.api.net, t.token);
  if (who.error === "refused" && !reconnect) {
    t = await userToken(ctx, creds, entry.id, t.token);   // the access token is refused: renew it once, then ask again
    if (t.error) return handled(t.error);
    who = await oauth.validate(ctx.api.net, t.token);
  }
  if (who.error === "network" || who.error === "rate") return unknown();
  if (who.error === "refused") return renew("revoked");
  if (who.clientId !== creds.clientId) return renew("app_changed");
  if (d.userId && who.userId !== d.userId) return renew("other_account");
  const missing = needed.filter((s) => !who.scopes.includes(s));
  const need = (d.health?.need ?? []).filter((s) => !who.scopes.includes(s));
  const health = await record(ctx, entry.id, missing.length ? { state: "scopes", missing, need, scopes: who.scopes } : { state: "ok", need, scopes: who.scopes }, now);
  return health ?? unknown();
}

/** Connections with a problem: [{ id, channel, slot, login, state, since, missing }]. */
export async function problems(ctx) {
  const out = [];
  for (const e of await store.conns(ctx)) { const h = viewOf(e.data); if (isProblem(h.state)) out.push({ id: e.id, channel: e.data.channel, slot: e.data.slot, login: e.data.login, state: h.state, since: h.since, missing: h.missing }); }
  return out;
}

const fmt = (ctx, at) => { try { return new Date(at).toLocaleString(ctx.locale, { dateStyle: "short", timeStyle: "short", timeZone: ctx.timezone }); } catch { return new Date(at).toISOString(); } };
/** One e-mail to the owner of the site: "off" (no mail server), "sent" or "failed". */
async function send(ctx, kind, h, d, now) {
  let configured = false;
  try { configured = typeof ctx.api.mail?.configured === "function" ? await ctx.api.mail.configured() : false; } catch { configured = false; }
  if (!configured) return "off";
  const link = `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}/admin/instances/${ctx.instance.id}`;
  const what = ctx.t(`health_${h.state === "ok" ? "renew" : h.state}`, { list: scopeWords(ctx, h.missing), account: d.login ?? "" });
  const text = kind === "problem" ? ctx.t("mail_body_problem", { what, since: fmt(ctx, h.since ?? now), link }) : ctx.t("mail_body_back", { since: fmt(ctx, h.since ?? now), link });
  try { const r = await ctx.api.mail.send({ to: "owner", subject: ctx.t(kind === "problem" ? "mail_subject_problem" : "mail_subject_back"), text }); return r === false || r?.ok === false ? "failed" : "sent"; } catch { return "failed"; }
}

/** The mails of one connection: one for the problem once the grace delay passed, one when all is back. Never when the setting is off. */
export async function mailStep(ctx, docId, now = Date.now()) {
  try {
    const entry = await ctx.api.store.get(docId);
    const d = entry?.data, h = d?.health;
    if (!h) return null;
    const on = ctx.setting("healthMail") !== false;
    if (isProblem(h.state)) {
      if (!on || h.notified?.state === h.state || now - (h.since ?? now) < GRACE_MS || (h.mailTry && now - h.mailTry < MAIL_RETRY_MS)) return null;
      const r = await send(ctx, "problem", h, d, now);
      await ctx.api.store.update(docId, { ...d, health: { ...h, ...(r === "sent" ? { notified: { state: h.state, at: now } } : {}), mailTry: now, mail: r } });
      return r;
    }
    if (h.notified) {
      const r = on ? await send(ctx, "back", { ...h, since: h.notified.at }, d, now) : "off";
      const { notified, mailTry, mail, ...rest } = h;
      if (r !== "failed" || (h.mailTry && now - h.mailTry >= MAIL_RETRY_MS)) await ctx.api.store.update(docId, { ...d, health: rest });
      else await ctx.api.store.update(docId, { ...d, health: { ...h, mailTry: now } });
      return r;
    }
  } catch { /* the health never breaks anything */ }
  return null;
}

/** The periodic task: re-check each connection that has not been checked for a while, then do its mail step. */
export async function sweep(ctx, { userToken, now = Date.now() } = {}) {
  const creds = await store.credsOf(ctx);
  if (!store.hasCreds(creds)) return { checked: 0 };
  let checked = 0;
  for (const entry of await store.conns(ctx)) {
    const last = entry.data.health?.checkedAt ?? 0;
    if (now - last >= SWEEP_MS) { await verify(ctx, creds, entry, { userToken, force: true, now }); checked++; }
    await mailStep(ctx, entry.id, now);
  }
  return { checked };
}

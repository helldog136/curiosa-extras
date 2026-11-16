// Shop (EXPERIMENTAL prototype): order e-mails and their queue (decisions D11 and D17).
//
// The order is always saved FIRST; an e-mail is only ever a consequence. Every e-mail is first written into an outbox and sent from there:
//  - one e-mail per event and order at most (the outbox is keyed by "<kind>:<order>", so replaying an event never writes a second one);
//  - the core limits how many e-mails a site may send per hour: when it answers "rate_limited" the pass stops and the rest waits, in order, for the next pass;
//    a limit or a missing mail setting never counts as a failure, a real failure is retried with growing delays and given up after 6 tries or 3 days;
//  - the customer gets the tracking link ONCE (the link is not kept anywhere else); later messages point back to that first e-mail;
//  - the owner gets ONE digest at most per hour, sent 10 minutes after the first event so that a burst of orders makes one message (order numbers and counts only: no name, address or e-mail);
//  - once an e-mail is sent or given up, its address and text are erased: only a small log line stays (no personal data) for 14 days.
// At least once: if the process stops between sending and noting it, the same e-mail can go out again; that is rare and harmless.
import { readFile } from "node:fs/promises";
const v = new URL(import.meta.url).search;
const { LIMITS, DAY, limited, withLock, formatMoney } = await import(`./lib.mjs${v}`);

const RETRY_LIMITED_MS = 10 * 60_000;
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];   // after the 1st..5th real failure; the 6th gives up
const KINDS = ["placed", "paid", "shipped", "cancelled"];

// Texts are written in the CUSTOMER's language (the one of the order), not the one of the person who clicks in the administration.
const tables = new Map();
async function table(lang) {
  if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang)) return {};
  if (!tables.has(lang)) {
    let t = {};
    try { t = JSON.parse(await readFile(new URL(`./locales/${lang}.json`, import.meta.url), "utf8")); } catch { t = {}; }
    tables.set(lang, t && typeof t === "object" ? t : {});
  }
  return tables.get(lang);
}
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export async function say(ctx, lang, key, vars = {}) {
  for (const l of [lang, ctx.defaultLocale, "en", "fr"]) {
    const t = await table(l);
    if (typeof t[key] === "string") return fill(t[key], vars);
  }
  return key;
}
const langOf = (ctx, order) => (order.lang && (ctx.locales ?? []).includes(order.lang) ? order.lang : ctx.defaultLocale || "en");
const siteName = async (ctx) => { try { return String((await ctx.api.site?.(ctx.defaultLocale))?.name ?? "").slice(0, 80) || "Site"; } catch { return "Site"; } };
const pathPrefix = (ctx, lang) => `${lang && lang !== ctx.defaultLocale && (ctx.locales ?? []).includes(lang) ? `/${lang}` : ""}${ctx.instance.basePath ? `/${ctx.instance.basePath}` : ""}`;
const configured = async (ctx) => { try { return (await ctx.api.mail?.configured?.()) === true; } catch { return false; } };
const addressKey = (a) => String(a).toLowerCase();

// ── Writing into the outbox ─────────────────────────────────────────────────────────────────────────────────────
async function enqueue(ctx, { kind, orderId, to, subject, text }, now) {
  const key = `${kind}:${orderId}`;
  if (await ctx.api.store.getByKey("outbox", key) || await ctx.api.store.getByKey("outlog", key)) return { ok: true, already: true };
  await ctx.api.store.add("outbox", { kind, orderId, to, subject, text, attempts: 0, nextAt: now, at: now }, { key });
  return { ok: true };
}

/** An event happened to this order: write the customer's e-mail (never throws, never blocks the order). `extra`: { token } for "placed". */
export async function customerMail(ctx, order, kind, extra = {}, now = Date.now()) {
  try {
    if (!KINDS.includes(kind) || !order?.customer?.email) return { ok: false, reason: "skipped" };
    if (limited(`mail|${ctx.instance.key}|${addressKey(order.customer.email)}`, LIMITS.mailsPerAddressPerDay, DAY, now)) return { ok: false, reason: "address_limit" };
    const lang = langOf(ctx, order), site = await siteName(ctx);
    const money = formatMoney(order.total, order.currency, lang);
    const vars = { name: order.customer.name, number: order.number, site, total: money, tracking: order.tracking || "" };
    let extraText = "";
    if (kind === "placed") {
      vars.url = `${ctx.api.siteUrl}${pathPrefix(ctx, lang)}/track/${extra.token}`;
      const manual = String(ctx.setting("manualPayment") ?? "").trim();
      extraText = order.payment ? await say(ctx, lang, "mailPlacedOnline", vars) : manual ? await say(ctx, lang, "mailPlacedManual", { ...vars, how: manual }) : await say(ctx, lang, "mailPlacedNoHow", vars);
    }
    if (kind === "shipped") extraText = order.tracking ? await say(ctx, lang, "mailShippedTracking", vars) : "";
    const body = await say(ctx, lang, `mail_${kind}_body`, { ...vars, extra: extraText });
    return await enqueue(ctx, { kind, orderId: order.id, to: order.customer.email, subject: await say(ctx, lang, `mail_${kind}_subject`, vars), text: body }, now);
  } catch { return { ok: false, reason: "error" }; }
}
export const onPlaced = (ctx, order, token, now) => customerMail(ctx, order, "placed", { token }, now);

/** Something for the owner's next digest. Only an order number and what happened: nothing personal. */
export async function noteOwner(ctx, order, event, now = Date.now()) {
  try {
    if (ctx.setting("notifyOwner") === false) return;
    await ctx.api.store.add("mailevents", { number: String(order.number).slice(0, 30), event, at: now }, { key: "e" });
  } catch { /* the digest is a courtesy */ }
}

// ── The owner's digest ──────────────────────────────────────────────────────────────────────────────────────────
async function mailState(ctx) {
  const r = await ctx.api.store.getByKey("mailstate", "s");
  return { id: r?.id ?? null, ownerAt: r?.data?.ownerAt ?? 0 };
}
async function composeDigest(ctx, now) {
  const events = (await ctx.api.store.page("mailevents", { order: "asc", limit: LIMITS.ownerEventsMax })).items;
  if (!events.length) return false;
  if (ctx.setting("notifyOwner") === false) { for (const e of events) await ctx.api.store.remove(e.id); return false; }
  const st = await mailState(ctx);
  if (now - st.ownerAt < LIMITS.ownerMailEveryMs) return false;                 // at most one digest per hour
  if (now - Math.min(...events.map((e) => e.data.at)) < LIMITS.ownerGroupMs) return false;   // wait a little so that a burst of orders makes one message
  const by = (ev) => [...new Set(events.filter((e) => e.data.event === ev).map((e) => e.data.number))];
  const lang = ctx.defaultLocale || "en", site = await siteName(ctx);
  const failed = (await ctx.api.store.page("outlog", { limit: 200 })).items.filter((r) => r.data.state === "failed" && r.data.at > st.ownerAt).length;
  const list = (ns) => ns.slice(0, 15).join(", ") + (ns.length > 15 ? ` +${ns.length - 15}` : "");
  const lines = [];
  for (const [ev, key] of [["placed", "digestPlaced"], ["paid", "digestPaid"], ["to_resolve", "digestResolve"], ["flag", "digestFlag"]]) {
    const ns = by(ev);
    if (ns.length) lines.push(await say(ctx, lang, key, { n: ns.length, list: list(ns) }));
  }
  if (failed) lines.push(await say(ctx, lang, "digestFailed", { n: failed }));
  const vars = { site, n: events.length, lines: lines.join("\n"), url: `${ctx.api.siteUrl}/admin/instances/${ctx.instance.id}` };
  await enqueue(ctx, { kind: "owner", orderId: String(now), to: "owner", subject: await say(ctx, lang, "digestSubject", vars), text: await say(ctx, lang, "digestBody", vars) }, now);
  for (const e of events) await ctx.api.store.remove(e.id);
  if (st.id) await ctx.api.store.update(st.id, { ownerAt: now }); else await ctx.api.store.add("mailstate", { ownerAt: now }, { key: "s" });
  return true;
}

// ── Sending from the outbox ─────────────────────────────────────────────────────────────────────────────────────
async function finish(ctx, row, state, reason, now) {
  // The log line keeps no address and no text. The outbox line is removed only after the log line exists (a crash in between is cleaned up next time).
  await ctx.api.store.add("outlog", { kind: row.data.kind, orderId: row.data.orderId, state, reason, attempts: row.data.attempts, at: now }, { key: row.key });
  await ctx.api.store.remove(row.id);
}
async function send(ctx, m) {
  try {
    const r = await ctx.api.mail.send(m);
    return r?.ok === true ? { ok: true } : { ok: false, reason: String(r?.reason ?? "failed").slice(0, 30) };
  } catch { return { ok: false, reason: "failed" }; }
}

/** One pass: compose the digest if it is time, then send what can go, in order. Returns counts. Safe to run any time, even twice at once. */
export function flush(ctx, now = Date.now(), { max = LIMITS.mailBatch } = {}) {
  return withLock(`${ctx.instance.key}|mail`, () => flushNow(ctx, now, max));
}
async function flushNow(ctx, now, max) {
  const out = { sent: 0, failed: 0, waiting: 0, digest: false };
  try { out.digest = await composeDigest(ctx, now); } catch { /* retried next pass */ }
  const rows = (await ctx.api.store.page("outbox", { order: "asc", limit: 100 })).items;
  if (!rows.length) return out;
  if (!(await configured(ctx))) { out.waiting = rows.length; return out; }          // nothing is lost and no try is used up: the mail setting may come back
  let i = 0;
  for (; i < rows.length; i++) {
    const row = rows[i], d = row.data;
    if (await ctx.api.store.getByKey("outlog", row.key)) { await ctx.api.store.remove(row.id); continue; }   // already sent: a stop between sending and noting it
    if (now - d.at > LIMITS.mailMaxAgeMs) { await finish(ctx, row, "failed", "too_old", now); out.failed++; continue; }
    if (d.nextAt > now) { out.waiting++; continue; }
    if (out.sent >= max) { out.waiting++; continue; }
    const r = await send(ctx, { to: d.to, subject: d.subject, text: d.text });
    if (r.ok) { await finish(ctx, row, "sent", "", now); out.sent++; continue; }
    if (r.reason === "rate_limited" || r.reason === "not_configured") {            // the core's hourly limit: wait, in order, without counting a failure
      await ctx.api.store.update(row.id, { ...d, nextAt: now + RETRY_LIMITED_MS }, { key: row.key });
      out.waiting += rows.length - i;
      return out;
    }
    if (r.reason === "invalid" || r.reason === "no_recipient") { await finish(ctx, row, "failed", r.reason, now); out.failed++; continue; }
    const attempts = d.attempts + 1;
    if (attempts > BACKOFF_MS.length) { await finish(ctx, { ...row, data: { ...d, attempts } }, "failed", r.reason, now); out.failed++; continue; }
    await ctx.api.store.update(row.id, { ...d, attempts, nextAt: now + BACKOFF_MS[attempts - 1] }, { key: row.key });
    out.waiting++;
  }
  return out;
}

/** After an order is placed: send what can go at once, without making the customer wait for the mail server. */
const pending = (globalThis[Symbol.for("curiosa.shop.mailPending")] ??= new Set());
export function flushSoon(ctx) {
  const p = flush(ctx, Date.now(), { max: 3 }).catch(() => {}).finally(() => pending.delete(p));
  pending.add(p);
  return p;
}
/** Tests and shutdown: wait for the passes started by flushSoon. */
export const settle = () => Promise.all([...pending]);

/** For the administration: what is waiting and what was given up recently. */
export async function stats(ctx, now = Date.now()) {
  const waiting = (await ctx.api.store.page("outbox", { limit: 200 })).items;
  const log = (await ctx.api.store.page("outlog", { limit: 200 })).items;
  return { waiting: waiting.length, oldest: waiting.length ? Math.min(...waiting.map((r) => r.data.at)) : null, failed: log.filter((r) => r.data.state === "failed" && now - r.data.at < 7 * DAY).length };
}

/** Housekeeping: old log lines and events nobody will read. Bounded, replayable. */
export async function purge(ctx, now = Date.now()) {
  let removed = 0;
  for (const r of (await ctx.api.store.page("outlog", { order: "asc", limit: LIMITS.purgeBatch })).items) if (now - r.data.at > LIMITS.logKeepMs) { await ctx.api.store.remove(r.id); removed++; }
  for (const e of (await ctx.api.store.page("mailevents", { order: "asc", limit: LIMITS.purgeBatch })).items) if (now - e.data.at > 7 * DAY) { await ctx.api.store.remove(e.id); removed++; }
  return removed;
}

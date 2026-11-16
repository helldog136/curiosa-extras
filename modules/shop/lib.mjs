// Shop (EXPERIMENTAL prototype): shared tools. No storage and no network here.
// Money is always an integer in the smallest currency unit (cents) plus the shop currency.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const LIMITS = {
  products: 500, variantsPerProduct: 20, title: 120, description: 2000, label: 60, address: 400, name: 80, email: 200, note: 1000, tracking: 80,
  maxPerLine: 5,            // pieces of one variant in one cart (a "single" variant is always 1)
  linesPerCart: 20,
  cartsPerVisitorPerHour: 6, // new carts
  addsPerVisitorPerHour: 60,
  heldGlobal: 500,           // live reservations on the whole shop (anti-hoarding cap)
  ordersPerVisitorPerHour: 5,
  maxPrice: 10_000_000,      // 100 000.00
  maxStock: 100_000,
  purgeBatch: 200,
  mailBatch: 10,                       // e-mails sent in one pass
  mailMaxAgeMs: 3 * 24 * 3_600_000,    // an e-mail still unsent after 3 days is given up
  mailsPerAddressPerDay: 12,           // nobody can use the shop to flood an address someone typed
  ownerMailEveryMs: 3_600_000, ownerGroupMs: 10 * 60_000, ownerEventsMax: 200, logKeepMs: 14 * 24 * 3_600_000,
  paymentAttempts: 5,         // payment pages created for one order
  notifyMinGapMs: 5000,       // one provider notification per payment per 5 seconds is enough: it only triggers a state read
  pollBatch: 20, pollMinGapMs: 120_000, pollWindowMs: 3 * 24 * 3_600_000,
};
export const ORDER_STATES = ["awaiting_payment", "paid", "paid_to_resolve", "preparing", "shipped", "delivered", "cancelled", "expired"];
/** Allowed manual moves made by the seller. `paid` is reached through markPaid (it re-checks the stock). */
export const NEXT_STATES = {
  awaiting_payment: ["cancelled"],
  paid: ["preparing", "shipped", "cancelled"],
  paid_to_resolve: ["cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [], cancelled: [], expired: [],
};
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD"];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function clean(v, max, multiline = false) {
  let t = String(v ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
  t = multiline ? t.replace(/\n{3,}/g, "\n\n") : t.replace(/\s+/g, " ");
  return t.trim().slice(0, max);
}
export const num = (v, def, min, max) => { const n = Number(v); return v === undefined || v === null || v === "" || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.trunc(n))); };
export const idOk = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const validEmail = (v) => typeof v === "string" && v.length <= LIMITS.email && /^[^@\s,;<>"']+@[^@\s,;<>"']+\.[^@\s,;<>"']+$/.test(v);

/** "12.50" or "12,5" → 1250 ; anything else → null. Never floating-point arithmetic on money. */
export function parseMoney(text) {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return cents >= 0 && cents <= LIMITS.maxPrice ? cents : null;
}
export function formatMoney(cents, currency, locale = "en") {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
/** Tax included in a tax-inclusive price, for information only (integer rounding, half up). `percentTimes100`: 21 % = 2100. */
export function includedTax(gross, percentTimes100) {
  if (!percentTimes100) return 0;
  return Math.round((gross * percentTimes100) / (10_000 + percentTimes100));
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
/** 32 letters from 20 random bytes (160 bits): cart cookie and order tracking link. */
export function newToken() {
  let bits = 0, value = 0, out = "";
  for (const b of randomBytes(20)) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } value &= (1 << bits) - 1; }
  return out;
}
export const isToken = (t) => typeof t === "string" && /^[a-z2-7]{32}$/.test(t);
export const hashToken = (kind, token) => createHash("sha256").update(`shop:${kind}:${token}`).digest("hex");
export const sameHash = (a, b) => typeof a === "string" && typeof b === "string" && /^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

// Visitor fingerprint for rate limits only: salted hash of the address, never stored, memory only.
const SALT = randomBytes(8).toString("hex");
const ipOf = (request) => String(request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
export const visitorOf = (request) => createHash("sha256").update(`${SALT}|${ipOf(request)}`).digest("hex").slice(0, 16);
const memory = new Map();
export function limited(bucket, max, windowMs, now = Date.now()) {
  const recent = (memory.get(bucket) ?? []).filter((t) => now - t < windowMs);
  recent.push(now); memory.set(bucket, recent);
  if (memory.size > 5000) for (const [k, v] of memory) if (!v.some((t) => now - t < 24 * HOUR)) memory.delete(k);
  return recent.length > max;
}
export function forgetInstance(key) { for (const k of [...memory.keys()]) if (k.split("|")[1] === key) memory.delete(k); }

export const cartMs = (ctx) => num(ctx.setting("cartMinutes"), 5, 1, 60) * MIN;
export const onlineHoldMs = (ctx) => num(ctx.setting("onlineHoldMinutes"), 30, 5, 120) * MIN;
export const manualHoldMs = (ctx) => num(ctx.setting("manualHoldHours"), 24, 1, 168) * HOUR;
export const currencyOf = (ctx) => (CURRENCIES.includes(ctx.setting("currency")) ? ctx.setting("currency") : "EUR");

/**
 * One-at-a-time per key, inside this process. The real store stamps a document with its creation time BEFORE the write is
 * committed, and the production database uses several connections, so two simultaneous "add then read" steps can miss each
 * other (measured: see docs/ideas/BOUTIQUE.md section 12). Running the reservation steps of one variant one after the other
 * removes that. It protects ONE process only; the core runs one process per data volume (one container per volume).
 * The map lives on `globalThis` because a module update reloads this file under a new version and would otherwise get a new, empty map.
 */
const LOCKS = (globalThis[Symbol.for("curiosa.shop.locks")] ??= new Map());
export async function withLock(key, fn) {
  const prev = LOCKS.get(key) ?? Promise.resolve();
  let release;
  const tail = prev.then(() => new Promise((r) => { release = r; }));
  LOCKS.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (LOCKS.get(key) === tail) LOCKS.delete(key); }
}

/**
 * The shop opens only where the site can send e-mail (decision D17: an order without any way to write to the customer is not accepted).
 * `configured()` says a mail server is set up; a send can still fail later, which the e-mail delivery will handle. Never throws.
 */
export async function mailReady(ctx) {
  try { return (await ctx.api.mail?.configured?.()) === true; } catch { return false; }
}

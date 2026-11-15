// Mollie payments (EXPERIMENTAL prototype): small shared tools. No storage and no network here.
/** An address a provider can reach: https, a real domain name (no IP address, no localhost, no internal name), default port. Same rule as the Twitch activity module. */
export function isPublicSite(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  if (!h.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h);
}
/** 1250 → "12.50" (integer arithmetic only). Mollie wants the value as a string with two decimals. */
export const toValue = (cents) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
/** "12.50" → 1250, or null. */
export function fromValue(v) {
  const m = /^(\d{1,9})\.(\d{2})$/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}
export const MAX_AMOUNT = 10_000_000;
export const keyMode = (key) => (/^test_[A-Za-z0-9]{10,}$/.test(key) ? "test" : /^live_[A-Za-z0-9]{10,}$/.test(key) ? "live" : null);
export const clean = (v, max) => String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const paymentId = (v) => (typeof v === "string" && /^tr_[A-Za-z0-9]{3,60}$/.test(v) ? v : null);

/** One at a time per key, inside this process (shared across module reloads through globalThis): protects the "same checkout asked twice". */
const LOCKS = (globalThis[Symbol.for("curiosa.payment-mollie.locks")] ??= new Map());
export async function withLock(key, fn) {
  const prev = LOCKS.get(key) ?? Promise.resolve();
  let release;
  const tail = prev.then(() => new Promise((r) => { release = r; }));
  LOCKS.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (LOCKS.get(key) === tail) LOCKS.delete(key); }
}

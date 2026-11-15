// Shop (EXPERIMENTAL prototype): public routes /m/<instance>/<name>. The cart cookie holds a random token (160 bits);
// only its hash is stored. A public page cannot read cookies, so the cart is read through GET `cart` by scripts/shop.js.
// Protections: method check, honeypot, per-visitor and global limits, bounded sizes, same answer for unknown things.
import { LIMITS, HOUR, limited, visitorOf, isToken, idOk, num, currencyOf } from "./lib.mjs";
import * as D from "./data.mjs";
import * as C from "./cart.mjs";
import * as O from "./orders.mjs";

const json = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...extra } });
const COOKIE = "shop_cart";
const cookieOf = (request) => { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z2-7]{32})`).exec(request.headers.get("cookie") ?? ""); return m ? m[1] : null; };
const setCookie = (token, ctx) => `${COOKIE}=${token}; Path=/; Max-Age=${Math.ceil((60 * 60 * 1000) / 1000)}; SameSite=Lax; HttpOnly; Secure`;
const form = async (request) => { try { return await request.formData(); } catch { return null; } };
const withCookie = (ctx, token, body, status = 200) => json(body, status, isToken(token) ? { "set-cookie": setCookie(token, ctx) } : {});

async function cart(request, ctx) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const v = await C.viewCart(ctx, cookieOf(request));
  return json({ ...v, currency: currencyOf(ctx) });
}
async function add(request, ctx) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const f = await form(request);
  if (!f) return json({ ok: false, reason: "invalid" }, 400);
  if (String(f.get("website") ?? "")) return json({ ok: true });                                     // honeypot
  const key = ctx.instance.key, visitor = visitorOf(request);
  if (limited(`add|${key}|${visitor}`, LIMITS.addsPerVisitorPerHour, HOUR)) return json({ ok: false, reason: "rate" }, 429);
  const token = cookieOf(request);
  const productId = String(f.get("productId") ?? ""), variantId = String(f.get("variantId") ?? "");
  if (!idOk(productId) || !idOk(variantId)) return json({ ok: false, reason: "invalid" }, 400);
  if (!token && limited(`cart|${key}|${visitor}`, LIMITS.cartsPerVisitorPerHour, HOUR)) return json({ ok: false, reason: "rate" }, 429);
  const r = await C.addToCart(ctx, token, { productId, variantId, qty: num(f.get("qty"), 1, 1, 99) });
  const view = await C.viewCart(ctx, r.token);
  return withCookie(ctx, r.token, { ok: r.ok, reason: r.reason, available: r.available, cart: { ...view, currency: currencyOf(ctx) } }, r.ok ? 200 : r.reason === "sold_out" ? 409 : 400);
}
async function remove(request, ctx) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const f = await form(request);
  const token = cookieOf(request);
  if (!f || !token || !idOk(String(f.get("rid") ?? ""))) return json({ ok: false, reason: "invalid" }, 400);
  if (limited(`rm|${ctx.instance.key}|${visitorOf(request)}`, LIMITS.addsPerVisitorPerHour, HOUR)) return json({ ok: false, reason: "rate" }, 429);
  const r = await C.removeLine(ctx, token, String(f.get("rid")));
  return json({ ok: r.ok, reason: r.reason, cart: { ...(await C.viewCart(ctx, token)), currency: currencyOf(ctx) } });
}
async function checkout(request, ctx) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const f = await form(request);
  if (!f) return json({ ok: false, reason: "invalid" }, 400);
  if (String(f.get("website") ?? "")) return json({ ok: true });
  if (limited(`co|${ctx.instance.key}|${visitorOf(request)}`, LIMITS.ordersPerVisitorPerHour, HOUR)) return json({ ok: false, reason: "rate" }, 429);
  const token = cookieOf(request);
  if (!token) return json({ ok: false, reason: "expired" }, 409);
  const r = await O.checkout(ctx, token, { name: f.get("name"), email: f.get("email"), address: f.get("address") });
  if (!r.ok) return json({ ok: false, reason: r.reason, errors: r.errors }, r.errors ? 400 : 409);
  const base = ctx.instance.basePath ? `/${ctx.instance.basePath}` : "";
  return json({ ok: true, url: `${base}/track/${r.token}` });
}
export default { cart, add, remove, checkout };

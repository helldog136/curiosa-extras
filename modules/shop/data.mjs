// Shop (EXPERIMENTAL prototype): products, carts, orders in ctx.api.store.
// Collections: products, reservations (see stock.mjs), carts, orders.
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const { LIMITS, hashToken, clean, num, idOk, parseMoney } = await import(`./lib.mjs${v}`);

const view = (r) => ({ id: r.id, at: r.createdAt, ...r.data });

// ── Products ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function listProducts(ctx, { published = false } = {}) {
  const rows = (await ctx.api.store.page("products", { order: "asc", limit: LIMITS.products })).items.map(view);
  return published ? rows.filter((p) => p.status === "published") : rows;
}
export async function getProduct(ctx, id) {
  if (!idOk(id)) return null;
  const r = await ctx.api.store.get(id);
  return r && r.data && Array.isArray(r.data.variants) && r.data.title !== undefined ? view(r) : null;
}
/** Validate and normalise what the seller typed. Returns { value } or { errors }. Only kind "physical" is enabled in this prototype. */
export function normaliseProduct(values, existing) {
  const errors = {};
  const title = clean(values.title, LIMITS.title);
  if (!title) errors.title = "title";
  const price = parseMoney(values.price);
  if (price === null || price === 0) errors.price = "price";
  const mode = ["tracked", "single", "unlimited"].includes(values.stockMode) ? values.stockMode : "tracked";
  const onHand = mode === "single" ? 1 : mode === "unlimited" ? 0 : num(values.onHand, NaN, 0, LIMITS.maxStock);
  if (mode === "tracked" && !Number.isFinite(onHand)) errors.onHand = "stock";
  const taxRate = values.taxRate === undefined || values.taxRate === "" ? 0 : Math.round(Number(String(values.taxRate).replace(",", ".")) * 100);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 10_000) errors.taxRate = "tax";
  // Extra variants: one per line, "label | price | stock" (price and stock optional: they default to the product's).
  const variants = [{ id: existing?.variants?.[0]?.id ?? "v1", label: "", price, stockMode: mode, onHand: Number.isFinite(onHand) ? onHand : 0 }];
  const lines = clean(values.variants, 2000, true).split("\n").map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const [label, p, s] = line.split("|").map((x) => x.trim());
    const vp = p ? parseMoney(p) : price;
    const vs = s === undefined || s === "" ? onHand : Number(s);
    if (!label || label.length > LIMITS.label || vp === null || !Number.isInteger(vs) || vs < 0 || vs > LIMITS.maxStock) { errors.variants = `line ${i + 1}`; break; }
    variants.push({ id: existing?.variants?.[i + 1]?.id ?? `v${i + 2}`, label, price: vp, stockMode: mode === "single" ? "single" : "tracked", onHand: mode === "single" ? 1 : vs });
  }
  if (variants.length > LIMITS.variantsPerProduct) errors.variants = "too many";
  if (variants.length > 1) variants[0].label = clean(values.firstLabel, LIMITS.label) || "Default";
  if (Object.keys(errors).length) return { errors };
  return { value: { kind: "physical", title, description: clean(values.description, LIMITS.description, true), status: values.published === "on" ? "published" : "draft", taxRate, variants } };
}
export async function saveProduct(ctx, id, value) {
  if (id) { const ok = await ctx.api.store.update(id, value); return ok ? id : null; }
  if ((await ctx.api.store.count("products")) >= LIMITS.products) return null;
  return ctx.api.store.add("products", value);
}
/** Seller edits the number in hand. The only writer of `onHand`. */
export async function setOnHand(ctx, productId, variantId, onHand) {
  const p = await getProduct(ctx, productId);
  const v = p?.variants.find((x) => x.id === variantId);
  if (!p || !v || !Number.isInteger(onHand) || onHand < 0 || onHand > LIMITS.maxStock) return false;
  v.onHand = v.stockMode === "single" ? Math.min(1, onHand) : onHand;
  const { id, at, ...data } = p;
  return ctx.api.store.update(id, data);
}

// ── Carts ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function findCart(ctx, token) {
  const r = await ctx.api.store.getByKey("carts", hashToken("cart", token));
  return r ? view(r) : null;
}
export async function createCart(ctx, token, expiresAt, now) {
  const id = await ctx.api.store.add("carts", { status: "open", lines: [], expiresAt, at: now }, { key: hashToken("cart", token) });
  return { id, status: "open", lines: [], expiresAt, at: now };
}
export async function saveCart(ctx, cart) {
  const { id, at, ...data } = cart;
  return ctx.api.store.update(id, data);   // `key` omitted = unchanged
}

// ── Orders ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function listOrders(ctx) {
  return (await ctx.api.store.page("orders", { limit: 1000 })).items.map(view);
}
export async function getOrder(ctx, id) {
  if (!idOk(id)) return null;
  const r = await ctx.api.store.get(id);
  return r && r.data && r.data.number && Array.isArray(r.data.lines) ? view(r) : null;
}
export async function findOrderByToken(ctx, token) {
  const r = await ctx.api.store.getByKey("orders", hashToken("order", token));
  return r ? view(r) : null;
}
export async function saveOrder(ctx, order) {
  const { id, at, ...data } = order;
  return ctx.api.store.update(id, data);   // false when the order no longer exists
}
export const addOrder = (ctx, data, token) => ctx.api.store.add("orders", data, { key: hashToken("order", token) });
export const removeOrder = (ctx, id) => ctx.api.store.remove(id);

/** Gives the order a new tracking token: the old link stops working at once (the store key is the token's hash). Returns the new token and the old hash. */
export async function rotateOrderToken(ctx, order, token) {
  const { id, at, ...data } = order;
  const row = await ctx.api.store.get(id);
  if (!row) return null;
  await ctx.api.store.update(id, data, { key: hashToken("order", token) });
  return { oldKey: row.key };
}
export async function restoreOrderKey(ctx, orderId, key) { const row = await ctx.api.store.get(orderId); return row ? ctx.api.store.update(orderId, row.data, { key }) : false; }

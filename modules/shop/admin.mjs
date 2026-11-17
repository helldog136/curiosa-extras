// Shop (EXPERIMENTAL prototype): administration. Three views in one panel: orders (opens first), products, product sheet / order sheet.
// Not yet audited against docs/ERGONOMIE-ADMIN.md (see README): no dialog editing, no inline stock edit, no wizard.
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const { esc, formatMoney, currencyOf, idOk, num, ORDER_STATES, NEXT_STATES, mailReady } = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const S = await import(`./stock.mjs${v}`);
const O = await import(`./orders.mjs${v}`);
const P = await import(`./payments.mjs${v}`);
const Mail = await import(`./mail.mjs${v}`);
const Ship = await import(`./shipping.mjs${v}`);

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const one = (x) => (typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "");
const BADGE = { awaiting_payment: "warn", paid: "ok", paid_to_resolve: "danger", preparing: "info", shipped: "info", delivered: "neutral", cancelled: "neutral", expired: "neutral" };
const centsToText = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export async function adminPanel(ctx, { query } = {}) {
  const q = query && typeof query === "object" ? query : {};
  if (idOk(one(q.order))) return orderSheet(ctx, one(q.order));
  // A product or its stock is edited in a window above the list (the list keeps its search and place); the address stays the source of truth.
  const dialog = one(q.edit) === "new" || idOk(one(q.edit)) ? await productDialog(ctx, one(q.edit)) : idOk(one(q.stock)) ? await stockDialog(ctx, one(q.stock)) : Ship.MODES.includes(one(q.shipping)) ? await shippingDialog(ctx, one(q.shipping)) : [];
  return [...dialog, ...(await overview(ctx))];
}

async function overview(ctx) {
  const manage = can(ctx, "manage"), currency = currencyOf(ctx);
  const [products, orders] = await Promise.all([D.listProducts(ctx), D.listOrders(ctx)]);
  const blocks = [];
  if (!(await mailReady(ctx))) blocks.push({ type: "banner", tone: "warning", text: ctx.t("needMailBanner") }, { type: "links", items: [{ label: ctx.t("mailSetLink"), href: "/admin/settings" }] });
  const low = num(ctx.setting("lowStock"), 2, 0, 100);
  const lowList = [];
  const stockOf = new Map();
  for (const p of products) for (const v of p.variants) {
    const a = await S.availability(ctx, p, v);
    stockOf.set(`${p.id}:${v.id}`, a);
    if (p.status === "published" && v.stockMode === "tracked" && a.available !== Infinity && a.available <= low) lowList.push(`${p.title}${v.label ? ` (${v.label})` : ""}: ${a.available}`);
  }
  if (lowList.length) blocks.push({ type: "banner", tone: "warning", text: ctx.t("lowStockBanner", { list: lowList.slice(0, 5).join(", ") }) });
  const mailStats = await Mail.stats(ctx);
  if (mailStats.failed) blocks.push({ type: "banner", tone: "warning", text: ctx.t("mailFailedBanner", { n: mailStats.failed }) });
  else if (mailStats.oldest !== null && Date.now() - mailStats.oldest > 15 * 60_000) blocks.push({ type: "banner", tone: "info", text: ctx.t("mailWaitingBanner", { n: mailStats.waiting }) });
  const providers = await P.readyProviders(ctx);
  const installed = providers.length ? [] : await P.installedProviders(ctx);
  if (!providers.length && installed.length) blocks.push({ type: "banner", tone: "warning", text: ctx.t("providerNotReady") }, { type: "links", items: installed.map((x) => ({ label: ctx.t("openProvider", { name: x.name }), href: `/admin/instances/${x.id}` })) });
  else if (!providers.length) blocks.push({ type: "suggestInstall", service: "payment.provider", reason: ctx.t("suggestProviderReason") });
  else if (providers.some((p) => p.mode === "test")) blocks.push({ type: "banner", tone: "warning", text: ctx.t("testModeBanner") });
  const flagged = orders.filter((o) => o.flag).length;
  if (flagged) blocks.push({ type: "banner", tone: "warning", text: ctx.t("flaggedBanner", { n: flagged }) });
  const toResolve = orders.filter((o) => o.state === "paid_to_resolve").length;
  if (toResolve) blocks.push({ type: "banner", tone: "warning", text: ctx.t("toResolveBanner", { n: toResolve }) });

  blocks.push({ type: "heading", text: ctx.t("ordersTitle") });
  blocks.push({
    type: "table", columns: [ctx.t("colOrder"), ctx.t("colState"), ctx.t("colTotal"), ctx.t("colDate")], searchable: true, filters: [{ column: 1 }], pageSize: 50,
    empty: ctx.t("ordersEmpty"), rowIds: orders.slice().sort((a, b) => b.at - a.at).map((o) => o.id),
    rows: orders.slice().sort((a, b) => b.at - a.at).map((o) => [`${o.number}${can(ctx, "email.view") ? ` · ${o.customer.name}` : ""}`, { text: ctx.t(`state_${o.state}`), badge: BADGE[o.state] ?? "neutral" }, formatMoney(o.total, o.currency, ctx.locale), o.at.toISOString().slice(0, 10)]),
    rowActions: [{ label: ctx.t("open"), href: "?order={id}" }],
  });
  blocks.push(...(await shippingSection(ctx, manage, currency)));
  blocks.push({ type: "heading", text: ctx.t("productsTitle") });
  blocks.push({
    type: "table", columns: [ctx.t("colProduct"), ctx.t("colPrice"), ctx.t("colStock"), ctx.t("colStatus")], searchable: true, filters: [{ column: 3 }], truncate: [0], pageSize: 50,
    empty: ctx.t("productsEmpty"), rowIds: products.map((p) => p.id),
    rows: products.map((p) => [p.title, formatMoney(p.variants[0].price, currency, ctx.locale), p.variants.map((v) => { const a = stockOf.get(`${p.id}:${v.id}`); return a.available === Infinity ? "∞" : String(a.available); }).join(" / "), manage ? { text: ctx.t(p.status === "published" ? "published" : "draft"), switch: { on: p.status === "published", action: "setPublished", label: ctx.t("onSaleSwitch", { name: p.title }), onText: ctx.t("published"), offText: ctx.t("draft") } } : { text: ctx.t(p.status === "published" ? "published" : "draft"), badge: p.status === "published" ? "ok" : "neutral" }]),
    rowActions: manage ? [{ label: ctx.t("edit"), href: "?edit={id}", presentation: "dialog" }, { label: ctx.t("changeStock"), href: "?stock={id}", presentation: "dialog" }] : [],
  });
  if (manage) blocks.push({ type: "links", items: [{ label: ctx.t("addProduct"), href: "?edit=new", presentation: "dialog" }] });
  return blocks;
}

/** Where the seller says how delivery is charged: the present setup in one line, and one window per mode (each window shows only what that mode needs). */
async function shippingSection(ctx, manage, currency) {
  const cfg = await Ship.readConfig(ctx), money = (c) => formatMoney(c, currency, ctx.locale);
  let summary;
  if (cfg.mode === "flat") summary = ctx.t("shipSummaryFlat", { price: money(cfg.flat) });
  else if (cfg.mode === "zones") summary = ctx.t("shipSummaryZones", { zones: Ship.ZONES.map((z) => `${ctx.t(`zone_${z}`, { country: cfg.homeCountry })} ${cfg.prices[z] === null ? ctx.t("shipUndelivered") : money(cfg.prices[z])}`).join(" · ") });
  else summary = ctx.t("shipSummaryNone");
  const blocks = [{ type: "heading", text: ctx.t("shippingTitle") }];
  if (!cfg.configured) blocks.push({ type: "banner", tone: "warning", text: ctx.t("shipNotSetUp") });
  blocks.push({ type: "markdown", text: `**${summary}**` });
  if (manage) blocks.push({ type: "links", items: Ship.MODES.map((m) => ({ label: ctx.t(`shipMode_${m}`), href: `?shipping=${m}`, presentation: "dialog" })) });
  return blocks;
}

async function shippingDialog(ctx, mode) {
  if (!can(ctx, "manage")) return [];
  const cfg = await Ship.readConfig(ctx), cents = (c) => (c === null || c === undefined ? "" : centsToText(c));
  const tax = { name: "taxRate", label: ctx.t("fShipTax"), kind: "number", min: 0, max: 100, step: 0.01, unit: "%", value: cfg.taxRate ? String(cfg.taxRate / 100) : "", folded: true };
  const fields = [{ name: "mode", kind: "hidden", value: mode }];
  if (mode === "flat") fields.push({ name: "flat", label: ctx.t("fShipPrice"), required: true, value: cfg.mode === "flat" ? cents(cfg.flat) : "", example: "5.00" }, tax);
  if (mode === "zones") fields.push(
    { name: "homeCountry", label: ctx.t("fHomeCountry"), kind: "select", required: true, value: cfg.homeCountry, options: [{ value: "", label: ctx.t("countryPick") }, ...Ship.countryOptions(ctx.locale).map(([c, n]) => ({ value: c, label: n }))] },
    { name: "price_home", label: ctx.t("zone_home_form"), value: cents(cfg.prices.home), example: "5.00", help: ctx.t("shipEmptyHelp") },
    { name: "price_europe", label: ctx.t("zone_europe"), value: cents(cfg.prices.europe), example: "9.00", help: ctx.t("shipEmptyHelp") },
    { name: "price_world", label: ctx.t("zone_world"), value: cents(cfg.prices.world), example: "15.00", help: ctx.t("shipEmptyHelp") }, tax);
  if (mode === "none") fields.push({ name: "pickupInfo", label: ctx.t("fPickupInfo"), kind: "textarea", value: cfg.pickupInfo, example: ctx.t("exPickup") });
  return [{ type: "adminForm", presentation: "dialog", action: "saveShipping", cancelHref: "?", title: ctx.t(`shipMode_${mode}`), submitLabel: ctx.t("saveShipping"), fields }];
}

async function productDialog(ctx, id) {
  const p = id === "new" ? null : await D.getProduct(ctx, id);
  if (id !== "new" && !p) return [{ type: "banner", tone: "warning", text: ctx.t("notFound") }];
  if (!can(ctx, "manage")) return [];
  const v0 = p?.variants[0];
  const more = p?.variants.slice(1).map((v) => `${v.label} | ${centsToText(v.price)} | ${v.onHand}`).join("\n") ?? "";
  const counted = !p || v0.stockMode === "tracked";            // "pieces in stock" means nothing for a one-of-a-kind or unlimited product that already exists
  return [{
    type: "adminForm", presentation: "dialog", action: "saveProduct", cancelHref: "?", title: ctx.t(p ? "editProduct" : "newProduct"), submitLabel: ctx.t("saveProduct"),
    ...(p ? { secondaryAction: { label: ctx.t("deleteProduct"), action: "deleteProduct", confirm: ctx.t("deleteConfirm") } } : {}),
    fields: [
      { name: "id", kind: "hidden", value: p?.id ?? "" },
      { name: "title", label: ctx.t("fTitle"), required: true, value: p?.title ?? "", example: ctx.t("exTitle") },
      { name: "price", label: ctx.t("fPrice"), required: true, value: v0 ? centsToText(v0.price) : "", example: "12.50" },
      { name: "stockMode", label: ctx.t("fStockMode"), kind: "segmented", value: v0?.stockMode ?? "tracked", options: [{ value: "tracked", label: ctx.t("modeTracked") }, { value: "single", label: ctx.t("modeSingle") }, { value: "unlimited", label: ctx.t("modeUnlimited") }] },
      ...(counted ? [{ name: "onHand", label: ctx.t("fOnHand"), kind: "number", min: 0, max: 100000, value: String(v0?.onHand ?? 1), unit: ctx.t("pieces") }] : []),
      { name: "description", label: ctx.t("fDescription"), kind: "textarea", value: p?.description ?? "", folded: true },
      { name: "taxRate", label: ctx.t("fTaxRate"), kind: "number", min: 0, max: 100, step: 0.01, unit: "%", value: p && p.taxRate ? String(p.taxRate / 100) : "", folded: true },
      { name: "firstLabel", label: ctx.t("fFirstLabel"), value: p && p.variants.length > 1 ? v0.label : "", folded: true },
      { name: "variants", label: ctx.t("fVariants"), kind: "textarea", value: more, example: "Large | 24.00 | 3", folded: true },
    ],
  }];
}

/** One field and one click: the quickest way to say "I made five more". */
async function stockDialog(ctx, id) {
  const p = await D.getProduct(ctx, id);
  if (!p) return [{ type: "banner", tone: "warning", text: ctx.t("notFound") }];
  if (!can(ctx, "manage")) return [];
  if (p.variants.every((v) => v.stockMode === "unlimited")) return [{ type: "banner", tone: "info", text: ctx.t("noStockLimit") }];
  const first = p.variants.find((v) => v.stockMode !== "unlimited");
  const pick = p.variants.filter((v) => v.stockMode !== "unlimited");
  return [{
    type: "adminForm", presentation: "dialog", action: "saveStock", cancelHref: "?", title: ctx.t("stockTitle", { name: p.title }), submitLabel: ctx.t("saveStock"),
    fields: [
      { name: "id", kind: "hidden", value: p.id },
      ...(pick.length > 1 ? [{ name: "variant", label: ctx.t("fVariantPick"), kind: "select", value: first.id, options: pick.map((v) => ({ value: v.id, label: `${v.label || p.title} (${v.onHand})` })) }] : [{ name: "variant", kind: "hidden", value: first.id }]),
      { name: "onHand", label: ctx.t("fOnHand"), kind: "number", min: 0, max: 100000, value: String(first.onHand), unit: ctx.t("pieces") },
    ],
  }];
}

async function orderSheet(ctx, id) {
  const o = await D.getOrder(ctx, id);
  if (!o) return [{ type: "banner", tone: "warning", text: ctx.t("notFound") }, { type: "links", items: [{ label: ctx.t("back"), href: "?" }] }];
  const manage = can(ctx, "manage"), money = (c) => formatMoney(c, o.currency, ctx.locale);
  const blocks = [{ type: "heading", text: ctx.t("orderNumber", { n: o.number }) }, { type: "links", items: [{ label: ctx.t("back"), href: "?" }] }];
  if (o.state === "paid_to_resolve") blocks.push({ type: "banner", tone: "warning", text: ctx.t("resolveHelp") });
  if (o.flag) blocks.push({ type: "banner", tone: "warning", text: ctx.t(`flag_${o.flag}`) });
  blocks.push({ type: "table", columns: [ctx.t("colProduct"), ctx.t("colQty"), ctx.t("colTotal")], rows: o.lines.map((l) => [`${l.title}${l.label ? ` (${l.label})` : ""}`, String(l.qty), money(l.sum)]) });
  blocks.push({ type: "markdown", text: `**${ctx.t("total")}** ${money(o.total)}${o.includedTax ? ` · ${ctx.t("includesTax", { amount: money(o.includedTax) })}` : ""}  \n${o.shipping ? `**${ctx.t("shipLabel")}** ${o.shipping.pickup ? ctx.t("shipPickup") : `${o.shipping.price === 0 ? ctx.t("shipFree") : money(o.shipping.price)}${o.shipping.country ? ` (${o.shipping.country})` : ""}`}  \n` : ""}**${ctx.t("colState")}** ${ctx.t(`state_${o.state}`)}${can(ctx, "email.view") ? `  \n**${ctx.t("fEmail")}** ${o.customer.email}  \n**${ctx.t("fAddress")}** ${o.customer.address ? o.customer.address.replace(/\n/g, ", ") : ctx.t("shipPickup")}` : ""}${o.tracking ? `  \n**${ctx.t("trackingNumber")}** ${o.tracking}` : ""}${o.payment ? `  \n**${ctx.t("paymentLine")}** ${o.payment.providerName} (${ctx.t(o.payment.mode === "live" ? "modeLive" : "modeTest")}) · ${ctx.t(`payState_${o.payment.state}`)}` : ""}` });
  if (!manage) return blocks;
  if (o.state === "awaiting_payment" || o.state === "expired") blocks.push({ type: "adminForm", action: "markPaid", submitLabel: ctx.t("markPaid"), fields: [{ name: "id", kind: "hidden", value: o.id }] });
  blocks.push({ type: "markdown", text: ctx.t("linkWarning") });
  blocks.push({ type: "adminForm", action: "resendLink", submitLabel: ctx.t("resendLink"), submitStyle: "secondary", fields: [{ name: "id", kind: "hidden", value: o.id }] });
  const next = NEXT_STATES[o.state] ?? [];
  if (next.length) blocks.push({
    type: "adminForm", action: "setState", submitLabel: ctx.t("saveState"),
    fields: [{ name: "id", kind: "hidden", value: o.id }, { name: "state", label: ctx.t("fNextState"), kind: "select", required: true, options: next.map((s) => ({ value: s, label: ctx.t(`state_${s}`) })) }, { name: "tracking", label: ctx.t("trackingNumber"), value: o.tracking, folded: true }, { name: "note", label: ctx.t("fNote"), kind: "textarea", value: o.privateNote, folded: true }],
  });
  return blocks;
}

const fail = (ctx, key) => ({ error: ctx.t(key) });
export const adminActions = {
  async saveProduct(ctx, values) {
    if (!can(ctx, "manage")) return fail(ctx, "noRight");
    const id = idOk(values.id) ? values.id : "";
    const existing = id ? await D.getProduct(ctx, id) : null;
    const r = D.normaliseProduct(values, existing);
    if (r.errors) return { errors: Object.fromEntries(Object.entries(r.errors).map(([k, code]) => [k, ctx.t(`err_${code.startsWith("line") ? "variants" : code === "too many" ? "variants" : code}`, { line: code.replace("line ", "") })])) };
    const saved = await D.saveProduct(ctx, id || null, r.value);
    return saved ? { ok: ctx.t("saved") } : fail(ctx, "saveFailed");     // no redirect: the core closes the window on a success and marks the saved row
  },
  async saveShipping(ctx, values) {
    if (!can(ctx, "manage")) return fail(ctx, "noRight");
    const r = Ship.normaliseConfig(String(values.mode ?? ""), values);
    if (r.errors) return { errors: Object.fromEntries(Object.entries(r.errors).map(([k, code]) => [k, ctx.t(`errShip_${code}`)])) };
    await Ship.saveConfig(ctx, r.value);
    return { ok: ctx.t("saved") };
  },
  async saveStock(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const raw = String(values.onHand ?? "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0 || n > 100000) return { errors: { onHand: ctx.t("err_stock") } };   // an empty field is not zero: it would silently empty the stock
    const ok = await D.setOnHand(ctx, values.id, idOk(values.variant) ? values.variant : "v1", n);
    return ok ? { ok: ctx.t("saved") } : fail(ctx, "saveFailed");
  },
  /** Take a product on or off sale from the list: the action says the state wanted, it never flips (a double click cannot undo itself). */
  async setPublished(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const p = await D.getProduct(ctx, values.id);
    if (!p) return fail(ctx, "notFound");
    const { id, at, ...data } = p;
    await ctx.api.store.update(id, { ...data, status: values.enabled === "1" ? "published" : "draft" });
    return { ok: ctx.t("saved") };
  },
  async deleteProduct(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const p = await D.getProduct(ctx, values.id);
    if (!p) return { ok: ctx.t("deleted") };
    const now = Date.now();
    for (const v of p.variants) if ((await S.readAll(ctx, p.id, v.id)).some((r) => r.data.state === "held" && r.data.expiresAt > now)) return fail(ctx, "errDeleteBusy");   // in a cart or an order waiting for payment
    await ctx.api.store.remove(p.id);                                    // placed orders keep their own copy of the lines
    return { ok: ctx.t("deleted") };
  },
  async markPaid(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const r = await O.markPaid(ctx, values.id, { eventId: `manual:${values.id}` });
    Mail.flushSoon(ctx);
    return r.ok ? { ok: ctx.t(r.state === "paid_to_resolve" ? "paidToResolve" : "markedPaid"), redirect: `?order=${values.id}` } : fail(ctx, "saveFailed");
  },
  async resendLink(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const r = await O.resendLink(ctx, values.id);
    if (r.ok) return { ok: ctx.t("linkSent"), redirect: `?order=${values.id}` };
    return fail(ctx, r.reason === "limit" ? "linkLimit" : "linkNotSent");
  },
  async setState(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const r = await O.setState(ctx, values.id, ORDER_STATES.includes(values.state) ? values.state : "", { tracking: values.tracking, note: values.note });
    Mail.flushSoon(ctx);
    return r.ok ? { ok: ctx.t("saved"), redirect: `?order=${values.id}` } : { errors: { state: ctx.t("errTransition") } };
  },
};
export async function adminBadge(ctx) {
  return (await D.listOrders(ctx)).filter((o) => o.state === "paid" || o.state === "paid_to_resolve" || o.flag).length;
}

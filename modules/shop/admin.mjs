// Shop (EXPERIMENTAL prototype): administration. Three views in one panel: orders (opens first), products, product sheet / order sheet.
// Not yet audited against docs/ERGONOMIE-ADMIN.md (see README): no dialog editing, no inline stock edit, no wizard.
const v = new URL(import.meta.url).search;   // the module's version travels to the neighbour files, so an update never keeps old code in memory
const { esc, formatMoney, currencyOf, idOk, num, ORDER_STATES, NEXT_STATES, mailReady } = await import(`./lib.mjs${v}`);
const D = await import(`./data.mjs${v}`);
const S = await import(`./stock.mjs${v}`);
const O = await import(`./orders.mjs${v}`);
const P = await import(`./payments.mjs${v}`);
const Mail = await import(`./mail.mjs${v}`);

const can = (ctx, right) => typeof ctx.can === "function" && ctx.can(right) === true;
const one = (x) => (typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "");
const BADGE = { awaiting_payment: "warn", paid: "ok", paid_to_resolve: "danger", preparing: "info", shipped: "info", delivered: "neutral", cancelled: "neutral", expired: "neutral" };
const centsToText = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export async function adminPanel(ctx, { query } = {}) {
  const q = query && typeof query === "object" ? query : {};
  if (idOk(one(q.order))) return orderSheet(ctx, one(q.order));
  if (one(q.edit) === "new" || idOk(one(q.edit))) return productSheet(ctx, one(q.edit));
  return overview(ctx);
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
  blocks.push({ type: "heading", text: ctx.t("productsTitle") });
  blocks.push({
    type: "table", columns: [ctx.t("colProduct"), ctx.t("colPrice"), ctx.t("colStock"), ctx.t("colStatus")], searchable: true, filters: [{ column: 3 }], truncate: [0], pageSize: 50,
    empty: ctx.t("productsEmpty"), rowIds: products.map((p) => p.id),
    rows: products.map((p) => [p.title, formatMoney(p.variants[0].price, currency, ctx.locale), p.variants.map((v) => { const a = stockOf.get(`${p.id}:${v.id}`); return a.available === Infinity ? "∞" : String(a.available); }).join(" / "), { text: ctx.t(p.status === "published" ? "published" : "draft"), badge: p.status === "published" ? "ok" : "neutral" }]),
    rowActions: [{ label: ctx.t("edit"), href: "?edit={id}" }],
  });
  if (manage) blocks.push({ type: "links", items: [{ label: ctx.t("addProduct"), href: "?edit=new" }] });
  return blocks;
}

async function productSheet(ctx, id) {
  const p = id === "new" ? null : await D.getProduct(ctx, id);
  if (id !== "new" && !p) return [{ type: "banner", tone: "warning", text: ctx.t("notFound") }, { type: "links", items: [{ label: ctx.t("back"), href: "?" }] }];
  const manage = can(ctx, "manage"), v0 = p?.variants[0];
  const more = p?.variants.slice(1).map((v) => `${v.label} | ${centsToText(v.price)} | ${v.onHand}`).join("\n") ?? "";
  const blocks = [{ type: "heading", text: ctx.t(p ? "editProduct" : "newProduct") }];
  if (!manage) { blocks.push({ type: "banner", tone: "info", text: ctx.t("readOnly") }); return blocks; }
  blocks.push({
    type: "adminForm", action: "saveProduct", submitLabel: ctx.t("saveProduct"), cancelHref: "?",
    fields: [
      { name: "id", kind: "hidden", value: p?.id ?? "" },
      { name: "title", label: ctx.t("fTitle"), required: true, value: p?.title ?? "", example: ctx.t("exTitle") },
      { name: "price", label: ctx.t("fPrice"), required: true, value: v0 ? centsToText(v0.price) : "", example: "12.50" },
      { name: "stockMode", label: ctx.t("fStockMode"), kind: "segmented", value: v0?.stockMode ?? "tracked", options: [{ value: "tracked", label: ctx.t("modeTracked") }, { value: "single", label: ctx.t("modeSingle") }, { value: "unlimited", label: ctx.t("modeUnlimited") }] },
      { name: "onHand", label: ctx.t("fOnHand"), kind: "number", min: 0, max: 100000, value: String(v0?.onHand ?? 1), unit: ctx.t("pieces") },
      { name: "published", label: ctx.t("fPublished"), kind: "switch", value: !p || p.status === "published" ? "on" : "", folded: true },   // a new product is on sale: a draft hidden under "More options" would never show up
      { name: "description", label: ctx.t("fDescription"), kind: "textarea", value: p?.description ?? "", folded: true },
      { name: "taxRate", label: ctx.t("fTaxRate"), kind: "number", min: 0, max: 100, step: 0.01, unit: "%", value: p ? String((p.taxRate ?? 0) / 100) : "", folded: true },
      { name: "firstLabel", label: ctx.t("fFirstLabel"), value: p && p.variants.length > 1 ? v0.label : "", folded: true },
      { name: "variants", label: ctx.t("fVariants"), kind: "textarea", value: more, example: "Large | 24.00 | 3", folded: true },
    ],
  });
  return blocks;
}

async function orderSheet(ctx, id) {
  const o = await D.getOrder(ctx, id);
  if (!o) return [{ type: "banner", tone: "warning", text: ctx.t("notFound") }, { type: "links", items: [{ label: ctx.t("back"), href: "?" }] }];
  const manage = can(ctx, "manage"), money = (c) => formatMoney(c, o.currency, ctx.locale);
  const blocks = [{ type: "heading", text: ctx.t("orderNumber", { n: o.number }) }, { type: "links", items: [{ label: ctx.t("back"), href: "?" }] }];
  if (o.state === "paid_to_resolve") blocks.push({ type: "banner", tone: "warning", text: ctx.t("resolveHelp") });
  if (o.flag) blocks.push({ type: "banner", tone: "warning", text: ctx.t(`flag_${o.flag}`) });
  blocks.push({ type: "table", columns: [ctx.t("colProduct"), ctx.t("colQty"), ctx.t("colTotal")], rows: o.lines.map((l) => [`${l.title}${l.label ? ` (${l.label})` : ""}`, String(l.qty), money(l.sum)]) });
  blocks.push({ type: "markdown", text: `**${ctx.t("total")}** ${money(o.total)}${o.includedTax ? ` · ${ctx.t("includesTax", { amount: money(o.includedTax) })}` : ""}  \n**${ctx.t("colState")}** ${ctx.t(`state_${o.state}`)}${can(ctx, "email.view") ? `  \n**${ctx.t("fEmail")}** ${o.customer.email}  \n**${ctx.t("fAddress")}** ${o.customer.address.replace(/\n/g, ", ")}` : ""}${o.tracking ? `  \n**${ctx.t("trackingNumber")}** ${o.tracking}` : ""}${o.payment ? `  \n**${ctx.t("paymentLine")}** ${o.payment.providerName} (${ctx.t(o.payment.mode === "live" ? "modeLive" : "modeTest")}) · ${ctx.t(`payState_${o.payment.state}`)}` : ""}` });
  if (!manage) return blocks;
  if (o.state === "awaiting_payment" || o.state === "expired") blocks.push({ type: "adminForm", action: "markPaid", submitLabel: ctx.t("markPaid"), fields: [{ name: "id", kind: "hidden", value: o.id }] });
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
    return saved ? { ok: ctx.t("saved"), redirect: "?" } : fail(ctx, "saveFailed");
  },
  async markPaid(ctx, values) {
    if (!can(ctx, "manage") || !idOk(values.id)) return fail(ctx, "noRight");
    const r = await O.markPaid(ctx, values.id, { eventId: `manual:${values.id}` });
    Mail.flushSoon(ctx);
    return r.ok ? { ok: ctx.t(r.state === "paid_to_resolve" ? "paidToResolve" : "markedPaid"), redirect: `?order=${values.id}` } : fail(ctx, "saveFailed");
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

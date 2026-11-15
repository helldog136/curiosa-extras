// Shop (EXPERIMENTAL prototype): the public page (catalogue) and the private order page. Everything a person typed goes through esc().
import { esc, formatMoney, currencyOf, isToken, num } from "./lib.mjs";
import * as D from "./data.mjs";
import * as S from "./stock.mjs";
import * as P from "./payments.mjs";
import { ORDER_STATES } from "./lib.mjs";

const CSS = `.sh{max-width:56rem;display:grid;gap:1rem}.sh *{box-sizing:border-box}
.sh-grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))}
.sh-card{border:1px solid var(--v-line);border-radius:12px;background:var(--v-surface);color:var(--v-fg);padding:1rem;display:grid;gap:.5rem;align-content:start}
.sh-card h3{margin:0;font-size:1.05rem;overflow-wrap:anywhere}.sh-muted{color:var(--v-muted);margin:0;overflow-wrap:anywhere}
.sh-var{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between}
.sh-btn{min-height:44px;padding:.6rem 1.2rem;font:inherit;font-weight:600;border:1px solid transparent;border-radius:999px;background:var(--v-accent);color:var(--v-accent-fg);cursor:pointer}
.sh-btn:disabled{opacity:.6;cursor:not-allowed}.sh-btn-quiet{background:transparent;color:var(--v-fg);border-color:var(--v-line)}
.sh-btn:focus-visible,.sh-in:focus-visible{outline:3px solid var(--v-accent);outline-offset:2px}
.sh-in{width:100%;min-height:44px;padding:.6rem .75rem;font:inherit;color:var(--v-fg);background:var(--v-bg);border:1px solid var(--v-line);border-radius:8px}
.sh-badge{font-size:.85rem;font-weight:600;color:var(--v-warning)}.sh-msg{min-height:1.2em;margin:0}.sh-err{color:var(--v-danger)}
.sh-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.sh-lines{list-style:none;margin:0;padding:0;display:grid;gap:.4rem}
.sh-lines li{display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;justify-content:space-between}`;
const style = () => `<style>${CSS}</style>`;

const stockNote = (ctx, a) => (a.available === Infinity ? "" : a.available <= 0 ? ctx.t("soldOut") : a.available <= num(ctx.setting("lowStock"), 2, 0, 100) ? ctx.t("fewLeft", { n: a.available }) : "");

export async function page(ctx, { segments = [] } = {}) {
  if (segments[0] === "track" && segments.length === 2) return trackPage(ctx, segments[1]);
  if (segments.length) return { notFound: true };
  const currency = currencyOf(ctx), products = await D.listProducts(ctx, { published: true });
  const base = `/m/${ctx.instance.key}`;
  const announcement = String(ctx.setting("announcement") ?? "").trim();
  const cards = [];
  for (const p of products) {
    const rows = [];
    for (const v of p.variants) {
      const a = await S.availability(ctx, p, v);
      const note = stockNote(ctx, a);
      rows.push(`<form class="sh-var sh-add" method="post" action="${base}/add"><input type="hidden" name="productId" value="${esc(p.id)}"><input type="hidden" name="variantId" value="${esc(v.id)}"><input type="hidden" name="qty" value="1"><input class="sh-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">`
        + `<span>${esc(v.label || "")} <strong>${esc(formatMoney(v.price, currency, ctx.locale))}</strong>${note ? ` <span class="sh-badge">${esc(note)}</span>` : ""}</span>`
        + `<button class="sh-btn" type="submit"${a.available <= 0 ? " disabled" : ""}>${esc(ctx.t("addToCart"))}</button></form>`);
    }
    cards.push(`<article class="sh-card"><h3>${esc(p.title)}</h3>${p.description ? `<p class="sh-muted">${esc(p.description)}</p>` : ""}${rows.join("")}</article>`);
  }
  const t = JSON.stringify({ cart: ctx.t("cartTitle"), empty: ctx.t("cartEmpty"), remove: ctx.t("remove"), total: ctx.t("total"), left: ctx.t("timeLeft"), expired: ctx.t("cartExpired"),
    name: ctx.t("fName"), email: ctx.t("fEmail"), address: ctx.t("fAddress"), order: ctx.t("placeOrder"), sold: ctx.t("soldOutNow"), errName: ctx.t("errName"), errEmail: ctx.t("errEmail"), errAddress: ctx.t("errAddress"),
    rate: ctx.t("errRate"), generic: ctx.t("errGeneric"), qty: ctx.t("qtyLimit") });
  const html = `${style()}<div class="sh">${announcement ? `<p class="sh-card" role="status">${esc(announcement)}</p>` : ""}`
    + (cards.length ? `<div class="sh-grid">${cards.join("")}</div>` : `<p class="sh-card">${esc(ctx.t("noProducts"))}</p>`)
    + `<section id="shop-cart" class="sh-card" aria-live="polite" data-base="${esc(base)}" data-t="${esc(t)}"></section></div>`;
  return { title: ctx.t("pageTitle"), description: ctx.t("pageDescription"), blocks: [{ type: "html", html }], scripts: ["shop.js"] };
}

async function trackPage(ctx, token) {
  let order = isToken(token) ? await D.findOrderByToken(ctx, token) : null;
  if (!order) return { notFound: true };
  // Coming back from the payment page: ask the provider for the real state (at most every 20 s per order, never the customer's word).
  if (order.payment?.providerRef && ["open", "pending"].includes(order.payment.state) && ["awaiting_payment", "expired"].includes(order.state) && Date.now() - (order.payment.checkedAt ?? 0) > 20_000) {
    try { await P.refreshOrder(ctx, order); order = (await D.findOrderByToken(ctx, token)) ?? order; } catch { /* the page still shows what we know */ }
  }
  const money = (c) => formatMoney(c, order.currency, ctx.locale);
  const lines = order.lines.map((l) => `<li><span>${esc(l.qty)} × ${esc(l.title)}${l.label ? ` (${esc(l.label)})` : ""}</span><span>${esc(money(l.sum))}</span></li>`).join("");
  const pay = order.payment, waiting = order.state === "awaiting_payment" && order.holdUntil > Date.now();
  const payBlock = !pay || !waiting ? "" : ["failed", "canceled", "expired"].includes(pay.state)
    ? `<p role="status">${esc(ctx.t("payFailed"))}</p><form method="post" action="/m/${esc(ctx.instance.key)}/pay"><input type="hidden" name="t" value="${esc(token)}"><button class="sh-btn" type="submit">${esc(ctx.t("tryAgain"))}</button></form>`
    : `<p><a class="sh-btn" style="display:inline-block;text-decoration:none;line-height:1.6" href="${esc(pay.checkoutUrl)}" rel="noopener">${esc(ctx.t("payNow"))}</a></p><p class="sh-muted">${esc(ctx.t("payPending"))}</p>`;
  const startFailed = order.state === "awaiting_payment" && !pay && order.history.some((h) => h.s === "payment_start_failed")
    ? `<p role="status">${esc(ctx.t("payStartFailed"))}</p><form method="post" action="/m/${esc(ctx.instance.key)}/pay"><input type="hidden" name="t" value="${esc(token)}"><button class="sh-btn" type="submit">${esc(ctx.t("tryAgain"))}</button></form>` : "";
  const hist = order.history.filter((h) => ORDER_STATES.includes(h.s)).map((h) => `<li>${esc(ctx.t(`state_${h.s}`))} <time>${esc(h.at.slice(0, 16).replace("T", " "))}</time></li>`).join("");
  const html = `${style()}<div class="sh"><section class="sh-card"><h3>${esc(ctx.t("orderNumber", { n: order.number }))}</h3><p role="status"><strong>${esc(ctx.t(`state_${order.state}`))}</strong></p>`
    + (order.state === "awaiting_payment" && !pay ? `<p class="sh-muted">${esc(ctx.t("awaitingHelp"))}</p>` : "") + payBlock + startFailed
    + `<ul class="sh-lines">${lines}</ul><p><strong>${esc(ctx.t("total"))} ${esc(money(order.total))}</strong>${order.includedTax ? ` <span class="sh-muted">${esc(ctx.t("includesTax", { amount: money(order.includedTax) }))}</span>` : ""}</p>`
    + (order.tracking ? `<p>${esc(ctx.t("trackingNumber"))} <strong>${esc(order.tracking)}</strong></p>` : "")
    + `<ul class="sh-lines">${hist}</ul></section></div>`;
  return { title: ctx.t("trackTitle"), blocks: [{ type: "html", html }], robots: "noindex" };
}

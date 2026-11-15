// Shop (EXPERIMENTAL prototype, not for release): catalogue, stock by reservations, cart with a 5-minute timer, manual orders.
// Read in this order: lib → stock → data → cart → orders → routes → public → admin. See docs/ideas/BOUTIQUE.md.
const v = new URL(import.meta.url).search;
const L = await import(`./lib.mjs${v}`);
const S = await import(`./stock.mjs${v}`);
const C = await import(`./cart.mjs${v}`);
const O = await import(`./orders.mjs${v}`);
const P = await import(`./public.mjs${v}`);
const R = (await import(`./routes.mjs${v}`)).default;
const A = await import(`./admin.mjs${v}`);
const Pay = await import(`./payments.mjs${v}`);

/** Housekeeping, safe to replay: dead carts, old dead reservations, orders whose hold ended. */
export async function cleanup(ctx, now = Date.now()) {
  return { carts: await C.sweepCarts(ctx, now), reservations: await S.purgeDead(ctx, now), expiredOrders: await O.expireOrders(ctx, now) };
}

export default {
  page: P.page,
  routes: R,
  adminPanel: A.adminPanel,
  adminActions: A.adminActions,
  adminBadge: A.adminBadge,
  services: { "payment.consumer": { notify: (ctx, args) => Pay.consumer.notify(ctx, args) } },
  tasks: { cleanup: { everyMinutes: 5, run: (ctx) => cleanup(ctx) }, payments: { everyMinutes: 5, run: (ctx) => Pay.pollOpenPayments(ctx) } },
  hooks: { async onInstanceDelete(ctx) { L.forgetInstance(ctx.instance.key); } },
};

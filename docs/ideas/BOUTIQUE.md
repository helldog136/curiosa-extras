# Shop module (`shop`): exploration notes

> **Status: exploration only.** Branch `explore/shop-module`. Nothing here is released, no pull request is open, no real payment key is ever used. This file records decisions, open questions and proposals. Core 0.15.0, extras 1.82.0.

## 1. Decisions so far

| # | Decision | Source |
|---|---|---|
| D1 | Curiosa is for everyone, not only its first owner: the module is designed for an **international** audience. It never claims legal compliance; each shop owner stays responsible for their own legal setup (see section 6). | Owner |
| D2 | **First version: physical goods in limited quantity** (example: a maker of hand-made plush toys). | Owner |
| D3 | The product model is **generic from day one** so that later versions can add **downloadable digital content**, **voluntary donations** and **ticketing** without migrating data. | Owner |
| D4 | Payments are **separate modules, one per provider**, offering one common service that the shop consumes. The shop depends on no specific provider. | Owner |
| D5 | Card data never passes through Curiosa: hosted payment pages only. | Owner mission |
| D7 | **Feature target: the level of SumUp's free online store** (section 10). The module itself takes no commission; only the payment provider's own fee applies (to verify per provider). | Owner |
| D8 | **Slicing agreed**: (1) catalogue, variants, stock with low-stock alert, announcement bar, shop page and cart; (2) shipping zones + pickup + tracking number, order list, payment; (3) discount codes, promotions, cross-selling, reports. The first delivery must be **designed with the later ones in mind** (order lines, price snapshots, stock reservation, discount hooks), even though they are not built yet. | Owner |
| D9 | **Stock is reserved when an item goes into the cart. The cart expires after 5 minutes if no payment has been started**; the reserved pieces then go back on sale. What happens once a payment is started, and a payment arriving after expiry, are still open (section 7). | Owner |
| D6 | **Prices are tax-inclusive.** The seller enters their own tax rates (a small list in the shop settings, e.g. "Standard", "Reduced", "None"); each product or variant picks one. The module shows the included tax amount on the order for information only, with no per-country rules, and states no legal conclusion. Exact rounding rules and invoice wording need a human accounting review. | Owner |

## 2. What the core already gives us (read, not yet tested)

Verified by reading `docs/MODULES.md` and `src/app/m/[instance]/[...path]/route.ts` of the core:

- `offers` / `requires` services: the core installs a missing provider by itself, supports several providers of one service (master/replicas), and `callAll` to ask every provider.
- Public HTTP routes `/m/<instance>/<name>` accept GET and POST. The core only rejects a write whose `Origin` header names another host; a server-to-server webhook normally has no `Origin`, so it should pass. **To confirm in a test.**
- Route handlers receive a standard `Request`, so the raw body is probably available for signature checks. **Not verified.**
- E-mail: `ctx.api.mail.send`, plain text only, 10 per hour per instance and 40 per hour for the whole site. **Too tight for order confirmations once sales grow**: possible core need (see section 8).
- `ctx.api.net.request` is the core HTTP client (timeouts, circuit breaker, no retry for POST). Idempotency keys must be handled by the provider module.
- The `commissions` module is the closest model: public form, private tracking link (160-bit token, only the hash is stored), rate limits, mailer, queue.

## 3. Product model (draft)

All amounts are **integers in the smallest currency unit** (cents) plus a currency code. One currency per shop in v1 (the owner picks it).

```
Product
  id, slug, title, description (per language), images[]
  kind: "physical" | "digital" | "donation" | "ticket"     // v1 enables "physical" only
  status: "draft" | "published" | "archived"
  variants[]            // always at least one ("Default"); plush: size, colour
Variant
  id, label, sku?
  price: { amount, currency }      // donation: { min, suggested[] }, no fixed price
  stock: { mode: "tracked" | "unlimited" | "single", onHand, reserved }
  // single = one-of-a-kind item (hand-made piece); tracked = counted; unlimited = no limit
  fulfilment: depends on kind (below)
Order
  id, number, state, lines[] (snapshot of title, variant, price at purchase),
  customer { name, email, shippingAddress? }, totals, currency,
  payment { provider, providerRef, state }, history[], notes (private)
```

What changes per `kind` (the form shows only the fields that apply):

| kind | stock | needs address | after payment | later version |
|---|---|---|---|---|
| physical | counted or single | yes | order to prepare, then shipped (tracking number optional) | v1 |
| digital | usually unlimited | no | private download link, limited in time and count | later |
| donation | none | no | thank-you, optional receipt | later |
| ticket | per date or session | no | ticket code by e-mail, check-in list | later |

## 4. Proposed order states (physical)

`pending_payment` → `paid` → `preparing` → `shipped` → `delivered`; side exits: `expired` (reservation lapsed, never paid), `cancelled`, `refunded`, `partially_refunded`. Every change is appended to `history` with a date and the actor.

## 5. Payment service contract (first proposal, to discuss later)

Service `payment.provider`, version 1. Provider modules offer it; the shop `requires` it, with at least one active provider needed to sell online.

- `capabilities()` → currencies, countries, payment methods, refund support.
- `createCheckout({ orderId, amount, currency, description, returnUrl, cancelUrl, idempotencyKey })` → `{ checkoutUrl, providerRef }` (hosted page, redirect).
- Webhook route owned by each provider module: verifies the provider signature, then calls the shop service `shop.paymentEvent({ providerRef, orderId, state, amount, currency, eventId })`. The shop never trusts the redirect back from the provider; it only trusts the confirmed event (and may re-fetch the payment status from the provider).
- `refund({ providerRef, amount, idempotencyKey })` → `{ ok, refundRef }`.
- A manual provider (bank transfer / cash on pickup) is the simplest implementation and gives a payment-free first delivery.

Not designed yet: fees, payment expiry, partial captures, disputes. Provider APIs and fees are **not verified yet**; web research is planned (see section 9).

## 6. Legal and compliance: what the module will and will not do

Principle: **the module helps, it never certifies.** Anything below needs a human legal or accounting review before any real sale.

- International use means VAT/sales-tax rules, consumer withdrawal rights, mandatory shop information, privacy law and invoicing rules differ per country. The module will store configurable fields (seller identity, return policy text, tax mode) and show them; it will not compute or assert correct taxes in v1.
- Open: link with the `legal-pages` module for terms of sale.

## 7. Open questions

1. ~~Tax handling in v1~~ settled by D6.
2. Shipping: flat price per country zone, or "contact me for shipping" only? (to ask)
3. Hold duration once a payment is started, and late payments (human-validated refund proposed, not confirmed). Risk to handle: bots filling carts to block stock (limits per cart, per visitor, per hour).
4. Customers: stored in the shop only, or linked to the `contacts` module?
5. E-mail volume limit of the core (section 2).

## 8. Possible core needs (not changed, only described)

- Higher or configurable mail limits and HTML mails for transactional messages.
- Confirm a raw request body is available to routes (webhook signatures).
- A way for a module to declare an HTTP route that is exempt from the visitor rate limiter, if any exists.

## 9. Planned slicing (superseded in part by D8; to refine)

| # | Delivery | Effort | Risk |
|---|---|---|---|
| 1 | Products and catalogue, public shop page, no payment | M | low |
| 2 | Manual orders, stock, reservation | M | medium (stock races) |
| 3 | `payment.provider` contract + first provider in test mode | L | high (money, webhooks) |
| 4 | E-mails and order documents | M | medium |
| 5 | Other providers | M each | medium |
| 6 | Digital, donations, tickets | M each | medium |

## 10. Research log

### SumUp Online Store (feature benchmark)

Checked on 2026-11-15 from SumUp's own UK pages ([online store](https://sumup.com/en-gb/online-store), [2021 press release](https://www.sumup.com/en-gb/press/sumup-online-store-revamp-powers-new-wave-of-smart-tools-for-small-business/)). The pages are marketing text: they name features without detail, and the press release is from 2021.

Stated by SumUp: item catalogue, templates / fonts / colours and a theme editor, custom domain, shipping methods, in-store pickup, shipment tracking, discount codes, sales promotions, cross-selling, announcement bar, inventory management with restock alerts, order summary, real-time reports, secure online payments, sharing product links on social media. Fees on the UK page: 0 to create, 0 per month, 2.5 % per transaction; an Irish pricing page shows 1.69 % for pay-as-you-go digital payments (a third-party review, less reliable, mentions refund and chargeback charges). **No Belgian figure was found.**

**Not stated** (do not assume): variants, taxes, customer e-mails, digital goods, product limits, shipping zones or rates.

How the benchmark maps to this exploration:

| SumUp feature | Shop module | Where |
|---|---|---|
| Item catalogue, images | yes | delivery 1 |
| Templates, colours, fonts | the site's own skins; the shop adds no theme editor | core |
| Custom domain | the site's own domain | core |
| Shipping methods, pickup, tracking | zones with a flat price, a pickup option, a tracking number typed by hand | delivery 2 |
| Inventory + restock alerts | counted / single / unlimited stock, low-stock alert | delivery 2 |
| Order summary, reports | order list with search and state filters, simple totals | delivery 2 |
| Discount codes, sales promotions | codes (percent or amount, limited uses, dates) | delivery 5 |
| Announcement bar | optional banner on the shop page | delivery 1 |
| Cross-selling | "goes well with" products on a product page | delivery 5 |
| Secure online payments | `payment.provider` service and provider modules | delivery 3 |

### Payment providers (first pass, 2026-11-15, search snippets only)

Only search results were read, not the full official pages. Treat every figure as **to re-check on the live pricing page for the seller's country before use**.

- **Mollie.** Its own Bancontact pages state a flat 0.39 EUR per successful transaction ([mollie.com/payments/bancontact](https://mollie.com/payments/bancontact)); a third-party blog gives a different figure, so it is discarded. Flow described in Mollie's docs ([docs.mollie.com](https://docs.mollie.com/docs/online-payments), [webhooks](https://docs.mollie.com/docs/webhooks)): create a payment with a `webhookUrl`, get a checkout link, redirect the customer with a GET; the return redirect is **not** proof of payment. A classic webhook carries only the payment id, so the handler fetches the payment from the API and acts on its status ([Hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-mollie-webhooks-features-and-best-practices), third party). Sources disagree on signatures: classic webhooks are said to be unsigned, while Mollie's "next-gen webhooks" page mentions signature verification ([docs.mollie.com/reference/webhooks-new](https://docs.mollie.com/reference/webhooks-new.md)). **To verify in the official docs.**
- **Stripe.** Standard EU cards 1.5 % + 0.25 EUR, premium EU cards 1.9 % + 0.25 EUR, from an EEA pricing page dated 2023 ([support.stripe.com](https://support.stripe.com/questions/pricing-updates-for-businesses-based-in-the-european-economic-area-(eea))). Bancontact is available through Checkout ([stripe.com Bancontact](https://stripe.com/en-dk/payment-method/bancontact)); no Belgian Bancontact fee found. Webhook signing (`Stripe-Signature`): **not checked**.
- **PayPal, manual transfer:** not researched yet.

Design consequence (assumption, to validate): the shop treats any provider webhook as a **notification only** and asks the provider module to re-fetch the payment status (`payment.provider.status`). This works for signed and unsigned webhooks and keeps the shop independent of each provider's signing scheme.

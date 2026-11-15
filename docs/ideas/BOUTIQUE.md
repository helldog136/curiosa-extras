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
3. Stock reservation duration during payment (proposed: 30 minutes, configurable).
4. Customers: stored in the shop only, or linked to the `contacts` module?
5. E-mail volume limit of the core (section 2).

## 8. Possible core needs (not changed, only described)

- Higher or configurable mail limits and HTML mails for transactional messages.
- Confirm a raw request body is available to routes (webhook signatures).
- A way for a module to declare an HTTP route that is exempt from the visitor rate limiter, if any exists.

## 9. Planned slicing (to refine)

| # | Delivery | Effort | Risk |
|---|---|---|---|
| 1 | Products and catalogue, public shop page, no payment | M | low |
| 2 | Manual orders, stock, reservation | M | medium (stock races) |
| 3 | `payment.provider` contract + first provider in test mode | L | high (money, webhooks) |
| 4 | E-mails and order documents | M | medium |
| 5 | Other providers | M each | medium |
| 6 | Digital, donations, tickets | M each | medium |

## 10. Research log

Nothing researched on the web yet. Provider documentation and fees will be listed here with sources, separating what was checked from what is assumed.

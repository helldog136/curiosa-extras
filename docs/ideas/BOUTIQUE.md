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
| D10 | **Cart timer resets to 5 minutes on every cart change** and when the payment page is opened; the remaining time is shown. **Hold once payment starts:** card, Bancontact, PayPal: until the provider reports failure or expiry, 30 minutes at most; manual bank transfer: 24 hours (configurable), then released. Limits against stock hoarding: max quantity per cart, carts per visitor per hour, global cap of reserved pieces (imperfect without customer accounts). | Owner |
| D11 | **E-mail:** the core mail limits will be raised (core change, to be made in the core repository, not here), and the shop still keeps its own **outgoing queue**: when the limit is reached, order e-mails wait and go out in batches, retried later, never lost. The private tracking link stays the reference confirmation; e-mail is a complement. Seller notifications can be grouped into one digest when several orders arrive together. | Owner |
| D12 | **Data retention:** keep what the law requires the seller to keep; everything else is configurable by the seller and by the customer. Because the module cannot know the legal duties of every country, it carries **no hard-coded legal duration**: a per-country table of required retention is data, each row marked "checked by a human on <date>" with its source, and a country without a checked row defaults to "keep order lines, never delete automatically" plus a notice to ask an accountant. Personal contact data (address, phone, e-mail) that is not required is erased after a delay chosen by the seller. The customer can ask, from the private tracking page, to erase their personal data; the module erases what is not required and tells what it must keep and why. **Needs a human legal review before any real sale** (privacy law versus accounting duties differ per country). | Owner |
| D13 | **Admin layout:** three tabs. **Orders** (opens first): one table, live search, state filters (To prepare, Shipped, To resolve, All), late-paid orders highlighted in colour and text, empty state offers "Add a product". **Products**: searchable table, product sheet in a dialog with 5 visible fields (name, photos, price, stock, variants), the rest under "More options", stock editable in the row with a low-stock alert. **Settings**: at most 7 simple settings (currency, shipping zones and prices, pickup, tax rates, announcement bar, data retention; hold durations in advanced), working with defaults. Manual orders work without any payment provider; connecting one is a wizard of at most 3 steps. Rules R1 to R32 apply and the PR will need the ergonomics section when the time comes. | Owner |
| D14 | **Guest checkout, no customer accounts.** Name, e-mail and address at checkout, a private tracking link as confirmation (model: `commissions`). The cart needs a small functional cookie, declared in the module's privacy statement; whether it needs a consent banner is a legal question, not concluded here. Customer accounts, if ever, come much later. | Owner |
| D15 | **Every shop owner has their own contract and their own keys with each payment provider.** There is no Curiosa platform account, no commission and no money passing through the project or its servers (Connect / OAuth marketplace modes are refused: they would need a central application with legal duties). A provider module asks for the owner's own key (a secret setting), starts in test mode, and the owner switches to the live key themselves. | Owner, from self-hosting |
| D16 | **First provider is validated against a fake provider server** (no account, no key); a real test-mode run is a later step and needs the owner's own free test account entered through a secure form. **A public https address is a prerequisite**, handled like the Twitch activity module: no install gate in the core (none exists), the module shows a clear blocking state (site not reachable, it needs a public secure address) and refuses live mode until `ctx.api.siteUrl` is a public https address. Test mode works anywhere, and the polling fallback covers the missing notifications. | Owner |
| D17 | **No e-mail, no shop.** The shop is closed (no catalogue page to buy from, no cart, no order) while the site cannot send e-mail; the administration says so with a link to the e-mail settings, and the shop opens again by itself. Orders already placed stay followable. The check is `ctx.api.mail.configured()` (a server is set up); a later send failure is for the e-mail delivery to handle. The e-mails themselves (confirmation, queue of D11) are **not built yet**: today the rule only closes the shop. | Owner |
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
3. Late payment after the hold ended: order accepted if the piece is still free, otherwise state `paid_to_resolve` and the seller decides the refund, never automatic (proposed; the owner agreed on the durations, not yet explicitly on this rule). Risk to handle: bots filling carts to block stock (limits per cart, per visitor, per hour).
4. Customers: stored in the shop only, or linked to the `contacts` module?
5. ~~E-mail volume limit of the core~~ settled by D11 (exact new limits still to set in the core).

## 7b. Reliability design (draft, from reading the storage API)

Finding (read in `docs/MODULES.md`, "ctx.api.store"): the store has `add`, `get`, `update` (replaces the whole document), `list`, `page`, `getByKey`, `addMany` (one transaction) and `remove`. **There is no atomic increment, no compare-and-set and no lock.** A stock counter updated by read-modify-write would lose updates when two buyers act at the same time. Not verified: whether the core runs a single Node process (an in-memory lock would then help but is not enough alone).

Proposed approach, to prove with tests in the prototype:

- **Never store a mutable stock counter that buyers write to.** Stock is `onHand` (written only by the seller) minus the sum of **reservation documents**, each created with `add` (one document per reserved line, with an expiry time and an owner cart id).
- **Reserve = add, then verify.** Add the reservation, re-read all active reservations for the variant in a total order (creation order, id as tie-break), and keep it only if the cumulative quantity up to and including it fits in `onHand`. Otherwise remove it and answer "no longer available". Two buyers of the last piece: both add, both re-read, only the first in the total order keeps it. Needs the order of ids and `createdAt` to be stable: to check in the real store.
- **Expiry is computed, not deleted by a timer**: a reservation past its time simply stops counting; a task cleans old documents (tasks must be idempotent).
- **Payments:** every provider event carries an event id; the order stores the ids already processed (idempotent replay). A paid event is accepted only if the amount and currency equal the order totals; the status is re-read from the provider (D5 consequence). Late payment: see open question 3.
- **Webhook route hardening:** method check, size limit, no secrets in logs, same answer for unknown payments, rate limit that cannot block the provider's real calls (to check how the core's route limiter behaves).

## 8. Possible core needs (not changed, only described)

- **Raise the mail limits** (agreed by the owner). Suggestion to discuss: a separate "transactional" allowance, for example 60 per hour per instance and 200 per hour for the site (numbers are a guess, to size against typical SMTP provider limits), plus an optional simple HTML format. Without it the shop's queue (D11) still works, just slower.
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

## 11. Prototype status (`modules/shop/`, version 0.1.0, 2026-11-15)

Throwaway code on this branch only. Not released, not in `catalogue/index.json` (so `node scripts/build-index.mjs --check` reports an out-of-date index on this branch **on purpose**; do not regenerate it unless the module is ever meant to be published).

**What exists:** products with variants and tax rate, stock modes (counted, one of a kind, unlimited), stock by reservation documents, cart with the 5-minute timer restarting on every change, checkout without an account, manual payment, 24 h hold, late-payment handling (`paid_to_resolve`, never an automatic refund), order states, seller administration (orders, products, low-stock banner), public page, private tracking page, cart script, daily-style clean-up task, EN/FR texts.

**Checked (commands run on 2026-11-15):**
- `CURIOSA_DIR=../Curiosa node scripts/test.mjs tests/shop.test.mjs`: 27 tests pass. They include 20 simultaneous buyers of the last piece (exactly one wins, losers leave nothing behind), 25 randomised rounds of simultaneous buyers (never more held than in stock), cart expiry and timer restart, price and tax snapshot, idempotent payment events, late payment with all-or-nothing re-reservation, routes (methods, honeypot, rate limits, cookie flags), escaping, rights, French page.
- `tests/conformance.test.mjs` (the core's suite, run on every module): 0 failures, including `admin.ergonomics` for this module.
- A browser run (Chromium, 1280 px and 390 px) against a throwaway server using the real module code and an in-memory store: add to cart, countdown, stale page cannot take the one-of-a-kind item, fresh page shows it sold out, remove, errors under the fields with focus on the first, checkout to the private page, no horizontal scroll, controls at least 44 px high. Screenshots were looked at.

**NOT verified:**
- ~~The reservation algorithm on the real core storage~~ tested in section 12: the first version **oversold**; the version with a lock does not, in one process. Still unknown: behaviour with several processes (see section 12).
- No real core was started: page rendering, the `scripts` mechanism, CSP and the admin blocks were not seen in the real site. The administration page was only built as blocks and tested as data, not looked at.
- Ergonomics rules R1 to R32 are **not** met in full: no edit dialog, no inline stock editing, no payment wizard, no screenshots of the administration. A real delivery needs the "Ergonomics" section.
- No payment provider, no e-mail, no shipping prices, no data retention or erasure (D12), no photos, no tax rate list (a rate is typed per product), no link with `contacts`.
- Small known flaws: field errors stay visible after the field is corrected; the stock note on the shop page does not refresh without reloading; opening the payment page does not yet restart the timer (`cart.touch` exists but is not wired); the `Secure` cookie flag was not exercised over plain HTTP.

**Findings for the core:** a public `page()` cannot read cookies, so a per-visitor cart needs a route plus a page script; the store has no atomic operation (see 7b); mail limits (D11).

## 12. Reservation on the real core store, and core needs (2026-11-15)

### What was measured

Real core code (`src/core/services/store.ts`, Prisma, SQLite, migrations applied to a throwaway database), invented data, script `scripts/shop-real-store-stress.mjs` (usage in its header). One round = one product with capacity 1, 2 or 3 and 30 simultaneous buyers each adding one piece to a cart; an oversale is a round where more buyers got the piece than the capacity.

| Version of the reservation step | Database connections | Rounds x buyers | Oversold rounds |
|---|---|---|---|
| add, read in order, keep if it fits (as first built) | pool (production setting) | 60 x 20 | **9** |
| same | pool | 100 x 30 (control run, lock switched off) | **11** (210 pieces sold for 199 in stock) |
| same | 1 (setting of the core's own tests) | 60 x 20 | 0 |
| **same, steps of one variant run one after the other (lock in the module)** | pool | 150 x 30 and 100 x 30 | **0** (exactly 199 pieces sold for 199 in stock) |
| same, with the lock | 1 | 150 x 30 and 100 x 30 | **0** |

**Why it failed.** The store stamps a document with its creation time and id *before* the write is committed, and in production several connections write at once. A document can therefore get an earlier place in the order than another one and become visible later; the other buyer has already read the list without it and kept the piece. The in-memory store used by the unit tests cannot show this, and the core's own database helper uses a single connection, so it would not show it either. **Suggestion for the core:** let its database test helper offer a multi-connection mode.

**Fix in the module, no core change:** `withLock` in `modules/shop/lib.mjs` runs the reservation steps of one variant one after the other inside the process. The lock lives on `globalThis` so that a module update (which reloads the files under a new version) shares it. Unit test: `tests/shop.test.mjs`.

**Limit, stated plainly.** The lock protects one process. The core starts one `next start` process per data volume and its own notes say "one container per volume" (`scripts/docker-entrypoint.mjs`, `docs/ideas/update-paths.md`), so this holds for the normal setup, but a deployment with several processes on one database would oversell again. Not tested, not supported.

### Core functions the shop needs, checked one by one

Read in the core source or the docs, not all run:

| Need | State | Verdict |
|---|---|---|
| Provider webhooks: raw body for signatures, no `Origin` header, POST | `src/app/m/[instance]/[...path]/route.ts` hands the untouched `Request` to the module, rejects a write only when an `Origin` names another host, and applies no rate limit of its own | OK, nothing to add (the signature check itself is not written yet) |
| Calling provider APIs: POST, headers, idempotency key, timeout | `ctx.api.net.request` supports method, headers and body, never retries a POST, 20 s at most, text answers | OK |
| Provider modules calling the shop without forcing its installation | optional `requires` is never installed by itself; `offers.each` lets every provider instance answer | OK on paper (design, not yet built) |
| Scheduled clean-up | tasks every minute at the earliest | OK |
| Fresh stock on the shop page | `page()` is rendered on every request (`force-dynamic`) | OK |
| Cart per visitor | a public `page()` cannot read cookies | Worked around: route plus page script |
| Atomic stock | no atomic operation in the store | Worked around by the lock. **Optional hardening, generic:** `store.addIfAbsent(collection, key, data)`, an atomic insert when no record has that key. Polls (one vote per person) and promo codes (usage limits) have the same need. Not indispensable now; build only if several processes ever become supported. |
| Order e-mails | 10 per hour per instance, 40 per site, text only | **Indispensable before real sales** (agreed in D11): a separate, higher allowance for transactional mail. HTML mail is optional. |
| Private downloads for digital products (later) | uploads are served publicly with a one-year cache; a module cannot read files itself | Needed **only** for the digital delivery (later). Generic: a core function to deliver a stored file after a check made by the module (press kit and deliverables could use it). Not for delivery 1 or 2. |
| PDF invoices, HTML mail (later) | not offered | Later, after the legal review; not decided. |

**So the only core change the first deliveries need is the mail allowance.** Everything else is either done, worked around inside the module, or belongs to a later delivery.

## 13. Payment providers when every site is self-hosted (2026-11-15)

### Consequences of "each owner has their own contract" (D15)

1. **The money goes straight from the customer to the owner's provider account.** Curiosa never holds funds, never needs a platform account and takes nothing.
2. **The owner opens the provider account themselves** and passes the provider's own checks (identity, business details, bank account). Nothing in the module can speed that up; it only explains it, and manual payment (bank transfer, cash on pickup) works meanwhile, so a shop is never blocked by the provider's checks.
3. **A provider module is a form for the owner's own key**, in three steps at most (rule R8): (1) a link to open the provider account, (2) paste the test key, (3) a test payment with the result shown; then a clearly worded switch to the live key. A banner "Test mode" stays on the shop administration until the live key is in.
4. **The provider's fees and rules are the owner's.** The shop shows no fee. The module's page points to the provider's own price list; it does not promise any figure.
5. **Which provider is possible depends on the owner's country and activity.** Not verified per country. The module only says which providers are installed; the provider tells the owner whether their account is accepted.
6. **No key ever goes through a conversation or a repository.** Keys are secret settings (they never leave memory, per `docs/MODULES.md`). Tests use an invented key and a fake provider server only.

### The webhook problem of self-hosting

Mollie's documentation says the webhook address must be reachable from Mollie, so `localhost` does not work, and that live mode needs HTTPS ([webhook docs](https://docs.mollie.com/docs/webhooks), [next-gen webhooks](https://docs.mollie.com/reference/webhooks-new.md)). A site on a home connection, a NAS without a public address, or behind a router with no forwarding therefore cannot receive notifications. Two consequences for the design:

- **A notification is only a nudge** (already decided in section 5): the shop asks the provider for the payment's real state.
- **A fallback that needs no incoming connection:** when the customer comes back from the provider's page, and in a scheduled task every few minutes for open payments, the provider module asks for the state itself. A shop on a private address still works, only a few minutes later. The module tells the owner whether its public address works (a "reachable from the internet" check) instead of failing silently.

### Test and live keys, as far as verified

Mollie's authentication page says each website profile has a Live key and a Test key, to use the Test key while building and the Live key for real payments; keys beginning `test_` and `live_` come from partner documentation, not from Mollie's own reference ([authentication](https://docs.mollie.com/docs/authentication)). The page also says the key is shown only when it is created. **Not verified:** whether live payments require the account checks to be finished first, the checks themselves, and the same details for Stripe and PayPal.

### What the first provider delivery will and will not prove

Built and tested against a **fake provider server** that follows the documented flow (create payment, redirect, notification with only an identifier, state fetch, refund). That proves our side of the contract: idempotency, amounts, late payments, the polling fallback. It does **not** prove that Mollie accepts our calls: that needs the owner's own free test account and key, entered through a secure form, and a run in test mode.

### Public address prerequisite: what the Twitch modules actually do (checked in this repository)

- There is **no install-time prerequisite mechanism in the core** (searched the manifest schema and `MODULES.md`). `twitch-events` installs normally, then `diagnose()` calls its own `isPublicSite(ctx.api.siteUrl)` (https, real domain name, no IP address, no `localhost`, `.local` or `.lan`, default port) and reports the state `site_private`: "Twitch cannot reach your site: it needs a public secure address (https)". Its README says "needs a public https address: yes (the page says so)".
- The same helper is copied into more than one module. A third copy in the shop would be the cue for a **small generic core addition** (for example `ctx.api.siteIsPublic`), optionally with a "needs a public address" line on the extension sheet. Not indispensable: a copy in the module works. Not requested yet.
- A shop needs a public address anyway (customers must reach it); only live mode additionally needs https. That is why test mode can stay open on a private site.

## 14. The payment contract, as built and tested against a fake Mollie (2026-11-15)

Code: `modules/payment-mollie/` (new, version 0.1.0, experimental), `modules/shop/payments.mjs`, `tests/payment-mollie.test.mjs`, `tests/helpers/fakeMollie.mjs`. Same status as the shop: throwaway, not in the catalogue index, never run against Mollie itself.

### Two services, no module knows another by name

| Service | Offered by | Used by | Declared as |
|---|---|---|---|
| `payment.provider` v1 (`each: true`: every provider answers for itself) | each provider extension | the shop | the shop `requires` it **optionally**; a provider never forces the shop to be installed, and the shop works without any provider (manual payment) |
| `payment.consumer` v1 | the shop | providers, from their notification address | each provider `requires` it **optionally** |

Tests assert both declarations, that the shop's code never contains a provider name, and that the provider imports nothing from the shop.

### `payment.provider` v1

All amounts are integers in the smallest unit; every answer is plain data and never contains a secret.

- `describe()` → `{ id, name, mode: "test" | "live", ready, problems: ["no_key" | "bad_key" | "site_private"], publicSite }`. Real mode is not ready on a non-public address (D16); test mode is.
- `createCheckout({ idempotencyKey, amount, currency, description, returnUrl, metadata: { orderId }, locale })` → `{ ok: true, providerRef, checkoutUrl, expiresAt }` or `{ ok: false, reason: "not_ready" | "invalid" | "amount" | "currency" | "rejected" | "rejected_key" | "unavailable" }`. The provider keeps the idempotency key itself (Mollie's pages say nothing about an idempotency header) and a lock makes two simultaneous identical requests create one payment.
- `getStatus({ providerRef })` → `{ ok: true, state: "open" | "pending" | "paid" | "canceled" | "expired" | "failed", amount, currency, paidAt, refunded }` or `{ ok: false, reason: "unknown" | "unavailable" | "invalid" }`. A status or amount it does not recognise is an error, never a guess.
- `refund({ providerRef, amount, currency, reason, idempotencyKey })` → `{ ok, refundRef, state }`. Only a person ever asks (no screen yet); never automatic.

### `payment.consumer` v1

- `notify({ providerRef })`. The shop looks the reference up, **asks the provider for the real state**, and applies it. An unknown reference is answered "ok, unknown". At most one read per payment per 5 seconds, so a flood of forged calls costs nothing. If the provider cannot be asked, the call fails so that the provider answers "try again later".

### What the shop does with a state (`modules/shop/payments.mjs`)

`paid` → the same `markPaid` as the manual path, with the amount and currency checked, one event id per payment (`<ref>:paid`), so a replay changes nothing; late payment follows decision D10. `failed`, `canceled`, `expired` → the order keeps waiting until its hold ends and the customer can ask for another payment page (5 at most). A wrong amount never marks an order paid and flags it. A payment for a cancelled order flags it. **Nothing is ever refunded automatically.**

### Mollie facts used, from Mollie's own reference (read 2026-11-15)

Base `https://api.mollie.com/v2`; bearer key, `test_` or `live_`; `amount` is `{ currency, value }` with a string value; create answers 201 with `id`, `status` and `_links.checkout.href`; seven statuses, of which `paid`, `canceled`, `expired` and `failed` are final; `webhookUrl` cannot be `localhost`; the notification is a POST with one form field `id`, **no status and no signature**, only `200 OK` is expected, 10 calls over about 26 hours, an unknown id should still be answered 200; refunds cannot exceed the remaining amount and two identical refunds in a row give 409. Open payments expire after a time that depends on the method: **Bancontact 1 hour**, cards and iDEAL 15 minutes, PayPal 6 hours, bank transfer about 12 days. Mollie itself advises not to predict expiry.

**Consequence:** with a 30-minute hold and a one-hour Bancontact page, a customer can pay after our hold ended. That case is real, not theoretical, and the late-payment rule (D10) covers it. Cancelling the unpaid payment at Mollie when our hold ends would help; Mollie's cancel call was not among the pages read, so it is **not** built.

Not stated in the pages read, so assumed in the fake: the exact text of the 401 answer, and that a refund on an unpaid payment is a 422.

### Checked

- `tests/payment-mollie.test.mjs`: 17 tests pass, including webhook answers (405, 400, 413, 200 for unknown, 503 only when the state is unreadable), forged and repeated notifications, no incoming connection at all (polling), return to the tracking page, failed payment and retry, late payment with the piece free or taken, wrong amount, payment after cancellation, provider down at checkout, the access code never leaving the provider's header.
- **The tests were checked against deliberate defects:** removing the amount check, the idempotency lookup, or the re-reading of the real state each makes the matching tests fail; the code was restored afterwards.
- The core's conformance suite, run on every module, passes for both modules (one name clash was found and fixed: a secret setting called `apiKey` already exists in `youtube-connector`, so ours is `mollieCode`).

### NOT checked

Against Mollie itself (needs the owner's own free test account, D16). In a running core: the setup page and the shop's administration were tested as data, not looked at. No screen for refunds. The customer cannot choose between several providers (the first ready one is used). No e-mail. No cancellation at Mollie. The text of the setup page has not been reviewed against the ergonomics rules by a person.

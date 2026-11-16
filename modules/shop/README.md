# Shop (experimental prototype)

**This is a throwaway prototype, kept on the branch `explore/shop-module`. It is not meant to be released, and it takes no real payment.** The ideas behind it are in [docs/ideas/BOUTIQUE.md](../../docs/ideas/BOUTIQUE.md).

## What it does

- A page `/shop` that lists the products you put on sale, with an announcement bar and a "few left" or "sold out" note.
- A cart. An item is held for the customer as soon as it goes into the cart. The cart is released after 5 minutes without a change, and every change restarts the 5 minutes.
- An order without an account. The customer gives a name, an e-mail address and a delivery address, then gets a private link to follow the order.
- A manual payment: you mark the order as paid when the money arrives. Items are held for 24 hours while waiting.
- If the payment is marked after the hold ended, the items are taken again only if they are still free. Otherwise the order shows "Paid, to resolve" and you decide. Nothing is ever refunded automatically.
- An administration page: orders (with search and filters), products, and a stock alert.

## What it does not do yet

No shipping prices (online payment is a separate extension, see `payment-mollie`), no discount codes, no photos, no download or ticket products, no customer data cleanup, no link with the Contacts module. The administration page has not been checked against the ergonomics rules in `docs/ERGONOMIE-ADMIN.md`: products open on their own page instead of a dialog, and stock is edited in the product form, not in the list.

## E-mails

The shop only opens where the site can send e-mail. Each event writes **one** message into an outbox: the confirmation with the private link (the only message that holds it), then "payment received", "shipped" (with the tracking number) and "cancelled". The owner gets a single summary at most once an hour, ten minutes after the first event, with order numbers only. The core limits how many e-mails a site may send per hour: when it is reached, the rest waits in order and goes out later, nothing is lost. A real failure is retried with growing delays and given up after six tries or three days. A sent or given-up message keeps no address and no text.

## How the stock stays right

Buyers never change a counter. The stock you type is the number in hand; what is available is that number minus the reservations that are valid. A reservation is a small record. When two people want the last piece, both records are added, then each person reads all the records in order and keeps theirs only if it fits. Only the first one fits. This is tested with simultaneous purchases, in memory and on the real storage of the core (`scripts/shop-real-store-stress.mjs`). On the real storage the steps of one product must run one after the other: the module does it with a lock, which holds for one process only.

## Test

From the extras repository: `CURIOSA_DIR=../Curiosa node scripts/test.mjs tests/shop.test.mjs`. All test data is invented.

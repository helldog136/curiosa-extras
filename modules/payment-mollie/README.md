# Mollie payments (experimental prototype)

**A throwaway prototype on the branch `explore/shop-module`. It has only been tried against a fake Mollie server, never against Mollie itself, and it is not meant to be released.** The design is in [docs/ideas/BOUTIQUE.md](../../docs/ideas/BOUTIQUE.md), section 14.

## What it is

A small extension that lets a shop take online payments with **your own Mollie account**. Each site owner opens their own account and pastes their own access code: the money goes straight to you, nothing passes through Curiosa, and the project takes no commission. The customer pays on Mollie's own page; no card or bank detail ever reaches your site.

## What it does

- Tells the shop whether it is ready, in test or real mode (the access code starts with `test_` or `live_`).
- Creates a payment page for an order, asks Mollie for the real state of a payment, and can refund an amount when a person asks.
- Receives Mollie's notification. The notification only carries the payment reference: the extension passes it on and the shop asks Mollie for the real state, so a forged call can never mark an order as paid.
- A setup page with three steps: open an account, paste the access code, make a test payment (test code only).

## What you need

- A Mollie account, and its test or live access code.
- For real payments, a public secure address (https) for your site. In test mode any address works: the shop then checks payments itself every few minutes.

## Not done or not checked

Not tried against Mollie. Refunds are only a service call: no screen asks for them yet. Cancelling an unpaid payment when the shop releases the items is not implemented (Mollie's cancel call has not been read). Mollie's bank transfer, recurring payments and order lines are out of scope.

## Test

`CURIOSA_DIR=../Curiosa node scripts/test.mjs tests/payment-mollie.test.mjs`. All data is invented.

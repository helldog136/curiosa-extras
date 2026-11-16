# Core need: reset the upload limits of AI assistants, or lift them for a few minutes

> **A description for the core repository, not a change.** Written on the exploration branch `explore/shop-module` on 2026-11-16, after the owner asked: "allow resetting the limits, or lifting them temporarily, for example for the next 10 minutes". Everything below was **read** in `helldog136/Curiosa` (core 0.15.0: `src/core/mediaMcp.ts`, `src/core/services/mcp/server.ts`, `src/core/maintenance/slots.ts`, `docs/MAINTENANCE-IA.md`). Nothing was run and no code was written for the core.

## What exists today

| Limit | Value | Where | Can the owner change it? |
|---|---|---|---|
| Hourly counter of an access, class `content` (covers `media_upload`, `media_import`, settings, publishing) | 120 per hour | `maintenance/slots.ts` | **Yes**: Admin > AI assistants > the access: a "Reset the limits" button (journalled `mcp.limits.reset`) and, in advanced mode, the limit itself (10 to 1000, `mcp.limits.set`) |
| Hourly counter, class `risky` (installs, updates, restarts) | 12 per hour | same | Yes, same place (1 to 60) |
| Size of one image | 3 MB | `MAX_MEDIA_BYTES` in `mediaMcp.ts` | **No** (a constant) |
| Size of a `media_upload` call | 4.3 MB (3 MB in base64); every other call 1 MB | `MAX_BODY_MEDIA` in `mcp/server.ts` | **No** |
| Daily quota of the whole site for images sent by assistants | 100 images or 60 MB per 24 hours | `DAILY_FILES`, `DAILY_BYTES` in `mediaMcp.ts`, counted from the audit journal | **No, and no reset** |
| Type from the bytes, pixels (40 million), svg cleaning, 120 requests per minute | fixed | `mediaMcp.ts`, `imageDerive.ts` | No (and they should stay so) |

So part of the question already has an answer: **the hourly counters can be reset and changed today**. What is missing is the reset of the site's **daily quota**, any **temporary lifting**, and a **configurable image size**.

What the owner can do today without any change: reset or raise the hourly counter of the access (up to 1000 per hour); resize images below 3 MB; wait for the daily quota to roll over (it counts the last 24 hours of the journal).

## Proposal

One card, in the place and with the mechanism of the existing "Trusted image sources" card (Admin > AI assistants > Settings; owner-only behind `core:mcp.tokens`; values read from the database on every call; every action journalled).

1. **"Start the daily count over."** Writes `mcp.media.quotaFrom = now`. `usedToday()` then counts only the journal lines after `max(now - 24 h, quotaFrom)`. **No journal line is deleted or changed.** Journalled `mcp.media.quota.reset`.
2. **"Lift the limits for N minutes"** with N in 10, 30 or 60 (default 10, never more than 60). Writes `mcp.media.liftedUntil = now + N`. The date is **compared on every call, with no timer**, so a restart can neither extend nor forget it. While it lasts, and only for `media_upload` and `media_import`:
   - the daily quota is not applied;
   - the size of one image goes from 3 MB to 10 MB, and the body cap of `media_upload` from 4.3 MB to 14 MB;
   - the `content` hourly counter of the access is not applied (the `risky` class is **never** lifted).
3. **A visible state.** While lifted, a banner on the AI assistants page and on the dashboard says "Upload limits lifted until 14:32" with a "Stop now" button (which writes the current time, so the effect ends at once).
4. **Journal.** `mcp.limits.lift` (who, until when), `mcp.limits.lift.stop`, `mcp.media.quota.reset`; the actor is the signed-in owner, never an assistant. No assistant tool can read or write these settings (same rule as the trusted sources list).
5. **Optional, separate:** make the three constants settings with the current values as defaults and hard bounds (image 1 to 10 MB; daily 10 to 1000 images and 10 to 500 MB), under advanced mode. This is the same idea as the existing hourly limits.

### What must NOT be lifted, and why

"Disable" never means "unlimited": the base64 body of an upload is read into memory, so an unbounded size is a way to exhaust the server. So: the lifted size is a higher **bound** (10 MB), not none; the type is still read from the bytes; the pixel cap and the svg cleaning stay (they protect decoding); the 1 MB cap of every other call stays; the `risky` counter stays; the trusted-sources list stays; rights per tool stay. Lifting is time-boxed, owner-only, visible and journalled, because an assistant token with write rights is exactly what these limits protect against when it loops or is misused.

## Effort and risk

Effort **M**: two functions in `mediaMcp.ts` and one in `mcp/server.ts` read the settings instead of constants, one card and two server actions in `assistants/`, two settings keys, two journal types, a banner, texts in English and French, tests. Risk **low to medium**: memory use up to about 14 MB per upload call while lifted (a few at once at most, since lifting lasts minutes); the rest only narrows to what exists.

## Tests the change should carry

Reset: the count starts over, the journal is untouched, an older line before the reset is ignored, a line after it counts. Lift: before expiry the 10 MB image and the 100+ images pass, one second after expiry they are refused again, the `risky` class is refused all along, a restart in the middle keeps the same end time, "Stop now" ends it at once, the type/pixel/svg checks still refuse bad files while lifted, a non-owner cannot lift, no assistant tool can reach the settings, journal lines are written with the right actor.

## Not decided

Whether the lift should also cover `media_import`'s trusted download limit (3 MB per fetch, 10 images per call); whether 60 minutes is the right ceiling; whether the hourly `content` counter should be lifted or only raised (its bound is already 1000). Nothing here concerns the module `alerts-overlay`, whose chunked media tools have their own limits.

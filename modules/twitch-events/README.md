# Twitch activity (`twitch-events`)

Receives what happens on your Twitch channel (follows, subscriptions, resubs, gifted subs, bits, incoming raids, stream start and end, hype trains, and optionally channel point rewards),
keeps it in a **persistent journal**, and offers it to the other modules as the topic **`twitch.event`**. It never depends on its consumers (alerts, thanks wall, story, statistics...):
they read the topic if they want to. Needs the Twitch connector (`twitch.api` v3) and My Twitch channel (`twitch.live`).

## What the person sees

- **Events** tab: a status line ("Your site is listening to Twitch", or the one thing to fix), a *Check now* button, then the journal: live search, filter by type (colored AND written badge),
  *Replay the alert* and *Remove from the journal* on each line, an empty state that says what to do.
- **Event types** tab: one row per type with a switch, what it covers, the Twitch permission it needs, its state and a *Send a test* button (realistic sample, invented names).
- When a Twitch permission is missing, the page says which ("Twitch's permission is missing for: bits, hype trains") and shows *Allow again at Twitch*.
- One setting: how long the journal is kept (30 days by default). A channel choice appears in advanced mode when the site has several channels.

## Transport: signed EventSub webhook (decision)

Twitch calls `/m/<key>/webhook`. Compared with the EventSub **WebSocket**:

| | Webhook (chosen) | WebSocket |
|---|---|---|
| Needs a public https address | yes (the page says so: `site_private`) | no |
| A site restart or an update | Twitch retries a failed delivery; the subscription stays | the connection is lost, nothing is received until the process reconnects; no replay |
| Keep-alive, `session_welcome`, `session_reconnect` | none | to implement and to keep alive in a server process that restarts |
| Token | application token (subscription created through the connector) | a **user** token for the subscription, which must stay valid |
| Proven here | yes: same signature, replay protection and repair as the chat of the Twitch bot | new |

The webhook is the safest for a site that restarts and updates itself. The bot's route could not be shared cleanly (it carries the bot's secret and only parses chat and rewards), so this module has its own route and its own secret.

Checks on each request: HMAC-SHA256 over `id + timestamp + raw body`, compared in constant time; a timestamp more than 10 minutes away is refused (replay); the body is limited to 100 KB;
the route is rate-limited (600 requests a minute, 30 refused requests a minute, then 429). Delivery is "at least once": the message id is the key of the journal, so a duplicate (or a delivery after a restart) is stored once.
The event is stored **before** the answer to Twitch (a local write), then `204`.

Subscriptions (checked every minute, recreated when Twitch cut them): `channel.follow` v2, `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift`, `channel.cheer`,
`channel.raid` (`to_broadcaster_user_id`), `stream.online`, `stream.offline`, `channel.hype_train.begin|progress|end` (v2), and `channel.channel_points_custom_reward_redemption.add` (off by default).
`channel.chat.notification` is **not** used: the dedicated types carry the same data without needing chat permissions, and using both would deliver everything twice.

## Twitch permissions (scopes)

Asked through the connector (`wantScopes`, version 1.4.0 of the connector adds `bits:read`, `channel:read:hype_train`, `channel:read:redemptions`), only for the types that are switched on:
followers `moderator:read:followers`; subs, resubs, gifts `channel:read:subscriptions`; bits `bits:read`; hype train `channel:read:hype_train`; reward alerts `channel:read:redemptions`; raids and stream start/end: none.
After the update the owner must **allow again at Twitch** once (the page says which permissions are missing and gives the button); types whose permission is granted keep working meanwhile.

## The topic `twitch.event`

Newest first, 200 at most; see `docs/TOPICS.md` for the fields. Test lines (`test: true`) and replay lines (`replay: true`, `of` = original id) are flagged; a gifted sub that belongs to a gift is `gifted: true`
(the gift line already carries the count). Consumers deduplicate on `id`.

## The journal

Collection `events`, keyed by the Twitch message id; fields are whitelisted (display name, login, tier, months, count, bits, viewers, public message, hype train figures), every string normalised (NFKC,
no control or direction characters, bounded). Purge task every hour: older than the retention (1 to 365 days, 30 by default), test and replay lines after one day, and never more than 5000 lines.
Hype `progress` messages are stored only when the level goes up. Tokens are never stored or logged; the secret of the subscriptions is kept in the state document and never shown.

## MCP tools (off by default)

`twitch_events_list` (read), `twitch_events_status` (read: listening state, missing permissions, last event per type, journal size), `twitch_event_replay` (write, bounded: 10 replays and 20 tests a minute, writes only a flagged line; nothing is ever deleted).

## Privacy

Only public data from the events: display names, amounts, tiers, counts, the public message of a resub or of bits. No e-mail, no account details. See the `privacy` text of the manifest.

## Limits and what is NOT verified

No live Twitch was available when this was written. Event fields were read in the official reference (see the header of `eventsub.mjs`); **not verified**: the behaviour of an application token for these subscriptions on a real channel,
how many failures make Twitch revoke a subscription, the redelivery schedule, and the reward redemption type. The tests use a fake Twitch that signs like the real one.
See "Robustness" below for what is recovered after a gap and what cannot be.

## The OBS dock (version 1.1.0)

A compact page for **OBS > Docks > Custom browser docks**, with the same secret address as the raid docks of the Twitch raid module (`/m/<key>/dock?k=…`, no session of the administration needed in OBS). Address and instructions: tab **OBS dock** of the module, one field with a copy button, and **New address** (asks for confirmation, the old dock stops at once: reload the dock in OBS).

- **What it shows**: the live journal, newest first, one row of the same height each: a badge **coloured and written** (type), the display name, the details (amount, tier, count), the time ("2 min ago", "il y a 2 min") and a **Replay** button (44 px at least). Works from about 280 px wide to wide panels, dark by default (`?scheme=light` forces light), follows the look of the administration (`--cur-*` tokens, no colour written in the page).
- **Period**: "This stream" (since the stream start we received; default while live), "24 h" or "All kept"; filter by type (chips, hype train in one) and a search field (no accents, no case).
- **Live updates**: a short read every 3 seconds; when the site does not answer (restart, update) the dock keeps what it shows, says "Reconnecting… next try in N s" with a dot that changes (never colour alone) and waits 6, 12, 24, 30 s; it comes back by itself. A wrong or replaced address stops it with one plain sentence (no retry loop).
- **Replay**: re-queues the alert with the same data as a new journal line flagged `replay` (who/when are the journal's). **It works even if the type is switched off** (a manual replay is a wish). De-bounced (a double click sends one alert; the button says "Replayed ✓"), rate limited (10 a minute), refused when no alerts overlay is installed (the buttons are disabled and the page says why). The only MCP route to replay stays `twitch_event_replay`.
- **Pause alerts / Resume**: **holds** the alerts of the alerts overlay (they are kept in order and come out when you resume; nothing is lost), **Empty the queue** (asks first) and **Test** (a menu of types), through the service `alerts.queue` of the alerts overlay (optional: without it these buttons are disabled).
- **Privacy**: only display names, amounts and counts leave the module; never a token, a secret or an e-mail (a test checks the whole answer). Wrong keys are counted: 30 a minute, then 429 before any comparison; the data route answers 90 reads a minute, the actions 40.
- Code: `dock.mjs` (page, one script, nonce policy, nothing from another site), `dockapi.mjs` (address, data, actions), `dockpure.mjs` (functions run by the page AND by the tests), `dockkit.mjs` (copy of the look helpers of `twitch-raid/dock.mjs`; a test fails if the tokens drift), `describe.mjs` (how a line is written, shared with the admin page).

## Robustness (version 1.2.0)

- **A check every minute** (`cycle.mjs`): one list call to Twitch when all is well; a cut or missing subscription is recreated, stale ones are removed, the others' (for example the Twitch bot's) are never touched.
- **Catch-up after a gap** (`catchup.mjs`): the passes did not run for 7 minutes (restart, update, outage), or the listening was in trouble (expired token, revoked, Twitch down, site not reachable). When it is back, from the last time all was fine:
  - **followers** are read again with their real date (`GET channels/followers`, newest first, 3 pages of 100 at most) and added once, flagged `missed` ("possibly missed" in the journal, `missed: true` in the topic), unless the journal already has that login within 10 seconds;
  - **subscribers** are compared with the names we know (every sub received is added to a baseline; the first pass only learns it and invents nothing): a new name is a sub we did not see, dated when we noticed it (Twitch gives no date there). Skipped above 1000 subscribers;
  - 50 lines a gap at most; the outcome is in the state (`catchup`), the page and `twitch_events_status`. A retry cannot add the same line twice (stable keys).
  - **Cannot be recovered** (Twitch gives nothing to read afterwards): gifts, bits, raids, hype trains, stream start and end, reward redemptions. They are lost for good if missed. Said here, not hidden.
  - The alerts overlay keeps a `missed` line up to an hour (a normal line only 5 minutes).
- **Silence while live**: live (a `stream.online` received) with no event for N hours (advanced setting, 3 by default, 0 = never): the page warns (a quiet stream is normal: it asks to check) and the badge shows 1.
- **Active warning**: when something that worked stops (token to renew, subscription revoked, site not reachable by Twitch, Twitch down for 30 minutes, silence while live; a missing permission only after a day), **one e-mail to the owner of the site** (site e-mail, `ctx.api.mail`, nothing rebuilt), after a grace delay of 10 minutes, again after 24 hours if it is still there, and once when everything is back. None for a fresh install that never worked, none if the setting is off, and the page says when the site has no e-mail set up. Also: the badge of the administration, `twitch_events_status` (health, since when, warned by e-mail or not, last catch-up). No viewer data in the mail.
- **During a site update or restart**: the webhook answers `503` with `Retry-After: 30` when it cannot store (never a lost event: the message is stored once whenever it comes, a retry is not mistaken for a duplicate), the pages read their state on demand and keep nothing in memory that matters (the journal, the pause and the ids already shown are in storage).
- Tests: `tests/twitch-events-robust.test.mjs` and the end-to-end `tests/twitch-alerts-e2e.test.mjs`, with a fake Twitch that signs like the real one: follow, sub, resub, a gift bomb (the gift and its 25 gifted subs), raid, bits, hype train, a message delivered twice, a restart in the middle, an expired token, a revoked subscription, a burst of 150 follows.
- Not verified against a live Twitch: the exact fields of the two catch-up answers (read in the reference), and how Twitch behaves when its answer comes late.

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

Subscriptions (checked every 5 minutes, recreated when Twitch cut them): `channel.follow` v2, `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift`, `channel.cheer`,
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
A missed delivery (site down for a long time) is not recovered in this version; see the next versions of the module.

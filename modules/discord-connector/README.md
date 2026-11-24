# Discord connector

The Discord connector links your site to your Discord server with a **bot**, once, for every module that talks to Discord. It keeps the bot in one safe place (nothing secret is ever shown again), shares one pause when Discord asks for it, and offers one service to the other modules, which describe what they want and never see a secret.

It does not replace the **Discord** module (the button in your header and your member count) or **Discord announcements** (messages through a channel address, no bot). It is for modules that need a real bot: keep one message up to date, open a thread, write in it, close it.

## Get started (5 minutes, once, free)

1. Open [discord.com/developers/applications](https://discord.com/developers/applications), click “New Application”, and copy its “Application ID”.
2. Open the “Bot” tab, create the bot's secret code and copy it. Leave every “Privileged Gateway Intent” off: the connector needs none.
3. In Discord, turn on Developer Mode (Settings, Advanced), right-click your server and choose “Copy Server ID”.
4. On the connector page, click **Register the bot** and paste the three values (application number, server number, secret code).
5. The card then offers **Add the bot to the server**: click it and confirm in Discord. **Test the connection** (menu “⋯” of the card) tells you in plain words whether it works and, if not, exactly which permission is missing for which feature.

The card has three states written by the core: **Configured** (one line, the end of the application number, and “Edit”), **Degraded** (a sentence with the reason and since when, and the button that fixes it: code refused, bot not on the server, a permission missing for a feature, Discord asks for a pause until a time) and **Not configured** (the guide above).

## Why REST only (no permanent connection)

The bot only sends requests to Discord when something happens (a message to write, a thread to open). It never listens, so it needs **no privileged intent**, no always-on process, and it works the same on a small server. Reacting to what members do (commands, reactions, new members) would need a permanent connection and is **not part of this version**.

## Permissions of the bot

The invitation link asks for the smallest set the features need: **395137010688**.

| Permission | Bit | Needed for |
|---|---|---|
| View Channels | 1 << 10 | everything |
| Send Messages | 1 << 11 | posting, keeping a message up to date, opening message of a thread |
| Embed Links | 1 << 14 | embeds (the week's planning) |
| Create Public Threads | 1 << 35 | public threads |
| Create Private Threads | 1 << 36 | private threads |
| Send Messages in Threads | 1 << 38 | adding a person and writing in a thread |
| Manage Threads | 1 << 34 | archiving and locking a thread |

Checked against the Discord documentation ([Permissions](https://docs.discord.com/developers/topics/permissions), [Channel](https://docs.discord.com/developers/resources/channel), [Message](https://docs.discord.com/developers/resources/message)). Never asked: the all-powers permission, Mention Everyone, Manage Messages, Manage Channels, Manage Roles. The first five bits without the public-thread and embed ones give 360777255936.

## What the bot can and cannot do

- It posts, edits and deletes **its own** messages. It never touches the messages of a person: `editMessage` and `deleteMessage` only accept a message the bot itself wrote (the managed ones, plus a log of the last 500 messages it sent), anything else is refused with `forbidden` before any call.
- It only writes in channels of **your** server: before a write, the channel is looked up and refused (`forbidden`, no write) when it belongs to another server or is not a text, announcement or thread channel (a thread is checked on its parent). There is no owner-chosen channel allowlist in this version: it needs a settings page or the caller identity from the core (see below).
- A kept message count is capped before anything is sent: 200 in all, 50 per module.
- Only the **owner role** (right `bot.manage`, sensitive, given to nobody by default) can replace, test or remove the bot code; an administrator without it sees the state and a line saying it is owner-only, and the actions refuse in code too.
- Every message is **silent** (no push notification) unless the module asks otherwise, and **nobody can be mentioned** by a message: `@everyone`, `@here`, users and roles are defused. The only exception is the opening message of a private thread, which mentions the person and the staff role it was asked for, and nobody else.
- It does not create, rename or delete channels or categories (possible follow-up, with a designated category).

## For modules: service `discord.api`, version 1 (not `each`)

Declare `"requires": [{ "service": "discord.api" }]` (add `"optional": true` for a module that works without Discord): the core installs the connector with it. Every answer is `{ ok: true, … }` or `{ ok: false, reason }`; a method never throws and never returns a secret or the body of a Discord error. `reason` is one of `not_configured`, `invalid_input`, `forbidden` (401/403), `not_found`, `not_member`, `rate_limited` (with `retryAt`), `unavailable` (no answer or 5xx), `failed`. Numbers (channels, roles, people, messages) are 15 to 25 digits and checked before any call.

| Method | Arguments → answer |
|---|---|
| `status` | `{}` → `{ ok, bot, oauth, guildId? }` (no network; `oauth` is always `false` in 1.0) |
| `listChannels`, `listRoles` | `{}` → `{ ok, channels: [{ id, name }] }` / `{ ok, roles: [{ id, name }] }` (text channels; no @everyone, no bot role; kept 1 minute) |
| `guildStats` | `{}` → `{ ok, memberCount, onlineCount? }`: the approximate counts Discord shows publicly (`GET /guilds/{id}?with_counts=true`), kept 5 minutes so a public page may call it freely; honours the site-wide pause |
| `channelChoices`, `channelsByIds` | For the core's `choice` setting (source `service`): `{ q?, limit? }` → `{ items: [{ id, label }], next }`; `{ ids }` → `{ items, missing }`. No `ok` field (the core's own shape); a Discord failure **throws**, so the core keeps the chosen value as "unverified" instead of reporting the channel as gone. |
| `createPrivateThread` | `{ channelId, name, userId, staffRoleId?, intro? }` → `{ ok, threadId }` or `{ ok: false, reason, threadId? }`. Private thread (type 12, not invitable, closes itself after 7 days), name cleaned (no control characters, 100 characters, never empty), the person added, then the opening message mentioning only the person and the role. `intro` is plain text, 1500 characters, pings defused. `threadId` is present when the thread exists but a later step failed. |
| `setThreadArchived` | `{ threadId, archived }` → `{ ok }` (`true` archives and locks, `false` reopens) |
| `postMessage` | `{ channelId, content?, embeds?, silent? }` → `{ ok, messageId }`. `silent` is `true` by default. A thread is a channel: pass its number. |
| `editMessage` | `{ channelId, messageId, content?, embeds? }` → `{ ok, messageId }` (only a message the bot sent) |
| `deleteMessage` | `{ channelId, messageId }` → `{ ok }` (already gone counts as done) |
| `upsertManagedMessage` | `{ owner, key, channelId, content?, embeds?, silent?, label? }` → `{ ok, messageId, action }`, `action` being `created`, `edited`, `unchanged` or `recreated`. Keeps **one** message per `owner:key`: edited in place, nothing sent when the content is the same, written again once if a person deleted it (a line in the log). Two simultaneous calls make one message. A new channel moves it. The first write carries a `nonce` (from owner, key, content) with `enforce_nonce`, so a retry after a lost reply never makes a second message. `owner` is the id of the calling module. **It is advisory**: the core does not tell a service who calls, so any module that can call the service can claim any owner, and the caps and the sent-log are the real limits. `label` is the name shown in the connector page. |
| `forgetManagedMessage` | `{ owner, key }` → `{ ok }` deletes the kept message |
| `createThread` | `{ channelId, name, messageId?, privateThread? }` → `{ ok, threadId }` (public thread, from a message, or private) |

Embeds: `title`, `description`, `url` (https), `color`, `timestamp`, `fields` (25), `footer`; 10 per message, 6000 characters in all.

Limits and pauses: every call goes through `ctx.api.net` (never `fetch`), with the user agent `DiscordBot (https://github.com/helldog136/Curiosa, 1)`. When Discord says “too many requests”, **the whole site** stops calling until the time Discord gave (one bucket per bot), then resumes alone; the card shows the pause.

## Where things are kept

The application number, the server number and the secret code are one document in the connector's private storage. They are never in a setting, a block, a service answer, a log line, an error, or the readable backup (the module has none). **Plain truth about storage:** the core has no secret-sealing API for modules, so the code is stored as text in the site's database like any module data, and it is encrypted only inside the core's backup file (with your backup password). Anyone who can read the database or the live storage sees it: restrict that access, and regenerate the code in the Discord developer portal if you suspect a leak. Kept messages (module, key, channel, message number, a hash of the content) are listed on the page with a search and “Delete the message”.

## Not in this version

- Visitor sign-in with Discord (`discord.identity`): design below, not implemented.
- Channel and category creation, reactions, commands, members, live events (all need more permissions or a permanent connection).

### Design proposal: `discord.identity` (not implemented)

A visitor proves their Discord account with the scope `identify` only.

1. **Start**: `identity.start({ returnTo })` returns the Discord address (`/oauth2/authorize`, `response_type=code`, `scope=identify`, `state`, `prompt=none`, the return address of the connector). `returnTo` must be a path of this site (checked against a closed pattern), never an address.
2. **State**: 256 random bits, kept server-side for 10 minutes, single use, bound to the return address and to a random value also set in a cookie `HttpOnly; Secure; SameSite=Lax` (against forged returns). Consumed before any call to Discord.
3. **Return** (`/m/discord-connector/oauth/callback`): check the state, exchange the code (needs the application secret, kept like the bot code), read `/users/@me` once, **throw the access token away** (never stored, never logged), keep only the Discord number.
4. **Session**: a signed value (HMAC with a key derived from the site secret) holding the Discord number and an expiry of 30 minutes, in a cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, and the service method `identity.whoami(request)` returning `{ ok, userId }` to the modules that ask. Logout deletes the cookie.
5. **Abuse**: at most 20 invalid returns per 10 minutes per instance, then 429; redirect only to the verified `returnTo`; no open redirect; no personal data kept beyond the number.

The only new things to enter would be the application secret and the return address in the application's “Redirects”.

## For developers

Id `discord-connector`, `instances: "single"`, `minCore` 0.46.0 (connection card, `mcp[].right`). Files: `discord.mjs` (the only calls to Discord, permission bits), `service.mjs` (the methods), `health.mjs` (does it work now: bot, server, permissions of the bot's roles on the whole server), `store.mjs` (what is kept), `panel.mjs` (the card). The task `check` asks Discord every 10 minutes and notes changes in the central log (`connection.problem`, `connection.back`, `message.recreated`). One read-only tool for assistants: `connector_discord_status`. Tests use a fake Discord behind the real network client: `tests/helpers/fakeDiscord.mjs` and `tests/helpers/discordConnector.mjs` (a real connector bound to a fake context, for the tests of consumers).

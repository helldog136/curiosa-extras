## A Discord bot for your site: the Discord connector

*Modules touched: Discord connector 1.0.0 (new).*

### New
- **Discord connector 1.0.0.** Register your Discord bot once (a guide of four steps, five minutes, free) and every module that talks to Discord can use it: keep one message up to date, write in a channel, open a private thread for a person and close it. The card on the page says **Configured**, **Degraded** (secret code refused, bot not on your server, a permission missing for a feature, Discord asking for a pause, with the button that fixes it) or **Not configured**, and **Test the connection** says in plain words what works and what is missing. The secret code is never shown again.
- **Silent by default, nobody pinged.** Messages the bot writes do not notify anyone unless a module asks for it, and no message can mention `@everyone`, `@here` or anybody else. The bot only touches its own messages and never creates or deletes channels.
- **The list of what a module keeps up to date** (for example the week's planning) is on the page, with a search and “Delete the message”. A message deleted by a person is written again once.

### For developers
- New service `discord.api` version 1 (not `each`): `status`, `listChannels`, `listRoles`, `channelChoices` and `channelsByIds` (the channel picker of other modules), `createPrivateThread`, `setThreadArchived`, `postMessage`, plus `editMessage`, `deleteMessage`, `upsertManagedMessage`, `forgetManagedMessage` and `createThread`. Answers are `{ ok: true, … }` or `{ ok: false, reason }` with a closed `reason` list (`not_configured`, `invalid_input`, `forbidden`, `not_found`, `not_member`, `rate_limited`, `unavailable`, `failed`); no secret and no Discord error body ever comes back. REST only (no gateway, no privileged intent), everything through `ctx.api.net` with one bucket per bot, so a "too many requests" pauses the whole site.
- Invitation permission number 395137010688 (view channels, send messages, embed links, manage threads, create public threads, create private threads, send messages in threads), checked against the Discord documentation.
- The core does not tell a service who calls it: `upsertManagedMessage` takes the calling module's id as `owner` (it namespaces the keys; it is not a security boundary).
- Test helpers: `tests/helpers/fakeDiscord.mjs` (a fake Discord behind the real network client) and `tests/helpers/discordConnector.mjs`.

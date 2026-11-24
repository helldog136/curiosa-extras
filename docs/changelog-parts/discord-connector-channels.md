## Choose where the Discord bot may write

*Modules touched: Discord connector 1.1.0.*

### New
- **Discord connector 1.1.0: choose the channels the bot may write in.** On the connector page, "Choose the channels the bot may write in" opens the list of your server's channels, with a live search, the category of each and the module that already writes there. Switch on the ones you want: from then on the bot refuses to write anywhere else, and so does every module that uses it. Threads follow their channel. Nothing to set up: until you choose, the bot may write in every text channel of the server, as before.
- **The card says it, only when it is true.** "Writes limited to 2 channels" appears on the card once you have chosen, and "Allow every channel" in its menu lifts the limit. "Choose the channels in use" picks, in one click, the channels where your modules already keep a message.
- **Test the connection names the channels where the bot cannot write** (a permission taken away on that channel only, or a channel that was deleted), next to what it already says about the whole server.
- **Only the owner changes the list** (the same sensitive right as the bot code, now also covering the choice of channels).
- Other modules that let you pick a Discord channel (for example the week's planning) only offer the channels you chose.

### For developers
- `discord.api` stays version 1 and additive. When the owner chose channels, every write (`postMessage`, `upsertManagedMessage` with or without `verify`, `createPrivateThread`, `createThread`, `setThreadArchived`, `editMessage`, `deleteMessage`) answers `{ ok: false, reason: "forbidden", scope: "channel" }` with no write call unless the channel, or the parent of a thread, is chosen; the parent is read once (`parent_id`, kept 10 minutes). With nothing chosen the behaviour is exactly that of 1.0.0.
- `channelChoices` offers only the chosen channels; `listChannels`, `channelsByIds` and `status` stay reads (`status` adds `channelLimit` when a list exists). Deleting the bot's own messages when a kept message moves or is forgotten stays allowed. A list that cannot be read answers `unavailable` (fail closed).
- Storage: one document in the new collection `discordAllow` (`{ channelIds, at }`, 100 at most). Actions `setChannel`, `chooseUsed`, `allowAll`, all with the right `bot.manage`. The MCP tool `connector_discord_status` adds `writesLimitedToChannels`.
- `tests/helpers/fakeDiscord.mjs`: `parent_id` on threads and channels, options `overwrites` and `moreChannels`. New test: `tests/discord-connector-allowlist.test.mjs`.

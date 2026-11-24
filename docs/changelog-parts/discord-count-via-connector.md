## Discord counts your members with your bot when you have one

*Modules touched: Discord 1.5.0. Needs the Discord connector 1.0.0 to use the bot; nothing changes without it.*

### New
- **Discord 1.5.0.** When the Discord connector is installed and set up, and the account is your own server, the member count comes from your bot instead of the public invitation. Nothing to set, nothing to install: the module still works with no connector, no bot and no setup, and visitors never see a difference.
- **One plain line in the Discord panel** says where the figure comes from: "Counted by your Discord bot" or "Counted from the public invite". When the bot could count but does not (not set up, refused, not answering), one link leads to the connector; when the connector is not installed, the core offers it, and nothing is installed without a click from the site owner.
- **Another Discord is never given your number.** The server of an account is read from its invitation, so a second instance for a friend's Discord keeps counting from its own invitation. The server of an invitation is read again every 30 minutes, so a code given to another server is noticed.
- **Last known figure.** If the bot and the invitation both fail, the last figure is kept with its real date for up to 30 minutes, then no number. The panel line then says "Last known figure" instead of claiming a source.

### For developers
- Optional need `{ "service": "discord.api", "min": 1, "optional": true }` (a core 0.2.0 feature; `minCore` stays 0.6.0, a core older than 0.46.0 simply has no connector). Only the read-only methods `status` and `guildStats` are called, with no argument, a short delay (3 s, less in a public page) and a closed fallback on every reason.
- No new permission, no new setting, no new network host.
- Tests: `tests/discord-count.test.mjs` (real connector behind a fake Discord, every reason, delay, last figure, no secret, both languages).

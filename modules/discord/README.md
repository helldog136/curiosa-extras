# Discord — community module of Curiosa

Shows the button of your Discord (icon and link) in the site header. It gives the core the topic `social.link`, which gathers the buttons of all your networks, and its own figures (topic `social.stat`). It stores nothing.

- **Setting**: your invitation link. For example: https://discord.gg/abcDEF. The name alone, the address without https:// or www. and short addresses are recognised; tracking parameters are removed.
- **Several accounts**: add one instance per account (yours, a friend's…).
- Only an https address of the right site is accepted; nothing is shown until the profile is set.

## Statistics: members

**Follow my statistics** is ticked by default: these are public figures, no key is needed. Untick to follow nothing.

Two sources, in this order:

1. **Your Discord bot** (optional). When the Discord connector is installed and set up, and the account is the bot's own server, the member count comes from its `guildStats` method (service `discord.api`, declared as an optional need: the module never installs it and works without it). The server of an account is read from its invitation, so a second instance for a friend's Discord is never given your server's number.
2. **The public invitation**: `GET /invites/<code>?with_counts=true`, the **approximate** member count read from a public invitation (the code or the `discord.gg/…` address). The invitation of the setting "Invitation link" is used first; without it, the profile is used if it is itself an invitation. Kept 30 minutes.

- **The panel says which one counted**: "Counted by your Discord bot" or "Counted from the public invite". When the bot could count but does not, one link leads to the connector ("Set up the Discord bot" or "Check the Discord bot"); when the connector is not installed, the core offers it (nothing is installed without a click from the site owner).
- **Never in the way**: the connector is waited for a few seconds at most (less in a public page). If it is absent, not set up, slow, refused or answers anything unexpected, visitors see nothing different: the figure comes from the invitation. If both fail, the last figure is kept with its real date while it is younger than 30 minutes; after that, no number.
- **Limits of the platform**: Discord only gives an approximate member count, and only with an invitation that exists: an expired or deleted invitation gives nothing. Create one that never expires (Discord: invitation settings, "Expire after: never").
- **If it does not work**: the panel of the module says in plain words what happens. *"Add your Discord's invitation link"*: fill "Invitation link" in Settings. *"This invitation no longer exists"*: create one without an end date.
- No figure is invented or outdated: when the platform does not answer, the module publishes the error (`auth`, `rate`, `network`, `hidden` or `config`) and no number. Several instances of the same account share one request.
- The module has no secret and no new permission: the bot code stays in the connector, only a number comes back.

## Short address: /discord

**Create a short address for your Discord** is off by default. Switched on, the core creates the address `yoursite.be/discord`, which leads to the invitation of your button. It stays the same if your invitation changes: only its destination follows. Redirects belong to the core: the module only **asks** for it (key `shortLink` of its `module.json`), it writes nothing itself.

- **Off by default**, because it is one more public address on your site that nobody asked for: it is not born from an update. One click switches it on.
- **The name** is changed under "More options" (empty: `discord`). Lowercase letters, digits and dashes. Changing the name renames the address, with its figures.
- **If the name is already taken** by one of your links, nothing is created or changed: the message under the field suggests another name (for example `discord-2`), and the page *Link shortcuts* reminds it with a button to the settings.
- **Where to see it**: page *Link shortcuts*, with the badge "Discord extension". It is set here, not there: it is neither edited nor deleted by hand.
- **If you switch the option off**, remove this account or uninstall the extension, the address disappears with its figures and the name becomes free again.
- **The header button** keeps the address of your invitation. It goes through `/discord` (and its clicks are counted) only if you switched on "Count the clicks on my links" in *Link shortcuts*, as for every network button.
- **Privacy**: nothing new is collected. The figures are those of any short link (one number per day, no cookie, no IP address). No effect with an older Curiosa: the module works, without a short address.

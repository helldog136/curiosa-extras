## The week's planning on your Discord server

*Modules touched: Stream schedule 2.10.0.*

### New
- **Post the week's planning to Discord.** Turn on the option, choose a channel, and the week (Monday to Sunday) appears as one message that the site edits as your schedule changes. It is written again by itself when a new week starts. Hours are shown in each member's own time zone.
- **With or without notification.** The message is silent unless you choose “Notify members”. Editing it never notifies anyone, and nobody can be mentioned from a stream title.
- **A short message when a stream changes** (optional, in the advanced settings): a stream added, moved or cancelled is announced in one separate line. Nothing is posted when you turn it on.
- Needs the Discord connector. Without it, or with the option off, the schedule works exactly as before and the page of the module says what is missing, with the button to install it.

### For developers
- New optional need `discord.api`. The module reads the week every minute (task `discord`), compares a digest with the last one posted and calls `upsertManagedMessage` only when it changed, after a 6 second pause that gathers a burst of calendar edits. The channel setting is a `choice` over `channelChoices` / `channelsByIds`.

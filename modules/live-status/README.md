# Live status

Shows a "live" banner and your player on the home page when you are live **on Twitch, on YouTube or on both**. (The module used to be called "Twitch live status": its identifier `live-status`, its settings and its instance did not change.)

**This module displays, it does not query Twitch.** It asks **My Twitch channel** (module `twitch-channel`, service `twitch.live`) whether you are live; that module goes through the **Twitch connector**. The Twitch application (client id and secret) is set **once, in the Twitch connector**, and the channel in My Twitch channel; one authentication and one call to Twitch serve the banner, the player and the other modules. My Twitch channel must be installed and active.

The Twitch player shows a big white "offline" panel when offline. As soon as the site is linked to Twitch, the player therefore appears **only when live** (setting "When to show the player": "Only when live" by default, or "Always"). **Without a Twitch application** (in the Twitch connector) or without a channel (in My Twitch channel), there is no way to know whether you are live: the player is **not shown** (no more white "offline" panel), unless you choose "Always". The admin page of this module says so and links to the right page. If Twitch does not answer, there is neither banner nor player.

## YouTube (version 1.4.0)

Install **YouTube channel** (module `youtube-channel`, 1.4.0 or later, with the key of the YouTube connector): Live status uses it by itself, with no setting. Both sources, Twitch and YouTube, are **optional**: one is enough. With neither, the admin page says so ("Install My Twitch channel or YouTube channel") and offers to install them.

- **Banner**: YouTube alone live → "Live on YouTube" with the link of the video. Several platforms live → one line per platform (Twitch, YouTube) with its title and its "Watch" button.
- **Player**: one player at a time. If Twitch and YouTube are live together, the setting **Live on both: which player?** chooses (Twitch by default, as before); the other platform stays a link in the banner. If only one is live, its player is shown.
- **Privacy**: the YouTube player (address `youtube-nocookie.com`) is loaded **only after the visitor clicks** "Start the YouTube player" (setting **YouTube player**: "After a click", the default). "As soon as the page opens" loads it at once, like the Twitch player. As long as the visitor has not clicked, no image, script or frame contacts YouTube: the player frame is stored, closed, in a collapsible block.
- **Quota**: each check costs **2 units** of the daily limit of YouTube (10,000 on a free key). YouTube channel keeps its answer 45 seconds; Live status keeps it **3 minutes when live, 5 minutes when offline, 2 minutes after an error**, whatever the number of visitors (960 units a day at most, under 10%). Nothing runs in the background: with no visitor, no check. A visitor never waits more than 2.5 seconds. Consequence: a YouTube live can appear up to 5 minutes after it starts, and disappear up to 3 minutes after it ends.
- **YouTube down, key missing, daily limit reached**: neither YouTube banner nor player for the public; the admin page says what to do in one sentence, with the link of the right setting. Twitch goes on normally.
- **A Twitch-only site does not change**: without YouTube channel, no extra call and exactly the same display as before (banner, player, settings, instance).
- For developers: optional service `youtube.live` (method `current`, through `callAll`, never `fresh`); `youtube.mjs` (answer memory, shared question, 2.5 s delay), `view.mjs` (multi-platform banner, "on click" player). Both needs (`twitch.live`, `youtube.live`) are `optional`. The declared platform stays `twitch` (a simple grouping on screen).

## If you had already set up this module (automatic hand-over)

Nothing to do: at the update (Curiosa 0.2.0), the Twitch identifiers this module used to keep (channel, client id, client secret) are **handed over by themselves** (the channel to My Twitch channel, the application to the Twitch connector), then erased from here. They have no field in the settings any more and are never displayed.

- **The copy** only fills the **empty** fields of My Twitch channel (a value already there is never overwritten), and never displays or logs a value. A field is erased from here only once **confirmed** in My Twitch channel; what is not there yet stays here, unused.
- **If My Twitch channel does not answer** at the time of the update, nothing is erased, and the hand-over is tried again each time you open the Live status page (1.4.4; there used to be an hourly task) until it is done. Meanwhile the player is not shown (without Twitch identifiers there is no way to know whether you are live). A value that is still here is counted on the Upkeep page of the core.
- **Instance already handed over before** (the old button had been used): same display as before; the old values, now useless, are simply erased.
- **Why through the service**: a module is not allowed to write into the settings of another. The copy goes through the `adopt` method of the `twitch.live` service, which stores the handed-over values in the storage of My Twitch channel; its own entered settings always win, field by field.
- With several Twitch channels, the handed-over channel goes into the **first** one (by order of creation), only if it has none; the application goes to the Twitch connector, which serves all the channels of the site (it never replaces an application already set).
- For developers: `legacySettings` (`channel`, `clientId`, `clientSecret`), `dataVersion` 2, `migrations[2]` and the opening of the admin page call `adoptLegacy` (`adopt.mjs`); it reads with `ctx.legacy.get` and only clears with `ctx.legacy.clear` after confirmation. Needs Curiosa 0.2.0. This hand-over of secrets is removed in two steps (`docs/MIGRATIONS.md`): step 1 is 1.4.4 (no hourly task), step 2 deletes the hand-over in a later release.

## Several channels (version 1.2.0, Curiosa 0.1.14 or later)

One My Twitch channel per channel: Live status queries **all of them** (`callAll("twitch.live", "status")`) and still does not talk to Twitch.

- **Only one live**: exactly the display of before (one-line banner, player of that channel).
- **Several live**: the banner has **one line per channel** (name, title, game, audience, "Watch" button); the player shows the **first** live channel (order of creation of the instances) with a **pill per channel** to switch between them (HTML/CSS radio buttons, no script, keyboard accessible).
- **None live**: nothing. With "Always", the player of the first channel.
- Optional setting **Channels to announce**: identifiers separated by commas; empty = all.
- **Old core** (without `callAll`): falls back to the single call of before (first channel only). The module still requires Curiosa 0.1.14 at install.

Base module of Curiosa (Curiosa License 1.0). It is enabled from the admin, under **Features**; its settings are on its page.

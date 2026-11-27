# Alerts overlay (OBS) — Curiosa community module

A browser source for OBS (`https://your-site/overlays/<key>`) that shows an alert (follow, sub, raid…) **as soon as it is pushed**, live (SSE).

To push an alert from any tool (Streamer.bot, webhook relay, script):

```
POST https://your-site/m/<key>/push
Authorization: Bearer <sending token>
{ "kind": "follow", "message": "Alex", "username": "alex" }
```

`kind`: `follow`, `sub`, `raid`, `alert` (the text is shown as is, never interpreted as HTML). With no token set, nothing can push; the admin panel has a **test** button.
The stream lives in memory in the server process (a single server, like the standard installation).

## Twitch activity is part of this module (version 1.18.0)

Until 1.17.0 a second module, **Twitch activity** (`twitch-events`), received the Twitch events and edited this overlay's reactions through a protocol between the two modules
(services `alerts.reaction` v3 and `alerts.reaction.editor`, `twitch.journal` consumed, the `editorOf` logic, the reward plumbing). Since 1.18.0 it lives **here**, in `twitch/`:
the signed EventSub webhook, the journal, the OBS dock, the catch-up after a gap, the health e-mails, the per-type and per-reward reactions and the four tools
`twitch_events_list`, `twitch_events_status`, `twitch_event_replay`, `twitch_events_rewards`. The same functions are called directly: no service between them any more.
What Twitch activity offered to others stays offered here: the topic `twitch.event` and the service `twitch.journal`. `alerts.show` (Twitch bot) and `alerts.queue` are unchanged.

**One copy listens** (`twitch/home.mjs`): the first copy of the overlay, as the reaction editor of Twitch activity already chose. Modes of a copy:

| Mode | When | What it shows and does |
|---|---|---|
| `on` | the first copy, on a site with the Twitch connector | first tab: status, journal, OBS dock, journal options; **Twitch events** tab: one table of types (state, reaction window, the *Alert* switch), styles, sample evening, Twitch options; **Rewards** and **Viewer texts and voice** tabs |
| `waiting` | Twitch activity is still installed and has not handed over | its alerts keep showing (the overlay reads its topic, as before); a banner says what to do; nothing is listened to here |
| `guest` | another copy of the overlay | its own editor of the alerts (as before), a link to the copy that listens; it shows the Twitch alerts through the topic |
| `off` | no Twitch connection on the site (Streamer.bot, YouTube, the bot's media only) | **nothing Twitch**: no Twitch, Rewards or Voice tab, no journal, no dock, no task calls, no permission asked; every Twitch need is optional |

**Settings that moved.** The four Twitch options of the overlay (*Play a sound with each alert*, *Show the messages that come with an alert*, *Names to ignore*,
*Wait to group bursts*) were settings shown in the Twitch tab even without Twitch. Data version 2 copies them once into the store (`options.mjs`, collection
`twitchOptions`, `ctx.legacy` then cleared); they are a form of the Twitch events tab now. *Pause between two alerts* and *Volume of the sounds* apply to the media too:
they went to the Settings tab (same keys, nothing to migrate). The journal options of Twitch activity (*Keep the journal for*, the e-mails, the silence warning) are a
window of the first tab, opened by "Journal and e-mails" under a one-line summary (stored in the state of the listening); the choice of the Twitch channel stays a setting (advanced, asked with several channels only).

### Taking over Twitch activity (once)

Twitch activity **1.13.0** is a bridge release: it works exactly as 1.12.0 and also offers `twitch.events.handover` (`release`, `export`, `flag`). On the copy that listens,
the minute task (and the opening of its page) does, once:

1. `release`: Twitch activity deletes ITS subscriptions at Twitch (its own address only), withdraws its permission wish at the connector, and becomes **retired**
   (no task, its webhook answers 410, its topic is empty, its page says where everything went, its dock address redirects to the new one with the same key);
2. `export`, page by page: the journal (every line with its id, its flag of moderation, its source), the switches of the types, the dock key, the live state, the baseline of
   the catch-up and the options; copied here, keyed by the Twitch message id (idempotent: a failure half way is taken up at the next pass, nothing is copied twice);
3. a document `handover` (`state: "done"`, `from`, `lines`, the old address). The next pass creates the subscriptions at `/m/<key>/webhook`; a subscription left at the old
   address (a removal without hand-over) is deleted, never reported as "taken"; the gap since the release is caught up (follows and subs, as after any gap).

**(1.18.1) Do not remove Twitch activity before the site log says "Twitch activity taken over: N journal lines" with N greater than 0.** Version 1.18.0 refused the
real ids of Twitch messages (base64, with `=`, `+`, `/`) and copied 0 lines while taking over everything else. 1.18.1 accepts them; a hand-over made by 1.18.0
(document `handover` without `importVersion`) copies the journal again, once, with `export` only (no `release`, no state, no options), while Twitch activity is
installed. Test and replay lines are never copied (a test always shows on screen); the lines received since the hand-over are written again after the copied ones,
so the journal stays newest first; nothing is copied twice (keyed by the message id) and no copied line shows as an alert (older than the age limit of alerts:
5 minutes, 60 for a line found after a gap).

A line taken over keeps the address of its first journal (`from`): an alert already shown is never shown again. With Twitch activity 1.12.0 still installed, the overlay
waits (mode `waiting`) and says to update it. Nothing of Twitch activity is deleted by the overlay: the owner removes it afterwards (its data is then set aside by the core).

**Losses and changes for the owner** (helldog136, the only site with both modules):
- the OBS dock address changes from `/m/twitch-events/dock?k=…` to `/m/alerts-overlay/dock?k=…` (same key). The old address redirects while Twitch activity is
  installed; paste the new one in OBS before removing it;
- the four MCP tools are now `alerts-overlay__twitch_events_list`, `…_status`, `…_replay`, `…_rewards`: an access that had them ticked under `twitch-events__…` ticks them
  again (they are off by default). Every other tool of the overlay keeps its name and its rights;
- custom roles: neither module declares rights, nothing to redo. The menu has one entry fewer.

## Hype train and session counter, animated (version 1.20.0, core 0.30.0)

Two more elements for overlay pages, drawn by the core's animation engine in the style of the page's skin (any skin: the engine has a plain rendering for skins without an animation recipe):

- **Hype train** (`hype-train`, genre `levels`): the level, the progress inside it and the countdown Twitch gives. Each contribution is a reaction, a new level a celebration, the end a last celebration; the element hides when no train is on (20 s after the end). The Test of the « hype » type shows a short demonstration.
- **Session counter** (`session-counter`, genre `counter`): subs (new, renewed and gifted; the gifted subs are not counted twice), bits or follows (once per login) since the stream started. The session starts at the last « online »; a stream that drops and comes back within 10 minutes is the same session; without any « online », the last 12 hours. Tests lift the counter for 8 seconds and it comes back: they never count.

Both read the journal of the copy that listens (another copy reads the topic, without the progress inside a level), every 1.5 s, with the server's clock: a reaction starts 1.6 s after the event arrived, the same on every open page; a reloaded page replays nothing. Options: **Title**, **What it counts** (counter), and the engine's **Effects** and **Calm motion**. Readers never write.

### The Twitch data behind them

- **Listening is not the alert (1.22.0).** The switch of a type is its alert (the `on` of its configuration; `state.enabled` mirrors it at every pass). It never removes a subscription: every type whose permission is already granted is listened to, and stream start and end (no permission needed) always are. A line of a type with its alert off is recorded as usual (counters, goals, live state) with `muted: true`, also in the topic `twitch.event`; the overlay never plays it. Permissions are asked for only by types with their alert on. On the first pass after the update, a type that was off in the old *Received* list keeps no alert (its alert is switched off), and starts being listened to on the next pass.
- **Silence (1.22.0).** The silence warning only runs while the stream is known to be live: both stream types are listened to and the start is less than 48 hours old (an older start is forgotten). The end of the stream clears the warning without a "back" e-mail.

- The live state of a train is kept in the listening state (`hype`: level, progress, goal, `expiresAt`, the last 20 messages), updated by every « progress » message. The journal still gets one line per **new** level only (its size and retention are unchanged). Its lines now keep `expiresAt` (Twitch's `expires_at`), and the topic item carries it.
- A state written by an older version has no `hype` key: it is rebuilt from the journal lines of the train (no countdown in those).
- **End of a subscription**: `channel.subscription.end` (v1, same permission as subs, checked against the Twitch reference and the Twitch CLI) is listened to with the « sub » switch and stored as `sub_end`. It never makes an alert (the overlay does not know that type) and the Test of « sub » still sends one sub. Twitch has **no unfollow event**.

## YouTube alerts (version 1.1.0)

If the **YouTube live actions** module is installed, the **Super Chats, Super Stickers, new memberships and gifted memberships** of your YouTube live also appear, one after the other (a queue of 50 at most). Nothing to connect: the overlay reads the `live.event` topic that module publishes ("Data sources" tab of the overlay if you want to choose which ones).

- **Amount**: written in the currency of the gift ("€5.00"), never converted, never without a currency.
- **Message text**: **hidden by default** (setting "Show the text of YouTube messages"). A Super Chat message can contain anything; when ticked, it is cut at 140 characters and always plain text (never interpreted as HTML).
- **Keep the "Live" page of YouTube live actions open** during the live: it is what reads the chat. Without it, no YouTube alert arrives (the overlay never triggers that reading). Without Home Assistant, tick "Read the chat even without Home Assistant" in YouTube live actions.
- **No background timer**: the overlay page (open in OBS) fetches news every 5 seconds (at most one read every 2 seconds per overlay); with the overlay closed, nothing runs. An alert is never shown twice, and an alert older than 2 minutes (OBS reopened, server restarted) is not replayed.
- A **Send a fake Super Chat** button shows the rendering without asking YouTube anything.
- **Without YouTube live actions, nothing changes**: the overlay page is exactly the previous one and asks for nothing more. Pushed alerts (`push`) stay immediate and replace the alert on screen, as before.

## Element for overlay pages (version 1.2.0, core 0.5.0)

The module offers the **Alerts** element ("keeps its proportions", 640 × 260) in the **Overlays** section of the administration: place it wherever you want in an overlay page, with the other elements, and paste a single address in OBS. It follows the page's **common style** (text colour, background, corners); the accent colour, the neon or plain look and the display time stay the module's.

- **One option**: "Alerts shown" (all, the channel's, or the live gifts and memberships). Two elements, one of each, show them in two places.
- **Several overlay pages can show the alerts at the same time** (or the same element twice): each page keeps its own marker in the stream, none empties the queue of the others. The module keeps the last 100 alerts in memory for this. A page opened later does not replay old ones.
- **Test mode**: the element shows a fixed sample alert.
- Position and size settings do not exist here: the element fills the frame given by the overlay page.
- **Nothing changes for the current overlay**: same address, same page, same settings. The limit of one read of the `live.event` topic every 2 seconds applies per overlay, however many pages show it.

## Skins and the "Opaque" background reach the card (version 1.10.1)

The element's stage carries `data-ov-region="element"`: an overlay skin and the "Opaque" background of the page now give their background to the alert card (before, the card stayed transparent under a skin and semi-transparent on an "Opaque" page). Nothing else changes. With core 0.17.0, the appearance tab of each element (readability, background, outline) applies too, with or without this version.

## How it enters and leaves (version 1.3.0, core 0.6.0)

Under "More options": by default an alert zooms in lightly and fades out, exactly as before. Pick another way for each direction: slide from the left, right, top or bottom, fade, jiggle or pop, or none; "Same as how it enters" (the default for leaving) plays the entrance backwards. The length of the movement goes from 0.2 to 2 seconds; the alert stays on screen for the display time in between. The choices exist as module settings and as options of the element (default: like the module settings). With reduced motion on the device, any movement becomes a short fade. With every choice on "Default", the page is exactly the previous one. The shared code is `scripts/overlay-transition.mjs`, copied to `transition.mjs` by `node scripts/gen-transition.mjs`.

## Twitch alerts (version 1.4.0)

If the module **Twitch activity** is installed, the follows, subs, resubs, gifted subs, bits, incoming raids, stream start and end, hype trains (and, if you switch them on, channel point rewards) of your channel appear as alerts, **one after the other**.
The overlay reads the topic `twitch.event` (declared in `consumes`; nothing is required: without the module the page is exactly the one of before, byte for byte, and pushed alerts still replace the alert on screen).

- **Queue.** An alert never replaces one still on screen: they wait their turn (50 at most), with a **pause between two alerts** (setting, 1 second by default). Alerts that come from the topic and pushed alerts all queue when Twitch activity is installed; a pushed alert can still ask to replace the current one with `{"queue": false}`.
- **Per type** (tab "Twitch events"): a switch, the **text** (plain words with `{name}`, `{count}`, `{amount}`, `{tier}`, `{months}`, `{viewers}`, `{level}`, `{title}`, `{text}`, `{total}`; unknown words are refused under the field), the **time on screen** (2 to 60 seconds, empty = the module duration) and a **minimum** (bits, gifted subs, viewers, points). Three ready-made styles (Simple, Short, Thanks) apply to every type at once. A **test** per type goes through the same writing.
- **Ignore list** (names) and **messages**: the public message of a resub or of bits is hidden unless you tick "Show the messages that come with an alert" (cut at 140 characters, plain text).
- **Bursts.** Gifts by the same person (same tier) within the wait window (5 seconds by default, advanced setting, 0 = never) become one alert ("Camille gifts 5 subs"); three or more follows in a row become "N new followers, including …". A gifted sub that belongs to a gift is not announced twice. A raid, a sub, bits and the rest are never delayed.
- **Pause.** "Pause the alerts" **holds** them (nothing is lost, in order, up to 50, kept across a restart); "Resume the alerts" releases them; "Empty the queue" drops what waits and clears the card and the queue on every page. The same controls are offered to other modules as the service `alerts.queue` (`state`, `pause`, `resume`, `clear`; one answer per overlay).
- **Memory across a restart.** The ids of the alerts already shown are kept (400 at most), so a restart or an update never shows an alert twice and never loses one that was waiting in the topic (events older than 5 minutes are dropped, so reopening OBS does not replay the evening; a line that Twitch activity found after a gap, flagged `missed`, is kept up to one hour). A test or a replay (flagged by Twitch activity) ignores the switches, minimums, ignore list and age limit: whoever asks to see an alert sees it.
- **Nothing runs in the background**: the page (open in OBS) reads the topic at most once every 2 seconds per overlay, like for YouTube.
- **Tools for assistants** (off by default): `alert_templates_get` (read) and `alert_template_update` (write: switch, text, duration, minimum; nothing is deleted).
- New permission: `storage` (the configuration of the types, the pause and the ids already shown); `mcp` for the two tools.

Not done yet (next versions): sounds and images per type, animation choice per type, the preview of the alert in the administration.

## The look of Twitch alerts (version 1.5.0)

Under "More options" of the edit window of each type (the three of them are folded, so the window keeps its three visible fields):

- **Picture** (a field "Picture"): an image of your site (PNG, JPG, WebP or GIF, sent in the administration) shown above the text, 96 px square, as the part `image` of the card. The module **keeps** the file (permission `files`: it is claimed when you save, and let go when you replace or remove the picture), the page only accepts an address of the form `/uploads/<id>.<png|jpg|webp|gif>` (checked when saving, when reading the configuration, and again in the page): nothing is ever loaded from another site. Not available to assistants (a picture needs an upload).
- **Sound**: none (default), chime, bell, pop or fanfare. **The page makes them itself** (a few synthesised notes with Web Audio): nothing is uploaded, nothing is downloaded, so no third-party load and no file to validate. Off unless you tick "Play a sound with each alert" (tab Twitch events); the volume is an advanced setting (50 % by default). When sounds are off the page contains no audio code at all. **Custom sound files are not offered**: the core only accepts images and videos as uploads, so an audio upload would need a change of the core, which was left for the owner to decide (see the report).
- **How it enters and leaves**: per type, the modes of the shared transition helper (slide from an edge, fade, jiggle, pop, instant), or "like the module settings". A page where no type asks for a mode is exactly as before (it keeps its own animation).
- **Preview and "what the stream sees"**: the tab shows three sample cards as the overlay draws them (with their picture), the table shows a thumbnail and the sentence each type would say, and the button "Show a sample evening on screen" sends five sample alerts (follow, sub, gift, bits, raid) through the real path: texts, pictures, sounds, durations, queue.
- **Skins**: the picture is `[data-ov-part="image"]` in an overlay page element and `.al-img` in the module's own overlay; colours still come from the `--ov-*` tokens. A skin that does not know the part `image` simply leaves it at its default look.
- Tools for assistants: `alert_template_update` also takes `sound` and `animation`.
- Not done: custom sound files (core), text-to-speech and a rich animation engine (out of scope, stay external).

## Viewer texts, voice and moderation (version 1.6.0)

**What a type shows.** In the edit window of a type, under "More options": *What is shown* is the text (default), a picture alone (a GIF sent for the type, shown alone and framed as the part `media` of the card) or a video alone. Six videos can be added in the tab "Videos" (settings of type video, MP4 or WebM, kept on the site) and a type picks one; "Play the sound of the video" lets the video use its own sound. The six ways to get a card are therefore: GIF alone, video alone, GIF with a synthesised sound (choose the sound of the type), video with its own sound, text with a sound, text only. The core accepts images and videos as uploads, **not audio**: personal sound files are possible only inside a video. A real audio upload needs a small change in the core (signature check for ogg/mp3/wav/m4a in the uploads service and an upload field in forms); it is not done here.

**Viewer texts.** For resubs, bits and rewards, the type can show the message the viewer wrote, after the sentence, cut at a limit you choose (20 to 250, default 140). Always plain text. A type without a viewer message (follow, sub, gift, raid, stream start and end) never shows one; the hype train line has no viewer text in Twitch's data, so none is shown. The older setting "Show the messages that come with an alert" still decides for a type until that type chooses.

**Voice (text to speech).** The overlay page uses the browser's own `speechSynthesis`: no service, no key, nothing sent out. The tab "Viewer texts and voice" holds the switch (off by default), the voice, the speed, the volume, and, folded, the pitch, the language, the longest reading and "read the name". Each type chooses what is read: nothing, the sentence, the viewer text or both. The alert stays on screen long enough for the reading. The page tells the site which voices it sees (route `tts-report`), so the administration lists them and says in plain words: voice ready, no voice, no support, or no page has reported yet.

Honest limits, **not verified on a live OBS** (the tests use a fake `speechSynthesis`; a headless Chromium here has the API but no voice):
- OBS's browser (CEF) lists the voices of the computer. On Windows they are the system voices; on some builds or machines the list is empty and nothing is read. The page then shows the alert normally.
- Browsers may refuse sound before a first interaction (autoplay policy). OBS browser sources usually allow it, but if no sound is heard, check the option of OBS for the source (and "Control audio via OBS" for the audio of the page).
- Voices differ from one computer to another; a voice name saved in the administration may not exist elsewhere (the language is then used).

**Dock controls.** The OBS dock of Twitch activity (1.3.0) has three switches that say their state (Alerts, Voice, Mute voice), "Stop speech", "Skip alert", the queue buttons, and the texts waiting with "Accept anyway" and "Dismiss". They go through the service `alerts.queue` (version 2); the page obeys within its next read (about 1.5 seconds). Mute stops the speech at once and stays until unmuted, also after a restart.

**Moderation (basic).** Before a viewer text is shown or read: links, long runs of capital letters, repeated characters or words, and an optional list of blocked words (any case or accent, simple look-alike symbols undone, spread-out letters caught for words of five letters or more). The list is **empty by default**; the structural rules are on. A refused text makes the alert show **without the text** and nothing of the text is read (default), or the **whole alert waits** for your decision. Refused texts appear in the tab and in the dock with the plain reason; "Accept anyway" shows the alert again with its text (once), "Dismiss" keeps it hidden. The journal of Twitch activity marks the line. This is a **simple filter, not a replacement for Twitch AutoMod**: it can miss things and can refuse harmless texts (a blocked word inside a longer word of five letters or more, for example).

**For assistants** (off by default): `voice_moderation_get`, `voice_moderation_update` and `held_text_decide`. Nothing is deleted.

Tests: `tests/alerts-twitch-voice.test.mjs` (moderation, media, texts, voice, controls, the real page with a fake `speechSynthesis`, the administration with the ergonomics kit, the tools).

## Sound files (version 1.7.0, core 0.10.0)

Core 0.10.0 accepts sounds as uploads (MP3, Ogg, WAV, M4A, AAC; 10 MB at most, checked on the bytes). Under "More options" of the edit window of each type, the field **Sound file** (an `audio` field of the form, with a native listening control) keeps one sound of your site for that type. The module keeps it (`files.claim`; the previous file is let go) and the action checks the address again (`/uploads/<uuid>.(mp3|ogg|wav|m4a|aac)`, never an outside address). No slots, no new setting: the field is in the window.

- The file **replaces** the synthesised sound of the type. It plays once per alert, at the volume of the sounds, and stops with the card (skip, next alert). It needs "Play a sound with each alert" to be on, like the synthesised sounds; a page where no type has a file carries no code for it.
- A video with its own sound (1.6.0) keeps working; it does not need this field.
- Browsers refuse sound before a first interaction (autoplay). The overlay iframe of the core carries `allow="autoplay"`; in a plain OBS browser source it usually plays. If nothing is heard, check the OBS source option for audio. Not verified on a live OBS.
- Assistants can see that a type has a sound file (`hasSoundFile`), never its address, and cannot send sounds (the upload tool stays images only).
- Needs Curiosa 0.10.0.

## Media library (version 1.8.0)

The **Media** tab holds the pictures, GIFs and sounds you send (name, type, search, edit, delete) next to the six video fields. Other modules pick from this library through the service `alerts.show` (`list`, `show { visual, sound, seconds }`): the Twitch bot uses it for the "On stream" choice of commands and words. A media goes through the same queue as the alerts (pause holds it, skip and "Empty the queue" stop it) and stays on screen 2 to 60 seconds (default: the alert duration; a sound alone: 4 s, no card). A video plays with its own sound; sounds use the volume of the sounds setting. At most 30 media a minute are accepted. With an empty library the page is unchanged; after adding the first media, refresh the browser source in OBS.

## One editor per event type (version 1.13.0; replaced in 1.18.0)

*Since 1.18.0 Twitch activity is part of this module: the copy that listens shows ONE table of types (see above), the other copies keep the full editor. The text below is
the history of 1.13.0 to 1.17.0.* When **Twitch activity 1.10.0** (or anything that offers the optional service `alerts.reaction.editor`) is active and writes to this copy, the "Twitch events" tab no longer has its own edit window: its table is a summary (type, what is shown with the display order when there are several files, the switch "Shown") with **"Set in Twitch activity →"** on each row, which opens the Reaction window of that type there. The text styles, the preview, "What the stream sees" and the queue stay here. Without such an editor (alerts sent by another tool, YouTube only, an older Twitch activity, or a second copy of this overlay, since Twitch activity writes to the first one), the full editor stays in this tab. The settings stay owned by this overlay either way: nothing is migrated.

- **How the overlay knows**: `ctx.api.services.providers("alerts.reaction.editor")` lists only active instances of an installed module (optional need, never installed by itself); the editor's method `editor({ instance })` then answers `{ edits, path, name }`, `edits` being true only for the copy its window writes to. Any other answer, an error or no answer keeps the full editor.
- **`alerts.reaction` version 2** (additive): `get` also gives `version: 2`, `min` (null for a type without a minimum), `minMax`, `anim` and `anims`, `tts` and `ttsModes`, `viewer` and `viewerMax` (null outside resub, cheer and redeem) and `viewerMaxLimits`; `set` and `test` accept `patch.min`, `anim`, `tts`, `viewer`, `viewerMax` (error codes `range` and `choice`). A version 1 caller sends none of them and changes none.

## Reaction service (version 1.9.0; internal since 1.18.0)

*Since 1.18.0 the service is no longer offered: the same methods are called inside the module (`twitch/reaction.mjs` `service`, `index.mjs` `reactionService`), with the
same inputs and answers.* `alerts.reaction` (version 1, one answer per overlay) let Twitch activity set the on-screen reaction of an event type from its Types tab, without holding any file:

- `list`, `get({ type })`, `media` read (summary per type, one type in full, the pictures and sounds of the library by name).
- `set({ type, patch })` changes it; the method is listed in `callerRights`, so the files sent in that window are kept by THIS overlay (core 0.14.0, `files.claim` receives the person). Patch keys: `variants` (up to 12 uploads, pictures or videos), `pick` (`random` or `rotate`), `text`, `sound`, `audio`, `seconds`, `videoSound`. Errors are codes per field.
- `test({ type, patch })` shows a sample alert built with the typed values, saved or not.

One source of truth: the per-type settings of the Twitch events tab. A saved single picture is a list of one (nothing is migrated, the alert is byte-identical). With several variants one is picked per alert: at random, never the same twice in a row, or in turn; the position is kept in the stored state and restarts when the list changes. A file held by the library and by one or more types is let go only when the last holder lets go (`releaseFile`).

## Files made by your AI assistant (version 1.11.0, core 0.18.0)

Your AI assistant can add a video, GIF, picture or sound it made to the media library, then put it on a Twitch event. Every tool that writes is off by default: tick it in Admin > AI assistants, for this overlay.

| Tool | What it does |
|---|---|
| `reaction_media_upload_begin` | `name`, `bytes`, `sha256`. Returns `upload`, a one-time address to PUT the bytes (`curl -T clip.webm "<address>"`, 8 MB per request, `?offset=` for more) and the number of base64 pieces otherwise. |
| `reaction_media_upload_chunk` | `upload`, `index`, `data`: one base64 piece of 700 000 bytes, in order. |
| `reaction_media_upload_finish` | `upload`, optional `poster` (a library picture for a video). The site checks the real content: webm (VP8, VP9, AV1) or mp4 (H.264) up to 25 MB, 30 s and 1920x1080; pictures 5 MB; sounds 10 MB; nothing glued after the end. Returns name, id, duration, size and `transparent` for a video. |
| `reaction_media_list` | The library: kind, size, duration, dimensions, transparency, poster, added by a person or the assistant, used by which events. |
| `reaction_get` / `reaction_set` | One event type (`follow`, `sub`, `resub`, `gift`, `cheer`, `raid`, `online`, `offline`, `hype`, `redeem`): `media` (library names, 12 at most), `order` (`random`, `round_robin`), `text`, `durationSeconds`, `sound` (`off`, a built-in sound or a library sound), `videoSound`, `enabled`. |
| `reaction_test` | Sends one test alert of that type to the open overlay pages. Nothing reaches Twitch. |
| `reaction_media_delete` | Deletes a library file and the file itself; refused while an event uses it. |

The Media tab shows "Added by the assistant" on those files; you can delete them there like any other. The Twitch bot shows the same files by name (`onStreamPictures`). On a core older than 0.18.0 the upload tools answer that the core must be updated.

## Placed texts and "Large alerts" (version 1.12.0, core 0.19.0)

"Place the text" (the composition editor of the core, opened from the window of a reaction in Twitch activity) writes the sentence of an alert ON its picture or GIF, where the person chose. One placement per file of a reaction; "Apply to the other files" copies it.

- **Storage**: a collection of its own, `compositions` (`{ key: "event:<type>|<src>", place, src, composition, updatedAt, by }`), never the configuration: an older version of this module saving its settings cannot wipe them, it simply shows the media alone. A file taken out of a reaction loses its text.
- **Service `alerts.reaction`** (additive, no version change for callers): `get` adds `compose` (whether the core can place text) and `compositions` (`{ [src]: composition }`); `list` adds `placed` per type; `set` and `test` accept `patch.compositions` (`{ [src]: composition | null }`, only sent when the core's window could place text) and `test` accepts `patch.composeFor` (the file to show). Every composition is checked by the core (`ctx.overlay.checkComposition`): the backdrop must be the file it belongs to, a file of the reaction, and only the words of the alerts may be used; otherwise `{ errors: { variants: "compose" } }` and nothing is saved.
- **Alerts**: an alert of a file that has a placed text carries `compose`, its texts filled on the server (`ctx.overlay.resolveComposition`); the page draws it with the core's engine, in `data-ov-region="composition"` (never a card), whole inside the element. Without any composition the page is byte for byte the page of 1.10.1 (test `alerts-overlay-compose`, golden hashes).
- **Videos (1.14.0, core 0.21.0)**: `alerts.reaction.get` adds `composeVideo: true` when the core places text on videos too (`ctx.overlay.features` includes `"video"`); Twitch activity then offers "Place the text" on the videos of a reaction. The alert of a video with a placed text lasts as long as its composition says (the video's own length, or a chosen one, 2 to 60 s; longer only when the voice needs more time), the reaction's "Sound of the videos" still turns its sound on, and the page loads the backdrop of the next alert ahead (`CuriosaCompose.preload`, one at a time; only on a page that holds compositions). Transparent WebM videos stay transparent; one video plays at a time.
- **For an AI assistant (1.15.0, core 0.25.0)**: MCP tools `composition_places` (the places `event:<type>`, their files with size, length, transparency and still picture, the automatic values of each type), `composition_get` (a placement, or the editor's starting point), `composition_set` (off by default; the composition is a JSON text; `dryRun`; every problem listed at once in plain words, nothing saved then; a video gets its still picture and its own length; saved with `by: "assistant:<access>"`), `composition_preview` (an IMAGE: the core's approximate render with sharp, 20 a minute per access), `composition_render_kit` (a self-contained page for the assistant's own browser: exact render, `#t=` freezes a moment), `composition_copy` (off by default) and `composition_remove` (destructive, never granted by default). These tools never claim a file: the files come from the reaction (`reaction_set`). Typical path: make motion frames with ffmpeg, upload with `reaction_media_upload_*` (with a `poster`), `reaction_set` the event, `composition_set` with `dryRun`, LOOK at `composition_preview`, iterate, save; the owner fine-tunes in the editor.
- **Bot commands and words (1.16.0)**: service `alerts.show` version 3. `compositions({ prefix })` gives a caller (the Twitch bot) the placements of all its places in one read, `place({ place: "<instance>:<kind>:<id>", label, files, variables, phrase, compositions?, check? })` declares a place and saves the texts placed in the caller's window (checked by the core; every file must be in the library), `forget({ place })` removes them when the command goes, and `show` takes `place`, `vars` (20 values of 200 characters at most) and `text` (the bot's answer): the overlay fills the composition of the picked file and the page draws it. Places are kept in the collection `composePlaces`; the assistant tools list them as `show:<instance>:<kind>:<id>`. The caller draws nothing; without this overlay nothing changes for it.
- **"Large alerts"** (`alerts-stage`, `fit: "fluid"`): the same page in a frame the person sizes freely, so a 16:9 picture with its text shows at its real size. It follows the common style and the appearance kit, and is empty and transparent between two alerts.
- On a core older than 0.19.0: no "Place the text", nothing stored, media alone. On 0.19.0: pictures and GIFs only.


## One reaction per channel point reward (version 1.17.0)

A redemption whose reward has its own row (collection `rewardReactions`: `rid`, `title`, `cost`, `on`, `cfg`) shows ITS reaction (files, order, sentence, sound, placed texts at the place `event:redeem:<reward id>`) and follows ITS switch; any other redemption, or one without `rewardId` (an older Twitch activity), shows the reaction of the type `redeem`, exactly as before. The rows never touch the configuration (an older version ignores them). Service `alerts.reaction` version 3 (additive): `rewards`, `forget({ reward })`, and `reward` (+ `title`, `cost`) in `get`, `set`, `test`. A file used by a reward's reaction is never let go. MCP: `reaction_get`, `reaction_set`, `reaction_test` take `reward` (id or exact title) with type `redeem`; the `composition_*` tools take `reward` with the place `event:redeem`, and `composition_places` lists the rewards' places.

## The Twitch part (formerly Twitch activity, 1.0.0 to 1.12.0)

What follows is the documentation of Twitch activity, kept as it was: the version numbers are those of Twitch activity. Since 1.18.0 its *Events* tab is the first
tab of this overlay, its *Event types* tab is the *Twitch events* tab, its *OBS dock* tab is a section of the first tab, and its settings are described above.

### What the person sees (formerly the page of Twitch activity)

- **Events** tab: a status line ("Your site is listening to Twitch", or the one thing to fix), a *Check now* button, then the journal: live search, filter by type (colored AND written badge),
  *Replay the alert* and *Remove from the journal* on each line, an empty state that says what to do.
- **Event types** tab: one row per type with a switch, what it covers, the Twitch permission it needs, its state and a *Send a test* button (realistic sample, invented names).
- When a Twitch permission is missing, the page says which ("Twitch's permission is missing for: bits, hype trains") and shows *Allow again at Twitch*.
- One setting: how long the journal is kept (30 days by default). A channel choice appears in advanced mode when the site has several channels.

### Transport: signed EventSub webhook (decision)

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

### Twitch permissions (scopes)

Asked through the connector (`wantScopes`, version 1.4.0 of the connector adds `bits:read`, `channel:read:hype_train`, `channel:read:redemptions`), only for the types that are switched on:
followers `moderator:read:followers`; subs, resubs, gifts `channel:read:subscriptions`; bits `bits:read`; hype train `channel:read:hype_train`; reward alerts `channel:read:redemptions`; raids and stream start/end: none.
After the update the owner must **allow again at Twitch** once (the page says which permissions are missing and gives the button); types whose permission is granted keep working meanwhile.

### The topic `twitch.event`

Newest first, 200 at most; see `docs/TOPICS.md` for the fields. Test lines (`test: true`) and replay lines (`replay: true`, `of` = original id) are flagged; a gifted sub that belongs to a gift is `gifted: true`
(the gift line already carries the count). Consumers deduplicate on `id`.

### The journal

Collection `events`, keyed by the Twitch message id; fields are whitelisted (display name, login, tier, months, count, bits, viewers, public message, hype train figures), every string normalised (NFKC,
no control or direction characters, bounded). Purge task every hour: older than the retention (1 to 365 days, 30 by default), test and replay lines after one day, and never more than 5000 lines.
Hype `progress` messages are stored only when the level goes up. Tokens are never stored or logged; the secret of the subscriptions is kept in the state document and never shown.

### MCP tools (off by default)

`twitch_events_list` (read), `twitch_events_status` (read: listening state, missing permissions, last event per type, journal size), `twitch_event_replay` (write, bounded: 10 replays and 20 tests a minute, writes only a flagged line; nothing is ever deleted).

### Privacy

Only public data from the events: display names, amounts, tiers, counts, the public message of a resub or of bits. No e-mail, no account details. See the `privacy` text of the manifest.

### Limits and what is NOT verified

No live Twitch was available when this was written. Event fields were read in the official reference (see the header of `eventsub.mjs`); **not verified**: the behaviour of an application token for these subscriptions on a real channel,
how many failures make Twitch revoke a subscription, the redelivery schedule, and the reward redemption type. The tests use a fake Twitch that signs like the real one.
See "Robustness" below for what is recovered after a gap and what cannot be.

### The OBS dock (version 1.1.0, narrow layout 1.8.0)

A compact page for **OBS > Docks > Custom browser docks**, with the same secret address as the raid docks of the Twitch raid module (`/m/<key>/dock?k=…`, no session of the administration needed in OBS). Address and instructions: tab **OBS dock** of the module, one field with a copy button, and **New address** (asks for confirmation, the old dock stops at once: reload the dock in OBS).

- **What it shows**: the live journal, newest first, one row of the same height each: a badge **coloured and written** (type), the display name, the details (amount, tier, count), the time ("2 min ago", "il y a 2 min") and a **Replay** button (44 px at least). Works from about 280 px wide to wide panels, dark by default (`?scheme=light` forces light), follows the look of the administration (`--cur-*` tokens, no colour written in the page).
- **Period**: "This stream" (since the stream start we received; default while live), "24 h" or "All kept"; filter by type (chips, hype train in one) and a search field (no accents, no case).
- **Live updates**: a short read every 3 seconds; when the site does not answer (restart, update) the dock keeps what it shows, says "Reconnecting… next try in N s" with a dot that changes (never colour alone) and waits 6, 12, 24, 30 s; it comes back by itself. A wrong or replaced address stops it with one plain sentence (no retry loop).
- **Replay**: re-queues the alert with the same data as a new journal line flagged `replay` (who/when are the journal's). **It works even if the type is switched off** (a manual replay is a wish). De-bounced (a double click sends one alert; the button says "Replayed ✓"), rate limited (10 a minute), refused when no alerts overlay is installed (the buttons are disabled and the page says why). The only MCP route to replay stays `twitch_event_replay`.
- **Pause alerts / Resume**: **holds** the alerts of the alerts overlay (they are kept in order and come out when you resume; nothing is lost), **Empty the queue** (asks first) and **Test** (a menu of types), through the service `alerts.queue` of the alerts overlay (optional: without it these buttons are disabled).
- **Privacy**: only display names, amounts and counts leave the module; never a token, a secret or an e-mail (a test checks the whole answer). Wrong keys are counted: 30 a minute, then 429 before any comparison; the data route answers 90 reads a minute, the actions 40.
- **Narrow layout (1.8.0)**: built for an OBS dock of 220 to 360 px, still fine wide or very short. Each row has two lines (name and detail, then type and time) and ONE 44 px replay button; the type pill is never cut, the name is cut with "…" only when needed (full text in the tooltip). The period and the type are two lists (no tabs or chips to scroll sideways). The controls (Alerts, Voice, Mute voice, Stop speech, Skip alert, Empty the queue, Test) are icon buttons with a name and a tooltip, folded under a "Controls" button (folded by default, remembered in the dock; words and states appear from 520 px). A "Paused" pill stays visible in the title when alerts are held. The notice is one short line; when the site is not listening it is a link to the page of the module. Under 420 px high the title and filters scroll away with the list, which starts in view.
- **The "not listening" notice** only shows for a real problem (permission missing, Twitch or the site not answering, connection missing). Never checked yet (just after an update), "pending" and "nothing on" no longer count, as in the badge of the administration.
- Code: `dock.mjs` (page, one script, nonce policy, nothing from another site), `dockapi.mjs` (address, data, actions), `dockpure.mjs` (functions run by the page AND by the tests), `dockkit.mjs` (copy of the look helpers of `twitch-raid/dock.mjs`; a test fails if the tokens drift), `describe.mjs` (how a line is written, shared with the admin page).

### Robustness (version 1.2.0)

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

### Moderation marks and voice controls (version 1.3.0)

- **Service `twitch.journal`** (method `flag`): the alerts overlay (1.6.0+) tells the journal when it hid or held a viewer's text (reason: word, link, caps, repeat) and when you accepted or dismissed it. The line then reads, for example, "500 bits · text hidden (link)". Only the reason and the state are stored, not another copy of the text. Without this module the overlay simply does not mark anything.
- **Dock**: three switches that show their state in words (Alerts, Voice, Mute voice), "Stop speech", "Skip alert" and, when the moderation holds something, the texts waiting with "Accept anyway" and "Dismiss" (buttons of 44 px, equal rows). They need the alerts overlay 1.6.0; with an older one the voice controls are disabled and say so.
- Read more about the voice and the moderation (basic filter, not Twitch AutoMod) in the README of the alerts overlay.

### Reaction (version 1.5.0)

The Types tab has a Reaction column (Text, GIF, 3 GIFs, Video, plus the pick rule and "sound") and an Edit button that opens a window: a gallery of pictures, GIFs or videos (up to 12, uploaded together or picked from the library), the order (at random or in turn), then under "More options" the sentence, a sound, the time on screen. "Test the reaction" plays what is typed without saving. Everything goes through the optional service `alerts.reaction` of the alerts overlay (core 0.14.0): this module holds no file. Without the overlay the tab shows one line ("Alerts overlay: to add") with a link to the catalogue and no Edit button.

The Events tab shows a short list of steps (Twitch authorized, listening, overlay added) while one is missing. Whether the alerts element sits in an overlay page cannot be read from here: that step is a link to the overlay pages with no state, never a checkmark.

**Setting up the overlay in one click (version 1.6.0, core 0.15.0).** When the alerts overlay is installed but has no copy, a "Set up Alerts overlay" button sits under the steps (and in the Types tab): it does what "Set up" does on the Modules page, for the administration team, and the page comes back with a confirmation. The module asks for the permission `instances.setup` (`ctx.api.instances.pending` and `setUp`, which only reach an installed module that offers a service this module requires). When the overlay is not installed, the core's install suggestion (`suggestInstall`) installs it with its first copy; a copy too old to offer the service keeps the link to its page. This module never installs or updates code.

**Honest status per type (version 1.7.0).** Twitch lists every condition field of a subscription and fills the ones we do not use with an empty text (`channel.raid`: `from_broadcaster_user_id: ""`; channel points: `reward_id: ""`). Before 1.7.0 the module compared the fields as it had sent them, did not recognise its own raid and channel point subscriptions, deleted them as "stale" and created them again every minute: those two types stayed "waiting for Twitch" for ever and lost their events. An empty field now counts as absent (`sameCondition` in `eventsub.mjs`). The Types tab says, for each type that does not listen, the real reason in one visible sentence: Twitch has not confirmed yet; Twitch stopped it (permission withdrawn, address did not answer); another module already receives the same thing (state "Held elsewhere": it never holds the verdict of an optional type); or Twitch refused to start it, with its own code and message. Each refusal writes one line to the site log (`type.create_failed`), only when the answer changes. The row menu has "Try again" per type: it deletes only our subscriptions of that type and creates them again.

### The only editor of a reaction (version 1.10.0)

With the alerts overlay 1.13.0 (service `alerts.reaction` version 2), the Reaction window also holds what only the overlay's "Twitch events" tab used to edit, all under "More options": the minimum (cheer, gift, raid, redeem), how the alert enters and leaves, what is read aloud, and the viewer text with its longest length (resub, cheer, redeem). The form sends them only when the window showed them (hidden field `more`), so an older overlay receives nothing new. This module offers the service `alerts.reaction.editor` (method `editor`, read only): the overlay asks it whether this window writes to its copy and, if so, shows a summary with "Set in Twitch activity →" instead of a second editor.

### Placed texts on the pictures of a reaction (core 0.19.0)

The window of a reaction (Types tab) declares the `compose` option on its gallery when the alerts overlay can keep placed texts (`alerts.reaction.get` says `compose: true`). Each picture or GIF then has "Place the text"; the automatic values offered depend on the type (`TYPE_WORDS`: a follow offers the name, a cheer the name, the amount and the viewer's text…), shown as chips, never braces. The form sends the placed texts only when the core marks the field (`variants__compose`), so an older core changes nothing; "Test on the overlay" sends `variants__composeFor` and the overlay shows that file. Nothing is kept here: the alerts overlay owns the files and the compositions. The Types table says "3 GIF, 2 with text". (1.11.0) Videos get "Place the text" too when the overlay says `composeVideo: true` (Alerts overlay 1.14.0 on core 0.21.0).


### One reaction per channel point reward (version 1.12.0)

The **Rewards** tab lists the channel point rewards of the channel (read at Twitch through the connector, `GET channel_points/custom_rewards`, permission "read the redemptions" that the type "Channel points" already asks for; at most once every 30 s), with the rewards seen in the journal when Twitch cannot be read, and the rewards deleted on Twitch that still have a reaction ("Deleted on Twitch", the reaction can be removed). "All other rewards" (the type `redeem` of the alerts overlay) comes first. Each line: its reaction, a switch, "Edit" (the same reaction window as a type, with the core's preview), "Send a test" and "Remove the reaction" in the menu. A redemption keeps the id of its reward (`rewardId` in the journal and the topic).

The reactions are kept by the alerts overlay (`alerts.reaction` version 3: `rewards`, `forget`, and `get`/`set`/`test` with `reward`). "Add a reward" creates it on Twitch through the Twitch bot (`twitch.rewards`, optional, the person's right carried): this module never asks for the permission "manage the rewards". Without the bot, one line with a link. Read tool: `twitch_events_rewards`.

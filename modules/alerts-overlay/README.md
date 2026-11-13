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

## Reaction service (version 1.9.0)

`alerts.reaction` (version 1, one answer per overlay) lets Twitch activity set the on-screen reaction of an event type from its Types tab, without holding any file:

- `list`, `get({ type })`, `media` read (summary per type, one type in full, the pictures and sounds of the library by name).
- `set({ type, patch })` changes it; the method is listed in `callerRights`, so the files sent in that window are kept by THIS overlay (core 0.14.0, `files.claim` receives the person). Patch keys: `variants` (up to 12 uploads, pictures or videos), `pick` (`random` or `rotate`), `text`, `sound`, `audio`, `seconds`, `videoSound`. Errors are codes per field.
- `test({ type, patch })` shows a sample alert built with the typed values, saved or not.

One source of truth: the per-type settings of the Twitch events tab. A saved single picture is a list of one (nothing is migrated, the alert is byte-identical). With several variants one is picked per alert: at random, never the same twice in a row, or in turn; the position is kept in the stored state and restarts when the list changes. A file held by the library and by one or more types is let go only when the last holder lets go (`releaseFile`).

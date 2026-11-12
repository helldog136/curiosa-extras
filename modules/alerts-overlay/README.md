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

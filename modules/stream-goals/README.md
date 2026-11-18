# Live goals (`stream-goals`) — Curiosa module

Two animated elements for your overlay pages:

- **Goal bar**: a bar towards a number (your followers, your paid subs, or a number you keep by hand). It moves at each follow or sub, celebrates each quarter and the goal itself.
- **Subathon**: a countdown whose time grows with each sub, bits or follow, by the rules you choose. The time added is written ("+5:00").

The module only says **what happens**. The core's animation engine (core 0.30.0, `docs/OVERLAY-ANIMATIONS.md` of the core) draws it in the style of the overlay page's skin: a skin with an animation recipe (stained glass, neon…) looks richer, and **every other skin works too**, through the engine's plain rendering. Changing the page's skin changes the look, nothing else.

## Short path

On core 0.31.0 the settings live in **Live › Goals** (`live.goals`), two tabs, one « Save » bar per tab:

| Tab | What you do | Fields shown | Folded under « Advanced settings » |
|---|---|---|---|
| **Goal** | choose what counts and the target | What counts (Followers · Paid subs · By hand), Target (empty: the next round number) | Title of the bar |
| **Subathon** | choose when it starts and how long | Start (date and time of the site), Starting length (4 h by default) | Time added per sub (5 min), what a tier 1, 2 or 3 sub counts as (1, 2 and 5 subs, folded under « More options »), per 100 bits (1 min), per new follower (0), longest total length (0: no limit), title |

Then, in **Overlay pages**, add the element **Goal bar** or **Subathon** (this module) where you want it. The element has the two options of every animated element: **Effects** (automatic, all, light, none) and **Calm motion**.

Live buttons on each tab (secondary): **Test the bar** / **Test the countdown** (a rehearsal on your overlay pages: the bar gains one step, or the countdown gains time, and goes back after 8 seconds; nothing is counted), **Set the value** (when the value is kept by hand, or when no Twitch figure is available), **Pause the subathon** / **Resume**, **Add this time** (minutes, negative to remove: a donation received elsewhere, a correction).

On an older core (0.30.0) the same tabs are on the module's own page.

## Sources: all optional

| Present | What it gives |
|---|---|
| nothing | the bar and the countdown work with the value and the time you set by hand |
| **Alerts overlay** (it listens to Twitch) | each follow, sub, gift and bits moves the bar or adds time, about 2 to 4 seconds after Twitch |
| **My Twitch channel** | the bar starts from the channel's real number of followers or paid subs (read every 5 minutes by that module; paid subs need « paid subs » switched on there, and an affiliate or partner channel) |

When a source is missing, the tab shows « Install a module that… » (the core's suggestion block): nothing is ever installed without your click.

## How the value is counted (no double counting)

```
displayed = last reference value + events counted since its date
```

- The **reference value** is the channel's figure read by My Twitch channel, with the time Twitch was read (`asOf`), or the value you set by hand (dated when you set it). A newer one replaces an older one; an older one is ignored.
- The **events** come from the Twitch events of the Alerts overlay. This module keeps its own short list of what it counted (the « ledger », 60 days), unique **by the Twitch message id**, then **by person**: a follow counts once per login (unfollow and follow again does not count twice; a follow found again by a catch-up neither), a sub, a renewal or a sub end once per login within 10 minutes, a gift or bits once per (login, amount) within 10 seconds. Two listening modules (the bridge period of Twitch activity) deliver the same event under two message ids: the person rule catches it.
- An event dated **at or before** the reference date is already in it: it is not added again. Twitch updates its counts a little after the events: a follow in the last seconds before a reading can be counted by both; the next reading puts it right (with a glide).
- **Followers**: +1 per new follower. Twitch has **no unfollow event**: the bar goes down only at the next reading.
- **Paid subs**: +1 per sub (gifted subs arrive one by one as subs, so the gift line itself is not counted again), −1 per **end of subscription** (`channel.subscription.end`, listened to by the Alerts overlay 1.20.0).
- **A new reference value never celebrates**: the bar glides to it in about 2 seconds, up or down (a drop is never celebrated). Only events celebrate: a quarter of the way, the goal.
- **Tests and replays never change a value**: a test line of the Alerts overlay (its Test buttons) plays a rehearsal that goes back by itself.
- **The automatic target** (Target left empty) is the next round number above the value when the bar starts (63 → 70, 512 → 550, 1 234 → 1 500); it stays while you approach it, and an hour after it is reached the next one is chosen.

## The subathon, exactly

- Nothing counts before the start. From the start the clock runs for the starting length plus the time added, and **stands still while paused** (events during a pause still add time).
- Each event adds its rule: a sub or a renewal `seconds per sub × tier factor` (by default tier 1: ×1, tier 2: ×2, tier 3: ×5; each factor is a setting, « A tier 1 / 2 / 3 sub counts as », from 0 to 20 in steps of 0.5, 0 meaning that tier adds no time; the result is rounded to the second), a gift of N subs `N × seconds per sub × tier factor` (the gifted subs themselves are not counted again), bits `bits / 100 × seconds per 100 bits` (rounded down), a new follower `seconds per follower` (once per login).
- An event counts only if the subathon was still running at its instant: once at zero, it is over.
- **Cap**: the longest total length (starting length + added time). What goes beyond is noted (« longest length reached ») but not added; the bar's span is the cap.
- **Corrections**: « Add this time » with a negative number removes time, never below « ends now ».
- **Changing a factor** re-computes the whole countdown from the list of events, past events included (the same rule for every setting of the subathon).
- Everything is computed from the list of events in time order: the same list gives the same countdown on every overlay page and after a reload.

## Live behaviour

- **Latency**: the element asks every 1.5 s; a reaction starts 1.6 s after the module first saw the event, so every open overlay page shows it at the same moment (about 2 to 4 s after Twitch, Twitch's own delay not included).
- **Bursts**: five follows in two seconds are one reaction « +5 » (the engine merges them); celebrations wait in line, one at a time.
- **Reload, network cut**: the page shows the current state at once (times are the server's); reactions older than their few seconds are over: **nothing is replayed**. An event seen more than a minute after it happened (a catch-up) counts silently.
- **Two pages open at once** (a test page during the live): the sources are read once per 1.4 s per instance, a second page waits for that reading, and each event is stored once (keyed by its message id): no double count, no double celebration.
- **Calm motion and effects**: from the engine (element options, and the computer's « reduce motion »).
- The element addresses carry a secret: the numbers are not readable without it.

## Assistant tools

| Tool | Default | What it does |
|---|---|---|
| `goal_get` | on (read) | what counts, value, target, reference value and its date, sources present |
| `subathon_get` | on (read) | start, time left, time added, pause, end, cap, rules |
| `goal_set` | off | sets the value by hand |
| `goal_test` | off | a rehearsal of the bar or of the countdown (nothing counted) |
| `subathon_add_time` | off | adds or removes minutes (−600 to 600) |
| `subathon_pause` | off | pauses or resumes |

The target, what counts, the start and the rules are settings: the assistant changes them with the core's `maintenance_module_configure` (`goalMetric`, `goalTarget`, `subathonStart`, `subathonLength`, `secondsPerSub`, `tierFactor1`, `tierFactor2`, `tierFactor3`, `secondsPerHundredBits`, `secondsPerFollow`, `subathonCap`).

## Privacy

To count each person once, the ledger keeps the public Twitch login, the kind and the amount of the events it counted, for 60 days (then removed by an hourly task; 20 000 rows at most). Only your team reads it, through the admin and the assistant. Nothing is collected from visitors.

## Not verified here

- Real Twitch timing (delivery delay, how fast Helix counts follow a new follow), shared hype trains: tested with Twitch's documented shapes only.
- OBS performance on the streaming computer: the engine's own measures are in the core's documentation; check OBS's Stats dock.

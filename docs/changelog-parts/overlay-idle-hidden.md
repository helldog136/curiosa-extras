## Audience 1.8.2, Planning 2.7.5, Community statistics 1.2.2, Game suggestions 1.9.2, Thanks wall 1.2.4, My Twitch channel 2.3.1: an overlay with nothing to say shows nothing

*Module versions: Audience 1.8.2, Planning 2.7.5, Community statistics 1.2.2, Game suggestions 1.9.2, Thanks wall 1.2.4, My Twitch channel 2.3.1. Nothing to set up, no new permission.*

### Fixes

- **Prize draw: nothing on screen once sign-ups are closed.** The "Prize draw" element used to keep showing "Sign-ups closed / title / 0 people signed up" (and "Draw finished" after the winners). It now shows the draw only **while sign-ups are open**, then the **people drawn** (20 seconds, or until the next draw with the "Keep the people drawn on screen" option), and nothing else: no draw, sign-ups closed with nobody drawn yet, or winners already shown, the frame is empty and transparent. The frame also empties by itself when the end time passes.
- **Same rule for the other elements.** Planning ("Week planning", "Next stream"), Community statistics ("Counters"), Game suggestions ("Top suggested games"), Thanks wall and My Twitch channel ("Followers and subscriptions", "Live pill") with nothing to show now leave an empty frame, with no "no stream planned" card, and no background or border left over from the common page style. The test mode still shows a sample so that you can place the element.

### For developers

- New `tests/overlay-idle.test.mjs`: walks over every overlay element declared in `modules/*/module.json`, renders it idle and checks that nothing visible is produced (and that the test-mode sample still shows). A new element must be added to `IDLE` or to `EXEMPT` with the reason, or the coverage test fails.
- Removed the now unused texts `drawOvClosed` and `drawOvDone` (Audience).

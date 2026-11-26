# Sponsor banner motion audit (Sponsor ticker 1.7.0)

Scope: the sponsor banner (`modules/sponsor-ticker`) and its page element "Sponsor banner". Checked and left alone: `ticker-overlay` (a scrolling banner of generic cards, not a sponsor overlay), `sponsors` and `partnerships` (no overlay), the alerts overlay (out of scope).
Guidelines: the private `animation-fundamentals` skill and `principes-animation` note, plus the motion section of the UI ergonomics notes. Figures marked as starting points there were tested, not assumed.

## Method

The overlay page (`dev=1` developer mode, one card, 4 s period) was run in headless Chromium (Playwright), at 1920x1080 and 3440x1440, with `prefers-reduced-motion` both `no-preference` and `reduce`. Every animation frame (requestAnimationFrame, 60 Hz) the position, transform and opacity of the slider, card, logo, text, QR plate and shine were sampled, and velocities derived (px/s). OBS CEF was not available: the figures are Chromium's, the paint-cost items below are reasoned from what the CSS asks for, not profiled in CEF.

## Findings and what changed

| # | Finding (before 1.7.0) | Measured | Guideline | Change |
|---|---|---|---|---|
| 1 | The entrance curve `cubic-bezier(.2,.9,.32,1.15)` ends with a non-zero velocity: the card snaps to its final place after the overshoot | last frames 243-287 px/s (4-5 px per frame) at 1920, 4.1 % overshoot | stop cleanly: velocity 0 on the last frame | `cubic-bezier(.3,1.35,.5,1)`: same start speed (4.5 x the mean) and same 4.1 % overshoot, last frames 12-47 px/s |
| 2 | The default exit replayed the entrance curve (the CSS transition had one curve for both ways) | exit starts at 6200 px/s on frame 1 (no soft start), then bounces 33 px backwards while already invisible | exits: soft start, crisp end | exit state has its own curve `cubic-bezier(.5,0,.75,.4)` (the one the explicit modes already used): starts at 16-67 px/s, ends at ~3000 px/s, no bounce |
| 3 | The exit fade (0.45 s, ease) finished before the slide (0.58 s): the card was invisible while it was still crossing the frame | opacity 0 at 78 % of the slide | one clear motion, crisp end | the fade runs over the last 70 % of the slide and ends with it |
| 4 | Everything moved rigidly together (plate, logo, text, QR) | 0 ms offset between the pieces | follow-through; 1-3 frame stagger between similar elements | the plate stays the hero; logo at +40 ms, text at +80 ms, QR at +120 ms (about 2 frames per step, 260 ms each, 14 px of trailing travel on the side the card comes from, QR by opacity only so it stays pixel-aligned). Skipped when the entrance is "none" |
| 5 | The shine started sweeping while the card was still moving, then ran for 3 s every 5.5 s: two motions at once, and a moving highlight over the text for 55 % of the time | shine moved 0-3000 ms after the card was built | one hero motion; a moving hold that does not distract | the shine and the float start after the card has landed; one 3 s sweep per 11 s (one sweep per appearance with the default 10 s display time); periods 4.6 s (float) and 11 s (shine) are not multiples of each other |
| 6 | Two infinite animations kept running while the banner was hidden (about 80 s of every 90 s) | 2 running animations while hidden | cost | after the exit the page pauses them (`tk-idle`), they restart on the next entrance: 0 running animations while hidden |
| 7 | `box-shadow` on `.ticker-card` (drop shadow, and the neon glow) is always clipped away by the card's `clip-path` | pixel diff with and without it: 0 px | cost, no invisible work | removed. The neon glow therefore never showed; making it visible (a filter on an animated layer) is a look decision, not done here |
| 8 | `backdrop-filter: blur(10px)` on a card whose background is an opaque theme colour | no visible effect in the standalone page | cost | removed from the standalone page; kept on the page element (its surface can be transparent) |
| 9 | Default ("auto") entrance ignored `prefers-reduced-motion` and slid 814 px, against what the README promised | slide of 814 px with `reduce` | reduced motion | with `reduce`: no travel, no loops, timed opacity fade in and out of the configured length (see the note below) |
| 10 | "jiggle" is piecewise linear: the wobble reverses direction with a velocity jump at every key | 4 sharp reversals | no angular value curves | every key eases in and out; the entrance's first step is an ease-out, the exit's last step an ease-in |
| 11 | "fade" with the entrance curve reached full opacity at 47 % of its length | 283 ms of a 600 ms setting | timing respects the setting | the fade uses its whole length |
| 12 | The explicit modes' entrance (slide, pop) had the same snap as the default | 429-455 px/s at the end | stop cleanly | same new entrance curve, applied after the shared helper starts the animation (the shared helper `overlay-transition.mjs` and the other overlays are untouched) |

Deliberately left as it is:

- The length of the exit equals the entrance length (`transitionSeconds` keeps its meaning); the 70-80 % rule of thumb is not applied.
- No anticipation: a calm lower third is not a strong gesture. Overshoot stays at 4 %, inside the 5 % the UI notes allow.
- Straight horizontal travel, no arc: the banner is a graphic plate on rails.
- The 4 px, 4.6 s float (3 px/s at most) is calm enough; with a QR code it is off, as before ("the banner stays still while a QR code is shown").
- `will-change: transform` on the slider stays: one layer, and the QR plate is snapped to whole pixels at rest.
- Layout work (title fit, QR plan) runs once per card while it is hidden and on a window resize, never while it moves. Longest frame gap measured during the sequence went from 50 ms (one frame lost) to 16.8 ms.
- 25 % and 200 % playback (derived from the sampled timings, not played back): at 25 % the content is fully legible about 1.4 s after the plate starts (0.34 s x 4); at 200 % the peak speed doubles to about 12 000 px/s (200 px per frame), still one single motion. Not changed.

## Measurements (1920x1080, 60 Hz sampling)

| | before | after |
|---|---|---|
| Entrance, default, last frames | 287 / 243 px/s | 47 / 12 px/s |
| Entrance overshoot | 4.1 % (33 px) | 4.1 % (33 px) |
| Exit, first frames | 6207 / 5894 px/s | 22 / 67 px/s |
| Exit, bounce backwards | 33 px | 0 |
| Exit, last frames | -287 / -243 px/s (reversing) | 3246 / 2675 px/s (crisp, invisible) |
| Content offset (logo / text / QR) | 0 / 0 / 0 ms | 40 / 80 / 120 ms |
| First shine movement after the card is built | 0 ms | 1200 ms |
| Running animations while hidden | 2 | 0 |
| 3440x1440 | same distances in px (the card is 603 px wide at both sizes), same curves | same |
| `reduce`, default entrance | slides 814 px in 583 ms | opacity only, 450 ms in, 417 ms out |
| `reduce`, explicit "slide left" | 100 ms fade in, 217 ms out (shared helper, unchanged) | same |

## Reduced motion and OBS

For a streamed overlay the viewer is the audience, not the streamer: a reduced-motion preference of the streaming PC must not remove the entrance and exit. The banner therefore keeps its timing and an opacity fade under `reduce` and drops only the travel and the loops. The core currently overrides this for skinned overlays: `skinSheet.ts` emits `animation:none!important;transition:none!important` under that media query, which also removes the fade of the default mode (the card then appears and leaves at the right moments, without a fade). The core fix is separate; nothing is edited in the core here.

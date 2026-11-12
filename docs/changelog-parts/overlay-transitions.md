## Sponsor ticker 1.2.0, Scrolling banner 1.2.0, Alerts 1.3.0: choose how an overlay element enters and leaves

*Module versions: Sponsor ticker overlay 1.2.0, Scrolling banner overlay 1.2.0, Alerts overlay 1.3.0. These three now need Curiosa 0.6.0. Nothing to set up, no new permission, nothing changes unless you pick another way.*

### New

- **How it enters / How it leaves.** The sponsor banner used to slide in from the right of its frame, always. You can now pick, for the entrance and for the exit: slide from the **left**, **right**, **top** or **bottom**, slide from the nearest edge, **fade**, **jiggle** (a short bouncy entrance; on the way out, a wobble then a fade), **pop** (zoom) or **instant**. "Default" keeps the previous look; "Same as how it enters" (the default for leaving) plays the entrance backwards.
- **Where.** In the module settings, under "More options" (for the standalone overlay), and as two options of the overlay element ("Like the module settings" by default), so two elements in one page can move differently. The same choices exist for the **Scrolling banner** (cards) and for **Alerts**.
- **Length of the movement**, from 0.2 to 2 seconds (module settings, "More options").
- **Less motion.** For people who ask their device for less motion, any movement becomes a short fade.

### For developers

- The code is written once in `scripts/overlay-transition.mjs` (server: `transitionConfig`, which validates the two choices and the length; client: `ovTransition`, Web Animations API, any frame anchor) and copied to `modules/<id>/transition.mjs` by `node scripts/gen-transition.mjs` (`--check` in `tests/overlay-transition.test.mjs`). The texts of the settings are written once in `scripts/overlay-transition-labels.mjs`, which also writes them into the three `module.json` files.
- Settings and element options keys: `transitionIn`, `transitionOut`, `transitionSeconds`. With every choice on "Default" the Alerts page is byte for byte the previous one; the sponsor and banner pages only gained CSS variable fallbacks and the shared function.
- The skin entrance presets (`--ov-anim`) are untouched; a skin may still define an idle motion.

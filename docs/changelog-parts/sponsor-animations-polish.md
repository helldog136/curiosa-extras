## Sponsor ticker 1.7.0: a calmer, cleaner sponsor banner animation / Overlay sponsors 1.7.0 : une animation du bandeau plus calme et plus nette

*EN: module touched: Sponsor ticker 1.7.0. No new permission, no new setting, nothing to set up. Your settings and the way the banner enters and leaves are kept.*
*FR : module touché : Overlay sponsors 1.7.0. Aucune nouvelle permission, aucun nouveau réglage, rien à régler. Vos réglages et la façon dont le bandeau arrive et repart sont conservés.*

### What changes for you / Ce qui change pour vous

- **EN: the banner lands cleanly.** It still slides in fast with a very slight bounce, but now stops dead instead of snapping into place at the end.
- **FR : le bandeau se pose proprement.** Il glisse toujours vite avec un très léger rebond, mais s'arrête net au lieu de « claquer » en place à la fin.
- **EN: it leaves softly.** It starts slowly, speeds up and fades out as it goes, instead of leaving at full speed and bouncing back out of sight.
- **FR : il repart en douceur.** Il démarre lentement, accélère et s'efface en partant, au lieu de partir à pleine vitesse puis de rebondir hors de vue.
- **EN: the content follows the card.** The logo, the text and the QR code appear one after the other, a split second after the plate.
- **FR : le contenu suit la carte.** Le logo, le texte et le QR code apparaissent l'un après l'autre, une fraction de seconde après la plaque.
- **EN: the shine and the floating wait for the card to land, and the shine is rarer** (one pass per appearance with the default display time). Nothing moves while the banner is hidden.
- **FR : le reflet et la flottaison attendent que la carte soit posée, et le reflet est plus rare** (un passage par apparition avec la durée d'affichage par défaut). Rien ne bouge quand le bandeau est caché.
- **EN: with reduced motion on the device, the banner fades in and out over the same time, without sliding or looping.** Before, the default entrance still slid.
- **FR : avec le mouvement réduit sur l'appareil, le bandeau apparaît et disparaît en fondu sur la même durée, sans glisser ni boucler.** Avant, l'entrée par défaut glissait encore.
- **EN: the "jiggle" wobble turns smoothly, and "fade" uses its whole length.**
- **FR : le tremblement « jiggle » tourne en douceur, et « fondu » utilise toute sa durée.**

### For developers

- `modules/sponsor-ticker/index.mjs`: new exports `ENTER_CURVE` (`cubic-bezier(.3,1.35,.5,1)`), `EXIT_CURVE` (`cubic-bezier(.5,0,.75,.4)`), `FLOAT`, `SHINE`, `STAGGER`. The slider's CSS transition has the exit curve on the base state and the entrance curve on `.on`; the exit fade is delayed by 30 % of the length. The page script gets `tune(phase, mode)` (re-times the Web Animation started by the shared `ovTransition`, so `scripts/overlay-transition.mjs` and the other overlays are untouched), `follow(card)` (content stagger) and the `tk-idle` class (animation-play-state paused after the exit). Removed: the card's `box-shadow` (always clipped by its `clip-path`) and, from the standalone page, `backdrop-filter` (opaque surface). Under `prefers-reduced-motion: reduce` the slider has no translation and keeps timed opacity transitions. The core still overrides this on skinned overlays (`skinSheet.ts`, `transition:none!important`).
- Audit, measurements and what was left on purpose: `docs/SPONSOR-MOTION-AUDIT.md`. Tests: `tests/sponsor-ticker-motion.test.mjs`; the version pins in `tests/places.test.mjs`, `tests/sponsor-ticker-rotation.test.mjs` and `tests/overlay-elements-countdown-sponsors.test.mjs` moved to 1.7.0.

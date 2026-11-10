## Announcement story: two new styles, Epic fantasy and Hero arena / Story d'annonce : deux nouveaux styles, Épique et Héros

*EN: twelve styles now. Module touched: Announcement story 2.11.0. Nothing to set up, no new permission.*
*FR : douze styles désormais. Module touché : Story d'annonce 2.11.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: "Epic fantasy".** Dark leather, a gilded frame with gems in the corners, a banner for the date, rune-like strokes, engraved golden capitals that glow once as they appear, and embers that rise then fade out before the final hold.
- **FR : « Épique ».** Cuir sombre, cadre doré avec des gemmes aux coins, bannière pour la date, traits façon runes, capitales dorées gravées qui s'illuminent une fois en apparaissant, et des braises qui montent puis s'éteignent avant l'image finale.
- **EN: "Hero arena".** Big slanted panels in your main colour and a contrasting one, hexagon pictures, condensed italic capitals, chevrons that slow down to a stop, and a bar that fills up for the countdown.
- **FR : « Héros ».** De grands panneaux inclinés dans votre couleur principale et une couleur contrastée, des images en hexagone, des capitales italiques condensées, des chevrons qui ralentissent jusqu'à l'arrêt, et une barre qui se remplit pour le compte à rebours.
- **EN: Same care as the other styles.** Readable in 9:16 and 4:5, everything inside the safe area, the "Made with Curiosa" mention stays at the bottom, text never smaller than 20 px, a still image for the last 22 % of the video. Both are original designs: nothing is taken from any game.
- **FR : le même soin que les autres styles.** Lisibles en 9:16 et en 4:5, tout dans la zone sûre, la mention « Made with Curiosa » reste en bas, aucun texte sous 20 px, une image fixe sur les 22 % finaux de la vidéo. Ce sont deux créations originales : rien n'est repris d'un jeu.

### For developers

- `STYLES` has twelve ids (`epic`, `arena` added); `styleEpic` and `styleArena` in `scenes-extra.mjs` with their palettes (`extraPalette`), same contract (`draw(ctx, t)` pure function of time, `restTime` at 78 %). Arena squeezes its text with `ctx.scale` (84 %), so `tests/helpers/fakeCanvas.mjs` now notes the horizontal scale and offset (two extra fields, only when the scale is not 1) and the safe-area test measures squeezed text where it lands. The MCP `style` enum and description list the two ids. No `minCore` change, no migration.

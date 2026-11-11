## Announcement story: a new "Haunted" style / Story d'annonce : un nouveau style « Hantise »

*EN: fourteen styles now. Module touched: Announcement story 2.14.0. Nothing to set up, no new permission.*
*FR : quatorze styles désormais. Module touché : Story d'annonce 2.14.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: "Haunted".** A night investigation in a dark house: cold blue-grey fog, a flashlight cone in pale lamp yellow that sweeps and settles while the light flickers, faint orbs that drift and fade out, an evidence tag for the day and time, a handwritten-style title, a few LEDs like a field meter for the countdown, snapshots with a white border for the game and a notebook page for your sentence. Readable in 9:16 and 4:5, a still image for the last 22 %, the "Made with Curiosa" mention stays at the bottom. Works with "Show the day with the time" (the tag then holds the time alone) and with "My styles". An original design: nothing is taken from any game.
- **FR : « Hantise ».** Une enquête de nuit dans une maison sombre : brume froide bleu-gris, faisceau de lampe de poche jaune pâle qui balaie puis se fixe pendant que la lumière vacille, orbes pâles qui dérivent puis s'effacent, étiquette de preuve pour le jour et l'heure, titre façon écriture à la main, quelques voyants comme un appareil de mesure pour le compte à rebours, photos à bord blanc pour le jeu et page de carnet pour votre phrase. Lisible en 9:16 et en 4:5, image fixe sur les 22 % finaux, la mention « Made with Curiosa » reste en bas. Fonctionne avec « Afficher le jour avec l'heure » (l'étiquette ne porte alors que l'heure) et avec « Mes styles ». Une création originale : rien n'est repris d'un jeu.

### For developers

- `STYLES` has fourteen ids (`haunt`); `styleHaunt` in `scenes-extra.mjs` with its palette (cold blue-grey and pale lamp yellow, each taking a little of the site colours, always 4.5:1 on the ground; the paper of the tag carries dark ink); the MCP `style` enums and the variants white list follow `STYLES`. The handwriting stack is the one of the paper-collage style (a plain serif where the device has none). No `minCore` change, no migration.

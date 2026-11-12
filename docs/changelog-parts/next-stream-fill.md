## Planning: the "Next stream" element fills its frame / Planning : l'élément « Prochain stream » remplit son cadre

*EN: in OBS, "Next stream" no longer draws a card inside the panel: one single frame, content centred and filling it, text sized for a TV. Module touched: Planning 2.7.6.*
*FR : dans OBS, « Prochain stream » ne dessine plus une carte dans le panneau : un seul cadre, un contenu centré qui le remplit, un texte à la taille d'une télé. Module touché : Planning 2.7.6.*

### What changes for you / Ce qui change pour vous

- **EN: One frame instead of two.** The panel of the page style (background, border, corners) is the only one drawn; the content fills it, whatever its size.
- **FR : un cadre au lieu de deux.** Le panneau du style de la page (fond, bordure, angles) est seul dessiné ; le contenu le remplit, quelle que soit sa taille.
- **EN: Readable on a TV.** The smallest text is at least 24 px, the title and the time are bigger, and everything grows with the frame (720p, 1080p, 1440p, 3440x1440). In a very small frame, the lines of least use are dropped instead of shrinking the text.
- **FR : lisible sur une télé.** Le plus petit texte fait au moins 24 px, le titre et l'heure sont plus grands, et tout grandit avec le cadre (720p, 1080p, 1440p, 3440x1440). Dans un cadre très petit, les lignes les moins utiles disparaissent au lieu de rapetisser le texte.

### For developers

- **Planning 2.7.6**: `modules/planning/overlay.mjs` only (`NEXT_SIZES`, `NEXT_CSS`, class `pa-fill`, `#p.fill`). The "Week schedule" element and the public page appearances are unchanged. No manifest change, no data change.
- Tests: `tests/planning-overlay.test.mjs` (3 new tests).

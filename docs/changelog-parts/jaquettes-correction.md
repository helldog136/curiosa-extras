## Game covers 1.3.2: a corrected cover shows everywhere at once / Jaquettes de jeux 1.3.2 : une jaquette corrigée s'affiche partout aussitôt

*For Curiosa 0.6.0 or later. Module changed: Game covers 1.3.2. / Pour Curiosa 0.6.0 ou plus. Module touché : Jaquettes de jeux 1.3.2.*

### Corrections
- **A cover you correct replaces the old one everywhere, straight away** (Planning, Game suggestions, announcement story). Before, the old cover could stay on screen for hours or days after a correction, and some pages showed no cover at all. A failed attempt to renew the old image no longer blocks the one you chose, and the address of a cover now changes when its image changes, so browsers load the new one.
- **Une jaquette que vous corrigez remplace l'ancienne partout, tout de suite** (Planning, Suggestions de jeux, Story d'annonce). Avant, l'ancienne pouvait rester affichée des heures ou des jours après une correction, et certaines pages n'en montraient aucune. Un échec pour renouveler l'ancienne image ne bloque plus celle que vous avez choisie, et l'adresse d'une jaquette change maintenant quand son image change : les navigateurs chargent la nouvelle.
- **« Aucune jaquette » et « Tout oublier » retirent aussi l'image gardée** : une page qui connaissait encore l'ancienne adresse n'affiche plus l'ancienne jaquette.
- **The correction page now says whether the image is kept on your site** (copied, not copied yet, or failed with the reason in plain words), with a "Copy the image now" button. / **La page de correction dit si l'image est bien gardée sur votre site** (copiée, pas encore copiée, ou échec avec la raison en clair), avec un bouton « Copier l'image maintenant ».

### Pour les développeurs
- `cover` returns `/m/<key>/cover/<id>?v=<hash>`; the route serves `public, max-age<=3600` for the current version and `public, no-cache` + `ETag` (304) otherwise, and applies the owner's correction itself. Failure back-off and in-flight downloads are keyed by `id|source|path`; a correction forces its copy. Tests: `tests/game-covers-correction.test.mjs`.

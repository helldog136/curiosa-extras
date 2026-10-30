## Labyrinthe 3D 1.2.0 et Overlay alertes 1.2.0 : leurs éléments pour les pages d'overlay

*Pour Curiosa 0.5.0 ou plus. Modules touchés : Labyrinthe 3D 1.2.0, Overlay alertes 1.2.0.*

### Nouveautés

- **Le Labyrinthe 3D s'adapte au ratio de son cadre.** Dans la section « Overlays », l'élément « Labyrinthe 3D » accepte tous les cadres de 4:3 à 32:9. En plein écran 3440×1440 (21:9), il remplit le cadre : le champ de vision s'élargit sur les côtés, sans étirer les murs. En 16:9, l'image est celle d'avant.
- **L'Overlay alertes propose l'élément « Alertes ».** Il garde ses proportions, suit le style commun de la page d'overlay (texte, fond, arrondis) et garde la couleur d'accent, le style néon ou sobre et la durée réglés dans le module. Une option, « Alertes affichées », permet de séparer les alertes de la chaîne et les dons du direct en deux éléments.
- **Plusieurs pages d'overlay peuvent afficher les mêmes alertes en même temps.** Chaque page garde son propre repère : aucune ne vide la file des autres, et une page ouverte plus tard ne rejoue pas les anciennes alertes.
- Mode test : l'élément « Alertes » montre une alerte d'exemple.

### Rien ne change pour ce que vous aviez

- Les overlays actuels (même adresse, même page, mêmes réglages) sont servis octet pour octet comme avant. Les réglages de place et de taille propres au module sont ignorés dans une page d'overlay.
- La lecture du sujet `live.event` reste limitée à une toutes les 2 secondes par overlay, quel que soit le nombre de pages qui l'affichent.

### Pour les développeurs

- `minCore` 0.5.0 (clé `overlayElements`). Labyrinthe : `overlayElements.maze`, `fit: ratio`, `referenceHeight` 1080, `ratios` 1,33 à 3,56, `minSize` 640×360, `followsStyle: false`, aucune option ; moteur `followAspect` (`planeLength()`). Alertes : `overlayElements.alerts`, `fit: scale` 640×260, `demo`, option `kinds` ; route `feed` (repère par lecteur, journal de 100 alertes, lecture de 50 au plus), `pullLive` à vol unique par overlay.
- Les deux modules réutilisent leur overlay actuel : la page de l'élément est la même, repérée par les paramètres `ov-*` du cœur.
- Tests : `tests/overlay-elements-alerts.test.mjs`, `tests/overlay-elements-maze.test.mjs`, `tests/helpers/overlayPageDom.mjs`, `tests/fixtures/overlay-elements-golden.json` (empreintes de l'overlay d'avant). La CI « cœur publié » reste rouge tant que le cœur 0.5.0 n'est pas publié.

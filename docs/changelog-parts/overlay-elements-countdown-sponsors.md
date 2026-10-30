## Compte à rebours 1.1.0 et Overlay sponsors 1.1.0 : des éléments pour vos pages d'overlay

*Pour Curiosa 0.5.0 ou plus. Modules touchés : Compte à rebours 1.1.0, Overlay sponsors 1.1.0.*

### Nouveautés

- **Compte à rebours est proposé dans la section « Overlays »** : « Ajouter un élément » liste « Compte à rebours » avec le nom de chaque instance. Vous pouvez en placer plusieurs sur la même page d'overlay, chacun sur son propre événement.
- **Option « Événement »** : vide, c'est l'événement à la une ; sinon, le nom court d'un événement précis (visible dans « Modifier »). Un nom qui n'existe plus montre l'événement à la une, sans erreur. Option « Afficher les secondes » en plus.
- **Overlay sponsors est proposé sous le nom « Bandeau sponsors »**, avec le code promo et le QR code. Option « Afficher le QR code ».
- Les deux éléments gardent leurs proportions (elles se mettent à l'échelle avec le cadre), suivent le style commun de la page (texte clair ou sombre, fond, angles) et ont un contenu d'exemple en mode test.

### Améliorations

- **Rien ne change pour vos overlays actuels** : mêmes adresses, même rendu, mêmes réglages (style, place, taille, durée du message de fin, fréquence et durée du bandeau). Dans une page d'overlay, la place et la taille réglées dans le module sont ignorées : l'élément remplit le cadre que vous lui donnez.
- Plusieurs pages d'overlay peuvent montrer le même élément en même temps : rien n'est consommé à la lecture.

### Pour les développeurs

- `minCore` 0.5.0, version mineure en plus ; clé `overlayElements` dans les deux `module.json` (`countdown` : `scale` 600 × 200, options `event` (texte) et `seconds` ; `sponsors` : `scale` 720 × 180, option `qr`) et fonctions `overlayElements.<id>` qui répondent `/overlays/<clé>?lang=…` : l'overlay existant est réutilisé tel quel, il passe en « mode élément » quand l'adresse porte `ov-w` (jetons `--ov-*`, `data-ov-part`, `data-ov-region`, jamais le thème ni le skin du site). Aucun secret `?k=` : ces overlays n'en ont pas.
- Compte à rebours : `pickForElement` (repli sur la une pour un nom inconnu), route `state` avec `el=1` / `demo=1`. Overlay sponsors : route `items` avec `demo=1` (carte d'exemple).
- Tests : `tests/overlay-elements-countdown-sponsors.test.mjs` (déclaration, parité FR/EN, page de l'élément, option événement, `assertMultiReaders`) ; `tests/overlay-elements-regression.test.mjs` (empreintes de l'overlay actuel, prises avant les éléments) ; `tests/countdown.test.mjs` ajusté (version, `minCore`).

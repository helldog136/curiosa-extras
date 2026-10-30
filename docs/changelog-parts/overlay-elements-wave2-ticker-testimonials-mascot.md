## Overlay défilant 1.1.0, Témoignages 1.1.0 et Mascotte 1.1.0 : des éléments pour vos pages d'overlay

*Pour Curiosa 0.5.0 ou plus. Modules touchés : Overlay défilant 1.1.0, Témoignages 1.1.0, Mascotte 1.1.0.*

### Nouveautés

- **Bandeau défilant.** « Ajouter un élément » propose un bandeau d'annonces et de codes promo à placer en bas du stream : une carte à la fois (celles de vos autres modules), qui change toutes les quelques secondes. Il garde ses proportions quand vous le redimensionnez. Option « Quoi montrer » (tout, codes promo seulement, annonces et articles seulement : pratique pour avoir deux bandeaux) et option « Montrer les images ». La durée par carte reste celle réglée dans le module.
- **Avis de la communauté.** Un avis déjà publié sur votre site s'affiche à tour de rôle, avec le prénom ou pseudo et les étoiles. Le cadre s'adapte à la taille que vous lui donnez. **Seuls les avis publics sont montrés** (validés par vous, avec l'accord de la personne qui les a écrits) : jamais une adresse e-mail, un lien privé, un avis en attente ou refusé. Options « Secondes par avis » et « Nombre d'avis » ; l'ordre est celui choisi dans le module.
- **Mascotte (version réduite).** Un petit personnage qui dit bonjour, donne une astuce ou annonce une nouveauté, avec le nom et le dessin (ou l'image) choisis dans le module. Un cadre d'overlay n'est pas une page de site : le coin de la page, les pages concernées, le délai, la limite par jour, les boutons fermer / réduire / couper et la mémoire du navigateur n'existent pas ici. **À l'écran de stream, les phrases viennent uniquement de ce que vous avez écrit pour la mascotte** (vos phrases publiées, avec le nom du site et le nom de la mascotte) : jamais le prochain événement, le direct en cours, les nouveautés ni les suggestions d'autres modules. Mascotte en brouillon : cadre vide. Option « Secondes par phrase ».
- Les trois éléments suivent le style commun de la page d'overlay (texte clair ou sombre, fond, angles), ne prennent jamais le style de votre site et ont un contenu d'exemple en mode test, qui n'apparaît que s'il n'y a rien de vrai à montrer.

### Améliorations

- **Rien ne change pour ce que vous aviez** : l'overlay défilant, les pages de Témoignages, l'accueil, les adresses, les réglages, les outils pour l'assistant IA et la mascotte de votre site sont identiques, octet pour octet (la place, la taille et les couleurs réglées dans un module sont ignorées dans une page d'overlay).
- Plusieurs pages d'overlay peuvent montrer le même élément en même temps sans alourdir votre site : une seule lecture (de vos cartes, de vos avis, de vos phrases) sert tout le monde pendant quelques dizaines de secondes, l'élément montré au même instant est le même partout (déduit de l'heure), rien n'est consommé à la lecture et rien ne tourne en arrière-plan. Les pages se mettent à jour doucement, de plus en plus lentement quand rien ne change.
- Aucune migration, aucun nouveau réglage dans les modules.

### Pour les développeurs

- `minCore` 0.5.0, version mineure en plus ; clé `overlayElements` dans les trois `module.json` et fonctions `overlayElements.<id>` : `banner` (`ticker-overlay`, `scale` 640 × 140, options `show` et `image`, réutilise l'overlay existant, qui passe en « mode élément » quand l'adresse porte `ov-w`), `reviews` (`testimonials`, `fluid`, ratios 0,8 à 6, minimum 320 × 140, options `seconds` et `count`, route `element/:slug`, fichier `overlay.mjs`), `mascot` (`mascot`, `scale` 440 × 320, option `seconds`, route `element/:slug`, fichier `overlay.mjs`). Aucun secret : aucun de ces éléments n'en a besoin.
- Multi-lecteurs : le repère est l'heure (créneau = heure / durée, élément = liste[créneau % taille]), pas de file ; lecture partagée à vol unique, gardée 30 s (`ELEMENT_CACHE`, `CACHE`). Mascotte : `ownLines` est la seule source des phrases de l'élément (aucun service, aucun sujet d'un autre module n'est interrogé ; test de confidentialité).
- Overlay défilant : `locales/fr.json` et `en.json` (exemple du mode test) ; route `items` avec `el=1` (genre de carte, filtre) et `demo=1` ; la route sans `el` est inchangée. Mascotte : `VERSION` d'`assets.mjs` 1.1.0.
- Tests : `tests/overlay-elements-wave2.test.mjs` (déclaration, parité FR/EN, pages des éléments, options, mode test, visibilité et confidentialité, lecture partagée, rotation synchronisée, `assertMultiReaders`) avec `tests/helpers/elementPageDom.mjs` (navigateur factice) ; `tests/overlay-elements-wave2-regression.test.mjs` (empreintes prises sur 363a6e5, avant les éléments) ; versions ajustées dans `testimonials.test.mjs`, `ticker-overlay.test.mjs`, `tabs-modules.test.mjs`.
- **Attention à la publication** : ces modules demandent Curiosa 0.5.0 (publié).
- **Assemblage** : `package.json` 1.27.0, `catalogue/index.json` régénéré (refs `v1.27.0`).

## Éléments d'overlay : Planning et Statistiques de la communauté

*Deux modules proposent des éléments aux pages d'overlay de Curiosa 0.5.0. Pour Curiosa 0.5.0 ou plus. Modules touchés : Planning 2.5.0, Statistiques de la communauté 1.2.0.*

### Nouveautés
- **Planning de la semaine** : vos prochains streams jour par jour (grille sur sept jours si le cadre est large, liste s'il est étroit ; taille minimale 480 × 280). Options : apparence (selon la place, semaine en grille, liste classique, liste en alternance, timeline, affiches), nombre de jours (1 à 14), jaquettes.
- **Prochain stream** : le prochain stream en grand, avec en option les 5 suivants (taille minimale 320 × 160) et les jaquettes.
- **Compteurs** (Statistiques de la communauté) : followers, abonnements payants, publications, vues, et leur évolution sur la semaine ou le mois. Options : quels compteurs afficher (parmi ceux que vous montrez déjà), évolution.
- **Rien n'est montré sans votre accord** : seuls les chiffres marqués « Montrer sur mon site » apparaissent, jamais plus ; un chiffre privé n'apparaît ni dans la page, ni dans sa mise à jour, ni en mode test.

### Améliorations
- Fond transparent, style commun de la page d'overlay suivi (jetons `--ov-*`), jamais le style du site, aucun lien ni bouton, aucun secret (ces données sont déjà publiques).
- Plusieurs pages d'overlay, une seule lecture partagée (45 s pour le Planning, 30 s pour les compteurs) ; mise à jour douce côté page (de plus en plus lente, bornée), aucune tâche de fond.
- Rien ne change pour la page du planning, l'accueil, l'image de la semaine, l'administration, l'assistant IA, les réglages et les adresses.

### Pour les développeurs
- **Planning 2.5.0** : `minCore` 0.5.0 ; fichier `overlay.mjs` (lecture partagée `sharedSlots`, `renderContent` pur qui réutilise `buildModel` et les apparences, `elementResponse`) ; `index.mjs` : `overlayElements`, route `element/:slug` (`?frag=1` : contenu + empreinte), `loadSlots` rend aussi `failed`. Les variables `--v-*` des apparences sont déduites des jetons `--ov-*` sur la page de l'élément ; le skin du site n'est jamais chargé.
- **Statistiques de la communauté 1.2.0** : `minCore` 0.5.0 ; nouveau droit `routes` ; `overlay.mjs` ; `publicRead.mjs` : `isShowable` (règle unique) et `publicStats`, `readPublic` inchangé.
- Tests : `tests/planning-overlay.test.mjs`, `tests/community-stats-overlay.test.mjs` (manifeste, kit `overlay.elements`, trois cadres, options, accord, multi-lecteurs `assertMultiReaders`, charge bornée, mise à jour douce, non-régression) ; `tests/helpers/overlayNonReg.mjs` et `tests/golden/*-1.25.0.json` (produits avec le dépôt 1.25.0) ; versions ajustées dans `rawg-covers`, `planning-appearances`, `planning-migration`, `game-covers-consumers`, `community-stats`.

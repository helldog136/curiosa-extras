## Éléments d'overlay (seconde vague) : Suggestions de jeux et Mur des remerciements

*Deux modules proposent des éléments aux pages d'overlay de Curiosa 0.5.0. Pour Curiosa 0.5.0 ou plus. Modules touchés : Suggestions de jeux 1.6.0, Mur des remerciements 1.2.0.*

### Nouveautés
- **Top des jeux proposés** (Suggestions de jeux) : pendant un segment « on joue à quoi après ? », les jeux les plus proposés ou les plus votés, avec leur rang. Options : nombre de jeux (1 à 10, 3 par défaut) et quels jeux (proposés, planifiés, acceptés, déjà joués, finis). Les jeux de même nom sont regroupés ; « déjà joués » classe par votes « rejoue-le ».
- **Remerciements** (Mur des remerciements) : les dernières personnes à remercier, qui défilent (vers le haut dans un cadre haut, vers la gauche dans un bandeau). Options : groupe (tous ou l'un des groupes du mur), nombre de personnes (1 à 30, 10 par défaut), faire défiler, montrer le petit mot.
- **Rien de plus que ce que montre déjà votre site** : le Top ne montre que le nom du jeu, ses propositions et ses votes (jamais un pseudo, une note, une jaquette ni un jeu rejeté) ; les Remerciements viennent de la même lecture que le mur public (catégorie « Ne pas montrer » respectée, fiches à relire écartées, même choix de nom) et n'ont aucune photo.

### Améliorations
- Les deux éléments s'adaptent à la taille du cadre, suivent le style commun de la page d'overlay (jetons `--ov-*`), ne prennent jamais le style du site et ont un contenu d'exemple en mode test ; sans rien à montrer, le cadre reste vide en direct.
- Plusieurs pages d'overlay peuvent montrer le même élément : une seule lecture (30 secondes pour le Top, la lecture du mur pour les Remerciements) sert tout le monde ; rien n'est consommé à la lecture, aucune tâche de fond.
- Rien ne change pour la page des suggestions, le vote, la suggestion, le mur public, l'administration, l'assistant IA, les réglages et les adresses (vérifié octet pour octet).
- **Soutiens** n'a rien à ajouter : il alimente déjà le mur par la catégorie de Contacts de votre choix, et les Remerciements lisent ce mur.

### Pour les développeurs
- **Suggestions de jeux 1.6.0** : `minCore` 0.5.0 ; `overlay.mjs` (`rank`, `sharedRanking`, `renderContent` pur, `elementResponse`) ; `index.mjs` : `overlayElements.top`, route `element/:slug`, `publicRows` (une seule définition du « public », partagée avec la page). Élément `top` : `fluid`, minimum 240 × 100, ratios 0,4 à 8.
- **Mur des remerciements 1.2.0** : `minCore` 0.5.0 ; nouveau droit `routes` ; `overlay.mjs` (réutilise `getWall`, `displayOf`, `readData` ; `pick`, `renderContent`, `elementResponse`) ; élément `thanks` : `fluid`, minimum 200 × 80, ratios 0,3 à 10.
- Tests : `tests/overlay-elements-games.test.mjs`, `tests/overlay-elements-thanks.test.mjs` (manifeste, kit `overlay.elements`, rien de plus que le public, trois cadres, options, multi-lecteurs `assertMultiReaders`, charge bornée, mise à jour douce), `tests/overlay-elements-wave2-regression.test.mjs` avec `tests/helpers/overlayNonRegWave2.mjs` et `tests/golden/*-1.5.1.json` / `*-1.0.2.json` (produits avec le dépôt 1.26.0, avant toute modification) ; versions ajustées dans `rawg-covers`, `rawg-wrong-cover`, `game-covers-consumers`, `game-suggestions-add`, `tabs-modules`.

## Sondages 1.3.0 et Ma Chaîne Twitch 2.2.0 : des éléments pour vos pages d'overlay

*Pour Curiosa 0.5.0 ou plus (les pages d'overlay arrivent avec le cœur 0.5.0). Modules touchés : Sondages 1.3.0, Ma Chaîne Twitch 2.2.0.*

### Nouveautés
- **Sondages : l'élément « Sondage en direct ».** Dans la section « Overlays » de l'administration, vous pouvez poser les résultats d'un sondage où vous voulez dans une page d'overlay. Le contenu **s'adapte à la taille du cadre** (empilé dans un cadre haut, question à gauche et choix à droite dans un cadre large) et suit le style commun de la page. Une option, « Quel sondage » : vide, il montre ce que montre l'écran en direct ; sinon un sondage précis, et s'il n'existe plus c'est le choix automatique qui s'affiche.
- **Ma Chaîne Twitch : deux éléments.** « Followers et abonnements » montre vos chiffres en grand, « Pastille En direct » montre une pastille quand vous diffusez (le jeu et « Hors ligne » en option). **Rien n'est montré que vous n'avez pas autorisé** : les chiffres suivent vos réglages (« Suivre mes statistiques », « Compter mes followers », « Compter mes abonnements payants »), même dans le mode test. Un chiffre que Twitch ne donne pas manque, sans message dans le direct et sans valeur inventée.
- **Plusieurs pages, plusieurs fois, en même temps** : un même élément peut figurer dans plusieurs pages d'overlay ; chacun lit de son côté, aucun ne prive les autres, et Twitch n'est pas plus sollicité.
- **Mode test** : ces éléments montrent un sondage d'exemple, des chiffres d'exemple et une pastille d'exemple.

### Améliorations
- Rien ne change pour ce que vous aviez : la source OBS actuelle de Sondages garde son adresse, son rendu (identique au pixel près) et ses réglages. Ma Chaîne Twitch n'a toujours pas d'overlay à elle ; ses éléments n'existent que dans les pages d'overlay.
- Aucune migration, aucun nouveau droit, aucun nouveau réglage.

### Pour les développeurs
- `polls` 1.3.0 et `twitch-channel` 2.2.0 : `minCore` 0.5.0 (clé `overlayElements`), `apiVersion` 2 inchangé, aucune migration. Sondages : `overlayElements.poll` répond l'adresse de l'overlay actuel (secret ajouté côté serveur) ; mode élément de `overlay()` (jetons `--ov-*`, `data-ov-part`, police ajustée au cadre) ; option `opt-poll` lue comme `want=` par la route `live` (repli) ; `poll=` reste strict. Ma Chaîne Twitch : fichier `overlay.mjs`, routes `element/:slug` et `element-data/:slug` protégées par un secret propre au module (collection `twitchElementKey`).
- Tests : `tests/polls-overlay-element.test.mjs` et `tests/twitch-overlay-elements.test.mjs` (nouveaux : manifeste, adresse, page, options, repli, droits de visibilité, `assertMultiReaders`, mise à jour douce avec Participation, non-régression) ; versions ajustées dans `polls.test.mjs`, `polls-delete.test.mjs`, `twitch-channel*.test.mjs`, `tabs-modules.test.mjs`.
- Attention : la CI « cœur publié » reste rouge tant que le cœur 0.5.0 n'est pas publié (`minCore` 0.5.0).

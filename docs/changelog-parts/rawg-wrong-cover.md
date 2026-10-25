## Jaquettes : « Ce n'est pas le bon jeu ? »

*Un lien discret, dans l'administration, pour corriger une jaquette douteuse. Pour Curiosa 0.2.10 ou plus. Modules touchés : Planning 2.3.0, Story d'annonce 2.3.0, Suggestions de jeux 1.3.0.*

### Améliorations

- **Un lien « Ce n'est pas le bon jeu ? » à côté des jaquettes douteuses.** Quand le site n'est pas sûr du jeu trouvé, l'administration du Planning et celle des Suggestions de jeux listent ce jeu avec ce lien. Il ouvre directement l'écran de correction du site, déjà sur le bon titre : vous choisissez le bon jeu en deux clics.
- **Dans la Story d'annonce, vous êtes prévenu avant de fabriquer la vidéo** : une petite phrase au-dessus du bouton « Générer la vidéo » dit que la jaquette est peut-être celle d'un autre jeu, avec le même lien (il s'ouvre dans un nouvel onglet, votre travail reste là). La vidéo n'est jamais bloquée.
- **Les Suggestions de jeux se mettent à jour après votre correction** : en rouvrant l'administration, la bonne jaquette remplace l'ancienne.
- **Les visiteurs ne voient jamais ce lien.** Rien ne change sur les pages publiques.

### Pour les développeurs

- `ctx.api.rawg.cover(titre)` : les modules lisent `ambiguous` et `name` (facultatifs, cœur 0.2.10), d'où `minCore` 0.2.10 pour Planning, Story d'annonce et Suggestions de jeux. Lien : `/admin/settings/rawg-covers?titre=` + `encodeURIComponent(titre)` (en Markdown, `! ' ( ) *` sont aussi encodés), avec le **même titre** que celui passé à `cover`.
- Planning : `coverFor` ajoute `ambiguous` et `name` seulement quand `ambiguous` est vrai ; `coversForSlots` renvoie en plus `ambiguous` (Map nom vers jeu trouvé) ; `wrongCoverHref` exporté.
- Story d'annonce : la route `cover` (`coverOf`) renvoie en plus `title`, `ambiguous`, `found` ; l'éditeur affiche `#cover-warn` (clés `ui_cover_ambiguous`, `ui_cover_ambiguous_named`, `ui_cover_wrong`), lien en `target="_blank" rel="noopener"`.
- Suggestions de jeux : la suggestion garde `coverAmbiguous: true` ; `refreshAmbiguous(ctx, list)` redemande au cœur (10 titres au plus) à l'ouverture de l'admin et remplace la jaquette quand la réponse n'est plus ambiguë ; `wrongCoverHref` exporté.

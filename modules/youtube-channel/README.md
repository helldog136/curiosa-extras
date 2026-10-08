# Chaîne YouTube — module communautaire de Curiosa

- **Vidéo mise en avant** (section d'accueil) : la plus vue des vidéos de moins de N jours (30 par défaut), Shorts exclus sauf réglage. La vignette renvoie vers YouTube : on n'intègre **pas** le lecteur, car YouTube compte un lecteur affiché comme une vue.
- **Flux RSS, annonces Discord, overlay labyrinthe** : les vidéos (hors Shorts) sont proposées aux autres modules via les sujets `feed.item` (rubrique `video`) et `maze.poster`. Le module ne connaît aucun consommateur.
- **Réglages** : identifiant de chaîne (`UC…`) suffit (flux public, ~15 vidéos). Une clé d'API (facultative) donne les durées exactes et la détection des Shorts ; sans clé, un test à la première apparition détermine si une vidéo est un Short.
- Cache de 10 minutes.

# Carte

Une page qui montre vos lieux utiles (studios, bonnes adresses, événements…) : d'abord une **liste** claire, avec des filtres par type et une recherche ; puis, si le visiteur le demande, une **carte** OpenStreetMap et un bouton **« Près de moi »**.

## Ce que voit le visiteur

- La liste des lieux, toujours là (elle marche sans JavaScript et avec un lecteur d'écran) : nom, type, adresse, description, horaires, lien du site, lien « Itinéraire » (nouvelle fenêtre).
- Des filtres par type et une recherche sans accents ni majuscules.
- Un bouton **« Afficher la carte »**. Tant qu'il n'a pas cliqué, rien n'est demandé à OpenStreetMap. La carte se déplace au doigt, à la souris et au clavier, se zoome (boutons, molette, pincement), regroupe les lieux proches et affiche la mention OpenStreetMap.
- Un bouton **« Près de moi »** : le navigateur demande l'autorisation, calcule les distances sur l'appareil et trie les lieux (rayon 5, 20, 50 ou 100 km). La position n'est jamais envoyée au site ni gardée. S'il refuse, il choisit une ville de votre liste ou tape ses coordonnées.

## Ce que vous faites

1. Installez : la page `/map` existe, avec deux types de départ (Lieu, Événement).
2. Onglet **Mes lieux** : écrivez le nom, collez un **lien de carte** (Google Maps, OpenStreetMap, Plans…) : la position est lue toute seule. Sans lien, écrivez la latitude et la longitude. Cochez « Publié » pour montrer le lieu.
3. Onglet **Types et import** : choisissez un jeu de départ (neutre, collectif, créateur seul, boutique), renommez les types, ajoutez des villes pour « Près de moi », importez un fichier CSV (500 lignes à la fois, avec compte rendu et reprise) ou téléchargez vos lieux.
4. Les lieux publiés par d'autres parties du site (événements, annuaire…) apparaissent d'eux-mêmes avec une pastille « Via … » ; vous pouvez les masquer un par un, sans rien changer chez eux.

## Réglages

Introduction, mots du site (« lieu / lieux », « studio / studios »…), texte des boutons, ordre de la liste, application d'itinéraire (OpenStreetMap, Google Maps, Plans), afficher ou non la carte et « Près de moi », lieux venant d'ailleurs, événements passés, lien en pied de page. Plusieurs cartes sont possibles (carte des studios, carte des événements).

## Limites

- Pas de recherche d'adresse automatique : la position vient d'un lien de carte ou de nombres. Un lien raccourci (maps.app.goo.gl…) doit d'abord être ouvert pour copier l'adresse complète.
- Au plus 5000 lieux saisis, 200 lieux venant d'autres parties du site, 200 marqueurs affichés avant regroupement.
- Pas d'alerte envoyée au visiteur (idée pour plus tard).
- Le module déclare la permission `visitor.geolocation` (cœur 0.2.12 ou plus) : le cœur n'ouvre alors la position (`Permissions-Policy: geolocation=(self)`) que sur les sites où le module est installé. Sans cette permission le navigateur refuse la position, même après le clic ; « Près de moi » propose alors les villes et les coordonnées (voir `docs/ideas/map.md`).
- Les fonds de carte sont ceux d'OpenStreetMap, gratuits et sans clé, à usage raisonnable.

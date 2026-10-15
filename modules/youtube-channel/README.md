# Chaîne YouTube — module communautaire de Curiosa

- **Vidéo mise en avant** (section d'accueil) : la plus vue des vidéos de moins de N jours (30 par défaut), Shorts exclus sauf réglage. La vignette renvoie vers YouTube : on n'intègre **pas** le lecteur, car YouTube compte un lecteur affiché comme une vue.
- **Flux RSS, annonces Discord, overlay labyrinthe** : les vidéos (hors Shorts) sont proposées aux autres modules via les sujets `feed.item` (rubrique `video`) et `maze.poster`. Le module ne connaît aucun consommateur.
- **Réglages** : identifiant de chaîne (`UC…`) suffit (flux public, ~15 vidéos). Une clé d'API (facultative) donne les durées exactes et la détection des Shorts ; sans clé, un test à la première apparition détermine si une vidéo est un Short.
- Cache de 10 minutes.

## Statistiques : abonnés, vidéos, vues

Cochez **Suivre mes statistiques** (désactivé par défaut : il demande une clé YouTube) pour que le site tienne à jour le nombre de vos **abonnés**, de vos **vidéos** et de vos **vues**. Le module les publie (sujet `social.stat`) ; un autre module les collecte et garde l'historique.

- **Ce qui est lu** : une seule demande à YouTube (`channels.list`, partie `statistics`) avec la clé YouTube du module, gardée 10 minutes (1 unité de quota sur les 10 000 par jour). Rien d'autre n'est lu, rien n'est stocké.
- **Les abonnés sont arrondis par YouTube** : il ne donne que 3 chiffres significatifs (1 234 567 devient 1 230 000, 8 421 devient 8 420). Les vidéos et les vues sont exactes. Pour de petites chaînes l'arrondi ne se voit pas.
- **Si ça ne marche pas** (le panneau du module le dit en mots simples) :
  - *« Ajoutez votre clé YouTube dans Réglages »* : sans clé, rien n'est suivi ; le reste du module (vidéo mise en avant, flux, bouton) fonctionne comme avant. La clé est gratuite : console.cloud.google.com → créer un projet → activer « YouTube Data v3 » → créer une clé.
  - *« La clé YouTube est refusée »* : la clé est fausse, le service « YouTube Data v3 » n'est pas activé pour elle, ou elle est restreinte à d'autres adresses.
  - *« YouTube cache votre nombre d'abonnés »* : la chaîne a masqué son compteur. Rendez-le public dans YouTube Studio ; les vidéos et les vues continuent d'être suivies. Jamais de chiffre inventé : le compteur reste « caché » tant que YouTube ne le donne pas.
  - *« YouTube a atteint sa limite de demandes »* : le quota du jour est épuisé (une clé partagée avec d'autres usages), cela reprend tout seul.
- La clé n'est jamais affichée ni écrite dans un journal ; elle ne sert qu'à l'adresse de l'appel vers YouTube.


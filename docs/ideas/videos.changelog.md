# Vidéothèque 1.0.0

## Nouveautés
- Une page de vidéos prête à l'emploi : grille avec miniatures, catégories, recherche, « Voir plus ».
- Vous collez l'adresse d'une vidéo YouTube : le titre et la miniature se remplissent tout seuls. Plusieurs adresses d'un coup (100 au plus) avec un aperçu avant l'ajout.
- Le lecteur ne se charge qu'après un clic du visiteur : avant, son navigateur ne contacte jamais YouTube.
- Des séries à regarder dans l'ordre, avec un bouton « Suivant ».
- Description, transcription repliable, lien vers l'album photo de l'événement, liens de partage.
- Un modèle de départ (« Masterclass, Rétrospectives, Tutoriels » ou « Vide »), un vocabulaire réglable (« Replays », « Formations »…).
- Votre assistant IA peut lister, ajouter (en brouillon) et corriger vos brouillons ; il ne publie jamais.

## Améliorations
- Si YouTube ne répond pas, le formulaire vous demande d'écrire le titre : rien n'est perdu.
- Erreurs sous le champ, avec un exemple ; tout fonctionne au doigt sur téléphone, sans défilement de côté.
- Aucun cookie, rien n'est gardé sur vos visiteurs.

## Pour les développeurs
- Module à code (`type: content` pour le rangement du menu), `minCore` 0.2.6 (script de page), onglets « Mes vidéos » et « Catégories, séries ».
- Fichiers : `pure.mjs`, `providers.mjs` (table de fournisseurs : YouTube), `data.mjs`, `ops.mjs`, `view.mjs`, `routes.mjs` (`thumb`, `find`), `admin.mjs`, `mcp.mjs`, `service.mjs`, `albums.mjs`, `scripts/videos.js`. Imports de voisins avec `?v=` (test de mise à jour à chaud).
- Offre `videos.library` v1 (`each`, `readOnly: list, get`) ; consomme `gallery.albums` (facultatif). Faux fournisseur `tests/helpers/fakeVideos.mjs`.
- Adresses de page : `/c/<catégorie>/s/<mots>/after/<curseur>`, `/v/<n>[-titre][/in/<p>][/play]`, `/p/<p>` (une page de module ne reçoit pas de paramètres de requête).
- Réseau : titres par `ctx.api.net` (oEmbed, 5 s) ; image de miniature par un `fetch` très serré (le client du cœur ne rend pas d'octets), seulement depuis l'administration.
- Tests : `videos-address`, `videos-public`, `videos-routes`, `videos-admin`, `videos-mcp`, `videos-service`, `videos-albums`, `videos-update`, `videos-scale`, `videos-privacy` ; aides `videosKit.mjs`, `fakeVideos.mjs`.

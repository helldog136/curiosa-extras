# Galeries photos 1.0.0

## Nouveautés
- Des albums de photos pour votre site : liste d'albums (couvertures, 12 par page), page d'album avec miniatures qui se chargent au fil du défilement, visionneuse plein écran.
- Les photos sont des fichiers du site (envoi d'images du site, sauvegardes comprises), dans des limites que vous réglez, ou une carte mène vers l'album d'un autre service (avec une phrase claire : « vous quittez ce site »).
- Un lien pour chaque photo, mention de consentement et lien « Demander le retrait d'une photo » ; un clic sur « Masquer la photo » la retire du site.
- Trois points de départ en un clic : Rétrospectives, Portfolio, Vide.
- Plusieurs galeries possibles (portfolio, événements), chacune avec ses réglages.
- Un assistant IA peut lister, créer un album en brouillon, ajouter une photo par adresse (masquée) et masquer une photo ; il ne publie jamais.

## Améliorations
- Envoi de plusieurs photos d'un coup, avec une barre de progression par photo et les erreurs écrites sous chaque fichier ; jamais de glisser-déposer obligatoire.
- Les photos sont réduites sur votre appareil, et les informations cachées (position GPS, appareil, date) sont retirées deux fois : par le navigateur, puis par la version propre que le site fabrique pour les pages publiques.
- Visionneuse accessible : flèches et Échap, balayage au doigt, gros boutons précédente / suivante, mouvement réduit respecté, retour du téléphone qui la ferme.
- Rappel d'accessibilité : les photos sans description sont signalées.

## Pour les développeurs
- Module à code, `minCore` 0.2.6 (script de page), onglets « Mes albums » et « Retraits ». Fichiers : `text`, `images`, `data`, `ops`, `view`, `routes`, `admin`, `mcp`, `service` (`.mjs`), `scripts/gallery.js`, `scripts/gallery-studio.js`. Tous les voisins sont importés avec la version (test de mise à jour à chaud).
- Stockage : le module réutilise l'envoi d'images du cœur (`POST /api/admin/upload`, fichiers `/uploads/…` sauvegardés avec le site) ; il ne garde que les adresses. La page `/…/studio/<album>` ré-encode chaque photo dans le navigateur (plus d'EXIF), l'envoie une par une, puis appelle l'action `addPhoto` (champs texte). Les pages publiques n'utilisent que `?c=o_1_0.5_0.5_ffffff` (version fabriquée par le cœur, sans métadonnées). Aucune route d'image, aucune bibliothèque, aucun accès aux fichiers.
- Limite du cœur : un module ne peut pas effacer un fichier envoyé ; retirer une photo la retire des pages, le fichier reste sur le disque (documenté, dit avant confirmation). Lot proposé : `ctx.api.files` (remove + quota).
- Service `gallery.albums` v1 (`each`, lecture seule) : `list`, `get`. Faux fournisseur : `tests/helpers/fakeGallery.mjs`.
- Outils MCP : `gallery_albums_list`, `gallery_photos_list` (lecture), `gallery_album_create`, `gallery_photo_add_url`, `gallery_photo_hide` (écritures éteintes d'office).
- Tests : `tests/gallery-*.test.mjs`, aides `galleryKit.mjs`, `galleryImages.mjs`, `fakeGallery.mjs`.

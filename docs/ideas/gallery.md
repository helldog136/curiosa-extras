# Galeries photos (`gallery`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.6, licence et auteur comme les autres modules. Type déclaré `content` (rangement sous « Mon contenu »), sans bloc `content` : module à code.

## Le problème

Une association ou une créatrice veut montrer des albums (rétrospectives d'événements, portfolio, coulisses) sans imposer de service tiers (cookies, règles sur les photos de personnes). Décision de la propriétaire : **hébergement borné sur le site** + **lien vers un album externe** pour les gros albums.

## Stockage : le mécanisme d'envoi d'images du cœur

Décision de la propriétaire : le module **réutilise l'envoi d'images du cœur** (0.2.9) et ne garde aucun octet d'image.
- **Envoi** : la page `/<chemin>/studio/<album>` (script de page du cœur 0.2.6, `scripts/gallery-studio.js`) réduit et ré-encode chaque photo dans le navigateur (canvas : EXIF, GPS, XMP, date disparaissent d'office), fabrique une miniature de 480 px, puis envoie les deux fichiers **un par un** à `POST /api/admin/upload` (champ `file`, connexion et accès à l'administration exigés par le cœur, signature PNG/JPEG/WebP/GIF vérifiée, 5 Mo au plus, SVG refusé), avec progression (XMLHttpRequest) et erreur sous chaque fichier. Puis il appelle l'action `addPhoto` (route du cœur des actions : même site, connexion, droit `edit`) avec des **champs texte seulement** : les deux adresses `/uploads/<uuid>.jpg` et les tailles annoncées. Le module ne garde que ces adresses (plus de `gallery_blobs`, plus de base64, plus de route d'image, plus de `images.mjs`).
- **Ce que le cœur sert** : l'original **tel quel** (`/uploads/x.jpg`, EXIF présent si le navigateur n'avait pas ré-encodé) ou, avec `?c=<cadrage>`, une version fabriquée par `sharp` (`core/imageDerive.ts`), orientation appliquée et **toutes les métadonnées retirées**, mise en cache (`data/cache/crops`, hors sauvegarde, refabriquée seule) ; si `sharp` manque ou refuse, l'original est servi (l'image s'affiche toujours). Les pages publiques, le service `gallery.albums` et les données structurées utilisent donc **toujours** `?c=o_1_0.5_0.5_ffffff` (ratio d'origine, zoom 1, sans rognage) : version propre, taille bornée à 1 600 px. Le ré-encodage du navigateur reste la première défense (l'original ne contient alors rien) ; la version fabriquée est la seconde. Limite : si quelqu'un ouvre l'adresse sans `?c=`, il reçoit l'original (propre si l'envoi a passé par la page d'envoi).
- **Vérification côté module** : un module n'a aucun accès aux fichiers (`code.noDanger` interdit le disque, aucune API ne lit `/uploads`) : il ne peut ni mesurer ni relire un fichier. Il vérifie la **forme** des adresses (`/uploads/<uuid>.jpg|png|webp`, jamais un GIF, un SVG ou un autre site), rogne les tailles annoncées, refuse les doublons et applique ses bornes sur les **nombres** (photos par album, albums, photos sur le site). Le type et la taille sont ceux que le cœur a déjà vérifiés.
- **Suppression** (module 1.1.0, cœur 0.2.13, permission `files`) : à l'envoi, `addUploadedPhoto` **revendique** (`ctx.api.files.claim`) l'original ET la miniature juste après l'envoi (fenêtre de 30 minutes, même personne, depuis l'action `addPhoto`) ; si l'un est refusé (`expired`, `taken`, `not-uploader`, `quota`, `unknown`, `invalid`, `missing`, `no-person`, `no-permission`), aucune photo n'est créée, un fichier déjà revendiqué est rendu, et la phrase simple (FR+EN) s'écrit sous le fichier concerné dans la page d'envoi. Un fichier déjà gardé par une autre photo du module est un doublon (jamais supprimé par la tentative). `deletePhoto` retire d'abord la photo des données, puis `files.remove` de l'original et de la miniature ; `deleteAlbum` retire l'album, la liste, puis les fichiers de toutes les photos et de la couverture, par lots de 8 au plus, sans minuteur. « Masquer » ne supprime rien. **Anciennes photos** (avant 0.2.13) : `owns` rend faux, `remove` rendrait `removed:false` ; le module ne l'appelle pas, l'accepte sans erreur et le dit à l'écran (note sur la fiche de la photo, phrase après la suppression, nombre de fichiers gardés pour un album). Un refus de suppression du cœur (`failed`) est compté et dit, la photo a déjà quitté l'album. Les adresses restent aléatoires (UUID) et jamais écrites sur les pages sans `?c=`. L'état de santé du site (`upload_missing`) ne signale rien de particulier.
- **Un brouillon n'est pas secret au niveau du fichier** : ses images sont servies par le cœur à qui connaît l'adresse (l'aperçu est protégé par une clé, pas les fichiers).
- **Lot du cœur proposé (reste)** : un envoi multi-fichiers avec progression dans le panneau d'administration, et une miniature fabriquée par le cœur (`?c=` ne permet pas de taille choisie : la « miniature » est donc un second fichier de 480 px envoyé par le navigateur).

## Ce que voit le visiteur

Liste (12 par page, cartes), album (miniatures `loading="lazy"` avec dimensions, légendes, description, mention de consentement, lien « Demander le retrait d'une photo », lien « voir toutes les photos » vers un autre service), page de photo partageable (sans JavaScript : précédente, suivante, retour), visionneuse (`dialog`, flèches, Échap, Début/Fin, balayage, compteur, légende, copie du lien, partage natif si disponible, boutons précédent/suivant de 56 px, retour téléphone, focus rendu, mouvement réduit), carte d'album externe avec « Ce lien ouvre … dans un nouvel onglet : vous quittez ce site ». Aperçu privé d'un brouillon par lien secret. Accueil : section « Les derniers albums ». ImageGallery facultatif (éteint d'office).

## Ce que fait Emma

Choisit un point de départ (Rétrospectives, Portfolio, Vide : mots, ordre et dates par défaut + album d'exemple en brouillon), crée un album (titre, date, description, sur ce site / chez un autre service), « Ajouter des photos » (plusieurs fichiers, légende et description avant l'envoi, progression et erreur sous chaque fichier, nouvel essai), range par Monter / Descendre / En premier, choisit la couverture, masque, supprime, publie. Onglet « Retraits » : « Masquer la photo » (immédiat, e-mail effacé), écarter, effacer.

## Réglages

Titre, introduction, personnes sur les photos (oui), mention, lien de retrait (oui), e-mail à chaque demande (oui), copie dans Contacts (oui), ordre et dates (selon le gabarit), ImageGallery (non). Avancés : mots du lien de retour et de retrait, sites autorisés pour photos par adresse (vide = fermé), poids visé d'une photo (300 Ko, 4 000 max : le cœur refuse plus de 5 Mo), plus grand côté (1 600, 4 096), photos par album (120, 300), albums (100, 500), photos sur tout le site (1 500, 10 000), demandes par visiteur et par heure (3), durée de garde (90 jours max). Droits : `edit`, `publish`, `requests`.

## Gabarits et vocabulaire

Les gabarits ne changent que des valeurs **par défaut** (le module ne peut pas écrire les réglages) : titre, introduction, lien de retour, ordre, dates. Un réglage rempli l'emporte. Tous les mots viennent de `locales/` (FR+EN en parité) ou de réglages ; aucun nom propre à un site.

## Données et vie privée

Collections : albums (ligne légère), photos (une ligne par album : adresses et textes seulement), demandes, gabarit. Les fichiers envoyés (originaux et miniatures) appartiennent au module (`files.claim`) et sont supprimés du serveur avec la photo ou l'album, sauf ceux des anciennes photos (avant le cœur 0.2.13) ; la déclaration `privacy` le dit. Aucun cookie, aucune adresse gardée (empreinte salée du cœur en mémoire pour la limite de débit). Demandes : photo, message, e-mail facultatif effacé dès le traitement ; effacées 30 jours après traitement ou 90 jours au plus. Copie facultative dans Contacts (`contact.store`, seulement si un e-mail est donné). Photos par adresse : le visiteur contacte l'autre site (déclaré dans `privacy`, `referrerpolicy="no-referrer"`).

## Sécurité des fichiers

Tout vient du cœur : type par le contenu, 5 Mo, SVG refusé, connexion exigée, noms aléatoires, `nosniff` ; côté navigateur : ré-encodage (plus d'EXIF) ; côté pages : version fabriquée sans métadonnées. Côté module : adresses `/uploads/…` strictement validées, noms de fichiers assainis, aucun contenu exécuté.

## Intégrations

Offre `gallery.albums` v1 (`each`, lecture seule : `list({limit,cursor,q})`, `get(id)`), faux fournisseur `tests/helpers/fakeGallery.mjs` avec consommateur de référence (absent / panne / occupé / lent / illisible). Besoin facultatif `contact.store`.

## Outils pour l'assistant IA

`gallery_albums_list`, `gallery_photos_list` (lecture) ; `gallery_album_create` (toujours brouillon), `gallery_photo_add_url` (toujours masquée, sites autorisés), `gallery_photo_hide` (écritures éteintes d'office).

## Bornes

500 albums, 300 photos par album, 10 000 photos sur le site, 200 demandes en attente, lectures bornées, 50 par page d'administration, écritures sérialisées par instance, cache des albums 20 s. Plus d'« espace total » en base : l'espace disque dépend des fichiers du cœur (compté seulement en nombre de photos).

## Ce qui n'est pas fait

Vidéo, GIF animé, recadrage, commentaires, catégories d'albums, recherche publique, glisser-déposer, effacement du fichier d'origine des **anciennes** photos (avant le cœur 0.2.13 : impossible pour un module), miniature fabriquée par le cœur. Idées : catégories, export ZIP.

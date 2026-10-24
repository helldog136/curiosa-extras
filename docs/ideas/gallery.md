# Galeries photos (`gallery`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.6, licence et auteur comme les autres modules. Type déclaré `content` (rangement sous « Mon contenu »), sans bloc `content` : module à code.

## Le problème

Une association ou une créatrice veut montrer des albums (rétrospectives d'événements, portfolio, coulisses) sans imposer de service tiers (cookies, règles sur les photos de personnes). Décision de la propriétaire : **hébergement borné sur le site** + **lien vers un album externe** pour les gros albums.

## Stockage : ce que le cœur offre, ce qui manque

Le cœur 0.2.9 n'offre à un module **aucun stockage de fichiers** : `/api/admin/upload` sert les champs « image » d'un formulaire (un seul fichier, 5 Mo, aucun nettoyage des informations cachées, GIF accepté, pas de suppression, pas de limite par module) ; le champ « fichier » d'une action n'accepte que du **texte** ; le panneau d'administration ne peut pas charger de script. Choix honnête, sans contournement de sécurité :
- les photos sont gardées **dans le stockage propre du module** (collection `gallery_blobs`, base64), ce qui donne ce que l'envoi du cœur ne donne pas : suppression réelle, bornes comptées sur les octets réels, nettoyage serveur, sauvegarde et suppression avec l'instance ;
- l'envoi se fait depuis une **page de l'instance** (`/<chemin>/studio/<album>`, script de page du cœur 0.2.6) qui appelle la **route du cœur des actions à champ fichier** avec la photo en texte base64. Le cœur vérifie même site, connexion et droit `edit` avant tout ; la page elle-même ne montre rien de privé ;
- coût : la base grossit (borne par défaut 150 Mo, dure 2 000 Mo ; +33 % de base64) et les sauvegardes aussi ; chaque image servie lit une ligne.

**Petit lot du cœur proposé** : `ctx.api.files` (put/get/remove par instance, quota, type vérifié, nettoyage et miniature par `sharp` côté serveur, service statique en cache), des champs fichier binaires multiples avec progression, et un script autorisé dans le panneau d'administration. Le module pourrait alors supprimer `images.mjs` et la page d'envoi.

Miniatures : générées **dans le navigateur** (canvas, 480 px, JPEG) à l'envoi, car le cœur n'expose pas son moteur d'images aux modules ; le serveur les revérifie comme les photos.

## Ce que voit le visiteur

Liste (12 par page, cartes), album (miniatures `loading="lazy"` avec dimensions, légendes, description, mention de consentement, lien « Demander le retrait d'une photo », lien « voir toutes les photos » vers un autre service), page de photo partageable (sans JavaScript : précédente, suivante, retour), visionneuse (`dialog`, flèches, Échap, Début/Fin, balayage, compteur, légende, copie du lien, partage natif si disponible, boutons précédent/suivant de 56 px, retour téléphone, focus rendu, mouvement réduit), carte d'album externe avec « Ce lien ouvre … dans un nouvel onglet : vous quittez ce site ». Aperçu privé d'un brouillon par lien secret. Accueil : section « Les derniers albums ». ImageGallery facultatif (éteint d'office).

## Ce que fait Emma

Choisit un point de départ (Rétrospectives, Portfolio, Vide : mots, ordre et dates par défaut + album d'exemple en brouillon), crée un album (titre, date, description, sur ce site / chez un autre service), « Ajouter des photos » (plusieurs fichiers, légende et description avant l'envoi, progression et erreur sous chaque fichier, nouvel essai), range par Monter / Descendre / En premier, choisit la couverture, masque, supprime, publie. Onglet « Retraits » : « Masquer la photo » (immédiat, e-mail effacé), écarter, effacer.

## Réglages

Titre, introduction, personnes sur les photos (oui), mention, lien de retrait (oui), e-mail à chaque demande (oui), copie dans Contacts (oui), ordre et dates (selon le gabarit), ImageGallery (non). Avancés : mots du lien de retour et de retrait, sites autorisés pour photos par adresse (vide = fermé), poids d'une photo (300 Ko, 1 000 max), plus grand côté (1 600, 4 096), photos par album (120, 300), albums (100, 500), espace total (150 Mo, 2 000), demandes par visiteur et par heure (3), durée de garde (90 jours max). Droits : `edit`, `publish`, `requests`.

## Gabarits et vocabulaire

Les gabarits ne changent que des valeurs **par défaut** (le module ne peut pas écrire les réglages) : titre, introduction, lien de retour, ordre, dates. Un réglage rempli l'emporte. Tous les mots viennent de `locales/` (FR+EN en parité) ou de réglages ; aucun nom propre à un site.

## Données et vie privée

Collections : albums (ligne légère), photos (une ligne par album), images, demandes, gabarit. Aucun cookie, aucune adresse gardée (empreinte salée du cœur en mémoire pour la limite de débit). Demandes : photo, message, e-mail facultatif effacé dès le traitement ; effacées 30 jours après traitement ou 90 jours au plus. Copie facultative dans Contacts (`contact.store`, seulement si un e-mail est donné). Photos par adresse : le visiteur contacte l'autre site (déclaré dans `privacy`, `referrerpolicy="no-referrer"`).

## Sécurité des fichiers

Type par le contenu (JPEG, PNG, WebP), reconstruction du fichier sans EXIF/XMP/commentaires/vignette/texte PNG/octets après la fin, refus des images animées, bornes (octets, côté, pixels), noms assainis, aucun contenu exécuté, images servies avec `nosniff` et CSP `sandbox`, 404 pour album non publié ou photo masquée (clé d'aperçu sinon), structure testée par fuzz.

## Intégrations

Offre `gallery.albums` v1 (`each`, lecture seule : `list({limit,cursor,q})`, `get(id)`), faux fournisseur `tests/helpers/fakeGallery.mjs` avec consommateur de référence (absent / panne / occupé / lent / illisible). Besoin facultatif `contact.store`.

## Outils pour l'assistant IA

`gallery_albums_list`, `gallery_photos_list` (lecture) ; `gallery_album_create` (toujours brouillon), `gallery_photo_add_url` (toujours masquée, sites autorisés), `gallery_photo_hide` (écritures éteintes d'office).

## Bornes

500 albums, 300 photos par album, 200 demandes en attente, lectures bornées, 50 par page d'administration, écritures sérialisées par instance, cache des albums 20 s.

## Ce qui n'est pas fait

Vidéo, GIF animé, recadrage, commentaires, catégories d'albums, recherche publique, glisser-déposer, miniatures serveur. Idées : lot cœur `ctx.api.files`, catégories, export ZIP.

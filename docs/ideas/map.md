# Carte (`map`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.6, licence et auteur comme les autres modules. Type `content` (rangé sous « Mon contenu »), sans bloc `content` : module à code, plusieurs instances.

## Problème et public
Montrer des lieux utiles (studios, bonnes adresses, événements) sans que la propriétaire (non technique, surtout sur téléphone) n'ouvre un fichier. Décision : carte SIMPLE d'abord, tuiles OpenStreetMap sans clé, « Près de moi » au clic, pas d'alertes en v1.

## Pourquoi du code, et pourquoi un moteur maison
Le type `content` n'a ni coordonnées, ni carte, ni distance. Les scripts de page (cœur 0.2.6) sont limités à 3 fichiers de 32 Ko : Leaflet (~150 Ko) ne tient pas. Moteur « tuiles glissantes » maison : `scripts/map-engine.js` (≈ 20 Ko : projection Web Mercator, haversine, regroupement en grappes, glisser, pincer, molette, clavier, boutons) et `scripts/map-page.js` (≈ 15 Ko : comportement de la page). Les calculs sont essayés hors navigateur (`tests/map-pure.test.mjs`) ; le tout a aussi été essayé dans Chromium.

## Ce que voit le visiteur
Voir README. Adresses : `/map` (liste), `/map/t/<type>`, `/map/q/<mots>`, `/map/page/<n>` (combinables), `/map/p/<code>` (fiche partageable). Sans JavaScript : liste, filtres (liens), recherche (formulaire qui renvoie vers `/q/…`), pagination, fiches. Avec : recherche en tapant, carte, « Près de moi ». Carte : aucune requête avant « Afficher la carte » ; tuiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png` chargées par le navigateur avec le Referer par défaut, zoom 18 au plus, seules les tuiles visibles, cache du navigateur, attribution visible en permanence. Marqueurs : grille fixée au monde, 200 au plus (regroupement forcé), cibles de 44 px, symbole du type (pas la seule couleur). Fiche sous la carte (région `aria-live`).
« Près de moi » : `navigator.geolocation` après clic ; position dans une variable, jamais envoyée ni stockée (test statique). Refus ou panne : message poli, villes saisies par la propriétaire, ou latitude/longitude. Pas de géocodage externe en v1 (limite assumée).

## Ce que fait la propriétaire
Onglet « Mes lieux » : nom, type, adresse (texte), lien de carte (Google Maps, OpenStreetMap, Apple Plans, Waze, Bing, `geo:` ; ou « lat, lng », degrés décimaux ou DMS) ou latitude/longitude, description, horaires (texte libre), site, publié/brouillon ; liste filtrable, ordre par ↑ ↓, suppression ; lieux d'autres modules (masquer / réafficher). Onglet « Types et import » : types (nom par langue du site, symbole), jeux de départ (neutre, collectif, créateur seul, boutique : ajoutent leurs types et retirent les types de départ inutilisés), villes, import CSV progressif (500 lignes, reprise préremplie, brouillons par défaut, doublons ignorés, erreurs numérotées), export CSV. Erreurs sous le champ avec un exemple. Les liens raccourcis ne sont pas suivis (dit clairement). Mini-carte de choix non faite : l'administration ne peut pas charger de script ; le lien de carte + latitude/longitude guidée la remplacent. Le jeu de départ neutre est posé à la création ou, à défaut, au premier usage (une seule fois).

## Réglages et défauts
Introduction, mots du site (un/plusieurs lieux), texte des boutons « carte » et « près de moi » (tous traduisibles, vides = mots neutres FR+EN), carte oui, près de moi oui, ordre « mon ordre » ou alphabétique, itinéraire OpenStreetMap (ou Google, Apple), lieux d'ailleurs oui, événements passés cachés, lien de pied de page non, lieux par page 20 (avancé, ≤ 50). Droits : `edit`, `publish`.

## Données et vie privée
Stockage de l'instance : `map_places`, `map_types`, `map_cities`, `map_hidden`, `map_meta`. Aucun cookie, aucune position, aucune adresse IP (limiteur : empreinte du cœur, en mémoire). Déclaration `privacy` : OpenStreetMap contacté après le clic. Sauvegarde lisible : `places.csv` (même format que l'import), `types.csv`, `cities.csv`.

## Intégration `map.place` (consommé, facultatif)
Sujet lu en lecture seule (200 éléments au plus, limite du cœur), schéma id, title, lat, lng, kind, url, at, note. Pastille « Via <source> ». Un genre qui porte l'identifiant d'un type de l'équipe rejoint ce type. Événements passés (> 36 h) cachés (réglage). Masquer : `map_hidden`, jamais d'écriture chez la source. `member` : montré tel que reçu (5 décimales au plus, aucune adresse ajoutée). Source absente, en panne, illisible ou lente (2,5 s) : la page marche, dernières données gardées. Faux fournisseur : `tests/helpers/fakeMapPlaces.mjs`.

## Bornes
5000 lieux ; 30 types ; 100 villes ; 500 masqués ; 50 lieux par page ; 500 lignes par import (fichier ≤ 2 Mo) ; 200 marqueurs ; mémoire de 20 s ; 30 lectures de points par minute et par visiteur.

## Outils pour l'assistant
`map_places_list` (lecture), `map_types_list` (lecture), `map_place_add` (écriture non accordée d'office : BROUILLON seulement, 200 en attente au plus, doublon refusé, pas de publication).

## Constat sur le cœur (réglé par le cœur 0.2.12)
Le cœur envoie `Permissions-Policy: camera=(), microphone=(), geolocation=()` : sans la permission, le navigateur refuse TOUJOURS la position, même après clic (vérifié dans Chromium : « Permissions policy violation »). Depuis le cœur 0.2.12, le module déclare `visitor.geolocation` (`minCore` 0.2.12, Carte 1.0.1) et le cœur ouvre `geolocation=(self)` seulement si un module installé la déclare ; sans cette permission le navigateur refuse la position, et « Près de moi » tombe sur le repli (villes, coordonnées). Aucune politique CSP : les tuiles ne sont pas bloquées. Le sujet `map.place` n'est pas dans le tableau « Sujets connus » de docs/MODULES.md du cœur (fait échouer tests/repo-rules.test.mjs tant que ce n'est pas ajouté).

## Pas fait
Alertes poussées (idée), géocodage d'adresses, descriptions traduites par langue, mini-carte de choix dans l'administration, tuiles autres qu'OSM, itinéraire intégré.

## Idées pour la suite
Géocodage optionnel (service choisi par le propriétaire), lecture des liens raccourcis, filtre de la carte par types cochés, alertes « un lieu s'ouvre près de chez moi ».

# Autres plateformes (`platform-links`)

## Le problème
Le site sait déjà afficher Instagram, Bluesky, Twitch, YouTube… en icônes dans l'en-tête (un module par réseau). Il manquait la même chose pour les plateformes de soutien ou de contenu par abonnement (OnlyFans, Mym, Fansly, Patreon, Ko-fi…) ou une page quelconque : ces liens n'ont pas leur module, et certains méritent une page qui prévient le visiteur avant l'ouverture (contenu pour adultes), sans que ce soit une obligation : un lien OnlyFans n'est pas forcément du contenu pour adultes.

## Pour qui
Emma, créatrice non technique, qui veut ajouter un lien, le voir apparaître comme les autres réseaux, et décider elle-même s'il y a un avertissement. Ton neutre, sans jugement, ouvert à tous.

## Ce que voit le visiteur
- Les icônes des liens, **au même endroit, dans le même alignement et avec le même rendu** que celles des autres réseaux : le module ne dessine rien lui-même, il fournit ses boutons au cœur par le sujet `social.link`, comme Instagram ou Bluesky. Les logos sont ceux du jeu d'icônes du cœur (OnlyFans, Patreon, Ko-fi, Liberapay, Buy Me a Coffee, Linktree). Mym, Fansly et Tipeee n'en ont pas : une pastille de lettre sobre (Ⓜ, Ⓕ, Ⓣ) les remplace ; « Autre » a un signe générique (◎). Le nom du lien est lu par les lecteurs d'écran et montré au survol.
- Lien **sans avertissement** : l'icône ouvre directement la destination.
- Lien **avec avertissement** : l'icône ouvre une page simple (titre, message, bouton **J'ai 18 ans ou plus, continuer**, bouton **Retour au site**). Elle fonctionne sans JavaScript, n'est jamais indexée (en-tête `X-Robots-Tag: noindex, nofollow` et balise robots), ne pose aucun cookie, ne compte rien. Le bouton « continuer » est un vrai lien (même onglet, `rel="noopener nofollow"`, `referrerpolicy="strict-origin-when-cross-origin"` : le domaine du site est transmis, jamais le chemin).
- Clé inconnue, lien masqué ou retiré : page aimable « Ce lien n'existe plus » (réponse 404, aussi non indexée) avec « Retour au site ».
- Un lien dont l'avertissement est coupé, mais dont l'ancienne adresse de page est encore ouverte, donne une page neutre « Vous quittez le site » (sans mention 18+).

## Ce que fait Emma, pas à pas
1. Extensions > Autres plateformes (le module est épinglé au menu, rubrique Ma communauté). Onglet **Mes liens**.
2. Elle choisit la plateforme, colle l'adresse (même sans `https://` ; pour une plateforme de la liste, son nom seul suffit), ajoute un nom si elle veut (obligatoire pour « Autre »), choisit si l'icône est visible et s'il y a un avertissement (*Selon la plateforme* / *Oui* / *Non, ouvrir directement*), puis **Ajouter ce lien**.
3. Erreur : le message s'affiche sous le champ, avec un exemple (« Seules les adresses sécurisées (https) sont acceptées. Écrivez par exemple onlyfans.com/monnom. »).
4. **Modifier** ouvre la fiche : formulaire, boutons **Monter** et **Descendre** (la fiche reste ouverte pour monter plusieurs fois), et **Retirer** (avec une case de confirmation). Pas de glisser-déposer.
5. Onglet **Réglages** : l'avertissement par défaut pour OnlyFans, Mym et Fansly (coupé d'un geste pour toutes), le titre et le message de la page, par langue.

## Réglages et valeurs par défaut
| Réglage | Défaut | Mode |
|---|---|---|
| Prévenir avant d'ouvrir OnlyFans, Mym et Fansly | oui (les autres plateformes : non) | simple |
| Titre / message de la page d'avertissement (par langue) | « Avant de continuer » / « Ce lien mène vers un site réservé aux adultes (18 ans et plus). » | simple |
| Choix par lien : selon la plateforme / oui / non | selon la plateforme | simple (fiche du lien) |
| Indiquer d'où vient le visiteur | oui | avancé |
| Nom de campagne (utm_campaign) | vide | avancé |
| Choisir l'origine lien par lien | non | avancé |

Un module installé marche sans aucun réglage.

## Origine des visites (automatique)
Sur chaque adresse de destination, le module ajoute côté serveur `utm_source=<nom d'hôte du site>` (pris sur l'adresse publique du site, aucun réglage) et `utm_medium=link`, plus `utm_campaign` si renseigné. Les paramètres déjà présents ne sont jamais remplacés ni doublés, l'ancre `#…` est gardée, les valeurs sont encodées (aucune injection). Rien de personnel n'est transmis ; certaines plateformes ignorent ces paramètres. Interrupteur général, campagne et surcharge par lien : **mode avancé seulement**, aucun texte à ce sujet en mode simple. La destination et ses paramètres viennent uniquement de la configuration : l'icône directe et le bouton « continuer » ouvrent exactement la même adresse.

## Adresses acceptées
https seulement. Complétées : `onlyfans.com/nom`, `//site.example/x`, un nom seul pour une plateforme connue. Refusées avec un message clair : `http://`, `javascript:` et tout autre schéma, identifiants dans l'adresse (`https://nom:mot@…`), adresses internes ou numériques (`localhost`, `127.0.0.1`, `.local`, `.lan`, port inhabituel), espaces, adresses trop longues (300 caractères), doublon dans la liste. Pour une plateforme connue, l'adresse doit être sur son site (`onlyfans.com.autre.example` est refusé) ; « Autre » accepte n'importe quel site https. L'adresse est revérifiée à chaque affichage (une sauvegarde modifiée à la main ne peut pas introduire `javascript:`).

## Données et vie privée
Une collection `links` (une ligne par lien : clé publique, plateforme, adresse, nom, visible, avertissement, origine, rang). Aucune donnée de visiteur, aucun cookie, aucun compteur, aucune adresse IP : le module ne déclare rien de collecté. La clé publique du lien (`l` + 7 caractères) ne désigne qu'une ligne de la configuration, jamais une destination. Sauvegarde lisible : `links.csv`.

## Bornes
20 liens, nom 40 caractères, adresse 300 caractères. **Le haut du site montre au plus 10 icônes en tout, réseaux compris** (limite du cœur) : l'admin le dit.

## Droits et assistant IA
Droit `links.edit` (« modifier les liens des autres plateformes », administrateurs par défaut) exigé par le cœur pour chaque écriture ; sans lui, la liste est en lecture seule. Outils : `platform_links_list` (lecture), `platform_link_create` et `platform_link_update` (écritures explicites, jamais accordées d'office, mêmes règles de validation, erreurs lisibles). Pas d'outil de suppression. Aucun secret.

## Intégrations
Sujet fourni : `social.link`. Aucune dépendance. Type `widget` (et non `social`) : un module de type réseau doit être sans stockage ni droits ; celui-ci a une liste, des droits et une page.

## Choix de conception
- **Page d'avertissement en route `/m/<instance>/go?l=<clé>`** et non `/<chemin>/go/<clé>` : la page d'un module (`page`) ne peut pas, dans le cœur 0.2.7, se déclarer non indexée ni choisir ses en-têtes, et les routes de module n'ont pas de segment variable. La route répond avec ses propres en-têtes (noindex, CSP stricte, pas de cache) et son propre habillage aux couleurs du site (thème du cœur). Pas de JavaScript.
- **Pas de « se souvenir de mon choix »** : la page tient en un clic, sans JavaScript ; mémoriser ajouterait un script, un stockage dans le navigateur et une phrase de vie privée pour gagner un clic. Idée pour la suite si Emma le demande.
- **Pas une vérification d'âge** : l'admin le dit sobrement ; la page visiteur n'en parle pas.
- Liste en une colonne et un seul bouton « Modifier » par ligne : le tableau du cœur ne passe pas à la ligne, des boutons Monter/Descendre/Retirer en ligne seraient hors écran sur téléphone.

## Limites liées au cœur (à connaître)
- Le cœur affiche toutes les icônes du site avec `rel="noopener noreferrer"` et `target="_blank"` (nouvel onglet) : un module ne peut pas y changer `rel`, `referrerpolicy` ni l'onglet. Pour l'icône directe, la plateforme ne reçoit donc **pas** de Referer du tout ; `utm_source` indique la provenance à la place. Le bouton « continuer » de la page d'avertissement suit la demande (`noopener nofollow` + `strict-origin-when-cross-origin`, même onglet). Idée pour le cœur : laisser un bouton `social.link` fournir `rel`, `referrerPolicy`, `target`, et une icône SVG propre (aujourd'hui seuls l'identifiant d'icône ou un texte).
- Les lettres Ⓜ Ⓕ Ⓣ et ◎ sont du texte : légèrement plus grandes que les logos et de quelques pixels plus bas.
- L'ordre des icônes entre modules est celui des instances du cœur ; les icônes de ce module sont groupées.

## Pas fait, idées pour la suite
Se souvenir du choix du visiteur (voir plus haut) ; aperçu de l'icône dans le formulaire ; réordonner plusieurs liens d'un coup ; logos propres pour Mym, Fansly, Tipeee après vérification de leurs droits ; plus de 10 icônes (limite du cœur).

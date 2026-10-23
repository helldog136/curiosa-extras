# Mur des remerciements (`thanks-wall`), description complète

Version 1.0.0, cœur 0.2.5 au moins. Type « widget » avec code (une page publique et un panneau d'administration) : un module « contenu » sans code ne convenait pas, car la matière (personnes, photos, catégories) n'est pas à lui mais lue dans Contacts à chaque affichage.

## Le problème
On veut remercier sa communauté (modération, mécènes, bêta-testeurs…) mais personne n'a le temps de retaper des noms et de retrouver des photos, ni de mettre à jour la liste quand elle change.

## Pour qui
Emma : créatrice non technique, qui tient déjà ses contacts dans le module Contacts.

## Ce que voit le visiteur
- Une page « Merci ! » (adresse proposée `/merci`) : en haut, la personne à l'honneur du mois en grand (photo, nom, petit mot) ; puis un bloc par groupe (titre, nombre de personnes, grille de cartes photo + nom + petit mot éventuel). Deux cartes par ligne sur téléphone, jusqu'à six ou plus sur grand écran.
- Un groupe montre 12 cartes (réglable de 4 à 48) avec un bouton « Voir tout le monde (N) » ; la page d'un groupe (`/merci/g/2`) montre 50 cartes par page avec « Précédent / Suivant » (`/merci/g/2/page/3`). Une page qui n'existe pas répond 404.
- Pas de photo permise : les initiales dans un rond. Le texte de chaque carte est le vrai texte (la photo est décorative, `alt` vide).
- Contacts muet ou absent : le dernier mur connu (24 h au plus), sinon « Le mur des remerciements se prépare » (jamais une erreur). Mur sans personne : « Le mur se remplit bientôt ».
- Accessibilité : titres hiérarchisés, liens et boutons de 44 px, focus visible, mouvements seulement si la personne n'a pas demandé moins d'animation, contrastes via les couleurs du thème du site (clair et sombre).

## Ce que fait Emma, pas à pas
1. Installer : Contacts vient avec (besoin obligatoire, version 2).
2. Dans Contacts, ranger des fiches dans une catégorie. Dans le module, onglet Réglages, choisir « Qui remercier » (une liste avec recherche ; « Créer » fait une nouvelle catégorie depuis ce champ). S'il n'y a qu'une seule catégorie dans Contacts, elle est prise toute seule : le mur marche sans réglage.
3. Plusieurs groupes : « Ajouter un deuxième groupe » (jusqu'à six), chacun avec sa catégorie et un titre facultatif par langue (par défaut : le nom de la catégorie).
4. Onglet « Mon mur » : voir l'état (personnes, cachées), ouvrir le mur, choisir la personne à l'honneur (rechercher un nom, « Mettre à l'honneur », mois parmi ce mois-ci et les cinq suivants, petit mot par langue), écrire un petit mot par personne (liste de 25 par page avec recherche ; « Écrire », un texte par langue du site, 160 caractères ; vide = retirer), « Vérifier mes messages » après une fusion ou une suppression de fiches.

## « Ne pas montrer » (décision)
Le module ne possède pas cette donnée : ce serait une deuxième vérité à côté de Contacts. L'exclusion est donc une **catégorie de Contacts** :
- réglage « Catégorie Ne pas montrer » (choix parmi les catégories, avec « Créer ») ; sinon une catégorie nommée « Ne pas montrer » ou « Do not show » est utilisée d'office (sans casse ni accents) ;
- une fiche rangée dedans disparaît du mur (et de la mise à l'honneur, de la page d'un groupe, de la liste de l'assistant) en moins de deux minutes, même si elle est aussi dans une catégorie remerciée ;
- jamais montrées non plus : les fiches « à vérifier » (arrivées par le formulaire de contact et pas encore relues) ;
- en cas de doute, on ne publie pas : si Contacts ne peut pas dire QUI est caché, rien de nouveau n'est publié (le dernier mur connu reste, 24 h au plus) ;
- la catégorie supprimée : plus personne n'est caché et l'administration le dit en toutes lettres ; fusionnée : on suit la fusion.
- Limite assumée : pendant une panne de Contacts, quelqu'un qu'on vient de cacher peut rester visible jusqu'à 24 h, car la mémoire du mur est la dernière version sûre. Idée : raccourcir cette durée.

## Réglages et valeurs par défaut
Groupe 1 : catégorie (obligatoire, mais prise d'office s'il n'y a qu'une catégorie) et titre ; groupes 2 à 6 facultatifs ; catégorie « Ne pas montrer » (facultative) ; titre de la page (« Merci ! ») ; quelques mots sous le titre ; comment les noms sont affichés (comme la fiche par défaut, prénom seulement, pseudo du compte) car le mur est public ; montrer les photos (oui) ; avancés : ordre (alphabétique, fiches les plus anciennes ou récentes d'abord), nombre de cartes en aperçu (12).

## Données gardées et vie privée
Le module garde deux petites collections, toujours par numéro de fiche : `messages` (fiche → un texte par langue, 160 caractères) et `honors` (mois → fiche, petit mot par langue). Jamais un nom, une photo, un pseudo, un e-mail ou un téléphone (de la fiche, il ne retient que ce qui s'affiche : nom, photo, pseudo du compte, et seulement en mémoire). Aucun cookie, aucun formulaire, aucune route publique, aucune adresse de visiteur gardée. Offre `privacy.subject` : exporter (message et mises à l'honneur), effacer (avant la suppression de la fiche), suivre une fusion (le message déjà écrit pour la fiche gardée n'est jamais écrasé). Pour une fiche fusionnée ou supprimée dont le module n'aurait rien reçu, « Vérifier mes messages » rattrape (comportement `moved` suivi, `missing` retiré).

Photos : le navigateur du visiteur les charge directement (le cœur ne laisse pas un module relayer des images : `ctx.api.net` ne rend ni octets ni image, et un `fetch` direct est interdit). Pour limiter la fuite d'adresse vers un serveur arbitraire : photo choisie à la main dans Contacts = n'importe quel serveur https ou une image du site (c'est Emma qui l'a choisie) ; photo d'un réseau = seulement les serveurs d'images connus de Twitch, YouTube et Bluesky ; le reste = initiales. `referrerpolicy="no-referrer"`, chargement différé. Dit dans « privacy » du manifeste.

## Bornes et limites
6 groupes ; 1 000 fiches lues par groupe (2 lectures de 500 par curseur ; au-delà seules les 1 000 premières sont montrées et l'administration le dit) ; 50 cartes par page ; 1 000 messages ; 24 mises à l'honneur (les plus anciennes partent) ; texte : 160 et 300 caractères. Mémoire du mur en processus (jamais sur disque) : fraîche 2 minutes (15 s pour l'administration), utilisable en secours 24 h, 20 murs au plus, une seule reconstruction à la fois ; chaque appel à Contacts est borné (4 s) ; aucun minuteur de fond. Le mois à l'honneur change à minuit UTC.

## Outils pour l'assistant IA
`wall_status`, `wall_people` (lecture) ; `message_set`, `honor_set` (écriture, jamais accordés d'office) ; `message_clear`, `honor_clear` (destructifs). Les fiches se trouvent avec les outils de Contacts.

## Intégrations
Lit Contacts (`contact.book` v2 : `categories`, `categoriesResolve`, `list`, `resolve`, `search`) ; réglages `choice` à source service ; `suggestInstall` si Contacts manque ; offre `privacy.subject` (`each`). Droit propre : `messages.edit` (écrire les messages, choisir la personne à l'honneur).

## Ce qui n'est pas fait, et pourquoi
- Récupérer les abonnés Twitch : droits que l'utilisatrice n'a pas toujours.
- Choix multiple de catégories dans un seul champ : le cœur n'a pas de choix multiple ; remplacé par un choix par groupe (jusqu'à six), ce qui permet en plus un titre par groupe.
- Relais d'images par le site : impossible honnêtement avec l'API (voir plus haut).
- Interrupteur « ne pas montrer » dans la fiche : Contacts n'en a pas ; la catégorie en tient lieu.
- Sauvegarde lisible : sans noms (non copiés), un fichier d'identifiants n'aurait aucun sens.

## Idées pour la suite
Interrupteur natif « ne pas montrer » dans la fiche de Contacts (service `hidden`) ; mise à l'honneur au hasard ou automatique ; durée de secours réglable ; carte « merci » à partager (image) ; message par groupe ; pastille dans le menu quand le mois n'a personne à l'honneur.

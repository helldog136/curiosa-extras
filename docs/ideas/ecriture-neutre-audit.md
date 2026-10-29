# Écriture neutre : inventaire et corrections

Objectif : aucun texte lu par une personne ne suppose son genre ni celui de son public. Exemple de départ : le module Commandes parlait des « créatrices » et de leurs « clientes ».

Méthode : recherche des termes genrés dans tous les `module.json`, `locales/fr.json` et `en.json`, textes écrits dans le code (`.mjs`, `.js`), README, `catalogue/index.json`, `starter/`, `examples/` et `docs/` ; puis lecture complète des textes modifiés. Garde-fou : `tests/neutral-wording.test.mjs` (liste de termes et liste blanche commentées en tête du fichier).

Ampleur : environ 640 lignes de texte réécrites dans 145 fichiers ; 57 modules et 1 exemple montent d'une version corrective (liste dans `docs/changelog-parts/ecriture-neutre.md`). Rien d'autre ne change : clés, réglages, `dataVersion`, `minCore`, `apiVersion`, parité exacte FR/EN.

## Règles appliquées

| Avant | Après |
|---|---|
| les visiteurs, le visiteur, par visiteur | le public, la personne qui visite, par personne |
| spectateurs, spectateurs moyens, pic de spectateurs | audience, audience moyenne, pic d'audience, « personnes qui regardent » |
| abonnés (chiffres des réseaux) ; abonnés payants | followers ; abonnements payants |
| créatrice, créateur, cliente | personne qui crée, artistes, personne qui commande |
| le propriétaire, la propriétaire (du site, de la chaîne) | la personne propriétaire |
| quelqu'un, chacun, tous | une personne, chaque personne, tout le monde |
| connecté·e, discret(e), assujetti·e, un·e indépendant·e | reformulés sans accord (« session ouverte », « garder votre discrétion »…) |
| vous êtes prête, vous seule, vous vous êtes connecté | vous voulez, vous êtes la seule personne à…, « la connexion s'est faite avec… » |
| Cela m'a aidé, vous a-t-elle aidé | Cela m'a été utile, vous a-t-elle été utile |
| he, she, his, her (anglais) | they, their, them |
| prénoms d'exemple féminins ou masculins seuls | Camille, Alex, Sacha, Dominique |

## Modules

| Module (nouvelle version) | Avant | Après |
|---|---|---|
| Commandes 1.0.1 | « pour les créatrices … pour chaque cliente » ; « Vous êtes illustratrice, créatrice de modèles… » ; EN « she / her » (16 textes) | « pour toute personne qui crée sur commande … pour chaque personne qui commande » ; « Vous faites de l'illustration, des modèles… » ; « they / their » |
| 20 modules de réseaux : Bandcamp 1.0.2, Bluesky 1.1.3, Discord 1.1.5, Facebook 1.0.2, GitHub 1.1.3, Instagram 1.0.2, Kick 1.0.2, Ko-fi 1.0.2, Mastodon 1.1.3, Patreon 1.0.2, Pinterest 1.0.2, Reddit 1.1.3, Snapchat 1.0.2, SoundCloud 1.0.2, Spotify 1.0.2, Steam 1.0.2, Telegram 1.0.2, Threads 1.0.2, TikTok 1.0.2, X 1.0.2 (README) | « celle d'un ami » | « celle d'une personne amie » |
| Bluesky 1.1.3, GitHub 1.1.3, Mastodon 1.1.3, Reddit 1.1.3, Chaîne YouTube 1.4.1, Connecteur YouTube 1.3.1, Contacts 2.2.3, Statistiques de la communauté 1.1.3 | « Abonnés Bluesky », « nombre d'abonnés », « 12 400 abonnés » | « Followers Bluesky », « nombre de followers », « 12 400 followers » |
| Statistiques de la communauté 1.1.3, Ma Chaîne Twitch 2.1.1 | « Abonnés payants », « Spectateurs moyens », « Pic de spectateurs » | « Abonnements payants », « Audience moyenne », « Pic d'audience » |
| Compte à rebours 1.0.1, Jeu du jour 1.0.1, Annuaire 1.0.1, Événements 1.0.1, Questions fréquentes 1.0.2, Galeries photos 1.1.1, Jaquettes de jeux 1.0.1, Suggestions de jeux 1.5.1, Bandeau d'accueil 1.0.2, Mentions légales 1.0.1, Carte 1.0.2, Mascotte 1.0.1, Autres plateformes 1.1.1, Sondages 1.1.1, Story d'annonce 2.5.1, Témoignages 1.0.1, Mur des remerciements 1.0.2, Vidéothèque 1.0.1, Statut du live 1.4.2, Planning 2.4.1, Raid Twitch 2.2.4, Soutiens 1.0.1, Livre d'or 1.0.6 | « vos visiteurs voient », « chez le visiteur », « par visiteur et par heure », « Rien n'est collecté sur vos visiteurs » | « votre public voit », « chez la personne qui visite », « par personne et par heure », « Rien n'est collecté sur votre public » |
| Questions fréquentes 1.0.2 | « Cela m'a aidé », « Cette réponse vous a-t-elle aidé ? » (l'accord suppose un genre) | « Cela m'a été utile », « … vous a-t-elle été utile ? » |
| Mentions légales 1.0.1 | « vous seul·e connaissez », « assujetti·e », « Un·e indépendant·e », « satisfait·e », « Jeanne Martin » ; « L'éditeur est un particulier. Il a choisi… » | « personne ne connaît votre site mieux que vous », « cette taxe s'applique à vous », « Une personne en activité indépendante », « Dominique Martin » ; « Le site est édité par un particulier, qui a choisi… » |
| Galeries photos 1.1.1 | « Vous n'êtes pas connecté·e à l'administration », « Il a écrit : » | « Aucune session n'est ouverte dans l'administration », « Elle a écrit : » (la personne qui demande le retrait) |
| Témoignages 1.0.1 | « De 1 (déçu·e) à 5 (enchanté·e) », « l'accord de son auteur », « vraiment cliente » | « De 1 (décevant) à 5 (excellent) », « la personne qui l'a écrit », « a vraiment acheté chez vous » |
| Soutiens 1.0.1 | « rester discret(e) », « quand vous êtes prête », « la clé du créateur de la page », EN « the person herself … she agrees » | « garder votre discrétion », « quand vous voulez », « la clé du compte qui a créé la page », « the person directly … they agree » |
| Mur des remerciements 1.0.2 | « Un petit mot pour chacun », « Modérateurs » (exemple), EN « her card … she disappears » | « … pour chaque personne », « Modération », « their card … they disappear » |
| Annuaire 1.0.1 | modèle « Collectif de créateurs », mots « Créateurs » / « créateur », « Invités », « Voici ceux et celles que… » | « Collectif d'artistes », « Artistes » / « artiste », « Personnes invitées », « Voici les personnes que… » |
| Événements 1.0.1 | « Intervenants », « Créateur seul », « Illustratrice » (exemple) | « Personnes invitées », « Création en solo », « Illustration » |
| Carte 1.0.2 | « Créateur seul » | « Création en solo » |
| Bot Twitch 1.3.1 | « Les modérateurs », « Les abonnés », « vous seule le pouvez », « il faut être Affilié ou Partenaire », « Vous vous êtes connecté chez Twitch », « merci à tous », repli « ami » | « L'équipe de modération », « Les personnes abonnées », « vous êtes la seule personne à pouvoir le faire », « il faut que la chaîne soit dans le programme Affilié ou Partenaire », « La connexion chez Twitch s'est faite avec… », « merci à tout le monde », repli « chat » |
| Ma Chaîne Twitch 2.1.1 | « Réservé aux affiliés et partenaires », « Vous vous êtes connecté chez Twitch », « 150 spectateurs en moyenne » | « Réservé aux chaînes du programme Affilié ou Partenaire », « La connexion chez Twitch s'est faite avec… », « 150 personnes en moyenne » |
| Actions du live YouTube 1.1.1 | « le propriétaire », « les modérateurs YouTube », « quelqu'un soutient » | « la personne propriétaire », « l'équipe de modération YouTube », « une personne soutient » |
| Raid Twitch 2.2.4 (administration et README seulement) | « raider un ami », « ceux qui », « vos visiteurs », « quelqu'un », EN « her card » | « raider une personne amie », « les chaînes qui », « votre public », « une personne », « their card » |
| Participation 1.0.1, Sondages 1.1.1 | « Demandez au propriétaire du site », « vainqueurs / gagnants des manches », « un participant inactif » | « Demandez à la personne propriétaire du site », « choix gagnants des manches », « une personne inactive » |
| Jeu du jour 1.0.1 (quiz) | « Joueur » (colonne), « un abonné », « le streamer / le spectateur », « un ami », « Grand gagnant » | « Pseudo », « un abonnement », « la personne qui diffuse / le public », « un contact », « Grand gala » |
| Overlay alertes 1.1.1, Home Assistant 1.0.2 | alerte d'essai « Léa », exemple « Alice » | « Sacha », « Alex » |
| Contacts 2.2.3 | modèle de fichier « Marie Exemple, Productrice, Amis, Rencontrée à un festival » ; EN « Jane Example » | « Camille Exemple, Production, Proches, Rencontre faite à un festival » ; EN « Alex Example » |
| README de 24 modules et du module de départ | « Pour les développeurs » | « Pour qui développe » |
| README racine, `package.json`, `starter/`, `examples/` | « modules pour créateurs », « des auteurs externes », « Soyez le premier à signer ! » | « modules pour la création de contenu », « pour publier son propre module », « Soyez la première personne à signer ! » |

## Conservé volontairement

| Terme | Où | Pourquoi |
|---|---|---|
| streameur, spectateur(s), « Vous êtes nombreux ! » | dock du Raid Twitch (`dock_*`), et les textes qui citent son bouton | Les empreintes du dock 2.1 (`tests/helpers/twitch-raid-golden.mjs`) prouvent qu'il n'a pas bougé : le changer les casse. À reprendre dans un lot qui les régénère. |
| `{utilisateur}` | Bot Twitch | Nom de variable déjà utilisé dans les commandes enregistrées : renommer les casserait. |
| streameuse, modo, moderateur | liste de pseudos réservés d'Audience | Il faut bloquer les deux formes pour empêcher de se faire passer pour l'équipe. |
| « droit d'auteur », « éditeur » / « hébergeur » | Mentions légales | Termes de la loi (ils figurent dans les mentions obligatoires). Les pronoms autour ont été réécrits. |
| « Gagnant » | Sondages (badge d'un choix) | Désigne le choix qui l'emporte, pas une personne. |
| « Personnage non joueur », « Joueur contre joueur » | quiz du Jeu du jour | Développement officiel des sigles PNJ et PvP. |
| `intervenants` | import CSV d'Événements | Nom de colonne accepté dans les fichiers déjà préparés. |
| `j.participant` | script d'Audience | Propriété d'une réponse JSON (contrat technique). |
| « ID client », « secret du client », « client » OAuth | Connecteurs Twitch et YouTube, Soutiens | Termes imposés par Google, Twitch et Patreon, pas des personnes. |
| Affilié, Partenaire | Twitch | Noms des programmes de Twitch. |
| « Pour les développeurs » | CHANGELOG et brouillons `docs/changelog-parts/` | Des tests vérifient ces titres. À renommer en une fois avec eux. |

## Noms de rôles du système à discuter (non modifiés)

Les modules citent ces noms sans les définir. Leur choix relève du cœur de Curiosa.

| Nom actuel | Où il apparaît | Suggestion |
|---|---|---|
| Administrateur / administrateurs | « Réservé aux administrateurs » (Suggestions de jeux), « connecté en tant qu'administrateur » (Story d'annonce), « visibles des seuls administrateurs » (Bot Twitch, Story d'annonce) | « Administration », ou « Personne qui administre » |
| Éditeur (rôle) | rôles du cœur ; non cité par les modules | « Édition » |
| Propriétaire | nom de rôle ; les articles autour (« le / la propriétaire ») sont corrigés dans les modules | garder « Propriétaire » ; écrire « la personne propriétaire » |
| Modérateurs (Twitch, YouTube) | rôles des plateformes, cités tels quels dans le nom de certaines options | « équipe de modération » dans les phrases (fait) |

## Hors périmètre (à décider)

- `docs/ideas/*.md` : notes de conception et cahiers des charges des modules. Elles décrivent des personas (par exemple « Emma, créatrice non technique ») et citent les anciens mots. Je ne les ai pas réécrites : ce sont des documents de travail, pas des textes lus par les personnes qui utilisent le site. Les fichiers `*.changelog.md` sont de l'historique.
- `CHANGELOG.md` : historique, jamais réécrit.
- Les textes du cœur de Curiosa (hors de ce dépôt).

# Changelog

Ce que chaque version de ce dépôt change pour vous. Chaque version est une étiquette (`vX.Y.Z`) : c'est elle que le Catalogue de Curiosa propose à l'installation, et son texte devient celui de la release GitHub.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, qui disent ce que ça change pour vous.

## 1.6.0

*Changements depuis la 1.5.1.*

### Nouveautés

- **Nouveau : le Bot Twitch.** Votre site répond aux commandes tapées dans votre chat Twitch : `!planning`, `!jeu`, `!titre`, `!followers` et `!uptime` sont prêtes, et vous créez les vôtres (nom, réponse, autres noms, qui peut s'en servir, attente entre deux réponses). Les réponses peuvent contenir le jeu, le titre, la durée du direct, le nombre de followers, le prochain stream ou le pseudo de la personne. Il faut Curiosa 0.1.22 ou plus ; Chaîne Twitch s'installe avec lui.
- **Des commandes pour vos partenaires et vos réseaux.** Si Sponsors est installé, chaque partenaire peut avoir sa commande (`!tesla` donne l'adresse de sa page). Si vous avez installé des modules de réseaux (YouTube, TikTok, Instagram, Discord, X…), chacun peut avoir la sienne (`!youtube`, `!tiktok`…), et `!reseaux` donne tous les liens d'un coup. Sans ces modules, rien ne change et la page du bot l'explique.
- **Un arrêt d'urgence et un journal.** Un gros bouton en haut de la page coupe toutes les réponses tout de suite ; un court journal dit, pour chaque commande, si le bot a répondu ou pourquoi il s'est tu. Par défaut le bot ne répond que pendant vos directs, ne répond jamais à lui-même ni aux autres bots, et se retient s'il y a trop de messages d'un coup.
- **Votre IA peut lister, créer et modifier des commandes** (rien n'est accordé d'office, rien ne se supprime).
- **Chaîne Twitch 1.5.0 : elle prépare le terrain pour le bot.** Elle peut demander à Twitch l'autorisation de lire et d'écrire dans votre chat (un bouton, une seule fois) et parler à Twitch à la place d'autres modules sans jamais leur montrer vos accès. Rien ne change pour vous si vous n'installez pas le bot.
- **Une vérification automatique de chaque module.** Tous les modules (et les deux exemples) passent maintenant une même série de contrôles : fichier de description, langues, réglages, sécurité, vie privée, textes en mots simples. Un défaut est repéré avant que vous ne le voyiez. Les défauts trouvés à la mise en place sont tous corrigés ci-dessous.

### Améliorations

- **Livre d'or : la vie privée est annoncée.** La page de confidentialité de votre site dit maintenant que les noms et messages des visiteurs sont enregistrés, et comment les faire retirer. Les champs « Image de bannière » et « Code d'invitation », qui sont facultatifs, ne sont plus comptés « à remplir ». Il faut Curiosa 0.1.22 ou plus.
- **Suggestions de jeux : la vie privée est annoncée.** Votre page de confidentialité explique ce que les visiteurs laissent quand ils proposent un jeu ou votent (nom ou pseudo, note, un petit cookie pour les votes).
- **Bannière d'annonce : le lien est vraiment facultatif**, et sa description est plus claire. Il faut Curiosa 0.1.22 ou plus.
- **Contacts et Partenariats : votre IA n'écrit plus sans votre accord.** Créer ou compléter un contact, créer ou modifier un partenaire, tenir son journal, lier ou détacher un contact : ces outils ne sont plus donnés d'office à votre IA, vous les accordez vous-même dans son accès. La lecture reste possible. Si votre IA les utilisait, recochez-les.
- **Overlay alertes : des mots plus simples.** La description n'emploie plus de terme technique, et le réglage « Jeton d'envoi » est rangé dans les réglages avancés.
- **Annonces Discord : une aide plus claire** pour l'adresse du lien Discord, sans terme technique.

### Pour les développeurs

- `npm test` lance la suite de conformité du cœur (dossier `testsupport/`, Curiosa 0.1.23) sur chaque dossier de `modules/` et `examples/` : une exigence = un test nommé. Aucun défaut connu n'est toléré (le tableau `KNOWN` de `tests/conformance.test.mjs` est vide). Un nouveau module est contrôlé sans rien écrire.
- Tests retirés car la suite les couvre : `optional-settings`, et des contrôles de `repo-rules`, `srp-guard` et des tests de modules (manifeste valide, langues, réglages, correspondance code/manifeste).
- Le test du Planning « carte prochain stream » ne dépend plus de l'heure.

## 1.5.1

*Changements depuis la 1.5.0.*

- **Les champs facultatifs ne sont plus marqués « à remplir ».** Dans Discord, les annonces Discord, le statut du live, Planning, le formulaire de contact, la Chaîne Twitch et la Chaîne YouTube, un réglage qui dit « facultatif » le reste vraiment : le laisser vide ne met plus l'extension « À configurer ». Il faut Curiosa 0.1.22 ou plus.

## 1.5.0

*Changements depuis la 1.4.0.*

- **Le site mesure maintenant vos directs Twitch et les vues de vos vidéos.** Il note les spectateurs moyens, le pic, les heures de live et regardées et les followers gagnés par jeu, à partir de l'activation du suivi (déjà active si « Suivre mes statistiques » était coché). Il faut Curiosa 0.1.17 ou plus.
- **Votre IA comprend mieux les chiffres de vos réseaux.** Quand il n'y a encore rien à lire, elle sait maintenant pourquoi et quoi faire. L'outil de saisie à la main change de nom (stats_set_manual) : recochez-le dans votre accès si vous l'utilisiez.
- **Un guide pour créer votre clé YouTube.** Le module Chaîne YouTube explique pas à pas, en haut de sa page, comment obtenir la clé gratuite dont il a besoin pour suivre vos abonnés, avec le lien vers la console Google et les pistes si la clé est refusée.

## 1.4.0

*Changements depuis la 1.3.3.*

- **Le site peut maintenant tenir à jour les chiffres de vos réseaux.** Vos abonnés, publications et vues sont notés régulièrement, avec leur évolution, pour vous et pour votre IA ; rien n'est montré sur votre site sans votre accord. Nouveau : Statistiques de la communauté ; il faut Curiosa 0.1.16 ou plus.
- **Vos réseaux peuvent maintenant partager le nombre de leurs abonnés.** YouTube, Twitch, Bluesky, Mastodon, GitHub, Discord et Reddit s'en occupent chacun, avec une case « Suivre mes statistiques ». Pour Twitch, un bouton « Connecter ma chaîne » suffit.

## 1.3.3

*Changements depuis la 1.3.2.*

- **Statut live annonce maintenant toutes vos chaînes Twitch, pas une seule.** Si plusieurs sont en direct, vous les voyez toutes, avec un petit choix pour passer de l'une à l'autre dans le lecteur. Mettez à jour Chaîne Twitch avec Statut live ; il faut Curiosa 0.1.14 ou plus.

## 1.3.2

*Changements depuis la 1.3.1.*

- **Le Catalogue propose maintenant tous les modules.** Blog, liens, pages, codes promo et les autres y figurent, au même titre que les autres. Il sait aussi quels modules ont besoin d'un autre, pour l'installer avec lui.

## 1.3.1

*Changements depuis la 1.3.0.*

- **Statut live et Chaîne Twitch partagent maintenant les mêmes identifiants.** Vous ne les saisissez qu'une fois, dans la Chaîne Twitch ; si vous les aviez déjà dans Statut live, un bouton les y reprend sans rien perdre. Sans identifiants, le lecteur n'apparaît plus (plus de panneau blanc « hors ligne »). Mettez à jour les deux ensemble.
- **Planning : choisissez l'apparence.** Liste classique, liste en alternance comme sur l'ancien site, semaine en grille, timeline, affiches, ou « à la une » : un aperçu de chaque choix est montré dans l'admin. Rien ne change tant que vous ne choisissez pas (module 1.3.0).

## 1.3.0

*Changements depuis la 1.2.1.*

- **Un seul carnet de contacts.** Chaque personne n'existe plus qu'une fois, dans le module Contacts ; les partenariats ne font que s'y référer. Les assistants savent désormais dans quel module écrire (mises à jour 1.1.0 de Contacts et de Partenariats).
- **Les contacts d'un partenaire sont de retour sur sa fiche.** On y retrouve leur nom, leur fonction et leur e-mail, on en ajoute ou on en retire, sans jamais effacer la personne du carnet.
- **Un bouton pour fusionner vos contacts existants.** Il montre d'abord ce qui serait fait, ne touche à rien sans votre accord, garde vos anciens contacts en copie et peut être annulé.

## 1.2.1

*Changements depuis la 1.2.0.*

- **Labyrinthe : le marcheur ne s'arrête plus.** Il pouvait se figer pour de bon après quelques instants, surtout avec un tracé dessiné à la main. Il continue sa promenade et se remet tout seul en route si quelque chose le bloque (module 1.0.2).
- **Overlay sponsors : plus de texte coupé.** Le titre et la légende du QR code s'affichent en entier (sur deux lignes si besoin), et le bandeau se réduit tout seul pour rester visible dans une petite source navigateur d'OBS. Mise à jour 1.0.1.

## 1.2.0

*Changements depuis la 1.1.0.*

- **Planning : les jaquettes des jeux sont de retour.** Pour chaque jeu écrit dans la description d'un événement (ligne « Jeu : … »), l'image du jeu s'affiche sur la page du planning, sur l'accueil, dans l'admin et sur l'image à partager. La clé RAWG se saisit une seule fois, dans Réglages du site ; sans elle, seul le nom du jeu s'affiche, et l'admin vous le dit.
- **Planning : le « prochain stream » de l'accueil devient une vraie carte.** Jaquette du jeu, jour et heure bien lisibles, « dans 3 h » ou « demain », bouton vers votre chaîne ; sans jeu (soirée caritative…), le logo de votre site sur fond mauve Twitch ; et un joli message quand rien n'est prévu.
- **Planning : un tutoriel et un fichier pour votre IA.** Dans la page du module, « Comment remplir mon agenda Google ? » explique où écrire le titre, le jeu et l'heure. « Télécharger le skill pour mon IA » donne un fichier à confier à votre assistant pour qu'il remplisse l'agenda correctement.
- **Statut live Twitch : le lecteur n'apparaît plus quand vous êtes hors ligne.** Avec vos identifiants Twitch, il ne s'affiche qu'en direct, plus de grand panneau blanc « hors ligne » (réglage « Quand afficher le lecteur » pour le garder toujours). Mise à jour 1.0.2.
- **Planning : l'image du panneau Twitch reprend l'allure de l'ancienne.** Une ligne par jour, deux streams au plus, avec les jaquettes à côté de l'heure et du titre. Elle se trouve à l'adresse `/m/<nom du module>/image` ; `?week=1` donne la semaine suivante.
- **Suggestions de jeux : les jaquettes manquantes sont retrouvées toutes seules.** Les suggestions arrivées sans image (reprises de l'ancien site, restaurées d'une sauvegarde, ou ajoutées pendant une panne de RAWG) sont cherchées petit à petit, sans jamais ralentir le site ni harceler RAWG. Dès qu'une clé est saisie ou corrigée, la recherche reprend.
- **Suggestions de jeux : un bouton « Rechercher les jaquettes manquantes ».** Il lance la recherche tout de suite et dit en clair ce qui s'est passé : combien de jaquettes trouvées, combien sans résultat, ou si la clé est absente, refusée ou si RAWG ne répond pas.
- **Une seule clé RAWG pour tout le site.** Les modules utilisent la clé des Réglages du site (il faut une version de Curiosa qui la propose). Sur une version plus ancienne, les suggestions de jeux gardent leur ancien champ de clé.
- **Les réseaux sont rangés par plateforme.** Les modules Twitch, Discord, YouTube et les réseaux sociaux se déclarent comme appartenant à leur plateforme, pour que l'administration puisse bientôt les regrouper au même endroit. Ils proposent une mise à jour (1.0.1) sans autre changement pour vous.
- **Labyrinthe : les boutons du tracé ne détruisent plus rien.** « Générer un nouveau tracé » et « Supprimer le tracé » préparent seulement le changement dans l'éditeur : rien n'est modifié tant que vous n'avez pas enregistré, et « Annuler les modifications » revient en arrière. Il faut Curiosa 0.1.10.

## 1.1.0

*Changements depuis la 1.0.0.*

- **Un module par réseau social.** Instagram, TikTok, X, Facebook, Discord, GitHub, Bluesky, Mastodon, Threads, Kick, Spotify, Reddit, Patreon, Ko-fi, Snapchat, Pinterest, Telegram, Steam, SoundCloud et Bandcamp. Vous indiquez votre identifiant ou l'adresse de votre profil, et l'icône apparaît dans l'en-tête du site.
- **Plusieurs comptes du même réseau.** Vous pouvez ajouter le même module plusieurs fois : votre chaîne Twitch et celle d'un ami, par exemple. Les modules Twitch et YouTube en profitent aussi.
- **Twitch et YouTube affichent leur bouton.** Ils s'ajoutent aux réseaux de l'en-tête, sans les saisir une deuxième fois.
- **Bandeau d'accueil plus simple.** Le titre et l'introduction sont déjà remplis avec ceux du site. Le bouton et la vidéo de fond s'ajoutent seulement si vous en voulez.
- **« Réseaux sociaux » devient « Liste de liens ».** Ce module sert pour vos sites et vos projets ; les réseaux ont maintenant les leurs.

## 1.0.0

*Première version du dépôt de modules, séparé du cœur de Curiosa.*

- **Tous les modules au même endroit.** Blog, réseaux sociaux, codes promo, pages, formulaire de contact, sponsors, planning, chaînes Twitch et YouTube… 21 modules et 2 exemples, installables depuis le Catalogue.
- **Une version figée pour chaque module.** Le Catalogue installe exactement la version relue, jamais un travail en cours.
- **Modules suggérés au départ.** Blog, réseaux sociaux et pages sont proposés lors de la première installation, et peuvent être passés sans risque.

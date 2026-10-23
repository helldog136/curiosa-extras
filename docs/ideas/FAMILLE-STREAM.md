# La famille « Interaction en stream » (idée née du module Sondages)

Principe : la communauté participe depuis son téléphone (une page publique, sans compte, sans application), la streameuse pilote depuis son téléphone ou son ordinateur (une page de commande très simple, grands boutons), et tout ce qui doit se voir à l'écran passe par une **source navigateur OBS** transparente (même mécanique que les overlays existants). Aucun argent réel, aucune donnée inutile, tout se purge seul.

## La base commune (à construire une fois, utilisée par tous)
Aujourd'hui chaque module devrait réinventer : l'identité anonyme d'un participant, la limite de votes, le pseudo, la modération, le direct sur l'overlay, la télécommande de la streameuse, la purge RGPD. Proposition : un petit module fournisseur **« Participation »** (`audience`, service `audience.session`) qui possède ces briques, et que les modules ci-dessous appellent :
- **identité anonyme** : un jeton aléatoire dans le navigateur, jamais un cookie de suivi ; pseudo choisi par la personne (liste de mots interdits modifiable, pseudo unique par session) ; possibilité de se lier à une fiche Contacts seulement si la personne le demande ;
- **limites** : débit, un participant = une voix, anti-doublons sans garder d'adresse IP en clair ;
- **télécommande** : une page secrète « En direct » pour lancer, arrêter, passer au suivant, avec de gros boutons ;
- **direct** : mise à jour de l'overlay et de la page publique par interrogation douce et bornée (pas de boucle serrée), avec repli lisible ;
- **journal d'audit** minimal (qui a décidé quoi, quand) et **purge** automatique à la lecture (pas de minuteur de fond) ;
- **mode modération** : mettre un participant en sourdine, vider une salle.
Les modules qui en dépendent restent utilisables seuls (repli simple) tant que la base n'est pas installée ; Emma n'a rien à comprendre : « Participation » s'installe toute seule quand elle active un module qui en a besoin.

## Les concepts

1. **Tombola / tirage au sort (`giveaway`)** : les gens s'inscrivent sur la page (un pseudo) ou la streameuse colle une liste ; elle lance le tirage : un **tambour ou une urne animée** à l'écran (désactivée si mouvement réduit), un ou plusieurs gagnants, une **réserve** si le gagnant est absent (« tirer à nouveau » en un clic), exclusions (modérateurs, anciens gagnants). Le plus : un **tirage vérifiable** — avant de commencer, le module publie une empreinte (hash) d'un nombre secret ; après le tirage, il révèle le nombre : n'importe qui peut recalculer le résultat et constater qu'il n'a pas été truqué. Règlement du jeu en un clic (modèle, avec lien vers les mentions légales), date limite, purge des inscrits après N jours. Rien n'est promis sur le plan légal : un rappel clair sur les règles de la plateforme et du pays.
2. **Roue du hasard (`wheel`)** : une roue personnalisée (jeux à lancer, gages, récompenses, questions) avec poids par case, couleurs lisibles, résultat affiché à l'écran et gardé dans un historique ; la roue peut être **cliquée par la streameuse ou par le chat** (vote « qui lance ? »). Idéale pour le « quel jeu ce soir » et les gages. Partage son moteur de tirage avec la tombola.
3. **Décisions du chat (rondes) (`polls` v2)** : le sondage devient une **boucle** : « toutes les 10 minutes, le chat décide » ; compte à rebours de manche, vainqueur appliqué automatiquement (affiché à l'écran), historique des décisions, égalités départagées au hasard et dites à l'écran. Possibilité de **sondage rapide en un geste** (« A ou B ? » depuis la télécommande).
4. **Quiz en direct (`quiz`)** : la streameuse prépare des questions à l'avance (texte, image, 2 à 4 réponses, durée) ; en direct, elle pousse la question, les participants répondent sur leur téléphone, le **classement s'affiche à l'écran** (rapidité + justesse, sans pression : pas de classement honteux, on affiche le top 5). Modes : « question surprise », « quiz de fin de stream », « devine le jeu à partir d'un détail ».
5. **Bingo de stream (`bingo`)** : une grille de 25 événements probables (« le streamer râle », « le chat spamme un emote », « mort en moins de 5 min »), générée au hasard pour chaque participant depuis un **modèle préparé** ; la streameuse valide les événements en direct d'un appui ; le premier à compléter une ligne gagne. Très utile pour les longs streams, les speedruns, les soirées de découverte de jeux ; zéro compte, résultats en direct.
6. **Prédictions (sans argent) (`predictions`)** : « Va-t-elle battre le boss en moins de 10 essais ? » Les participants parient des **points virtuels non convertibles** (jamais d'argent réel, aucun achat, rien d'échangeable) ; classement mensuel des meilleures prévisions. Insiste sur la différence avec les paris : le module le dit en clair et ne propose aucune boutique de points.
7. **Mur de questions (`ama`)** : pour les streams discussion, IRL et AMA : les participants posent des questions, les autres **votent pour celles qui comptent**, la streameuse choisit « la suivante » et la question s'affiche à l'écran ; filtre anti-spam, mots bloqués, une question par minute, « déjà répondu » classé à part, export du Q&R pour en faire un article FAQ.
8. **Jauge d'objectif (`goal-bar`)** : une barre à l'écran (« 100 votes pour débloquer le quiz bonus », « 50 messages pour la danse de la victoire ») alimentée à la main, par les votes d'un sondage ou par les inscrits d'une tombola ; paliers avec récompenses, effet discret à chaque palier. Peut afficher un objectif de followers saisi à la main ou lu depuis les statistiques de la communauté.
9. **Subathon / minuteur évolutif (`subathon`)** : un compte à rebours qui **s'allonge** quand des choses arrivent (ajout manuel de temps en un bouton, ou après un vote de la communauté) avec plafond, journal, pause et reprise ; s'appuie sur le module Compte à rebours pour l'affichage, sans en dupliquer les règles.
10. **Chasse au mot secret (`secret-word`)** : la streameuse dit un mot ou un code pendant le stream ; les participants le tapent sur le site pour gagner un point ou débloquer une page bonus (s'appuie sur le module des codes existant plutôt que de le remplacer) ; palmarès à la fin du mois.
11. **Cartes de présence (« Qui est là ? ») (`presence`)** : les participants se « signalent » d'un geste ; un petit mur de pseudos à l'écran (ou un compteur) pour dire bonjour ; sert aussi de **liste d'inscription** au bingo, au quiz ou à la tombola.
12. **Bibliothèque de sons et d'alertes déclenchables par la communauté** : à voir plus tard (demande des garde-fous de volume et d'abus).

## Pourquoi cette famille est cohérente
- Un seul endroit pour la télécommande et pour la modération : la streameuse apprend UN geste.
- Les mêmes limites de sécurité partout (une voix, pas de cookie de suivi, purge).
- Chaque module reste simple, utile seul, et peut se combiner (un objectif qui se débloque grâce à un sondage, une tombola réservée à ceux qui ont joué au quiz).

## Garde-fous éthiques et légaux (à écrire noir sur blanc dans l'admin)
- Aucun argent réel, aucune mise, aucun point convertible ou achetable. Les « prédictions » ne sont pas des paris.
- Tombola : règlement, âge, pays, règles de la plateforme de diffusion ; le module aide mais ne remplace pas un avis juridique. Le tirage vérifiable est un moyen de prouver l'équité, pas de la garantir.
- Données : pseudo + jeton anonyme, purge automatique, aucune adresse IP en clair, suppression à la demande.
- Modération : tout contenu écrit par un visiteur (pseudo, question) passe par une liste de mots interdits, une limite de débit et un moyen de le retirer en un clic.

## Ordre de construction proposé
1. **Base « Participation »** (avec Sondages v2 : rondes et télécommande) — c'est le socle.
2. **Tombola** (la plus demandée, et la plus visible) + **Roue** (même moteur de tirage).
3. **Bingo** et **Quiz** (les deux « jeux » du chat).
4. **Mur de questions** et **Jauge d'objectif**.
5. **Subathon**, **Mot secret**, **Présence**, **Prédictions**.

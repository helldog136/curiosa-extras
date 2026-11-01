# Jeu du jour

Un petit jeu **une fois par jour**, pour donner au public une raison de revenir : un **quiz** (une question, 2 à 4 réponses, une explication après la réponse, une quinzaine de secondes de jeu), puis « revenez demain ». Pas de compte, pas de cookie : la **série de jours** et le **meilleur score** restent dans le navigateur de chaque personne.

## Ce que voit la personne qui visite
- **La page du jeu** (`/jeu-du-jour`, le chemin se change) : la question du jour, les réponses, un bouton « Valider ma réponse ». Ensuite : bonne ou mauvaise réponse, **l'explication**, le score, la série (« 3 jours de suite ! ») et « Revenez demain pour une nouvelle question ».
- **La même question pour tout le monde** le même jour. Le jour change à minuit, dans le fuseau horaire que vous réglez : c'est le site qui le décide, pas l'horloge de la personne qui visite.
- **Un chronomètre en bonus**, jamais une limite : on peut prendre tout son temps, ou le décocher d'un clic. S'il reste du temps, quelques points de bonus.
- **Un résultat à partager** en texte, sans dévoiler la réponse : « Quiz du jour — 3 jours de suite ! ».
- **Un bloc facultatif pour la page d'accueil** (« Le jeu du jour ») : « à jouer », « déjà joué » ou la série en cours.
- **Accessible** : tout se fait au clavier, un lecteur d'écran annonce le résultat, la bonne ou la mauvaise réponse n'est jamais montrée par la seule couleur, les animations sobres s'arrêtent si la personne qui visite a demandé moins de mouvement.
- **Effaçable en un clic** : le bouton « Effacer mes données de ce jeu » retire la série et les scores du navigateur. Si le navigateur bloque son stockage, le jeu marche quand même (la série n'est simplement pas retenue).

## Ce que fait la personne qui gère le site (pas à pas)
1. Elle installe le module : la page existe et propose **« Par où commencer ? »** : le gabarit **Culture jeu vidéo** (30 questions prêtes, en français et en anglais, publiées) ou **Vide** (elle écrit les siennes).
2. Onglet **Mes questions** : « Ajouter une question » : trois champs, la question, les réponses (une par ligne, de 2 à 4) et le numéro de la bonne. L'explication, l'image et sa description, les autres langues, la catégorie, la difficulté, la date précise et l'état sont repliés sous « Plus d'options ». La liste a une recherche en direct et des pastilles d'état. Les erreurs s'affichent sous le champ, avec un exemple.
3. **Brouillon ou publiée** : un brouillon n'est jamais joué. **Aperçu** : voir la question comme le public, avec la bonne réponse marquée.
4. **Planifier** : mettre une date précise sur une question (une fête, un événement) ; elle passe ce jour-là, avant la rotation. 365 jours planifiés au plus.
5. **Ordre** (réglage) : « dans l'ordre » (une par jour, dans l'ordre qu'elle choisit avec ↑ ↓) ou « au hasard sans répétition » (toutes passent avant qu'une revienne). Dans les deux cas, tout le monde a la même question, sans minuteur.
6. Le tableau de bord dit **« Il reste N jours de questions »** et montre les 7 prochains jours. Une pastille avertit quand il en reste moins de 3.
7. Onglet **Packs et fichiers** : activer ou retirer un pack en un clic, **importer** un tableur enregistré en .csv, **exporter** toutes les questions, télécharger un fichier d'exemple.
8. Elle peut changer les mots du jeu (nom, phrase de série, message « revenez demain »…) dans les réglages.

## Les packs de départ
Deux packs de 30 questions, **chacune en français et en anglais** : *Culture jeu vidéo* et *Culture du streaming*. Ils ne contiennent aucun nom de marque, de personne ou de site. Une fois activé, un pack se modifie comme vos propres questions ; le retirer supprime ses questions.

## Réglages
Ordre des questions (dans l'ordre par défaut) · fuseau horaire · chronomètre (proposé et coché / décoché / absent) · bouton « Copier le résultat » (oui) · **classement de la semaine** (non) · état du jeu sur le bloc d'accueil (oui) · « Mes mots » (nom du jeu, texte d'introduction, texte du bouton, phrase de série, message « revenez demain »). En mode avancé : secondes du bonus de rapidité (15), réponses permises par personne et par heure (40), type de jeu (quiz).

## Plusieurs jeux
On peut créer **plusieurs instances** : un quiz par thème, chacun avec sa page, ses questions, son ordre, ses mots et sa série séparée dans le navigateur.

## Classement de la semaine (facultatif)
Désactivé au départ. Activé, et si l'outil de participation du site est installé (il propose de l'installer), les personnes qui le veulent choisissent un **pseudo** et apparaissent au classement de la semaine (lundi à dimanche). Sans cet outil, rien n'est affiché. Jamais d'adresse gardée ; les semaines de plus de 4 semaines disparaissent d'elles-mêmes ; « Quitter le classement » ou « Effacer mes données » retire la personne. Vous pouvez retirer une ligne ou vider la semaine.

## Ce qui est gardé (vie privée)
- **Chez la personne qui visite** (stockage du navigateur) : série, meilleur score, nombre de parties, préférence du chronomètre, et — seulement s'il rejoint le classement — son pseudo et un code privé au hasard.
- **Sur le site** : vos questions, ce qui est déjà passé (pour ne pas répéter), et, si le classement est activé, pseudo et points de la semaine. La réponse d'une personne n'est **pas** enregistrée.
- Aucun cookie. Aucune adresse n'est gardée : une empreinte brouillée, en mémoire quelques heures, sert à freiner les envois en masse.

## Bornes
2 000 questions · 365 jours planifiés · 300 caractères pour une question ou une explication, 120 pour une réponse · 4 réponses au plus · 100 lignes au classement · 4 semaines de classement · 1 Mo pour un fichier importé · 50 questions par page dans l'administration. Rien ne tourne en arrière-plan.

## Ce que le module ne garantit pas (honnêtement)
- **Pas de triche impossible** : la bonne réponse n'est jamais envoyée avant la réponse, et le site la juge lui-même, mais une personne déterminée peut rejouer en vidant son navigateur. Il n'y a pas d'enjeu : n'utilisez pas ce jeu pour un concours.
- Le classement compte « un navigateur », pas « une personne ».
- Changer la question d'aujourd'hui après que des gens ont joué est possible mais déconseillé.

## Ce que le module ne fait pas
Pas de compte, pas de classement par défaut, pas de jeu d'image ni de mot du jour pour l'instant (la table des types de jeu est faite pour les accueillir, voir plus bas), pas de statistiques sur les réponses du public.

## Pour qui développe
- **Types de jeu** : `games.mjs` contient la table des types (`registerGameType`). Le quiz est le premier. Pour en ajouter un : écrire un objet qui respecte le contrat décrit en tête de `games.mjs`, ajouter une option au réglage `gameType` de `module.json` et les textes de `locales/`, ajouter l'entrée du type dans `TYPES` de `client.mjs` (lire la réponse, montrer le résultat), puis régénérer `scripts/daily-game.js` (copie exacte de `CLIENT_JS`). Le choix de la question du jour, la série, le partage, le classement, le planning, l'import et les packs marchent sans autre changement.
- **Choix de la question du jour** (`plan.mjs`) : fonctions pures. Question planifiée à la date, sinon tirage dans un « sac » (dans l'ordre ou au hasard déterministe selon la date et une graine), figé dans l'historique à la première visite du jour (400 jours gardés).
- **Routes** : `answer` (POST, juge la réponse), `board` (POST, classement), `card.js` (GET, petit script du bloc d'accueil). Limites par personne (empreinte du cœur) et limite globale, piège à robots, corps bornés.
- **Service facultatif** `audience.session` : pseudo, une participation par jour (`claim`), limites. Sans lui, pas de classement, et le module marche seul.
- **Données** : `dg_questions`, `dg_plan` (un document), `dg_board` (un document par semaine).
- **Outils pour l'assistant** : `daily_questions_list` (lecture) et `daily_question_add` (écrit un **brouillon** seulement ; jamais accordé d'office).
- Droits : `edit`, `publish`, `moderate`. `minCore` 0.2.6 (script de page, empreinte de la personne qui visite).

## Jeu du jour : une question par jour pour donner envie de revenir

*Un quiz quotidien sans compte, avec série de jours dans le navigateur. Pour Curiosa 0.2.6 ou plus. Module nouveau : Jeu du jour 1.0.0.*

### Nouveautés
- Un petit jeu une fois par jour : un quiz (une question, 2 à 4 réponses, une explication, « revenez demain »), la même question pour tout le monde, le jour changeant à minuit dans votre fuseau.
- La série de jours et le meilleur score restent dans le navigateur de chaque visiteur : pas de compte, pas de cookie, un bouton pour tout effacer.
- Un chronomètre en bonus (jamais une limite, décochable) et un texte à partager sans dévoiler la réponse.
- Un bloc facultatif pour la page d'accueil : « à jouer », « déjà joué » ou la série en cours.
- Une banque de questions facile : brouillon ou publiée, image, catégorie, difficulté, date précise, aperçu, ordre, « il reste N jours de questions ».
- Deux packs de 30 questions en français et en anglais (jeu vidéo, streaming) et deux gabarits au départ (« Culture jeu vidéo », « Vide »).
- Import et export de fichiers CSV (un tableur), avec des erreurs expliquées ligne par ligne.
- Un classement de la semaine, facultatif, avec pseudo (grâce à Participation).
- Plusieurs jeux possibles (un quiz par thème) et des mots que vous changez.
- Pour votre assistant : lire les questions et proposer des brouillons (jamais accordé d'office).

### Améliorations
- Accessible : clavier, lecteur d'écran, mouvement réduit, contrastes du thème.
- Aucune adresse n'est gardée ; les anciennes semaines de classement disparaissent d'elles-mêmes.

### Pour les développeurs
- `minCore` 0.2.6. Fichiers : `lib`, `games` (table des types de jeu extensible), `plan` (choix de la question, fonctions pures), `data`, `packs`, `csv`, `bridge`, `view`, `client`, `routes`, `admin`, `mcp`. Tous les imports voisins portent la version (`await import(`./x.mjs${q}`)`) ; test de mise à jour à chaud.
- Routes `answer`, `board` (POST) et `card.js` (GET). `scripts/daily-game.js` = copie exacte de `CLIENT_JS` (test). Collections `dg_questions`, `dg_plan`, `dg_board`. Service facultatif `audience.session`.
- Outils : `daily_questions_list`, `daily_question_add`. Droits : `edit`, `publish`, `moderate`.
- Tests : `daily-game-plan`, `-public`, `-routes`, `-admin`, `-packs`, `-types`, `-update` ; aide `tests/helpers/dailyGameKit.mjs` (avec `fakeAudience`).

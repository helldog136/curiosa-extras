## Suggestions de jeux 1.5 : ajoutez vous-même un jeu à la liste

*Remplissez votre liste de jeux (par exemple « Jeux joués ») directement depuis l'administration. Pour Curiosa 0.2.10 ou plus. Module touché : Suggestions de jeux 1.5.0.*

### Améliorations

- **Un formulaire « Ajouter un jeu » en haut de l'administration.** Un seul champ à remplir : le nom du jeu. Le statut est « Déjà joué » au départ (vous pouvez en choisir un autre), la note est facultative. La jaquette est trouvée toute seule ; si ce n'est pas le bon jeu, le lien « Ce n'est pas le bon jeu ? » est là.
- **Plusieurs jeux d'un coup.** « Ajouter plusieurs jeux d'un coup » : collez votre liste, un jeu par ligne (50 au plus par envoi). Si une ligne pose problème, rien n'est ajouté et les lignes à corriger sont indiquées sous le champ.
- **Pas de doublon par erreur.** Si le jeu est déjà dans la liste (même écrit avec d'autres majuscules ou sans accent), le formulaire le dit sous le champ et explique comment changer son statut.
- **Une image de votre choix.** Si aucune jaquette n'est trouvée, « Choisir l'image moi-même » (replié par défaut) permet de donner l'adresse d'une image. Un bouton « Jaquette… » sur chaque ligne permet de le faire plus tard.
- **Un jeu ajouté par vous se comporte comme les autres** : il apparaît sur la page publique sans pseudo de visiteur, les visiteurs peuvent voter « rejoue-le » s'il est « déjà joué », et il est dans la sauvegarde lisible (`games.csv`, nouvelle colonne « origin »). Rien ne change pour les visiteurs. Le tableau de l'administration se lit maintenant par pages de 50.
- **Votre assistant IA peut aussi ajouter des jeux** (outil « game_suggestions_add »), avec les mêmes règles.

### Pour les développeurs

- Aucune migration : les lignes ajoutées portent `origin: "admin"` (donnée facultative ; une ligne sans `origin` vaut « visiteur »). `dataVersion` reste 2, `minCore` reste 0.2.10, aucune nouvelle permission.
- `addGames(ctx, { lines, status, note, image, field })` (exportée) : tout ou rien, 50 lignes au plus, doublons par `titleKey` (sans accents, majuscules ni ponctuation, lignes rejetées comprises), plafond de 2000, jaquette par `coverFor` (service `game.cover`, repli `ctx.api.rawg`) : 1 recherche pour un jeu, 10 au plus en lot, le reste est laissé à la tâche de rattrapage existante (aucun nouveau minuteur). Image à la main : `imageUrlOf` (https, 500 caractères, sans espace), marquée `coverResult: "manual"`.
- Nouvelles actions d'admin `addGame`, `addGames`, `setImage` (fonctions : administrateurs, comme `status_*`) ; erreurs par champ (`errors`). `adminPanel(ctx, { query })` lit `ajout` (`plusieurs` | `image`), `jaquette` (id d'une ligne) et `page`.
- Outil MCP `game_suggestions_add` (écriture) ; `game_suggestions_list` renvoie `origin`. `rows(ctx, limit)` lit jusqu'à 2000 lignes pour l'admin, l'export et la détection de doublons (la page publique garde 1000).
- Tests : `tests/game-suggestions-add.test.mjs`.

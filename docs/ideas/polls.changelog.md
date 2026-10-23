# Sondages 1.0.0

## Nouveautés
- Créez un sondage en une minute : une question, 2 à 8 choix, un choix ou plusieurs par personne.
- Un lien à partager, une page publique avec les sondages en cours et l'historique des sondages passés, et un petit encart « Le sondage en cours » pour l'accueil.
- Une date de fin facultative (l'heure et le fuseau sont écrits clairement) : le sondage se ferme tout seul et affiche son résultat final.
- Résultats en barres lisibles (texte et pourcentage, jamais seulement la couleur), visibles tout de suite ou seulement après le vote, au choix.
- Un vote par personne, sans compte ni cookie.
- Un affichage en direct pour OBS, protégé par une adresse secrète.
- L'assistant IA peut lister, lire, créer et fermer des sondages.

## Améliorations
- Messages d'erreur sous chaque champ, avec un exemple.
- Actions graves (fermer, archiver, supprimer) avec une case de confirmation claire.
- Les votes détaillés (sans aucun nom) sont effacés 30 jours après la fin ; les totaux restent.
- Sauvegarde lisible (tableur) de tous les sondages.

## Pour les développeurs
- Module `polls` 1.0.0, `minCore` 0.2.5, type widget, instance unique, droits `manage` et `obs.view`.
- Stockage : `polls` (≤ 200), `archive` (≤ 800), `b-<id>` (≤ 5 000 bulletins), `meta`. Écritures sérialisées par instance, bulletin unique par clé (le plus ancien gagne), « Recompter » pour réparer.
- Limite de débit par empreinte HMAC à sel quotidien en mémoire ; aucun minuteur ni tâche de fond ; source OBS à interrogation douce bornée.
- Les actions d'admin sont des fonctions qui vérifient `ctx.can` (le kit 0.2.5 ne reconnaît pas la forme `{ right, run }` pour les actions liées à un formulaire).

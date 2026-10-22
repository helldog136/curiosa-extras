# Sondages 1.1.0

## Nouveautés
- **Des manches : « toutes les 10 minutes, le chat décide ».** Une question qui revient en boucle ; à la fin de chaque manche le choix qui a le plus de voix l'emporte, s'affiche en grand à l'écran, puis la manche suivante démarre. En cas d'égalité, le sort tranche, et l'écran le dit. L'historique des décisions est public (`/polls/decisions`) et téléchargeable.
- **Un lien à partager qui montre toujours la manche du moment** (`/polls/now`), avec son compte à rebours.
- **Un sondage rapide « A ou B ? »** en un geste (2 à 4 choix, 30 secondes à 5 minutes) : il passe tout de suite à l'écran.
- **Une télécommande pour votre téléphone** avec de gros boutons (lancer, suivant, arrêter, A ou B ?), grâce au nouveau module Participation, qui s'installe d'un clic depuis l'onglet « En direct ».
- L'écran de votre stream affiche le numéro de la manche, le compte à rebours, les résultats en direct et la décision prise.
- L'assistant IA peut lancer, passer ou arrêter les manches, lire l'historique et lancer un sondage rapide (ces gestes ne sont jamais autorisés d'office).

## Améliorations
- L'onglet « À l'écran » devient « En direct » et rassemble les manches, le sondage rapide et l'écran OBS.
- Les votes d'une manche sont effacés dès que la décision est prise (au lieu de 30 jours après la fin).
- Avec Participation : une voix par personne gérée en commun, la possibilité de mettre quelqu'un en sourdine, et une mise à jour de l'écran plus douce qui ralentit toute seule quand il y a beaucoup de monde. Sans elle, tout marche comme avant.

## Pour les développeurs
- Module `polls` 1.1.0, `minCore` 0.2.5. Offre `audience.remote` v1 (`each`) ; demande `audience.session` en facultatif (mode autonome conservé, délai de 3 s puis repli).
- Données ajoutées : `rounds` (≤ 500), `series` dans `meta`, file d'attente du ménage dans `cfg` ; aucune migration (`dataVersion` 1).
- Une manche = un sondage (`round: { n, run }`, caché des listes). La série avance « à la lecture » (verrou `series:` distinct du verrou des votes) ; `syncLive` publie `screen` (privé, clé = adresse secrète) et `now` (public) chez Participation, regroupé quand plusieurs votes arrivent ensemble.
- Nouveaux fichiers : `bridge.mjs` (pont vers Participation), fonctions pures `pickWinner`, `validateSeriesForm`, `validateQuick` dans `lib.mjs`. Route `client` désormais asynchrone (bibliothèque du direct livrée devant si Participation est là).
- Nouveaux outils MCP : `rounds_status`, `rounds_history`, `round_control`, `poll_quick`.

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

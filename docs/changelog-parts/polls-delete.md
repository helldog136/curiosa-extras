## Sondages 1.2.0 : supprimer un sondage, terminé ou en cours, en sachant ce qui sera perdu

*Pour Curiosa 0.2.5 ou plus. Module touché : Sondages 1.2.0.*

### Nouveautés
- **Un bouton « Supprimer » pour chaque sondage**, dans la liste et dans ses détails, pour les sondages terminés, les sondages en cours et les sondages archivés (ceux-ci apparaissent maintenant dans l'administration, 50 par page). Il ouvre une page qui dit ce qui sera perdu : « Ce sondage et ses 12 votes seront supprimés définitivement. » Rien n'est supprimé tant que la case n'est pas cochée.
- **Pour un sondage en cours, une confirmation renforcée.** La page prévient que des personnes peuvent encore voter, que les votes en cours seront perdus et que la page disparaîtra tout de suite, y compris à l'écran du stream. Elle demande une seconde case et propose de **fermer le sondage plutôt** (le résultat reste visible), avec le bouton « Fermer maintenant » juste au-dessus.
- **Tout part avec lui** : le sondage, ses choix, ses votes et ses totaux. S'il était affiché à l'écran, l'écran est libéré ; avec Participation, l'écran du stream et la page « en cours » se mettent à jour tout de suite. Les décisions des manches déjà prises ne sont jamais touchées.
- **L'ancienne adresse reste propre** : elle affiche « Ce sondage n'existe plus » (le même message qu'une adresse qui n'a jamais existé, sans rien révéler, et non indexé par les moteurs de recherche). Une source OBS réglée sur ce sondage n'affiche plus rien, au lieu de montrer un autre sondage.
- **Votre assistant IA peut supprimer un sondage** avec le nouvel outil `poll_delete`, mais seulement si vous le lui accordez expressément (jamais d'office). Un sondage encore ouvert est refusé tant que l'assistant ne précise pas `allowOpen: true` ; fermer le sondage reste le choix prudent.

### Améliorations
- La manche en cours ne se supprime pas ici : la page l'explique et renvoie vers « Suivant » ou « Arrêter ».
- Beaucoup de votes ne posent pas de problème : ils s'effacent par petites tranches. Si le travail est trop long, le sondage est fermé, le message le dit et un nouveau clic termine la suppression.
- Le message de réussite dit combien de votes sont partis.
- Rien à refaire : aucune donnée n'est modifiée, droits et réglages sont ceux d'avant. Le droit « créer, modifier, fermer et supprimer des sondages » couvre la suppression, comme avant.

### Pour les développeurs
- `polls` 1.2.0, `minCore` 0.2.5 et `apiVersion` 2 inchangés, aucune migration (`dataVersion` 1), aucun nouveau droit (`manage`). Clé `robots: "noindex"` de la page « n'existe plus » : ignorée par un cœur antérieur à 0.2.14, sans effet gênant.
- `deletePoll(ctx, id, { allowOpen })` (exportée) : relit le sondage sous le verrou, refuse la manche en cours de la série (`round`), exige `allowOpen` pour un sondage ouvert (`open`), ferme d'abord un sondage ouvert, efface les bulletins par tranches de 200 (30 tranches au plus, sinon `partial` et le sondage reste, fermé), libère `onAir`, retire la ligne en dernier, puis `syncLive`. Un identifiant qui n'est pas une ligne de sondage (vote, réglage, décision, texte forgé) donne `gone`.
- Administration : page `?delete=<id>` (formulaire `remove`, cases `confirm` et `confirmOpen`), liste des archives (`?ac=` curseur). `findById` reconnaît les archives (`archivedAt`). `onAirPoll` : une adresse OBS `?poll=` introuvable donne un écran vide.
- Journal d'audit : celui du cœur (`module.<clé>.remove`, `poll_delete` pour l'assistant). Participation (`audience.session`) garde des « voix » `v-<id>` par salle, qui expirent chez lui ; Sondages n'a pas de moyen de les retirer.
- Tests : `tests/polls-delete.test.mjs` (nouveau, 19 tests) ; `polls.test.mjs` et `polls-rounds.test.mjs` ajustés (adresse inconnue, version, suppression d'un sondage en cours).

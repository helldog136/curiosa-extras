## Jaquettes de jeux 1.0.0 : un module pour les jaquettes

*Les jaquettes de jeux quittent le cœur de Curiosa et deviennent un module à part entière. Pour Curiosa 0.2.13 ou plus (la reprise automatique demande la version du cœur qui l'accompagne). Modules touchés : Jaquettes de jeux 1.0.0 (nouveau), Suggestions de jeux 1.4.0, Planning 2.4.0, Story d'annonce 2.4.0.*

### Nouveautés

- **Un module « Jaquettes de jeux ».** Votre clé RAWG s'y saisit une seule fois, elle n'est jamais réaffichée, et un bouton « Tester la clé » dit en mots simples si elle fonctionne. Les modules qui affichent des jaquettes passent par lui.
- **Rien à refaire si vous aviez déjà une clé.** À la mise à jour, le module s'installe tout seul sur les sites qui utilisaient RAWG, et votre clé comme vos corrections « Quel est le bon jeu ? » le rejoignent sans être ressaisies. Si vous revenez en arrière, l'ancien réglage du site reprend la main.
- **Les liens « Ce n'est pas le bon jeu ? » déjà publiés continuent de marcher** : ils ouvrent l'écran du module, sur le bon titre. L'assistant IA garde ses deux outils de jaquettes, avec les mêmes noms.

### Améliorations

- **Suggestions de jeux, Planning et Story d'annonce** demandent la jaquette au nouveau module. Sans lui, ils continuent d'utiliser l'ancienne interface du site : aucune jaquette ne disparaît entre deux mises à jour.
- **Plus clair quand la clé manque** : au lieu de renvoyer vers les réglages du site, ces modules renvoient vers « Jaquettes de jeux », ou proposent de l'installer d'un clic.

### Pour les développeurs

- Nouveau service `game.cover` (v1) : `status`, `cover({ title })`, `candidates({ title, search? })`, `fix` (droit `fix`, `asCaller`) et `adopt`. Besoin facultatif : `"requires": [{ "service": "game.cover", "optional": true }]`, repli sur `ctx.api.rawg` (permission `rawg` conservée) tant que la cale du cœur existe (retrait prévu en 0.3.0).
- `game-covers` 1.0.0 : clé en réglage `secret` (`apiKey`) ou reprise (`adoptedKey`, jamais affichée), requêtes par `ctx.api.net` (5 s, 256 Ko), cache mémoire borné (24 h / 1 h / 500), corrections dans `fixes` (clé = titre normalisé, 1 000), journal `todo` (100, 60 jours, purge à la lecture), pages de 25 par curseur. Même barème de ressemblance que le cœur (`match.mjs`, test repris tel quel).
- Écran : `adminPanel` lit `?titre=`, `&q=`, `&cursor=` ; les choix passent par des boutons de ligne dont l'identifiant porte `rawgId|titre|recherche`. Outils MCP `rawg_covers_to_check` et `rawg_cover_set` (mêmes réponses qu'avant).
- Suggestions de jeux 1.4.0, Planning 2.4.0, Story d'annonce 2.4.0 : `requires` facultatif, `minCore` inchangé (0.2.10), bloc `suggestInstall` quand la clé manque. Test : `tests/game-covers-consumers.test.mjs`.

# Raid Twitch 2.2.0

## Nouveautés
- **Sélection du moment** : le dock peut montrer 5 membres en direct tirés au hasard (de 1 à 10), au lieu de toute la liste. La sélection reste la même pendant 10 minutes pour tout le monde, puis se renouvelle. Un bouton « Tirer de nouveau » en tire une autre tout de suite.
- **Équitable** : les mêmes personnes ne reviennent pas tant que d'autres sont en direct. Option « petites chaînes d'abord » et liste de pseudos à ne jamais tirer.
- **Page publique « En direct chez nos membres »** (facultative, éteinte au départ) : mêmes membres, avec jeu, titre, spectateurs, durée et un bouton « Regarder sur Twitch ». Elle se met à jour toute seule, garde la dernière sélection si Twitch ne répond pas, et dit gentiment quand personne n'est en direct. Titre, texte et bouton se changent dans les réglages.
- **Une adresse à part pour OBS**, secrète comme celle du dock (la même clé).

## Améliorations
- Les personnes rangées dans « Ne pas montrer » dans Contacts ne sont jamais tirées ni montrées ; la liste complète n'est jamais publique.
- Le dock d'avant ne change pas : rien à faire pour les sites qui l'utilisent déjà.
- Une seule demande à Twitch pour tous les visiteurs (jusqu'à 100 chaînes à la fois).
- Les aperçus des directs sont une option : les images ne se chargent que si le visiteur clique.

## Pour les développeurs
- `twitch-raid` 2.2.0, `minCore` 0.2.6 (script de page). Nouveaux fichiers serveur : `draw.mjs` (tirage pur, graine, rotation, poids, exclusions), `moment.mjs` (sélection, tranches, remplacement, repli 10 min), `consent.mjs` (catégorie « Ne pas montrer » + `resolve`), `public.mjs` (page, route `members`), `featured-dock.mjs`, `moment-admin.mjs` (onglet `moment`), `scripts/live-members.js`. `search.mjs` : ajout de `findMany` (mêmes bornes que `findRandom`). `streams.mjs` : `thumbOf`/`thumbUrl` (WeakMap, la forme des entrées ne change pas). `dock.mjs` : seulement `export` de `CSS` et `headers`.
- Routes : `featured`, `featured-data`, `featured-again` (clé secrète), `members` (publique). `page: true`, `basePath` proposé « en-direct » (les instances existantes n'ont pas d'adresse). Outil MCP `raid_featured_now`. 12 réglages ajoutés (onglet `moment`).
- Tests : `twitch-raid-compat` (empreintes du dock 2.1, `tests/helpers/twitch-raid-golden.mjs`), `twitch-raid-draw`, `twitch-raid-moment`, `twitch-raid-public` ; aide `twitch-raid-world.mjs`. Tests existants de Raid mis à jour (routes, actions, permissions, version).
- Conflits probables : `catalogue/index.json` (version 2.2.0, minCore).

## Raid Twitch 2.2.3 : une administration aux mots neutres

## Améliorations
- L'administration de Raid Twitch ne parle plus de « membres » ni de « communauté » : elle dit « chaînes », « la liste » ou « les personnes à qui vous donnez l'adresse ». C'est vrai pour l'introduction, les étapes pour ajouter le dock dans OBS, l'aide de « Nouvelle adresse », l'explication du mode du dock, l'onglet « Sélection du moment » et ses messages, ainsi que le réglage « Combien de chaînes montrer ».
- Les mots sont les mêmes en français et en anglais, et ils conviennent à n'importe quel site. Rien ne change dans le dock que vous avez déjà ajouté dans OBS, ni dans vos réglages. Si vous aviez saisi vos propres textes, ils restent tels quels.

## Pour les développeurs
- `twitch-raid` 2.2.3 (aucune migration, aucun nouveau fichier serveur). Textes seulement : `locales/fr.json` et `locales/en.json` (`admin_intro`, `addr_steps`, `renew_help`, `mode_full`, `mode_full_one`, `mode_random`, `mo_intro`, `mo_addr_steps`, `mo_check_ok`, `mo_check_none`, `mo_warn_count`), `module.json` (description, libellé et aide de `count`, description de l'outil `raid_featured_now`), README, `docs/ideas/assoc-raid-random*.md`. Clés de réglages et noms d'outils MCP inchangés.
- Aucun texte verrouillé par les empreintes du dock 2.1 (`twitch-raid-compat`) ne contenait ces mots : le dock est identique. Les commentaires du code gardent « membre » (pas de texte affiché).
- Tests : `twitch-raid-page-optin` (nouveau test : plus de « membre(s) », « communauté », « association » dans les textes par défaut hors dock verrouillé, manifeste et README ; parité FR/EN), `twitch-raid-large` et `twitch-raid-public` mis à jour pour les nouvelles phrases.

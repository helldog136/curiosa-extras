## Discord : une adresse courte /discord créée pour vous

*Le module Discord peut maintenant demander au cœur de créer l'adresse courte « votresite.be/discord », qui mène à votre invitation et reste la même si elle change. Éteint par défaut. Discord 1.3.0, pour Curiosa 0.6.0 ou plus ; l'adresse courte apparaît avec la prochaine version du cœur (sur un cœur plus ancien, rien ne change).*

### Nouveautés

- **Une adresse courte pour votre Discord.** Allumez « Créer une adresse courte pour votre Discord » dans les réglages : l'adresse `/discord` mène à votre invitation. Elle apparaît dans « Raccourcis de liens » avec la pastille « Extension Discord », et ses clics sont comptés comme ceux de vos autres liens courts.
- **Vos liens ne sont jamais touchés.** Si le nom est déjà pris par l'un de vos liens, rien n'est créé : le message sous le champ vous propose un autre nom. Le nom se change sous « Plus d'options ».
- **Elle suit votre invitation.** Si vous changez d'invitation, l'adresse courte suit sans perdre ses chiffres. Si vous coupez l'option ou retirez le compte, elle disparaît.
- **Le bouton de l'en-tête ne change pas tout seul.** Il passe par l'adresse courte, et ses clics sont comptés, seulement si « Compter les clics sur mes liens » est activé.

### Pour les développeurs

- **Clé `shortLink` de `module.json`** (cœur après 0.6.3) : `{ "enabled": "createShortLink", "name": "shortLinkName", "default": "discord", "target": "social.link" }`. Aucun code dans `index.mjs` : le cœur crée, met à jour et retire le lien (colonne `Redirect.managedBy`). Pas de nouvelle permission ni de `minCore` plus haut : un cœur plus ancien ignore la clé.
- **`tests/discord-shortlink.test.mjs`** : le manifeste (éteint par défaut, nom replié, textes) tourne avec tout cœur ; les scénarios (création, nom pris, changement d'adresse, option coupée, bouton de l'en-tête) tournent quand le cœur testé contient `src/core/managedRedirects.ts`.
- Versions : dépôt 1.35.0 ; Discord 1.3.0.

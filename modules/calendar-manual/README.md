# Streams saisis à la main — module communautaire de Curiosa

Pour qui **n'a pas d'agenda en ligne** : écrivez vos streams directement dans l'administration de votre site. Ils apparaissent tout seuls sur le **Planning des streams** et le **bot Twitch** s'en sert pour répondre à `!planning`.

Il faut Curiosa 0.2.2 ou plus.

## Ajouter un stream

Un petit formulaire :

- **Titre** et **jour**.
- **Heure de début** (par exemple `21:00`) et **heure de fin** (facultative : une fin avant le début veut dire que le stream finit le lendemain ; sans heure de fin, le stream reste affiché 2 heures).
- **Jeux** (facultatif) : le nom exact du jeu pour retrouver sa jaquette, plusieurs jeux séparés par une virgule (trois au plus). Rien pour une soirée sans jeu.
- **Répétition** : *Une seule fois* ou *Chaque semaine*, avec une date de fin facultative. Pour une semaine sans stream, notez sa date dans **« Dates à sauter »**.
- **Toute la journée** et **Annulé** : un stream annulé reste dans la liste, le planning peut le montrer barré ou le cacher.

Le tableau en haut de la page liste vos streams avec **Modifier** et **Supprimer**. Rien n'est supprimé sans votre confirmation. Jusqu'à 500 streams.

## Les heures

Les heures que vous tapez sont celles du fuseau **Europe/Paris**. Pour un autre fuseau (exemple : `America/Montreal`), changez le réglage **« Fuseau horaire des heures que vous tapez »** (réglages avancés) : l'heure d'été est gérée. Le planning affiche les heures dans ce même fuseau, sans autre réglage.

## Plusieurs listes

Ajoutez un module « Streams saisis à la main » par liste si vous le souhaitez ; vous pouvez aussi l'utiliser avec un « Agenda en ligne » : leurs streams s'ajoutent.

## Si vous retirez ce module

*Retirer et garder mes données* met vos streams de côté : réinstaller le module les retrouve tels quels. *Retirer et tout effacer* les supprime pour de bon, après confirmation.

## Pour qui développe

Ce module fournit le sujet **`planning.slot`** (le Planning et le bot Twitch le lisent ; aucun ne connaît ce module). Contrat d'un élément : `id`, `title`, `start` et `end` (instants ISO 8601 en UTC), `allDay`, `day` (journée entière : la date `AAAA-MM-JJ`, `end` est le début du jour suivant), `games`, `text`, `status` (`confirmed` ou `cancelled`), `timezone`. Les streams sont gardés dans le stockage du module (collection `streams`) ; la logique pure est dans `schedule.mjs`.

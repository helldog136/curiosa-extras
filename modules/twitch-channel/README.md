# Chaîne Twitch — module communautaire de Curiosa

**Le seul module qui parle à Twitch.** Client id, client secret (jamais réaffichés) et chaîne se saisissent ici, une fois, avec une application Twitch à vous (dev.twitch.tv/console). Le jeton, les appels et les caches sont gérés ici, et partagés avec les modules qui en ont besoin.

Il fournit :

- le **bouton** Twitch de l'en-tête (`social.link`), aussi repris par le planning pour son bouton « Regarder sur Twitch » ;
- `stream.live` : le live en cours (titre, jeu, début, adresse), vide hors ligne. Les annonces Discord le reprennent ;
- `maze.poster` : vos derniers clips (60 jours) en affiches pour l'overlay labyrinthe ;
- le **service `twitch.live`** (pour les modules qui en dépendent, comme *Statut live Twitch* qui affiche la bannière « en direct » et le lecteur) :
  - `channel()` → `{ channel, url, configured, ready, missing }` : la chaîne de l'instance et ce qui manque, sans appel réseau ;
  - `status({ channel? })` → `{ configured, known, live, channel, url, id?, title?, game?, viewers?, startedAt?, thumbnail?, error? }` ; `known` : Twitch a répondu ; `error` : `auth`, `rate`, `network` ou `config`. Ne lève jamais ;
  - `adopt({ channel, clientId, clientSecret })` → `{ adopted: [champs], ready }` : reprise des identifiants d'un autre module (migration), qui ne remplit que les champs vides et ne renvoie jamais de valeur.

Un seul jeton par couple d'identifiants, un seul appel par chaîne (30 s ; 20 s après une erreur, 60 s après un « trop de requêtes »), même quand plusieurs modules le demandent en même temps. Plusieurs instances (une par chaîne) partagent le même jeton quand leurs identifiants sont les mêmes ; un consommateur est servi par l'instance **maître** du service.

Identifiants repris d'un autre module : ils ne sont jamais affichés ; l'admin le signale et propose « Oublier les identifiants repris ». Ce que vous saisissez dans les réglages a toujours le dessus.

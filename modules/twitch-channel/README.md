# Chaîne Twitch — module communautaire de Curiosa

**Le seul module qui parle à Twitch.** Client id, client secret (jamais réaffichés) et chaîne se saisissent ici, une fois, avec une application Twitch à vous (dev.twitch.tv/console). Le jeton, les appels et les caches sont gérés ici, et partagés avec les modules qui en ont besoin.

Il fournit :

- le **bouton** Twitch de l'en-tête (`social.link`), aussi repris par le planning pour son bouton « Regarder sur Twitch » ;
- `stream.live` : le live en cours (titre, jeu, début, adresse), vide hors ligne. Les annonces Discord le reprennent ;
- `maze.poster` : vos derniers clips (60 jours) en affiches pour l'overlay labyrinthe ;
- le **service `twitch.live`** (pour les modules qui en dépendent, comme *Statut live Twitch* qui affiche la bannière « en direct » et le lecteur) :
  - `channel()` → `{ channel, url, configured, ready, missing }` : la chaîne de l'instance et ce qui manque, sans appel réseau ;
  - `status({ channel? })` → `{ configured, known, live, channel, url, id?, title?, game?, viewers?, startedAt?, thumbnail?, displayName?, error? }` ; `known` : Twitch a répondu ; `error` : `auth`, `rate`, `network` ou `config`. Ne lève jamais ;
  - `adopt({ channel, clientId, clientSecret })` → `{ adopted: [champs], ready }` : reprise des identifiants d'un autre module (migration), qui ne remplit que les champs vides et ne renvoie jamais de valeur.

Un seul jeton par couple d'identifiants, un seul appel par chaîne (30 s ; 20 s après une erreur, 60 s après un « trop de requêtes »), même quand plusieurs modules le demandent en même temps. **Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus).** Ajoutez une instance par chaîne : l'offre `twitch.live` est « chaque instance répond » (`each`), il n'y a donc **aucun maître** à choisir. `channel()` et `status()` sans argument répondent pour la chaîne de l'instance, et *Statut live* les interroge toutes (`callAll`). Deux chaînes aux mêmes identifiants partagent **un seul jeton** ; une requête Twitch par chaîne.

**Même application Twitch pour plusieurs chaînes ?** Le réglage avancé *Utiliser les identifiants d'une autre chaîne* (identifiant de l'autre chaîne, par exemple `helldog136`) reprend son client id et son secret, **seulement là où ils sont vides** : ce que vous saisissez dans l'instance prévaut champ par champ. Un module ne peut pas lire les réglages d'une autre instance : les identifiants complets de chaque chaîne sont donc « prêtés » en mémoire (jamais affichés ni renvoyés) et une copie est gardée dans le stockage de l'instance qui emprunte, pour survivre à un redémarrage. Au tout premier affichage après un redémarrage, si l'instance qui emprunte est lue avant l'autre et n'a pas encore de copie, elle est « pas prête » un instant ; le rechargement suivant suffit. « Oublier les identifiants repris » supprime aussi cette copie.

**Reprise depuis Statut live (migration)** : avec plusieurs chaînes, la reprise va dans la **première** Chaîne Twitch (par ordre de création), uniquement dans ses champs vides ; les autres sont intactes (utilisez le réglage ci-dessus pour partager).

Identifiants repris d'un autre module : ils ne sont jamais affichés ; l'admin le signale et propose « Oublier les identifiants repris ». Ce que vous saisissez dans les réglages a toujours le dessus.

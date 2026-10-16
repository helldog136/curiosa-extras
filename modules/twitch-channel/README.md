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

- le **service `twitch.api`** (version 1.5.0, pour le *Bot Twitch*) : parler à Twitch **au nom de la chaîne sans jamais rendre un jeton**. Le module appelant décrit la demande, c'est Chaîne Twitch qui la fait avec le bon jeton et qui rend la réponse de Twitch. Liste d'appels **fermée** : côté application, lire des utilisateurs et gérer des abonnements aux évènements ; côté utilisateur, uniquement envoyer un message dans le chat. Méthodes : `account()` (état de la connexion, jamais de jeton), `wantScopes()` (un module annonce les autorisations Twitch dont il a besoin, dans une liste fermée : lire/écrire dans le chat), `connectLink()` (le bouton « Autoriser » de Twitch), `request()` et `disconnect()` (compte « bot » seulement). Un 2e compte, le **compte bot**, peut se connecter par la même adresse de retour (rien de plus à enregistrer chez Twitch) ; ses jetons restent ici aussi. Même règle « une chaîne par instance » : l'appelant passe `channel`.

Un seul jeton par couple d'identifiants, un seul appel par chaîne (30 s ; 20 s après une erreur, 60 s après un « trop de requêtes »), même quand plusieurs modules le demandent en même temps. **Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus).** Ajoutez une instance par chaîne : l'offre `twitch.live` est « chaque instance répond » (`each`), il n'y a donc **aucun maître** à choisir. `channel()` et `status()` sans argument répondent pour la chaîne de l'instance, et *Statut live* les interroge toutes (`callAll`). Deux chaînes aux mêmes identifiants partagent **un seul jeton** ; une requête Twitch par chaîne.

**Même application Twitch pour plusieurs chaînes ?** Le réglage avancé *Utiliser les identifiants d'une autre chaîne* (identifiant de l'autre chaîne, par exemple `helldog136`) reprend son client id et son secret, **seulement là où ils sont vides** : ce que vous saisissez dans l'instance prévaut champ par champ. Un module ne peut pas lire les réglages d'une autre instance : les identifiants complets de chaque chaîne sont donc « prêtés » en mémoire (jamais affichés ni renvoyés) et une copie est gardée dans le stockage de l'instance qui emprunte, pour survivre à un redémarrage. Au tout premier affichage après un redémarrage, si l'instance qui emprunte est lue avant l'autre et n'a pas encore de copie, elle est « pas prête » un instant ; le rechargement suivant suffit. « Oublier les identifiants repris » supprime aussi cette copie.

**Reprise depuis Statut live (migration)** : avec plusieurs chaînes, la reprise va dans la **première** Chaîne Twitch (par ordre de création), uniquement dans ses champs vides ; les autres sont intactes (utilisez le réglage ci-dessus pour partager).

Identifiants repris d'un autre module : ils ne sont jamais affichés ; l'admin le signale et propose « Oublier les identifiants repris ». Ce que vous saisissez dans les réglages a toujours le dessus.

## Statistiques et connexion de votre chaîne (1.3.0)

**Suivre mes statistiques** (désactivé par défaut : il demande votre autorisation) compte vos **followers** et, si vous êtes affilié ou partenaire, vos **abonnés payants**. Le module les publie (sujet `social.stat`) ; un autre module les collecte et garde l'historique. Les cases *Compter mes followers* / *Compter mes abonnés payants* choisissent ce que Twitch doit autoriser : **le minimum** (followers → lecture des followers ; abonnés payants → lecture des abonnements, rien d'autre). Cocher une case après coup demande de reconnecter la chaîne (le panneau le dit).

### Connecter ma chaîne Twitch (une fois)
Le panneau du module, une fois « Suivre mes statistiques » activé et enregistré, guide pas à pas : 1. ouvrir votre application sur dev.twitch.tv/console (type *Confidential*), 2. y ajouter l'**adresse de retour affichée** (bouton *Copier*) dans les adresses de redirection, 3. coller l'identifiant et le secret de l'application dans les réglages, 4. cliquer **Connecter ma chaîne Twitch** puis *Autoriser* chez Twitch. Ensuite : « Connectée en tant que … depuis le … » et **Déconnecter**. Une instance = une connexion ; avec plusieurs chaînes, ajoutez l'adresse de retour de chacune dans la même application Twitch (Twitch accepte plusieurs adresses). Il faut le compte de la chaîne : un autre compte est refusé, avec un message qui dit lequel.

C'est **votre** application Twitch : aucune application centrale de Curiosa, aucun secret partagé. Si la connexion est perdue (mot de passe Twitch changé, accès retiré, application recréée), le panneau montre « Twitch demande de nouveau votre autorisation » avec le bouton ; les chiffres sont alors publiés avec l'erreur `auth` et sans valeur.

### Ce qui est lu, et les limites de Twitch
- `GET /helix/channels/followers` (`total`) avec la portée `moderator:read:followers`, et `GET /helix/subscriptions` (`total`) avec `channel:read:subscriptions` : une requête par chaîne et par chiffre toutes les 5 minutes (20 s après une erreur, 60 s après un « trop de requêtes »), un seul jeton d'application, quel que soit le nombre de consommateurs.
- Les **abonnements ne sont disponibles que pour les affiliés et partenaires** : sinon l'erreur `config` et le message *« Les abonnements ne sont disponibles que pour les affiliés et partenaires Twitch »*. Twitch peut compter votre propre chaîne parmi les abonnés : un écart de 1 est possible.
- Aucune valeur n'est jamais inventée ni périmée : sans connexion ou en cas d'erreur, l'élément porte `error` (`auth`, `rate`, `network`, `config`) et pas de `value`.

### Sécurité de la connexion
Flux « code d'autorisation » avec le secret de **votre** application, côté serveur uniquement.

| Risque | Réponse |
|---|---|
| **Vol ou invention du `state`** (CSRF : faire connecter à l'administrateur le compte de quelqu'un d'autre) | 256 bits aléatoires, créés seulement dans le panneau d'administration (réservé aux administrateurs), gardés dans le stockage de CETTE instance, **à usage unique** (supprimés avant tout appel à Twitch), **10 minutes**. Un `state` inconnu, forgé, rejoué, expiré ou d'une autre instance reçoit la même réponse neutre (400), sans rien écrire ni appeler Twitch ; au-delà de 20 essais invalides en 10 minutes, 429. Limite connue : une route de module ne sait pas **qui** est connecté (le cœur ne le lui dit pas), donc le `state` n'est pas lié à la session de l'administrateur. Il est compensé : un `state` volé ne sert à rien sans compte Twitch **de la chaîne** (le compte autorisé doit être celui de la chaîne réglée, sinon refus et jetons révoqués). |
| **Rejeu du code** | Twitch ne l'accepte qu'une fois ; notre `state` aussi. |
| **Redirection ouverte** | L'adresse de retour est fixe (`<site>/m/<clé>/oauth/callback`) et envoyée telle quelle à Twitch, qui n'accepte que celle enregistrée. Après le rappel, la redirection va toujours vers la page d'administration de l'instance : rien de ce que contient la requête ne choisit la destination. |
| **Secrets dans les journaux** | Aucun appel `console.*` dans le module ; les jetons passent dans le corps ou l'en-tête des requêtes vers Twitch, jamais dans une adresse ; aucune erreur ne les cite. Les réponses du rappel portent `Cache-Control: no-store` et `Referrer-Policy: no-referrer`. |
| **Jeton lisible par un autre module** | Les jetons (accès et renouvellement) sont dans le **stockage de l'instance** : le cœur le réserve à l'instance (`createStore(instanceId)` filtre chaque lecture par instance : une autre instance, même du même module, ne voit rien). Ils ne sont jamais un réglage, ni dans le service `twitch.live`, ni dans un export, ni dans un outil d'assistant. Le stockage fait partie de la sauvegarde du site (chiffrée) : protégez-la. |
| **Jeton qui traîne** | Renouvelé automatiquement avant son expiration et à la réception d'un 401 (une seule tentative, fusionnée entre appels simultanés) ; échec définitif → « À reconnecter ». **Déconnecter** révoque les deux jetons chez Twitch puis les efface. Mauvais compte, autorisation incomplète : jetons révoqués aussitôt. |
| **PKCE** | Non utilisé : Twitch ne le documente pas pour ce flux, et le secret de l'application protège déjà l'échange. |

Risques restants : un administrateur dont la session est volée peut connecter ou déconnecter (comme n'importe quelle action d'administration) ; la sauvegarde contient les jetons (chiffrée) ; l'adresse de retour doit être en https (sauf `localhost` pour des essais).

## Mes directs : ce que le site mesure lui-même (1.4.0, Curiosa 0.1.17 ou plus)

Twitch ne donne que le nombre de followers : ni spectateurs moyens, ni pic, ni heures de live, ni followers par jeu, ni vues par vidéo. Avec **Suivre mes statistiques** coché (rien d'autre à régler), **votre site mesure lui-même** pendant vos directs, **à partir du jour où ce suivi est activé** : Twitch ne fournit pas l'historique, rien n'existe donc avant. Si vous aviez déjà coché l'interrupteur, la mesure démarre à la mise à jour. Décoché : aucune mesure, aucune requête.

Ce que dit le panneau **Mes directs** (page d'administration de la chaîne) : « Mesuré par votre site toutes les 2 minutes quand vous êtes en direct, à partir du jour où ce suivi a été activé : Twitch ne fournit pas l'historique. », « Suivi actif depuis le … », vos derniers directs, le jeu qui vous fait gagner le plus de followers par heure, vos vidéos et clips les plus vus, et le bouton **Effacer les mesures** (avec confirmation).

### Limites, dites honnêtement
- Précision de **2 minutes** (réglable de 1 à 5 en mode avancé) : un direct de moins de 2 minutes peut être manqué ; un direct très court n'a qu'une ou deux mesures.
- Les **spectateurs** sont ceux comptés par Twitch (`viewer_count`), tels quels.
- **Followers gagnés / par heure** : il faut avoir connecté la chaîne (voir plus haut) ; sinon ils restent « inconnus » (jamais 0). C'est le gain net (les désabonnements comptent). Un « followers par heure » n'est donné que pour au moins 10 minutes de direct par jeu (1 heure pour le classement des jeux) : on n'extrapole pas.
- Un trou de mesure (site arrêté, Twitch qui ne répond pas) n'est **jamais comblé** : il n'entre pas dans les moyennes, et le direct est marqué « approximatif ». Au-delà de 30 minutes sans mesure, le direct est refermé à sa dernière mesure.
- Une **coupure brève** (moins de 3 vérifications consécutives hors direct, soit environ 4 à 6 minutes) ne coupe pas le direct en deux ; ces minutes ne comptent pas comme regardées.

### Comment un direct est reconstitué
Tâche planifiée `record-lives` : le cœur la repasse **chaque minute** (c'est sa granularité minimale : `everyMinutes` >= 1, passage chaque minute) ; elle ne mesure qu'à son rythme : **toutes les 2 minutes en direct**, **toutes les 4 minutes hors direct**. À chaque mesure : `GET /helix/streams?user_id=…` avec le jeton d'application déjà géré (spectateurs, jeu, titre, début, langue) ; les followers (`GET /helix/channels/followers`, jeton du compte connecté) sont relevés à l'ouverture, à chaque changement de jeu, à la première vérification hors direct et sinon au plus **toutes les 10 minutes**. Chaque mesure vaut jusqu'à la suivante ; la moyenne est pondérée par le temps ; les heures regardées sont la somme spectateurs × temps mesuré. Fermeture après **3 vérifications consécutives** hors direct, à la dernière mesure en direct. Idempotent : une mesure en erreur (401, 429, réseau) n'écrit rien.

Un **direct** (session) : `startedAt` (début donné par Twitch), `endedAt`, durée, `peakViewers`, `avgViewers`, `hoursWatched`, `followersStart` / `followersEnd` / `followersGained`, `approximate` + `approxReasons` (`gaps`, `partial_start`, `interrupted`), `segments[]`. Un **segment** (un jeu) : `game`, `startedAt`, `endedAt`, `durationSec`, `avgViewers`, `peakViewers`, `hoursWatched`, `followersGained`, `followersPerHour`.

### Stockage et volumes (collections propres à ce module, préfixées `twitch…`)
| Collection | Contenu | Conservation | Volume |
|---|---|---|---|
| `twitchLiveState` | un document : suivi actif depuis, direct ouvert, dernière vérification | — | < 1 Ko |
| `twitchLiveSessions` | un résumé par direct (segments compris) | **5 ans** par défaut (1, 2, 5 ou 10 ans, mode avancé), 3 000 au plus | 1 à 2,5 Ko ; 300 directs par an pendant 5 ans ≈ 2,5 Mo ; plafond ≈ 7 Mo |
| `twitchLiveDays` | mesures brutes, un document par jour (`[secondes, spectateurs, jeu, followers]`) | **90 jours** par défaut (30, 90, 180 ou 365), puis supprimées | ≈ 35 octets la mesure : 4 h de live par jour ≈ 4 Ko/jour ≈ 380 Ko ; 24 h/jour ≈ 25 Ko/jour ≈ 2,3 Mo ; 1 500 mesures au plus par jour |
| `twitchLiveLists` | vidéos (300 au plus) et clips (100) avec leurs vues | remplacé toutes les 30 minutes | ≈ 90 Ko |
Typiquement moins de 1 Mo ; pire cas réglable ≈ 12 Mo. La purge tourne une fois par jour.

### Coût pour Twitch
Un direct : environ **0,6 requête par minute** (1 mesure toutes les 2 minutes + 1 relevé de followers toutes les 10) ; hors direct **0,25 requête par minute** ; vidéos et clips : au plus 5 requêtes toutes les 30 minutes. Le budget de Twitch est d'environ 800 points par minute et par application : c'est moins de 0,2 %. En cas de « trop de requêtes » (429), tout est suspendu 60 secondes pour l'application, et le jeton d'application est renouvelé une fois en cas de 401 ; rien n'est mesuré à tort pendant ce temps.

### Vues par vidéo et clips
`GET /helix/videos?user_id=…&first=100` (rediffusions `archive`, temps forts `highlight`, mises en ligne `upload`), 3 pages au plus = **300 vidéos** ; `GET /helix/clips?broadcaster_id=…&first=100` = **100 clips** les plus vus (nom du jeu résolu en un appel). Titre, date, durée, vues, type, adresse (https Twitch uniquement). Rafraîchi toutes les 30 minutes (5 minutes après une erreur, en gardant les dernières vues connues, datées).

### Chiffres de synthèse (`social.stat`, 30 jours glissants)
En plus de `followers` et `paying`, pour les directs **commencés dans les 30 derniers jours** (`id` stable `twitch-channel:<clé>:<chiffre>`, entiers >= 0 ; **les durées sont en minutes entières**, dites dans le libellé) :
`avg_viewers` (spectateurs moyens par direct, pondérés par le temps), `peak_viewers` (pic maximum), `hours_streamed` (temps de live, **minutes**), `hours_watched` (spectateurs × temps, **minutes**), `followers_gained` (gain net pendant les directs, jamais négatif dans ce chiffre ; en erreur `auth` si la chaîne n'est pas connectée). `0` = aucun direct mesuré. Aucun chiffre tant que le suivi n'a pas pris sa première mesure. Statistiques de la communauté (1.1.0 ou plus) les collecte et les affiche en « 12 h 30 ».

### Outils pour votre IA (lecture seule, aucun secret, **aucun accordé d'office** : administration > API & MCP > accès du jeton)
| Outil | Ce qu'il fait |
|---|---|
| `twitch_streams` | Derniers directs : début, fin, durée (minutes), pic, moyenne, heures regardées, followers gagnés, jeux ; filtres `days` / `since`, `limit` (100 au plus). |
| `twitch_games` | Jeux sur une période : nombre de directs, heures de live, moyenne, pic, heures regardées, followers gagnés et par heure ; tri `sort`. |
| `twitch_videos` | Vidéos (ou clips avec `type: "clip"`) avec leurs vues ; tri par vues, date ou durée ; filtre de type et de période. |
Une réponse vide dit pourquoi (« aucun direct mesuré depuis le … : le suivi mesure à partir de son activation »).

### Réglages avancés
Fréquence de mesure en direct (1, 2 par défaut, 3 ou 5 minutes), conservation du détail des mesures (90 jours par défaut), conservation du résumé de chaque direct (5 ans par défaut).

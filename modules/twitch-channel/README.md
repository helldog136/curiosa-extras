# Ma Chaîne Twitch

Votre chaîne Twitch, mise en avant sur votre site : le **bouton Twitch** de l'en-tête, le **direct en cours** (repris par la bannière « en direct », le planning et les annonces Discord), vos **derniers clips**, et, si vous le souhaitez, vos **followers**, vos **abonnés payants** et les chiffres de vos **directs** (spectateurs, heures, followers gagnés par jeu, vues de vos vidéos).

## Pour commencer
1. **Installez « Ma Chaîne Twitch ».** Le **Connecteur Twitch** s'installe avec lui : c'est lui qui relie votre site à Twitch, une seule fois pour tous vos modules Twitch.
2. **Tapez votre chaîne** (par exemple `machaine`) dans les réglages, puis enregistrez. Le bouton Twitch apparaît tout de suite dans l'en-tête.
3. **Ouvrez le Connecteur Twitch** et suivez son guide (5 minutes, une seule fois) : il vous dit quoi coller chez Twitch, avec un bouton « Copier ». Ensuite, le direct, les clips et les chiffres arrivent tout seuls.

**Vous utilisiez déjà « Chaîne Twitch » ?** Rien à refaire. À la mise à jour, votre application Twitch et votre connexion passent toutes seules dans le Connecteur Twitch, sans rien ressaisir et sans jamais être affichées. L'adresse déjà enregistrée chez Twitch reste valable.

Sans Connecteur Twitch, le bouton de votre chaîne et son lien restent affichés, mais rien n'est lu chez Twitch ; la page d'administration propose alors d'installer un module qui relie votre site à Twitch.

## Plusieurs chaînes
Ajoutez une « Ma Chaîne Twitch » par chaîne. Toutes passent par **la même application Twitch**, celle du Connecteur : chaque chaîne se connecte avec son propre compte Twitch. La bannière « en direct » les annonce toutes.

## Vos statistiques
**Suivre mes statistiques** (désactivé par défaut) compte vos **followers** et, si vous êtes affilié ou partenaire, vos **abonnés payants**. Twitch doit d'abord vous demander votre accord : une fois l'interrupteur activé et enregistré, le bouton **Connecter ma chaîne Twitch** apparaît en haut de la page. Cliquez, puis « Autoriser » chez Twitch. C'est tout. Il faut se connecter avec le compte de la chaîne : un autre compte est refusé, avec un message qui dit lequel.

- *Compter mes followers* / *Compter mes abonnés payants* : Twitch n'autorise que le **minimum** nécessaire. Cocher une case après coup demande de reconnecter la chaîne (la page le dit).
- Les **abonnements ne sont disponibles que pour les affiliés et partenaires** Twitch. Twitch peut compter votre propre chaîne parmi les abonnés : un écart de 1 est possible.
- Aucun chiffre n'est jamais inventé ni périmé : sans connexion ou si Twitch ne répond pas, le chiffre manque, avec la raison.
- Si Twitch ne reconnaît plus votre accord (mot de passe changé, accès retiré), la page affiche « Twitch demande de nouveau votre autorisation » avec le bouton. **Déconnecter** retire l'accord chez Twitch.

## Mes directs : ce que le site mesure lui-même

Twitch ne donne que le nombre de followers : ni spectateurs moyens, ni pic, ni heures de live, ni followers par jeu, ni vues par vidéo. Avec **Suivre mes statistiques** coché (rien d'autre à régler), **votre site mesure lui-même** pendant vos directs, **à partir du jour où ce suivi est activé** : Twitch ne fournit pas l'historique, rien n'existe donc avant. Si vous aviez déjà coché l'interrupteur, la mesure démarre à la mise à jour. Décoché : aucune mesure, aucune requête.

Ce que dit le panneau **Mes directs** (page d'administration de la chaîne) : « Mesuré par votre site toutes les 2 minutes quand vous êtes en direct, à partir du jour où ce suivi a été activé : Twitch ne fournit pas l'historique. », « Suivi actif depuis le … », vos derniers directs, le jeu qui vous fait gagner le plus de followers par heure, vos vidéos et clips les plus vus, et le bouton **Effacer les mesures** (avec confirmation).

### Limites, dites honnêtement
- Précision de **2 minutes** (réglable de 1 à 5 en mode avancé) : un direct de moins de 2 minutes peut être manqué ; un direct très court n'a qu'une ou deux mesures.
- Les **spectateurs** sont ceux comptés par Twitch, tels quels.
- **Followers gagnés / par heure** : il faut avoir connecté la chaîne (voir plus haut) ; sinon ils restent « inconnus » (jamais 0). C'est le gain net (les désabonnements comptent). Un « followers par heure » n'est donné que pour au moins 10 minutes de direct par jeu (1 heure pour le classement des jeux) : on n'extrapole pas.
- Un trou de mesure (site arrêté, Twitch qui ne répond pas) n'est **jamais comblé** : il n'entre pas dans les moyennes, et le direct est marqué « approximatif ». Au-delà de 30 minutes sans mesure, le direct est refermé à sa dernière mesure.
- Une **coupure brève** (moins de 3 vérifications consécutives hors direct, soit environ 4 à 6 minutes) ne coupe pas le direct en deux ; ces minutes ne comptent pas comme regardées.

## Votre planning Twitch (annoncer un événement)

Depuis la 2.1, le module sait dire **les rendez-vous que vous avez publiés dans le planning de votre chaîne Twitch**, pour les modules qui annoncent des événements (par exemple « Story d'annonce » : ils apparaissent dans sa liste « Pour quoi veux-tu une story ? », triés par date et heure avec le reste). Il n'y a **rien à régler** : si l'application Twitch du site est réglée (le guide du Connecteur Twitch), c'est fait.

- **Ce qui est lu** : le planning **public** de votre chaîne (Tableau de bord Twitch, Planning) : titre, début, fin, catégorie (le jeu). Les rendez-vous **annulés** et ceux pendant vos **vacances** annoncées sont ignorés ; 25 rendez-vous au plus, dans les 90 jours.
- **Sans planning publié** sur Twitch, il n'y a rien à venir : le module le dit (« Aucun rendez-vous à venir dans votre planning Twitch… »), ce n'est pas une panne.
- **Rien de privé** : aucune autorisation de votre compte n'est demandée, le planning est public.
- **Combien ça coûte** : un appel à Twitch par chaîne tous les quarts d'heure au plus, seulement quand un module demande la liste (aucune tâche en arrière-plan).
- **Si ça ne marche pas** : phrase en mots simples (nom de chaîne à saisir, application Twitch à régler, Connecteur Twitch à mettre à jour) ; si Twitch ne répond pas, la liste dit « Twitch ne répond pas pour l'instant ».

## Pour les développeurs

Identifiant technique **conservé** : `twitch-channel` (sauvegardes, adresses de retour déjà enregistrées chez Twitch, catalogue). Nom affiché : « Ma Chaîne Twitch ». Version 2.0.0, `minCore` 0.2.0, données en version 2.

### Ce que le module fournit
- `social.link` (bouton), `stream.live` (live en cours, vide hors ligne), `maze.poster` (derniers clips, 60 jours), `social.stat` (followers, abonnés payants, chiffres de période).
- **Service offert `event.source`** (version 1, `each: true`, `readOnly: ["upcoming"]`, depuis la 2.1.0) : `upcoming({ limit?, locale? })` → `{ ok: true, source: { kind: "twitch", label: "Twitch" }, state: "ok" | "setup" | "down", message?, note?, events: [{ id: "twitch:<chaîne>:<empreinte du rendez-vous>", title, start (UTC), end?, timezone: "", type: "stream", url: "https://www.twitch.tv/<chaîne>", games? }] }` (contrat commun : README de Story d'annonce et du dépôt). `GET schedule` (`broadcaster_id`, `first` 25) par le jeton d'application du Connecteur Twitch (1.1.0 et plus : ajouté à sa liste fermée) ; 404 = pas de planning = `ok` sans événement ; 15 minutes de cache par chaîne (20 s après une erreur, 60 s après un 429), un appel partagé entre demandes simultanées ; `events.mjs` (pur) transforme la réponse. Un Connecteur plus ancien refuse l'appel : réponse « à mettre à jour ». Le besoin `twitch.api` (min 3) ne change pas.
- Service `twitch.live` (`each` : chaque instance répond pour sa chaîne) : `channel()` → `{ channel, url, configured, ready, missing }` (sans réseau ; `configured` : l'application est réglée dans le Connecteur) ; `status({ channel?, legacy? })` → `{ configured, known, live, channel, url, id?, title?, game?, viewers?, startedAt?, thumbnail?, displayName?, error? }` ; `adopt({ channel, clientId, clientSecret })` → `{ adopted, ready }` (la chaîne va dans cette instance si elle est vide, l'application va au Connecteur par son `adopt`, qui n'écrase jamais).
- Il **n'offre plus** `twitch.api` : c'est le Connecteur Twitch (`twitch.api` version 3, non `each`, une seule instance). Sans quoi un mélange `each` / non-`each` demanderait à l'administrateur de choisir un maître.

### Dépendance et passage au Connecteur (données version 2)
- `requires: [{ service: "twitch.api", min: 3 }]`, **dur** : avec le cœur 0.2.0, la mise à jour installe le Connecteur (catalogue officiel) AVANT de migrer. Sans Connecteur (restauration incomplète, module retiré de force), le module se dégrade : bouton et lien, aucun appel ; le panneau renvoie le bloc `suggestInstall` (service `twitch.api`, `min` 3), jamais un nom de module.
- `migrations[2]` (`handover.mjs`, rejouable) : lit `clientId`, `clientSecret` (devenus `legacySettings`, le secret marqué `secret`), la copie `borrowed` (ancien `useCredentialsOf`), la reprise `adopted` (Statut live), les connexions `twitchConnection` / `twitchBotConnection` et les demandes `twitchWants`, puis appelle `twitch.api.adopt({ clientId, clientSecret, channel, redirectUri?, connections, wants })`. Seulement si le Connecteur répond `ready` : `ctx.legacy.clear` des trois clés, suppression des documents de connexion et des copies (le secret retiré de `adopted`, la chaîne gardée). Sinon rien n'est effacé, l'état `handover` dit `pending` (Connecteur absent, application incomplète) ou `conflict`, et le passage est retenté à l'ouverture de l'administration et dans la tâche planifiée (10 minutes au plus souvent). La migration n'échoue jamais pour « pas encore prêt ».
- `redirectUri` n'est confiée au Connecteur que si la connexion avait déjà servi (compte connecté ou tentative) : seule une adresse réellement enregistrée chez Twitch est réutilisée. Le Connecteur s'en sert pour les liens d'autorisation de cette chaîne ; la route `oauth/callback` de ce module reste en place et **relaie** `code` + `state` au Connecteur (`exchangeCode`, avec cette adresse exacte). Une nouvelle configuration utilise l'adresse du Connecteur.
- `useCredentialsOf` disparaît : le Connecteur est **une** application avec N comptes connectés. Instances multiples qui partageaient l'application (même identifiant, ou `useCredentialsOf`) : reprises une à une, sans conflit. Une instance qui avait une **autre** application : `adopt` répond `conflict`, rien n'est effacé ; le panneau demande de reconnecter la chaîne avec l'application du Connecteur ; dès que c'est fait, les anciens jetons sont révoqués par le Connecteur (`retire`) puis effacés ici.
- `legacyCollections` déclare les anciennes collections (comptées par le rapport d'entretien du cœur).

### Statistiques et appels
Tous les appels passent par `twitch.api.request` : `GET users`, `GET streams` (`user_login` ou `user_id`), `GET clips`, `GET videos`, `GET games` (jeton d'application) ; `GET channels/followers` et `GET subscriptions` (compte connecté, portées `moderator:read:followers` et `channel:read:subscriptions`). Caches inchangés : direct 30 s, chiffres 5 min, vidéos et clips 30 min ; 20 s après une erreur, 60 s après un 429 (la pause réelle est celle de `ctx.api.net` dans le Connecteur, partagée par toute l'application Twitch). Aucun travail partagé sans borne (`timing.sharedMs`).

#### Comment un direct est reconstitué
Tâche planifiée `record-lives` : le cœur la repasse **chaque minute** (c'est sa granularité minimale : `everyMinutes` >= 1, passage chaque minute) ; elle ne mesure qu'à son rythme : **toutes les 2 minutes en direct**, **toutes les 4 minutes hors direct**. À chaque mesure : `GET /helix/streams?user_id=…` par le Connecteur (spectateurs, jeu, titre, début, langue) ; les followers (`GET /helix/channels/followers`, compte connecté, par le Connecteur) sont relevés à l'ouverture, à chaque changement de jeu, à la première vérification hors direct et sinon au plus **toutes les 10 minutes**. Chaque mesure vaut jusqu'à la suivante ; la moyenne est pondérée par le temps ; les heures regardées sont la somme spectateurs × temps mesuré. Fermeture après **3 vérifications consécutives** hors direct, à la dernière mesure en direct. Idempotent : une mesure en erreur (401, 429, réseau) n'écrit rien.

Un **direct** (session) : `startedAt` (début donné par Twitch), `endedAt`, durée, `peakViewers`, `avgViewers`, `hoursWatched`, `followersStart` / `followersEnd` / `followersGained`, `approximate` + `approxReasons` (`gaps`, `partial_start`, `interrupted`), `segments[]`. Un **segment** (un jeu) : `game`, `startedAt`, `endedAt`, `durationSec`, `avgViewers`, `peakViewers`, `hoursWatched`, `followersGained`, `followersPerHour`.

#### Stockage et volumes (collections propres à ce module, préfixées `twitch…`)
| Collection | Contenu | Conservation | Volume |
|---|---|---|---|
| `twitchLiveState` | un document : suivi actif depuis, direct ouvert, dernière vérification | — | < 1 Ko |
| `twitchLiveSessions` | un résumé par direct (segments compris) | **5 ans** par défaut (1, 2, 5 ou 10 ans, mode avancé), 3 000 au plus | 1 à 2,5 Ko ; 300 directs par an pendant 5 ans ≈ 2,5 Mo ; plafond ≈ 7 Mo |
| `twitchLiveDays` | mesures brutes, un document par jour (`[secondes, spectateurs, jeu, followers]`) | **90 jours** par défaut (30, 90, 180 ou 365), puis supprimées | ≈ 35 octets la mesure : 4 h de live par jour ≈ 4 Ko/jour ≈ 380 Ko ; 24 h/jour ≈ 25 Ko/jour ≈ 2,3 Mo ; 1 500 mesures au plus par jour |
| `twitchLiveLists` | vidéos (300 au plus) et clips (100) avec leurs vues | remplacé toutes les 30 minutes | ≈ 90 Ko |
Typiquement moins de 1 Mo ; pire cas réglable ≈ 12 Mo. La purge tourne une fois par jour.

#### Coût pour Twitch
Un direct : environ **0,6 requête par minute** (1 mesure toutes les 2 minutes + 1 relevé de followers toutes les 10) ; hors direct **0,25 requête par minute** ; vidéos et clips : au plus 5 requêtes toutes les 30 minutes. Le budget de Twitch est d'environ 800 points par minute et par application : c'est moins de 0,2 %. En cas de « trop de requêtes » (429), le Connecteur suspend toute l'application jusqu'à l'heure dite par Twitch (`Retry-After`, sinon 60 s) ; rien n'est mesuré à tort pendant ce temps.

#### Vues par vidéo et clips
`GET /helix/videos?user_id=…&first=100` (rediffusions `archive`, temps forts `highlight`, mises en ligne `upload`), 3 pages au plus = **300 vidéos** ; `GET /helix/clips?broadcaster_id=…&first=100` = **100 clips** les plus vus (nom du jeu résolu en un appel). Titre, date, durée, vues, type, adresse (https Twitch uniquement). Rafraîchi toutes les 30 minutes (5 minutes après une erreur, en gardant les dernières vues connues, datées).

#### Chiffres de synthèse (`social.stat`, 30 jours glissants)
En plus de `followers` et `paying`, pour les directs **commencés dans les 30 derniers jours** (`id` stable `twitch-channel:<clé>:<chiffre>`, entiers >= 0 ; **les durées sont en minutes entières**, dites dans le libellé) :
`avg_viewers` (spectateurs moyens par direct, pondérés par le temps), `peak_viewers` (pic maximum), `hours_streamed` (temps de live, **minutes**), `hours_watched` (spectateurs × temps, **minutes**), `followers_gained` (gain net pendant les directs, jamais négatif dans ce chiffre ; en erreur `auth` si la chaîne n'est pas connectée). `0` = aucun direct mesuré. Aucun chiffre tant que le suivi n'a pas pris sa première mesure. Statistiques de la communauté (1.1.0 ou plus) les collecte et les affiche en « 12 h 30 ».

#### Outils pour votre IA (lecture seule, aucun secret, aucun accordé d'office)
| Outil | Ce qu'il fait |
|---|---|
| `twitch_streams` | Derniers directs : début, fin, durée (minutes), pic, moyenne, heures regardées, followers gagnés, jeux ; filtres `days` / `since`, `limit` (100 au plus). |
| `twitch_games` | Jeux sur une période : nombre de directs, heures de live, moyenne, pic, heures regardées, followers gagnés et par heure ; tri `sort`. |
| `twitch_videos` | Vidéos (ou clips avec `type: "clip"`) avec leurs vues ; tri par vues, date ou durée ; filtre de type et de période. |
Une réponse vide dit pourquoi (« aucun direct mesuré depuis le … : le suivi mesure à partir de son activation »).

#### Réglages avancés
Fréquence de mesure en direct (1, 2 par défaut, 3 ou 5 minutes), conservation du détail des mesures (90 jours par défaut), conservation du résumé de chaque direct (5 ans par défaut).

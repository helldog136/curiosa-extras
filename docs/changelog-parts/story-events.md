## Story d'annonce 2.1 : « Pour quoi veux-tu une story ? »

*Une seule liste de tout ce qui arrive bientôt, pour choisir l'événement à annoncer. Pour Curiosa 0.2.2 ou plus. Modules touchés : Story d'annonce 2.1.0, Chaîne YouTube 1.3.0, Ma Chaîne Twitch 2.1.0, Connecteur YouTube 1.1.0, Connecteur Twitch 1.1.0.*

### Nouveautés

- **Story d'annonce : « Pour quoi veux-tu une story ? »** Une seule liste rassemble ce qui arrive bientôt, de toutes vos sources, **classé par date et heure** : vos streams (Agenda en ligne, Streams saisis à la main), vos **vidéos et directs YouTube programmés** et votre **planning Twitch**. Chaque ligne a une pastille de sa source, le jour et l'heure dans votre fuseau, et le titre. **Un clic choisit l'événement** : la vidéo se remplit toute seule. Rien à régler : une source installée apparaît toute seule.
- **Chercher et filtrer.** Tapez un mot du titre ou du jeu ; un bouton par source ne garde que celle-là. La liste se lit 20 par 20 (« Voir plus d'événements ») et s'arrête aux 200 prochains.
- **Pas de doublon.** Un stream annoncé à la fois par votre agenda et par votre planning Twitch n'apparaît qu'une fois, avec la mention « Aussi dans : Twitch ».
- **Une source ne répond pas ? Ce n'est jamais bloquant.** Une phrase polie sous la liste (« YouTube ne répond pas pour l'instant »), un bouton « Réessayer », et les autres sources restent là. Vous pouvez toujours écrire l'événement vous-même.
- **Chaîne YouTube : vos directs et premières programmés.** Dès que la clé YouTube du site est là, ils rejoignent la liste. La page dit honnêtement ce que YouTube ne permet pas : **une vidéo privée programmée n'est pas visible** avec la clé du site (pour celle-là, écrivez l'événement vous-même).
- **Ma Chaîne Twitch : votre planning Twitch.** Les rendez-vous publiés sur votre chaîne rejoignent la liste ; ceux qui sont annulés ou pendant vos vacances sont ignorés. Rien de privé n'est demandé.
- **Votre assistant** peut lister tous ces événements (nouvel outil `story_events`) et préparer la vidéo pour l'un d'eux. L'événement choisi est gardé dans la demande ; si un événement a disparu entre-temps, la page le dit et prend le prochain.

### Améliorations

- Sur téléphone, un clic sur un événement vous amène directement à l'aperçu, le bouton « Générer la vidéo » en vue ; les lignes de la liste sont de grandes zones à toucher.
- Quand un événement a son propre fuseau horaire et que l'heure n'est pas la même que chez vous, l'heure sur place est écrite entre parenthèses.
- Les anciens outils et les anciens liens de votre assistant continuent de marcher (`story_next_streams` et `story_prepare` avec une clé de stream sont inchangés).
- Les connecteurs YouTube et Twitch laissent passer ce dont les sources ont besoin (début programmé des vidéos ; planning public d'une chaîne), et rien d'autre. Mettez-les à jour avec les modules qui s'en servent : sans cela, la source dit « le connecteur doit être mis à jour » au lieu de planter.

### Pour les développeurs

- **Nouveau contrat `event.source`** (service version 1, `each: true`, besoin **facultatif** `requires[].optional` chez le consommateur) : `upcoming({ from, to, limit, locale })` → `{ ok, source: { kind, label }, state: "ok" | "setup" | "down", message?, note?, events: [{ id, title, start (UTC), timezone, end?, allDay?/day?, type, url?, image?, games? }] }`. Décrit dans le README du dépôt. Un module qui publie des événements datés n'a qu'à l'offrir ; aucun consommateur n'est à changer. Les agendas gardent le sujet `planning.slot`.
- **Story d'annonce** : `events.mjs` (contrat, `cleanEvent`, `aggregate` : doublons à 15 minutes près, tri sur l'instant UTC, 100 par source, 200 au total ; `pageOf` : curseur opaque, 50 par page ; `filterEvents`), `sources.mjs` (`loadEvents` : un appel borné par source, 10 sources, liste gardée 45 s, dernière bonne liste 15 min, partage des demandes simultanées, aucun minuteur de fond), routes `events` et `cover`, outil `story_events`, `story_prepare` accepte `event`. Les réglages gardent `eventId` et `eventSource` (jamais les modèles) ; `streamKey` reste rempli pour un événement d'agenda. `minCore` inchangé (0.2.2).
- **Chaîne YouTube** : `events.mjs`, service `event.source` (`channels.list` → `playlistItems.list` → `videos.list` avec `snippet,contentDetails,liveStreamingDetails`, 3 unités par chaîne et par 10 minutes). **Ma Chaîne Twitch** : `events.mjs`, `channelSchedule` dans `helix.mjs` (`GET schedule`, 15 minutes de cache, 404 = pas de planning). **Connecteurs** : `liveStreamingDetails` ajouté aux parties permises de `videos.list` (YouTube) ; `GET schedule` ajouté à la liste fermée des appels d'application (Twitch). Services `youtube.api` v1 et `twitch.api` v3 inchangés.
- Tests : `stream-story-events`, `stream-story-events-editor`, `youtube-channel-events`, `twitch-channel-events`, `event-source-contract` ; `fakeTwitch` sait répondre à `/helix/schedule`.
- Conflits probables avec une version qui touche aussi *Chaîne YouTube* ou le *Planning* : `modules/youtube-channel/module.json` (version, bloc `offers`), `modules/youtube-channel/index.mjs` (un import en tête et un bloc `services` avant `exports`), ses deux `locales/*.json` (six clés `events_…` ajoutées en fin de fichier).

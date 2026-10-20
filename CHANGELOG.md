# Changelog

Ce que chaque version de ce dépôt change pour vous. Chaque version est une étiquette (`vX.Y.Z`) : c'est elle que le Catalogue de Curiosa propose à l'installation, et son texte devient celui de la release GitHub.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, qui disent ce que ça change pour vous.

## Prochaine version (non publiée)

*Livraison « Connexions » et nettoyage, pour Curiosa 0.2.0 ou plus : un module qui garde votre clé YouTube à un seul endroit, et plus aucun réglage « ancien » à voir.*

### Nouveautés

- **Nouveau module « Connecteur YouTube ».** Votre clé YouTube est rangée **à un seul endroit** pour tout le site : vous la saisissez une fois, elle n'est plus jamais affichée ni écrite dans un journal. La page du connecteur dit en une phrase où créer la clé gratuite, combien de la limite du jour de YouTube a déjà servi, et, si elle est atteinte, quand cela reprend (« La limite YouTube du jour est épuisée, reprise demain à 9 h »).
- **Le site ne tombe plus à court de la limite YouTube.** Chaque demande à YouTube est comptée ; le connecteur s'arrête avant la fin (9 000 sur 10 000 par défaut, dont 1 000 gardées pour ce que vous faites dans l'administration). Une même réponse sert 10 minutes, et si YouTube ne répond plus, le site montre les dernières données connues avec leur date.

### Améliorations

- **« Suggestions de jeux » : la clé RAWG se saisit une seule fois**, dans les Réglages du site. Le champ propre au module a disparu. S'il manque une clé, l'administration du module le dit tout en haut, avec le lien pour la saisir. Si le module gardait une clé de son côté, elle est effacée dès que le site a la sienne.
- **« Statut live Twitch » reprend tout seul vos identifiants Twitch** dans la Chaîne Twitch, à la mise à jour : plus de bouton à cliquer, plus de champs à vider. Si la Chaîne Twitch n'est pas disponible à ce moment-là, le module réessaie chaque heure.
- **« Planning » ne montre plus de champ d'adresse de calendrier** : l'adresse reprise par « Agenda en ligne » n'est plus affichée nulle part.
- Quelques phrases de « Raid Twitch » (renouvellement de l'adresse du dock) sont reformulées sans parler d'« ancienne » adresse.
- **« Chaîne YouTube » : plus de clé à saisir ici.** Si vous en aviez mis une, elle est remise au connecteur à la mise à jour, puis effacée de « Chaîne YouTube » seulement quand le connecteur confirme l'avoir : rien à retaper. Sans connecteur, la page de « Chaîne YouTube » propose de l'installer en un clic ; votre clé reste gardée, masquée, en attendant, et la vidéo mise en avant continue de marcher avec le flux public.
- **« Chaîne YouTube » ne bloque plus jamais la page d'accueil** quand YouTube est lent : chaque demande a un délai, plus court encore dans une page publique.

### Pour les développeurs

- `scripts/build-index.mjs` recopie `requires[].optional` (et seulement la valeur `true`) dans `needs` de l'index : sans cela un cœur 0.2.0 traitait un besoin facultatif comme dur. Les fonctions partagées vivent dans `scripts/rules.mjs`. `build-index.mjs --check` vérifie en plus la règle `needs.optional`.
- `scripts/release-check.mjs` : règle `needs.optional` et règle `data.versionMonotonic` (un module ne baisse jamais sa `dataVersion` par rapport à l'étiquette précédente ; `dataFloor` ≤ `dataVersion`).
- `tests/legacy-labels.test.mjs` : copie du test du cœur 0.2.0 (aucun libellé visible ne dit « ancien », « legacy », « reprise automatiquement »), qui lit ce dépôt par défaut. Liste blanche temporaire, nommée et datée (2026-10-20), pour `partnerships` : à retirer avec Partenariats 2.0.
- `game-suggestions` 1.2.0, `live-status` 1.3.0, `planning` 2.1.0 : `minCore` 0.2.0, `dataVersion` montée (2, 2 et 3), anciennes clés déclarées dans `legacySettings` (`rawgApiKey`, `channel` / `clientId` / `clientSecret`, `icsUrl`), lues par `ctx.legacy.get` et effacées par `ctx.legacy.clear` seulement après reprise confirmée. `game-suggestions` n'a plus de repli `fetch` direct vers RAWG. Tests de migration : rejeu deux fois, secret jamais affiché ni journalisé.
- Nouveau module `youtube-connector` 1.0.0 (`type: "integration"`, `instances: "single"`, `minCore: "0.2.0"`) : offre `youtube.api` version 1 (contrat 11.2). Méthodes `request({ endpoint, params, priority?, timeoutMs? })` (liste fermée : `channels.list`, `playlistItems.list`, `videos.list`, 1 unité chacun ; `search.list` exclu), `channels({ ids?, handles? })` (1 à 50 par appel : nom, photo, abonnés), `adopt({ apiKey })` (jamais de valeur renvoyée, idempotent), `status()`. Tout passe par `ctx.api.net` ; la clé voyage dans l'en-tête `x-goog-api-key`, jamais dans l'adresse. Compteur d'unités du jour dans le stockage (remise à zéro à minuit `America/Los_Angeles`), budget `dailyBudget` (9 000, dont `min(1000, budget/9)` réservées à `priority: "interactive"`), refus `quota` sans réseau avant l'épuisement ou après un 403 `quotaExceeded`, pause de 10 min sur clé refusée, cache de 10 min, repli daté (`stale`, `at`), bloc `netHealth`. Aucune tâche.
- `youtube-channel` 1.2.0 (`minCore: "0.2.0"`, `dataVersion: 2`) : `apiKey` passe en `legacySettings` (secret), `requires: [{ service: "youtube.api", min: 1, optional: true }]`, migration 2 et ouverture du panneau : `adopt` puis `ctx.legacy.clear("apiKey")` seulement après `ready: true`. Sans fournisseur : bloc `suggestInstall` (service `youtube.api`). Flux RSS et contrôles « Short » par `ctx.api.net` ; `channelId` déclaré `refersTo: "external"`. Les fonctions exportées prennent maintenant `ctx` en premier argument (`listVideos(ctx, id)`, `viaFeed`, `viaApi`, `isShort`, `shortFlags`, `channelStats`).
- Tests : `youtube-connector` (faux YouTube : 403 `quotaExceeded`, 429, silence, JSON tronqué, disjoncteur, compteur d'unités, budget et réserve, clé refusée, `channels`, `adopt`, aucune fuite de la clé dans les retours, blocs, journaux et console), `youtube-channel` (migration rejouée deux fois, reprise en échec → rien d'effacé, `suggestInstall`), `hang-youtube` et `social-stat` passés sur le vrai connecteur. Aide de test `tests/helpers/fakeYoutube.mjs`.

## 1.10.0

*Changements depuis la 1.9.0. « Raid Twitch » sait maintenant servir une grande communauté : jusqu'à 2 000 chaînes, avec un bouton « au hasard » quand la liste est très longue.*

### Nouveautés

- **« Raid Twitch » pour les grandes communautés (associations, collectifs).** La liste peut contenir **jusqu'à 2 000 chaînes** (100 avant). Jusqu'à 500 chaînes, le dock montre toujours **tous les membres en direct**. Au-delà, il propose un grand bouton **« Trouver un streameur en ligne au hasard »** : un clic choisit un membre en direct, le met en évidence et **copie sa commande de raid**. « Un autre au hasard » en propose un différent. La page d'administration dit clairement dans quel cas vous êtes, et pourquoi (Twitch ne permet de vérifier que 100 chaînes à la fois).
- **Un seul dock pour toute l'association.** Une personne tient la liste sur un site ; les membres ajoutent l'adresse du dock dans OBS, sans rien installer. Le site n'interroge Twitch que lorsque quelqu'un regarde ou clique, et le nombre de demandes ne dépend pas du nombre de membres.

### Améliorations

- **Une liste de 2 000 chaînes reste agréable à gérer** : 50 chaînes par page, champ de recherche (pseudo, nom, note), nombre total affiché, retour à la même page après chaque action.
- **Importer toute une communauté d'un coup** : collez vos pseudos (un par ligne, ou séparés par des virgules ou des espaces). Un bilan dit combien ont été ajoutés, combien y étaient déjà et lesquels ne sont pas valables, sans bloquer les bons. Un texte trop long est signalé, avec l'endroit où reprendre.
- **Le dock ne se vide plus si quelques chaînes ne répondent pas** : il affiche ce qu'il a, avec le message « Certaines chaînes n'ont pas pu être vérifiées. »
- **Votre propre chaîne n'apparaît plus** dans votre dock ni dans les tirages au hasard.
- **« Nouvelle adresse » est plus clair** : il est écrit qu'elle coupe l'accès à tout le monde, membres compris.
- **Votre IA** : au-delà de 500 chaînes, l'outil « qui est en direct » donne un membre tiré au hasard plutôt que la liste. Il reste en lecture seule et n'est jamais accordé d'office.

### Pour les développeurs

- `twitch-raid` 1.2.0 (`twitch-channel` inchangé : `GET streams` garde sa forme stricte de 100 pseudos au plus). Constantes uniques dans `pure.mjs` : `MAX_PARTNERS = 2000`, `FULL_VIEW_MAX = 500`, `PACKET_SIZES = [100, 50, 20]`, `SEARCH_TRIES = 6`. Nouveaux fichiers : `streams.mjs` (appel `GET streams`, paquets, borne par appel, repli 100 → 50 → 20 sur erreur 400, taille retenue 10 minutes) et `search.mjs` (mode au hasard : tirage sans remise injectable, souvenir par instance d'une minute, une recherche en cours est rejointe, plafond de 12 recherches par minute). `live.mjs` : vue complète par paquets de 100, 3 à la fois, résultat partiel, cache de 30 s (15 s si partiel) partagé et jamais éternel.
- Nouvelle route `pick` (POST seulement, secret obligatoire). La route `live` ne fait aucune demande à Twitch au-delà de 500 chaînes. Le dock reste une seule page sans donnée : `canSearch` est recopiée dans la page comme les autres fonctions du dock.
- Administration : `pageOf`, `filterPartners`, `rowId` / `parseRowId` (la page et la recherche voyagent dans l'identifiant de ligne). Le cœur coupe les textes de formulaire à 20 000 caractères : un collage trop long ignore son dernier pseudo, peut-être coupé.
- Tests : `twitch-raid-large` (paquets, repli 400, partiel, 50 visiteurs = 1 jeu d'appels, tirage équitable et sans remise, 300 clics en une minute, plafond, « trou noir » de la vue complète et du mode au hasard, administration à 2 000 chaînes). `fakeTwitch` : `streamsMax` (400 au-delà), `streamsFail`, compteurs de demandes.

## 1.9.0

*Changements depuis la 1.8.0. Un nouveau module « Story d'annonce » fabrique la vidéo qui annonce votre prochain stream. Il faut Curiosa 0.1.22 ou plus.*

### Nouveautés

- **Nouveau module « Story d'annonce ».** Il fabrique une petite **vidéo animée** qui annonce votre prochain stream, prête à publier en **story Instagram**. Vous choisissez le stream (le prochain, un autre, ou un stream écrit à la main si vous n'avez pas d'agenda), ce que la vidéo montre (titre, jour et heure, compte à rebours « Dans 2 h 15 » / « Ce soir à 19 h 30 » / « Demain », jeu et jaquette, logo et nom de votre chaîne, votre phrase, vos co-streamers), le **style** (néon qui clignote, affiche qui glisse, compte à rebours animé, texte seul), le **format** (vertical 9:16, ou « Passeport » 4:5 presque carré) et la **durée** (5 à 15 secondes, 15 par défaut). Un aperçu animé vous montre le résultat avant de le fabriquer, avec une option pour afficher les **zones de sécurité** que cache Instagram.
- **La vidéo se fabrique dans votre navigateur, rien n'est gardé sur le site** : une barre d'avancement, un bouton « Annuler », puis le fichier se télécharge (par exemple `annonce-2026-10-22-vertical.mp4`). Vidéo muette. Chrome ou Safari récents donnent un fichier MP4 ; sinon la page le dit et vous conseille un autre navigateur.
- **Vos co-streamers** : une liste à vous (pseudo Twitch, nom et photo facultatifs), des cases pour choisir qui apparaît (6 au plus), et l'ajout d'un pseudo pour une seule vidéo. Si « Raid Twitch » est installé, un bouton **« Reprendre mes partenaires de Raid Twitch »** les ajoute avec leur photo de profil.
- **Vos modèles** : enregistrez vos réglages sous un nom (« Stream du soir néon »), chargez-les, remplacez-les ou supprimez-les, chaque fois avec une confirmation.
- **Votre IA peut préparer la vidéo pour vous** : elle remplit tout et vous donne un lien ; vous vérifiez l'aperçu et cliquez sur « Générer la vidéo ». Elle ne fabrique ni ne publie rien, et l'outil qui prépare n'est jamais accordé d'office.

### Améliorations

- **« Raid Twitch » 1.1.0 peut partager vos partenaires avec vos autres modules** (leur pseudo, leur nom et leur photo de profil Twitch, jamais vos notes ni l'adresse du dock). Rien ne change pour vous si vous n'en avez pas l'usage.
- **« Chaîne Twitch » 1.7.0 sait donner le nom affiché et la photo de profil d'une liste de chaînes** (100 au plus, en une seule demande). Rien à régler ; la mise à jour est proposée toute seule.

### Pour les développeurs

- `stream-story` 1.0.0 (`minCore` 0.1.22, instance unique, `platform: "instagram"`, aucune page publique, aucune dépendance forte) : **consomme** les sujets `planning.slot` (n'importe quel agenda ; lecture bornée `from` / `to`, plafond de 100, attente maximale 6 s) et `stream.partner` ; jaquettes par `ctx.api.rawg`. L'éditeur est une page servie par la route `studio` dans un cadre du panneau d'administration ; ses routes de données exigent un jeton signé (HMAC, 12 h) donné par le panneau dans la partie `#` de l'adresse. Relais d'images `img` : hôtes `static-cdn.jtvnw.net` et `media.rawg.io` seulement, chemin d'image connu, 3 Mo, type lu dans les premiers octets, aucune redirection, 4 téléchargements à la fois. Outils MCP : `story_models` et `story_next_streams` (lecture seule), `story_prepare` (`default: false` : écrit une préparation de 7 jours et rend un lien ; entrées vérifiées une à une).
- Fabrication dans le navigateur : `scenes.mjs` (chaque style est une fonction `draw(ctx, t)`), `mp4.mjs` (emballeur MP4 minimal écrit pour le module, essayé avec de vraies images x264 relues par `ffprobe`), `encode.mjs` (détection des capacités avant de commencer, WebCodecs H.264 à 30 images/s et environ 8 Mb/s, repli `MediaRecorder`), `pure.mjs` (formats dans une seule table `FORMATS`, dates, compte à rebours, mise en lignes, mise en page des co-streamers, couleurs). Fichiers purs, exécutables dans un `vm` vierge.
- `twitch-raid` 1.1.0 : fournit le sujet `stream.partner` (`id`, `login`, `title`, `image` seulement s'il y a une photo), photos lues par `GET users` en demandes de 20 pseudos au plus, bornées à 6 s, gardées 6 h. Permission `topics`. `twitch-channel` 1.7.0 : `GET users` (liste fermée `ALLOWED.app`) passe en forme stricte : seul `login`, 1 à 100 pseudos valables. `fakeTwitch` répond à `GET users` (`state.users`).
- Tests : `stream-story-pure`, `stream-story-scenes` (zone sûre de chaque style × format × 0 à 6 co-streamers), `stream-story-video`, `stream-story`, `hang-stream-story` (essais « trou noir »), `mp4probe` (analyseur de structure MP4) et `fakeCanvas` dans `tests/helpers`. Le sujet `stream.partner` est une exception documentée de `repo-rules.test.mjs` tant que le tableau des sujets du cœur ne le liste pas.

## 1.8.0

*Changements depuis la 1.7.1. Le Planning montre vos streams et deux nouveaux modules les fournissent ; un nouveau module « Raid Twitch » vous dit quels partenaires sont en direct. Il faut Curiosa 0.1.27 ou plus pour mettre le Planning à jour.*

### Nouveautés

- **Nouveau module « Raid Twitch ».** Vous y listez les chaînes de vos partenaires, et il vous donne un petit panneau (un « dock ») à ajouter à OBS, qui montre **uniquement ceux qui sont en direct en ce moment** : leur jeu, leur titre, leurs spectateurs et depuis combien de temps ils streament. Un clic sur un partenaire **copie la commande de raid** (`/raid pseudo`), prête à coller dans votre chat : c'est vous qui la lancez. Un bouton « Au hasard » en choisit un pour vous. Le panneau se met à jour tout seul, se lit bien même très étroit, et ne s'ouvre qu'avec son adresse secrète (que vous pouvez remplacer d'un clic si elle a été partagée par erreur). Il faut Curiosa 0.1.22 ou plus ; « Chaîne Twitch » s'installe avec lui.
- **« Agenda en ligne » : votre Google Agenda alimente le site.** Collez l'adresse secrète de votre agenda une seule fois, puis écrivez vos streams dans Google Agenda comme d'habitude. Un guide pas à pas et un bouton « Tester l'adresse » sont dans la page du module.
- **« Streams saisis à la main » : pas d'agenda en ligne ? Pas de problème.** Un petit formulaire pour écrire vos streams (jour, heure, jeux, « chaque semaine », semaines à sauter) directement dans l'administration.
- **Vous pouvez avoir un seul de ces modules, ou les deux.** Leurs streams s'ajoutent sur le planning, et un stream écrit deux fois n'est montré qu'une fois.

### Améliorations

- **Si vous aviez déjà le Planning, vous n'avez rien à faire.** En se mettant à jour, il reprend l'adresse de votre agenda dans « Agenda en ligne » (installé pour vous) : la page du planning, les blocs d'accueil et le bot du chat montrent exactement les mêmes streams.
- **Sans agenda, le Planning n'affiche plus d'erreur.** Vos visiteurs voient « Pas de stream planifié », et l'administration vous dit quoi installer.
- **Le bot Twitch répond à « !planning » avec un seul de ces modules.** Le Planning n'est plus nécessaire. Un stream annulé n'est jamais annoncé.
- **Les heures suivent par défaut le fuseau de votre agenda.** Le réglage « Fuseau horaire d'affichage » du Planning est facultatif.
- **Un agenda qui ne répond plus ne ralentit jamais votre site.** La lecture s'arrête au bout de quelques secondes et le site garde la dernière copie reçue.
- **Chaîne Twitch 1.6.0 peut dire qui est en direct parmi une liste de chaînes.** C'est ce qui permet à « Raid Twitch » de savoir qui est en ligne, en une seule demande à Twitch (jusqu'à 100 chaînes). Rien à régler et pas besoin de connecter votre compte. Le module est proposé en mise à jour automatiquement.
- **Chaîne Twitch ne peut plus rester en attente d'un Twitch qui ne répond pas quand un autre module l'interroge** (le Bot Twitch, par exemple) : la demande est abandonnée au bout de quelques secondes et le module appelant en est informé.

### Pour les développeurs

- `calendar-ical` 1.0.0 et `calendar-manual` 1.0.0 fournissent le sujet `planning.slot` : `id`, `title`, `start`, `end`, `allDay`, `day`, `games`, `text`, `status`, `timezone` (contrat dans le README de `calendar-ical`). Aucun service, aucune dépendance. Le lecteur d'iCal quitte le Planning (`ical.mjs`), avec un téléchargement borné d'un seul tenant (`fetch.mjs`, `timing.totalMs`).
- `planning` 2.0.0 (`minCore` 0.1.27) ne fournit plus `planning.slot` : il le consomme. `slots.mjs` met les créneaux au format des apparences (fonctions pures) ; la lecture est bornée (`timing.collectMs`). Les jeux viennent de l'agenda (`games`), plus d'une description.
- Migration 1 → 2 (`dataVersion` 2, **temporaire, à retirer en 0.3.0**) : `seeds` désigne `calendar-ical`, le lien est un sujet (le cœur doit accepter `seeds` avec `consumes`, 0.1.27). Elle sème une instance avec `{ url, timezone }` puis efface `icsUrl`, déclaré en réglage avancé le temps de la reprise.
- `twitch-bot` 1.1.1 : `!planning` lit `planning.slot` sans exiger le Planning, ignore les streams annulés, lecture bornée (`timing.collectMs`). Tests : `tests/hang-calendar.test.mjs` (serveur « trou noir »), `planning-slots.test.mjs`, `planning-migration.test.mjs`, `calendar-*.test.mjs`.
- `twitch-channel` 1.6.0 : le service `twitch.api` passe en **version 2** (`offers[].version`). La liste fermée `ALLOWED.app` gagne `GET streams`, avec une forme stricte (`access.mjs`) : seuls `user_login` (1 à 100 pseudos, des textes qui passent `LOGIN`) et `first` (1 à 100) sont permis, jamais `after`, `game_id` ni `user_id`, et jamais avec le jeton d'utilisateur ; les autres appels gardent leur plafond de 20 valeurs par paramètre. `request()` borne désormais l'ensemble de l'appel (jeton compris) à `timing.sharedMs` (`helix.within`) et rend `network` au-delà. `fakeTwitch` sait répondre à `GET streams` (`state.streams`).
- `twitch-raid` 1.0.0 (`minCore` 0.1.22) : `requires: [{ service: "twitch.api", min: 2 }]` (une Chaîne Twitch d'avant la 1.6.0 est refusée avec le message du cœur « mettez le module à jour »). Une instance unique. Le dock est une page complète servie par la route `dock` (`/m/<clé>/dock?k=<secret>`), qui lit la route `live` ; secret de 192 bits gardé dans le stockage de l'instance, comparé à temps constant (empreintes SHA-256), régénérable ; page avec politique de sécurité à `nonce`, sans aucune donnée dans le HTML. `live.mjs` : un appel groupé par actualisation, gardé 30 s (`timing.okMs`), 15 s après une erreur, partagé par `share()` (expire à `timing.callMs`, 8 s), dernière liste connue (10 min) jointe aux erreurs. `pure.mjs` : les fonctions `raidCommand`, `sortPartners`, `pickRandom(items, rng, avoid)` et `durationText` sont recopiées telles quelles dans la page (`toString`) et testées avec un générateur injectable. Un outil MCP en lecture seule, non accordé d'office : `raid_partners_live`.
- Tests : `twitch-raid.test.mjs` (dont les essais « trou noir » du service Twitch, de `account` et de la page d'administration), `hang-twitch.test.mjs` (GET streams), `twitch-api.test.mjs` (forme stricte de `GET streams`). `platform.test.mjs` connaît `twitch-raid`.


## 1.7.1

*Changements depuis la 1.7.0. Aucune nouveauté : cette version corrige un blocage possible de la page d'accueil.*

### Améliorations

- **Chaîne Twitch et Chaîne YouTube ne peuvent plus bloquer votre page d'accueil si Twitch ou YouTube cessent de répondre.** Avant, quand l'un des deux ne répondait plus du tout, une demande restée en attente pouvait faire patienter toutes les suivantes : la page d'accueil n'affichait plus rien (erreur 504) jusqu'au redémarrage du site. Maintenant, chaque attente a une limite : passé quelques secondes, le module abandonne, affiche ce qu'il sait déjà (ou rien) et réessaie plus tard, tout seul.
- **Chaîne YouTube : la bannière de la dernière vidéo s'affiche plus vite.** Savoir si une vidéo est un Short demandait un appel à YouTube par vidéo, l'un après l'autre. Ils se font maintenant plusieurs à la fois, avec une limite de temps pour l'ensemble, et la réponse est gardée 10 minutes. Ce que vos visiteurs voient ne change pas.
- **Bluesky, Mastodon, GitHub, Discord et Reddit : même protection.** Si l'un de ces réseaux ne répond plus, vos chiffres de communauté s'affichent en erreur au lieu de rester bloqués.
- **Statistiques de la communauté et Planning : même protection.** Un réseau qui ne répond pas ne bloque plus la mise à jour des chiffres ni l'affichage du calendrier.

### Pour les développeurs

- `twitch-channel` 1.5.1 : `helix.mjs` partage ses travaux en cours (jeton, état du direct, renouvellement, statistiques, vidéos, clips) par `share()`, qui retire l'entrée de `state.inflight` à l'expiration (`timing.sharedMs`, 15 s ; 45 s pour les vidéos) et pas seulement à la fin ; le résultat d'un travail resté en arrière-plan n'est jamais écrit. `oauth.mjs` exporte `timing` et `request()` : signal d'abandon (`requestMs`, 5 s) ET borne dure de 20 % en plus, lecture du corps comprise ; tous les appels de `helix.mjs` et d'`oauth.mjs` passent par elle. L'enregistreur de directs ne reste plus « busy » à cause d'un Twitch muet.
- `youtube-channel` 1.1.2 : mêmes `timing`, `get` et `share` ; `isShort` garde sa réponse par vidéo (10 min, « inconnu » 1 min) ; `shortFlags()` contrôle les vidéos en parallèle (4 à la fois) sous une borne globale (`timing.shortsMs`, 5 s) ; `longVideos` et `featured` s'en servent ; `statsPending` est borné.
- `bluesky`, `discord` 1.1.2, `github`, `mastodon`, `reddit` 1.1.1 : `lookup()` borne sa promesse partagée (`timing.sharedMs`) et retire l'entrée à l'expiration.
- `community-stats` 1.1.1 : `collectNow` borne la collecte (`limits.collectMs`, 60 s) pour que le verrou `running` se libère. `planning` 1.3.2 : `fetchIcs` a une borne globale (`icsTiming.totalMs`, 10 s) redirections comprises.
- Tests `tests/hang-*.test.mjs` : un `fetch` « trou noir » (qui ne se termine jamais, signal d'abandon ignoré), des délais raccourcis et l'horloge simulée ; chacun échoue sans le correctif.

## 1.7.0

*Changements depuis la 1.6.0.*

### Nouveautés

- **Bot Twitch : la commande d'un partenaire se règle dans sa fiche.** Ouvrez la fiche du sponsor : une section « Commande de chat pour ce partenaire » propose la case « Activer la commande dans le chat », le nom de la commande (celui de sa page, que vous pouvez changer), le texte déjà rempli et un aperçu. Elle s'enregistre sans quitter la fiche. Il faut Curiosa 0.1.24 ou plus.
- **Bot Twitch : la page du bot garde le résumé.** Chaque partenaire y apparaît avec sa commande et son état (active, désactivée, en pause), et « Modifier » ouvre sa fiche directement sur cette section. Une commande dont la fiche n'est plus publiée est dite « en pause » avec ce qui va se passer.
- **Bot Twitch : on ne remonte plus en haut de la page à chaque clic.** Activer une commande, créer la vôtre, couper les réponses, vider le journal : le message s'affiche à côté du bouton et vous restez où vous étiez. « Modifier » descend jusqu'au formulaire.
- **Bot Twitch : un lien vers le module du réseau.** Quand vous modifiez la commande d'un réseau, un lien vous mène aux réglages de ce réseau pour changer son adresse.

### Pour les développeurs

- `twitch-bot` 1.1.0 (`minCore` 0.1.24) : première utilisation du point d'extension `entryPanels` du cœur. `module.json` déclare la section (`for: { topic: "sponsor.card" }`), `entry.mjs` la fournit (`render` + action `save`), la donnée reste dans `botConfig` sous l'identifiant de la fiche. Sponsors n'a pas changé et ne connaît pas le bot.
- Un cœur plus ancien refuse la mise à jour (`minCore`) et garde le bot 1.0.0 avec son formulaire sur la page du bot : pas de code de repli à maintenir. La fonction ne s'active que si Sponsors ET le bot sont installés.
- Le formulaire de partenaire est retiré de la page du bot (`?edit=partner:…` renvoie vers la fiche). Les actions de la page ne redirigent plus (sauf supprimer et rétablir le texte) ; les liens « Modifier » portent l'ancre `#edit`.
- `sources.networks` lit `adminPath` dans `ctx.api.instances.list()` (cœur 0.1.24) pour lier vers le module du réseau.

## 1.6.0

*Changements depuis la 1.5.1.*

### Nouveautés

- **Nouveau : le Bot Twitch.** Votre site répond aux commandes tapées dans votre chat Twitch : `!planning`, `!jeu`, `!titre`, `!followers` et `!uptime` sont prêtes, et vous créez les vôtres (nom, réponse, autres noms, qui peut s'en servir, attente entre deux réponses). Les réponses peuvent contenir le jeu, le titre, la durée du direct, le nombre de followers, le prochain stream ou le pseudo de la personne. Il faut Curiosa 0.1.22 ou plus ; Chaîne Twitch s'installe avec lui.
- **Des commandes pour vos partenaires et vos réseaux.** Si Sponsors est installé, chaque partenaire peut avoir sa commande (`!tesla` donne l'adresse de sa page). Si vous avez installé des modules de réseaux (YouTube, TikTok, Instagram, Discord, X…), chacun peut avoir la sienne (`!youtube`, `!tiktok`…), et `!reseaux` donne tous les liens d'un coup. Sans ces modules, rien ne change et la page du bot l'explique.
- **Un arrêt d'urgence et un journal.** Un gros bouton en haut de la page coupe toutes les réponses tout de suite ; un court journal dit, pour chaque commande, si le bot a répondu ou pourquoi il s'est tu. Par défaut le bot ne répond que pendant vos directs, ne répond jamais à lui-même ni aux autres bots, et se retient s'il y a trop de messages d'un coup.
- **Votre IA peut lister, créer et modifier des commandes** (rien n'est accordé d'office, rien ne se supprime).
- **Chaîne Twitch 1.5.0 : elle prépare le terrain pour le bot.** Elle peut demander à Twitch l'autorisation de lire et d'écrire dans votre chat (un bouton, une seule fois) et parler à Twitch à la place d'autres modules sans jamais leur montrer vos accès. Rien ne change pour vous si vous n'installez pas le bot.
- **Une vérification automatique de chaque module.** Tous les modules (et les deux exemples) passent maintenant une même série de contrôles : fichier de description, langues, réglages, sécurité, vie privée, textes en mots simples. Un défaut est repéré avant que vous ne le voyiez. Les défauts trouvés à la mise en place sont tous corrigés ci-dessous.

### Améliorations

- **Livre d'or : la vie privée est annoncée.** La page de confidentialité de votre site dit maintenant que les noms et messages des visiteurs sont enregistrés, et comment les faire retirer. Les champs « Image de bannière » et « Code d'invitation », qui sont facultatifs, ne sont plus comptés « à remplir ». Il faut Curiosa 0.1.22 ou plus.
- **Suggestions de jeux : la vie privée est annoncée.** Votre page de confidentialité explique ce que les visiteurs laissent quand ils proposent un jeu ou votent (nom ou pseudo, note, un petit cookie pour les votes).
- **Bannière d'annonce : le lien est vraiment facultatif**, et sa description est plus claire. Il faut Curiosa 0.1.22 ou plus.
- **Contacts et Partenariats : votre IA n'écrit plus sans votre accord.** Créer ou compléter un contact, créer ou modifier un partenaire, tenir son journal, lier ou détacher un contact : ces outils ne sont plus donnés d'office à votre IA, vous les accordez vous-même dans son accès. La lecture reste possible. Si votre IA les utilisait, recochez-les.
- **Overlay alertes : des mots plus simples.** La description n'emploie plus de terme technique, et le réglage « Jeton d'envoi » est rangé dans les réglages avancés.
- **Annonces Discord : une aide plus claire** pour l'adresse du lien Discord, sans terme technique.

### Pour les développeurs

- `npm test` lance la suite de conformité du cœur (dossier `testsupport/`, Curiosa 0.1.23) sur chaque dossier de `modules/` et `examples/` : une exigence = un test nommé. Aucun défaut connu n'est toléré (le tableau `KNOWN` de `tests/conformance.test.mjs` est vide). Un nouveau module est contrôlé sans rien écrire.
- Tests retirés car la suite les couvre : `optional-settings`, et des contrôles de `repo-rules`, `srp-guard` et des tests de modules (manifeste valide, langues, réglages, correspondance code/manifeste).
- Le test du Planning « carte prochain stream » ne dépend plus de l'heure.

## 1.5.1

*Changements depuis la 1.5.0.*

- **Les champs facultatifs ne sont plus marqués « à remplir ».** Dans Discord, les annonces Discord, le statut du live, Planning, le formulaire de contact, la Chaîne Twitch et la Chaîne YouTube, un réglage qui dit « facultatif » le reste vraiment : le laisser vide ne met plus l'extension « À configurer ». Il faut Curiosa 0.1.22 ou plus.

## 1.5.0

*Changements depuis la 1.4.0.*

- **Le site mesure maintenant vos directs Twitch et les vues de vos vidéos.** Il note les spectateurs moyens, le pic, les heures de live et regardées et les followers gagnés par jeu, à partir de l'activation du suivi (déjà active si « Suivre mes statistiques » était coché). Il faut Curiosa 0.1.17 ou plus.
- **Votre IA comprend mieux les chiffres de vos réseaux.** Quand il n'y a encore rien à lire, elle sait maintenant pourquoi et quoi faire. L'outil de saisie à la main change de nom (stats_set_manual) : recochez-le dans votre accès si vous l'utilisiez.
- **Un guide pour créer votre clé YouTube.** Le module Chaîne YouTube explique pas à pas, en haut de sa page, comment obtenir la clé gratuite dont il a besoin pour suivre vos abonnés, avec le lien vers la console Google et les pistes si la clé est refusée.

## 1.4.0

*Changements depuis la 1.3.3.*

- **Le site peut maintenant tenir à jour les chiffres de vos réseaux.** Vos abonnés, publications et vues sont notés régulièrement, avec leur évolution, pour vous et pour votre IA ; rien n'est montré sur votre site sans votre accord. Nouveau : Statistiques de la communauté ; il faut Curiosa 0.1.16 ou plus.
- **Vos réseaux peuvent maintenant partager le nombre de leurs abonnés.** YouTube, Twitch, Bluesky, Mastodon, GitHub, Discord et Reddit s'en occupent chacun, avec une case « Suivre mes statistiques ». Pour Twitch, un bouton « Connecter ma chaîne » suffit.

## 1.3.3

*Changements depuis la 1.3.2.*

- **Statut live annonce maintenant toutes vos chaînes Twitch, pas une seule.** Si plusieurs sont en direct, vous les voyez toutes, avec un petit choix pour passer de l'une à l'autre dans le lecteur. Mettez à jour Chaîne Twitch avec Statut live ; il faut Curiosa 0.1.14 ou plus.

## 1.3.2

*Changements depuis la 1.3.1.*

- **Le Catalogue propose maintenant tous les modules.** Blog, liens, pages, codes promo et les autres y figurent, au même titre que les autres. Il sait aussi quels modules ont besoin d'un autre, pour l'installer avec lui.

## 1.3.1

*Changements depuis la 1.3.0.*

- **Statut live et Chaîne Twitch partagent maintenant les mêmes identifiants.** Vous ne les saisissez qu'une fois, dans la Chaîne Twitch ; si vous les aviez déjà dans Statut live, un bouton les y reprend sans rien perdre. Sans identifiants, le lecteur n'apparaît plus (plus de panneau blanc « hors ligne »). Mettez à jour les deux ensemble.
- **Planning : choisissez l'apparence.** Liste classique, liste en alternance comme sur l'ancien site, semaine en grille, timeline, affiches, ou « à la une » : un aperçu de chaque choix est montré dans l'admin. Rien ne change tant que vous ne choisissez pas (module 1.3.0).

## 1.3.0

*Changements depuis la 1.2.1.*

- **Un seul carnet de contacts.** Chaque personne n'existe plus qu'une fois, dans le module Contacts ; les partenariats ne font que s'y référer. Les assistants savent désormais dans quel module écrire (mises à jour 1.1.0 de Contacts et de Partenariats).
- **Les contacts d'un partenaire sont de retour sur sa fiche.** On y retrouve leur nom, leur fonction et leur e-mail, on en ajoute ou on en retire, sans jamais effacer la personne du carnet.
- **Un bouton pour fusionner vos contacts existants.** Il montre d'abord ce qui serait fait, ne touche à rien sans votre accord, garde vos anciens contacts en copie et peut être annulé.

## 1.2.1

*Changements depuis la 1.2.0.*

- **Labyrinthe : le marcheur ne s'arrête plus.** Il pouvait se figer pour de bon après quelques instants, surtout avec un tracé dessiné à la main. Il continue sa promenade et se remet tout seul en route si quelque chose le bloque (module 1.0.2).
- **Overlay sponsors : plus de texte coupé.** Le titre et la légende du QR code s'affichent en entier (sur deux lignes si besoin), et le bandeau se réduit tout seul pour rester visible dans une petite source navigateur d'OBS. Mise à jour 1.0.1.

## 1.2.0

*Changements depuis la 1.1.0.*

- **Planning : les jaquettes des jeux sont de retour.** Pour chaque jeu écrit dans la description d'un événement (ligne « Jeu : … »), l'image du jeu s'affiche sur la page du planning, sur l'accueil, dans l'admin et sur l'image à partager. La clé RAWG se saisit une seule fois, dans Réglages du site ; sans elle, seul le nom du jeu s'affiche, et l'admin vous le dit.
- **Planning : le « prochain stream » de l'accueil devient une vraie carte.** Jaquette du jeu, jour et heure bien lisibles, « dans 3 h » ou « demain », bouton vers votre chaîne ; sans jeu (soirée caritative…), le logo de votre site sur fond mauve Twitch ; et un joli message quand rien n'est prévu.
- **Planning : un tutoriel et un fichier pour votre IA.** Dans la page du module, « Comment remplir mon agenda Google ? » explique où écrire le titre, le jeu et l'heure. « Télécharger le skill pour mon IA » donne un fichier à confier à votre assistant pour qu'il remplisse l'agenda correctement.
- **Statut live Twitch : le lecteur n'apparaît plus quand vous êtes hors ligne.** Avec vos identifiants Twitch, il ne s'affiche qu'en direct, plus de grand panneau blanc « hors ligne » (réglage « Quand afficher le lecteur » pour le garder toujours). Mise à jour 1.0.2.
- **Planning : l'image du panneau Twitch reprend l'allure de l'ancienne.** Une ligne par jour, deux streams au plus, avec les jaquettes à côté de l'heure et du titre. Elle se trouve à l'adresse `/m/<nom du module>/image` ; `?week=1` donne la semaine suivante.
- **Suggestions de jeux : les jaquettes manquantes sont retrouvées toutes seules.** Les suggestions arrivées sans image (reprises de l'ancien site, restaurées d'une sauvegarde, ou ajoutées pendant une panne de RAWG) sont cherchées petit à petit, sans jamais ralentir le site ni harceler RAWG. Dès qu'une clé est saisie ou corrigée, la recherche reprend.
- **Suggestions de jeux : un bouton « Rechercher les jaquettes manquantes ».** Il lance la recherche tout de suite et dit en clair ce qui s'est passé : combien de jaquettes trouvées, combien sans résultat, ou si la clé est absente, refusée ou si RAWG ne répond pas.
- **Une seule clé RAWG pour tout le site.** Les modules utilisent la clé des Réglages du site (il faut une version de Curiosa qui la propose). Sur une version plus ancienne, les suggestions de jeux gardent leur ancien champ de clé.
- **Les réseaux sont rangés par plateforme.** Les modules Twitch, Discord, YouTube et les réseaux sociaux se déclarent comme appartenant à leur plateforme, pour que l'administration puisse bientôt les regrouper au même endroit. Ils proposent une mise à jour (1.0.1) sans autre changement pour vous.
- **Labyrinthe : les boutons du tracé ne détruisent plus rien.** « Générer un nouveau tracé » et « Supprimer le tracé » préparent seulement le changement dans l'éditeur : rien n'est modifié tant que vous n'avez pas enregistré, et « Annuler les modifications » revient en arrière. Il faut Curiosa 0.1.10.

## 1.1.0

*Changements depuis la 1.0.0.*

- **Un module par réseau social.** Instagram, TikTok, X, Facebook, Discord, GitHub, Bluesky, Mastodon, Threads, Kick, Spotify, Reddit, Patreon, Ko-fi, Snapchat, Pinterest, Telegram, Steam, SoundCloud et Bandcamp. Vous indiquez votre identifiant ou l'adresse de votre profil, et l'icône apparaît dans l'en-tête du site.
- **Plusieurs comptes du même réseau.** Vous pouvez ajouter le même module plusieurs fois : votre chaîne Twitch et celle d'un ami, par exemple. Les modules Twitch et YouTube en profitent aussi.
- **Twitch et YouTube affichent leur bouton.** Ils s'ajoutent aux réseaux de l'en-tête, sans les saisir une deuxième fois.
- **Bandeau d'accueil plus simple.** Le titre et l'introduction sont déjà remplis avec ceux du site. Le bouton et la vidéo de fond s'ajoutent seulement si vous en voulez.
- **« Réseaux sociaux » devient « Liste de liens ».** Ce module sert pour vos sites et vos projets ; les réseaux ont maintenant les leurs.

## 1.0.0

*Première version du dépôt de modules, séparé du cœur de Curiosa.*

- **Tous les modules au même endroit.** Blog, réseaux sociaux, codes promo, pages, formulaire de contact, sponsors, planning, chaînes Twitch et YouTube… 21 modules et 2 exemples, installables depuis le Catalogue.
- **Une version figée pour chaque module.** Le Catalogue installe exactement la version relue, jamais un travail en cours.
- **Modules suggérés au départ.** Blog, réseaux sociaux et pages sont proposés lors de la première installation, et peuvent être passés sans risque.

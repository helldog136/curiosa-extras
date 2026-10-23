## Le direct, quelle que soit la plateforme

*Votre site annonce vos directs YouTube comme vos directs Twitch : bannière, lecteur, alertes à l'écran et message Discord. Pour Curiosa 0.2.6 ou plus. Modules touchés : Statut du live (ex-« Statut live Twitch ») 1.4.0, Overlay alertes (OBS) 1.1.0, Annonces Discord 1.1.0, Actions du live YouTube 1.1.0.*

### Nouveautés

- **Statut du live** (le module s'appelait « Statut live Twitch ») affiche aussi votre **direct YouTube** : bannière « En direct sur YouTube » avec le lien, ou une ligne par plateforme si vous êtes en direct sur les deux. Le lecteur YouTube ne se charge **qu'après un clic** du visiteur (réglage possible : dès l'ouverture de la page). Si vous êtes en direct sur les deux, **un seul lecteur** est montré, celui que vous choisissez (Twitch par défaut). Il suffit d'avoir **Chaîne YouTube**.
- **Overlay alertes (OBS)** : avec Actions du live YouTube, les **Super Chats, Super Stickers et adhésions** de votre direct s'affichent à l'écran, l'un après l'autre, avec le montant dans sa devise. Le **texte des messages est masqué** tant que vous ne cochez pas « Afficher le texte des messages YouTube ». Un bouton « Envoyer un faux Super Chat » montre le rendu.
- **Annonces Discord** : « En direct sur YouTube : titre » part **une seule fois par direct**, jamais deux. Si vous êtes en direct sur Twitch et YouTube en même temps, **un seul message** cite les deux (ou seulement la première plateforme, au choix). Le texte est modifiable avec `{platform}`, `{title}`, `{game}` et `{url}`.
- **Actions du live YouTube** : nouveau réglage « Lire le chat même sans Home Assistant (alertes OBS seulement) », éteint par défaut.

### Améliorations

- **Rien ne change si vous n'êtes que sur Twitch** : même bannière, même lecteur, mêmes réglages, mêmes messages Discord, même overlay ; aucun appel de plus.
- **La limite du jour de YouTube est ménagée** : vérification gardée 3 à 5 minutes par le site quel que soit le nombre de visiteurs, toutes les 10 minutes au plus pour Discord ; en cas de panne ou de limite atteinte, personne n'insiste.
- Statut du live dit en une phrase ce qui manque (« Installez Ma Chaîne Twitch ou Chaîne YouTube ») et renvoie vers le bon réglage.
- Les deux sources du Statut du live sont **facultatives** : une seule suffit.

### Pour les développeurs

- **Statut du live 1.4.0** : `youtube.mjs` (service facultatif `youtube.live`, `current`, via `callAll`, mémoire 180 s en direct / 300 s hors direct / 120 s en erreur, question partagée, 2,5 s d'attente au plus), `view.mjs` (bannière à plusieurs plateformes, lecteur « au clic » en `<details>` + cadre `loading="lazy"` sur `youtube-nocookie.com`). `requires` : `twitch.live` et `youtube.live`, tous deux `optional`. Identifiant, `platform: "twitch"` et réglages existants inchangés (la plateforme sert au regroupement visuel ; la retirer demanderait de modifier `tests/platform.test.mjs`). Nouveaux réglages `playerPlatform` (`twitch`/`youtube`) et `youtubeLoad` (`click`/`auto`).
- **Actions du live YouTube 1.1.0** : fournit le sujet `live.event` (`{ id, platform, kind, who, at, amount?, currency?, count?, text? }`, `amount` seulement avec `currency`) ; file **en mémoire** (`events.mjs`, 50 évènements, 15 minutes, purgée à la lecture, rien sur le disque). Réglages `shareAlerts` (oui) et `readWithoutHouse` (non).
- **Overlay alertes 1.1.0** : consomme `live.event` (permission `topics`, schéma déclaré) ; route `GET /m/<clé>/pull` appelée par la page de l'overlay toutes les 5 s **seulement si une instance d'Actions du live YouTube existe** (au plus une lecture toutes les 2 s, 20 alertes par lecture, 400 identifiants retenus, alertes de plus de 2 minutes jamais affichées), file de 50 côté page. `overlay()` devient asynchrone. Réglage `youtubeText` (non).
- **Annonces Discord 1.1.0** : besoin facultatif `youtube.live` ; clé `live:yt:<identifiant de vidéo>` ; document `yt` du stockage (dernière vérification) ; vérification toutes les `youtubeCheckMinutes` (10, avancé), revérifiée au plus une fois par minute juste avant d'annoncer ; réglages `youtubeLive`, `liveBoth` (`both`/`first`), `liveText`.
- Tests : `live-status-youtube`, `alerts-overlay-youtube`, `youtube-live-actions-alerts`, `discord-announcer-youtube`.
- Conflits probables : `modules/youtube-live-actions/{engine,index,module.json,settings}` et ses locales (avec `ideas/youtube-oauth`), `tests/live-status.test.mjs`, `catalogue/index.json` (non modifié ici).

## Connecteur YouTube 1.3.0 : connecter votre compte YouTube (facultatif)

*Pour répondre dans le chat de votre direct, ou lire ce chat quand YouTube refuse de le laisser lire avec la seule clé du site. Pour Curiosa 0.2.2 ou plus. Modules touchés : Connecteur YouTube 1.3.0, Actions du live YouTube (ajustements).*

### Nouveautés

- **Connecter votre compte YouTube, une fois.** Une mise en route en 4 étapes (avec les liens et les mots à chercher chez Google), puis un bouton « Connecter mon compte YouTube » : l'écran affiche un **code court** ; vous l'entrez sur google.com/device depuis votre téléphone, vous autorisez, vous revenez cliquer « C'est fait, vérifier ». Aucune adresse à régler.
- **« Déconnecter » en un clic** : l'accès est effacé du site et Google est prévenu.
- **Le site peut répondre dans le chat de votre direct**, mais **seulement si vous le décidez** : le réglage « Laisser le site répondre dans le chat » (options avancées) est **désactivé par défaut**. Aujourd'hui, Actions du live YouTube s'en sert pour répondre à « !stop » et « !start », et à rien d'autre.
- **Actions du live YouTube** écrit « Connectez votre compte YouTube dans le Connecteur YouTube », avec un lien, quand YouTube refuse de laisser lire le chat avec la clé seule, et reprend tout de suite après la connexion.

### Améliorations

- Autorisation **minimale** : lire le chat d'abord. L'autorisation d'écrire n'est demandée que si vous activez les réponses (Google la nomme « gérer votre compte YouTube » : c'est la plus petite que son système « code sur téléphone » permette pour écrire).
- Le code secret Google est saisi une fois et **jamais réaffiché** ; les accès ne sont jamais montrés ni écrits dans un journal.
- Les erreurs de Google (refus, code expiré, règle de votre organisation, Google qui ne répond pas) ont chacune une phrase simple et disent quoi faire.

### Pour les développeurs

- Flux « appareil » de Google (`oauth.mjs`) : trois adresses en liste fermée (`oauth2.googleapis.com/device/code|token|revoke`) par `ctx.api.net` ; portées `youtube.readonly` ou `youtube` (le flux appareil n'accepte pas `youtube.force-ssl`) ; pas de PKCE ni d'état (aucune redirection) ; l'adresse de vérification est contrôlée (https, google.com) ; jetons dans la collection `oauth-tokens` du stockage du connecteur ; rafraîchissement à la demande, une demande à la fois, pause d'une minute après une panne ; `invalid_grant` efface les jetons.
- `youtube.api` (toujours v1, ajouts) : `chatPost({ liveChatId, text })` (20 unités, 200 caractères, 3 s entre deux messages, 30 par heure ; `readOnly` pour ne jamais être recopié vers une réplique) ; `status().chat = { read, write }` selon les portées accordées ; `status().oauth` ; `chat_denied` sans compte et sans clé acceptée ; la lecture du chat passe avec le jeton (jamais la clé) quand le compte est connecté.
- Nouveaux réglages : `oauthClientId` (texte), `oauthClientSecret` (secret), `chatReply` (avancé, faux).
- Actions du live YouTube : état `connect` (lit `status().chat.read`), lien vers l'écran du connecteur, `reply()` inchangé (écrit seulement si `chat.write`).
- Le test `srp-guard` tolère `refresh_token` dans le Connecteur YouTube (nom du champ de Google).

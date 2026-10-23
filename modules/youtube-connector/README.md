# Connecteur YouTube

Garde **la clé YouTube de votre site à un seul endroit**. Vous la saisissez une fois ; elle n'est plus jamais affichée, ni écrite dans un journal. Les fonctionnalités qui lisent YouTube (par exemple votre chaîne, ses chiffres, la photo d'une chaîne amie) passent par ce connecteur au lieu de vous redemander la clé.

## Réglages

- **Clé YouTube** : gratuite. Dans la [console Google](https://console.cloud.google.com/apis/library/youtube.googleapis.com), activez « YouTube Data v3 », puis créez une clé dans « Identifiants » et collez-la ici. Si une de vos chaînes YouTube avait déjà une clé, elle est reprise toute seule : rien à retaper.
- **ID client Google** et **Code secret du client Google** (facultatifs) : seulement pour connecter votre compte YouTube (voir plus bas). Le code secret est saisi une fois et jamais réaffiché.
- **Part de la limite du jour utilisée par le site** (mode avancé) : 9 000 par défaut.
- **Laisser le site répondre dans le chat de votre direct** (mode avancé) : **désactivé par défaut**.

## La limite du jour de YouTube

YouTube accorde **10 000 unités par jour** à une clé gratuite, remises à zéro à minuit heure de Californie (9 h du matin en France). Lire une chaîne, une liste de vidéos ou les détails de 50 vidéos coûte **1 unité**. Le connecteur compte ce qui est utilisé et **s'arrête avant la fin** : 9 000 par défaut, dont 1 000 gardées pour ce que vous faites vous-même dans l'administration. Le panneau du connecteur dit combien a été utilisé aujourd'hui.

Si la limite est atteinte (ou si YouTube le signale), plus aucune demande ne part jusqu'à la remise à zéro : le panneau l'écrit en clair (« La limite YouTube du jour est épuisée, reprise demain à 9 h ») et le site continue d'afficher les **dernières données connues**, avec leur date.

## Connecter votre compte YouTube (facultatif)

Pour **répondre dans le chat** de votre direct (par exemple « Tout est coupé. » quand vous écrivez « !stop »), ou pour **lire le chat** si YouTube refuse de le laisser lire avec la seule clé du site, le connecteur peut se connecter à **votre compte YouTube**. Ce n'est pas nécessaire pour lire les chiffres de votre chaîne.

**Ce que YouTube exige, d'après sa documentation officielle** : écrire dans un chat demande bien une connexion au compte (autorisation « youtube » ou « youtube.force-ssl ») ; la liste des autorisations acceptées pour *lire* un chat y figure aussi, mais la documentation ne dit nulle part que la clé seule est refusée pour un chat public. Le connecteur essaie donc d'abord la clé, et dit « Connectez votre compte YouTube » seulement si YouTube la refuse.

**Mise en route, une seule fois** (l'écran du connecteur la guide pas à pas, avec les liens) :

1. Dans la console Google, choisissez ou créez un projet et vérifiez que « YouTube Data API v3 » est activée.
2. Dans Google Auth Platform, préparez l'écran d'autorisation (« Externe »), puis cliquez sur **Publier l'application** (sans cela, la connexion s'arrête au bout de 7 jours).
3. Dans « Clients », créez un client de type **Téléviseurs et périphériques à entrée limitée** : Google affiche un **ID client** et un **code secret**.
4. Collez ces deux valeurs dans les champs du connecteur, enregistrez, puis cliquez sur **Connecter mon compte YouTube**.

**Se connecter** : l'écran affiche un **code court** et l'adresse google.com/device. Ouvrez-la sur votre téléphone, entrez le code, choisissez le compte de votre chaîne, autorisez (si Google dit « application non vérifiée », c'est normal : c'est votre propre application ; « Paramètres avancés » puis « Accéder à… »), puis revenez cliquer sur **C'est fait, vérifier**. Aucune adresse de retour à configurer.

- **Autorisation minimale** : lecture du chat seulement. L'autorisation d'**écrire** n'est demandée que si vous activez, dans les options avancées, **« Laisser le site répondre dans le chat »** (désactivé par défaut) ; Google l'appelle alors « gérer votre compte YouTube » (le flux « appareil » de Google n'accepte pas d'autorisation plus étroite pour écrire). Le site ne s'en sert que pour écrire un court message quand une autre fonction le demande.
- **Déconnecter** : un clic efface l'accès gardé par le site et prévient Google. Vous pouvez aussi le retirer sur votre compte Google.
- Le code secret n'est jamais réaffiché ; les accès ne sont jamais montrés ni écrits dans un journal.

## Ce que fait le connecteur, et ce qu'il ne fait pas

- Il ne travaille **que sur demande** (une page, un panneau, un chiffre demandé) : aucune tâche ne tourne en arrière-plan.
- Une même réponse est gardée **10 minutes** : cent visiteurs ne font qu'une demande.
- Si YouTube ne répond plus, le connecteur fait une pause au lieu d'insister, et le panneau dit depuis quand.
- Il ne lit que des informations **publiques** (nom, photo, abonnés, vidéos d'une chaîne). La clé ne donne aucun accès à votre compte YouTube. Sans compte connecté, il n'écrit rien nulle part.
- Il n'écrit dans un chat **que** si vous l'avez autorisé (compte connecté, autorisation d'écrire donnée, « répondre dans le chat » activé), un message à la fois, 200 caractères au plus, 30 par heure.

## Pour les développeurs

Service `youtube.api` version 1 (non `each`, une seule instance). Chaque méthode est bornée à 15 s et ne lève jamais ; aucune réponse ne contient la clé.

| Méthode | Arguments | Réponse | Coût |
|---|---|---|---|
| `request` | `{ endpoint, params, priority?, timeoutMs? }` | `{ ok: true, status, json, cost, at, cached?, stale?, error? }` ou `{ ok: false, error, retryAt? }` | voir ci-dessous |
| `channels` | `{ ids?: string[], handles?: string[], priority? }` (1 à 50 au total) | `{ ok: true, items: [{ id, handle, title, avatar, subscribers, hidden, videos, views, at }], missing, failed, cost, stale? }` | 1 pour tous les `UC…`, 1 par `@pseudo` |
| `adopt` | `{ apiKey }` | `{ adopted: ["apiKey"] \| [], ready, conflict? }` (jamais la valeur) | 0 |
| `status` | — | `{ ready, key: "set" \| "missing" \| "refused", quota: { used, budget, reserve, day, resetAt, exhausted, until }, costs, lastGoodAt }` | 0 |

Liste fermée de `request` (toute autre demande : `invalid`, sans réseau) :

- `channels.list` (1 unité) : `part` ⊂ `snippet,statistics,contentDetails` ; `id` (1 à 50 `UC…`) **ou** `forHandle` (`@nom`) ;
- `playlistItems.list` (1 unité) : `part` ⊂ `snippet,contentDetails` ; `playlistId` ; `maxResults` ≤ 50 ; `pageToken` ;
- `videos.list` (1 unité) : `part` ⊂ `snippet,contentDetails,statistics,liveStreamingDetails` ; `id` (1 à 50). `liveStreamingDetails` (depuis la 1.1.0) donne l'heure de début programmée d'une première ou d'un direct public ; une vidéo privée programmée reste invisible avec une clé.
- `liveChatMessages.list` (**5 unités**, depuis la 1.2.0) : lecture du chat d'un direct public. `part` ⊂ `snippet,authorDetails` ; `liveChatId` ; `maxResults` 200 à 500 ; `pageToken`. **Jamais en cache** et jamais de réponse de repli (un chat périmé n'a aucun sens). Réponses d'erreur propres à ce chat : `chat_ended` (direct fini ou chat introuvable), `chat_disabled` (chat désactivé), `chat_denied` (YouTube demande plus qu'une clé pour ce chat : pause de 10 minutes pour CET appel seulement, la clé n'est pas déclarée refusée). Elles ne coupent jamais les autres lectures.
- `search.list` (100 unités) est exclu.

Toute demande accepte `fresh: true` (depuis la 1.2.0) : ni lue ni gardée en cache (pour savoir si un direct a commencé). Le coût est celui de l'appel.

`status().chat` dit ce que ce connecteur sait faire avec le chat : `{ read, write }`. `read` : un compte connecté avec une portée de lecture, ou une clé que YouTube n'a pas refusée pour le chat. `write` : compte connecté **avec** une portée d'écriture réellement accordée **et** « répondre dans le chat » activé **et** YouTube ne l'a pas refusé (pause de 10 minutes après un refus). Faux dans tous les autres cas : les modules ne doivent promettre une réponse dans le chat que si `write` est vrai. `status().oauth` (jamais un jeton) : `{ state: "none"|"pending"|"connected"|"stale", configured, read, write, writeWanted, scopes: ["read"|"manage"], since }`.

**`chatPost`** (1.3.0) : `{ liveChatId, text, priority? }` → `{ ok: true, cost: 20, at }` ou `{ ok: false, error }` avec `error` ∈ `invalid` (texte vide ou de plus de 200 caractères, identifiant invalide : sans réseau) · `write_off` (réglage coupé) · `chat_denied` (compte non connecté, portée d'écriture absente ou refus de YouTube) · `chat_ended` · `chat_disabled` · `quota` · `rate` (3 s entre deux messages, 30 par heure) · `timeout` · `network` · `circuit` · `busy`. Coût : 20 unités (`liveChatMessages.insert`, barème publié par YouTube), dans le même budget que le reste. Le texte n'est jamais repris dans la réponse. Hors liste fermée de `request` (qui ne contient aucune écriture) ; déclaré `readOnly` pour qu'un message ne soit jamais recopié vers une réplique du service.

**Connexion au compte** (flux « appareil » de Google, `oauth.mjs`) : trois adresses en liste fermée (`oauth2.googleapis.com/device/code`, `/token`, `/revoke`), HTTPS, par `ctx.api.net` ; portées `youtube.readonly` (lecture) ou `youtube` (écriture : le flux appareil de Google n'accepte pas `youtube.force-ssl`). Le code d'appareil ne quitte jamais le serveur ; l'adresse à ouvrir est contrôlée (https, google.com, sans port, sans détour) et remplacée par `https://www.google.com/device` sinon. Jetons dans le stockage privé du connecteur (collection `oauth-tokens`, le cœur n'offrant pas d'écriture dans un réglage secret), jamais renvoyés ni journalisés ; jeton d'accès renouvelé à la demande (une seule demande à la fois, pause d'une minute après une panne, jamais de minuteur) ; `invalid_grant` : jetons effacés et message « reconnectez-le » ; le chat passe avec `Authorization: Bearer …` (jamais la clé en même temps) ; un 401 renouvelle le jeton et réessaie une fois. Anti-abus : 10 s entre deux demandes de code, 10 par heure, vérification au plus une fois par intervalle annoncé par Google, code mort après 30 minutes.

Erreurs : `config` (aucune clé), `auth` (clé refusée : pause de 10 min ou jusqu'au changement de clé), `quota` (budget du jour atteint, ou 403 `quotaExceeded` : rien avant minuit `America/Los_Angeles`, `retryAt`), `rate`, `timeout`, `network`, `circuit`, `busy`, `invalid`, `too_large`. Avec un résultat déjà lu pour la même demande, la réponse est `ok: true` avec `stale: true`, `at` (date de la lecture) et `error`.

Fonctionnement : tout passe par `ctx.api.net` (seau propre à la clé, disjoncteur par hôte, déduplication) ; la clé est envoyée dans l'en-tête `x-goog-api-key`, jamais dans l'adresse. Cache de 10 min par demande (300 entrées), pause d'une minute après une panne pour la même demande. Compteur du jour dans le stockage (`quota`), budget réglable (`dailyBudget`, 9 000 par défaut), dont `min(1000, budget/9)` réservées à `priority: "interactive"`. Les unités ne sont comptées que si une demande est réellement partie. Une clé reprise par `adopt` est gardée dans le stockage (`credential`) ; le réglage « Clé YouTube » l'emporte toujours.

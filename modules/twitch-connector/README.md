# Connecteur Twitch

Le Connecteur Twitch **relie votre site à Twitch, une seule fois pour tous vos modules Twitch**. Il garde votre application Twitch et les comptes Twitch que vous connectez (votre chaîne, et si vous le voulez un compte pour le bot du chat), en sécurité : rien n'est jamais affiché. Vos autres modules Twitch (*Ma Chaîne Twitch*, *Bot Twitch*, *Raid Twitch*…) passent par lui.

## Pour commencer
Le Connecteur s'installe tout seul avec *Ma Chaîne Twitch*. Ouvrez sa page et suivez le guide (5 minutes, une seule fois, gratuit) :

1. Ouvrez **dev.twitch.tv/console** et connectez-vous avec votre compte Twitch. Cliquez sur « Register Your Application ».
2. Donnez-lui un nom. Dans la case **« Redirect URLs »**, collez l'adresse affichée par le Connecteur (bouton **« Copier »**), puis « Add ».
3. Catégorie « Website Integration », type de client « Confidential », puis « Create ».
4. Ouvrez votre application (« Manage »), copiez le **Client ID**, cliquez sur « New Secret » et copiez le **secret**. Collez-les dans les réglages du Connecteur et enregistrez.

Ensuite, le bouton **« Connecter ma chaîne Twitch »** se trouve dans *Ma Chaîne Twitch* (et, pour le compte qui répond dans le chat, dans le *Bot Twitch*).

**Vous utilisiez déjà « Chaîne Twitch » ?** Rien à faire : à la mise à jour, votre application et vos connexions arrivent ici toutes seules, sans les ressaisir. Les adresses déjà enregistrées chez Twitch restent valables ; la page du Connecteur les liste pour que vous les laissiez dans la console Twitch.

## Ce que montre la page
- **Votre application Twitch** : prête ou non, et l'adresse à coller chez Twitch, avec un bouton « Copier ». Jamais l'identifiant ni le secret.
- **Les comptes connectés** : la chaîne, le compte, l'état (« Connecté », « À reconnecter », « Une autorisation de plus est demandée »), et un bouton **Déconnecter** (qui retire aussi l'accès chez Twitch).
- **La santé de Twitch**, en mots simples : « Twitch répond normalement », « trop de demandes, pause jusqu'à 11 h 00 »… Pendant une panne, vos pages affichent les dernières données connues.

## Plusieurs chaînes
Le Connecteur est **une seule application Twitch**, avec autant de comptes connectés que de chaînes (une *Ma Chaîne Twitch* par chaîne). Chaque chaîne se connecte avec son propre compte Twitch.

## Limites
- Une seule application Twitch par site. Si une ancienne chaîne utilisait une autre application, sa page vous demande de la reconnecter une fois (avec un bouton) ; l'ancien accès est ensuite retiré tout seul.
- L'adresse de votre site doit commencer par https:// pour que Twitch accepte la connexion.
- Si Twitch dit « trop de demandes », tout le site fait une pause jusqu'à l'heure indiquée par Twitch, puis reprend seul.

## Pour les développeurs

Identifiant `twitch-connector`, `instances: "single"`, `minCore` 0.2.2. La clé d'instance par défaut est celle que le cœur 0.2.0 dérive de l'identifiant du module (`twitch-connector`) : l'adresse de retour des **nouvelles** configurations est donc `<site>/m/twitch-connector/oauth/callback` (le cœur 0.2.0 n'a pas de réglage de clé par défaut ; voir le CHANGELOG). Réglages : `appClientId` (texte, `refersTo: "external"`) et `appSecret` (secret). Les valeurs reprises vivent dans le stockage (`twitchApp`) ; un réglage saisi a toujours le dessus, champ par champ.

### Service `twitch.api`, version 3 (non `each`)
Sur-ensemble de la version 2 offerte par « Chaîne Twitch » 1.7 : les appels de *Bot Twitch*, *Raid Twitch* et *Statut live* passent sans changement.

| Méthode | Arguments → résultat |
|---|---|
| `request` | `{ as: "app" \| "user", slot?, method, path, query?, body?, channel?, priority? }` → `{ ok: true, status, json }` ou `{ ok: false, error: "forbidden" \| "invalid" \| "config" \| "auth" \| "rate" \| "network" \| "scope" }`. `channel` choisit le compte connecté pour un appel `user` (sans lui : la première chaîne connue). |
| `account` | `{ channel?, slot? }` → `{ ok, channel, ready, https, status: "none" \| "ok" \| "reconnect" \| "more", login, userId, scopes, wanted, connectedAt?, result?, adminPath }` — jamais un jeton. |
| `wantScopes` | `{ channel?, consumer, slot, scopes, returnTo? }` → `{ ok, scopes }` (liste fermée : `user:read:chat`, `user:write:chat`, `user:bot`, `channel:bot`, `moderator:read:followers`, `channel:read:subscriptions`). |
| `connectLink` | `{ channel?, slot, scopes?, returnTo? }` → `{ ok, url }` ou `{ ok, url: null, reason: "connected" \| "not_ready" \| "https" \| "nothing" }`. |
| `disconnect` | `{ channel?, slot: "main" \| "bot" }` (emplacement explicite) → `{ ok, reached }`. |
| `connections` | → `[{ id, login, displayName, slot, channel, scopes, status: "ok" \| "expired" \| "missing_scopes" }]`. |
| `exchangeCode` | `{ code, state, redirectUri, error? }` → `{ ok: true, login, slot, returnTo? }` ou `{ ok: false, error: "state" \| "expired" \| "denied" \| "network", returnTo? }`. `redirectUri` doit être exactement celle de l'autorisation ; un `state` prévu pour une autre adresse n'est pas consommé. |
| `adopt` | `{ clientId, clientSecret, channel?, redirectUri?, connections: [{ slot, login, accessToken, refreshToken, scopes, expiresAt, userId?, clientId? }], wants? }` → `{ ok: true, adopted: ["clientId" \| "clientSecret" \| "main" \| "bot"], ready }` ou `{ ok: false, error: "conflict", adopted: [], ready: false }`. Jamais une valeur ; idempotent ; n'écrase ni un réglage, ni l'application reprise, ni une connexion présente. `ready` : application complète ET chaque connexion fournie présente. |
| `status` | → `{ ready, missing, health }` (sans réseau). |
| `register` | `{ channel, redirectUri?, remove? }` → `{ ok }` : une chaîne se fait connaître ; `redirectUri` (même site, `/m/<clé>/oauth/callback`) sert à ses liens d'autorisation. |
| `retire` | `{ clientId, tokens ≤ 4 }` → `{ revoked }` : révoque des jetons d'une autre application (reprise en conflit). |

**Liste fermée** (`helix.mjs`, `ALLOWED`). Application : `GET users` (`login` ou `id`, 1 à 100), `GET streams` (`user_login` ou `user_id`, 1 à 100, `first`), `GET games` (`id` ≤ 100), `GET channels` (`broadcaster_id` ≤ 100), `GET videos` (`user_id`, `first`, `after`, `type`), `GET clips` (`broadcaster_id`, `first`, `after`, `started_at`, `ended_at`), `GET/POST/DELETE eventsub/subscriptions`. Compte connecté : `POST chat/messages` (`user:write:chat`), `GET channels/followers` (`moderator:read:followers`), `GET subscriptions` (`channel:read:subscriptions`). Corps : 10 000 octets au plus, seulement pour les deux `POST`.

### Réseau, limites, caches
- Tout passe par `ctx.api.net` : 8 s par appel, pause après 429 (`Retry-After`, `Ratelimit-Reset`) et disjoncteur fournis par le cœur, journal sans corps ni requête (les secrets voyagent dans le corps ou les en-têtes). Seau `bucket` = l'application (`twitch-app:<empreinte du Client ID>`) : un 429 met en pause **tous** les modules consommateurs, sans réseau, jusqu'à l'heure donnée.
- Un appel complet du service (jeton, renouvellement, nouvel essai compris) est borné à 15 s (`oauth.timing.sharedMs`). Jeton d'application en mémoire (un par application) ; jetons des comptes renouvelés avec le secret 2 minutes avant leur fin, ou après un 401 (une fois, fusionné entre appels simultanés), sinon « À reconnecter ». `GET users` et `GET games` gardés 10 minutes (300 réponses au plus).
- Bornes du stockage : 50 connexions, 50 chaînes connues, 50 demandes d'autorisations, 20 liens en attente (un par chaîne et emplacement), 40 résultats.
- Bloc d'administration `netHealth` (`api.twitch.tv`, `id.twitch.tv`) avec la date de la dernière bonne réponse.

### Sécurité
`state` : 256 bits, usage unique (consommé avant tout appel à Twitch), 10 minutes, lié à l'adresse de retour exacte et à la chaîne ; le compte autorisé doit être celui de la chaîne (emplacement `main`), sinon refus et jetons révoqués. Au-delà de 20 retours invalides en 10 minutes : 429. Après le retour, la redirection va vers une page `/admin/instances/…` vérifiée, jamais vers une adresse de la requête. Les jetons ne quittent jamais le stockage de l'instance (ni réglage, ni bloc, ni réponse de service, ni journal).

# Connecteur YouTube

Garde **la clé YouTube de votre site à un seul endroit**. Vous la saisissez une fois ; elle n'est plus jamais affichée, ni écrite dans un journal. Les fonctionnalités qui lisent YouTube (par exemple votre chaîne, ses chiffres, la photo d'une chaîne amie) passent par ce connecteur au lieu de vous redemander la clé.

## Réglages

- **Clé YouTube** : gratuite. Dans la [console Google](https://console.cloud.google.com/apis/library/youtube.googleapis.com), activez « YouTube Data v3 », puis créez une clé dans « Identifiants » et collez-la ici. Si une de vos chaînes YouTube avait déjà une clé, elle est reprise toute seule : rien à retaper.
- **Part de la limite du jour utilisée par le site** (mode avancé) : 9 000 par défaut.

## La limite du jour de YouTube

YouTube accorde **10 000 unités par jour** à une clé gratuite, remises à zéro à minuit heure de Californie (9 h du matin en France). Lire une chaîne, une liste de vidéos ou les détails de 50 vidéos coûte **1 unité**. Le connecteur compte ce qui est utilisé et **s'arrête avant la fin** : 9 000 par défaut, dont 1 000 gardées pour ce que vous faites vous-même dans l'administration. Le panneau du connecteur dit combien a été utilisé aujourd'hui.

Si la limite est atteinte (ou si YouTube le signale), plus aucune demande ne part jusqu'à la remise à zéro : le panneau l'écrit en clair (« La limite YouTube du jour est épuisée, reprise demain à 9 h ») et le site continue d'afficher les **dernières données connues**, avec leur date.

## Ce que fait le connecteur, et ce qu'il ne fait pas

- Il ne travaille **que sur demande** (une page, un panneau, un chiffre demandé) : aucune tâche ne tourne en arrière-plan.
- Une même réponse est gardée **10 minutes** : cent visiteurs ne font qu'une demande.
- Si YouTube ne répond plus, le connecteur fait une pause au lieu d'insister, et le panneau dit depuis quand.
- Il ne lit que des informations **publiques** (nom, photo, abonnés, vidéos d'une chaîne). La clé ne donne aucun accès à votre compte YouTube.

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
- `videos.list` (1 unité) : `part` ⊂ `snippet,contentDetails,statistics` ; `id` (1 à 50).
- `search.list` (100 unités) est exclu.

Erreurs : `config` (aucune clé), `auth` (clé refusée : pause de 10 min ou jusqu'au changement de clé), `quota` (budget du jour atteint, ou 403 `quotaExceeded` : rien avant minuit `America/Los_Angeles`, `retryAt`), `rate`, `timeout`, `network`, `circuit`, `busy`, `invalid`, `too_large`. Avec un résultat déjà lu pour la même demande, la réponse est `ok: true` avec `stale: true`, `at` (date de la lecture) et `error`.

Fonctionnement : tout passe par `ctx.api.net` (seau propre à la clé, disjoncteur par hôte, déduplication) ; la clé est envoyée dans l'en-tête `x-goog-api-key`, jamais dans l'adresse. Cache de 10 min par demande (300 entrées), pause d'une minute après une panne pour la même demande. Compteur du jour dans le stockage (`quota`), budget réglable (`dailyBudget`, 9 000 par défaut), dont `min(1000, budget/9)` réservées à `priority: "interactive"`. Les unités ne sont comptées que si une demande est réellement partie. Une clé reprise par `adopt` est gardée dans le stockage (`credential`) ; le réglage « Clé YouTube » l'emporte toujours.

# Home Assistant : contrat HTTP et contrat de service, tels qu'IMPLÉMENTÉS

Ce document décrit ce que le module `home-assistant` (version 1.0.0, Curiosa 0.2.6 ou plus) fait réellement. Il prime sur le cahier des charges ; les écarts sont listés en fin de page. Le simulateur `tests/helpers/fakeHaClient.mjs` parle exactement ce contrat (transport direct ou `FakeHaClient.overHttp(base)` vers un vrai site).

## 1. HTTP public

Préfixe : `<SITE_URL>/m/<instance>/` (l'instance est unique ; sa clé est le plus souvent `home-assistant`, elle est rendue par `pair`). HTTPS obligatoire côté intégration (sauf localhost de développement). JSON UTF-8. Corps de requête ≤ 4096 octets (413 au-delà). Toutes les réponses : `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Content-Type: application/json; charset=utf-8`. Aucune donnée personnelle dans les réponses. Un `Origin` étranger est refusé par le cœur (403) : l'intégration (client serveur) n'envoie pas d'en-tête `Origin`.

Erreurs communes : `{ "ok": false, "error": "<code>" }` avec `error` ∈ `bad_request` (400), `too_large` (413), `unauthorized` (401, + `WWW-Authenticate: Bearer`), `method_not_allowed` (405, + `Allow`), `rate_limited` (429, + `Retry-After: <secondes entières ≥ 1>`), `unavailable` (503, + `Retry-After: 5` : panne passagère de Curiosa, réessayer avec repli). 404 : module absent (réponse du cœur, pas du module).

### 1.1 `POST pair`
Corps : `{ "code": "ABCD2345", "name": "Maison" }` (`code` : 8 caractères, insensible à la casse, espaces et tirets ignorés ; `name` facultatif, ≤ 40 caractères).
Succès 200 : `{ "token": "<43 caractères A-Za-z0-9_->", "instance": "<clé>", "pollSeconds": 3 }` (exactement ces trois clés).
Échec : 400 `{ "ok": false, "error": "invalid_code" }` (code faux, expiré, déjà utilisé ou annulé : même réponse), 400 `bad_request`, 413, 405, 429.
Règles : code à usage unique, valable 10 minutes, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 5 mauvais essais l'annulent (même si le bon code arrive ensuite). Limite de débit : 10 essais par heure et par visiteur, 60 par heure en tout (429). Le jeton n'est rendu qu'ici, une seule fois ; Curiosa n'en garde que l'empreinte SHA-256. Un nouvel appairage remplace l'appareil précédent (son jeton reçoit 401). « Dissocier » dans l'administration révoque le jeton (401).

### 1.2 `GET pull?cursor=<n>&limit=<k>`
En-tête : `Authorization: Bearer <jeton>`. `cursor` : entier ≥ 0 (défaut 0) ; `limit` : entier, ramené à 1..10 (défaut 10). Toute autre forme : 400.
Succès 200 (exactement ces clés) :
```json
{ "enabled": true, "live": true, "serverTime": "2026-10-14T20:00:03.000Z", "cursor": 12, "pollSeconds": 3,
  "actions": [ { "id": "a1b2c3d4e5f60718", "key": "tts:lire", "text": "Léa dit : Bonjour", "viewer": "Léa",
                 "issuedAt": "…Z", "expiresAt": "…Z", "test": true } ] }
```
- `enabled` : faux si le coupe-circuit est actif ; `live` : vrai si Twitch dit « en direct » ou dans les 5 minutes qui suivent. Si `enabled` est faux : `actions` vide (la réponse reste 200 : c'est ainsi que l'intégration voit « coupé côté Curiosa »). Si `live` est faux : `actions` vide, SAUF pour une action marquée `test` (voir plus bas).
- `actions[]` : `id` (16 hexadécimaux), `key` (`^[a-z0-9][a-z0-9:_-]{0,39}$`), `text` (déjà nettoyé et modéré ; chaîne vide sauf pour les clés `tts:*` ; **déjà préfixée « Pseudo dit : »** si le réglage est actif : l'intégration ne doit PAS ajouter de préfixe), `viewer` (pseudo nettoyé, ≤ 25 caractères, peut être vide ; informatif), `issuedAt`, `expiresAt` (ISO UTC), et le champ **facultatif `test: true`**, présent seulement pour un essai lancé par la propriétaire (absent sinon) : l'intégration l'exécute comme les autres (même chemin) ; elle peut l'afficher comme un test.
- Curseur : chaque action a un numéro croissant. Curiosa renvoie, dans l'ordre, les actions non acquittées, non expirées, de numéro > `cursor`, par lots de `limit` au plus. `cursor` (dans la réponse) = le plus grand numéro livré dans ce lot, sinon le `cursor` demandé (ramené au dernier numéro existant si l'intégration est « en avance »). **L'intégration renvoie ce `cursor` à l'appel suivant, après avoir traité le lot** ; si une réponse se perd, elle repasse l'ancien curseur et reçoit de nouveau les actions non acquittées.
- Chaque action est livrée **au plus 3 fois** tant qu'elle n'est pas acquittée ; au-delà elle n'est plus livrée et expire. Déduplication par `id` à la charge de l'intégration.
- Expiration : 60 s après `issuedAt` (réglable 15–300 s), constatée à la lecture (aucun minuteur) : une action expirée n'est jamais livrée. Comparer `expiresAt` à `serverTime` (et non à l'horloge de Home Assistant seule) ; tolérance conseillée 5 s.
- Débit : au moins 1 s entre deux appels d'un même appareil, sinon 429 + `Retry-After: 1`. Intervalle conseillé : `pollSeconds` (3 par défaut, réglable 2–30). Repli conseillé : ×2 jusqu'à 60 s sur erreur (429, 5xx, réseau). **401 : ne pas boucler**, passer en « ré-appairage nécessaire ».
- Jeton refusé : 401 (+ 429 après 20 refus en 5 minutes pour un même visiteur).
- Un appel authentifié réussi est le « signe de vie » : Curiosa considère Home Assistant hors ligne s'il n'a pas interrogé depuis plus de 60 s.

### 1.3 `POST ack`
En-tête `Authorization: Bearer <jeton>`. Corps : `{ "id": "<id>", "status": "done|failed|ignored", "code": "ok|unmapped|disabled|expired|error" }`. Combinaisons : `status: "done"` ⇔ `code: "ok"`. Autre combinaison, valeur hors liste, `id` mal formé : 400 `bad_request` (rien n'est enregistré). Aucun texte libre.
Succès 200 : `{ "ok": true, "result": "recorded" | "already" | "unknown" }` (`already` : déjà acquittée, expirée ou annulée ; `unknown` : identifiant inconnu ; ce n'est jamais une erreur : ne pas réessayer). Débit : 60 accusés / 10 s (429).
Sens : `ignored/unmapped` = pas de scène liée à cette clé dans Home Assistant ; `ignored/disabled` = interrupteur local coupé ; `ignored/expired` = arrivée trop tard ; `failed/error` = l'exécution a échoué.

## 2. Service `home-assistant.bridge` (version 1)
Appelé par `ctx.api.services.call("home-assistant.bridge", méthode, args)`.

- `enqueue({ key, text?, viewer?, ref })` → `{ ok: true, id }` ou `{ ok: false, reason }`. `reason` ∈ `unknown_key` | `not_paired` | `off` | `not_live` | `offline` | `blocked` | `busy` (ordre d'évaluation). `ref` : identifiant d'échange Twitch (`^[A-Za-z0-9._:-]{1,80}$`, sinon traité comme absent) ; **un même `ref` rendu deux fois renvoie le même `id`** (Twitch qui rejoue). `unknown_key` : clé invalide. `offline` : Home Assistant n'a pas interrogé depuis plus de 60 s. `not_live` : pas de direct vu par Twitch (ou module « Ma Chaîne Twitch » absent, ou Twitch muet : le module reste fermé). `blocked` : texte refusé (détail uniquement dans le journal). `busy` : file de 50 pleine, ou attente entre deux messages lus (par viewer 60 s, global 10 s, réglables ; ne concerne que les clés `tts:*`). Le texte (`text`) n'est pris en compte que pour les clés `tts:*`, nettoyé et modéré (nettoyage NFKC, liens, adresses, mentions, balises, emojis > 3, répétitions, longueur ≤ 140 réglable 20–300, numéros, liste de mots) ; un texte vide après nettoyage est `blocked`.
- `status()` → `{ enabled, paired, lastSeenAt, live, queued }` (`lastSeenAt` : ISO ou `null`, `live` : avec la marge de 5 minutes). Aucun secret. N'écrit rien.
- `stop({ by })` → `{ ok: true, enabled: false }` ; `start({ by })` → `{ ok: true, enabled: true }`. `by` obligatoire (chaîne ≤ 40 ; sinon `{ ok: false, reason: "invalid_by" }`) ; `start` avec `by` qui commence par `mod:` → `{ ok: false, reason: "forbidden" }` (un modérateur coupe, ne reprend pas). L'autorité réelle (qui a le droit d'écrire `!stop`/`!start`) est vérifiée par l'appelant.
  Couper refuse tout ce qui attendait (`ha.result` : `refused/off`).

## 3. Sujets publiés (`exports`, consommés par `ctx.api.topics.collect`)
- `ha.result` : éléments `{ ref, id, status, code, at }` (`at` ISO), les plus récents d'abord, 50 au plus, gardés 24 h, **seulement les actions qui ont un `ref`** (un test n'en a pas). `status` ∈ `done` | `failed` | `ignored` (accusé de HA : `code` comme dans `ack`), `expired` (`code: "expired"`, constaté à la lecture), `refused` (`code` : `off` si coupé, `not_paired` si dissocié). Le consommateur déduplique par `id`. À rembourser : tout sauf `done`.
- `ha.state` : un élément `{ enabled, live, paired, lastSeenAt? }` (`lastSeenAt` absent si jamais vu).

## 4. Essai de la propriétaire (administration et outil `home_assistant_test`)
Même chemin que `enqueue` (même file, expiration, modération réelle du texte, accusé), avec : `test: true` dans l'action de `pull`, `viewer: "Test"`, aucun `ref` (donc rien dans `ha.result`), jamais d'appel à Twitch, **possible hors direct** (le coupe-circuit, l'appairage et la présence de Home Assistant restent obligatoires ; refus `off`/`not_paired`/`offline` dits en mots simples), pas d'attente par viewer, droit `ha.test`, limite 1 test / 3 s et 30 / heure, pastille « Test » dans le journal. Un test hors direct est livré même si `live` est faux dans la réponse de `pull`.

## 5. Écarts avec le cahier des charges
1. **503** n'est PAS « coupé » : le coupe-circuit répond 200 avec `enabled: false` et `actions: []` (l'intégration peut ainsi afficher l'état). 503 = panne passagère.
2. `pull` ajoute `pollSeconds` ; les actions ajoutent le champ facultatif `test`.
3. `ack` répond `{ "ok": true, "result": … }` ; combinaisons statut/code incohérentes refusées (400).
4. Le texte préfixé par le pseudo est fabriqué par Curiosa (réglage) : HA ne préfixe pas.
5. 429 aussi pour jeton refusé en rafale (20 / 5 min / visiteur) et accusés (60 / 10 s).
6. Service : `stop`/`start` refusent un `by` vide ; `start` refuse `mod:*`. `status` rend `live` avec la marge de 5 minutes.
7. Pas d'interrupteur manuel « Je suis en direct » : sans « Ma Chaîne Twitch », le pont reste fermé (`not_live`) et la page le dit.

# Service `audience.session` v1 (Participation) et convention `audience.remote` v1

**Ce n'est PAS une modification de `contact.book`, `privacy.subject` ni d'un contrat du cœur** : c'est un service de plus, offert par le module Participation (`audience`), dans la lignée de `contact.curate`
(`tests/contract-ext/README.md`). Suite exécutable : `audience.contract.mjs`, contre le double `tests/helpers/fakeAudience.mjs` ET contre le vrai module (`tests/audience-contract.test.mjs`).
**À valider par le propriétaire** avant d'être reporté dans `docs/V2-CONTRACTS.md` du cœur.

Un module d'animation (Sondages, plus tard Quiz, Bingo, Tombola…) le déclare **en facultatif** : `requires: [{ "service": "audience.session", "min": 1, "optional": true }]`
(cœur 0.2.0 ; le cœur ne l'installe alors pas d'office : c'est `suggestInstall` qui le propose au propriétaire). Sans lui, le module garde son mode autonome ; avec lui, il lui confie l'identité,
les limites, la télécommande et le direct. Un module qui NE peut PAS fonctionner sans la base le déclare en dur : le cœur installe alors Participation tout seul.

## Règles communes
- Aucune méthode ne lève. Réponse `{ ok: true, … }` ou `{ ok: false, error: "<code>" [, retryAfter] }`. Par le cœur, l'appelant reçoit en plus `{ ok: false, reason: "unavailable" | "failed" }` si la base est absente ou en panne : il retombe alors sur son mode autonome (délai conseillé : 3 s).
- **Salle** (`room`) : l'espace d'une animation. `^[a-z0-9][a-z0-9:._-]{0,59}$`, créée à la première inscription (`join`). Convention : `<module>:<clé de l'instance>`. 200 salles au plus (la plus ancienne inactive depuis plus d'un jour cède sa place, sinon `too_many_rooms`).
- **Code** (`token`) : le code au hasard du navigateur, `^[A-Za-z0-9_-]{22,64}$`. Il n'est **jamais gardé ni renvoyé** : le module en tire un identifiant propre à la salle (`id`, 40 caractères hexadécimaux), donc deux salles ne se recoupent pas. Vider une salle change son sel : plus personne n'y est reconnu.
- **Connexion** (`conn`, facultative) : `{ forwarded?, real? }`, les en-têtes `x-forwarded-for` et `x-real-ip` tels quels. La base les brouille tout de suite avec un sel quotidien tenu en mémoire (jamais écrit) ; l'adresse n'est ni gardée ni journalisée. Sans `conn`, toutes les connexions partagent une empreinte.
- **Pseudo** : unique par salle (accents, majuscules, chiffres-pour-lettres ignorés), 3 à 20 caractères (réglable de 2 à 10 et de 8 à 30), lettres/chiffres/espaces/tirets, mots interdits (liste modifiable). **Jamais tronqué** : refusé avec un code.
- Droits : `mute` et `clearRoom` exigent le droit `moderate` de Participation. Ils sont listés dans `offers[].callerRights` : un module les appelle depuis une de SES actions d'administration avec `{ asCaller: true }` (cœur 0.2.4). Ailleurs : `denied`.

## Méthodes

| Méthode | Arguments | Réponse `ok: true` | Erreurs |
|---|---|---|---|
| `info` (lecture) | `{}` | `{ version: 1, base: "/m/<clé>", limits: { pseudoMin, pseudoMax, participants, rooms, liveBytes }, remote: true }` | — |
| `join` | `{ room, token, conn?, label?, pseudo? }` | `{ participant: { id, pseudo \| null, muted, isNew }, room: { key, count } }` : inscrit ou retrouve la personne ; avec `pseudo`, le choisit dans le même geste (un pseudo refusé n'annule pas l'inscription). Une personne déjà inscrite n'use pas la limite de nouvelles personnes. | `invalid`, `limit` (+`retryAfter`), `room_full` (5 000 par salle), `too_many_rooms`, `muted` (avec `pseudo`), `pseudo_short`, `pseudo_long`, `pseudo_chars`, `pseudo_banned`, `pseudo_taken`, `busy` |
| `who` (lecture) | `{ room, token }` | `{ participant: { id, pseudo, muted } \| null }` (ne crée rien) | `invalid`, `unknown_room` |
| `setPseudo` | `{ room, token, pseudo }` | `{ participant }` ; rejouer le même pseudo est accepté ; au plus 8 changements par heure et par personne | `invalid`, `unknown_room`, `unknown_participant`, `muted`, `limit`, `pseudo_*` |
| `checkPseudo` (lecture) | `{ pseudo, room? }` | `{ valid: true, value }` ou `{ valid: false, code }` (avec `room` : `pseudo_taken` aussi) | `invalid`, `unknown_room` |
| `claim` | `{ room, token, key }` (`key` : `^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$`) | `{ first: true }` : la **voix unique** de cette personne pour cette clé (un sondage, une manche, une question) | `invalid`, `unknown_room`, `unknown_participant`, `muted`, `already`, `room_full` (20 000 voix par salle), `limit` |
| `release` | `{ room, token, key }` | `{ released: bool }` : rend la voix (le vote n'a finalement pas eu lieu) | `invalid`, `unknown_room` |
| `limit` | `{ room, scope, conn?, token?, max, per }` (`scope` : `^[a-z0-9][a-z0-9:._-]{0,39}$`, `max` 1–10 000, `per` 1–86 400 s) | `{ remaining }` : compte un passage dans une fenêtre glissante, par connexion (et par personne si `token`) | `invalid`, `limit` (+`retryAfter` en secondes) |
| `mute` (écrit, droit) | `{ room, id \| pseudo, muted: bool }` | `{ participant }` : une personne en sourdine reste dans la salle mais ne peut ni `claim`, ni `setPseudo` ; elle le reste si elle revient | `denied`, `invalid`, `unknown_room`, `not_found` |
| `clearRoom` (écrit, droit) | `{ room }` | `{ removed }` : tout le monde est oublié, voix et pseudos compris | `denied`, `invalid`, `unknown_room` |
| `forget` | `{ token }` | `{ removed }` : retire la personne de TOUTES les salles (droit à l'oubli) ; rejouable | `invalid` |
| `journal` | `{ what, room?, detail?, who? }` | `{}` : une ligne du journal d'audit (qui a décidé quoi, quand ; 500 lignes, 30 jours) | `invalid` |
| `livePublish` | `{ room, channel, data, public?, readKey?, refreshAt?, ttlSec? }` (`channel` : `^[a-z0-9][a-z0-9_-]{0,29}$`, `data` ≤ 16 Ko, `readKey` 8–200 caractères) | `{ rev }` : publie l'état d'un point de lecture. Même état = même `rev` (rien n'est écrit). `public: true` : lisible par tous ; sinon seulement avec `readKey` (gardée **hachée**). `refreshAt` (ISO) : quand l'état change tout seul (voir `tick`). `ttlSec` 10–86 400 (défaut 6 h). 100 points au plus. | `invalid`, `too_big`, `too_many_channels` |
| `liveRead` (lecture) | `{ room, channel, rev? }` | `{ empty: true }` \| `{ unchanged: true, rev, due }` \| `{ rev, data, at, due }` (lecture « de confiance », entre modules) | `invalid` |
| `liveDrop` | `{ room, channel }` | `{ dropped: bool }` | `invalid` |
| `directClient` (lecture) | `{}` | `{ js, rev }` : le texte de la bibliothèque `AudienceDirect.watch({ url, base, max, onData, onEmpty, onError })` (mise à jour douce : une visite à la fois, ralentit de 1,5× quand rien ne change jusqu'à `max`, suit le conseil `next`, pause quand la page est cachée) à poser devant le script d'une page ou d'un overlay | — |

### La route publique du direct
`GET /m/<clé de Participation>/direct?room=…&channel=…[&rev=…][&k=<readKey>]` → `{ ok: true, empty: true } | { ok: true, unchanged: true, rev, next } | { ok: true, rev, data, at, next }`.
Un canal privé sans la bonne clé répond **comme s'il n'existait pas** (`empty`). `next` (ms) est un conseil d'espacement qui grandit avec l'affluence (3 s à 30 s). 90 lectures par minute et par connexion, jamais d'écriture.
Quand `due` (l'instant `refreshAt` est passé), la base demande au module qui alimente le canal de se rafraîchir (`audience.remote.tick`, un seul appel partagé par canal) puis relit : les manches de Sondages avancent ainsi quand quelqu'un regarde l'écran.

## Convention `audience.remote` v1 (offerte par les modules d'animation, appelée par Participation)
Offerte avec `each: true` (chaque module répond pour lui-même) ; Participation la déclare en `requires` facultatif.

| Méthode | Arguments | Réponse |
|---|---|---|
| `describe` | `{ locale? }` | `{ ok: true, panel: { title ≤ 60, state?: { text ≤ 200, tone: idle\|live\|done, until?: ISO }, buttons?: [{ id, label ≤ 40, tone?: primary\|danger\|plain, confirm? ≤ 120, disabled? }] (≤ 8), forms?: [{ id, title ≤ 60, submit ≤ 30, fields: [{ name, label ≤ 40, type: text\|number\|select, required?, max?, placeholder?, value?, options? }] (≤ 6) }] (≤ 3) } }` — textes dans la langue du contexte reçu. Participation ramène le panneau à cette forme (le reste est écarté). 3 s au plus. |
| `press` | `{ action, values, locale? }` (`values` : texte, 6 champs, 200 caractères) | `{ ok: true, message? ≤ 200 }` ou `{ ok: false, error: "<code>", message?, field? }` (`field` : le champ à corriger, le message s'affiche sous lui). 6 s au plus. |
| `tick` | `{ room, channel }` | `{ ok: true, handled: bool }` : « ton direct est périmé, rafraîchis-le » (facultatif). |

Aucun droit n'est transmis : la télécommande a déjà vérifié l'adresse secrète. Un module qui offre `press` n'y fait donc aucune écriture sensible au-delà de ce que sa télécommande permet.

## Service `audience.draw` v1 (offert par Participation 1.2.0, consommé par le Bot Twitch)

Le tirage au sort vit dans Participation. Les personnes viennent du site (page `/participation/tirage`, par la route `draw-enter`, pas par ce service) ou du chat, par le module qui lit le chat (Bot Twitch). Le module du chat le déclare **en facultatif** : `requires: [{ "service": "audience.draw", "min": 1, "optional": true }]`. Double de test : `tests/helpers/fakeAudienceDraw.mjs`.

| Méthode | Arguments | Réponse |
|---|---|---|
| `status` (lecture) | `{}` | `{ open: bool, keyword: string, level: "all"\|"sub"\|"mod", expiresAt?: ISO }` : le tirage ouvert, s'il y en a un. `keyword` : le mot du chat **toujours sous la forme `!mot`** (minuscules, un seul point d'exclamation, sans espace) ou `""` s'il n'y a pas d'inscription par le chat. `expiresAt` seulement pour un tirage avec une durée. `id` (facultatif, ajouté dans 1.2.0) : texte opaque, **différent pour chaque nouveau tirage et à chaque « Vider le tirage »** ; le module du chat s'en sert pour oublier les personnes déjà envoyées quand un tirage en remplace un autre avec le même mot-clé et sans échéance (sinon une personne déjà inscrite au tirage précédent serait ignorée, tant que le module du chat n'a pas vu le tirage fermé). Sans tirage ouvert : `{ open: false, keyword: "", level: "all" }`. Aucun secret, ne lève jamais. Le module du chat peut la garder 10 s en mémoire. |
| `enter` | `{ pseudo, platform, login?, role? }` : `pseudo` texte (coupé à 25 caractères) ; `platform` `^[a-z][a-z0-9_-]{0,19}$` (`twitch`, `youtube`, `kick`…, jamais `site`) ; `login` (facultatif) l'identifiant de la personne, sinon le pseudo sert d'identifiant ; `role` (facultatif) `"all"\|"sub"\|"mod"` : le niveau le plus haut que le module connaît pour cette personne (la modération compte comme abonnée) | `{ ok: true }` ou `{ ok: false, reason }` avec `reason` parmi `closed` (pas de tirage ouvert, échéance passée, ou tirage sans mot-clé), `muted` (la personne est en sourdine dans la salle « draw »), `already` (une entrée par `platform` + `login`/pseudo, sans tenir compte des majuscules), `invalid` (arguments, pseudo vide ou interdit), `full` (5 000 au plus), `level` (le `role` donné n'atteint pas le niveau demandé ; sans `role`, le service fait confiance à l'appelant, qui a lu `status().level`). Ne lève jamais. |

Ce que le module du chat fait : lire `status()` (cache 10 s), n'appeler `enter` que pour le mot-clé exact, et vérifier lui-même le niveau (ou transmettre `role`). Ce que Participation garde : le pseudo, l'origine et la date de l'inscription, rien d'autre (l'identifiant du chat est brouillé) ; la liste est effacée 24 h après la fermeture.

## Ce que le double ne fait pas
Pas de ménage (aucune durée de conservation), pas de journal borné, pas de mots interdits réglables (il refuse `fuck`, `nazi`, `admin`), pas de salle « générale » ; la limite des nouvelles personnes est fixe (200 par heure et par connexion).
Le temps est réglable : `audience.clock.now = () => …`. Pannes : `audience.faults.throw.add("claim")`, `audience.faults.hang.add("join")`.

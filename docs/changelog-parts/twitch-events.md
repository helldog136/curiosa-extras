## Twitch activity: your follows, subs, gifts, bits, raids and hype trains in a journal / Activité Twitch : vos follows, abonnements, cadeaux, bits, raids et trains d'enthousiasme dans un journal

*EN: new module Twitch activity 1.0.0 and Twitch connector 1.4.0 (three more permissions can be requested). Needs Curiosa 0.6.0. After the update, allow again at Twitch once. Nothing else to set up.*
*FR : nouveau module Activité Twitch 1.0.0 et Connecteur Twitch 1.4.0 (trois accords de plus peuvent être demandés). Demande Curiosa 0.6.0. Après la mise à jour, autorisez de nouveau chez Twitch, une seule fois. Rien d'autre à régler.*

### What changes for you / Ce qui change pour vous

- **EN: your site now receives what happens on your Twitch channel.** Follows, subscriptions, resubs, gifted subs, bits, incoming raids, stream start and end, hype trains (and, if you want, channel point rewards). Each event is kept once in a journal, even if Twitch sends it twice or your site restarts.
- **FR : votre site reçoit maintenant ce qui se passe sur votre chaîne Twitch.** Follows, abonnements, réabonnements, abonnements offerts, bits, raids reçus, début et fin de direct, trains d'enthousiasme (et, si vous le voulez, récompenses en points de chaîne). Chaque événement est gardé une seule fois dans un journal, même si Twitch l'envoie deux fois ou si votre site redémarre.
- **EN: a page to read, search, test and replay.** The journal has a live search and a filter by type; each type has a switch and a "Send a test" button with a realistic sample. A status line tells you at once if the site stopped listening and what to do.
- **FR : une page pour lire, chercher, tester et rejouer.** Le journal a une recherche en direct et un filtre par type ; chaque type a un interrupteur et un bouton « Envoyer un test » avec un exemple réaliste. Une ligne d'état dit tout de suite si le site a cessé d'écouter et ce qu'il faut faire.
- **EN: allow again at Twitch once.** Bits and hype trains need two more permissions. The page says which ones and shows the "Allow again at Twitch" button; the other types work meanwhile.
- **FR : autorisez de nouveau chez Twitch, une fois.** Les bits et les trains d'enthousiasme demandent deux accords de plus. La page dit lesquels et montre le bouton « Autoriser de nouveau chez Twitch » ; les autres types fonctionnent en attendant.
- **EN: only public data, kept 30 days by default** (display names, amounts, the public message of a resub or of bits). You choose the duration from 1 to 365 days.
- **FR : seulement des données publiques, gardées 30 jours par défaut** (pseudos, montants, message public d'un réabonnement ou de bits). Vous choisissez la durée, de 1 à 365 jours.
- **EN: the events are shared with your other modules** as the topic `twitch.event`. The alerts overlay will read it in the next version; nothing changes for it today.
- **FR : les événements sont partagés avec vos autres modules** sous le sujet `twitch.event`. L'overlay alertes le lira dans la prochaine version ; rien ne change pour lui aujourd'hui.

### For developers

- New module `twitch-events` (`minCore` 0.6.0, permissions storage, admin, routes, topics, mcp; requires `twitch.api` v3 and `twitch.live`). Transport: the signed EventSub webhook `/m/<key>/webhook` (own secret, HMAC-SHA256 in constant time, 10 minute window, 100 KB body, 600 requests a minute and 30 refusals a minute, then 429), chosen over the WebSocket (see its README).
- Subscriptions checked every 5 minutes (`channel.follow` v2, `channel.subscribe`, `channel.subscription.message|gift`, `channel.cheer`, `channel.raid`, `stream.online|offline`, `channel.hype_train.*` v2, and the reward redemption, off by default); only types whose Twitch permission is granted are subscribed; subscriptions of other modules are never touched.
- Journal: collection `events` keyed by the Twitch message id (`getByKey` + `add` in one serial step), whitelisted fields, strings normalised and bounded, hourly purge (retention, test/replay lines after a day, 5000 lines at most). Topic `twitch.event` registered in `docs/TOPICS.md`.
- MCP tools `twitch_events_list`, `twitch_events_status` (read) and `twitch_event_replay` (write, bounded, never on by default). `tests/srp-guard.test.mjs` now lets `twitch_event(s)_*` tools through (the reserved `twitch_*` names stay those of My Twitch channel).
- Twitch connector 1.4.0: `EXTRA_SCOPES` gains `bits:read`, `channel:read:hype_train` and `channel:read:redemptions`. No call is added.
- Not verified against a live Twitch (see the README): application token behaviour for these subscriptions, failures before revocation, the reward redemption type.

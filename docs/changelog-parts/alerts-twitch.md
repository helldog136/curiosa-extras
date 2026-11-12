## Alerts overlay 1.4.0: your Twitch alerts, one after the other / Overlay alertes 1.4.0 : vos alertes Twitch, l'une après l'autre

*EN: module touched: Alerts overlay 1.4.0 (with Twitch activity 1.0.0 installed). New permission: storage. Nothing to set up: the alerts work with their default sentences. Without Twitch activity, nothing changes.*
*FR : module touché : Overlay alertes 1.4.0 (avec Activité Twitch 1.0.0 installé). Nouvelle permission : stockage. Rien à régler : les alertes marchent avec leurs phrases d'origine. Sans Activité Twitch, rien ne change.*

### What changes for you / Ce qui change pour vous

- **EN: follows, subs, resubs, gifted subs, bits, raids, stream start and end and hype trains now appear as alerts**, one after the other. An alert never replaces the one on screen; a short pause (1 second by default) separates two alerts.
- **FR : les follows, abonnements, réabonnements, abonnements offerts, bits, raids, débuts et fins de direct et trains d'enthousiasme s'affichent maintenant en alertes**, l'une après l'autre. Une alerte ne remplace jamais celle qui est à l'écran ; une courte pause (1 seconde par défaut) sépare deux alertes.
- **EN: a "Twitch events" tab**: for each type a switch, the text, the time on screen and a minimum (bits, gifted subs, viewers). Three ready-made styles, a test per type, a list of names to ignore.
- **FR : un onglet « Événements Twitch »** : pour chaque type, un interrupteur, le texte, la durée à l'écran et un minimum (bits, abonnements offerts, personnes). Trois styles prêts à l'emploi, un test par type, une liste de pseudos à ignorer.
- **EN: bursts become one alert**: gifts by the same person ("Camille gifts 5 subs"), many follows in a row ("12 new followers"). A raid, a sub or bits are never delayed.
- **FR : les rafales deviennent une seule alerte** : cadeaux d'une même personne (« Camille offre 5 abonnements »), nombreux follows d'affilée (« 12 nouveaux follows »). Un raid, un abonnement ou des bits ne sont jamais retardés.
- **EN: pause the alerts without losing any**: they are held, in order, and come out when you resume; "Empty the queue" drops what waits. Nothing is shown twice after a restart.
- **FR : mettez les alertes en pause sans en perdre** : elles sont retenues, dans l'ordre, et sortent à la reprise ; « Vider la file » retire ce qui attend. Rien ne s'affiche deux fois après un redémarrage.
- **EN: messages written by viewers stay hidden** unless you tick "Show the messages that come with an alert".
- **FR : les messages écrits par le public restent cachés** sauf si vous cochez « Afficher les messages joints aux alertes ».
- **EN: the two buttons "Send" of the page now say what they do** ("Send the test alert", "Send the fake Super Chat").
- **FR : les deux boutons « Envoyer » de la page disent maintenant ce qu'ils font** (« Envoyer l'alerte de test », « Envoyer le faux Super Chat »).

### For developers

- `twitch.mjs` (pure engine and per-overlay state: templates, config, `alertFor`, `groupBurst`, staging window, pause/held, memory of ids; stored in collection `twitchAlerts`: documents `config` and `state`), `twitch-admin.mjs` (tab, dialog, actions, the two MCP tools). Topic `twitch.event` consumed (optional), service `alerts.queue` offered (`each`).
- The page is generated differently ONLY when Twitch activity is installed (title, per-alert duration, pause, clear, queue for everything); otherwise it is byte for byte the page of before (non-regression test unchanged). Pushed alerts: `{ "queue": false }` asks to replace the current alert.
- Permissions: `storage`, `mcp` added. Settings: `minGapSeconds`, `ignoreNames`, `twitchText`, `groupSeconds` (advanced) on the new tab `twitch`.
- Tests: `tests/alerts-twitch.test.mjs` (templates, filters, grouping, memory across a restart, pause, the real page with queue, admin, service, tools). Version assertions of the YouTube and element tests updated.

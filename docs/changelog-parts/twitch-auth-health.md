## Twitch connector 1.5.0: the site now knows when Twitch no longer accepts your authorization / Connecteur Twitch 1.5.0 : le site sait quand Twitch n'accepte plus votre autorisation

*EN: modules touched: Twitch connector 1.5.0, My Twitch channel 2.3.2 and Community statistics 1.2.3. After the update, click "Authorize again with Twitch" once if the page asks you to. The connector adds the permission to send you an e-mail (you can turn it off in its settings).*
*FR : modules touchés : Connecteur Twitch 1.5.0, Ma Chaîne Twitch 2.3.2 et Statistiques de la communauté 1.2.3. Après la mise à jour, cliquez une fois sur « Autoriser de nouveau avec Twitch » si la page vous le demande. Le connecteur demande en plus le droit d'envoyer un e-mail (vous pouvez le couper dans ses réglages).*

### What changes for you / Ce qui change pour vous

- **EN: the connector page tells the truth**: "Connected" only when Twitch really accepts the authorization. Otherwise "To renew" or "Missing permissions" (in plain words), with one button "Authorize again with Twitch" at the top. A green "Twitch answers normally" only says that Twitch itself is up.
- **FR : la page du connecteur dit la vérité** : « Connecté » seulement quand Twitch accepte vraiment l'autorisation. Sinon « À renouveler » ou « Autorisations manquantes » (en mots simples), avec un seul bouton « Autoriser de nouveau avec Twitch » en haut. Le « Twitch répond normalement » vert dit seulement que Twitch lui-même fonctionne.
- **EN: it notices within minutes**: when a module is refused, at once; otherwise a check every 10 minutes. The red dot of the menu and one line in the site log appear at the first sign of trouble (once per change, never per check).
- **FR : il s'en aperçoit en quelques minutes** : quand un module est refusé, tout de suite ; sinon une vérification toutes les 10 minutes. La pastille rouge du menu et une ligne du journal du site apparaissent dès le premier signe (une fois par changement, jamais à chaque vérification).
- **EN: one e-mail per problem** after 10 minutes, one when all is back, none if you turn it off ("E-mail me when Twitch needs a new authorization").
- **FR : un e-mail par problème** au bout de 10 minutes, un au retour, aucun si vous le coupez (« Me prévenir par e-mail si Twitch refuse l'accès »).
- **EN: no more dead end**: "My Twitch channel" shows "Authorize again with Twitch" when followers or paying subscribers are frozen, even if the connector believed everything was fine. Community statistics says what to do, and the assistant tools (`connector_twitch_status`, `twitch_streams`, `community_stats_list`) say why a figure is frozen.
- **FR : plus d'impasse** : « Ma Chaîne Twitch » montre « Autoriser de nouveau avec Twitch » quand les followers ou les abonnements payants sont figés, même si le connecteur croyait que tout allait bien. Statistiques de la communauté dit quoi faire, et les outils de l'assistant disent pourquoi un chiffre est figé.
- **EN: not verified on the real Twitch**: the tests use a fake Twitch (revoked token, refused refresh, lost permission).
- **FR : non vérifié sur le vrai Twitch** : les tests utilisent un faux Twitch (jeton révoqué, renouvellement refusé, autorisation perdue).

### For developers

- Connector: `health.mjs` (`verify` through the validate endpoint and the refresh, `record` on a state change with one log line, `noteScope`, `mailStep`, `sweep`); `health: { state: ok | renew | scopes | app, since, checkedAt, missing, need, notified }` on each connection document; `statusOf` follows it (`renew` = `reconnect`, a recorded missing permission = `more`).
- Service `twitch.api` v3 gains, without breaking it, `health({ channel?, slot?, check? })` (read only) and `report({ consumer, problem, scopes? })` (makes the connector check, never believed blindly); `connectLink` accepts `force`; `account` and `connections` carry `health`.
- Refresh: 400 = refused for good (renew), 401/403 = the application (state `app`, consumers get `config`), 429 = rate, anything else temporary with a backoff (30 s doubling up to 15 min) instead of one attempt per call.
- Task `check` every 5 minutes, `adminBadge`, `logEvents` (`connection.problem`, `connection.back`), permission `mail`, setting `healthMail`, MCP tool `connector_twitch_status`.
- My Twitch channel: the permission is no longer pre-checked locally (the connector checks and records it), wants are declared even if nobody opens the page, `reason` on `auth` results (`renew`, `scope`, `connect`, `denied`).
- Tests: `tests/twitch-connector-health.test.mjs`, `tests/twitch-channel-auth.test.mjs`; captures in `docs/captures/ergonomie-twitch-auth/` (`tests/visual/render-twitch-auth.mjs`).

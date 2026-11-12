## Twitch bot 1.15.0 and Audience 1.9.0: the collaboration mode is clear and you choose what it does / Bot Twitch 1.15.0 et Participation 1.9.0 : le mode collaboration est clair et vous choisissez ce qu'il fait

*EN: on the Bot tab of the remote control, the collaboration card says its state in words, and you pick what the timers do right there. Modules touched: Twitch bot 1.15.0, Audience 1.9.0. Nothing to set up, no new permission.*
*FR : dans l'onglet Bot de la télécommande, la carte du mode collaboration dit son état en mots, et vous choisissez là ce que font les timers. Modules touchés : Bot Twitch 1.15.0, Participation 1.9.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: The card says only its state.** "Off — the bot talks as usual", "On — timers paused — stops in 5 h 20", "On — timers 1 in 3 — stops in 5 h 20". Off is calm and neutral (a circle), on has the accent colour and a check mark. What the mode does (commands still answer, timers paused or less frequent) is in the "?" bubble.
- **FR : la carte dit seulement son état.** « Désactivé — le bot parle comme d'habitude », « Activé — timers en pause — s'arrête dans 5 h 20 », « Activé — timers 1 sur 3 — s'arrête dans 5 h 20 ». Désactivé est calme et neutre (un rond), activé prend la couleur d'accent avec une coche. Ce que fait le mode (les commandes répondent toujours, timers en pause ou moins fréquents) est dans la bulle « ? ».
- **EN: You choose the timers right on the card:** Pause, 1 in 2, 1 in 3 (as before) or 1 in 5. Chosen while off, it is kept for next time; while on, it applies at once without restarting the mode. Under "More options": stop by itself after 2 h, 4 h, 6 h (as before) or never.
- **FR : vous choisissez les timers sur la carte :** Pause, 1 sur 2, 1 sur 3 (comme avant) ou 1 sur 5. Choisi quand le mode est coupé, c'est gardé pour la prochaine fois ; quand il est activé, c'est appliqué tout de suite sans le redémarrer. Sous « Plus d'options » : arrêt automatique après 2 h, 4 h, 6 h (comme avant) ou jamais.
- **EN: The bot page has the same single choice** (four buttons) instead of two fields. **Your assistant** (`collaboration_mode_set`, still off until you allow it) takes `timers` (`pause` or `every_n` with `n` 2, 3 or 5) and `autoStopHours`; the older names still work.
- **FR : la page du bot a le même choix unique** (quatre boutons) au lieu de deux champs. **Votre assistant** (`collaboration_mode_set`, toujours désactivé tant que vous ne l'autorisez pas) accepte `timers` (`pause` ou `every_n` avec `n` 2, 3 ou 5) et `autoStopHours` ; les anciens noms marchent toujours.
- **EN / FR: not changed / inchangé :** commands always answer / les commandes répondent toujours ; no per-timer "never quiet" switch (the engine has no such flag) / pas d'interrupteur par timer (le moteur n'a pas ce réglage).

### For developers

- **Twitch bot 1.15.0**: `collab.mjs` (`TIMERS`, `RATIOS` 2/3/5, `HOURS_LIST`, `timersOf`, `fromTimers`, `stateLine`, `check({ timers })`), `collabUi.mjs` (one segmented field `collabTimers`), remote press `collabset`, MCP `timers` / `n` / `autoStopHours` + `timersChoice`, `timersEveryN`, `autoStopHours` in `collaborationMode`. Stored settings unchanged in shape (`collabCfg` `mode` + `ratio`; ratio may now be 5). No migration.
- **Audience 1.9.0**: panel toggle fields `calm`, `more`, `foldLabel`, `choices` (`sanitizeChoices`), "?" bubble and radio buttons in the page script; absent fields change nothing.
- Tests: `twitch-bot-collab`, `twitch-bot-remote`, `twitch-bot-remote-browser` (280, 390 px), `audience-remote-panel`; captures `docs/captures/ergonomie-collab-ux/`.

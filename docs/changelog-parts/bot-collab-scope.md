## Twitch bot 1.16.0 and Audience 1.11.0: the timers choice sits inside the collaboration card and says when it applies / Bot Twitch 1.16.0 et Participation 1.11.0 : le choix des timers est dans la carte du mode collaboration et dit quand il s'applique

*EN: on the Bot tab of the remote control, the timers choice is no longer a section of its own under the card: it is inside the collaboration card, under the switch, labelled "Timers when the mode is on". Modules touched: Twitch bot 1.16.0, Audience 1.11.0. Nothing to set up, no new permission.*
*FR : dans l'onglet Bot de la télécommande, le choix des timers n'est plus une section à part sous la carte : il est dans la carte du mode collaboration, sous l'interrupteur, avec le titre « Timers quand le mode est activé ». Modules touchés : Bot Twitch 1.16.0, Participation 1.11.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: One card.** The switch, its state line, the timers buttons and "More options" are in the same bordered card. **FR : une seule carte.** L'interrupteur, sa ligne d'état, les boutons des timers et « Plus d'options » sont dans la même carte encadrée.
- **EN: Off, the chosen button is only prepared.** Dashed outline and a small check; its tooltip says it is used when you switch the mode on. On, it is filled with the accent colour and the state line says what is active ("On — timers 1 in 3 — stops in 5 h 20"). **FR : désactivé, le bouton choisi est seulement préparé.** Contour en pointillés et petite coche ; son info-bulle dit qu'il sera utilisé à l'activation. Activé, il est plein, à la couleur d'accent, et la ligne d'état dit ce qui est actif (« Activé — timers 1 sur 3 — s'arrête dans 5 h 20 »).
- **EN: Same wording on the bot page and for your assistant.** "Timers when the mode is on"; `collaboration_mode_set` says the choice only applies when the mode is on, and the read-back has `timersApplyNow`. **FR : mêmes mots sur la page du bot et pour l'assistant.** « Timers quand le mode est activé » ; `collaboration_mode_set` dit que le choix ne s'applique que lorsque le mode est activé, et la relecture a `timersApplyNow`.

### For developers

- **Audience 1.11.0**: additive panel fields `toggle.card` (strictly true: choices and fold inside the card, group labels up to 40 characters) and `option.title` (60-character tooltip); output unchanged without them (`sanitizeChoices(raw, labelMax = 30)`). The card is `role="group"` named by its title; the radio buttons are never disabled.
- **Twitch bot 1.16.0**: the panel sets `card: true` and an option `title` ("Timers: 1 time in 3", plus "used when you switch the mode on" for the prepared one); labels `rc_collab_timers`, `rc_collab_hours`, `co_f_timers`; keys `rc_opt_*`; MCP texts and `collaborationMode.timersApplyNow`. No migration.
- Tests: `twitch-bot-remote-browser` (280, 390 px, light, dark), `twitch-bot-collab`, `audience-remote-panel`; captures `docs/captures/ergonomie-collab-scope/`.

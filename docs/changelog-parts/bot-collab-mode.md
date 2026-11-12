## Twitch bot 1.14.0 and Audience 1.8.3: collaboration mode / Bot Twitch 1.14.0 et Participation 1.8.3 : le mode collaboration

*EN: when you stream with other people in a shared chat, one switch makes the bot talk less on its own. Off by default. Modules touched: Twitch bot 1.14.0, Audience 1.8.3. Nothing to set up, no new permission.*
*FR : quand vous streamez avec d'autres personnes dans un chat partagé, un interrupteur fait parler le bot moins tout seul. Désactivé par défaut. Modules touchés : Bot Twitch 1.14.0, Participation 1.8.3. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: A "Collaboration mode" switch on the bot page**, right under the status line: its state, since when, what it does, when it ends, and one button ("Start collaboration mode" / "Stop collaboration mode"). Also on the **Bot** tab of the remote control (phone, OBS dock), and for your AI assistant (`collaboration_mode_set`, off until you allow it).
- **FR : un interrupteur « Mode collaboration » sur la page du bot**, juste sous la ligne d'état : son état, depuis quand, ce qu'il fait, quand il s'arrête, et un bouton (« Activer le mode collaboration » / « Arrêter le mode collaboration »). Aussi dans l'onglet **Bot** de la télécommande (téléphone, dock OBS), et pour votre assistant IA (`collaboration_mode_set`, désactivé tant que vous ne l'autorisez pas).
- **EN: Timers are thinned out or paused.** Two choices: "Thin out" (default) or "Pause"; when thinning, "1 in 3" (default) or "1 in 2". The count is per timer and kept, so each timer keeps its rhythm. Commands still answer.
- **FR : les timers sont espacés ou mis en pause.** Deux choix : « Espacer » (par défaut) ou « Mettre en pause » ; en mode espacé, « 1 sur 3 » (par défaut) ou « 1 sur 2 ». Le compte est fait par timer et conservé : chaque timer garde son rythme. Les commandes répondent toujours.
- **EN: Under "More options":** longer waits between answers (1 to 5 times), mute the other automatic messages (the refund notice; a reward that makes the bot answer is refunded instead), and an automatic end after 6 hours by default (0 = never) so the mode is not left on by mistake.
- **FR : sous « Plus d'options » :** attentes plus longues entre deux réponses (1 à 5 fois), couper les autres messages automatiques (l'avis de remboursement ; une récompense qui fait répondre le bot est remboursée), et une fin automatique après 6 heures par défaut (0 = jamais) pour ne pas l'oublier.
- **EN / FR: Never muted / jamais coupé :** the answer to a command a viewer typed / la réponse à une commande tapée par une personne du chat.

### For developers

- **Twitch bot 1.14.0**: `collab.mjs` (state `collab` + `collabCfg` in the state document, pure `effective`, `setOn`, `check`), `collabUi.mjs` (bar + form with folded options), thinning in `timers.mjs` (`thin` / `thinSince` per timer in `botTimers`), delays stretched in `engine.mjs`, quiet mode in `redeem.mjs` (refund reason `collab`), remote toggle (`collabon` / `collaboff`), MCP `collaboration_mode_set` (write, default off) and `collaborationMode` in `bot_commands_list`, history events `collab.on` / `collab.off`, auto-end settled by the one-minute task. No migration, `minCore` unchanged.
- **Audience 1.8.3**: journal words for the two new panel gestures.
- Tests: `twitch-bot-collab`; version pins updated.
- Likely conflicts with another version touching these modules: `modules/twitch-bot/timers.mjs`, `engine.mjs`, `redeem.mjs`, `remote.mjs`, `tools.mjs`, `admin.mjs`, `module.json`, both locale files, both READMEs, `modules/audience/index.mjs`.

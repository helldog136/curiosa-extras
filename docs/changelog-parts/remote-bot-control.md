## Twitch bot 1.13.0 and Audience 1.8.0: pause the bot and add a command from the remote control / Bot Twitch 1.13.0 et Participation 1.8.0 : mettre le bot en pause et ajouter une commande depuis la télécommande

*EN: the remote control of your live (phone and OBS dock) gets a Bot tab. For Curiosa 0.6.7 or later. Modules touched: Twitch bot 1.13.0, Audience 1.8.0.*
*FR : la télécommande de votre direct (téléphone et dock OBS) gagne un onglet Bot. Pour Curiosa 0.6.7 ou plus. Modules touchés : Bot Twitch 1.13.0, Participation 1.8.0.*

### What changes for you / Ce qui change pour vous

- **EN: One switch to pause the bot.** "Bot answers" shows the state ("On, answering your chat" / "Paused, silent in your chat"), in a big target. While the bot is paused the tab says "Paused". It is the emergency stop you already have: the bot page shows it too ("Since …, from the remote control").
- **FR : un interrupteur pour mettre le bot en pause.** « Réponses du bot » montre l'état (« Actif, répond dans votre chat » / « En pause, muet dans votre chat »), sur une grande cible. Pendant la pause, l'onglet affiche « En pause ». C'est l'arrêt d'urgence que vous avez déjà : la page du bot l'affiche aussi (« Depuis …, depuis la télécommande »).
- **EN: Paused now covers channel point rewards too.** No chat answer, no action at home, the points are given back, and the refund notice stays silent. Commands, repeating commands, `!addcom`, the giveaway and the replies to `!stop` / `!start` were already covered.
- **FR : la pause couvre maintenant aussi les récompenses en points de chaîne.** Aucune réponse dans le chat, aucune action chez vous, les points sont rendus et le message de remboursement reste silencieux. Les commandes, les commandes répétées, `!addcom`, le tirage au sort et les réponses à `!stop` / `!start` l'étaient déjà.
- **EN: Quick add of a command.** Two fields (name, reply) and one button, "Add the command". The command is for everyone, enabled, with the usual delays; same checks as the administration, a refusal is said under the field with an example and what you typed stays. Text only: no website call, role, delay or action from here.
- **FR : ajout rapide d'une commande.** Deux champs (nom, réponse) et un bouton, « Ajouter la commande ». La commande est pour tout le monde, activée, avec les attentes habituelles ; mêmes vérifications que l'administration, un refus est dit sous le champ avec un exemple et votre saisie reste. Du texte seulement : ni appel à un site, ni rôle, ni attente, ni action depuis ici.
- **EN: Undo.** The last three commands added this way are listed with a "Delete !name" button, until someone changes them in the administration.
- **FR : annuler.** Les trois dernières commandes ajoutées ainsi sont listées avec un bouton « Supprimer !nom », tant que personne ne les modifie dans l'administration.
- **EN / FR: Same protection as the rest of the remote / même protection que le reste de la télécommande.** Secret address, 60 presses a minute, journal ("Remote control: Twitch bot paused"). No new route, right or permission.

### For developers

- **Twitch bot 1.13.0**: `remote.mjs` (service `audience.remote`, `describe` / `press`: `pause`, `resume`, `addcom`, `undo`), `offers` in `module.json` (`each: true`), four history events (`bot.paused`, `bot.resumed`, `command.quickadded`, `command.quickremoved`), `state.setMuted(ctx, muted, by)` keeps who pressed (`mutedBy`), `redeem.mjs` honours the pause (`muted` refund reason, no notice, no home simulation), `rc_*` texts in both languages. `minCore` unchanged, no data migration, no new route.
- **Audience 1.8.0**: `sanitizePanel` accepts `toggles`, `values` and `group` on buttons, `badge`, `alert` and `note`; `client.mjs` draws them (switch, form submitted with Enter, undo list); journal words for the four gestures. The contract `audience.remote` stays version 1 and every field is optional.
- Tests: `twitch-bot-remote` (contract, pause and every path, quick add, undo, authentication, rate limit, words), `twitch-bot-remote-browser` (real Chromium, 390 / 360 / 300 px), `audience-remote-panel`, one test added to `channel-rewards`; version pins updated.
- Likely conflicts with another version touching these modules: `modules/twitch-bot/index.mjs`, `redeem.mjs`, `state.mjs`, both locale files, `modules/audience/lib.mjs`, `client.mjs`, `remote.mjs`, both READMEs.

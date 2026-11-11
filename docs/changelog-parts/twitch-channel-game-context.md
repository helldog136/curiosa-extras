## My Twitch channel: a skin per game / Ma Chaîne Twitch : un skin par jeu

*EN: module touched: My Twitch channel 2.3.0. Needs Curiosa 0.8.0. Nothing to set up, no new permission.*
*FR : module touché : Ma Chaîne Twitch 2.3.0. Demande Curiosa 0.8.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: a skin per game.** In an overlay page, the new "Skin" tab shows a "Skin per game" switch. Turned on, a searchable table lets you pick a skin for each game you have streamed, from the list of games already seen in your measured lives. The skin changes by itself when you change game (after two checks in a row, with a fade). Offline, not connected or if Twitch does not answer, the page keeps its default skin.
- **FR : un skin par jeu.** Dans une page d'overlay, le nouvel onglet « Skin » propose l'interrupteur « Un skin par jeu ». Activé, un tableau avec recherche vous laisse choisir un skin pour chaque jeu que vous avez diffusé, dans la liste des jeux déjà vus pendant vos directs mesurés. Le skin change tout seul quand vous changez de jeu (après deux contrôles de suite, avec un fondu). Hors direct, sans connexion ou si Twitch ne répond pas, la page garde son skin par défaut.

### For developers

- First provider of the generic overlay context contract (core 0.8.0): `overlayContexts` in `module.json` (`game`: label, switch label, example in FR and EN) and `overlayContexts.game.current` / `.values` in `index.mjs`. `current` is the game of the live stream (`gameId` and `game` of `helix.streamNow`, cached by helix; nothing offline); `values` are the games seen in the measured lives (`live.gamesOf`, most streamed first, a game without a Twitch id is skipped) plus the current one, accent-insensitive search, bounded by `limit`. `minCore` is now 0.8.0. No migration, no new permission.

## Networks menu: the modules say where they belong / Menu Réseaux : les modules disent où se ranger

*EN: Twitch, Discord and YouTube modules now sit under Networks › Twitch, Networks › Discord and Networks › YouTube in the administration menu, and are pinned there by default. Needs Curiosa 0.13.0; on an older Curiosa nothing changes. No new permission, nothing to set up.*
*FR : les modules Twitch, Discord et YouTube se rangent maintenant sous Réseaux › Twitch, Réseaux › Discord et Réseaux › YouTube dans le menu d'administration, et y sont épinglés par défaut. Prend effet avec Curiosa 0.13.0 ; sur un Curiosa plus ancien, rien ne change. Aucune nouvelle permission, rien à régler.*

### What changes for you / Ce qui change pour vous

- **EN: Twitch** — Twitch connector, My Twitch channel, Live status, Twitch activity, Alerts overlay (OBS), Twitch bot, Twitch raid, in that order. **FR : Twitch** — Connecteur Twitch, Ma Chaîne Twitch, Statut du live, Activité Twitch, Overlay alertes (OBS), Bot Twitch, Raid Twitch, dans cet ordre.
- **EN: Discord** — Discord, Discord announcements. **FR : Discord** — Discord, Annonces Discord.
- **EN: YouTube** — YouTube connector, YouTube channel, YouTube live actions. **FR : YouTube** — Connecteur YouTube, Chaîne YouTube, Actions du live YouTube.
- **EN:** you can still unpin an entry; your choice wins. Profile-link modules (Instagram, Bluesky, Kick…) and the other tools keep their place. **FR :** vous pouvez toujours désépingler une entrée ; votre choix l'emporte. Les modules de lien vers un profil (Instagram, Bluesky, Kick…) et les autres outils gardent leur place.

### For developers

- `module.json`: `adminMenu` (`Réseaux.Twitch`, `Réseaux.Discord`, `Réseaux.YouTube`) and `adminMenuOrder` (connector 10, channel 20, then status 30, activity 40, alerts 50, bot 60, raid 70 on Twitch; the others keep the default 100), core 0.13.0. No `minCore` change: an older core ignores the keys. `menuGroup` stays as the fallback for an older core.
- Versions: patch bump of the 12 modules, no code change.
- Test: `admin-menu` (path shape and order range, the expected table, no other module declares a path, the core's tree builder places each entry once).

## Menu sections for 28 modules / Rubriques du menu pour 28 modules

*EN: each of these modules now says in which section of the administration menu it belongs (Content, Community, Tools or Connections), so a tool for yourself is no longer listed with the pages for your audience. Needs Curiosa 0.7.0 to take effect; on an older Curiosa the modules are listed as before. Nothing to set up, no new permission.*
*FR : chacun de ces modules dit maintenant dans quelle rubrique du menu d'administration il se range (Contenu, Communauté, Outils ou Connexions), pour qu'un outil pour vous ne soit plus mélangé aux pages pour votre public. Prend effet avec Curiosa 0.7.0 ; sur un Curiosa plus ancien, les modules se rangent comme avant. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: Content** — Countdown, Directory, Events, Legal pages, Mascot, Platform links, Press kit, Home banner.
- **FR : Contenu** — Compte à rebours, Annuaire, Événements, Pages légales, Mascotte, Liens de plateformes, Dossier de presse, Bandeau d'accueil.
- **EN: Tools** — Manual calendar, Content planner, Live status, Planning, Announcement story, Twitch raid.
- **FR : Outils** — Calendrier manuel, Planificateur de contenu, Statut du live, Planning, Story d'annonce, Raid Twitch.
- **EN: Community** — Supporters, Audience, Commissions, Community stats, Contact form, Contacts, Daily game, Game suggestions, Idea box, Partnerships, Polls, Testimonials, Thanks wall.
- **FR : Communauté** — Soutiens, Participation, Commandes, Statistiques de la communauté, Formulaire de contact, Contacts, Jeu du jour, Suggestions de jeux, Boîte à idées, Partenariats, Sondages, Témoignages, Mur de remerciements.
- **EN: Connections** — Discord announcer.
- **FR : Connexions** — Annonces Discord.

### For developers / Pour les développeurs

- `module.json`: optional key `menuGroup` (`content`, `community`, `tools` or `connections`), added in core 0.7.0. No `minCore` change: an older core ignores the key. Versions: patch bump of each module, no code change.

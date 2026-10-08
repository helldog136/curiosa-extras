# Chaîne Twitch — module communautaire de Curiosa

Fournit deux sujets aux autres modules (il n'en consomme aucun) :

- `stream.live` : le live en cours (titre, jeu, début, adresse) — vide quand vous n'êtes pas en direct. Les annonces Discord le reprennent.
- `maze.poster` : vos derniers clips (60 jours) en affiches pour l'overlay labyrinthe.

Il faut une application Twitch à vous (dev.twitch.tv/console) : *client id* et *client secret* (jamais réaffichés). La bannière « en direct » et le lecteur sur l'accueil restent ceux du module *Statut live Twitch* livré avec le framework.

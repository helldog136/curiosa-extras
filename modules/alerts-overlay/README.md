# Overlay alertes (OBS) — module communautaire de Curiosa

Une source navigateur pour OBS (`https://votre-site/overlays/<clé>`) qui affiche une alerte (follow, sub, raid…) **dès qu'on la pousse**, en direct (SSE).

Pour pousser une alerte depuis n'importe quel outil (Streamer.bot, relais de webhook, script) :

```
POST https://votre-site/m/<clé>/push
Authorization: Bearer <jeton d'envoi>
{ "kind": "follow", "message": "Alice", "username": "alice" }
```

`kind` : `follow`, `sub`, `raid`, `alert` (le texte est affiché tel quel, jamais interprété comme du HTML). Sans jeton défini, rien ne peut pousser ; le panneau d'admin a un bouton de **test**.
Le flux vit en mémoire dans le processus du serveur (un seul serveur, comme l'installation standard).

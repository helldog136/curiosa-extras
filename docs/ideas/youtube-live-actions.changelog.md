## Nouveautés
- Nouveau module « Actions du live YouTube » : un Super Chat, un Super Sticker, une nouvelle adhésion ou des adhésions offertes peuvent allumer vos lumières ou faire lire un message chez vous, grâce à Home Assistant.
- Une page « En direct » : état de la lecture, gros bouton « Tout couper », vos règles, une simulation sans rien demander à YouTube, le journal et la part de la limite YouTube utilisée.
- « !stop » et « !start » dans le chat YouTube (propriétaire et modérateurs), pendant que la page est ouverte.

## Améliorations
- Chaîne YouTube sait dire si vous êtes en direct et quel chat lire.
- Le Connecteur YouTube sait lire le chat d'un direct, en comptant ce que ça coûte.

## Pour les développeurs
- Connecteur YouTube 1.2.0 : `liveChatMessages.list` (5 unités, sans cache), demande `fresh`, erreurs `chat_ended` / `chat_disabled` / `chat_denied`, `status().chat`.
- Chaîne YouTube 1.4.0 : service `youtube.live` (`current`, `each: true`, lecture seule).
- youtube-live-actions 1.0.0 : consomme `ha.result`, appelle `home-assistant.bridge` ; outils MCP `youtube_live_status`, `youtube_live_journal`, `youtube_live_rules`, `youtube_action_simulate`.

## Twitch bot 1.17.0 and Alerts overlay 1.8.0: words that trigger an answer, and media on stream / Bot Twitch 1.17.0 et Overlay alertes 1.8.0 : des mots qui déclenchent une réponse, et des médias à l'écran

*EN: a command or a word can also show a picture, a GIF or a video, or play a sound, on your stream. The bot can answer when a message contains a word ("quoi" gets "Feur"). Modules touched: Twitch bot 1.17.0, Alerts overlay 1.8.0. No new permission, nothing to set up.*
*FR : une commande ou un mot peut aussi montrer une image, un GIF ou une vidéo, ou jouer un son, sur votre stream. Le bot peut répondre quand un message contient un mot (« quoi » donne « Feur »). Modules touchés : Bot Twitch 1.17.0, Overlay alertes 1.8.0. Aucune nouvelle permission, rien à régler.*

### What changes for you / Ce qui change pour vous

- **EN: words.** In the commands table, "New word": the word(s), a reply, who may trigger it. Whole words only, capitals and accents ignored; waits of 30 s and 60 s, six automatic answers a minute at most, "one time out of N", quiet in collaboration mode. **FR : les mots.** Dans le tableau des commandes, « Nouveau mot » : le ou les mots, une réponse, qui peut le déclencher. Mots entiers seulement, majuscules et accents ignorés ; attentes de 30 s et 60 s, six réponses automatiques par minute au plus, « une fois sur N », silencieux en mode collaboration.
- **EN: On stream.** Under "More options" of a command or a word: a picture, GIF or video and/or a sound, for 2 to 60 seconds, picked from the Media tab of the alerts overlay. **FR : à l'écran.** Sous « Plus d'options » d'une commande ou d'un mot : une image, un GIF ou une vidéo et/ou un son, de 2 à 60 secondes, choisis dans l'onglet Médias de l'overlay alertes.
- **EN: one media library** in the alerts overlay (name, search, delete); media wait in the alert queue like any alert. **FR : une seule bibliothèque de médias** dans l'overlay alertes (nom, recherche, suppression) ; les médias attendent dans la file comme les alertes.
- **EN: assistants** read and write words and "On stream" by name (write tools stay off). **FR : les assistants** lisent et écrivent les mots et « À l'écran » par leur nom (outils d'écriture éteints par défaut).

### For developers

- Alerts overlay 1.8.0: service `alerts.show` v1 (`list` read-only, `show`), `media.mjs` (library in the `mediaLib` collection, files claimed), `media-admin.mjs`; the page gets the queue, sounds and media code only when the library is not empty (`mvol`, `present: "sound"`, `own`); CSS for media size.
- Twitch bot 1.17.0: `words.mjs` (matching, saved shape `words` in the config document, no migration), `media.mjs` (optional `alerts.show`), `engine.processWords`, setting `wordsPerMinute`, additive MCP arguments (`kind: "word"`, `words`, `match`, `answerOneTimeOutOf`, `alsoInCollaborationMode`, `onStreamPicture`, `onStreamSound`, `onStreamSeconds`, `clearOnStream`).
- Tests: `twitch-bot-words`, `twitch-bot-words-admin`, `alerts-overlay-media`.

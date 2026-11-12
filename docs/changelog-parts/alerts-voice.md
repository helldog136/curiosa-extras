## Alerts overlay 1.6.0: viewer texts, voice, videos and basic moderation / Overlay alertes 1.6.0 : textes du public, voix, vidéos et modération simple

*EN: modules touched: Alerts overlay 1.6.0 and Twitch activity 1.3.0 (marks and dock controls). Nothing to set up: the voice is off, the word list is empty. The overlay and the activity module should be updated together.*
*FR : modules touchés : Overlay alertes 1.6.0 et Activité Twitch 1.3.0 (marques et commandes du dock). Rien à régler : la voix est éteinte, la liste de mots est vide. Mettez les deux modules à jour ensemble.*

### What changes for you / Ce qui change pour vous

- **EN: choose what each type shows**: the text, a picture (GIF) alone, or a video alone with its own sound if you want. Add up to six videos in the new tab "Videos".
- **FR : choisissez ce que montre chaque type** : le texte, une image (GIF) seule, ou une vidéo seule avec son propre son si vous le voulez. Ajoutez jusqu'à six vidéos dans le nouvel onglet « Vidéos ».
- **EN: show the message of your viewers** (resubs, bits, rewards), cut at the length you choose.
- **FR : montrez le message de votre public** (réabonnements, bits, récompenses), coupé à la longueur choisie.
- **EN: read alerts aloud** with the voice of your computer (off by default). Pick what is read per type; the page says if it sees no voice.
- **FR : lisez les alertes à voix haute** avec la voix de votre ordinateur (éteint par défaut). Choisissez ce qui est lu par type ; la page dit si elle ne voit aucune voix.
- **EN: basic moderation before anything is shown or read**: links, shouting, repeats and your own list of blocked words (empty at first). A refused text shows the alert without it, or holds the whole alert for you. It is a simple filter, not a replacement for Twitch AutoMod.
- **FR : modération simple avant tout affichage ou lecture** : liens, majuscules, répétitions et votre propre liste de mots bloqués (vide au départ). Un texte refusé montre l'alerte sans lui, ou retient toute l'alerte pour vous. C'est un filtre simple, pas un remplaçant d'AutoMod de Twitch.
- **EN: in the OBS dock**: switches for alerts, voice and mute, buttons to stop the speech and skip the alert, and the texts waiting with "Accept anyway" or "Dismiss".
- **FR : dans le dock d'OBS** : interrupteurs pour les alertes, la voix et la coupure, boutons pour arrêter la lecture et passer l'alerte, et les textes en attente avec « Accepter quand même » ou « Écarter ».
- **EN: not verified on a live OBS**: voices depend on your computer and on OBS; the tests use a fake voice. Custom sound files are still not possible (the site accepts images and videos only).
- **FR : non vérifié sur un OBS en direct** : les voix dépendent de votre ordinateur et d'OBS ; les tests utilisent une fausse voix. Les fichiers de son personnels restent impossibles (le site n'accepte que des images et des vidéos).

### For developers

- `moderation.mjs` (pure: `normalise`, `wordsOf`, `flag`, `cut`), `twitch.mjs` (per-type `present/video/videoSound/viewer/viewerMax/tts`, `config.tts`, `config.moderation`, `alertFor` returning `alert`, `held` or `flagged`, controls `ctlOf/setMuted/setVoiceOn/stopSpeech/skipAlert/textsList/decideText`, voice report), `twitch-admin.mjs` (tabs `viewers` and `media`, actions, MCP `voice_moderation_get/update`, `held_text_decide`).
- Service `alerts.queue` version 2 (`voice`, `mute`, `voiceOn`, `stopSpeech`, `skip`, `texts`, `decide`); optional service `twitch.journal.flag` offered by Twitch activity; the page reads `ctl` with its normal poll.
- Tests: `tests/alerts-twitch-voice.test.mjs`, `tests/twitch-events-voice-dock.test.mjs`; the pages without Twitch activity stay byte for byte as before.

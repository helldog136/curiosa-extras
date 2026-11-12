## Alerts overlay 1.7.0: your own sound for each type of alert / Overlay alertes 1.7.0 : votre propre son pour chaque type d'alerte

*EN: module touched: Alerts overlay 1.7.0. Needs Curiosa 0.10.0. Nothing to set up: no sound file until you add one.*
*FR : module touché : Overlay alertes 1.7.0. Demande Curiosa 0.10.0. Rien à régler : aucun fichier son tant que vous n'en ajoutez pas.*

### What changes for you / Ce qui change pour vous

- **EN: a sound file for each type of alert** (MP3, Ogg, WAV, M4A or AAC), sent in the window of the type under "More options". It plays instead of the built-in sound, once per alert, and stops when the alert goes. It stays on your site.
- **FR : un fichier son pour chaque type d'alerte** (MP3, Ogg, WAV, M4A ou AAC), envoyé dans la fenêtre du type sous « Plus d'options ». Il joue à la place du son intégré, une fois par alerte, et s'arrête quand l'alerte part. Il reste sur votre site.
- **EN: tick "Play a sound with each alert" for it to play.** The volume is the one of the sounds. Not verified on a live OBS.
- **FR : cochez « Jouer un son avec chaque alerte » pour qu'il joue.** Le volume est celui des sons. Non vérifié sur un OBS en direct.

### For developers

- `AUDIO_RE` and per-type `audio` in `twitch.mjs`; `kind: "audio"` field in the edit window, validated again and kept with `files.claim` / `remove`; the page plays `new Audio(e.audio)` (`AUDIO_SCRIPT`) only when sounds are on and a type has a file. `minCore` 0.10.0. MCP: `hasSoundFile` in `alert_templates_get`.
- Test: `tests/alerts-twitch-sound-file.test.mjs`.

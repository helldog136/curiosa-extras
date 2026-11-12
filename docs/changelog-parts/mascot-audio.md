## Mascot 1.4.0: your own sound as an audio file / Mascotte 1.4.0 : votre propre son en fichier audio

*EN: module touched: Mascot 1.4.0. It now needs Curiosa 0.10.0 (which accepts sound files). Nothing to set up; what you already sent keeps working.*
*FR : module touché : Mascotte 1.4.0. Elle demande maintenant Curiosa 0.10.0 (qui accepte les fichiers son). Rien à régler ; ce que vous aviez déjà envoyé continue de marcher.*

### What changes for you / Ce qui change pour vous

- **EN: send your own sound as a real sound file** (MP3, OGG, WAV, M4A or AAC), in the Voice tab, right where it is used. A player lets you listen to it. No more short video file.
- **FR : envoyez votre propre son comme un vrai fichier son** (MP3, OGG, WAV, M4A ou AAC), dans l'onglet « Voix », là où il sert. Un lecteur permet de l'écouter. Plus besoin d'une courte vidéo.
- **EN: only where it is used.** The sound field shows with "Your own sound" and with the blips set to "Your own sound", and nowhere else.
- **FR : seulement là où il sert.** Le champ du son apparaît avec « Votre propre son » et avec les petits sons réglés sur « Votre propre son », et nulle part ailleurs.
- **EN: tip for the blips**: OGG or WAV are best (MP3 and AAC begin with a tiny silence). 4 MB at most; the file you replace or remove is deleted from your site.
- **FR : conseil pour les petits sons** : OGG ou WAV sont les meilleurs (MP3 et AAC commencent par un petit silence). 4 Mo au plus ; le fichier que vous remplacez ou retirez est supprimé de votre site.
- **EN: nothing to convert.** A short MP4 or WebM sound chosen with the previous version keeps working (the old setting is now under "Older sound file", advanced); a sound sent in the form wins over it.
- **FR : rien à convertir.** Un court son MP4 ou WebM choisi avec la version précédente continue de marcher (l'ancien réglage est maintenant sous « Ancien fichier son », avancé) ; un son envoyé dans le formulaire passe avant.

### For developers

- `model.mjs`: `AUDIO_EXTS = "mp3|ogg|wav|m4a|aac"`, `SOUND_EXTS` = audio + `mp4|webm` (old values stay readable), `uploadAudio` (what the Voice form stores), `soundOf(voice, setting)` (form first, then the older setting), `SOUND_BYTES` (4 MB). `admin-anim.mjs`: `kind: "audio"` field `sound` in the Voice form (only for "your own sound" and for the blips set to it); the action re-checks the address (`^/uploads/…\.(mp3|ogg|wav|m4a|aac)$`), claims the file (the core tells its size), releases the old one. `module.json`: `voiceFile` is now `type: "audio"`, advanced; `minCore` 0.10.0.
- Tests: three new tests in `tests/mascot-motion.test.mjs` (sample `/uploads/<uuid>.mp3` and `.ogg`; they run against core 0.10.0).

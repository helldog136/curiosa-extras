## Alerts overlay 1.5.0: pictures, sounds and ways of entering for your Twitch alerts / Overlay alertes 1.5.0 : images, sons et façons d'arriver pour vos alertes Twitch

*EN: module touched: Alerts overlay 1.5.0. New permission: files (it keeps the pictures you send). Nothing to set up: sounds are off and pictures empty until you choose.*
*FR : module touché : Overlay alertes 1.5.0. Nouvelle permission : fichiers (il garde les images que vous envoyez). Rien à régler : les sons sont éteints et les images vides tant que vous ne choisissez rien.*

### What changes for you / Ce qui change pour vous

- **EN: a picture for each type of alert**, shown above the text. Send it in the window of the type, under "More options". The picture stays on your site; nothing is loaded from elsewhere.
- **FR : une image pour chaque type d'alerte**, montrée au-dessus du texte. Envoyez-la dans la fenêtre du type, sous « Plus d'options ». L'image reste sur votre site ; rien n'est chargé d'ailleurs.
- **EN: a sound for each type** (chime, bell, pop, fanfare), made by the page itself, so nothing to upload. Off until you tick "Play a sound with each alert"; the volume is an advanced setting.
- **FR : un son pour chaque type** (carillon, cloche, pop, fanfare), fabriqué par la page elle-même, donc rien à envoyer. Éteint tant que vous ne cochez pas « Jouer un son avec chaque alerte » ; le volume est un réglage avancé.
- **EN: choose how each type enters and leaves** (slide from a side, fade, jiggle, pop, instant), or keep the module setting.
- **FR : choisissez comment chaque type arrive et repart** (glissement depuis un côté, fondu, rebond, zoom, instantané), ou gardez le réglage du module.
- **EN: see it before going live.** The tab shows sample cards, a thumbnail and the sentence of each type, and a button "Show a sample evening on screen" sends five sample alerts one after the other, as on stream.
- **FR : voyez le résultat avant de passer en direct.** L'onglet montre des cartes d'exemple, une vignette et la phrase de chaque type, et un bouton « Montrer une soirée type à l'écran » envoie cinq alertes d'exemple l'une après l'autre, comme en direct.
- **EN: custom sound files are not possible yet**: the site only accepts images and videos as uploads. Your AI assistant can set the sound and the way of entering, not the picture.
- **FR : les fichiers de son personnels ne sont pas encore possibles** : le site n'accepte que des images et des vidéos à l'envoi. Votre assistant IA peut régler le son et la façon d'arriver, pas l'image.

### For developers

- `twitch.mjs`: per-type `sound` (closed list), `anim` (the modes of `transition.mjs`) and `image` (`IMAGE_RE`: `/uploads/<uuid>.(png|jpg|webp|gif)`), carried by each alert (groups keep them). `twitch-admin.mjs`: three folded fields in the dialog, `files.claim` / `files.remove` on save, thumbnails in the table, an `html` preview (escaped, site pictures only), action `simulate`. `index.mjs`: the page code for pictures, sounds and per-type transitions exists only when Twitch activity is installed and, for sounds, when they are switched on; `card._anim` carries the per-type mode into `fx`.
- Permission `files` added; settings `twitchSounds` (simple) and `soundVolume` (advanced) on the tab `twitch`; MCP `alert_template_update` takes `sound` and `animation`.
- Tests: `tests/alerts-twitch-look.test.mjs` (the real page with a fake `AudioContext`: sounds once per alert at the chosen volume, none when off; pictures refused unless the site's own; per-type transitions; thumbnails, preview and the sample evening). `tests/helpers/overlayPageDom.mjs` accepts `globals`.

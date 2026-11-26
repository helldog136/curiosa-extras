## Alerts overlay 1.22.3: the text of an alert follows the video, not the moment the card appears / Overlay alertes 1.22.3 : le texte d'une alerte suit la vidéo, pas l'instant où la carte apparaît

*EN: module touched: Alerts overlay 1.22.3. No new permission, nothing to set up. If you tuned the times of a text on a video, see the last point.*
*FR : module touché : Overlay alertes 1.22.3. Aucune nouvelle permission, rien à régler. Si vous aviez réglé les temps d'un texte sur une vidéo, voyez le dernier point.*

### What changes for you / Ce qui change pour vous

- **EN: on a video, the times of a placed text are now seconds of the video.** "Enters at 1 s" means one second after the video really starts, on every machine and in OBS. Before, the text started when the card appeared, 0.6 to 0.8 s before the picture could be seen, so it came and left too early.
- **FR : sur une vidéo, les temps d'un texte placé sont maintenant des secondes de la vidéo.** « Arrive à 1 s » veut dire une seconde après le vrai départ de la vidéo, sur toutes les machines et dans OBS. Avant, le texte partait dès que la carte apparaissait, 0,6 à 0,8 s avant que l'image soit visible : il arrivait et partait trop tôt.
- **EN: the end of the video is no longer cut.** The length of the alert counts from the start of the video, and a video played once always goes to its end (plus a short margin).
- **FR : la fin de la vidéo n'est plus coupée.** La durée de l'alerte compte depuis le départ de la vidéo, et une vidéo jouée une fois va toujours jusqu'au bout (plus une courte marge).
- **EN: a text is never lost.** If a video has not started after about a second (refused, stuck, broken), the text starts anyway.
- **FR : un texte n'est jamais perdu.** Si une vidéo n'a pas démarré après environ une seconde (refusée, bloquée, cassée), le texte démarre quand même.
- **EN: pictures and GIFs do not change.**
- **FR : les images et les GIF ne changent pas.**
- **EN: if you adjusted the times of a text on a video, add about 0.5 s to each time** (the old values included about 0.5 s of compensation for the loading time). Your saved texts are not modified.
- **FR : si vous aviez réglé les temps d'un texte sur une vidéo, ajoutez environ 0,5 s à chaque temps** (les anciennes valeurs comprenaient environ 0,5 s de compensation du temps de chargement). Vos textes enregistrés ne sont pas modifiés.

### For developers

- `modules/alerts-overlay/index.mjs`: `VIDEO_CLOCK` (`cmpClock(card, secs, rearm)`) and `composeMount(fx)` replace the former `COMPOSE_MOUNT`. After `CuriosaCompose.mount` the boxes' `animationPlayState` is `paused`; on the video's `playing` the Web Animations of each box are set to `video.currentTime` and resumed; `waiting` pauses, the next `playing` resynchronises (plus the length of the video per lap when it looped); `rearm` re-arms the length of the alert (the `hold` of the transitions, or the plain timer) from the start; the length is at least `duration + 0.3 s` for `play: "once"`, capped at 120 s. Fallback: 1.2 s (3 s while `networkState` is loading), `error` starts at once. The token `clk` (incremented by `done` and "clear") makes late events of a gone card harmless. No video: no code path changes.
- No change in the core: the engine still starts the animations at mount; the page holds and releases them.
- Tests: `tests/alerts-overlay-video-clock.test.mjs`.

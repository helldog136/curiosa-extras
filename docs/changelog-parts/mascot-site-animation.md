## Mascot 1.3.0: the animation also moves the mascot in the corner of your site / Mascotte 1.3.0 : l'animation anime aussi la mascotte du coin de votre site

*EN: module touched: Mascot 1.3.0. Nothing to set up and no new permission: it uses the animations you already sent for the overlay. Without an animation, the corner mascot is exactly what it was.*
*FR : module touché : Mascotte 1.3.0. Rien à régler et aucune nouvelle permission : elle reprend les animations déjà envoyées pour l'overlay. Sans animation, la mascotte du coin est exactement ce qu'elle était.*

### What changes for you / Ce qui change pour vous

- **EN: the mascot in the corner of your site moves too.** The idle animation plays over its avatar, and when a bubble opens the talking animation plays for the time the sentence takes to read, then the idle one comes back. Same pictures as on the overlay: you send them once, in the "Animation" tab.
- **FR : la mascotte du coin de votre site bouge aussi.** L'animation d'attente joue sur son avatar, et quand une bulle s'ouvre l'animation de parole joue le temps de lire la phrase, puis celle d'attente revient. Les mêmes images que sur l'overlay : vous les envoyez une fois, dans l'onglet « Animation ».
- **EN: silent and light.** No sound on the pages of your site. Nothing is downloaded before the mascot shows, so visitors who never see it download no picture. A hidden tab stops the pictures; with reduced motion only the first picture shows.
- **FR : silencieuse et légère.** Aucun son sur les pages de votre site. Rien n'est téléchargé avant que la mascotte se montre : les visiteurs qui ne la voient pas ne téléchargent aucune image. Un onglet caché arrête les images ; avec « mouvement réduit », seule la première image est montrée.
- **EN: nothing moves on the page.** The picture lies over the avatar, which keeps its size.
- **FR : rien ne bouge dans la page.** L'image se pose sur l'avatar, qui garde sa taille.
- **EN: limits.** An animated GIF cannot be frozen by a page: with reduced motion the plain drawing stays. A hidden tab cannot stop a GIF (the browser slows it down). Checked in a real browser (Chrome); not on every device.
- **FR : limites.** Une page ne peut pas figer un GIF animé : avec « mouvement réduit », le dessin reste. Un onglet caché ne peut pas arrêter un GIF (le navigateur le ralentit). Vérifié dans un vrai navigateur (Chrome) ; pas sur tous les appareils.
- **EN: the admin shows it.** The preview of the tab "My mascot" shows the first picture of the idle animation, and the "Animation" tab has a link to see it on your site.
- **FR : l'administration le montre.** L'aperçu de l'onglet « Ma mascotte » montre la première image de l'animation d'attente, et l'onglet « Animation » a un lien pour la voir sur votre site.

### For developers

- `play.mjs`: `mascotSiteAnim(S, talkSeconds, mascotPlayer)`, appended to the visitor script by `assets.mjs` only when an animation is set; it watches the page with `MutationObserver` (the mascot `.mc`, its bubble `.mc-bub`, its avatar `.mc-av` rewritten by `innerHTML`) and lays an `<img class="mc-an">` over the avatar. `client.mjs` is NOT touched: with nothing set, `code`, `cfg` and the style sheet address are byte for byte those of 1.2.0 (golden hashes of `tests/overlay-elements-wave2-ticker-regression.test.mjs` unchanged).
- `style.mjs`: `ANIM_CSS`, served by `mascot.css?a=1` with its own fingerprint (`animCssHash`); the plain address gives the plain sheet. Texts: `previewAnim`, `animIntro`.
- Tests: `tests/mascot-site-anim.test.mjs` (the visitor script in the fake browser with a `MutationObserver`: lazy, idle to talking to idle, avatar rewritten, reduced motion, GIF restart, hidden tab, leaving, no `MutationObserver`, silent, admin). Real Chrome checks: `tests/visual/render-site-mascot.mjs` and `shoot-site-mascot.cjs`.

## Announcement story: choose your default style / Story d'annonce : choisissez votre style par défaut

*EN: one button remembers the style you like. Module touched: Announcement story 2.10.0. Nothing to set up, no new permission.*
*FR : un bouton retient le style que vous aimez. Module touché : Story d'annonce 2.10.0. Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: "Use as my default style" on the last step.** Pick a style card, click the button, done. New videos start in that style, and the preview of the first two steps (event, information) shows it instead of the plain one. The last step still lets you change the style for the video you are making.
- **FR : « Utiliser comme style par défaut » à la dernière étape.** Choisissez une carte de style, cliquez sur le bouton, c'est tout. Les nouvelles vidéos démarrent avec ce style, et l'aperçu des deux premières étapes (l'événement, les informations) le montre au lieu du style simple. La dernière étape permet toujours de changer le style de la vidéo en cours.
- **EN: Nothing changes until you use the button.** Saved models keep the style they stored. The assistant prepares videos in your default style unless it asks for another one or uses a model.
- **FR : rien ne change tant que vous n'utilisez pas le bouton.** Les modèles enregistrés gardent leur style. L'assistant prépare les vidéos dans votre style par défaut, sauf s'il en demande un autre ou s'il utilise un modèle.

### For developers

- `prefs.style` action (same `story_prefs` document as the mention box, key `defaultStyle`, validated against `STYLES`), `defaultStyle` in the `/data` defaults, `pure.defaultStyleOf` / `previewStyleFor`, `strictPrepare(…, { styleDefault })`. No setting added, no `minCore` change, no migration.

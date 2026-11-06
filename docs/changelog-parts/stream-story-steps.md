## Announcement story 2.8.0: event, then information, then style / Story d'annonce 2.8.0 : l'événement, puis les informations, puis le style

*EN: the style is now the last step before the download. For Curiosa 0.2.10 or later. Module touched: Announcement story 2.8.0.*
*FR : le style est maintenant la dernière étape avant le téléchargement. Pour Curiosa 0.2.10 ou plus. Module touché : Story d'annonce 2.8.0.*

### What changes for you / Ce qui change pour vous

- **EN: Three steps in a new order.** 1 Event (pick one, or "No event, I write it myself": the next step then starts empty), 2 Information (title, day and time, game, countdown, your sentence, guest streamers, logo and channel name: correct any of them, remove one with its "In the video" switch), 3 Style (ten cards, format, "Made with Curiosa" mark, then the "Generate the video" button).
- **FR : trois étapes, dans un nouvel ordre.** 1 Événement (en choisir un, ou « Aucun événement, j'écris moi-même » : l'étape suivante part alors de zéro), 2 Informations (titre, jour et heure, jeu, compte à rebours, votre phrase, co-streamers, logo et nom de la chaîne : corrigez chacune, retirez-en une avec son interrupteur « Dans la vidéo »), 3 Style (dix cartes, format, mention « Made with Curiosa », puis le bouton « Générer la vidéo »).
- **EN: A plain preview while you edit.** Steps 1 and 2 show the video in the "Minimal / text only" style, at rest so you can read it; step 3 shows the chosen style and each card updates it at once.
- **FR : un aperçu simple pendant les modifications.** Les étapes 1 et 2 montrent la vidéo dans le style « Minimal / texte seul », à l'arrêt pour qu'on puisse la lire ; l'étape 3 montre le style choisi et chaque carte le met à jour tout de suite.
- **EN: "Generate now" keeps the style you see.** Its button names the style ("Generate now, Minimal / text only style"); that style then shows as selected on the last step. The advanced-options block is gone: the switches moved next to their field, the rare settings sit under "More options".
- **FR : « Générer maintenant » garde le style que vous voyez.** Son bouton nomme le style (« Générer maintenant, style Minimal / texte seul ») ; ce style apparaît ensuite sélectionné à la dernière étape. Le bloc d'options avancées disparaît : les interrupteurs sont à côté de leur champ, les réglages rares sont sous « Plus d'options ».
- **EN: Models and assistant preparations** still open on the last step (now the style step) with their own style applied. Nothing stored changes.
- **FR : les modèles et les préparations de l'assistant** s'ouvrent toujours sur la dernière étape (maintenant le style), leur style déjà appliqué. Rien de ce qui est enregistré ne change.

### For developers

- **Announcement story 2.8.0**: `app.mjs` (three steps, `S.info`, `S.noEvent`, `S.styleChosen`, game cover by game name), `page.mjs` (markup and CSS, `KEYS`), `pure.mjs` (`EDIT_STYLE`, `infoFromStream`, `streamFromInfo`, `buildContent` tolerates a stream with no day), both locale files, the README. `minCore` unchanged, no data migration, no new route.
- Tests: `stream-story-ux`, `-events-editor`, `-watermark`, `-pure` and `stream-story` updated for the new steps.
- Likely conflicts with another version touching Announcement story: `app.mjs`, `page.mjs`, both locale files, the README and `tests/stream-story*.test.mjs`.

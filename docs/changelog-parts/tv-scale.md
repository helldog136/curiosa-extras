## Overlay elements: TV-sized text, and delete from the Partnerships edit window / Éléments d'overlay : texte à la taille d'une télé, et suppression depuis la fenêtre de modification des partenaires

*EN: the overlay elements follow the text size of the page (core 0.11.0): no text under 24 px on screen, whatever the frame. Partnerships gets its "Delete the partner" button in the edit window (core 0.12.0). Modules touched: Community stats 1.3.0, Thanks wall 1.3.0, Game suggestions 1.10.0, Sponsors overlay 1.3.0, Twitch raid 2.5.0, Countdown 1.3.0, Events 1.4.0, Polls 1.8.0, Twitch channel 2.4.0, Testimonials 1.4.0, Participation 1.10.0, Mascot 1.5.0, Planning 2.8.0, Partnerships 2.4.0.*
*FR : les éléments d'overlay suivent la taille du texte de la page (cœur 0.11.0) : aucun texte sous 24 px à l'écran, quel que soit le cadre. Partenariats a son bouton « Supprimer le partenaire » dans la fenêtre de modification (cœur 0.12.0). Modules touchés : voir la liste ci-dessus.*

### What changes for you / Ce qui change pour vous

- **EN: Readable on a TV.** Counters, thanks, top games, sponsors, raids, countdown, next event, poll, channel figures, reviews, draw, mascot and planning use the TV type scale: the smallest text is 24 px of the canvas, and the text size you choose for the page or the element applies exactly.
- **FR : lisible sur une télé.** Compteurs, remerciements, jeux en tête, sponsors, raids, compte à rebours, prochain événement, sondage, chiffres de la chaîne, avis, tirage au sort, mascotte et planning suivent l'échelle de texte TV : le plus petit texte fait 24 px du canevas, et la taille de texte choisie pour la page ou l'élément s'applique exactement.
- **EN: The text keeps its size, the layout gives way.** In a small frame an element leaves out its least useful lines or its last rows (or cuts a long text with "…") instead of shrinking the text. Frames already placed are not moved.
- **FR : le texte garde sa taille, la mise en page s'adapte.** Dans un cadre petit, un élément laisse de côté ses lignes les moins utiles ou ses dernières rangées (ou coupe un long texte par « … ») au lieu de rapetisser le texte. Les cadres déjà placés ne bougent pas.
- **EN: Delete a partner from its edit window.** "Delete the partner" sits at the start of the window footer, asks first and says what is lost. The row menu keeps it too.
- **FR : supprimer un partenaire depuis sa fenêtre de modification.** « Supprimer le partenaire » est au début du pied de la fenêtre, demande confirmation et dit ce qui est perdu. Le menu de la ligne le garde aussi.

### For developers

- Every overlay element declares `"tvScale": true` and `"minCore": "0.11.0"` (Partnerships keeps `0.6.7`: older cores ignore `secondaryAction`). Alerts overlay and Ticker overlay (already 16 and 18 px) and the maze are untouched.
- Each page reads `ov-tv` (above 0 and below 20, else 1) and defines `--ov-tv`, `--ov-text-xs` to `--ov-text-2xl` on the root. Planning "Next stream" now takes its smallest size from `--ov-text-xs`; "Week schedule" scales its rem sizes so its smallest text is 24 px.
- Partnerships 2.4.0: `adminForm.secondaryAction` on the edit window and the adminAction `removePartner` (the core's confirmation box replaces the tick of the deletion window).
- `docs/ERGONOMIE-ADMIN.md` and `tests/helpers/ergonomics.mjs` are copies of the core at tag v0.12.0 (rule R32). CONTRIBUTING.md has the TV checklist.
- Tests: `tests/helpers/tvLegibility.mjs` (shared helper, Chromium optional) and one `tests/tv-<module>.test.mjs` per module; `tests/partnerships-dialogs.test.mjs`; captures `docs/captures/ergonomie-partners-delete-action/`.

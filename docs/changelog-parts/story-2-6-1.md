## Announcement story 2.6.1: game cover and guests really show up / Story d'annonce 2.6.1 : la jaquette et les invités s'affichent vraiment

*For Curiosa 0.2.10 or later. Module changed: Announcement story 2.6.1. / Pour Curiosa 0.2.10 ou plus. Module touché : Story d'annonce 2.6.1.*

### Corrections
- **The game cover kept on your site is drawn in the story again.** Story 2.6.0 rejected the version mark of covers copied before the last update of Game covers. / **La jaquette gardée sur votre site s'affiche de nouveau dans la story.** La 2.6.0 refusait la marque de version des jaquettes copiées avant la dernière mise à jour de Jaquettes de jeux.
- **The people listed with a stream are now added by default.** The core only passes on the fields a module declares, and Story did not declare the list of people of a stream. / **Les personnes indiquées avec un stream sont maintenant ajoutées par défaut.** Le cœur ne transmet que les champs qu'un module déclare, et Story ne déclarait pas la liste des personnes d'un stream.

### Pour les développeurs
- `images.COVER_VERSION` accepts `[0-9a-f]{12}` or `t[0-9a-z]{1,12}` (what `versionOf` of Game covers produces); `module.json` declares `partners` (`string[]`) in the `planning.slot` schema. Tests: `tests/stream-story-cover-partners.test.mjs`.

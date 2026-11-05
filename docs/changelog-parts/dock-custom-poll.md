## Sondages 1.7.0 et Participation 1.7.0 : une durée libre et un titre pour les sondages lancés depuis le dock

*Pour Curiosa 0.6.0 ou plus. Modules touchés : Sondages 1.7.0, Participation 1.7.0.*

### Nouveautés

- **Polls 1.7.0 / Audience 1.7.0: a custom poll length in the dock.** The last chip of the length row is "Other": it turns into one small field in the same row where you type `45`, `90`, `1:30`, `2m` or `90s` (a whole number alone is seconds). Enter starts the poll. The length must be between 15 s and 15 min; otherwise a message under the field gives the limits and an example.
- **Sondages 1.7.0 / Participation 1.7.0 : une durée libre dans le dock.** Le dernier choix de la ligne des durées est « Autre » : il devient un petit champ dans la même ligne où vous tapez `45`, `90`, `1:30`, `2m` ou `90s` (un nombre seul veut dire des secondes). Entrée lance le sondage. La durée doit être entre 15 s et 15 min ; sinon un message sous le champ donne les limites et un exemple.
- **Polls 1.7.0 / Audience 1.7.0: the last custom length comes back as a chip** ("↺ 2:30"), so repeating it is one tap.
- **Sondages 1.7.0 / Participation 1.7.0 : la dernière durée libre revient en un clic** (« ↺ 2:30 »), pour la répéter d'un seul geste.
- **Polls 1.7.0 / Audience 1.7.0: a title for the poll, from the dock.** An optional "Question" field (for example "Do we raid now?") gives its title to a Yes / No poll, to "Repeat" and to the A / B form. Left empty, nothing changes: the usual title, one tap. The last question comes back as a "Last: ..." chip. On a very short dock the field moves under the "..." button.
- **Sondages 1.7.0 / Participation 1.7.0 : un titre pour le sondage, depuis le dock.** Un champ « Question » facultatif (par exemple « On raid maintenant ? ») donne son titre à un sondage Oui / Non, à « Refaire » et au formulaire A / B. Laissé vide, rien ne change : le titre habituel, en un clic. La dernière question revient en « Dernier : … ». Sur un dock très bas, le champ passe sous le bouton « … ».

### Pour les développeurs

- **Polls 1.7.0**: `parseDuration(text)` and `showDuration(seconds)` in `lib.mjs`, `QUICK = { minSeconds: 15, maxSeconds: 900 }`. `validateQuick` reads `seconds` through `parseDuration`, so the website form, the dock and the `poll_quick` tool share one check (an integer alone is seconds, as before). The dock remembers `{ seconds, question }` in the `meta` row `dock` (a custom length is stored only when it is not one of the presets). `poll-yesno` and `poll-again` read `values.question` (cut at 140 characters by `validateQuick`, like the site).
- **Audience 1.7.0**: `sanitizeForm` keeps `low`, `recall`, `recallLabel` on fields and `custom`, `last` on options; `sanitizeView` keeps `with` (up to 4 field names) on buttons, which the page merges into the values it sends. Tests: `dock-custom.test.mjs`, `dock-page.test.mjs`, `dock-flows.test.mjs`, `dock-layout.test.mjs` (new scene `poll-idle-last`, states custom-open / custom-error).

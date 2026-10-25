## Soutiens : remerciez ceux qui vous soutiennent, sans rien montrer sans leur accord

*Une page de remerciements alimentée par votre plateforme de mécénat. Pour Curiosa 0.2.12 ou plus. Module touché : Soutiens 1.0.0 (nouveau).*

### Nouveautés
- Branchez Patreon, Ko-fi ou importez un fichier : le site sait qui vous soutient, sans rien retaper. Un assistant en étapes vous guide, avec des mots simples.
- Rien n'est public sans l'accord de la personne : elle reçoit un lien personnel, choisit son pseudo et peut se retirer quand elle veut. S'inscrire sur la plateforme ne vaut jamais accord.
- Aucun montant n'est affiché : seulement les libellés de palier que vous choisissez, avec des modèles de départ.
- Vous pouvez ranger vos soutiens dans Contacts, seulement avec le droit prévu et en un clic.

### Améliorations
- Les clés secrètes ne sont jamais réaffichées, aucune adresse e-mail n'est gardée, et le site ne contacte que la plateforme choisie.
- Les anciens soutiens sont oubliés au bout d'un an, et Contacts peut exporter, effacer ou fusionner ce que le module garde.

### Pour les développeurs
- Table de fournisseurs extensible (`providers.mjs`) : Patreon (API v2, liste blanche d'hôtes, `ctx.api.net`), Ko-fi (webhook vérifié, limité en débit, idempotent), import CSV. Aucun minuteur : actualisation à la lecture, une fois par délai.
- `contact.book` v2 et `contact.curate` facultatifs ; écritures sous le droit `contacts.file`. Offre `privacy.subject` (`each`) et `supporters.public` v1 (pseudos montrables). `minCore` 0.2.12 (`pageSetting`).
- Neuf outils MCP, écritures jamais accordées d'office. Tests : `tests/supporters*.test.mjs`, aides `supporters-world.mjs` et `fakePatreon.mjs`.

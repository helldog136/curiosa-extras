# Mur des remerciements 1.0.0

## Nouveautés
- Une page « Merci ! » qui montre, en cartes avec photos, les personnes de vos catégories de Contacts : modération, mécènes, bêta-testeurs… (jusqu'à six groupes).
- Une personne à l'honneur chaque mois, préparée à l'avance si vous voulez, avec un petit mot.
- Un petit message sous le nom de chaque personne, dans chaque langue de votre site.
- Quelqu'un ne veut pas apparaître ? Rangez sa fiche dans la catégorie « Ne pas montrer » de Contacts : elle disparaît du mur en moins de deux minutes.

## Améliorations
- Rien à retaper : les noms et les photos viennent de Contacts et restent à jour.
- Si Contacts ne répond plus, la page garde le dernier mur connu ; sinon elle affiche un message aimable.
- Pensé pour le téléphone : deux cartes par ligne, grands boutons, erreurs sous le champ concerné.
- Le nom peut s'afficher en entier, en prénom seulement ou en pseudo : le mur est public, vous choisissez.

## Pour les développeurs
- Dépend de `contact.book` v2 (obligatoire, `min: 2`) : `categories`, `categoriesResolve`, `list` (curseur, 500 au plus), `resolve`, `search`. Réglages `choice` à source service (`createCategory` pour « Créer »). Aucun nom, photo ni pseudo n'est stocké : seuls `messages` et `honors`, par identifiant de fiche.
- Offre `privacy.subject` (`each`) : `export`, `erase`, `remap` ; `moved` suivi et `missing` retiré par l'action « Vérifier mes messages ».
- Mémoire du mur en processus (2 minutes, secours 24 h, 20 murs, reconstruction partagée), appels à Contacts bornés, aucun `fetch`, aucun minuteur de fond ; en cas de doute sur « ne pas montrer », rien de nouveau n'est publié.
- Photos : chargées par le navigateur du visiteur (liste blanche pour les photos de réseau). Droit `messages.edit`. Six outils MCP (écritures jamais accordées d'office). `minCore` 0.2.5.
- Tests : `tests/thanks-wall.test.mjs`, `tests/thanks-wall-admin.test.mjs`, `tests/helpers/thanks-wall-world.mjs` (avec `fakeContactBook`, non modifié).

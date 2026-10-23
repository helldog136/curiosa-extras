# Mentions légales 1.0.0

## Nouveautés
- Nouvelle extension « Mentions légales » : 6 à 8 questions simples, puis trois pages en français et en anglais (mentions légales, confidentialité, cookies) pour la Belgique, la France, la Suisse, le Canada et un autre pays.
- Un aperçu avant publication, avec ce qui manque écrit en clair. Une page n'est jamais publiée avec un trou.
- Un lien discret en bas de chaque page, et un rappel visible quand une extension qui récolte des informations est ajoutée.
- Ce sont des modèles d'aide, pas un conseil juridique : c'est dit à chaque étape.

## Améliorations
- Le site préremplit ce qu'il sait déjà : son nom, son adresse de contact, les extensions reconnues. Pour une extension qu'il ne connaît pas, il pose la question.
- Les erreurs s'affichent sous le champ, avec un exemple.
- Utilisable sur téléphone, sans défilement de côté.

## Pour les développeurs
- Module `legal-pages` 1.0.0, `minCore` 0.2.5, une instance, page publique `/legal` (sous-pages `notice`, `privacy`, `cookies`), emplacement `layout.footer`, droit `publish`, outils `legal_status`, `legal_preview`, `legal_set_answers`.
- `known.mjs` : table de préremplissage des extensions (testée contre les manifestes) ; le cœur n'expose pas les déclarations `privacy`.
- Les textes publiés sont un instantané fabriqué en mode « final » (erreur au moindre manque) ; aperçu en mode « preview ».
- Ne pas oublier de classer chaque nouvelle extension du catalogue dans `known.mjs`.

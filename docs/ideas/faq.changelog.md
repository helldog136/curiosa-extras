# Questions fréquentes 1.0.0

## Nouveautés
- Une page « Questions fréquentes » prête à l'emploi : questions rangées par thèmes, qui s'ouvrent et se referment, même sans JavaScript.
- Recherche en tapant (les accents et les majuscules ne gênent pas), lien direct vers chaque question.
- Boutons « Cela m'a aidé / Pas vraiment » sous chaque réponse, sans compte et sans cookie de suivi.
- Boîte « Vous ne trouvez pas votre réponse ? » : vous répondez et publiez d'un clic, la question quitte la boîte.
- Chaque question peut exister en français, en anglais ou dans les deux.
- Un assistant IA peut proposer des brouillons de réponse ; il ne publie jamais.

## Améliorations
- Pas de glisser-déposer : l'ordre se change avec « ↑ Haut / ↓ Bas ».
- Deux exemples de réponses sont prêts en brouillon à l'installation.
- Les questions reçues s'effacent d'elles-mêmes après 90 jours au plus et ne contiennent aucune donnée personnelle.
- Google et les autres moteurs de recherche peuvent afficher vos questions publiées.

## Pour les développeurs
- Module à code (`type: content` seulement pour le rangement du menu), `minCore` 0.2.6 (script de page), onglets « Ma FAQ » et « Questions reçues ».
- Fichiers : `text.mjs`, `data.mjs`, `ops.mjs`, `view.mjs`, `client.mjs`, `routes.mjs`, `admin.mjs`, `mcp.mjs`.
- Routes : `ask`, `vote` (JSON si `Accept: application/json`, sinon redirection 303 vers `#faq-…` construite côté serveur). Le script de confort n'est plus dans `layout.head` de toutes les pages : la page renvoie `scripts: ["faq.js"]` (`PageResult.scripts`, cœur 0.2.6) et le fichier `scripts/faq.js` est la copie exacte de `CLIENT_JS` (`client.mjs`), vérifiée par `tests/faq-public.test.mjs` (à régénérer si `client.mjs` change). La route `client.js` est retirée.
- FAQPage en JSON-LD dans le corps de la page (échappé, ≤ 17 000 caractères, ≤ 100 questions) via `ctx.api.seo.jsonLd`.
- Pas d'usage de `getByKey` ni de `generation` (absents du faux contexte du kit) ; écritures sérialisées par un verrou en mémoire.
- Tests : `tests/faq-public.test.mjs`, `tests/faq-routes.test.mjs`, `tests/faq-admin.test.mjs`, aide `tests/helpers/faqKit.mjs`.

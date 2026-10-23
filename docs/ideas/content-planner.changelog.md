# Cahier de contenu 1.0.0

## Nouveautés
- Un cahier privé pour vos idées de vidéos, d'articles et de posts, en trois endroits : Idées, En préparation, Publié (plus les Archivées).
- Un gros bouton « J'ai une idée ! » : un titre suffit, le reste vient après.
- Pour chaque idée : une phrase, des étapes à cocher, une date visée, les réseaux concernés et des notes.
- Un rythme facultatif (« 1 par semaine ») avec un message doux quand la dernière publication date un peu.
- Recherche, listes de 50 idées par page, archivage, suppression définitive avec une question claire.
- Téléchargement en CSV et sauvegarde lisible. Rien n'est jamais affiché sur votre site.
- Votre assistant IA peut ajouter une idée, les lister, les déplacer et cocher une étape.

## Améliorations
- Pensé pour le téléphone : grandes zones à toucher, aucune barre de défilement sur le côté, pas de glisser-déposer obligatoire.
- Les erreurs s'affichent sous le champ, avec un exemple.

## Pour les développeurs
- Module `content-planner` 1.0.0 (`minCore` 0.2.5), une instance, permissions `admin`, `storage`, `mcp`. Aucune route, page, section ni sujet.
- Données : collection `ideas` (1 000 documents au plus), lue par pages de 500 ; tri, recherche et pages calculés en mémoire sur ce plafond.
- Actions d'administration en forme fonction : la forme `{ right, run }` n'est pas reconnue par la règle `def.matches` du kit de conformité (panneau → action), qui exige une fonction. Seul `adminDownloads.ideas` porte un droit (`ideas.export`).
- Outils MCP : `ideas_list` (curseur opaque, 50 au plus), `idea_get`, `idea_add`, `idea_update`, `idea_move`, `idea_step`.
- Tests : `tests/content-planner.test.mjs`, `tests/content-planner-tools.test.mjs`.

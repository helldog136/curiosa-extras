# curiosa-extras

Les modules de [Curiosa](https://github.com/helldog136/Curiosa). Le cœur de Curiosa est volontairement minimal (le site et son admin) : tout le reste vit ici.

| Dossier | Contenu |
|---|---|
| `modules/` | Les fonctionnalités de base (blog, réseaux sociaux, codes promo, pages, bandeau, formulaire de contact, statut live…) et les modules pour créateurs (sponsors, planning, contacts, partenariats, overlays de stream…). |
| `examples/` | Deux petits modules à lire pour apprendre à en écrire un. |
| `catalogue/index.json` | L'index que le Catalogue de l'admin relit (généré par `scripts/build-index.mjs`). |
| `tests/` | Les tests des modules. |

Chaque module est un dossier autonome (`module.json`, `index.mjs`, `locales/`, `README.md`). Il s'installe depuis le Catalogue, ou à la main avec une adresse de la forme `https://github.com/helldog136/curiosa-extras#:modules/<id>`.

## Branches
Même cycle que le cœur : `dev` reçoit le travail, la fusion de `dev` dans `master` publie. Les versions du cœur embarquent un instantané de `master` pour l'assistant de première installation.

## Tests
```
git clone https://github.com/helldog136/Curiosa ../Curiosa && (cd ../Curiosa && npm ci)
CURIOSA_DIR=../Curiosa npm test
```
Les tests passent par le chargeur du cœur : un module ne doit utiliser que l'API publique des modules.

## Licence
Chaque module déclare la sienne dans son `module.json`. Les modules de base portent la Curiosa License 1.0 (voir le cœur).

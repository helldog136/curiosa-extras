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

## Les chiffres des réseaux : le contrat `social.stat`
Le module *Statistiques de la communauté* relève, garde et sert (admin, assistant) les chiffres des réseaux de la personne. Chaque module de réseau **possède ses chiffres** et les publie sur le sujet `social.stat` ; Statistiques de la communauté ne fait que les collecter (aucun cumul inventé, aucun affichage public pour l'instant). Un fournisseur déclare `provides: [{ "topic": "social.stat" }]` et implémente `exports["social.stat"](ctx, { locale, limit, tags })`, qui renvoie des éléments :

```js
{ id: "twitch-channel:emma:followers", // stable : "<module>:<clé d'instance>:<type de chiffre>" ("manual" est réservé)
  platform: "twitch", account: "emma_live", accountKey: "emma",
  metric: "followers", // followers (audience gratuite) | paying (audience payante) | content (nombre de contenus) | views (vues cumulées)
  label: "Followers Twitch", value: 1250, // entier >= 0 ; ABSENT quand `error` est présent, jamais une valeur périmée
  asOf: "2026-10-14T10:00:00Z", url: "https://…", // url facultative
  error: undefined /* ou "auth" | "rate" | "network" | "hidden" | "config" */ }
```
Un élément invalide est écarté seul ; un élément avec `error` ne produit jamais de point d'historique. Le détail (limites de taille, stockage, volumes) est dans `modules/community-stats/README.md`.

## Tests
```
git clone https://github.com/helldog136/Curiosa ../Curiosa && (cd ../Curiosa && npm ci)
CURIOSA_DIR=../Curiosa npm test
```
Les tests passent par le chargeur du cœur : un module ne doit utiliser que l'API publique des modules.

## Soutenir le projet

Ces modules sont gratuits. Si vous les aimez, un pourboire est possible sur [helldog136.be/tip-me](https://helldog136.be/tip-me) ; c'est entièrement volontaire, rien n'en dépend.

## Licence
Chaque module déclare la sienne dans son `module.json`. Les modules de base portent la Curiosa License 1.0 (voir le cœur).

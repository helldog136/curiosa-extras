# curiosa-extras

Les modules de [Curiosa](https://github.com/helldog136/Curiosa). Le cœur de Curiosa est volontairement minimal (le site et son admin) : tout le reste vit ici.

| Dossier | Contenu |
|---|---|
| `modules/` | Les fonctionnalités de base (blog, réseaux sociaux, codes promo, pages, bandeau, formulaire de contact, statut live…) et les modules pour créateurs (sponsors, planning, contacts, partenariats, overlays de stream…). |
| `examples/` | Deux petits modules à lire pour apprendre à en écrire un. |
| `catalogue/index.json` | L'index que le Catalogue de l'admin relit (généré par `scripts/build-index.mjs`). |
| `tests/` | Les tests des modules. |

Chaque module est un dossier autonome (`module.json`, `index.mjs`, `locales/`, `README.md`). Il s'installe depuis le Catalogue, ou à la main avec une adresse de la forme `https://github.com/helldog136/curiosa-extras#:modules/<id>`.

## Calendriers : le sujet `calendar.event`

Le **Planning** ne lit plus de calendrier lui-même : il *consomme* des calendriers que fournissent d'autres modules, et l'administrateur choisit ses sources (section « Sources de données » du Planning, filtrables par étiquette ; plusieurs sources dans un même planning, aucun dédoublonnage : on choisit ses sources).

| Fournisseur | Rôle |
|---|---|
| `calendar-ical` | un Google Agenda ou tout flux iCal (adresse secrète, jamais réaffichée) |
| `calendar-manual` | des évènements saisis à la main (avec une répétition hebdomadaire) |
| `twitch-channel` | le planning de diffusion publié sur Twitch (option « Fournir mon planning Twitch comme calendrier », désactivée par défaut) |

Chaque fournisseur déclare `provides: [{ "topic": "calendar.event" }]`, implémente `exports["calendar.event"]` et offre le service `calendar.provider` en `each: true` (`{ "service": "calendar.provider", "each": true }` : chaque instance répond pour SA source, aucun maître à choisir). Le Planning déclare `requires: [{ "service": "calendar.provider" }]` : n'importe quel fournisseur actif suffit, et le cœur en installe un depuis le Catalogue si aucun n'est là (`calendar-ical` en premier). Aucun fournisseur ne connaît le Planning, et un fournisseur ne livre que des évènements **bruts et neutres** : c'est le consommateur qui interprète les textes.

**Élément du sujet** (cœur 0.1.16 ou plus ; `start` / `end` sont du type `datetime` du schéma de `consumes`, ISO 8601) :

```jsonc
{
  "id": "abc@2026-10-14T19:00:00.000Z",   // string, obligatoire : unique pour la source (une occurrence d'une répétition a le sien)
  "title": "Soirée découverte",           // string, obligatoire
  "start": "2026-10-14T19:00:00.000Z",    // datetime, obligatoire
  "end": "2026-10-14T21:30:00.000Z",      // datetime, facultatif
  "allDay": false,                        // boolean, facultatif
  "description": "Jeu : Celeste",         // string, facultatif : texte brut, non interprété par le fournisseur
  "location": "…", "url": "https://…",    // facultatifs
  "status": "confirmed",                  // "confirmed" | "cancelled", facultatif (absent = confirmé)
  "category": "Celeste",                  // facultatif : catégorie NEUTRE (pour Twitch : le jeu)
  "color": "#9146ff",                     // facultatif : couleur de la SOURCE (#rgb ou #rrggbb)
  "sourceLabel": "Streams"                // facultatif : nom de la SOURCE
}
```

- **Journée entière** (`allDay: true`) : `start` et `end` sont des **dates** (`2026-10-14`), `end` **exclue** (comme en iCal : un évènement du 14 seul finit le 15) ; le consommateur les place dans son propre fuseau. Sinon : instants ISO 8601 en UTC (`…Z`) ; sans décalage, le cœur lit l'heure en UTC.
- **Appel** : `exports["calendar.event"](ctx, { locale, limit, tags, from, to })`. Le fournisseur **respecte** `from` / `to` (objets `Date` ; les évènements qui *chevauchent* la plage, répétitions développées dans la plage), `limit` (200 au plus) et `tags` (si le consommateur demande des étiquettes, une source qui n'en a aucune de commune ne renvoie rien). Sans plage : de maintenant à 60 jours.
- **Étiquette et couleur** : chaque évènement porte celles de SA source (réglages de l'instance fournisseuse, facultatifs).
- **`category`** : le Planning s'en sert comme jeu quand la description n'a pas de ligne « Jeu : … » (la ligne de la description l'emporte).
- **Annulation** : `status: "cancelled"` ; le fournisseur renvoie aussi les évènements annulés, c'est le consommateur qui décide de les montrer (barrés) ou non.
- **Service `calendar.provider`** : méthode `describe()` → `{ kind, label, color, active, state }` (aucun appel réseau, aucune adresse). Le Planning s'en sert pour lister ses sources et dire « Ajoutez une source de calendrier » quand il n'y en a aucune.

## Branches
Même cycle que le cœur : `dev` reçoit le travail, la fusion de `dev` dans `master` publie. Les versions du cœur embarquent un instantané de `master` pour l'assistant de première installation.

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

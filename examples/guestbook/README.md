# Guestbook (Livre d'or) — module d'exemple pour Curiosa

Un livre d'or **modéré** : les visiteurs signent, l'administrateur valide. C'est un vrai module qui fonctionne, et aussi
le module d'exemple **le plus complet** : il utilise chaque capacité du framework, avec des commentaires qui expliquent
le pourquoi. Le tutoriel [docs/CREATE-A-MODULE.md](../../docs/CREATE-A-MODULE.md) s'appuie dessus, la référence est
[docs/MODULES.md](../../docs/MODULES.md).

## Installer

Dans l'admin : **Catalogue** (ou **Modules → Installer un module**) → « Livre d'or ». Le module s'installe *désactivé* ;
activez-le, ajoutez une instance, puis ouvrez-la pour régler. Dépôt personnel : voir « Tester son module en local » du tutoriel.

## Fichiers

| Fichier | Rôle |
|---|---|
| `module.json` | Manifeste : identité, permissions, réglages, sections (avec taille), sujets fournis, actions MCP |
| `index.mjs` | Code, en ES module pur, **sans aucun import du cœur** : tout passe par `ctx` |
| `locales/en.json`, `locales/fr.json` | Textes (`ctx.t("clé")`), mêmes clés dans les deux langues |

## Ce que le module montre, capacité par capacité

| Capacité | Où |
|---|---|
| Réglages de tous types (`text`, `textarea`, `boolean`, `number`, `select`, `color`, `image`, `secret`), `translatable`, `advanced`, `group: "appearance"`, couleur qui suit le thème (`theme:accent`) | `module.json` → `settings` |
| Sections d'accueil avec taille recommandée (`small` « dernier message », `medium` « messages récents » + option `count`) | `sections` |
| Page publique (`/guestbook`, pagination par chemin `/guestbook/page/2`) | `page` |
| Formulaire public : validation, piège à robots, limiteur en mémoire, code d'invitation, conservation puis e-mail au propriétaire (au mieux) | `routes.sign` |
| Stockage privé de l'instance, modération (`pending` → `approved`) | `ctx.api.store` |
| E-mail | `ctx.api.mail.send({ to: "owner", … })` |
| Emplacement du site (lien dans le pied de page) | `slots["layout.footer"]` |
| Sujets : `feed.item` (flux RSS, rubrique partagée `guestbook`) et `guestbook.message` (format propre au module) | `provides` + `exports` |
| Panneau d'admin : tableau + boutons de ligne + formulaire de modification | `adminPanel`, `adminActions` |
| Actions MCP : `guestbook_list` (lecture), `guestbook_approve` (écriture, non accordée d'office), `guestbook_delete` (destructive) | `mcp` |
| Sauvegarde lisible sans le framework (`messages.csv`, injection de formule neutralisée) | `backup.readable` |
| Thème du site (variables CSS et `ctx.theme`), i18n, échappement de tout texte de visiteur, URL sûres | `card()`, `esc()`, `safeSrc()` |
| Crochets d'instance | `hooks` |

Non utilisés ici car sans intérêt pour un livre d'or (mais décrits dans le tutoriel) : `consumes` (lire les données d'autres
modules), `overlay`, `filters`, `content` (modules « zéro code »).

## Le sujet `guestbook.message`

Un autre module peut l'afficher en le déclarant dans son `consumes` :

```json
{ "topic": "guestbook.message", "label": { "en": "Guestbook messages" },
  "schema": [ { "key": "id", "type": "string" }, { "key": "name", "type": "string", "required": true },
              { "key": "text", "type": "string", "required": true }, { "key": "publishedAt", "type": "string" } ] }
```

Seuls les messages **validés** sont exposés (au flux RSS comme à ce sujet).

## Limites connues

- Le limiteur de débit est en mémoire (remis à zéro au redémarrage) : un garde-fou, pas un pare-feu.
- Le stockage n'a pas de requête : le module lit jusqu'à 1000 messages et filtre en code.
- `hooks.onInstanceCreate` est appelé à la création de l'instance (pas lors d'une restauration de sauvegarde) : il est idempotent.

## Tests

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/helpers/register.mjs --test tests/modules/example-guestbook.test.mjs`

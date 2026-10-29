# Registre des sujets

Un **sujet** est le nom d'un échange d'informations entre modules (`domaine.objet`, en anglais, en minuscules). Ce fichier est le
**registre** des sujets utilisés par les modules de ce dépôt. Le test `tests/repo-rules.test.mjs` le lit : un sujet utilisé par un
module (dans `module.json` ou dans le code) et absent d'ici fait échouer les tests ; une ligne mal formée aussi.

Le cœur de Curiosa ne tient **aucun** registre : il ne documente (dans son `docs/MODULES.md`) que les trois sujets qu'il lit lui-même,
`core.entry`, `social.link` et `feed.item`. Tout autre sujet est une affaire entre modules, donc se déclare ici. Publier un nouveau
sujet ne demande donc jamais une nouvelle version du cœur.

## Comment ajouter un sujet

1. Ajouter **une ligne** au tableau ci-dessous : `sujet | fournisseurs | consommateurs | champs | depuis`.
2. Colonne « Champs » : les champs du schéma, `?` après le nom si facultatif, les valeurs fermées entre parenthèses, les bornes (nombre
   d'éléments, longueur) et la règle de vie privée s'il y en a une.
3. Colonne « Depuis » : la version du dépôt des modules qui introduit le sujet (pour les sujets anciens : la version du cœur dont la
   documentation les listait, marquée « cœur »).
4. Un champ ajouté plus tard est **facultatif** et se note dans la colonne « Champs » ; on ne retire ni ne renomme jamais un champ (un
   champ renommé est un nouveau champ, l'ancien reste lu).

Les noms entre accolades `{…}` regroupent des fournisseurs ou consommateurs de même famille ; `*` veut dire « tout module qui le
souhaite ».

## Sujets lus par le cœur

Le cœur possède le schéma de ces trois sujets (voir `docs/MODULES.md` du cœur) ; ils sont répétés ici pour que la liste soit complète.

| Sujet | Fournisseurs | Consommateurs | Champs | Depuis |
|---|---|---|---|---|
| `core.entry` | le cœur | `discord-announcer`, `maze-overlay`, `sponsor-ticker`, `ticker-overlay` | entrées publiées de toute instance à contenu | cœur 0.2.0 |
| `feed.item` | `youtube-channel`, `*` | le cœur (flux RSS), `discord-announcer`, `mascot` | éléments proposés au flux RSS | cœur 0.1.23 |
| `social.link` | tout module « réseau social » (`bluesky`, `discord`, `github`, `youtube-channel`, `twitch-channel`, `platform-links`…) | le cœur (en-tête et pied de page), `planning`, `twitch-bot` | `label`, `url`, `icon`, et les champs facultatifs de liens définis par le cœur | cœur 0.2.13 |

## Sujets entre modules

| Sujet | Fournisseurs | Consommateurs | Champs | Depuis |
|---|---|---|---|---|
| `overlay.item` | `testimonials`, `*` | `ticker-overlay` | `title`, `text?`, `image?`, `url?` : éléments simples pour les overlays | cœur 0.1.x |
| `guestbook.message` | `guestbook` (exemple) | tout module qui affiche un livre d'or | `id`, `name`, `text`, `publishedAt` : message validé | cœur 0.1.x |
| `sponsor.card` | `sponsors` | `sponsor-ticker` | nom, code, logo, lien : carte de sponsor | cœur 0.1.x |
| `partnership.partner` | `partnerships` | `sponsors` | nom, logo : fiche de partenaire | cœur 0.1.x |
| `planning.slot` | `calendar-manual`, `calendar-ical`, tout module « agenda de streams » | `planning`, `stream-story`, `twitch-bot` | `id`, `title`, `start`, `end?`, `allDay?`, `day?`, `games?`, `status?`, `timezone?` ; reçoit une période `from` / `to` | cœur 0.1.27 |
| `calendar.event` | tout module « calendrier » (réservé) | lecteurs d'agenda qui ne parlent pas de streams | `id`, `title`, `start`, `end?`, `allDay?`, `description?`, `location?`, `url?`, `status?`, `category?`, `color?`, `sourceLabel?` ; reçoit une période `from` / `to`. Les streams passent par `planning.slot` | cœur 0.1.17 |
| `social.stat` | `bluesky`, `discord`, `github`, `mastodon`, `reddit`, `twitch-channel`, `youtube-channel` | `community-stats`, `twitch-bot` | `id`, `metric` (`followers`, `paying`, `content`, `views`), `value`, `asOf`, `error?` | cœur 0.1.17 |
| `maze.poster` | `twitch-channel`, `youtube-channel`, `*` | `maze-overlay` | affiche pour le labyrinthe | cœur 0.1.x |
| `stream.live` | `twitch-channel` | `discord-announcer` | `id`, `title`, `url`, `startedAt`, `game` ; vide hors ligne | cœur 0.1.x |
| `ha.result` | `home-assistant` | `twitch-bot`, `youtube-live-actions` | `ref`, `id`, `status` (`done`, `failed`, `ignored`, `expired`, `refused`), `code`, `at` : issue d'un ordre confié à Home Assistant, pour valider, rembourser ou afficher | cœur 0.2.8 |
| `ha.state` | `home-assistant` | `twitch-bot` | `enabled`, `live`, `paired`, `lastSeenAt?` : un seul élément, l'état du pont (le bot met ses récompenses en pause ou les réactive) | cœur 0.2.8 |
| `home.actions` | `twitch-bot` | `home-assistant` | `key` (`^[a-z0-9][a-z0-9:_-]{0,39}$`), `label` (texte nettoyé, 60 caractères au plus, dans la langue du site) : les NOMS des actions de la maison que les récompenses peuvent lancer, 50 au plus, sans secret ni récompense ni pseudo. Les actions de base (lumières, voix) n'y sont que si une récompense les utilise ; les actions nommées y sont toutes. Le connecteur les ajoute à `pull` (champ `catalog`) pour que l'intégration propose de les relier | 1.23.0 |
| `live.event` | `youtube-live-actions` | `alerts-overlay` | `id`, `platform`, `kind` (`superchat`, `supersticker`, `member`, `gift`), `who`, `at`, et selon le cas `amount` (toujours avec `currency`), `count`, `text` ; en mémoire seulement (15 minutes, 50 au plus) | cœur 0.2.8 |
| `map.place` | `events`, `directory`, tout module qui a des lieux | `map` | `id`, `title`, `lat` (-90 à 90), `lng` (-180 à 180, jamais le point 0,0, 5 décimales), `kind`, `url?`, `at?` (date ISO), `note?` ; 200 éléments au plus. **Jamais d'adresse personnelle sans consentement** : lieu public ou ville arrondie d'une personne qui a dit oui. La carte n'écrit jamais chez la source | cœur 0.2.11 |
| `mascot.hint` | `daily-game`, tout module qui a une nouveauté à annoncer | `mascot` | `id` (change quand l'état change), `text` (140 caractères, sans balise), `url?` (page du site) ; 10 au plus. Un module qui n'a rien à dire ne publie rien | cœur 0.2.11 |

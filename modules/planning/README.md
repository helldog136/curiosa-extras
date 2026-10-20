# Planning des streams — module communautaire de Curiosa, porté d'un planning existant

Vos prochains streams, jour par jour, **affichés** dans l'apparence de votre choix. Le Planning ne lit pas d'agenda lui-même : vos streams lui viennent d'un module « agenda », sans qu'il ait à savoir lequel :

- **Agenda en ligne** : lit votre Google Agenda (ou tout agenda au format iCal) ;
- **Streams saisis à la main** : vous écrivez vos streams dans l'administration, sans agenda en ligne.

Installez l'un des deux, ou les deux : leurs streams s'ajoutent (un stream écrit deux fois n'est montré qu'une fois). Le **bot Twitch** lit les mêmes agendas : il peut répondre à `!planning` même sans Planning.

Il faut Curiosa 0.1.27 ou plus.

- **Page publique** `/planning` : les *N* prochains jours (7 par défaut, réglage avancé).
- **Section d'accueil** « Prochains streams » et « Prochain stream » (à placer depuis *Page d'accueil*).
- **Sans agenda installé** : le planning ne casse rien. Il dit « Pas de stream planifié pour l'instant » aux visiteurs, et l'administration vous explique quoi installer.
- **Fuseau horaire** : par défaut, celui de vos agendas (réglage avancé « Fuseau horaire d'affichage » pour en imposer un autre).
- **Assistants IA** : `planning_upcoming` (lecture seule, accordée par défaut).
- **Admin** : les prochains streams vus, les jaquettes, et l'aperçu de chaque apparence.

## Apparences au choix (réglage « Apparence du planning »)

Le même agenda, présenté de six manières (plus l'affichage d'origine, **choix par défaut** : rien ne change tant que vous ne choisissez pas). L'admin de l'instance montre, sous l'état des streams, un **aperçu réel** de chaque choix avec des streams d'exemple.

| Apparence | Ce que ça donne | Inspiration |
|---|---|---|
| **Liste simple** (défaut) | Le rendu d'origine : un titre par jour, puis les streams. | — |
| **Liste classique** | Agenda sobre : un jour par rangée, heure à gauche, jaquette, titre et jeux. | Apple Calendrier, Dieter Rams |
| **Liste en alternance** | L'en-tête de jour passe de gauche à droite d'un jour à l'autre, en cases arrondies ; jusqu'à 3 jaquettes ; semaine vide = un seul message ; en colonne sur mobile. | L'ancien site de l'auteur |
| **Semaine en grille** | 7 colonnes (premier jour de la semaine au choix), créneaux empilés ; liste verticale sur mobile. | Vue semaine d'un agenda |
| **Timeline** | Rail vertical, points datés, vignettes, aéré ; les jours vides se résument en une ligne. | Linear, Stripe |
| **Affiches** | Cartes verticales : jaquette pleine hauteur, dégradé, date en pastille, titre dessus ; sans jeu, logo du site sur mauve Twitch. | Apple TV, Netflix, Spotify |
| **À la une + à suivre** | Le prochain stream en grand (« Dans 3 h » ou « En cours », bouton vers la chaîne), puis la suite en liste compacte. | Apple TV « À suivre » |

Captures décrites : toutes les apparences ont été vérifiées dans le vrai site (page `/planning` et accueil, 390 px et 1280 px, palette claire avec accent secondaire et palette sombre).

**Options communes** : densité (confortable/compacte), jaquettes, indications relatives (« Dans 3 h »), format de l'heure (24 h/12 h), premier jour de la semaine, rappel du fuseau, style des en-têtes de jour (texte/pastille/court), heure de fin, afficher les streams annulés (barrés, avec « Annulé »). Le nombre de jours reste le réglage « Jours affichés » (7, 14, 30…). **Options propres** : liste classique (masquer les jours vides), alternance (côté du premier jour), semaine (semaines du calendrier ou 7 jours glissants), timeline (montrer les jours vides), à la une (nombre de « à suivre »).

**Où ça s'applique** : page publique et section « Prochains streams » (celle-ci peut avoir sa propre apparence, option « Apparence » du morceau ; « Comme la page » par défaut). La carte « Prochain stream » garde son rendu et suit la densité. L'image PNG du panneau Twitch (`/m/<clé>/image`) garde son gabarit.

## Les morceaux d'accueil

- **« Prochain stream »** : une carte encadrée (bordure, arrondi, relief, filet aux couleurs du thème) : à gauche la **jaquette** du jeu (jusqu'à 3, superposées), puis une pastille d'état (« En cours », « Dans 40 min », « Dans 3 h », « Aujourd'hui », « Demain », « Dans 4 jours »), le **titre**, l'**heure** en grand et le jour, le jeu, les autres streams du même jour et un bouton « Regarder sur Twitch ». Son lien est celui de la Chaîne Twitch si elle est installée (un seul endroit pour saisir votre chaîne) ; sinon, c'est « Lien de votre chaîne » dans les réglages du planning. Les balises `<time>` sont sémantiques, les jaquettes ont un texte alternatif, aucune animation sans `prefers-reduced-motion`.
- **« Prochains streams »** : une liste dans une carte, une ligne par stream (tuile de jour, vignette, titre, heure, jeu, pastille d'état) et un lien « Voir le planning complet » (si l'instance a une page publique).
- **Rien de prévu** (ou aucun agenda installé) : une carte « Pas de stream planifié pour l'instant » avec le lien vers le planning complet. Jamais d'erreur affichée aux visiteurs.
- **Stream sans jeu** (soirée caritative, discussion…) : pas de jeu indiqué, donc ni nom de jeu ni recherche de jaquette ; à la place de la jaquette, un visuel aux mêmes proportions : le **logo du site** (variante « fond sombre » si elle existe, sinon le logo principal sur un disque blanc) sur le **mauve Twitch** `#9146FF` (seule couleur fixe du module, c'est la couleur de marque de Twitch) ; sans logo, l'initiale du nom du site. Le même visuel sert dans la liste et, pour un jour qui mêle streams avec et sans jeu, sur la page publique. L'image PNG à partager ne l'utilise pas encore (elle n'affiche rien pour un stream sans jaquette).
- Les couleurs viennent des variables de thème du site (`--v-surface`, `--v-line`, `--v-fg`, `--v-muted`, `--v-accent`, `--v-gradient`…) : la carte suit toutes les palettes, claires ou sombres, avec ou sans couleur secondaire. La mise en page suit la largeur de la case, pas celle de l'écran.

## Où écrire ses streams ?

Dans le module qui les fournit, pas ici :

- **Agenda en ligne** : un guide « Comment remplir mon agenda Google ? » (où écrire le titre, les heures, le jeu, les répétitions) et un fichier à donner à votre assistant IA sont dans la page de ce module.
- **Streams saisis à la main** : un petit formulaire dans la page de ce module.

Sans aucun agenda installé, l'administration du planning le dit et vous indique quoi ajouter (*Extensions → Ajouter*).

## Si vous aviez déjà le Planning (version 1.x)

Avant la version 2.0.0, le Planning gardait lui-même l'adresse de votre Google Agenda. **En vous mettant à jour, il reprend tout seul cette adresse (et son fuseau horaire) dans un module « Agenda en ligne », qu'il installe pour vous si besoin, puis efface son ancien réglage.** Votre page `/planning`, vos blocs d'accueil, l'image à partager et les réponses du bot Twitch montrent exactement les mêmes streams, et vous n'avez rien à faire. Si l'installation du nouveau module échouait (site sans accès au Catalogue, par exemple), la mise à jour du Planning est mise de côté avec un bouton « Réessayer » : rien n'est perdu, et l'ancienne adresse reste en place jusqu'à ce que ça réussisse.

Le réglage « Ancienne adresse du calendrier » (réglages avancés) est vide une fois la reprise faite : laissez-le vide. Cette reprise automatique est **temporaire : à retirer en 0.3.0**.

## Jaquettes des jeux (RAWG)

Pour chaque jeu d'un stream, le module demande sa jaquette à RAWG **par le service du cœur** et l'affiche sur la page publique, dans les morceaux d'accueil « prochain stream » et « prochains streams », dans l'admin et sur l'image à partager. La clé RAWG (gratuite, [rawg.io/apidocs](https://rawg.io/apidocs)) se saisit **une seule fois, dans Admin → Réglages**, pour tous les modules : le planning n'a pas de réglage de clé, et ne la voit jamais. Il faut une version de Curiosa qui offre ce service (permission `rawg`) ; sinon, ou sans clé, ou si RAWG refuse la clé ou ne répond pas, seul le nom du jeu s'affiche, et l'admin du module dit clairement lequel de ces cas c'est. Le cache et la cadence des demandes sont ceux du cœur.

## Image à partager (PNG)

`https://votre-site/m/<clé>/image` : la semaine en cours (lundi → dimanche) en image PNG de 900 px de large aux couleurs du site, prête pour un panneau Twitch (« image + lien depuis une URL ») ou un réseau social. Une ligne par jour, deux streams au plus par jour, avec la jaquette des jeux (trois au plus par stream) à côté de l'heure et du titre. `?week=1` pour la semaine suivante (jusqu'à 8). Générée par le service du cœur `ctx.api.png` (aucune dépendance native dans le module), mise en cache 5 minutes ; pour la télécharger : ouvrez l'adresse dans le navigateur et enregistrez l'image.

Différence avec l'ancien site : pas de page d'admin dédiée avec bouton « Enregistrer l'image » ni de choix de semaine en un clic — l'adresse `?week=N` en tient lieu, et la route est publique (comme l'ancienne adresse destinée à l'extension Twitch).

## Pour les développeurs

Le Planning est un **lecteur** : il *consomme* le sujet `planning.slot` (voir le contrat dans le README de « Agenda en ligne »), validé par le cœur, et ne connaît aucun module qui le fournit. Chaque créneau arrive avec son état (`status`), ses jeux (`games`) et le fuseau de son agenda (`timezone`) ; une journée entière porte sa date (`day`). Le Planning écarte les doublons (même titre, mêmes heures) et affiche dans son fuseau d'affichage (réglage, sinon fuseau le plus courant des agendas, sinon UTC). Il ne lit plus de description : les jeux viennent de l'agenda.

**Architecture** (`modules/planning/`) : `index.mjs` (jaquettes, pages, morceaux d'accueil, module), `slots.mjs` (mise au format des créneaux reçus, fonctions pures), `dates.mjs`, `relative.mjs`, puis `appearances/` : `options.mjs` (réglages et défauts), `model.mjs` (regroupement par jour/semaine, en cours, annulé, fuseau), `kit.mjs` (outils et style de base), `layouts/*.mjs` (une apparence = `render(model, options, ctx) → { html, css }`, pure), `registry.mjs`, `preview.mjs`, `entry.mjs` (seul point d'appel d'`index.mjs`). Les fichiers voisins sont chargés avec le même `?v=` que `index.mjs` pour qu'une mise à jour à chaud ne mélange pas d'anciens fichiers.

Migration 1 → 2 (`dataVersion` 2, **temporaire, à retirer en 0.3.0**) : `seeds` désigne `calendar-ical` ; `migrations[2]` demande au cœur (`ctx.seedInstance`, une seule fois par adresse grâce à `seedKey`) une instance d'« Agenda en ligne » avec `{ url, timezone }` (fuseau choisi, sinon `UTC`, comme le lisait l'ancien Planning), puis efface `icsUrl`. Le lien avec la cible est un sujet (`consumes` / `provides`) et non une dépendance (`requires`) : cela demande Curiosa 0.1.27.

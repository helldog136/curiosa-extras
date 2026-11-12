# Planning des streams — module communautaire de Curiosa, porté d'un planning existant

Vos prochains streams, jour par jour, **affichés** dans l'apparence de votre choix. Le Planning ne lit pas d'agenda lui-même : vos streams lui viennent d'un module « agenda », sans qu'il ait à savoir lequel :

- **Agenda en ligne** : lit votre Google Agenda (ou tout agenda au format iCal) ;
- **Streams saisis à la main** : vous écrivez vos streams dans l'administration, sans agenda en ligne.

Installez l'un des deux, ou les deux : leurs streams s'ajoutent (un stream écrit deux fois n'est montré qu'une fois). Le **bot Twitch** lit les mêmes agendas : il peut répondre à `!planning` même sans Planning.

Il faut Curiosa 0.5.0 ou plus (les éléments pour les pages d'overlay ; la page, l'accueil et le reste fonctionnent comme avant).

- **Page publique** `/planning` : les *N* prochains jours (7 par défaut, réglage avancé).
- **Section d'accueil** « Prochains streams » et « Prochain stream » (à placer depuis *Page d'accueil*).
- **Sans agenda installé** : le planning ne casse rien. Il dit « Pas de stream planifié pour l'instant » au public, et l'administration vous explique quoi installer.
- **Fuseau horaire** : par défaut, celui de vos agendas (réglage avancé « Fuseau horaire d'affichage » pour en imposer un autre).
- **Assistants IA** : `planning_upcoming` (lecture seule, accordée par défaut).
- **Jaquette peut-être fausse** (administration seulement, Curiosa 0.2.10 ou plus) : quand RAWG n'est pas sûr du jeu (`ambiguous`), l'administration liste le jeu avec un lien « Ce n'est pas le bon jeu ? » vers `/admin/settings/rawg-covers?titre=<titre encodé>`, l'écran du cœur où l'on choisit le bon jeu. Rien n'est ajouté côté public.
- **Admin** : les prochains streams vus, « Avec qui vous streamez », les jaquettes, et l'aperçu de chaque apparence.

## Éléments pour les pages d'overlay (version 2.5.0, Curiosa 0.5.0)

Le Planning propose **deux éléments** aux pages d'overlay de la section **Overlays** de l'administration (une seule adresse à coller dans OBS par page d'overlay). Le Planning n'a pas d'overlay à lui : ces éléments n'existent que dans les pages d'overlay. Rien ne change pour la page publique, l'accueil, l'image de la semaine, vos réglages ou vos adresses.

| Élément | Ce qu'il montre | Options |
|---|---|---|
| **Planning de la semaine** | Vos prochains streams jour par jour. Il demande de la place (taille minimale 480 × 280) : une grille sur sept jours quand le cadre est large, une liste quand il est étroit. | **Apparence** (selon la place, semaine en grille, liste classique, liste en alternance, timeline, affiches), **nombre de jours** (1 à 14, 7 par défaut), **jaquettes** (oui par défaut ; masquées d'office dans une grille trop basse) |
| **Prochain stream** | Le prochain stream en grand (titre, jour, heure, jeu, jaquette, « Dans 2 h » ou « En cours »). Taille minimale 320 × 160. | **Streams suivants à montrer** (0 à 5, 0 par défaut), **jaquettes** |

- **Il se réorganise selon la taille reçue** et remplit tout le cadre ; sans place, il réduit un peu le texte (jamais en dessous de 55 %) puis estompe le bas. Fond transparent par défaut ; il suit le **style commun** de la page d'overlay (texte clair ou sombre, fond doux, angles) par les jetons `--ov-*` et les attributs `data-ov-part`. Il ne charge **jamais** le style de votre site.
- **Ce que vous réglez chez le Planning reste chez lui** : fuseau, format de l'heure, jaquettes, streams annulés, premier jour de la semaine… sont ceux de la page du planning. Ses réglages de place et de taille propres à une page ne comptent pas dans une page d'overlay.
- **Aucun lien, aucun bouton** (rien ne se clique dans OBS) et aucun secret : vos streams sont déjà publics. Mode test : des streams d'exemple.
- **Rien de prévu, rien à l'écran** (depuis la 2.7.5) : sans aucun stream dans la période, ou, pour « Prochain stream », sans stream à venir, le cadre reste vide et transparent (pas de carte « aucun stream », pas de fond ni de bordure). Le mode test montre toujours un exemple.
- **Plusieurs pages d'overlay peuvent montrer le même élément** : une seule lecture de votre agenda (et des jaquettes) sert tout le monde pendant 45 secondes. Aucune tâche de fond : la page s'interroge elle-même, de plus en plus lentement quand rien ne change (au plus 300 fois).
- Développeurs : routes `element/week` et `element/next` (`?frag=1` rend seulement le contenu et son empreinte), fichier `overlay.mjs`, test `tests/planning-overlay.test.mjs`.

## Apparences au choix (réglage « Apparence du planning »)

Le même agenda, présenté de six manières (plus l'affichage d'origine, **choix par défaut** : rien ne change tant que vous ne choisissez pas). L'admin de l'instance montre, sous l'état des streams, un **aperçu réel** de chaque choix avec des streams d'exemple.

| Apparence | Ce que ça donne | Inspiration |
|---|---|---|
| **Liste simple** (défaut) | Le rendu d'origine : un titre par jour, puis les streams. | — |
| **Liste classique** | Agenda sobre : un jour par rangée, heure à gauche, jaquette, titre et jeux. | Apple Calendrier, Dieter Rams |
| **Liste en alternance** | L'en-tête de jour passe de gauche à droite d'un jour à l'autre, en cases arrondies ; jusqu'à 3 jaquettes ; dans chaque case, le contenu occupe toute la largeur (l'heure et l'état « Demain » aux deux bouts de la ligne, titre en grand, jeu et partenaires sur une ligne, jour vide au centre) sans changer la taille des cases ; semaine vide = un seul message ; en colonne sur mobile. | L'ancien site de la personne qui a créé ce module |
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
- **Rien de prévu** (ou aucun agenda installé) : une carte « Pas de stream planifié pour l'instant » avec le lien vers le planning complet. Jamais d'erreur affichée au public.
- **Stream sans jeu** (soirée caritative, discussion…) : pas de jeu indiqué, donc ni nom de jeu ni recherche de jaquette ; à la place de la jaquette, un visuel aux mêmes proportions : le **logo du site** (variante « fond sombre » si elle existe, sinon le logo principal sur un disque blanc) sur le **mauve Twitch** `#9146FF` (seule couleur fixe du module, c'est la couleur de marque de Twitch) ; sans logo, l'initiale du nom du site. Le même visuel sert dans la liste et, pour un jour qui mêle streams avec et sans jeu, sur la page publique. L'image PNG à partager ne l'utilise pas encore (elle n'affiche rien pour un stream sans jaquette).
- Les couleurs viennent des variables de thème du site (`--v-surface`, `--v-line`, `--v-fg`, `--v-muted`, `--v-accent`, `--v-gradient`…) : la carte suit toutes les palettes, claires ou sombres, avec ou sans couleur secondaire. La mise en page suit la largeur de la case, pas celle de l'écran.

## Où écrire ses streams ?

Dans le module qui les fournit, pas ici :

- **Agenda en ligne** : un guide « Comment remplir mon agenda Google ? » (où écrire le titre, les heures, le jeu, les répétitions) et un fichier à donner à votre assistant IA sont dans la page de ce module.
- **Streams saisis à la main** : un petit formulaire dans la page de ce module.

Sans aucun agenda installé, l'administration du planning le dit et vous indique quoi ajouter (*Extensions → Ajouter*).

## Si vous aviez déjà le Planning (version 1.x)

Avant la version 2.0.0, le Planning gardait lui-même l'adresse de votre Google Agenda. **En vous mettant à jour, il reprend tout seul cette adresse (et son fuseau horaire) dans un module « Agenda en ligne », qu'il installe pour vous si besoin, puis efface la valeur qu'il gardait.** Votre page `/planning`, vos blocs d'accueil, l'image à partager et les réponses du bot Twitch montrent exactement les mêmes streams, et vous n'avez rien à faire. Si l'installation du nouveau module échouait (site sans accès au Catalogue, par exemple), la mise à jour du Planning est mise de côté avec un bouton « Réessayer » : rien n'est perdu, et l'adresse reste en place (jamais affichée) jusqu'à ce que ça réussisse.

Plus aucun champ d'adresse dans les réglages : la valeur reprise n'est jamais affichée. Cette reprise automatique est **temporaire : à retirer en 0.3.0**.

## Jaquettes des jeux (RAWG)

Pour chaque jeu d'un stream, le module demande sa jaquette à RAWG **par le service du cœur** et l'affiche sur la page publique, dans les morceaux d'accueil « prochain stream » et « prochains streams », dans l'admin et sur l'image à partager. La clé RAWG (gratuite, [rawg.io/apidocs](https://rawg.io/apidocs)) se saisit **une seule fois, dans Admin → Réglages**, pour tous les modules : le planning n'a pas de réglage de clé, et ne la voit jamais. Il faut une version de Curiosa qui offre ce service (permission `rawg`) ; sinon, ou sans clé, ou si RAWG refuse la clé ou ne répond pas, seul le nom du jeu s'affiche, et l'admin du module dit clairement lequel de ces cas c'est. Le cache et la cadence des demandes sont ceux du cœur.

## Avec qui vous streamez (version 2.6.0)

Quand un stream est en compagnie d'autres personnes, écrivez leurs **pseudos Twitch** dans le stream, comme vous précisez le jeu :

- **Streams saisis à la main** : le champ « Avec ces pseudos Twitch », sous « Plus d'options » (par exemple `etoile_nord, lune_douce`).
- **Agenda en ligne** : une ligne `Avec : etoile_nord, lune_douce` dans la description de l'événement Google (voir le README d'« Agenda en ligne »).

Le planning montre alors « Avec Camille » **si ce pseudo est le compte Twitch d'une fiche de votre module Contacts** : c'est le **nom de la fiche** qui s'affiche, avec un lien vers la chaîne Twitch, sur la page, dans les morceaux d'accueil, dans les éléments d'overlay (le nom seul, rien à cliquer) et sur l'image de la semaine (en texte).

- **Vie privée.** Seuls le nom de la fiche, le lien Twitch et (depuis la version 2.7.0) la photo publique du compte sortent de Contacts : jamais l'e-mail, le téléphone ni les notes. Un pseudo absent de Contacts n'est **pas affiché** (il reste dans le stream). Une fiche encore « à vérifier », une fiche de la catégorie « Ne pas montrer » (ou celle choisie dans le réglage avancé du même nom, comme au Mur des remerciements) ne sont jamais montrées, ni leur nom ni leur photo. Si Contacts ne peut pas dire qui est caché, rien de nouveau n'est montré. Aucune demande n'est faite à Twitch pour les noms.
- **Sans Contacts**, le planning marche comme avant : aucun nom n'est montré, et l'administration le dit (« Les noms apparaissent sur le planning quand Contacts est installé »).
- **Dans l'administration**, « Avec qui vous streamez » dit pour chaque pseudo ce qui sera fait : affiché sous tel nom, dans vos contacts mais non affiché, ou « pas dans vos contacts » avec un lien **Ajouter** vers Contacts (choisissez « Ajouter via » Twitch et collez le pseudo).
- **Le même stream dans deux endroits** (saisi à la main et dans Google Agenda) n'en fait qu'un : ses partenaires sont réunis, sans doublon, 5 au plus.
- **Bornes** : 5 personnes par stream ; pseudo en minuscules (4 à 25 lettres, chiffres ou `_`), `@pseudo` et `twitch.tv/pseudo` acceptés. Les réponses de Contacts restent 2 minutes en mémoire (30 minutes au plus si Contacts ne répond plus), jamais sur disque.

## La photo des partenaires (version 2.7.0)

Devant le nom d'un partenaire (page, morceaux d'accueil), un petit rond avec **sa photo**, ou ses initiales s'il n'en a pas ou si elle ne charge pas. Le nom reste écrit à côté : le rond est décoratif (texte alternatif vide, caché des lecteurs d'écran) et le lien entier (rond + nom) fait au moins 44 px de haut.

- **Le public ne contacte jamais Twitch.** C'est **le site** qui télécharge la photo publique du compte (la photo que Contacts connaît déjà), une seule fois, la garde dans son propre stockage (donc dans la sauvegarde) et la sert à votre public depuis **sa propre adresse** (`/m/<clé>/photo/<repère>`). Aucun cookie, aucun réglage libre : l'adresse ne contient qu'un repère de 16 caractères (une empreinte du pseudo), jamais l'adresse de la photo.
- **Seulement pour une fiche affichable.** La copie n'est lancée que pour une personne que le planning montre déjà. Elle est **effacée** dès que la fiche est effacée, masquée (« Ne pas montrer »), « à vérifier », ou que Contacts disparaît ; la route vérifie la fiche à chaque demande et répond « introuvable » sinon (un navigateur peut garder l'image 5 minutes au plus).
- **Planning 2.7.3, copy rules (replaces the 2.7.0 "6 hours" rule).** All the partners of the page that still need a copy are attempted together, in one batch of 5 at a time at most; the page waits for the batch at most 1.5 s and shows initials for whatever is not finished, which then appears on the next render (no new question to Contacts). A failed copy is retried after 1 minute, then 5 minutes, then 30 minutes, then every 6 hours; a copy that worked is never dropped before it is a week old, and an older copy keeps being shown if its refresh fails. The photo is the one Contacts shows for the card; when it cannot be copied (another network, address outside the list), the avatar of the Twitch account that carries this very pseudo is used.
- **Admin: who has a photo.** In "Who you stream with", each shown partner says "Photo copied", "Photo pending (next try in 3 min)" or "Photo failed: <plain reason> (next try in ...)"; a single "Retry photos" button (visible only when a photo is missing) clears the failure marks and copies again right now.
- **Limits**: avatar hosts of Twitch, YouTube and Bluesky only (the same list as "Story"), https, no redirect, 256 KB per image at most, type read from the first bytes (never SVG), 30 photos at most (the oldest makes room, but a copy shown on the page being rendered goes last), 5 downloads at once, refreshed at most once a week, forgotten after 30 days without refresh. No background task: everything starts when the schedule is displayed.
- **Photo envoyée à la main dans Contacts** (sur votre site, `/uploads/…`) : montrée telle quelle, sans copie. Une photo choisie à la main sur un autre serveur n'est pas copiée (initiales), sauf si c'est un avatar permis ci-dessous ; un sous-dossier de `/uploads/` et le fragment de recadrage (`#…`) sont acceptés.
- **Pas montrée** dans les éléments d'overlay (le nom seul, pour OBS), l'aperçu de l'administration et l'image PNG de la semaine : cette image est gardée longtemps par Twitch et les réseaux, elle figerait la photo d'une personne ensuite masquée.
- **Réglage avancé « Afficher la photo des partenaires »** (oui par défaut, onglet Apparence) : coupé, plus aucun rond, plus aucune copie, celles qui existent sont effacées.
- Nouvelle permission : **`storage`** (la copie vit dans la collection `partnerPhotos`, une ligne par pseudo). Développeurs : `photos.mjs` (règles, copie, route), `avatar.mjs` (le rond, pur), route `photo/:slug`, test `tests/planning-photos.test.mjs`.

## Ajouter les jeux joués à votre liste (version 2.7.0)

Réglage **« Ajouter les jeux joués à la liste « Déjà joué » »** (coupé par défaut). Quand il est oui et que le module **Suggestions de jeux** (1.9.0 ou plus) est installé, le jeu d'un stream **commencé** (en cours ou passé) est ajouté à sa liste « Déjà joué », **une seule fois** :

- **Jamais un jeu seulement prévu** : un stream à venir, annulé ou en journée entière n'ajoute rien.
- **Sans doublon** : le jeu est comparé sans tenir compte des accents, des majuscules ni de la ponctuation. S'il est déjà dans la liste (proposé, planifié, rejeté…), **rien n'est modifié**. Les jeux ajoutés n'ont pas de pseudo ; leur jaquette est cherchée plus tard par le rattrapage de Suggestions de jeux.
- **Sans minuteur** : le passage part quand le planning lit vos streams (page, accueil, administration), au plus **une fois toutes les 10 minutes**, sur les 7 derniers jours, 20 jeux au plus. Si personne ne visite le site pendant plus de 7 jours, les jeux de cette période ne sont pas ajoutés (ajoutez-les à la main dans Suggestions de jeux).
- Sans Suggestions de jeux, ou s'il ne répond pas, il ne se passe rien ; l'administration du planning le dit (« Jeux joués »), avec un lien pour l'installer.
- Développeurs : service `game.played` (version 1, méthode `add({ title, via? })` → `{ ok: true, added, status }`), besoin **facultatif** du Planning ; fichier `played.mjs`, test `tests/planning-played.test.mjs`.

## Image à partager (PNG)

`https://votre-site/m/<clé>/image` : la semaine en cours (lundi → dimanche) en image PNG de 900 px de large aux couleurs du site, prête pour un panneau Twitch (« image + lien depuis une URL ») ou un réseau social. Une ligne par jour, deux streams au plus par jour, avec la jaquette des jeux (trois au plus par stream) à côté de l'heure et du titre. `?week=1` pour la semaine suivante (jusqu'à 8). Générée par le service du cœur `ctx.api.png` (aucune dépendance native dans le module), mise en cache 5 minutes ; pour la télécharger : ouvrez l'adresse dans le navigateur et enregistrez l'image.

Différence avec l'ancien site : pas de page d'admin dédiée avec bouton « Enregistrer l'image » ni de choix de semaine en un clic — l'adresse `?week=N` en tient lieu, et la route est publique (comme l'ancienne adresse destinée à l'extension Twitch).

## Pour qui développe

Le Planning est un **lecteur** : il *consomme* le sujet `planning.slot` (voir le contrat dans le README de « Agenda en ligne »), validé par le cœur, et ne connaît aucun module qui le fournit. Chaque créneau arrive avec son état (`status`), ses `partners` (pseudos Twitch, 5 au plus, facultatif : le Planning les nettoie de nouveau et ne fait confiance à aucun fournisseur), ses jeux (`games`) et le fuseau de son agenda (`timezone`) ; une journée entière porte sa date (`day`). Le Planning écarte les doublons (même titre, mêmes heures) et affiche dans son fuseau d'affichage (réglage, sinon fuseau le plus courant des agendas, sinon UTC). Il ne lit plus de description : les jeux viennent de l'agenda.

**Architecture** (`modules/planning/`) : `index.mjs` (jaquettes, pages, morceaux d'accueil, module), `slots.mjs` (mise au format des créneaux reçus, fonctions pures), `partners.mjs` (pseudos, recherche dans le service `contact.book` — besoin facultatif —, règles de visibilité), `dates.mjs`, `relative.mjs`, puis `appearances/` : `options.mjs` (réglages et défauts), `model.mjs` (regroupement par jour/semaine, en cours, annulé, fuseau), `kit.mjs` (outils et style de base), `layouts/*.mjs` (une apparence = `render(model, options, ctx) → { html, css }`, pure), `registry.mjs`, `preview.mjs`, `entry.mjs` (seul point d'appel d'`index.mjs`). Les fichiers voisins sont chargés avec le même `?v=` que `index.mjs` pour qu'une mise à jour à chaud ne mélange pas d'anciens fichiers.

Migration 1 → 2 (`dataVersion` 2, **temporaire, à retirer en 0.3.0**) : `seeds` désigne `calendar-ical` ; `migrations[2]` demande au cœur (`ctx.seedInstance`, une seule fois par adresse grâce à `seedKey`) une instance d'« Agenda en ligne » avec `{ url, timezone }` (fuseau choisi, sinon `UTC`, comme le lisait l'ancien Planning), puis efface `icsUrl` par `ctx.legacy.clear` (`icsUrl` est dans `legacySettings` : jamais affiché, lu par `ctx.legacy.get`). `dataVersion` 3 : `migrations[3]` rejoue la même reprise (idempotente) pour un site déjà en version 2 qui aurait gardé une adresse. Le lien avec la cible est un sujet (`consumes` / `provides`) et non une dépendance (`requires`) : cela demande Curiosa 0.2.0 (`ctx.legacy`).

## Visuels de la fiche

Depuis la version 2.5.1, la fiche du module montre des captures de ce qu'il ajoute à votre site (données inventées, aucune donnée réelle).

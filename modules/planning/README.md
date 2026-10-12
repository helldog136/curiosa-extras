# Planning des streams — module communautaire de Curiosa

Vos prochains streams, jour par jour, lus depuis un **Google Agenda** (ou n'importe quel flux iCal). Porté du planning
d'un site existant.

- **Page publique** `/planning` : les *N* prochains jours (7 par défaut, réglage avancé), heure du fuseau choisi.
- **Section d'accueil** « Prochains streams » (à placer depuis *Page d'accueil*).
- **Sujet `planning.slot`** : d'autres modules (overlay, bot…) peuvent lire les prochains créneaux.
- **MCP** : `planning_upcoming` (lecture seule, accordée par défaut).
- **Admin** : état du calendrier, prochains créneaux, bouton « Actualiser maintenant ».

## Apparences au choix (réglage « Apparence du planning »)

Le même agenda, présenté de six manières (plus l'affichage d'origine, **choix par défaut** : rien ne change tant que vous ne choisissez pas). L'admin de l'instance montre, sous l'état du calendrier, un **aperçu réel** de chaque choix avec des streams d'exemple.

| Apparence | Ce que ça donne | Inspiration |
|---|---|---|
| **Liste simple** (défaut) | Le rendu d'origine : un titre par jour, puis les streams. | — |
| **Liste classique** | Agenda sobre : un jour par rangée, heure à gauche, jaquette, titre et jeux. | Apple Calendrier, Dieter Rams |
| **Liste en alternance** | L'en-tête de jour passe de gauche à droite d'un jour à l'autre, en cases arrondies ; jusqu'à 3 jaquettes ; semaine vide = un seul message ; en colonne sur mobile. | L'ancien site Helldog136 |
| **Semaine en grille** | 7 colonnes (premier jour de la semaine au choix), créneaux empilés ; liste verticale sur mobile. | Vue semaine d'un agenda |
| **Timeline** | Rail vertical, points datés, vignettes, aéré ; les jours vides se résument en une ligne. | Linear, Stripe |
| **Affiches** | Cartes verticales : jaquette pleine hauteur, dégradé, date en pastille, titre dessus ; sans jeu, logo du site sur mauve Twitch. | Apple TV, Netflix, Spotify |
| **À la une + à suivre** | Le prochain stream en grand (« Dans 3 h » ou « En cours », bouton vers la chaîne), puis la suite en liste compacte. | Apple TV « À suivre » |

Captures décrites : toutes les apparences ont été vérifiées dans le vrai site (page `/planning` et accueil, 390 px et 1280 px, palette claire avec accent secondaire et palette sombre).

**Options communes** : densité (confortable/compacte), jaquettes, indications relatives (« Dans 3 h »), format de l'heure (24 h/12 h), premier jour de la semaine, rappel du fuseau, style des en-têtes de jour (texte/pastille/court), heure de fin, afficher les streams annulés (barrés, avec « Annulé »). Le nombre de jours reste le réglage « Jours affichés » (7, 14, 30…). **Options propres** : liste classique (masquer les jours vides), alternance (côté du premier jour), semaine (semaines du calendrier ou 7 jours glissants), timeline (montrer les jours vides), à la une (nombre de « à suivre »).

**Où ça s'applique** : page publique et section « Prochains streams » (celle-ci peut avoir sa propre apparence, option « Apparence » du morceau ; « Comme la page » par défaut). La carte « Prochain stream » garde son rendu et suit la densité. L'image PNG du panneau Twitch (`/m/<clé>/image`) garde son gabarit.

**Architecture** (`modules/planning/`) : `index.mjs` (lecteur iCal, jaquettes, module), `dates.mjs`, `games.mjs`, `relative.mjs`, puis `appearances/` : `options.mjs` (réglages et défauts), `model.mjs` (regroupement par jour/semaine, en cours, annulé, fuseau), `kit.mjs` (outils et style de base), `layouts/*.mjs` (une apparence = `render(model, options, ctx) → { html, css }`, pure), `registry.mjs`, `preview.mjs`, `entry.mjs` (seul point d'appel d'`index.mjs`). Les fichiers voisins sont chargés avec le même `?v=` que `index.mjs` pour qu'une mise à jour à chaud ne mélange pas d'anciens fichiers.

## Les morceaux d'accueil

- **« Prochain stream »** : une carte encadrée (bordure, arrondi, relief, filet aux couleurs du thème) : à gauche la **jaquette** du jeu (jusqu'à 3, superposées), puis une pastille d'état (« En cours », « Dans 40 min », « Dans 3 h », « Aujourd'hui », « Demain », « Dans 4 jours »), le **titre**, l'**heure** en grand et le jour, le jeu, les autres streams du même jour et un bouton « Regarder sur Twitch ». Son lien est celui de la Chaîne Twitch si elle est installée (un seul endroit pour saisir votre chaîne) ; sinon, c'est « Lien de votre chaîne » dans les réglages du planning. Les balises `<time>` sont sémantiques, les jaquettes ont un texte alternatif, aucune animation sans `prefers-reduced-motion`.
- **« Prochains streams »** : une liste dans une carte, une ligne par stream (tuile de jour, vignette, titre, heure, jeu, pastille d'état) et un lien « Voir le planning complet » (si l'instance a une page publique).
- **Rien de prévu** (agenda lisible mais vide) : une carte « Pas de stream planifié pour l'instant » avec le lien vers le planning complet. Agenda non réglé ou illisible : la section disparaît.
- **Stream sans jeu** (soirée caritative, discussion…) : pas de ligne « Jeu : » dans la description, donc ni nom de jeu ni appel à RAWG ; à la place de la jaquette, un visuel aux mêmes proportions : le **logo du site** (variante « fond sombre » si elle existe, sinon le logo principal sur un disque blanc) sur le **mauve Twitch** `#9146FF` (seule couleur fixe du module, c'est la couleur de marque de Twitch) ; sans logo, l'initiale du nom du site. Le même visuel sert dans la liste et, pour un jour qui mêle streams avec et sans jeu, sur la page publique. L'image PNG à partager ne l'utilise pas encore (elle n'affiche rien pour un stream sans jaquette).
- Les couleurs viennent des variables de thème du site (`--v-surface`, `--v-line`, `--v-fg`, `--v-muted`, `--v-accent`, `--v-gradient`…) : la carte suit toutes les palettes, claires ou sombres, avec ou sans couleur secondaire. La mise en page suit la largeur de la case, pas celle de l'écran.

## Aide à la saisie dans l'admin

Dans la page de l'instance, sous l'état du calendrier :

- **« Comment remplir mon agenda Google ? »** (bloc repliable) : où écrire le titre (titre de l'événement), le jeu (une ligne `Jeu : Nom` dans la description ; aucune ligne = pas de jeu), l'heure et la durée (début et fin), ce que deviennent le lieu (non lu), le reste de la description (ignoré), « toute la journée », les répétitions et les suppressions ; comment obtenir l'adresse secrète iCal ; deux exemples remplis ; les erreurs fréquentes (fuseau, jeu dans le titre, événement à la journée, délai de Google).
- **« Télécharger le skill pour mon IA »** : un fichier `SKILL.md` (en-tête `name:` / `description:`) généré à partir du fuseau et du nom du site de l'instance : rôle, règles de remplissage exactes, modèle, exemples (stream de jeu, événement caritatif sans jeu, stream récurrent), liste de contrôle, interdits, questions à poser à l'humain. Servi par la route `/m/<clé>/skill` (publique, GET/HEAD seulement) : il ne contient jamais l'adresse du calendrier ni aucune clé.

## Configurer

Dans Google Agenda : *Paramètres → votre agenda → « Adresse secrète au format iCal »*, à coller dans le réglage de l'instance
(elle n'est plus jamais réaffichée). **Utilisez un agenda dédié** : tout ce qu'il contient devient public.

Pour afficher le jeu d'un créneau, écrivez dans la **description** de l'événement une ligne `Jeu : Nom du jeu` (plusieurs jeux :
séparés par une virgule ou « + », trois maximum). Rien n'est deviné depuis le titre. Le **lieu** de l'événement n'est pas lu.

## Sécurité

L'adresse doit être en `https://` et publique : localhost, réseaux privés et adresses de lien local sont refusés (le serveur
télécharge l'adresse : pas de requête vers le réseau interne). Téléchargement limité à 8 s et 5 Mo, mis en cache 5 minutes.

## Jaquettes des jeux (RAWG)

Pour chaque jeu écrit dans la description d'un événement, le module demande sa jaquette à RAWG **par le service du cœur** et l'affiche sur la page publique, dans les morceaux d'accueil « prochain stream » et « prochains streams », dans l'admin et sur l'image à partager. La clé d'API RAWG (gratuite, [rawg.io/apidocs](https://rawg.io/apidocs)) se saisit **une seule fois, dans Admin → Réglages**, pour tous les modules : le planning n'a pas de réglage de clé, et ne la voit jamais. Il faut une version de Curiosa qui offre ce service (permission `rawg`) ; sinon, ou sans clé, ou si RAWG refuse la clé ou ne répond pas, seul le nom du jeu s'affiche, et l'admin du module dit clairement lequel de ces cas c'est. Le cache et la cadence des demandes sont ceux du cœur.

## Image à partager (PNG)

`https://votre-site/m/<clé>/image` : la semaine en cours (lundi → dimanche) en image PNG de 900 px de large aux couleurs du site, prête pour un panneau Twitch (« image + lien depuis une URL ») ou un réseau social. Une ligne par jour, deux streams au plus par jour, avec la jaquette des jeux (trois au plus par stream) à côté de l'heure et du titre. `?week=1` pour la semaine suivante (jusqu'à 8). Générée par le service du cœur `ctx.api.png` (aucune dépendance native dans le module), mise en cache 5 minutes ; pour la télécharger : ouvrez l'adresse dans le navigateur et enregistrez l'image.

Différence avec l'ancien site : pas de page d'admin dédiée avec bouton « Enregistrer l'image » ni de choix de semaine en un clic — l'adresse `?week=N` en tient lieu, et la route est publique (comme l'ancienne adresse destinée à l'extension Twitch).

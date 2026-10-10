# Planning des streams — module communautaire de Curiosa

Vos prochains streams, jour par jour, lus depuis un **Google Agenda** (ou n'importe quel flux iCal). Porté du planning
d'un site existant.

- **Page publique** `/planning` : les *N* prochains jours (7 par défaut, réglage avancé), heure du fuseau choisi.
- **Section d'accueil** « Prochains streams » (à placer depuis *Page d'accueil*).
- **Sujet `planning.slot`** : d'autres modules (overlay, bot…) peuvent lire les prochains créneaux.
- **MCP** : `planning_upcoming` (lecture seule, accordée par défaut).
- **Admin** : état du calendrier, prochains créneaux, bouton « Actualiser maintenant ».

## Les morceaux d'accueil

- **« Prochain stream »** : une carte encadrée (bordure, arrondi, relief, filet aux couleurs du thème) : à gauche la **jaquette** du jeu (jusqu'à 3, superposées), puis une pastille d'état (« En cours », « Dans 40 min », « Dans 3 h », « Aujourd'hui », « Demain », « Dans 4 jours »), le **titre**, l'**heure** en grand et le jour, le jeu, les autres streams du même jour et, si vous renseignez « Lien de votre chaîne », un bouton « Regarder sur Twitch ». Les balises `<time>` sont sémantiques, les jaquettes ont un texte alternatif, aucune animation sans `prefers-reduced-motion`.
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

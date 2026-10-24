# Vidéothèque

Une page de vidéos pour votre site (masterclass, rétrospectives, tutoriels, présentations…) **sans rien héberger** : les vidéos restent sur YouTube, votre site les range et les présente.

## À quoi ça sert

- Vos visiteurs voient une **grille de vidéos** (miniature, titre, durée, catégorie), filtrent par **catégorie**, **cherchent** un mot, et ouvrent la page d'une vidéo.
- Le **lecteur YouTube ne se charge qu'après un clic** sur « Lire ici ». Avant, le navigateur du visiteur ne contacte jamais YouTube : les miniatures sont des copies gardées par votre site. Le bouton « Regarder sur YouTube » est toujours là.
- Des **séries** (listes de lecture) : vous choisissez l'ordre, le visiteur a un bouton « Suivant » qui enchaîne les vidéos.
- Sous chaque vidéo : la description, la **transcription** (dans un bloc repliable), un lien vers l'**album photo** de l'événement (si vous avez un module de galeries), et des **liens de partage**.
- Les moteurs de recherche reçoivent les informations d'une vidéo (titre, durée, date).

## Ce que vous faites

1. Ouvrez l'extension, onglet **Mes vidéos**. Au premier passage, c'est une page d'accueil avec un seul champ.
2. **Collez l'adresse** d'une vidéo YouTube (n'importe quelle forme : `youtube.com/watch?v=…`, `youtu.be/…`, `shorts`, `embed`, avec ou sans les morceaux de suivi). Le **titre** et la **miniature** se remplissent tout seuls. Si YouTube ne répond pas, le formulaire vous demande d'écrire le titre.
3. La vidéo arrive **en brouillon** : relisez, mettez une catégorie, une durée, une description, une transcription, puis passez son état à **Publiée**.
4. Pour en ajouter beaucoup : **« Ajouter plusieurs adresses d'un coup »** (100 au plus). Vous voyez un **aperçu** (nouvelle, déjà présente, adresse non reconnue) avant que rien ne soit ajouté.
5. Onglet **Catégories, séries** : un **modèle de départ** en un clic (« Masterclass, Rétrospectives, Tutoriels » ou « Vide »), vos propres catégories, et vos séries. L'ordre se change avec les boutons ↑ et ↓.

Le **vocabulaire** se règle : « Vidéos », « Replays », « Formations »… (pluriel et singulier), le nom des séries, le mot « Gratuit ».

## Réglages

Nom de la page et des séries, texte au-dessus de la liste, miniatures (copie gardée par le site, ou fond sobre sans aucune image), liens de partage, et en mode avancé le nombre de vidéos par page et l'aide aux moteurs de recherche. Tout marche sans rien régler.

## Limites

5 000 vidéos par vidéothèque, 12 par page (50 au plus), 100 vidéos par série, 100 adresses collées d'un coup, 40 catégories, 200 séries, 20 000 caractères de transcription.

## Ce qu'il ne fait pas

- Pas d'hébergement de vidéos : seul YouTube les diffuse.
- Pas d'autre plateforme que YouTube pour l'instant (le code est prêt à en recevoir une : voir `docs/ideas/videos.md`).
- Pas de traduction automatique : un titre et une description sont écrits dans une seule langue ; les catégories et les séries ont un nom par langue.
- Pas de commentaires, de likes, de statistiques de visionnage.
- La transcription n'est pas prise en compte par la recherche (seuls le titre et la description le sont).

## Vie privée

Aucun cookie. Rien n'est gardé sur vos visiteurs. Le navigateur d'un visiteur ne contacte YouTube (via le lecteur « youtube-nocookie.com ») qu'**après son clic** sur « Lire ici ». Seul le serveur de votre site interroge YouTube, quand vous ajoutez une vidéo, pour lire son titre et sa miniature.

## Pour votre assistant IA

Il peut **lister** les vidéos et les catégories, **ajouter une vidéo à partir de son adresse** (toujours en brouillon) et **modifier** un brouillon. Il ne publie jamais. Ces écritures ne lui sont pas accordées d'office.

## Avec d'autres modules

- **Galerie** (facultatif) : relier un album de photos à une vidéo (la rétrospective d'un événement).
- **Autres modules** : la vidéothèque offre la liste de ses vidéos publiées (service `videos.library`, lecture seule) : un module d'événements peut y lier une masterclass.

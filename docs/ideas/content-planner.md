# Cahier de contenu (`content-planner`) : ce qui a été construit

## Le problème
Les idées de vidéos, d'articles et de posts sont éparpillées (notes du téléphone, messages à soi-même). On oublie, on republie trop tard. Il faut un endroit unique, simple, privé, utilisable d'une main sur un téléphone.

## Pour qui
Emma et toute personne qui crée du contenu seule ou en petite équipe. Rien n'est destiné aux visiteurs.

## Ce que voit le visiteur
**Rien, jamais.** Aucune page, aucune route publique, aucune section d'accueil, aucun emplacement, aucun sujet partagé, aucun flux. Le module est de type « utilitaire », une seule instance, sans `page`.

## Ce que fait Emma, pas à pas
1. Elle ouvre *Mon cahier* (onglet « Utiliser » renommé). Tout en haut : le champ « Le titre de votre idée » et un gros bouton pleine largeur « J'ai une idée ! » (56 px de haut sur téléphone).
2. Elle écrit quelques mots : c'est noté dans « Idées », avec les étapes du modèle. Un titre vide ou trop long donne une erreur sous le champ avec un exemple.
3. Quatre endroits (« Idées », « En préparation », « Publié », « Archivées »), chacun avec son nombre. Chaque idée est une carte entière cliquable : titre, phrase, pastilles (étapes 2/4, date visée, réseaux), barre d'avancement.
4. Dans une idée : un menu à quatre lignes « Où en est cette idée ? » (bouton « Ranger ici »), les étapes en cases à cocher, « Quand et où ? » (date visée, réseaux à cocher + autres réseaux libres, « Publiée le » pour une idée publiée) et « L'idée » (titre, phrase, notes, liste d'étapes une par ligne).
5. Rythme facultatif (réglages) : « 1 par semaine » ; message doux calculé à la lecture.
6. Recherche (dès 8 idées) : mots, sans accents ni majuscules, dans titres, phrases, notes, réseaux, étapes ; résultats tous endroits confondus.
7. Archiver = la ranger dans « Archivées » (rien n'est perdu). Supprimer pour toujours n'est proposé que pour une idée archivée, avec une confirmation qui explique ce qui sera effacé.
8. « Garder une copie » : téléchargement CSV.

## Réglages et valeurs par défaut
Tout marche sans réglage.
- *Étapes de chaque nouvelle idée* : vide = Script, Miniature, Description, Publication (dans la langue de l'admin). Une étape par ligne, 12 au plus. Ne change pas les idées existantes.
- *Mon rythme de publication* (groupe facultatif, absent par défaut) : nombre (1 à 5, ou 7) par semaine, quinzaine ou mois.
- *Réseaux proposés* (avancé) : « YouTube, Twitch, Instagram, TikTok, Blog, Newsletter, Podcast, Bluesky ». Ce sont des mots : le module ne dépend d'aucun module de réseau.

## Le rythme et l'avertissement doux
Calculé quand on ouvre le cahier (aucun minuteur) sur les jours (UTC). Intervalle = durée / nombre (7 j pour « 1 par semaine »).
- rien publié encore : « dès que vous rangerez une idée dans Publié… » ;
- dernière publication dans l'intervalle : « vous êtes dans votre rythme » ;
- au-delà : « date de N jours. Ce n'est pas grave, cela arrive à tout le monde » + idée déjà en préparation, sinon « choisissez une idée », sinon « notez-en une » ;
- 30 jours et plus : « pause, tout à fait normal, reprenez à votre vitesse » + rappel qu'on peut changer le rythme.
Aucun mot de reproche. Les dates visées passées (idée ni publiée ni archivée) donnent une phrase « aucune urgence » et une pastille ambrée. Une idée archivée mais publiée compte toujours dans le rythme.

## Données gardées et vie privée
Collection `ideas` du stockage de l'instance, un document par idée : titre (120), phrase (300), endroit, archivée oui/non, étapes (12 × 60), date visée, date de publication, réseaux (12 × 30), notes (4 000), qui l'a notée (propriétaire ou assistant), dates de création et de modification. Aucune donnée de visiteur, aucun cookie, aucune adresse IP, rien n'est envoyé hors du site (aucun appel réseau, e-mail ni service). Retirer le module avec « tout effacer » supprime les idées. Rien n'est publié dans les flux ou la déclaration de confidentialité (le module ne collecte rien).

## Bornes et limites
1 000 idées au plus (archivées comprises) : au-delà, message sous le champ. Lecture par pages de 500 ; l'écran affiche 50 cartes par page (`?page=N`, valeurs invalides ramenées à la page 1 ou à la dernière). Tri : dates visées les plus proches, puis les plus récentes ; publié : le plus récent ; recherche : 6 mots au plus, 100 caractères. Sauvegarde lisible bornée à 4,5 Mo par fichier. Dates en UTC (un décalage possible d'un jour en soirée). Pas de glisser-déposer (le panneau d'un module est fait de blocs du cœur qui n'en offrent pas) : le déplacement se fait par un menu de boutons, accessible au clavier.

## Droits
Ouvrir le module : droit implicite du cœur. Les actions du panneau sont réservées aux administrateurs (voir plus bas). Le téléchargement CSV a son droit `ideas.export` (administrateurs d'office, délégable).

## Outils pour l'assistant IA
Six outils, nommés `<instance>__<action>` : `ideas_list` (lecture, par endroit, recherche, 50 au plus, curseur opaque), `idea_get` (lecture, notes comprises), `idea_add` (titre obligatoire ; phrase, endroit idée/en préparation, date, réseaux, étapes, notes), `idea_update`, `idea_move` (idée, en préparation, publié, archivée ; « publié » note la date du jour), `idea_step` (cocher/décocher par nom ou numéro). Lectures accordées d'office ; **écritures jamais accordées d'office**. Aucun outil ne supprime. Les erreurs sont lisibles par l'assistant (« No idea with this id », liste des étapes…). L'assistant ne lit aucune donnée d'un autre module.

## Fichiers
`ideas.csv` en téléchargement (500 idées à la fois, BOM, séparateur selon la langue, cellules neutralisées contre les formules) ; sauvegarde lisible `ideas.csv` + `ideas.md` (cases à cocher Markdown).

## Intégration avec le planning
**Non faite.** `calendar-manual` ne fait que fournir le sujet `planning.slot` en lecture (aucun service ni sujet pour y créer un créneau) et `planning` ne fait que l'afficher. Il n'existe donc pas de moyen propre de transformer une date visée en créneau sans écrire dans les données d'un autre module. Voir les idées pour la suite.

## Ce qui n'est pas fait, et pourquoi
- Glisser-déposer : impossible avec les blocs du panneau (facultatif dans la demande).
- Rappels, notifications, e-mails : aucun minuteur de fond voulu.
- Actions du panneau pour un rôle personnalisé : la règle `def.matches` du kit de conformité du cœur 0.2.5 ne reconnaît pas la forme `{ right, run }` (elle exige une fonction) ; les actions sont donc réservées aux administrateurs.
- Import CSV : non demandé.

## Idées pour la suite
- Un service d'agenda côté `calendar-manual` (« créer un créneau ») pour proposer « Mettre dans mon planning » depuis la date visée ; en attendant, un fichier `.ics` d'une idée.
- Faire reconnaître `{ right, run }` par le kit, puis des droits `ideas.edit` / `ideas.delete` pour un rôle « assistant·e ».
- Déplacer par glisser-déposer quand le cœur offrira un bloc de tableau triable.
- Fuseau du site pour calculer « aujourd'hui ».
- Rubrique « Mon contenu » dans le menu (aujourd'hui rangé avec la communauté, faute de `content` dans le manifeste).

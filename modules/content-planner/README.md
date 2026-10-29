# Cahier de contenu

Votre cahier **privé** pour vos idées de vidéos, d'articles et de posts. Il remplace les notes éparpillées dans le téléphone et les messages à soi-même : tout est au même endroit, et **rien n'est jamais montré sur votre site** (le module n'a ni page, ni lien, ni bloc d'accueil).

## À quoi ça sert

Un cahier à quatre endroits : **Idées**, **En préparation**, **Publié** et **Archivées**. Une idée, c'est :

- un **titre** (c'est tout ce qu'il faut pour la noter) ;
- une **phrase** qui dit de quoi ça parle ;
- des **étapes à cocher** (par défaut : script, miniature, description, publication ; vous pouvez changer ce modèle dans les réglages, et les étapes de chaque idée une par une) ;
- une **date visée** (un repère, pas une obligation) ;
- les **réseaux** concernés (YouTube, Twitch, Instagram, TikTok, blog… à cocher, ou n'importe quel autre mot de votre choix) ;
- des **notes** libres.

## Comment l'utiliser

1. Ouvrez *Mon cahier* et touchez le gros bouton **« J'ai une idée ! »** : écrivez un titre, c'est noté. Le reste viendra après.
2. Touchez une idée pour l'ouvrir. Là, vous cochez les étapes, choisissez une date et des réseaux, écrivez vos notes.
3. Pour faire avancer une idée, choisissez son nouvel endroit dans le menu **« Où en est cette idée ? »** (Idées, En préparation, Publié, Archivées). Quand vous la rangez dans *Publié*, le cahier retient la date du jour.
4. Sur le téléphone comme sur l'ordinateur, tout se fait avec des boutons : il n'y a **jamais** de glisser-déposer obligatoire.
5. Dès huit idées, une **recherche** apparaît (les accents et les majuscules ne comptent pas). Les listes affichent 50 idées par page.

### Un rythme, si vous voulez

Dans l'onglet *Réglages*, « Ajouter un rythme » : par exemple « 1 par semaine ». Si la dernière publication date de plus longtemps, le cahier le dit **doucement**, sans reproche, en vous proposant l'idée déjà en préparation ou d'en choisir une. Après une longue pause, il vous dit que c'est normal. Les dates visées passées sont signalées de la même façon, avec une petite pastille. Tout est calculé quand vous ouvrez le cahier : rien ne tourne en arrière-plan, aucun rappel n'est envoyé.

### Archiver plutôt que supprimer

Une idée archivée sort des listes mais n'est pas perdue : on la ressort quand on veut. Seules les idées **archivées** peuvent être supprimées pour toujours, après une question qui explique ce qui sera effacé.

## Garder une copie

- **Télécharger mes idées (CSV)** : un fichier qui s'ouvre dans un tableur (points-virgules en français, virgules en anglais).
- La **sauvegarde du site** contient aussi votre cahier dans deux fichiers lisibles sans rien installer : un tableau et un texte.

## Avec l'assistant IA

Si vous avez branché un assistant IA, il peut **lister** vos idées, en **lire** une, **ajouter** une idée (« ajoute une idée : tutoriel sur… »), la **modifier**, la **déplacer** et **cocher une étape**. Lire est permis d'office ; écrire doit être accordé explicitement dans l'accès de l'assistant. Il ne peut rien supprimer, et il ne lit que ce cahier, jamais les données d'un autre module.

## Ce qu'il ne fait pas

- Il n'affiche rien sur le site et n'envoie aucun message ni rappel.
- Il ne se relie pas à vos modules de réseaux : les réseaux sont de simples mots.
- Il ne crée pas de créneau dans le planning (voir les idées pour la suite dans `docs/ideas/content-planner.md`).
- Il garde au plus **1 000 idées** (archivées comprises).

## Pour qui développe

Une seule instance, aucun service offert ni requis, trois permissions (`admin`, `storage`, `mcp`). Les idées sont des documents de la collection `ideas`. Les actions de l'administration sont réservées à l'administration ; seul le téléchargement a un droit propre (`ideas.export`). Outils MCP : `ideas_list`, `idea_get` (lecture), `idea_add`, `idea_update`, `idea_move`, `idea_step` (écriture, jamais accordée d'office). Voir `docs/ideas/content-planner.md`.

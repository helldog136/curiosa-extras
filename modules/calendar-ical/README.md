# Agenda en ligne — module communautaire de Curiosa

Lit votre **Google Agenda** (ou tout autre agenda en ligne au format iCal) et le met à la disposition de votre site. Vous écrivez vos streams dans votre agenda comme d'habitude, et ils apparaissent tout seuls : le **Planning des streams** les affiche, le **bot Twitch** s'en sert pour répondre à `!planning`. Rien à recopier.

Il faut Curiosa 0.1.22 ou plus.

## Pour commencer

1. Dans Google Agenda, **sur ordinateur** : roue dentée → *Paramètres* → cliquez sur le nom de votre agenda → descendez jusqu'à *Intégrer l'agenda* → copiez **« Adresse secrète au format iCal »**.
2. Collez-la dans le réglage **« Adresse de votre agenda »** de ce module, puis enregistrez.
3. Cliquez sur **« Tester l'adresse »** : le module dit combien de streams il voit, ou ce qui ne va pas (et quoi faire).

**Utilisez un agenda dédié à vos streams** : tout ce qu'il contient devient visible sur votre site. L'adresse est un secret (qui la possède peut lire votre agenda) : elle n'est jamais réaffichée une fois enregistrée, ni écrite dans un message d'erreur.

## Comment remplir son agenda

Une ligne d'agenda = un stream.

- **Titre** de l'événement = titre du stream.
- **Début et fin** de l'événement = heures du stream (le stream disparaît du planning une fois fini).
- **Le jeu** : dans la *description* de l'événement, une ligne `Jeu : Nom du jeu` (plusieurs jeux : séparés par une virgule ou « + », trois au plus). Pas de ligne `Jeu :` = pas de jeu (soirée caritative, discussion…). Rien n'est deviné depuis le titre.
- **Répétition** : utilisez celle de l'agenda (« chaque semaine… »). Supprimer un événement, ou une seule date d'une répétition, le retire du planning.

Un **guide complet** (avec des exemples et les erreurs fréquentes) est dans la page de ce module, dans l'administration : *« Comment remplir mon agenda Google ? »*. Vous y trouvez aussi un fichier **SKILL.md** à donner à votre assistant IA : il apprend à remplir votre agenda comme votre site l'attend. Il ne contient aucun secret.

## Plusieurs agendas

Ajoutez un module « Agenda en ligne » par agenda : leurs streams s'ajoutent sur le planning (un stream écrit dans deux agendas n'est montré qu'une fois).

## Réglages

- **Adresse de votre agenda** (secrète) : voir plus haut.
- **Fuseau horaire de l'agenda** (facultatif, réglages avancés) : utile seulement si les heures semblent décalées (exemple : `Europe/Paris`). Laissé vide, c'est le fuseau que l'agenda annonce lui-même.
- **Minutes entre deux lectures** (réglages avancés) : 5 par défaut. Google met de toute façon son agenda à jour avec un délai.

## Ce qu'il lit

Les événements simples et les **répétitions** (chaque jour, chaque semaine avec les jours choisis, chaque mois, chaque année ; fin par une date ou un nombre de fois), les dates **exclues**, les occurrences **déplacées ou annulées**, les **fuseaux horaires**, les événements « toute la journée » et les événements **annulés**. Ce n'est pas une lecture complète de la norme iCal (pas de « le 2e mardi du mois »).

## Si l'agenda ne répond plus

Le module garde la dernière copie reçue (moins de 24 heures) : le planning continue d'afficher vos streams. Il ne harcèle pas Google : après une erreur, il attend 30 secondes avant de réessayer. Aucune lecture ne dure plus de quelques secondes : un agenda qui ne répond pas ne ralentit jamais votre site.

## Si vous retirez ce module

*Retirer et garder mes données* met l'adresse de côté, et réinstaller le module la retrouve. *Retirer et tout effacer* l'oublie pour de bon. Dans les deux cas, plus aucune copie de votre agenda n'est gardée en mémoire. Vos streams, eux, restent dans votre agenda Google : rien n'y est modifié par ce module.

## Si vous aviez déjà le Planning des streams

Avant la version 2.0.0, le Planning gardait lui-même l'adresse de l'agenda. En se mettant à jour, il crée pour vous un module « Agenda en ligne » avec **la même adresse et le même fuseau**, puis efface son ancien réglage : le planning montre exactement les mêmes streams, sans que vous fassiez quoi que ce soit.

## Sécurité

Adresse en `https://` et publique seulement : les adresses internes (localhost, réseaux privés) sont refusées, y compris à chaque redirection (3 au plus). Lecture limitée à 5 secondes (redirections comprises) et 5 Mo.

## Pour qui développe

Ce module fournit le sujet **`planning.slot`** (le Planning et le bot Twitch le lisent ; aucun ne connaît ce module). Contrat d'un élément : `id`, `title`, `start` et `end` (instants ISO 8601 en UTC), `allDay`, `day` (pour une journée entière : la date `AAAA-MM-JJ` dans le fuseau de l'agenda ; `end` est alors le début du jour suivant), `games` (liste, de la ligne `Jeu :`), `text` (les jeux en une ligne), `status` (`confirmed` ou `cancelled` : les annulés sont fournis, c'est au lecteur de décider), `timezone` (fuseau retenu). Le lecteur reçoit une période `from` / `to` et ne reçoit jamais l'adresse. Fichiers : `fetch.mjs` (seul fichier qui parle au réseau : une borne de temps pour tout le téléchargement, `timing.totalMs`), `ical.mjs` (lecteur, fonctions pures), `games.mjs`, `tutorial.mjs`.

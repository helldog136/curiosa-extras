# Compte à rebours

Annoncez un **événement ponctuel** : la sortie d'un jeu, un lancement, un anniversaire, une convention. Votre public voit le temps qui reste, **l'heure chez lui** écrite en toutes lettres (« samedi à 21 h chez vous ») et peut ajouter l'événement à son agenda. Une fois l'heure passée, un message de votre choix prend la place des chiffres (« C'est parti ! », avec un bouton), puis l'événement disparaît tout seul.

Ce module ne remplace pas le module **Planning** : le Planning montre vos *streams* réguliers, celui-ci sert aux *rendez-vous uniques* qu'on attend.

## À quoi ça sert

- Tout le monde vit dans un fuseau horaire différent : « 20 h » n'a pas le même sens à Liège, à Montréal et à Tokyo. La personne qui visite lit directement l'heure chez lui.
- Un seul endroit pour plusieurs rendez-vous : une page, un morceau pour l'accueil et une source pour votre stream (OBS).
- Rien à surveiller : l'événement se masque tout seul quand vous l'avez décidé.

## Comment l'utiliser

1. Ouvrez le module (onglet **Mes événements**).
2. Remplissez **Nom, Jour, Heure** et choisissez le fuseau horaire si ce n'est pas le vôtre. Cliquez sur **Ajouter**. C'est tout : l'événement apparaît sur la page du module.
3. Pour aller plus loin, cliquez sur **Modifier** à côté de l'événement : message de fin et bouton, description, lieu, image, jour de fin, délai avant de disparaître.
4. **Mettre à la une** : l'événement passe en premier sur l'accueil et dans OBS. Sans choix de votre part, c'est le prochain événement qui est à la une.

### Sur la page d'accueil
Dans **Page d'accueil** (menu de gauche), ajoutez le morceau **Compte à rebours à la une** (un seul grand compteur) et/ou **Prochains événements** (une courte liste). Si vous n'avez aucun événement, ces morceaux restent invisibles.

### Dans OBS (stream)
Dans l'onglet **Mes événements**, copiez l'adresse OBS et collez-la dans une *source navigateur* (largeur 1920, hauteur 1080 conseillées). Le fond est transparent. Par défaut, l'événement à la une s'affiche ; pour un événement précis, ouvrez-le avec **Modifier** et copiez « l'adresse à coller dans OBS pour cet événement ». Le style (sombre, clair, sans fond), la place, la taille et la durée du message de fin se règlent dans l'onglet **Réglages**.

## Les heures et le changement d'heure

- Vous écrivez l'heure **là où l'événement a lieu** (par exemple 21 h à Paris). Le module garde « le jour, l'heure et le nom du fuseau », jamais un décalage fixe : le passage à l'heure d'été ou d'hiver est donc toujours juste, même si l'événement a lieu dans plusieurs mois.
- Si vous choisissez une heure qui **n'existe pas** (la nuit du passage à l'heure d'été, 2 h 30 saute à 3 h 30) ou qui existe **deux fois** (retour à l'heure d'hiver), le module vous le dit et choisit comme le font les agendas.
- Pour un fuseau qui n'est pas dans la liste, écrivez son nom officiel (Asia/Kolkata, America/Montreal…).
- Pour une **journée entière** (anniversaire, convention), cochez « Toute la journée » : pas d'heure, et la date ne bouge pas d'un pays à l'autre.

## Ce que voit une personne

- Les jours, heures, minutes (et secondes) qui avancent, exacts à la seconde : le compteur se recale sur l'heure de l'événement, il ne prend pas de retard, même si l'onglet reste longtemps en arrière-plan.
- L'heure chez lui, et la date dans le fuseau de l'événement quand elles diffèrent.
- Un bouton **Ajouter à mon agenda** (fichier .ics).
- **Sans JavaScript** : la date et l'heure restent lisibles, dans le fuseau de l'événement.
- Si la personne demande moins de mouvement sur son appareil : pas de secondes, un seul changement par minute, aucune animation.
- Quand l'heure arrive : le message de fin et son bouton, puis la disparition au bout du délai choisi.

## Réglages

| Réglage | Par défaut |
|---|---|
| Mon fuseau horaire | Belgique, France, Allemagne… (heure de Paris) |
| Garder un événement affiché une fois passé | 1 jour |
| Message de fin | « C'est parti ! » |
| Afficher les secondes | oui |
| Titre de la page | « Compte à rebours » |
| OBS : style, place, taille, minutes du message de fin | sombre, en haut au centre, moyen, 5 minutes |

## Limites

- 100 événements au plus. Au-delà, supprimez les plus anciens (bouton « Supprimer ces événements masqués »).
- Pas d'événement qui se répète tout seul chaque année : utilisez **Réutiliser** sur un événement masqué.
- Le fichier d'agenda donne l'heure exacte (heure universelle) : tous les agendas l'affichent à la bonne heure locale.
- Aucune donnée de visiteur n'est gardée : pas de cookie, pas de compteur, pas d'adresse.

## Pour les développeurs

- Une page publique (`/<chemin>`, `/<chemin>/<nom-court>`), deux morceaux d'accueil, un emplacement `layout.head` (script d’environ 12 Ko, chargé seulement s'il y a des événements), une source `overlay`, des routes en lecture seule (`ics`, `now`, `state`, `live.js`) et des outils pour les assistants (`events_list`, `event_create`, `event_update`, `event_set_featured`, `event_delete`).
- `time.mjs` : tout le calcul du temps, sans dépendance. Les fonctions communes au serveur et au navigateur sont envoyées au navigateur telles quelles (`Function.prototype.toString`) : mêmes résultats partout, testés directement.
- Les tests : `tests/countdown*.test.mjs` (changements d'heure belges et fuseaux lointains, fichier d'agenda validé par un lecteur strict, compteur sans dérive, pause onglet caché, mouvement réduit).

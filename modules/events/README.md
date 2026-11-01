# Événements

Un **agenda d'événements et de formations** pour votre site : vos prochains rendez-vous, un calendrier du mois, une fiche détaillée pour chacun et, une fois qu'ils sont passés, une **rétrospective** avec les photos et la vidéo.

Il convient à une association, à une personne qui crée seule, à une boutique : les mots, les types et les couleurs sont les vôtres. Rien n'est écrit « en dur » pour un public précis.

## Ce que voit une personne

- **Les prochains rendez-vous**, du plus proche au plus lointain, avec un filtre par type, une recherche et des pages.
- **Un calendrier du mois**, lisible au clavier et sur téléphone. Il marche sans JavaScript ; sur un petit écran il devient une simple liste de jours.
- **La fiche d'un rendez-vous** : titre, date et heure (dans le fuseau de votre site **et** chez la personne qui visite, écrites en toutes lettres : « Samedi à 20 h chez vous »), lieu, programme en créneaux, personnes invitées, image, inscription, places restantes, vidéo, et un bouton **Ajouter à mon agenda**.
- **Une situation claire** : complet, annulé, reporté.
- **La rétrospective** : les rendez-vous terminés y passent tout seuls, sans que vous fassiez rien, avec un lien vers l'album photo et la vidéo.
- Les moteurs de recherche reçoivent aussi les informations de chaque rendez-vous (nom, date, lieu, situation).

## Ce que vous faites (pas à pas)

1. Ouvrez le module (onglet **Mes événements**). Au premier passage, choisissez un **modèle de départ** : *Association / collectif*, *Création en solo* ou *Vide*. Il crée quelques types que vous pouvez renommer, recolorer ou supprimer.
2. Remplissez le petit formulaire : **titre, date, heure, lieu, texte**. Cliquez sur **Ajouter**. C'est tout : le rendez-vous est sur le site.
3. Pour aller plus loin, cliquez sur **Plus d'options** : jour de fin, fuseau, coordonnées, programme, personnes invitées, image, lien d'inscription, places restantes, vidéo, album photo, répétition.
4. **Dupliquer** copie un rendez-vous en brouillon. **Répéter** crée la suite (chaque semaine, toutes les deux semaines, chaque mois) : 100 rendez-vous au plus, 3 ans au plus.
5. **Brouillon / publié** : un brouillon n'est vu que de vous.
6. L'onglet **Types et fichiers** : vos types (nom, couleur du thème ou teinte sobre, icône), l'export et l'import d'un fichier tableur.

## Vos mots

Dans l'onglet **Réglages**, dites comment vous appelez un rendez-vous (« atelier », « rencontre »…) et, au pluriel, le titre de la page des rendez-vous passés, et le fuseau horaire du site. Les types sont **les vôtres** : le module n'en connaît aucun.

## Plusieurs agendas

Vous pouvez installer le module plusieurs fois : par exemple un agenda public et un agenda de formations, chacun avec sa page, ses types et ses réglages.

## Avec d'autres éléments du site (tout est facultatif)

- **Annonce en vidéo** : vos rendez-vous publiés à venir apparaissent dans la liste « Pour quoi veux-tu une story ? ».
- **Carte** : les rendez-vous qui ont des coordonnées sont proposés à une carte.
- **Galerie photo** et **vidéos** : si vous en avez, vous choisissez l'album ou la vidéo d'un rendez-vous passé dans une liste ; sinon vous collez un lien. Si ces éléments ne répondent pas, la page reste correcte.

## Votre assistant IA

Il peut lister vos rendez-vous, voir vos types, **préparer des brouillons** et modifier un rendez-vous. Il ne publie jamais et ne supprime rien. Ces écritures ne lui sont pas accordées d'office.

## Fichiers tableur

Exportez tous vos rendez-vous, ou importez un fichier (2 000 lignes au plus). On peut d'abord **vérifier sans rien ajouter** : un rapport dit quelle ligne et quelle colonne corriger. Réimporter le même fichier ne crée pas de doublons ; un type inconnu est créé.

## Vie privée

Aucun cookie, aucun nom ni e-mail demandé. Une vidéo YouTube ne se charge qu'après le clic de la personne qui visite. Le lien « Voir sur la carte » est un simple lien.

## Limites

- 2 000 rendez-vous, 30 types, 40 créneaux de programme et 20 personnes invitées par rendez-vous, 50 rendez-vous par page.
- Aucun paiement : l'inscription est un lien vers votre formulaire ; les places restantes sont un nombre que vous mettez à jour vous-même.
- Les inscriptions ne sont pas gérées ici (pas de liste des personnes inscrites).

## Pour qui développe

- Service offert `event.source` (méthode `upcoming`) et sujet publié `map.place`. Services facultatifs consommés : `gallery.albums` et `videos.library`.
- Toutes les heures sont gardées comme « jour + heure du mur + nom de fuseau » : l'instant exact se calcule à la lecture (changements d'heure justes, y compris dans une répétition).
- Détails : `docs/ideas/events.md` du dépôt.

## Visuels de la fiche

Depuis la version 1.0.2, la fiche du module montre des captures de ce qu'il ajoute à votre site (données inventées, aucune donnée réelle).

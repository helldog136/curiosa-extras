# Événements (`events`) : description complète

## Problème
Une association, une créatrice ou une boutique annonce des rendez-vous (ateliers, formations, rencontres, lives spéciaux, sorties). Sans outil, les dates vivent dans des publications éparses, personne ne sait « à quelle heure chez moi », et rien ne reste après coup.

## Pour qui
Des sites très différents : le module ne connaît aucun type, aucun mot, aucune région. Les types, les mots et les couleurs sont ceux de la propriétaire ; plusieurs agendas peuvent coexister (public, formations).

## Ce que voit le visiteur
- Page `/<chemin>` : prochains rendez-vous (annulés et reportés visibles avec leur étiquette), filtre par type, recherche, pages de 12 (50 au plus).
- `/cal/AAAA-MM` : calendrier du mois en vrai tableau (légende, jours, liens) ; sur téléphone, simple liste de jours. Aucun JavaScript requis.
- `/past` : rétrospective ; les rendez-vous terminés y passent seuls (comparaison avec l'heure, aucune tâche). Lien vers l'album (service facultatif `gallery.albums`, sinon lien libre) et une vidéo (`videos.library`).
- `/e/<nom>` : fiche : date et heure dans le fuseau de l'événement avec son nom, heure chez le visiteur en toutes lettres (script de page, cachée sans lui), lieu en texte, lien « Voir sur la carte » si coordonnées, programme en créneaux, intervenants (lien facultatif vers une fiche), image, inscription (lien externe et/ou places restantes ; jamais de paiement), situation (complet, annulé, reporté), vidéo (YouTube seulement après le clic, ou fichier du site), « Ajouter à mon agenda » (.ics), données structurées Event.
- Recherche sans JavaScript : un formulaire GET vers `/m/<clé>/find` qui renvoie vers une adresse construite par le module.
- Abonnement : `/m/<clé>/feed.ics` (100 événements à venir).

## Ce que fait Emma, pas à pas
1. Onglet « Mes événements » : choisir un modèle de départ (Association / collectif, Créateur seul, Vide) ; il crée des types modifiables.
2. Formulaire à 5 champs (titre, date, heure, lieu, texte) + « publier tout de suite ». Erreurs sous le champ avec un exemple.
3. « Plus d'options » : fin/fuseau/coordonnées, programme et intervenants (une ligne chacun), image, inscription, places, vidéo, album et vidéo liés, répétition.
4. Dupliquer (brouillon), publier/retirer, supprimer ; répéter chaque semaine / deux semaines / mois (100 au plus, 3 ans au plus, tout ou rien) ; « appliquer aussi aux prochains de la série ».
5. Onglet « Types et fichiers » : types (nom par langue, couleur du thème ou palette sobre, icône), ajout des types d'un gabarit, export CSV, import CSV (vérifier d'abord, rapport ligne/colonne, pas de doublon, types inconnus créés).

## Réglages et valeurs par défaut
Fuseau du site (Europe/Paris, à régler), introduction, mots (singulier, pluriel, titre de la rétrospective ; vides = « événement(s) », « Rétrospective »), page des passés (oui), abonnement (oui), lien carte (oui) ; avancé : par page (12), début de semaine (lundi).

## Gabarits et vocabulaire
`templates.mjs` : données seulement. Association / collectif : Événement, Atelier, Formation, Masterclass, Rencontre. Créateur seul : Live spécial, Sortie, Rencontre. Vide : rien. Le code ne contient aucun de ces mots (test).

## Données et vie privée
Collections `ev_events`, `ev_types`, `ev_meta`. Un événement garde jour + heure du mur + fuseau (jamais un décalage) : changements d'heure justes, répétitions comprises. Aucun cookie, aucun nom ni e-mail ; empreinte salée du cœur en mémoire (limites de débit). Album et vidéo : seulement l'identifiant, relus chez leur propriétaire (cache 5 min, panne retenue 1 min, délai 2,5 s). Tiers : YouTube après clic, lien carte simple.

## Bornes
2 000 événements, 30 types, 40 créneaux, 20 intervenants, 100 occurrences/3 ans, 50 par page, import 2 000 lignes/5 Mo, liste en mémoire 20 s, `event.source` 100, `map.place` 200.

## Intégrations
- Offre `event.source` v1 (`each`, `upcoming`) : publiés, à venir, ni annulés ni reportés ; vérifié avec la lecture réelle de la Story.
- Publie `map.place` (événements à venir avec coordonnées).
- Consomme facultativement `gallery.albums` et `videos.library` (faux fournisseurs `tests/helpers/fakeGallery.mjs`, `fakeVideos.mjs` : absent, en panne, muet, lent, illisible).

## Outils pour l'assistant
`agenda_list_events`, `agenda_get_event`, `agenda_list_types` (lecture) ; `agenda_create_event` (toujours un brouillon, répétition possible), `agenda_update_event` (ne change jamais la publication). Écritures non accordées d'office ; droit `events.edit` pour écrire.

## Ce qui n'est pas fait
Inscriptions gérées (liste de participants), paiement, répétition annuelle ou « 2e mardi », édition en lot dans la liste, import d'agendas externes.

## Idées pour la suite
Capacité décomptée par un module d'inscriptions, rappels par e-mail, import iCal.

## Événements 1.0.0

### Nouveautés
- Un agenda d'événements et de formations : prochains rendez-vous (filtre par type, recherche, pages), calendrier du mois, fiche complète et rétrospective des événements passés.
- L'heure chez le visiteur, écrite en toutes lettres.
- Programme en créneaux, intervenants, inscription par lien, places restantes, complet / annulé / reporté, vidéo, « Ajouter à mon agenda ».
- Vos types, vos mots, vos couleurs ; modèles de départ au choix ; plusieurs agendas possibles.
- Dupliquer, répéter (chaque semaine ou mois), brouillon / publié, import et export de fichier tableur.
- Vos rendez-vous publiés apparaissent dans la liste de l'annonce en vidéo ; ceux qui ont des coordonnées peuvent aller sur une carte.

### Améliorations
- Une seule étape pour ajouter : titre, date, heure, lieu, texte. Le reste est dans « Plus d'options ».
- Les erreurs s'affichent sous le champ avec un exemple.

### Pour les développeurs
- Offre le service `event.source` (v1, `each`) et le sujet `map.place` ; consomme `gallery.albums` et `videos.library` en facultatif.
- Données en jour + heure du mur + fuseau ; imports de voisins avec la version ; test de mise à jour à chaud.
- Tests : `tests/events-*.test.mjs`, faux fournisseurs `fakeGallery.mjs`, `fakeVideos.mjs`.
- Conflits probables : `tests/event-source-contract.test.mjs` (liste exacte des fournisseurs) et `tests/repo-rules.test.mjs` (sujet `map.place` à documenter dans le cœur).

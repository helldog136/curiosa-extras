## Vidéothèque : vos vidéos YouTube sur une page à vous

*Un nouveau module, Vidéothèque 1.0.0, pour Curiosa 0.2.6 ou plus. Rien n'est hébergé : les vidéos restent sur YouTube.*

### Nouveautés

- **Une page de vidéos** (masterclass, rétrospectives, tutoriels…) : grille, catégories, recherche, séries à regarder dans l'ordre, transcription, partage.
- **Collez une adresse, le titre se remplit.** Plusieurs adresses d'un coup, avec aperçu. Si YouTube ne répond pas, vous écrivez le titre.
- **Le lecteur ne se charge qu'après un clic** : aucune requête vers YouTube avant.
- **Modèle de départ et vocabulaire réglable** (« Replays », « Formations »…).

### Améliorations

- Pensé pour le téléphone, erreurs sous les champs, aucun cookie.

### Pour les développeurs

- Offre `videos.library` v1 (lecture seule) ; consomme `gallery.albums` (facultatif). Table de fournisseurs prête pour une autre plateforme. Voir `docs/ideas/videos.md`.

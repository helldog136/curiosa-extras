# Témoignages 1.0.0

## Nouveautés
- Un lien « Laisser un avis » à partager (et son QR code), pensé pour le téléphone.
- Chaque avis arrive « à valider » : rien n'est publié sans que vous l'ayez lu, ni sans l'accord de la personne (case obligatoire, enregistrée avec sa date).
- Étoiles facultatives, note moyenne, filtre par note, avis en grille ou en défilement lent avec un bouton pause (sans mouvement pour qui préfère moins d'animation).
- Favoris, ordre au choix, trois avis à la une sur la page d'accueil, note moyenne et invitation à laisser un avis en encarts.
- La personne peut retirer son avis elle-même avec un lien privé ; vous pouvez aussi le supprimer à sa demande.
- Téléchargement des avis (tableur) avec la preuve d'accord de chacun.

## Améliorations
- Les erreurs du formulaire s'affichent sous chaque champ, avec un exemple, et la personne ne retape rien.
- L'adresse e-mail est facultative, jamais publiée, et s'efface toute seule au bout de 90 jours.
- Les avis refusés s'effacent tout seuls après 30 jours ; aucun cookie, aucune adresse IP gardée.
- Vous pouvez ajouter un avis reçu ailleurs (message, e-mail) en indiquant que la personne est d'accord.

## Pour les développeurs
- Module à code (`index.mjs`, `lib.mjs`, `data.mjs`, `view.mjs`, `admin.mjs`), `minCore` 0.2.5, onglet « Avis » (renommé) + un onglet ajouté « Partager » (blocs rangés par `tab`).
- Droits : `reviews.moderate`, `reviews.delete`, `email.view`, `reviews.export` ; téléchargement `adminDownloads.reviews` (flux, 500 lignes par lecture).
- Actions MCP : `testimonials_list`, `testimonials_summary`, `testimonials_decide`, `testimonials_delete` (destructive). Sujet fourni : `overlay.item`.
- Données : collections `reviews` et `drafts` ; tâche `tidy` quotidienne et idempotente.
- Données structurées d'évaluation : éteintes par défaut, JSON-LD posé dans le corps de la page des avis uniquement (le `layout.head` du cœur vaut pour tout le site).
- Limites de débit en mémoire, visiteur = dernier nom de `x-forwarded-for`, empreinte salée.

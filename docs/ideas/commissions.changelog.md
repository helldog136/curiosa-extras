# Commandes 1.0.0

## Nouveautés
- Une page « Commandes » qui dit si vos commandes sont ouvertes, complètes ou fermées, avec le nombre de places libres et la date de réouverture.
- Vos formules (nom, prix indicatif, délai, ce qui est inclus) et un formulaire court pour les demandes.
- Un lien de suivi privé pour chaque cliente : elle voit où en est sa commande et sa place dans la file, sans créer de compte.
- Une liste de demandes simple : nouvelle, acceptée, en cours, livrée (ou refusée, annulée), avec des notes privées et un message pour la cliente.
- Des e-mails de confirmation et de changement d'état, si votre site sait envoyer des e-mails.
- Une fiche Contacts créée en un clic quand vous acceptez une commande (si le module Contacts est installé).
- Un fichier à télécharger avec toutes les demandes.

## Améliorations
- Les commandes terminées s'effacent toutes seules après 12 mois (réglable).
- Votre adresse e-mail et vos notes ne sont jamais montrées à la cliente ; seules les personnes autorisées voient les adresses.
- Sur téléphone, tout se lit et se touche sans défilement de côté ; les erreurs s'affichent sous le champ avec un exemple.

## Pour les développeurs
- Module en code, une instance ; demande Curiosa 0.2.5 ; dépendance facultative à `contact.book` (v2), offre `privacy.subject`.
- Lien de suivi : 160 bits, seule l'empreinte SHA-256 est gardée (clé d'index du stockage), comparaison `timingSafeEqual`, réponse identique pour tout lien inconnu.
- Droits `manage`, `email.view`, `export` ; export par `adminDownloads` ; tâche quotidienne de conservation ; 5 outils MCP sans suppression.
- Détail : `docs/ideas/commissions.md`.

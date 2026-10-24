# Annuaire 1.0.0

## Nouveautés
- Une page d'annuaire publique de vos membres, créateurs ou partenaires : on cherche par nom (sans se soucier des accents), on filtre par catégorie, on trie, on ouvre la fiche d'une personne.
- Une section Équipe avec le titre de chacun (« Présidente »…), dans l'ordre que vous choisissez.
- Une version imprimable et un fichier à télécharger, avec seulement ce qui est déjà public.
- Un bouton « Proposer ma fiche » vers votre formulaire de contact ou votre e-mail.
- Trois modèles de départ en un clic : Association, Collectif de créateurs, Vide. Plusieurs annuaires possibles (membres, partenaires…).
- Quelqu'un ne veut pas apparaître ? Catégorie « Ne pas montrer » de Contacts, ou « Masquer » d'un clic.
- Pour la carte du site : seulement les personnes qui ont accepté, au niveau de leur ville.

## Améliorations
- Tout vient de Contacts : rien à retaper, et tout reste à jour.
- Tient 5 000 personnes sans lenteur ; si Contacts ne répond plus, la dernière liste reste affichée.
- Les photos hébergées ailleurs ne se chargent qu'après un clic du visiteur.
- Pensé pour le téléphone, FR et EN, mots réglables.

## Pour les développeurs
- Dépend de `contact.book` v2 (`min: 2`) ; lit chaque catégorie publique par paquets de 500, index en mémoire borné (10 000), recherche/filtre/tri/curseur locaux (`directory.mjs`). Offre `privacy.subject` (`each`), fournit `map.place` (consentement explicite, ville arrondie, géocodage `ctx.api.net` depuis l'administration seulement).
- Collections `dir_config` et `dir_profiles`. Routes GET `go` (redirection reconstruite) et `csv` (limitée). Cinq outils MCP en lecture seule. Droits `edit`, `hide`. `minCore` 0.2.6.
- Imports voisins versionnés (`await import(…${v})`), test de mise à jour à chaud. Tests : `tests/directory*.test.mjs`, `tests/helpers/directory-world.mjs` (faux Contacts de 5 000 fiches).

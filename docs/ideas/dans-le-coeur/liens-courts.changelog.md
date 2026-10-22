# Liens courts 1.0.0

## Nouveautés
- Collez une longue adresse : le site crée un nom court lisible (`merch`) et son QR code, à télécharger en image nette (SVG) ou en PNG, prêt à imprimer.
- Un petit compteur de clics par jour pour chaque lien, avec un graphique, sans cookie ni adresse IP.
- Une date de fin facultative : après elle, une page aimable remplace la redirection (vous pouvez écrire votre message).
- Changez où mène un lien sans changer le QR code déjà imprimé.
- Export des clics par jour pour votre tableur ; les liens et les chiffres sont aussi dans la sauvegarde lisible.
- Votre assistant IA peut lister, créer, modifier et supprimer des liens (suppression jamais accordée d'office).

## Améliorations
- Les adresses qui ne peuvent pas marcher pour vos visiteurs (ordinateur local, réseau privé) sont refusées avec une explication et un exemple, sous le champ.
- Un bandeau vous prévient si l'adresse publique du site n'est pas réglée, avant que vous imprimiez.
- Utilisable sur téléphone, en clair et en sombre, en français et en anglais.

## Pour les développeurs
- Module `short-links` 1.0.0, `minCore` 0.2.5, aucune dépendance ; générateur de QR code en JavaScript pur (`qr.mjs`, `qr-render.mjs`).
- Adresse : `/m/<clé>/go?c=<nom>` (302, sans cache) et `/m/<clé>/qr` ; le cœur réserve `/go/…`.
- Compteur : en mémoire puis une écriture coalescée par lien (un document de statistiques par lien, 120 jours), sans verrou ni minuteur.
- Tests : `tests/short-links.test.mjs`, `tests/short-links-qr.test.mjs`, décodeur de test `tests/helpers/short-links-qr-decode.mjs`.

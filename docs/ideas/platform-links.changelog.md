# Autres plateformes — 1.0.0

## Nouveautés
- Ajoutez votre OnlyFans, Mym, Fansly, Patreon, Ko-fi, Tipeee, Liberapay, Buy Me a Coffee, Linktree ou n'importe quelle page en icône, à côté de vos autres réseaux en haut du site.
- Collez l'adresse comme vous l'avez : « onlyfans.com/monnom » est complété tout seul. Jusqu'à 20 liens, rangés avec Monter et Descendre.
- Une page d'avertissement « contenu pour adultes » peut s'afficher avant l'ouverture d'un lien : prévue par défaut pour OnlyFans, Mym et Fansly, jamais pour les autres, et vous pouvez la couper pour tous ou pour un seul lien. Elle ne vérifie pas l'âge. Elle fonctionne sans JavaScript, ne laisse aucune trace chez le visiteur et n'est pas référencée par les moteurs de recherche.
- Un assistant IA peut lister, ajouter et modifier vos liens si vous lui en donnez l'accès.

## Améliorations
- Le message d'erreur sous le champ dit quoi écrire, avec un exemple, en français et en anglais.
- Pour que la plateforme sache d'où viennent les visites, le nom de votre site est ajouté automatiquement à chaque lien (sans rien régler ; réglages fins en mode avancé).
- Sur téléphone, la liste et les boutons tiennent à l'écran, sans défilement sur le côté.

## Pour les développeurs
- Fournit le sujet `social.link` (rendu par l'en-tête du cœur, comme les modules de réseaux) ; type `widget`, instance unique, `minCore` 0.2.5, droit `links.edit` sur chaque action d'administration, stockage `links`.
- Page d'avertissement : route `go` (`/m/<instance>/go?l=<clé>`), HTML sans script, `X-Robots-Tag: noindex`, CSP `default-src 'none'`, destination uniquement issue de la configuration ; l'icône directe et le bouton « continuer » utilisent la même fonction `destinationOf` (utm ajoutés côté serveur, fusion sans écrasement, encodage strict).
- Validation d'adresse pure (`links.mjs`, `normalizeUrl`) testée : schémas, identifiants, adresses internes ou numériques, ports, faux sites.
- Outils : `platform_links_list`, `platform_link_create`, `platform_link_update` (noms ≤ 31 caractères).
- Tests : `tests/platform-links.test.mjs`.

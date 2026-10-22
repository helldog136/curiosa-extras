# Santé du site 1.0.0

## Nouveautés
- Une page « Santé du site » avec un bouton « Vérifier maintenant » : le résultat tient en quelques phrases claires, classées Important / Conseillé / Pour info, avec « Tout va bien » quand tout va bien.
- Elle repère les images sans description, les pages sans texte pour les moteurs de recherche, les titres vides ou en double, les traductions manquantes, les liens qui ne répondent plus et les liens vers une de vos pages disparue.
- Chaque remarque a un bouton « Corriger » qui ouvre le bon écran, et « Ignorer » si c'est voulu.
- Les 5 dernières vérifications sont gardées.

## Améliorations
- Les liens vers d'autres sites sont visités doucement, un site à la fois, par petits groupes avec une barre de progression, et seulement quand vous le demandez.
- La page dit aussi ce qu'elle ne peut pas voir (le menu, les pages d'autres extensions, vos fichiers importés).

## Pour les développeurs
- Lecture par `ctx.api.instances/entries/site/brand` et le sujet `social.link` ; visites par `ctx.api.net` seulement (HEAD puis GET de 2 Ko, redirections suivies à la main, garde d'adresses publiques avec résolution `node:dns`).
- Actions MCP : `site_health_status` (lecture), `site_health_run` (écriture explicite).
- Aucune tâche planifiée ; un passage à la fois (réservation mémoire + date en données). Données : `report`, `run`, `state`, `history`, `ignored`.

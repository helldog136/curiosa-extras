## Hygiène du dépôt : registre des sujets, tests sur un cœur publié

*Aucun module ne change pour les visiteurs. Pour les développeurs de modules.*

### Pour les développeurs
- Le registre des sujets échangés entre modules vit ici : `docs/TOPICS.md` (une ligne par sujet : sujet, fournisseurs, consommateurs, champs, depuis). Le test des règles du dépôt le lit (format, fournisseurs et consommateurs déclarés) ; créer un sujet ne demande plus de version du cœur.
- L'intégration continue teste les modules contre le dernier cœur publié (bloquant) et contre la branche `dev` du cœur (information, jamais bloquant), au lieu de la branche portant le même nom que celle du module.
- Nouveau : `docs/ideas/CAPACITES.md`, la revue de capacités à faire avant de construire un module (un lot par version du cœur, le cœur publié avant les modules qui en dépendent) et le registre des demandes faites au cœur.

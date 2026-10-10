# Suggestions de jeux — module communautaire de Curiosa

Page publique `/suggestions` : la communauté propose un jeu, vous le faites avancer (proposé → planifié → accepté → déjà joué → fini, ou rejeté, non public).

- **Votes « rejoue-le »** sur les jeux déjà joués : 3 par mois et par visiteur (réglable) — cookie + mémoire côté serveur.
- **Jaquettes** via RAWG par le service du cœur : la clé d'API se saisit une seule fois dans Admin → Réglages (facultatif ; sans elle, pas d'image). Sur une version de Curiosa trop ancienne pour ce service, le module garde son ancien champ de clé (réglage avancé).
- **Rattrapage des jaquettes manquantes** : une suggestion restée sans image (migrée, restaurée d'une sauvegarde, ajoutée pendant une panne de RAWG) est cherchée plus tard, toute seule : cinq titres toutes les 15 minutes, avec un nouvel essai après 3, 7, 14 puis 30 jours pour un jeu que RAWG ne connaît pas (cinq essais au plus), et tout de suite dès qu'une clé est saisie ou corrigée (la recherche repart quand « clé absente » ou « clé refusée » a cessé). Une clé refusée met la recherche en pause 24 h ; RAWG injoignable ne compte pas comme un essai. Le bouton **Rechercher les jaquettes manquantes** (admin) fait la même chose immédiatement, 25 titres à la fois, et dit en clair : combien trouvées, combien sans résultat, ou « clé absente » / « clé refusée » / « RAWG ne répond pas ». La date et le résultat de chaque essai sont enregistrés avec les suggestions : tout survit à une restauration de sauvegarde.
- **Anti-spam** : piège à robots, limite par heure, au plus un lien dans la note, plafond de 2000 suggestions.
- **Admin** : tableau avec changement de statut en un clic. **MCP** : un assistant peut lister et changer les statuts.
- **Sauvegarde lisible** : `games.csv`.

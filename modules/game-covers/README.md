# Jaquettes de jeux

Ce module **trouve la jaquette d'un jeu vidéo** pour les autres modules de votre site (*Planning*, *Story d'annonce*, *Suggestions de jeux*…). Il garde votre clé RAWG, en sécurité (jamais réaffichée), et retient vos choix quand une jaquette n'est pas la bonne. RAWG est une base de données de jeux vidéo, gratuite.

## Pour commencer
1. Créez un compte gratuit sur **rawg.io/apidocs** et copiez votre clé.
2. Ouvrez l'onglet **Réglages** de ce module et collez-la dans « Clé RAWG ».
3. Revenez sur l'onglet principal et cliquez sur **« Tester la clé »**.

**Vous aviez déjà une clé RAWG sur votre site ?** Rien à faire : à la mise à jour, ce module s'installe tout seul, et votre clé comme vos corrections de jaquettes arrivent ici sans que vous les ressaisissiez. Les adresses « Ce n'est pas le bon jeu ? » déjà publiées continuent de marcher.

## « Quel est le bon jeu ? »
Quand le site n'est pas sûr du jeu qui correspond à un titre (par exemple « Playrooms »), il le note dans **« Jaquettes à vérifier »**. Cliquez sur **Corriger** : vous voyez les jaquettes proposées par RAWG, vous choisissez le bon jeu en un clic (ou « Aucune jaquette »), et le site retient votre choix pour tous les modules. **« Ce choix est bon »** valide le choix du site tel quel.

## Ce que le module garde
- votre clé RAWG (jamais affichée) ;
- vos corrections (1 000 au plus) et la liste des titres à vérifier (100 au plus, 60 jours) ;
- le dernier état de la clé (« fonctionne », « refusée »…).

Les jaquettes elles-mêmes ne sont pas téléchargées : le site garde seulement leur adresse, et le navigateur des visiteurs les charge depuis RAWG.

## Vie privée
Le module ne collecte rien sur vos visiteurs. Il envoie à RAWG le titre du jeu (depuis le serveur de votre site) avec votre clé. Quand une jaquette est affichée, le navigateur du visiteur charge l'image depuis RAWG, qui voit donc son adresse.

## Pour les développeurs
- **Service `game.cover` (version 1)**, à déclarer en besoin facultatif : `"requires": [{ "service": "game.cover", "optional": true }]`.
  - `cover({ title })` → `{ status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous? }` ;
  - `candidates({ title, search? })` → `{ status, candidates: [{ id, name, year, platforms, url }] }` (6 au plus) ;
  - `status()` → `{ ready, configured, source, state, at? }`, sans appel réseau ni clé ;
  - `fix({ title, rawgId | none | forget })` : réservé au droit « choisir le bon jeu » (`{ asCaller: true }` depuis une action d'administration) ;
  - `adopt({ key?, fixes?, todo? })` : reprise des données de l'ancien réglage du site (ne remplace jamais, ne rend jamais une valeur).
- Un module peut aussi écrire « Ce n'est pas le bon jeu ? » avec le lien `/admin/settings/rawg-covers?titre=<titre encodé>` : le cœur le redirige vers l'écran de ce module.
- Appels vers RAWG : `ctx.api.net` (https, délai de 5 s, 256 Ko, disjoncteur du cœur) ; cache en mémoire (24 h trouvé, 1 h « aucun résultat », 500 recherches) ; aucun minuteur.
- Stockage : `fixes` (clé = titre normalisé), `todo`, `adoptedKey`, `keyState`, `handover`.
- Outils de l'assistant : `rawg_covers_to_check` (lecture) et `rawg_cover_set` (écriture, jamais accordée d'office).

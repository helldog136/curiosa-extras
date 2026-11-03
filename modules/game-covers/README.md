# Jaquettes de jeux

Ce module **trouve la jaquette d'un jeu vidéo** (et la garde, pour qu'elle reste affichée même quand RAWG est en panne) pour les autres modules de votre site (*Planning*, *Story d'annonce*, *Suggestions de jeux*…). Il garde votre clé RAWG, en sécurité (jamais réaffichée), et retient vos choix quand une jaquette n'est pas la bonne. RAWG est une base de données de jeux vidéo, gratuite.

## Pour commencer
1. Créez un compte gratuit sur **rawg.io/apidocs** et copiez votre clé.
2. Ouvrez l'onglet **Réglages** de ce module et collez-la dans « Clé RAWG ».
3. Revenez sur l'onglet principal et cliquez sur **« Tester la clé »**.

**Vous aviez déjà une clé RAWG sur votre site ?** Rien à faire : à la mise à jour, ce module s'installe tout seul, et votre clé comme vos corrections de jaquettes arrivent ici sans que vous les ressaisissiez. Les adresses « Ce n'est pas le bon jeu ? » déjà publiées continuent de marcher.

## Quand RAWG ne répond pas
- Chaque jaquette trouvée toute seule est **gardée** (1 000 au plus ; les plus anciennes sortent d'elles-mêmes). Elle survit aux redémarrages du site.
- Si RAWG ne répond pas, la jaquette gardée s'affiche **même si elle a plus de 24 heures**, et elle n'est pas supprimée. Quand RAWG revient, elle est rafraîchie dès qu'une page la demande.
- Une panne n'est **jamais** retenue comme « pas de jaquette » : la jaquette apparaîtra dès que RAWG reviendra.
- Après trois échecs d'affilée, le site arrête d'insister : pause de 1, 2, 5 puis 15 minutes au plus, avec un seul essai de reprise à la fois. Vos pages n'attendent jamais longtemps (3 secondes au plus).
- En haut de **« Jaquettes à vérifier »**, une phrase dit où on en est : « Tout fonctionne » (avec la date de la dernière réponse) ou « La base de jaquettes ne répond pas pour le moment. Les jaquettes déjà trouvées restent affichées. » « Tester la clé » réessaie tout de suite. Le Journal du site note une fois l'arrêt et une fois le retour.
- Vos corrections passent toujours avant tout.

## « Quel est le bon jeu ? »
Quand le site n'est pas sûr du jeu qui correspond à un titre (par exemple « Playrooms »), il le note dans **« Jaquettes à vérifier »**. Cliquez sur **Corriger** : vous voyez les jaquettes proposées par RAWG, vous choisissez le bon jeu en un clic (ou « Aucune jaquette »), et le site retient votre choix pour tous les modules. **« Ce choix est bon »** valide le choix du site tel quel.

## « Jaquettes enregistrées »
Cet onglet réunit en **un seul tableau** tout ce que le site retient pour vos jeux, avec sa recherche en direct et des filtres :
- **Corrigée** : un jeu ou une image que vous avez choisi ;
- **Sans jaquette** : un titre pour lequel vous avez choisi « Aucune jaquette » ;
- **Automatique** : un jeu trouvé tout seul par le site (douteux ou non).

Sur chaque ligne : **Voir** (la jaquette en grand), **Changer** (les jaquettes proposées pour ce titre, ou « Aucune jaquette ») et, dans le menu « ⋯ », **Oublier cette jaquette** (une phrase vous dit ce qui sera oublié ; le site cherchera de nouveau tout seul). **« Oublier toutes les corrections »** demande une case à cocher.

Pour retenir une jaquette sans attendre qu'un module la demande, écrivez un titre dans **« Chercher un jeu »** (par exemple *Hollow Knight*), puis choisissez **« Utiliser cette jaquette »**. La recherche part au moment où vous cliquez, jamais en arrière-plan. Le titre est retenu tel que vous l'écrivez : écrivez-le comme vos pages l'écrivent.

## Ce que le module garde
- votre clé RAWG (jamais affichée) ;
- vos corrections (1 000 au plus), la liste des titres à vérifier (100 au plus, 60 jours) et les jaquettes trouvées toutes seules (1 000 au plus) : l'onglet « Jaquettes enregistrées » montre tout ;
- le dernier état de RAWG (« fonctionne », « ne répond pas », « refuse la clé ») et la date de sa dernière réponse correcte.

Les jaquettes elles-mêmes ne sont pas téléchargées : le site garde seulement leur adresse (`https://media.rawg.io/media/…`), et le navigateur les charge depuis RAWG, dans l'administration comme sur le site. Un titre sans résultat n'est retenu qu'une heure, en mémoire.

## Vie privée
Le module ne collecte rien sur votre public. Il envoie à RAWG le titre du jeu (depuis le serveur de votre site) avec votre clé. Quand une jaquette est affichée, le navigateur de la personne qui visite charge l'image depuis RAWG, qui voit donc son adresse.

## Pour qui développe
- **Service `game.cover` (version 1)**, à déclarer en besoin facultatif : `"requires": [{ "service": "game.cover", "optional": true }]`.
  - `cover({ title })` → `{ status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous? }` ;
  - `candidates({ title, search? })` → `{ status, candidates: [{ id, name, year, platforms, url }] }` (6 au plus) ;
  - `status()` → `{ ready, configured, source, state, at? }`, sans appel réseau ni clé ;
  - `fix({ title, rawgId | none | forget })` : réservé au droit « choisir le bon jeu » (`{ asCaller: true }` depuis une action d'administration) ;
  - `adopt({ key?, fixes?, todo? })` : reprise des données de l'ancien réglage du site (ne remplace jamais, ne rend jamais une valeur).
- Un module peut aussi écrire « Ce n'est pas le bon jeu ? » avec le lien `/admin/settings/rawg-covers?titre=<titre encodé>` : le cœur le redirige vers l'écran de ce module.
- Appels vers RAWG : `ctx.api.net` (https, délai de 5 s, 256 Ko, disjoncteur du cœur) ; lecture = mémoire (24 h trouvé, 1 h « aucun résultat », 500 recherches), puis stockage `autoCovers`, puis RAWG (délai de 3 s pour une page, 5 s à l'écran d'administration) ; périmé mais utilisable si RAWG est injoignable ; disjoncteur en mémoire (3 échecs, pauses 1/2/5/15 min) ; aucun minuteur.
- Stockage : `fixes` (clé = titre normalisé), `todo`, `autoCovers` (1 000 au plus), `adoptedKey`, `keyState` (état, date, `okAt`), `handover`.
- Journal du cœur : `cover.game`, `cover.image`, `cover.none`, `cover.confirmed`, `cover.forgotten`, `cover.cleared`, `cover.outage`, `cover.back` (titre du jeu et geste, jamais la clé).
- Outils de l'assistant : `rawg_covers_to_check` et `rawg_covers_list` (lecture), `rawg_cover_set` (écriture, jamais accordée d'office).

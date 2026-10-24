## Nouveautés
- Carte : une liste de lieux utiles avec filtres par type et recherche, et une carte OpenStreetMap affichée seulement à la demande du visiteur.
- « Près de moi » : les lieux triés par distance, sans que la position quitte l'appareil.
- Ajout d'un lieu en collant un lien Google Maps, OpenStreetMap ou Plans ; import et export de fichiers CSV.

## Améliorations
- Les lieux des événements ou de l'annuaire apparaissent d'eux-mêmes, avec leur source ; on peut les masquer un par un.
- Types de lieux et mots du site réglables, quatre jeux de départ, plusieurs cartes possibles.

## Pour les développeurs
- Moteur de carte maison (2 scripts de page, moins de 25 Ko pour le moteur), calculs testés hors navigateur.
- Consomme le sujet `map.place` ; faux fournisseur `tests/helpers/fakeMapPlaces.mjs` ; outils MCP `map_places_list`, `map_types_list`, `map_place_add` (brouillon).
- Imports de fichiers voisins avec la version ; test de mise à jour à chaud.

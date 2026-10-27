## Mur des remerciements 1.1.0 : prêt pour les skins, sans rien changer à son apparence

*Les skins de Curiosa pourront bientôt restyler le mur des remerciements (arrondis, bordures, ombres, espaces). Aujourd'hui, il s'affiche exactement comme avant. Pour Curiosa 0.4.0 ou plus. Module touché : Mur des remerciements 1.1.0.*

### Améliorations

- **Le mur est stylable par les skins.** Six éléments (la personne à l'honneur, les cartes, la grille, les photos, l'étiquette « à l'honneur », les boutons) peuvent changer d'arrondi, de bordure, d'ombre ou d'espacement quand un skin le demande.
- **Rien ne change pour vous.** Sans skin (ou avec le skin de base), le mur est identique pixel pour pixel à la version précédente : mêmes textes, mêmes personnes, mêmes liens. Un skin ne peut ni ajouter ni retirer ni cacher quoi que ce soit.

### Pour les développeurs

- Première conversion d'un module aux pièces de skin (`skin` dans `module.json`, `minCore` 0.4.0) : 6 pièces `thanks-wall.*`, 14 jetons `--sk-m-thanks-wall-*` dont les valeurs par défaut sont les valeurs d'avant (`var(--sk-m-…, var(--sk-…, valeur-actuelle))`), aperçu `skin-demo.html`. Version mineure : le test `tests/thanks-wall-skin.test.mjs` prouve que la feuille se réduit exactement à celle de la 1.0.1.

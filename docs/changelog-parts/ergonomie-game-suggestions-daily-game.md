## Suggestions de jeux et Jeu du jour : deux administrations refaites pour se lire d'un coup d'œil

*Les pages d'administration de Suggestions de jeux et du Jeu du jour suivent les règles d'ergonomie du dépôt (`docs/ERGONOMIE-ADMIN.md`). Pour Curiosa 0.6.0 ou plus. Modules touchés : Suggestions de jeux 1.7.0, Jeu du jour 1.1.0.*

### Suggestions de jeux

- **Un seul tableau, qui tient sur un téléphone.** Plus de huit boutons par ligne (« → Proposé », « → Planifié »…), plus de tableau qui sort de l'écran. Chaque ligne montre le jeu, son statut et son origine en pastille colorée **et** écrite, la date, les votes et, seulement quand elle manque, la jaquette. Sous 640 px, chaque ligne devient une carte.
- **Une recherche qui filtre pendant que vous tapez** : le nom du jeu, le pseudo, la note, le statut. Au-dessus, des pastilles de statut avec leur nombre (« Proposé 12 », « Planifié 3 »…). Le tableau garde toutes vos suggestions et se lit 50 par 50.
- **Le statut se change par le menu « ⋯ »** de la ligne. Un seul bouton reste visible : « Changer la jaquette ». « Supprimer » est dans le menu, en rouge, et demande confirmation.
- **Ajouter un jeu tient en deux champs** : le nom et le statut. La note et l'image sont sous « Plus d'options ».
- **Des mots de tous les jours** : plus de « clé » dans les messages sur les jaquettes (« Les jaquettes ne sont pas encore reliées : ouvrez le module « Jaquettes de jeux » »), plus de point d'exclamation.

### Jeu du jour

- **Écrire une question tient en trois champs** : la question, les réponses (une par ligne, de 2 à 4) et le numéro de la bonne. Avant, le formulaire montrait 19 champs, avec le français et l'anglais côte à côte. L'explication, l'image, les autres langues, la catégorie, la difficulté, la date précise et l'état sont repliés sous « Plus d'options », qui s'ouvre tout seul quand l'un d'eux est rempli.
- **Une liste qui se cherche en direct**, avec des pastilles d'état (Publiée, Brouillon, Planifiée) et leur nombre, 50 par page. Le bouton « Chercher » disparaît.
- **Les packs et les gabarits** sont des tableaux de trois colonnes (nom, description, avancement). L'étiquette « Pas activé » n'est plus répétée sur chaque ligne.
- **Moins de réglages à l'écran** : sept réglages simples au lieu de treize. Les trois réglages rares (état dans le bloc d'accueil, mascotte et son message) sont sous « Plus d'options ». L'ordre et le chronomètre se choisissent par des boutons côte à côte.
- **Des aides courtes, avec un exemple** sous chaque champ libre. Plus de « CSV » dans les libellés : « Importer depuis un tableur ». Plus de tutoiement ni de point d'exclamation dans les textes du jeu.

### Pour les développeurs

- Les deux modules demandent maintenant Curiosa 0.6.0 (`minCore`) : tableau enrichi, champs `segmented` et `folded`, réglages `rare`, `display: "segmented"` et `example`.
- `tests/helpers/ergonomics.mjs` est recopié depuis `testsupport/ergonomics.mjs` du cœur 0.6.0 (il connaît les réglages `rare` et `example`). La base d'écarts d'ergonomie passe de 1185 à 1114 écarts.
- `answers_<langue>` remplace `a1_<langue>` à `a4_<langue>` dans le formulaire du Jeu du jour ; les anciens noms sont encore lus par l'action `saveQuestion`.

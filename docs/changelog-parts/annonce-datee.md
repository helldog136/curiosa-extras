## Bannière d'annonce : une annonce qui commence et finit toute seule

*Pour Curiosa 0.6.0 ou plus. Module touché : Bannière d'annonce 1.1.0.*

### Nouveautés
- « Limiter dans le temps », sous « Plus d'options » : un début et une fin en un seul champ, avec la phrase « Du 1er décembre au 24 décembre » pour vérifier. « Chaque année » est possible.
- Hors de ces dates, le bandeau, la note d'accueil et l'annonce proposée aux overlays disparaissent d'eux-mêmes.
- Sans dates, rien ne change : vos réglages sont conservés.
- Des exemples sous le texte, l'adresse et la note d'accueil.

### Pour les développeurs
- Réglage `period`, décision prise à l'affichage dans le fuseau du site (`ctx.timezone` s'il existe, sinon celui de la machine), aucun minuteur.

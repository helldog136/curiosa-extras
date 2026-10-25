### Améliorations

- **« Autres plateformes » 1.1.0 règle lui-même la façon dont ses liens s'ouvrent.** Les icônes qui mènent directement à OnlyFans, Mym ou une autre plateforme s'ouvrent dans un nouvel onglet (votre site reste ouvert), sans dire à la plateforme quelle page de votre site la visite quitte, seulement son adresse principale. Celles qui passent par la page d'avertissement 18+ restent dans le même onglet. Il n'y a rien à régler.

### Pour les développeurs

- `platform-links` 1.1.0 déclare `rel`, `referrerPolicy` et `target` dans son export `social.link` (contrat du cœur 0.2.13) : lien direct `rel="noopener nofollow"`, `strict-origin-when-cross-origin`, `_blank` ; lien vers la page `/go` du module `rel="noopener"`, `_self`. Le bouton de la page `/go` utilise les mêmes constantes (`OUTBOUND_REL`, `OUTBOUND_REFERRER`). `minCore` passe à 0.2.13 ; sur un cœur plus ancien, ces champs sont ignorés sans danger.

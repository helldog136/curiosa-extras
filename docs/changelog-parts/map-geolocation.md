## Carte 1.0.1 : « Près de moi » fonctionne vraiment

## Améliorations
- La position n'est demandée qu'après un clic sur « Près de moi », et seulement si le module Carte est installé. Sans cette permission le navigateur refuse la position, même après le clic ; avec elle, il la demande normalement. Rien n'est envoyé au site ni gardé.
- Il faut Curiosa 0.2.12 ou plus.

## Pour les développeurs
- `map` 1.0.1 : permission `visitor.geolocation` ajoutée au manifeste et `minCore` 0.2.12. Le cœur 0.2.12 envoie `Permissions-Policy: geolocation=(self)` seulement si un module installé déclare cette permission. `navigator.geolocation` n'est appelé que dans le gestionnaire de clic de `scripts/map-page.js`.
- Tests : `map-module` (permissions = capacités utilisées, y compris la position ; aucun appel avant le clic ; phrase de documentation).

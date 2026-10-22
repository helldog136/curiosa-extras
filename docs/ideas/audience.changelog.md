# Participation 1.0.0

## Nouveautés
- Un nouveau module, **Participation**, qui s'installe tout seul avec les animations de stream qui en profitent (Sondages pour commencer).
- **Un pseudo sans compte** : chaque personne peut choisir son pseudo (unique, sans insulte grâce à une liste de mots interdits que vous modifiez), ou ne pas en choisir. Une page « Participation » lui permet de l'effacer, avec toutes ses données, d'un bouton.
- **Une voix par personne** et des limites contre les abus, sans jamais garder l'adresse de personne.
- **Une télécommande pour votre téléphone** : une page secrète avec de GROS boutons (lancer, arrêter, suivant, « A ou B ? », sourdine, vider la salle). Un code à flasher dans l'administration pour l'ouvrir sans rien taper, une nouvelle adresse en un clic si quelqu'un l'a vue.
- **Un écran qui se met à jour doucement** : l'écran de votre stream et les pages publiques se rafraîchissent sans surcharger le site, et ralentissent quand il y a beaucoup de monde ou quand rien ne change.
- **Un journal** de qui a décidé quoi et quand, et un ménage automatique : personnes inactives effacées après 14 jours, journal après 30 jours.
- L'assistant IA peut lire les salles et le journal, mettre quelqu'un en sourdine ou vider une salle (ces deux gestes ne sont jamais autorisés d'office).

## Améliorations
- Tout est en français et en anglais, utilisable au doigt (boutons de 44 à 76 px), avec des erreurs sous le champ et un exemple.
- Les personnes en sourdine restent en sourdine si elles reviennent ; vider une salle est immédiat.

## Pour les développeurs
- Module `audience` 1.0.0, `minCore` 0.2.5, type widget, instance unique, droits `remote.use` et `moderate`.
- Offre `audience.session` v1 (16 méthodes, `mute` et `clearRoom` en `callerRights`) ; demande `audience.remote` en facultatif (offert `each` par les modules d'animation : `describe`, `press`, `tick`). Contrat exécutable : `tests/contract-ext/audience.md` + `audience.contract.mjs` + `tests/helpers/fakeAudience.mjs`.
- Stockage : `rooms` (≤ 200), `p-<salle>-<génération>` (personnes ≤ 5 000, index des pseudos), `c-<salle>-<génération>` (voix ≤ 20 000), `live` (≤ 100), `audit` (≤ 500), `meta`. Vider une salle = nouvelle génération et nouveau sel ; les anciennes collections partent au ménage.
- Aucun `fetch`, aucun minuteur ni tâche de fond ; limiteur en mémoire à sel quotidien ; un verrou d'écriture par instance.

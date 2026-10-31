## Participation 1.2.0 : le tirage au sort, depuis le chat ou depuis le site

*Pour Curiosa 0.5.0 ou plus. Module touché : Participation 1.2.0. Le Bot Twitch 1.5.0 (même version du dépôt) peut s'y brancher pour les inscriptions par le chat.*

### Nouveautés

- **Un tirage au sort dans Participation.** Nouvel onglet **Tirage au sort** : un titre, un mot pour le chat (facultatif : « !cadeau » ou « cadeau », c'est pareil), qui peut s'inscrire depuis le chat (tout le monde, personnes abonnées, équipe de modération), l'inscription depuis le site (oui ou non) et une durée de 1 à 120 minutes (ou « jusqu'à ce que je ferme »). Le tirage passe d'**ouvert** à **fermé** puis **tiré au sort**, et se ferme tout seul à l'heure prévue sans qu'aucun minuteur ne tourne.
- **Un vrai tirage au sort.** Chaque personne inscrite a exactement la même chance, une personne déjà tirée ne l'est jamais deux fois, on peut tirer plusieurs personnes d'un coup (1 à 10) et tirer encore. « Tirer une autre personne » met de côté une personne absente et en tire une autre.
- **Une page d'inscription sur votre site**, `/participation/tirage` : un champ pseudo et un bouton « Je participe ». Les erreurs s'affichent sous le champ, avec un exemple. Mêmes protections que le reste de Participation : mêmes règles de pseudo, une seule inscription par navigateur, sourdine, limites par connexion. Aucun cookie de plus.
- **Dans le chat**, le Bot Twitch (ou tout module qui lit un chat) inscrit les personnes grâce au nouveau service `audience.draw`.
- **Sur la télécommande et dans le dock OBS** : trois boutons, « Ouvrir le tirage », « Fermer » et « Tirer une personne au sort ». Fermer et Tirer demandent de cliquer encore pour confirmer.
- **À l'écran du stream**, les personnes tirées s'affichent 20 secondes. Une adresse secrète pour une source navigateur OBS, et un **élément « Tirage au sort »** pour les pages d'overlay : le tirage en cours (titre, mot à taper, nombre d'inscriptions, compte à rebours) puis les personnes tirées. Option « Garder les personnes tirées au sort à l'écran ». Il s'adapte à la taille du cadre, suit le style commun de la page d'overlay et a un contenu d'exemple en mode test.
- **Une liste réservée à l'administration** : la liste des personnes inscrites n'est visible que de l'équipe d'administration (50 par page), avec « Retirer cette personne » (avec ou sans sourdine) et « Vider le tirage ». L'historique garde les 20 derniers tirages (titre, date, pseudos des personnes tirées, nombre d'inscriptions).
- **Pour l'assistant IA** : `draw_status` (lecture), `draw_open`, `draw_close` et `draw_pick` (écritures, jamais accordées d'office). Nouveau droit « gérer le tirage au sort », réservé à l'administration par défaut.

### Améliorations

- **Vie privée** : une inscription garde le pseudo, l'origine et la date, rien d'autre ; l'identifiant du chat n'est jamais gardé en clair. **La liste est effacée 24 heures après la fermeture** (à la lecture, par petites tranches).
- Le journal de Participation dit qui a décidé quoi (ouverture, fermeture, tirage, personne retirée, tirage vidé), depuis l'administration, la télécommande, le dock ou l'assistant.
- Rien ne change pour ce que vous aviez : pseudos, salles, sourdine, télécommande, dock, adresses secrètes et données sont identiques. Aucune migration ; les nouvelles données sont créées au premier tirage. La télécommande montre un panneau de plus, « Tirage au sort », après ceux de vos autres modules.

### Pour qui développe

- `minCore` passe à 0.5.0 (clé `overlayElements`), `apiVersion` 2 inchangé, aucune migration (`dataVersion` inchangé). Nouveau service `audience.draw` version 1 (`status` en lecture seule, `enter` ; `status` donne aussi un `id` opaque qui change à chaque nouveau tirage et quand la liste est vidée), contrat dans `tests/contract-ext/audience.md` et double `tests/helpers/fakeAudienceDraw.mjs`. Nouveaux fichiers `draw.mjs`, `drawlib.mjs` et `drawview.mjs`, tous chargés avec `?v=` (mise à jour à chaud). Le script du navigateur de Participation passe en révision 2 (page d'inscription).
- Données : collection `draws` (le tirage en cours sous la clé `cur`, l'historique sous `h-<id>`), `de-<id>-<n>` pour les inscriptions, entrée `draw-cfg` dans `meta` (secret de l'écran, file d'effacement). Les personnes (pseudo, sourdine) sont celles de la salle `draw`.
- Tests : `tests/audience-draw.test.mjs` (28 tests : service, cycle, tirage uniforme, exclusion, effacement à 24 h, historique, télécommande et dock, page publique avec son script, administration, outils de l'assistant, textes) et `tests/audience-draw-overlay.test.mjs` (12 tests : élément, adresse, page, direct, navigateur factice, `assertMultiReaders`). Versions et nombres de panneaux ajustés dans `audience*.test.mjs`.

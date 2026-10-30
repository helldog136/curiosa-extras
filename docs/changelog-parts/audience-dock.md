## Participation 1.1.0 : la télécommande en dock pour OBS, avec la même adresse secrète

*Pour Curiosa 0.2.5 ou plus. Module touché : Participation 1.1.0.*

### Nouveautés

- **La télécommande de Participation existe maintenant en « dock » pour OBS.** C'est la même télécommande, avec toutes ses fonctions (lancer, arrêter, suivant, « A ou B ? » en un geste, mettre une personne en sourdine, vider une salle, et tout ce que Sondages ou les futurs modules y ajoutent), dans un petit panneau étroit à placer dans OBS. Elle se manie à la souris comme au clavier, sur fond sombre, avec des boutons assez grands pour être cliqués sans viser.
- **Une seule adresse secrète.** L'adresse du dock est celle du téléphone avec `&dock=1` à la fin : pas de deuxième secret à garder. Dans l'onglet « En direct » de Participation, elle s'affiche juste sous celle du téléphone, avec un bouton « Copier » et trois étapes pour OBS : **Docks**, **Docks de navigateur personnalisés**, un nom, l'adresse, **Appliquer**. Vous pouvez aussi l'ouvrir dans un onglet.
- **« Créer une nouvelle adresse » change tout d'un coup.** Le téléphone et le dock cessent de marcher ; il suffit de rouvrir la télécommande sur le téléphone et de coller la nouvelle adresse du dock dans OBS. Le texte de la case à cocher et le message de réussite le disent.
- **Sondages (et les modules à venir) apparaissent dans le dock sans rien changer de leur côté**, avec les mêmes boutons, le même formulaire « A ou B ? » et les mêmes messages d'erreur sous les champs.

### Améliorations

- **Au clavier, le bouton choisi garde le focus** quand la télécommande se met à jour toute seule (téléphone comme dock) : on peut enchaîner « Suivant », « Suivant » avec Tab puis Entrée sans reprendre la main.
- Dans le dock, un geste risqué (« Arrêter », « Vider la salle ») demande de **cliquer encore** pour confirmer (et non « toucher » : la souris n'est pas un doigt).
- La page de la télécommande (téléphone et dock) n'accepte plus que son propre script et ne peut parler qu'à votre site ; la police du thème est vérifiée avant d'être utilisée.
- Rien ne change pour ce que vous aviez : l'adresse du téléphone, les droits (« voir les adresses secrètes de la télécommande et les changer », « modérer »), les réglages et les données sont ceux d'avant. Aucune migration.

### Pour les développeurs

- `minCore` 0.2.5 et `apiVersion` 2 inchangés, aucun nouveau droit, aucune donnée ni migration (`dataVersion` inchangé). Route `remote` avec `&dock=1` (`wantsDock`, `remoteResponse`), même script `REMOTE_JS`, mêmes routes `remote-state` et `remote-press`.
- Tests : `tests/audience-dock.test.mjs` (nouveau, 11 tests, avec un navigateur factice qui fait tourner le vrai script : `tests/helpers/remoteDom.mjs`) ; `tests/audience.test.mjs` ajusté (version).

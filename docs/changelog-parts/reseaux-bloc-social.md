## Réseaux sociaux : le Catalogue reconnaît l'adresse avant l'installation

*Chaque module de réseau social décrit maintenant comment reconnaître l'adresse de son profil, et le Catalogue le recopie : Curiosa 0.6.2 reconnaît l'adresse collée avant d'installer le réseau. Pour Curiosa 0.6.0 ou plus (rien ne change pour un cœur plus ancien). Modules touchés : les 20 réseaux et Annonces Discord (version corrective).*

### Nouveautés

- **Le Catalogue sait reconnaître votre adresse avant l'installation.** Les 20 réseaux déclarent leurs sites, la forme de leurs adresses et un exemple. Avec Curiosa 0.6.2, le nom seul, l'adresse sans https ou le lien de partage mènent au bon réseau sans que vous ayez rien installé.
- **Rien ne change pour vous aujourd'hui** sur un cœur 0.6.x : les modules se comportent comme dans la 1.31.0.

### Pour les développeurs

- **Bloc `social` de `module.json`**, écrit par `node scripts/gen-social.mjs` depuis la même table que le bloc `profile()` : `name`, `icon`, `hosts`, `template`, `example`, et au besoin `handle`, `tag`, `aliases`, `forms`, `shapes`, `fediverse`. `scripts/build-index.mjs` le recopie dans `catalogue/index.json` (60 Ko au total). Un cœur plus ancien ignore la clé.
- **`tests/social-block.test.mjs`** : le bloc est identique à la table et au catalogue ; quand le cœur testé contient `src/core/socialRecognize.ts` (0.6.2), il vérifie que `recognizeOne` du cœur donne **le même résultat que le `profile()` du module** sur 37 saisies, pour les 20 réseaux, et lit un texte à plusieurs adresses ; sinon ces deux tests sont passés.
- Versions : dépôt 1.34.0 (le lot 1 est la 1.31.0) ; les 20 réseaux et Annonces Discord +0.0.1.

# Mises à jour à chaud : la règle des fichiers voisins

**Règle.** Dans un module, le serveur n'importe jamais un fichier voisin avec `import … from "./x.mjs"`. Il écrit :

```js
const v = new URL(import.meta.url).search;            // « ?v=<version> » du fichier principal
const { clean, LIMITS } = await import(`./x.mjs${v}`); // ou : await import(new URL(`./x.mjs${q}`, import.meta.url).href)
```

Cela vaut pour `export … from "./x.mjs"` et `import "./x.mjs"`. Les imports de modules Node (`node:fs`) et de paquets ne changent pas. Les fichiers envoyés **au navigateur** (`scripts/*.js`, `web/`, les `.mjs` servis tels quels) gardent leurs `import` statiques : le navigateur en a besoin.

## Pourquoi

Quand on met un module à jour **sans redémarrer le site**, le cœur remplace les fichiers du dossier puis importe `index.mjs?v=<nouvelle version>`. Node garde en mémoire chaque adresse **déjà importée** : un `import … from "./source.mjs"` (sans `?v=`) retrouve l'ADRESSE de l'ancienne version et reprend l'ANCIEN `source.mjs`, sans les fonctions ajoutées depuis. Le nouveau code ne trouve plus ce qu'il cherche et le module devient « impossible à charger ». C'est ce qui est arrivé à Statut du live (1.16.0). Les tests habituels ne le voient pas : chacun charge le module dans un processus neuf.

Limite : un fichier importé en `await import(…)` doit lui-même importer ses voisins de la même façon (c'est la règle ci-dessus, appliquée partout). Pas de dépendance circulaire entre fichiers du module : chacun attend l'autre.

## Ce que vérifie `tests/hot-update-all.test.mjs`

Pour **chaque** module du dépôt, sans rien à écrire :

1. **Analyse du code** (sans l'exécuter). Elle suit les fichiers que le serveur charge à partir de `main`, commentaires et chaînes mis à part, imports sur plusieurs lignes compris. Elle refuse un import relatif statique, un `import()` relatif sans version, un fichier importé qui n'existe pas. Un fichier `.mjs` qui contient un import statique mais que le serveur ne charge pas (il est envoyé au navigateur) doit être déclaré dans `BROWSER_ONLY` du test, avec la raison.
2. **Rejeu de la mise à jour N-1 → N** (modules à plusieurs fichiers serveur), dans UN SEUL processus, comme sur un site qui tourne :
   - la version précédente est extraite de l'étiquette git la plus récente où la version du module diffère (`git archive`, dans un dossier sous `TMPDIR`), chargée avec `?v=ancien` et utilisée (pages, routes, administration, outils MCP, avec le faux contexte de `testsupport`) pour créer un état ;
   - ses fichiers sont remplacés par ceux de la version courante dans le même dossier, puis la version courante est chargée avec `?v=nouveau` et utilisée avec cet état ;
   - un **témoin** (la version courante, dossier neuf, même état) dit quels fichiers doivent être évalués : il y a échec si l'un d'eux est resté à l'ancienne version, a été évalué sans `?v=`, ou si une exception apparaît que le témoin n'a pas.
3. Les deux listes blanches ne gardent rien d'inutile (une entrée sans objet fait échouer le test).

Sans historique git (pas d'étiquettes, clone partiel), le rejeu se fait sur la version courante contre elle-même, et le test « historique git disponible » est **sauté avec sa raison**. La CI récupère tout l'historique (`fetch-depth: 0`) et met `HOT_UPDATE_REQUIRE_HISTORY=1`, qui transforme ce saut en échec. En local : `git fetch --tags --unshallow`.

## Si le test échoue

- « import statique … » : appliquez la règle ci-dessus (fichier et ligne sont indiqués), puis augmentez la version patch du module.
- « gardé en mémoire à l'ancienne version » ou « importé sans la version » : un import n'a pas la version (ou la variable `v` / `q` est vide).
- Un cas **légitime** (fichier partagé avec le navigateur, par exemple) : `ALLOWED_STATIC` dans le test, avec une vraie raison. Aujourd'hui : `maze-overlay/web/generate.js`.

Un test propre au module reste utile pour ses comportements (modèles : `tests/live-status-update.test.mjs`, `tests/stream-story-update.test.mjs`) ; celui-ci garantit le minimum partout.

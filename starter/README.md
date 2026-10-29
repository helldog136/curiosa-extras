# Mon module

Une phrase pour dire à quoi sert votre module, pour quelqu'un qui n'a aucun bagage technique. (Ce fichier est affiché à la personne **avant** l'installation : c'est votre vitrine.)

Ce module de départ affiche un court message d'accueil sur la page d'accueil du site.

## Réglages

- **Message d'accueil** : la phrase affichée. Si vous la videz, le module affiche « Bienvenue ! ».
- **Signature** (facultatif) : une ligne sous le message.

## Ce que le module demande

Afficher une section sur la page d'accueil. Rien d'autre : il ne stocke rien, ne contacte aucun site et ne collecte aucune donnée sur votre public.

## Installer sur votre site Curiosa

1. Dans l'administration, ouvrez le menu de gauche et cliquez sur **« Afficher les réglages avancés »** (l'installation depuis une adresse n'existe que là), puis ouvrez **Extensions → Catalogue**.
2. Ouvrez **Installer un dépôt personnel (non vérifié)**, collez l'adresse ci-dessous et cliquez sur **Voir le README avant d'installer**.

   ```
   https://github.com/<votre-compte>/<votre-depot>#v1.0.0
   ```

3. Lisez ce que le module demande, cochez la case « Je comprends… » puis **Installer sur mon site**. Le module est installé et actif : cliquez sur **Mettre en place** pour créer son premier bloc.

Les mises à jour se font depuis **Extensions → votre module → Chercher une mise à jour**.

## Licence

MIT (voir `LICENSE`).

---

## Pour les développeurs (à supprimer avant de publier)

Ce dossier est un dépôt de module **complet**. Copiez-le dans un nouveau dépôt git (le fichier `module.json` doit être à la **racine** du dépôt) et changez, dans cet ordre : l'identifiant `id` (à vous pour toujours), `author`, `license`, les textes, `LICENSE`, puis cette page.

```bash
git clone https://github.com/<vous>/<votre-depot> mon-module && cd mon-module   # après avoir copié ces fichiers dedans
git clone --branch v0.3.0 --depth 1 https://github.com/helldog136/Curiosa ../Curiosa   # le cœur, à côté (prenez la dernière étiquette vX.Y.Z)
(cd ../Curiosa && npm ci --omit=dev --ignore-scripts && npx prisma generate)            # une fois : prépare le kit de test, ne lance pas le site
export CURIOSA_DIR=$PWD/../Curiosa
npm test            # conformité + vos tests
npm run check       # le rapport de conformité, lisible
git tag v1.0.0 && git push --tags
```

Le guide complet : `docs/PUBLIER-SON-MODULE.md` du dépôt du cœur (Curiosa).

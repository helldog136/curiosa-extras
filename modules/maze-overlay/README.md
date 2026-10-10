# Labyrinthe 3D (overlay OBS) — module communautaire de Curiosa

Un labyrinthe rétro en raycasting pour OBS : le personnage se promène et s'arrête devant des
affiches construites à partir de votre contenu. Porté depuis un labyrinthe 3D existant.

**Ce module n'est pas livré avec le cœur** : il s'installe depuis son dépôt git
(Modules → Installer un module). Il vit ici, dans `modules-community/`, en attendant son propre
dépôt (il est autonome : `module.json`, `index.mjs`, `web/`).

## Alimenter le labyrinthe

Il ne connaît ni les blogs ni les sponsors : il digère deux sujets, et l'admin choisit
quelles instances l'alimentent (page de l'instance → *Sources de données*).

| Sujet | Source |
|---|---|
| `core.entry` | Les entrées publiées de n'importe quelle instance à contenu (blog, codes promo…). Filtrable par étiquette. |
| `maze.poster` | Un format à lui : `title`, `text`, `url`, `image`, `kind` (`code`/`article`/`clip`/`video`/`short`), `badge`. À fournir depuis un module « clips Twitch » ou « vidéos YouTube » (`provides: [{ "topic": "maze.poster" }]`). |

Un `kind` `clip` / `video` / `short` avec une URL Twitch / YouTube joue la vidéo dans la carte « focus ».

## Utiliser dans OBS

Ajoutez une instance, puis collez l'URL affichée sur sa page (`https://votre-site/overlays/<clé>`)
dans une *Source navigateur* OBS (1920×1080).

## Mode développeur (tests)

Réglage avancé « Mode développeur » de l'instance. Une fois activé, l'URL de l'overlay accepte des
paramètres qui **manipulent le hasard** — rien d'autre n'est touché :

| Paramètre | Effet |
|---|---|
| `?seed=42` | graine : même labyrinthe et même trajet à chaque chargement |
| `?luck=always` / `never` / `0.3` | issue des tirages « s'arrêter devant une affiche ? » |
| `?fast=1` | les délais tirés au hasard (entre deux arrêts) prennent leur minimum |
| `?dev=1` | raccourci : `luck=always` + `fast=1` |

Les paramètres se combinent (`?dev=1&seed=7`). Désactivé (par défaut), ils sont ignorés. En mode
dev, `window.__MAZE_DEV__` expose la graine et une empreinte du tracé pour les tests automatiques.
Tous les tirages passent par `web/random.js` (jamais `Math.random` directement).

## Différences avec la version d'origine

- Le tracé est généré à chaque chargement (la carte figée et son éditeur ne sont pas portés).
- Les clips Twitch / vidéos YouTube ne sont plus récupérés par l'overlay lui-même : ils doivent venir d'un module fournisseur de `maze.poster`.

## Tracé personnalisé (éditeur de carte)

Par défaut, le labyrinthe est généré au hasard à chaque chargement. Dans l'admin de l'instance (section *Tracé du labyrinthe*), l'éditeur de grille permet de dessiner son propre tracé : choisissez un pinceau (mur, chemin, emplacement d'affiche, portail), cliquez ou glissez sur les cases, redimensionnez (5 à 41), puis **Enregistrer le tracé**. Tant qu'un tracé est enregistré, c'est toujours lui qui s'affiche. Un tracé sans aucune case de chemin est refusé.

Rien n'est enregistré avant *Enregistrer le tracé* (ni la barre flottante, ni l'avertissement en quittant la page ne sont oubliés) :

- **Générer un nouveau tracé au hasard** met un tracé aléatoire dans l'éditeur, à retoucher ou à garder.
- **Supprimer le tracé et randomiser à chaque affichage** met la grille de côté ; l'enregistrement supprime alors le tracé enregistré et le labyrinthe redevient aléatoire à chaque affichage.
- **Annuler les modifications** revient au tracé enregistré.

Ces fonctions reposent sur les propriétés `generateAction`, `autoLabel`, `autoNotice` et `autoActive` du bloc générique `gridEditor` : le module demande donc le cœur 0.1.10 (`minCore`). L'action `generate` renvoie un tracé sans l'enregistrer ; `saveMap` reçoit soit une grille, soit `auto: "true"`.

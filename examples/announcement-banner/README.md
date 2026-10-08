# Announcement banner — module d'exemple pour Curiosa

Affiche une bannière d'annonce (une par langue) et une note sur la page d'accueil.
C'est le plus petit module utile : `module.json` + `index.mjs`.

## Installer

Dans l'admin : **Modules → Installer un module**, puis l'adresse de ce dépôt :

```
https://github.com/<vous>/<ce-depot>
```

Le module s'installe *désactivé*. Activez-le, puis configurez-le depuis son entrée dans le menu.

## Fichiers

| Fichier | Rôle |
|---|---|
| `module.json` | Manifeste : identité, version, formulaire de réglages (généré par l'admin), capacités déclarées |
| `index.mjs` | Code : `slots` (blocs ajoutés au site), `routes`, `filters`, `adminPanel`, `hooks` |
| `locales/*.json` | Textes du module par langue (`ctx.t("clé")`) — optionnel |

Voir [docs/MODULES.md](../../docs/MODULES.md) pour toute l'API.

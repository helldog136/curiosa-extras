# Announcement banner — module d'exemple pour Curiosa

Affiche une bannière d'annonce (une par langue) et une note sur la page d'accueil.
C'est le plus petit module utile : `module.json` + `index.mjs`.

## Installer

Dans l'admin : **Extensions → Catalogue** → « Bannière d'annonce » → **Installer sur mon site**. Le module est installé et actif ; cliquez sur **Mettre en place** pour créer la bannière, puis réglez-la.

(Un module d'un dépôt personnel, lui, s'installe par **Installer un dépôt personnel (non vérifié)**, en mode avancé : `https://github.com/<vous>/<depot>#v1.0.0`.)

## Fichiers

| Fichier | Rôle |
|---|---|
| `module.json` | Manifeste : identité, version, formulaire de réglages (généré par l'admin), capacités déclarées |
| `index.mjs` | Code : `slots` (blocs ajoutés au site), `routes`, `filters`, `adminPanel`, `hooks` |
| `locales/*.json` | Textes du module par langue (`ctx.t("clé")`) — optionnel |

Voir [docs/MODULES.md](../../docs/MODULES.md) pour toute l'API.

# Announcement banner — module d'exemple pour Curiosa

Affiche une bannière d'annonce (une par langue) et une note sur la page d'accueil.
C'est le plus petit module utile : `module.json` + `index.mjs`.

## Installer

Dans l'admin : **Extensions → Catalogue** → « Bannière d'annonce » → **Installer sur mon site**. Le module est installé et actif ; cliquez sur **Mettre en place** pour créer la bannière, puis réglez-la.

(Un module d'un dépôt personnel, lui, s'installe par **Installer un dépôt personnel (non vérifié)**, en mode avancé : `https://github.com/<vous>/<depot>#v1.0.0`.)

## Limiter dans le temps (version 1.1.0, Curiosa 0.6.0 ou plus)

Sous **Plus d'options**, « Limiter dans le temps » est **un seul champ** : « Du [date] au [date] », avec « Chaque année » en option et la phrase qui dit ce qui a été compris (« Du 1er décembre au 24 décembre, chaque année »). Le réglage est de type `period`.

- **Vide (le cas de départ)** : rien ne change, le bandeau s'affiche comme avant. Les réglages déjà enregistrés sont conservés tels quels.
- **Le premier et le dernier jour sont inclus**, de 00:00 à 23:59. Hors période (pas encore commencée, ou terminée), le bandeau, la note d'accueil et l'élément proposé aux overlays ne sont pas affichés ; « Afficher la bannière » reste prioritaire.
- **Aucun minuteur.** La décision se prend à chaque affichage de la page, d'après l'heure du serveur : rien ne tourne en arrière-plan, et une annonce programmée apparaît d'elle-même le jour venu.
- **Heure d'été** : on compare des jours du calendrier, pas des heures ; un jour de 23 ou de 25 heures compte comme un jour entier.
- **Fin avant le début** : le cœur refuse la valeur et l'écrit sous le champ, avec un exemple. Le contrôle demande toujours les deux dates : pour « jusqu'au 24 décembre », mettez la date du jour comme début.
- **Fuseau** : le jour change à minuit dans le fuseau du site. Le cœur 0.6.x ne le donne pas encore aux modules : le module lit `ctx.timezone` s'il existe, sinon le fuseau de la machine, qui est aussi le repli du cœur quand le fuseau du site n'est pas réglé.
- Une valeur illisible ne cache jamais l'annonce.

Pour lire une période dans votre propre module, voir `isActive(period, now, tz)` dans `index.mjs` (voir aussi « Contrôles `period`, `datetime`, `duration` » dans [docs/MODULES.md](../../docs/MODULES.md)).

## Fichiers

| Fichier | Rôle |
|---|---|
| `module.json` | Manifeste : identité, version, formulaire de réglages (généré par l'admin), capacités déclarées |
| `index.mjs` | Code : `slots` (blocs ajoutés au site), `routes`, `filters`, `adminPanel`, `hooks` |
| `locales/*.json` | Textes du module par langue (`ctx.t("clé")`) — optionnel |

Voir [docs/MODULES.md](../../docs/MODULES.md) pour toute l'API.

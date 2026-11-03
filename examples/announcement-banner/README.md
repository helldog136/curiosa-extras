# Announcement banner — module d'exemple pour Curiosa

Affiche une bannière d'annonce (une par langue) et une note sur la page d'accueil.
C'est le plus petit module utile : `module.json` + `index.mjs`.

## Installer

Dans l'admin : **Extensions → Catalogue** → « Bannière d'annonce » → **Installer sur mon site**. Le module est installé et actif ; cliquez sur **Mettre en place** pour créer la bannière, puis réglez-la.

(Un module d'un dépôt personnel, lui, s'installe par **Installer un dépôt personnel (non vérifié)**, en mode avancé : `https://github.com/<vous>/<depot>#v1.0.0`.)

## Limiter dans le temps (version 1.1.0 ; une seule date possible depuis la 1.2.0, Curiosa 0.6.4 ou plus)

Sous **Plus d'options**, « Limiter dans le temps » est **un seul champ** avec la phrase qui dit ce qui a été compris. **Une seule date suffit** :

| Vous choisissez | La phrase sous le champ | Le bandeau est affiché |
|---|---|---|
| un début seulement | « À partir du 1er décembre 2026 » | dès le 1er décembre, sans fin |
| une fin seulement | « Jusqu'au 24 décembre 2026 » | dès maintenant, jusqu'au 24 décembre à minuit |
| les deux dates | « Du 1er décembre 2026 au 24 décembre 2026 » | du 1er au 24 décembre |
| les deux, avec « Chaque année » | « Du 1er décembre au 24 décembre, chaque année » | tous les ans à ces dates (peut passer le 31 décembre) |

- **Vide (le cas de départ)** : rien ne change, le bandeau s'affiche comme avant.
- **Valeurs déjà enregistrées** : elles sont lues exactement comme en 1.1.0 (deux dates, « chaque année »), sans aucune migration. Les valeurs « début seul » (`2026-12-01/`) et « fin seule » (`/2026-12-24`) n'existaient pas avant : un cœur plus ancien les refusait.
- **Le premier et le dernier jour sont inclus**, de 00:00 à 23:59. Hors période (pas encore commencée, ou terminée), le bandeau, la note d'accueil et l'élément proposé aux overlays ne sont pas affichés ; « Afficher la bannière » reste prioritaire.
- **Aucun minuteur.** La décision se prend à chaque affichage de la page : rien ne tourne en arrière-plan, et une annonce programmée apparaît d'elle-même le jour venu.
- **Heure d'été** : on compare des jours du calendrier, pas des heures ; un jour de 23 ou de 25 heures compte comme un jour entier.
- **Fin avant le début** : le cœur refuse la valeur et l'écrit sous le champ, avec un exemple.
- **Fuseau** : le jour change à minuit dans le fuseau du site, que le cœur 0.6.4 donne aux modules (`ctx.timezone`). Si un contexte ne le donne pas ou le donne inconnu, le module prend le fuseau de la machine, comme le cœur quand le fuseau du site n'est pas réglé.
- Une valeur illisible ne cache jamais l'annonce.

Pour lire une période (y compris ouverte, clé `openEnded`) dans votre propre module, voir `isActive(period, now, tz)` dans `index.mjs` (voir aussi « Contrôles `period`, `datetime`, `duration` » dans [docs/MODULES.md](../../docs/MODULES.md)).

## Fichiers

| Fichier | Rôle |
|---|---|
| `module.json` | Manifeste : identité, version, formulaire de réglages (généré par l'admin), capacités déclarées |
| `index.mjs` | Code : `slots` (blocs ajoutés au site), `routes`, `filters`, `adminPanel`, `hooks` |
| `locales/*.json` | Textes du module par langue (`ctx.t("clé")`) — optionnel |

Voir [docs/MODULES.md](../../docs/MODULES.md) pour toute l'API.

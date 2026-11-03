# Jaquettes de jeux

Ce module **trouve la jaquette d'un jeu vidéo** pour les autres modules de votre site (*Planning*, *Story d'annonce*, *Suggestions de jeux*…), **la copie sur votre site** et la garde, pour qu'elle reste affichée même quand une source est en panne. Il retient aussi vos choix quand une jaquette n'est pas la bonne.

**Rien n'est obligatoire.** Sans rien régler, le module fonctionne : il cherche chez Steam. Un code Rawg gratuit (en premier) et le Connecteur Twitch (en dernier secours) élargissent les résultats, mais ne sont jamais un blocage : une source qui manque est simplement une source de moins, sans message d'erreur.

## Les sources, dans l'ordre
Pour un titre, le module interroge les sources **dans cet ordre**, et s'arrête à la première réponse **sûre** (un titre quasi identique, sans rival aussi bon : c'est la vérification habituelle, `match.mjs`). Si aucune réponse n'est sûre, il garde la meilleure réponse incertaine de la première source qui en a une, et note le titre dans « Jaquettes à vérifier ».

| # | Source | Ce qu'il faut | Image | Pourquoi à cette place |
|---|---|---|---|---|
| 1 | **Rawg** | un code gratuit (facultatif) | image du jeu, 600 × 400 (paysage) | La plus large (toutes plateformes) et celle que vos jaquettes déjà trouvées utilisent : rien ne change pour elles. Copie gardée 30 jours. |
| 2 | **Steam** (magasin) | rien : recherche publique, sans clé ni compte | jaquette **verticale** 600 × 900 (sinon l'image d'en-tête, paysage) | Toujours disponible, copie gardée 30 jours ; mais seulement les jeux vendus sur PC. |
| 3 | **Twitch** (jaquettes de boîte), **dernier secours** | le Connecteur Twitch, déjà réglé : **aucune clé de plus** | jaquette de boîte verticale, 285 × 380 | Une copie venue de Twitch ne peut être gardée que **24 heures** (leurs conditions), alors que les autres vivent 30 jours : mieux vaut qu'une jaquette durable passe avant. Twitch reste utile pour les jeux absents des deux premières. |

**Cadrage.** Les modules qui affichent une jaquette la placent dans une case de taille fixe (par exemple 120 × 160) : ce module ne recadre rien et ne mélange pas les formats. Steam donne une image verticale, comme Twitch (l'image d'en-tête paysage n'est qu'un repli, comme les images de Rawg, déjà paysage) ; c'est donc le même cadrage qu'avant pour les images de Rawg, et un cadrage vertical naturel pour les deux autres.

**Compromis assumé.** Mettre Twitch en dernier fait gagner de la durée (30 jours au lieu de 24 heures, donc moins de téléchargements et des adresses stables), au prix de jaquettes de boîte Twitch moins souvent choisies : Steam passe avant pour les jeux PC. Si vous préférez Twitch avant Steam, c'est l'ordre de `SOURCES` dans `hosts.mjs`.

Chaque source a **son propre disjoncteur** : après trois échecs d'affilée, elle fait une pause de 1, 2, 5 puis 15 minutes au plus (un seul essai de reprise à la fois) pendant que les autres continuent. Chaque source a 3 secondes au plus pour une page du site (5 secondes à l'administration), et une page n'attend jamais plus de 5 secondes en tout. « Indisponible » n'est dit que si **aucune** source disponible n'a répondu ; une panne n'est jamais retenue comme « pas de jaquette ».

**Sources étudiées et non retenues.** *IGDB* : elle utilise les mêmes identifiants d'application Twitch, mais le Connecteur ne les expose pas (par construction, il ne rend jamais un secret), et les jaquettes de boîte de Twitch **viennent d'IGDB** : elle n'apporterait que des images identiques, au prix d'un accès de plus. *OpenCritic* : une clé est exigée (vérifié : la réponse le dit). *SteamGridDB*, *Giant Bomb* : un compte et une clé sont demandés à ma connaissance (non vérifié ici : leurs adresses ont répondu par une redirection). *Wikipédia* : les jaquettes y sont en général des images à usage restreint ; je n'ai pas lu ses conditions pour cet usage, et le but est de ne prendre aucun risque légal.

## Ce que disent les conditions d'utilisation (lues le 3 novembre 2026)
- **Twitch** — *Twitch Developer Services Agreement* (version du 4 décembre 2024), lu en entier : les données et contenus de Twitch ne peuvent être gardés que **24 heures** (sauf autorisation écrite), il est interdit de les redistribuer, et il faut les mettre à jour. **Le module s'y plie** : une copie venue de Twitch n'est jamais gardée ni montrée plus de 24 heures, quel que soit le réglage de renouvellement ; elle est refaite à la demande suivante. C'est la raison pour laquelle Twitch est en dernier secours. **L'adresse de la copie ne devient jamais un 404 pour un jeu connu** (Suggestions de jeux la mémorise) : si une copie Twitch a plus de 24 heures, la route la refait à la demande (6 secondes au plus) puis la sert ; si Twitch ne répond pas à ce moment-là, la copie est effacée (la règle des 24 heures prime) et la réponse est un 404 propre, c'est-à-dire une image absente et jamais une erreur. Un repère inconnu donne aussi un 404. Pour Rawg et Steam, la route sert toujours l'ancienne copie et lance le renouvellement en même temps.
- **IGDB** — page « Account creation » de la documentation, lue : gratuit pour un usage non commercial avec les identifiants d'une application Twitch ; stocker et servir les données est permis. Non utilisé ici (voir plus haut).
- **Steam** — *Steam Web API Terms of Use* (juillet 2010), lues : elles visent l'API Web à clé. La recherche du magasin utilisée ici est publique, sans clé, et **n'est pas décrite** par ces conditions : je n'ai pas pu confirmer qu'elle est autorisée pour cet usage. Option la plus prudente retenue : appel du serveur à Steam (jamais du navigateur), 8 résultats par recherche, mémoire de 24 heures (« rien trouvé » : 1 heure), copie locale limitée (300 images au plus, 30 jours), jamais de revente, aucun logo ni marque de Steam. Si Valve refusait un jour cet usage, il suffit de couper « Utiliser le magasin Steam » dans les réglages avancés.
- **Rawg** — les conditions de l'API (rawg.io/apidocs) **n'ont pas pu être lues** : le site répondait par une erreur 522 pendant mes essais (c'est la panne dont il est question). Option la plus prudente retenue : usage du serveur à Rawg, copie locale limitée, jamais de revente. Une attribution à Rawg (lien visible vers rawg.io) est habituellement exigée : elle est citée ici et dans la fiche du module, mais ce module ne peut pas l'ajouter aux pages des modules qui affichent les jaquettes.

## Pour commencer (facultatif)
Pour élargir les résultats avec Rawg :
1. Créez un compte gratuit sur **rawg.io/apidocs** et copiez votre code d'accès.
2. Ouvrez l'onglet **Réglages** de ce module et collez-le dans « Code d'accès gratuit Rawg ».
3. Revenez sur l'onglet principal et cliquez sur **« Tester le code »**.

Pour ajouter les jaquettes de boîte de Twitch (en dernier secours) : installez et réglez le **Connecteur Twitch** (Jaquettes de jeux n'y demande rien d'autre).

**Vous aviez déjà un code Rawg sur votre site ?** Rien à faire : il est repris tout seul. Les adresses « Ce n'est pas le bon jeu ? » déjà publiées continuent de marcher.

## Votre public ne contacte jamais ces services
Le **site** (jamais le navigateur de la personne qui visite) télécharge l'image choisie, une fois, la garde dans son stockage (donc dans la sauvegarde) et la sert depuis sa propre adresse, `/m/<clé>/cover/<repère>`. Règles : https, hôte et chemin connus pour chaque source (liste fermée, `hosts.mjs`), sans redirection suivie, 300 Ko au plus, type lu dans les premiers octets (PNG, JPEG ou WebP, jamais SVG). L'adresse ne vient jamais de la personne qui visite : le repère de 16 caractères ne désigne qu'une copie déjà faite. Pas de cookie, pas de paramètre.
- **Paresseux, sans minuteur** : la copie est lancée quand une jaquette est demandée et absente, trois à la fois au plus. Pas encore prête, la jaquette est « indisponible pour l'instant » (jamais « aucune jaquette », jamais une erreur visible) et elle sera là à la demande suivante.
- **Limites** : 300 copies et 20 Mo au plus ; la plus ancienne fait place.
- **Renouvellement** : une copie est refaite quand elle est demandée et plus vieille que l'âge réglé (30 jours par défaut, réglage avancé « Renouveler une jaquette gardée après », de 1 à 365 jours). Pendant ce temps l'ancienne reste affichée : **une source en panne ne fait jamais perdre une copie bonne**, et un renouvellement raté est retenté plus tard (1 heure, puis 6 heures, puis 24 heures). Seule exception : Twitch, 24 heures.
- **Vos choix** (« C'est ce jeu ») ne sont jamais écrasés par un renouvellement : seule l'image choisie est refaite, jamais une nouvelle recherche.
- **Si la copie échoue**, il n'y a pas d'image. Le réglage avancé « Si la copie échoue, montrer l'image de la source » (coupé par défaut) rétablit l'ancien comportement : le navigateur charge alors l'image chez la source.

## Quand une source ne répond pas
- Chaque jaquette trouvée toute seule est **gardée** (1 000 choix au plus, les plus anciens sortent d'eux-mêmes) et sert **même périmée** quand toutes les sources sont en panne.
- En haut de **« Jaquettes à vérifier »**, une phrase dit où on en est : « RAWG : pas de code (facultatif) — Steam : actif ✓ — Twitch : connecté ✓ », puis la dernière source qui a répondu. Si plus rien ne répond : « Aucune source ne répond pour le moment. Les jaquettes déjà gardées restent affichées. » Le Journal du site note une fois l'arrêt de Rawg et une fois son retour.
- Vos corrections passent toujours avant tout.

## « Quel est le bon jeu ? »
Quand le site n'est pas sûr du jeu qui correspond à un titre (par exemple « Playrooms »), il le note dans **« Jaquettes à vérifier »**. Cliquez sur **Corriger** : vous voyez les jaquettes proposées par **toutes les sources** (6 au plus chacune, avec leur source écrite), vous choisissez le bon jeu en un clic (ou « Aucune jaquette »), et le site retient votre choix pour tous les modules, en copiant tout de suite l'image. **« Ce choix est bon »** valide le choix du site tel quel.

## « Jaquettes gardées »
Cet onglet (anciennement « Jaquettes enregistrées ») réunit en **un seul tableau** tout ce que le site garde pour vos jeux, avec sa recherche en direct, des filtres (source, origine), une vignette de la copie gardée sur votre site et la **source** de chaque jaquette :
- **Corrigée** : un jeu ou une image que vous avez choisi ;
- **Sans jaquette** : un titre pour lequel vous avez choisi « Aucune jaquette » ;
- **Automatique** : un jeu trouvé tout seul par le site (douteux ou non).

Sur chaque ligne : **Voir** (la jaquette en grand), **Changer** (les jaquettes proposées pour ce titre) et, dans le menu « ⋯ », **Oublier cette jaquette** (la copie est effacée avec elle ; le site cherchera de nouveau tout seul). **« Oublier toutes les corrections »** demande une case à cocher.

Pour aller chercher une jaquette sans attendre qu'un module la demande, écrivez un titre dans **« Chercher une jaquette »** (par exemple *Hollow Knight*), puis choisissez **« Utiliser cette jaquette »**. La recherche part au moment où vous cliquez, jamais en arrière-plan. Écrivez le titre comme vos pages l'écrivent.

## Réglages
Un seul réglage simple : le code Rawg (facultatif). Réglages **avancés** : « Utiliser les jaquettes de Twitch » (oui), « Utiliser le magasin Steam » (oui), « Renouveler une jaquette gardée après » (30 jours), « Si la copie échoue, montrer l'image de la source » (non).

## Ce que le module garde
- votre code Rawg (jamais affiché) ;
- vos corrections (1 000 au plus), la liste des titres à vérifier (100 au plus, 60 jours) et les jaquettes trouvées toutes seules (1 000 au plus) ;
- les **copies** des images (300 au plus, 20 Mo au plus) ;
- le dernier état de Rawg (« fonctionne », « ne répond pas », « refuse le code ») et la date de sa dernière réponse correcte.

Mise à jour : **rien n'est perdu ni réécrit**. Les choix déjà gardés (sans champ « source ») restent valables comme des choix Rawg ; leur copie est faite au fil de l'eau, à la première demande.

## Vie privée
Le module ne collecte rien sur votre public, qui ne contacte jamais Rawg, Twitch ni Steam. Le serveur de votre site envoie le titre du jeu à Rawg (avec votre code, si vous en avez réglé un), à Twitch (par le Connecteur Twitch) et à la recherche du magasin Steam. Seule la personne qui administre voit, pendant son choix, les images proposées, chargées depuis leur source.

## Pour qui développe
- **Service `game.cover` (version 1)**, à déclarer en besoin facultatif : `"requires": [{ "service": "game.cover", "optional": true }]`.
  - `cover({ title })` → `{ status: "found" | "none" | "no-key" | "refused" | "unreachable", url, name?, id?, ambiguous?, source? }`. **`url` est la copie gardée sur le site** (https absolue, `/m/<clé>/cover/<repère>`), jamais l'adresse de la source. `unreachable` aussi quand la copie n'est pas encore prête (jamais `none`). `id` n'est donné que pour Rawg ;
  - `candidates({ title, search? })` → `{ status, candidates: [{ id, name, year, platforms, url, source }], sources }` (6 au plus par source ; `url` est l'adresse de la source, pour l'administration seulement) ;
  - `status()` → `{ ready, configured, source, state, at?, keyHeld, sources: [{ source, on, why? }] }`, sans appel réseau ni code. `ready` et `configured` : au moins une source est disponible ; `keyHeld` : un code Rawg est réglé ;
  - `fix({ title, rawgId | gameId + source | none | forget })` : réservé au droit « choisir le bon jeu » (`{ asCaller: true }` depuis une action d'administration) ;
  - `adopt({ key?, fixes?, todo? })` : reprise des données de l'ancien réglage du site (ne remplace jamais, ne rend jamais une valeur).
- Un module peut aussi écrire « Ce n'est pas le bon jeu ? » avec le lien `/admin/settings/rawg-covers?titre=<titre encodé>` : le cœur le redirige vers l'écran de ce module.
- Fichiers : `hosts.mjs` (sources, hôtes et chemins permis, fonctions pures), `breaker.mjs` (disjoncteur d'une source), `sources.mjs` (Rawg, Twitch, Steam derrière la même interface), `chain.mjs` (l'ordre et le choix), `copies.mjs` (copie locale, route, rafraîchissement), `rawg.mjs`, `match.mjs`, `fixes.mjs`, `ops.mjs`, `service.mjs`, `panel.mjs`, `mcp.mjs`.
- Appels : Rawg et Steam par `ctx.api.net` (https, délais bornés, disjoncteur du cœur en plus du nôtre) ; Twitch par le service `twitch.api` du Connecteur (`request` : `GET search/categories`, ajouté au Connecteur 1.3.0 ; un Connecteur plus ancien répond « forbidden » et la source reste simplement coupée). Les octets d'une image passent par `fetch` (le client réseau du cœur ne rend que du texte), avec `redirect: "manual"`.
- Stockage : `fixes` (clé = titre normalisé), `todo`, `autoCovers` (1 000 au plus), `adoptedKey`, `keyState`, `handover`, et, depuis la 1.3.0, `coverMeta` (une fiche par copie : source, chemin, taille, date) et `coverBytes` (l'image en base 64). Les documents `fixes`, `todo` et `autoCovers` gagnent `src` ("rawg" quand il manque) et, pour Twitch et Steam, `srcId`.
- Journal du cœur : `cover.game`, `cover.image`, `cover.none`, `cover.confirmed`, `cover.forgotten`, `cover.cleared`, `cover.outage`, `cover.back` (titre du jeu et geste, jamais un code).
- Outils de l'assistant : `rawg_covers_to_check` et `rawg_covers_list` (lecture), `rawg_cover_set` (écriture, jamais accordée d'office). Mêmes noms qu'avant ; les réponses gagnent `source` et `gameId`.
- **Proposition pour le cœur (non faite ici)** : une brique « copie locale d'une image externe » (`ctx.api.images.copy({ hosts, … })`) servirait à ce module, au Planning (photos des partenaires) et à Story. Aujourd'hui chacun écrit sa propre version (liste blanche d'hôtes, https, sans redirection, taille bornée, type lu sur les octets, stockage `ctx.api.store`, route publique) : le cœur pourrait la fournir une fois, avec le stockage et la purge.

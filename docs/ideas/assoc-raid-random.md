# Raid Twitch 2.2 : « Sélection du moment » et page « En direct en ce moment » (`twitch-raid`), description complète

Version **2.2.0** (mineure) du module existant `twitch-raid`, `minCore` **0.2.6** (le script de la page publique est un script de page, cœur 0.2.6). Aucun module ajouté. Branche `ideas/assoc-raid-random`.

## Le problème
Un groupe de streameurs (réseau de créateurs, équipe, amis) veut **favoriser les raids entre ses chaînes** : montrer, à ses visiteurs comme dans OBS, quelques chaînes **en direct**, tirés au hasard et de façon juste, sans que la liste change à chaque rafraîchissement, sans exposer la liste complète ni les personnes qui ne veulent pas apparaître. Avant, Raid montrait tous les partenaires en direct (ou un seul tiré au hasard au-delà de 500 chaînes), seulement pour la propriétaire, dans un dock.

## Pour qui
La propriétaire (Emma) qui tient la liste ; les personnes de la liste, qui ajoutent le dock dans OBS ; les visiteurs du site. Aucun nom de groupe ni type de site n'est codé : titre, introduction, texte vide et libellé du bouton sont des réglages (FR et EN), avec des mots simples par défaut.

## Ce que voit le visiteur
Une page facultative (chemin réglable, « en-direct » proposé) : titre, phrase d'introduction, puis N cartes (nom de la fiche, jeu, titre, spectateurs, « en direct depuis … », bouton « Regarder sur Twitch » = lien sortant `rel="noopener noreferrer"` dans un nouvel onglet). Mobile d'abord (une colonne, cibles ≥ 44 px, aucun défilement horizontal), thème du site (jetons `--v-*`), clavier et lecteur d'écran (liens nommés, zone « la sélection a changé » annoncée seulement quand elle change, mouvement réduit respecté). Elle est écrite par le serveur (marche sans script) puis rafraîchie environ toutes les 60 s (+ 0 à 5 s) par `scripts/live-members.js` : seules les valeurs qui changent sont réécrites, les cartes sont réutilisées (pas de clignotement, le focus reste). Si Twitch ne répond pas : dernière sélection connue (10 min au plus) avec un mot ; au-delà : message aimable « Les informations en direct ne sont pas disponibles… » ; personne en direct : « Personne n'est en direct pour le moment. ». Les aperçus (option) ne se chargent qu'après un clic sur « Afficher les aperçus » (choix gardé dans le stockage du navigateur, rien d'autre).

## Ce que fait Emma, pas à pas
1. Met à jour Raid (rien ne change : dock, liste et adresse identiques).
2. Onglet **« Sélection du moment »** : elle lit l'explication, copie l'adresse du **dock de la sélection** (même clé secrète que le dock ordinaire) dans OBS, clique « Voir la sélection » ou « Tirer de nouveau ».
3. Facultatif : choisit le nombre (1 à 10), la durée, « Que montre le dock ordinaire ? » (liste ou sélection), les options avancées.
4. Facultatif : coche « Afficher la page publique sur le site ». Installation neuve : la page a déjà son adresse. Site existant : mode avancé, « Adresse de la page » (l'administration l'explique si l'adresse manque). Ajoute la page au menu si elle le souhaite.
5. Quelqu'un ne veut pas apparaître : elle range sa fiche dans la catégorie « Ne pas montrer » de Contacts ; en moins de 2 minutes la personne disparaît de la sélection et de la page.

## Réglages et défauts
| Réglage | Défaut | Notes |
|---|---|---|
| Que montre le dock ordinaire ? (`dockMode`) | liste (comme avant) | « sélection » : la même adresse montre la sélection |
| Combien de chaînes (`count`) | 5 | 1 à 10, ramené dans l'intervalle |
| Durée (`duration`, minutes) | 10 | 1 à 240 |
| Petites chaînes d'abord (`smallFirst`, avancé) | non | poids = 1 / (spectateurs + 1) |
| Ne jamais tirer (`exclude`, avancé) | vide | pseudo, @pseudo ou lien, un par ligne ; 200 au plus ; les mots illisibles sont signalés |
| Catégorie « Ne pas montrer » (`hide`, avancé) | « Ne pas montrer » / « Do not show » si elle existe | suit une fusion de catégories ; supprimée : plus personne écarté (avertissement) |
| Afficher la page publique (`publicPage`) | non | éteinte = 404 (page et route) |
| Titre, introduction (avancé), texte vide, texte du bouton | mots simples FR/EN | traduisibles |
| Aperçus (`thumbs`, avancé) | non | aucune image de Twitch tant que le visiteur n'a pas cliqué |

Pas de gabarits : ce module n'a ni catégories ni types propres (la liste vit dans Contacts) ; les mots sont les seuls éléments d'identité, tous réglables. Une seule instance (`instances: single`) : une communauté, un tirage.

## Comment la sélection est tirée (moment.mjs, draw.mjs)
- Tranches de `duration` minutes alignées sur l'horloge ; la graine vient de (instance, tranche, nombre de « Tirer de nouveau »). Même graine, même tirage : deux lectures simultanées, un autre processus ou un redémarrage retombent sur le même résultat. Tout est calculé à la lecture ; **aucun minuteur serveur**, **rien sur le disque**.
- Les chaînes choisies qui ne sont plus en direct sont remplacées ; la sélection se complète si d'autres arrivent ; les autres ne bougent pas.
- Rotation : mémoire de 200 pseudos au plus (en mémoire) ; on tire d'abord parmi ceux jamais montrés, puis les plus anciennement montrés.
- « Tirer de nouveau » : au plus une fois toutes les 5 s (sinon la sélection actuelle, `wait`), pour tout le monde (dock, page publique).
- Twitch / Contacts en panne : dernier état connu 10 min (`stale`), puis l'erreur. Vérification partielle (un paquet en erreur) : une chaîne choisie qui manque est gardée 10 min.

## Données, vie privée, consentement
Aucune donnée de visiteur, aucun cookie. Aucune nouvelle donnée sur disque (la déclaration `privacy` est mise à jour). La page publique n'affiche que des informations publiques de Twitch et le nom de la fiche de Contacts, **seulement pour les N membres tirés** ; la liste complète, le nombre de membres en direct et la raison d'une panne ne sortent jamais. **Consentement** (consent.mjs) : sont écartées les fiches rangées dans « Ne pas montrer » et celles au statut « à relire » (même règle que le Mur des remerciements) ; Contacts est interrogé (`resolve`, 100 fiches par appel) **uniquement pour les membres en direct**, verdicts gardés 2 min ; ce que Contacts ne sait pas dire n'est pas montré ; si la catégorie « Ne pas montrer » ne peut pas être vérifiée, on garde la dernière sélection (10 min) ou on n'affiche rien. Le dock de sélection applique la même règle (mêmes membres que la page). Twitch n'est contacté par le navigateur que si le visiteur clique « Regarder sur Twitch » ou « Afficher les aperçus » (domaines `jtvnw.net` seulement).

## Bornes
Appel Twitch inchangé (100 chaînes par appel, cache 30 s partagé, bornes 6 s/9 s). Au-delà de 500 chaînes : vérification des seules chaînes choisies (un appel, 30 s) + échantillon de paquets de 100 (`findMany`, **mêmes** bornes que « au hasard » : 6 paquets, 12 recherches par minute pour l'instance, mémoire 60 s). Route publique `members` : GET seulement, 60 requêtes par minute et par visiteur (empreinte du cœur, jamais d'adresse IP en clair), cache public de 20 s. Page : attente de la sélection ≤ 4,5 s, sinon coquille « chargement » que le script remplit. Mémoire : 50 instances, 5 000 verdicts, 200 pseudos de rotation, 200 exclusions.

## Intégrations
Aucune nouvelle. Contacts (`contact.book` v2 : `resolve`, `categories`, `categoriesResolve`, `accounts`), Connecteur Twitch (`twitch.api`), Ma Chaîne Twitch : déjà requis. Aucun service offert en plus. Outil de l'assistant ajouté : `raid_featured_now` (lecture seule, non accordé d'office) ; `raid_partners_live` inchangé.

## Ce qui n'est pas fait, et pourquoi
- Pas de rotation mémorisée sur disque : elle repart de zéro après un redémarrage (documenté ; la graine garde le tirage de la tranche).
- Pas de bouton « Tirer de nouveau » public (action de la propriétaire seulement).
- Sur un **site existant**, le cœur ne donne pas d'adresse à la page tant que la propriétaire n'en choisit pas une (mode avancé) ; la page éteinte répond 404 et, depuis le cœur 0.2.12, n'est plus dans le plan du site, `llms.txt` ni le menu (`pageSetting`).
- Pas de liste d'exclusions par fiche de Contacts (la catégorie « Ne pas montrer » joue ce rôle).
- Le script de page n'est pas couvert par un test automatique de navigateur (vérifié à la main avec Chromium).

## Idées pour la suite
Mettre en avant les nouvelles chaînes ; filtrer par jeu ; une sélection par langue ; un widget d'accueil (section) qui montre la même sélection.

## 2.2.1 : une page éteinte est une page absente, et des mots neutres
- **Textes par défaut neutres** (FR et EN) : « En direct en ce moment » / « Live right now », « Voici qui est en direct sur Twitch maintenant. Passez leur dire bonjour ! » (aucun « membres », « communauté » ni « association » ; avant, le titre par défaut était propre à un type de site). Titre, introduction, texte vide et libellé du bouton restent réglables ; un titre déjà saisi ne change pas.
- **Éteinte = aucune trace côté module** : la page répond 404 sans titre ni script annoncé ; la route publique `members` répond comme une route inconnue (404 « Not found », plus de `{"state":"off"}`).
- **Page éteinte et cœur 0.2.12** : le manifeste déclare `"pageSetting": "publicPage"` (`minCore` 0.2.12). Tant que ce réglage booléen (défaut `false`) est faux, le cœur traite l'instance comme sans adresse pour le plan du site, `llms.txt`, le menu, la résolution `[...path]` et le script de page. Aucun changement de code du module : le texte `mo_page_off_addr` dit seulement que la page n'apparaît nulle part.
- **Case et adresse** : le module ne peut pas écrire l'adresse (champ du cœur, mode avancé). L'onglet « Sélection du moment » dit clairement lequel des deux manque ou reste en place.

## 2.2.3 : une administration au vocabulaire neutre
- **Mots de l'administration** (FR et EN, parité exacte) : « membres » et « communauté » disparaissent des textes par défaut de l'administration (introduction, étapes de l'adresse, aide de « Nouvelle adresse », description du mode du dock, onglet « Sélection du moment », avertissements), du libellé et de l'aide du réglage `count`, de la description du module, de la description de l'outil `raid_featured_now` et du README. On parle de « chaînes », de « la liste » et de « personnes » (celles à qui la propriétaire donne l'adresse). Les clés de réglages et les noms d'outils MCP ne changent pas ; un texte déjà saisi par une propriétaire non plus.
- **Dock 2.1 intact** : aucun texte verrouillé par les empreintes (`twitch-raid-compat`) ne contenait ces mots ; rien du dock n'a changé.
- **Test de neutralité étendu** : tous les textes par défaut (sauf ceux du dock verrouillé) refusent « membre(s) », « communauté », « association ».

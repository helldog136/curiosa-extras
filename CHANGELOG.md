# Changelog

Ce que chaque version de ce dépôt change pour vous. Chaque version est une étiquette (`vX.Y.Z`) : c'est elle que le Catalogue de Curiosa propose à l'installation, et son texte devient celui de la release GitHub.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, qui disent ce que ça change pour vous.

## 1.30.0

*L'onglet « Récompenses » du Bot Twitch est refait, et le haut de la page « Commandes » tient en une ligne. Bot Twitch 1.7.0 : pour Curiosa 0.6.0 ou plus.*

### Nouveautés

- **Un seul tableau de récompenses**, avec recherche en direct, filtres en pastilles, ce qui se passe (pastille colorée **et** écrite), le coût et un interrupteur « en vente / en pause » dans la ligne. Un seul bouton « Modifier » par ligne ; « Tester » et « Supprimer la récompense » sont dans le menu « ⋯ ».
- **Un formulaire de trois champs** : Titre, Coût, Ce qui se passe. Tout le reste (réponse du bot, couleur, délai de recharge, texte d'aide, message du viewer) est sous « Plus d'options ». Une réponse sensée est prévue si vous n'écrivez rien.
- **Une phrase et trois étapes** à la place de l'introduction de cinq lignes : activer, autoriser Twitch, relier la maison (facultatif), avec l'état de chaque étape. Une fois tout en place, une ligne dit l'état du Connecteur Home Assistant, avec le lien pour l'ouvrir et pour créer une récompense.
- **« Vos actions »** : recherche, un bouton « Renommer » et « Retirer » dans le menu ; la colonne « Maison » ne parle que de ce qui sort de l'ordinaire.
- **Le journal des échanges** a sa recherche et un filtre par résultat.
- **Le haut de la page « Commandes » tient en une ligne** : « Le bot écoute votre chat », le dernier message, « répond pendant vos directs », un petit bouton « Vérifier » (ou « Réparer l'écoute » s'il y a un problème) et le bouton « Arrêt d'urgence », toujours visible. Plus de carte à un seul bouton.
- **L'onglet « Sources »** s'appelle « Informations utilisées » dans cette page.

### Pour les développeurs

- Bot Twitch 1.7.0, `minCore` 0.6.0 : tableau enrichi, champs `duration`, `switch`, `folded`, `example` du cœur. L'action `rewardToggle` devient `rewardEnable` (l'interrupteur dit l'état voulu : `enabled` vaut `1` ou `0`). Le champ `cooldownMin` reste accepté ; le formulaire envoie `cooldown` en secondes. Le choix de la couleur est replié (vide : rouge).
- `adminkit.client.js` reste pour les parties que le cœur ne couvre pas encore : période des commandes et des timers (la migration vers le contrôle natif est un lot suivant), aperçu et morceaux à insérer, et les boutons d'action en ligne (sans carte) en attendant une brique du cœur.
### Pour les développeurs

- **Le cliquet d'ergonomie.** `tests/ergonomics.test.mjs` mesure, pour chaque module, les règles automatiques de `docs/ERGONOMIE-ADMIN.md` (réglages par onglet, mots interdits, libellés, aides et exemples, ton, parité FR/EN). Les écarts déjà présents sont listés dans `tests/ergonomics-baseline.json` : un nouvel écart fait échouer le test, un écart corrigé doit être retiré de la base, qui ne peut que rétrécir.
- **Deux commandes.** `node scripts/ergonomics-baseline.mjs --write` écrit ou fait rétrécir la base (il refuse d'ajouter un écart) ; `--report` imprime le tableau « module, nombre d'écarts par règle ».
- **`tests/helpers/ergonomics.mjs`** : copie de l'aide du kit du cœur (comme `tmp.mjs`), avec `assertAdminPageErgonomics(blocks)` pour les pages produites par du code. Aucune version du cœur n'est exigée ; un test vérifie que la copie reste identique à celle du cœur.

## 1.31.0

*Les 20 modules de réseau social demandent « L'adresse de votre profil » et reconnaissent ce que l'on colle vraiment : le nom seul, l'adresse sans https ou sans www, `@nom@serveur`, les adresses courtes. Le module Annonces Discord est allégé. Pour Curiosa 0.6.0 ou plus. Modules touchés : les 20 réseaux, Annonces Discord 1.2.0.*

### Nouveautés

- **Une seule question, la même partout : « Adresse de votre profil ».** Sous le champ : « Collez le lien de votre page. » et un exemple concret (« Par exemple : https://www.instagram.com/monpseudo »). Le mot « identifiant » et le « (sans @) » disparaissent des 20 modules.
- **Ce que l'on colle vraiment est reconnu.** Le nom seul (avec ou sans @), `instagram.com/monpseudo` sans https, avec ou sans `www.`, les adresses courtes (`fb.me`, `t.me`, `discord.gg`), `@nom@mastodon.social`, `u/pseudo` et `r/communaute` pour Reddit, `monnom.bandcamp.com`, un numéro de profil Steam. Les paramètres de suivi (`igsh`, `utm_…`, `fbclid`, `s`, `t`…) sont retirés. L'ancienne adresse `twitter.com` devient `x.com`.
- **Un seul bouton par compte, quelle que soit la saisie.** Que vous tapiez `monpseudo` ou que vous colliez l'adresse, le bouton s'appelle « Instagram · monpseudo » et mène à la même adresse : le doublon est écarté. Le bouton de X s'appelle « X » (plus « X (Twitter) »).
- **Mastodon** vérifie que l'adresse est celle d'un profil (`/@nom`) : un lien quelconque n'est plus accepté. **Bandcamp** accepte le simple nom. **Facebook** reconnaît `fb.me`.
- **Discord** : le lien d'invitation séparé est replié sous « Plus d'options » ; le profil accepte déjà une invitation.
- **Annonces Discord est allégé.** Deux champs visibles (l'adresse d'envoi et « Annoncer aussi mes directs YouTube ») ; la mention, l'icône et le choix « en même temps » sont repliés sous « Plus d'options », le texte de l'annonce passe en mode avancé. Le mot « webhook » disparaît des textes (« adresse d'envoi du salon »), les délais disent leur unité et leurs bornes, les erreurs disent quoi faire.
- Avec le cœur 0.6.0, les messages d'erreur du compte (Bluesky, GitHub…) renvoient à « l'adresse de votre profil ».

### Pour les développeurs

- **Une seule table pour les 20 réseaux** : `scripts/social-networks.mjs` (hôtes, modèle d'adresse, formes reconnues, exemple, icône). `node scripts/gen-social.mjs` écrit le bloc `profile()` de chaque `index.mjs` (le fichier entier pour les 15 réseaux sans statistiques), le réglage `profile`, la description et la ligne « Réglage » du README ; `--check` vérifie qu'aucun fichier n'a été modifié à la main.
- **`tests/social-generated.test.mjs`** : anti-copie (une seule `profile()` par module, identique à celle de la table), textes communs, 40 collages réels. `profile()` renvoie maintenant `{ url, handle, tag }` ; `handle` garde son sens pour les statistiques.
- `minCore` passe à 0.6.0 pour ces modules (`example` et `rare` sont des clés du cœur 0.6.0). Aucune donnée ne change : les adresses déjà saisies marchent toujours.
- Le kit d'ergonomie est recopié depuis le cœur 0.6.0 (`tests/helpers/ergonomics.mjs`) ; la base des écarts passe de 1185 à 1115 (les 21 modules à 0 écart, -70).
- Versions : 20 réseaux +0.1.0 (1.1.0 ; 1.2.0 pour Bluesky, Discord, GitHub, Mastodon, Reddit), Annonces Discord 1.2.0.

## 1.29.0

*Le Bot Twitch a une administration refaite : un seul tableau de commandes avec recherche en direct et interrupteurs, un formulaire de trois champs, une période d'activité en un seul contrôle, des timers sur le même modèle. L'import Nightbot est retiré. Bot Twitch 1.6.0 : pour Curiosa 0.2.5 ou plus.*
*La page du Bot Twitch est refaite selon les règles d'ergonomie du dépôt (`docs/ERGONOMIE-ADMIN.md`), et l'import Nightbot est retiré. Pour Curiosa 0.2.5 ou plus. Module touché : Bot Twitch 1.6.0.*

### Nouveautés

- **Un seul tableau pour toutes les commandes.** Les vôtres, les toutes prêtes, celles des partenaires et celles de vos réseaux sont dans le même tableau : nom et autres noms, réponse sur une ligne (complète en info-bulle), origine (une pastille colorée **et** écrite : « La vôtre », « Prête », « Partenaire », « Réseau »), état, bouton. Plus d'étiquette répétée sur chaque ligne, des lignes de même hauteur.
- **Une recherche qui filtre pendant que vous tapez** (« disc » ne laisse que `!discord`), sans accents ni majuscules, dans les noms, les autres noms, les réponses et l'état. Des filtres en pastilles avec leur nombre : Toutes, Les vôtres, Prêtes, Partenaires, Réseaux ; Actives, Désactivées, Masquées. « Aucun résultat » propose d'effacer la recherche. Sans JavaScript, la liste reste complète.
- **Un interrupteur dans la ligne** pour activer ou désactiver, à la place du bouton « Activer / désactiver ». Une commande masquée dit pourquoi, sous l'interrupteur (« Masquée : pas d'agenda »).
- **Les commandes produites par une autre page** (partenaires) restent des lignes comme les autres, mais leur bouton mène à la page qui les règle : « Ouvrir la fiche du partenaire → ». Les partenaires et les réseaux qui n'ont pas encore de commande ne sont plus des lignes « Pas encore activée » : un bouton « Ajouter une commande pour un partenaire ou un réseau » ouvre un choix avec recherche.
- **Un formulaire de commande de trois champs** : Nom, Ce que le bot répond (avec un aperçu en direct et des morceaux à insérer d'un clic), Qui peut l'utiliser (quatre boutons). Le reste est replié sous « Plus d'options » : autres noms, attentes (« Attendre [ ] s entre deux réponses, et [ ] s pour une même personne », le champ vide dit sa valeur) et période d'activité.
- **La période d'activité en un seul contrôle**, pour les commandes comme pour les timers : « Toujours active » ou « Seulement pendant une période », puis « Du [jour][mois] au [jour][mois] », une case « Chaque année » cochée au départ, la phrase « Active du 1er novembre au 30 novembre, chaque année » et des raccourcis d'un clic (Tout novembre, Tout septembre, Cet été, Noël). Les années n'apparaissent que si « Chaque année » est décochée. Une erreur dit quoi faire avec un exemple (« Le 31 février n'existe pas. Exemple : 28 février »).
- **Des timers sur le même modèle** : tableau avec recherche et interrupteur ; formulaire de cinq champs au plus (Nom, Message, « Toutes les [ ] minutes, après au moins [ ] lignes de chat », En direct seulement ou Toujours), période repliée.
- **Le journal** a sa recherche et un filtre Répondu / Pas répondu ; « Vider le journal » devient un petit bouton discret dans l'en-tête, qui demande confirmation en disant ce qui sera effacé.

### Retiré

- **L'import depuis Nightbot** : le copier-coller de Nightbot est trop aléatoire pour qu'un site le lise sans se tromper. Demandez plutôt à votre assistant IA de recréer vos commandes : collez-lui votre liste, il utilise les outils `bot_command_create`, `timer_create` et leurs périodes. Le tableau de correspondance des morceaux reste dans le guide du module. Le droit « import Nightbot » et les outils `nightbot_import_preview` et `nightbot_import` disparaissent ; un brouillon d'import resté en mémoire est effacé à la mise à jour, sans toucher à aucune commande.

### Pour les développeurs

- Un petit script de page réutilisable (`adminkit.client.js`, avec `adminkit.mjs` qui écrit le HTML et sert le script par une route du module) : recherche en direct, pastilles, interrupteur, boutons segmentés, zone « Plus d'options », phrase à champs, contrôle de période. Amélioration progressive : sans lui, tous les champs sont là. Le cœur 0.5.x n'a aucun de ces composants ; proposés au cœur dans la PR.
- Données 5 : efface l'ancien brouillon d'import (`botImport`). Additif pour tout le reste, rejouable.
- Les périodes du formulaire passent par un seul champ texte (`01/11 - 30/11` ou `01/11/2026 - 30/11/2026`) ; les outils des assistants (`activeFrom`, `activeUntil`, `yearly`, `clearPeriod`) ne changent pas.
- Nouveau test `tests/twitch-bot-admin.test.mjs`, jeu de la propriétaire (35 commandes) dans `tests/helpers/ownerSet.mjs`, captures reproductibles dans `tests/visual/`.

## 1.28.0

*Deux modules évoluent. Le Bot Twitch rejoint Nightbot sur les commandes, les timers et l'import, ajoute des dates de validité qui reviennent toutes seules, et peut inscrire les personnes du chat à un tirage au sort. Participation ajoute ce tirage au sort, depuis le chat du stream ou depuis une page de votre site. Bot Twitch 1.5.0 : pour Curiosa 0.2.5 ou plus ; Participation 1.2.0 : pour Curiosa 0.5.0 ou plus. Modules touchés : Bot Twitch 1.5.0 et Participation 1.2.0.*

### Nouveautés

- **Des timers.** Un nouvel onglet « Timers » : un message que le bot écrit dans votre chat à intervalle régulier (un rappel du Discord, une astuce…), avec un nombre de minutes, un minimum de lignes de chat, « en direct seulement » ou « toujours », un aperçu et un bouton « Envoyer maintenant ». 20 timers au plus. **Comme chez Nightbot, un timer a besoin que le chat soit actif** : le bot n'a aucun minuteur, il regarde ses timers quand un message arrive. Un seul timer écrit par message, jamais pendant l'arrêt d'urgence, jamais au-delà de la limite de réponses.
- **Des dates de validité sur les commandes et les timers** (Nightbot n'a pas cette fonction). `!movember` du 1er au 30 novembre, `!subtember` en septembre : la période revient **chaque année toute seule**, même à cheval sur le changement d'année. Deux sélecteurs jour / mois, une case « Chaque année », des erreurs claires sous le champ. Hors période la commande ne répond pas mais reste visible et modifiable (« Hors période : se réactive le 1er novembre ») ; la case « Activée » décochée l'emporte toujours.
- **Les morceaux de Nightbot.** Dans vos commandes : `{cible}`, `{requete}`, `{1}` `{2}` `{1:}`, `{compteur}` (avec bouton de remise à zéro), `{chaine}`, `{viewers}`, `{heure}` et `{date}` (avec fuseau), `{aleatoire …}` (une liste ou une plage de nombres) et `{calcul …}` (de l'arithmétique sûre, jamais de JavaScript). Un morceau inconnu ou mal écrit est refusé à la saisie, avec un exemple. Ce que les gens tapent est nettoyé et jamais gardé.
- **`{urlfetch}`, version sûre.** Éteint tant que vous n'avez pas listé, en mode avancé, les sites autorisés. https seulement, jamais d'adresse privée ou locale, aucune redirection suivie, 3 secondes, 400 caractères, 30 secondes de mémoire, 10 demandes par minute.
- **Gérer les commandes depuis le chat.** `!addcom`, `!editcom`, `!delcom` et `!commands` pour vous et votre équipe de modération, avec des réponses claires et exactement les mêmes vérifications que l'administration. Désactivé tant que vous ne cochez pas le réglage. Jamais d'écrasement.
- **Importer depuis Nightbot.** Collez votre liste de commandes et de timers : le site montre, ligne par ligne, ce qui est repris tel quel, adapté (anciennes écritures traduites, niveau « habitué » remplacé par « personnes abonnées ») ou impossible (avec la raison). Vous cochez, vous choisissez quoi faire des noms déjà pris, vous pouvez ajouter une période à chaque ligne, et rien n'est écrit avant votre validation.
- **Pour votre assistant IA** : voir, créer et modifier les timers ; lire (sans rien écrire) puis importer une liste Nightbot ; des périodes sur les commandes et les timers. Aucune écriture n'est accordée d'office. Nouveaux droits « timers » et « import Nightbot » pour vos rôles.
- **Alimenter un tirage au sort de Participation.** Si Participation est installé, le bot lui transmet le pseudo de la personne qui tape le mot du tirage (une fois par personne), sans répondre dans le chat et sans rien garder.
- **Un tirage au sort dans Participation.** Nouvel onglet **Tirage au sort** : un titre, un mot pour le chat (facultatif : « !cadeau » ou « cadeau », c'est pareil), qui peut s'inscrire depuis le chat (tout le monde, personnes abonnées, équipe de modération), l'inscription depuis le site (oui ou non) et une durée de 1 à 120 minutes (ou « jusqu'à ce que je ferme »). Le tirage passe d'**ouvert** à **fermé** puis **tiré au sort**, et se ferme tout seul à l'heure prévue sans qu'aucun minuteur ne tourne.
- **Un vrai tirage au sort.** Chaque personne inscrite a exactement la même chance, une personne déjà tirée ne l'est jamais deux fois, on peut tirer plusieurs personnes d'un coup (1 à 10) et tirer encore. « Tirer une autre personne » met de côté une personne absente et en tire une autre.
- **Une page d'inscription sur votre site**, `/participation/tirage` : un champ pseudo et un bouton « Je participe ». Les erreurs s'affichent sous le champ, avec un exemple. Mêmes protections que le reste de Participation : mêmes règles de pseudo, une seule inscription par navigateur, sourdine, limites par connexion. Aucun cookie de plus.
- **Dans le chat**, le Bot Twitch (ou tout module qui lit un chat) inscrit les personnes grâce au nouveau service `audience.draw`.
- **Sur la télécommande et dans le dock OBS** : trois boutons, « Ouvrir le tirage », « Fermer » et « Tirer une personne au sort ». Fermer et Tirer demandent de cliquer encore pour confirmer.
- **À l'écran du stream**, les personnes tirées s'affichent 20 secondes. Une adresse secrète pour une source navigateur OBS, et un **élément « Tirage au sort »** pour les pages d'overlay : le tirage en cours (titre, mot à taper, nombre d'inscriptions, compte à rebours) puis les personnes tirées. Option « Garder les personnes tirées au sort à l'écran ». Il s'adapte à la taille du cadre, suit le style commun de la page d'overlay et a un contenu d'exemple en mode test.
- **Une liste réservée à l'administration** : la liste des personnes inscrites n'est visible que de l'équipe d'administration (50 par page), avec « Retirer cette personne » (avec ou sans sourdine) et « Vider le tirage ». L'historique garde les 20 derniers tirages (titre, date, pseudos des personnes tirées, nombre d'inscriptions).
- **Pour l'assistant IA** : `draw_status` (lecture), `draw_open`, `draw_close` et `draw_pick` (écritures, jamais accordées d'office). Nouveau droit « gérer le tirage au sort », réservé à l'administration par défaut.

### Améliorations

- Rien ne change pour vos commandes d'avant : elles restent toujours actives, avec les mêmes textes. La migration des données (version 4) ajoute seulement une liste de timers vide.
- Le journal indique « Hors période » avec la date de réouverture, et les timers apparaissent avec le signe ⏱.
- Ce qui n'est pas repris de Nightbot, et pourquoi, est écrit dans le README du module (section « Si vous venez de Nightbot ») : l'habitué, la date de suivi d'une personne, le JavaScript de `$(eval)`, `$(querystring)`.
- **Vie privée** : une inscription garde le pseudo, l'origine et la date, rien d'autre ; l'identifiant du chat n'est jamais gardé en clair. **La liste est effacée 24 heures après la fermeture** (à la lecture, par petites tranches).
- Le journal de Participation dit qui a décidé quoi (ouverture, fermeture, tirage, personne retirée, tirage vidé), depuis l'administration, la télécommande, le dock ou l'assistant.
- Rien ne change pour ce que vous aviez : pseudos, salles, sourdine, télécommande, dock, adresses secrètes et données sont identiques. Aucune migration ; les nouvelles données sont créées au premier tirage. La télécommande montre un panneau de plus, « Tirage au sort », après ceux de vos autres modules.

### Pour les développeurs

- **Bot Twitch 1.5.0** (`dataVersion` 4, `minCore` inchangé 0.2.5) : nouveaux fichiers `calc.mjs` (évaluateur sans JavaScript), `urlfetch.mjs`, `period.mjs`, `timers.mjs` et `timersAdmin.mjs` (onglet), `manage.mjs` (`!addcom`…), `nightbot.mjs` et `importAdmin.mjs` (import), `draw.mjs` (besoin facultatif `audience.draw` v1 (`min` 1) : `status()` → `{ open, keyword: "!mot" ou "", level: all|sub|mod }` gardé 10 s, appel borné à 1,5 s, `enter({ pseudo, platform: "twitch", login, role })` ; le message est comparé tel quel au mot-clé, sans le préfixe du bot), `errors.mjs`. `variables.mjs` : morceaux emboîtés (3 niveaux, 30 au plus), `checkTemplate` renvoie `arg` / `deep`. Stockage : `botConfig.timers`, nouveaux documents `botTimers` (état), `botCounters` (300 au plus), `botImport` (brouillon, 24 h).
- Réglages `chatManage` et `fetchHosts` (avancé) ; droits `timers.manage` et `nightbot.import` ; outils MCP `timers_list`, `timer_create`, `timer_update`, `nightbot_import_preview`, `nightbot_import`. Le schéma d'entrée des outils n'accepte pas d'objet : la période se donne par `activeFrom` / `activeUntil` / `yearly` (textes `MM-JJ` ou `AAAA-MM-JJ`).
- Aucune tâche planifiée ni minuteur de fond n'a été ajouté : les timers, les périodes et le tirage sont évalués à l'arrivée d'un message du chat.
- Tests : `twitch-bot-variables`, `twitch-bot-nightbot`, `twitch-bot-timers`, `twitch-bot-manage`, `twitch-bot-draw`, `twitch-bot-period` ; aide `helpers/botWorld.mjs`.
- `minCore` passe à 0.5.0 (clé `overlayElements`), `apiVersion` 2 inchangé, aucune migration (`dataVersion` inchangé). Nouveau service `audience.draw` version 1 (`status` en lecture seule, `enter` ; `status` donne aussi un `id` opaque qui change à chaque nouveau tirage et quand la liste est vidée), contrat dans `tests/contract-ext/audience.md` et double `tests/helpers/fakeAudienceDraw.mjs`. Nouveaux fichiers `draw.mjs`, `drawlib.mjs` et `drawview.mjs`, tous chargés avec `?v=` (mise à jour à chaud). Le script du navigateur de Participation passe en révision 2 (page d'inscription).
- Données : collection `draws` (le tirage en cours sous la clé `cur`, l'historique sous `h-<id>`), `de-<id>-<n>` pour les inscriptions, entrée `draw-cfg` dans `meta` (secret de l'écran, file d'effacement). Les personnes (pseudo, sourdine) sont celles de la salle `draw`.
- Tests : `tests/audience-draw.test.mjs` (28 tests : service, cycle, tirage uniforme, exclusion, effacement à 24 h, historique, télécommande et dock, page publique avec son script, administration, outils de l'assistant, textes) et `tests/audience-draw-overlay.test.mjs` (12 tests : élément, adresse, page, direct, navigateur factice, `assertMultiReaders`). Versions et nombres de panneaux ajustés dans `audience*.test.mjs`.
- **Assemblage** : `package.json` 1.28.0 (une seule version de dépôt pour les deux modules), `catalogue/index.json` régénéré (refs `v1.28.0`), parties de CHANGELOG fusionnées dans cette section. Le Bot Twitch branche l'inscription au tirage sur Participation (service `audience.draw` v1, besoin facultatif) : `tests/twitch-bot-participation-draw.test.mjs` charge les deux vrais modules ensemble.
- **Écarts de contrat corrigés par ce test d'intégration** : (1) `audience.draw.status` donne un `id` opaque (nouveau tirage ou liste vidée) que le Bot Twitch ajoute à sa mémoire des personnes déjà inscrites : sans lui, un tirage ouvert juste après un autre avec le même mot-clé et sans échéance ignorait à tort les personnes du tirage précédent ; (2) le Bot Twitch sans Participation n'appelle plus du tout le service absent (il demande seulement, en local, qui l'offre).


## 1.27.0

*Cinq modules proposent des éléments aux pages d'overlay de Curiosa 0.5.0 (section « Overlays » : une seule adresse à coller dans OBS pour toute une page). Pour Curiosa 0.5.0 ou plus. Modules touchés : Suggestions de jeux 1.6.0, Mur des remerciements 1.2.0, Overlay défilant 1.1.0, Témoignages 1.1.0 et Mascotte 1.1.0.*

### Nouveautés

- **Suggestions de jeux : l'élément « Top des jeux proposés ».** Pendant un segment « on joue à quoi après ? », les jeux les plus proposés ou les plus votés, avec leur rang. Options : nombre de jeux (1 à 10, 3 par défaut) et quels jeux (proposés, planifiés, acceptés, déjà joués, finis). Les propositions de même nom sont regroupées ; « déjà joués » classe par votes « rejoue-le ».
- **Mur des remerciements : l'élément « Remerciements ».** Les dernières personnes à remercier, qui défilent (vers le haut dans un cadre haut, vers la gauche dans un bandeau). Options : groupe, nombre de personnes (1 à 30, 10 par défaut), faire défiler, montrer le petit mot.
- **Rien de plus que ce que montre déjà votre site.** Le Top ne montre que le nom du jeu, ses propositions et ses votes : jamais un pseudo, une note, une jaquette ni un jeu rejeté. Les Remerciements viennent de la même lecture que votre mur : une personne de la catégorie « Ne pas montrer » n'apparaît jamais, les fiches à relire non plus, et il n'y a aucune photo.
- **Bandeau défilant.** « Ajouter un élément » propose un bandeau d'annonces et de codes promo à placer en bas du stream : une carte à la fois (celles de vos autres modules), qui change toutes les quelques secondes. Il garde ses proportions quand vous le redimensionnez. Option « Quoi montrer » (tout, codes promo seulement, annonces et articles seulement : pratique pour avoir deux bandeaux) et option « Montrer les images ». La durée par carte reste celle réglée dans le module.
- **Avis de la communauté.** Un avis déjà publié sur votre site s'affiche à tour de rôle, avec le prénom ou pseudo et les étoiles. Le cadre s'adapte à la taille que vous lui donnez. **Seuls les avis publics sont montrés** (validés par vous, avec l'accord de la personne qui les a écrits) : jamais une adresse e-mail, un lien privé, un avis en attente ou refusé. Options « Secondes par avis » et « Nombre d'avis » ; l'ordre est celui choisi dans le module.
- **Mascotte (version réduite).** Un petit personnage qui dit bonjour, donne une astuce ou annonce une nouveauté, avec le nom et le dessin (ou l'image) choisis dans le module. Un cadre d'overlay n'est pas une page de site : le coin de la page, les pages concernées, le délai, la limite par jour, les boutons fermer / réduire / couper et la mémoire du navigateur n'existent pas ici. **À l'écran de stream, les phrases viennent uniquement de ce que vous avez écrit pour la mascotte** (vos phrases publiées, avec le nom du site et le nom de la mascotte) : jamais le prochain événement, le direct en cours, les nouveautés ni les suggestions d'autres modules. Mascotte en brouillon : cadre vide. Option « Secondes par phrase ».
- Les trois éléments Bandeau, Avis et Mascotte suivent le style commun de la page d'overlay (texte clair ou sombre, fond, angles), ne prennent jamais le style de votre site et ont un contenu d'exemple en mode test, qui n'apparaît que s'il n'y a rien de vrai à montrer.
- Les éléments de Suggestions de jeux et du Mur des remerciements s'adaptent à la taille que vous leur donnez, suivent le style commun de la page d'overlay (texte clair ou sombre, fond, angles), ne prennent jamais le style de votre site et ont un contenu d'exemple en mode test.

### Améliorations

- **Rien ne change pour ce que vous aviez** (Overlay défilant, Témoignages, Mascotte) : l'overlay défilant, les pages de Témoignages, l'accueil, les adresses, les réglages, les outils pour l'assistant IA et la mascotte de votre site sont identiques, octet pour octet (la place, la taille et les couleurs réglées dans un module sont ignorées dans une page d'overlay).
- **Rien ne change non plus pour Suggestions de jeux et le Mur des remerciements** : page des suggestions, vote, formulaire, mur public, administration, assistant IA, réglages et adresses sont identiques (vérifié octet pour octet).
- Plusieurs pages d'overlay peuvent montrer le même élément en même temps sans alourdir votre site : une seule lecture (de vos cartes, de vos avis, de vos phrases) sert tout le monde pendant quelques dizaines de secondes, l'élément montré au même instant est le même partout (déduit de l'heure), rien n'est consommé à la lecture et rien ne tourne en arrière-plan. Les pages se mettent à jour doucement, de plus en plus lentement quand rien ne change.
- Le module **Soutiens** n'a rien à ajouter : il range déjà, si vous le voulez, les personnes qui ont donné leur accord dans la catégorie de Contacts de votre choix, et le mur (donc l'élément « Remerciements ») lit cette catégorie.
- Aucune migration, aucun nouveau réglage.

### Pour les développeurs

- Suggestions de jeux 1.6.0 et Mur des remerciements 1.2.0 passent à `minCore` 0.5.0 (clé `overlayElements`, `apiVersion` 2 inchangé) ; le mur demande en plus le droit `routes`. Détail dans `docs/changelog-parts/overlay-elements-wave2-games-thanks.md` et `overlay-elements-wave2-ticker-testimonials-mascot.md`.
- Tests : `overlay-elements-games`, `overlay-elements-thanks` (avec `assertMultiReaders`), `overlay-elements-wave2-regression`, `tests/golden/` (1.5.1 et 1.0.2, produits avec le dépôt 1.26.0).
- `minCore` 0.5.0, version mineure en plus ; clé `overlayElements` dans les trois `module.json` et fonctions `overlayElements.<id>` : `banner` (`ticker-overlay`, `scale` 640 × 140, options `show` et `image`, réutilise l'overlay existant, qui passe en « mode élément » quand l'adresse porte `ov-w`), `reviews` (`testimonials`, `fluid`, ratios 0,8 à 6, minimum 320 × 140, options `seconds` et `count`, route `element/:slug`, fichier `overlay.mjs`), `mascot` (`mascot`, `scale` 440 × 320, option `seconds`, route `element/:slug`, fichier `overlay.mjs`). Aucun secret : aucun de ces éléments n'en a besoin.
- Multi-lecteurs : le repère est l'heure (créneau = heure / durée, élément = liste[créneau % taille]), pas de file ; lecture partagée à vol unique, gardée 30 s (`ELEMENT_CACHE`, `CACHE`). Mascotte : `ownLines` est la seule source des phrases de l'élément (aucun service, aucun sujet d'un autre module n'est interrogé ; test de confidentialité).
- Overlay défilant : `locales/fr.json` et `en.json` (exemple du mode test) ; route `items` avec `el=1` (genre de carte, filtre) et `demo=1` ; la route sans `el` est inchangée. Mascotte : `VERSION` d'`assets.mjs` 1.1.0.
- Tests : `tests/overlay-elements-wave2.test.mjs` (déclaration, parité FR/EN, pages des éléments, options, mode test, visibilité et confidentialité, lecture partagée, rotation synchronisée, `assertMultiReaders`) avec `tests/helpers/elementPageDom.mjs` (navigateur factice) ; `tests/overlay-elements-wave2-regression.test.mjs` (empreintes prises sur 363a6e5, avant les éléments) ; versions ajustées dans `testimonials.test.mjs`, `ticker-overlay.test.mjs`, `tabs-modules.test.mjs`.
- **Attention à la publication** : cette version demande Curiosa 0.5.0 (publié).
- **Assemblage** : `package.json` 1.27.0, `catalogue/index.json` régénéré (refs `v1.27.0`) ; tests de non-régression séparés : `overlay-elements-wave2-regression` (jeux, remerciements) et `overlay-elements-wave2-ticker-regression` (bandeau, témoignages, mascotte) ; liste `OVERLAY_ELEMENTS` de `tabs-modules.test.mjs` = les 13 modules qui déclarent `overlayElements`.
- **Assemblage** : `package.json` 1.27.0, `catalogue/index.json` régénéré (refs `v1.27.0`).

## 1.26.0

*Vos modules proposent des éléments aux nouvelles pages d'overlay de Curiosa 0.5.0 (section « Overlays » : une seule adresse à coller dans OBS pour toute une page). Pour Curiosa 0.5.0 ou plus. Modules touchés : Compte à rebours 1.1.0, Overlay sponsors 1.1.0, Planning 2.5.0, Statistiques de la communauté 1.2.0, Labyrinthe 3D 1.2.0, Overlay alertes 1.2.0, Sondages 1.3.0 et Ma Chaîne Twitch 2.2.0.*

### Nouveautés

- **Compte à rebours est proposé dans la section « Overlays »** : « Ajouter un élément » liste « Compte à rebours » avec le nom de chaque instance. Vous pouvez en placer plusieurs sur la même page d'overlay, chacun sur son propre événement. Option « Événement » : vide, c'est l'événement à la une ; sinon, le nom court d'un événement précis (visible dans « Modifier »). Un nom qui n'existe plus montre l'événement à la une, sans erreur. Option « Afficher les secondes » en plus.
- **Overlay sponsors est proposé sous le nom « Bandeau sponsors »**, avec le code promo et le QR code. Option « Afficher le QR code ».
- **Planning : deux éléments pour vos pages d'overlay.** « Planning de la semaine » montre vos prochains streams jour par jour : une grille sur sept jours quand le cadre est large, une liste quand il est étroit (il demande de la place : 480 × 280 au minimum). « Prochain stream » montre le suivant en grand, avec ses jeux et sa jaquette, et si vous voulez les 5 streams d'après. Vous choisissez l'apparence parmi celles que le Planning sait déjà faire, le nombre de jours et les jaquettes. Le Planning n'avait pas d'overlay : ces éléments n'existent que dans les pages d'overlay.
- **Statistiques de la communauté : un élément « Compteurs ».** Vos followers, abonnements payants, publications et vues, en grand, avec ce qu'ils ont gagné sur la semaine ou le mois. Vous choisissez quels types de chiffres afficher.
- **Le Labyrinthe 3D s'adapte au ratio de son cadre.** L'élément « Labyrinthe 3D » accepte tous les cadres de 4:3 à 32:9. En plein écran 3440×1440 (21:9), il remplit le cadre : le champ de vision s'élargit sur les côtés, sans étirer les murs. En 16:9, l'image est celle d'avant.
- **L'Overlay alertes propose l'élément « Alertes ».** Il garde ses proportions, suit le style commun de la page d'overlay et garde la couleur d'accent, le style néon ou sobre et la durée réglés dans le module. Une option, « Alertes affichées », permet de séparer les alertes de la chaîne et les dons du direct en deux éléments. Chaque page garde son propre repère : aucune ne vide la file des autres, et une page ouverte plus tard ne rejoue pas les anciennes alertes.
- **Sondages : l'élément « Sondage en direct ».** Vous pouvez poser les résultats d'un sondage où vous voulez dans une page d'overlay. Le contenu s'adapte à la taille du cadre (empilé dans un cadre haut, question à gauche et choix à droite dans un cadre large). Option « Quel sondage » : vide, il montre ce que montre l'écran en direct ; sinon un sondage précis, et s'il n'existe plus c'est le choix automatique qui s'affiche.
- **Ma Chaîne Twitch : deux éléments.** « Followers et abonnements » montre vos chiffres en grand, « Pastille En direct » montre une pastille quand vous diffusez (le jeu et « Hors ligne » en option). Un chiffre que Twitch ne donne pas manque, sans message dans le direct et sans valeur inventée.
- **Rien n'est montré sans votre accord.** Les compteurs de Statistiques de la communauté ne montrent que les chiffres pour lesquels vous avez choisi « Montrer sur mon site », et ceux de Ma Chaîne Twitch suivent vos réglages (« Suivre mes statistiques », « Compter mes followers », « Compter mes abonnements payants »), même en mode test. Un chiffre gardé pour vous n'apparaît nulle part.
- Les éléments s'adaptent à la taille que vous leur donnez, suivent le style commun de la page d'overlay (texte clair ou sombre, fond, angles), ne prennent jamais le style de votre site et ont un contenu d'exemple en mode test.

### Améliorations

- **Rien ne change pour vos overlays actuels** : mêmes adresses, même rendu (identique au pixel près), mêmes réglages. Dans une page d'overlay, la place et la taille réglées dans le module sont ignorées : l'élément remplit le cadre que vous lui donnez. Ma Chaîne Twitch et le Planning n'ont toujours pas d'overlay à eux ; leurs éléments n'existent que dans les pages d'overlay.
- Plusieurs pages d'overlay peuvent montrer le même élément en même temps sans alourdir votre site ni Twitch : une seule lecture (de votre Google Agenda, de vos chiffres, du direct) sert tout le monde pendant quelques dizaines de secondes, et rien n'est consommé à la lecture. Rien ne tourne en arrière-plan ; la page se met à jour doucement, de plus en plus lentement quand rien ne change.
- Aucune migration, aucun nouveau réglage.

### Pour les développeurs

- **Les tests ne laissent plus de dossiers dans `/tmp`.** Une aide `makeTempDir()` (`tests/helpers/tmp.mjs`) enregistre et supprime chaque dossier temporaire, y compris à la sortie du processus ; `npm test` donne à chaque exécution son propre `TMPDIR`, supprimé à la fin, et signale ce qui y reste (`KEEP_TEST_TMP=1` pour déboguer). Aucun module n'est touché.
- Les huit modules passent à `minCore` 0.5.0 (clé `overlayElements` dans `module.json`, `apiVersion` 2 inchangé). Détail de chaque lot dans `docs/changelog-parts/overlay-elements-*.md` (`countdown-sponsors`, `planning-stats`, `maze-alerts`, `polls-twitch`).
- Compte à rebours 1.1.0 : `scale` 600 × 200, options `event` et `seconds`, `pickForElement`, route `state` avec `el=1` / `demo=1`. Overlay sponsors 1.1.0 : `scale` 720 × 180, option `qr`, route `items` avec `demo=1`. Les deux réutilisent l'overlay existant (mode élément quand l'adresse porte `ov-w`).
- Planning 2.5.0 : `overlay.mjs`, routes `element/week` et `element/next`. Statistiques de la communauté 1.2.0 : nouveau droit `routes`, `overlay.mjs`, route `element/counters`, `isShowable` (règle unique).
- Labyrinthe 3D 1.2.0 : `fit: ratio`, ratios 1,33 à 3,56, moteur `followAspect`. Overlay alertes 1.2.0 : `fit: scale` 640×260, option `kinds`, route `feed` (repère par lecteur, journal de 100 alertes), `pullLive` à vol unique par overlay.
- Sondages 1.3.0 : `overlayElements.poll`, option `opt-poll`. Ma Chaîne Twitch 2.2.0 : `overlay.mjs`, routes `element/:slug` et `element-data/:slug` protégées par un secret propre au module (collection `twitchElementKey`).
- Tests : `overlay-elements-countdown-sponsors`, `overlay-elements-regression`, `planning-overlay`, `community-stats-overlay`, `overlay-elements-alerts`, `overlay-elements-maze`, `polls-overlay-element`, `twitch-overlay-elements` (tous avec `assertMultiReaders` quand il y a lieu), `tests/golden/` et `tests/fixtures/overlay-elements-golden.json` (empreintes de l'overlay d'avant) ; `tests/tmp-hygiene.test.mjs` ; versions ajustées dans les tests existants.
- **Attention à la publication** : cette version demande Curiosa 0.5.0 (publié).
- **Assemblage** : `package.json` 1.26.0, `catalogue/index.json` régénéré (refs `v1.26.0`).

## 1.25.0

*La télécommande de Participation (Sondages, « A ou B ? », sourdine…) devient aussi un dock pour OBS, avec la même adresse secrète. Pour Curiosa 0.2.5 ou plus. Module touché : Participation 1.1.0.*

### Nouveautés

- **La télécommande de Participation existe maintenant en « dock » pour OBS.** C'est la même télécommande, avec toutes ses fonctions (lancer, arrêter, suivant, « A ou B ? » en un geste, mettre une personne en sourdine, vider une salle, et tout ce que Sondages ou les futurs modules y ajoutent), dans un petit panneau étroit à placer dans OBS. Elle se manie à la souris comme au clavier, sur fond sombre, avec des boutons assez grands pour être cliqués sans viser.
- **Une seule adresse secrète.** L'adresse du dock est celle du téléphone avec `&dock=1` à la fin : pas de deuxième secret à garder. Dans l'onglet « En direct » de Participation, elle s'affiche juste sous celle du téléphone, avec un bouton « Copier » et trois étapes pour OBS : **Docks**, **Docks de navigateur personnalisés**, un nom, l'adresse, **Appliquer**. Vous pouvez aussi l'ouvrir dans un onglet.
- **« Créer une nouvelle adresse » change tout d'un coup.** Le téléphone et le dock cessent de marcher ; il suffit de rouvrir la télécommande sur le téléphone et de coller la nouvelle adresse du dock dans OBS. Le texte de la case à cocher et le message de réussite le disent.
- **Sondages (et les modules à venir) apparaissent dans le dock sans rien changer de leur côté**, avec les mêmes boutons, le même formulaire « A ou B ? » et les mêmes messages d'erreur sous les champs.

### Améliorations

- **Au clavier, le bouton choisi garde le focus** quand la télécommande se met à jour toute seule (téléphone comme dock) : on peut enchaîner « Suivant », « Suivant » avec Tab puis Entrée sans reprendre la main.
- Dans le dock, un geste risqué (« Arrêter », « Vider la salle ») demande de **cliquer encore** pour confirmer (et non « toucher » : la souris n'est pas un doigt).
- La page de la télécommande (téléphone et dock) n'accepte plus que son propre script et ne peut parler qu'à votre site ; la police du thème est vérifiée avant d'être utilisée.
- Rien ne change pour ce que vous aviez : l'adresse du téléphone, les droits (« voir les adresses secrètes de la télécommande et les changer », « modérer »), les réglages et les données sont ceux d'avant. Aucune migration.

### Pour les développeurs

- **Participation 1.1.0** : voir `docs/changelog-parts/audience-dock.md`. `minCore` 0.2.5 et `apiVersion` 2 inchangés, aucun nouveau droit, aucune donnée ni migration (`dataVersion` inchangé). Route `remote` avec `&dock=1` (`wantsDock`, `remoteResponse`), même script `REMOTE_JS`, mêmes routes `remote-state` et `remote-press`.
- Tests : `tests/audience-dock.test.mjs` (nouveau, 11 tests, avec un navigateur factice qui fait tourner le vrai script : `tests/helpers/remoteDom.mjs`) ; `tests/audience.test.mjs` ajusté (version).

## 1.24.0

*Vous pouvez supprimer un sondage, terminé ou en cours, en sachant exactement ce qui sera perdu. Pour Curiosa 0.2.5 ou plus. Module touché : Sondages 1.2.0.*

### Nouveautés

- **Un bouton « Supprimer » pour chaque sondage**, dans la liste et dans ses détails, pour les sondages terminés, en cours et archivés (ceux-ci apparaissent maintenant dans l'administration, 50 par page). Il ouvre une page qui dit ce qui sera perdu : « Ce sondage et ses 12 votes seront supprimés définitivement. » Rien n'est supprimé tant que la case n'est pas cochée.
- **Pour un sondage en cours, une confirmation renforcée.** La page prévient que des personnes peuvent encore voter, que les votes en cours seront perdus et que la page disparaîtra tout de suite, y compris à l'écran du stream. Elle demande une seconde case et propose de **fermer le sondage plutôt** (le résultat reste visible).
- **Tout part avec lui** : le sondage, ses choix, ses votes et ses totaux. S'il était affiché à l'écran, l'écran est libéré ; avec Participation, l'écran du stream et la page « en cours » se mettent à jour tout de suite. Les décisions des manches déjà prises ne sont jamais touchées.
- **L'ancienne adresse reste propre** : elle affiche « Ce sondage n'existe plus » (le même message qu'une adresse qui n'a jamais existé, sans rien révéler). Une source OBS réglée sur ce sondage n'affiche plus rien, au lieu de montrer un autre sondage.
- **Votre assistant IA peut supprimer un sondage** avec le nouvel outil `poll_delete`, mais seulement si vous le lui accordez expressément (jamais d'office). Un sondage encore ouvert est refusé tant que l'assistant ne précise pas `allowOpen: true`.

### Améliorations

- La manche en cours ne se supprime pas ici : la page l'explique et renvoie vers « Suivant » ou « Arrêter ».
- Beaucoup de votes ne posent pas de problème : ils s'effacent par petites tranches. Si le travail est trop long, le sondage est fermé, le message le dit et un nouveau clic termine la suppression.
- Le message de réussite dit combien de votes sont partis.
- Rien à refaire : aucune donnée n'est modifiée, droits et réglages sont ceux d'avant (le droit « créer, modifier, fermer et supprimer des sondages » couvrait déjà la suppression).

### Pour les développeurs

- **Sondages 1.2.0** : voir `docs/changelog-parts/polls-delete.md`. `minCore` 0.2.5 et `apiVersion` 2 inchangés, aucune migration, aucun nouveau droit. `deletePoll` (relecture côté serveur, bulletins par tranches de 200, ligne retirée en dernier), outil `poll_delete` (destructeur, jamais accordé d'office), page `?delete=<id>`.
- Tests : `tests/polls-delete.test.mjs` (nouveau) ; `polls.test.mjs` et `polls-rounds.test.mjs` ajustés.

## 1.23.0

*Les textes ne supposent plus le genre de personne, ajouter un contact prend quelques secondes, et une récompense de points de chaîne peut lancer « quelque chose chez vous » en mots simples. Pour Curiosa 0.2.6 ou plus. Modules touchés : Contacts 2.3.0, Bot Twitch 1.4.0, Connecteur Home Assistant 1.1.0 (le module Home Assistant change de nom), Actions du live YouTube 1.1.1 et 54 autres modules en version corrective (textes seulement).*

### Nouveautés

- **Une seule question pour une récompense : « Que se passe-t-il quand une personne prend cette récompense ? »** Les choix sont lisibles : « Répondre dans le chat », « Changer la couleur des lumières » (puis une couleur : rouge, vert, bleu, jaune, orange, violet, rose, blanc), « Lire son message à voix haute » et « Autre chose chez moi ». Les récompenses restent réglées dans le Bot Twitch, leur place naturelle.
- **« Autre chose chez moi » : il suffit de donner un nom** (par exemple « Lancer l'aspirateur »). Curiosa fabrique toute seule ce qu'il faut pour relier l'action à Home Assistant. Si le nom existe déjà, c'est la même action qui est reprise ; le renommer plus tard ne casse rien. La liste **« Vos actions »** permet de les retrouver, de les renommer et de retirer celles dont aucune récompense ne se sert.
- **Le nom de l'action partout, jamais un mot technique** : dans la liste des récompenses, dans le journal et dans les messages. Les erreurs s'affichent sous le champ concerné, avec un exemple.
- **Home Assistant sait comment s'appellent vos actions.** Le Bot Twitch donne les noms de vos actions au Connecteur Home Assistant, qui les passe à l'intégration : elle peut proposer « Lancer l'aspirateur → choisir un script ». Rien de votre maison n'est jamais envoyé à Curiosa.
- **Quand Home Assistant n'a pas encore de script pour une action**, la récompense le dit en toutes lettres (« Home Assistant n'a pas encore de script pour cette action. Ouvrez Home Assistant > Curiosa > Configurer pour la relier. »), dans la liste et dans le journal. Les points sont rendus comme avant, mais plus en silence. La page du Connecteur Home Assistant ajoute la liste **« Actions en attente de liaison »**.
- **Deux liens pour s'y retrouver** : sur la page du Connecteur Home Assistant, un bloc « Étape suivante » avec le bouton « Créer ou modifier vos récompenses » ; dans l'onglet Récompenses du Bot Twitch, le lien « Relier à votre maison ». Si l'autre module n'est pas installé, une phrase simple le dit et propose de l'installer.
- **Une mise en route en 3 étapes** sur la page du Connecteur Home Assistant : installer l'intégration dans Home Assistant, l'associer avec le code, créer une première récompense.

### Améliorations

- **« Nouvelle personne » en deux onglets.** **Ajouter via** (par défaut) : on choisit la plateforme, on colle un lien ou on tape un pseudo, on enregistre. Le nom affiché est facultatif (le pseudo sert de nom, ou le nom trouvé sur Twitch ou YouTube quand leur connecteur est installé). **Ajout manuel** : fonction, organisation, e-mail, téléphone, relation, catégories, et deux emplacements pour des comptes.
- **Les plateformes proposées sont celles de votre site** : celles dont le connecteur est installé, celles qui ont déjà un compte dans votre carnet, ou les plus courantes quand il n'y en a aucune. La dernière plateforme utilisée est déjà choisie.
- **Chaque erreur est sous le champ, avec un exemple** (lien d'une autre plateforme, vidéo au lieu d'une chaîne, pseudo trop court…).
- **Pas de seconde fiche par erreur** : si le compte est déjà dans le carnet, le site propose d'ouvrir la fiche existante.
- **La fiche s'ouvre juste après**, avec un message pour la compléter.
- **« Statut » quitte le formulaire** (il ne servait qu'aux messages du formulaire de contact, qui gardent leur bouton « C'est vérifié » sur la fiche). Les catégories se lisent « Dans la catégorie « Cible de raid » », avec une phrase d'aide. Textes sans accord de genre.
- Rien d'autre ne change : données, outils pour assistants IA, droits et services (Partenariats, Raid, Story…) sont les mêmes.
- **« Home Assistant » devient « Connecteur Home Assistant »** (« Home Assistant connector » en anglais), comme « Connecteur Twitch ». Rien à refaire : même module, mêmes liens, mêmes réglages, mêmes récompenses. Les textes du Bot Twitch et d'Actions du live YouTube qui parlaient du « module Home Assistant » ont suivi.
- **Mode avancé** : un réglage « Montrer les identifiants techniques des actions » montre l'identifiant à côté du nom et permet d'en choisir un pour une nouvelle action, pour qui relie sa maison à la main. Par défaut, il n'est jamais montré.
- **Rien à refaire pour vos récompenses actuelles.** L'ancien réglage « Autres actions à choisir » (avancé) continue de marcher : ses mots sont repris automatiquement dans « Vos actions », le mot servant de nom. Aucune récompense ne change, rien n'est perdu.
- Votre assistant IA peut donner un nom à une action en créant ou en modifiant une récompense, et voit le nom des actions.
- **Des textes qui ne supposent le genre de personne.** 57 modules et un exemple reçoivent une version corrective : textes de l'administration, pages publiques, aides et README réécrits pour ne supposer ni le genre de la personne qui gère le site, ni celui de son public. Aucun réglage, aucune donnée, aucune adresse ne change.
- **Commandes** dit maintenant : « Une file de commandes claire pour toute personne qui crée sur commande ». Avant, le texte parlait des « créatrices » et de « chaque cliente ». Les messages, l'aide et la version anglaise (« they ») suivent.
- **Le public, pas « les visiteurs ».** Dans toute l'administration et les README : « votre public », « la personne qui visite », « par personne » à la place de « vos visiteurs », « le visiteur », « par visiteur ». Même chose pour les spectateurs (« audience », « personnes qui regardent ») et les abonnés (« followers », « abonnements payants »).
- **Plus d'accords sur la personne qui lit.** Disparus : « connecté·e », « discret(e) », « vous êtes prête », « vous seule », « le propriétaire », « la propriétaire » (on lit « la personne propriétaire »), « quelqu'un » (« une personne »), « Cela m'a aidé » (« Cela m'a été utile »), « Un·e indépendant·e ».
- **Des exemples qui ne sont pas tous de même genre** : prénoms d'exemple neutres (Camille, Alex, Sacha, Dominique), « Création en solo » au lieu de « Créateur seul », « Artistes » au lieu de « Créateurs » dans l'annuaire, « Personnes invitées » au lieu d'« Intervenants » dans Événements, « Pseudo » au lieu de « Joueur » dans le classement du Jeu du jour.
- **Les modèles de texte du Bot Twitch** : si le pseudo est introuvable, le bot dit « chat » à la place de « ami ». La variable `{utilisateur}` ne change pas : vos commandes continuent de marcher.
- Le dock du Raid Twitch reste exactement le même (ses empreintes de la 2.1 sont verrouillées) : seuls l'administration et le README changent.
- **« L'administration » plutôt que « les administrateurs ».** Suggestions de jeux (« Réservé à l'administration »), Story d'annonce, Bot Twitch, Connecteur Home Assistant et Actions du live YouTube parlent de l'administration ou de l'équipe d'administration, comme le cœur de Curiosa qui renomme le rôle.

### Pour les développeurs

- **Bot Twitch 1.4.0** (`dataVersion` 3) : `actions.mjs` (nouveau, fichier feuille) : actions de base, couleurs, actions nommées (collection `homeAction`, 50 au plus), clé fabriquée `perso:<nom>` (minuscules sans accents, `-2`, `-3` si prise, forme `^[a-z0-9][a-z0-9:_-]{0,39}$`, **stable** au renommage), état de liaison par action (`links` dans l'état du bot, 50 au plus : `unmapped` / `ok`), publication du sujet `home.actions`. Migration 3 : les mots de `extraActions` et les clés portées par des récompenses deviennent des actions nommées (idempotente) ; le réglage continue d'être lu. Nouveau réglage avancé `showKeys`. `rewards.mjs` : `check` reçoit `named`, `retarget`. `redeem.mjs` : la raison d'un refus de la maison suit le code de l'accusé (`unmapped`, `disabled`, `expired`), le journal garde le nom (`an`), `adminPathOf`. Aucun nouveau minuteur ni nouvelle tâche. Outils MCP : `customActionName`, `actionName`, `actions`.
- **Connecteur Home Assistant 1.1.0** : `catalog.mjs` (nouveau) lit le sujet facultatif `home.actions` (30 s de cache, 1,5 s au plus, 50 éléments, libellé de 60 caractères, nettoyé) ; `pull` ajoute le champ additif `catalog` (contrat HTTP v1 compatible ; `docs/ideas/home-assistant-contract.md`) ; `haCore.unmapped` (20 au plus) alimente « Actions en attente de liaison ». Identifiant, service `home-assistant.bridge`, routes et sujets fournis inchangés.
- **Actions du live YouTube 1.1.1** : textes seulement (« Connecteur Home Assistant »).
- Sujet `home.actions` ajouté à `docs/TOPICS.md`. Simulateur `tests/helpers/fakeHaClient.mjs` : lit `catalog`, `proposals()`. Test `home-actions.test.mjs` (parcours complet avec les deux vrais modules).
- **Contacts 2.3.0** : voir `docs/changelog-parts/contacts-quick-add.md` (`networks.checkAccountInput`, `quick.mjs`, `book.saveCard` accepte `accounts` à la création). Les aides `helpEmail` et `helpCategories` restent telles que retouchées dans la 2.3.0.
- Écriture neutre, modules (version corrective, textes seulement ; contacts, twitch-bot, home-assistant montent plus haut ci-dessus) : alerts-overlay 1.1.1, audience 1.0.1, bandcamp 1.0.2, bluesky 1.1.3, calendar-ical 1.0.2, calendar-manual 1.0.2, commissions 1.0.1, community-stats 1.1.3, content-planner 1.0.1, contacts 2.2.3, countdown 1.0.1, daily-game 1.0.1, directory 1.0.1, discord 1.1.5, events 1.0.1, facebook 1.0.2, faq 1.0.2, gallery 1.1.1, game-covers 1.0.1, game-suggestions 1.5.1, github 1.1.3, hero 1.0.2, home-assistant 1.0.2, instagram 1.0.2, kick 1.0.2, kofi 1.0.2, legal-pages 1.0.1, live-status 1.4.2, map 1.0.2, mascot 1.0.1, mastodon 1.1.3, patreon 1.0.2, pinterest 1.0.2, planning 2.4.1, platform-links 1.1.1, polls 1.1.1, reddit 1.1.3, snapchat 1.0.2, soundcloud 1.0.2, spotify 1.0.2, steam 1.0.2, stream-story 2.5.1, supporters 1.0.1, telegram 1.0.2, testimonials 1.0.1, thanks-wall 1.0.2, threads 1.0.2, tiktok 1.0.2, twitch-bot 1.3.1, twitch-channel 2.1.1, twitch-connector 1.2.1, twitch-raid 2.2.4, videos 1.0.1, x-twitter 1.0.2, youtube-channel 1.4.1, youtube-connector 1.3.1, youtube-live-actions 1.1.1, et l'exemple Livre d'or 1.0.6. `dataVersion`, `minCore` et `apiVersion` ne changent pas.
- Les constantes `VERSION` qui doivent suivre le manifeste sont montées avec lui (`events`, `faq`, `map`, `mascot`). Aucune clé de réglage, de texte ni d'outil MCP ne change : parité exacte FR/EN.
- Nouveau test `tests/neutral-wording.test.mjs` : lit les valeurs des `.json`, les `.md` et les chaînes du code (jamais les commentaires) et refuse les termes genrés connus (liste modifiable en tête de fichier). Sa liste blanche est commentée entrée par entrée et ne garde rien d'inutile.
- Textes volontairement conservés : le dock du Raid Twitch (empreintes de la 2.1), la variable `{utilisateur}`, la liste de pseudos réservés d'Audience, « droit d'auteur », le badge « Gagnant » des Sondages (un choix, pas une personne), les sigles « PNJ » et « joueur contre joueur » du quiz, les alias de colonnes à l'import d'Événements.
- Les titres de sections « Pour les développeurs » du CHANGELOG et des brouillons restent tels quels (des tests les vérifient) ; ceux des README deviennent « Pour qui développe ».
- **Assemblage** : `package.json` 1.23.0, `catalogue/index.json` régénéré (refs `v1.23.0`). Extraits : `docs/changelog-parts/ecriture-neutre.md`, `contacts-quick-add.md` et `home-actions.md`. Versions finales là où plusieurs branches touchaient le même module : Contacts 2.3.0 (et non 2.2.3), Bot Twitch 1.4.0 (et non 1.3.1), Connecteur Home Assistant 1.1.0 (et non 1.0.2), Actions du live YouTube 1.1.1. Partenariats passe à 2.0.3 (un texte d'outil pour assistants IA parle de « l'administration »).

## 1.22.1

*Un module de départ pour ceux qui veulent publier leur propre module, et des explications d'installation corrigées. Aucun module du Catalogue ne change. Pour Curiosa 0.2.10 ou plus.*

### Améliorations

- **Un module de départ à copier, le dossier « starter ».** Il contient tout ce qu'il faut pour publier son propre module dans son dépôt : le module, ses textes en français et en anglais, un test, des tests automatiques sur GitHub et un texte d'installation prêt à coller. Il n'est pas proposé dans le Catalogue.
- **Les explications d'installation des deux exemples sont justes.** Le module est installé tout de suite et actif, puis on clique sur « Mettre en place ». Avant, elles parlaient d'un module « désactivé » et d'un menu qui n'existe plus.
- **Le guide « Publier son propre module »** (dans la documentation de Curiosa) explique, de zéro, comment publier un module dans son dépôt GitHub, le tester et le faire installer.
- Rien d'autre ne change : les modules du Catalogue gardent leur version.

## 1.22.0

*Vous ajoutez vous-même un jeu à votre liste, et la vidéo d'annonce se prépare en trois étapes simples. Pour Curiosa 0.2.10 ou plus. Modules touchés : Suggestions de jeux 1.5.0 et Story d'annonce 2.5.0.*

### Améliorations

- **Un formulaire « Ajouter un jeu » en haut de l'administration.** Un seul champ à remplir : le nom du jeu. Le statut est « Déjà joué » au départ (vous pouvez en choisir un autre), la note est facultative. La jaquette est trouvée toute seule ; si ce n'est pas le bon jeu, le lien « Ce n'est pas le bon jeu ? » est là.
- **Plusieurs jeux d'un coup.** « Ajouter plusieurs jeux d'un coup » : collez votre liste, un jeu par ligne (50 au plus par envoi). Si une ligne pose problème, rien n'est ajouté et les lignes à corriger sont indiquées sous le champ.
- **Pas de doublon par erreur.** Si le jeu est déjà dans la liste (même écrit avec d'autres majuscules ou sans accent), le formulaire le dit sous le champ et explique comment changer son statut.
- **Une image de votre choix.** Si aucune jaquette n'est trouvée, « Choisir l'image moi-même » (replié par défaut) permet de donner l'adresse d'une image. Un bouton « Jaquette… » sur chaque ligne permet de le faire plus tard.
- **Un jeu ajouté par vous se comporte comme les autres** : il apparaît sur la page publique sans pseudo de visiteur, les visiteurs peuvent voter « rejoue-le » s'il est « déjà joué », et il est dans la sauvegarde lisible (`games.csv`, nouvelle colonne « origin »). Rien ne change pour les visiteurs. Le tableau de l'administration se lit maintenant par pages de 50.
- **Votre assistant IA peut aussi ajouter des jeux** (outil « game_suggestions_add »), avec les mêmes règles.
- **Le prochain événement est déjà choisi quand vous ouvrez l'écran**, parmi toutes vos sources (agenda, YouTube programmé, Twitch…), classé par date et heure. L'aperçu est déjà prêt : un clic sur **« Générer maintenant »** suffit. Plus besoin de chercher.
- **Trois étapes simples** : 1 Événement, 2 Look, 3 Vidéo. Un indicateur cliquable, « Précédent » et « Suivant », et des boutons toujours visibles en bas de l'écran du téléphone. L'aperçu reste affiché à chaque étape et bouge quand vous changez quelque chose. Avant, il fallait descendre de plus de quatre écrans pour trouver le bouton.
- **« Changer d'événement »** ouvre une liste courte (les 5 prochains, avec la source, le jour et l'heure) et « Voir plus d'événements » en ajoute. La recherche n'apparaît que s'il y en a beaucoup. Changer d'événement, ou revenir en arrière, ne fait rien perdre.
- **Le look** (style, votre phrase, la mention « Made with Curiosa », co-streamers, modèles) est à l'étape 2 ; **« Afficher les options avancées »** garde pour la fin ce que la vidéo montre, le format, la durée, la langue, le nom de la chaîne et les zones de sécurité. Rien n'a disparu.
- **L'étape 3 résume la vidéo** (événement, style, format et durée, phrase, mention, co-streamers) avec un bouton « Modifier » pour chaque ligne, puis fabrique la vidéo, avec l'avancement, la lecture et le téléchargement. Quand un modèle ou votre assistant a déjà tout rempli, l'écran s'ouvre directement sur cette étape.
- **Plus clair quand quelque chose manque** : s'il n'y a aucun événement, vous écrivez le titre et la date tout de suite. Si une source ne répond pas, un message simple apparaît sous l'événement, avec « Réessayer », et les autres sources continuent de marcher. Un événement déjà commencé est marqué « Déjà commencé » ; deux événements à la même heure sont signalés.
- **Plus agréable à utiliser** : les erreurs s'affichent sous le champ avec un exemple, les boutons disent ce qu'ils font (« Création en cours… 42 % », « Enregistrement… »), les zones à toucher font au moins 44 px, tout se fait au clavier, le mouvement réduit est respecté. Le lien « Ce n'est pas le bon jeu ? » est toujours là quand la jaquette est incertaine. Clair et sombre, français et anglais.
- Vos modèles, vos anciens liens, les préparations de votre assistant et ses outils fonctionnent comme avant.

### Pour les développeurs

- Aucune migration : les lignes ajoutées portent `origin: "admin"` (donnée facultative ; une ligne sans `origin` vaut « visiteur »). `dataVersion` reste 2, `minCore` reste 0.2.10, aucune nouvelle permission.
- `addGames(ctx, { lines, status, note, image, field })` (exportée) : tout ou rien, 50 lignes au plus, doublons par `titleKey` (sans accents, majuscules ni ponctuation, lignes rejetées comprises), plafond de 2000, jaquette par `coverFor` (service `game.cover`, repli `ctx.api.rawg`) : 1 recherche pour un jeu, 10 au plus en lot, le reste est laissé à la tâche de rattrapage existante (aucun nouveau minuteur). Image à la main : `imageUrlOf` (https, 500 caractères, sans espace), marquée `coverResult: "manual"`.
- Nouvelles actions d'admin `addGame`, `addGames`, `setImage` (fonctions : administrateurs, comme `status_*`) ; erreurs par champ (`errors`). `adminPanel(ctx, { query })` lit `ajout` (`plusieurs` | `image`), `jaquette` (id d'une ligne) et `page`.
- Outil MCP `game_suggestions_add` (écriture) ; `game_suggestions_list` renvoie `origin`. `rows(ctx, limit)` lit jusqu'à 2000 lignes pour l'admin, l'export et la détection de doublons (la page publique garde 1000).
- Tests : `tests/game-suggestions-add.test.mjs`.
- **Story d'annonce 2.5.0** : seuls `page.mjs` (page, CSS), `app.mjs` (éditeur, fichier du navigateur), `pure.mjs` (deux fonctions), les locales, le README et la version changent. **Routes, formats de données, réglages, outils MCP (`story_models`, `story_next_streams`, `story_events`, `story_prepare`) et `dataVersion` (2) sont inchangés** ; pas de migration ; `minCore` inchangé.
- `pure.mjs` : `isUpcoming(e, nowMs, tz)` (pas commencé ; une journée entière compte jusqu'à la fin du jour) et `nextEvent(items, nowMs, tz)` (premier à venir, sinon premier). L'éditeur les applique à la première page de la route `events` (déjà agrégée et triée par `events.mjs`) ; aucune agrégation n'est dupliquée. La première page passe de 20 à 5 événements (`FIRST_PAGE`), « voir plus » à 10 (`NEXT_PAGE`) ; recherche et filtres visibles au-delà de 8 événements (`SEARCH_FROM`).
- Éditeur : `S.pickerOpen`, `S.defaultId` (badge « Prochain événement »), `S.advanced` (case mémorisée dans `localStorage` sous `story-advanced`, avec `try/catch` ; ouverte d'office si `advancedUsed()`). `event-alert` (sources en panne, sous l'événement) et `event-sources` (notes de la liste). Assistant : `S.step` (1 à 3), `setStep`, `renderSteps`, `renderRecap` ; `.wiz` en grille (zones `steps`, `panels`, `side`), `.top` collé en haut et `.navbar` fixe sous 720 px, collée en bas du panneau au-dessus. `generate-now` (étapes 1 et 2) passe à l'étape 3 puis appelle `generate()` ; `generate` n'est visible qu'à l'étape 3. Une préparation (`?p=`) ou le chargement d'un modèle ouvre l'étape 3. Identifiants conservés (`event-list`, `event-q`, `event-more`, `el-*`, `style-*`, `generate`, `cover-warn`…).
- Locales : 39 clés ajoutées, 2 retirées (`ui_event_help`, `ui_event_manual_chosen`), 10 réécrites ; parité FR/EN et variables vérifiées par test.
- Tests : nouveau `stream-story-ux` (prochain événement, tout commencé, même heure, travail conservé, assistant en 3 étapes : navigation, « Générer maintenant », récapitulatif et « Modifier », ouverture sur l'étape 3 par une préparation ou un modèle, options avancées, erreurs sous le champ, parité, structure de la page) ; `stream-story-update` : cas 2.3.0 → 2.5.0 avec le dossier `tests/fixtures/stream-story-2.3.0` ; modifiés parce que le changement est voulu : `stream-story-events-editor` (liste repliée de 5, badge, messages de panne lus dans `event-alert`, « voir plus » par 10, titre, phrase du choix manuel), `stream-story-watermark` (version, place de la case dans l'étape « Look » et non dans les options avancées), `stream-story` (version).
- Conflits probables avec une branche qui touche aussi *Story d'annonce* : `modules/stream-story/page.mjs`, `app.mjs`, `locales/fr.json` et `en.json`, `module.json` (version), `README.md`, et les trois tests modifiés.
- **Assemblage** : `package.json` 1.22.0, `catalogue/index.json` régénéré (refs `v1.22.0`, 72 modules, aucun module nouveau). Extraits : `docs/changelog-parts/gs-add-game.md` et `story-ux.md`. Un conflit de fusion, dans `tests/game-covers-consumers.test.mjs` (versions attendues : Suggestions de jeux 1.5.0, Planning 2.4.0, Story d'annonce 2.5.0). Texte de la 1.21.0 corrigé : le réglage secret de Jaquettes de jeux s'appelle `rawgKey`, pas `apiKey`.

## 1.21.0

*Les jaquettes de jeux deviennent un module à part entière, et le dépôt des modules est mieux rangé pour ceux qui en écrivent. Pour Curiosa 0.2.14 ou plus : mettez d'abord Curiosa à jour, c'est lui qui installe le nouveau module et lui confie votre clé. Modules touchés : Jaquettes de jeux 1.0.0 (nouveau), Suggestions de jeux 1.4.0, Planning 2.4.0 et Story d'annonce 2.4.0.*

### Améliorations

- **Nouveau module « Jaquettes de jeux »** (Jaquettes de jeux 1.0.0). Votre clé RAWG s'y saisit une seule fois, elle n'est jamais réaffichée, et un bouton « Tester la clé » dit en mots simples si elle fonctionne. Les modules qui montrent des jaquettes passent par lui.
- **Rien à refaire si vous aviez déjà une clé.** À la mise à jour de Curiosa, le module s'installe tout seul sur les sites qui utilisaient RAWG, avec votre clé et vos corrections « Quel est le bon jeu ? ». Si vous le retirez, l'ancien réglage du site reprend.
- **Les liens « Ce n'est pas le bon jeu ? » déjà publiés continuent de marcher**, et l'assistant IA garde ses deux outils de jaquettes, avec les mêmes noms.
- **Suggestions de jeux, Planning et Story d'annonce demandent la jaquette au nouveau module** (Suggestions de jeux 1.4.0, Planning 2.4.0, Story d'annonce 2.4.0). Sans lui, ils continuent comme avant : aucune jaquette ne disparaît. Quand la clé manque, ils renvoient vers « Jaquettes de jeux » ou proposent de l'installer d'un clic.

### Pour les développeurs

- **Jaquettes de jeux 1.0.0** : `minCore` 0.2.13. Service `game.cover` v1 (`status`, `cover`, `candidates`, `fix` avec droit `fix` et `asCaller`, `adopt`). Clé en réglage `secret` (`rawgKey`) ou reprise (`adoptedKey`, jamais affichée) ; requêtes par `ctx.api.net` (5 s, 256 Ko) ; cache mémoire borné ; corrections dans `fixes` (1 000) ; journal `todo` (100, 60 jours). Outils MCP `rawg_covers_to_check` et `rawg_cover_set`.
- **Suggestions de jeux 1.4.0, Planning 2.4.0, Story d'annonce 2.4.0** : besoin facultatif `"requires": [{ "service": "game.cover", "optional": true }]`, repli sur `ctx.api.rawg` tant que la cale du cœur existe (retrait prévu en 0.3.0). `minCore` inchangé (0.2.10). Test : `tests/game-covers-consumers.test.mjs`.
- **Dépôt** : registre des sujets `docs/TOPICS.md` (lu par `tests/repo-rules.test.mjs`) ; la CI teste contre le dernier cœur publié (bloquant) et contre `dev` (information) ; `docs/ideas/CAPACITES.md` (revue de capacités avant de construire un module) ; test de neutralité : termes locaux par variable d'environnement.
- **Assemblage** : `package.json` 1.21.0, `catalogue/index.json` régénéré (refs `v1.21.0`, 72 modules). Extraits : `docs/changelog-parts/game-covers.md` et `topics-registry.md`. La CI échoue tant que le cœur 0.2.14 n'est pas publié si un module en exige une capacité ; ce n'est pas le cas ici (`minCore` 0.2.13 au plus).

## 1.20.0

*Les galeries photos effacent vraiment ce que vous supprimez, les liens vers les autres plateformes s'ouvrent plus prudemment, et un nouveau module permet de remercier ceux qui vous soutiennent. Pour Curiosa 0.2.13 ou plus. Modules touchés : Galeries photos 1.1.0, Autres plateformes 1.1.0 et Soutiens 1.0.0 (nouveau).*

### Améliorations

- **Galeries photos : supprimer une photo ou un album efface vraiment ses fichiers du serveur** (Galeries photos 1.1.0). La place est rendue et les fichiers ne partent plus dans les prochaines sauvegardes. Les photos envoyées avant cette mise à jour gardent leur fichier, et le module le dit. « Masquer » reste un simple masquage.
- **Autres plateformes : les liens s'ouvrent de la façon la plus prudente, automatiquement** (Autres plateformes 1.1.0). Les liens directs s'ouvrent dans un nouvel onglet, sans dire à la plateforme quelle page de votre site la visite quitte. Il n'y a rien à régler.
- **Nouveau module Soutiens : remercier les personnes qui vous soutiennent sur une plateforme de mécénat (Patreon, Ko-fi ou fichier), avec leur accord explicite et sans jamais montrer de montant** (Soutiens 1.0.0). Chaque personne reçoit un lien personnel, choisit son pseudo et peut se retirer quand elle veut. Les clés secrètes ne sont jamais réaffichées et aucune adresse e-mail n'est gardée.

### Pour les développeurs

- **Galeries photos 1.1.0** : `minCore` 0.2.13, permission `files`. `addUploadedPhoto` revendique l'original et la miniature (`ctx.api.files.claim`) après chaque envoi, avant d'écrire ; un refus renvoie `{ ok: false, error: "file", reason }` et rend ce qui était déjà revendiqué. `deletePhoto` et `deleteAlbum` retirent les données puis appellent `remove` (lots de 8, ni minuteur ni boucle de fond) ; une ancienne photo non revendiquée est comptée `legacy`, sans erreur. Tests : `gallery-files`, mise à jour à chaud dans `gallery-update`.
- **Autres plateformes 1.1.0** : l'export `social.link` déclare `rel`, `referrerPolicy` et `target` (contrat du cœur 0.2.13) : lien direct `noopener nofollow`, `strict-origin-when-cross-origin`, `_blank` ; lien vers la page `/go` du module `noopener`, `_self`. `minCore` 0.2.13 ; sur un cœur plus ancien ces champs sont ignorés.
- **Soutiens 1.0.0** : table de fournisseurs extensible (`providers.mjs`) : Patreon (API v2, liste blanche d'hôtes, `ctx.api.net`), Ko-fi (webhook vérifié, limité en débit, idempotent), import CSV ; aucun minuteur. Service `supporters.public` v1 (pseudos montrables), `contact.book` v2 et `contact.curate` facultatifs sous le droit `contacts.file`, offre `privacy.subject`. `minCore` 0.2.12. Neuf outils MCP. Tests : `tests/supporters*.test.mjs`.
- **Assemblage** : `package.json` 1.20.0, `catalogue/index.json` régénéré (refs `v1.20.0`, 71 modules). Extraits : `docs/changelog-parts/gallery-delete-files.md`, `platform-links-social.md` et `supporters.md`. Aucun conflit de fusion.

## 1.19.0

*Des mises à jour plus sûres pour six modules, un lien pour corriger une jaquette qui n'est pas la bonne, et une administration du Raid Twitch aux mots plus neutres. Pour Curiosa 0.2.10 ou plus. Modules touchés : Questions fréquentes 1.0.1, Contacts 2.2.2, Mur des remerciements 1.0.1, Assistant maison 1.0.1, Autres plateformes 1.0.1, Labyrinthe en overlay 1.1.1, Planning 2.3.0, Story d'annonce 2.3.0, Suggestions de jeux 1.3.0 et Raid Twitch 2.2.3.*

### Améliorations

- **Mises à jour plus sûres pour six modules** (Questions fréquentes, Contacts, Mur des remerciements, Assistant maison, Autres plateformes, Labyrinthe en overlay). Mettre un module à jour sans redémarrer le site est maintenant vérifié automatiquement pour chacun des modules du dépôt, ce qui évite qu'une mise à jour le laisse « impossible à charger ». Ces six-là avaient un défaut caché, corrigé avant qu'il ne se produise. Rien ne change pour vous : mêmes pages, mêmes réglages, mêmes données.
- **« Ce n'est pas le bon jeu ? » dans Planning, Story d'annonce et Suggestions de jeux** (Planning 2.3.0, Story d'annonce 2.3.0, Suggestions de jeux 1.3.0). Quand le site n'est pas sûr du jeu trouvé pour une jaquette, un lien discret ouvre l'écran de correction, déjà sur le bon titre : vous choisissez le bon jeu en deux clics. Dans la Story d'annonce, vous êtes prévenu avant de fabriquer la vidéo, qui n'est jamais bloquée. Les Suggestions de jeux prennent la bonne jaquette dès que vous rouvrez l'administration. Les visiteurs ne voient jamais ce lien.
- **Raid Twitch : une administration aux mots neutres** (Raid Twitch 2.2.3). L'administration ne parle plus de « membres » ni de « communauté » mais de « chaînes » et de « la liste », en français comme en anglais. Le dock déjà ajouté dans OBS et vos réglages ne changent pas ; vos propres textes restent tels quels.

### Pour les développeurs

- **Test générique de mise à jour à chaud** : `tests/hot-update-all.test.mjs` (aides dans `tests/helpers/hotUpdate.mjs`, règle expliquée dans `docs/HOT-UPDATE.md`). Pour chaque module, analyse du code des fichiers chargés par le serveur (aucun `import` relatif statique, tout `import()` relatif porte la version ; liste blanche `ALLOWED_STATIC` et `BROWSER_ONLY`), puis rejeu de la mise à jour N-1 vers N dans un seul processus pour les 34 modules à plusieurs fichiers serveur. Il exige l'historique git complet avec les étiquettes : `.github/workflows/ci.yml` passe en `fetch-depth: 0` et `HOT_UPDATE_REQUIRE_HISTORY=1` ; sans historique, le rejeu se fait sur la version courante et un test est sauté (avec sa raison). Correctifs : `faq` 1.0.1, `contacts` 2.2.2, `thanks-wall` 1.0.1, `home-assistant` 1.0.1, `platform-links` 1.0.1 (`await import(\`./x.mjs${v}\`)`), `maze-overlay` 1.1.1 (`web/generate.js` importé avec la version).
- **Jaquettes** : `ctx.api.rawg.cover(titre)` lit `ambiguous` et `name` (cœur 0.2.10, d'où `minCore` 0.2.10 pour Planning, Story d'annonce et Suggestions de jeux). Lien `/admin/settings/rawg-covers?titre=` + titre encodé, avec le même titre que celui passé à `cover`. Planning : `coverFor`/`coversForSlots` renvoient `ambiguous`, `wrongCoverHref` exporté. Story d'annonce : la route `cover` renvoie `title`, `ambiguous`, `found` et l'éditeur affiche `#cover-warn`. Suggestions de jeux : `coverAmbiguous` et `refreshAmbiguous` (10 titres au plus à l'ouverture de l'admin).
- **Raid Twitch 2.2.3** : textes seulement (`locales/fr.json`, `en.json`, `module.json`, README), clés de réglages et outils MCP inchangés, dock 2.1 identique (`twitch-raid-compat`). Test `twitch-raid-page-optin` : plus de « membre(s) », « communauté » ni « association » dans les textes par défaut ; parité FR/EN.
- **Test instable corrigé** : le test d'import de Contacts (`contacts-import`) supposait qu'un aperçu de 41 lignes n'était pas fini après 1 ms, ce qui échouait sur une machine rapide. Le réglage de test `importStepMs` accepte maintenant 0 (un seul lot par pas, sans dépendre de l'horloge) ; `modules/contacts/import.mjs` change donc, d'où Contacts 2.2.2 (aucun changement pour l'utilisateur).
- **Assemblage** : `package.json` 1.19.0, `catalogue/index.json` régénéré (refs `v1.19.0`), toujours 70 modules. Extraits : `docs/changelog-parts/hot-update-all.md`, `rawg-wrong-cover.md` et `raid-admin-wording.md`. Aucun conflit de fusion ; seul `tests/contacts-v2.test.mjs` épingle la nouvelle version de Contacts.

## 1.18.1

*Deux petits correctifs : la page « En direct » du Raid Twitch disparaît complètement quand vous l'éteignez, et le bouton « Près de moi » de la Carte peut enfin demander votre position. Pour Curiosa 0.2.12 ou plus. Modules touchés : Raid Twitch 2.2.2 et Carte 1.0.1.*

### Améliorations

- **Raid Twitch : les textes de la page publique sont neutres ; une page éteinte n'apparaît plus nulle part** (Raid Twitch 2.2.2). Les mots par défaut ne parlent plus de « membres » ni de « communauté » : « En direct en ce moment », « Voici qui est en direct sur Twitch maintenant. Passez leur dire bonjour ! » (vos propres mots ne changent pas). Quand la case « Afficher la page publique » est décochée, la page n'existe plus pour vos visiteurs et elle disparaît aussi du menu et du plan du site : il n'y a plus rien à retirer à la main. L'administration vous dit ce qui se passe.
- **Carte : la position n'est demandée qu'après un clic et seulement si le module est installé** (Carte 1.0.1). Sans cette autorisation côté site, le navigateur refusait la position même après le clic. Maintenant « Près de moi » la demande normalement, uniquement quand le visiteur clique ; la position reste sur son appareil.

### Pour les développeurs

- **Raid Twitch 2.2.2** : fusion de `fix/raid-page-optin` (2.2.1 : textes `pub_*` neutres FR/EN, page éteinte = 404, route `members` identique à une route inconnue, `mo_page_off_addr`), puis `minCore` 0.2.12 et `"pageSetting": "publicPage"` (booléen, défaut `false`, `page: true`) : le cœur retire la page éteinte du plan du site, de `llms.txt`, du menu et de la résolution des adresses. `mo_page_off_addr` et la documentation ne parlent plus d'une entrée restante du plan du site. Les empreintes du dock 2.1 restent verrouillées par `twitch-raid-compat`.
- **Carte 1.0.1** : permission `visitor.geolocation` et `minCore` 0.2.12 (le cœur n'ouvre `Permissions-Policy: geolocation=(self)` que si un module installé la déclare). `navigator.geolocation` n'est appelé que dans le gestionnaire de clic de « Près de moi ».
- **Assemblage** : `package.json` 1.18.1, `catalogue/index.json` régénéré (refs `v1.18.1`, Carte 1.0.1, Raid Twitch 2.2.2), toujours 70 modules. Extraits : `docs/changelog-parts/raid-page-optin.md` et `map-geolocation.md`. Tests mis à jour : `map-module`, `twitch-raid`, `twitch-raid-large`, `twitch-raid-page-optin`, `tabs-modules` (Raid demande le cœur 0.2.12).

## 1.18.0

*Sept nouveaux modules pour une association, un club ou une petite communauté : un agenda d'événements, des galeries photos, une vidéothèque, un annuaire des membres, une carte des lieux, un petit jeu quotidien et une mascotte. Et le Raid Twitch peut mettre en avant une sélection de membres en direct. Pour Curiosa 0.2.6 ou plus (0.2.5 pour la Mascotte seule). Modules nouveaux : Événements 1.0.0, Galeries photos 1.0.0, Vidéothèque 1.0.0, Annuaire 1.0.0, Carte 1.0.0, Jeu du jour 1.0.0 et Mascotte 1.0.0. Module touché : Raid Twitch 2.2.0.*

### Améliorations

- **Événements : un agenda de rendez-vous et de formations** (Événements 1.0.0). Prochains rendez-vous avec filtre par type et recherche, calendrier du mois, fiche complète, rétrospective des événements passés. L'heure s'affiche chez le visiteur, écrite en toutes lettres. Programme en créneaux, intervenants, inscription par lien, places restantes, complet / annulé / reporté, « Ajouter à mon agenda ». Vous ajoutez un événement en une seule étape (titre, date, heure, lieu, texte), vous pouvez le dupliquer ou le répéter chaque semaine ou chaque mois, et importer ou exporter un fichier tableur. Vos rendez-vous publiés apparaissent dans la liste de l'annonce en vidéo (Story d'annonce) ; ceux qui ont des coordonnées peuvent aller sur la carte.
- **Galeries photos : des albums à vous** (Galeries photos 1.0.0). Une visionneuse plein écran accessible, un lien par photo, une mention de consentement et une demande de retrait en un clic. Les photos sont envoyées avec l'envoi d'images du site, réduites et débarrassées de leurs informations cachées (position GPS comprise) directement dans votre navigateur ; vous réglez le poids visé et le nombre de photos, ou vous liez simplement un album d'un autre service. Retirer une photo n'efface pas encore son fichier (limite du site de base). Trois points de départ (Rétrospectives, Portfolio, Vide) et plusieurs galeries possibles. Un événement peut renvoyer vers son album.
- **Vidéothèque : vos vidéos YouTube sur une page à vous** (Vidéothèque 1.0.0). Grille, catégories, recherche, séries à regarder dans l'ordre, transcription, partage. Vous collez une adresse (ou plusieurs d'un coup) et le titre se remplit ; si YouTube ne répond pas, vous l'écrivez. Rien n'est hébergé, et le lecteur ne se charge qu'après un clic : aucune requête vers YouTube avant, aucun cookie.
- **Annuaire : retrouvez vos membres, créateurs ou partenaires** (Annuaire 1.0.0). Une page publique pour chercher (sans accents) et filtrer une grande liste de personnes venant de Contacts : catégories, tri, pages, fiche détaillée, section Équipe, version imprimable et fichier CSV, bouton « Proposer ma fiche ». Une personne se retire en un clic (catégorie « Ne pas montrer » de Contacts, ou « Masquer »). La carte n'apparaît qu'avec l'accord de la personne et au niveau de la ville. Tient 5 000 personnes et garde la dernière liste si Contacts ne répond pas.
- **Carte : une liste de lieux utiles et une carte** (Carte 1.0.0). Filtres par type, recherche, carte OpenStreetMap affichée seulement quand le visiteur le demande, et « Près de moi » (les lieux triés par distance, sans que la position quitte l'appareil). Vous ajoutez un lieu en collant un lien Google Maps, OpenStreetMap ou Plans, ou par import de fichier CSV. Les lieux des événements et de l'annuaire apparaissent d'eux-mêmes, avec leur source, et se masquent un par un.
- **Jeu du jour : une question par jour pour donner envie de revenir** (Jeu du jour 1.0.0). Un quiz quotidien (une question, 2 à 4 réponses, une explication, « revenez demain »), le même pour tout le monde, sans compte et sans cookie : la série de jours et le meilleur score restent dans le navigateur du visiteur, avec un bouton pour tout effacer. Chronomètre en bonus (jamais une limite), texte à partager sans dévoiler la réponse, bloc facultatif pour la page d'accueil, classement de la semaine avec pseudo (grâce à Participation). Une banque de questions facile à remplir (brouillon ou publiée, image, catégorie, date précise, aperçu, « il reste N jours de questions »), deux packs de 30 questions (français et anglais), import et export CSV. Si le module Mascotte est installé, elle peut inviter à jouer : une invitation par jour, jamais la réponse.
- **Mascotte : un petit personnage discret pour donner de la vie au site** (Mascotte 1.0.0). Elle dit bonjour, donne une astuce ou annonce le prochain événement, puis se range : une apparition par visite après quelques secondes, jamais deux fois la même phrase, 3 messages par jour au plus, pas de son, aucune animation si « mouvement réduit ». Dessin inclus aux couleurs de votre thème, ou votre propre image. Vous écrivez vos phrases (100 au plus, par langue, partout ou sur certaines pages) et chaque annonce (événement, direct Twitch ou YouTube, dernière nouveauté) est facultative. Le visiteur garde la main : croix, coupure pour toujours, aucun cookie. Elle s'installe en brouillon, avec un aperçu, et un bouton « Publier ».
- **Raid Twitch : une sélection du moment** (Raid Twitch 2.2.0). Le dock peut montrer 5 membres en direct tirés au hasard (de 1 à 10) au lieu de toute la liste. La sélection reste la même pendant 10 minutes pour tout le monde, puis se renouvelle ; un bouton « Tirer de nouveau » en tire une autre tout de suite. Le tirage est équitable (les mêmes personnes ne reviennent pas tant que d'autres sont en direct), avec une option « petites chaînes d'abord » et une liste de pseudos à ne jamais tirer. Une page publique facultative, éteinte au départ, « En direct chez nos membres » montre les mêmes membres (jeu, titre, spectateurs, durée, bouton « Regarder sur Twitch ») et se met à jour toute seule ; une adresse à part, secrète, sert pour OBS. Les personnes rangées dans « Ne pas montrer » dans Contacts ne sont jamais tirées ni montrées. Le dock d'avant ne change pas : rien à faire pour les sites qui l'utilisent déjà.

### Pour les développeurs

- **Services et sujets entre modules** : *Événements* offre `event.source` (v1, `each`, `upcoming`) : Story d'annonce affiche ses rendez-vous sans changement ; il publie aussi le sujet `map.place`, comme *Annuaire* (les deux sont consommés par *Carte*). *Mascotte* lit `event.source` pour annoncer le prochain événement. *Galeries photos* offre `gallery.albums` (v1, lecture seule) et *Vidéothèque* offre `videos.library` (v1, lecture seule) ; *Événements* consomme les deux, *Vidéothèque* consomme `gallery.albums`, en facultatif. *Jeu du jour* publie `mascot.hint`, consommé avec `feed.item` par *Mascotte*. Les deux sujets `map.place` et `mascot.hint` sont documentés dans `docs/MODULES.md` du cœur 0.2.11.
- **Raid Twitch 2.2.0** : `minCore` 0.2.6 (script de page). Nouveaux fichiers `draw.mjs` (tirage pur, graine, rotation, poids, exclusions), `moment.mjs`, `consent.mjs`, `public.mjs` (route publique `members`), `featured-dock.mjs`, `moment-admin.mjs` (onglet `moment`), `scripts/live-members.js` ; routes `featured`, `featured-data`, `featured-again` (clé secrète) et `members` ; outil MCP `raid_featured_now` ; 12 réglages ajoutés. Les empreintes du dock 2.1 sont verrouillées par `twitch-raid-compat`.
- Chaque module garde sa documentation dans son `README.md` et son extrait dans `docs/changelog-parts/assoc-*.md`. Tous les imports de fichiers voisins portent la version de `index.mjs`, et chaque module a son test de mise à jour à chaud.
- **Assemblage** : deux faux fournisseurs de test portaient le même nom dans deux branches ; ceux des Événements sont devenus `tests/helpers/fakeGalleryEvents.mjs` et `tests/helpers/fakeVideosEvents.mjs`. `tests/content.test.mjs` compte 70 modules ; `tests/event-source-contract.test.mjs` attend `events`, `twitch-channel` et `youtube-channel` comme fournisseurs de `event.source` ; `tests/tabs-modules.test.mjs` demande le cœur 0.2.6 pour `twitch-raid`.

## 1.17.0

*Une case à cocher pour signer vos vidéos. Pour Curiosa 0.2.2 ou plus. Module touché : Story d'annonce 2.2.0.*

### Améliorations

- **Une case à cocher : « Ajouter la mention “Made with Curiosa” en bas de la vidéo ».** Elle est **décochée au départ** : rien n'est ajouté à vos vidéos sans que vous le choisissiez. Cochée, un petit texte discret apparaît **au centre, en bas**, sur une pastille aux couleurs de votre fond, lisible sur fond clair comme sombre. Il est placé juste au-dessus de la zone que recouvre Instagram, donc visible en story, et il reste là du début à la fin de la vidéo, sans bouger.
- **Le mot « Curiosa » a la typographie du logo** (Fraunces italique, comme dans le pied de page de votre site), avec un grand « C » ; « Made with » reste dans la police de votre vidéo.
- **Vous le voyez avant de fabriquer la vidéo** : l'aperçu montre la mention dès que vous cochez la case.
- **Votre choix est retenu** pour vos prochaines stories : cochée une fois, elle le reste jusqu'à ce que vous la décochiez. Un modèle enregistré ne la garde pas.
- **Votre assistant** peut la demander (ou non) quand il prépare une vidéo ; sans consigne, il suit votre choix. Les anciens outils et liens continuent de marcher.
- La mention est écrite en anglais, quelle que soit la langue de la vidéo : c'est un nom de marque. Elle ne contient aucun lien et rien n'est envoyé nulle part. La génération de la vidéo ne dure pas plus longtemps.
- Un réglage facultatif (mode avancé) « Ajouter la mention par défaut » donne la valeur de départ de la case.

### Pour les développeurs

- **Story d'annonce 2.2.0** : `createScene({ watermark: true })` réserve 82 px au bas de la zone sûre et dessine la mention en dernier à chaque image (aucune dépendance au temps, donc aucune animation, « mouvement réduit » compris). Texte `WATERMARK_TEXT` dans `pure.mjs` (non traduit), police de la vidéo, 30 px, couleur du texte et de la pastille calculées à partir des couleurs de fond du style (contraste ≥ 4,5:1, pastille ajustée pour les gris moyens). `scene.watermark` décrit la mention (position, couleur, contraste) ou vaut `null`.
- **Police du nom** : `curiosa-wordmark.woff2` (copie exacte de `src/components/brand/` du cœur, ≈ 1,7 Ko, seules les lettres de « Curiosa ») et `curiosa-wordmark.OFL.txt` (SIL OFL 1.1) dans le dossier du module ; route `wordmark` (GET, sans jeton) ; chargée par `FontFace` avant de bâtir la scène (3 s au plus, repli Georgia italique 600, jamais bloquant). La mention est dessinée en deux segments (« Made with » police de la vidéo 30 px ; « Curiosa » italique 600 à 1,15×) sur la même ligne de base, l'ensemble centré avec `measureText`. Aucun CDN ni appel extérieur.
- `config.watermark` : booléen, **faux** par défaut (seul `true` l'active) ; gardé dans les préparations, jamais dans les modèles (`story_models` inchangé, `story_models` MCP sans nouveau champ).
- **Le cœur ne permet pas à un module d'écrire ses propres réglages** : le choix de la case est gardé dans `story_prefs` (un document `{ watermark }`, écrit par `act` `prefs.watermark`), et le réglage `watermark` (booléen, avancé, faux) n'est que la valeur de départ tant qu'aucun choix n'a été fait. Route `data` : `defaults.watermark`.
- **MCP `story_prepare`** : paramètre facultatif `watermark` (booléen ; autre type refusé) ; défaut = choix retenu ; la réponse ajoute `prepared.watermark`. Rien d'autre ne change.
- `minCore` inchangé (0.2.2), pas de migration (`dataVersion` 2), texte de vie privée mis à jour (≤ 500 caractères).
- Tests : `stream-story-watermark` (police, repli, deux segments, case décochée, choix retenu, MCP, dessin demandé ou non sur toutes les images, place, contraste, parité FR/EN, éditeur) ; trois tests de `stream-story` mis à jour (version, liste des réglages, champ `watermark`).
- Conflits probables avec une version qui touche aussi *Story d'annonce* : `modules/stream-story/module.json` (version, un réglage en fin de `settings`, un paramètre en fin de `story_prepare`, texte `privacy`), `locales/fr.json` et `en.json` (deux clés ajoutées en fin de fichier), `README.md`, `scenes.mjs` (début de `createScene`) et `tests/stream-story.test.mjs`.

## 1.16.1

*Correctif : Statut du live 1.4.1 se recharge correctement après la mise à jour. Pour Curiosa 0.2.6 ou plus.*

### Améliorations

- **Le statut du live se recharge correctement après la mise à jour.** Avec la 1.4.0, le module pouvait être signalé comme « non chargeable » juste après sa mise à jour, et la bannière et le lecteur disparaissaient. Il se charge maintenant normalement, sans rien réinstaller ni redémarrer. Les sites qui ne diffusent que sur Twitch ne voient aucune différence.

### Pour les développeurs

- **Statut du live 1.4.1 : cause.** `youtube.mjs` (nouveau en 1.4.0) faisait `import { askAll } from "./source.mjs"`. Le cœur importe `index.mjs?v=<commit>`, mais un import statique relatif n'a **pas** ce `?v=` : il vise `source.mjs` sans version. Or `adopt.mjs` de la 1.3.2 faisait déjà ce même import, si bien que, dans un site qui tournait avant la mise à jour, Node avait gardé en mémoire l'ANCIEN `source.mjs` (sans `askAll`, ajouté en 1.4.0). Après `modules_update_all` : `SyntaxError: The requested module './source.mjs' does not provide an export named 'askAll'` → `loadModule` renvoie `null` → `maintenance_modules` : `loadable: false`. Un processus neuf (CI, redémarrage) charge le bon fichier : c'est pourquoi les tests, le cœur jetable et « réinstaller » (identique à la source) n'ont rien vu.
- **Correctif** : `youtube.mjs` et `adopt.mjs` importent `./source.mjs` comme `index.mjs` le fait pour ses voisins (`await import(new URL("./source.mjs" + new URL(import.meta.url).search, import.meta.url).href)`). Aucun autre changement de comportement.
- **Test** `tests/live-status-update.test.mjs` (échoue avant, passe après) : charge l'ancienne 1.3.2 (`tests/fixtures/live-status-1.3.2/`) avec `?v=`, remplace les fichiers du dossier, charge la version courante dans le MÊME processus, puis vérifie qu'un direct YouTube est vu ; un second test interdit tout import relatif statique dans `modules/live-status`. Règle à retenir : dans un module, les fichiers voisins s'importent TOUJOURS avec la version de `index.mjs` ; un test de mise à jour doit charger l'ancienne version avant la nouvelle, dans un seul processus.

## 1.16.0

*La maison réagit à votre live : des récompenses en points de chaîne Twitch et des soutiens YouTube qui allument vos lumières ou font lire un message chez vous, avec un gros bouton « Tout couper ». Et votre direct YouTube compte autant que votre direct Twitch : connexion de votre compte pour lire et répondre au chat, bannière « en direct » sur le site, alertes Super Chat à l'écran, annonce Discord (désactivée tant que vous ne la cochez pas). Nouveautés : Bot Twitch 1.3.0, Home Assistant, Actions du live YouTube 1.1.0, Connecteur YouTube 1.3.0, Statut du live 1.4.0, Overlay alertes 1.1.0 et Annonces Discord 1.1.0. Pour Curiosa 0.2.6 ou plus (0.2.5 pour le Bot Twitch seul, 0.2.2 pour la connexion du compte YouTube).*

### Améliorations

- **Actions du live Twitch : récompenses en points de chaîne** (Bot Twitch 1.3.0). Un nouvel onglet « Récompenses » : vous créez, modifiez, mettez en pause et supprimez vos récompenses en points de chaîne **depuis votre site** (elles existent vraiment chez Twitch) : titre, coût, délai de recharge, texte d'aide, « le viewer écrit un message », et l'**action** à lancer, choisie dans une liste (« Lumières : rouge », « Lire le message à voix haute », « Répondre dans le chat »…). Les erreurs s'affichent sous le champ, avec un exemple. Modules touchés : Bot Twitch 1.3.0, Connecteur Twitch 1.2.0.
  - **Les points sont validés ou rendus tout seuls.** Si l'action a été faite, la récompense est validée ; si la maison refuse (coupée, pas en direct, message refusé…) ou ne répond pas à temps, **les points sont rendus** au viewer, avec un petit message dans le chat si vous le souhaitez. Un échange n'est jamais traité deux fois.
  - **Les lumières et la voix, avec le module Home Assistant** (facultatif : sans lui, les récompenses qui répondent dans le chat marchent quand même, et l'onglet propose de l'installer). Hors direct ou quand vous coupez la maison, ses récompenses se **mettent en pause chez Twitch** et reviennent toutes seules.
  - **`!stop` et `!start` dans le chat** : vous et les modérateurs que vous nommez coupez la maison avec `!stop` ; vous seule la rebranchez avec `!start`.
  - **« Simuler cette récompense »** : un faux échange (viewer « Test ») pour vérifier que tout marche, sans Twitch et sans dépenser de points. Marqué « [Test] » dans le journal des 50 derniers échanges.
  - **Pour votre assistant** : voir, créer, modifier et simuler les récompenses (jamais accordé d'office). Nouveau droit « créer, modifier et supprimer les récompenses » pour vos rôles.
  - Le Connecteur Twitch sait demander l'autorisation de gérer les récompenses, **seulement quand vous activez l'onglet** : le chat du bot ne s'arrête jamais pour ça.
  - Si votre compte n'est ni Affilié ni Partenaire, la page le dit simplement (« Twitch ne propose pas les points de chaîne à ce compte ») : rien n'est cassé.
  - Aucun jeton n'est jamais affiché ; les messages que Twitch envoie sont vérifiés et un même message renvoyé est ignoré.
- **Home Assistant** (nouveau module). Vos viewers peuvent changer la couleur de vos lumières ou faire lire un message à voix haute chez vous, grâce à Home Assistant, avec leurs points de chaîne Twitch ou leurs soutiens YouTube.
  - **Un gros bouton « Tout couper »** arrête tout en un clic ; « Reprendre » remet en marche. Il se voit sans défiler sur téléphone.
  - **Un assistant en 3 étapes** pour associer Home Assistant, avec un code à 8 caractères. Rien n'est ouvert chez vous : c'est Home Assistant qui vient chercher les ordres.
  - **Rien ne se joue hors direct** (avec 5 minutes de marge après la fin), et un ordre non exécuté à temps est abandonné : les points sont rendus. **Twitch ou YouTube** peut dire que vous êtes en direct : il suffit que l'un des deux le dise, donc une personne qui ne diffuse que sur YouTube peut s'en servir. Sans « Ma Chaîne Twitch » ni « Chaîne YouTube », rien n'est joué et la page vous dit d'en installer un.
  - **Les messages lus sont vérifiés** : liens, numéros, mots de la liste (français et anglais, que vous complétez), longueur, attentes entre deux messages.
  - **Un journal** des 50 dernières actions, avec la raison de chaque refus.
- **Actions du live YouTube** (nouveau module). Un Super Chat, un Super Sticker, une nouvelle adhésion ou des adhésions offertes peuvent allumer vos lumières ou faire lire un message chez vous, grâce à Home Assistant.
  - Une page « En direct » : état de la lecture, gros bouton « Tout couper », vos règles, une simulation sans rien demander à YouTube, le journal et la part de la limite YouTube utilisée.
  - `!stop` et `!start` dans le chat YouTube (propriétaire et modérateurs), pendant que la page est ouverte.
  - La Chaîne YouTube sait dire si vous êtes en direct et quel chat lire ; le Connecteur YouTube sait lire le chat d'un direct, en comptant ce que ça coûte. Modules touchés : Chaîne YouTube 1.4.0, Connecteur YouTube 1.2.0.
- **Tester le pont.** Un bloc « Tester le pont » dans Home Assistant simule un échange de points de chaîne pour vérifier que tout marche sans attendre un viewer, même hors direct, avec le suivi du trajet (envoyé, récupéré par Home Assistant, exécuté). Les simulations du Bot Twitch (« Simuler cette récompense ») et d'Actions du live YouTube (« Simuler un don ») passent par ce même test : elles sont marquées « Test », ne touchent ni Twitch ni YouTube, ne coûtent et ne rendent aucun point, ne partent jamais si tout est coupé ou si Home Assistant n'est pas associé, et sont limitées à 30 par heure.

- **Connexion de votre compte YouTube, une fois** (Connecteur YouTube 1.3.0, facultatif). Pour lire le chat de votre direct quand YouTube refuse de le laisser lire avec la seule clé du site, et pour que le site puisse y répondre. Une mise en route en 4 étapes, puis un bouton « Connecter mon compte YouTube » : l'écran affiche un **code court** ; vous l'entrez sur google.com/device depuis votre téléphone, vous autorisez, vous revenez cliquer « C'est fait, vérifier ». Aucune adresse à régler.
  - **« Déconnecter » en un clic** : l'accès est effacé du site et Google est prévenu. Le code secret Google est saisi une fois et jamais réaffiché.
  - **Le site ne répond dans le chat que si vous le décidez** : le réglage « Laisser le site répondre dans le chat » (options avancées) est **désactivé par défaut**. Aujourd'hui, Actions du live YouTube s'en sert pour répondre à « !stop » et « !start », et à rien d'autre.
  - **Autorisation minimale** : lire le chat d'abord ; l'autorisation d'écrire n'est demandée que si vous activez les réponses.
  - **Actions du live YouTube** écrit « Connectez votre compte YouTube dans le Connecteur YouTube », avec un lien, quand YouTube refuse de laisser lire le chat avec la clé seule, et reprend tout de suite après la connexion. Les erreurs de Google ont chacune une phrase simple qui dit quoi faire.
- **Votre direct YouTube sur le site** (Statut du live 1.4.0, ex-« Statut live Twitch »). La bannière « En direct sur YouTube » avec le lien, ou une ligne par plateforme si vous êtes en direct sur les deux. Le lecteur YouTube ne se charge **qu'après un clic** du visiteur (réglage possible : dès l'ouverture de la page) ; en direct sur les deux, **un seul lecteur** est montré, celui que vous choisissez (Twitch par défaut). Il suffit d'avoir Chaîne YouTube. **Rien ne change si vous n'êtes que sur Twitch.**
- **Alertes Super Chat sur l'overlay** (Overlay alertes (OBS) 1.1.0). Avec Actions du live YouTube, les **Super Chats, Super Stickers et adhésions** de votre direct s'affichent à l'écran, l'un après l'autre, avec le montant dans sa devise. Le **texte des messages est masqué** tant que vous ne cochez pas « Afficher le texte des messages YouTube ». Un bouton « Envoyer un faux Super Chat » montre le rendu. Actions du live YouTube a un nouveau réglage « Lire le chat même sans Home Assistant (alertes OBS seulement) », éteint par défaut.
- **Annonces Discord pour vos directs YouTube** (Annonces Discord 1.1.0). « En direct sur YouTube : titre » part **une seule fois par direct**, jamais deux ; en direct sur Twitch et YouTube en même temps, **un seul message** cite les deux (ou seulement la première plateforme, au choix). Le texte est modifiable avec `{platform}`, `{title}`, `{game}` et `{url}`. **C'est désactivé par défaut** : rien ne change sur votre Discord tant que vous ne cochez pas « Annoncer aussi mes directs YouTube » dans les réglages.
- **Mises à jour sans surprise.** Sur un site existant, rien n'est activé tout seul : l'annonce Discord des directs YouTube reste éteinte, la connexion du compte YouTube est facultative et le site n'écrit toujours rien dans votre chat. L'Overlay alertes déclare une capacité de plus (l'échange d'évènements avec Actions du live YouTube) ; la mise à jour se fait comme d'habitude, sans question de plus.
- **La limite du jour de YouTube est ménagée** : vérification du direct gardée 3 à 5 minutes par le site quel que soit le nombre de visiteurs, toutes les 10 minutes au plus pour Discord ; en cas de panne ou de limite atteinte, personne n'insiste. Statut du live dit en une phrase ce qui manque (« Installez Ma Chaîne Twitch ou Chaîne YouTube »).

### Pour les développeurs

- **Connecteur Twitch 1.2.0** : `rewards.mjs` (nouveau) ajoute à la liste fermée, avec le jeton de la chaîne et `channel:manage:redemptions` (autorisation demandable, `EXTRA_SCOPES`) : `GET/POST/PATCH/DELETE channel_points/custom_rewards` et `PATCH channel_points/custom_rewards/redemptions`, requêtes et corps fermés et bornés. Trois lignes ajoutées dans `helix.mjs` (après `ALLOWED`, et dans `check`). Service `twitch.api` v3 inchangé.
- **Bot Twitch 1.3.0** (`minCore` 0.2.5) : `eventsub.mjs` (abonnement `channel.channel_points_custom_reward_redemption.add` v1 sur la route existante, mêmes secret, signature et rejeu ; requêtes Helix ; **hypothèses non vérifiées notées en tête**), `rewards.mjs` (récompenses, pauses), `redeem.mjs` (échanges idempotents par identifiant, pont, `ha.result`, expiration à la lecture, simulation), `kill.mjs` (`!stop`/`!start`), `rewardsAdmin.mjs` (onglet). Besoin **facultatif** `home-assistant.bridge` (`enqueue({ key, text?, viewer, ref, test? })`, `status`, `stop({ by })`, `start({ by })`) ; sujets consommés `ha.result` et `ha.state`. Mots `stop` et `start` réservés aux commandes. Réglages `rewardsNotice`, `stopMods`, `rewardWaitSeconds` (avancé), `extraActions` (avancé). Outils MCP `rewards_list`, `reward_create`, `reward_update`, `reward_simulate`.
- **Home Assistant 1.0.0** (nouveau module, instance unique, `minCore` 0.2.6) : service `home-assistant.bridge` v1 (`enqueue`, `status`, `stop`, `start`), sujets `ha.result` et `ha.state`, routes publiques `pair`, `pull`, `ack`, droits `ha.manage`, `ha.stop`, `ha.test`, outils `ha_status`, `ha_journal`, `ha_stop`, `home_assistant_test`. Contrat HTTP exact : `docs/ideas/home-assistant-contract.md` ; simulateur : `tests/helpers/fakeHaClient.mjs`.
  - **`enqueue` accepte `test?: true`** (seul le booléen `true` compte) : l'action porte `test: true` dans la réponse de `pull`, journal « Test », jamais de points ; possible hors direct mais jamais avec le coupe-circuit actif (`off`) ni sans appairage (`not_paired`) ; 30 par heure et 5 par fenêtre de 3 s au plus (`busy` au-delà ; le bouton « Tester » de l'administration reste à un toutes les 3 s). Un `ref` valide fait publier l'issue dans `ha.result`.
  - **Le direct vient de deux services facultatifs** : `twitch.live` (`status`) ET `youtube.live` (`current`, Chaîne YouTube 1.4.0), tous deux `requires[].optional`. « En direct » = au moins une source répond « en direct » (+ 5 minutes de marge) ; sans source : fermé (`not_live`). Home Assistant ne copie aucun état : il lit. YouTube n'est interrogé que si Twitch ne dit pas « en direct », jamais par l'interrogation à vide de Home Assistant, et sa réponse est gardée 20 s (en direct) ou 60 s (pas en direct) : 2 unités de limite YouTube par vérification.
  - Les sujets `ha.result` et `ha.state` sont à ajouter au tableau « Sujets connus » de docs/MODULES.md du cœur (branche `core/docs-sujets-ha`, cœur 0.2.8) ; en attendant, `tests/repo-rules.test.mjs` les garde dans `NOT_YET_DOCUMENTED` (à retirer ensuite).
- **Chaîne YouTube 1.4.0** : service `youtube.live` (`current`, `each: true`, lecture seule).
- **Connecteur YouTube 1.2.0** : `liveChatMessages.list` (5 unités, sans cache), demande `fresh`, erreurs `chat_ended` / `chat_disabled` / `chat_denied`, `status().chat`.
- **Actions du live YouTube 1.1.0** (nouveau module, plateforme `youtube`, `minCore` 0.2.6) : consomme `ha.result`, appelle `home-assistant.bridge` ; outils MCP `youtube_live_status`, `youtube_live_journal`, `youtube_live_rules`, `youtube_action_simulate`. Description : `docs/ideas/youtube-live-actions.md`.
- Tests : `channel-rewards-connector`, `channel-rewards`, `home-assistant`, `home-assistant-moderation`, `home-assistant-wiring` (le vrai pont branché au vrai Bot Twitch), `youtube-live-actions*` ; aides `fakeHaBridge.mjs`, `fakeHaClient.mjs`, `fakeRewards.mjs`, `fakeYoutubeLive.mjs`. `tabs-modules.test.mjs`, `platform.test.mjs` (Actions du live YouTube partage la plateforme `youtube`) et `content.test.mjs` (63 modules) mis à jour.
- **Connecteur YouTube 1.3.0** : flux « appareil » de Google (`oauth.mjs`), trois adresses en liste fermée (`oauth2.googleapis.com/device/code|token|revoke`) par `ctx.api.net` ; portées `youtube.readonly` ou `youtube` (le flux appareil n'accepte pas `youtube.force-ssl`) ; pas de PKCE ni d'état (aucune redirection) ; l'adresse de vérification est contrôlée (https, google.com) ; jetons dans la collection `oauth-tokens` du stockage du connecteur ; rafraîchissement à la demande, une demande à la fois, pause d'une minute après une panne ; `invalid_grant` efface les jetons.
- `youtube.api` (toujours v1, ajouts) : `chatPost({ liveChatId, text })` (20 unités, 200 caractères, 3 s entre deux messages, 30 par heure ; `readOnly` pour ne jamais être recopié vers une réplique) ; `status().chat = { read, write }` selon les portées accordées ; `status().oauth` ; `chat_denied` sans compte et sans clé acceptée ; la lecture du chat passe avec le jeton (jamais la clé) quand le compte est connecté.
- Nouveaux réglages du Connecteur YouTube : `oauthClientId` (texte), `oauthClientSecret` (secret), `chatReply` (avancé, faux).
- Actions du live YouTube : état `connect` (lit `status().chat.read`), lien vers l'écran du connecteur, `reply()` inchangé (écrit seulement si `chat.write`). Le test `srp-guard` tolère `refresh_token` dans le Connecteur YouTube (nom du champ de Google).
- **Statut du live 1.4.0** : `youtube.mjs` (service facultatif `youtube.live`, `current`, via `callAll`, mémoire 180 s en direct / 300 s hors direct / 120 s en erreur, question partagée, 2,5 s d'attente au plus), `view.mjs` (bannière à plusieurs plateformes, lecteur « au clic » en `<details>` + cadre `loading="lazy"` sur `youtube-nocookie.com`). `requires` : `twitch.live` et `youtube.live`, tous deux `optional`. Identifiant, `platform: "twitch"` et réglages existants inchangés (la plateforme sert au regroupement visuel ; la retirer demanderait de modifier `tests/platform.test.mjs`). Nouveaux réglages `playerPlatform` (`twitch`/`youtube`) et `youtubeLoad` (`click`/`auto`).
- **Actions du live YouTube 1.1.0** : fournit le sujet `live.event` (`{ id, platform, kind, who, at, amount?, currency?, count?, text? }`, `amount` seulement avec `currency`) ; file **en mémoire** (`events.mjs`, 50 évènements, 15 minutes, purgée à la lecture, rien sur le disque). Réglages `shareAlerts` (oui) et `readWithoutHouse` (non). Sans Home Assistant et sans compte connecté, la lecture par la clé du site est tentée comme avant ; avec `readWithoutHouse`, les dons sont notés « alerte seulement » et ne partent qu'à l'overlay.
- **Overlay alertes 1.1.0** : consomme `live.event` (permission `topics`, schéma déclaré) ; route `GET /m/<clé>/pull` appelée par la page de l'overlay toutes les 5 s **seulement si une instance d'Actions du live YouTube existe** (au plus une lecture toutes les 2 s, 20 alertes par lecture, 400 identifiants retenus, alertes de plus de 2 minutes jamais affichées), file de 50 côté page. `overlay()` devient asynchrone. Réglage `youtubeText` (non). La permission `topics` est déclarative : le cœur ne bloque pas la mise à jour d'un site existant (seule la réinstallation refuse une permission nouvelle).
- **Annonces Discord 1.1.0** : besoin facultatif `youtube.live` ; clé `live:yt:<identifiant de vidéo>` ; document `yt` du stockage (dernière vérification) ; vérification toutes les `youtubeCheckMinutes` (10, avancé), revérifiée au plus une fois par minute juste avant d'annoncer ; réglages `youtubeLive` (**faux par défaut** ; une instance sans valeur vaut « non »), `liveBoth` (`both`/`first`), `liveText`.
- Tests : `youtube-oauth`, `youtube-live-actions-oauth`, `live-status-youtube`, `alerts-overlay-youtube`, `youtube-live-actions-alerts`, `discord-announcer-youtube` ; aide `fakeGoogleAuth.mjs`.
- À l'assemblage des deux lots : conflits résolus dans le README et les deux fichiers de langue d'Actions du live YouTube (on garde les deux côtés). Le sujet `live.event` est à ajouter au tableau « Sujets connus » de docs/MODULES.md du cœur, avec `ha.result` et `ha.state` ; en attendant, `tests/repo-rules.test.mjs` les garde dans `NOT_YET_DOCUMENTED`.

## 1.15.0

*Dix nouveaux modules (Mentions légales, Mur des remerciements, Commandes, Questions fréquentes, Témoignages, Sondages avec manches, Compte à rebours, Cahier de contenu, Participation, Autres plateformes) et une Story d'annonce qui propose tous vos événements. Pour Curiosa 0.2.5 ou plus (0.2.6 pour Questions fréquentes) ; Story d'annonce et ses sources restent compatibles avec Curiosa 0.2.2.*

### Améliorations

- **Story d'annonce 2.1 : « Pour quoi veux-tu une story ? »** Une seule liste de tout ce qui arrive bientôt : vos agendas, vos vidéos et directs YouTube programmés et votre planning Twitch. Modules touchés : Story d'annonce 2.1.0, Chaîne YouTube 1.3.0, Ma Chaîne Twitch 2.1.0, Connecteur YouTube 1.1.0, Connecteur Twitch 1.1.0.
  - **Story d'annonce : « Pour quoi veux-tu une story ? »** Une seule liste rassemble ce qui arrive bientôt, de toutes vos sources, **classé par date et heure** : vos streams (Agenda en ligne, Streams saisis à la main), vos **vidéos et directs YouTube programmés** et votre **planning Twitch**. Chaque ligne a une pastille de sa source, le jour et l'heure dans votre fuseau, et le titre. **Un clic choisit l'événement** : la vidéo se remplit toute seule. Rien à régler : une source installée apparaît toute seule.
  - **Chercher et filtrer.** Tapez un mot du titre ou du jeu ; un bouton par source ne garde que celle-là. La liste se lit 20 par 20 (« Voir plus d'événements ») et s'arrête aux 200 prochains.
  - **Pas de doublon.** Un stream annoncé à la fois par votre agenda et par votre planning Twitch n'apparaît qu'une fois, avec la mention « Aussi dans : Twitch ».
  - **Une source ne répond pas ? Ce n'est jamais bloquant.** Une phrase polie sous la liste (« YouTube ne répond pas pour l'instant »), un bouton « Réessayer », et les autres sources restent là. Vous pouvez toujours écrire l'événement vous-même.
  - **Chaîne YouTube : vos directs et premières programmés.** Dès que la clé YouTube du site est là, ils rejoignent la liste. La page dit honnêtement ce que YouTube ne permet pas : **une vidéo privée programmée n'est pas visible** avec la clé du site (pour celle-là, écrivez l'événement vous-même).
  - **Ma Chaîne Twitch : votre planning Twitch.** Les rendez-vous publiés sur votre chaîne rejoignent la liste ; ceux qui sont annulés ou pendant vos vacances sont ignorés. Rien de privé n'est demandé.
  - **Votre assistant** peut lister tous ces événements (nouvel outil `story_events`) et préparer la vidéo pour l'un d'eux. L'événement choisi est gardé dans la demande ; si un événement a disparu entre-temps, la page le dit et prend le prochain.
  - Sur téléphone, un clic sur un événement vous amène directement à l'aperçu, le bouton « Générer la vidéo » en vue ; les lignes de la liste sont de grandes zones à toucher.
  - Quand un événement a son propre fuseau horaire et que l'heure n'est pas la même que chez vous, l'heure sur place est écrite entre parenthèses.
  - Les anciens outils et les anciens liens de votre assistant continuent de marcher (`story_next_streams` et `story_prepare` avec une clé de stream sont inchangés).
  - Les connecteurs YouTube et Twitch laissent passer ce dont les sources ont besoin (début programmé des vidéos ; planning public d'une chaîne), et rien d'autre. Mettez-les à jour avec les modules qui s'en servent : sans cela, la source dit « le connecteur doit être mis à jour » au lieu de planter.
- **Mentions légales** (nouveau module).
  - Nouvelle extension « Mentions légales » : 6 à 8 questions simples, puis trois pages en français et en anglais (mentions légales, confidentialité, cookies) pour la Belgique, la France, la Suisse, le Canada et un autre pays.
  - Un aperçu avant publication, avec ce qui manque écrit en clair. Une page n'est jamais publiée avec un trou.
  - Un lien discret en bas de chaque page, et un rappel visible quand une extension qui récolte des informations est ajoutée.
  - Ce sont des modèles d'aide, pas un conseil juridique : c'est dit à chaque étape.
  - Le site préremplit ce qu'il sait déjà : son nom, son adresse de contact, les extensions reconnues. Pour une extension qu'il ne connaît pas, il pose la question.
  - Les erreurs s'affichent sous le champ, avec un exemple.
  - Utilisable sur téléphone, sans défilement de côté.
- **Mur des remerciements** (nouveau module).
  - Une page « Merci ! » qui montre, en cartes avec photos, les personnes de vos catégories de Contacts : modération, mécènes, bêta-testeurs… (jusqu'à six groupes).
  - Une personne à l'honneur chaque mois, préparée à l'avance si vous voulez, avec un petit mot.
  - Un petit message sous le nom de chaque personne, dans chaque langue de votre site.
  - Quelqu'un ne veut pas apparaître ? Rangez sa fiche dans la catégorie « Ne pas montrer » de Contacts : elle disparaît du mur en moins de deux minutes.
  - Rien à retaper : les noms et les photos viennent de Contacts et restent à jour.
  - Si Contacts ne répond plus, la page garde le dernier mur connu ; sinon elle affiche un message aimable.
  - Pensé pour le téléphone : deux cartes par ligne, grands boutons, erreurs sous le champ concerné.
  - Le nom peut s'afficher en entier, en prénom seulement ou en pseudo : le mur est public, vous choisissez.
- **Commandes (la file de commandes)** (nouveau module).
  - Une page « Commandes » qui dit si vos commandes sont ouvertes, complètes ou fermées, avec le nombre de places libres et la date de réouverture.
  - Vos formules (nom, prix indicatif, délai, ce qui est inclus) et un formulaire court pour les demandes.
  - Un lien de suivi privé pour chaque cliente : elle voit où en est sa commande et sa place dans la file, sans créer de compte.
  - Une liste de demandes simple : nouvelle, acceptée, en cours, livrée (ou refusée, annulée), avec des notes privées et un message pour la cliente.
  - Des e-mails de confirmation et de changement d'état, si votre site sait envoyer des e-mails.
  - Une fiche Contacts créée en un clic quand vous acceptez une commande (si le module Contacts est installé).
  - Un fichier à télécharger avec toutes les demandes.
  - Les commandes terminées s'effacent toutes seules après 12 mois (réglable).
  - Votre adresse e-mail et vos notes ne sont jamais montrées à la cliente ; seules les personnes autorisées voient les adresses.
  - Sur téléphone, tout se lit et se touche sans défilement de côté ; les erreurs s'affichent sous le champ avec un exemple.
- **Questions fréquentes** (nouveau module).
  - Une page « Questions fréquentes » prête à l'emploi : questions rangées par thèmes, qui s'ouvrent et se referment, même sans JavaScript.
  - Recherche en tapant (les accents et les majuscules ne gênent pas), lien direct vers chaque question.
  - Boutons « Cela m'a aidé / Pas vraiment » sous chaque réponse, sans compte et sans cookie de suivi.
  - Boîte « Vous ne trouvez pas votre réponse ? » : vous répondez et publiez d'un clic, la question quitte la boîte.
  - Chaque question peut exister en français, en anglais ou dans les deux.
  - Un assistant IA peut proposer des brouillons de réponse ; il ne publie jamais.
  - Pas de glisser-déposer : l'ordre se change avec « ↑ Haut / ↓ Bas ».
  - Deux exemples de réponses sont prêts en brouillon à l'installation.
  - Les questions reçues s'effacent d'elles-mêmes après 90 jours au plus et ne contiennent aucune donnée personnelle.
  - Google et les autres moteurs de recherche peuvent afficher vos questions publiées.
- **Témoignages** (nouveau module).
  - Un lien « Laisser un avis » à partager (et son QR code), pensé pour le téléphone.
  - Chaque avis arrive « à valider » : rien n'est publié sans que vous l'ayez lu, ni sans l'accord de la personne (case obligatoire, enregistrée avec sa date).
  - Étoiles facultatives, note moyenne, filtre par note, avis en grille ou en défilement lent avec un bouton pause (sans mouvement pour qui préfère moins d'animation).
  - Favoris, ordre au choix, trois avis à la une sur la page d'accueil, note moyenne et invitation à laisser un avis en encarts.
  - La personne peut retirer son avis elle-même avec un lien privé ; vous pouvez aussi le supprimer à sa demande.
  - Téléchargement des avis (tableur) avec la preuve d'accord de chacun.
  - Les erreurs du formulaire s'affichent sous chaque champ, avec un exemple, et la personne ne retape rien.
  - L'adresse e-mail est facultative, jamais publiée, et s'efface toute seule au bout de 90 jours.
  - Les avis refusés s'effacent tout seuls après 30 jours ; aucun cookie, aucune adresse IP gardée.
  - Vous pouvez ajouter un avis reçu ailleurs (message, e-mail) en indiquant que la personne est d'accord.
- **Sondages, avec des manches** (nouveau module).
  - **Des manches : « toutes les 10 minutes, le chat décide ».** Une question qui revient en boucle ; à la fin de chaque manche le choix qui a le plus de voix l'emporte, s'affiche en grand à l'écran, puis la manche suivante démarre. En cas d'égalité, le sort tranche, et l'écran le dit. L'historique des décisions est public (`/polls/decisions`) et téléchargeable.
  - **Un lien à partager qui montre toujours la manche du moment** (`/polls/now`), avec son compte à rebours.
  - **Un sondage rapide « A ou B ? »** en un geste (2 à 4 choix, 30 secondes à 5 minutes) : il passe tout de suite à l'écran.
  - **Une télécommande pour votre téléphone** avec de gros boutons (lancer, suivant, arrêter, A ou B ?), grâce au nouveau module Participation, qui s'installe d'un clic depuis l'onglet « En direct ».
  - L'écran de votre stream affiche le numéro de la manche, le compte à rebours, les résultats en direct et la décision prise.
  - L'assistant IA peut lancer, passer ou arrêter les manches, lire l'historique et lancer un sondage rapide (ces gestes ne sont jamais autorisés d'office).
  - L'onglet « À l'écran » devient « En direct » et rassemble les manches, le sondage rapide et l'écran OBS.
  - Les votes d'une manche sont effacés dès que la décision est prise (au lieu de 30 jours après la fin).
  - Avec Participation : une voix par personne gérée en commun, la possibilité de mettre quelqu'un en sourdine, et une mise à jour de l'écran plus douce qui ralentit toute seule quand il y a beaucoup de monde. Sans elle, tout marche comme avant.
  - Créez un sondage en une minute : une question, 2 à 8 choix, un choix ou plusieurs par personne.
  - Un lien à partager, une page publique avec les sondages en cours et l'historique des sondages passés, et un petit encart « Le sondage en cours » pour l'accueil.
  - Une date de fin facultative (l'heure et le fuseau sont écrits clairement) : le sondage se ferme tout seul et affiche son résultat final.
  - Résultats en barres lisibles (texte et pourcentage, jamais seulement la couleur), visibles tout de suite ou seulement après le vote, au choix.
  - Un vote par personne, sans compte ni cookie.
  - Un affichage en direct pour OBS, protégé par une adresse secrète.
  - L'assistant IA peut lister, lire, créer et fermer des sondages.
  - Messages d'erreur sous chaque champ, avec un exemple.
  - Actions graves (fermer, archiver, supprimer) avec une case de confirmation claire.
  - Les votes détaillés (sans aucun nom) sont effacés 30 jours après la fin ; les totaux restent.
  - Sauvegarde lisible (tableur) de tous les sondages.
- **Compte à rebours** (nouveau module).
  - Nouveau module « Compte à rebours » pour annoncer une sortie, un lancement, un anniversaire ou une convention.
  - Vos visiteurs voient le temps qui reste et l'heure chez eux, écrite en toutes lettres (« samedi à 21 h chez vous »).
  - Un bouton « Ajouter à mon agenda » pour chaque événement.
  - Un message de fin de votre choix quand l'heure arrive, avec un bouton ; l'événement disparaît tout seul après le délai que vous choisissez.
  - Plusieurs comptes à rebours, dont un « à la une », sur une page, sur l'accueil et dans votre stream (OBS).
  - Le passage à l'heure d'été et d'hiver est toujours juste, même pour un événement dans plusieurs mois ou dans un pays lointain. Si l'heure choisie n'existe pas ou existe deux fois, le module vous le dit.
  - Fonctionne sans réglage dès l'installation, sur téléphone, en français et en anglais.
  - Respecte la demande « moins de mouvement » des visiteurs ; sans JavaScript, la date et l'heure restent lisibles.
  - Aucune donnée de visiteur n'est gardée.
- **Cahier de contenu** (nouveau module).
  - Un cahier privé pour vos idées de vidéos, d'articles et de posts, en trois endroits : Idées, En préparation, Publié (plus les Archivées).
  - Un gros bouton « J'ai une idée ! » : un titre suffit, le reste vient après.
  - Pour chaque idée : une phrase, des étapes à cocher, une date visée, les réseaux concernés et des notes.
  - Un rythme facultatif (« 1 par semaine ») avec un message doux quand la dernière publication date un peu.
  - Recherche, listes de 50 idées par page, archivage, suppression définitive avec une question claire.
  - Téléchargement en CSV et sauvegarde lisible. Rien n'est jamais affiché sur votre site.
  - Votre assistant IA peut ajouter une idée, les lister, les déplacer et cocher une étape.
  - Pensé pour le téléphone : grandes zones à toucher, aucune barre de défilement sur le côté, pas de glisser-déposer obligatoire.
  - Les erreurs s'affichent sous le champ, avec un exemple.
- **Participation** (nouveau module).
  - Un nouveau module, **Participation**, qui s'installe tout seul avec les animations de stream qui en profitent (Sondages pour commencer).
  - **Un pseudo sans compte** : chaque personne peut choisir son pseudo (unique, sans insulte grâce à une liste de mots interdits que vous modifiez), ou ne pas en choisir. Une page « Participation » lui permet de l'effacer, avec toutes ses données, d'un bouton.
  - **Une voix par personne** et des limites contre les abus, sans jamais garder l'adresse de personne.
  - **Une télécommande pour votre téléphone** : une page secrète avec de GROS boutons (lancer, arrêter, suivant, « A ou B ? », sourdine, vider la salle). Un code à flasher dans l'administration pour l'ouvrir sans rien taper, une nouvelle adresse en un clic si quelqu'un l'a vue.
  - **Un écran qui se met à jour doucement** : l'écran de votre stream et les pages publiques se rafraîchissent sans surcharger le site, et ralentissent quand il y a beaucoup de monde ou quand rien ne change.
  - **Un journal** de qui a décidé quoi et quand, et un ménage automatique : personnes inactives effacées après 14 jours, journal après 30 jours.
  - L'assistant IA peut lire les salles et le journal, mettre quelqu'un en sourdine ou vider une salle (ces deux gestes ne sont jamais autorisés d'office).
  - Tout est en français et en anglais, utilisable au doigt (boutons de 44 à 76 px), avec des erreurs sous le champ et un exemple.
  - Les personnes en sourdine restent en sourdine si elles reviennent ; vider une salle est immédiat.
- **Autres plateformes** (nouveau module).
  - Ajoutez votre OnlyFans, Mym, Fansly, Patreon, Ko-fi, Tipeee, Liberapay, Buy Me a Coffee, Linktree ou n'importe quelle page en icône, à côté de vos autres réseaux en haut du site.
  - Collez l'adresse comme vous l'avez : « onlyfans.com/monnom » est complété tout seul. Jusqu'à 20 liens, rangés avec Monter et Descendre.
  - Une page d'avertissement « contenu pour adultes » peut s'afficher avant l'ouverture d'un lien : prévue par défaut pour OnlyFans, Mym et Fansly, jamais pour les autres, et vous pouvez la couper pour tous ou pour un seul lien. Elle ne vérifie pas l'âge. Elle fonctionne sans JavaScript, ne laisse aucune trace chez le visiteur et n'est pas référencée par les moteurs de recherche.
  - Un assistant IA peut lister, ajouter et modifier vos liens si vous lui en donnez l'accès.
  - Le message d'erreur sous le champ dit quoi écrire, avec un exemple, en français et en anglais.
  - Pour que la plateforme sache d'où viennent les visites, le nom de votre site est ajouté automatiquement à chaque lien (sans rien régler ; réglages fins en mode avancé).
  - Sur téléphone, la liste et les boutons tiennent à l'écran, sans défilement sur le côté.

### Pour les développeurs

**Story d'annonce 2.1.0 et sources d'événements**

- **Nouveau contrat `event.source`** (service version 1, `each: true`, besoin **facultatif** `requires[].optional` chez le consommateur) : `upcoming({ from, to, limit, locale })` → `{ ok, source: { kind, label }, state: "ok" | "setup" | "down", message?, note?, events: [{ id, title, start (UTC), timezone, end?, allDay?/day?, type, url?, image?, games? }] }`. Décrit dans le README du dépôt. Un module qui publie des événements datés n'a qu'à l'offrir ; aucun consommateur n'est à changer. Les agendas gardent le sujet `planning.slot`.
- **Story d'annonce** : `events.mjs` (contrat, `cleanEvent`, `aggregate` : doublons à 15 minutes près, tri sur l'instant UTC, 100 par source, 200 au total ; `pageOf` : curseur opaque, 50 par page ; `filterEvents`), `sources.mjs` (`loadEvents` : un appel borné par source, 10 sources, liste gardée 45 s, dernière bonne liste 15 min, partage des demandes simultanées, aucun minuteur de fond), routes `events` et `cover`, outil `story_events`, `story_prepare` accepte `event`. Les réglages gardent `eventId` et `eventSource` (jamais les modèles) ; `streamKey` reste rempli pour un événement d'agenda. `minCore` inchangé (0.2.2).
- **Chaîne YouTube** : `events.mjs`, service `event.source` (`channels.list` → `playlistItems.list` → `videos.list` avec `snippet,contentDetails,liveStreamingDetails`, 3 unités par chaîne et par 10 minutes). **Ma Chaîne Twitch** : `events.mjs`, `channelSchedule` dans `helix.mjs` (`GET schedule`, 15 minutes de cache, 404 = pas de planning). **Connecteurs** : `liveStreamingDetails` ajouté aux parties permises de `videos.list` (YouTube) ; `GET schedule` ajouté à la liste fermée des appels d'application (Twitch). Services `youtube.api` v1 et `twitch.api` v3 inchangés.
- Tests : `stream-story-events`, `stream-story-events-editor`, `youtube-channel-events`, `twitch-channel-events`, `event-source-contract` ; `fakeTwitch` sait répondre à `/helix/schedule`.

**Mentions légales** (`legal-pages`)

- Module `legal-pages` 1.0.0, `minCore` 0.2.5, une instance, page publique `/legal` (sous-pages `notice`, `privacy`, `cookies`), emplacement `layout.footer`, droit `publish`, outils `legal_status`, `legal_preview`, `legal_set_answers`.
- `known.mjs` : table de préremplissage des extensions (testée contre les manifestes) ; le cœur n'expose pas les déclarations `privacy`.
- Les textes publiés sont un instantané fabriqué en mode « final » (erreur au moindre manque) ; aperçu en mode « preview ».
- Ne pas oublier de classer chaque nouvelle extension du catalogue dans `known.mjs`.

**Mur des remerciements** (`thanks-wall`)

- Dépend de `contact.book` v2 (obligatoire, `min: 2`) : `categories`, `categoriesResolve`, `list` (curseur, 500 au plus), `resolve`, `search`. Réglages `choice` à source service (`createCategory` pour « Créer »). Aucun nom, photo ni pseudo n'est stocké : seuls `messages` et `honors`, par identifiant de fiche.
- Offre `privacy.subject` (`each`) : `export`, `erase`, `remap` ; `moved` suivi et `missing` retiré par l'action « Vérifier mes messages ».
- Mémoire du mur en processus (2 minutes, secours 24 h, 20 murs, reconstruction partagée), appels à Contacts bornés, aucun `fetch`, aucun minuteur de fond ; en cas de doute sur « ne pas montrer », rien de nouveau n'est publié.
- Photos : chargées par le navigateur du visiteur (liste blanche pour les photos de réseau). Droit `messages.edit`. Six outils MCP (écritures jamais accordées d'office). `minCore` 0.2.5.
- Tests : `tests/thanks-wall.test.mjs`, `tests/thanks-wall-admin.test.mjs`, `tests/helpers/thanks-wall-world.mjs` (avec `fakeContactBook`, non modifié).

**Commandes (la file de commandes)** (`commissions`)

- Module en code, une instance ; demande Curiosa 0.2.5 ; dépendance facultative à `contact.book` (v2), offre `privacy.subject`.
- Lien de suivi : 160 bits, seule l'empreinte SHA-256 est gardée (clé d'index du stockage), comparaison `timingSafeEqual`, réponse identique pour tout lien inconnu.
- Droits `manage`, `email.view`, `export` ; export par `adminDownloads` ; tâche quotidienne de conservation ; 5 outils MCP sans suppression.
- Détail : `docs/ideas/commissions.md`.

**Questions fréquentes** (`faq`)

- Module à code (`type: content` seulement pour le rangement du menu), `minCore` 0.2.6 (script de page), onglets « Ma FAQ » et « Questions reçues ».
- Fichiers : `text.mjs`, `data.mjs`, `ops.mjs`, `view.mjs`, `client.mjs`, `routes.mjs`, `admin.mjs`, `mcp.mjs`.
- Routes : `ask`, `vote` (JSON si `Accept: application/json`, sinon redirection 303 vers `#faq-…` construite côté serveur). Le script de confort n'est plus dans `layout.head` de toutes les pages : la page renvoie `scripts: ["faq.js"]` (`PageResult.scripts`, cœur 0.2.6) et le fichier `scripts/faq.js` est la copie exacte de `CLIENT_JS` (`client.mjs`), vérifiée par `tests/faq-public.test.mjs` (à régénérer si `client.mjs` change). La route `client.js` est retirée.
- FAQPage en JSON-LD dans le corps de la page (échappé, ≤ 17 000 caractères, ≤ 100 questions) via `ctx.api.seo.jsonLd`.
- Pas d'usage de `getByKey` ni de `generation` (absents du faux contexte du kit) ; écritures sérialisées par un verrou en mémoire.
- Tests : `tests/faq-public.test.mjs`, `tests/faq-routes.test.mjs`, `tests/faq-admin.test.mjs`, aide `tests/helpers/faqKit.mjs`.

**Témoignages** (`testimonials`)

- Module à code (`index.mjs`, `lib.mjs`, `data.mjs`, `view.mjs`, `admin.mjs`), `minCore` 0.2.5, onglet « Avis » (renommé) + un onglet ajouté « Partager » (blocs rangés par `tab`).
- Droits : `reviews.moderate`, `reviews.delete`, `email.view`, `reviews.export` ; téléchargement `adminDownloads.reviews` (flux, 500 lignes par lecture).
- Actions MCP : `testimonials_list`, `testimonials_summary`, `testimonials_decide`, `testimonials_delete` (destructive). Sujet fourni : `overlay.item`.
- Données : collections `reviews` et `drafts` ; tâche `tidy` quotidienne et idempotente.
- Données structurées d'évaluation : éteintes par défaut, JSON-LD posé dans le corps de la page des avis uniquement (le `layout.head` du cœur vaut pour tout le site).
- Limites de débit en mémoire, visiteur = dernier nom de `x-forwarded-for`, empreinte salée.

**Sondages, avec des manches** (`polls`)

- Module `polls` 1.1.0, `minCore` 0.2.5. Offre `audience.remote` v1 (`each`) ; demande `audience.session` en facultatif (mode autonome conservé, délai de 3 s puis repli).
- Données ajoutées : `rounds` (≤ 500), `series` dans `meta`, file d'attente du ménage dans `cfg` ; aucune migration (`dataVersion` 1).
- Une manche = un sondage (`round: { n, run }`, caché des listes). La série avance « à la lecture » (verrou `series:` distinct du verrou des votes) ; `syncLive` publie `screen` (privé, clé = adresse secrète) et `now` (public) chez Participation, regroupé quand plusieurs votes arrivent ensemble.
- Nouveaux fichiers : `bridge.mjs` (pont vers Participation), fonctions pures `pickWinner`, `validateSeriesForm`, `validateQuick` dans `lib.mjs`. Route `client` désormais asynchrone (bibliothèque du direct livrée devant si Participation est là).
- Nouveaux outils MCP : `rounds_status`, `rounds_history`, `round_control`, `poll_quick`.
# Sondages 1.0.0
- Module `polls` 1.0.0, `minCore` 0.2.5, type widget, instance unique, droits `manage` et `obs.view`.
- Stockage : `polls` (≤ 200), `archive` (≤ 800), `b-<id>` (≤ 5 000 bulletins), `meta`. Écritures sérialisées par instance, bulletin unique par clé (le plus ancien gagne), « Recompter » pour réparer.
- Limite de débit par empreinte HMAC à sel quotidien en mémoire ; aucun minuteur ni tâche de fond ; source OBS à interrogation douce bornée.
- Les actions d'admin sont des fonctions qui vérifient `ctx.can` (le kit 0.2.5 ne reconnaît pas la forme `{ right, run }` pour les actions liées à un formulaire).

**Compte à rebours** (`countdown`)

- Heure d'un événement = jour + heure du mur + nom du fuseau, instant calculé à la lecture (`time.mjs`) ; fonctions communes serveur et navigateur envoyées par `Function.prototype.toString`.
- Fichier .ics écrit à la main (pliage 75 octets, échappements, UID stable, SEQUENCE, DTSTAMP) et validé par un lecteur strict dans les tests.
- Source OBS (permission `overlay`) alimentée par une route en lecture seule `state` ; routes `ics`, `now`, `live.js` ; emplacement `layout.head`.
- Aucune tâche de fond ; disparition évaluée à la lecture ; 100 événements au plus.
- Actions d'administration en forme de fonction avec contrôle `ctx.can` (le kit refuse la forme objet pour les formulaires).
- Tests : `tests/countdown*.test.mjs`, aides `tests/helpers/countdownDom.mjs` (navigateur factice, horloge manuelle) et `countdownIcs.mjs` (lecteur strict).

**Cahier de contenu** (`content-planner`)

- Module `content-planner` 1.0.0 (`minCore` 0.2.5), une instance, permissions `admin`, `storage`, `mcp`. Aucune route, page, section ni sujet.
- Données : collection `ideas` (1 000 documents au plus), lue par pages de 500 ; tri, recherche et pages calculés en mémoire sur ce plafond.
- Actions d'administration en forme fonction : la forme `{ right, run }` n'est pas reconnue par la règle `def.matches` du kit de conformité (panneau → action), qui exige une fonction. Seul `adminDownloads.ideas` porte un droit (`ideas.export`).
- Outils MCP : `ideas_list` (curseur opaque, 50 au plus), `idea_get`, `idea_add`, `idea_update`, `idea_move`, `idea_step`.
- Tests : `tests/content-planner.test.mjs`, `tests/content-planner-tools.test.mjs`.

**Participation** (`audience`)

- Module `audience` 1.0.0, `minCore` 0.2.5, type widget, instance unique, droits `remote.use` et `moderate`.
- Offre `audience.session` v1 (16 méthodes, `mute` et `clearRoom` en `callerRights`) ; demande `audience.remote` en facultatif (offert `each` par les modules d'animation : `describe`, `press`, `tick`). Contrat exécutable : `tests/contract-ext/audience.md` + `audience.contract.mjs` + `tests/helpers/fakeAudience.mjs`.
- Stockage : `rooms` (≤ 200), `p-<salle>-<génération>` (personnes ≤ 5 000, index des pseudos), `c-<salle>-<génération>` (voix ≤ 20 000), `live` (≤ 100), `audit` (≤ 500), `meta`. Vider une salle = nouvelle génération et nouveau sel ; les anciennes collections partent au ménage.
- Aucun `fetch`, aucun minuteur ni tâche de fond ; limiteur en mémoire à sel quotidien ; un verrou d'écriture par instance.

**Autres plateformes** (`platform-links`)

- Fournit le sujet `social.link` (rendu par l'en-tête du cœur, comme les modules de réseaux) ; type `widget`, instance unique, `minCore` 0.2.5, droit `links.edit` sur chaque action d'administration, stockage `links`.
- Page d'avertissement : route `go` (`/m/<instance>/go?l=<clé>`), HTML sans script, `X-Robots-Tag: noindex`, CSP `default-src 'none'`, destination uniquement issue de la configuration ; l'icône directe et le bouton « continuer » utilisent la même fonction `destinationOf` (utm ajoutés côté serveur, fusion sans écrasement, encodage strict).
- Validation d'adresse pure (`links.mjs`, `normalizeUrl`) testée : schémas, identifiants, adresses internes ou numériques, ports, faux sites.
- Outils : `platform_links_list`, `platform_link_create`, `platform_link_update` (noms ≤ 31 caractères).
- Tests : `tests/platform-links.test.mjs`.

**Pour tout le dépôt**

- `catalogue/index.json` régénéré (`node scripts/build-index.mjs`).

## 1.14.0

*Finitions des modules existants : des limites anti-abus qui ne se contournent plus, la vie privée mieux expliquée, des textes d'aide plus justes. Pour Curiosa 0.2.6 ou plus.*

### Améliorations

- **Les limites anti-abus ne se contournent plus.** Le formulaire de contact (1.0.3), les suggestions de jeux (1.2.3) et le livre d'or d'exemple (1.0.5) comptent les essais d'un visiteur grâce à l'identifiant discret que fournit désormais votre site (Curiosa 0.2.6), et non plus d'après une adresse que le visiteur pouvait inventer. Cet identifiant ne permet jamais de retrouver l'adresse, change chaque jour et n'est pas partagé d'un module à l'autre. Ces trois modules demandent donc Curiosa 0.2.6.
- **La page « Politique de confidentialité » parle des services d'autres sites.** « Statut live » 1.3.2 (lecteur Twitch), « Ma Chaîne YouTube » 1.2.2 (vignettes YouTube), « Planning » 2.2.2 et « Suggestions de jeux » (jaquettes RAWG) disent en mots simples que le navigateur du visiteur contacte ces services pour afficher l'image ou le lecteur.
- **Textes d'aide plus justes** : « Press kit » 1.0.1 et « Discord » 1.1.4 ne renvoient plus à un endroit imprécis (« ici », « le bouton ci-dessus »).

### Pour les développeurs

- `contact-form` 1.0.3, `game-suggestions` 1.2.3 et l'exemple `guestbook` 1.0.5 : le débit se compte par `ctx.api.visitor.fingerprint(request, portée)` (portées `envoi`, `suggest` / `vote`, `sign`) ; plus aucune lecture de `X-Forwarded-For`. `minCore` 0.2.6 (l'API est protégée par `minCore`, pas de repli). La règle du kit `routes.visitorIp` est satisfaite par ces trois modules ; aucun autre module du dépôt ne lit d'en-tête d'adresse.
- Nouveau `tests/visitor-fingerprint.test.mjs` : un double espion de `ctx.api.visitor.fingerprint` désigne le visiteur ; il prouve que la limite suit l'empreinte et non l'en-tête, que les portées sont celles ci-dessus, qu'aucun des trois fichiers ne contient d'en-tête d'adresse et que `minCore` vaut 0.2.6 au moins. Il échoue sur le code de la 1.13.0.
- Déclaration `privacy` (FR+EN) de ce que le navigateur charge chez un tiers : `live-status` 1.3.2, `youtube-channel` 1.2.2, `planning` 2.2.2, `game-suggestions` (jaquettes RAWG). Textes d'aide : `press-kit` 1.0.1, `discord` 1.1.4.
- `catalogue/index.json` régénéré.

## 1.13.0

*Ajout rapide d'une chaîne dans Raid Twitch, et des pages de module mieux rangées, pour Curiosa 0.2.5 ou plus.*

### Nouveautés

- **« Raid Twitch » 2.1 : ajouter une chaîne en quelques secondes.** Un champ « Ajouter une chaîne » en haut de la page : tapez un nom pour le chercher dans vos contacts, ou un pseudo Twitch, un @pseudo ou un lien twitch.tv/… pour l'ajouter tout de suite. Plus besoin de remplir une fiche de Contacts : le nom et la photo sont repris sur Twitch tout seuls.
- **La liste « Cible de raid » se crée toute seule** dans Contacts à votre premier ajout. Vous n'avez rien à préparer.
- **Une personne de vos contacts n'a pas de chaîne Twitch ?** Raid le dit (« pas de chaîne Twitch ») et vous tapez son pseudo : il est ajouté à sa fiche, sans doublon. Personne ne correspond ? Un seul bouton « Créer … » fait la fiche avec ce seul pseudo.
- **Coller plusieurs chaînes d'un coup** (un pseudo ou un lien par ligne, 200 au plus). Un aperçu dit combien sont nouvelles, déjà dans Contacts, déjà dans votre liste ou invalides (avec la raison et un exemple) avant d'ajouter quoi que ce soit. Refaire le même envoi ne double rien.
- **« Retirer » sur chaque chaîne de la liste.** La liste se lit 50 par page et se cherche. « Retirer » sort la chaîne de la liste de raid seulement : sa fiche reste dans Contacts.

### Améliorations

- Une faute de frappe dans un pseudo est repérée (« Twitch ne connaît pas … ») au lieu de créer une fiche pour rien. Sans réponse de Twitch, l'ajout marche quand même : la fiche prend le pseudo comme nom et Contacts la complétera à sa première ouverture.
- Chaque erreur s'affiche sous le champ concerné et dit quoi faire. Les noms déjà saisis dans une fiche ne sont jamais changés.
- « Ranger mes chaînes » (venue de la version 1) crée aussi la catégorie toute seule si elle manque.
- **Contacts 2.2** : de quoi retrouver, chercher et ranger des comptes pour Raid (ajouter un compte à une fiche existante, sortir une fiche d'une catégorie). Rien ne change pour vous dans Contacts.

### Pour les développeurs

- Nouveau service `contact.curate` v1 offert par Contacts (extension additive, `tests/contract-ext/` : texte, double `tests/helpers/fakeContactCurate.mjs` et suite exécutable passée par le double et par le vrai module) : `lookupAccounts`, `searchAccounts`, `addAccount`, `removeCategory`. Le contrat `contact.book` v2 et ses fichiers d'exécution ne changent pas. À valider avant d'être reporté dans `docs/V2-CONTRACTS.md` du cœur.
- `offers[].callerRights: ["createCategory"]` sur `contact.book` : Raid appelle `createCategory` avec `{ asCaller: true }` depuis une action d'administration (cœur 0.2.4 ; branche `core/service-caller-rights`). Sur un cœur 0.2.2 ou 0.2.3, l'appel reste `denied` et Raid dit de créer la catégorie dans Contacts ; tout le reste marche. `tests/helpers/callerRights.mjs` simule le cœur pour les tests.
- Raid : `quick.mjs` (ajout, retrait, liste par pages, envoi en gros avec aperçu et reprise), `add-admin.mjs` (blocs et actions), `profiles.mjs` (`GET users` par 100 via `twitch.api`, attente bornée, trou noir et 429 testés), `settings.mjs`. Le dock et sa lecture de la liste ne changent pas.

## 1.12.0

*Livraison « Contacts 2.0 », pour Curiosa 0.2.2 ou plus : un carnet de contacts unique pour tout le site (Contacts), que Raid, Story d'annonce et Partenariats lisent au lieu de garder chacun leur liste ; des pages de module en onglets.*

### Nouveautés

- **Contacts 2.0** : le carnet gère maintenant les **organisations** (une personne y est rattachée avec sa fonction), les **comptes** sur les réseaux (Twitch, YouTube, TikTok, Instagram, Discord, X, Bluesky, Mastodon, site web) — collez le lien du profil ou tapez le pseudo —, des **catégories** (créer, renommer, « Mettre dans… », supprimer sans perdre aucune fiche) et une **photo** (automatique, celle du compte qui a le plus d'abonnés, ou choisie à la main).
- Nouvelle page **Contacts** pensée pour le téléphone : des cartes avec photo, organisation et petites icônes des réseaux, une recherche en haut (accents et majuscules ignorés), des filtres d'un clic et « Voir la suite ».
- Quand une fiche a un compte Twitch ou YouTube, Contacts propose d'installer ce qui relie votre site à ce service.
- Nouveaux droits pour vos rôles : « voir les e-mails et téléphones », « exporter le carnet », « créer des catégories ».
- **Importer vos contacts depuis un tableur.** Collez vos lignes ou choisissez un fichier CSV (5 Mo au plus, jusqu'à 100 000 lignes). Avant que quoi que ce soit soit ajouté, vous voyez un aperçu : fiches créées, fiches complétées, déjà dans le carnet, lignes à corriger, avec pour chaque ligne la raison et un exemple. Un modèle à remplir est à télécharger.
- **Réimporter le même fichier ne crée aucun doublon.** Une fiche qui existe déjà est complétée (un compte, une catégorie, une note, un champ vide en plus), jamais renommée.
- **Exporter tout le carnet en un clic** (CSV, avec le droit « exporter le carnet »). Le fichier a les mêmes colonnes que l'import : exporté puis réimporté, le carnet redevient identique.
- **Doublons : une page pour réunir deux fiches.** Le carnet repère les fiches qui se ressemblent (même compte, même e-mail, même nom dans la même organisation, nom presque identique). Vous comparez, choisissez la fiche à garder, lisez ce qui sera repris, puis validez. Tant que vous n'avez pas validé, rien ne change. Les autres modules sont prévenus et suivent.
- **Tout ce que le site sait d'une personne.** Sur chaque fiche, un bouton télécharge sa fiche, ses notes et ce que les autres modules gardent sur elle. Un autre bouton l'efface partout, après une case à cocher, avec un bilan module par module (« n'a pas répondu à temps » si l'un d'eux est muet).
- **« Actualiser la photo ».** La photo et le nombre d'abonnés se mettent à jour quand vous ouvrez une fiche (si elle date de plus de 24 h) ou quand vous cliquez : jamais en arrière-plan. Twitch et YouTube demandent leur connecteur (la fiche le propose), Bluesky marche tout seul.
- **La page du module s'ouvre sur « Mes contacts ».**
- **« Raid Twitch » 2.0 : votre liste de raid vit dans Contacts.** Vos partenaires à raider sont les personnes d'une catégorie de Contacts, « Cible de raid » par défaut, qui ont une chaîne Twitch. Une personne a une seule fiche pour tout le site : son nom et sa photo servent partout, et vous les changez à un seul endroit. Pas encore de catégorie ? Dans le réglage « Liste de raid », tapez « Cible de raid » puis « Créer ».
- **Rien à refaire en venant de la 1.x.** À la mise à jour, votre ancienne liste passe toute seule dans Contacts : une fiche par chaîne (jamais en double), avec le nom que vous aviez donné, et vos notes deviennent des notes des fiches. Si la catégorie « Cible de raid » n'existe pas encore, la page de Raid vous demande une dernière étape (la créer, puis « Ranger mes chaînes dans cette catégorie ») ; en attendant, le dock continue de marcher. Votre ancienne liste reste gardée telle quelle.
- **« Story d'annonce » 2.0 : vos co-streamers viennent de Contacts.** Tapez un nom ou un pseudo (sur n'importe quel réseau) : la liste montre la photo et les comptes de chaque personne, et un clic l'ajoute à la vidéo (6 au plus). Plus besoin de retaper un nom ou de recoller une photo : ils restent dans Contacts, et une correction faite là-bas se retrouve dans vos vidéos.
- **« Ajouter depuis une catégorie de Contacts ».** Choisissez une catégorie (par exemple celle de vos cibles de raid) et ajoutez ses personnes une à une, ou remplissez d'un clic les places libres de la vidéo. Ce bouton remplace « Reprendre mes partenaires de Raid Twitch ».
- **Sans Contacts, rien ne casse.** Vous pouvez toujours ajouter quelqu'un « pour cette vidéo seulement » (un pseudo, un nom, une photo, tous facultatifs) : cette personne n'est jamais enregistrée dans Contacts. Le panneau propose d'installer un module qui tient vos contacts, sans rien installer sans votre clic.
- **Partenariats ne garde plus de carnet de contacts à lui.** L'écran « Contacts à fusionner » et le bouton « Annuler la fusion » disparaissent : toutes vos personnes sont dans Contacts, et les fiches partenaires ne font que s'y référer.
- **Vos anciens contacts sont repris tout seuls à la mise à jour, sans rien à cliquer.** Ceux dont on est sûr (même e-mail, ou même nom et même organisation) sont créés dans Contacts ou rattachés à la personne qui y est déjà. Les cas douteux deviennent des fiches Contacts marquées « à vérifier », avec la note « Repris de Partenariats : à vérifier » : vous les confirmez quand vous voulez. Rien n'est jamais fusionné à votre insu et rien n'est perdu.
- **Les pages des modules se rangent en onglets, avec le bon nom.** Le premier onglet porte le nom de ce qu'on y fait : « Fabriquer la vidéo » (Story d'annonce), « Ma liste » (Raid Twitch), « Créneaux » (Planning), « Commandes » (Bot Twitch), « Partenaires », « Chiffres » (Statistiques de la communauté), « Mes streams » (Agenda manuel), « Annonces » (Annonces Discord), « Suggestions » (Suggestions de jeux), « Messages » (Livre d'or). Pour Discord, GitHub, Mastodon, Reddit, Bluesky et la Chaîne YouTube, l'onglet qui ne montre que des chiffres s'appelle « Statistiques » ; « Ma chaîne » pour Ma Chaîne Twitch.
- **Un onglet « Apparence » pour Planning et pour l'overlay Labyrinthe**, qui ont beaucoup de réglages d'aspect : ils ne se mélangent plus aux autres réglages.
- **Moins d'onglets inutiles.** Le Connecteur Twitch, le Connecteur YouTube et « En direct ? » (live-status) n'ont plus d'onglet « Utiliser » : leur état de connexion ou leurs avertissements s'affichent en haut de « Réglages », à côté de la clé ou du réglage concerné.

### Améliorations

- Vos fiches gardent tout à la mise à jour : le texte « organisation » devient une fiche organisation (une seule par nom), les notes restent, les liens de Partenariats restent valables. Le texte « Autres canaux » est gardé ; les comptes qu'on y repère s'ajoutent d'un clic.
- Les erreurs s'affichent sous le champ concerné et disent quoi faire.
- Supprimer une fiche prévient les modules qui la citaient ; s'il y en a un qui ne répond pas, le message le dit.
- L'assistant (MCP) ne voit plus les e-mails ni les téléphones dans la liste ; toutes ses écritures doivent être accordées explicitement.
- **Mettre une fiche dans une catégorie se fait en deux gestes** sur la fiche : un choix et un bouton, sans cocher une liste de centaines de catégories.
- **Les gros imports ne bloquent rien.** Ils avancent par petits paquets avec une barre de progression, et reprennent là où ils en étaient si la page se ferme ou si le site redémarre.
- **Aucun écran ne déborde sur téléphone** : les tableaux n'ont qu'une colonne et les textes longs passent à la ligne.
- **Quand un service (Twitch, YouTube, Bluesky) ne répond pas ou demande une pause**, la fiche s'ouvre quand même et garde ses dernières données ; elle ne réessaie pas avant 10 minutes.
- **Le dock ne change pas** : mêmes membres en direct, même tri, même bouton « au hasard » au-delà de 500 chaînes, même adresse secrète. Seule l'origine de la liste change.
- **La page de Raid est plus simple** : le nombre de chaînes, l'état du dock et un lien « Gérer mes partenaires dans Contacts ». Ajouter, importer, chercher ou retirer des partenaires se fait dans Contacts. (Depuis la 1.13.0, un champ « Ajouter une chaîne » et un bouton « Retirer » existent aussi dans Raid.)
- **Si la catégorie choisie disparaît**, la page et le dock disent « La catégorie choisie n'existe plus, choisissez-en une » ; si elle a été fusionnée avec une autre, Raid suit tout seul. **Si Contacts ne répond pas un moment**, le dock garde la dernière liste connue (10 minutes au plus) puis le dit clairement. **Sans Contacts**, la page propose de l'installer.
- **Vie privée** : une personne effacée dans Contacts est aussi retirée de ce que Raid garde, et l'export « tout ce que le site sait de cette personne » inclut la part de Raid.
- **Votre liste de co-streamers passe dans Contacts toute seule.** À la mise à jour, chaque personne de « Ma liste de co-streamers » devient une fiche de Contacts (ou retrouve celle qu'elle avait déjà), avec sa photo, et vos modèles enregistrés suivent. Rien n'est perdu : si Contacts n'est pas installé, la liste reste, elle est proposée comme « ponctuels », et le passage se fait dès que Contacts arrive. Le faire deux fois ne crée aucun doublon.
- **Les photos de Contacts s'affichent dans la vidéo** quand elles viennent de Twitch, YouTube ou Bluesky (ou d'une photo choisie dans Contacts sur l'un de ces sites). Sinon, la vidéo montre les initiales de la personne.
- Si Contacts ne répond pas, l'éditeur le dit et continue de marcher : la recherche attend quelques secondes au plus.
- **Si Contacts n'est pas prêt** (absent, pas encore à jour, ou qui ne répond pas), rien n'est modifié : un message le dit en haut de Partenariats, et la reprise se fait toute seule dès que Contacts répond.
- **Effacer ou fusionner une personne dans Contacts met aussi Partenariats à jour** : le lien est retiré de vos fiches, ou redirigé vers la personne gardée, sans doublon.
- **Une personne fusionnée ou supprimée dans Contacts** est suivie sur vos fiches partenaires (elle ne disparaît plus de la liste). Le comportement des partenariats, le journal et l'accès pour les assistants IA ne changent pas.
- **Raid Twitch ne partage plus ses partenaires sous forme de sujet** : personne ne le lisait plus depuis Story 2.0 (Story lit Contacts directement). Aucune donnée n'est touchée, le dock marche comme avant.

### Pour les développeurs

- `contacts` 2.0.0, `minCore` 0.2.1, `dataVersion` 2 (migration rejouable, testée sur 2 000 puis 10 000 fiches, stockage en mémoire et vrai SQLite). Offre `contact.book` **version 2** (contrat de `tests/contract/`, passé par le vrai module : `tests/contacts-v2-contract.test.mjs`) et `contact.store` inchangé ; requiert en facultatif `privacy.subject`, `twitch.api` (≥ 3), `youtube.api` (régénérer `catalogue/index.json` : besoins facultatifs).
- Index mémoire borné invalidé par `store.generation()` et un tampon d'écriture ; reconstruction par pages, attentes avec expiration ; plafond 100 000 fiches ; options de test internes `ctx.__contactsTest`.
- Nouveau double de stockage fidèle au contrat 5 : `tests/helpers/contactsStore.mjs` (clés, curseurs, `addMany`, `generation`, pannes « trou noir »).
- `contacts` 2.1.0, `minCore` 0.2.2 (`tabs` : « Utiliser » devient « Mes contacts », un seul onglet renommé, règle `tabs.reasonable`), `dataVersion` 2 (aucune migration : les nouvelles collections `imports`, `importRows`, `importLog`, `notdup`, `reports` sont bornées et créées à la demande). Le contrat de `contact.book` n'est pas modifié.
- Nouveaux fichiers : `csv.mjs`, `import.mjs` (`stage`, `step("preview" | "run")`, `evaluate` unique pour l'aperçu et l'import), `export.mjs` et `downloads.mjs` (`adminDownloads` : `contacts` avec le droit `export`, `template`, `importReport`, `person`), `dedupe.mjs` (`planMerge` partagé avec `merge`), `privacy.mjs`, `photos.mjs`, écrans `*-admin.mjs`.
- Bornes : import 100 000 lignes, paquets de 200, 100 lignes par verrou, 8 s par pas, un pas abandonné au bout de 28 s si le stockage ne répond plus ; export par pages de 500 ; doublons 20 groupes par page, 5 000 gardés ; photos 6 s, 10 comptes par service. Mesures à 2 000, 10 000 et 100 000 fiches dans `tests/contacts-volume.test.mjs` (stockage en mémoire fidèle au contrat 5).
- L'index mémoire garde l'e-mail de chaque fiche (`m`) pour le détecteur.
- `twitch-raid` 2.0.0 : `minCore` 0.2.1, `dataVersion` 3 (migration `3` : `upsertByAccount` par lots de 100 avec point de reprise `contactsMigration`, idempotente, ne lève pas pour une panne de Contacts, ancien document `partners` intact ; à retirer en phase 3). `requires` : `contact.book` `min: 2` (dur) ; `offers` : `privacy.subject` (`each`). Nouveau réglage `category` (`choice`, source `service` `categories` / `categoriesResolve` / `createCategory`, `allowCreate`, `refersTo: "category"`, facultatif). Raid n'appelle `createCategory` que depuis une action d'administration, avec le droit de la personne connectée (`asCaller`, cœur 0.2.4 ; voir 1.13.0).
- La liste est lue par `accounts({ network: "twitch", categoryId, cursor, limit: 500 })` (10 000 comptes au plus), gardée 30 s et partagée, bornée (4,5 s), avec la dernière liste connue 10 minutes en cas de panne. La logique du dock (paquets de 100, 3 en parallèle, mode « au hasard », souvenir d'une minute, plafond) est inchangée.
- Sortis en 1.12.0 (l'ajout rapide, le retrait et la liste par pages reviennent en 1.13.0) : l'administration de la liste (ajout, import par collage, pages, recherche, monter/descendre), `backup.readable`, l'appel `GET users` (photos lues dans Contacts).
- Délais du dock dans le navigateur : 14 s pour `live`, 18 s pour `pick` (lecture de Contacts comprise).
- `stream-story` 2.0.0 (`minCore` 0.2.1, `dataVersion` 2) : `requires: [{ service: "contact.book", min: 2, optional: true }]`, `offers: [{ service: "privacy.subject", each: true }]` (export, effacement et suivi des fusions sur les références gardées dans les modèles et les préparations). Le sujet `stream.partner` n'est plus consommé (aucun autre module du dépôt ne le lisait) : le module Raid peut cesser de l'offrir.
- Un co-streamer d'une vidéo est `{ id }` (référence de fiche, rien d'autre) ou `{ login, name, image }` (saisie pour cette vidéo seulement) ; un modèle de la version 1 (liste de pseudos) reste lisible. Nouvelles routes de l'éditeur : `people`, `members`, `categories`, `category` ; `costreamer.*` et `costreamers.import` disparaissent. Le document `story_costreamers` n'existe plus qu'avant la migration ; `story_adhoc` (20 au plus) garde les personnes que Contacts n'a pas pu accueillir.
- Migration 2 (« à retirer en phase 3 », `migrate.mjs`) : `upsertByAccount({ network: "twitch", handle, kind: "person", name?, source: "stream-story" })` par ancien co-streamer, `setAccountProfile` pour la photo quand l'hôte est relayable, puis les pseudos des modèles et préparations deviennent des identifiants. Sans `contact.book` v2, muet ou en panne : rien n'est touché, et la route `data` (ouverture de l'éditeur) la rejoue, une passe à la fois, bornée.
- Relais d'images : ajout de `yt3.ggpht.com`, `yt3.googleusercontent.com` et `cdn.bsky.app` (chemins exacts), mêmes bornes (3 Mo, aucune redirection, type lu dans les premiers octets). Une photo sur un autre hôte n'est pas relayée.
- Tests : `stream-story-contacts` (contre `fakeContactBook`), `stream-story-editor` (l'éditeur dans un faux navigateur) ; `hang-stream-story` (Contacts muet, migration bornée) ; le test « trou noir » du sujet `stream.partner` de Raid sort de ce fichier (il appartient au module Raid).
- Partenariats 2.0.0 : `dataVersion` 2 (reprise `migrations[2]` : `migrate.mjs`, à retirer en phase 3), `minCore` 0.2.1, `legacyCollections` : `contacts`, `legacyContacts`, `meta`. `merge.mjs`, les actions `merge*` et `backup.readable` (CSV de l'ancien carnet) sont supprimés.
- Offre `privacy.subject` (`each`, `export` en lecture seule) : export / erase / remap de ses `contactIds`, vérifié par `runPrivacySubjectContract`. Gère `missing` et `moved` (`resolve`). Tout appel à `contact.book` a une attente bornée (5 s).
- Retire l'entrée temporaire `partnerships` de la liste blanche de `tests/legacy-labels.test.mjs` : plus aucun libellé hérité n'est toléré.
- Nouveaux tests : `tests/partnerships-migration.test.mjs` (cas sûrs / douteux, Contacts absent, trop ancien, muet, arrêt en cours de route, rejeu, 50 liens, reprise après une fusion 1.x) et `tests/partnerships-privacy.test.mjs`, contre `fakeContactBook`.
- Onglets (cœur 0.2.2) : clé `tabs` (`{ id, label?, hidden? }`) et `settings[].tab`, `minCore` 0.2.2. Renommés (`use`) : `stream-story`, `twitch-raid`, `planning`, `twitch-bot`, `partnerships`, `community-stats`, `calendar-manual`, `discord-announcer`, `game-suggestions`, `twitch-channel` (« Ma chaîne » : connexion et chiffres, à garder car un panneau de statistiques ne doit pas passer au-dessus du réglage de la chaîne) et l'exemple `guestbook` ; « Statistiques » : `discord`, `github`, `mastodon`, `reddit`, `bluesky`, `youtube-channel`. Retirés (`hidden`) : `twitch-connector`, `youtube-connector`, `live-status`. Onglet ajouté `look` (« Apparence ») : `planning` (15 réglages `group: "appearance"`) et `maze-overlay` (9). Règle `tabs.reasonable` du kit : 0 ou 1 onglet ajouté, noms de 20 caractères au plus en FR+EN.
- Versions : `stream-story` 2.0.1, `twitch-raid` 2.0.1, `planning` 2.2.0, `maze-overlay` 1.1.0, `twitch-bot` 1.2.1, `partnerships` 2.0.1, `community-stats` 1.1.2, `calendar-manual` 1.0.1, `discord-announcer` 1.0.4, `game-suggestions` 1.2.1, `live-status` 1.3.1, `twitch-channel` 2.0.1, `twitch-connector` 1.0.1, `youtube-connector` 1.0.1, `discord` 1.1.3, `github`/`mastodon`/`reddit`/`bluesky` 1.1.2, `youtube-channel` 1.2.1, `guestbook` (exemple) 1.0.2.
- `twitch-raid` : le sujet `stream.partner` est retiré (`provides`, `exports`, `partners.mjs`, permission `topics`, ses 4 tests, l'exception `NOT_YET_DOCUMENTED` de `tests/repo-rules.test.mjs`, qui est maintenant vide). Vérifié par grep dans le dépôt et le catalogue : plus aucun consommateur depuis Story 2.0. Les tests « trou noir » de la lecture de la liste par le dock restent (`twitch-raid-contacts`, `twitch-raid-large`).
- Textes qui disaient « plus haut / plus bas » d'un réglage devenu un autre onglet : l'aperçu des apparences de `planning` (aide du réglage et introduction du panneau) et la dernière étape de migration de `twitch-raid` renvoient maintenant à l'onglet par son nom.

## 1.11.0

*Livraison « Connexions » et nettoyage, pour Curiosa 0.2.0 ou plus : un Connecteur Twitch et un Connecteur YouTube qui gardent vos accès à un seul endroit, « Ma Chaîne Twitch », et plus aucun réglage « ancien » à voir.*

### Nouveautés

- **Nouveau module « Connecteur Twitch ».** Il relie votre site à Twitch, une seule fois pour tout ce qui touche à Twitch : votre application Twitch et les comptes que vous connectez (votre chaîne, et le compte du bot si vous en avez un) sont gardés à un seul endroit, en sécurité, et jamais affichés. Sa page vous guide pas à pas chez Twitch, avec l'adresse à coller et un bouton « Copier », et dit en mots simples si Twitch répond bien (« trop de demandes, pause jusqu'à 11 h 00 »…).
- **« Chaîne Twitch » s'appelle maintenant « Ma Chaîne Twitch »** (version 2.0). Elle passe par le Connecteur Twitch, installé avec elle. **Rien à refaire** : à la mise à jour, votre application Twitch et vos connexions (chaîne et bot) passent toutes seules dans le Connecteur, sans rien ressaisir. L'adresse déjà enregistrée chez Twitch reste valable.
- **Nouveau module « Connecteur YouTube ».** Votre clé YouTube est rangée **à un seul endroit** pour tout le site : vous la saisissez une fois, elle n'est plus jamais affichée ni écrite dans un journal. La page du connecteur dit en une phrase où créer la clé gratuite, combien de la limite du jour de YouTube a déjà servi, et, si elle est atteinte, quand cela reprend (« La limite YouTube du jour est épuisée, reprise demain à 9 h »).
- **Le site ne tombe plus à court de la limite YouTube.** Chaque demande à YouTube est comptée ; le connecteur s'arrête avant la fin (9 000 sur 10 000 par défaut, dont 1 000 gardées pour ce que vous faites dans l'administration). Une même réponse sert 10 minutes, et si YouTube ne répond plus, le site montre les dernières données connues avec leur date.

### Améliorations

- **Plusieurs chaînes, une seule application Twitch.** Le réglage « Utiliser les identifiants d'une autre chaîne » disparaît : toutes vos chaînes passent par l'application du Connecteur. Si une chaîne utilisait une autre application, sa page vous demande de la reconnecter une fois ; l'ancien accès est ensuite retiré tout seul.
- **Twitch en pause ? Tout le site fait une pause ensemble.** Quand Twitch dit « trop de demandes », le Bot, le Raid et votre chaîne attendent tous l'heure indiquée, puis reprennent seuls.
- **Sans Connecteur Twitch**, le bouton de votre chaîne et son lien restent affichés, et la page propose d'installer ce qu'il faut.
- **« Raid Twitch » et « Bot Twitch » passent au Connecteur Twitch.** Rien à refaire : ils s'en servent tout seuls après la mise à jour.
- **Plusieurs chaînes : Raid et Bot servent bien celle que vous avez choisie.** Avant, un Raid ou un Bot réglé sur votre deuxième chaîne pouvait dire « chaîne inconnue » ; c'est corrigé. La chaîne se **choisit dans une liste** (vos « Ma Chaîne Twitch »), en mode avancé, au lieu d'être tapée ; avec une seule chaîne, il n'y a rien à choisir. Un pseudo tapé avant continue de servir, et la page vous propose de le confirmer dans la liste.
- **« Suggestions de jeux » : la clé RAWG se saisit une seule fois**, dans les Réglages du site. Le champ propre au module a disparu. S'il manque une clé, l'administration du module le dit tout en haut, avec le lien pour la saisir. Si le module gardait une clé de son côté, elle est effacée dès que le site a la sienne.
- **« Statut live Twitch » reprend tout seul vos identifiants Twitch** à la mise à jour (la chaîne dans Ma Chaîne Twitch, l'application dans le Connecteur Twitch) : plus de bouton à cliquer, plus de champs à vider. Si Ma Chaîne Twitch n'est pas disponible à ce moment-là, le module réessaie chaque heure. Sa page dit maintenant quoi régler, et où : l'application dans le Connecteur Twitch, ou la chaîne dans Ma Chaîne Twitch.
- **« Planning » ne montre plus de champ d'adresse de calendrier** : l'adresse reprise par « Agenda en ligne » n'est plus affichée nulle part.
- Quelques phrases de « Raid Twitch » (renouvellement de l'adresse du dock) sont reformulées sans parler d'« ancienne » adresse.
- **« Chaîne YouTube » : plus de clé à saisir ici.** Si vous en aviez mis une, elle est remise au connecteur à la mise à jour, puis effacée de « Chaîne YouTube » seulement quand le connecteur confirme l'avoir : rien à retaper. Sans connecteur, la page de « Chaîne YouTube » propose de l'installer en un clic ; votre clé reste gardée, masquée, en attendant, et la vidéo mise en avant continue de marcher avec le flux public.
- **« Chaîne YouTube » ne bloque plus jamais la page d'accueil** quand YouTube est lent : chaque demande a un délai, plus court encore dans une page publique.

### Pour les développeurs

- `twitch-connector` 1.0.0 (`minCore` 0.2.0, `instances: "single"`, type `integration`) : offre `twitch.api` **version 3, non `each`**, sur-ensemble de la v2 (`account`, `wantScopes`, `connectLink`, `disconnect`, `request`) + `connections`, `exchangeCode`, `adopt`, `status`, `register`, `retire`. Liste fermée élargie : `GET users` (`login` ou `id`), `GET streams` (`user_login` ou `user_id`), `GET games`, `GET channels`, `GET videos`, `GET clips`, EventSub ; compte connecté : `POST chat/messages`, `GET channels/followers`, `GET subscriptions`. Tout passe par `ctx.api.net` (seau `bucket` par application Twitch, 8 s par appel, 15 s par appel complet du service), bloc `netHealth`. Réglages `appClientId` / `appSecret` (noms distincts de l'ancien `clientSecret` de `live-status`, pour la règle « un propriétaire par secret »).
- Clé d'instance : le cœur 0.2.0 dérive la clé par défaut de l'identifiant du module, soit `twitch-connector` ; les nouvelles configurations ont donc l'adresse de retour `/m/twitch-connector/oauth/callback` (une clé `twitch` demanderait un réglage `defaultKey` du cœur, qui n'existe pas en 0.2.0).
- `twitch-channel` 2.0.0 (identifiant conservé, nom « Ma Chaîne Twitch », `minCore` 0.2.0, `dataVersion` 2) : n'offre plus `twitch.api` ; `requires: [{ service: "twitch.api", min: 3 }]` dur (le cœur 0.2.0 installe le Connecteur avant de migrer). `clientId`, `clientSecret` (secret), `useCredentialsOf` deviennent `legacySettings` ; `legacyCollections` liste les anciennes collections. Migration 2 (`handover.mjs`, rejouable) : `adopt` de l'application, des connexions et des demandes ; `ctx.legacy.clear` et suppression seulement après `ready` ; sinon état `pending` / `conflict`, nouvel essai à l'ouverture de l'administration et dans la tâche. La route `oauth/callback` relaie `code` + `state` au Connecteur (`exchangeCode`) pour les installations existantes. `oauth.mjs` et `access.mjs` retirés ; `helix.mjs` ne parle plus qu'au Connecteur. Sans Connecteur : bloc `suggestInstall` (service `twitch.api`, `min` 3).
- Tests : `twitch-connector`, `twitch-connector-contract` (Bot, Raid et Statut live d'aujourd'hui contre le vrai Connecteur), `twitch-channel-handover` (reprise, rejeu, échec sans perte, conflit, plusieurs instances, EventSub) ; `twitch-api.test.mjs` remplacé. `fakeTwitch` : en-têtes sans casse, corps de formulaire en texte, `retryAfter`, `silence`, `truncated`, `clips` ; `fakeLive.connect` écrit la connexion chez le Connecteur ; nouvelle aide `helpers/twitchConnector.mjs`.
- `twitch-raid` 1.3.0 et `twitch-bot` 1.2.0 (`minCore` 0.2.0, `dataVersion` 2) : `requires: [{ service: "twitch.api", min: 3 }, { service: "twitch.live" }]`. Le réglage `channel` devient un `choice` (`source: { kind: "providers", service: "twitch.live" }`, `fromText`, `refersTo: "channel"`, avancé, facultatif) : la valeur est l'id d'une instance de Ma Chaîne Twitch. Nouveau `channel.mjs` (même fichier dans les deux modules) : `resolveChannel` traduit le choix en pseudo (`ctx.resolveChoice`, puis `twitch.live` `channel` avec `{ provider }`), puis le Connecteur est appelé avec `account({ channel })` (sans `channel`, il ne répond que pour la première chaîne connue : c'était la cause de `channel_unknown`). Rien de choisi : la première chaîne prête, comme avant. Toutes les attentes sont bornées (3,5 s pour le choix, 2,5 s par appel).
- Migration 2 de `twitch-raid` et `twitch-bot` (`rememberTypedChannel`) : un module ne peut pas réécrire son propre réglage, et `fromText` du cœur ne compare qu'au nom et à la clé de l'instance. La migration note donc dans la collection `typedChannel` le pseudo tapé et l'instance de Ma Chaîne Twitch qui a cette chaîne (au plus 50 instances, 6 s en tout) ; le réglage n'est jamais modifié ni effacé. À l'exécution, une valeur tapée sert encore : l'instance notée, sinon le pseudo s'il est connu de Ma Chaîne Twitch ou du Connecteur (`connections`), sinon `channel_unknown` (jamais une autre chaîne en silence).
- `live-status` : `setupGap` (remplace `canTellLive`) distingue l'application manquante (lien vers le Connecteur, `/admin/modules/twitch-connector`) de la chaîne manquante (lien vers Ma Chaîne Twitch) ; nouveaux textes `needChannel`, `openConnector`.
- Tests : `twitch-connexions-e2e` (de bout en bout contre le faux Twitch : Connecteur installé vide, deux Ma Chaîne Twitch migrées, Raid et Bot sur la DEUXIÈME chaîne : migration, `GET streams` / `GET users`, autorisations, EventSub, message envoyé dans le bon chat, compte bot séparé ; cas limites de `channel.mjs`, dont le « trou noir »). `tests/srp-guard.test.mjs` : `googleapis.com` appartient au Connecteur YouTube.
- `scripts/build-index.mjs` recopie `requires[].optional` (et seulement la valeur `true`) dans `needs` de l'index : sans cela un cœur 0.2.0 traitait un besoin facultatif comme dur. Les fonctions partagées vivent dans `scripts/rules.mjs`. `build-index.mjs --check` vérifie en plus la règle `needs.optional`.
- `scripts/release-check.mjs` : règle `needs.optional` et règle `data.versionMonotonic` (un module ne baisse jamais sa `dataVersion` par rapport à l'étiquette précédente ; `dataFloor` ≤ `dataVersion`).
- `tests/legacy-labels.test.mjs` : copie du test du cœur 0.2.0 (aucun libellé visible ne dit « ancien », « legacy », « reprise automatiquement »), qui lit ce dépôt par défaut. Liste blanche temporaire, nommée et datée (2026-10-20), pour `partnerships` : à retirer avec Partenariats 2.0.
- `game-suggestions` 1.2.0, `live-status` 1.3.0, `planning` 2.1.0 : `minCore` 0.2.0, `dataVersion` montée (2, 2 et 3), anciennes clés déclarées dans `legacySettings` (`rawgApiKey`, `channel` / `clientId` / `clientSecret`, `icsUrl`), lues par `ctx.legacy.get` et effacées par `ctx.legacy.clear` seulement après reprise confirmée. `game-suggestions` n'a plus de repli `fetch` direct vers RAWG. Tests de migration : rejeu deux fois, secret jamais affiché ni journalisé.
- Nouveau module `youtube-connector` 1.0.0 (`type: "integration"`, `instances: "single"`, `minCore: "0.2.0"`) : offre `youtube.api` version 1 (contrat 11.2). Méthodes `request({ endpoint, params, priority?, timeoutMs? })` (liste fermée : `channels.list`, `playlistItems.list`, `videos.list`, 1 unité chacun ; `search.list` exclu), `channels({ ids?, handles? })` (1 à 50 par appel : nom, photo, abonnés), `adopt({ apiKey })` (jamais de valeur renvoyée, idempotent), `status()`. Tout passe par `ctx.api.net` ; la clé voyage dans l'en-tête `x-goog-api-key`, jamais dans l'adresse. Compteur d'unités du jour dans le stockage (remise à zéro à minuit `America/Los_Angeles`), budget `dailyBudget` (9 000, dont `min(1000, budget/9)` réservées à `priority: "interactive"`), refus `quota` sans réseau avant l'épuisement ou après un 403 `quotaExceeded`, pause de 10 min sur clé refusée, cache de 10 min, repli daté (`stale`, `at`), bloc `netHealth`. Aucune tâche.
- `youtube-channel` 1.2.0 (`minCore: "0.2.0"`, `dataVersion: 2`) : `apiKey` passe en `legacySettings` (secret), `requires: [{ service: "youtube.api", min: 1, optional: true }]`, migration 2 et ouverture du panneau : `adopt` puis `ctx.legacy.clear("apiKey")` seulement après `ready: true`. Sans fournisseur : bloc `suggestInstall` (service `youtube.api`). Flux RSS et contrôles « Short » par `ctx.api.net` ; `channelId` déclaré `refersTo: "external"`. Les fonctions exportées prennent maintenant `ctx` en premier argument (`listVideos(ctx, id)`, `viaFeed`, `viaApi`, `isShort`, `shortFlags`, `channelStats`).
- Tests : `youtube-connector` (faux YouTube : 403 `quotaExceeded`, 429, silence, JSON tronqué, disjoncteur, compteur d'unités, budget et réserve, clé refusée, `channels`, `adopt`, aucune fuite de la clé dans les retours, blocs, journaux et console), `youtube-channel` (migration rejouée deux fois, reprise en échec → rien d'effacé, `suggestInstall`), `hang-youtube` et `social-stat` passés sur le vrai connecteur. Aide de test `tests/helpers/fakeYoutube.mjs`.

## 1.10.0

*Changements depuis la 1.9.0. « Raid Twitch » sait maintenant servir une grande communauté : jusqu'à 2 000 chaînes, avec un bouton « au hasard » quand la liste est très longue.*

### Nouveautés

- **« Raid Twitch » pour les grandes communautés (associations, collectifs).** La liste peut contenir **jusqu'à 2 000 chaînes** (100 avant). Jusqu'à 500 chaînes, le dock montre toujours **tous les membres en direct**. Au-delà, il propose un grand bouton **« Trouver un streameur en ligne au hasard »** : un clic choisit un membre en direct, le met en évidence et **copie sa commande de raid**. « Un autre au hasard » en propose un différent. La page d'administration dit clairement dans quel cas vous êtes, et pourquoi (Twitch ne permet de vérifier que 100 chaînes à la fois).
- **Un seul dock pour toute l'association.** Une personne tient la liste sur un site ; les membres ajoutent l'adresse du dock dans OBS, sans rien installer. Le site n'interroge Twitch que lorsque quelqu'un regarde ou clique, et le nombre de demandes ne dépend pas du nombre de membres.

### Améliorations

- **Une liste de 2 000 chaînes reste agréable à gérer** : 50 chaînes par page, champ de recherche (pseudo, nom, note), nombre total affiché, retour à la même page après chaque action.
- **Importer toute une communauté d'un coup** : collez vos pseudos (un par ligne, ou séparés par des virgules ou des espaces). Un bilan dit combien ont été ajoutés, combien y étaient déjà et lesquels ne sont pas valables, sans bloquer les bons. Un texte trop long est signalé, avec l'endroit où reprendre.
- **Le dock ne se vide plus si quelques chaînes ne répondent pas** : il affiche ce qu'il a, avec le message « Certaines chaînes n'ont pas pu être vérifiées. »
- **Votre propre chaîne n'apparaît plus** dans votre dock ni dans les tirages au hasard.
- **« Nouvelle adresse » est plus clair** : il est écrit qu'elle coupe l'accès à tout le monde, membres compris.
- **Votre IA** : au-delà de 500 chaînes, l'outil « qui est en direct » donne un membre tiré au hasard plutôt que la liste. Il reste en lecture seule et n'est jamais accordé d'office.

### Pour les développeurs

- `twitch-raid` 1.2.0 (`twitch-channel` inchangé : `GET streams` garde sa forme stricte de 100 pseudos au plus). Constantes uniques dans `pure.mjs` : `MAX_PARTNERS = 2000`, `FULL_VIEW_MAX = 500`, `PACKET_SIZES = [100, 50, 20]`, `SEARCH_TRIES = 6`. Nouveaux fichiers : `streams.mjs` (appel `GET streams`, paquets, borne par appel, repli 100 → 50 → 20 sur erreur 400, taille retenue 10 minutes) et `search.mjs` (mode au hasard : tirage sans remise injectable, souvenir par instance d'une minute, une recherche en cours est rejointe, plafond de 12 recherches par minute). `live.mjs` : vue complète par paquets de 100, 3 à la fois, résultat partiel, cache de 30 s (15 s si partiel) partagé et jamais éternel.
- Nouvelle route `pick` (POST seulement, secret obligatoire). La route `live` ne fait aucune demande à Twitch au-delà de 500 chaînes. Le dock reste une seule page sans donnée : `canSearch` est recopiée dans la page comme les autres fonctions du dock.
- Administration : `pageOf`, `filterPartners`, `rowId` / `parseRowId` (la page et la recherche voyagent dans l'identifiant de ligne). Le cœur coupe les textes de formulaire à 20 000 caractères : un collage trop long ignore son dernier pseudo, peut-être coupé.
- Tests : `twitch-raid-large` (paquets, repli 400, partiel, 50 visiteurs = 1 jeu d'appels, tirage équitable et sans remise, 300 clics en une minute, plafond, « trou noir » de la vue complète et du mode au hasard, administration à 2 000 chaînes). `fakeTwitch` : `streamsMax` (400 au-delà), `streamsFail`, compteurs de demandes.

## 1.9.0

*Changements depuis la 1.8.0. Un nouveau module « Story d'annonce » fabrique la vidéo qui annonce votre prochain stream. Il faut Curiosa 0.1.22 ou plus.*

### Nouveautés

- **Nouveau module « Story d'annonce ».** Il fabrique une petite **vidéo animée** qui annonce votre prochain stream, prête à publier en **story Instagram**. Vous choisissez le stream (le prochain, un autre, ou un stream écrit à la main si vous n'avez pas d'agenda), ce que la vidéo montre (titre, jour et heure, compte à rebours « Dans 2 h 15 » / « Ce soir à 19 h 30 » / « Demain », jeu et jaquette, logo et nom de votre chaîne, votre phrase, vos co-streamers), le **style** (néon qui clignote, affiche qui glisse, compte à rebours animé, texte seul), le **format** (vertical 9:16, ou « Passeport » 4:5 presque carré) et la **durée** (5 à 15 secondes, 15 par défaut). Un aperçu animé vous montre le résultat avant de le fabriquer, avec une option pour afficher les **zones de sécurité** que cache Instagram.
- **La vidéo se fabrique dans votre navigateur, rien n'est gardé sur le site** : une barre d'avancement, un bouton « Annuler », puis le fichier se télécharge (par exemple `annonce-2026-10-22-vertical.mp4`). Vidéo muette. Chrome ou Safari récents donnent un fichier MP4 ; sinon la page le dit et vous conseille un autre navigateur.
- **Vos co-streamers** : une liste à vous (pseudo Twitch, nom et photo facultatifs), des cases pour choisir qui apparaît (6 au plus), et l'ajout d'un pseudo pour une seule vidéo. Si « Raid Twitch » est installé, un bouton **« Reprendre mes partenaires de Raid Twitch »** les ajoute avec leur photo de profil.
- **Vos modèles** : enregistrez vos réglages sous un nom (« Stream du soir néon »), chargez-les, remplacez-les ou supprimez-les, chaque fois avec une confirmation.
- **Votre IA peut préparer la vidéo pour vous** : elle remplit tout et vous donne un lien ; vous vérifiez l'aperçu et cliquez sur « Générer la vidéo ». Elle ne fabrique ni ne publie rien, et l'outil qui prépare n'est jamais accordé d'office.

### Améliorations

- **« Raid Twitch » 1.1.0 peut partager vos partenaires avec vos autres modules** (leur pseudo, leur nom et leur photo de profil Twitch, jamais vos notes ni l'adresse du dock). Rien ne change pour vous si vous n'en avez pas l'usage.
- **« Chaîne Twitch » 1.7.0 sait donner le nom affiché et la photo de profil d'une liste de chaînes** (100 au plus, en une seule demande). Rien à régler ; la mise à jour est proposée toute seule.

### Pour les développeurs

- `stream-story` 1.0.0 (`minCore` 0.1.22, instance unique, `platform: "instagram"`, aucune page publique, aucune dépendance forte) : **consomme** les sujets `planning.slot` (n'importe quel agenda ; lecture bornée `from` / `to`, plafond de 100, attente maximale 6 s) et `stream.partner` ; jaquettes par `ctx.api.rawg`. L'éditeur est une page servie par la route `studio` dans un cadre du panneau d'administration ; ses routes de données exigent un jeton signé (HMAC, 12 h) donné par le panneau dans la partie `#` de l'adresse. Relais d'images `img` : hôtes `static-cdn.jtvnw.net` et `media.rawg.io` seulement, chemin d'image connu, 3 Mo, type lu dans les premiers octets, aucune redirection, 4 téléchargements à la fois. Outils MCP : `story_models` et `story_next_streams` (lecture seule), `story_prepare` (`default: false` : écrit une préparation de 7 jours et rend un lien ; entrées vérifiées une à une).
- Fabrication dans le navigateur : `scenes.mjs` (chaque style est une fonction `draw(ctx, t)`), `mp4.mjs` (emballeur MP4 minimal écrit pour le module, essayé avec de vraies images x264 relues par `ffprobe`), `encode.mjs` (détection des capacités avant de commencer, WebCodecs H.264 à 30 images/s et environ 8 Mb/s, repli `MediaRecorder`), `pure.mjs` (formats dans une seule table `FORMATS`, dates, compte à rebours, mise en lignes, mise en page des co-streamers, couleurs). Fichiers purs, exécutables dans un `vm` vierge.
- `twitch-raid` 1.1.0 : fournit le sujet `stream.partner` (`id`, `login`, `title`, `image` seulement s'il y a une photo), photos lues par `GET users` en demandes de 20 pseudos au plus, bornées à 6 s, gardées 6 h. Permission `topics`. `twitch-channel` 1.7.0 : `GET users` (liste fermée `ALLOWED.app`) passe en forme stricte : seul `login`, 1 à 100 pseudos valables. `fakeTwitch` répond à `GET users` (`state.users`).
- Tests : `stream-story-pure`, `stream-story-scenes` (zone sûre de chaque style × format × 0 à 6 co-streamers), `stream-story-video`, `stream-story`, `hang-stream-story` (essais « trou noir »), `mp4probe` (analyseur de structure MP4) et `fakeCanvas` dans `tests/helpers`. Le sujet `stream.partner` est une exception documentée de `repo-rules.test.mjs` tant que le tableau des sujets du cœur ne le liste pas.

## 1.8.0

*Changements depuis la 1.7.1. Le Planning montre vos streams et deux nouveaux modules les fournissent ; un nouveau module « Raid Twitch » vous dit quels partenaires sont en direct. Il faut Curiosa 0.1.27 ou plus pour mettre le Planning à jour.*

### Nouveautés

- **Nouveau module « Raid Twitch ».** Vous y listez les chaînes de vos partenaires, et il vous donne un petit panneau (un « dock ») à ajouter à OBS, qui montre **uniquement ceux qui sont en direct en ce moment** : leur jeu, leur titre, leurs spectateurs et depuis combien de temps ils streament. Un clic sur un partenaire **copie la commande de raid** (`/raid pseudo`), prête à coller dans votre chat : c'est vous qui la lancez. Un bouton « Au hasard » en choisit un pour vous. Le panneau se met à jour tout seul, se lit bien même très étroit, et ne s'ouvre qu'avec son adresse secrète (que vous pouvez remplacer d'un clic si elle a été partagée par erreur). Il faut Curiosa 0.1.22 ou plus ; « Chaîne Twitch » s'installe avec lui.
- **« Agenda en ligne » : votre Google Agenda alimente le site.** Collez l'adresse secrète de votre agenda une seule fois, puis écrivez vos streams dans Google Agenda comme d'habitude. Un guide pas à pas et un bouton « Tester l'adresse » sont dans la page du module.
- **« Streams saisis à la main » : pas d'agenda en ligne ? Pas de problème.** Un petit formulaire pour écrire vos streams (jour, heure, jeux, « chaque semaine », semaines à sauter) directement dans l'administration.
- **Vous pouvez avoir un seul de ces modules, ou les deux.** Leurs streams s'ajoutent sur le planning, et un stream écrit deux fois n'est montré qu'une fois.

### Améliorations

- **Si vous aviez déjà le Planning, vous n'avez rien à faire.** En se mettant à jour, il reprend l'adresse de votre agenda dans « Agenda en ligne » (installé pour vous) : la page du planning, les blocs d'accueil et le bot du chat montrent exactement les mêmes streams.
- **Sans agenda, le Planning n'affiche plus d'erreur.** Vos visiteurs voient « Pas de stream planifié », et l'administration vous dit quoi installer.
- **Le bot Twitch répond à « !planning » avec un seul de ces modules.** Le Planning n'est plus nécessaire. Un stream annulé n'est jamais annoncé.
- **Les heures suivent par défaut le fuseau de votre agenda.** Le réglage « Fuseau horaire d'affichage » du Planning est facultatif.
- **Un agenda qui ne répond plus ne ralentit jamais votre site.** La lecture s'arrête au bout de quelques secondes et le site garde la dernière copie reçue.
- **Chaîne Twitch 1.6.0 peut dire qui est en direct parmi une liste de chaînes.** C'est ce qui permet à « Raid Twitch » de savoir qui est en ligne, en une seule demande à Twitch (jusqu'à 100 chaînes). Rien à régler et pas besoin de connecter votre compte. Le module est proposé en mise à jour automatiquement.
- **Chaîne Twitch ne peut plus rester en attente d'un Twitch qui ne répond pas quand un autre module l'interroge** (le Bot Twitch, par exemple) : la demande est abandonnée au bout de quelques secondes et le module appelant en est informé.

### Pour les développeurs

- `calendar-ical` 1.0.0 et `calendar-manual` 1.0.0 fournissent le sujet `planning.slot` : `id`, `title`, `start`, `end`, `allDay`, `day`, `games`, `text`, `status`, `timezone` (contrat dans le README de `calendar-ical`). Aucun service, aucune dépendance. Le lecteur d'iCal quitte le Planning (`ical.mjs`), avec un téléchargement borné d'un seul tenant (`fetch.mjs`, `timing.totalMs`).
- `planning` 2.0.0 (`minCore` 0.1.27) ne fournit plus `planning.slot` : il le consomme. `slots.mjs` met les créneaux au format des apparences (fonctions pures) ; la lecture est bornée (`timing.collectMs`). Les jeux viennent de l'agenda (`games`), plus d'une description.
- Migration 1 → 2 (`dataVersion` 2, **temporaire, à retirer en 0.3.0**) : `seeds` désigne `calendar-ical`, le lien est un sujet (le cœur doit accepter `seeds` avec `consumes`, 0.1.27). Elle sème une instance avec `{ url, timezone }` puis efface `icsUrl`, déclaré en réglage avancé le temps de la reprise.
- `twitch-bot` 1.1.1 : `!planning` lit `planning.slot` sans exiger le Planning, ignore les streams annulés, lecture bornée (`timing.collectMs`). Tests : `tests/hang-calendar.test.mjs` (serveur « trou noir »), `planning-slots.test.mjs`, `planning-migration.test.mjs`, `calendar-*.test.mjs`.
- `twitch-channel` 1.6.0 : le service `twitch.api` passe en **version 2** (`offers[].version`). La liste fermée `ALLOWED.app` gagne `GET streams`, avec une forme stricte (`access.mjs`) : seuls `user_login` (1 à 100 pseudos, des textes qui passent `LOGIN`) et `first` (1 à 100) sont permis, jamais `after`, `game_id` ni `user_id`, et jamais avec le jeton d'utilisateur ; les autres appels gardent leur plafond de 20 valeurs par paramètre. `request()` borne désormais l'ensemble de l'appel (jeton compris) à `timing.sharedMs` (`helix.within`) et rend `network` au-delà. `fakeTwitch` sait répondre à `GET streams` (`state.streams`).
- `twitch-raid` 1.0.0 (`minCore` 0.1.22) : `requires: [{ service: "twitch.api", min: 2 }]` (une Chaîne Twitch d'avant la 1.6.0 est refusée avec le message du cœur « mettez le module à jour »). Une instance unique. Le dock est une page complète servie par la route `dock` (`/m/<clé>/dock?k=<secret>`), qui lit la route `live` ; secret de 192 bits gardé dans le stockage de l'instance, comparé à temps constant (empreintes SHA-256), régénérable ; page avec politique de sécurité à `nonce`, sans aucune donnée dans le HTML. `live.mjs` : un appel groupé par actualisation, gardé 30 s (`timing.okMs`), 15 s après une erreur, partagé par `share()` (expire à `timing.callMs`, 8 s), dernière liste connue (10 min) jointe aux erreurs. `pure.mjs` : les fonctions `raidCommand`, `sortPartners`, `pickRandom(items, rng, avoid)` et `durationText` sont recopiées telles quelles dans la page (`toString`) et testées avec un générateur injectable. Un outil MCP en lecture seule, non accordé d'office : `raid_partners_live`.
- Tests : `twitch-raid.test.mjs` (dont les essais « trou noir » du service Twitch, de `account` et de la page d'administration), `hang-twitch.test.mjs` (GET streams), `twitch-api.test.mjs` (forme stricte de `GET streams`). `platform.test.mjs` connaît `twitch-raid`.


## 1.7.1

*Changements depuis la 1.7.0. Aucune nouveauté : cette version corrige un blocage possible de la page d'accueil.*

### Améliorations

- **Chaîne Twitch et Chaîne YouTube ne peuvent plus bloquer votre page d'accueil si Twitch ou YouTube cessent de répondre.** Avant, quand l'un des deux ne répondait plus du tout, une demande restée en attente pouvait faire patienter toutes les suivantes : la page d'accueil n'affichait plus rien (erreur 504) jusqu'au redémarrage du site. Maintenant, chaque attente a une limite : passé quelques secondes, le module abandonne, affiche ce qu'il sait déjà (ou rien) et réessaie plus tard, tout seul.
- **Chaîne YouTube : la bannière de la dernière vidéo s'affiche plus vite.** Savoir si une vidéo est un Short demandait un appel à YouTube par vidéo, l'un après l'autre. Ils se font maintenant plusieurs à la fois, avec une limite de temps pour l'ensemble, et la réponse est gardée 10 minutes. Ce que vos visiteurs voient ne change pas.
- **Bluesky, Mastodon, GitHub, Discord et Reddit : même protection.** Si l'un de ces réseaux ne répond plus, vos chiffres de communauté s'affichent en erreur au lieu de rester bloqués.
- **Statistiques de la communauté et Planning : même protection.** Un réseau qui ne répond pas ne bloque plus la mise à jour des chiffres ni l'affichage du calendrier.

### Pour les développeurs

- `twitch-channel` 1.5.1 : `helix.mjs` partage ses travaux en cours (jeton, état du direct, renouvellement, statistiques, vidéos, clips) par `share()`, qui retire l'entrée de `state.inflight` à l'expiration (`timing.sharedMs`, 15 s ; 45 s pour les vidéos) et pas seulement à la fin ; le résultat d'un travail resté en arrière-plan n'est jamais écrit. `oauth.mjs` exporte `timing` et `request()` : signal d'abandon (`requestMs`, 5 s) ET borne dure de 20 % en plus, lecture du corps comprise ; tous les appels de `helix.mjs` et d'`oauth.mjs` passent par elle. L'enregistreur de directs ne reste plus « busy » à cause d'un Twitch muet.
- `youtube-channel` 1.1.2 : mêmes `timing`, `get` et `share` ; `isShort` garde sa réponse par vidéo (10 min, « inconnu » 1 min) ; `shortFlags()` contrôle les vidéos en parallèle (4 à la fois) sous une borne globale (`timing.shortsMs`, 5 s) ; `longVideos` et `featured` s'en servent ; `statsPending` est borné.
- `bluesky`, `discord` 1.1.2, `github`, `mastodon`, `reddit` 1.1.1 : `lookup()` borne sa promesse partagée (`timing.sharedMs`) et retire l'entrée à l'expiration.
- `community-stats` 1.1.1 : `collectNow` borne la collecte (`limits.collectMs`, 60 s) pour que le verrou `running` se libère. `planning` 1.3.2 : `fetchIcs` a une borne globale (`icsTiming.totalMs`, 10 s) redirections comprises.
- Tests `tests/hang-*.test.mjs` : un `fetch` « trou noir » (qui ne se termine jamais, signal d'abandon ignoré), des délais raccourcis et l'horloge simulée ; chacun échoue sans le correctif.

## 1.7.0

*Changements depuis la 1.6.0.*

### Nouveautés

- **Bot Twitch : la commande d'un partenaire se règle dans sa fiche.** Ouvrez la fiche du sponsor : une section « Commande de chat pour ce partenaire » propose la case « Activer la commande dans le chat », le nom de la commande (celui de sa page, que vous pouvez changer), le texte déjà rempli et un aperçu. Elle s'enregistre sans quitter la fiche. Il faut Curiosa 0.1.24 ou plus.
- **Bot Twitch : la page du bot garde le résumé.** Chaque partenaire y apparaît avec sa commande et son état (active, désactivée, en pause), et « Modifier » ouvre sa fiche directement sur cette section. Une commande dont la fiche n'est plus publiée est dite « en pause » avec ce qui va se passer.
- **Bot Twitch : on ne remonte plus en haut de la page à chaque clic.** Activer une commande, créer la vôtre, couper les réponses, vider le journal : le message s'affiche à côté du bouton et vous restez où vous étiez. « Modifier » descend jusqu'au formulaire.
- **Bot Twitch : un lien vers le module du réseau.** Quand vous modifiez la commande d'un réseau, un lien vous mène aux réglages de ce réseau pour changer son adresse.

### Pour les développeurs

- `twitch-bot` 1.1.0 (`minCore` 0.1.24) : première utilisation du point d'extension `entryPanels` du cœur. `module.json` déclare la section (`for: { topic: "sponsor.card" }`), `entry.mjs` la fournit (`render` + action `save`), la donnée reste dans `botConfig` sous l'identifiant de la fiche. Sponsors n'a pas changé et ne connaît pas le bot.
- Un cœur plus ancien refuse la mise à jour (`minCore`) et garde le bot 1.0.0 avec son formulaire sur la page du bot : pas de code de repli à maintenir. La fonction ne s'active que si Sponsors ET le bot sont installés.
- Le formulaire de partenaire est retiré de la page du bot (`?edit=partner:…` renvoie vers la fiche). Les actions de la page ne redirigent plus (sauf supprimer et rétablir le texte) ; les liens « Modifier » portent l'ancre `#edit`.
- `sources.networks` lit `adminPath` dans `ctx.api.instances.list()` (cœur 0.1.24) pour lier vers le module du réseau.

## 1.6.0

*Changements depuis la 1.5.1.*

### Nouveautés

- **Nouveau : le Bot Twitch.** Votre site répond aux commandes tapées dans votre chat Twitch : `!planning`, `!jeu`, `!titre`, `!followers` et `!uptime` sont prêtes, et vous créez les vôtres (nom, réponse, autres noms, qui peut s'en servir, attente entre deux réponses). Les réponses peuvent contenir le jeu, le titre, la durée du direct, le nombre de followers, le prochain stream ou le pseudo de la personne. Il faut Curiosa 0.1.22 ou plus ; Chaîne Twitch s'installe avec lui.
- **Des commandes pour vos partenaires et vos réseaux.** Si Sponsors est installé, chaque partenaire peut avoir sa commande (`!tesla` donne l'adresse de sa page). Si vous avez installé des modules de réseaux (YouTube, TikTok, Instagram, Discord, X…), chacun peut avoir la sienne (`!youtube`, `!tiktok`…), et `!reseaux` donne tous les liens d'un coup. Sans ces modules, rien ne change et la page du bot l'explique.
- **Un arrêt d'urgence et un journal.** Un gros bouton en haut de la page coupe toutes les réponses tout de suite ; un court journal dit, pour chaque commande, si le bot a répondu ou pourquoi il s'est tu. Par défaut le bot ne répond que pendant vos directs, ne répond jamais à lui-même ni aux autres bots, et se retient s'il y a trop de messages d'un coup.
- **Votre IA peut lister, créer et modifier des commandes** (rien n'est accordé d'office, rien ne se supprime).
- **Chaîne Twitch 1.5.0 : elle prépare le terrain pour le bot.** Elle peut demander à Twitch l'autorisation de lire et d'écrire dans votre chat (un bouton, une seule fois) et parler à Twitch à la place d'autres modules sans jamais leur montrer vos accès. Rien ne change pour vous si vous n'installez pas le bot.
- **Une vérification automatique de chaque module.** Tous les modules (et les deux exemples) passent maintenant une même série de contrôles : fichier de description, langues, réglages, sécurité, vie privée, textes en mots simples. Un défaut est repéré avant que vous ne le voyiez. Les défauts trouvés à la mise en place sont tous corrigés ci-dessous.

### Améliorations

- **Livre d'or : la vie privée est annoncée.** La page de confidentialité de votre site dit maintenant que les noms et messages des visiteurs sont enregistrés, et comment les faire retirer. Les champs « Image de bannière » et « Code d'invitation », qui sont facultatifs, ne sont plus comptés « à remplir ». Il faut Curiosa 0.1.22 ou plus.
- **Suggestions de jeux : la vie privée est annoncée.** Votre page de confidentialité explique ce que les visiteurs laissent quand ils proposent un jeu ou votent (nom ou pseudo, note, un petit cookie pour les votes).
- **Bannière d'annonce : le lien est vraiment facultatif**, et sa description est plus claire. Il faut Curiosa 0.1.22 ou plus.
- **Contacts et Partenariats : votre IA n'écrit plus sans votre accord.** Créer ou compléter un contact, créer ou modifier un partenaire, tenir son journal, lier ou détacher un contact : ces outils ne sont plus donnés d'office à votre IA, vous les accordez vous-même dans son accès. La lecture reste possible. Si votre IA les utilisait, recochez-les.
- **Overlay alertes : des mots plus simples.** La description n'emploie plus de terme technique, et le réglage « Jeton d'envoi » est rangé dans les réglages avancés.
- **Annonces Discord : une aide plus claire** pour l'adresse du lien Discord, sans terme technique.

### Pour les développeurs

- `npm test` lance la suite de conformité du cœur (dossier `testsupport/`, Curiosa 0.1.23) sur chaque dossier de `modules/` et `examples/` : une exigence = un test nommé. Aucun défaut connu n'est toléré (le tableau `KNOWN` de `tests/conformance.test.mjs` est vide). Un nouveau module est contrôlé sans rien écrire.
- Tests retirés car la suite les couvre : `optional-settings`, et des contrôles de `repo-rules`, `srp-guard` et des tests de modules (manifeste valide, langues, réglages, correspondance code/manifeste).
- Le test du Planning « carte prochain stream » ne dépend plus de l'heure.

## 1.5.1

*Changements depuis la 1.5.0.*

- **Les champs facultatifs ne sont plus marqués « à remplir ».** Dans Discord, les annonces Discord, le statut du live, Planning, le formulaire de contact, la Chaîne Twitch et la Chaîne YouTube, un réglage qui dit « facultatif » le reste vraiment : le laisser vide ne met plus l'extension « À configurer ». Il faut Curiosa 0.1.22 ou plus.

## 1.5.0

*Changements depuis la 1.4.0.*

- **Le site mesure maintenant vos directs Twitch et les vues de vos vidéos.** Il note les spectateurs moyens, le pic, les heures de live et regardées et les followers gagnés par jeu, à partir de l'activation du suivi (déjà active si « Suivre mes statistiques » était coché). Il faut Curiosa 0.1.17 ou plus.
- **Votre IA comprend mieux les chiffres de vos réseaux.** Quand il n'y a encore rien à lire, elle sait maintenant pourquoi et quoi faire. L'outil de saisie à la main change de nom (stats_set_manual) : recochez-le dans votre accès si vous l'utilisiez.
- **Un guide pour créer votre clé YouTube.** Le module Chaîne YouTube explique pas à pas, en haut de sa page, comment obtenir la clé gratuite dont il a besoin pour suivre vos abonnés, avec le lien vers la console Google et les pistes si la clé est refusée.

## 1.4.0

*Changements depuis la 1.3.3.*

- **Le site peut maintenant tenir à jour les chiffres de vos réseaux.** Vos abonnés, publications et vues sont notés régulièrement, avec leur évolution, pour vous et pour votre IA ; rien n'est montré sur votre site sans votre accord. Nouveau : Statistiques de la communauté ; il faut Curiosa 0.1.16 ou plus.
- **Vos réseaux peuvent maintenant partager le nombre de leurs abonnés.** YouTube, Twitch, Bluesky, Mastodon, GitHub, Discord et Reddit s'en occupent chacun, avec une case « Suivre mes statistiques ». Pour Twitch, un bouton « Connecter ma chaîne » suffit.

## 1.3.3

*Changements depuis la 1.3.2.*

- **Statut live annonce maintenant toutes vos chaînes Twitch, pas une seule.** Si plusieurs sont en direct, vous les voyez toutes, avec un petit choix pour passer de l'une à l'autre dans le lecteur. Mettez à jour Chaîne Twitch avec Statut live ; il faut Curiosa 0.1.14 ou plus.

## 1.3.2

*Changements depuis la 1.3.1.*

- **Le Catalogue propose maintenant tous les modules.** Blog, liens, pages, codes promo et les autres y figurent, au même titre que les autres. Il sait aussi quels modules ont besoin d'un autre, pour l'installer avec lui.

## 1.3.1

*Changements depuis la 1.3.0.*

- **Statut live et Chaîne Twitch partagent maintenant les mêmes identifiants.** Vous ne les saisissez qu'une fois, dans la Chaîne Twitch ; si vous les aviez déjà dans Statut live, un bouton les y reprend sans rien perdre. Sans identifiants, le lecteur n'apparaît plus (plus de panneau blanc « hors ligne »). Mettez à jour les deux ensemble.
- **Planning : choisissez l'apparence.** Liste classique, liste en alternance comme sur l'ancien site, semaine en grille, timeline, affiches, ou « à la une » : un aperçu de chaque choix est montré dans l'admin. Rien ne change tant que vous ne choisissez pas (module 1.3.0).

## 1.3.0

*Changements depuis la 1.2.1.*

- **Un seul carnet de contacts.** Chaque personne n'existe plus qu'une fois, dans le module Contacts ; les partenariats ne font que s'y référer. Les assistants savent désormais dans quel module écrire (mises à jour 1.1.0 de Contacts et de Partenariats).
- **Les contacts d'un partenaire sont de retour sur sa fiche.** On y retrouve leur nom, leur fonction et leur e-mail, on en ajoute ou on en retire, sans jamais effacer la personne du carnet.
- **Un bouton pour fusionner vos contacts existants.** Il montre d'abord ce qui serait fait, ne touche à rien sans votre accord, garde vos anciens contacts en copie et peut être annulé.

## 1.2.1

*Changements depuis la 1.2.0.*

- **Labyrinthe : le marcheur ne s'arrête plus.** Il pouvait se figer pour de bon après quelques instants, surtout avec un tracé dessiné à la main. Il continue sa promenade et se remet tout seul en route si quelque chose le bloque (module 1.0.2).
- **Overlay sponsors : plus de texte coupé.** Le titre et la légende du QR code s'affichent en entier (sur deux lignes si besoin), et le bandeau se réduit tout seul pour rester visible dans une petite source navigateur d'OBS. Mise à jour 1.0.1.

## 1.2.0

*Changements depuis la 1.1.0.*

- **Planning : les jaquettes des jeux sont de retour.** Pour chaque jeu écrit dans la description d'un événement (ligne « Jeu : … »), l'image du jeu s'affiche sur la page du planning, sur l'accueil, dans l'admin et sur l'image à partager. La clé RAWG se saisit une seule fois, dans Réglages du site ; sans elle, seul le nom du jeu s'affiche, et l'admin vous le dit.
- **Planning : le « prochain stream » de l'accueil devient une vraie carte.** Jaquette du jeu, jour et heure bien lisibles, « dans 3 h » ou « demain », bouton vers votre chaîne ; sans jeu (soirée caritative…), le logo de votre site sur fond mauve Twitch ; et un joli message quand rien n'est prévu.
- **Planning : un tutoriel et un fichier pour votre IA.** Dans la page du module, « Comment remplir mon agenda Google ? » explique où écrire le titre, le jeu et l'heure. « Télécharger le skill pour mon IA » donne un fichier à confier à votre assistant pour qu'il remplisse l'agenda correctement.
- **Statut live Twitch : le lecteur n'apparaît plus quand vous êtes hors ligne.** Avec vos identifiants Twitch, il ne s'affiche qu'en direct, plus de grand panneau blanc « hors ligne » (réglage « Quand afficher le lecteur » pour le garder toujours). Mise à jour 1.0.2.
- **Planning : l'image du panneau Twitch reprend l'allure de l'ancienne.** Une ligne par jour, deux streams au plus, avec les jaquettes à côté de l'heure et du titre. Elle se trouve à l'adresse `/m/<nom du module>/image` ; `?week=1` donne la semaine suivante.
- **Suggestions de jeux : les jaquettes manquantes sont retrouvées toutes seules.** Les suggestions arrivées sans image (reprises de l'ancien site, restaurées d'une sauvegarde, ou ajoutées pendant une panne de RAWG) sont cherchées petit à petit, sans jamais ralentir le site ni harceler RAWG. Dès qu'une clé est saisie ou corrigée, la recherche reprend.
- **Suggestions de jeux : un bouton « Rechercher les jaquettes manquantes ».** Il lance la recherche tout de suite et dit en clair ce qui s'est passé : combien de jaquettes trouvées, combien sans résultat, ou si la clé est absente, refusée ou si RAWG ne répond pas.
- **Une seule clé RAWG pour tout le site.** Les modules utilisent la clé des Réglages du site (il faut une version de Curiosa qui la propose). Sur une version plus ancienne, les suggestions de jeux gardent leur ancien champ de clé.
- **Les réseaux sont rangés par plateforme.** Les modules Twitch, Discord, YouTube et les réseaux sociaux se déclarent comme appartenant à leur plateforme, pour que l'administration puisse bientôt les regrouper au même endroit. Ils proposent une mise à jour (1.0.1) sans autre changement pour vous.
- **Labyrinthe : les boutons du tracé ne détruisent plus rien.** « Générer un nouveau tracé » et « Supprimer le tracé » préparent seulement le changement dans l'éditeur : rien n'est modifié tant que vous n'avez pas enregistré, et « Annuler les modifications » revient en arrière. Il faut Curiosa 0.1.10.

## 1.1.0

*Changements depuis la 1.0.0.*

- **Un module par réseau social.** Instagram, TikTok, X, Facebook, Discord, GitHub, Bluesky, Mastodon, Threads, Kick, Spotify, Reddit, Patreon, Ko-fi, Snapchat, Pinterest, Telegram, Steam, SoundCloud et Bandcamp. Vous indiquez votre identifiant ou l'adresse de votre profil, et l'icône apparaît dans l'en-tête du site.
- **Plusieurs comptes du même réseau.** Vous pouvez ajouter le même module plusieurs fois : votre chaîne Twitch et celle d'un ami, par exemple. Les modules Twitch et YouTube en profitent aussi.
- **Twitch et YouTube affichent leur bouton.** Ils s'ajoutent aux réseaux de l'en-tête, sans les saisir une deuxième fois.
- **Bandeau d'accueil plus simple.** Le titre et l'introduction sont déjà remplis avec ceux du site. Le bouton et la vidéo de fond s'ajoutent seulement si vous en voulez.
- **« Réseaux sociaux » devient « Liste de liens ».** Ce module sert pour vos sites et vos projets ; les réseaux ont maintenant les leurs.

## 1.0.0

*Première version du dépôt de modules, séparé du cœur de Curiosa.*

- **Tous les modules au même endroit.** Blog, réseaux sociaux, codes promo, pages, formulaire de contact, sponsors, planning, chaînes Twitch et YouTube… 21 modules et 2 exemples, installables depuis le Catalogue.
- **Une version figée pour chaque module.** Le Catalogue installe exactement la version relue, jamais un travail en cours.
- **Modules suggérés au départ.** Blog, réseaux sociaux et pages sont proposés lors de la première installation, et peuvent être passés sans risque.

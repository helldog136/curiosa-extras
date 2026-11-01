# Audit ergonomie : modules « stream et direct » (contre `docs/ERGONOMIE-ADMIN.md`, R1 à R30)

Périmètre : alerts-overlay, audience, community-stats, countdown, daily-game, game-covers, game-suggestions, home-assistant, live-status, maze-overlay, mascot, polls, sponsor-ticker, stream-story, ticker-overlay, twitch-channel, twitch-connector, twitch-raid, youtube-channel, youtube-connector, youtube-live-actions (21 modules ; `twitch-bot` exclu). Base : branche `dev`, version 1.28.0. Aucun code de module modifié.

Méthode : lecture de `module.json`, `locales/fr.json`, `admin.mjs` et `index.mjs` ; scripts de mesure hors dépôt ; appel réel de `adminPanel` avec un faux contexte (`fakeCtx` du cœur, textes FR) pour obtenir les blocs réellement produits ; captures des 5 pires modules (voir §5 pour les limites : le rendu est une reconstitution des blocs avec les classes du cœur, pas le vrai écran).

Captures (1280 px et 390 px) : `/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/audit-m1/` : `daily-game-1-formulaire`, `game-suggestions-1-liste`, `polls-1-liste`, `polls-2-en-direct`, `youtube-live-actions-1`, `home-assistant-1`, `home-assistant-2-reglages` (suffixes `-1280.png` et `-390.png`). Je les ai regardées.

## 1. Tableau « un module par ligne »

Note « praticable par Emma » : 1 impraticable, 5 sans reproche. « Simples » = réglages non avancés par onglet (le cœur place les réglages sans `tab` dans l'onglet « Réglages »). Seuil R5 = 7.

| Module | Note | Réglages simples (par onglet) | Top 3 des défauts | Règles violées |
|---|---|---|---|---|
| daily-game | 2 | 13 (Réglages) | 1) formulaire « Nouvelle question » à 19 champs visibles, FR/EN dupliqués ; 2) 13 réglages simples et 15 aides > 60 car. ; 3) deux listes de même schéma (« Par où commencer » et « Packs de départ ») avec « Pas activé » et boutons Activer/Retirer | R4, R5, R7, R11, R14, R15, R17, R30, R9 (CSV, `answer1`, `status`) |
| game-suggestions | 2 | 2 | 1) 8 boutons par ligne (« → Proposé », « → Planifié »…) qui débordent à 1280 et sortent de l'écran à 390 ; 2) aucune recherche ni filtre par statut (jusqu'à 1000 lignes lues) ; 3) écran fait de HTML en style inline, formulaire d'ajout avant la liste | R15, R16, R17, R27, R3, R10 |
| youtube-live-actions | 2 | 6 (Réglages) | 1) formulaire de règle à 8 champs dont « Autre nom d'action » à écrire à la main (`lumieres:violet`) ; 2) liste de 32 devises, minimum et délai en champs texte ; 3) 11 aides > 60 car., « clé », « identifiant », deux encarts « Module à installer » identiques | R4, R6, R9, R11, R19, R20, R25, R7 |
| home-assistant | 2 | 9 (Réglages) | 1) 9 réglages simples avec unités entre parenthèses et libellé de 66 car. ; 2) test avec « identifiant technique » à saisir (`lumieres:bleu`) ; 3) assistant qui parle de HACS et d'un dépôt GitHub, bouton « Vider le journal » au même niveau que le reste | R5, R9, R10, R20, R8, R3, R26 |
| twitch-connector | 2 | 2 | 1) guide Twitch en 5 étapes avec textes anglais à recopier (« Redirect URLs », « New Secret », « Confidential ») ; 2) libellés « Identifiant (Client ID) », « Secret » ; 3) liste des comptes connectés sans état clair | R8, R9, R26, R10 |
| youtube-connector | 2 | 3 (Réglages) | 1) 4 étapes dans la console Google (« API », « Identifiants », « clé », « service ») ; 2) « ID client Google », « Code secret du client » ; 3) deux secrets et un identifiant à coller | R8, R9, R11, R26 |
| polls | 3 | 7 (Réglages), 6 champs dans « Nouveau sondage » | 1) la liste des sondages est une liste à puces Markdown, sans recherche ni état filtrable ; 2) page de détail avec 6 formulaires à un bouton + cases « Oui, je suis sûr » ; 3) l'onglet « En direct » empile 5 formulaires et l'adresse secrète ; date et heure de fin en deux champs | R4, R6, R15, R16, R17, R1, R7 |
| audience | 3 | 1 (Salles et pseudos) | 1) onglet « En direct » : télécommande, dock, modules branchés, « ce que Participation garantit » (6 titres, paragraphes longs) ; 2) « Sourdine / rétablir » (verbe-bascule) ; 3) tirage : 6 champs, « Vider le tirage » toujours affiché, listes de 50 sans recherche | R1, R4, R15, R17, R19, R24, R11, R9 (« clé ») |
| mascot | 3 | 5 (Réglages) | 1) formulaires à 7 et 6 champs, textes FR/EN dupliqués ; 2) « Publier / retirer » (verbe-bascule) ; 3) colonne « Détails » avec « Publiée » répété sur chaque ligne, pas de recherche | R4, R14, R15, R17, R7 |
| countdown | 4 | 10 (Réglages) + 2 (section « Prochains ») | 1) 10 réglages simples dont 5 « (OBS) » ; 2) formulaire d'ajout à 6 champs : jour, heure, « toute la journée » et fuseau séparés ; 3) libellé de 67 car. | R5, R4, R6, R21, R10, R15 |
| twitch-raid | 3 | 1 (Réglages) + 7 (Sélection du moment) | 1) 12 réglages dans « Sélection du moment », 14 aides > 60 car. (certaines de 5 lignes) ; 2) tableau utilisé comme conteneur de bouton (« Nouvelle adresse ») ; 3) recherche de liste avec bouton, pas en direct | R5 (limite), R11, R15, R3, R1 |
| twitch-channel | 3 | 4 (Réglages) | 1) l'onglet « Ma chaîne » mélange connexion, statistiques, directs, jeux, vidéos, clips, effacement ; 2) « Effacer » présenté comme une ligne de tableau ; 3) aide de 700 car. sur « Suivre mes statistiques » ; « identifiant » | R1, R3, R11, R9, R24 |
| youtube-channel | 3 | 4 (Réglages) | 1) « Identifiant de chaîne » (commence par UC) à retrouver dans YouTube Studio ; 2) messages d'erreur qui disent « clé » et renvoient à un autre module ; 3) page d'admin réduite à un tableau de chiffres | R9, R8, R25, R11 |
| community-stats | 3 | 0 (2 avancés) | 1) « Ce que vous montrez » : un menu Oui/Non par chiffre et par compte ; 2) tableau « chiffre / évolution » en cellules multi-lignes ; 3) formulaire manuel à 6 champs | R17, R19, R14, R15, R4 |
| alerts-overlay | 3 | 4 | 1) commande `curl` avec `Bearer <token>` et JSON affichée sur la page ; 2) « Jeton d'envoi » ; 3) bouton « Envoyer » vague (R3) | R9, R3, R11, R25 |
| maze-overlay | 3 | 6 (Apparence) + 1 | 1) 7 libellés avec parenthèses (« (sans texture de mur) ») ; 2) éditeur de tracé à grille sans alternative clavier vérifiée ; 3) « Autres textures de murs (une URL par ligne) » | R10, R28, R11, R9 |
| game-covers | 3 | 1 | 1) « Clé RAWG » (3 occurrences) et guide en étapes ; 2) liste « à vérifier » sans recherche ; 3) trois actions autour de la clé (tester, oublier, enregistrer) | R9, R8, R15 |
| live-status | 4 | 4 | 1) « identifiants séparés par des virgules » ; 2) deux encarts « Module à installer » ; 3) libellé « En direct sur les deux : quel lecteur ? » (question, `:` absent mais ton) | R9, R25, R19 |
| stream-story | 4 | 0 (6 avancés) | 1) éditeur en iframe de 820 px minimum ; 2) 200 événements sans alternative claire au défilement ; 3) libellés avec « : » (« Story pour : ») | R27, R10, R15 |
| sponsor-ticker | 4 | 5 | 1) aucune aide ni exemple (réglages en secondes) ; 2) « Mode développeur » avec `?dev=1` (avancé, donc toléré) ; 3) pas de page d'admin : aucune phrase R1 | R1, R11, R20 |
| ticker-overlay | 4 | 4 | 1) aucune aide ; 2) aucune page d'admin ; 3) unités non dites (« Secondes par carte ») | R1, R11, R20 |

Moyenne du groupe : 3,0. Aucun module à 1 : aucun n'est inutilisable, mais 6 sont à 2.

## 2. Liste complète des écarts

Légende gravité : B = Bloquant pour Emma, G = Gênant, M = Mineur. Effort : S < 1 h, M < 1 jour, L plus.

### R1 / R2 : une page, une tâche ; chemin court
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| audience | `index.mjs` adminPanel, onglet « En direct » (clés `liveTitle`, `dockTitle`, `pluggedTitle`, `limitsTitle`) | quatre sujets sur un onglet (télécommande, dock, modules branchés, limites) ; l'action principale (ouvrir la télécommande) n'est pas isolée | G | M |
| polls | onglet « En direct » (`roundsBlocks`, `obsTitle`) | manches, sondage rapide, résultats OBS, adresse secrète : cinq formulaires dans un onglet | G | M |
| twitch-channel | `analytics.mjs` panel, `connect.mjs` panel | connexion, directs, jeux, vidéos, clips et effacement : six tâches | G | M |
| daily-game | `admin.mjs` adminPanel | un écran porte aperçu des 7 jours, liste, formulaire, packs ; chemin court « ajouter une question » = 19 champs | B | L |
| twitch-raid | `admin.mjs:66-87`, `add-admin.mjs` | liste, ajout, import en lot, dock, migration, vérification, renouvellement sur le même onglet | G | M |
| alerts-overlay, sponsor-ticker, ticker-overlay | `index.mjs` | pas de phrase de tâche (alerts a un `heading`+texte ; les deux autres n'ont aucune page) | M | S |

### R3 / R24 : bouton principal, destructif séparé et confirmé
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| audience | `drawview.mjs:65` formulaire « Vider le tirage » toujours affiché ; `regenerate` (case « Oui, les adresses… ») | actions destructives permanentes en carte pleine, confirmation par case à cocher de 66 car. | G | S |
| home-assistant | `admin.mjs` `jr_clear` « Vider le journal », `big_stop` | bouton primaire pour « Vider le journal » (perte de l'historique), au même poids que « Obtenir un code » | M | S |
| twitch-channel | `analytics.mjs:126` | « Effacer » présenté comme ligne de tableau ; dit ce qui est perdu seulement dans la confirmation | M | S |
| twitch-raid | `admin.mjs:87` | un tableau d'une cellule sert de conteneur au bouton « Nouvelle adresse » (danger) | M | S |
| daily-game | tableau « Recommencer le tour », « Retirer le pack » | boutons destructifs sans séparation du reste | M | S |
| polls | page de détail | 6 formulaires, chacun avec « Oui, je suis sûr » ; suppression par page dédiée (bonne pratique, à généraliser) | M | M |
| alerts-overlay | `testSubmit` « Envoyer » | verbe vague ; envoie une alerte réelle à l'écran | M | S |

### R4 : au plus 5 champs visibles par formulaire
| Module | Formulaire | Champs visibles |
|---|---|---|
| daily-game | « Nouvelle question » (`questionForm`, `games.mjs`) | 19 |
| youtube-live-actions | « Ajouter une règle » (`ruleForm`) | 8 |
| mascot | « Apparence » | 7 |
| polls | « Nouveau sondage » | 6 |
| audience | « Nouveau tirage » | 6 |
| mascot | « Ajouter une phrase » | 6 |
| countdown | « Nouveau compte à rebours » (court) | 6 (édition complète : 16) |
| community-stats | « Noter un chiffre » | 6 |
| polls | « Sondage rapide » | 5 (limite) |
| twitch-raid | réglages « Sélection du moment » | 12 dont 7 simples |

### R5 : au plus 7 réglages simples par onglet
daily-game 13 (G), home-assistant 9 (G), countdown 10 (G ; 5 d'entre eux, préfixés « (OBS) », pourraient se replier sous « Apparence »). Limite atteinte sans dépassement : polls 7, twitch-raid « Sélection du moment » 7. Remarque : les réglages avec `group: appearance` sont peut-être repliés par le cœur ; je ne l'ai pas vérifié, les chiffres ci-dessus les comptent.

### R6 / R7 / R21 : une notion = un champ, options rares, dates et heures
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| polls | `pollFields` : `endDate` + `endTime` ; mêmes champs dans le détail | date et heure en deux champs, « (facultatif) » deux fois | G | M |
| countdown | `formFields` : `date`, `time`, `allDay`, `tz`, plus en édition `endDate`, `endTime`, `tzOther` | un événement = jusqu'à 7 champs de temps ; « Autre fuseau » en texte libre | G | M |
| daily-game | `date` précise (facultative) dans le formulaire principal | option rare permanente | M | S |
| audience | « Durée en minutes (facultatif) » dans « Nouveau tirage » | option rare permanente | M | S |
| daily-game, mascot, polls (manches) | `q_fr`/`q_en`, `name_fr`/`name_en`, `alt_*` | un champ par langue, tous visibles même si le site est monolingue | G | M |
| youtube-live-actions | `currency` (32 options) + `min` + `cooldownSec` | une règle de seuil en trois contrôles | M | M |

### R9 : mots interdits (occurrences exactes, textes visibles hors mode avancé)
Mesure : réglages simples + toutes les clés `fr.json` (le détail visible/invisible n'a pas été trié clé par clé pour les messages ; les faux positifs « Mise en route » et « cache » (verbe) sont exclus).
| Module | Occurrences |
|---|---|
| game-covers | « clé » : 20 clés de texte (`key_title` « Clé RAWG », `key_none`, `guide`, `test_key`, `status_no_key`, `err_no_key`…) ; réglage `rawgKey` « Clé RAWG » (3 occurrences) |
| youtube-channel | « clé » : 8 clés (`err_auth`, `err_config_key`, `err_config_connector`, `suggest_reason`, `key_waiting`, `events_note`, `events_setup_*`) ; « identifiant » : `channelId` (libellé), `err_config_channel`, `events_setup_channel` |
| youtube-connector | « clé » : `key_ok`, `key_missing`, `key_refused`, `key_help`, `acc_intro`, `acc_none`, `acc_step1` ; « service » (`key_refused`), « API » (`acc_step1`, `err_scope`), « identifiants » (`key_help`), « identifiant » (`acc_step3`), « URL » (`pend_1`) ; réglage `apiKey` « Clé YouTube » |
| youtube-live-actions | « clé » : `st_no_api`, `err_config`, `err_unavailable`, `err_auth`, `err_chat_denied`, `suggest_api`, `info_stop`, `info_nochat`, `st_connect` ; « identifiant » : `st_no_channel`, `err_channel` |
| game-suggestions | « clé » : `coversNoKeyHint`, `coversDeniedHint`, `coversNoKey`, `coversDenied`, `rawgBanner` ; « Markdown » dans le libellé `intro` |
| home-assistant | « identifiant » : `test_unknown_key`, `test_custom_help` (« identifiant technique »), plus les clés d'action `lumieres:rouge` affichées dans le journal et la liste |
| twitch-connector | « Identifiant (Client ID) » (réglage `appClientId`), `adopted_note` |
| twitch-channel | « identifiant » : réglage `channel` (« Chaîne Twitch (identifiant) »), `res_refused`, `handover_incomplete` ; « identifiants » : `events_setup_refused` |
| twitch-raid | « identifiant » : `dock_nr_setup`, `dock_nr_refused` |
| live-status | « identifiants » : réglage `channels` ; « clé » : `ytNeedKey` |
| audience | « clé » : `remoteSecret` |
| alerts-overlay | « jeton » : `noToken` (page visible) ; « token », `Bearer`, `kind`, JSON dans le bloc `curl` de la page (le réglage « Jeton d'envoi » est avancé) |
| daily-game | « CSV » : `importHelp`, `fFile`, `hFile`, `exportButton`, `csvEmpty` ; noms de colonnes `answer1`, `status` dans `importHelp` |
| maze-overlay | « service » : `mapCustom` (« en service ») ; « URL » dans le libellé `extraWall` |
| community-stats, countdown, mascot, polls, sponsor-ticker, stream-story, ticker-overlay | aucune |

Remarque : `{n}`, `{title}`… sont des variables remplacées avant affichage (pas des accolades visibles) ; seuls les gabarits de la mascotte (`{nom_du_site}`, `{prochain_evenement}`) et la « phrase de série » de daily-game (`{n}`) montrent des accolades à Emma, avec explication.

### R10 : libellés > 60 caractères ou avec « : » / parenthèses
Libellés > 60 : countdown `overlayEndMinutes` (67), home-assistant `globalDelaySeconds` (66), youtube-live-actions `readWithoutHouse` (61), audience `regenConfirm` (66, hors réglages). Aucun libellé de réglage ne finit par « : ». Parenthèses de précision (à remplacer par une unité dans le champ, R20) : countdown 5 (« (OBS) »), home-assistant 8 (« (secondes) », « (caractères) »), maze-overlay 7, mascot 3 (« (secondes, de 3 à 60) »), youtube-live-actions 4, daily-game 1, polls 2, twitch-raid 2, youtube-connector 2, live-status 2, youtube-channel 1, twitch-channel 1, twitch-connector 1, stream-story 1, game-suggestions 1. Libellé avec « : » : stream-story `ui_event_chosen` « Story pour : ».

### R11 : aides > 60 caractères, champs libres sans exemple
Aides > 60 caractères (réglages, avancés compris) : daily-game 15 sur 16, twitch-raid 14 sur 14, youtube-live-actions 11 sur 11, mascot 7 sur 7, countdown 6 sur 7, home-assistant 6 sur 10, twitch-channel 6 sur 6, youtube-connector 5 sur 5, audience 4 sur 6, live-status 4 sur 4, polls 4 sur 8, stream-story 4 sur 6, alerts-overlay 2, community-stats 2, twitch-connector 2, youtube-channel 2, game-covers 1, maze-overlay 1, sponsor-ticker 1, game-suggestions 0, ticker-overlay 0. Plus longues : twitch-channel `trackStats` (environ 700 car.), twitch-raid `publicPage` (environ 600 car.), alerts-overlay `youtubeText` (environ 250 car.). Champs libres sans exemple : game-suggestions `title`, `intro` ; audience `bannedWords` (l'exemple est dans le texte de départ) ; maze-overlay `extraWall` ; youtube-connector `oauthClientId` ; youtube-live-actions `thanks`. Sous-formulaires sans exemple : community-stats « Chiffre », mascot « Description de l'image » (exemple présent seulement sur la première langue).

### R14 : étiquettes répétées par ligne
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| mascot | colonne « Détails » : « Salutation · français · Publiée » | état par défaut répété sur chaque ligne | M | S |
| daily-game | « Pas activé » sur chaque pack ; colonne « Origine »/note sous la question | M | S |
| game-suggestions | colonnes « Par : Administration » et « Jaquette : ✓ » identiques pour presque toutes | M | S |
| community-stats | « Sur le site : oui/non » et « Mise à jour automatique : … » répétés dans chaque carte | M | S |
| youtube-live-actions | « recharge 0 s » sur chaque règle | M | S |

### R15 : listes qui peuvent grandir sans recherche dynamique
| Module | Liste | Recherche |
|---|---|---|
| game-suggestions | suggestions (pages de 50, jusqu'à 1000 chargées) | aucune, aucun filtre par statut : B pour Emma dès 30 suggestions ; L (recherche serveur) ou M (filtre client) |
| polls | sondages (liste à puces, 50 par page) + archivés | aucune ; G ; M |
| daily-game | questions (30 à 2000) | formulaire « Chercher » avec bouton (à partir de 13 questions), pas en direct ; G ; M |
| mascot | phrases (jusqu'à 100) | aucune ; G ; S |
| twitch-raid | « Ma liste » | recherche à bouton (serveur) ; M ; M |
| audience | personnes inscrites (50 par page), salles, journal | aucune ; G ; M |
| community-stats | chiffres, comptes manuels | aucune ; M ; S |
| youtube-live-actions | règles, journal | aucune (limite de règles) ; M ; S |
| game-covers | « Corrections gardées » | aucune ; M ; S |
| countdown | événements (limite `MAX_EVENTS`) | aucune ; M ; S |
| home-assistant | journal (50 lignes) | aucune ; M ; S |
Seul stream-story propose une recherche en direct (événements, contacts).

### R16 / R17 : lignes régulières, interrupteurs
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| game-suggestions | `index.mjs:~470`, `rowActions` | 8 actions par ligne : 6 verbes « → Statut », « Jaquette… », « Supprimer ». Le statut est un bouton-verbe, pas un menu | B | M |
| mascot | `actToggle` « Publier / retirer » | bouton « Activer / désactiver » déguisé (R17) ; 3 actions par ligne | G | S |
| audience | `actMute` « Sourdine / rétablir » | même défaut | G | S |
| daily-game | « Activer » / « Retirer le pack » | état montré dans le texte, bouton verbe | M | S |
| youtube-live-actions | « Pause » / « Reprendre » par règle | verbe-bascule ; 3 actions par ligne | M | S |
| community-stats | `saveVisibility` : un menu Oui/Non par chiffre | doit être un interrupteur en ligne | G | M |
| polls | `onAir` / `close` / `reopen` | états en boutons-verbes | M | M |

### R19 / R20 : bon contrôle, unités et bornes
| Module | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|
| audience | `site` (« Inscription depuis le site ») liste Oui/Non | R19 | M | S |
| community-stats | menus Oui/Non (cf. R17) | R19 | G | M |
| youtube-live-actions | `currency` 32 options, `min` et `cooldownSec` en texte | R19, R20 | G | M |
| countdown | `timezone` 45 options (libellés avec le nom technique « Europe/Paris ») | R19 | M | S |
| daily-game, polls | `timezone` 23 options | R19 | M | S |
| home-assistant, countdown, sponsor-ticker, ticker-overlay, alerts-overlay, maze-overlay | unité dans le libellé entre parenthèses ou absente | R20 | M | S |
| twitch-raid | `exclude` : « Ne jamais tirer ces pseudos » | case/champ négatif | M | S |

### R22 / R23 : erreurs
Les erreurs de champ observées donnent un exemple (daily-game, polls, mascot, stream-story, audience tirage) : point fort. Écarts : home-assistant `test_unknown_key` parle d'« identifiant technique » ; youtube-live-actions `rules_*` (erreurs de forme libre sur les règles) non testées visuellement. Le focus sur le premier champ en erreur n'a pas été vérifié (comportement du cœur).

### R25 : liens entre modules
| Module | Écart |
|---|---|
| youtube-live-actions | deux encarts « Module à installer » identiques quand le Connecteur Home Assistant manque, aucune ligne d'état « associé ✓ » ; pour la clé YouTube : « ajoutez-la dans le module Connecteur YouTube » sans lien direct |
| live-status, home-assistant | deux encarts « Module à installer » (Twitch, YouTube) au lieu d'un choix unique |
| game-suggestions / game-covers / stream-story | renvoi à « le module Jaquettes de jeux » en texte, lien direct seulement dans la ligne « Jaquette… » |
| alerts-overlay | « installez le module Actions du live YouTube » sans lien |
| youtube-channel, twitch-channel | « ajoutez votre clé dans Réglages, sur la page du connecteur » : bon dans l'idée, sans bouton |
Points forts : home-assistant et twitch-raid donnent un bouton vers l'autre page quand elle existe.

### R26 / R8 : première fois, assistants
twitch-connector (5 étapes, anglais à recopier), youtube-connector (4 étapes Google Cloud, 10 minutes annoncées), home-assistant (3 étapes mais HACS + GitHub), game-covers (guide RAWG) dépassent « trois étapes » ou les contiennent sans état par étape. daily-game et mascot ont un bon départ en un clic (gabarits). countdown, polls, game-suggestions : pas d'exemple prérempli (état vide = texte).

### R18 : états vides
Corrects partout où un état vide existe (phrase qui dit quoi faire). Écarts mineurs : audience « Aucune salle pour le moment » sans action ; game-suggestions « Suggestions (0, 0 à traiter) » affiche un tableau vide au lieu d'une phrase ; community-stats « Aucun de vos réseaux… » sans bouton direct.

### R27 / R28 : téléphone et clavier
game-suggestions : à 390 px la table défile horizontalement et les actions de ligne sont hors écran (capture). Tous les autres tableaux avec actions (daily-game, mascot, polls, YLA) restent dans `overflow-x`. maze-overlay `gridEditor` : alternative clavier non vérifiée. Le cœur rend l'annulation d'un formulaire par une flèche `↩` (cible 44 px non vérifiée).

### R29 : parité FR/EN
Mesurée : identique (mêmes clés, mêmes variables) pour les 21 modules. R13 : 42 clés contiennent « ! », surtout des exemples, des textes publics ou des commandes (`!stop`) ; non triées une par une.

## 3. Motifs répétés (candidats composant ou règle du kit)

| # | Motif | Modules | Proposition |
|---|---|---|---|
| A | Liste sans recherche en direct ni filtre d'état | game-suggestions, polls, daily-game, mascot, twitch-raid, audience, community-stats, youtube-live-actions, game-covers, countdown, home-assistant (11 sur 21) | Un bloc `searchTable` du cœur : champ « Rechercher » en direct, filtres d'état, pagination serveur. À poser une fois |
| B | Bouton-verbe de bascule (« Publier / retirer », « Sourdine / rétablir », « Pause », « → Statut », « Activer ») | mascot, audience, youtube-live-actions, game-suggestions, daily-game, polls (6) | Un type d'action `toggle` avec interrupteur dans la cellule, et un menu `…` pour les autres actions (au plus 2 visibles) |
| C | Formulaire bilingue : un champ par langue | daily-game, mascot, polls (manches) | Un champ `translatable` du cœur (onglets FR/EN dans le même champ, replié si une seule langue) |
| D | Date + heure (+ fuseau) en champs séparés | countdown, polls, daily-game, stream-story, audience (durée) | Un contrôle `dateTime` (R6/R21) avec fuseau replié et phrase d'aperçu |
| E | Formulaire d'un bouton, sans champ, dans une carte (« Fermer », « Vider », « Tout couper », « Obtenir un code ») | audience, polls, twitch-raid, home-assistant, alerts-overlay, community-stats, game-suggestions (7) | Un bloc `actionButton` (titre facultatif, `danger`, confirmation, résultat à côté) ; une règle « un bouton seul n'est pas un formulaire » |
| F | Case de confirmation pour une adresse secrète ou une suppression | audience (×2), polls (×2+), twitch-raid | Un bloc `secretAddress` (copier, ouvrir, régénérer avec confirmation en boîte) : apparaît dans 3 modules et dans plusieurs autres familles |
| G | Assistant avec identifiants à recopier chez un tiers | twitch-connector, youtube-connector, game-covers, home-assistant (4) | Un bloc `setupSteps` (3 étapes max, état par étape, bouton copier, vérifier) et un lexique « code YouTube / code Twitch » à la place de « clé / identifiant / secret » |
| H | Vocabulaire « clé / identifiant / jeton / CSV » | game-covers, youtube-*, twitch-*, game-suggestions, alerts-overlay, live-status, daily-game (11) | Ajouter « CSV », « Client ID », « URL », « Markdown », « Bearer » à la liste du test R9 et un glossaire (« code d'accès ») |
| I | Encart « Module à installer » dupliqué | youtube-live-actions, home-assistant, live-status, polls, audience (5) | Regrouper en un seul bloc d'état « Il manque : … » avec un bouton par module manquant |
| J | Réglages d'apparence OBS dans l'onglet principal | countdown, polls, alerts-overlay, sponsor-ticker, ticker-overlay, maze-overlay | Un groupe « Apparence » replié par défaut (hors du décompte R5) ; unité dans le champ et non dans le libellé |
| K | Adresse OBS / dock + 3 étapes d'installation recopiées | audience, twitch-raid (×2), polls, community-stats, countdown | Bloc `obsSource` (adresse, copier, étapes repliées, aperçu) |
| L | Tableau d'une cellule utilisé comme conteneur de bouton | twitch-raid, twitch-channel, daily-game | Utiliser E ; interdire par test |

## 4. Plan de correction ordonné (impact pour Emma ÷ effort)

Lots indépendants, chacun de 1 à 3 jours d'agent. Les lots 1 à 4 sont des composants du cœur ou du kit ; ils servent d'autres familles que « stream ».

1. **Lot 1 — Tableau avec recherche en direct, filtres et interrupteur en ligne (motifs A, B, L), 3 jours.** Poser le bloc `searchTable` + type d'action `toggle` + menu `…` dans le cœur, puis l'appliquer à game-suggestions (8 boutons vers un menu de statut, recherche, filtre par statut), mascot (phrases), polls (liste à puces vers tableau), daily-game (recherche en direct). Gain le plus fort : game-suggestions B, polls G, mascot G.
2. **Lot 2 — Formulaires courts et options repliées (R4, R7, motifs C, D), 3 jours.** daily-game : « Nouvelle question » en 3 champs (question, réponses, bonne réponse) et le reste sous « Plus d'options » ; langue en onglets. polls : date et heure en un champ. countdown : quand/fuseau en un contrôle. mascot : formulaires Apparence/Phrase à 3 champs. audience : « Nouveau tirage » à 3 champs.
3. **Lot 3 — Règle YouTube : un seul contrôle de seuil et de nom d'action (R6, R19, R9), 2 jours.** youtube-live-actions et home-assistant : la liste d'actions vient des actions déjà reçues ou des récompenses (plus d'identifiant à écrire), devise en liste recherchable, minimum et délai en nombres avec unité. Supprimer « Autre nom d'action » et « Ou une autre action (avancé) » du chemin court.
4. **Lot 4 — Vocabulaire et aides courtes (R9, R10, R11, motif H), 2 jours.** Un seul passage de réécriture : « clé YouTube / RAWG » → « code YouTube / RAWG », « identifiant » → « nom de la chaîne », unités sorties des libellés, aides ≤ 60 caractères avec le reste dans la bulle « ? » (daily-game 15, twitch-raid 14, YLA 11, mascot 7). Étendre la liste R9 (CSV, Client ID, URL, Markdown, Bearer). Concerne 14 modules, aucune logique.
5. **Lot 5 — Assistants de configuration (motif G, R8, R26), 3 jours.** `setupSteps` du cœur (3 étapes, état par étape, copier, vérifier) puis twitch-connector, youtube-connector, game-covers, home-assistant (HACS : un seul lien « Ouvrir la procédure »).
6. **Lot 6 — Actions destructives et adresses secrètes (R3, R24, motifs E, F, K), 2 jours.** Blocs `actionButton` et `secretAddress` ; audience (Vider le tirage, adresses), polls, twitch-raid, home-assistant (« Vider le journal »), twitch-channel (« Effacer »). Remplacer les cases « Oui, … » par la boîte de confirmation du cœur avec ce qui sera perdu.
7. **Lot 7 — Pages trop chargées (R1, R5, motifs I, J), 2 jours.** audience « En direct » (3 sections repliables), polls « En direct », twitch-channel « Ma chaîne » (une carte par tâche), regrouper les encarts « Module à installer » ; replier l'apparence OBS (countdown 10 simples vers 5, daily-game 13 vers 6, home-assistant 9 vers 5 avec « Mots refusés » dans un second onglet).
8. **Lot 8 — Petits écarts S (1 jour).** Étiquettes répétées (R14), cases négatives, états vides (R18), exemples manquants (game-suggestions, maze, sponsor/ticker : aide + unité), `alerts-overlay` : retirer le `curl`/Bearer de la page visible (le replier ou le mettre en mode avancé), libellés > 60.
9. **Lot 9 — Mobile et clavier (R27, R28), 1 à 2 jours.** Tables avec actions : cartes à 390 px ; alternative clavier de `gridEditor` (maze) ; cibles ≥ 44 px ; vérification par le futur kit `admin.ergonomics`.

Ordre recommandé : 1, 4, 2, 3, 6, 5, 7, 8, 9. Le lot 4 est le meilleur rapport impact/effort (aucune logique) mais ne règle pas les blocages ; le lot 1 est le seul qui change l'utilisabilité de game-suggestions.

## 5. Ce que je n'ai pas pu vérifier

- **Captures** : reconstituées à partir des blocs réellement produits par `adminPanel` (faux contexte) et des classes du cœur (`ui.ts`, `AdminBlocks.tsx`, `Blocks.tsx`), pas le vrai écran Next (pas de base ni de session d'admin). Polices, thème, boîte de confirmation, menus du cœur et le groupement par `group` des réglages ne sont pas fidèles. Mobile : une fenêtre Chromium sans interface ne descend pas sous 500 px, le 390 px est un cadre de 390 px dans cette fenêtre. Pas de mode sombre ni d'écran d'erreur capturés. Captures faites seulement pour 5 modules : daily-game, game-suggestions, polls, youtube-live-actions, home-assistant.
- **Kit `admin.ergonomics`** : absent du cœur à la date de l'audit (`ec98bbd`) ; les mesures R4/R5/R9/R10/R11 viennent de mes scripts (`/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/audit-m1/measure.py`, `scanloc.py`, `harness.mjs`) et sont à recouper avec le kit.
- **Écrans non rendus avec des données** : audience (salles, personnes, tirage ouvert), countdown (liste), mascot, community-stats (comptes), twitch-raid (liste, import en lot), twitch-channel connecté, youtube-connector connecté, stream-story (l'éditeur est une page HTML à part, lue dans `fr.json`, non rendue), maze-overlay (éditeur de grille), game-covers (liste « à vérifier »). Pour ceux-là, les écarts viennent de la lecture du code.
- **Pages publiques et overlays** (page de sondage, page du jeu, overlays OBS, télécommande et dock d'audience, pages d'inscription) : hors périmètre « configuration », non audités.
- **Mots interdits** : les occurrences viennent de `fr.json` en entier ; je n'ai pas trié chaque message selon qu'il est affiché hors mode avancé ou dans un message technique de journal. « Mise en route » et « cache » (verbe) écartés à la main.
- **R22 (focus), R23 (état « en cours »), R28 (ordre de tabulation, libellés reliés)** : comportements du cœur, non testés.
- **R13** : seul le décompte des « ! » et de « Veuillez » (zéro) est fait ; vouvoiement, longueur des phrases, noms réels dans les textes par défaut non vérifiés.

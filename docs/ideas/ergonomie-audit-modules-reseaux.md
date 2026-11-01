# Audit d'ergonomie : réseaux sociaux et annonces (21 modules + page « Réseaux sociaux » du cœur)

Date : 2026-11-01. Règles : `docs/ERGONOMIE-ADMIN.md` (R1 à R30, lues en entier). Modules : curiosa-extras, branche `dev` (contenu de master 1.28.0 + docs). Cœur : `helldog136/Curiosa` branche `dev`, version 0.5.1 (fichiers `src/app/admin/(panel)/social/`, `src/core/social.ts`, `src/app/admin/(panel)/instances/[id]/InstanceView.tsx`, `src/components/admin/ModuleSettings.tsx`). Aucun code modifié.

Modules audités : bandcamp, bluesky, discord, discord-announcer, facebook, github, instagram, kick, kofi, mastodon, patreon, pinterest, reddit, snapchat, soundcloud, spotify, steam, telegram, threads, tiktok, x-twitter.

Méthode : lecture de `module.json`, `locales/fr.json`, `index.mjs` et README de chaque module ; scripts de mesure hors dépôt (nombre de réglages, mots interdits R9, libellés R10, aides R11, exemples, phrases R13, parité FR/EN R29) ; essai de 85 saisies réalistes sur la fonction `profile()` de chaque module ; site du cœur monté pour de vrai (harnais `scripts/visual`, base de démonstration, navigateur Chromium) et captures à 1280 et 390 px, regardées une à une. Captures : `/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/audit-m3/` (`coeur-reseaux-{1280,390}.png`, `instagram-*`, `discord-*`, `discord-announcer-*`, `bandcamp-asetter-*`).

## 0. Ce qu'il faut retenir

1. **Le gabarit n'est pas partagé : il est copié.** 15 modules ont un `index.mjs` identique ligne à ligne (33 lignes) hors 3 à 5 constantes ; la fonction `profile()` est octet pour octet la même dans 20 modules ; les 5 modules à statistiques (bluesky, discord, github, mastodon, reddit) copient en plus ~100 lignes de collecte (30 à 60 lignes de différence entre eux). Le cœur ne sait rien d'eux : un réseau = un module à installer + une instance + une page de réglages.
2. **Le gabarit a un défaut de fond** : un seul champ « Profil X » dont la saisie n'est **jamais vérifiée** ; une adresse qui ne convient pas (`instagram.com/monpseudo` sans https, `u/pseudo`, `@nom@mastodon.social`) est enregistrée sans un mot et **le bouton n'apparaît simplement pas**. Les captures le montrent : Bandcamp contient « demo », aucune erreur, aucun encadré « à renseigner ».
3. **Parcours « mes six réseaux »** : aujourd'hui 25 clics, 6 champs, 12 chargements de page (7 si on compte l'installation de chaque module). Cible : 3 clics et 1 champ (adresses collées d'un coup), voir section 4.
4. **Page « Réseaux sociaux » du cœur** : à 1280 px, le nom de chaque réseau est **tronqué à 3 ou 4 lettres** dans la grille « Ajouter » (« Ban », « Blue », « Disc »…), parce que le champ « Nom (ex. Chaîne de Ra… » prend la place ; 23 cartes sans recherche ; chaque réseau déjà installé apparaît **deux fois** (liste « Mes réseaux » et grille « Ajouter »).

## 1. Tableau, un module par ligne

Note de 1 à 5 pour la page de réglages du module seule (5 = aucun écart ; on retire 1 point pour le défaut du gabarit commun, 1 pour un mot interdit R9, 1 pour un champ libre sans exemple R11, 1 pour un champ en doublon, 1 pour une étape externe sans assistant R8 ; plancher 1). La note du parcours complet est donnée à part (2 sur 5). « Simples » = réglages non avancés. « Défauts » = réglages qui ont une valeur par défaut. Aides > 60 = aides visibles de plus de 60 caractères (donc cachées derrière « ? », ce qui est le comportement prévu du cœur, mais l'exemple y disparaît).

| Module | Version | Réglages (simples) | Défauts | Aides > 60 car. | Champ libre sans exemple | Mot interdit R9 | Phrases > 20 mots (R13) | Onglets vus par Emma | Note |
|---|---|---|---|---|---|---|---|---|---|
| bandcamp | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 0 | 0 | 0 | Réglages, Général | 4 |
| bluesky | 1.1.3 | 2 (2) | trackStats | 2 sur 2 | 0 | 2 (identifiant) | 1 | Statistiques, Réglages, Général | 3 |
| discord | 1.1.5 | 3 (3) | trackStats | 3 sur 3 | 1 | 0 | 2 | Statistiques, Réglages, Général | 2 |
| discord-announcer | 1.1.0 | 9 (6) | 8 sur 9 | 7 sur 9 | 1 (+1 sans aide) | 7 (webhook, accolades) | 3 | Annonces, Réglages, Général | 1 |
| facebook | 1.0.2 | 1 (1) | aucun | 0 | 1 | 0 | 0 | Réglages, Général | 3 |
| github | 1.1.3 | 2 (2) | trackStats | 1 sur 2 | 1 | 2 (identifiant) | 0 | Statistiques, Réglages, Général | 2 |
| instagram | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 0 | 1 (identifiant) | 0 | Réglages, Général | 3 |
| kick | 1.0.2 | 1 (1) | aucun | 0 | 1 | 0 | 0 | Réglages, Général | 3 |
| kofi | 1.0.2 | 1 (1) | aucun | 0 | 1 | 1 | 0 | Réglages, Général | 2 |
| mastodon | 1.1.3 | 2 (2) | trackStats | 2 sur 2 | 0 | 0 | 1 | Statistiques, Réglages, Général | 3 |
| patreon | 1.0.2 | 1 (1) | aucun | 0 | 1 | 0 | 0 | Réglages, Général | 3 |
| pinterest | 1.0.2 | 1 (1) | aucun | 0 | 1 | 1 | 0 | Réglages, Général | 2 |
| reddit | 1.1.3 | 2 (2) | trackStats | 2 sur 2 | 1 | 1 | 0 | Statistiques, Réglages, Général | 2 |
| snapchat | 1.0.2 | 1 (1) | aucun | 0 | 1 | 1 | 0 | Réglages, Général | 2 |
| soundcloud | 1.0.2 | 1 (1) | aucun | 0 | 1 | 1 | 0 | Réglages, Général | 2 |
| spotify | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 1 | 0 | 0 | Réglages, Général | 3 |
| steam | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 1 | 1 | 0 | Réglages, Général | 2 |
| telegram | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 1 | 1 | 0 | Réglages, Général | 2 |
| threads | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 1 | 1 | 0 | Réglages, Général | 2 |
| tiktok | 1.0.2 | 1 (1) | aucun | 1 sur 1 | 1 | 1 | 0 | Réglages, Général | 2 |
| x-twitter | 1.0.2 | 1 (1) | aucun | 0 | 1 | 1 | 0 | Réglages, Général | 2 |

Notes : (a) « champ libre sans exemple » = pas de « ex. » ni « par exemple » dans l'aide ; « (sans @) » n'est pas un exemple. (b) R29 (parité FR/EN, variables) : aucun écart trouvé, y compris les 6 fichiers `locales`. (c) R10 : aucun libellé de plus de 60 caractères ni avec deux-points ; « Profil X (Twitter) » est le seul libellé avec marque double. (d) R5 : aucun module ne dépasse 7 réglages simples ; discord-announcer en a 6 mais les affiche dans un seul formulaire (R4, voir écarts). (e) Les 5 modules à statistiques ont un onglet « Statistiques » placé en premier (une fois configurés, c'est lui qui s'ouvre), alors que la seule tâche de la personne est de dire son adresse.

## 2. Écarts complets

Gravité : B = Bloquant pour Emma, G = Gênant, M = Mineur. Effort : S (moins d'une demi-journée), M (jusqu'à un jour), L (plus).

### 2.1 Gabarit commun (les 20 modules `profile`)

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| G1 | R22, R23, R8 | `modules/*/index.mjs` `profile()` (20 copies) ; `ModuleSettings.tsx` cas `text` (aucune validation) | Une saisie non reconnue est enregistrée sans message ; le bouton n'apparaît pas ; « Enregistré. » s'affiche quand même. Mesuré : `instagram.com/monpseudo`, `www.instagram.com/…`, `x.com/…`, `github.com/…`, `t.me/…`, `kick.com/…`, `ko-fi.com/…`, `patreon.com/…`, `soundcloud.com/…`, `discord.gg/…`, `bsky.app/profile/…`, `u/pseudo`, `r/communaute`, `@nom@mastodon.social`, `fb.me/…`, `monnom.bandcamp.com` : tous rejetés en silence. Bandcamp et Spotify refusent même le simple pseudo (pas de modèle d'adresse). | B | M (cœur + 20 modules) |
| G2 | R11, R9 | `settings.profile.help` (FR) | « Votre identifiant X (sans @) ou l'adresse de votre profil. » : mot interdit « identifiant » dans 11 modules + 2 messages d'erreur ; 14 modules sans exemple concret ; le cœur n'a pas de champ « exemple/placeholder » dans `SettingField` (types.ts), donc l'exemple ne peut vivre que dans l'aide, et l'aide de plus de 60 caractères part derrière « ? » (l'exemple devient invisible : capture instagram-1280). | G | S (textes) + S (cœur : clé `example`) |
| G3 | R6 | `settings.profile` | Une notion (le profil) demandée sous deux formes dans un seul champ (pseudo OU adresse), sans dire laquelle choisir ; le bouton affiche « Instagram · monpseudo » si on tape le pseudo mais « Instagram » seul si on colle l'adresse (`index.mjs` ligne `label`) : même réseau, deux libellés selon la saisie. | G | S |
| G4 | R12 | libellés et aides | Même chose, cinq mots : « Profil » (libellé), « page » (Bandcamp, Facebook, Kofi, Patreon), « chaîne » (Kick), « canal » (Telegram), « compte » ; « followers » dans les titres de chiffres alors que le code dit « abonnés » ; « membres » pour Discord. Pas de glossaire dans le dépôt (R12 en réclame un). | M | S |
| G5 | R7 | `trackStats` « Suivre mes statistiques » (5 modules) | Libellé ambigu : sur un réseau social, « Suivre » veut dire s'abonner. Case activée par défaut, effet invisible si le module Statistiques de la communauté n'est pas installé (R25 : aucun état de l'autre côté). Aides de 90 à 129 caractères. | G | S |
| G6 | R13 | `description` | Chaque description ajoute « Ajoutez-en un par compte si vous en avez plusieurs » : un mode d'emploi dans la phrase qui dit à quoi sert la page (R1) ; bluesky et mastodon : 21 mots. Côté cœur, le texte par défaut `social.nickname` cite un nom de personne (« Chaîne de Rascane »). | M | S |
| G7 | R7, R4 | onglet « Général » (cœur) | Pour un bouton sans page, « Général » montre quand même « Nom affiché » et « Dans mon menu d'administration » (épingler au menu un module qui n'a ni page ni panneau n'a pas de sens). | M | S (cœur) |
| G8 | R25 | `trackStats`, `social.stat` | Les chiffres sont fournis à `community-stats` ; aucun lien ni état (« Statistiques de la communauté : installé ✓ ») dans le réglage. | M | S |

### 2.2 Modules qui s'écartent du gabarit

| # | Module | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|---|
| M1 | discord | R6, R7 | `settings.invite` (module.json) | Deuxième champ « Lien d'invitation (facultatif) » pour une notion déjà saisie dans « Profil Discord » (qui accepte déjà une invitation) ; aide de 142 caractères et 24 mots, sans exemple ; sert dans 5 % des cas. À replier sous « Plus d'options ». | G | S |
| M2 | discord | R22, R23 | `locales/fr.json` `err_hidden`, `err_config_*` | Messages utiles mais longs (22 mots) ; l'erreur d'invitation apparaît dans l'onglet Statistiques, pas sous le champ fautif (R22). | M | S |
| M3 | mastodon | R6, G1 | `TEMPLATE = null`, `HOSTS = null` | Seule l'adresse https complète est acceptée ; `@nom@mastodon.social`, forme que tout le monde connaît, est refusée en silence. N'importe quel site https est accepté (aucun contrôle que c'est du Mastodon). | G | S |
| M4 | spotify | R8, R11 | `TEMPLATE` absent | Pas de modèle : un pseudo ne marche pas, seule l'adresse copiée depuis « Partager » (aide de 89 caractères, sans exemple). | G | S |
| M5 | bandcamp | R8 | `TEMPLATE = null` | Seule l'adresse complète avec https ; `monnom.bandcamp.com` est refusé. | G | S |
| M6 | github, reddit, bluesky, mastodon, discord | R9 | `locales/fr.json` `err_config_account` | « vérifiez votre identifiant dans Réglages » (mot interdit, et « Réglages » n'est pas un lien, R25). | M | S |
| M7 | reddit | R11 | `profile` | Accepte `/r/…` et `/user/…` mais seul un pseudo seul est autorisé hors adresse (`r/communaute` et `u/pseudo` refusés en silence) ; aide de 77 caractères qui demande « profil ou communauté » sans exemple. | G | S |
| M8 | steam | R11, R9 | `help` | « identifiant personnalisé » (jargon Steam) ; `…/profiles/<nombre>` accepté mais pas dit. | M | S |
| M9 | facebook | G1 | `HOSTS` | `fb.com` déclaré accepté mais `fb.me` refusé ; `profile.php?id=…` accepté ; aide sans exemple. | M | S |
| M10 | x-twitter | R10, R12 | `label` « Profil X (Twitter) » | Marque double dans le libellé et dans le bouton ; l'adresse `twitter.com/…` est acceptée telle quelle (non convertie vers x.com). | M | S |
| M11 | kofi, patreon | R12, R30 | `module.json` + module `platform-links` | Ko-fi et Patreon existent deux fois : module à part ET ligne dans « Autres plateformes » (`links.mjs` : `PLATFORMS`). Deux chemins pour la même chose ; la personne ne sait pas lequel choisir. Le bouton peut se doubler dans l'en-tête (dédoublonnage par adresse seulement). | G | M (décision) |
| M12 | discord-announcer | R8, R26 | `settings.webhookUrl` | Il faut créer un « webhook » dans Discord (chemin « Discord → paramètres du salon → Intégrations → Webhooks » dans une aide de 151 caractères, derrière « ? ») avant de coller une adresse. Aucun assistant en trois étapes avec l'état de chaque étape (créer, coller, tester). Le test existe, mais dans un autre onglet (« Annonces »), seulement après l'enregistrement. | B | M |
| M13 | discord-announcer | R9 | libellé, `description`, `notConfigured`, `configured`, `errNoWebhook`, `liveText.help`, `mention.help` | « webhook » (7 occurrences visibles), « URL », `{accolades}` expliquées en 241 caractères, `<@&id-du-rôle>`. | G | S |
| M14 | discord-announcer | R4, R7 | onglet Réglages | 5 champs visibles dont 1 select qui ne sert que si « Annoncer aussi mes directs YouTube » est coché (le select « En direct sur Twitch et YouTube en même temps » reste visible, capture discord-announcer-1280) ; `liveText` et `mention` sont des options rares affichées en permanence. | G | S |
| M15 | discord-announcer | R11 | `settings.prefix` | « Icône avant chaque annonce » : aucune aide, aucun exemple, champ qui attend un emoji. | M | S |
| M16 | discord-announcer | R13 | `liveText.help` | Exemple avec point d'exclamation (« Venez voir {title} sur {platform} ! ») ; aides de 22 à 24 mots. | M | S |
| M17 | discord-announcer | R25 | `youtubeLive.help` | « Demande le module Chaîne YouTube » sans lien ni état (installé ? connecté ?) ; la case reste cochable sans lui. | G | S |
| M18 | discord-announcer | R22, R9 | `errTest`, `resultFailed` | « Échec de l'envoi : {error} » et « échec ({status}) · {attempts} tentative(s) : {error} » : erreur brute du service, aucune marche à suivre (R23). | G | S |
| M19 | discord-announcer | R25 | `notConfigured` | « Renseignez-le dans l'onglet « Réglages » » : pas de lien direct vers le champ. | M | S |
| M20 | discord-announcer | R20 | `freshHours`, `liveCooldownHours`, `youtubeCheckMinutes` (avancés) | Unité entre parenthèses dans le libellé, bornes dites seulement pour une (5 à 60) ; aucune « valeur vide » affichée. | M | S |
| M21 | discord-announcer | R3, R24 | onglet Annonces | Bouton « Envoyer le test » correct (verbe précis) ; le journal de 50 lignes n'a ni filtre ni recherche (acceptable : ce n'est pas une liste que la personne remplit, à confirmer). | M | S |

### 2.3 Côté cœur : page « Réseaux sociaux » et chemin d'ajout

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| C1 | R2, R6, R8 | `social/actions.ts` `addNetwork` → redirection `/admin/instances/<id>` | Ajouter un réseau demande deux écrans : « + Ajouter » puis, sur la page de l'instance, le champ du profil et « Enregistrer », puis le retour à la liste. 4 clics et 1 champ par réseau. | B | L (parcours cible) |
| C2 | R19 (libellés tronqués), R16 | `social/page.tsx` grille « Ajouter un réseau » | Le champ « Nom (ex. Chaîne de Rascane) » est affiché sur chaque carte d'un réseau déjà installé et écrase le nom : « Ban », « Blue », « Disc »… à 1280 px ; à 390 px le nom passe seul sur une ligne mais le champ est tronqué (« Nom (ex. Chaîne de R »). Capture coeur-reseaux-1280. | B | S |
| C3 | R15, R19 | même grille | 23 cartes (21 réseaux + « Autres plateformes » + Twitch + YouTube) sans champ « Rechercher » ni groupes ni tri par réseaux courants (plus de 10 choix : recherche obligatoire). | G | S |
| C4 | R14, R30 | liste « Mes réseaux » + grille | Un réseau installé apparaît deux fois (liste et grille) ; la grille propose d'ajouter ce qui est déjà ajouté. Une liste de cartes de même schéma, sans colonnes. | G | M |
| C5 | R17, R16 | liste « Mes réseaux » | Aucun interrupteur « affiché / masqué » dans la ligne ; le seul bouton est « Régler » ; pour masquer un bouton, l'aide renvoie à « Apparence et réglages, onglet Apparence » (ambigu : masquer tout ou un seul ?). Aucun ordre modifiable : l'ordre des boutons est celui des instances, non réglable (`loadSocialLinks`). | G | M |
| C6 | R15 | liste « Mes réseaux » | Pas de recherche, présente-même-courte exigée. | M | S |
| C7 | R22, R23, R24 | `loadSocialLinks`, `MAX_SOCIALS = 10`, dédoublonnage par adresse | L'en-tête ne garde que 10 boutons et écarte les doublons sans le dire ; l'administration en montre 24. Aucun avertissement « 12 réseaux ajoutés, 10 affichés ». | G | S |
| C8 | R22 | `addInstance` (modules/actions.ts) appelé depuis `addNetwork` | Pour un 2ᵉ compte du même réseau, la page n'envoie pas `nickname_<id>` de l'instance existante : `checkNickname` renvoie « empty » et la personne est renvoyée vers la page du module avec une erreur. **Lu dans le code, non rejoué** (je n'ai pas créé de second compte dans la base d'essai). | G | S |
| C9 | R24 | `installFromCatalogue` dans `addNetwork` | L'installation télécharge du code depuis git au clic sur « Ajouter », sans dire que c'est une installation ni combien de temps (R23 : bouton « en cours » seulement). Réservée au propriétaire : un administrateur voit « Seule la personne propriétaire peut ajouter un réseau ». | M | S |
| C10 | R9, R13 | `social.nickname`, `social.noneHelp`… | « Chaîne de Rascane » : nom de personne ; « Régler » (verbe flou) sur chaque ligne ; « extension » n'est pas dit alors que c'est ce que fait « Ajouter » (R12). | M | S |
| C11 | R11, R26 | `SettingField` (types.ts) | Pas de clé `example` ou `placeholder` pour un réglage texte, donc aucun module ne peut afficher un exemple dans le champ : cause racine de G2. | G | S |
| C12 | R27 | page `/admin/social` à 390 px | 5954 px de haut ; adresses coupées avec « … » (acceptable, R16) ; cibles de 44 px respectées. | M | — |

## 3. Le défaut du gabarit et sa correction une fois pour toutes

### Où est le gabarit
Un squelette copié, pas un fichier partagé et pas le cœur : `modules/bandcamp/index.mjs` est la référence (33 lignes ; `NAME`, `ICON`, `TEMPLATE`, `HOSTS` changent) et se retrouve dans facebook, instagram, kick, kofi, patreon, pinterest, snapchat, soundcloud, spotify, steam, telegram, threads, tiktok, x-twitter. Bluesky, discord, github, mastodon, reddit : même `profile()` plus ~100 lignes de collecte de chiffres copiées. Un module d'extras ne peut pas importer le code d'un autre : la seule « maison commune » possible est le cœur ou le manifeste (données).

### Le défaut
Le gabarit pose **une seule saisie sans filet** : un texte libre qui doit être un pseudo OU une adresse https exacte du bon site, vérifié uniquement au moment de dessiner le bouton, par du code qui répond « rien » à tout ce qui s'écarte. Conséquences : (1) silence, donc la personne croit avoir réussi (G1) ; (2) aide vague avec un mot de programmeur (G2) ; (3) un module à installer par réseau pour ce qui est, en réalité, une table de données (hôtes, modèle d'adresse, icône).

### Correction en une fois (sans code ici)
1. **Données, pas code** : un bloc `social` dans `module.json` (hôtes acceptés, modèle d'adresse d'un pseudo, forme des pseudos, exemple d'adresse, icône, « avec chiffres » oui/non). Le cœur lit ce bloc dans le catalogue (`catalogue/index.json`, déjà généré par `scripts/build-index.mjs`) **avant** l'installation, et exporte lui-même `social.link` : les 15 modules simples n'ont plus de `index.mjs`.
2. **Un seul outil de reconnaissance dans le cœur** (`src/core/social.ts`) : accepte pseudo, `@pseudo`, `host/chemin` sans https, `www.`, adresses courtes (`fb.me`, `t.me`, `discord.gg`), `@nom@serveur` pour Mastodon ; retire les paramètres de suivi (`igsh`, `si`, `s`, `utm_*`, `fbclid`) ; renvoie toujours **la même forme** de bouton (« Instagram · monpseudo »).
3. **Validation visible** : sous le champ, une phrase avec l'exemple (« Cette adresse n'est pas celle d'Instagram. Par exemple : https://www.instagram.com/monpseudo ») et, après enregistrement, un aperçu du bouton (« Le bouton Instagram s'affichera : Instagram · monpseudo »).
4. **Un seul texte d'aide, écrit une fois** : libellé « Adresse de votre profil » ; aide courte « Collez le lien de votre page. » ; exemple dans le champ. Retirer « identifiant » et « sans @ » partout (R9).
5. **Les 5 modules avec chiffres** gardent leur collecte (code), mais passent par le même bloc `social` et le même cœur de reconnaissance ; la case « Suivre mes statistiques » devient « Afficher le nombre de followers » avec l'état de Statistiques de la communauté (R25).
6. Un test de conformité (dans `tests/`) qui échoue si un module `type: social` redéfinit `profile()` : plus de copie.

## 4. Parcours cible : « mes réseaux en un écran »

### État actuel (mesuré sur le site monté)
Pour six réseaux (Instagram, TikTok, Bluesky, Discord, X, Twitch) à partir de zéro, en tant que propriétaire : ouvrir « Réseaux sociaux » (1 clic) ; pour chaque réseau : repérer la carte parmi 23 sans recherche, clic « + Ajouter » (installation du module par le réseau, redirection), clic dans « Profil X », saisie, clic « Enregistrer », retour à la liste (1 clic) = 4 clics et 1 champ. **Total : 25 clics, 6 champs, 12 pages chargées.** Deuxième compte d'un même réseau : un champ « Nom » de plus et, d'après le code, un risque d'erreur (C8). R2 demande « au plus deux champs et un clic » pour la tâche la plus fréquente ; R6/R8 « une saisie suffit ».

### Cible : un seul écran `/admin/social`
1. **Phrase d'usage** (R1) : « Collez l'adresse de vos profils : chacun devient un bouton en haut de votre site. »
2. **Un seul champ** (zone de texte de deux lignes) : « Collez l'adresse de votre profil », exemple « https://www.instagram.com/monpseudo ». Accepte une ou plusieurs adresses (une par ligne, ou séparées par des espaces ; un copier-coller de la liste d'un site comme Linktree est reconnu). Un seul bouton principal : « Ajouter ».
3. **Reconnaissance en direct** sous le champ (aperçu avant d'appliquer, R24) : une pastille par adresse : icône + nom du réseau + pseudo + coche ; « déjà ajouté » ; « réseau non reconnu : choisissez-le » (liste avec recherche, R19) ou « Ajouter comme lien libre » (reprise du principe de « Autres plateformes »). Un simple pseudo sans site (« @monpseudo ») montre une rangée de réseaux à choisir (« De quel réseau s'agit-il ? »).
4. **Clic « Ajouter 6 réseaux »** : installation des extensions nécessaires avec progression visible (« Installation d'Instagram… 2 sur 6 », R23) ; aucune page intermédiaire ; en cas d'échec d'un réseau, les autres restent ajoutés et le message dit quoi faire.
5. **Un seul tableau « Mes réseaux »** (R30) : colonnes Réseau (icône + nom + pseudo), Adresse (coupée avec « … », complète en info-bulle), **Affiché** (interrupteur, R17), Nombre de followers (interrupteur, seulement pour les 5 réseaux qui savent), Origine (pastille colorée **et écrite** : « Réseau », « Autre plateforme », « Livestream »), Ordre (boutons Monter/Descendre au clavier, R28), « Modifier » et menu (Retirer, Déplacer). Recherche en direct et filtres « Tous · Affichés · Masqués » (R15). Un compteur « 6 sur 10 affichés » prévient quand la limite de l'en-tête est atteinte.
6. **Aperçu de l'en-tête** : les six icônes telles qu'elles seront vues, mises à jour en direct.
7. Second compte du même réseau : la même saisie ; le surnom est proposé par défaut (« Instagram 2 ») et modifiable dans « Modifier » (R7), jamais demandé d'office.

Résultat visé : **3 clics (ouvrir, coller, Ajouter) et 1 champ pour six réseaux**, ou 6 collages + Entrée si les adresses viennent d'endroits différents (toujours un champ, aucun changement de page).

### Ce que cela demande
**Au cœur** (`helldog136/Curiosa`) : (a) `recognizeSocial(texte)` pur et testé dans `src/core/social.ts`, qui lit une table d'hôtes issue du catalogue ; (b) une action de création par lot (installer si besoin, créer l'instance, écrire `profile`) en s'appuyant sur `installFromCatalogue` + `createInstance` existants ; (c) une clé `example` dans `SettingField` et un message d'erreur sous le champ pour les réglages d'adresse (aussi utile partout ailleurs) ; (d) la page tableau, interrupteur d'affichage, ordre, recherche, aperçu, compteur de la limite de 10 ; (e) `social.link` généré à partir du manifeste pour les modules sans code ; (f) le droit : l'installation reste réservée au propriétaire (`core:modules.install`) ; un administrateur sans ce droit peut coller une adresse **déjà installable**, la page lui dit qu'il faut demander à la personne propriétaire (état clair, pas un champ qui disparaît).
**Aux modules** (curiosa-extras) : un bloc `social` déclaratif dans `module.json` (hôtes, modèle, exemple, icône, chiffres) ; le champ « Profil » devient « Adresse de votre profil » ; suppression des `index.mjs` identiques (après mise à jour du cœur minimal, `minCore`) ; le catalogue (`scripts/build-index.mjs`) recopie ce bloc dans `catalogue/index.json` pour que la reconnaissance fonctionne **avant** l'installation ; les 5 modules à chiffres gardent leur code de collecte.
**Aux données existantes (migration)** : **aucune migration si l'on garde une instance par réseau** (option A) : la page lit les instances et leur réglage `profile` tels quels, l'ordre des boutons reste l'ordre des instances (à rendre réglable par un réglage de cœur, ajouté sans toucher aux instances). Les profils déjà saisis mais invalides (comme « demo » dans la base d'essai) sont listés avec « Adresse à corriger » et un champ en ligne. **Option B (une liste unique de liens, comme `platform-links` : une ligne par réseau)** : migration à écrire (une ligne par instance de réseau avec adresse valide ; `visible`, ordre = ordre des instances ; instances d'origine conservées désactivées jusqu'à vérification ; dédoublonnage des boutons pour éviter deux icônes) ; elle ferait aussi disparaître le doublon Ko-fi / Patreon avec `platform-links`. Recommandation : A d'abord, B seulement si le nombre de modules à installer reste jugé pesant.

## 5. Plan de correction en lots

| Lot | Contenu | Où | Jours-agent | Résultat |
|---|---|---|---|---|
| 1 | **Textes et tolérance du gabarit** : générer les 20 `profile()` et `module.json` depuis une seule table (script dans `scripts/`), libellé « Adresse de votre profil », aide courte avec exemple, suppression de « identifiant », adresses sans https, `www.`, `@nom@serveur`, `fb.me`, paramètres de suivi retirés, libellé de bouton unique ; `discord.invite` replié ; discord-announcer : champs repliés (R4/R7), mots R9/R11/R13, texte des erreurs ; test de conformité anti-copie ; versions et notes de version. | extras seulement | 2 | Les règles [auto] R9, R10, R11, R13 passent pour les 21 modules ; le silence recule (la plupart des collages réels marchent). |
| 2 | **Cœur : validation visible et exemple** : clé `example` dans `SettingField`, message sous le champ pour un réglage d'adresse, aperçu du bouton après « Enregistrer », avertissement des 10 boutons et des doublons ; correction du nom tronqué et du champ « Nom » sur la page Réseaux (C2, C3, C8) avec recherche dans la grille. | cœur | 2 | G1 corrigé pour de bon, C2/C3/C7/C8 résolus. |
| 3 | **Bloc `social` dans les manifestes et le catalogue** : le cœur lit les hôtes avant installation ; `recognizeSocial` ; modules sans code (15 `index.mjs` supprimés), 5 modules à chiffres sur le même cœur. | cœur + extras | 3 | Fin des copies ; reconnaissance disponible. |
| 4 | **Page « Réseaux sociaux » : champ unique, tableau, interrupteur, ordre, aperçu** (section 4, étapes 1 à 7), installation par lot avec progression. | cœur | 3 | Parcours cible en 3 clics et 1 champ. |
| 5 | **discord-announcer : assistant en trois étapes** (créer le webhook avec une phrase et une capture du chemin, coller, tester ; état de chaque étape ; test dans le même écran ; lien vers Chaîne YouTube avec état). | extras (+ lien du cœur) | 2 | R8/R25/R26 respectés pour le module le plus difficile. |
| 6 | **Décision et migration facultative** : fusionner Patreon/Ko-fi et « Autres plateformes » (option B, une liste unique) ; glossaire du dépôt (R12) ; case statistiques (G5/G8). | cœur + extras | 3 | Un seul chemin par plateforme. |

**Lot n° 1 recommandé : le lot 1** (2 jours, extras seulement, aucun risque pour le cœur, rend les règles [auto] vertes sur 21 modules et réduit déjà le silence). Il prépare le lot 3 : la table qui génère les 20 `profile()` est la même qui alimentera le bloc `social`. Si une seule chose devait se faire d'abord pour Emma, ce serait le lot 2 puis le 4 (le parcours), mais ils dépendent du cœur.

## 6. Ce que je n'ai pas pu vérifier

- **Les chiffres réels** (followers, membres) : le serveur d'essai n'a pas de réseau sortant ; on y voit seulement l'état « ne répond pas pour le moment » (capture discord-1280). Les messages d'erreur ont été jugés d'après `locales/fr.json`.
- **Le second compte d'un même réseau** (C8) : lu dans `addInstance`, pas rejoué.
- **Le mode avancé** (réglages « avancés » de discord-announcer) : jugé d'après `module.json`, non capturé.
- **Clair et sombre** : seule la capture claire a été faite (le thème automatique n'a pas été basculé) ; **l'état « erreur »** de la section 9 du document n'existe pas, puisque le formulaire n'en produit pas (c'est l'écart G1).
- **Le kit `admin.ergonomics`** n'existe pas dans le cœur `dev` (aucun fichier ne le contient) : les contrôles [auto] ont été refaits par mes scripts avec la liste de mots de R9 du document, pas avec le kit officiel.
- **R12** : il n'existe pas de glossaire dans le dépôt, la règle n'a pu être jugée que par comparaison entre modules.
- **R28 (clavier, lecteur d'écran)** : non testé au clavier ni au lecteur ; seuls les libellés visibles et la présence des bulles « ? » ont été regardés.
- **Droit d'un administrateur non propriétaire** : lu dans `social/page.tsx` (message « Seule la personne propriétaire… »), non essayé.
- **Le catalogue** utilisé par la page d'essai est celui de GitHub (même contenu que la branche) : les 23 cartes y sont toutes apparues, ce qui confirme C2 et C3.

# Audit d'ergonomie : modules « contenu du site »

Date : 1er novembre 2026. Dépôt `curiosa-extras`, branche `dev` (contenu de master 1.28.0 plus les docs). Référence : `docs/ERGONOMIE-ADMIN.md` (R1 à R30, lu en entier). Aucun code de module n'a été modifié.

Périmètre : blog, calendar-ical, calendar-manual, codes, collection, commissions, contact-form, contacts, content-planner, directory, events, faq, gallery, hero, legal-pages, links, map, pages, partnerships, planning, platform-links, press-kit, sponsors, supporters, testimonials, thanks-wall, videos (27 modules).

## Comment les chiffres ont été obtenus

- **Réglages** (R5, R9, R10, R11) : script qui lit chaque `module.json` (onglet, `advanced`, libellés et aides FR). « Simple » = réglage non avancé. Pour thanks-wall, les groupes optionnels repliables sont comptés à part.
- **Pages d'administration** (R4, R14 à R17, R30) : les `adminPanel` des modules ont été exécutés avec le faux contexte du cœur (`testsupport/fakeCtx.mjs`) et des données de test (34 rendez-vous, 60 lieux, 24 albums, 40 partenaires, 60 personnes, 80 soutiens). Les blocs obtenus ont été comptés par script : champs par formulaire, libellés, aides, boutons de ligne, présence d'une recherche. Les écrans vides de tous les modules ayant un `adminPanel` ont aussi été rendus.
- **Textes** (R9, R13, R29) : script sur `locales/fr.json` et `locales/en.json`. Pour R9, seules les clés utilisées par les fichiers d'administration sont retenues.
- **Captures** : 6 modules (events, map, gallery, partnerships, directory, supporters), à 1280 px et 390 px. Ce sont des maquettes HTML construites à partir des blocs réellement rendus, pas des pages du vrai cœur (voir la section 5). Elles sont dans `/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/audit-m2/` (`capture-<module>-1280.png` et `capture-<module>-390.png`). Les scripts de mesure sont dans `audit-m2/tools/`.

## Constat d'ensemble

1. **Aucune liste d'administration du groupe n'a de recherche en direct (R15).** Toutes les recherches sont un champ plus un bouton « Chercher » avec rechargement de la page. Neuf modules en ont une (contacts, content-planner, directory, events, map, supporters, testimonials, thanks-wall, videos), et six la cachent sous un seuil : events et map (plus de 8 éléments), content-planner (8 idées), directory, videos et thanks-wall (plus de 25 lignes). La règle demande une recherche dès le départ. Cinq modules n'ont aucune recherche sur une liste qui grandit : faq, gallery (albums et photos), commissions (demandes), partnerships, calendar-manual.
2. **Le bloc `table` du cœur ne peut pas faire ce que R15, R16, R17 et R30 demandent.** Il n'a ni recherche, ni interrupteur, ni menu de ligne, ni pastille colorée, et sa cellule d'actions est en `white-space: nowrap` (`Blocks.tsx`). Chaque module contourne comme il peut. Un module ne peut pas respecter R15 seul.
3. **Les réglages sont souvent trop nombreux.** Plus de 7 réglages simples : directory (15), map (12), gallery (10), supporters (10), hero (9), events (8), testimonials (8), videos (8), et thanks-wall (17 déclarés, 7 visibles par défaut). faq est exactement à 7.
4. **Les aides sont presque toutes trop longues.** 123 aides de réglages sur 152 dépassent 60 caractères (R11), dans 19 des 21 modules qui ont des réglages. Les formulaires ont aussi des aides de 100 à 260 caractères.
5. **Points solides** : FR et EN sont à parité exacte dans les 19 modules ayant des textes (aucune clé ou variable manquante, R29). Les suppressions sont confirmées. Les états vides disent quoi faire (R18). Les formulaires « chemin court » de contacts (3 champs) et de content-planner (1 champ) sont de bons modèles. Aucun libellé de réglage ne finit par « : ».

## 1. Un module par ligne

Note « praticable par Emma » : 5 = rien à redire, 1 = impraticable. « Réglages » = simples (avancés) sur l'onglet de réglages du module. « — » = module sans réglages ou piloté par le cœur.

| Module | Note | Réglages | Top 3 des défauts | Règles violées |
|---|---|---|---|---|
| blog | 4 (non vérifié : éditeur du cœur) | — | Aucun réglage. Liste d'entrées et recherche dans le cœur, non auditables ici. | R15 (à vérifier) |
| calendar-ical | 3 | 1 (2) | 1. Il faut copier une adresse secrète d'agenda Google : configuration externe obligatoire, sans assistant d'étapes. 2. Aide de 260 caractères sur cette adresse. 3. Fichier SKILL.md tutoyant et fautif (« Tu rempli »). | R8, R11, R13 |
| calendar-manual | 2 | 0 (1) | 1. Un formulaire de 10 champs visibles. 2. « Toute la journée » et « Annulé » sont des listes oui/non, les heures sont des champs texte. 3. Tous les streams, passés compris, dans un seul tableau sans recherche. | R4, R19, R21, R6, R15, R7 |
| codes | 4 (non vérifié) | — | Liste et éditeur dans le cœur. | R15 (à vérifier) |
| collection | 4 (non vérifié) | — | Liste et éditeur dans le cœur. | R15 (à vérifier) |
| commissions | 3 | 6 (2) | 1. 6 aides de réglage et 3 aides de formulaire de plus de 60 caractères (jusqu'à 263). 2. L'état des commandes est un tableau de 3 lignes avec un bouton « Choisir » : c'est un choix à 3 valeurs. 3. La liste des demandes n'a pas de recherche. | R11, R19, R15, R3 |
| contact-form | 3 | 2 | 1. Le libellé « Slug d'une page… (facultatif) » fait 71 caractères et contient « slug ». 2. Le nom d'une page se tape à la main au lieu de se choisir. 3. Aide de 141 caractères. | R9, R10, R19, R25, R11 |
| contacts | 4 | — | 1. La recherche est présente dès le départ, mais avec bouton et rechargement. 2. L'ajout manuel a 10 champs plus une case par catégorie. 3. « services » dans deux messages de photo. | R15, R4, R9 |
| content-planner | 4 | 3 (1) | 1. La recherche n'apparaît qu'à partir de 8 idées, avec bouton. 2. « Déplacer ici » : 4 lignes de tableau pour changer l'étape d'une idée. 3. Aide de 185 caractères sur « Étapes ». | R15, R19, R11 |
| directory | 2 | 15 (5) | 1. 15 réglages simples, avec des mots de Contacts non expliqués (« Catégorie « a accepté d'apparaître » »). 2. Un panneau qui mélange six tâches. 3. 15 aides de plus de 60 caractères (jusqu'à 248). | R5, R1, R11, R9, R15, R14 |
| events | 2 | 8 (2) | 1. Quatre boutons par ligne (« Modifier », « Publier / retirer », « Dupliquer », « Supprimer »). 2. Le formulaire d'ajout a 6 champs. 3. Recherche cachée sous 9 rendez-vous, avec bouton. | R16, R17, R2, R4, R15, R5, R27 |
| faq | 3 | 7 (3) | 1. Aucune recherche, aucune pagination sur les questions publiées. 2. L'ordre se règle avec « Monter / Descendre ». 3. 8 aides de plus de 60 caractères (jusqu'à 174). | R15, R16, R11 |
| gallery | 2 | 10 (10) | 1. 20 réglages dont 10 simples, 15 aides de plus de 60 caractères. 2. Aucune recherche sur les albums (jusqu'à 500) ni sur les photos. 3. « Masquer / Afficher » en bouton ; 3 boutons de déplacement par photo. | R5, R15, R17, R16, R9, R10 |
| hero | 3 | 9 | 1. 9 réglages simples. 2. Aide de 119 caractères sur la vidéo. 3. Champs libres sans exemple (« Texte du bouton », « Petite ligne »). | R5, R11 |
| legal-pages | 4 | 1 (1) | 1. Aide de 91 caractères sur « Liens en bas de chaque page ». 2. Bouton « Commencer » peu précis. 3. Assistant de 6 à 8 questions : bon principe. | R11, R3 |
| links | 4 (non vérifié) | — | Liste et éditeur dans le cœur. | R15 (à vérifier) |
| map | 2 | 12 (1) | 1. Formulaire « Ajouter un lieu » à 10 champs. 2. Les lieux (jusqu'à 5000) se réordonnent avec ↑ et ↓, un cran à la fois. 3. Latitude et longitude en champs texte séparés. | R4, R16, R6, R5, R11 |
| pages | 4 (non vérifié) | — | Liste et éditeur dans le cœur. | R15 (à vérifier) |
| partnerships | 2 | 0 (1) | 1. Formulaire « Nouveau partenariat » à 13 champs, toujours ouvert, dont 8 sans aide ni exemple. 2. Aucune recherche. 3. Import CSV dans un grand champ de texte permanent. | R4, R7, R15, R11 |
| planning | 3 | 5 (13) | 1. 18 réglages dont 13 avancés, 7 apparences. 2. 5 libellés avancés avec deux-points (« Timeline : montrer… »). 3. Messages sur « la clé RAWG ». | R5, R10, R9 |
| platform-links | 3 | 3 (3) | 1. Aide de 336 caractères sur l'avertissement adulte. 2. « Prévenir avant d'ouvrir » est une liste à 3 choix. 3. « utm_campaign » dans un libellé avancé. | R11, R19, R9 |
| press-kit | 5 | 0 (2) | Rien de notable. | — |
| sponsors | 4 | 1 | 1. « Mention de partenariat » : champ libre sans exemple, aide de 124 caractères. 2. Liste et éditeur dans le cœur (non vérifié). | R11, R15 (à vérifier) |
| supporters | 2 | 10 (5) | 1. Connexion Patreon en 5 étapes manuelles (copier une « clé secrète » dans un autre onglet). 2. « Caché : pas d'accord donné » et « Actif » répétés sur chaque ligne. 3. Mot « clé » dans 4 textes visibles. | R8, R14, R9, R5, R15 |
| testimonials | 3 | 8 (7) | 1. Quatre boutons par avis à valider (« Publier », « Refuser », « Modifier », « Supprimer »). 2. Recherche avec bouton. 3. 9 aides de plus de 60 caractères (jusqu'à 260). | R16, R15, R11, R5 |
| thanks-wall | 3 | 17 déclarés, 7 par défaut | 1. 17 réglages : jusqu'à 6 groupes, chacun avec une catégorie et un titre. 2. « Catégorie « Ne pas montrer » » : formulation négative. 3. Aides de 216 et 256 caractères. | R5, R30, R19, R11 |
| videos | 3 | 8 (2) | 1. 5 champs de vocabulaire (« Nom de la page (pluriel) », « Le même mot au singulier »…). 2. Recherche cachée sous 26 vidéos, avec bouton. 3. 4 boutons par catégorie et par série. | R5, R15, R16, R7 |

## 2. Liste complète des écarts

Légende : B = Bloquant pour Emma, G = Gênant, M = Mineur. Effort : S < 1 h, M < 1 jour, L plus. Les références `fichier:ligne` sont celles de `modules/<id>/` sur la branche `dev`.

### Écarts transversaux (kit ou cœur)

| Règle | Endroit | Gravité | Effort | Constat |
|---|---|---|---|---|
| R15 | bloc `table` du cœur | B | L | Aucun moyen de déclarer une recherche en direct. |
| R17 | bloc `table` du cœur | B | M | Pas d'interrupteur d'état dans une ligne. |
| R16, R27 | `rowActions` du cœur | G | M | Au-delà de 2 actions, la ligne déborde à 390 px (défilement horizontal du tableau). |
| R30 | cœur | G | M | Aucune pastille colorée dans une cellule, aucune colonne d'origine. |
| R6, R21 | `adminForm.kind` | G | M | Pas de type pour une plage d'heures, une période récurrente, des coordonnées. |
| R19 | `adminForm.kind` | G | S | Pas de type interrupteur ni boutons segmentés : les modules emploient une liste oui/non ou un tableau de boutons. |

### Par module

**calendar-ical**
- R8, G, L : adresse secrète d'agenda à copier depuis Google (réglage `url`, type `secret`). Le module a un tutoriel, mais pas d'assistant avec l'état de chaque étape.
- R11, M, S : aides longues sur `url` (260), `timezone` (147, avancé), `cacheMinutes` (68, avancé).
- R13, M, S : le fichier SKILL.md (clé `skillBody`) tutoie et contient une faute (« Tu rempli ») ; exemple avec « ! » (`tutoExNoGameDesc`).

**calendar-manual**
- R4, G, M : formulaire « Ajouter un stream » à 10 champs visibles (`index.mjs:51-68`).
- R19, G, S : « Toute la journée » et « Annulé » sont des listes oui/non (`yesNo`) au lieu de cases.
- R21, R6, G, M : « Heure de début » et « Heure de fin » sont des champs texte libres ; « Répétition », « Répéter jusqu'au » et « Dates à sauter » forment une période en 3 champs.
- R7, G, S : « Répéter jusqu'au » et « Dates à sauter » sont des options rares affichées en permanence.
- R15, G, M : la liste (tous les streams, passés compris, `index.mjs:83`) n'a ni recherche ni séparation à venir / passés.
- R11, M, S : 5 aides de plus de 60 caractères (jusqu'à 146).
- R3, M, S : bouton principal « Enregistrer ».

**commissions**
- R11, G, S : 6 aides de réglage de plus de 60 caractères (`clientMails` 263, `keepMonths` 185, `notify` 176…) et 3 aides de formulaire.
- R11, M, S : « Titre de la page » et « Texte de présentation » sans exemple.
- R19, G, M : l'état des commandes est un tableau de 3 lignes avec un bouton « Choisir » (`admin.mjs:45`) ; ce sont 3 boutons segmentés.
- R15, G, M : la liste « Vos demandes » a des filtres par état mais pas de recherche, et peut grandir.
- R3, M, S : suppression d'une formule présentée par un faux tableau à une ligne (`admin.mjs:165`).

**contact-form**
- R9, G, S : libellé « Slug d'une page qui affiche le formulaire… » (mot interdit).
- R10, G, S : libellé de 71 caractères avec « (facultatif) ».
- R19, R25, G, M : nom de page à taper à la main ; devrait être un choix parmi les pages.
- R11, M, S : aides de 68 et 141 caractères.
- R13, M, S : message d'envoi avec « ! » (côté public).

**contacts**
- R15, G, M : recherche présente dès le départ, mais avec bouton et rechargement (`ui.mjs:101`).
- R4, G, M : formulaire d'ajout manuel : nom, rôle, organisation, e-mail, téléphone, relation, 2 × (réseau + pseudo), puis une case par catégorie et « Nouvelle catégorie » (`admin.mjs:205-230`). Le chemin court (3 champs) est bon.
- R9, M, S : « services » et « service » dans `photoMissing` et `photoFail`.
- R16, M, S : plusieurs tableaux d'une ligne pour porter un seul bouton (catégorie, note, compte : `admin.mjs:132,163,175,292`).

**content-planner**
- R15, G, M : la recherche apparaît à partir de 8 idées, avec bouton (`admin.mjs:62`).
- R19, M, M : « Déplacer ici » : 4 lignes de tableau avec un bouton chacune (`admin.mjs:97`).
- R11, M, S : aides de 185 (`stepModel`) et 114 caractères (`rhythmCount`).
- R3, M, S : bouton « J'ai une idée ! » (avec « ! »).

**directory**
- R5, B, M : 15 réglages simples (limite 7). Regroupables : les 3 catégories de Contacts, les 3 réglages du bouton « Proposer ma fiche », les 2 mots singulier / pluriel.
- R9, G, S : « Catégorie « Ne pas montrer » », « a accepté d'apparaître », « accepte d'être sur la carte » : mots de Contacts non expliqués ; « service » dans `errCityDown`.
- R11, G, S : 15 aides de plus de 60 caractères (`hide` 248, `mapConsent` 221).
- R1, G, L : un seul panneau pour six tâches (catégories publiques, équipe, personnes visibles, masquées, remise en ordre).
- R15, G, M : la recherche des personnes n'apparaît qu'au-delà de 25 personnes, avec bouton (`admin.mjs:292`).
- R14, G, S : chaque ligne répète la catégorie (« Bénévole 001 · Bénévoles ») et « Contacts : Membres ».
- R7, M, M : « Titre de la section équipe » et le groupe « Proposer ma fiche » sont des options rares affichées.
- R13, M, S : exemple « Présidente » (genre).
- R11, M, S : champs libres sans exemple (`intro`, `proposeLabel`).

**events**
- R16, G, M : 4 boutons par ligne de rendez-vous (`admin.mjs:234`).
- R17, G, S : bouton « Publier / retirer » (état non lisible).
- R2, R4, G, M : formulaire d'ajout à 6 champs ; le chemin court devrait en avoir 2 (titre, date).
- R15, G, M : recherche seulement au-delà de 8 rendez-vous, avec bouton (`admin.mjs:228`) ; filtre par état présent (bien).
- R5, G, M : 8 réglages simples, dont 3 de vocabulaire (`wordOne`, `wordMany`, `pastTitle`).
- R11, G, S : 8 aides de réglage de plus de 60 caractères (`timezone` 157) ; 4 aides de formulaire.
- R10, M, S : libellé de 61 caractères (« Montrer « Voir sur la carte »… »).
- R14, M, S : colonne « Type » à « — » sur toutes les lignes sans type.
- R19, M, S : « Fuseau horaire du site » est une liste de 44 valeurs, sans recherche.
- R27, G, M : à 390 px, les 4 boutons forcent un défilement horizontal du tableau.
- R3, M, S : bouton « Lancer » pour l'import.

**faq**
- R15, G, M : aucune recherche, aucune pagination sur les questions publiées ; seul le regroupement par thème aide (`admin.mjs:158-170`).
- R16, G, M : « Monter / Descendre » pour l'ordre (`admin.mjs:102`).
- R11, G, S : 8 aides de plus de 60 caractères (`fallback` 173, `notify` 174).
- R14, M, S : chaque ligne répète « FR · EN · 0 oui / 0 non ».
- R30, M, M : brouillons et publiées dans des tableaux séparés au lieu d'un tableau avec filtre.

**gallery**
- R5, G, M : 10 réglages simples.
- R15, G, M : pas de recherche sur 500 albums possibles ni sur 300 photos par album.
- R17, G, S : bouton « Masquer / Afficher » par photo (`admin.mjs:271`).
- R16, G, M : 3 boutons de déplacement par photo (`admin.mjs:237`) ; 2 boutons par album.
- R9, M, S : « autre service » dans 11 textes (il s'agit d'un autre site d'hébergement de photos) ; à reformuler.
- R10, M, S : libellés avec précision entre parenthèses (« Poids visé d'une photo envoyée (Ko, 4 000 au plus) », avancé).
- R11, G, S : 15 aides de plus de 60 caractères (`allowedHosts` 246).
- R14, M, S : « Brouillon · Aucune photo » répété sur chaque ligne d'album.
- R13, M, S : « Revenez bientôt ! » (côté public).

**hero**
- R5, G, S : 9 réglages simples ; la vidéo et le bouton sont déjà dans des groupes optionnels (bien), mais le reste dépasse 7.
- R11, M, S : aide de 119 caractères sur la vidéo ; « Texte du bouton » et « Petite ligne » sans exemple.

**legal-pages**
- R11, M, S : aide de 91 caractères (`footerLinks`).
- R3, M, S : « Commencer » : verbe peu précis.

**map**
- R4, B, M : « Ajouter un lieu » : 10 champs visibles.
- R6, G, M : latitude, longitude et lien de carte : 3 champs pour une notion.
- R16, G, M : réordonner jusqu'à 5000 lieux avec ↑ ↓ ; 3 boutons par ligne (`admin.mjs:94`).
- R5, G, M : 12 réglages simples.
- R11, G, S : 9 aides de plus de 60 caractères (`showExternal` 162, `showMap` 148) ; aide de 260 caractères sur le lien de carte.
- R15, G, M : filtre (mot, état, type) seulement au-delà de 8 lieux, avec bouton (`admin.mjs:70`).
- R7, G, M : « Description », « Horaires », « Site web » : options rares permanentes.
- R30, M, M : lieux venant d'autres modules : tableau séparé avec bouton « Masquer » ; devrait être une colonne « Source ».

**partnerships**
- R4, B, M : « Nouveau partenariat » : 13 champs visibles.
- R7, G, S : 8 champs sans aide ni exemple (Marque, Secteur, Pays, Leurs produits, Ce que ça nous apporte, Brief et notes, Brouillon de mail, Source).
- R15, G, M : aucune recherche sur la liste (`admin.mjs:76`).
- R11, M, S : import CSV : un grand champ de texte permanent.
- R28, M, S : « ⏰ » ajouté au statut sans texte.
- R10, M, S : libellé « Comment joindre la marque (standard, formulaire…) » avec précision entre parenthèses.

**planning**
- R5, M, S : 5 réglages simples seulement, mais 13 avancés et 7 apparences.
- R10, M, S : 5 libellés avec « : » (« Liste classique : masquer les jours sans stream »…), tous avancés.
- R9, G, S : « clé RAWG » dans 3 messages visibles (`coversNoKey`, `coversDenied`, `coversNoKeyNoModule`).
- R25, M, M : renvoi vers le module Jaquettes sous forme de texte, sans état de l'autre côté.
- R11, G, S : `appearance` 202 caractères, `channelUrl` 134.

**platform-links**
- R11, G, S : `warnAdult` 336 caractères, `originEnabled` 300 (avancé).
- R19, M, S : « Prévenir avant d'ouvrir » : liste à 3 choix.
- R9, M, S : « utm_campaign » dans un libellé avancé.

**sponsors**
- R11, M, S : « Mention de partenariat » sans exemple ; aide de 124 caractères.

**supporters**
- R8, B, L : connexion à Patreon en 5 étapes manuelles, avec copie d'une « clé secrète » (`accessToken`) dans un autre onglet.
- R9, G, S : « clé » dans `needToken`, `tokenSaved`, `tokenMissing` et dans le libellé « Clé secrète de la plateforme » ; « instance » dans l'aide de `provider`.
- R14, G, S : « Caché : pas d'accord donné » et « Actif » sur chaque ligne (valeurs par défaut).
- R5, G, M : 10 réglages simples.
- R15, G, M : recherche avec bouton « Chercher », pagination 25 (`admin.mjs:112`).
- R11, G, S : 12 aides de plus de 60 caractères.
- R10, M, S : libellé avancé de 64 caractères (`activeDays`).

**testimonials**
- R16, G, M : 4 boutons par avis à valider (`admin.mjs:88`).
- R17, G, S : « Publier » / « Retirer » en boutons-verbes.
- R15, G, M : « Chercher » avec bouton ; filtres par état et par note présents (bien).
- R11, G, S : 9 aides de plus de 60 caractères (`structuredData` 260).
- R5, M, S : 8 réglages simples.

**thanks-wall**
- R5, G, M : 17 réglages déclarés (7 visibles par défaut avec les groupes repliés) ; dès qu'on ajoute des groupes, on dépasse le budget.
- R30, G, M : 6 groupes de même schéma (catégorie + titre) alors qu'un tableau « Groupes » avec « Ajouter un groupe » suffirait.
- R19, M, S : « Catégorie « Ne pas montrer » » (formulation négative).
- R11, G, S : 7 aides de plus de 60 caractères (216 et 256 pour `category` et `hide`) ; « Titre du … groupe » sans exemple (5 champs).
- R15, M, M : recherche des messages seulement au-delà de 25 lignes, avec bouton.

**videos**
- R5, G, M : 8 réglages simples dont 5 de vocabulaire (`vocabPlural`, `vocabOne`, `vocabSeries`, `vocabSeriesOne`, `vocabFree`).
- R15, G, M : recherche seulement au-delà de 25 vidéos, avec bouton (`admin.mjs:89`).
- R16, G, M : 4 boutons par catégorie (Monter, Descendre, Renommer, Supprimer) et par série (`admin.mjs:209,220`).
- R11, G, S : 9 aides de plus de 60 caractères (`vocabPlural` 117, `thumbs` 173).

**blog, codes, collection, links, pages**
- Aucun réglage. Écarts éventuels (recherche R15, boutons de ligne R16 et R17) à vérifier dans le cœur.

**press-kit** : aucun écart notable.

## 3. Motifs répétés à transformer en composant ou en règle du kit

| Motif | Modules concernés | Proposition |
|---|---|---|
| Recherche à bouton, avec rechargement (R15) | 9 : contacts, content-planner, directory, events, map, supporters, testimonials, thanks-wall, videos | Option du bloc `table` : `searchable`, en direct, sans accent. |
| Liste qui grandit sans aucune recherche | 5 : faq, gallery, commissions, partnerships, calendar-manual | Même composant. |
| Recherche cachée sous un seuil | 6 : events, map, content-planner, directory, videos, thanks-wall | Règle du kit : jamais de seuil. |
| Faux tableau à une ligne pour porter un seul bouton | 11 : commissions, contacts, content-planner, events, faq, gallery, legal-pages, map, partnerships, supporters, videos | Bloc `action` ou `dangerZone` (titre, texte de ce qui est perdu, bouton). |
| Plus de 2 boutons par ligne, avec Monter / Descendre | 6 : events, testimonials, videos, map, gallery, faq | Menu de ligne, « Modifier » fixe ; ordre par « Déplacer à la position… » ou glisser-déposer avec alternative clavier. |
| Bouton-verbe « Publier / retirer », « Masquer / Afficher » (R17) | 4 : events, gallery, testimonials, videos | Interrupteur d'état dans la ligne. |
| Même étiquette sur chaque ligne (R14) | 5 : supporters, directory, gallery, faq, events | Règle de test : une colonne ou étiquette identique partout est signalée. |
| Plusieurs listes de même schéma (R30) | 4 : thanks-wall (groupes), faq (brouillons et publiées), map (lieux d'autres modules), videos (catégories et séries) | Tableau unique avec colonne d'origine (pastille colorée et écrite) et filtres rapides. |
| Aides de plus de 60 caractères | 19 modules sur 21 qui ont des réglages (123 aides sur 152) | Règle R11 déjà prévue ; passer le surplus dans la bulle « ? ». |
| Vocabulaire singulier / pluriel | 4 : directory, events, map, videos | Un contrôle `vocabulary` : un mot, le pluriel se déduit (avancé pour le corriger). |
| Titre de page et texte d'introduction | 10 : commissions, directory, events, faq, gallery, map, supporters, testimonials, thanks-wall, videos | Bloc commun en tête de l'onglet, avec exemple fourni. |
| E-mail de notification | 5 : commissions, contact-form, faq, gallery, testimonials | Réglage standard, aide d'une ligne, lien vers l'état du serveur d'e-mail (R25). |
| Aide aux moteurs de recherche | 5 : directory, faq, gallery, testimonials, videos | Un seul réglage du site, pas un par module. |
| Durée de garde et limites par heure | 5 et 4 : commissions, faq, gallery, supporters, testimonials | « Plus d'options » avec valeurs par défaut (R7, R20). |
| Choix d'une catégorie de Contacts | 4 : directory, gallery, supporters, thanks-wall | Composant unique avec recherche et état de l'autre côté (R25). |
| Fuseau horaire | 4 : calendar-ical, calendar-manual, events, planning | Un réglage du site, repris par les modules. |
| Formulaire de plus de 5 champs sans repli | 5 : calendar-manual (10), map (10), partnerships (13), events (6), contacts manuel (10 et plus) | `adminForm` avec section « Plus d'options » repliée (R7). |
| Heures, périodes, coordonnées en plusieurs champs | 3 : calendar-manual, events, map | Contrôles `timeRange`, `recurrence`, `coordinates` (R6, R21). |
| Import CSV dans un champ de texte | 4 : events, map, partnerships, supporters | Bloc `import` commun (fichier, aperçu, rapport). |
| Mot « clé » ou « service » dans les textes visibles | 6 : supporters, planning, gallery, contacts, directory, videos | Ajouter « clé » et « service » aux mots surveillés du test, avec exceptions justifiées. |
| Listes et éditeurs du cœur pour les modules de contenu | 6 : blog, codes, collection, links, pages, sponsors | Corriger une fois dans le cœur. |

## 4. Plan de correction ordonné

Chaque lot est indépendant, de 1 à 3 jours d'agent, classé par impact pour Emma divisé par l'effort. Les lots 1 à 3 touchent le kit (cœur).

1. **Lot 1 : tableau d'administration utilisable (cœur, 3 jours).** Étendre le bloc `table` : `searchable` (recherche en direct, sans seuil), interrupteur d'état dans la ligne, pastille colorée, menu de ligne, pagination à 50. Documenter dans `ERGONOMIE-ADMIN.md`. Débloque R15, R16, R17 et R30 pour une vingtaine de modules, et peut aussi servir les listes de blog, links et pages.
2. **Lot 2 : migrer les listes du groupe (2 à 3 jours).** events, testimonials, faq, gallery, map, videos, directory, supporters, partnerships, commissions, calendar-manual : recherche en direct, interrupteur à la place de Publier / Masquer, « Modifier » plus un menu, « Déplacer à… » à la place de Monter / Descendre.
3. **Lot 3 : blocs `action` et `dangerZone` (1 jour).** Remplacer les faux tableaux à une ligne (11 modules) et fixer la règle de confirmation (R3, R24).
4. **Lot 4 : formulaires trop longs (2 jours).** map (10 champs), partnerships (13), calendar-manual (10), events (6) : chemin court de 2 champs, le reste dans « Plus d'options » ; contrôles `timeRange` et `coordinates` ; cases à la place des listes oui/non.
5. **Lot 5 : réglages (2 jours).** directory (15 vers 7), map (12), gallery (10), supporters (10), hero (9), events, testimonials, videos : valeurs par défaut, regroupement (vocabulaire, titre et introduction, notifications), passage en avancé. thanks-wall : tableau de groupes.
6. **Lot 6 : textes (1 jour).** Raccourcir les 123 aides de plus de 60 caractères (ou les passer en bulle « ? »), ajouter des exemples aux champs libres, remplacer « clé », « slug », « service », « instance », « utm_campaign » ; reformuler les cases négatives ; corriger le fichier SKILL.md de calendar-ical.
7. **Lot 7 : assistants de connexion (2 à 3 jours).** supporters (Patreon en 3 étapes, avec état), calendar-ical (adresse d'agenda), contact-form (choix de la page).
8. **Lot 8 : composants communs de réglages (2 jours).** Titre et introduction, vocabulaire, e-mail de notification, aide aux moteurs de recherche, fuseau horaire, choix de catégorie de Contacts : un composant du kit chacun, repris module par module.
9. **Lot 9 : audit dans le cœur (1 jour).** Éditeurs et listes de blog, codes, collection, links, pages, sponsors.

## 5. Ce qui n'a pas pu être vérifié

- **Éditeurs et listes de blog, codes, collection, links, pages, sponsors** : fournis par le cœur (`content` dans `module.json`). Leur recherche, leurs boutons de ligne et leurs formulaires ne sont pas dans ce dépôt. Les notes 4 sont une hypothèse.
- **Rendu réel** : les captures sont des maquettes HTML fabriquées à partir des blocs rendus par les modules (faux contexte), avec une mise en forme proche de celle du cœur, pas des pages du vrai site. Elles montrent la structure (nombre de champs, de boutons, absence de recherche), pas les marges, couleurs ni le focus. À 390 px, plusieurs maquettes débordent plus que le vrai cœur, dont le tableau défile sur place : ne pas juger le débordement sur ces images seules. Je n'ai pas pu utiliser Playwright (non installé) ; Chromium a été lancé directement.
- **Mode sombre** : non capturé. Le test `admin.ergonomics` n'existe pas dans ce dépôt : seules les règles écrites ont été appliquées, avec mes scripts.
- **Écrans non rendus avec données** : contacts (fiche, import, doublons), content-planner (fiche d'idée), legal-pages (assistant), planning (aperçu), platform-links, thanks-wall (listes), calendar-ical. Pour eux, les écarts viennent des réglages, des textes et de la lecture du code.
- **Erreurs (R22)** : non rendues une par une.
- **Mode avancé et droits** : les écrans ont été rendus avec tous les droits.
- **Contacts** : directory, thanks-wall et supporters ont été testés avec le double `fakeContactBook`, pas avec le vrai service.
- **R12 (glossaire), R23 (retour d'action), R26 (premier usage), R28 (clavier, contraste)** : non mesurés.
- **Faux positifs R9** : « cache » (verbe « cacher ») dans directory, « service » au sens commercial dans testimonials et legal-pages, `{service}` (nom d'une plateforme) dans videos.
- **Gravités et notes** : elles sont mon jugement ; les nombres (champs, réglages, aides, boutons) sont mesurés.

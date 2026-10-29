# Contacts

Votre carnet d'adresses **privé** : les **personnes** et les **organisations** avec qui vous travaillez, leurs **comptes** sur les réseaux (Twitch, YouTube, TikTok, Instagram, Discord, X, Bluesky, Mastodon, site web…), des **catégories**, des **notes** et une **photo**. Rien n'est public.

**Une personne n'existe qu'une fois, ici.** Les autres modules (Partenariats, Raid, Story…) ne font que s'y référer : quand vous corrigez un nom ou une photo dans Contacts, tout le site suit.

## Pour commencer
1. Ouvrez **Contacts** dans l'administration.
2. **+ Ajouter une personne** : le nom suffit. Enregistrez.
3. Sur la fiche, **Ajouter un compte** : choisissez le réseau, puis **collez le lien du profil** (par exemple `twitch.tv/nom`) **ou tapez le pseudo** (`@nom`). Le site comprend les deux. En cas d'erreur, le message est juste sous le champ et dit quoi faire (« Ce lien est un lien YouTube : choisissez « YouTube » dans la liste Réseau. »).

## Ce que vous pouvez faire
- **Chercher** en haut de la liste : nom, pseudo, organisation, sans vous soucier des accents ni des majuscules. Les **filtres** (catégorie, réseau, « À vérifier ») se cliquent ; **Voir la suite** affiche les fiches suivantes.
- **Organisations** : une personne appartient à une organisation, avec sa fonction. Tapez simplement le nom de l'organisation sur la fiche : elle est créée si elle n'existe pas encore. La fiche d'une organisation montre ses personnes.
- **Catégories** (par exemple « Cible de raid ») : une fiche peut en avoir plusieurs. Page **Catégories** : créer, renommer, **Mettre dans…** (réunir deux catégories), supprimer. **Supprimer une catégorie ne supprime aucune fiche.**
- **Photo** : automatiquement celle du compte qui a le plus de followers (la fiche dit d'où elle vient, par exemple « Photo YouTube (12 400 followers) »), ou une image que vous choisissez (téléversée depuis votre appareil). **Revenir à la photo automatique** annule votre choix. La photo et les followers se mettent à jour **quand vous ouvrez une fiche** (si elle date de plus de 24 h) ou quand vous cliquez **Actualiser la photo** : jamais en arrière-plan. Twitch et YouTube demandent d'installer leur connecteur (la fiche le propose, un service à la fois) ; Bluesky marche tout seul. Twitch ne donne pas le nombre de followers d'une autre chaîne : il n'entre pas dans le calcul « la plus grosse communauté ».
- **Ajouter une fiche à une catégorie** : sur la fiche, section **Catégories**, la liste avec **Retirer**, puis un choix et le bouton **Ajouter à la catégorie** (aucune case à cocher parmi des centaines).
- **Notes** datées sur chaque fiche.
- **Messages du formulaire de contact** : ils arrivent comme fiches **« À vérifier »** (le message est la première note). Vérifiez la personne puis cliquez **C'est vérifié**.
- **Supprimer une fiche** : définitif, avec confirmation. Les modules qui la citaient sont prévenus ; si l'un d'eux ne répond pas, le message le dit.

## Importer, exporter, réunir les doublons, effacer une personne
La page du module s'ouvre sur l'onglet **Mes contacts**, avec cinq sections : Contacts, Organisations, Catégories, **Doublons**, **Importer / exporter**.

### Importer (tableur CSV)
- **Collez** vos lignes ou **choisissez un fichier** (5 Mo au plus, 100 000 lignes au plus). La première ligne nomme les colonnes : `nom`, `type`, `fonction`, `organisation`, `e-mail`, `téléphone`, `comptes`, `catégories`, `notes` (ou leurs noms anglais ; les autres colonnes sont ignorées). **Seul le nom est obligatoire** (sans nom, le pseudo du premier compte en tient lieu). Un compte s'écrit `twitch:pseudo | youtube:@nom` ou se colle comme lien du profil. Le bouton **Télécharger un modèle à remplir** donne un exemple.
- **Aperçu avant d'importer** : rien n'est ajouté tant que vous n'avez pas cliqué **Importer maintenant**. Chaque ligne est **créée**, **complétée** (la fiche existait : on lui ajoute le compte, la catégorie, la note ou le champ vide qui manquait, **sans jamais changer son nom** ni écraser ce qu'elle contient), **déjà là** (rien à ajouter) ou **à corriger** (la raison et un exemple sont écrits en clair, ligne par ligne).
- **Réimporter le même fichier ne crée aucun doublon.** Les lignes à corriger se téléchargent dans un fichier que vous corrigez puis réimportez tel quel.
- **Gros fichiers** : l'import avance par paquets de quelques secondes, avec une barre de progression ; si la page se ferme ou si le site redémarre, il reprend où il en était (bouton **Continuer l'import**). Un seul import à la fois.

### Exporter
**Importer / exporter → Télécharger tout le carnet (CSV)** (droit « exporter le carnet ») : toutes les fiches, jusqu'à 100 000, dans un fichier qui s'ouvre dans un tableur (point-virgule en français, virgule en anglais). Il a **les mêmes colonnes que l'import** : exporté puis réimporté, le carnet redevient identique. Les e-mails et téléphones n'y sont que pour les personnes qui ont le droit de les voir. Chaque fiche y garde ses 50 dernières notes ; la sauvegarde du site les contient toutes.

### Doublons
La section **Doublons** repère les fiches qui se ressemblent : même compte, même e-mail, même nom dans la même organisation, nom presque identique (une lettre de différence, prénom et nom inversés) dans la même organisation, même nom sans organisation (le plus incertain). Pour chaque groupe : **Comparer**, **choisir la fiche à garder**, lire **ce qui sera repris** (comptes, catégories, notes, champs vides complétés), puis **Valider la réunion**. **Tant que vous n'avez pas validé, rien ne change** : annuler ne coûte rien. **Ce ne sont pas des doublons** écarte la paire pour de bon. Une fois validée, la réunion est définitive, et les autres modules (Partenariats, Raid, Story…) sont prévenus : ils pointent ensuite vers la fiche gardée.

### Données personnelles (RGPD)
Sur chaque fiche : **Télécharger tout ce que le site sait de cette personne** (sa fiche, ses notes et ce que chaque module garde sur elle) et **Effacer cette personne partout…** (une page qui liste les modules concernés, demande de cocher une case, puis donne un **bilan module par module** ; un module qui ne répond pas à temps est dit « n'a pas répondu à temps »).

Les fiches d'avant la version 2.0 gardent leur texte « Autres canaux » tel quel, en lecture ; les comptes qu'on y repère (`twitch.tv/…`, `youtube.com/@…`) s'ajoutent d'un clic avec **Ajouter comme compte**.

## Qui voit quoi
- Les **e-mails et téléphones** ne s'affichent qu'aux personnes qui ont le droit **« voir les e-mails et téléphones »** (rôles de la page Équipe). Sans ce droit, on voit les fiches, les comptes et les notes, jamais une adresse ni un numéro.
- **« créer des catégories »** et **« exporter le carnet »** sont aussi des droits que vous donnez rôle par rôle.

## Avec d'autres modules
- **Formulaire de contact** : ses messages arrivent ici.
- **Partenariats** : les personnes liées à une marque sont des fiches de Contacts.
- **Raid**, **Story** : lisent les comptes Twitch d'une catégorie ou cherchent une personne, sans rien recopier. Un lien `?category=<id>` ouvre la liste filtrée sur une catégorie. Depuis la 2.2, **Raid** peut aussi, sur un clic de votre part, créer la catégorie « Cible de raid », ajouter un compte Twitch à une fiche existante (jamais de doublon), ranger une fiche dans la catégorie ou l'en sortir (la fiche reste toujours dans Contacts).
- Quand une fiche a un compte **Twitch** ou **YouTube** et qu'aucun module ne relie votre site à ce service, la fiche propose de l'installer (pour la photo et le nombre de followers).

## Assistant (MCP)
`contacts_list` (sans e-mail ni téléphone, par pages de 100), `contact_get`, `contact_categories` : lecture. `contact_get_private` (avec e-mail et téléphone), `contact_create`, `contact_update`, `contact_note`, `contact_add_account`, `contact_delete` : **jamais accordés d'office**, c'est vous qui les accordez à un accès IA.

## Sauvegarde
Chaque sauvegarde contient `contacts.csv` et `notes.csv`, lisibles dans un tableur.

---

## Pour les développeurs

- **Services offerts** : `contact.book` **version 2** (sur-ensemble de la v1 : Partenariats garde `min: 1`) et `contact.store` inchangé. Contrat complet et suite exécutable : `tests/contract/README.md`, `tests/contract/contactBook.contract.mjs` (le module la passe : `tests/contacts-v2-contract.test.mjs`). Aucune méthode ne lève ; si le carnet ne peut pas répondre dans le temps imparti, `{ ok: false, error: "busy" }`.
- **Extension `contact.curate` v1 (2.2, additive)** : `lookupAccounts` (200 pseudos, index seulement), `searchAccounts` (50 par page, curseur), `addAccount` (un compte à une fiche existante, jamais de doublon), `removeCategory` (retire UNE catégorie d'une fiche). Texte du contrat et suite exécutable : `tests/contract-ext/` (passée par le double ET par ce module). Le contrat `contact.book` v2 ne change pas. `createCategory` est listé dans `offers[].callerRights` de `contact.book` : depuis une action d'administration d'un autre module qui l'appelle avec `{ asCaller: true }` (cœur 0.2.4), il reçoit le droit « créer des catégories » de la personne qui a cliqué ; sur un cœur plus ancien l'option est ignorée et la réponse reste `denied`.
- **Besoins facultatifs** : `privacy.subject` (Contacts appelle chaque fournisseur, 8 s au plus chacun, pour `export`, `erase` et `remap`), `twitch.api` ≥ 3 et `youtube.api` (photo et followers, appelés seulement à l'ouverture d'une fiche ou sur « Actualiser la photo », attente bornée à 6 s au total). Bluesky : `ctx.api.net` directement, profil public.
- **Onglets** (`minCore` 0.2.2) : `tabs` renomme « Utiliser » en « Mes contacts » / « My contacts » (aucun onglet ajouté : règle du kit `tabs.reasonable`).
- **Stockage** : `contacts` (personnes ; ids d'avant la 2.0 conservés), `orgs`, `notes` (clé = id de la fiche, `listByKey`), `categories` (une catégorie fusionnée garde `{ movedTo }`), `moved` (fiche fusionnée → gardée), `meta` (tampon d'écriture). K2 ajoute des collections temporaires ou bornées : `imports` (le document de l'import en cours, clé « job »), `importRows` (lignes rangées par paquets de 200, clé = id de l'import, effacées à la fin), `importLog` (journal : 1 000 erreurs et 200 lignes de chaque autre résultat au plus), `notdup` (paires « pas des doublons », 20 000 au plus), `reports` (20 bilans d'effacement, sans nom de personne). Clé « e:<e-mail> » sur les fiches : recherche exacte par e-mail.
- **Index mémoire** borné (≈ 400 octets par fiche mesurés à 100 000 fiches), tenu à jour à chaque écriture du module, jeté quand `store.generation()` ou le tampon d'écriture change ; reconstruction par pages de 1 000, durée bornée, une seule à la fois, attentes avec expiration. Plafond technique : 100 000 fiches.
- **Migration** 1 → 2 (`migrate.mjs`, à retirer en phase 3) : organisation texte → fiche organisation (une par nom), notes rangées par clé sur place, ids gardés ; rejouable ; vérifie les comptes avant de finir.
- **Options de test internes** (jamais un réglage) : `ctx.__contactsTest = { privacyTimeoutMs, maxContacts, indexWaitMs, … }`.
- **Fichiers du lot K2** : `csv.mjs` (lecture en flux, écriture, colonnes communes à l'import et à l'export, protection des formules de tableur), `import.mjs` (rangement, aperçu et import par lots avec reprise : `stage`, `step("preview" | "run")`, `logPage`, `cancel` ; `evaluate` est LA fonction qui décide du sort d'une ligne, pour l'aperçu comme pour l'import), `import-admin.mjs` (écran), `export.mjs` + `downloads.mjs` (`adminDownloads` : `contacts` avec le droit `export`, `template`, `importReport`, `person`), `dedupe.mjs` + `dedupe-admin.mjs` (détecteur par pages de 20 groupes, aperçu de fusion `planMerge` partagé avec `merge`), `privacy.mjs` + `privacy-admin.mjs` (export et effacement d'une personne), `photos.mjs` (lecture des profils), `nav.mjs`, `messages.mjs`.
- **Import** : une ligne = les champs de `create` + `accounts`, `categoryIds` (par NOM de catégorie dans le CSV), `note`. Même fiche = même `id` (si le nom est le même), un de ses comptes, son e-mail, ou (sans e-mail différent) même nom dans la même organisation. Le service `contact.book.import` garde son comportement du contrat (`added` / `existing` / `invalid`) ; l'import CSV, lui, **complète** les fiches existantes. Bornes : 100 000 lignes, 200 par paquet, 100 par verrou d'écriture, 8 s par pas, un seul import à la fois, un aperçu qui perd sa mémoire (redémarrage) repart du début sans rien écrire.
- **Photos** : `refreshOnOpen` (une fois par fiche et par 10 minutes, profils de plus de 24 h) et `refreshNow` (bouton) sont appelés par `admin.mjs` et nulle part ailleurs ; un test le vérifie (aucun appel depuis les services, la liste, l'import, l'export, la fusion ; ni minuteur, ni `tasks`, ni `hooks`).
- **Index** : chaque entrée garde aussi l'e-mail (`m`) pour le détecteur de doublons.
- **Mesures** (stockage en mémoire fidèle au contrat 5) : voir `tests/contacts-volume.test.mjs` (2 000, 10 000 et 100 000 fiches : import par pas, export en flux de pages de 500, détecteur de doublons).

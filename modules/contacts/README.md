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
- **Photo** : automatiquement celle du compte qui a le plus d'abonnés (la fiche dit d'où elle vient, par exemple « Photo YouTube (12 400 abonnés) »), ou une image que vous choisissez. **Revenir à la photo automatique** annule votre choix.
- **Notes** datées sur chaque fiche.
- **Messages du formulaire de contact** : ils arrivent comme fiches **« À vérifier »** (le message est la première note). Vérifiez la personne puis cliquez **C'est vérifié**.
- **Supprimer une fiche** : définitif, avec confirmation. Les modules qui la citaient sont prévenus ; si l'un d'eux ne répond pas, le message le dit.

Les fiches d'avant la version 2.0 gardent leur texte « Autres canaux » tel quel, en lecture ; les comptes qu'on y repère (`twitch.tv/…`, `youtube.com/@…`) s'ajoutent d'un clic avec **Ajouter comme compte**.

## Qui voit quoi
- Les **e-mails et téléphones** ne s'affichent qu'aux personnes qui ont le droit **« voir les e-mails et téléphones »** (rôles de la page Équipe). Sans ce droit, on voit les fiches, les comptes et les notes, jamais une adresse ni un numéro.
- **« créer des catégories »** et **« exporter le carnet »** sont aussi des droits que vous donnez rôle par rôle.

## Avec d'autres modules
- **Formulaire de contact** : ses messages arrivent ici.
- **Partenariats** : les personnes liées à une marque sont des fiches de Contacts.
- **Raid**, **Story** : lisent les comptes Twitch d'une catégorie ou cherchent une personne, sans rien recopier. Un lien `?category=<id>` ouvre la liste filtrée sur une catégorie.
- Quand une fiche a un compte **Twitch** ou **YouTube** et qu'aucun module ne relie votre site à ce service, la fiche propose de l'installer (pour la photo et le nombre d'abonnés).

## Assistant (MCP)
`contacts_list` (sans e-mail ni téléphone, par pages de 100), `contact_get`, `contact_categories` : lecture. `contact_get_private` (avec e-mail et téléphone), `contact_create`, `contact_update`, `contact_note`, `contact_add_account`, `contact_delete` : **jamais accordés d'office**, c'est vous qui les accordez à un accès IA.

## Sauvegarde
Chaque sauvegarde contient `contacts.csv` et `notes.csv`, lisibles dans un tableur.

---

## Pour les développeurs

- **Services offerts** : `contact.book` **version 2** (sur-ensemble de la v1 : Partenariats garde `min: 1`) et `contact.store` inchangé. Contrat complet et suite exécutable : `tests/contract/README.md`, `tests/contract/contactBook.contract.mjs` (le module la passe : `tests/contacts-v2-contract.test.mjs`). Aucune méthode ne lève ; si le carnet ne peut pas répondre dans le temps imparti, `{ ok: false, error: "busy" }`.
- **Besoins facultatifs** : `privacy.subject` (Contacts appelle chaque fournisseur, 8 s au plus chacun, pour `erase` et `remap`), `twitch.api` ≥ 3 et `youtube.api` (photos et abonnés : lot suivant).
- **Stockage** (`minCore` 0.2.1) : `contacts` (personnes ; ids d'avant la 2.0 conservés), `orgs`, `notes` (clé = id de la fiche, `listByKey`), `categories` (une catégorie fusionnée garde `{ movedTo }`), `moved` (fiche fusionnée → gardée), `meta` (tampon d'écriture). Clé « e:<e-mail> » sur les fiches : recherche exacte par e-mail.
- **Index mémoire** borné (≈ 400 octets par fiche mesurés à 100 000 fiches), tenu à jour à chaque écriture du module, jeté quand `store.generation()` ou le tampon d'écriture change ; reconstruction par pages de 1 000, durée bornée, une seule à la fois, attentes avec expiration. Plafond technique : 100 000 fiches.
- **Migration** 1 → 2 (`migrate.mjs`, à retirer en phase 3) : organisation texte → fiche organisation (une par nom), notes rangées par clé sur place, ids gardés ; rejouable ; vérifie les comptes avant de finir.
- **Options de test internes** (jamais un réglage) : `ctx.__contactsTest = { privacyTimeoutMs, maxContacts, indexWaitMs, … }`.
- **Points d'extension prévus** (fichiers à créer) : `import.mjs` (CSV), `dedupe.mjs` (doublons), `privacy.mjs` (export/effacement d'une personne), `photos.mjs` (rafraîchir les photos depuis les connecteurs, seulement à l'ouverture d'une fiche ou sur « Actualiser »). Le service sait déjà `merge`, `import` et `erase` (`book.mjs`).

# Contrat `contact.book` v2 et `privacy.subject` (Contacts 2.0)

Une page pour les développeurs des modules qui lisent ou écrivent le carnet (Raid, Story, Partenariats…) et pour celui qui écrit Contacts 2.0.
Source : contrat 11.3 à 11.5 de `docs/V2-CONTRACTS.md` du cœur, plus les précisions ci-dessous (marquées **[précisé]**). En cas de doute, c'est la
**suite exécutable** qui fait foi : `tests/contract/contactBook.contract.mjs`.

| Fichier | Rôle |
|---|---|
| `tests/helpers/fakeContactBook.mjs` | Double en mémoire du service, à brancher dans `fakeCtx({ services: book.services })`. |
| `tests/contract/contactBook.contract.mjs` | `runContactBookContract(makeProvider)` : la suite, contre le double ou le vrai module. |
| `tests/contract/privacySubject.contract.mjs` | `runPrivacySubjectContract(makeConsumer)` : la suite de VOTRE `privacy.subject`. |
| `tests/contact-book-fake.test.mjs` | Les deux suites contre le double. |

## Règles communes

- Contacts offre `contact.book` **version 2** (sur-ensemble de la v1 : Partenariats garde `min: 1`) et `contact.store` inchangé. Un consommateur de la v2 déclare `requires: [{ "service": "contact.book", "min": 2 }]` (ou `optional: true`) et `minCore: "0.2.0"`.
- **Aucune méthode ne lève** : réponse `{ ok: true, … }` ou `{ ok: false, error: "<code>" }`. Le cœur emballe le tout : `ctx.api.services.call(…)` rend `{ ok: true, value: <réponse> }` ou `{ ok: false, reason }` (fournisseur absent, en panne). Appelez toujours avec une **attente bornée** (4 à 6 s, repli) : le double sait « ne jamais répondre » (`book.faults.hang.add("accounts")`).
- Identifiants **opaques** (fiche, compte, catégorie) : ne supposez jamais leur forme ; 80 caractères au plus.
- Codes d'erreur : `invalid` (argument mal formé, liste trop longue), `invalid_network`, `invalid_handle`, `not_found`, `name_required`, `invalid_email`, `email_taken`, `text_required`, `nothing_to_update`, `too_many` (carnet plein : 100 000 fiches), `denied`, `duplicate`, `confirm_required`.
- `source` (écritures v2) : l'identifiant du module appelant (`^[a-z][a-z0-9-]{0,39}$`), obligatoire **[précisé]**.

## Méthodes

Lecture seule (déclarées `readOnly`) : `get`, `resolve`, `find`, `accounts`, `search`, `list`, `categories`, `categoriesResolve`.

| Méthode | Arguments | Réponse `ok: true` | Erreurs |
|---|---|---|---|
| `get` | `{ id }` | `{ contact }` : fiche + `others`, `relation`, `notes` (50 dernières) | `not_found` (+ `movedTo` si la fiche a été fusionnée) |
| `resolve` | `{ ids ≤ 100 }` | `{ contacts, missing, moved: { ancien: gardé } }` | `invalid` |
| `find`, `create`, `update`, `note` | v1 inchangées (+ `kind: "person" \| "org"` à la création) | v1 | v1 |
| `accounts` | `{ network, ids? ≤ 500, categoryId?, cursor?, limit ≤ 500 }` | `{ items: [{ id, accountId, name, handle, url, displayName?, avatar?, followers? }], next }` (un élément par compte) | `invalid_network`, `invalid`, `not_found` (catégorie supprimée/inconnue) |
| `search` | `{ q (coupé à 100), network?, kind?, limit ≤ 30 (déf. 10) }` | `{ items: [{ id, name, kind, accounts: [{ network, handle, displayName? }] }] }` | `invalid_network`, `invalid` |
| `list` | `{ categoryId?, kind?, orgId?, cursor?, limit ≤ 500 }` | `{ items: [fiche], next }` | `invalid`, `not_found` |
| `categories` | `{ q?, cursor?, limit ≤ 500 }` | `{ items: [{ id, label, name, color, icon }], next }` | — |
| `categoriesResolve` | `{ ids ≤ 50 }` | `{ items: [{ id, label, … }], moved: { ancien: actuel }, missing }` | `invalid` |
| `createCategory` ✎ | `{ label (1–100), color?, icon? }` | `{ id, label }` | `denied`, `invalid`, `duplicate` (+ `id` de l'existante), `too_many` |
| `setAccountProfile` ✎ | `{ id, accountId, displayName?, avatar? (https), followers? (entier ≥ 0), source, at (ISO) }` | `{}` ou `{ stale: true }` (plus ancien que le cache : ignoré) | `invalid`, `not_found` |
| `upsertByAccount` ✎ | `{ network, handle, name?, kind?, categoryId?, source, note? }` | `{ created, id, accountId }` | `invalid`, `invalid_network`, `invalid_handle`, `not_found`, `too_many` |
| `merge` ✎ | `{ keep, drop }` (même `kind`) | `{ id, remapped: [{ module, ok }] }` | `invalid`, `not_found` |
| `import` ✎ | `{ rows ≤ 1000 }` (ligne = champs de `create` + `accounts`, `categoryIds`, `note`) | `{ added, existing, invalid: [{ line, reason }] }` | `invalid` |
| `erase` ✎ | `{ id, confirm: true }` | `{ modules: [{ module, ok, removed? }] }` | `invalid`, `not_found`, `confirm_required` |

**Fiche** (`get`, `resolve`, `list`) : `id, kind, name, role, organisation, orgId, orgName, email, phone, status, source, createdAt, categoryIds, accounts, photo, adminPath`.
`organisation` = `orgName` (alias v1 : en entrée de `create`/`update`, le texte trouve ou crée la fiche organisation). Un compte de fiche :
`{ id, network, handle, url, displayName?, avatar?, followers?, profileAt? }`, jamais d'e-mail ni de téléphone.

**Comptes et réseaux.** `network` ∈ `twitch, youtube, tiktok, instagram, discord, x, bluesky, mastodon, web, other`. Chaque saisie est normalisée
(`@pseudo`, adresse du profil, majuscules…) : voir `normalizeAccount` dans le double et la table `SAME_ACCOUNT` de la suite. **Un compte n'appartient
qu'à une fiche** : `upsertByAccount` est idempotent (même compte = même fiche, nom existant jamais écrasé, même note de même source jamais doublée),
ce qui permet de rejouer une migration.

**Pagination.** Curseur opaque (≤ 500 caractères), ordre de création. Parcours complet sans doublon ni trou ; une fiche créée pendant le parcours
arrive à la fin. Un curseur illisible donne une page vide (`{ items: [], next: null }`), jamais d'erreur. `limit` hors bornes est ramenée.

```js
let cursor = null; const out = [];
do {
  const r = await within(ctx.api.services.call("contact.book", "accounts", { network: "twitch", categoryId, cursor, limit: 500 }), 5000);
  if (!r?.ok || !r.value.ok) break;                 // repli : dernières données connues
  out.push(...r.value.items); cursor = r.value.next;
} while (cursor);
```

**Catégories.** Plusieurs par fiche. L'admin de Contacts les renomme (même id), fusionne (l'ancien id devient `moved` vers l'actuel, chaînes
repliées) ou supprime (`missing` ; retirée des fiches, aucune fiche supprimée). Les écritures et filtres qui reçoivent un id fusionné le suivent.
Pour un réglage « choix d'une catégorie » (Raid : « Cible de raid ») :

```json
{ "key": "category", "type": "choice", "refersTo": "category", "allowCreate": true,
  "source": { "kind": "service", "service": "contact.book", "list": "categories", "get": "categoriesResolve", "create": "createCategory" } }
```

**Droit de création.** `createCategory` exige `ctx.can("categories.create")` (droit déclaré par Contacts). En cœur 0.2.0, `ctx.can` n'est vrai que
dans le `create` d'un `choice` appelé par le cœur pour la personne connectée : un `services.call` depuis l'action d'un autre module reçoit
`denied`. Le bouton « Créer la catégorie Cible de raid » est donc la création à la volée du `choice` ci-dessus. Dans les tests :
`book.asViewer(["categories.create"]).createCategory({ label })`.

**Photo** (`contact.photo` = `{ url, source: "manual" | <réseau>, accountId? }` ou `null`). Photo manuelle, sinon le compte qui a le plus d'abonnés
**connus** (cache daté de `setAccountProfile`), sinon Twitch, YouTube, Bluesky, puis les autres réseaux. Calcul pur à partir du cache, sans réseau ;
le cache n'est rafraîchi par Contacts qu'à l'ouverture d'une fiche ou sur « Actualiser ». Un module qui connaît déjà un profil (Raid) peut le
pousser par `setAccountProfile` ; une donnée plus ancienne que le cache est ignorée.

## `privacy.subject` (export, effacement, fusion)

- **Qui l'offre** : tout module qui garde une référence à une fiche (un `contactId` dans ses données) : Raid, Story, Partenariats… Déclaration :
  `"offers": [{ "service": "privacy.subject", "each": true }]`. Règle de kit (conseil en 0.2.0) : qui `requires contact.book` offre `privacy.subject`.
- **Qui l'appelle** : Contacts seulement (`requires: [{ "service": "privacy.subject", "optional": true }]`), fournisseur par fournisseur
  (`providers()` puis `call(…, { provider })`), **8 s au plus chacun** ; un module muet est listé `ok: false` dans le bilan, sans bloquer les autres.

| Méthode | Arguments | Réponse | Quand |
|---|---|---|---|
| `export` | `{ contactId }` | `{ label, data }` (JSON ≤ 1 Mo ; `label` = nom lisible du module) | export « tout ce que le site sait de cette personne » |
| `erase` | `{ contactId }` | `{ removed }` (entier ≥ 0) | `erase` de Contacts, AVANT la suppression de la fiche |
| `remap` | `{ from, to }` | `{ updated }` (entier ≥ 0) | `merge` de Contacts, APRÈS la fusion |

Les trois répondent `0` (jamais d'exception) pour une fiche inconnue ou des arguments absurdes, et sont idempotentes. Un module qui n'a pas reçu
`remap` lit l'ancien id dans `resolve(…).moved` et se corrige ; une référence à une fiche effacée apparaît dans `missing`.

## Brancher la suite sur le vrai module

En tête de `tests/contract/contactBook.contract.mjs` : un `makeProvider` qui lie les méthodes du service au `fakeCtx` du module, pose
`ctx.can`, passe les `privacy.subject` en `serviceInstances`, accepte un délai `privacyTimeoutMs` et un plafond `maxContacts` raccourcis pour le
test, et expose six gestes d'admin (`renameCategory`, `mergeCategories(keep, drop)`, `deleteCategory`, `setManualPhoto(id, url | null)`,
`removeAccount`, `deleteContact`). Un module consommateur fait de même avec `runPrivacySubjectContract`.

## Écarts au texte du contrat 11.3 (à reporter dans `docs/V2-CONTRACTS.md` du cœur)

1. `categories.resolve` s'appelle **`categoriesResolve`** : le manifeste refuse un point dans un nom de méthode (`readOnly` et source d'un `choice`).
2. Les éléments de `categories` portent **`label`** (lu par le cœur pour un `choice`) en plus de `name`.
3. Les réponses gardent l'enveloppe v1 `{ ok, … }` ; `resolve` gagne `moved` ; `get` d'une fiche fusionnée rend `movedTo` ; `accounts` gagne `accountId`, `url`, `followers`.
4. `list` accepte aussi `kind` et `orgId` ; `upsertByAccount` accepte `kind` et rend `accountId` ; `createCategory` accepte `color` et `icon`.
5. `upsertByAccount` reçoit `categoryId` (un id) et non `categoryName` (version du rapport de conception).

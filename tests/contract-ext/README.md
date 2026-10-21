# Extension additive `contact.curate` v1 (Contacts 2.2)

**Ce n'est PAS une modification du contrat `contact.book` v2** (`tests/contract/*`, intact) : c'est un service de plus, offert par le même module Contacts,
pour ce que Raid (ajout rapide d'une chaîne, bouton « Retirer ») ne peut pas faire avec le contrat v2. Un consommateur le déclare
`requires: [{ "service": "contact.curate", "min": 1 }]`. Suite exécutable : `contactCurate.contract.mjs` (contre le double `tests/helpers/fakeContactCurate.mjs`
ET contre le vrai module). **À valider par le propriétaire** avant d'être reporté dans `docs/V2-CONTRACTS.md` du cœur.

Mêmes règles que le contrat v2 : aucune méthode ne lève (`{ ok: true, … }` ou `{ ok: false, error }`), identifiants opaques, attente bornée côté appelant.

| Méthode | Arguments | Réponse `ok: true` | Erreurs |
|---|---|---|---|
| `lookupAccounts` (lecture) | `{ network, handles ≤ 200, categoryId? }` | `{ items: [{ input, handle, id, accountId?, hasProfile?, inCategory? } \| { input, error: "invalid_handle" }] }`, dans l'ordre reçu. `id: null` : personne ne porte ce compte. `inCategory` seulement si `categoryId` est donné ; `hasProfile` : le compte a déjà un nom affiché ou une photo. Index seulement, aucun parcours du carnet. | `invalid` (liste > 200), `invalid_network`, `not_found` (catégorie inconnue ; une fusionnée est suivie) |
| `searchAccounts` (lecture) | `{ network, q, categoryId?, cursor?, limit ≤ 50 (déf. 10) }` | `{ items: [{ id, accountId, name, handle, displayName?, avatar? }], next }` (un élément par compte du réseau ; le plus exact d'abord ; curseur opaque ; texte vide ou curseur illisible : page vide) | `invalid`, `invalid_network`, `not_found` |
| `addAccount` | `{ id, network, handle }` | `{ accountId, existed }` : ajoute le compte à la fiche EXISTANTE (jamais de doublon : un compte n'appartient qu'à une fiche ; rejouable) | `invalid`, `invalid_network`, `invalid_handle`, `not_found`, `taken` (+ `id` de l'autre fiche), `too_many_accounts` |
| `removeCategory` | `{ id, categoryId }` | `{ removed }` : retire CETTE catégorie de la fiche (une fusionnée est suivie) ; la fiche, ses comptes et ses autres catégories ne changent pas ; `removed: false` si elle n'y était pas | `invalid`, `not_found` (fiche ou catégorie) |

## Droit de création d'une catégorie (cœur 0.2.4)

`createCategory` (contrat v2, inchangé) exige `ctx.can("categories.create")`. Le manifeste de Contacts liste `createCategory` dans `offers[].callerRights` de
`contact.book` : un module qui l'appelle depuis une de ses actions d'administration avec `{ asCaller: true }` reçoit le droit de la personne qui a cliqué
(cœur 0.2.4 ; voir `docs/MODULES.md` du cœur). Sur un cœur plus ancien l'option est ignorée et la réponse reste `denied`.

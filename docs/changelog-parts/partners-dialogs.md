## Partnerships: windows to edit, and a way to delete a partner / Partenariats : fenêtres de modification, et suppression d'un partenaire

*EN: adding, editing, deleting a partner and adding a journal entry now open in a window above the page, and a partner can be deleted from the list or its page. For Curiosa 0.6.7 or later. Module touched: Partnerships 2.3.0.*
*FR : ajouter, modifier, supprimer un partenaire et ajouter une entrée au journal s'ouvrent dans une fenêtre au-dessus de la page, et un partenaire se supprime depuis la liste ou sa fiche. Pour Curiosa 0.6.7 ou plus. Module touché : Partenariats 2.3.0.*

### What changes for you / Ce qui change pour vous

- **EN: Editing no longer opens a form at the top of the page.** "Edit" opens a window titled "Edit — <brand>" with its own "Save the partner" and "Cancel"; the module tabs stay behind it, so they no longer look like they belong to the partner. Brand, status, chance of success and website are in sight; sector, country, how to reach the brand, logo, products, benefits, brief, draft email and source are under "More options".
- **FR : modifier n'ouvre plus un formulaire en haut de la page.** « Modifier » ouvre une fenêtre « Modifier — <marque> » avec ses propres boutons « Enregistrer le partenaire » et « Annuler » ; les onglets du module restent derrière, ils ne semblent plus appartenir au partenaire. Marque, statut, chances de succès et site web se voient ; secteur, pays, comment joindre la marque, logo, produits, apports, brief, brouillon de mail et source sont sous « Plus d'options ».
- **EN: You can delete a partner.** "Delete the partner" is in the "⋯" menu of each row and at the bottom of the partner page. A window says what goes ("Delete this partner and its 12 journal entries") and that the linked contacts stay in your address book, and asks for a tick before it deletes. Nothing is deleted by opening it.
- **FR : on peut supprimer un partenaire.** « Supprimer le partenaire » est dans le menu « ⋯ » de chaque ligne et en bas de la fiche. Une fenêtre dit ce qui part (« Supprimer ce partenaire et ses 12 entrées de journal »), précise que les contacts liés restent dans votre carnet d'adresses, et demande de cocher une case. L'ouvrir ne supprime rien.
- **EN: The list** has live search and a status filter; the follow-up mark has its own column. Adding a journal entry and a new partner open a window too.
- **FR : la liste** a une recherche en direct et un filtre par statut ; la relance a sa propre colonne. Ajouter une entrée au journal et un nouveau partenaire ouvrent aussi une fenêtre.

### For developers

- **Partnerships 2.3.0**: `minCore` 0.2.2 → **0.6.7** (windows, enriched table). No data change, no migration: same collections, same stored documents. `savePartner` answers `{ ok }` (no `redirect`), `deletePartner` needs `confirm: "on"` and refuses an id that is not a partner file. New log line `partner.deleted` (counts only). `partner_delete` (MCP, still off by default) now shares the function of the window, refuses a non-partner id and returns `journalEntries` and `contactLinks`.
- Tests: `tests/partnerships-dialogs.test.mjs` (new), the other Partnerships tests updated; the ergonomics baseline loses the two `openInContacts` gaps.

## One word for what you install: "module" / Un seul mot pour ce qu'on installe : « module »

*EN: wording only, nothing changes in how the modules work. No module version changes: the new texts ship with the next release of each module.*
*FR : formulation seulement, rien ne change dans le fonctionnement des modules. Aucune version de module ne change : les nouveaux textes partent avec la prochaine version de chaque module.*

### What changes for you / Ce qui change pour vous

- **EN: the texts say "module" everywhere.** Messages, help and tool descriptions of 18 modules no longer say "extension", "feature" or "fonctionnalité" for something installed from the catalogue; the pointers to the admin page read "Modules".
- **FR : les textes disent « module » partout.** Les messages, aides et descriptions d'outils de 18 modules ne disent plus « extension », « feature » ou « fonctionnalité » pour ce qui s'installe depuis le catalogue ; les renvois vers la page d'administration disent « Modules ».

### For developers

- New test `tests/r34-retired-terms.test.mjs` (rule R34 of the core, `docs/ERGONOMIE-ADMIN.md`): every visible text of a module (manifest `{ fr, en }` strings, `locales/en.json`, `locales/fr.json`) is scanned for the retired words. Its allow-list starts empty. The checker lives in `tests/helpers/retiredTerms.mjs`, a local mirror of `retiredTerms()` of the core kit; `tests/helpers/ergonomics.mjs` stays the copy of the published core until the core release that carries R34 exists, then it is synced and the mirror is deleted.
- Kept on purpose: the address `/admin/extensions`, manifest keys (`features`), identifiers (action `feature` of Testimonials), the `contact.curate` "extension" of the Contacts contract (a contract extension, not a module), file extensions, and code comments.

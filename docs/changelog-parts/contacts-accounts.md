## Contacts 2.8.0: the people who log in have a card

*For Curiosa 0.47.0 or later (older versions keep working, the feature simply stays idle). Module touched: Contacts 2.8.0.*

### New
- **Your login accounts are in your address book.** You and your team each get a card with the name, e-mail and a quiet "Account · role" badge. The card follows the account when its name, e-mail or role changes. Your notes, networks and categories stay yours.
- **No duplicates.** A card that already has the same e-mail is linked, and only the link is added. If the e-mail is on several cards, a new card is created and marked "To check" so you can merge them yourself.
- **A linked card cannot be deleted** while the account exists, and the message says why. When the account is deleted, the card stays, no longer linked, with a note.
- **A filter "Login accounts"** in the list, and a "site account" column at the end of the CSV export (an import ignores it).
- Nothing is shown publicly, and the assistant tools keep exactly the same rights.

### For developers
- `contacts` 2.8.0, `minCore` unchanged (0.38.0). New optional `consumes` for the core topic `core.user` and the `topics` permission. New file `accounts.mjs`, a task `accounts` (every 5 minutes, reads only that topic). On first use the sync creates or links one card per existing account, once (idempotent).
- Tests: `tests/contacts-accounts.test.mjs` (new), plus version and header updates in the existing Contacts tests; `docs/TOPICS.md` lists `core.user`.

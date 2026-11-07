# Contacts

Your **private** address book: the **people** and **organisations** you work with, their **accounts** on the networks (Twitch, YouTube, TikTok, Instagram, Discord, X, Bluesky, Mastodon, website…), **categories**, **notes** and a **photo**. Nothing is public.

**A person exists once, here.** The other modules (Partnerships, Raid, Story…) only refer to it: when you correct a name or a photo in Contacts, the whole site follows.

## Getting started
1. Open **Contacts** in the administration.
2. **+ Add a person** opens on the **Add via** tab: choose the **platform** (the last one used is already chosen), **paste the link or type the handle** (`@name`), then **Save**. The **display name** is optional: without it, the handle is used (or the name found on Twitch or YouTube when their connector is installed). The card opens: complete it whenever you like.
3. The platforms offered are those your site knows: the ones whose connector is installed (Twitch, YouTube), the ones that already have an account in your book, or, otherwise, the most common. Another platform, an e-mail, a role? The **Manual entry** tab has every detail (role, organisation, e-mail, phone, relation, categories) and two places for accounts.
4. If the link does not match the chosen platform, the message is just under the field and says what to do ("This link is a YouTube link, but the chosen platform is Twitch. Change the platform, or paste a Twitch link."). If the account is already in the book, the site offers **to open that card** instead of creating a second one.
5. Other accounts are added later on the card, with **Add an account**.

## What you can do
- **Search** at the top of the list: name, handle, organisation, without worrying about accents or capitals. The **filters** (category, network, "To check") are clickable; **See more** shows the next cards.
- **Organisations**: a person belongs to an organisation, with a role. Just type the name of the organisation on the card: it is created if it does not exist yet. The card of an organisation shows its people.
- **Categories** (for example "Raid target"): a card can have several. **Categories** page: create, rename, **Put into…** (merge two categories), delete. **Deleting a category deletes no card.**
- **Photo**: automatically the one of the account with the most followers (the card says where it comes from, for example "YouTube photo (12,400 followers)"), or an image you choose (uploaded from your device). **Back to the automatic photo** cancels your choice. The photo and the followers are refreshed **when you open a card** (if it is older than 24 h) or when you click **Refresh the photo**: never in the background. Twitch and YouTube need their connector to be installed (the card offers it, one service at a time); Bluesky works by itself. Twitch does not give the follower count of another channel: it does not enter the "biggest community" computation.
- **Add a card to a category**: on the card, **Categories** section, the list with **Remove**, then a choice and the **Add to the category** button (no checkbox among hundreds).
- Dated **notes** on each card.
- **Messages of the contact form**: they arrive as **"To check"** cards (the message is the first note). Check the person then click **It is checked**.
- **Delete a card**: final, with a confirmation. The modules that referred to it are warned; if one of them does not answer, the message says so.

## Import, export, merge duplicates, erase a person
The page of the module opens on the **My contacts** tab, with five sections: Contacts, Organisations, Categories, **Duplicates**, **Import / export**.

### Import (CSV spreadsheet)
- **Paste** your lines or **choose a file** (5 MB at most, 100,000 lines at most). The first line names the columns: `name`, `type`, `role`, `organisation`, `e-mail`, `phone`, `accounts`, `categories`, `notes` (or their French names; other columns are ignored). **Only the name is required** (without a name, the handle of the first account stands in). An account is written `twitch:handle | youtube:@name` or pasted as the link of the profile. The **Download a template to fill in** button gives an example.
- **Preview before importing**: nothing is added until you click **Import now**. Each line is **created**, **completed** (the card existed: the account, category, note or empty field that was missing is added, **never changing its name** nor overwriting what it holds), **already there** (nothing to add) or **to correct** (the reason and an example are written in plain words, line by line).
- **Importing the same file again creates no duplicate.** The lines to correct can be downloaded in a file that you correct then import again as it is.
- **Big files**: the import goes forward in batches of a few seconds, with a progress bar; if the page is closed or the site restarts, it resumes where it was (**Continue the import** button). One import at a time.

### Export
**Import / export → Download the whole book (CSV)** (right "export the book"): all the cards, up to 100,000, in a file that opens in a spreadsheet (semicolon in French, comma in English). It has **the same columns as the import**: exported then imported again, the book becomes identical. E-mails and phones are only there for the people allowed to see them. Each card keeps its last 50 notes there; the backup of the site contains them all.

### Duplicates
The **Duplicates** section spots cards that look alike: same account, same e-mail, same name in the same organisation, nearly the same name (one letter of difference, first and last name swapped) in the same organisation, same name without organisation (the least certain). For each group: **Compare**, **choose the card to keep**, read **what will be taken over** (accounts, categories, notes, empty fields completed), then **Confirm the merge**. **Until you confirm, nothing changes**: cancelling costs nothing. **They are not duplicates** sets the pair aside for good. Once confirmed, the merge is final, and the other modules (Partnerships, Raid, Story…) are warned: they then point to the kept card.

### Personal data (GDPR)
On each card: **Download everything the site knows about this person** (their card, their notes and what each module keeps about them) and **Erase this person everywhere…** (a page that lists the modules concerned, asks you to tick a box, then gives a **module by module report**; a module that does not answer in time is reported as "did not answer in time").

Cards from before version 2.0 keep their "Other channels" text as it is, read only; the accounts spotted in it (`twitch.tv/…`, `youtube.com/@…`) are added with one click using **Add as an account**.

## Who sees what
- **E-mails and phones** are only shown to the people who have the right **"see e-mails and phones"** (roles of the Team page). Without this right, you see the cards, the accounts and the notes, never an address or a number.
- **"create categories"** and **"export the book"** are also rights that you give role by role.

## With other modules
- **Contact form**: its messages arrive here.
- **Partnerships**: the people linked to a brand are Contacts cards.
- **Raid**, **Story**: read the Twitch accounts of a category or look for a person, without copying anything. A `?category=<id>` link opens the list filtered on a category. Since 2.2, **Raid** can also, on a click from you, create the "Raid target" category, add a Twitch account to an existing card (never a duplicate), put a card into the category or take it out (the card always stays in Contacts).
- When a card has a **Twitch** or **YouTube** account and no module links your site to that service, the card offers to install it (for the photo and the follower count).

## Assistant (MCP)
`contacts_list` (without e-mail or phone, in pages of 100), `contact_get`, `contact_categories`: reading. `contact_get_private` (with e-mail and phone), `contact_create`, `contact_update`, `contact_note`, `contact_add_account`, `contact_delete`: **never granted by default**, you grant them to an AI access.

## Backup
Each backup contains `contacts.csv` and `notes.csv`, readable in a spreadsheet.

---

## For developers

- **Services offered**: `contact.book` **version 2** (superset of v1: Partnerships keeps `min: 1`) and `contact.store` unchanged. Full contract and executable suite: `tests/contract/README.md`, `tests/contract/contactBook.contract.mjs` (the module passes it: `tests/contacts-v2-contract.test.mjs`). No method throws; if the book cannot answer in time, `{ ok: false, error: "busy" }`.
- **Extension `contact.curate` v1 (2.2, additive)**: `lookupAccounts` (200 handles, index only), `searchAccounts` (50 per page, cursor), `addAccount` (an account to an existing card, never a duplicate), `removeCategory` (takes ONE category off a card). Contract text and executable suite: `tests/contract-ext/` (passed by the double AND by this module). The `contact.book` v2 contract does not change. `createCategory` is listed in `offers[].callerRights` of `contact.book`: from an administration action of another module that calls it with `{ asCaller: true }` (core 0.2.4), it receives the right "create categories" of the person who clicked; on an older core the option is ignored and the answer stays `denied`.
- **Optional needs**: `privacy.subject` (Contacts calls each provider, 8 s at most each, for `export`, `erase` and `remap`), `twitch.api` >= 3 and `youtube.api` (photo and followers, called only when a card is opened or on "Refresh the photo", wait bounded to 6 s in total). Bluesky: `ctx.api.net` directly, public profile.
- **Adding a person (2.3)**: `networks.checkAccountInput(platform, input)` is THE pure function (no network) that checks that a handle or a link matches the chosen platform (`ok` / `empty` / `other_network` / `invalid`). `quick.mjs` chooses the platforms offered (connectors installed through `ctx.api.services.providers`, otherwise platforms already used in the index, otherwise the common ones) and remembers the last platform chosen (collection `meta`, key "quick"). `book.saveCard` accepts `accounts` at creation: an account already taken stops everything before the write (`account_taken`). The "Status" field is no longer in the form (it only served the contact form messages, which have their "It is checked" button on the card); the `save` action still understands `status`. MCP tools, services and data: unchanged. Tests: `tests/contacts-quick-add.test.mjs`.
- **Tabs** (`minCore` 0.2.2): `tabs` renames "Use" to "My contacts" (no tab added: kit rule `tabs.reasonable`).
- **Storage**: `contacts` (people; ids from before 2.0 kept), `orgs`, `notes` (key = id of the card, `listByKey`), `categories` (a merged category keeps `{ movedTo }`), `moved` (merged card → kept), `meta` (write stamp). K2 adds temporary or bounded collections: `imports` (the document of the import in progress, key "job"), `importRows` (lines stored in batches of 200, key = id of the import, erased at the end), `importLog` (journal: 1,000 errors and 200 lines of every other result at most), `notdup` ("not duplicates" pairs, 20,000 at most), `reports` (20 erasure reports, with no person name). Key "e:<e-mail>" on the cards: exact search by e-mail.
- **Bounded in-memory index** (about 400 bytes per card measured at 100,000 cards), kept up to date at each write of the module, dropped when `store.generation()` or the write stamp changes; rebuilt in pages of 1,000, bounded time, one at a time, waits with a timeout. Technical ceiling: 100,000 cards.
- **No conversion code any more (2.5.0)**: the 1.x → 2.0 migration (organisation text → organisation card, notes keyed in place, ids kept) was removed. `dataVersion` stays 2 with `dataFloor` 2: data still in version 1 is set aside instead of being marked up to date; the bridge is the tag `v1.50.0` (Contacts 2.4.1), see `docs/MIGRATIONS.md`. `migrations[2]` is an empty marker (the kit rule `data.version` wants one entry per `dataVersion` above 1).
- **Internal test options** (never a setting): `ctx.__contactsTest = { privacyTimeoutMs, maxContacts, indexWaitMs, … }`.
- **Files of batch K2**: `csv.mjs` (streamed reading, writing, columns shared by import and export, protection against spreadsheet formulas), `import.mjs` (staging, preview and batched import with resume: `stage`, `step("preview" | "run")`, `logPage`, `cancel`; `evaluate` is THE function that decides the fate of a line, for the preview as for the import), `import-admin.mjs` (screen), `export.mjs` + `downloads.mjs` (`adminDownloads`: `contacts` with the `export` right, `template`, `importReport`, `person`), `dedupe.mjs` + `dedupe-admin.mjs` (detector in pages of 20 groups, merge preview `planMerge` shared with `merge`), `privacy.mjs` + `privacy-admin.mjs` (export and erasure of a person), `photos.mjs` (reading of profiles), `nav.mjs`, `messages.mjs`.
- **Import**: a line = the fields of `create` + `accounts`, `categoryIds` (by category NAME in the CSV), `note`. Same card = same `id` (if the name is the same), one of its accounts, its e-mail, or (without a different e-mail) same name in the same organisation. The `contact.book.import` service keeps the behaviour of the contract (`added` / `existing` / `invalid`); the CSV import, for its part, **completes** existing cards. Bounds: 100,000 lines, 200 per batch, 100 per write lock, 8 s per step, one import at a time, a preview that loses its memory (restart) starts again from the beginning without writing anything.
- **Photos**: `refreshOnOpen` (once per card and per 10 minutes, profiles older than 24 h) and `refreshNow` (button) are called by `admin.mjs` and nowhere else; a test checks it (no call from the services, the list, the import, the export, the merge; no timer, no `tasks`, no `hooks`).
- **Index**: each entry also keeps the e-mail (`m`) for the duplicate detector.
- **Measures** (in-memory storage faithful to contract 5): see `tests/contacts-volume.test.mjs` (2,000, 10,000 and 100,000 cards: import by steps, export as a stream of pages of 500, duplicate detector).

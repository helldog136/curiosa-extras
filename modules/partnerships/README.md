# Partnerships — community module of Curiosa

The **private** follow-up of your partnerships: brands approached, status (to contact → sent → in discussion → accepted → published…), chances, follow-ups due, dated journal.
**No public page**: nothing of this module appears on your site.

## One address book: people live in Contacts

This module has **no address book of its own any more**. A person exists once, in the *Contacts* module; a partner file only keeps **links** (`contactIds`, identifiers). It **requires** the `contact.book` service of Contacts (as the contact form requires `contact.store`): enabling Partnerships installs and enables Contacts when needed.

- **On a file**: the linked contacts are shown (name, role, e-mail, phone, link to their Contacts card). You can **link** an existing contact (list or search), **create** one (it is born in Contacts, without duplicates: same e-mail = the existing person is linked), or **unlink** it. Unlinking or deleting a file **never** deletes a person.
- **Contacts missing or disabled**: the file is still shown, the links are kept (names "unavailable"), and a message says so. Nothing breaks.

## The reprise of the pre-2.0 contacts is gone (2.2.0)

Up to 1.x this module carried a small address book and a merge screen towards Contacts. 2.0 moved those people into Contacts by itself at the update (`dataVersion` 2). That conversion was removed in 2.2.0:

- `dataFloor` is 2: an instance whose data is still in version 1 is **set aside** (nothing is changed) instead of being marked up to date. Updating from the Catalogue goes through the last version that still converted (tag `v1.50.0`) by itself; the rule is in `docs/MIGRATIONS.md`. `migrations[2]` is an empty marker (the kit rule `data.version` wants one entry per `dataVersion` above 1).
- What the conversion left in the storage (`contacts`, `legacyContacts`, `meta`) is **not read or written any more**. The three collections stay declared in `legacyCollections` of the manifest, so the Upkeep page of the core counts them; `legacyContacts`, the safety copy, is also in `inertLegacyCollections`, so it can be deleted from that page when you decide to. The declaration of the three collections goes in a later release.

## Privacy: `privacy.subject`

Partnerships **offers** the `privacy.subject` service (one answer per instance) for what it keeps about a person of Contacts, that is only the **links** of its partner files. Contacts calls it:

- `export` `{ contactId }`: the partner files linked to this person (brand name, status).
- `erase` `{ contactId }`: the link is removed from all files; the files and their journal stay.
- `remap` `{ from, to }`: after a merge of duplicates in Contacts, the links to `from` point to `to`, without duplicates.

All three answer `0` for an unknown file, never throw, and can be replayed. A person **deleted** from Contacts is still flagged ("Deleted from the address book"), and a person **merged** without `remap` having been received is followed by `resolve(...).moved`: the link corrects itself.

## Windows and deletion (2.3.0)

New partner, edit, delete and "add a journal entry" open in a **window above the page** (core 0.6.7), so the module tabs are never taken for tabs of the partner. Only brand, status, chance and website are in sight; the other fields are under "More options".
**Delete the partner** is in the row menu and at the bottom of the partner page. The window counts what goes (the file and its journal entries), says that linked contacts stay in the address book, and asks for a tick; opening it deletes nothing. The deletion writes one core log line with counts only. There is no undo: the confirmation is the safety net.

## MCP

`partners_list`, `partner_get` (also returns the linked contacts: id, name, role, e-mail), `partner_create` (status "to contact" or "in discussion" only), `partner_update`, `partner_log`, **`partner_link_contact`** and **`partner_unlink_contact`**. The tools that write (`partner_create`, `partner_update`, `partner_log`, `partner_link_contact`, `partner_unlink_contact`) are **granted only explicitly** by your AI access; only reading is granted by default. The tools that create, change or delete people are those of *Contacts*. `partner_delete` exists but is **off by default** (it only deletes the file and its journal, and returns the counts). The changes made by an assistant are attributed to its token (`agent:<token>`).

The `partnership.partner` topic is still provided (the *Sponsors* module uses it). **Advanced setting**: days without news before a follow-up (14). One copy per site.

## Published articles (2.6.0)

The public articles about your partners live in a content module of the site (by default the one called `sponsoring`; advanced setting "Module that holds your public articles"). Partnerships only **reads** the published ones (200 at most; a draft is never visible to a module) and never writes to them.

- **A file shows its article.** The overview has an "Article" column when that module exists: "Published" (a link to the article) or, for a file marked Published, "No published article". A file is paired with the article it points to (edit window, under "More options", "Published article"), else with the article whose title is the brand name or contains it as a whole word. Each article is paired once.
- **An article without a file is a row.** It counts as Published, wears the badge "Article without file", and its "Open" or "Edit" button opens "Add the file", prefilled from the article. The file is born flagged `fromArticle`; replaying the action creates nothing twice. Nothing is created without a click, and no field of an existing file is overwritten.
- **The two numbers agree.** The number in the title ("Overview (n)") is the number of rows of the table, closed files and articles without a file included, as the search count ("n of N") says.
- Without the articles module (or an older core) the column and the field do not exist and nothing is read.


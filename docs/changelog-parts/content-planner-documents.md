## Content notebook: keep the script of a video, in versions, inside the idea

*Module touched: Content notebook 1.2.0. Nothing to set up, no new permission.*

### New
- **Documents in every idea.** An idea now has a Documents area for long texts such as the script of a video and its shorts. A document has a title, a version label ("v1", "v2", "final"…) and up to 60,000 characters (the notes stay at 4,000). Add one with a single button, read it on its own screen, edit it in a window, and see the length and date in the list.
- **Start a new version.** One button copies a document under a new label (v1 gives v2) and keeps the old one as it is, so no earlier draft is lost.
- **Deleting a document is yours alone**, and its confirmation says what is lost. Deleting an idea for good now also deletes its documents and says how many.
- **Your AI assistant** can list the documents of an idea, read one in full, add one and change one (it never deletes). Asked to read an idea, it is told how many documents it holds, without their text. Reading is allowed by default; writing must be granted, as for the other ideas tools.
- **Copies.** A new "Download my documents (CSV)" file (long texts are cut in parts of 30,000 characters so a spreadsheet keeps every character) and, in the site backup, `documents.csv` and `documents.md` next to the unchanged ideas files.
- **Still private.** Documents have no page, no link and no block on your site, and no other module reads them.

### For developers
- New collection `ideaDocs`: one row per document, keyed by the idea id (`store.listByKey`), `{ ideaId, title, version, text, by, updatedBy, createdAt, updatedAt }`. Idea rows are never touched: an idea written by 1.1.3 loads as before, no migration (`dataVersion` stays 1, `minCore` stays 0.2.5).
- Limits in `documents.mjs`: 60,000 characters per document, 20 documents and 240,000 characters per idea, 2,000 documents per notebook; nothing is cut silently (readable errors, under the field in the admin).
- New files `documents.mjs` (storage, cleaning, limits, versions) and `docsAdmin.mjs` (area, reading screen, windows, actions `saveDoc`, `newVersion`, `deleteDoc`). The windows are `adminForm` blocks with `presentation: "dialog"`, opened by plain links.
- MCP: `idea_doc_list`, `idea_doc_get` (read), `idea_doc_add`, `idea_doc_update` (write, never granted by default), `documentCount` in `idea_get`; no delete tool. The `text` property has no `maxLength` in `module.json` (the manifest accepts 20,000 at most): the 60,000 characters are checked in the code.
- Downloads: `adminDownloads.documents` (same right `ideas.export`); `backup.readable` adds the two document files only when a document exists. The README is now in English.
- Tests: `tests/content-planner-documents.test.mjs` (new); `tests/content-planner.test.mjs` and `tests/places.test.mjs` follow the new tools and version.

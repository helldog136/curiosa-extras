# Content notebook

Your **private** notebook for ideas of videos, articles and posts. It replaces the notes scattered in the phone and the messages sent to yourself: everything is in one place, and **nothing is ever shown on your site** (the module has no page, no link and no home block).

## What it is for

A notebook with four places: **Ideas**, **In progress**, **Published** and **Archived**. An idea is:

- a **title** (that is all it takes to write it down);
- a **sentence** saying what it is about;
- **steps to tick off** (by default: script, thumbnail, description, publishing; you can change this model in the settings, and the steps of each idea one by one);
- a **target date** (a guide, not a duty);
- the **networks** concerned (YouTube, Twitch, Instagram, TikTok, blog… to tick, or any other word you like);
- free **notes** (4,000 characters);
- **documents**, for the long texts (see below).

## How to use it

1. Open *My notebook* and touch the big button **"I have an idea!"**: write a title, it is noted. The rest can come later.
2. Touch an idea to open it. There you tick the steps, choose a date and networks, write your notes and keep your documents.
3. To move an idea forward, choose its new place in the **"Where is this idea at?"** menu (Ideas, In progress, Published, Archived). When you put it in *Published*, the notebook remembers today's date.
4. On the phone as on the computer, everything is done with buttons: there is **never** a mandatory drag and drop.
5. From eight ideas on, a **search** appears (accents and capital letters do not matter). The lists show 50 ideas per page.

### Documents: the script of a video, in versions

The notes hold 4,000 characters, which is not enough for the script of a long video and its shorts (about 7,000 characters). Each idea therefore has a **Documents** area:

- **Add a document**: a title and the text. A **version** label ("v1" by default, "v2", "final"… any short word, 20 characters at most) is under *More options*. The window closes on a message that says what was saved.
- **Read**: the full text on its own screen, with the buttons *Edit the document* and *Start a new version*. In the list, a long text is never shown: only its title, version, date and length.
- **Edit**: a window with the title, the version and the text.
- **New version**: the whole point of the area. *Start a new version* copies the document under a new label (the next one is suggested: v1 gives v2) and **keeps the old one as it is**. The copy comes first, because the list shows the most recently edited document first.
- **Delete**: reserved to you. Its confirmation says what is lost (the text, and how many characters); the idea and its other documents stay. There is no way to delete a document from the assistant.

Limits (so that the notebook stays light): **60,000 characters** per document (about 10,000 words, an hour of speech: a long script and its shorts fit many times over), **20 documents** and **240,000 characters** in all per idea (four documents of the maximum size, or about thirty scripts of 7,000 characters), **2,000 documents** in the whole notebook. A limit reached is said in clear words, under the field or in a message, and nothing is cut silently.

Documents are as private as the rest: they have no page, no link and no block, and they are never read by another module. Deleting an idea for good (only an archived idea can be) deletes its documents too, and its confirmation says how many.

### A rhythm, if you want one

In the *Settings* tab, "Add a rhythm": for example "1 per week". If the last publication is older than that, the notebook says so **gently**, without blame, suggesting the idea already in progress or to pick one. After a long break, it tells you that it is normal. Past target dates are signalled the same way, with a small badge. Everything is computed when you open the notebook: nothing runs in the background, no reminder is sent.

### Archiving rather than deleting

An archived idea leaves the lists but is not lost: bring it back whenever you like. Only **archived** ideas can be deleted for good, after a question explaining what will be erased.

## Keeping a copy

- **Download my ideas (CSV)**: a file that opens in a spreadsheet (semicolons in French, commas in English). Its ten columns have not changed.
- **Download my documents (CSV)**, shown once there is a document: one row per document, with the columns *Idea, Document, Version, Characters, Edited on, Part, Text*. A spreadsheet cell holds 32,767 characters at most and a document up to 60,000: a long text is cut in **parts of 30,000 characters at most**, one row per part ("1/2", "2/2"), and no character is lost. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'` so that it is never read as a formula.
- The **site backup** also holds your notebook in files readable without installing anything: `ideas.csv` and `ideas.md` (unchanged), and, only when there is at least one document, `documents.csv` (same columns as the download) and `documents.md` (one section per idea, one block per document, the text as written). Backup files are limited to 5 MB: beyond that, the text says it was cut and the documents CSV download holds everything.

## With the AI assistant

If you connected an AI assistant, it can **list** your ideas, **read** one (it also says how many documents the idea holds, without their text), **add** an idea, **change** it, **move** it and **tick a step**. For the documents it can **list** those of an idea (title, version, length), **read** one in full, **add** one and **change** one (`idea_doc_list`, `idea_doc_get`, `idea_doc_add`, `idea_doc_update`). Reading is allowed by default; writing must be granted explicitly in the assistant's access. Changing a document replaces what it holds, so the tool description tells the assistant to add a new version instead of overwriting an old one. It cannot delete anything, and it reads only this notebook, never the data of another module.

## What it does not do

- It shows nothing on the site and sends no message or reminder.
- It does not connect to your network modules: networks are plain words.
- It does not create a slot in the planning (see the ideas for later in `docs/ideas/content-planner.md`).
- It keeps at most **1,000 ideas** (archived included) and **2,000 documents**.
- The search of the notebook looks in titles, sentences, notes, networks and steps, not in documents.

## For developers

One instance, no service offered or required, three permissions (`admin`, `storage`, `mcp`). Ideas are documents of the `ideas` collection. **Documents** (1.2.0) are documents of the `ideaDocs` collection, one row per document, keyed by the idea id (`store.add(..., { key })`, read with `store.listByKey`): `{ ideaId, title, version, text, by, updatedBy, createdAt, updatedAt }`. The idea rows are never touched, so an idea stored by 1.1.3 loads as it always did and nothing is migrated (`dataVersion` stays 1). A row of `ideaDocs` that is not a document of the idea asked for is ignored. Limits live in `documents.mjs` (`DOC_LIMITS`, `MAX_DOCS_PER_IDEA`, `MAX_CHARS_PER_IDEA`, `MAX_DOCS_TOTAL`). The `text` property of the document tools has no `maxLength` in `module.json` (the core accepts at most 20,000 there): the 60,000 characters are checked in the code, with a readable error.

Files: `data.mjs` (ideas, rules, rhythm), `documents.mjs` (documents: cleaning, limits, versions, storage), `docsAdmin.mjs` (the Documents area, the reading screen, the windows and their actions), `view.mjs` (screen pieces), `admin.mjs` (list, idea page, actions), `tools.mjs` (assistant tools), `export.mjs` (CSV files and readable backup).

Admin actions are reserved to the administration; only the downloads have a right of their own (`ideas.export`, shared by the ideas and documents files). Document actions: `saveDoc` (add when `id` is empty), `newVersion`, `deleteDoc`. The windows are `adminForm` blocks with `presentation: "dialog"`, opened by plain links of the page (`?idea=…&newDoc=1`, `editDoc`, `versionDoc`) so that no `minCore` bump is needed; an older core shows the same form at the top of the page. MCP tools: `ideas_list`, `idea_get`, `idea_doc_list`, `idea_doc_get` (read), `idea_add`, `idea_update`, `idea_move`, `idea_step`, `idea_doc_add`, `idea_doc_update` (write, never granted by default). No tool deletes anything. See `docs/ideas/content-planner.md`.

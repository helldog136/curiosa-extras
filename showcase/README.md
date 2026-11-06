# Module showcase

The source of truth for the business showcase of Curiosa (the "Modules" blog of the Curiosa site): **one entry per module**, in English and French, with screenshots.
A later job (an AI assistant, run at every release) reads this folder at the release tag and publishes it. Nothing here is published by hand.

```
showcase/
  README.md              this file
  categories.json        the 6 categories (id, name and one-line blurb in EN and FR)
  index.json             every entry with category, order and a one-line pitch EN/FR (generated: node scripts/showcase-check.mjs --write)
  pending.json           (optional) modules that still wait for their entry; absent once everything is covered
  modules/<module-id>/
    entry.json           the facts (see below)
    entry.en.md          the English text
    entry.fr.md          the French text (same structure, same images, same links)
    shots/*.webp         the screenshots (the list may be empty)
  shared/*.webp          pictures several entries show (screenshots with "shared": true)
```

## entry.json

| Key | Meaning |
|---|---|
| `id` | The module's id (= the folder name). |
| `category` | One of `categories.json`: `content`, `streaming`, `community`, `looks`, `social`, `tools`. |
| `tags`, `order` | Words for the blog tags; the order inside the category. |
| `title`, `summary`, `pitch` | `{ "en", "fr" }`. `summary` and `pitch` are at most 160 characters. |
| `since` | The module version in which it first appeared. Never newer than the module's own `version`. |
| `moduleVersion` | The module version the entry was last read against. A newer module gives a warning: re-read the entry. |
| `requires` | The modules it needs. Must match the module's own (non-optional) requirements. |
| `worksWith` | Modules that go well with it (linked in "Works well with"). |
| `status` | `stable`, `beta` or `deprecated`. |
| `screenshots` | `[{ file, kind, shared?, alt: {en, fr}, caption: {en, fr} }]`, possibly empty. `kind`: `admin`, `public`, `mobile` or `overlay`. `shared: true` points to `showcase/shared/<file>` (one picture several entries show, such as the header buttons). `alt` is at most 125 characters. |
| `sources` | The files the text is based on (`modules/<id>/module.json` at least). **Every claim must be traceable to them.** Never invent a feature. |

## The texts

Plain words, friendly, benefit first. English and French with the same structure: same headings, same screenshots, same links.

- Sentences of 20 words at most, no exclamation mark, no jargon of the R9 list of the ergonomics kit (`tests/helpers/ergonomics.mjs`: key, service, API, token, instance…), no real person or real site. In French: *vous*, never *tu*.
- Sections, in this order: `## What it does`, `## Why you will like it`, `## How it looks` (only when there are screenshots), `## Works well with`, `## Good to know`, `## Since version X`.
- The Markdown is the subset the Curiosa renderer supports: `##` headings, lists, **bold**, links, images.
- A screenshot is written `![alt](shot:<file>)`: the sync replaces `shot:<file>` by the address of the uploaded image. A link to another module's entry is written `[Name](entry:<module-id>)`.

## Screenshots

Pictures are WebP, **80 KB at most**, 1280 px wide (390 px for a mobile shot), made from a throw-away demo site with **invented** data only (a streamer called "Etoile Nord", nicknames such as `lune_douce`, made-up games). Never a real name, nickname, address, cover or avatar, never a secret. Look at every picture before committing it. A module with no screen of its own (a connector) gets its admin settings. When pictures are added to an entry, add them to `entry.json` and add the section "How it looks" with `![alt](shot:<file>)` in both texts.

## Adding the entry of a new module (mandatory)

A new module is not finished without its entry: `node scripts/showcase-check.mjs` (and CI) fails when a module of `modules/` has no entry.

1. `modules/<id>/` exists with its `module.json` (names and descriptions in EN and FR).
2. Copy the folder of a similar module in `showcase/modules/` and adapt `entry.json`, `entry.en.md` and `entry.fr.md`. Use only facts from the module (its `module.json`, README, settings, tabs, sections, MCP tools); list the files in `sources`.
3. `node scripts/showcase-check.mjs --write` (rewrites `index.json`, then checks everything). Fix what it says.
4. Add screenshots when you can (see above).

When a module changes in a release, re-read its entry: the check warns when the module's version is newer than the entry's `moduleVersion` (update it once the text is right).

## Where the sync reads it

At a release tag `vX.Y.Z`, every picture has a fixed address:

```
https://raw.githubusercontent.com/helldog136/curiosa-extras/<tag>/showcase/modules/<id>/shots/<file>
```

The release also carries `showcase-bundle-<version>.json` (`node scripts/showcase-bundle.mjs <version>`): the index, all texts and, for each picture, its path, size, sha256 and this address. The sync uploads the pictures, replaces `shot:<file>` and `entry:<id>` in the texts, and publishes.

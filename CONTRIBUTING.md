# Contributing to the Curiosa modules

The language of the repository is **English**: documentation, code comments, identifiers, tests, commit messages and pull request descriptions. Only text shown to people (interface, help, errors, module descriptions, onboarding, e-mails) lives in the language files, in English **and** French with exact parity.

Admin pages follow [docs/ERGONOMIE-ADMIN.md](docs/ERGONOMIE-ADMIN.md); a pull request that touches one contains an "Ergonomics" section.

## Overlay elements: TV legibility

An overlay element is read from a distance, on a television or a phone. Every element declares `"tvScale": true` (with `"minCore": "0.11.0"`) and follows the TV type scale of the core ([OVERLAY-ELEMENTS.md, "Text size and TV legibility"](https://github.com/helldog136/Curiosa/blob/main/docs/OVERLAY-ELEMENTS.md)):

- Read `ov-tv` (a number above 0 and below 20, else 1) and define `--ov-tv` and `--ov-text-xs` to `--ov-text-2xl` (24, 28, 32, 40, 56 and 72 px of the 1080 canvas) on the root. Size every text with a token: `font-size: var(--ov-text-xs, 24px)`. Never multiply by the frame ratio or the text size again.
- **Nothing under 24 px on screen** (`xs`: captions and labels; `sm`: secondary text; `md`: body; `lg`: names and titles; `xl`, `2xl`: figures). Keep the visual hierarchy with the tokens, not with smaller text.
- The text keeps its size and the layout gives way: leave out the least useful lines or the last rows, cut a long text with an ellipsis (the full text in `title`), never shrink it. An element with nothing to show still shows nothing.
- Paint the panel with `var(--ov-surface, ...)` so the opaque background chosen by the person applies by itself.
- One test per element, using the shared helper `tests/helpers/tvLegibility.mjs` (`tvSuite`): the real page in Chromium at `ov-tv` 1 and 2, with invented data; it fails on a visible text under 24 px, a horizontal overflow or a clipped text. Set `TV_SHOTS=<folder>` to write the screenshots, and look at them.

## Where a module's settings go: places

Every module with settings or an admin panel says where they live in the admin, with `places` in `module.json` (core 0.31.0, [PLACES.md in the core](https://github.com/helldog136/Curiosa/blob/main/docs/PLACES.md)): `group.page[.tab]`, for example `networks.accounts` or `community.games.covers`. The vocabulary (groups, pages, tabs, EN and FR titles, one-line intro) is [catalogue/places.json](catalogue/places.json).

- Use the full form `places[]` with `fromTab` (the tab of the module whose panel and settings the section takes; `"settings"` is the default tab, with the "use" panel). Never `tabs[].place` and never a new `minCore`: a core older than 0.31.0 ignores `places` and keeps the old menu (`adminMenu` / `menuGroup` stay as they are).
- Pick a page of the vocabulary. A new page or tab is a minor release of the catalogue: add it to `places.json` with its EN and FR titles, then check the glossary (R12): two sidebar entries never share a name or a first word. Keep at most 5 tabs per page, and say why in `tabsReason` otherwise.
- Core limits: 3 sections of one module per page, 12 per module, 1 new group, a title of 40 characters at most. A module with more tabs than that on one page cannot be placed yet (Mascot: five tabs).
- Several modules on one page are fine and expected (Chat, Rewards, Figures, Other accounts): the section title is the module name unless the module has two sections on the same tab, then give each a `title`.
- A section on a page of the core (`site.home.banners`, `site.general.privacy`, `obs.pages.addresses`) is accepted, but the core does not show it there yet: the module keeps its own sidebar entry until it does.
- Content-only modules (Blog, Pages, Links, Codes, Collection) have no settings and declare no place.
- `tests/places.test.mjs` checks all of it: the vocabulary, the table of sections per module, the real previous manifests (an older core sees the same module), the kits `places.valid` and `places.budget`, and the sidebar of the four live sites (`tests/fixtures/places-menus.json`; `PLACES_MENUS_WRITE=1 npm test -- tests/places.test.mjs` rewrites it, read the diff).

## Removing an old data conversion

A module keeps its own data and converts it when its shape changes; the core has a support floor for itself, not for module data. Before you delete a `migrations` entry,
a hand-over of a secret or any compatibility code of a module, read [docs/MIGRATIONS.md](docs/MIGRATIONS.md): when it may go, the `dataFloor` and the bridge tag the removal release must declare,
and why a secret hand-over is removed in two releases.

## Adding a language

Anyone can, **with files only**. English and French are official and always complete; every other language is a community language and may be partial (empty texts are shown in English). The full guide, with the glossary and the tone, is [TRANSLATING.md in the core](https://github.com/helldog136/Curiosa/blob/dev/docs/TRANSLATING.md).

1. Clone the core next to this repository: `git clone https://github.com/helldog136/Curiosa ../Curiosa`.
2. `CURIOSA_DIR=../Curiosa node scripts/i18n-add-language.mjs <code>` writes `modules/<id>/locales/<code>.json` for every module (`--module blog` for one): every key, empty.
3. Translate what you can. `module.json` stays untouched: its texts are `manifest.<path>` keys of the same file.
4. `node scripts/build-index.mjs` (the catalogue then lists the language), then `CURIOSA_DIR=../Curiosa npm test -- tests/module-i18n.test.mjs`.
5. Open a pull request with the "New language" template (`?template=new-language.md`).

The legal pages module is special: its texts are help templates and a translation is never published automatically; it needs a person from the country.

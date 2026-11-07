# Data migrations of the extensions: the support floor of a module

Each extension keeps its own data (`dataVersion` in `module.json`) and converts it when the data changes shape (`migrations`). The core has a support floor for itself
(`upgrade.json`, [MIGRATIONS.md of the core](https://github.com/helldog136/Curiosa/blob/dev/docs/MIGRATIONS.md)); it does **not** cover module data, because modules are
updated one by one, independently of the core. This page is the rule for the modules of this repository.

## The vocabulary

| Word | Meaning |
|---|---|
| `dataVersion` | The shape of the data this version of the module writes (integer, never lowered: rule `data.versionMonotonic`). |
| `dataFloor` | The oldest data shape this version still knows how to convert (integer, between 1 and `dataVersion`, default 1). Data older than the floor is **not** converted: the instance is set aside (`error: "floor"`) with the message "install an intermediate version of this module first", and nothing is touched. |
| Bridge | The last release (git tag `vX.Y.Z` of this repository) whose module still contains the conversion that the floor leaves out. Bridges are **never deleted**: the tag stays for ever. |
| Hand-over | A module that keeps a secret or a setting for another module in `legacySettings`, and hands it over once. It is a conversion like the others, with one more rule (see below). |

## How a site gets through a bridge

The core does the chaining for modules: when a module is updated across several releases, it replays every tag between the installed release and the new one with
that tag's own code, one after the other, so each conversion runs in order (core `docs/MODULES.md`, section `migrations`). A site that is behind a floor therefore
normally updates in one click, **through the bridge**, as long as the update goes through the catalogue.

`dataFloor` is the safety net for the cases where the chain cannot run: a backup restored into a newer module, a module copied by hand, a module installed from a
personal repository at a given tag. There the instance is set aside, nothing is changed, and the message tells the person what to do. The bridge for that case is
the tag named in the table below: install the module at that tag, let it convert, then update.

## The rule

1. **When a conversion may be removed.** A conversion (a function of `migrations`, and everything that only it uses: helper files, notices, texts, tests, fixtures)
   may be deleted when **all** of these hold:
   - it was released at least **two minor releases of the module** ago (so the bridge is already in the catalogue history);
   - its own release notes said it was temporary ("to be removed in phase 3" in the code or the README);
   - it has **no step that depends on a person** (a button to click, a category to create): such a conversion first needs a release that finishes it on its own;
   - it leaves nothing behind that the module would then stop looking after (personal data included): a leftover copy is declared in `legacyCollections`, and a
     privacy branch (`privacy.subject`) that reads or erases it stays until the copy is gone (see "Leftovers").
2. **What the removal release must do.**
   - set `dataFloor` to the `dataVersion` the removed conversion produced (the instance cannot skip it silently);
   - keep `dataVersion` as it is (never lower it) and keep a `migrations` entry for that number as an empty marker: the kit rule `data.version` refuses a
     `dataVersion` above 1 without any migration, and the entry is never run on data that is already at that version;
   - add the module to the table below with the bridge tag (the last tag that contained the conversion);
   - say it in the changelog part of the release: what was removed, the floor, the bridge, and "older sites update through the bridge";
   - bump the module (minor), the README, the showcase entry and the catalogue index.
3. **Leftovers.** Whatever the conversion left in the store (an inert copy, a state document) is listed in `legacyCollections` of the manifest, so the *Upkeep*
   page of the core counts it and the person can see it. It stays declared **one more release** after the code is gone; a copy the module promises never to read
   again is also in `inertLegacyCollections`, which is what lets the person delete it from that page. Removing the declaration comes last.
4. **Hand-overs of secrets** (a key, a URL that is a secret, client credentials) go in **two steps**, in two releases, because the core clears only **empty**
   legacy values and a value left behind would stay hidden for ever:
   - step 1: no useless background task; the hand-over runs at the data update and again when the person opens the module page; a leftover value stays visible in the *Upkeep* page (Live status 1.4.4 is at this step);
   - step 2 (the next release, after step 1 has been out): delete the hand-over code, and clear the remaining values in the same release only if the new owner of the secret has confirmed it.
5. **Never** remove, in the same release as the code, the thing that lets a leftover be seen or deleted.

## Not removed yet, and why

| Conversion | Why it stays |
|---|---|
| Twitch raid 2.0 (`migrate.mjs`, data version 3) | Its last steps are done by the person (a button "Continue the copy", then a category to create and fill), and its progress lives in a document outside `dataVersion`: a floor cannot protect a site that is half way. It first needs a release that finishes on its own. The old list it leaves behind is also still read by the privacy branch. |
| Hand-overs of secrets (Planning, YouTube channel, Twitch channel, Live status, Game suggestions) | Step 2 of rule 4, in the release after Live status 1.4.4. |
| Twitch bot timers, `legacyKey` of stream events, countdown `legacyHead`, "legacy" actions of the bot | No proof that nothing uses them any more. |

## Floors in force

| Module | `dataVersion` | `dataFloor` | Since | Bridge tag (last release with the conversion) | What the bridge converts |
|---|---|---|---|---|---|
| contacts | 2 | 2 | next release | `v1.50.0` (Contacts 2.4.1) | organisation text to organisation cards, notes keyed by card |
| partnerships | 2 | 2 | next release | `v1.50.0` (Partnerships 2.1.0) | contacts of the 1.x address book moved into Contacts |
| stream-story | 2 | 2 | next release | `v1.50.0` (Announcement story 2.8.0) | the 1.x co-streamer list moved into Contacts |

A test (`tests/module-data-floor.test.mjs`) checks that every module with a `dataFloor` above 1 is in this table with a bridge tag that exists in the git history.

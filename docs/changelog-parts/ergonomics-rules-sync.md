## Ergonomics rules synced with the core (R34 to R37)

*Documentation only: no module is touched, no version changes. `docs/ERGONOMIE-ADMIN.md` is now byte-identical to the copy on the `dev` branch of the core repository.*

### For developers

- New rules copied from the core: **R34** (one word, "module", for an installed piece), **R35** (people only see what they can open), **R36** (one page, one title, the same everywhere), **R37** (a row switch does not write its state), plus their four lines in the checklist.
- The ergonomics kit copy (`tests/helpers/ergonomics.mjs`) was already identical to `testsupport/ergonomics.mjs` in the core: nothing to change.
- The terms swept by R34 in module texts are only reported for now (see the pull request); they are not changed here.

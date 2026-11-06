## Module showcase: one entry per module (repository tooling, no module changes)

*No module version is bumped.*

### For developers

- `showcase/` is the source of truth of the business showcase of the Curiosa site ("Modules" blog): one entry per module (`entry.json`, `entry.en.md`, `entry.fr.md`, `shots/*.webp`), categories, an index and a README that explains the layout and how a new module adds its entry (now a mandatory step, see the README and the new-module pull request template).
- `scripts/showcase-check.mjs` (and `tests/showcase-check.test.mjs`, plus a step in the CI) fails when a module has no entry, a file or a module an entry points to is missing, English and French differ, a text is too long or contains jargon or an exclamation mark, a picture is over 80 KB, or `since`/`requires` do not match the module.
- `scripts/showcase-bundle.mjs <version>` writes `showcase-bundle-<version>.json`, attached to each release by the release workflow.

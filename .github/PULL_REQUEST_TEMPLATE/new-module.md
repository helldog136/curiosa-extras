<!-- New module. Open with: .../compare/dev...your-branch?template=new-module.md -->
## New module

- Module id and name: 
- What it does, in one sentence: 

## Checks

- [ ] `module.json`: names and descriptions in English and French, `minCore`, honest `permissions`, `privacy` text when it keeps anything about visitors.
- [ ] `node scripts/build-index.mjs` run: `catalogue/index.json` lists the module.
- [ ] **Showcase entry** (mandatory): `showcase/modules/<id>/` with `entry.json`, `entry.en.md`, `entry.fr.md` (and screenshots, invented data only, every picture looked at); `node scripts/showcase-check.mjs --write` passes. See [showcase/README.md](../../showcase/README.md).
- [ ] `previews` declared in `module.json` and `node scripts/shoot-previews.mjs --check` passes (see the README, "Les visuels des fiches").
- [ ] Tests pass: `CURIOSA_DIR=../Curiosa npm test`.

## Ergonomics

Section required when a configuration page is added or changed: main task, visible fields, clicks, what is folded and why, and the result of `admin.ergonomics` (see `docs/ERGONOMIE-ADMIN.md`).

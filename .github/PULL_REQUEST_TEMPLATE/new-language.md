<!-- New language for the extensions. Open with: .../compare/dev...your-branch?template=new-language.md -->
## New language

- Language (two-letter code and name in itself): 
- Extensions translated: all / these: ___
- Status: `community` (English and French are the only official languages)
- Pull request in the core for the interface (`src/locales/<code>.json`): ___

## What is translated

- [ ] Created with `node scripts/i18n-add-language.mjs <code>` (skeleton in `modules/<id>/locales/<code>.json`), not by hand.
- [ ] `module.json` is not edited: manifest texts are `manifest.<path>` keys of `locales/<code>.json`.
- [ ] A partial translation is welcome: empty texts fall back to English.

## Checks

- [ ] `{variables}` unchanged (the test `tests/module-i18n.test.mjs` checks it).
- [ ] Tone and glossary of [TRANSLATING.md](https://github.com/helldog136/Curiosa/blob/dev/docs/TRANSLATING.md): polite, short, no exclamation mark, no ALL CAPS.
- [ ] No legal template translated for publication: the legal pages extension stays "to be reviewed by a person from the country".
- [ ] No real person's name, no real site in examples.
- [ ] `CURIOSA_DIR=../Curiosa npm test -- tests/module-i18n.test.mjs` passes.
- [ ] `node scripts/build-index.mjs` run: `catalogue/index.json` lists the new language.

## Ergonomics

Only language files change: no page, field or control is added or moved (rules R1 to R28 are untouched). R29 (English and French in exact parity) is unaffected: English and French are not modified.

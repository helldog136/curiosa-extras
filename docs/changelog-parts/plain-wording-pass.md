## Plain wording: Legal pages, Twitch bot, Thanks wall / Des mots simples : Pages légales, Bot Twitch, Mur de remerciements

*EN: Legal pages 1.1.4, Twitch bot 1.24.5 and Thanks wall 1.5.1. Texts only, nothing changes in how they work.*
*FR : Pages légales 1.1.4, Bot Twitch 1.24.5 et Mur de remerciements 1.5.1. Textes seulement, rien ne change dans leur fonctionnement.*

### What changes for you / Ce qui change pour vous

- **EN: shorter, plainer texts.** Long sentences are split, trailing colons and long parentheses are gone, exclamation marks are removed, and "extension" or "service" now read "module" or "site". Legal facts in the Legal pages templates are unchanged.
- **FR : des textes plus courts et plus simples.** Les phrases longues sont coupées, les deux-points finaux et les longues parenthèses ont disparu, les points d'exclamation sont retirés, et « extension » ou « service » deviennent « module » ou « site ». Les faits juridiques des modèles de Pages légales ne changent pas.

### For developers

- Known gaps of `tests/ergonomics-baseline.json` go from 478 to 335 (shrink only): Legal pages 93 to 12 (legal acronyms kept), Twitch bot 39 to 0, Thanks wall 23 to 0. Version pins in tests follow the new versions; the Thanks wall 1.0.2 golden comparison maps the rewritten texts explicitly.

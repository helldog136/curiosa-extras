## Blog 1.2.0: the list display becomes cards, with an optional search field / Blog 1.2.0 : l'affichage en liste devient des cartes, avec un champ de recherche facultatif

*EN: the "list" display of a blog is now a series of full-width cards, and a search field can filter the list while visitors type. For Curiosa 0.6.18 or later. Module touched: Blog 1.2.0.*
*FR : l'affichage « liste » d'un blog devient une suite de cartes pleine largeur, et un champ de recherche peut filtrer la liste pendant que le public tape. Pour Curiosa 0.6.18 ou plus. Module touché : Blog 1.2.0.*

### What changes for you / Ce qui change pour vous

- **EN: A list that looks like your cards.** Each article has a frame with its title and its summary, cut with "…" when long, the same height everywhere, and the whole row opens the article. It follows your skin, light or dark, on a phone or a computer.
- **FR : une liste qui ressemble à vos cartes.** Chaque article a un cadre avec son titre et son résumé, coupés par « … » s'ils sont longs, la même hauteur partout, et toute la ligne ouvre l'article. Elle suit votre skin, en clair comme en sombre, sur téléphone comme sur ordinateur.
- **EN: A search field above the list.** It filters while typing, with no button or reload, ignoring capitals and accents, and also searches the other pages of a long blog. "Show a search field" is in the General tab of each blog; it is on by default in list display.
- **FR : un champ de recherche au-dessus de la liste.** Il filtre pendant la frappe, sans bouton ni rechargement, sans tenir compte des majuscules ni des accents, et cherche aussi dans les autres pages d'un long blog. « Afficher un champ de recherche » est dans l'onglet Général de chaque blog ; il est activé d'office en affichage liste.

### For developers

- **Blog 1.2.0**: `minCore` set to **0.6.18** (core pull request "Public list: card rows and an optional live search field"). No code, no setting, no migration, no new permission in the module: the rows, the search and the per-blog setting (`instance.<id>.__search`, optional manifest key `content.search`) belong to the core. An older core does not offer this version (`minCore`) and keeps Blog 1.1.1 with the old list.
- Showcase entry (`moduleVersion`, texts) and README updated.

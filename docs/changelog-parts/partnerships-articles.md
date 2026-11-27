## Partnerships 2.6.0: your published articles and your partner files tell the same story / Partenariats 2.6.0 : vos articles publiés et vos fiches racontent la même histoire

*EN: Partnerships 2.6.0. Nothing to set up: it works with the articles module called "sponsoring".*
*FR : Partenariats 2.6.0. Rien à régler : cela marche avec le module d'articles nommé « sponsoring ».*

### What changes for you / Ce qui change pour vous

- **EN: each file shows whether its article is published.** The overview gets an "Article" column: "Published" with a link, or "No published article" for a file marked Published.
- **FR : chaque fiche dit si son article est publié.** La vue d'ensemble a une colonne « Article » : « Publié » avec un lien, ou « Aucun article publié » pour une fiche marquée Publié.
- **EN: a published article that has no file now appears in the list.** It counts as Published and a button "Add the file" creates the file from it, in one click.
- **FR : un article publié qui n'a pas de fiche apparaît maintenant dans la liste.** Il compte comme Publié et un bouton « Ajouter la fiche » crée la fiche à partir de lui, en un clic.
- **EN: the two numbers of the overview agree.** The number in the title was one lower than the "n of N" of the search, because it left out closed files. Both now count the rows of the table.
- **FR : les deux nombres de la vue d'ensemble concordent.** Le nombre du titre était inférieur d'un à celui de la recherche (« n sur N »), car il écartait les fiches closes. Les deux comptent maintenant les lignes du tableau.

### For developers

- `partnerships` 2.5.1 to 2.6.0: `articleId` (a published article chosen on the file, at most 80 characters) and `fromArticle` on a file; `loadArticles` and `pairArticles` in `data.mjs` read `ctx.api.entries.list({ instance, limit: 200 })` only; advanced setting `articlesKey` (default `sponsoring`). `minCore` unchanged: an older core has no `ctx.api.entries` and keeps the old table. New test `tests/partnerships-articles.test.mjs`.

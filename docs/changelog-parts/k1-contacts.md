### Contacts 2.0.0 (lot K1)

#### Nouveautés
- **Contacts 2.0** : le carnet gère maintenant les **organisations** (une personne y est rattachée avec sa fonction), les **comptes** sur les réseaux (Twitch, YouTube, TikTok, Instagram, Discord, X, Bluesky, Mastodon, site web) — collez le lien du profil ou tapez le pseudo —, des **catégories** (créer, renommer, « Mettre dans… », supprimer sans perdre aucune fiche) et une **photo** (automatique, celle du compte qui a le plus d'abonnés, ou choisie à la main).
- Nouvelle page **Contacts** pensée pour le téléphone : des cartes avec photo, organisation et petites icônes des réseaux, une recherche en haut (accents et majuscules ignorés), des filtres d'un clic et « Voir la suite ».
- Quand une fiche a un compte Twitch ou YouTube, Contacts propose d'installer ce qui relie votre site à ce service.
- Nouveaux droits pour vos rôles : « voir les e-mails et téléphones », « exporter le carnet », « créer des catégories ».

#### Améliorations
- Vos fiches gardent tout à la mise à jour : le texte « organisation » devient une fiche organisation (une seule par nom), les notes restent, les liens de Partenariats restent valables. Le texte « Autres canaux » est gardé ; les comptes qu'on y repère s'ajoutent d'un clic.
- Les erreurs s'affichent sous le champ concerné et disent quoi faire.
- Supprimer une fiche prévient les modules qui la citaient ; s'il y en a un qui ne répond pas, le message le dit.
- L'assistant (MCP) ne voit plus les e-mails ni les téléphones dans la liste ; toutes ses écritures doivent être accordées explicitement.

#### Pour les développeurs
- `contacts` 2.0.0, `minCore` 0.2.1, `dataVersion` 2 (migration rejouable, testée sur 2 000 puis 10 000 fiches, stockage en mémoire et vrai SQLite). Offre `contact.book` **version 2** (contrat de `tests/contract/`, passé par le vrai module : `tests/contacts-v2-contract.test.mjs`) et `contact.store` inchangé ; requiert en facultatif `privacy.subject`, `twitch.api` (≥ 3), `youtube.api` (régénérer `catalogue/index.json` : besoins facultatifs).
- Index mémoire borné invalidé par `store.generation()` et un tampon d'écriture ; reconstruction par pages, attentes avec expiration ; plafond 100 000 fiches ; options de test internes `ctx.__contactsTest`.
- Nouveau double de stockage fidèle au contrat 5 : `tests/helpers/contactsStore.mjs` (clés, curseurs, `addMany`, `generation`, pannes « trou noir »).

<!-- Lignes de CHANGELOG du lot R3 (Raid Twitch 2.1, Contacts 2.2). L'orchestrateur les assemble dans CHANGELOG.md. -->

### Nouveautés

- **« Raid Twitch » 2.1 : ajouter une chaîne en quelques secondes.** Un champ « Ajouter une chaîne » en haut de la page : tapez un nom pour le chercher dans vos contacts, ou un pseudo Twitch, un @pseudo ou un lien twitch.tv/… pour l'ajouter tout de suite. Plus besoin de remplir une fiche de Contacts : le nom et la photo sont repris sur Twitch tout seuls.
- **La liste « Cible de raid » se crée toute seule** dans Contacts à votre premier ajout. Vous n'avez rien à préparer.
- **Une personne de vos contacts n'a pas de chaîne Twitch ?** Raid le dit (« pas de chaîne Twitch ») et vous tapez son pseudo : il est ajouté à sa fiche, sans doublon. Personne ne correspond ? Un seul bouton « Créer … » fait la fiche avec ce seul pseudo.
- **Coller plusieurs chaînes d'un coup** (un pseudo ou un lien par ligne, 200 au plus). Un aperçu dit combien sont nouvelles, déjà dans Contacts, déjà dans votre liste ou invalides (avec la raison et un exemple) avant d'ajouter quoi que ce soit. Refaire le même envoi ne double rien.
- **« Retirer » sur chaque chaîne de la liste.** La liste se lit 50 par page et se cherche. « Retirer » sort la chaîne de la liste de raid seulement : sa fiche reste dans Contacts.

### Améliorations

- Une faute de frappe dans un pseudo est repérée (« Twitch ne connaît pas … ») au lieu de créer une fiche pour rien. Sans réponse de Twitch, l'ajout marche quand même : la fiche prend le pseudo comme nom et Contacts la complétera à sa première ouverture.
- Chaque erreur s'affiche sous le champ concerné et dit quoi faire. Les noms déjà saisis dans une fiche ne sont jamais changés.
- « Ranger mes chaînes » (venue de la version 1) crée aussi la catégorie toute seule si elle manque.
- **Contacts 2.2** : de quoi retrouver, chercher et ranger des comptes pour Raid (ajouter un compte à une fiche existante, sortir une fiche d'une catégorie). Rien ne change pour vous dans Contacts.

### Pour les développeurs

- Nouveau service `contact.curate` v1 offert par Contacts (extension additive, `tests/contract-ext/` : texte, double `tests/helpers/fakeContactCurate.mjs` et suite exécutable passée par le double et par le vrai module) : `lookupAccounts`, `searchAccounts`, `addAccount`, `removeCategory`. Le contrat `contact.book` v2 et ses fichiers d'exécution ne changent pas. À valider avant d'être reporté dans `docs/V2-CONTRACTS.md` du cœur.
- `offers[].callerRights: ["createCategory"]` sur `contact.book` : Raid appelle `createCategory` avec `{ asCaller: true }` depuis une action d'administration (cœur 0.2.4 ; branche `core/service-caller-rights`). Sur un cœur 0.2.2 ou 0.2.3, l'appel reste `denied` et Raid dit de créer la catégorie dans Contacts ; tout le reste marche. `tests/helpers/callerRights.mjs` simule le cœur pour les tests.
- Raid : `quick.mjs` (ajout, retrait, liste par pages, envoi en gros avec aperçu et reprise), `add-admin.mjs` (blocs et actions), `profiles.mjs` (`GET users` par 100 via `twitch.api`, attente bornée, trou noir et 429 testés), `settings.mjs`. Le dock et sa lecture de la liste ne changent pas.

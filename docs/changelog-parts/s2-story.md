### Nouveautés

- **« Story d'annonce » 2.0 : vos co-streamers viennent de Contacts.** Tapez un nom ou un pseudo (sur n'importe quel réseau) : la liste montre la photo et les comptes de chaque personne, et un clic l'ajoute à la vidéo (6 au plus). Plus besoin de retaper un nom ou de recoller une photo : ils restent dans Contacts, et une correction faite là-bas se retrouve dans vos vidéos.
- **« Ajouter depuis une catégorie de Contacts ».** Choisissez une catégorie (par exemple celle de vos cibles de raid) et ajoutez ses personnes une à une, ou remplissez d'un clic les places libres de la vidéo. Ce bouton remplace « Reprendre mes partenaires de Raid Twitch ».
- **Sans Contacts, rien ne casse.** Vous pouvez toujours ajouter quelqu'un « pour cette vidéo seulement » (un pseudo, un nom, une photo, tous facultatifs) : cette personne n'est jamais enregistrée dans Contacts. Le panneau propose d'installer un module qui tient vos contacts, sans rien installer sans votre clic.

### Améliorations

- **Votre liste de co-streamers passe dans Contacts toute seule.** À la mise à jour, chaque personne de « Ma liste de co-streamers » devient une fiche de Contacts (ou retrouve celle qu'elle avait déjà), avec sa photo, et vos modèles enregistrés suivent. Rien n'est perdu : si Contacts n'est pas installé, la liste reste, elle est proposée comme « ponctuels », et le passage se fait dès que Contacts arrive. Le faire deux fois ne crée aucun doublon.
- **Les photos de Contacts s'affichent dans la vidéo** quand elles viennent de Twitch, YouTube ou Bluesky (ou d'une photo choisie dans Contacts sur l'un de ces sites). Sinon, la vidéo montre les initiales de la personne.
- Si Contacts ne répond pas, l'éditeur le dit et continue de marcher : la recherche attend quelques secondes au plus.

### Pour les développeurs

- `stream-story` 2.0.0 (`minCore` 0.2.1, `dataVersion` 2) : `requires: [{ service: "contact.book", min: 2, optional: true }]`, `offers: [{ service: "privacy.subject", each: true }]` (export, effacement et suivi des fusions sur les références gardées dans les modèles et les préparations). Le sujet `stream.partner` n'est plus consommé (aucun autre module du dépôt ne le lisait) : le module Raid peut cesser de l'offrir.
- Un co-streamer d'une vidéo est `{ id }` (référence de fiche, rien d'autre) ou `{ login, name, image }` (saisie pour cette vidéo seulement) ; un modèle de la version 1 (liste de pseudos) reste lisible. Nouvelles routes de l'éditeur : `people`, `members`, `categories`, `category` ; `costreamer.*` et `costreamers.import` disparaissent. Le document `story_costreamers` n'existe plus qu'avant la migration ; `story_adhoc` (20 au plus) garde les personnes que Contacts n'a pas pu accueillir.
- Migration 2 (« à retirer en phase 3 », `migrate.mjs`) : `upsertByAccount({ network: "twitch", handle, kind: "person", name?, source: "stream-story" })` par ancien co-streamer, `setAccountProfile` pour la photo quand l'hôte est relayable, puis les pseudos des modèles et préparations deviennent des identifiants. Sans `contact.book` v2, muet ou en panne : rien n'est touché, et la route `data` (ouverture de l'éditeur) la rejoue, une passe à la fois, bornée.
- Relais d'images : ajout de `yt3.ggpht.com`, `yt3.googleusercontent.com` et `cdn.bsky.app` (chemins exacts), mêmes bornes (3 Mo, aucune redirection, type lu dans les premiers octets). Une photo sur un autre hôte n'est pas relayée.
- Tests : `stream-story-contacts` (contre `fakeContactBook`), `stream-story-editor` (l'éditeur dans un faux navigateur) ; `hang-stream-story` (Contacts muet, migration bornée) ; le test « trou noir » du sujet `stream.partner` de Raid sort de ce fichier (il appartient au module Raid).

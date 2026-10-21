<!-- Lot R2 : Raid Twitch 2.0.0 (livraison « Contacts 2.0 ») -->

### Nouveautés

- **« Raid Twitch » 2.0 : votre liste de raid vit dans Contacts.** Vos partenaires à raider sont les personnes d'une catégorie de Contacts, « Cible de raid » par défaut, qui ont une chaîne Twitch. Une personne a une seule fiche pour tout le site : son nom et sa photo servent partout, et vous les changez à un seul endroit. Pas encore de catégorie ? Dans le réglage « Liste de raid », tapez « Cible de raid » puis « Créer ».
- **Rien à refaire en venant de la 1.x.** À la mise à jour, votre ancienne liste passe toute seule dans Contacts : une fiche par chaîne (jamais en double), avec le nom que vous aviez donné, et vos notes deviennent des notes des fiches. Si la catégorie « Cible de raid » n'existe pas encore, la page de Raid vous demande une dernière étape (la créer, puis « Ranger mes chaînes dans cette catégorie ») ; en attendant, le dock continue de marcher. Votre ancienne liste reste gardée telle quelle.

### Améliorations

- **Le dock ne change pas** : mêmes membres en direct, même tri, même bouton « au hasard » au-delà de 500 chaînes, même adresse secrète. Seule l'origine de la liste change.
- **La page de Raid est plus simple** : le nombre de chaînes, l'état du dock et un lien « Gérer mes partenaires dans Contacts ». Ajouter, importer, chercher ou retirer des partenaires se fait dans Contacts.
- **Si la catégorie choisie disparaît**, la page et le dock disent « La catégorie choisie n'existe plus, choisissez-en une » ; si elle a été fusionnée avec une autre, Raid suit tout seul. **Si Contacts ne répond pas un moment**, le dock garde la dernière liste connue (10 minutes au plus) puis le dit clairement. **Sans Contacts**, la page propose de l'installer.
- **Vie privée** : une personne effacée dans Contacts est aussi retirée de ce que Raid garde, et l'export « tout ce que le site sait de cette personne » inclut la part de Raid.

### Pour les développeurs

- `twitch-raid` 2.0.0 : `minCore` 0.2.1, `dataVersion` 3 (migration `3` : `upsertByAccount` par lots de 100 avec point de reprise `contactsMigration`, idempotente, ne lève pas pour une panne de Contacts, ancien document `partners` intact ; à retirer en phase 3). `requires` : `contact.book` `min: 2` (dur) ; `offers` : `privacy.subject` (`each`). Nouveau réglage `category` (`choice`, source `service` `categories` / `categoriesResolve` / `createCategory`, `allowCreate`, `refersTo: "category"`, facultatif). Raid n'appelle jamais `createCategory` lui-même.
- La liste est lue par `accounts({ network: "twitch", categoryId, cursor, limit: 500 })` (10 000 comptes au plus), gardée 30 s et partagée, bornée (4,5 s), avec la dernière liste connue 10 minutes en cas de panne. La logique du dock (paquets de 100, 3 en parallèle, mode « au hasard », souvenir d'une minute, plafond) est inchangée.
- Sortis : l'administration de la liste (ajout, import par collage, pages, recherche, monter/descendre), `backup.readable`, l'appel `GET users` (photos lues dans Contacts). Le sujet `stream.partner` reste (lu par Story) mais vient de Contacts.
- Délais du dock dans le navigateur : 14 s pour `live`, 18 s pour `pick` (lecture de Contacts comprise).

## Contacts 2.3.0 : ajouter une personne en quelques secondes

*Pour Curiosa 0.2.2 ou plus. Module touché : Contacts 2.3.0.*

### Améliorations
- **« Nouvelle personne » ne montre plus tout d'un coup.** Le formulaire a deux onglets. **Ajouter via** (celui qui s'ouvre) : on choisit la plateforme, on colle un lien ou on tape un pseudo, et c'est enregistré. Le nom affiché est facultatif (le pseudo sert de nom, ou le nom trouvé sur Twitch ou YouTube quand leur connecteur est installé). **Ajout manuel** : fonction, organisation, e-mail, téléphone, relation, catégories, et deux emplacements pour des comptes.
- **Les plateformes proposées sont celles de votre site** : celles dont le connecteur est installé, celles qui ont déjà un compte dans votre carnet, ou les plus courantes quand il n'y en a aucune. La dernière plateforme utilisée est déjà choisie.
- **Chaque erreur est sous le champ, avec un exemple** : un lien YouTube alors que Twitch est choisi, une vidéo au lieu d'une chaîne, un pseudo trop court…
- **Pas de seconde fiche par erreur** : si le compte est déjà dans le carnet, le site propose d'ouvrir la fiche existante.
- **La fiche s'ouvre juste après**, avec un message pour la compléter ; d'autres comptes s'ajoutent comme avant.
- **« Statut » quitte le formulaire** (il ne servait qu'aux messages du formulaire de contact, qui ont leur bouton « C'est vérifié » sur la fiche). Les catégories se lisent « Dans la catégorie « Cible de raid » », avec une phrase d'aide.
- Textes sans accord de genre (« Par exemple : responsable des partenariats », « Écrivez le nom de l'organisation… »).

### Pour les développeurs
- `contacts` 2.3.0, `minCore` et `apiVersion` inchangés, aucune migration, un fichier serveur de plus (`quick.mjs`, importé avec la version). `networks.checkAccountInput` (pure, sans réseau) ; `book.saveCard` accepte `accounts` à la création (`account_taken`) ; `photos.hasProvider` exporté. Outils MCP, services et droits inchangés ; le connecteur Twitch ou YouTube reste un besoin facultatif.
- Tests : `tests/contacts-quick-add.test.mjs` (nouveau), `tests/contacts-v2.test.mjs` (version).

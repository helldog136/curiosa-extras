### Contacts 2.1.0 (lot K2)

#### Nouveautés
- **Importer vos contacts depuis un tableur.** Collez vos lignes ou choisissez un fichier CSV (5 Mo au plus, jusqu'à 100 000 lignes). Avant que quoi que ce soit soit ajouté, vous voyez un aperçu : fiches créées, fiches complétées, déjà dans le carnet, lignes à corriger, avec pour chaque ligne la raison et un exemple. Un modèle à remplir est à télécharger.
- **Réimporter le même fichier ne crée aucun doublon.** Une fiche qui existe déjà est complétée (un compte, une catégorie, une note, un champ vide en plus), jamais renommée.
- **Exporter tout le carnet en un clic** (CSV, avec le droit « exporter le carnet »). Le fichier a les mêmes colonnes que l'import : exporté puis réimporté, le carnet redevient identique.
- **Doublons : une page pour réunir deux fiches.** Le carnet repère les fiches qui se ressemblent (même compte, même e-mail, même nom dans la même organisation, nom presque identique). Vous comparez, choisissez la fiche à garder, lisez ce qui sera repris, puis validez. Tant que vous n'avez pas validé, rien ne change. Les autres modules sont prévenus et suivent.
- **Tout ce que le site sait d'une personne.** Sur chaque fiche, un bouton télécharge sa fiche, ses notes et ce que les autres modules gardent sur elle. Un autre bouton l'efface partout, après une case à cocher, avec un bilan module par module (« n'a pas répondu à temps » si l'un d'eux est muet).
- **« Actualiser la photo ».** La photo et le nombre d'abonnés se mettent à jour quand vous ouvrez une fiche (si elle date de plus de 24 h) ou quand vous cliquez : jamais en arrière-plan. Twitch et YouTube demandent leur connecteur (la fiche le propose), Bluesky marche tout seul.
- **La page du module s'ouvre sur « Mes contacts ».**

#### Améliorations
- **Mettre une fiche dans une catégorie se fait en deux gestes** sur la fiche : un choix et un bouton, sans cocher une liste de centaines de catégories.
- **Les gros imports ne bloquent rien.** Ils avancent par petits paquets avec une barre de progression, et reprennent là où ils en étaient si la page se ferme ou si le site redémarre.
- **Aucun écran ne déborde sur téléphone** : les tableaux n'ont qu'une colonne et les textes longs passent à la ligne.
- **Quand un service (Twitch, YouTube, Bluesky) ne répond pas ou demande une pause**, la fiche s'ouvre quand même et garde ses dernières données ; elle ne réessaie pas avant 10 minutes.

#### Pour les développeurs
- `contacts` 2.1.0, `minCore` 0.2.2 (`tabs` : « Utiliser » devient « Mes contacts », un seul onglet renommé, règle `tabs.reasonable`), `dataVersion` 2 (aucune migration : les nouvelles collections `imports`, `importRows`, `importLog`, `notdup`, `reports` sont bornées et créées à la demande). Le contrat de `contact.book` n'est pas modifié.
- Nouveaux fichiers : `csv.mjs`, `import.mjs` (`stage`, `step("preview" | "run")`, `evaluate` unique pour l'aperçu et l'import), `export.mjs` et `downloads.mjs` (`adminDownloads` : `contacts` avec le droit `export`, `template`, `importReport`, `person`), `dedupe.mjs` (`planMerge` partagé avec `merge`), `privacy.mjs`, `photos.mjs`, écrans `*-admin.mjs`.
- Bornes : import 100 000 lignes, paquets de 200, 100 lignes par verrou, 8 s par pas, un pas abandonné au bout de 28 s si le stockage ne répond plus ; export par pages de 500 ; doublons 20 groupes par page, 5 000 gardés ; photos 6 s, 10 comptes par service. Mesures à 2 000, 10 000 et 100 000 fiches dans `tests/contacts-volume.test.mjs` (stockage en mémoire fidèle au contrat 5).
- L'index mémoire garde l'e-mail de chaque fiche (`m`) pour le détecteur.

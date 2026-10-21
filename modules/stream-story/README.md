# Story d'annonce

Vous allez streamer et vous voulez le dire sur Instagram ? Ce module fabrique pour vous **une petite vidéo animée** qui annonce votre prochain stream : son titre, le jour et l'heure, un compte à rebours (« Dans 2 h 15 », « Ce soir à 19 h 30 », « Demain »), le jeu et sa jaquette, votre logo, les amis qui vous accompagnent, et même une phrase de votre choix. Vous la regardez bouger avant de la fabriquer, puis vous **téléchargez le fichier** et le publiez en story.

Rien à installer sur votre ordinateur, rien à régler pour commencer : tout se passe dans la page du module.

## Pour commencer
1. **Installez le module.** Si vous avez un agenda (« Agenda en ligne » ou « Streams saisis à la main », dans le catalogue), vos prochains streams apparaissent tout seuls. Sans agenda, le module vous dit quoi installer, et vous pouvez **écrire le stream à la main** (titre, jour, heure) pour la vidéo.
2. **Ouvrez la page du module** (« Story d'annonce » dans le menu, ou dans Extensions).
3. **Choisissez** le stream, ce que la vidéo montre, le style, le format et la durée.
4. **Regardez l'aperçu**, puis cliquez sur **« Générer la vidéo »**. Une barre vous montre l'avancement, et un bouton « Annuler » arrête tout quand vous voulez. Le fichier se télécharge : il s'appelle par exemple `annonce-2026-10-22-vertical.mp4`.

## Ce que vous choisissez, à chaque vidéo
- **Le stream** : le prochain par défaut, ou un autre parmi les suivants, ou un stream que vous écrivez vous-même.
- **Ce qui s'affiche** (chaque élément se coche ou se décoche) : le titre, le jour et l'heure, le compte à rebours, le jeu et sa jaquette (quand on la connaît), le logo et le nom de votre chaîne, votre phrase, les co-streamers.
- **Votre phrase** : 140 caractères au plus, sur 3 lignes au plus. Elle s'écrit telle que vous la tapez.
- **Le style** (le contenu est le même, seule l'animation change) :
  - **Néon / glitch** : un texte lumineux qui clignote et se brouille, sur fond sombre.
  - **Affiche qui glisse** : la jaquette et le titre entrent en glissant, comme une affiche de film.
  - **Compte à rebours animé** : de gros chiffres défilent jusqu'à l'heure du stream.
  - **Minimal / texte seul** : un fond uni, le texte apparaît lettre par lettre.
- **Le format** :
  - **Vertical (9:16)** : 1080 × 1920, le format d'une story.
  - **Passeport (4:5)** : 1080 × 1350, le portrait presque carré d'Instagram.
- **La durée** : de 5 à 15 secondes (15 par défaut, la durée d'une story).
- **La langue des mots écrits dans la vidéo** : français ou anglais (les jours, le compte à rebours).

La vidéo est **muette**, ce qui convient très bien à Instagram. Les couleurs et le logo sont ceux de votre site.

## Les zones de sécurité
Instagram cache une partie de l'image : en haut et en bas d'une story (le nom du compte, la barre de réponse), et sur les côtés d'un portrait quand il s'affiche dans la grille du profil. Le module garde **tout ce qui compte au milieu**, dans des marges sûres (vertical : environ 250 pixels en haut, 340 en bas et 64 de chaque côté ; passeport : 60 en haut et en bas, 64 de chaque côté).

Pour vérifier, cochez **« Montrer les zones de sécurité »** : elles apparaissent hachurées sur l'aperçu, avec leur explication. Elles ne sont **jamais** dessinées dans la vidéo.

## Vos co-streamers
Ils viennent de **Contacts** : Story n'en garde ni le nom, ni les pseudos, ni la photo, seulement le numéro de la fiche (donc rien à retaper, et un nom corrigé dans Contacts l'est aussi dans vos vidéos).
- **Chercher dans mes contacts** : tapez un nom ou un pseudo (2 lettres au moins), sur n'importe quel réseau. La liste montre la photo et les comptes de chaque personne (Twitch, YouTube…). Un clic sur **Ajouter** la met dans la vidéo (**6 au plus**). Sans photo connue, la vidéo montre ses initiales dans un cercle de couleur.
- **Ajouter depuis une catégorie de Contacts** : choisissez une catégorie (par exemple celle de vos cibles de raid), ajoutez les personnes une à une, ou cliquez sur **« Ajouter les premiers »** pour remplir les places libres. Seuls les comptes Twitch de la catégorie sont proposés.
- **Pour une seule vidéo**, écrivez un pseudo, un nom, une photo (chacun facultatif, mais l'un des deux au moins) dans « Ajouter quelqu'un pour cette vidéo seulement » : la personne n'est **jamais** enregistrée dans Contacts. La photo doit être une photo de profil Twitch, YouTube ou Bluesky ; sinon la page vous le dit.
- **Sans Contacts**, tout marche : il reste la saisie pour une seule vidéo, et le panneau propose d'installer un module qui tient vos contacts. Rien n'est installé sans votre clic.
- **Ceux de votre liste d'avant** : à la mise à jour, chaque co-streamer de « Ma liste de co-streamers » devient une fiche de Contacts (ou retrouve la sienne), et vos modèles gardent le numéro de fiche. Si Contacts n'est pas là, rien n'est perdu : la liste reste, elle est proposée comme **ponctuels**, et l'opération se refait toute seule dès que Contacts est installé (à l'ouverture de l'éditeur). Une personne que Contacts ne peut pas accueillir reste dans ces ponctuels (20 au plus).
- Le bouton « Reprendre mes partenaires de Raid Twitch » n'existe plus : mettez vos partenaires dans une catégorie de Contacts et ajoutez-les par là.

## Vos modèles
Gardez vos réglages (style, format, durée, éléments, phrase, co-streamers) **sous un nom**, par exemple « Stream du soir néon ». Vous pouvez les **charger**, les **remplacer** par les réglages du moment ou les **supprimer** : chaque fois, une confirmation, et les autres modèles ne changent pas. Le stream lui-même n'est pas gardé dans un modèle : c'est toujours le prochain.

## Votre IA
Votre assistant peut vous préparer une vidéo. Trois outils, dont un seul qui écrit quelque chose, et **aucun des deux derniers n'est accordé d'office** (administration, accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `story_models` | Liste vos modèles enregistrés. Lecture seule. |
| `story_next_streams` | Liste vos prochains streams. Lecture seule. |
| `story_prepare` | Prépare une vidéo (modèle, réglages, stream, phrase, durée, co-streamers, par leur pseudo Twitch) et rend **un lien**. Un pseudo que Contacts connaît est relié à sa fiche. Il n'enregistre qu'une « préparation » gardée 7 jours. |

L'assistant **ne fabrique pas la vidéo** (cela ne se fait que dans un navigateur) et **ne publie rien**. Vous ouvrez le lien, connecté à votre administration : l'aperçu est déjà rempli, vous vérifiez, vous cliquez sur « Générer la vidéo » et vous enregistrez le fichier. Le lien ne contient qu'un identifiant au hasard, aucun secret. Tout ce que l'assistant envoie est vérifié (style, format, durée de 5 à 15 secondes, pseudos, longueurs) et jamais pris pour du code : un texte reste un texte.

## Réglages (mode avancé)
- **Couleurs de la vidéo** : par défaut celles de votre site ; vous pouvez en choisir d'autres (couleur principale, deuxième couleur, fond et texte du style « Minimal »). Un texte trop pâle est rendu plus lisible automatiquement.
- **Fuseau horaire des dates** (facultatif) : par exemple `Europe/Brussels`. Vide, c'est celui de votre agenda, sinon celui de votre navigateur.

## À savoir
- **Quel navigateur ?** Chrome ou Safari récents (ordinateur ou téléphone) fabriquent directement un fichier MP4, ce qu'Instagram préfère. Avec un navigateur plus ancien, le module enregistre la vidéo en temps réel (c'est plus long), et le fichier peut être un WebM : la page vous le dit, avec le conseil d'essayer Chrome ou Safari récent. Si votre navigateur ne sait pas du tout faire de vidéo, le module vous l'explique **avant de commencer**.
- **Pendant la fabrication**, gardez l'onglet ouvert. Une vidéo de 15 secondes demande de quelques secondes à une minute selon votre appareil.
- **Rien n'est gardé sur le site** : la vidéo et les images ne sont jamais envoyées ni enregistrées. Le module garde seulement vos modèles (avec le numéro de fiche de chaque co-streamer), une courte liste de ponctuels sans fiche et, 7 jours au plus, les préparations de votre assistant.
- **Les jaquettes** viennent du service de jaquettes du site (le propriétaire règle son accès une fois dans Réglages, Services externes). Sans jaquette connue, la vidéo s'en passe très bien. Les photos de profil et les jaquettes passent par le site lui-même, depuis les serveurs d'images de Twitch, de YouTube, de Bluesky et du jeu uniquement ; la photo d'une personne vient toujours de sa fiche dans Contacts.
- **Réduire les animations** : si votre appareil le demande, l'aperçu reste sur une image fixe (un bouton « Lecture » le fait bouger) ; la vidéo, elle, est toujours animée.
- **Sur téléphone**, l'éditeur s'adapte à l'écran : l'aperçu est en haut, les réglages dessous.
- **Vie privée** : le module ne collecte rien sur vos visiteurs et n'a pas de page publique. Ses données sont visibles des seuls administrateurs.

## Pour les développeurs
- **Fabrication dans le navigateur** : chaque style est une fonction du temps, `draw(ctx, t)` (`scenes.mjs`), exécutée image par image (déterministe, aucun hasard non reproductible). L'encodage utilise l'encodeur H.264 du navigateur (WebCodecs, 30 images/s, environ 8 Mb/s, une image clé par seconde, détecté avant de commencer par `VideoEncoder.isConfigSupported`), et un emballeur MP4 d'environ 150 lignes écrit pour ce module (`mp4.mjs` : `ftyp`, `moov` puis `mdat`, `avcC`, listes de temps d'affichage si l'encodeur réordonne les images ; il convertit aussi un flux « Annex B »). Repli : `MediaRecorder` (MP4 si le navigateur le sait, sinon WebM). Une seule image est en mémoire à la fois. Aucune bibliothèque tierce, aucun CDN.
- **Fichiers purs** : `pure.mjs` (formats, textes, dates, compte à rebours, découpe en lignes, mise en page des co-streamers, couleurs), `scenes.mjs`, `mp4.mjs` et `encode.mjs` n'ont aucune dépendance et tournent aussi dans un `vm` vierge ; ils sont servis tels quels à la page par les routes `lib/*.mjs`.
- **Formats** : une seule table, `FORMATS` dans `pure.mjs` : `{ id, width, height, margins, zones }`. Le ratio 4:5 du « Passeport » s'y change en une ligne.
- **Liens avec les autres modules** : il **consomme** le sujet `planning.slot` (fourni par n'importe quel agenda ; lecture bornée dans le temps, `from` / `to` et plafond de 100). Le sujet `stream.partner` n'est **plus lu**. Il `requires` le service **`contact.book` en version 2, FACULTATIF** (`optional: true`, `minCore` 0.2.1) : `search({ q, network?, kind: "person" })` puis `resolve` (photo) pour la saisie, `categories` et `accounts` (pages de 20) pour une catégorie, `upsertByAccount` et `setAccountProfile` pour la migration. Chaque appel est borné (`timing.bookMs`, 5 s) ; sans fournisseur, le panneau renvoie un bloc `suggestInstall` (service `contact.book`, `min` 2, jamais un nom de module). Il **offre** `privacy.subject` (`each: true`) : `export`, `erase`, `remap` sur les références gardées dans les modèles et les préparations. Jaquettes : `ctx.api.rawg` (permission `rawg`).
- **Un co-streamer dans une vidéo** (`pure.mjs`, `cleanMember`) : `{ id }` (référence de fiche, identifiant opaque ≤ 80 caractères, rien d'autre n'est gardé) ou `{ login, name, image }` (saisie pour cette vidéo seulement, pseudo libre OU nom). 6 au plus. Une liste de pseudos Twitch (modèle de la version 1) est lue comme des saisies ponctuelles.
- **Migration** (`dataVersion` 2, `migrate.mjs`, **à retirer en phase 3**) : `upsertByAccount({ network: "twitch", handle, kind: "person", name?, source: "stream-story" })` pour chaque entrée de `story_costreamers`, photo confiée à `setAccountProfile` quand l'hôte est relayable, puis les modèles et préparations passent des pseudos aux `{ id }` ; seuls les refus définitifs de Contacts (pseudo refusé, carnet plein) vont dans `story_adhoc`. L'ancienne liste n'est effacée qu'à la fin. Sans `contact.book` v2, muet ou en panne : rien n'est touché (« waiting ») et `ensureMigrated` (appelé par la route `data`, donc à l'ouverture de l'éditeur, bornée, une seule passe à la fois) la rejoue. Idempotente : un rejeu ne crée ni fiche, ni ponctuel, ni référence en double.
- **Routes** (`/m/<clé>/…`) : `studio` et `lib/*.mjs` (page et code, sans donnée) ; `data`, `streams`, `prep`, `people` (recherche), `members` (relire des fiches, 24 au plus), `categories` et `category` (GET), `act` (POST : `adhoc.check`, `adhoc.remove`, `model.save`, `model.remove`) et `img` (GET) exigent l'en-tête `X-Story-Token`. Ce jeton signé (HMAC, 12 h) est donné par le panneau d'administration, dans la partie `#` de l'adresse du cadre. Politique de sécurité de la page : `default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'`.
- **Relais d'images** (`images.mjs`) : https, hôtes `static-cdn.jtvnw.net`, `media.rawg.io` et, pour les photos de Contacts, `yt3.ggpht.com`, `yt3.googleusercontent.com` et `cdn.bsky.app` seulement, chemin d'image connu pour chacun (une photo manuelle sur un autre hôte, ou une adresse signée comme celles d'Instagram, n'est pas relayée : initiales), ni port, ni paramètres, ni identifiants ; aucune redirection suivie ; 3 Mo au plus ; type lu dans les premiers octets ; délai borné ; cache de 10 minutes ; 4 téléchargements au plus à la fois.
- **Attentes bornées** : `timing` dans `sources.mjs` (agenda 6 s, jaquettes 5 s, Contacts 5 s par appel, migration 45 s, route entière 20 s) et `images.mjs` ; essais « trou noir » dans `tests/hang-stream-story.test.mjs`.
- **Stockage** : `story_models` et `story_adhoc` (un document chacun), `story_preps` (7 jours, 30 au plus), `story_key` (clé de signature) ; `story_costreamers` (la liste de la version 1) n'existe plus qu'avant la migration.
- **Tests** : `stream-story-pure`, `stream-story-scenes` (zone sûre de chaque style × format × 0 à 6 co-streamers), `stream-story-video` (emballeur essayé avec de vraies images x264 relues par `ffprobe`), `stream-story`, `stream-story-contacts` (contre le double de `contact.book` v2 : références, recherche, catégories, repli, migration, photos, `privacy.subject`), `stream-story-editor` (l'éditeur exécuté dans un faux navigateur), `hang-stream-story`.

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
- Cochez ceux qui apparaissent dans la vidéo (**6 au plus**). Chacun est montré avec sa photo de profil Twitch, ou avec ses initiales dans un cercle de couleur si la photo manque.
- **Ma liste de co-streamers** garde vos habitués : un pseudo Twitch (4 à 25 lettres, chiffres ou _), un nom affiché et une photo, tous deux facultatifs. Vous pouvez en ajouter, les modifier et les retirer (une confirmation vous est demandée).
- **Pour une seule vidéo**, tapez simplement un pseudo dans « Ajouter quelqu'un pour cette vidéo seulement » : il n'est pas enregistré.
- Si le module **Raid Twitch** est installé, un bouton **« Reprendre mes partenaires de Raid Twitch »** ajoute vos partenaires à la liste, avec leur photo de profil. Rien n'est retiré, et ce que vous avez déjà écrit n'est pas écrasé. Sans Raid Twitch, tout marche pareil : saisissez vos co-streamers vous-même.

## Vos modèles
Gardez vos réglages (style, format, durée, éléments, phrase, co-streamers) **sous un nom**, par exemple « Stream du soir néon ». Vous pouvez les **charger**, les **remplacer** par les réglages du moment ou les **supprimer** : chaque fois, une confirmation, et les autres modèles ne changent pas. Le stream lui-même n'est pas gardé dans un modèle : c'est toujours le prochain.

## Votre IA
Votre assistant peut vous préparer une vidéo. Trois outils, dont un seul qui écrit quelque chose, et **aucun des deux derniers n'est accordé d'office** (administration, accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `story_models` | Liste vos modèles enregistrés. Lecture seule. |
| `story_next_streams` | Liste vos prochains streams. Lecture seule. |
| `story_prepare` | Prépare une vidéo (modèle, réglages, stream, phrase, durée, co-streamers) et rend **un lien**. Il n'enregistre qu'une « préparation » gardée 7 jours. |

L'assistant **ne fabrique pas la vidéo** (cela ne se fait que dans un navigateur) et **ne publie rien**. Vous ouvrez le lien, connecté à votre administration : l'aperçu est déjà rempli, vous vérifiez, vous cliquez sur « Générer la vidéo » et vous enregistrez le fichier. Le lien ne contient qu'un identifiant au hasard, aucun secret. Tout ce que l'assistant envoie est vérifié (style, format, durée de 5 à 15 secondes, pseudos, longueurs) et jamais pris pour du code : un texte reste un texte.

## Réglages (mode avancé)
- **Couleurs de la vidéo** : par défaut celles de votre site ; vous pouvez en choisir d'autres (couleur principale, deuxième couleur, fond et texte du style « Minimal »). Un texte trop pâle est rendu plus lisible automatiquement.
- **Fuseau horaire des dates** (facultatif) : par exemple `Europe/Brussels`. Vide, c'est celui de votre agenda, sinon celui de votre navigateur.

## À savoir
- **Quel navigateur ?** Chrome ou Safari récents (ordinateur ou téléphone) fabriquent directement un fichier MP4, ce qu'Instagram préfère. Avec un navigateur plus ancien, le module enregistre la vidéo en temps réel (c'est plus long), et le fichier peut être un WebM : la page vous le dit, avec le conseil d'essayer Chrome ou Safari récent. Si votre navigateur ne sait pas du tout faire de vidéo, le module vous l'explique **avant de commencer**.
- **Pendant la fabrication**, gardez l'onglet ouvert. Une vidéo de 15 secondes demande de quelques secondes à une minute selon votre appareil.
- **Rien n'est gardé sur le site** : la vidéo et les images ne sont jamais envoyées ni enregistrées. Le module garde seulement votre liste de co-streamers, vos modèles et, 7 jours au plus, les préparations de votre assistant.
- **Les jaquettes** viennent du service de jaquettes du site (le propriétaire règle son accès une fois dans Réglages, Services externes). Sans jaquette connue, la vidéo s'en passe très bien. Les photos de profil et les jaquettes passent par le site lui-même, depuis les serveurs d'images de Twitch et du jeu uniquement.
- **Réduire les animations** : si votre appareil le demande, l'aperçu reste sur une image fixe (un bouton « Lecture » le fait bouger) ; la vidéo, elle, est toujours animée.
- **Sur téléphone**, l'éditeur s'adapte à l'écran : l'aperçu est en haut, les réglages dessous.
- **Vie privée** : le module ne collecte rien sur vos visiteurs et n'a pas de page publique. Ses données sont visibles des seuls administrateurs.

## Pour les développeurs
- **Fabrication dans le navigateur** : chaque style est une fonction du temps, `draw(ctx, t)` (`scenes.mjs`), exécutée image par image (déterministe, aucun hasard non reproductible). L'encodage utilise l'encodeur H.264 du navigateur (WebCodecs, 30 images/s, environ 8 Mb/s, une image clé par seconde, détecté avant de commencer par `VideoEncoder.isConfigSupported`), et un emballeur MP4 d'environ 150 lignes écrit pour ce module (`mp4.mjs` : `ftyp`, `moov` puis `mdat`, `avcC`, listes de temps d'affichage si l'encodeur réordonne les images ; il convertit aussi un flux « Annex B »). Repli : `MediaRecorder` (MP4 si le navigateur le sait, sinon WebM). Une seule image est en mémoire à la fois. Aucune bibliothèque tierce, aucun CDN.
- **Fichiers purs** : `pure.mjs` (formats, textes, dates, compte à rebours, découpe en lignes, mise en page des co-streamers, couleurs), `scenes.mjs`, `mp4.mjs` et `encode.mjs` n'ont aucune dépendance et tournent aussi dans un `vm` vierge ; ils sont servis tels quels à la page par les routes `lib/*.mjs`.
- **Formats** : une seule table, `FORMATS` dans `pure.mjs` : `{ id, width, height, margins, zones }`. Le ratio 4:5 du « Passeport » s'y change en une ligne.
- **Liens avec les autres modules, sans dépendance** : il **consomme** le sujet `planning.slot` (fourni par n'importe quel agenda ; lecture bornée dans le temps, `from` / `to` et plafond de 100) et le sujet `stream.partner` (fourni par `twitch-raid` 1.1.0 : `id`, `login`, `title`, `image`, jamais la note). Il ne `requires` aucun service. Jaquettes : `ctx.api.rawg` (permission `rawg`).
- **Routes** (`/m/<clé>/…`) : `studio` et `lib/*.mjs` (page et code, sans donnée) ; `data`, `streams`, `prep` (GET), `act` (POST) et `img` (GET) exigent l'en-tête `X-Story-Token`. Ce jeton signé (HMAC, 12 h) est donné par le panneau d'administration, dans la partie `#` de l'adresse du cadre. Politique de sécurité de la page : `default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'`.
- **Relais d'images** (`images.mjs`) : https, hôtes `static-cdn.jtvnw.net` et `media.rawg.io` seulement, chemin d'image connu, ni port, ni paramètres, ni identifiants ; aucune redirection suivie ; 3 Mo au plus ; type lu dans les premiers octets ; délai borné ; cache de 10 minutes ; 4 téléchargements au plus à la fois.
- **Attentes bornées** : `timing` dans `sources.mjs` (agenda 6 s, jaquettes 5 s, partenaires 4 s, route entière 20 s) et `images.mjs` ; essais « trou noir » dans `tests/hang-stream-story.test.mjs`.
- **Stockage** : `story_costreamers`, `story_models` (un document chacun), `story_preps` (7 jours, 30 au plus), `story_key` (clé de signature).
- **Tests** : `stream-story-pure`, `stream-story-scenes` (zone sûre de chaque style × format × 0 à 6 co-streamers), `stream-story-video` (emballeur essayé avec de vraies images x264 relues par `ffprobe`), `stream-story`, `hang-stream-story`.

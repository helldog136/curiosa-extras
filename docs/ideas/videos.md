# Vidéothèque (module `videos`)

## Le problème

Une créatrice (ou une association de créateurs) a des vidéos : masterclass, rétrospectives d'événements, tutoriels, présentations. Elles sont sur YouTube. Elle veut **une page à elle** qui les range, les présente et les relie au reste du site, **sans héberger** de vidéo et sans que ses visiteurs soient suivis par une plateforme avant d'avoir choisi de lire.

## Pour qui

Tout site Curiosa qui montre des vidéos. Aucun mot, nom, couleur ni région propre à un site n'est dans le code : le vocabulaire se règle, les catégories se définissent, un modèle de départ se choisit (ou pas).

## Ce que voit le visiteur

- **Le catalogue** (`/videos`) : une grille (miniature, titre, durée si connue, catégorie, date, étiquette « Gratuit »), des **pastilles de catégories**, une **recherche** (accents et majuscules sans importance, tous les mots), et **« Voir plus »** (pagination par curseur : 12 par page, 6 à 50 au choix, jamais de numéro de page à deviner).
- **La page d'une vidéo** : l'image avec un bouton **« Lire ici »**, une note qui dit que le lecteur ne se charge qu'après le clic, un bouton **« Regarder sur YouTube »**, la description, la **transcription** (bloc repliable), un lien vers l'**album photo** lié (si un module de galeries est là), des **liens de partage** (copier, e-mail, WhatsApp, Facebook, X).
- **Les séries** : une série est une liste ordonnée ; dans une série, la page de la vidéo montre « Précédent / Suivant » et la liste ; « Suivant » depuis un lecteur ouvert ouvre la vidéo suivante **déjà prête à lire** (un seul clic par vidéo : aucune lecture automatique, car l'API du lecteur obligerait à charger un script de la plateforme).
- **Données structurées** `VideoObject` (titre, description, date, durée, miniature, lecteur) pour les moteurs de recherche, coupables dans les réglages avancés.
- **Accueil** : une section « Les dernières vidéos » (nombre réglable).

### Ce qui part vers la plateforme, et quand

| Moment | Qui contacte YouTube | Quoi |
|---|---|---|
| Affichage du catalogue ou d'une page | personne | rien : les miniatures sont des **copies gardées par le site** (`/m/<instance>/thumb?v=n`), ou un fond sobre |
| Clic sur « Lire ici » | le **navigateur** du visiteur | le lecteur `youtube-nocookie.com` (cadre fermé : `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`, `allow="autoplay; fullscreen"`, adresse fabriquée à partir de l'identifiant validé) |
| Clic sur « Regarder sur YouTube » | le navigateur | il quitte le site |
| Clic sur un lien de partage | le navigateur | il ouvre le service choisi |
| Emma ajoute une vidéo | le **serveur** du site | titre (service public « oEmbed », sans clé, par `ctx.api.net`) et miniature (une image de 64 Ko au plus) |

Sans JavaScript, « Lire ici » est un vrai lien vers `/videos/v/<n>/play` qui affiche la page avec le lecteur déjà ouvert : le clic est la navigation.

## Ce que fait Emma, pas à pas

1. **Mes vidéos** : un champ « Adresse de la vidéo YouTube ». Elle colle n'importe quelle forme (`watch`, `youtu.be`, `shorts`, `embed`, `live`, avec ou sans paramètres de suivi, avec ou sans `https://`). Le titre et la miniature se remplissent ; la vidéo arrive **en brouillon** et l'écran de modification s'ouvre.
2. **Erreurs sous le champ**, avec un exemple : pas une adresse YouTube, liste de lecture, chaîne, doublon, vidéo introuvable ; **YouTube ne répond pas** → « écrivez le titre vous-même » (le titre est le seul champ qui manque ; l'adresse reste valable).
3. **Modifier** : titre, description, catégorie, date (sert au classement), durée (`12:34`), « Vidéo gratuite » (simple étiquette), sa propre miniature (envoi de fichier), album photo lié, transcription, état (Brouillon / Publiée / Masquée). Boutons : Publier ou Masquer, Actualiser depuis YouTube, Supprimer (avec confirmation).
4. **Ajouter plusieurs adresses d'un coup** (100 au plus, une par ligne) : un **aperçu** liste chaque ligne (nouvelle, déjà présente, répétée, pas une adresse YouTube…) ; rien n'est ajouté avant « Ajouter N vidéos ». Les titres se remplissent 20 par passage ; le bouton **Compléter** continue (utile si YouTube a été injoignable).
5. **Catégories, séries** : un **modèle de départ** en un clic (« Masterclass, Rétrospectives, Tutoriels » ou « Vide »), catégories définies par Emma (un nom par langue), ordre par boutons ↑ ↓, séries (nom et présentation par langue, vidéos ajoutées par recherche, ordre par boutons, brouillon/publiée).

Mobile d'abord : tableaux à une colonne, boutons empilés, cibles d'au moins 44 px, aucun glisser-déposer.

## Réglages et valeurs par défaut

Tout marche sans rien régler. Simples : nom de la page (pluriel, singulier), nom des séries (pluriel, singulier), étiquette « gratuit », texte d'introduction, miniatures (**copie gardée** par défaut, ou **fond sobre** : aucune image), liens de partage (oui). Avancés : vidéos par page (12), données structurées (oui).

## Vocabulaire réglable

« Vidéos » par défaut (« Videos » en anglais) ; « Replays », « Formations », « Masterclass »… au singulier et au pluriel, par langue. Idem pour « Séries » (« Parcours », « Playlists »…) et « Gratuit ».

## Gabarits

Un seul gabarit de catégories : « Masterclass, Rétrospectives, Tutoriels » (ou « Vide »), proposé sur l'onglet « Catégories, séries » tant qu'il n'y a ni catégorie ni série ; appliqué une seule fois (re-cliquer ne duplique rien), toujours modifiable.

## Plusieurs instances

`instances: multiple` : chaque instance a son chemin, ses données (préfixe `vid_`), sa mémoire. Le service `videos.library` est `each: true` : chaque instance répond pour ses vidéos.

## Données et bornes

`vid_items` (une ligne par vidéo), `vid_text` (transcription, à part), `vid_thumbs` (miniature gardée, base64, 64 Ko au plus), `vid_cats`, `vid_series`, `vid_meta` (compteurs : un numéro n'est jamais réutilisé), `vid_bulk` (l'aperçu en cours, périmé au bout d'une heure).

| Borne | Valeur |
|---|---|
| Vidéos par instance | 5 000 |
| Par page publique | 12 (6 à 50) |
| Par série | 100 |
| Séries / catégories | 200 / 40 |
| Adresses collées d'un coup | 100 |
| Transcription / description / titre | 20 000 / 3 000 / 150 caractères |
| Miniature gardée | 64 Ko (≈ 5 000 × 15 Ko ≈ 100 Mo au maximum) |
| Titres complétés par clic | 20 (3 en même temps, 15 s au plus) |

Lecture : par pages de 1 000, gardée **20 s** en mémoire (une seule lecture partagée entre visiteurs), vidée à chaque écriture ; écritures sérialisées par instance ; rien en arrière-plan (aucune tâche, aucun minuteur).

## Vie privée

Aucun cookie, rien gardé sur les visiteurs, déclaration `privacy` (FR+EN) : le navigateur ne contacte YouTube qu'après un clic. Pas de `privacy.subject` : aucune donnée de personne.

## Sécurité

- Identifiant YouTube validé **strictement** (11 caractères `[A-Za-z0-9_-]`, type chaîne) à chaque fabrication d'adresse ; **jamais d'adresse arbitraire** dans le cadre, ni dans la miniature, ni dans la requête de titre ; hôtes en listes fermées (`www.youtube-nocookie.com`, `i.ytimg.com`, `www.youtube.com`).
- Miniature : `fetch` borné (hôte, https, sans port, sans redirection, 64 Ko, type vérifié sur les premiers octets, 4 s, 3 à la fois), appelé **seulement depuis l'administration** ; la route publique ne lit que le stockage (aucune écriture en GET).
- Recherche : le formulaire envoie à une route qui **fabrique** l'adresse de redirection (mots nettoyés, catégorie connue) : pas de redirection ouverte.
- Textes échappés, adresses `https://` seules en liens, JSON-LD échappé (`< > &`), couleurs du thème (`--v-*`), mouvement réduit respecté.
- Le script de page (`scripts/videos.js`) revérifie l'adresse du lecteur par expression stricte avant de créer le cadre.

## Ajouter une autre plateforme

`providers.mjs` contient une **table** `PROVIDERS`. Une entrée = `label`, `parse(texte)`, `validId`, `watchUrl`, `embedUrl`, `thumbUrl`, `oembedUrl`, `thumbHosts`, `embedHosts`. Le reste du module ne manipule que `{ provider, ext }`. Pour une nouvelle plateforme : ajouter l'entrée, étendre `privacy` (manifeste) et les textes, ajouter l'hôte du lecteur à l'expression du script de page et à ses tests. La v1 ne connaît que YouTube.

## Intégrations

- **Offre `videos.library`** (v1, lecture seule, `each`) : `list({limit,cursor,q,category})` → `{ ok, items:[{id,title,thumb?,url}], next? }` ; `get({id})` (ajout) → `{ ok, item|null }`. Seules les vidéos publiées ; `thumb` et `url` sont des chemins du site. Faux fournisseur : `tests/helpers/fakeVideos.mjs`.
- **Consomme `gallery.albums`** (facultatif, `requires[].optional`, `suggestInstall`) : `list` (≤ 100 albums proposés) et `get(id)` ; absent, en panne, lent (3 s), illisible : la page s'affiche sans le lien (dernier album connu gardé 24 h en mémoire). Seul l'identifiant de l'album est gardé.

## Outils pour l'assistant IA

`library_list` et `categories_list` (lecture seule), `video_add_by_url` et `video_update` (écritures **non accordées d'office**). L'assistant **ne publie jamais** : tout ajout est un brouillon, `video_update` ne touche que brouillons et vidéos masquées et ne peut pas publier. Les textes sont signalés comme des données.

## Droits

`edit` (ajouter, modifier, ranger, supprimer) et `publish` (publier, masquer). Sans `publish`, tout reste brouillon.

## Ce qui n'est pas fait, et pourquoi

- Une seule plateforme (décision de la propriétaire) ; la table est prête.
- Titres et descriptions dans une seule langue (ceux de la plateforme) ; catégories et séries traduites.
- Pas de lecture automatique de la vidéo suivante : détecter la fin d'une vidéo demande le script de la plateforme (chargé avant tout clic) ; le bouton « Suivant » ouvre la suivante prête à lire.
- Transcription non indexée par la recherche (volume).
- Miniature gardée seulement à l'ajout ou par « Compléter » / « Actualiser » (jamais à l'affichage : pas d'écriture en GET) ; une vidéo ajoutée pendant une panne de YouTube a un fond sobre jusqu'à ce clic.
- Pas de glisser-déposer pour l'ordre (boutons).
- Pas de plan du site (`sitemap`) pour les pages de vidéos (une page de module n'en déclare pas).

## Idées pour la suite

Import d'une liste de lecture YouTube entière ; autres plateformes (table prête) ; sous-titres par langue ; durée lue automatiquement ; section d'accueil « une série à la une ».

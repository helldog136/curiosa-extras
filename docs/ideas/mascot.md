# Mascotte (`mascot`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.5, licence et auteur comme les autres modules. Type `widget`, instance unique (une seule mascotte par site), aucune page publique.

## Le problème
Un site sérieux peut paraître froid. Une petite mascotte donne de la vie, accueille, guide et annonce, mais elle ne doit jamais gêner : ni cacher le contenu ou les boutons, ni revenir sans cesse, ni être imposée.

## Pour qui
Emma, créatrice non technique, qui travaille sur téléphone. Tout se règle par boutons et formulaires, les erreurs s'affichent sous le champ avec un exemple. Rien dans le code ni dans les textes de départ n'est propre à une association : un autre site l'installe tel quel (gabarits, noms, langues, couleurs du thème).

## Ce que voit le visiteur
- Une apparition par visite, après un délai (8 s). Le script décide **en local** (coupée ? déjà venue ? assez de messages aujourd'hui ? bonne page ?) et ne demande les phrases au site qu'au moment de se montrer.
- Bulle courte : salutation (la première fois du jour) puis annonce, sinon astuce. Bouton « Voir » si la phrase a un lien. Jamais deux fois de suite la même phrase (mémoire des 8 dernières), ni un sujet inchangé. 3 messages par jour par défaut (1 à 10). Pas de son. Une apparition au plus toutes les 20 minutes, même avec plusieurs onglets.
- Contrôles : croix de 44 px (ferme pour la visite), « Réduire en pastille » (reste dans le coin, endormie, sans rien demander au site ; un clic la réveille sans compter dans la limite du jour), « Ne plus afficher » (pour toujours). Choix gardés dans le navigateur (`localStorage`/`sessionStorage`) : aucun cookie, rien d'envoyé. Sans stockage possible, elle ne se montre pas.
- Petit écran (≤ 600 px de large ou ≤ 480 px de haut) : jamais de bulle seule ; pastille avec un point qui s'efface après 15 s, bulle au toucher.
- Ne gêne pas : coin fixe avec marges de sécurité (16 px, encoche comprise), largeur bornée (330 px), `z-index` 40 (sous le bandeau des cookies du cœur à 50, qu'elle attend), cachée à l'impression. Mouvement réduit : aucune animation, disparition immédiate. Bulle figée pendant le survol ou le focus ; Échap ferme ; région nommée, bulle en `role="status"`.
- `?mascot=voir` : elle se montre tout de suite et oublie les choix du navigateur. Lien facultatif « Réveiller la mascotte » en pied de page (désactivé par défaut).

## Les deux apparences
- **Dessin inclus** : petit être rond à touffe de deux feuilles (`face.mjs`), original. Corps = couleur principale, touffe et joues = secondaire, visage = fond des cartes, yeux = couleur du texte, tout par jetons `--v-*` (clair, sombre). Humeurs : contente (salutation), curieuse (astuces, annonces), endormie (pastille).
- **Sa propre image** : fichier (champ image du cœur, avec recadrage) ou adresse https ; ronde ou carrée ; **description obligatoire** (sinon l'image n'est jamais transmise et la publication est refusée).

## Ce que fait Emma
1. Installe : 18 phrases de départ (FR + EN, seulement les langues du site), mascotte en **brouillon**.
2. **Ma mascotte** : aperçu aux couleurs du site, apparence (dessin/image, forme, nom et description par langue), **Publier** / **Remettre en brouillon**, lien « La voir sur le site ».
3. **Phrases** : formulaire (phrase, sorte, langue, pages, lien, état), liste par 50 (Modifier / Publier-retirer / Supprimer), **gabarits** « Bienvenue discrète » et « Vide » (avec confirmation).
4. **Quand et où** : toutes les pages, accueil, ou certaines pages (`/agenda`, `/blog/*`, `/jeu*`) ; coin ; annonces des autres modules ; lien de pied de page ; avancé : attente (8 s, 3–60), durée mini de bulle (8 s, 4–20), messages par jour (3, 1–10).
5. L'erreur d'image est sous « Quel visage » (le champ image du cœur n'affiche pas de message sous lui).

## Variables
`{nom_du_site}`, `{nom}`, `{prochain_evenement}`, `{date_evenement}`, `{en_direct}`, `{titre_direct}`, `{derniere_nouveaute}` et leurs noms anglais (`{site_name}`, `{name}`, `{next_event}`, `{event_date}`, `{live_now}`, `{live_title}`, `{latest_news}`), acceptés dans toutes les langues. Une variable sans valeur rend la phrase non dite. La date est un repère remplacé dans le navigateur (langue et fuseau du visiteur).

## Annonces facultatives et découplées
Chaque source est un besoin facultatif : absente, lente (2,5 s), en panne ou illisible, la phrase n'existe pas. Interrogée seulement si une phrase de la page l'emploie ; réponse gardée 2 min (30 s après échec, dernière bonne valeur gardée) ; demandes partagées ; aucun minuteur de fond.
- `event.source` : prochain événement (45 jours) ; son lien devient « Voir ».
- `twitch.live` (`status`), `youtube.live` (`current`) : directs en cours (3 au plus).
- `feed.item` : dernière nouveauté de moins de 3 semaines.
- `mascot.hint` : tout module peut confier `{ id, text, url? }` (10 au plus). **C'est le moyen prévu pour le jeu du jour** (aucun contrat d'état n'existait) : le module du jeu déclare `provides: [{ topic: "mascot.hint" }]`.

## Bornes
100 phrases de 140 caractères, nom 40, description 125, 20 pages, 30 lignes par réponse, script ≤ 12 Ko (testé), liste d'admin par 50. Script servi à une adresse portant son empreinte (`?v=`), gardé « pour toujours ».

## Technique
`layout.head` annonce une balise `script defer` vers une **route du module** (`/m/<clé>/mascot.js`), sans script en ligne ; annoncée seulement si publiée et avec des phrases publiées. `PageResult.scripts` ne sert que les pages d'un module, pas toutes. CSS chargée à la demande (`mascot.css`), phrases par `lines` (GET). Fichiers : `model`, `store`, `lines`, `assets`, `client`, `face`, `style`, `admin`, `mcp`, `starters`, tous importés avec la version du fichier principal (test de mise à jour à chaud). Données : `config`, `phrases`. Sauvegarde lisible `phrases.csv`.

## Outils pour l'assistant IA
`mascot_phrases_list` (lecture) ; `mascot_phrase_add` (écriture non accordée d'office, toujours un **brouillon**, plafond 100). Droits : `edit`, `publish`.

## Ce qui n'est pas fait
Pas de son, de dialogue, de déplacement par glisser, de plusieurs mascottes. L'aperçu montre l'état enregistré (il ne suit pas la frappe). Le jeu du jour passe par `mascot.hint`. Le sujet `mascot.hint` est à ajouter au tableau « Sujets connus » de `docs/MODULES.md` du cœur (un test du dépôt le réclame).

## Idées pour la suite
Phrases saisonnières (dates de début/fin), import de phrases, humeurs supplémentaires, avatar par langue.

# Galeries photos

Des albums de photos pour votre site : les moments forts de vos événements, votre portfolio, les coulisses de vos projets. Les visiteurs voient une grille de couvertures, ouvrent un album, parcourent des miniatures qui se chargent au fil du défilement, puis regardent chaque photo en grand dans une visionneuse plein écran.

Les photos sont **hébergées sur votre site, dans des limites que vous réglez** (photos réduites, nombre et espace comptés). Pour un gros album, une carte **mène vers l'album d'un autre service** de votre choix : aucun service tiers n'est imposé.

## Ce que voit le visiteur

- Une **liste d'albums** (grille de couvertures, 12 par page).
- Un **album** : titre, date, description, miniatures à chargement progressif. Sur un téléphone comme sur un ordinateur, on touche une miniature et la photo s'ouvre en grand.
- Une **visionneuse accessible** : flèches du clavier et Échap, balayage du doigt, compteur (« 3 sur 24 »), légende, grands boutons précédente / suivante bien visibles sur téléphone, mouvement réduit respecté. On en sort toujours (bouton « Fermer », Échap, bouton Retour du téléphone).
- Un **lien pour chaque photo** (bouton « Copier le lien de cette photo »). Même sans JavaScript, chaque photo a sa page avec « précédente » et « suivante ».
- Pour un album chez un autre service : une carte avec une phrase claire (« Ce lien ouvre … dans un nouvel onglet : vous quittez ce site. »).
- Une **mention de consentement** et le lien **« Demander le retrait d'une photo »** : un formulaire très simple (la photo concernée, un message, un e-mail facultatif).

## Ce que vous faites

1. Installez le module : la page `/galeries` existe. Dans l'onglet **Mes albums**, choisissez un **point de départ** : *Rétrospectives*, *Portfolio* ou *Vide*. Il propose des mots, un ordre et un album d'exemple en brouillon ; rien n'est supprimé, tout se change ensuite.
2. **Créez un album** : titre, date, description. Choisissez si les photos sont **sur ce site** ou **chez un autre service** (vous collez alors son adresse).
3. **Ajoutez des photos** : « Ajouter des photos » ouvre une page où vous choisissez vos fichiers, plusieurs d'un coup. Chaque photo est réduite sur votre appareil puis envoyée avec sa barre de progression ; si une photo pose problème, l'erreur est écrite juste en dessous, avec ce qu'il faut faire. Vous pouvez écrire une légende et une **description pour les personnes qui ne voient pas l'image** (un rappel s'affiche).
4. **Rangez** : boutons *Monter* / *Descendre* / *En premier*, choix de la couverture, *Masquer* une photo (elle disparaît du site tout de suite sans être effacée), *Supprimer*. Aucun glisser-déposer.
5. **Publiez** quand c'est prêt. Un brouillon a un **lien d'aperçu privé** pour le relire sur le site avant de le montrer.
6. Dans l'onglet **Retraits**, lisez les demandes des visiteurs : un clic sur **« Masquer la photo »** la retire du site et clôt la demande.

## Photos : où elles vont, ce qui est vérifié et nettoyé

- Les photos sont envoyées par le **mécanisme d'envoi d'images du site** (le même que pour le logo ou l'image d'un article) : ce sont de vrais fichiers du site, dans ses sauvegardes. Le module ne garde que leur adresse.
- Seuls les formats **JPEG, PNG et WebP** sont acceptés (le site vérifie le type par le contenu du fichier, 5 Mo au plus). Les images animées (GIF) sont refusées.
- Les **informations cachées** dans les photos (position GPS, appareil, date) sont **retirées** : votre navigateur ré-encode chaque photo avant l'envoi, et les pages publiques n'affichent qu'une **version propre fabriquée par le site** (jamais le fichier d'origine).
- Chaque photo est envoyée **une par une**, avec sa barre de progression ; l'erreur d'une photo s'écrit sous elle sans bloquer les autres.
- Des **limites** protègent le site (réglables dans les réglages avancés) : poids visé d'une photo (300 Ko par défaut), photos par album (120 par défaut, 300 au plus), nombre d'albums (100 par défaut, 500 au plus), photos sur tout le site (1 500 par défaut, 10 000 au plus).
- **Retirer ou masquer** : masquer une photo la fait disparaître des pages du site tout de suite. Retirer une photo d'un album ou supprimer un album retire aussi les pages, **mais le fichier reste sur le disque du site** : un module ne peut pas encore effacer un fichier envoyé (voir « Ce que le module ne fait pas »). Quelqu'un qui connaîtrait l'adresse exacte du fichier pourrait donc encore l'ouvrir ; ces adresses sont longues et jamais écrites sur les pages.
- Une photo peut aussi rester **chez un autre site** (« par adresse »), mais seulement si vous avez autorisé ce site dans les réglages avancés.

## Réglages

Tout marche sans rien régler. Pour changer : titre et introduction de la page, mention de consentement, lien de retrait, e-mail à chaque demande, ordre et dates des albums, aide aux moteurs de recherche (désactivée d'office). En mode avancé : les mots du lien de retour, les limites ci-dessus (poids visé, photos par album, albums, photos sur tout le site), les sites autorisés pour des photos par adresse, la durée de garde des demandes (90 jours au plus).

## Vie privée

Aucun cookie de suivi, aucune adresse de visiteur gardée. Les demandes de retrait contiennent seulement la photo, un message et, si la personne le veut, un e-mail (effacé dès que la demande est traitée) ; elles sont effacées 30 jours après leur traitement. Si le module Contacts est installé, une demande qui contient un e-mail y est aussi copiée.

## Avec un assistant IA

Il peut lister les albums et leurs photos, **créer un album en brouillon**, **ajouter une photo par adresse** (toujours masquée, sur un site autorisé) et **masquer une photo**. Il ne publie jamais. Les trois actions d'écriture sont éteintes d'office : activez-les dans *Assistants IA* si vous le souhaitez.

## Ce que le module ne fait pas

- Pas de vidéo, pas de GIF animé.
- Pas de glisser-déposer pour envoyer ou ranger (les boutons suffisent, et c'est plus sûr au doigt).
- Pas de retouche de photo, pas de recadrage.
- Pas de commentaires ni de « j'aime » sur les photos.
- Effacer vraiment le fichier d'une photo retirée : pas encore (limite du site de base). Pour de très gros albums, utilisez la carte « vers un autre service ».

## Pour les développeurs

Le module offre le service `gallery.albums` (lecture seule, version 1) : `list({ limit, cursor, q })` et `get(id)`, pour lier un album à un événement par exemple. Détails dans `docs/ideas/gallery.md` du dépôt.

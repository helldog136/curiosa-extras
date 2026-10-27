# Story d'annonce : refonte ergonomique de l'éditeur (2.5.0)

Demande de la propriétaire : « les derniers ajouts dans story vidéo ont rendu l'interface très lourde à utiliser. Repense-la pour être ergonomique. Prends le prochain événement par défaut aussi pour pas devoir forcément faire une recherche. »
Personne de référence (archétype, pas une vraie personne) : « Emma », créatrice non technique, souvent sur téléphone.

## 1. État des lieux (Story d'annonce 2.3.0)

Mesures dans Chromium sur un serveur jetable (agenda de 41 streams, YouTube et Twitch simulés, jeux avec jaquettes dont une ambiguë), à l'ouverture de l'écran.

| Mesure à l'ouverture | 2.3.0, 390 px | 2.3.0, 1280 px | 2.5.0, 390 px | 2.5.0, 1280 px |
|---|---|---|---|---|
| Champs de saisie visibles (cases, boutons radio, textes, listes) | 24 | 24 | **0** | **0** |
| Boutons visibles | 31 | 31 | **5** | **5** |
| Hauteur de la page | 6 975 px (8,3 écrans) | 4 399 px | 1 139 px | 906 px |
| Position du bouton « Générer la vidéo » | 3 883 px sous le haut de la page : **4,6 écrans de défilement** | 928 px : sous le pli | **toujours visible** (barre fixe) | **visible** à l'ouverture |
| Clics pour obtenir la vidéo du prochain événement | 1, après avoir trouvé le bouton | 1 | **1** | **1** |
| Éléments interactifs sous 44 px de haut | 20 | 20 | 0 | 0 |

Ce qui rendait l'écran lourd (lu sur les captures `before-*` : la page entière à 390 px fait 8 écrans de hauteur) :

1. **Tout est exposé en même temps** : 7 blocs empilés (événement, éléments, textes, style et format, co-streamers, modèles, aperçu), 24 champs, alors que la plupart des vidéos n'ont besoin d'aucun réglage.
2. **La liste d'événements ouvre la page** : 20 lignes de 60 px, plus une barre de recherche, trois boutons de filtre, un bouton « voir plus », des notes de sources, un bouton « écrire moi-même ». Le prochain événement était bien présélectionné, mais rien ne le disait clairement, et la liste de 20 lignes cachait tout le reste.
3. **L'aperçu est loin des réglages** : sur téléphone il est après la liste (≈ 1 200 px de défilement) ; quand on change le style plus bas, on ne voit plus l'effet.
4. **Le bouton principal est enterré** : il est tout en bas de la carte « Aperçu », sur téléphone à 3 900 px.
5. **Options avancées exposées** : sept cases « ce que la vidéo montre », le format, un curseur de durée, la langue, le nom de la chaîne, les « zones de sécurité » : toutes au même niveau que le style.
6. **Redondances** : titre de page + phrase d'aide + titre de bloc + phrase d'aide + rappel « Story pour : … » ; la phrase personnalisée est séparée en deux blocs (éléments, textes) ; la case « zones de sécurité » est dans l'aperçu.
7. **Cibles tactiles trop petites** : cases des éléments (32 px), curseur, résumés pliables.
8. **Erreurs sans exemple**, parfois dans un bandeau en haut de page au lieu d'être sous le champ (nom de modèle).
9. **Pas d'état « en cours »** sur « Enregistrer », « Ajouter », « Réessayer » ; sur « Générer », la barre de progression est en bas.

## 2. Principes retenus

Un chemin principal d'un seul clic ; tout le reste facultatif et replié ; mobile d'abord (cibles ≥ 44 px, bouton principal toujours atteignable) ; mots simples ; erreurs sous le champ avec un exemple ; aperçu visible dès l'ouverture ; options avancées seulement sur demande ; aucune fonction perdue ; le travail en cours n'est jamais perdu quand on change d'événement ; clavier et lecteur d'écran ; mouvement réduit respecté.

## 3. Deux maquettes

Fichiers : `docs/ideas/stream-story-ux/maquette-A.html` et `maquette-B.html` (HTML/CSS statique). Captures (hors dépôt, trop lourdes pour être utiles) : `mock-A-390.png`, `mock-A-1280.png`, `mock-B-390.png`, lues avant le choix.

- **A. Une seule page, tout replié.** L'événement choisi dans une carte (avec « Changer »), l'aperçu juste dessous, un bouton « Générer » fixe en bas, et une seule section repliée « Personnaliser » qui contient le reste.
- **B. Assistant en 3 étapes** (1 Événement, 2 Look, 3 Vidéo), un bouton « Suivant » par étape.

**Choix : A.** B coûte 3 clics au lieu d'1 pour la vidéo par défaut (le cas de loin le plus fréquent), sépare l'aperçu des réglages (il faut changer d'étape pour voir l'effet), impose un état « étape en cours » à retenir et un retour arrière, et se prête mal aux modèles et aux préparations d'un assistant, qui remplissent tout d'un coup. A garde un seul écran, l'aperçu toujours là, et ajoute la profondeur seulement à la demande.

## 4. Changement de choix : la propriétaire préfère la maquette B

Après avoir vu les maquettes, la propriétaire a choisi **B (assistant en 3 étapes)**. A avait été construite et vérifiée (commits 530e052 et e9e58ae) ; B la remplace dans 2.4.0, en gardant tout ce qui était déjà vérifié (prochain événement par défaut, liste courte, options avancées repliées et mémorisées, cas vides et pannes, jaquette incertaine, erreurs sous le champ, 44 px, FR/EN, clavier).

Les trois défauts reprochés à B plus haut, et la réponse apportée pour que l'objectif « 1 clic » tienne :

1. **« 3 clics au lieu d'1 »** : **« Générer maintenant »** est visible dès l'étape 1 (et à l'étape 2). Le prochain événement y est déjà choisi : le cas courant reste à **1 clic**. Le bouton mène à l'étape 3, où la progression s'affiche, puis lance la création.
2. **« L'aperçu est loin des réglages »** : l'aperçu n'appartient à aucune étape, il est visible à **chaque** étape et se met à jour en direct : à côté sur grand écran (collé), réduit et collé en haut sur téléphone (24 % de la hauteur), avec Pause et Rejouer.
3. **« Mal adapté aux modèles et aux préparations d'un assistant »** : une préparation `story_prepare`, ou le chargement d'un modèle, ouvre (ou envoie) l'assistant sur l'**étape 3**, dont le récapitulatif offre un lien **« Modifier »** par réglage qui ramène à l'étape concernée. Le travail n'est jamais perdu en revenant en arrière (les étapes gardent leur état).

Comportement de l'assistant :
- Indicateur d'étapes cliquable (3 boutons, l'étape en cours porte `aria-current="step"`, les étapes vues un pastille verte) ; Précédent / Suivant ; sur téléphone la barre de boutons est fixe en bas, sur grand écran elle est collée en bas du panneau. Un changement d'étape remonte en haut de page, met le focus sur le titre de l'étape et l'annonce (« Étape 2 sur 3 : Look »). Pendant la création, la navigation est désactivée.
- **1 Événement** : prochain événement présélectionné (badge), « Changer d'événement » (liste courte de 5, « Voir plus » +10, recherche et filtres au-delà de 8 événements), saisie manuelle (ouverte d'emblée s'il n'y a rien), avertissements de source en panne, jaquette incertaine et lien « Ce n'est pas le bon jeu ? ».
- **2 Look** : style, phrase, mention « Made with Curiosa », co-streamers, modèles ; options avancées derrière une case mémorisée (ouverte d'office si un réglage avancé a changé).
- **3 Vidéo** : progression et résultat en haut du panneau, puis récapitulatif (événement, style, format et durée, phrase, mention, co-streamers), avec le même avertissement de jaquette et le lien.

## 5. Mesures (Chromium, serveur jetable, 41 streams d'agenda + YouTube + Twitch simulés)

| À l'ouverture | 2.3.0 (390) | 2.3.0 (1280) | 2.5.0 B (390) | 2.5.0 B (1280) |
|---|---|---|---|---|
| Champs de saisie visibles | 24 | 24 | **0** | **0** |
| Boutons visibles | 31 | 31 | 8 (3 étapes, Pause, Rejouer, Changer, Suivant, Générer maintenant) | 8 |
| Hauteur de la page | 6 975 px | 4 399 px | 852 px | 900 px |
| Bouton pour obtenir la vidéo | à 3 883 px (4,6 écrans) | à 928 px | **toujours visible** | visible |
| Aperçu visible à l'ouverture | non (sous la liste) | oui | oui (203 px de haut, collé) | oui (551 px) |
| Clics : vidéo du prochain événement | 1 (+ 4,6 écrans à descendre) | 1 | **1** (« Générer maintenant ») | **1** |
| Clics : en passant par les 3 étapes | n/a | n/a | 3 (Suivant, Suivant, Générer) | 3 |
| Cibles < 44 px | 20 | 20 | 0 | 0 |

À l'étape 2, 7 champs sont visibles (4 styles, phrase, mention, case des options avancées) ; tout ouvert, 21 (autant que l'ancien écran moins ceux de l'événement), seulement sur demande.

## 6. Re-vérification sur la base 2.4.0 (jaquettes via `game.cover`), version 2.5.0

Chromium, serveur jetable (cœur 0.2.14, modules Agenda, Jaquettes de jeux et Story, faux RAWG local), prochain événement = un jeu dont la jaquette est incertaine ; 390 px et 1280 px, clair et sombre, français et anglais. À l'ouverture : **0 champ de saisie, 8 boutons** aux deux largeurs ; hauteur de l'éditeur 952 px à 390 px (la ligne d'avertissement de jaquette est en plus des 852 px d'origine) et 867 px à 1280 px ; « Générer maintenant » visible sans défilement ; l'aperçu est affiché. Étape 2 : 11 champs, étape 3 : 0 champ. « Générer maintenant » produit et télécharge la vidéo. La jaquette est demandée au service `game.cover` (une seule recherche chez le faux RAWG), l'avertissement « Ce n'est pas le bon jeu ? » et son lien sont là aux étapes 1 et 3. Les gains tiennent (24 → 0 champs, 31 → 8 boutons, 6 975 → moins de 1 000 px en mobile).

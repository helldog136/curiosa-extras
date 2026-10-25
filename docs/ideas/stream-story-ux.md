# Story d'annonce : refonte ergonomique de l'éditeur (2.4.0)

Demande de la propriétaire : « les derniers ajouts dans story vidéo ont rendu l'interface très lourde à utiliser. Repense-la pour être ergonomique. Prends le prochain événement par défaut aussi pour pas devoir forcément faire une recherche. »
Personne de référence (archétype, pas une vraie personne) : « Emma », créatrice non technique, souvent sur téléphone.

## 1. État des lieux (Story d'annonce 2.3.0)

Mesures dans Chromium sur un serveur jetable (agenda de 41 streams, YouTube et Twitch simulés, jeux avec jaquettes dont une ambiguë), à l'ouverture de l'écran.

| Mesure à l'ouverture | 2.3.0, 390 px | 2.3.0, 1280 px | 2.4.0, 390 px | 2.4.0, 1280 px |
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

## 4. Ce qui est construit (A, dans le vrai module)

- **Prochain événement par défaut** : le premier événement **qui n'a pas commencé**, toutes sources confondues, déjà trié par date et heure par l'agrégation qui existait (`events.mjs`, rien de dupliqué). Une journée entière d'aujourd'hui compte encore. Si tout est déjà commencé, le premier. Étiquette « Prochain événement » ; « Déjà commencé » sur ce qui a débuté ; « Au même moment : … » quand deux événements ont la même heure.
- **Changer d'événement** : un bouton ouvre une liste **courte** (5, puis « Voir plus » +10) avec source, jour et heure ; la recherche et les filtres de source n'apparaissent que s'il y a plus de 8 événements. Un clic choisit et referme ; style, phrase, mention et co-streamers restent.
- **Aucun événement** : message clair, saisie manuelle ouverte d'emblée. **Source en panne** : message sous l'événement choisi (pas dans la liste repliée) + « Réessayer ».
- **Personnaliser** (replié) : style, phrase, mention « Made with Curiosa », co-streamers, modèles. **Options avancées** (case, mémorisée dans le navigateur, ouverte d'office si un réglage avancé a été modifié par un modèle ou un assistant) : ce que la vidéo montre, format, durée, nom de la chaîne, langue, zones de sécurité.
- **Aperçu et bouton** : l'aperçu est visible à l'ouverture ; sur téléphone, le bouton « Générer la vidéo » est une barre fixe en bas ; pendant qu'on personnalise, l'aperçu se réduit et reste collé en haut. « Générer » affiche « Création en cours… 42 % ».
- **Accessibilité** : ordre du code = ordre visuel (événement, aperçu, bouton, réglages) ; focus rendu au bouton « Changer » après un choix, Échap referme la liste ; `aria-expanded`, `aria-busy`, `aria-invalid`, `aria-describedby` sur les champs ; cibles ≥ 44 px ; mouvement réduit respecté.

## 5. Vérification dans Chromium

Voir le rapport du chantier : parcours de bout en bout à 390 et 1280 px, FR et EN, clair et sombre (une vidéo produite à chaque fois), changement d'événement, aucun événement, source en panne, personnalisation avec jaquette incertaine (le lien « Ce n'est pas le bon jeu ? » est conservé), clavier. Captures lues : `before-390-clair-fr-{fold,full}`, `before-1280-clair-fr-{fold,full}`, `mock-*`, `after-*`, `e2e-*`, `scen-*`, `s4-*` (dossier de travail, non versionné).

# Mur des remerciements

Une page « Merci ! » pour votre communauté : les personnes que vous voulez remercier (modération, soutiens, bêta-test…) en grille de cartes avec leur photo, **une personne à l'honneur chaque mois** et un **petit mot** pour qui vous voulez.

Vous ne retapez rien : les noms et les photos viennent de **Contacts**. Vous rangez une fiche dans une catégorie, et la personne apparaît sur le mur.

## À quoi ça sert

On veut remercier sa communauté, mais personne n'a le temps de recopier des noms et de retrouver des photos. Ici, le mur se construit tout seul à partir de vos fiches, et reste à jour quand vous en ajoutez ou en retirez.

## Pour commencer (2 minutes)

1. Installez le module : Contacts s'installe avec lui si vous ne l'avez pas.
2. Dans Contacts, rangez les fiches à remercier dans une catégorie (par exemple « Modération »).
3. Ouvrez le module, onglet **Réglages**, et choisissez cette catégorie dans « Qui remercier ». Pas encore de catégorie ? Tapez son nom et cliquez sur « Créer ». S'il n'y a qu'une seule catégorie dans Contacts, elle est prise toute seule.
4. Votre mur est en ligne, à l'adresse `/merci` (vous pouvez la changer à la création de l'instance).

Pour remercier plusieurs groupes (« Modération », « Mécènes »…), cliquez sur « Ajouter un deuxième groupe » (jusqu'à six groupes), et donnez-leur un titre.

## Ce que voit votre public

- En haut, la **personne à l'honneur** du mois, en grand, avec votre petit mot.
- Puis chaque **groupe** : son titre, le nombre de personnes, et une grille de cartes (photo ou initiales, nom, petit mot). Un bouton « Voir tout le monde » ouvre le groupe entier, 50 cartes par page.
- Sur téléphone, deux cartes par ligne ; au clavier, tout est atteignable ; les mouvements sont coupés pour les personnes qui préfèrent moins d'animation.

## Un petit mot par personne

Onglet **Mon mur**, section « Un petit mot pour chaque personne » : cherchez la personne, cliquez sur « Écrire un message » (160 caractères, dans chaque langue de votre site). Le message est gardé ici, rattaché à la fiche : si la fiche est fusionnée avec une autre dans Contacts, il la suit ; si elle est supprimée, il disparaît.

## À l'honneur ce mois-ci

Onglet **Mon mur**, section « À l'honneur ce mois-ci » : tapez le nom, choisissez le mois (ce mois-ci ou l'un des cinq suivants : vous pouvez préparer à l'avance) et ajoutez si vous voulez un mot sur pourquoi. Une personne par mois ; le premier du mois, la suivante prend la place toute seule.

## Une personne ne veut pas apparaître

Le module ne garde rien sur les personnes : c'est Contacts qui possède la fiche, donc c'est là que se règle « ne pas montrer ».

Dans Contacts, créez une catégorie **« Ne pas montrer »**, puis rangez dedans la fiche de la personne : elle disparaît du mur en moins de deux minutes, même si elle est aussi dans une catégorie remerciée, même si elle est à l'honneur. (Vous pouvez aussi choisir une autre catégorie dans les réglages : « Catégorie Ne pas montrer ».) Pour la remontrer, sortez la fiche de cette catégorie. Les fiches qui viennent du formulaire de contact et que vous n'avez pas encore relues n'apparaissent jamais.

## Dans vos pages d'overlay (version 1.2.0, Curiosa 0.5.0)

Si vous composez vos propres **pages d'overlay** (section « Overlays » de l'administration, une seule adresse à coller dans OBS), le module propose l'élément **« Remerciements »** : les **dernières personnes à remercier**, qui défilent.

- **Rien de plus que votre mur public.** Les personnes viennent de la même lecture que la page `/merci` : mêmes catégories de Contacts, même catégorie « Ne pas montrer » (une personne cachée n'apparaît jamais, ici non plus), mêmes fiches à relire écartées, même choix de nom (« comme sur la fiche », prénom seulement ou pseudo) et mêmes petits mots. **Pas de photo** (rien n'est chargé chez un tiers) : un rond avec les initiales.
- **Quatre options** : **Groupe** (tous à tour de rôle, ou l'un des groupes de votre mur), **Nombre de personnes** (de 1 à 30, 10 par défaut), **Faire défiler** (oui par défaut : la liste défile quand elle ne tient pas dans le cadre) et **Montrer le petit mot**. Les plus récentes d'abord.
- **Taille** : il s'adapte à la taille choisie (minimum 200 × 80) : une colonne qui défile vers le haut dans un cadre haut ou carré, une rangée qui défile vers la gauche dans un bandeau. Fond transparent par défaut ; il suit le style commun de la page d'overlay et ne charge jamais le style de votre site.
- **Si Contacts ne répond plus**, l'élément garde le dernier mur connu (24 heures), comme la page publique ; sans rien de connu, le cadre reste vide en direct. En mode test, des personnes d'exemple apparaissent.
- **Charge** : plusieurs pages d'overlay peuvent montrer l'élément ; une seule lecture de Contacts sert tout le monde. Rien n'est consommé ni écrit, aucune tâche de fond.
- **Vos soutiens** : le module **Soutiens** n'a rien à faire ici. Il range, si vous le voulez, les personnes qui ont donné leur accord dans la catégorie de Contacts de votre choix ; mettez cette catégorie dans un groupe du mur, et ces personnes apparaissent aussi dans l'élément.
- Développeurs : route publique `element/:slug` (nouveau droit `routes`, adresse sans secret), fichier `overlay.mjs` (réutilise `getWall`, `displayOf` et `readData`), test `tests/overlay-elements-thanks.test.mjs`.

## Les noms et les photos

- **Noms** : « comme sur la fiche » (par défaut), « prénom seulement » ou « pseudo en ligne ». Le mur est public : choisissez ce qui vous convient.
- **Photos** : celles de Contacts (photo envoyée à la main, sinon celle du compte Twitch, YouTube ou Bluesky). Le navigateur de la personne qui visite les charge directement là où elles sont. Une photo qui vient d'un autre endroit, ou qui ne charge pas, est remplacée par les initiales. Vous pouvez couper les photos dans les réglages.

## Si Contacts ne répond plus

La page publique garde le **dernier mur connu** (jusqu'à 24 heures) ; sans rien de connu, elle affiche un message aimable (« Le mur se prépare »). Jamais une page d'erreur. L'administration le dit en toutes lettres.

## Limites

- 6 groupes au plus ; 1 000 fiches lues par groupe (au-delà, seules les 1 000 premières sont montrées, et l'administration le dit) ; 50 cartes par page ; 1 000 messages au plus ; 24 mises à l'honneur gardées.
- Le mur se reconstruit au plus toutes les 2 minutes : un changement dans Contacts se voit en moins de deux minutes.
- Le mois à l'honneur change à minuit (heure universelle).
- Pas de récupération automatique des personnes abonnées sur Twitch : cela demande des droits que vous n'avez pas toujours. Le mur s'appuie sur vos fiches.
- Aucune saisie du public, aucun cookie, aucun message du public.

## Pour l'assistant IA

Six outils : l'état du mur, la liste des personnes d'un groupe, écrire ou retirer un message, mettre à l'honneur ou retirer une mise à l'honneur. Les outils qui écrivent ne sont pas accordés d'office. Les fiches se retrouvent avec les outils de Contacts.

## Vie privée

Le module ne copie ni nom, ni photo, ni pseudo : il garde seulement vos messages et vos mises à l'honneur, rattachés au numéro de la fiche. Quand une fiche est exportée ou effacée depuis Contacts, ces éléments sont exportés ou effacés avec elle.

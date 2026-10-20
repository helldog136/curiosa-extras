# Raid Twitch

Vous finissez votre live et vous voulez **raider un ami**. Mais qui est en direct à cet instant ? Ce module vous le montre : vous y listez les chaînes de vos partenaires, et il vous donne un **petit panneau (un « dock »)** à placer dans OBS. Ce panneau n'affiche **que les partenaires en direct**, avec leur jeu, leur titre, leurs spectateurs et depuis combien de temps ils streament.

**Un clic sur un partenaire copie la commande de raid** (par exemple `/raid mon_ami`). Vous la collez dans votre chat Twitch et appuyez sur Entrée : c'est vous qui lancez le raid, le module n'écrit jamais à votre place.

## Pour commencer
1. **Installez le module.** « Chaîne Twitch » s'installe avec lui. Si ce n'est pas déjà fait, renseignez votre chaîne et l'application Twitch dans « Chaîne Twitch » (c'est la même pour tout ce qui touche à Twitch, une seule fois).
2. **Ajoutez vos partenaires.** Sur la page du module, tapez un pseudo Twitch par ligne. Vous pouvez aussi coller l'adresse de la chaîne (`twitch.tv/pseudo`) ou un `@pseudo`, et en coller plusieurs d'un coup : le module range tout seul. Si un pseudo n'est pas bon, il vous dit lequel et pourquoi, et ajoute quand même les autres.
3. **Placez le dock dans OBS.** Copiez « l'adresse du dock », puis dans OBS : **Docks**, **Docks de navigateur personnalisés**, un nom (« Raid »), l'adresse, **Appliquer**. Vous pouvez aussi ouvrir cette adresse dans un onglet.
4. **Vérifiez** avec « Voir qui est en direct maintenant » : si tout est en place, le module le dit, et sinon il explique quoi régler.

## Le dock
- **Seuls les partenaires en direct** apparaissent. Pour chacun : son nom, le jeu, le titre, le nombre de spectateurs et la durée du live.
- **Par défaut, ceux qui ont le moins de spectateurs sont en haut** : un raid fait surtout plaisir à une petite chaîne. Un menu « Trier » permet de choisir autre chose : le plus de spectateurs, le live le plus récent, le plus long, ou l'ordre de votre liste.
- **Un clic sur un partenaire** copie `/raid pseudo` et le dit clairement (« Copié : /raid pseudo »). Si votre navigateur refuse de copier, la commande s'affiche toute prête à sélectionner et copier à la main.
- **« Au hasard »** : le bouton en haut choisit un partenaire en direct au hasard, le met en évidence et copie sa commande. Cliquez encore pour en tirer un autre.
- **Rien à faire pour le tenir à jour** (jusqu'à 500 chaînes) : il se rafraîchit tout seul (environ toutes les 45 secondes), sans clignoter. Si Twitch ne répond pas, il le dit, garde la dernière liste connue et réessaie seul.
- Il est pensé pour un **dock étroit** (300 pixels) comme pour un téléphone, en sombre, et se manie aussi au clavier.
- Aucun partenaire en direct ? Il écrit simplement « Aucun de vos partenaires n'est en direct pour le moment ».

## Votre liste
- **Ajouter, modifier, retirer, monter, descendre.** Pour chaque chaîne, vous pouvez donner un **nom affiché** (si vous préférez un autre nom que celui de Twitch) et une **note** pour vous seul (elle n'apparaît jamais dans le dock).
- **2 000 chaînes au plus.** Pour une liste longue, la page affiche **50 chaînes par page**, avec un **champ de recherche** (pseudo, nom ou note), le nombre total de chaînes en haut, et les mêmes boutons Modifier / Retirer sur chaque ligne : après une action, vous revenez à la même page.
- **Importer toute une communauté d'un coup** : collez vos pseudos (un par ligne, ou séparés par des virgules ou des espaces), environ 1 400 à la fois. Un bilan dit combien ont été ajoutés, combien y étaient déjà et lesquels ne sont pas valables, **sans bloquer les bons**. Si votre texte est trop long, le module le dit et vous indique où reprendre : aucun pseudo coupé en deux n'est ajouté.
- **Une sauvegarde lisible** de la liste (tableur) est incluse dans les sauvegardes du site.
- L'ordre de votre liste sert au tri « Dans l'ordre de ma liste », et à départager deux chaînes qui ont autant de spectateurs.

## Pour une grande communauté (association, collectif)
Le module sait servir **des centaines de membres** avec un seul dock.

- **Jusqu'à 500 chaînes**, le dock montre **tous les membres en direct**, comme pour une petite liste.
- **Au-delà de 500 chaînes**, il propose un grand bouton **« Trouver un streameur en ligne au hasard »**. Un clic choisit un membre en direct, le met en évidence (jeu, titre, spectateurs, durée) et **copie sa commande de raid**. « Un autre au hasard » en propose un différent. Si personne n'est trouvé : « Personne n'a été trouvé en ligne pour l'instant, réessayez. » Un petit délai de 2 secondes entre deux clics évite les doubles clics, et si beaucoup de monde clique en même temps, un message dit de patienter quelques secondes.
- **Pourquoi ce changement ?** Twitch ne permet de vérifier que 100 chaînes à la fois. Sur une très grande communauté, afficher tout le monde demanderait énormément de demandes à Twitch ; le bouton « au hasard » donne le même service, bien plus légèrement. La page d'administration vous dit toujours dans quel cas vous êtes (« Vous avez 612 chaînes : le dock propose un bouton "au hasard"… »).
- **Votre propre chaîne n'est jamais proposée** : on ne se raide pas soi-même.

### Installer le site central de l'association
Une seule personne tient la liste, sur **un seul site**. Les membres n'ont **rien à installer** et n'ont pas besoin de Curiosa ni d'un accès Twitch : ils ajoutent simplement l'adresse du dock dans OBS.

1. Installez **« Chaîne Twitch »** sur le site central et renseignez l'**identifiant client** et le **secret** de votre application Twitch. Aucune connexion de compte n'est nécessaire.
2. Installez **« Raid Twitch »**.
3. Importez la liste des membres (zone « Ajouter des partenaires », collage par paquets).
4. Copiez **l'adresse du dock** et donnez-la à vos membres : dans OBS, **Docks**, **Docks de navigateur personnalisés**, un nom, l'adresse, **Appliquer**.

Le site central **n'interroge Twitch que lorsque quelqu'un regarde ou clique**, et le nombre de demandes **ne dépend pas du nombre de membres** : tout le monde partage les mêmes réponses (30 secondes pour la liste complète, une minute pour le mode « au hasard »). Rien n'est écrit sur le disque : si le site redémarre, les réponses gardées sont simplement oubliées.

## Son adresse reste secrète
L'adresse du dock contient un code secret, créé pour vous : sans lui, la page ne montre rien. **Pour votre seul usage, gardez-la pour vous. Pour une communauté, donnez-la à vos membres** : tous voient le même dock, qui n'affiche que ce que Twitch montre déjà à tout le monde (nom, jeu, titre, spectateurs), **jamais vos notes**. Si elle a été partagée par erreur, ou si une personne ne doit plus y avoir accès, « Nouvelle adresse » en crée une autre (avec une confirmation) : **l'ancienne cesse de marcher aussitôt pour tout le monde**, et chacun doit coller la nouvelle dans OBS. Il n'y a pas d'adresse par membre pour l'instant : une même adresse pour tous.

## Votre IA
Un outil, **non accordé d'office** (administration, accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `raid_partners_live` | Dit quels partenaires sont en direct maintenant (nom, jeu, titre, spectateurs, depuis combien de minutes) avec la commande de raid de chacun. Au-delà de 500 chaînes, elle ne donne pas la liste mais **un membre en direct tiré au hasard**. Lecture seule : rien n'est envoyé. |

## Pour vos autres modules
Si vous avez aussi « Story d'annonce », il peut **reprendre vos partenaires** (pseudo, nom affiché et **photo de profil Twitch**) pour les montrer dans vos vidéos d'annonce : un bouton lui suffit, rien à régler. Seuls le pseudo, le nom et la photo sont partagés : **jamais vos notes**, ni l'adresse secrète du dock. Sans ce module, rien ne change.

## À savoir
- Les informations viennent de Twitch **par « Chaîne Twitch »** : ce module ne parle jamais à Twitch lui-même. Il faut Chaîne Twitch en version 1.6.0 ou plus (la mise à jour est proposée toute seule) ; les photos de profil demandent la version 1.7.0, mais sans elles tout marche quand même.
- Pas besoin de connecter votre compte Twitch : l'identifiant et le secret de votre application, déjà réglés dans « Chaîne Twitch », suffisent.
- Les informations sont gardées 30 secondes : plusieurs docks ou onglets ouverts en même temps ne font qu'une seule demande à Twitch (une par groupe de 100 chaînes). Si une partie des chaînes n'a pas pu être vérifiée, le dock affiche ce qu'il a avec le message « Certaines chaînes n'ont pas pu être vérifiées. »
- Si votre site a plusieurs chaînes Twitch, le mode avancé permet de choisir laquelle utiliser.
- **Vie privée** : le module ne collecte rien sur vos visiteurs. Il garde votre liste de chaînes, vos notes et l'adresse secrète du dock, visibles des seuls administrateurs. Le dock n'affiche que des informations publiques de Twitch.

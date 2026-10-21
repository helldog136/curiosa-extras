# Raid Twitch

Vous finissez votre live et vous voulez **raider un ami**. Mais qui est en direct à cet instant ? Ce module vous le montre : vos partenaires sont dans **Contacts** (le carnet d'adresses de votre site), et il vous donne un **petit panneau (un « dock »)** à placer dans OBS. Ce panneau n'affiche **que les partenaires en direct**, avec leur jeu, leur titre, leurs spectateurs et depuis combien de temps ils streament.

**Un clic sur un partenaire copie la commande de raid** (par exemple `/raid mon_ami`). Vous la collez dans votre chat Twitch et appuyez sur Entrée : c'est vous qui lancez le raid, le module n'écrit jamais à votre place.

## Pour commencer
1. **Installez le module.** Le « Connecteur Twitch », « Ma Chaîne Twitch » et « Contacts » s'installent avec lui. Si ce n'est pas déjà fait, suivez le guide du Connecteur Twitch pour renseigner l'application Twitch (c'est la même pour tout ce qui touche à Twitch, une seule fois), et indiquez votre chaîne dans « Ma Chaîne Twitch ».
2. **Créez votre liste de raid.** Dans les réglages du module, réglage « Liste de raid », tapez « Cible de raid » puis cliquez sur « Créer » : c'est une catégorie de Contacts. (Si elle existe déjà, rien à faire : le module la trouve tout seul.)
3. **Ajoutez vos partenaires dans Contacts.** Ouvrez Contacts (le lien « Gérer mes partenaires dans Contacts » y mène), créez ou ouvrez la fiche de chaque partenaire, ajoutez sa chaîne Twitch et la catégorie « Cible de raid ». Une personne a une seule fiche pour tout le site : son nom et sa photo servent partout.
4. **Placez le dock dans OBS.** Copiez « l'adresse du dock », puis dans OBS : **Docks**, **Docks de navigateur personnalisés**, un nom (« Raid »), l'adresse, **Appliquer**. Vous pouvez aussi ouvrir cette adresse dans un onglet.
5. **Vérifiez** avec « Voir qui est en direct maintenant » : si tout est en place, le module le dit, et sinon il explique quoi régler.

## Le dock
- **Seuls les partenaires en direct** apparaissent. Pour chacun : son nom, le jeu, le titre, le nombre de spectateurs et la durée du live.
- **Par défaut, ceux qui ont le moins de spectateurs sont en haut** : un raid fait surtout plaisir à une petite chaîne. Un menu « Trier » permet de choisir autre chose : le plus de spectateurs, le live le plus récent, le plus long, ou l'ordre de votre liste.
- **Un clic sur un partenaire** copie `/raid pseudo` et le dit clairement (« Copié : /raid pseudo »). Si votre navigateur refuse de copier, la commande s'affiche toute prête à sélectionner et copier à la main.
- **« Au hasard »** : le bouton en haut choisit un partenaire en direct au hasard, le met en évidence et copie sa commande. Cliquez encore pour en tirer un autre.
- **Rien à faire pour le tenir à jour** (jusqu'à 500 chaînes) : il se rafraîchit tout seul (environ toutes les 45 secondes), sans clignoter. Si Twitch ne répond pas, il le dit, garde la dernière liste connue et réessaie seul.
- Il est pensé pour un **dock étroit** (300 pixels) comme pour un téléphone, en sombre, et se manie aussi au clavier.
- Aucun partenaire en direct ? Il écrit simplement « Aucun de vos partenaires n'est en direct pour le moment ».

## Votre liste (dans Contacts)
- **Votre liste de raid, ce sont les fiches d'une catégorie de Contacts** (« Cible de raid » par défaut, ou celle que vous choisissez dans le réglage « Liste de raid ») qui ont une chaîne Twitch. Une fiche avec deux chaînes Twitch compte deux fois (une par chaîne).
- **Ajouter, retirer, renommer, noter** : tout se fait dans Contacts. La page de Raid montre le nombre de chaînes, l'état du dock et le lien « Gérer mes partenaires dans Contacts ».
- **Le nom** affiché dans le dock est celui de la fiche (sinon celui de Twitch) ; **la photo** est celle que Contacts choisit pour la fiche.
- **La catégorie a disparu ?** La page le dit (« La catégorie choisie n'existe plus, choisissez-en une ») et le dock aussi. Si elle a été **fusionnée** avec une autre dans Contacts, Raid suit tout seul.
- **Contacts ne répond pas un moment ?** Le dock continue avec la dernière liste connue pendant 10 minutes au plus, puis le dit clairement.
- L'ordre de Contacts sert au tri « Dans l'ordre de ma liste », et à départager deux chaînes qui ont autant de spectateurs.

### Vous veniez d'une version 1.x ?
À la mise à jour, **votre ancienne liste passe dans Contacts toute seule** : une fiche par chaîne (une fiche qui existait déjà avec ce compte Twitch est reprise, jamais doublée), avec le nom que vous aviez donné et **votre note devenue une note de la fiche**. Si la catégorie « Cible de raid » existe déjà, les fiches y sont rangées. Sinon, la page de Raid vous demande une dernière étape : créer « Cible de raid » dans le réglage « Liste de raid », puis cliquer sur « Ranger mes chaînes dans cette catégorie ». En attendant, le dock continue d'utiliser vos chaînes. Une liste très longue se copie par morceaux : si la copie a été interrompue, un bouton « Continuer la copie » la reprend là où elle s'était arrêtée. **Rien n'est perdu** : votre ancienne liste reste gardée telle quelle jusqu'à une mise à jour d'entretien.

## Pour une grande communauté (association, collectif)
Le module sait servir **des centaines de membres** avec un seul dock.

- **Jusqu'à 500 chaînes**, le dock montre **tous les membres en direct**, comme pour une petite liste.
- **Au-delà de 500 chaînes**, il propose un grand bouton **« Trouver un streameur en ligne au hasard »**. Un clic choisit un membre en direct, le met en évidence (jeu, titre, spectateurs, durée) et **copie sa commande de raid**. « Un autre au hasard » en propose un différent. Si personne n'est trouvé : « Personne n'a été trouvé en ligne pour l'instant, réessayez. » Un petit délai de 2 secondes entre deux clics évite les doubles clics, et si beaucoup de monde clique en même temps, un message dit de patienter quelques secondes.
- **Pourquoi ce changement ?** Twitch ne permet de vérifier que 100 chaînes à la fois. Sur une très grande communauté, afficher tout le monde demanderait énormément de demandes à Twitch ; le bouton « au hasard » donne le même service, bien plus légèrement. La page d'administration vous dit toujours dans quel cas vous êtes (« Vous avez 612 chaînes : le dock propose un bouton "au hasard"… »).
- **Votre propre chaîne n'est jamais proposée** : on ne se raide pas soi-même.

### Installer le site central de l'association
Une seule personne tient la liste, sur **un seul site**. Les membres n'ont **rien à installer** et n'ont pas besoin de Curiosa ni d'un accès Twitch : ils ajoutent simplement l'adresse du dock dans OBS.

1. Installez **« Raid Twitch »** sur le site central : le **Connecteur Twitch** et **Ma Chaîne Twitch** s'installent avec lui. Dans le Connecteur, renseignez l'**identifiant client** et le **secret** de votre application Twitch ; dans Ma Chaîne Twitch, la chaîne du site. Aucune connexion de compte n'est nécessaire.
2. Ouvrez la page de **« Raid Twitch »**.
3. Mettez les membres dans Contacts, dans la catégorie « Cible de raid » (l'import de Contacts accepte une liste collée ou un fichier).
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
Si vous avez aussi « Story d'annonce », il peut **reprendre vos partenaires** (pseudo, nom et photo, lus dans Contacts) pour les montrer dans vos vidéos d'annonce : un bouton lui suffit, rien à régler. Seuls le pseudo, le nom et la photo sont partagés : **jamais de note**, ni l'adresse secrète du dock. Sans ce module, rien ne change.

## À savoir
- Les informations viennent de Twitch **par le « Connecteur Twitch »** : ce module ne parle jamais à Twitch lui-même. La liste vient de **Contacts** (version 2 ou plus). Il faut Curiosa 0.2.1 ou plus ; le Connecteur, Ma Chaîne Twitch et Contacts sont installés ou mis à jour avec lui.
- Pas besoin de connecter votre compte Twitch : l'identifiant et le secret de votre application, réglés une fois dans le Connecteur Twitch, suffisent.
- Les informations sont gardées 30 secondes : plusieurs docks ou onglets ouverts en même temps ne font qu'une seule demande à Twitch (une par groupe de 100 chaînes). Si une partie des chaînes n'a pas pu être vérifiée, le dock affiche ce qu'il a avec le message « Certaines chaînes n'ont pas pu être vérifiées. »
- Si votre site a plusieurs chaînes Twitch (plusieurs « Ma Chaîne Twitch »), le mode avancé permet de **choisir dans la liste** laquelle utiliser ; sans choix, c'est la première qui est prête. Avec une seule chaîne, il n'y a rien à choisir. Si vous aviez tapé un pseudo avant la version 1.3.0, il continue de servir ; la page vous propose de confirmer la chaîne dans la liste.
- **Vie privée** : le module ne collecte rien sur vos visiteurs. Il ne garde pas de liste à lui (elle est dans Contacts) : seulement l'adresse secrète du dock et, après une mise à jour depuis la 1.x, la copie inchangée de l'ancienne liste (retirée lors d'une mise à jour d'entretien). Quand une personne est effacée dans Contacts, elle est aussi retirée de cette copie, et l'export « tout ce que le site sait d'elle » inclut ce que Raid en garde. Le dock n'affiche que des informations publiques de Twitch.

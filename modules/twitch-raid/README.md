# Raid Twitch

Vous finissez votre live et vous voulez **raider un ami**. Mais qui est en direct à cet instant ? Ce module vous le montre : vos partenaires sont dans **Contacts** (le carnet d'adresses de votre site), et il vous donne un **petit panneau (un « dock »)** à placer dans OBS. Ce panneau n'affiche **que les partenaires en direct**, avec leur jeu, leur titre, leurs spectateurs et depuis combien de temps ils streament.

**Un clic sur un partenaire copie la commande de raid** (par exemple `/raid mon_ami`). Vous la collez dans votre chat Twitch et appuyez sur Entrée : c'est vous qui lancez le raid, le module n'écrit jamais à votre place.

## Pour commencer
1. **Installez le module.** Le « Connecteur Twitch », « Ma Chaîne Twitch » et « Contacts » s'installent avec lui. Si ce n'est pas déjà fait, suivez le guide du Connecteur Twitch pour renseigner l'application Twitch (c'est la même pour tout ce qui touche à Twitch, une seule fois), et indiquez votre chaîne dans « Ma Chaîne Twitch ».
2. **Ajoutez votre première chaîne** avec le champ « Ajouter une chaîne » en haut de la page de Raid : tapez un nom, un pseudo Twitch ou collez le lien de la chaîne. La liste « Cible de raid » se crée toute seule dans Contacts, vous n'avez rien à préparer. (Si vous avez déjà une catégorie de Contacts pour vos raids, Raid la trouve et l'utilise.)
3. **Ajoutez les autres de la même façon**, une par une ou plusieurs d'un coup (voir « Ajouter une chaîne » plus bas). Pas besoin de remplir une fiche : le nom et la photo sont repris sur Twitch tout seuls.
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

## La sélection du moment (facultatif, depuis la 2.2)
Au lieu de montrer **tous** vos partenaires en direct, ce mode en choisit **quelques-uns au hasard** (de 1 à 10, 5 par défaut) pour donner envie de les raider, ou de les découvrir. Il est **éteint par défaut** : tant que vous n'y touchez pas, le dock ne change pas d'un pixel. Tout se règle dans l'onglet **« Sélection du moment »** de la page de Raid.

- **Stable** : les membres choisis ne changent pas à chaque rafraîchissement ni d'un visiteur à l'autre. La sélection dure **10 minutes** (réglable de 1 à 240), puis une nouvelle est tirée. « **Tirer de nouveau** » (dans le dock de la sélection, ou dans l'administration) en tire une autre tout de suite, pour tout le monde.
- **Équitable** : les mêmes personnes ne reviennent pas tant que d'autres sont en direct ; quand tout le monde est passé, on recommence par ceux montrés il y a le plus longtemps.
- **Moins de membres en direct que demandé ?** On montre ceux qui le sont, et la sélection se complète toute seule quand d'autres arrivent. Un membre qui s'arrête est remplacé, les autres ne bougent pas.
- **Petites chaînes d'abord** (option avancée, éteinte par défaut) : moins une chaîne a de spectateurs, plus elle a de chances d'être tirée.
- **Ne jamais tirer** (option avancée) : une liste de pseudos (par exemple vous-même). Votre propre chaîne n'est de toute façon jamais tirée.
- **Personnes qui ne veulent pas apparaître** : une personne rangée dans la catégorie **« Ne pas montrer »** de Contacts (ou celle que vous choisissez en mode avancé) n'est **jamais** tirée ni montrée, pas plus qu'une fiche encore « à relire ». Si Contacts ne répond pas, on garde la dernière sélection ou on n'affiche rien : on ne devine jamais.
- **Le dock de la sélection** : une adresse à part, secrète comme celle du dock ordinaire (la même clé : « Nouvelle adresse » remplace les deux), à ajouter dans OBS ou à ouvrir dans un onglet. Un clic sur un membre copie sa commande de raid. Le réglage « Que montre le dock ordinaire ? » permet aussi de faire afficher la sélection par l'adresse que vous avez déjà collée dans OBS.
- **La page publique « En direct en ce moment »** (facultative, éteinte par défaut) : une page de votre site avec les **mêmes** chaînes (nom, jeu, titre, spectateurs, durée du direct, bouton « Regarder sur Twitch » qui ouvre Twitch dans un nouvel onglet). Elle se rafraîchit toute seule environ chaque minute, sans clignoter ; si Twitch ne répond pas elle garde la dernière sélection ; si personne n'est en direct elle le dit gentiment. **La liste complète n'est jamais publique**, seulement les chaînes tirées. Les aperçus des directs sont une option : les images viennent de Twitch et ne se chargent que si le visiteur clique sur « Afficher les aperçus ».
  - Pour l'allumer : cochez « Afficher la page publique sur le site » (onglet « Sélection du moment »). Sur une nouvelle installation, la page a déjà son adresse (« en-direct » proposée). Sur un site qui avait déjà Raid, passez en **mode avancé** et donnez-lui une adresse dans « Adresse de la page » en haut de la page ; l'administration vous le rappelle. Ajoutez-la ensuite au menu du site si vous le souhaitez.
  - **Vos mots** : le titre, la phrase d'introduction, le texte « personne en direct » et le texte du bouton se changent dans les réglages (FR et EN). Laissés vides, des mots simples et neutres sont utilisés (« En direct en ce moment », « Voici qui est en direct sur Twitch maintenant. Passez leur dire bonjour ! »). Un titre que vous aviez déjà saisi ne change pas.
  - **Page éteinte = page absente** (depuis la 2.2.1) : décochée, la page répond « page introuvable » comme si elle n'existait pas, son rafraîchissement automatique aussi, et le module n'ajoute rien nulle part. Deux choses viennent du site et non du module : si vous avez mis la page dans le menu, retirez-la du menu tant qu'elle est éteinte ; et le plan du site destiné aux moteurs de recherche peut encore citer l'adresse (sans effet pour vos visiteurs : ils voient « page introuvable »). L'administration vous le dit sous la case. L'adresse et la case restent deux réglages séparés (l'adresse est celle du site, en mode avancé) : la page n'apparaît que si **les deux** sont réglés, et l'administration vous dit lequel manque.
- **Légèreté pour Twitch** : la sélection utilise le même appel groupé que le dock (jusqu'à 100 chaînes par demande, gardé 30 secondes) : dix visiteurs ou mille ne font qu'une seule demande. Au-delà de 500 chaînes, la sélection se tire par paquets de 100 avec les mêmes limites que le bouton « au hasard ».
- **Rien sur le disque** : la sélection et la mémoire de rotation (200 pseudos au plus) vivent dans la mémoire du site ; un redémarrage les oublie, sans conséquence.

## Ajouter une chaîne
Tout se fait dans le champ **« Ajouter une chaîne »**, en haut de la page de Raid (pensé pour le téléphone) :

- **Vous tapez un nom** (par exemple « Camille ») : Raid le cherche dans vos contacts. Un clic sur **« Ajouter à ma liste »** met la personne dans votre liste de raid. Si elle est dans vos contacts **sans chaîne Twitch**, le résultat dit « pas de chaîne Twitch » : un clic sur **« Ajouter son pseudo Twitch »**, vous tapez son pseudo, et il est ajouté à **sa fiche** (jamais une deuxième fiche). Personne ne correspond ? **Un seul bouton « Créer … »** fait la fiche avec ce seul pseudo : rien d'autre à remplir.
- **Vous tapez ou collez un pseudo ou un lien** (`camille_tv`, `@camille_tv`, `twitch.tv/camille_tv`) : la chaîne est ajoutée tout de suite. Les majuscules, les espaces et le @ ne gênent pas. Un pseudo Twitch a **4 à 25 caractères** (lettres sans accent, chiffres et _) ; sinon l'erreur s'affiche sous le champ et dit quoi corriger. Une faute de frappe est repérée : « Twitch ne connaît pas … ».
- **Vous collez plusieurs lignes** (**« Coller plusieurs chaînes »**, un pseudo ou un lien par ligne, **200 au plus** à la fois) : un **aperçu** dit combien sont nouvelles, combien sont déjà dans Contacts, combien sont déjà dans votre liste et combien sont invalides (avec la raison et un exemple), **avant** que quoi que ce soit soit ajouté. Vous validez, une barre montre l'avancement ; si c'est long, « Continuer » reprend où il en était. Refaire le même envoi ne double rien.
- **Le nom et la photo** viennent de Twitch **au moment de l'ajout** (un seul appel pour 100 chaînes) et sont rangés dans la fiche de Contacts. Une fiche qui a déjà un nom **n'est jamais renommée**. Sans Connecteur Twitch, ou si Twitch ne répond pas, la fiche prend le pseudo comme nom et Contacts la complétera à sa première ouverture : l'ajout, lui, marche toujours.
- **La liste « Cible de raid » se crée toute seule** dans Contacts au premier ajout, avec **vos** droits (il faut le droit « créer des catégories » de Contacts, que vous avez en tant qu'administrateur). Sur un site un peu ancien (Curiosa avant 0.2.4), elle ne peut pas se créer seule : la page dit alors de la créer dans Contacts ou dans le réglage « Liste de raid ».

### Retirer une chaîne
La liste de la page de Raid montre vos chaînes **50 par page**, avec une recherche. **« Retirer »** sort la chaîne de la liste de raid et **seulement de la liste** : sa fiche, ses autres comptes et ses autres catégories restent dans Contacts.

## Votre liste (dans Contacts)
- **Votre liste de raid, ce sont les fiches d'une catégorie de Contacts** (« Cible de raid » par défaut, ou celle que vous choisissez dans le réglage « Liste de raid ») qui ont une chaîne Twitch. Une fiche avec deux chaînes Twitch compte deux fois (une par chaîne).
- **Ajouter et retirer** : sur la page de Raid (voir plus haut). **Renommer, noter, changer la photo** : dans Contacts. La page de Raid montre le nombre de chaînes, l'état du dock et le lien « Gérer mes partenaires dans Contacts ».
- **Le nom** affiché dans le dock est celui de la fiche (sinon celui de Twitch) ; **la photo** est celle que Contacts choisit pour la fiche.
- **La catégorie a disparu ?** La page le dit (« La catégorie choisie n'existe plus, choisissez-en une ») et le dock aussi. Si elle a été **fusionnée** avec une autre dans Contacts, Raid suit tout seul.
- **Contacts ne répond pas un moment ?** Le dock continue avec la dernière liste connue pendant 10 minutes au plus, puis le dit clairement.
- L'ordre de Contacts sert au tri « Dans l'ordre de ma liste », et à départager deux chaînes qui ont autant de spectateurs.

### Vous veniez d'une version 1.x ?
À la mise à jour, **votre ancienne liste passe dans Contacts toute seule** : une fiche par chaîne (une fiche qui existait déjà avec ce compte Twitch est reprise, jamais doublée), avec le nom que vous aviez donné et **votre note devenue une note de la fiche**. Si la catégorie « Cible de raid » existe déjà, les fiches y sont rangées. Sinon, la page de Raid vous demande une dernière étape : créer « Cible de raid » dans le réglage « Liste de raid », puis cliquer sur « Ranger mes chaînes dans cette catégorie ». En attendant, le dock continue d'utiliser vos chaînes. Une liste très longue se copie par morceaux : si la copie a été interrompue, un bouton « Continuer la copie » la reprend là où elle s'était arrêtée. **Rien n'est perdu** : votre ancienne liste reste gardée telle quelle jusqu'à une mise à jour d'entretien.

## Pour une très grande liste
Le module sait servir **des centaines de chaînes** avec un seul dock (par exemple pour un réseau de créateurs).

- **Jusqu'à 500 chaînes**, le dock montre **tous les membres en direct**, comme pour une petite liste.
- **Au-delà de 500 chaînes**, il propose un grand bouton **« Trouver un streameur en ligne au hasard »**. Un clic choisit un membre en direct, le met en évidence (jeu, titre, spectateurs, durée) et **copie sa commande de raid**. « Un autre au hasard » en propose un différent. Si personne n'est trouvé : « Personne n'a été trouvé en ligne pour l'instant, réessayez. » Un petit délai de 2 secondes entre deux clics évite les doubles clics, et si beaucoup de monde clique en même temps, un message dit de patienter quelques secondes.
- **Pourquoi ce changement ?** Twitch ne permet de vérifier que 100 chaînes à la fois. Sur une très grande communauté, afficher tout le monde demanderait énormément de demandes à Twitch ; le bouton « au hasard » donne le même service, bien plus légèrement. La page d'administration vous dit toujours dans quel cas vous êtes (« Vous avez 612 chaînes : le dock propose un bouton "au hasard"… »).
- **Votre propre chaîne n'est jamais proposée** : on ne se raide pas soi-même.

### Installer un site central
Une seule personne tient la liste, sur **un seul site**. Les membres n'ont **rien à installer** et n'ont pas besoin de Curiosa ni d'un accès Twitch : ils ajoutent simplement l'adresse du dock dans OBS.

1. Installez **« Raid Twitch »** sur le site central : le **Connecteur Twitch** et **Ma Chaîne Twitch** s'installent avec lui. Dans le Connecteur, renseignez l'**identifiant client** et le **secret** de votre application Twitch ; dans Ma Chaîne Twitch, la chaîne du site. Aucune connexion de compte n'est nécessaire.
2. Ouvrez la page de **« Raid Twitch »**.
3. Mettez les membres dans Contacts, dans la catégorie « Cible de raid » (l'import de Contacts accepte une liste collée ou un fichier).
4. Copiez **l'adresse du dock** et donnez-la à vos membres : dans OBS, **Docks**, **Docks de navigateur personnalisés**, un nom, l'adresse, **Appliquer**.

Le site central **n'interroge Twitch que lorsque quelqu'un regarde ou clique**, et le nombre de demandes **ne dépend pas du nombre de membres** : tout le monde partage les mêmes réponses (30 secondes pour la liste complète, une minute pour le mode « au hasard »). Rien n'est écrit sur le disque : si le site redémarre, les réponses gardées sont simplement oubliées.

## Son adresse reste secrète
L'adresse du dock contient un code secret, créé pour vous : sans lui, la page ne montre rien. **Pour votre seul usage, gardez-la pour vous. Pour une communauté, donnez-la à vos membres** : tous voient le même dock, qui n'affiche que ce que Twitch montre déjà à tout le monde (nom, jeu, titre, spectateurs), **jamais vos notes**. Si elle a été partagée par erreur, ou si une personne ne doit plus y avoir accès, « Nouvelle adresse » en crée une autre (avec une confirmation) : **l'ancienne cesse de marcher aussitôt pour tout le monde**, et chacun doit coller la nouvelle dans OBS. Il n'y a pas d'adresse par membre pour l'instant : une même adresse pour tous.

## Votre IA
Deux outils, **non accordés d'office** (administration, accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `raid_partners_live` | Dit quels partenaires sont en direct maintenant (nom, jeu, titre, spectateurs, depuis combien de minutes) avec la commande de raid de chacun. Au-delà de 500 chaînes, elle ne donne pas la liste mais **un membre en direct tiré au hasard**. Lecture seule : rien n'est envoyé. |
| `raid_featured_now` | Donne la **sélection du moment** (les membres du dock de sélection et de la page publique), avec la commande de raid de chacun et l'heure de renouvellement. Lecture seule : elle ne tire jamais de nouveau. |

## Pour vos autres modules
Ce module ne partage plus rien avec les autres : ils lisent vos partenaires directement dans **Contacts**, qui en reste le seul propriétaire (« Story d'annonce » le fait pour ses co-streamers). Depuis la 2.0, le sujet `stream.partner` n'existe plus ; vos données ne changent pas.

## À savoir
- Les informations viennent de Twitch **par le « Connecteur Twitch »** : ce module ne parle jamais à Twitch lui-même. La liste vient de **Contacts** (version 2 ou plus). Il faut Curiosa 0.2.2 ou plus ; le Connecteur, Ma Chaîne Twitch et Contacts sont installés ou mis à jour avec lui.
- Pas besoin de connecter votre compte Twitch : l'identifiant et le secret de votre application, réglés une fois dans le Connecteur Twitch, suffisent.
- Les informations sont gardées 30 secondes : plusieurs docks ou onglets ouverts en même temps ne font qu'une seule demande à Twitch (une par groupe de 100 chaînes). Si une partie des chaînes n'a pas pu être vérifiée, le dock affiche ce qu'il a avec le message « Certaines chaînes n'ont pas pu être vérifiées. »
- Si votre site a plusieurs chaînes Twitch (plusieurs « Ma Chaîne Twitch »), le mode avancé permet de **choisir dans la liste** laquelle utiliser ; sans choix, c'est la première qui est prête. Avec une seule chaîne, il n'y a rien à choisir. Si vous aviez tapé un pseudo avant la version 1.3.0, il continue de servir ; la page vous propose de confirmer la chaîne dans la liste.
- **Vie privée** : le module ne collecte rien sur vos visiteurs. Il ne garde pas de liste à lui (elle est dans Contacts) : seulement l'adresse secrète du dock, 30 minutes au plus les pseudos publics d'un envoi en gros qui attend votre validation et, après une mise à jour depuis la 1.x, la copie inchangée de l'ancienne liste (retirée lors d'une mise à jour d'entretien). Quand une personne est effacée dans Contacts, elle est aussi retirée de cette copie, et l'export « tout ce que le site sait d'elle » inclut ce que Raid en garde. Le dock n'affiche que des informations publiques de Twitch.

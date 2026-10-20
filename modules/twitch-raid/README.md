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
- **Rien à faire pour le tenir à jour** : il se rafraîchit tout seul (environ toutes les 45 secondes), sans clignoter. Si Twitch ne répond pas, il le dit, garde la dernière liste connue et réessaie seul.
- Il est pensé pour un **dock étroit** (300 pixels) comme pour un téléphone, en sombre, et se manie aussi au clavier.
- Aucun partenaire en direct ? Il écrit simplement « Aucun de vos partenaires n'est en direct pour le moment ».

## Votre liste
- **Ajouter, modifier, retirer, monter, descendre.** Pour chaque chaîne, vous pouvez donner un **nom affiché** (si vous préférez un autre nom que celui de Twitch) et une **note** pour vous seul (elle n'apparaît jamais dans le dock).
- **100 chaînes au plus** : c'est ce que Twitch permet de vérifier en une fois.
- L'ordre de votre liste sert au tri « Dans l'ordre de ma liste », et à départager deux chaînes qui ont autant de spectateurs.

## Son adresse reste secrète
L'adresse du dock contient un code secret, créé pour vous : sans lui, la page ne montre rien. **Gardez-la pour vous.** Si elle a été partagée par erreur, « Nouvelle adresse » en crée une autre (avec une confirmation) et l'ancienne cesse de marcher aussitôt : il faut alors coller la nouvelle dans OBS.

## Votre IA
Un outil, **non accordé d'office** (administration, accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `raid_partners_live` | Dit quels partenaires sont en direct maintenant (nom, jeu, titre, spectateurs, depuis combien de minutes) avec la commande de raid de chacun. Lecture seule : rien n'est envoyé. |

## Pour vos autres modules
Si vous avez aussi « Story d'annonce », il peut **reprendre vos partenaires** (pseudo, nom affiché et **photo de profil Twitch**) pour les montrer dans vos vidéos d'annonce : un bouton lui suffit, rien à régler. Seuls le pseudo, le nom et la photo sont partagés : **jamais vos notes**, ni l'adresse secrète du dock. Sans ce module, rien ne change.

## À savoir
- Les informations viennent de Twitch **par « Chaîne Twitch »** : ce module ne parle jamais à Twitch lui-même. Il faut Chaîne Twitch en version 1.6.0 ou plus (la mise à jour est proposée toute seule) ; les photos de profil demandent la version 1.7.0, mais sans elles tout marche quand même.
- Pas besoin de connecter votre compte Twitch : l'identifiant et le secret de votre application, déjà réglés dans « Chaîne Twitch », suffisent.
- Les informations sont gardées 30 secondes : plusieurs docks ou onglets ouverts en même temps ne font qu'une seule demande à Twitch.
- Si votre site a plusieurs chaînes Twitch, le mode avancé permet de choisir laquelle utiliser.
- **Vie privée** : le module ne collecte rien sur vos visiteurs. Il garde votre liste de chaînes, vos notes et l'adresse secrète du dock, visibles des seuls administrateurs. Le dock n'affiche que des informations publiques de Twitch.

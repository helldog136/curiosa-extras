# Bot Twitch

Votre site **répond aux commandes tapées dans votre chat Twitch** : une personne écrit `!jeu`, et le chat reçoit « On joue à Zelda ! ». Des commandes sont déjà prêtes, vous créez les vôtres, et un gros bouton coupe tout en une seconde si besoin.

**Il faut Curiosa 0.2.5 ou plus.** Le « Connecteur Twitch » et « Ma Chaîne Twitch » s'installent tout seuls avec le bot. Le bot n'a besoin ni d'un agenda de streams (Planning, Agenda en ligne ou Streams saisis à la main), ni de Sponsors, ni des modules de réseaux : s'ils sont là, il en profite ; sinon la page vous explique simplement ce qui manque. Pour `!planning`, un agenda de streams suffit : le Planning n'est pas nécessaire.

## Pour commencer
1. **Installez le bot.** Le Connecteur Twitch et Ma Chaîne Twitch s'installent avec lui. Si ce n'est pas déjà fait, suivez le guide du Connecteur Twitch (en haut de sa page) pour renseigner l'application Twitch de votre site, et indiquez votre chaîne dans Ma Chaîne Twitch : c'est la même application pour tout ce qui touche à Twitch, vous ne la saisissez qu'une fois.
2. **Autorisez le bot chez Twitch.** Sur la page du bot, cliquez sur « Autoriser le bot chez Twitch », puis sur « Autoriser » chez Twitch. Une seule fois : Twitch doit savoir que vous êtes d'accord pour que le bot lise et écrive dans votre chat.
3. **Vérifiez.** En haut de la page, « Le bot écoute votre chat : oui » doit s'afficher. Sinon, la page dit pourquoi et ce qu'il faut faire (site pas encore joignable depuis Internet, autorisation à renouveler…).
4. **Essayez** : tapez `!jeu` dans votre chat pendant un direct.

Par défaut, c'est **votre propre compte** qui répond dans le chat.

## Les commandes
- **Toutes prêtes** : `!planning` (votre prochain stream), `!jeu`, `!titre`, `!followers`, `!uptime` (depuis combien de temps vous êtes en direct). Vous pouvez changer leur texte, leur nom, leurs autres noms, les désactiver.
- **Les vôtres** : un nom (sans le `!`), la réponse, d'éventuels autres noms (`!insta` et `!ig` pour `!instagram`), qui peut l'utiliser (tout le monde, les personnes abonnées, l'équipe de modération, seulement vous), et une attente entre deux réponses.
- **Des morceaux qui se remplissent tout seuls** dans n'importe quel texte : `{followers}`, `{jeu}`, `{titre}`, `{uptime}`, `{prochain_stream}`, `{utilisateur}` (le pseudo de la personne qui tape). Si une information n'est pas disponible, le bot écrit une phrase lisible à la place (« bientôt, restez à l'écoute »). Un morceau inconnu est refusé tout de suite, avec ce qu'il faut corriger. Le bot ne recopie jamais ce que les gens écrivent, à part leur pseudo.
- **Un aperçu** de la réponse s'affiche quand vous modifiez une commande.

## Vos partenaires et vos réseaux
- **Partenaires** (si le module Sponsors est installé) : la commande d'un partenaire se règle **dans sa fiche** (la page où vous modifiez le sponsor), dans la section « Commande de chat pour ce partenaire » : case « Activer la commande dans le chat », nom de la commande, texte et aperçu, avec son propre bouton « Enregistrer » (la page ne se recharge pas). Sur la page du bot, la rubrique des partenaires garde le résumé (la commande et son état) et « Modifier » ouvre la fiche sur cette section. Le nom proposé est celui de sa page (`!tesla`), le texte aussi : « Découvrez mon parrainage Tesla : example.org/sponsors/tesla ». Le titre et l'adresse viennent de la fiche, ils sont à jour tout seuls. Une fois enregistré, le nom est à vous : il ne change plus si la page change. Si la fiche disparaît, la commande se met en pause, puis s'efface après deux semaines.
- **Réseaux sociaux** (si vous avez installé leurs modules et indiqué vos adresses) : `!youtube`, `!tiktok` (aussi `!tik-tok`), `!instagram`, `!discord`, `!x` (aussi `!twitter`)… Texte proposé : « Retrouvez-moi sur YouTube : youtube.com/@vous ». Deux comptes d'un même réseau : `!youtube` et `!youtube2`. Une commande **`!reseaux`** donne d'un coup tous les liens des réseaux activés (vous pouvez la désactiver).
- Les commandes des réseaux, les vôtres et les commandes toutes prêtes se règlent **sur la page du bot** : un résumé les montre avec leur état et un bouton « Modifier » (ou « Configurer »). La page ne remonte plus en haut quand vous cliquez : le message s'affiche à côté du bouton.
- Une fiche pas encore publiée peut déjà avoir sa commande réglée : elle attend la publication. Sans le bot, la fiche du partenaire ne montre aucune section en plus.

## Les récompenses en points de chaîne (onglet « Récompenses », depuis la 1.3.0)
Vos viewers dépensent leurs points de chaîne pour déclencher quelque chose. **Curiosa crée la récompense chez Twitch** (titre, coût, délai de recharge, texte d'aide, « le viewer écrit un message ») et lui associe **une action** :
- **Répondre dans le chat** (marche sans rien d'autre) : « Merci {utilisateur} ! ».
- **Une action de la maison**, si le module **Home Assistant** est installé : la couleur des lumières (`lumieres:rouge`, `lumieres:bleu`…) ou **lire le message du viewer à voix haute** (`tts:lire`). Sans ce module, l'onglet propose de l'installer ; il reste facultatif.
- En **mode avancé**, le réglage « Autres actions à choisir » ajoute vos propres mots (`lumieres:orange`, `scene:cinema`) à la liste.

Pour commencer : activer les récompenses, autoriser Twitch (une fois, le chat n'est pas coupé), créer « Rouge » avec l'action « Lumières : rouge ».

**Ce qui se passe quand un viewer prend une récompense** : l'échange est noté **une seule fois**, puis l'action est lancée. Si la maison accepte, **les points sont validés** quand elle a joué l'action ; si elle refuse (maison coupée, pas en direct, message refusé par la modération, trop de demandes…) ou n'a rien fait dans le délai (2 minutes par défaut), **les points sont rendus**. Un message dans le chat peut prévenir le viewer (réglage « Prévenir le chat quand des points sont rendus », désactivé par défaut).
- **Rien ne tourne en arrière-plan** : les résultats de la maison et les délais dépassés sont pris en compte au prochain évènement sur votre chaîne ou quand vous ouvrez l'onglet.
- **Hors direct, ou quand la maison est coupée**, les récompenses de la maison sont **mises en pause chez Twitch**, et remises en vente toutes seules ensuite (seulement celles que Curiosa a mises en pause : une pause que vous avez faite reste).
- **`!stop`** dans le chat coupe la maison (vous et l'équipe de modération que vous nommez dans les réglages), **`!start`** la rebranche (vous uniquement). Sans le module Home Assistant, le bot le dit poliment.
- **Simuler** : le bouton « Simuler cette récompense » joue le même chemin avec un faux viewer « Test », **sans Twitch et sans points**. Une action de la maison est vraiment envoyée chez vous ; une réponse dans le chat est seulement montrée. Refusé si la maison est coupée. 1 test toutes les 3 secondes, 30 par heure.
- **Journal** des 50 derniers échanges (pseudo, récompense, résultat) ; le message écrit par le viewer n'est **jamais gardé**.
- **Limites** : 20 récompenses, 100 échanges en attente. Les points de chaîne n'existent que pour un compte **Affilié ou Partenaire** : sinon la page le dit en clair.
- Le droit **« créer, modifier et supprimer les récompenses »** (`rewards.manage`) se donne dans les rôles. Outils pour l'assistant : `rewards_list` (lecture), `reward_create`, `reward_update`, `reward_simulate` (écritures, jamais accordées d'office).

## Les protections
- Le bot **répond seulement pendant vos directs** (vous pouvez le changer).
- Une **attente** entre deux réponses d'une même commande, et une autre pour chaque personne.
- Il **ne répond jamais à lui-même ni aux autres bots**, et ses réponses ne peuvent pas déclencher une autre commande.
- Une **limite de réponses** par tranche de 30 secondes, bien en dessous de ce que Twitch tolère.
- Une réponse ne commence jamais par `/` ni par un point, et ne dépasse jamais 500 caractères.
- Chaque commande a un rôle : tout le monde, personnes abonnées, équipe de modération ou seulement vous.

## L'arrêt d'urgence
En haut de la page : **« Couper toutes les réponses »**. Un clic, le bot se tait partout, immédiatement. Rien n'est supprimé ; « Réactiver les réponses » le remet en marche.

## Comprendre « pourquoi il n'a pas répondu »
Le bot garde le **journal des 30 dernières commandes**. Chaque ligne dit si le bot a répondu ou pourquoi il s'est tu : « vous n'étiez pas en direct », « trop tôt, encore 12 s », « cette personne n'a pas le droit », « arrêt d'urgence », « aucun agenda de streams n'est installé »… Vous pouvez le vider.

## Votre IA
Trois outils, **aucun accordé d'office** (administration → accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `bot_commands_list` | Liste toutes les commandes avec leur texte, leur état et si l'arrêt d'urgence est activé. Lecture seule. |
| `bot_command_create` | Crée une commande à vous. Refusée avec une explication si le nom est pris ou si le texte contient un morceau inconnu. |
| `bot_command_update` | Modifie une commande existante (texte, noms, rôle, attentes, activée ou non). Ne supprime rien et n'envoie aucun message. |

## Réglages avancés
Réservés au mode avancé : le **signe des commandes** (`!` par défaut), un **compte bot séparé** pour que ce soit un autre compte Twitch qui réponde (vous le connectez sur la page du bot), les attentes par défaut, la limite de réponses, l'âge maximum d'un message de Twitch, la chaîne servie si votre site en a plusieurs (un choix dans la liste de vos « Ma Chaîne Twitch » ; un pseudo tapé avant la version 1.2.0 continue de servir), et des bots supplémentaires à ignorer.

## À savoir
- Le bot a besoin que **votre site soit joignable depuis Internet en `https://`** : Twitch envoie chaque message du chat à votre site. Un site en test sur votre ordinateur ne peut pas le recevoir ; la page vous le dit.
- Le nombre de followers demande de cocher « Suivre mes statistiques » dans Ma Chaîne Twitch et de connecter votre chaîne ; sinon `!followers` est masquée et la page explique pourquoi.
- Les heures de `!planning` suivent le fuseau horaire que vous indiquez dans les réglages ; sans fuseau, elles sont données en UTC et le disent.
- **Vie privée** : le journal garde le pseudo, la commande et le résultat des 30 dernières commandes, visibles des seuls administrateurs. Rien d'autre n'est conservé de ce que les gens écrivent.
- Ce module ne lit les messages que pour y trouver des commandes ; les autres messages sont ignorés dès leur arrivée.

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
- **Des morceaux qui se remplissent tout seuls** dans n'importe quel texte : `{followers}`, `{jeu}`, `{titre}`, `{uptime}`, `{prochain_stream}`, `{utilisateur}` (le pseudo de la personne qui tape). Si une information n'est pas disponible, le bot écrit une phrase lisible à la place (« bientôt, restez à l'écoute »). Un morceau inconnu est refusé tout de suite, avec ce qu'il faut corriger et un exemple. Les commandes que vous écrivez et les timers disposent aussi de : `{chaine}`, `{viewers}` (le public en direct), `{heure}` et `{date}` (dans votre fuseau, ou celui que vous écrivez : `{heure Europe/Paris}`), `{aleatoire oui | non | peut-être}` ou `{aleatoire 1-100}`, `{calcul 2+3*4}`. Seules les commandes ajoutent ce qui dépend de la personne qui tape : `{cible}` (le premier mot après la commande, sans @, ou la personne elle-même), `{requete}` (tout le texte après la commande), `{1}` `{2}` … `{9}` et `{1:}` (les mots, et « tout à partir du mot 1 »), `{compteur}` (combien de fois la commande a répondu ; un bouton le remet à zéro). Les morceaux peuvent s'emboîter sur 3 niveaux : `{calcul {1}*2}`.
- **Un aperçu** de la réponse s'affiche quand vous modifiez une commande.

## Dates de validité (commandes et timers)
Une commande ou un timer peut n'être active que sur une **période** : par exemple `!movember` du 1er au 30 novembre, ou `!subtember` en septembre, **chaque année** toute seule. Dans le formulaire : deux sélecteurs jour / mois pour le début et la fin (la fin est incluse), une case **Chaque année**, et des années à indiquer seulement si la période ne revient pas. Une période peut passer d'une année à l'autre (du 15 décembre au 15 janvier). Les erreurs s'affichent sous le champ (« Le 31 février n'existe pas »), et la phrase « Active du 1er novembre au 30 novembre, chaque année » s'affiche en aperçu.
- La période est regardée **au moment** où une personne tape la commande (ou qu'un timer est évalué) : aucun minuteur. Elle suit votre fuseau horaire ; sans fuseau réglé, c'est l'UTC et l'écran le dit.
- Hors période, la commande **ne répond pas**, mais reste visible et modifiable : l'état est « Hors période : se réactive le 1er novembre », et le journal le dit aussi. Ce n'est pas « désactivée » : la case « Activée » décochée l'emporte toujours.
- Les commandes d'avant n'ont pas de période : elles restent toujours actives.

## La page du bot
- **Commandes** : un seul tableau (les vôtres, les toutes prêtes, celles des partenaires et des réseaux) avec un champ **Rechercher** qui filtre pendant que vous tapez, des filtres en pastilles, l'**origine** de chaque commande en couleur et en toutes lettres, et un **interrupteur** pour activer ou désactiver. « Modifier » change le nom et la réponse ; pour un partenaire, le bouton mène à sa fiche. **Nouvelle commande** ouvre un formulaire de trois champs ; autres noms, attentes et période d'activité sont sous « Plus d'options ».
- **Période d'activité** : « Toujours active » ou « Seulement pendant une période » (« Du 1er novembre au 30 novembre », case « Chaque année », raccourcis d'un clic). Les années n'apparaissent que pour une période qui ne revient pas.
- **Timers**, **Récompenses** : même modèle (tableau, recherche, interrupteur).
- **Sans JavaScript**, la page reste complète : la liste entière et tous les champs sont là, seules la recherche en direct, les interrupteurs et le rangement du formulaire disparaissent. Le petit script qui les ajoute est dans `adminkit.client.js` (documenté en tête de fichier ; `adminkit.mjs` écrit le HTML et le sert par la route `kit`) : un autre module peut le reprendre tel quel.

## Timers
Un timer écrit un message dans votre chat à intervalle régulier (un rappel du Discord, une astuce…). Onglet **Timers** : un nom, le message (mêmes morceaux que les commandes, sauf ceux qui dépendent d'une personne), l'intervalle en minutes (1 à 1440), le nombre minimum de lignes de chat depuis son dernier message, « en direct seulement » ou « toujours », activé ou non, et une période facultative. 20 timers au plus, avec un aperçu du message et un bouton **Envoyer maintenant**.
- **Un timer a besoin que le chat soit actif, comme chez Nightbot.** Le bot n'a aucun minuteur : il regarde ses timers quand un message arrive dans le chat. Un chat silencieux n'en déclenche aucun. Il n'existe pas d'évènement « le direct commence » côté bot : le premier message du chat après le début du direct repart de zéro.
- À chaque message, **un seul** timer écrit ; si plusieurs sont dus, les autres passent aux messages suivants, dans l'ordre de la liste. Une commande qui vient de répondre laisse aussi sa place.
- Jamais pendant l'arrêt d'urgence (et sans rafale quand il est levé), jamais si le bot n'est pas prêt, jamais au-delà de la limite de réponses.
- Les lignes sont comptées depuis le dernier envoi (Nightbot les compte sur 5 minutes). Les messages du bot lui-même, des autres bots et des chats partagés ne comptent pas. Seuls le nom, le message, les réglages, l'heure du dernier envoi et un nombre de lignes sont gardés, jamais un message du chat.

## Gérer les commandes depuis le chat
Réglage **« Laisser l'équipe de modération gérer les commandes depuis le chat »** (éteint par défaut). Ensuite, vous et votre équipe de modération (le badge Twitch suffit) pouvez taper :
- `!addcom nom texte` : crée une commande. Options avant le nom : `-cd=30` (attente en secondes), `-ul=mods` (niveau : tous, sub, mods, moi).
- `!editcom nom nouveau texte` (ou seulement des options) : change une commande à vous. `!delcom nom` la supprime. `!commands` donne la liste.
- Le bot répond clairement dans le chat. Ce sont **exactement les mêmes vérifications** que dans l'administration (morceaux connus, pas de `/` ni de point au début, 450 caractères, 100 commandes). **Jamais d'écrasement** : `!addcom` sur un nom pris est refusé, et les commandes toutes prêtes ne se changent que dans l'administration. Une personne sans le droit n'obtient aucune réponse. Chaque action est notée dans le journal. Une commande qui porte déjà l'un de ces noms garde la priorité.

## Si vous venez de Nightbot
Il n'y a pas d'import automatique : copier-coller depuis Nightbot est trop aléatoire pour qu'un site le lise sans se tromper. **Demandez à votre assistant IA de recréer vos commandes** : collez-lui votre liste, il utilise les outils `bot_command_create`, `timer_create` et leurs périodes (`activeFrom`, `activeUntil`, `yearly`, `clearPeriod`). Voici la correspondance des morceaux de texte et des fonctions.

| Chez Nightbot | Ici |
|---|---|
| Niveaux tout le monde, abonnement, modération, propriétaire | Tout le monde, personnes abonnées, équipe de modération, seulement vous |
| Niveau « habitué » (regular) | Pas d'équivalent : le bot ne tient aucune liste de personnes ; choisissez « personnes abonnées » |
| Attente d'une commande | Attente pour tout le monde (+ une attente par personne, en plus) |
| `$(user)`, `$(touser)`, `$(count)` | `{utilisateur}`, `{cible}`, `{compteur}` |
| `$(query)`, `$(1)` `$(2)` `$(1:)` | `{requete}` (ou `{query}`), `{1}` `{2}` `{1:}` |
| `$(querystring)` | Pas d'équivalent (il sert à fabriquer des adresses) |
| `$(channel)`, `$(time fuseau)` | `{chaine}`, `{heure fuseau}` / `{date}` |
| `$(twitch … game / title / uptime)` | `{jeu}`, `{titre}`, `{uptime}`, et `{viewers}` |
| Date de suivi d'une personne (followage) | Pas d'équivalent : Ma Chaîne Twitch ne fournit que le nombre de followers (`{followers}`) |
| `$(urlfetch adresse)` | `{urlfetch adresse}` en version sûre |
| `$(eval …)` (JavaScript) | `{calcul …}` : nombres, `+ - * / % ^`, parenthèses, `abs round floor ceil min max sqrt` (le JavaScript n'est pas repris : l'exécuter serait une faille) |
| Timers (intervalle, lignes de chat) | Onglet Timers (les lignes sont comptées depuis le dernier envoi) |
| `!commands add / edit / delete`, `!addcom` | `!addcom` `!editcom` `!delcom` `!commands` |
| Dates de validité | **Chaque année toute seule** ou une seule fois |
| Tirage au sort | Module Participation |
| Compte à rebours, météo, chansons, filtres de chat | Hors de ce module |

**`{urlfetch}`, version sûre.** Éteint tant que vous n'avez pas écrit, en mode avancé, la liste des sites autorisés (réglage « Sites que {urlfetch} peut lire »). Ensuite : `https` seulement, le site doit être exactement dans la liste, jamais une adresse numérique, un nom interne ni un site qui pointe vers une adresse privée ou locale, **aucune redirection suivie**, 3 secondes, 400 caractères, texte seulement (une page web est refusée), réponse gardée 30 secondes, 10 demandes par minute. Limite connue : un site que vous avez autorisé et qui changerait d'adresse très vite pour viser une adresse privée pourrait passer entre notre vérification et la demande ; n'autorisez que des sites de confiance. Le texte qui suit la commande peut changer la fin de l'adresse (pas le site).

## Tirage au sort
Avec **Participation**, un tirage au sort peut être alimenté par le chat : le bot transmet à Participation le pseudo de la personne qui a tapé exactement le mot du tirage (une fois par personne), sans jamais répondre dans le chat et sans rien garder. Rien ne passe pendant l'arrêt d'urgence, ni hors direct si le réglage « seulement en direct » est actif. Sans Participation, rien ne change.

## Vos partenaires et vos réseaux
- **Partenaires** (si le module Sponsors est installé) : la commande d'un partenaire se règle **dans sa fiche** (la page où vous modifiez le sponsor), dans la section « Commande de chat pour ce partenaire » : case « Activer la commande dans le chat », nom de la commande, texte et aperçu, avec son propre bouton « Enregistrer » (la page ne se recharge pas). Sur la page du bot, la rubrique des partenaires garde le résumé (la commande et son état) et « Modifier » ouvre la fiche sur cette section. Le nom proposé est celui de sa page (`!tesla`), le texte aussi : « Découvrez mon parrainage Tesla : example.org/sponsors/tesla ». Le titre et l'adresse viennent de la fiche, ils sont à jour tout seuls. Une fois enregistré, le nom est à vous : il ne change plus si la page change. Si la fiche disparaît, la commande se met en pause, puis s'efface après deux semaines.
- **Réseaux sociaux** (si vous avez installé leurs modules et indiqué vos adresses) : `!youtube`, `!tiktok` (aussi `!tik-tok`), `!instagram`, `!discord`, `!x` (aussi `!twitter`)… Texte proposé : « Retrouvez-moi sur YouTube : youtube.com/@vous ». Deux comptes d'un même réseau : `!youtube` et `!youtube2`. Une commande **`!reseaux`** donne d'un coup tous les liens des réseaux activés (vous pouvez la désactiver).
- Les commandes des réseaux, les vôtres et les commandes toutes prêtes se règlent **sur la page du bot** : un résumé les montre avec leur état et un bouton « Modifier » (ou « Configurer »). La page ne remonte plus en haut quand vous cliquez : le message s'affiche à côté du bouton.
- Une fiche pas encore publiée peut déjà avoir sa commande réglée : elle attend la publication. Sans le bot, la fiche du partenaire ne montre aucune section en plus.

## Les récompenses en points de chaîne (onglet « Récompenses », depuis la 1.3.0 ; actions nommées depuis la 1.4.0)
Vos viewers dépensent leurs points de chaîne pour déclencher quelque chose. **Curiosa crée la récompense chez Twitch** (titre, coût, délai de recharge, texte d'aide, « le viewer écrit un message ») et lui associe **une action**, choisie en répondant à une seule question : « Que se passe-t-il quand une personne prend cette récompense ? »
- **Répondre dans le chat** (marche sans rien d'autre) : « Merci {utilisateur} ! ».
- **Changer la couleur des lumières** (rouge, vert, bleu, jaune, orange, violet, rose, blanc) ou **Lire son message à voix haute** : des actions de la maison, qui demandent le **Connecteur Home Assistant**. Sans lui, l'onglet propose de l'installer ; il reste facultatif.
- **Autre chose chez moi** : on **donne un nom** à l'action (par exemple « Lancer l'aspirateur »). Le nom est le seul mot à connaître : Curiosa fabrique elle-même l'identifiant technique, **qui ne change plus** même si vous renommez l'action (ce qui est relié dans Home Assistant ne casse donc pas). Un nom déjà utilisé reprend la même action ; la liste **« Vos actions »** permet de la choisir pour une autre récompense, de la renommer ou de la retirer quand aucune récompense ne s'en sert.
- **Home Assistant apprend les noms** : le Bot Twitch publie le sujet `home.actions` (les noms de vos actions) que le Connecteur Home Assistant lit en option pour proposer « Lancer l'aspirateur → choisir un script » dans Home Assistant. Rien de votre maison n'est jamais envoyé à Curiosa.
- Si Home Assistant répond qu'il **n'a pas encore de script pour une action**, la récompense (liste et journal) le dit en mots simples avec la marche à suivre (Home Assistant > Curiosa > Configurer), les points sont rendus et un bandeau nomme les actions à relier. Un lien **« Relier à votre maison »** mène à la page du Connecteur Home Assistant.
- En **mode avancé**, le réglage « Montrer les identifiants techniques des actions » montre l'identifiant à côté du nom et permet d'en choisir un pour une nouvelle action. L'ancien réglage « Autres actions à choisir » (des mots comme `scene:cinema`) **marche toujours** : ses mots sont repris automatiquement dans « Vos actions », le mot servant de nom.

Pour commencer : activer les récompenses, autoriser Twitch (une fois, le chat n'est pas coupé), créer « Rouge » avec « Changer la couleur des lumières » puis la couleur rouge.

**Ce qui se passe quand un viewer prend une récompense** : l'échange est noté **une seule fois**, puis l'action est lancée. Si la maison accepte, **les points sont validés** quand elle a joué l'action ; si elle refuse (maison coupée, pas en direct, message refusé par la modération, trop de demandes…) ou n'a rien fait dans le délai (2 minutes par défaut), **les points sont rendus**. Un message dans le chat peut prévenir le viewer (réglage « Prévenir le chat quand des points sont rendus », désactivé par défaut).
- **Rien ne tourne en arrière-plan** : les résultats de la maison et les délais dépassés sont pris en compte au prochain évènement sur votre chaîne ou quand vous ouvrez l'onglet.
- **Hors direct, ou quand la maison est coupée**, les récompenses de la maison sont **mises en pause chez Twitch**, et remises en vente toutes seules ensuite (seulement celles que Curiosa a mises en pause : une pause que vous avez faite reste).
- **`!stop`** dans le chat coupe la maison (vous et l'équipe de modération que vous nommez dans les réglages), **`!start`** la rebranche (vous uniquement). Sans le Connecteur Home Assistant, le bot le dit poliment.
- **Simuler** : le bouton « Simuler cette récompense » joue le même chemin avec un faux viewer « Test », **sans Twitch et sans points**. Une action de la maison est vraiment envoyée chez vous ; une réponse dans le chat est seulement montrée. Refusé si la maison est coupée. 1 test toutes les 3 secondes, 30 par heure.
- **Journal** des 50 derniers échanges (pseudo, récompense, résultat) ; le message écrit par le viewer n'est **jamais gardé**.
- **Limites** : 20 récompenses, 100 échanges en attente. Les points de chaîne n'existent que pour un compte **Affilié ou Partenaire** : sinon la page le dit en clair.
- Le droit **« créer, modifier et supprimer les récompenses »** (`rewards.manage`) se donne dans les rôles. Outils pour l'assistant : `rewards_list` (lecture), `reward_create`, `reward_update`, `reward_simulate` (écritures, jamais accordées d'office) ; `reward_create` et `reward_update` acceptent `customActionName` pour donner un nom à une action.

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
Des outils, **aucune écriture accordée d'office** (administration → accès de votre IA) :

| Outil | Ce qu'il fait |
|---|---|
| `bot_commands_list` | Liste toutes les commandes avec leur texte, leur état et si l'arrêt d'urgence est activé. Lecture seule. |
| `bot_command_create` | Crée une commande à vous. Refusée avec une explication si le nom est pris ou si le texte contient un morceau inconnu. |
| `bot_command_update` | Modifie une commande existante (texte, noms, rôle, attentes, activée ou non, période). Ne supprime rien et n'envoie aucun message. |
| `timers_list`, `timer_create`, `timer_update` | Voit, crée et modifie les timers (même période : `activeFrom` / `activeUntil` / `yearly`, `clearPeriod` pour l'enlever). |

Les périodes se donnent sous la forme `11-01` (chaque année) ou `2026-11-01` (une seule fois).

## Réglages avancés
Réservés au mode avancé : le **signe des commandes** (`!` par défaut), un **compte bot séparé** pour que ce soit un autre compte Twitch qui réponde (vous le connectez sur la page du bot), les attentes par défaut, la limite de réponses, l'âge maximum d'un message de Twitch, la chaîne servie si votre site en a plusieurs (un choix dans la liste de vos « Ma Chaîne Twitch » ; un pseudo tapé avant la version 1.2.0 continue de servir), des bots supplémentaires à ignorer, et la liste des sites que `{urlfetch}` peut lire.

## À savoir
- Le bot a besoin que **votre site soit joignable depuis Internet en `https://`** : Twitch envoie chaque message du chat à votre site. Un site en test sur votre ordinateur ne peut pas le recevoir ; la page vous le dit.
- Le nombre de followers demande de cocher « Suivre mes statistiques » dans Ma Chaîne Twitch et de connecter votre chaîne ; sinon `!followers` est masquée et la page explique pourquoi.
- Les heures de `!planning` suivent le fuseau horaire que vous indiquez dans les réglages ; sans fuseau, elles sont données en UTC et le disent.
- **Vie privée** : le journal garde le pseudo, la commande et le résultat des 30 dernières commandes, visibles de la seule équipe d'administration. Les mots tapés dans une commande (`{1}`, `{requete}`…) servent à la réponse et ne sont jamais gardés (le journal ne garde pas le texte d'une réponse qui les reprend). Rien d'autre n'est conservé de ce que les gens écrivent.
- Ce module ne lit les messages que pour y trouver des commandes ; les autres messages sont ignorés dès leur arrivée.

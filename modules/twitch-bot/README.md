# Bot Twitch

Votre site **répond aux commandes tapées dans votre chat Twitch** : une personne écrit `!jeu`, et le chat reçoit « On joue à Zelda ! ». Des commandes sont déjà prêtes, vous créez les vôtres, et un gros bouton coupe tout en une seconde si besoin.

**Il faut Curiosa 0.6.7 ou plus** (les fenêtres de modification, et le champ de période du cœur : « Tout le mois de », périodes toutes prêtes). Le « Connecteur Twitch » et « Ma Chaîne Twitch » s'installent tout seuls avec le bot. Le bot n'a besoin ni d'un agenda de streams (Planning, Agenda en ligne ou Streams saisis à la main), ni de Sponsors, ni des modules de réseaux : s'ils sont là, il en profite ; sinon la page vous explique simplement ce qui manque. Pour `!planning`, un agenda de streams suffit : le Planning n'est pas nécessaire.

## Pour commencer
1. **Installez le bot.** Le Connecteur Twitch et Ma Chaîne Twitch s'installent avec lui. Si ce n'est pas déjà fait, suivez le guide du Connecteur Twitch (en haut de sa page) pour renseigner l'application Twitch de votre site, et indiquez votre chaîne dans Ma Chaîne Twitch : c'est la même application pour tout ce qui touche à Twitch, vous ne la saisissez qu'une fois.
2. **Autorisez le bot chez Twitch.** Sur la page du bot, cliquez sur « Autoriser le bot chez Twitch », puis sur « Autoriser » chez Twitch. Une seule fois : Twitch doit savoir que vous êtes d'accord pour que le bot lise et écrive dans votre chat.
3. **Vérifiez.** En haut de la page, la pastille « Le bot écoute votre chat » doit s'afficher. Sinon, la page dit pourquoi et ce qu'il faut faire (site pas encore joignable depuis Internet, autorisation à renouveler…).
4. **Essayez** : tapez `!jeu` dans votre chat pendant un direct.

Par défaut, c'est **votre propre compte** qui répond dans le chat.

## Les commandes
- **Toutes prêtes** : `!planning` (votre prochain stream), `!jeu`, `!titre`, `!followers`, `!uptime` (depuis combien de temps vous êtes en direct). Vous pouvez changer leur texte, leur nom, leurs autres noms, les désactiver.
- **Les vôtres** : un nom (sans le `!`), la réponse, d'éventuels autres noms (`!insta` et `!ig` pour `!instagram`), qui peut l'utiliser (tout le monde, les personnes abonnées, l'équipe de modération, seulement vous), et une attente entre deux réponses.
- **Des morceaux qui se remplissent tout seuls** dans n'importe quel texte : `{followers}`, `{jeu}`, `{titre}`, `{uptime}`, `{prochain_stream}`, `{utilisateur}` (le pseudo de la personne qui tape). Si une information n'est pas disponible, le bot écrit une phrase lisible à la place (« bientôt, restez à l'écoute »). Un morceau inconnu est refusé tout de suite, avec ce qu'il faut corriger et un exemple. Les commandes que vous écrivez et les timers disposent aussi de : `{chaine}`, `{viewers}` (le public en direct), `{heure}` et `{date}` (dans votre fuseau, ou celui que vous écrivez : `{heure Europe/Paris}`), `{aleatoire oui | non | peut-être}` ou `{aleatoire 1-100}`, `{calcul 2+3*4}`. Seules les commandes ajoutent ce qui dépend de la personne qui tape : `{cible}` (le premier mot après la commande, sans @, ou la personne elle-même), `{requete}` (tout le texte après la commande), `{1}` `{2}` … `{9}` et `{1:}` (les mots, et « tout à partir du mot 1 »), `{compteur}` (combien de fois la commande a répondu ; un interrupteur de la fenêtre de la commande le remet à zéro). Les morceaux peuvent s'emboîter sur 3 niveaux : `{calcul {1}*2}`.
- **Les morceaux disponibles** pour une commande sont listés dans la bulle d'aide du champ « Ce que le bot répond ».

## Dates de validité (commandes et timers)
Une commande ou un timer peut n'être active que sur une **période** : par exemple `!movember` du 1er au 30 novembre, ou `!subtember` en septembre, **chaque année** toute seule. Dans le formulaire, sous **Plus d'options** puis **Limiter dans le temps**, c'est le champ « période » de Curiosa : un seul champ, avec **Tout le mois de** (choisissez un mois), **Une période toute prête** (saisons, fêtes), deux dates (la fin est incluse), une case **Chaque année** et la phrase d'aperçu (« Du 1er novembre au 30 novembre, chaque année »). Une période nouvelle part de « une seule fois » ; une période déjà réglée garde son sens, « chaque année » compris. Une période peut passer d'une année à l'autre (du 15 décembre au 15 janvier). Laisser le champ vide, c'est « toujours active ». Les erreurs s'affichent sous le champ.
- La période est regardée **au moment** où une personne tape la commande (ou qu'un timer est évalué) : aucun minuteur. Elle suit le fuseau horaire réglé dans le bot ; sans fuseau réglé, c'est l'UTC et l'aide du champ le dit.
- Hors période, la commande **ne répond pas**, mais reste visible et modifiable : l'état est « Hors période : se réactive le 1er novembre », et le journal le dit aussi. Ce n'est pas « désactivée » : la case « Activée » décochée l'emporte toujours.
- Les commandes d'avant n'ont pas de période : elles restent toujours actives.

## La page du bot
- **Commandes** : un seul tableau (les vôtres, les toutes prêtes, celles des partenaires et des réseaux) avec un champ **Rechercher** qui filtre pendant que vous tapez, des filtres en pastilles, l'**origine** de chaque commande en couleur et en toutes lettres, et un **interrupteur** pour activer ou désactiver. **Modifier** et **Nouvelle commande** ouvrent une **fenêtre** au-dessus de la page : la liste garde sa recherche, son filtre et sa place. La fenêtre a trois champs (nom, réponse, qui peut l'utiliser) ; autres noms, attentes, période d'activité et répétition sont sous « Plus d'options ». **Supprimer** est dans le menu « ⋯ » de la ligne et dit ce qui sera perdu. Pour un partenaire, la fenêtre mène à sa fiche.
- **Limiter dans le temps** : le champ de période de Curiosa, replié sous « Plus d'options » (voir plus haut). Vide : toujours active.
- **Timers**, **Récompenses** : même modèle (tableau, recherche, interrupteur, fenêtre de modification).
- **Sans JavaScript**, la page reste complète : la liste entière est là, et un lien « Modifier » ouvre la même fenêtre sur une page entière. Les listes de commandes, de timers et de récompenses sont des tableaux de Curiosa ; le petit script du module (`adminkit.client.js`, documenté en tête de fichier ; `adminkit.mjs` écrit le HTML et le sert par la route `kit`) ne sert plus qu'au journal, aux listes repliées « Ajouter une commande pour un partenaire ou un réseau » et « Choisir une commande », et aux boutons « Vérifier » et « Arrêt d'urgence ».

## Timers
Un timer est **une commande que le bot répète tout seul** dans votre chat (un rappel du Discord, une astuce…). Il n'a plus de titre ni de message à lui : il se règle sur la page de la commande, sous **Plus d'options → Répéter automatiquement** (un interrupteur, « Toutes les … » en une durée de 1 minute à 24 heures, un minimum de messages dans le chat depuis la dernière fois, « en direct seulement » ou « toujours »). À chaque échéance, le bot écrit la réponse de la commande comme si on l'avait tapée (`{utilisateur}` devient « tout le monde »).
- **Onglet Timers** : un seul tableau des commandes qui se répètent (recherche en direct, filtres avec leur nombre, interrupteur d'état par ligne, « Modifier » qui ouvre la commande dans une fenêtre, « Envoyer maintenant »). 20 au plus. **Ajouter un timer** : en créer un dans une fenêtre (nom + ce que le bot écrit ; sous « Plus d'options », le choix « Lancée par » : voir ci-dessous), ou **Choisir une commande** qui existe dans la liste repliée sous le tableau.
- **La commande reste maîtresse** : désactivée, hors de sa période d'activité, ou incomplète (Planning absent…), elle n'est pas répétée. Les attentes entre deux utilisations sont pour les personnes : elles ne retardent pas la répétition.
- **Un timer a besoin que le chat soit actif, comme chez Nightbot.** Il est regardé à l'arrivée d'un message du chat ; depuis la 1.11.0, une tâche d'une minute envoie aussi, à son heure, une répétition qui exige des lignes de chat déjà comptées (voir « Vitesse »). Un chat silencieux n'en déclenche toujours aucune. Le premier message du chat après le début du direct repart de zéro.
- À chaque message, **une seule** commande se répète ; si plusieurs sont dues, les autres passent aux messages suivants. Une commande qui vient de répondre laisse aussi sa place. Jamais pendant l'arrêt d'urgence (et sans rafale quand il est levé), jamais si le bot n'est pas prêt, jamais au-delà de la limite de réponses.
- Les lignes sont comptées depuis le dernier envoi. Les messages du bot lui-même, des autres bots et des chats partagés ne comptent pas. Seuls le texte et les réglages de la commande, l'heure du dernier envoi et un nombre de lignes sont gardés, jamais un message du chat.
- **Started by** (EN: "Started by", FR: « Lancée par »; stored field `timerOnly`, unchanged). A two-button choice under "More options", on the command page and on the new-timer form: **The timer and the chat** (the default: the bot repeats the command and anyone can also type it) or **The timer only** (nobody can trigger it by typing; it is listed as "Timer only" in the commands list). It replaces the old switch "Only for the timer, not in the chat", whose fixed help line was wrong when the switch was off. The line under the choice now follows the choice, the command name and the repeat interval as they are typed ("!movember is sent every 15 min. Typing it does nothing." / "... Anyone can also type it."); without a repeat it says to turn on "Repeat automatically" first. The core cannot show a different help for each choice, so the page script (`adminkit.client.js`, `stateHelp`) writes that line; without JavaScript the choice is still there, its two labels say what each does.
- **Supprimer le timer** (menu « ⋯ » de la ligne, avec une confirmation) laisse la commande telle quelle. Une commande « seulement pour le timer » n'existe que pour lui : elle est supprimée avec lui, et la confirmation le dit. Rien ne la rend jamais utilisable dans le chat sans votre choix : pour la garder comme commande du chat, ouvrez-la, choisissez « Le timer et le chat » dans « Lancée par » et éteignez la répétition.
- **Vos anciens timers (versions avant 1.9.0)** sont repris tout seuls à la mise à jour : chacun devient une commande « Timer seulement » (son titre est gardé, son nom est un mot libre dérivé du titre, son message est identique, avec le même rythme, les mêmes conditions, la même période et le même état) ; un timer qui disait déjà exactement la réponse d'une commande à vous se rattache à elle. L'ancienne liste n'est jamais effacée : elle reste dans les données, inerte et marquée. Rejouable sans effet ; le journal du site note seulement combien de timers ont été repris.

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
| Timers (intervalle, lignes de chat) | Onglet Timers et « Répéter automatiquement » sur la page d'une commande (les lignes sont comptées depuis le dernier envoi) |
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
- Les commandes des réseaux, les vôtres et les commandes toutes prêtes se règlent **sur la page du bot** : le tableau les montre avec leur état, et « Modifier » ouvre une fenêtre. La page ne remonte plus en haut quand vous cliquez : le message s'affiche à côté du bouton.
- Une fiche pas encore publiée peut déjà avoir sa commande réglée : elle attend la publication. Sans le bot, la fiche du partenaire ne montre aucune section en plus.

## Les récompenses en points de chaîne (onglet « Récompenses », depuis la 1.3.0 ; actions nommées depuis la 1.4.0)
Vos viewers dépensent leurs points de chaîne pour déclencher quelque chose. **Curiosa crée la récompense chez Twitch** (titre, coût, délai de recharge, texte d'aide, « le viewer écrit un message ») et lui associe **une action**, choisie en répondant à une seule question : « Ce qui se passe » quand une personne prend la récompense. La fenêtre « Nouvelle récompense » (ou « Modifier ») n'a que trois champs visibles (Titre, Coût, Ce qui se passe) ; le reste est sous « Plus d'options »
- **Répondre dans le chat** (marche sans rien d'autre) : « Merci {utilisateur} ! ».
- **Changer la couleur des lumières** (rouge, vert, bleu, jaune, orange, violet, rose, blanc) ou **Lire son message à voix haute** : des actions de la maison, qui demandent le **Connecteur Home Assistant**. Sans lui, l'onglet propose de l'installer ; il reste facultatif.
- **Autre chose chez moi** : on **donne un nom** à l'action (par exemple « Lancer l'aspirateur »). Le nom est le seul mot à connaître : Curiosa fabrique elle-même l'identifiant technique, **qui ne change plus** même si vous renommez l'action (ce qui est relié dans Home Assistant ne casse donc pas). Un nom déjà utilisé reprend la même action ; la liste **« Vos actions »** permet de la choisir pour une autre récompense, de la renommer ou de la retirer quand aucune récompense ne s'en sert.
- **Home Assistant apprend les noms** : le Bot Twitch publie le sujet `home.actions` (les noms de vos actions) que le Connecteur Home Assistant lit en option pour proposer « Lancer l'aspirateur → choisir un script » dans Home Assistant. Rien de votre maison n'est jamais envoyé à Curiosa.
- Si Home Assistant répond qu'il **n'a pas encore de script pour une action**, la récompense (liste et journal) le dit en mots simples avec la marche à suivre (Home Assistant > Curiosa > Configurer), les points sont rendus et un bandeau nomme les actions à relier. Un lien **« Relier à votre maison »** mène à la page du Connecteur Home Assistant.
- En **mode avancé**, le réglage « Montrer les identifiants techniques des actions » montre l'identifiant à côté du nom et permet d'en choisir un pour une nouvelle action. L'ancien réglage « Autres actions à choisir » (des mots comme `scene:cinema`) **marche toujours** : ses mots sont repris automatiquement dans « Vos actions », le mot servant de nom.

Pour commencer : activer les récompenses, autoriser Twitch (une fois, le chat n'est pas coupé), créer « Rouge » avec « Changer la couleur des lumières » puis la couleur rouge.

**Ce qui se passe quand un viewer prend une récompense** : l'échange est noté **une seule fois**, puis l'action est lancée. Si la maison accepte, **les points sont validés** quand elle a joué l'action ; si elle refuse (maison coupée, pas en direct, message refusé par la modération, trop de demandes…) ou n'a rien fait dans le délai (2 minutes par défaut), **les points sont rendus**. Un message dans le chat peut prévenir le viewer (réglage « Prévenir le chat quand des points sont rendus », désactivé par défaut).
- **Peu de choses tournent en arrière-plan** : les résultats de la maison sont relus quelques secondes après l'échange (cinq relectures espacées au plus), à chaque évènement de Twitch, à l'ouverture de l'onglet et par la tâche d'une minute.
- **Hors direct, ou quand la maison est coupée**, les récompenses de la maison sont **mises en pause chez Twitch**, et remises en vente toutes seules ensuite (seulement celles que Curiosa a mises en pause : une pause que vous avez faite reste).
- **`!stop`** dans le chat coupe la maison (vous et l'équipe de modération que vous nommez dans les réglages), **`!start`** la rebranche (vous uniquement). Sans le Connecteur Home Assistant, le bot le dit poliment.
- **Simuler** : le menu « ⋯ » de la récompense (« Simuler cette récompense ») joue le même chemin avec un faux viewer « Test », **sans Twitch et sans points**. Une action de la maison est vraiment envoyée chez vous ; une réponse dans le chat est seulement montrée. Refusé si la maison est coupée. 1 test toutes les 3 secondes, 30 par heure.
- **Journal** des 50 derniers échanges (pseudo, récompense, résultat) ; le message écrit par le viewer n'est **jamais gardé**. Un remboursement qui demande votre attention (la maison ne répond pas, pas de script relié, Twitch qui ne confirme pas…) est aussi noté dans l'**Historique** de l'extension, avec le nom de la récompense et la raison, jamais le pseudo. Les réussites et les remboursements normaux (maison coupée, hors direct, trop de demandes, message refusé) n'y sont pas.
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
| `timers_list`, `timer_create`, `timer_update` | Voit, crée (une commande « Timer seulement ») et modifie les timers, c'est-à-dire les commandes qui se répètent (même période : `activeFrom` / `activeUntil` / `yearly`, `clearPeriod` pour l'enlever). Pour répéter une commande qui existe : `bot_command_update` avec `repeatEveryMinutes`, `repeatMinChatLines`, `repeatWhen`, `repeatEnabled` (`clearRepeat` pour retirer, `timerOnly` pour une commande que personne ne tape). |

Les périodes se donnent sous la forme `11-01` (chaque année) ou `2026-11-01` (une seule fois).

## Réglages avancés
Réservés au mode avancé : le **signe des commandes** (`!` par défaut), un **compte bot séparé** pour que ce soit un autre compte Twitch qui réponde (vous le connectez sur la page du bot), les attentes par défaut, la limite de réponses, l'âge maximum d'un message de Twitch, la chaîne servie si votre site en a plusieurs (un choix dans la liste de vos « Ma Chaîne Twitch » ; un pseudo tapé avant la version 1.2.0 continue de servir), des bots supplémentaires à ignorer, et la liste des sites que `{urlfetch}` peut lire.

## À savoir
- Le bot a besoin que **votre site soit joignable depuis Internet en `https://`** : Twitch envoie chaque message du chat à votre site. Un site en test sur votre ordinateur ne peut pas le recevoir ; la page vous le dit.
- Le nombre de followers demande de cocher « Suivre mes statistiques » dans Ma Chaîne Twitch et de connecter votre chaîne ; sinon `!followers` est masquée et la page explique pourquoi.
- Les heures de `!planning` suivent le fuseau horaire que vous indiquez dans les réglages ; sans fuseau, elles sont données en UTC et le disent.
- **Vie privée** : le journal garde le pseudo, la commande et le résultat des 30 dernières commandes, visibles de la seule équipe d'administration. Les mots tapés dans une commande (`{1}`, `{requete}`…) servent à la réponse et ne sont jamais gardés (le journal ne garde pas le texte d'une réponse qui les reprend). Rien d'autre n'est conservé de ce que les gens écrivent.
- Ce module ne lit les messages que pour y trouver des commandes ; les autres messages sont ignorés dès leur arrivée.

## Visuels de la fiche

Depuis la version 1.7.1, la fiche du module montre des captures de ce qu'il ajoute à votre site (données inventées, aucune donnée réelle).

## Speed (1.11.0)

The bot answers a chat command in about one round trip to Twitch. What used to come before the reply and no longer does:

- **Only what the command needs is read.** The calendar, the partners, the networks and the follower count are read only by the commands that use them (`!planning`, a partner command, `{followers}`…). A `!word` that is not a command costs nothing.
- **An older reading answers at once.** Those four readings, and the "only when live" check, may be up to 10 minutes (live state: 1 minute) old and are renewed in the background; `{jeu}`, `{titre}`, `{uptime}` and `{viewers}` still ask for a fresh reading (at most 15 s old).
- **The configuration and the account check are remembered** (the configuration until you change it, the account check for 5 s, forgotten as soon as a send fails).
- **The journal is written after the reply.** The call only ends once it is written, so nothing is lost.
- **Replies leave through a short queue** (3 at a time, in the order they were asked), so a burst of answers cannot overload the site.
- **A task runs every minute** (`tick`): it keeps the readings warm, sends a repeat that asks for chat lines already counted at its time, and re-reads the rewards. A silent chat still gets nothing.
- **A home reward is validated by itself** a few seconds after the home answered (re-reads at 1.5, 4, 9, 20 and 45 s), instead of at the next event from Twitch.

What stays outside the code: the time Twitch takes to pass each chat message on to the site is Twitch's own; the default of 12 replies per 30 seconds (Twitch allows 20, and 100 for the channel owner and moderators) is a setting.

## Edit windows (1.12.0)

Creating or changing a command, a timer, a reward or one of your actions now opens a **window above the page** (the same window as the details of an extension before its installation), instead of a section that pushed the list down. The list keeps its search, its filter and its scroll position; Esc, "Close" and "Back" close the window, and a window with edited fields asks before it discards them. A reload or a shared link reopens it.

- **Lists are Curiosa tables.** Commands (one table: your own, ready-made, partners, networks), timers and rewards have live search, filter chips, an on/off switch in the row and a "⋯" menu. At most two buttons are visible; **Delete** is in the menu and its confirmation says what is lost (the window itself has no destructive button).
- **What did not move into a window**, on purpose: the partner command (its page is the partner file, so "Edit" opens a window whose only button goes there); the reward test (its answer must stay readable, which a window cannot do yet); the two collapsed lists "Add a command for a partner or a network" and "Pick a command" (a window cannot hold a list to pick from yet), and the journal. The live preview and the insert chips under the answer text are gone with the old page script: the pieces you can use are listed in the help bubble of the field.
- **Same data**: the settings, the stored commands, timers and rewards and the routes are unchanged; there is no migration. The module now needs Curiosa 0.6.7.

## Remote control (1.13.0)

With **Audience** installed, the remote control of your live (the secret address for your phone, and the same address with `&dock=1` for an OBS dock) gets a **Bot** tab, added by this module. Without Audience nothing changes: the module only offers its panel, it does not need Audience. With two bots on the same site, each one has its own tab.

- **One switch: "Bot answers".** It shows the current state ("On, answering your chat" or "Paused, silent in your chat"), in a big target, and says "Working…" the moment you press it. When the bot is paused, the tab says "Paused" from the other tabs too. If the change cannot be saved, a sentence under the switch says so and the switch keeps the real state.
- **It is the emergency stop you already have**, not a second one: the same flag, shown at the top of the bot page ("The bot is switched off", "Since 21:40, from the remote control", and the button "Switch answers back on"). Pause from the phone, resume from the administration, or the other way round.
- **What paused means.** The bot writes nothing in the chat and acts on nothing, on every path: replies to commands, replies to `!addcom`, `!editcom`, `!delcom` and `!commands`, repeating commands (a chat line or the one-minute task), "Send now", giveaway entries, the replies to `!stop` / `!start`, and **channel point rewards** (since 1.13.0: no chat answer, no action at home, the points are given back; the refund notice stays silent too, and a home reward cannot be simulated). Commands and settings are kept. Repeating commands do not fire in a burst when you resume. The "Stop everything" button of the remote closes polls and sign-ups; it does not pause the bot.
- **Quick add: two fields, one button.** "Command name" (for example `hello`) and "Reply" (for example "Welcome, make yourself at home"), then "Add the command". The new command is for everyone, enabled, with the usual delays; to give it a role, a delay, other names or a repeat, open it in the administration (the confirmation says so). Same checks as the administration (name rules, 450 characters, no `/` or dot at the start, known `{pieces}` only, 100 commands, no name already taken by one of your commands, a ready-made one, an alias or a reserved word). A refusal is said in a sentence with an example under the field in error, what you typed stays, and the cursor goes to that field. Not available here, on purpose: `{urlfetch}` (it reaches out to a website), roles, delays, other names, periods, repeats, actions. A reply typed on the remote is limited to 200 characters by Audience.
- **Undo.** The last three commands added this way are listed under "Just added", each with a "Delete !name" button. It deletes that command (and its counter) in one tap, only while nobody changed it in the administration since; after that the button disappears and the command is yours to delete there. Commands made in the administration or from the chat can never be deleted from the remote.
- **Who can press.** Only whoever holds the secret address of the remote control. The bot adds no route, no right and no permission: Audience checks the address, limits the number of presses (60 a minute, and a slower limit for wrong addresses) and writes who did what in its journal ("Remote control: Twitch bot paused", "Chat command added"…). The site's history also gets "Bot paused from the remote control", "Bot switched back on from the remote control", "Command … added / deleted from the remote control" (the name of the command only, never a message from the chat).
- **Assistants (MCP).** No tool was added: pausing the bot is the owner's gesture. `bot_commands_list` already tells whether the bot is paused.

## Collaboration mode (1.14.0)

When you stream with other people in a **shared chat**, the bot should not fill the chat on its own. The collaboration mode is one switch that makes it talk less. It is **off** until you switch it on, and it stays as you left it after a restart or an update.

- **Where it is.** On the bot page, right under the status line: "Collaboration mode off / on", since when it is on, what it does, when it ends, and one button, "Start collaboration mode" / "Stop collaboration mode" (one click, it uses the saved choices). With Audience, the **Bot** tab of the remote control (phone, OBS dock) has the same switch. An assistant can use `collaboration_mode_set` and read the state in `bot_commands_list` (`collaborationMode`).
- **Two choices, right under the line.** "Timers during collaboration": **Thin out** (default) or **Pause**. With thinning, "Timers still sent": **1 in 3** (default) or **1 in 2**.
  - *Thin out* is counted **per timer** and written down: when a timer is due, it is counted; the 3rd (or 2nd) time it goes out, and the counter starts again. The other times the timer simply waits for its next turn, so each timer keeps its own rhythm and none is forgotten. (A timer has no priority flag in this module, so all are treated alike.)
  - *Pause* sends no timer; when the mode ends, the timers start their wait again and nothing goes out in a burst.
- **Under "More options"** (all optional):
  - **Longer wait between answers**: the delays of the commands are multiplied (1 to 5 times, default 1 = unchanged). A command still answers; it just answers less often to the same person.
  - **Mute other automatic messages** (default off): the notice that points were given back is not written, and a reward that makes the bot answer in the chat is **refunded** instead of answered (no answer, no points lost). These are the only automatic messages of this module besides timers: it has no thank-you for follows, raids or subscriptions, and no automatic message about the game or the title.
  - **Stop by itself after** (default 6 hours, 0 = never): a safety net so that the mode is not left on by mistake. The page says when it will end.
- **What is never muted.** The answer to a command a viewer typed (and to `!addcom`, `!stop`, `!start`), and "Send now" from the timers tab. The emergency stop still wins over everything.
- **Shared chat.** The mode does not change how the bot reads the chat: messages that come from another channel's side of a shared chat are still ignored, as before.
- **History.** Each change is written in the site's history ("Collaboration mode switched on (admin)", with `admin`, `remote`, `assistant` or `auto` for the end by the clock) and the page and the remote say where the last change came from.
- **Who can use it.** Whoever opens the administration, the secret address of the remote control, or an assistant to which you gave the `collaboration_mode_set` tool (a write tool, off by default).
- **Data.** Nothing to migrate: the switch and the choices are two small entries in the state of the bot; the thinning counters are in the timers state. `minCore` unchanged.

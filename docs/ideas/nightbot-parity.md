# Bot Twitch : parité avec Nightbot (note de conception)

*Source : les pages https://docs.nightbot.tv/ n'ont pas pu être ouvertes depuis l'environnement de travail (nom d'hôte non résolu). Le comportement ci-dessous est résumé à partir des extraits remontés par la recherche web (pages « variables », « urlfetch », « userlevel », « timers », « commands »), de ce que l'on sait de Nightbot, et marqué « à vérifier » quand c'est incertain. Aucun texte n'est copié. Le tirage au sort n'est PAS dans ce module (décision : il vit dans Participation, le bot ne fait que l'alimenter).*

## Ce que fait Nightbot (résumé)

- **Niveaux** : tout le monde, habitué (« regular », liste tenue à la main), abonné, modération, propriétaire.
- **Délai** : un délai par commande (secondes), commun à tout le monde ; pas de délai par personne.
- **Variables** : `$(user)`, `$(touser)` (1er argument, ou la personne si absent), `$(count)` (nombre d'utilisations), `$(query)` / `$(querystring)` (tout ce qui suit la commande, brut ou encodé pour une adresse), `$(1)` `$(2)` `$(1:)` (arguments), `$(channel)`, `$(time fuseau)`, `$(twitch …)` (jeu, titre, durée du direct…), `$(urlfetch adresse)` (réponse d'un site, 400 caractères au plus), `$(eval …)` (JavaScript), compte à rebours.
- **Timers** : intervalle en minutes ; nombre minimum de lignes de chat (compté sur 5 minutes) ; le timer attend d'abord son intervalle. Pas de réglage « en ligne / hors ligne » côté Nightbot (à vérifier).
- **Gestion depuis le chat** : `!commands add|edit|delete` (et l'ancien `!addcom` `!editcom` `!delcom`) pour la modération ; options `-ul=` (niveau), `-cd=` (délai), `-a=` (alias).
- **Tirage au sort** : non vérifié dans la documentation consultée.

## Correspondances et décisions

| Fonction Nightbot | Équivalent du Bot Twitch | Décision |
|---|---|---|
| Niveau « tout le monde » | Tout le monde | repris |
| Niveau « abonné » | Les personnes abonnées | repris |
| Niveau « modération » | L'équipe de modération | repris |
| Niveau « propriétaire » | Seulement moi | repris |
| Niveau « habitué » | — | **non repris** : le bot ne tient aucune liste de personnes. L'import le remplace par « Les personnes abonnées » et le signale |
| Niveau inconnu à l'import | « L'équipe de modération » | adapté (le plus prudent), signalé |
| Délai d'une commande | Attente pour tout le monde (existait) + attente par personne (existait) | repris ; à l'import seul le délai commun est rempli |
| Alias (`-a=`) | Autres noms (5 au plus, existait) | repris |
| `$(user)` | `{utilisateur}` | repris (traduit à l'import) |
| `$(touser)` | `{cible}` : 1er mot sans @, nettoyé ; la personne qui écrit si absent | adapté |
| `$(count)` | `{compteur}` : un compteur par commande, gardé par le bot | repris (valeur de départ reprise de la colonne « count » si elle est collée) |
| `$(query)` | `{requete}` (ou `{requête}`, `{query}`) : texte après la commande, nettoyé, 200 caractères | adapté |
| `$(querystring)` | — | non repris : sert à construire des adresses, que le bot ne laisse pas construire à partir du chat |
| `$(1)` `$(2)` `$(1:)` | `{1}` `{2}` `{1:}` (jusqu'à `{9}`) | repris, texte nettoyé |
| `$(channel)` | `{chaine}` | repris |
| `$(time fuseau)` | `{heure fuseau}` et `{date fuseau}` | adapté (nom de fuseau vérifié à la saisie) |
| `$(twitch … game / title / uptime)` | `{jeu}` `{titre}` `{uptime}` (existaient) | repris |
| spectateurs en direct | `{viewers}` (via Ma Chaîne Twitch) | ajouté |
| `$(followage)` (n'existe pas en natif chez Nightbot, se fait avec `urlfetch`) | — | non repris : le nombre de followers de la chaîne existe (`{followers}`), pas la date de suivi d'une personne (autorisation Twitch non demandée par le Connecteur) |
| `$(urlfetch adresse)` | `{urlfetch adresse}` version sûre : https, hôtes de la liste blanche (vide = éteint), 3 s, 400 caractères, cache 30 s, limite de débit, aucune redirection suivie, aucune adresse privée | adapté, très restreint |
| `$(eval …)` | `{calcul …}` : petit évaluateur arithmétique (nombres, + - * / % ^, parenthèses, abs round floor ceil min max sqrt) | **JavaScript non repris** : exécuter du texte écrit par une personne sur le serveur du site est une faille ; le calcul couvre les usages courants |
| `$(random…)` | `{aleatoire a \| b \| c}` ou `{aleatoire 1-100}` | adapté (la variable n'est pas confirmée dans la documentation consultée) |
| `$(countdown)` `$(countup)` `$(timeto)` | `{prochain_stream}` (existait) pour l'usage le plus courant | non repris tels quels |
| `$(weather)` `$(provider)` `$(chatid)` `$(user.id)` `$(channel.id)`, etc. | — | non repris |
| `/me` en début de message | retiré | adapté (le bot ne peut pas écrire en italique) |
| Timers (intervalle, lignes minimum) | Section « Timers » : intervalle ≥ 1 min, lignes minimum, en direct seulement ou toujours, activé ; jamais de minuteur de fond : ils sont évalués à chaque message du chat | adapté : comme chez Nightbot il faut que le chat soit actif |
| Lignes comptées sur 5 minutes | Lignes comptées depuis le dernier envoi | adapté (plus simple à expliquer) |
| `!commands add / edit / delete`, `!addcom` `!editcom` `!delcom` | `!addcom` `!editcom` `!delcom` `!commands` pour la modération, mêmes vérifications que l'administration, réglage « Laisser la modération gérer les commandes depuis le chat » (éteint par défaut) | adapté ; `!commands` répond avec la liste (modération seulement) ; options `-ul=` `-cd=` |
| Commandes par défaut de Nightbot (`!uptime`, `!title`, `!game`…) | Commandes toutes prêtes existantes (`!jeu` `!titre` `!uptime` `!followers` `!planning`) | l'import ignore la rubrique « par défaut » |
| Tirage au sort | Participation (module `audience`) ; le bot lui envoie les participations par le service facultatif `audience.draw` | **hors de ce module** |
| Modération du chat (filtres de liens, majuscules…) | — | hors périmètre (hors de la demande) |
| Chansons, quotes, régulars, spam protection | — | hors périmètre |

## Format du copier-coller : inconnu

Le format exact obtenu en copiant la liste depuis le tableau de bord de Nightbot n'a pas pu être vérifié. L'analyseur est donc tolérant : tableau à tabulations ou à colonnes séparées par 2 espaces ou plus ; cellules sur des lignes séparées ; une commande par ligne (`!nom message`) ; JSON (export de l'API : `commands`, `timers`). Forme de secours documentée : `timer nom | minutes | lignes | message`.

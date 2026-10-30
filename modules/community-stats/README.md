# Statistiques de la communauté

Le site tient à jour **les chiffres de vos réseaux** : followers, abonnements payants, publications, vues. Il les note régulièrement, en garde l'historique, vous les montre dans l'administration avec leur évolution (« +120 followers cette semaine »), et votre IA peut les consulter. **Rien n'est affiché sur votre site** tant que vous n'avez pas choisi « Montrer sur mon site » pour un chiffre. Depuis la version 1.2.0, ces chiffres peuvent s'afficher dans vos **pages d'overlay** pour OBS (voir « Compteurs dans les pages d'overlay »).

**Il faut Curiosa 0.5.0 ou plus** (les pages d'overlay ; la collecte, l'administration et l'assistant IA fonctionnent comme avant). Depuis la version 1.1.0, il accepte aussi les chiffres de direct Twitch sur 30 jours (audience moyenne, pic, temps de direct et regardé, followers gagnés).

## Pour commencer : rien à régler
1. Installez et activez ce module.
2. Dans le module de chaque réseau (Twitch, YouTube…), cochez **« Suivre mes statistiques »**.

Les chiffres apparaissent d'eux-mêmes, au prochain passage (au plus 15 minutes) ou tout de suite avec **« Mettre à jour maintenant »**. Ce module se branche seul sur tous les réseaux qui partagent leurs chiffres, y compris ceux que vous installerez plus tard : il n'y a rien à relier à la main. (Si vous restreignez ses sources dans l'administration, seuls les réseaux cochés comptent.)

## Ce que vous voyez
- **Vos chiffres** : pour chaque compte, le dernier chiffre, l'évolution de la semaine et du mois en une phrase, d'où il vient (automatique ou saisi à la main) et quand il a été mis à jour.
- **Quand un chiffre manque**, une explication simple et quoi faire : « YouTube cache votre nombre de followers : rendez-le public dans YouTube Studio », « Twitch demande votre autorisation : cliquez sur Connecter ma chaîne »… Le dernier chiffre connu reste affiché, daté ; il n'est jamais présenté comme actuel.
- **Ce que vous montrez sur votre site** : un choix par chiffre, **« Non, je le garde pour moi » par défaut**. Vous pouvez par exemple montrer vos followers Twitch sans montrer vos abonnements payants.
- **Comptes saisis à la main** : pour Instagram, TikTok, X, Facebook… qui ne donnent pas leurs chiffres tout seuls. Vous notez le chiffre, le site garde la date et l'historique, et vous rappelle quand il a plus de 30 jours.
- **Réglages avancés** (mode avancé de l'administration) : à quelle fréquence noter les chiffres (toutes les heures, 6 h, 12 h, **une fois par jour par défaut**, une fois par semaine) et combien de temps garder l'historique (3 mois, 1 an, **2 ans par défaut**, 5 ans, pour toujours). Le dernier chiffre de chaque compte n'est jamais effacé.

Aucun total n'est inventé : ce module n'additionne pas vos réseaux (une même personne peut vous suivre à plusieurs endroits). Les règles d'assemblage viendront de vous, plus tard, dans la page où vous afficherez vos chiffres.

## Guide pour votre IA
Accordez-lui l'accès à ces outils (administration → API & MCP → accès du jeton) : **aucun n'est accordé d'office**.

| Outil | Ce qu'il fait |
|---|---|
| `community_stats_list` | Les chiffres actuels, leur origine (automatique ou saisi à la main), leur fraîcheur, l'évolution sur 7 et 30 jours. Filtres : `platform`, `metric`. Lecture seule. |
| `community_stats_history` | L'historique d'UN chiffre (`id` pris dans la liste), sur 1 à 1830 jours, au plus 500 points. Lecture seule. |
| `stats_set_manual` | Note à la main un chiffre pour un réseau sans lecture automatique. Refusé pour un compte lu automatiquement. Le nom du jeton est gardé dans l'historique. |

Exemples de questions : « Combien de followers ai-je gagnés ce mois-ci ? », « Quel réseau progresse le plus vite ? », « Mon nombre de vues YouTube a-t-il baissé depuis mars ? », « Note que j'ai 4 200 followers sur Instagram. » Les types de chiffres : `followers` (audience gratuite), `paying` (audience payante), `content` (publications), `views` (vues), et pour les directs Twitch `avg_viewers`, `peak_viewers`, `hours_streamed` et `hours_watched` (en minutes), `followers_gained` ; l'unité est dans le champ `unit`. Quand `status` vaut `no_data`, le chiffre est le dernier connu et `problem` dit pourquoi il manque.

## Contrat pour les modules de réseaux (pour les développeurs)
Chaque module de réseau **possède ses chiffres** et les publie ; ce module les collecte. Pour participer, un module déclare dans son `module.json` `provides: [{ "topic": "social.stat" }]` (permission `topics`) et implémente `exports["social.stat"](ctx, { locale, limit, tags })`, qui renvoie un tableau d'éléments :

| Champ | Type | Sens |
|---|---|---|
| `id` | texte | **stable** : `"<module>:<clé d'instance>:<type de chiffre>"` (ex. `twitch-channel:emma:followers`). Le module `manual` est réservé. |
| `platform` | texte | identifiant de la plateforme (`twitch`, `youtube`…), minuscules, 31 caractères au plus |
| `account` | texte | nom lisible du compte (120 caractères au plus) |
| `accountKey` | texte | clé d'instance |
| `metric` | texte | `followers` (audience gratuite), `paying` (audience payante : followers, membres, mécènes), `content` (nombre de contenus), `views` (vues cumulées) ; et, pour un module qui mesure lui-même ses directs, les **chiffres de période** ci-dessous. Doit être le dernier morceau de `id` |
| `label` | texte | libellé humain de la statistique, ex. « Followers Twitch » (120 caractères au plus) |
| `value` | nombre | entier de 0 à 1 000 000 000 000. **Absent** quand `error` est présent : jamais une valeur périmée |
| `asOf` | date ISO 8601 | moment de la lecture |
| `url` | adresse | facultative, http(s) seulement, 500 caractères au plus |
| `error` | texte | facultatif : `auth` (autorisation à redonner), `rate` (trop de demandes), `network` (réseau injoignable), `hidden` (le réseau cache ce chiffre), `config` (module mal réglé) |

### Chiffres de période (30 jours glissants)
Liste fermée, pour un module qui **mesure lui-même** une activité (aujourd'hui : *Chaîne Twitch*, ses directs). Chacun est un entier >= 0 ; `0` veut dire « rien de mesuré sur la période » :

| `metric` | Sens | Unité (champ `unit` pour l'IA) |
|---|---|---|
| `avg_viewers` | audience moyenne par direct, pondérés par le temps | `viewers` |
| `peak_viewers` | le plus haut pic d'un direct | `viewers` |
| `hours_streamed` | temps de direct | **minutes** entières (le nom est celui du contrat) |
| `hours_watched` | audience × temps (temps regardé par l'audience) | **minutes** entières |
| `followers_gained` | followers gagnés pendant les directs (net, jamais négatif dans ce chiffre) | `people` |

Pourquoi des minutes : un entier, sans arrondi qui ferait disparaître un petit direct, et une durée sans ambiguïté pour une IA (qui lit `unit`). La page d'administration les écrit en « 12 h 30 » ; elle ne compare pas ces chiffres semaine après semaine (ce sont déjà des totaux glissants) mais les garde dans l'historique comme les autres. Ils ne se saisissent pas à la main.

Règles : un élément invalide est écarté seul (les autres passent) ; un élément avec `error` ne produit **jamais** de point dans l'historique (la raison est gardée, le dernier chiffre connu aussi) ; une statistique qui n'est plus transmise garde son historique et son réglage, et est signalée comme « ne partage plus ». Le cœur ne laisse passer que 200 éléments par collecte et ne dit pas qui a échoué : un module qui ne peut pas lire son chiffre doit renvoyer l'élément avec `error` plutôt que de ne rien renvoyer.

## Où et combien c'est gardé
Dans le stockage privé de ce module (rien ne sort du serveur ; aucun secret) :
- `communityStats` : un document par statistique (réglage « montrer sur mon site », privé par défaut ; dernier chiffre ; état ; raison ; liste de ses mois d'historique) ;
- `communitySamples` : un document par statistique et par mois, `points: [[secondes, valeur], …]` ; un point saisi à la main porte en plus `"m"` et le nom du jeton (ou `admin`) ;
- `communityRun` : le dernier passage (période traitée, cadence du bouton « Mettre à jour maintenant », qui attend 2 minutes entre deux appuis).

Au plus **un point par statistique et par période** : un deuxième passage dans la même période ne crée rien (le bouton « Mettre à jour maintenant » remplace le point du jour). Volume : environ 20 octets par point. Par défaut (un par jour, 2 ans), 730 points ≈ 15 Ko par statistique, soit environ 300 Ko pour 20 statistiques. Pire cas réglable (toutes les heures, 5 ans) : 43 800 points ≈ 900 Ko par statistique. Au plus 300 statistiques suivies (les suivantes sont ignorées). La rétention est appliquée à chaque passage, sans jamais retirer le dernier chiffre connu d'un compte.

## Compteurs dans les pages d'overlay (version 1.2.0, Curiosa 0.5.0)
Le module propose un élément **« Compteurs »** aux pages d'overlay de la section **Overlays** de l'administration : vos followers, abonnements payants, publications et vues, en grand, avec leur évolution.

- **Rien n'est montré sans votre accord.** L'élément ne montre que les chiffres pour lesquels vous avez choisi **« Montrer sur mon site »**, et jamais plus : ses options ne font que **choisir parmi eux**. Un chiffre gardé pour vous n'apparaît nulle part (ni dans la page, ni dans sa mise à jour, ni en mode test). Un chiffre que le réseau cache ou ne partage plus n'est jamais montré périmé. Retirez votre accord : le compteur disparaît.
- **Options** : **Compteurs à afficher** (tous ceux que vous montrez, ou seulement les followers, les abonnements payants, les publications ou les vues) et **Évolution** (sur la semaine, sur le mois, ou aucune ; rien n'est écrit quand l'historique est trop court). Pour deux listes différentes, ajoutez l'élément deux fois.
- **Taille** : il s'adapte à la taille choisie (minimum 200 × 100) : les tuiles se répartissent en colonnes et rangées selon le cadre, 12 compteurs au plus. Fond transparent par défaut ; il suit le style commun de la page d'overlay (jetons `--ov-*`, attributs `data-ov-part`) et ne charge jamais le style de votre site.
- **Sans compteur autorisé**, le cadre reste vide en direct ; en mode test, une phrase vous dit quoi faire. Aucun chiffre n'est inventé.
- **Charge** : plusieurs pages d'overlay peuvent montrer l'élément ; une seule lecture du stockage sert tout le monde pendant 30 secondes. Aucune tâche de fond de plus ; la page s'interroge elle-même, de plus en plus lentement.
- Développeurs : route publique `element/counters` (adresse sans secret : elle ne rend que le montrable, via `publicStats`, la règle unique `isShowable` de `publicRead.mjs`), nouveau droit `routes`, fichier `overlay.mjs`, test `tests/community-stats-overlay.test.mjs`.

## Ce qui viendra (pas dans cette version)
L'affichage sur le site : une page « Les chiffres de la commu », ou un compteur glissé dans le texte d'une page, y compris un calcul de plusieurs chiffres (par exemple followers YouTube + Twitch) réglé dans la page qu'on édite. Le drapeau « Montrer sur mon site » et une lecture interne qui ne rend que les chiffres montrables (`readPublic`) existent déjà, pour que cet affichage n'ait rien à changer ici.

## Permissions
Administration, stockage, sujets (lecture des chiffres publiés), MCP, routes (la page de l'élément d'overlay). Aucune page publique ; l'élément d'overlay ne rend que les chiffres que vous avez choisi de montrer. Aucun envoi hors du serveur.

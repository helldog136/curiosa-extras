# Sondages (`polls`) — description complète

## Le problème
Décider du jeu de demain, du nom d'une mascotte, du prochain tutoriel : on fait des sondages sur des sites tiers, les résultats se perdent, personne ne les retrouve. Ce module garde tout sur le site d'Emma, avec l'historique.

## Pour qui
Emma, créatrice non technique, sur téléphone d'abord ; sa communauté ; son stream (OBS).

## Type de module et justification
Module à code, type « widget » (page publique + section d'accueil + panneau d'admin + actions pour l'assistant), instance unique. Pas du « contenu zéro code » : il faut un vote anonyme, des compteurs sûrs, une page vivante. La permission `overlay` (source OBS) le range par défaut « seulement dans Extensions » (règle du cœur sur le manifeste) : Emma l'épingle d'un clic si elle le veut dans le menu (voir « Idées »).

## Ce que voit le visiteur
- `/polls` : sondages en cours, puis terminés (50 par page, les plus récents d'abord ; complets puis archivés).
- `/polls/<nom>` : la question, la date de fin avec l'heure ET le fuseau écrits (« vendredi 30 octobre 2026 à 21:00 heure normale d'Europe centrale · chez vous : … » ajouté par le navigateur), le formulaire (cases ou boutons ronds selon le maximum de choix), le message d'erreur sous les choix, puis les résultats en barres : nom, pourcentage et voix écrits (« 42 % · 17 voix »), « En tête » / « Gagnant » écrit et barre rayée (jamais la couleur seule), « Votre choix » pour son propre vote. Lien à partager avec bouton « Copier ».
- Résultats « tout de suite » ou « après le vote » (au choix d'Emma, sondage par sondage ; réglage par défaut dans les réglages). Quand c'est « après », la page et les réponses du site ne contiennent AUCUN chiffre avant le vote. Une fois terminé : résultat final pour tous.
- Section d'accueil « Le sondage en cours » (le plus récent ouvert, votable sur place).
- Sans JavaScript : la question et les résultats (si permis) restent lisibles, un message explique qu'il faut JavaScript pour voter.

## Ce que fait Emma, pas à pas
1. Installer : rien à régler (fuseau Paris, résultats visibles tout de suite).
2. « Mes sondages » → formulaire : question, choix (un par ligne), nombre de choix par personne (1 = unique), qui voit les résultats, date et heure de fin facultatives. Erreurs sous chaque champ avec un exemple. Le lien à partager s'affiche aussitôt.
3. Détails d'un sondage : lien, résultats, Modifier (les choix se verrouillent dès qu'une personne a voté), Refaire un sondage comme celui-ci, Afficher à l'écran, Fermer maintenant, Rouvrir, Archiver, Recompter les voix, Supprimer ; chaque action grave demande de cocher une case claire.
4. Onglet « En direct » (« À l'écran » en 1.0) : les manches, le sondage rapide, puis l'adresse secrète à coller dans OBS, le retour à l'affichage automatique et le changement de l'adresse (confirmation).

## Réglages et valeurs par défaut
Simples : introduction de la page, fuseau horaire (Paris), résultats par défaut (visibles). Avancés : conservation des votes détaillés (30 jours, 1–90), votes par heure et par connexion (30, 3–300), secondes entre deux mises à jour à l'écran (5, 3–30). Apparence OBS : place, couleurs (suivent le thème). Droits : `polls:manage` (créer, modifier, fermer, supprimer, choisir l'écran, télécharger), `polls:obs.view` (voir/changer l'adresse secrète, sensible).

## Données gardées et vie privée
- Stockage de l'instance : `polls` (≤ 200), `archive` (≤ 800, totaux seulement), `b-<id>` (bulletins, ≤ 5 000 par sondage), `meta` (adresse secrète OBS, sondage à l'écran).
- Un bulletin = empreinte SHA-256 de « identifiant du sondage + code anonyme » (donc différente d'un sondage à l'autre : on ne peut pas relier deux sondages) + choix cochés + date. Ni nom, ni IP, ni code en clair.
- Le code anonyme est tiré au hasard dans le navigateur (localStorage). Aucun cookie, aucune requête avec cookie (`credentials: omit`).
- Limite de débit : HMAC-SHA-256 de la connexion avec un sel au hasard de 32 octets, en mémoire seulement, renouvelé chaque jour (et au redémarrage) ; empreinte tronquée à 16 caractères, tenue en mémoire bornée (5 000 compteurs). L'adresse IP n'est jamais écrite ni journalisée. Limites : 30 votes/heure/connexion (réglable), 8 essais/10 min/connexion/sondage, 120 votes/minute pour le site, 5 000 votants/sondage, champ piège.
- Conservation : bulletins effacés 30 jours après la fin (réglable) ; ménage « à la lecture », 200 effacements par passage, déclenché par un vote ou l'ouverture de l'admin (pas de minuteur). Archiver ou supprimer efface tout de suite. Déclaré dans `privacy` (repris dans la politique de confidentialité du site).

## Limites anti-triche (dites honnêtement, aussi dans l'admin)
« Un vote par personne » = un vote par navigateur : vider ses données, changer de navigateur ou la navigation privée permet de revoter ; il n'y a pas de compte. Le débit freine les curieux et les scripts simples mais pas une personne déterminée qui change de connexion. La limite par connexion lit l'adresse la plus à droite de `X-Forwarded-For` (celle ajoutée par le relais de confiance) : sans relais fidèle, tout le monde partage une empreinte ou la limite se contourne. Pour un enjeu qui compte, ne pas se fier à ce résultat seul.

## Compteurs sûrs
Toutes les écritures d'une instance passent par une file en mémoire (verrou par instance) : lecture du sondage, contrôle du bulletin, ajout du bulletin, mise à jour des compteurs. Un bulletin unique par code est garanti en plus par sa clé : si deux processus écrivaient en même temps, le plus ancien gagne et l'autre s'efface. Si l'écriture du compteur échoue, le bulletin est retiré (rien à moitié compté). « Recompter les voix » refait les totaux depuis les bulletins (réparation). Testé avec 80 votes simultanés.

## Source OBS
Type overlay du cœur (étudiés : ticker-overlay, alerts-overlay) : page `/overlays/<clé>?k=<secret>`, fond transparent. Sans le code secret : un message « adresse incomplète », aucun résultat. Le code (18 octets au hasard) est dans les données du module, montré seulement avec le droit `obs.view`, régénérable. Mise à jour par interrogation douce de `/m/<clé>/live` : toutes les 5 s au départ, ralentit ×1,5 (jusqu'à 30 s) quand rien ne change, 30 s mini quand le sondage est fini, quasi arrêtée quand l'onglet est caché, double à chaque erreur (jusqu'à 60 s), jamais de boucle serrée ; réponse minuscule si rien n'a changé ; 120 demandes/minute au plus. Montre le sondage choisi, sinon le plus récent ouvert. Les résultats y sont toujours en direct, même pour un sondage dont le public ne voit les résultats qu'après le vote.

## Outils pour l'assistant IA
`polls_list`, `poll_results` (lecture seule) ; `poll_create`, `poll_close` (écritures, désactivées par défaut) ; `poll_delete` (1.2.0, destructrice : jamais accordée d'office, un sondage ouvert demande `allowOpen: true`). Pas d'archivage par l'assistant.

## Intégrations
Aucune obligatoire. Intégration avec `game-suggestions` : **non faite**. Ce module n'offre ni service ni sujet exploitable (ni `provides` ni `offers`), et le cœur n'a pas de sujet « jeux suggérés » ; la faire demanderait de modifier l'autre module ou d'inventer un sujet. Voir « Idées ».

## Ce qui n'est pas fait, et pourquoi
Vote pondéré/classé, choix libres proposés par le public, vote avec compte, pastille d'accueil « nouveau sondage » (faite : pastille de menu via `news`), export automatique, e-mail aux votants : hors sujet ou contraire à la vie privée. Pas de minuteur : un sondage fini n'est « rangé » qu'à la lecture.

## Idées pour la suite
- `game-suggestions` pourrait publier un sujet `game.suggestion` (jeux « proposés ») : « Faire un sondage avec les 4 jeux les plus suggérés » en un clic (consommation facultative).
- Règle du cœur : un module qui a des actions MCP et une permission `overlay` pourrait être épinglé par défaut.
- Une vraie preuve de non-robot (défi léger) pour les sondages à enjeu ; un mode « un vote par adresse e-mail confirmée » avec Contacts.
- Annonce automatique d'un nouveau sondage (Discord, flux) via `feed.item`.
- Résultats en direct sans interrogation (SSE comme alerts-overlay).


---

# Version 1.1.0 : manches, sondage rapide et Participation

## Le problème
Un sondage « normal » se prépare à l'avance ; en live on veut autre chose : **« toutes les 10 minutes, le chat décide »** (quel boss, on continue ou on change de jeu, quelle pause) sans que la streameuse recrée un sondage à chaque fois, et un **« A ou B ? » en un geste** depuis son téléphone. Et tout ce qui est commun à toutes les animations (identité anonyme, voix unique, limites, télécommande, direct, journal) ne doit pas être réinventé ici : c'est le rôle du module Participation.

## Ce qui bouge dans Participation, ce qui reste dans Sondages
| Chez Participation (`audience`) | Chez Sondages (`polls`) |
|---|---|
| l'identité d'une personne (code du navigateur → identifiant par salle), le pseudo, la sourdine | les sondages, leurs choix, leurs dates |
| les limites (nouvelles personnes, votes par heure/connexion/sondage), la voix unique par sondage et par manche | **les votes** (bulletin : empreinte du code + choix) et les totaux |
| la page secrète de la télécommande et ses gros boutons | **les boutons de Sondages** (lancer, suivant, arrêter, A ou B ?) : décrits par le service `audience.remote` |
| le point de lecture du direct (révision, ralentissement, limites) | le contenu de l'écran et de la page « en cours » (publié à chaque changement) |
| le journal (« Sondages a décidé : manche 3, Hades ») | les décisions (historique de 500) |
Un propriétaire par donnée : **Participation ne sait jamais ce qu'on vote**, Sondages ne garde jamais le pseudo.

## Sans Participation, rien ne casse
Sondages 1.1 garde son mode autonome (code du navigateur → bulletin unique, limites locales en mémoire, écran OBS par sa propre route). La base est un **besoin facultatif** (`requires[].optional`) : le cœur ne l'installe pas d'office, l'onglet « En direct » propose de l'installer (`suggestInstall`) en disant ce que ça apporte. Si Participation est installée mais ne répond pas (panne, délai de 3 secondes), le vote passe tout de suite par le mode autonome. Le bulletin unique (clé = identifiant du sondage + code) est identique dans les deux modes : un bulletin posé sans Participation est reconnu quand elle arrive, et inversement.

## Les manches
- **Une série, une configuration** : question, 2 à 8 choix, durée (1 à 60 minutes, 10 par défaut). Par défaut : « Que fait-on maintenant ? / On continue / On change de jeu / On fait une pause », donc « Lancer » marche tout de suite.
- **Une manche est un sondage ordinaire** (même comptage, mêmes bulletins, même page de vote) qui se ferme à l'heure dite, caché des listes (il vit sur `/polls/now`). Au premier regard après sa fin, **la décision est prise** : le vainqueur est écrit dans l'historique (500 décisions, les plus anciennes s'effacent), les votes de la manche sont mis de côté puis **effacés** dès le passage de ménage suivant (pas 30 jours), et la manche suivante part. Elle part de l'heure de fin quand quelqu'un regardait (pas de dérive), de maintenant sinon (pas de manches fantômes à rattraper).
- **Égalité** : tirage au sort sûr (`crypto.randomInt`) parmi les premiers ex æquo ; la liste des ex æquo est gardée et **dite** à l'écran (« Égalité entre A et B : tirage au sort, A l'emporte »), sur la page publique, dans l'historique et dans le journal. Personne n'a voté : aucune décision, dit aussi.
- **Suivant** : décide tout de suite et lance la manche suivante. **Arrêter** : annule la manche en cours (aucune décision, ses votes sont effacés) et arrête la série.
- **Rien ne tourne en fond.** Les manches avancent quand l'écran OBS, la télécommande ou la page « en cours » regardent ; avec Participation, un lecteur qui arrive après l'heure fait demander à Sondages de se rafraîchir (service `tick`). Si personne ne regarde, rien ne se passe, et c'est dit dans le README.
- **Publiques** : `/polls/now` (le lien stable à partager : la manche ou le sondage du moment, compte à rebours calculé depuis ce qu'il reste au chargement donc juste même si l'horloge du téléphone est fausse, rechargement automatique avec délai aléatoire de 1 à 5 s à la fin de la manche, mise à jour des chiffres par le direct avec Participation) et `/polls/decisions` (50 par page).
- **À l'écran (OBS)** : « Manche N », compte à rebours (horloge corrigée par l'en-tête de date du site), barres en direct, puis la **décision** en grand pendant 20 secondes (réglage avancé, 5–120). Les couleurs et la place suivent les réglages existants.

## Le sondage rapide « A ou B ? »
Deux à quatre choix (A et B obligatoires, différents), durée 30 s / 1 / 2 / 5 minutes (15–900 s par l'assistant), question « A ou B ? » par défaut. C'est un sondage normal qui **passe tout de suite à l'écran**, devant la manche en cours, jusqu'à 45 secondes après sa fin, puis l'écran revient à ce qu'il montrait. Disponible dans l'onglet « En direct », dans la télécommande et pour l'assistant.

## Ce que voit et fait Emma
Onglet **En direct** : état (« Manche 3 en cours · fin à 21:10 · 42 votants »), lien à partager (copier), Lancer / Suivant / Arrêter (selon l'état ; arrêter demande de cocher « la manche en cours est annulée »), « Régler les manches » (erreurs sous chaque champ avec un exemple), « Sondage rapide », dernières décisions (tableau + téléchargement), puis l'adresse secrète OBS comme avant. Sur son téléphone : la télécommande de Participation (panneau « Sondages » : état avec compte à rebours, trois gros boutons, formulaire A ou B).

## Réglages ajoutés (avancés)
Secondes d'affichage de la décision (20, 5–120) ; durée habituelle d'un sondage rapide (60 s, 15–900). Aucun nouveau droit : `polls:manage` couvre les manches et le sondage rapide dans l'administration ; la télécommande se protège par son adresse secrète (voir `audience`).

## Données et vie privée (ajouts)
`rounds` (≤ 500 : numéro, question, totaux par choix, vainqueur, ex æquo, date, « minuterie » ou « suivant »), document `series` dans `meta` (configuration, série en cours, dernière décision), liste d'attente du ménage dans `cfg`. Les votes d'une manche sont effacés **dès la décision** (au passage de ménage suivant, 300 lignes au plus par passage). Avec Participation : une empreinte de code par salle (voir `audience.md`) ; l'écran lit un canal privé dont la clé est l'adresse secrète OBS (gardée hachée), la page publique un canal public qui **ne contient aucun chiffre** tant qu'un sondage « résultats après le vote » est ouvert. Régénérer l'adresse secrète invalide l'ancienne aussi chez Participation. `privacy` mis à jour.

## Bornes (ajouts)
500 décisions ; une série à la fois ; une manche de 1 à 60 minutes ; 2 à 4 choix pour un sondage rapide ; les sondages d'une manche comptent dans les 200 sondages complets (une seule manche existe à la fois, effacée dès la décision).

## Outils pour l'assistant (ajouts)
`rounds_status` et `rounds_history` (lecture), `round_control` (écriture : start / next / stop), `poll_quick` (écriture). Écritures jamais accordées d'office ; noms de 10 à 14 caractères.

## Ce qui n'est pas fait, et pourquoi
- **Plusieurs questions qui tournent** (une liste de questions préparées jouées dans l'ordre) : le formulaire serait bien plus lourd ; pour varier, « A ou B ? » et l'assistant (`poll_quick`) existent. Idée pour la suite.
- **Appliquer la décision ailleurs** (changer un titre, une scène OBS, une commande du bot) : Sondages affiche et journalise la décision ; ce qu'on en fait relève d'autres modules (une future action « quand le chat a décidé » via un sujet d'échange).
- **Pondérer / éliminer le dernier choix à chaque manche** (mode « survivant ») : idée pour la suite.
- **Mise à jour en continu de `/polls/now` sans Participation** : le compte à rebours recharge la page à la fin de la manche, mais les chiffres ne bougent qu'après un vote (pas d'interrogation sans la base commune, pour ne pas dupliquer le direct).
- **Pas de manche rattrapée** : si personne ne regarde pendant une heure, il n'y a pas six décisions fantômes, il y en a une.

## Tests (ajouts)
`tests/polls-rounds.test.mjs` (cycle d'une manche, dérive, égalités, lectures simultanées, suivant/arrêter, plafond de 500, réglages, sondage rapide, pages, administration, assistant, anciennes données), `tests/polls-audience.test.mjs` (voix unique, repli autonome, panne et trou noir, sourdine, limites, 120 votants en même temps, direct privé/public, adresse régénérée, écran, tick de bout en bout avec une horloge simulée, télécommande de bout en bout), plus les tests de la 1.0, conservés (ajustés pour le script désormais dynamique et la configuration séparée de la série).

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
4. Onglet « À l'écran » : adresse secrète à coller dans OBS, retour à l'affichage automatique, changement de l'adresse (confirmation).

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
`polls_list`, `poll_results` (lecture seule) ; `poll_create`, `poll_close` (écritures, désactivées par défaut). Pas de suppression ni d'archivage par l'assistant.

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

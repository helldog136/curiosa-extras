# Jeu du jour (`daily-game`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.6 (script de page et empreinte du visiteur), licence et auteur comme les autres modules. Type déclaré : `widget` (rangé sous « Ma communauté » à cause de ses outils pour l'assistant).

## Le problème
Donner aux visiteurs une raison de revenir chaque jour, avec une gamification légère : un quiz d'une question, une explication, « revenez demain ». Sans compte, sans cookie, sans classement par défaut.

## Pour qui
Une propriétaire non technique (écrire des questions, importer un tableur, voir « il reste N jours ») et tout site : aucun mot, nom ou région d'une association n'est dans le code (neutralité).

## Pourquoi du code (et pas le type « contenu » du cœur)
La question du jour dépend de la date (fuseau du site, calculé côté serveur), de l'historique (pas de répétition tant que la banque n'est pas épuisée) et du planning ; la bonne réponse ne doit jamais être dans la page ; il faut un import/export, des packs, un classement facultatif. Le type « contenu » ne fait rien de cela.

## Ce que voit le visiteur
- Page `/jeu-du-jour` : date, catégorie et difficulté, question, 2 à 4 réponses (cases natives, clavier), chronomètre facultatif (bonus, jamais une limite, décochable), « Valider ma réponse ». Après : verdict, explication, points, série, « Revenez demain », texte à copier ou à partager (« Quiz du jour — 3 jours de suite ! », sans la réponse).
- Série, meilleur score, meilleure série, parties jouées : stockage local du navigateur (`dg:<clé>`), « Effacer mes données de ce jeu » en un clic. Stockage bloqué : le jeu marche (mémoire de la page, avertissement).
- Bloc d'accueil « Le jeu du jour » : invitation ; un petit script (`card.js`, ≈ 1 Ko) y met « à jouer », « déjà joué » ou la série (réglage « état du jeu sur le bloc d'accueil », oui par défaut).
- Accessibilité : légende de groupe, étiquettes natives, focus sur le verdict, erreurs annoncées, vrai/faux jamais par la seule couleur (✔ ✘ + texte caché), contraste via les jetons du thème, cibles ≥ 44 px, animations sobres coupées avec `prefers-reduced-motion`, chronomètre sans animation en mouvement réduit.
- Sans JavaScript : la question est lisible, un message explique qu'il faut JavaScript pour répondre.

## Ce que fait la propriétaire, pas à pas
1. Installe : « Par où commencer ? » → gabarit **Culture jeu vidéo** (30 questions FR+EN publiées) ou **Vide**.
2. **Mes questions** : ajouter (énoncé, 2 à 4 réponses, bonne réponse, explication, image du site + description, catégorie, difficulté, date précise, brouillon/publiée). Erreurs sous le champ avec exemple. Aperçu (bonne réponse marquée), liste de 50 par page avec filtres (état, catégorie) et recherche, ordre ↑ ↓ « en premier » (mode « dans l'ordre »), « en faire la question d'aujourd'hui », « recommencer le tour ».
3. Le panneau dit la question du jour, **« Il reste N jours de questions »** (simulation exacte du programme), les 7 prochains jours, un avertissement sous 7 jours et une pastille de menu sous 3.
4. **Packs et fichiers** : activer/retirer un pack, importer un CSV (tout ou rien, erreurs par ligne), exporter, fichier d'exemple.
5. Réglages : ordre, fuseau, chronomètre, partage, classement, état du bloc d'accueil, « Mes mots ».

## Réglages et valeurs par défaut
Ordre « dans l'ordre » · fuseau Europe/Paris (liste de villes neutres) · chronomètre proposé et coché · partage oui · classement non · état sur l'accueil oui · mots vides (textes neutres FR/EN). Avancé : secondes du bonus (15), réponses par visiteur et par heure (40), type de jeu (quiz).

## Choix de la question du jour (`plan.mjs`, fonctions pures)
1. Une question publiée planifiée à la date passe avant tout (hors rotation).
2. Sinon un « sac » : les questions publiées non planifiées ; dans l'ordre (la première du sac) ou au hasard (tirage déterministe selon une graine et la date). Les questions déjà passées pendant le tour sont retenues dans l'historique : en ajouter ou en retirer ne fait jamais repasser une question avant la fin du tour.
3. Le choix d'un jour est figé à la première visite (document `dg_plan`, 400 jours). Même question pour tout le monde, sans minuteur.

## Vocabulaire réglable, gabarits, instances
Nom du jeu, introduction, texte du bouton, phrase de série (`{n}`), message « revenez demain » : réglages traduisibles, vides = mots neutres. Gabarits « Culture jeu vidéo » et « Vide » ; deux packs (jeu vidéo, streaming), 30 questions chacun, écrites pour le module, sans marque. Plusieurs instances : un quiz par thème (page, banque, ordre, mots, série et salle de classement séparés).

## Types de jeu extensibles
`games.mjs` : table de types (`registerGameType`) avec un contrat écrit en tête du fichier (formulaire, lecture/écriture CSV, rendu sans solution, jugement, aperçu, assistant). Le quiz est le premier. Ajouter « devinette d'image » ou « mot du jour » : un objet de type, une option du réglage `gameType`, les textes, l'entrée du type dans `TYPES` de `client.mjs`, puis `scripts/daily-game.js` régénéré. Prouvé par un test avec un second jeu (mot à deviner) sur page, réponse, planning, import/export, administration et assistant. Limite honnête : la partie navigateur d'un type est à écrire.

## Anti-triche raisonnable
La bonne réponse n'est jamais dans la page (testé) ; la route `answer` juge côté serveur, limite par visiteur (empreinte du cœur) et globale, piège à robots, corps borné, jour et question vérifiés. Une participation par navigateur et par jour : dans le navigateur, et, pour le classement, par une voix unique (`claim`) de Participation. Contournable (vider le navigateur) : pas d'enjeu, aucune promesse.

## Classement de la semaine (facultatif)
Service `audience.session` (Participation), facultatif : pseudo (règles et mots interdits de Participation), voix du jour, limites. Score recalculé par le site, jamais cru ; `dg_board` : un document par semaine ISO, 100 lignes, 4 semaines gardées (retrait au fil de l'eau) ; « Quitter le classement » / « Effacer mes données » : lignes retirées et participant oublié. Aucune adresse : seule l'empreinte salée du cœur est passée à Participation. Sans Participation : rien n'est affiché, l'administration propose de l'installer. Détail honnête : Participation n'a ni classement ni liste de pseudos, d'où une collection propre au jeu (une donnée, un propriétaire).

## Données et vie privée
`dg_questions`, `dg_plan` (un document), `dg_board`. Réponses des visiteurs : jamais enregistrées. Pas de cookie. Déclaration `privacy` dans `module.json`.

## Bornes
2 000 questions · 365 jours planifiés · 300 caractères (question, explication), 120 (réponse), 150 (description d'image), 40 (catégorie) · 4 réponses · 100 lignes de classement · 4 semaines · CSV 1 Mo · 50 lignes par page · 50 brouillons de l'assistant · banque en mémoire 1 minute.

## Intégrations
`audience.session` (facultatif).

**Sujet `mascot.hint` (fourni).** Le manifeste déclare `provides: [{ "topic": "mascot.hint" }]` (permission `topics`) et `index.mjs` définit `exports["mascot.hint"]`. Le module Mascotte (branche `ideas/assoc-mascot`) collecte ce sujet (`{ id, text, url? }`, 10 au plus, texte 140 caractères au plus) ; sans lui, personne n'appelle l'export et rien ne change. Aucun minuteur : la mascotte lit, et le jour change tout seul. Le message est `{ id: "daily-game:<clé de l'instance>:<jour>", text, url }` : l'identifiant contient la date du site, donc une invitation par jour et par instance, toujours la même dans la journée (idempotent), et la mascotte ne la répète pas. Il n'y a rien à annoncer (liste vide) s'il n'existe aucune question jouable aujourd'hui, ou si « Laisser la mascotte inviter à jouer » est décoché. Le texte est le réglage « Message de la mascotte » (traduisible, 140 caractères) ou, vide, « Le jeu du jour t'attend ! » / « Today's game is waiting for you! ». Jamais la question, la réponse ni l'explication. `url` est la page du jeu, avec la langue. **Limite honnête :** l'état « déjà joué » ne vit que dans le navigateur du visiteur (aucun compte, aucune réponse gardée), donc le serveur ne peut pas savoir qui a déjà joué : l'invitation est la même pour tous et la mascotte ne la tait pas pour ceux qui ont joué. Le module ne publie toujours aucun service. Idée : publier un service `game.daily` pour que d'autres modules affichent l'état du jeu.

## Outils pour l'assistant IA
`daily_questions_list` (lecture ; réponses seulement avec `full`) et `daily_question_add` (écrit un **brouillon**, jamais accordé d'office, 50 brouillons au plus, refus clairs).

## Ce qui n'est pas fait
Jeux d'image et mot du jour (la table est prête) ; statistiques de réponses ; classement mensuel ; pas de service offert ; texte du bouton et phrase de série seuls réglables parmi les phrases du résultat.

## Vérification
Tests unitaires (plan, page, routes, administration, packs, types, mise à jour à chaud) et parcours navigateur : voir le rapport de livraison.

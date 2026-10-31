# Participation (`audience`) — description complète

## Le problème
Les animations de stream (sondages, quiz, bingo, tombola, mur de questions…) ont toutes besoin des mêmes briques : reconnaître une personne sans compte, lui laisser choisir un pseudo, ne compter qu'une voix par personne, freiner les abus sans garder d'adresse IP, donner à la streameuse de GROS boutons sur son téléphone, mettre l'écran à jour sans surcharger le site, garder une trace de qui a décidé quoi, et tout purger. Si chaque module réinventait cela, on aurait dix identités, dix listes de mots interdits, dix pages de commande. Participation possède ces briques UNE fois ; les modules d'animation l'appellent.

## Pour qui
Emma (créatrice non technique, téléphone d'abord) : elle ne « configure » rien, elle ne sait même pas que ce module existe — il s'installe tout seul avec l'animation qui en profite, elle ouvre la télécommande sur son téléphone, et elle modère en deux touches. Ses spectateurs : sans compte, sur téléphone, ils choisissent éventuellement un pseudo et peuvent tout effacer d'un bouton.

## Type de module et justification
Module à code, type « widget », instance unique, avec une page publique (`/participation`). Pas de « contenu zéro code » : il faut un service entre modules, des routes publiques protégées et une page de commande. **Fournisseur de service** : `audience.session` (version 1) ; **consommateur facultatif** de `audience.remote` (les modules qui ont des boutons à montrer). Un module d'animation l'exige en `requires[].optional` : il fonctionne seul sans lui (mode autonome), et le cœur propose de l'installer (`suggestInstall`) ; un module qui ne peut pas fonctionner sans lui le déclare en dur et le cœur l'installe avec son instance.

## Décisions de conception (et pourquoi)
- **Un propriétaire par donnée.** Participation possède l'identité (le code du navigateur → un identifiant par salle), le pseudo, la sourdine, les limites, les « voix uniques », le journal et les points de direct. Les **votes restent chez Sondages** : Participation ne sait pas ce qu'on vote, seulement « cette personne a voté dans cette salle pour cette clé ».
- **Une salle par animation** (`polls:<instance>`), plus une « salle générale » pour le pseudo de la page `/participation`. L'identifiant d'une personne se calcule avec le **sel de la salle** : deux salles ne peuvent pas être reliées, et vider une salle change le sel (plus personne n'y est reconnu, sans rien parcourir).
- **L'adresse de connexion ne sort jamais de la fonction qui la brouille.** Le consommateur passe les en-têtes bruts (`conn`), Participation les transforme en empreinte HMAC avec un sel du jour tenu en mémoire et n'en garde que 16 caractères, en mémoire, bornés (5 000 compteurs).
- **Le direct est un point de lecture, pas un canal ouvert.** Un module publie l'état de son écran (≤ 16 Ko) ; tout le monde lit au même endroit, avec une révision (« inchangé » = une réponse minuscule), un conseil d'espacement qui grandit avec l'affluence, une pause quand la page est cachée, une limite par connexion. Un canal privé n'existe que pour qui a la clé (gardée hachée).
- **Pas de minuteur.** Une manche de sondage finit à une heure connue : l'état publié porte `refreshAt` ; le premier lecteur après cette heure fait demander à Sondages de se rafraîchir (une seule demande partagée pour des centaines de lecteurs), puis relit. Tout le ménage se fait à la lecture, par tranches (400 personnes, 300 lignes à effacer au plus par passage, une fois toutes les 10 minutes).
- **La télécommande est une page secrète, pas une page d'administration.** Sur un téléphone on n'ouvre pas l'administration d'un site pendant un live : une adresse secrète (régénérable) suffit, comme l'adresse OBS. Les boutons viennent des modules (service `audience.remote`) : Participation ne connaît aucun module par son nom.
- **Le dock OBS (1.1.0) est la même télécommande, pas une seconde.** Même clé secrète, même script, mêmes routes d'état et d'appui : l'adresse du téléphone avec `&dock=1` ne change que la mise en page (300 px, sombre, boutons de 40 px, souris et clavier). Un second secret aurait doublé ce qu'il faut protéger, régénérer et expliquer ; « Créer une nouvelle adresse » invalide ainsi les deux d'un coup.
- **Pseudos : refuser, jamais tronquer.** La personne choisit ; si c'est trop long ou interdit on le dit, sous le champ, avec un exemple.

## Ce que voit le visiteur
- `/participation` : « Choisir mon pseudo » (aide « de 3 à 20 caractères : lettres, chiffres, espaces, tirets. Exemple : Lune-Rousse. »), erreur sous le champ avec la marche à suivre (pris, interdit, trop court…), pseudo actuel affiché, et un bouton « Effacer mes données » (vide le code du navigateur, retire la personne de toutes les salles). Sans JavaScript, un message l'explique.
- Dans une animation : rien de plus qu'avant. Un vote refusé parce qu'on est en sourdine dit « Vous ne pouvez pas voter pour le moment » (neutre).

## Ce que fait Emma, pas à pas
1. Elle installe Sondages (ou active-le) : Participation arrive avec lui, sans question.
2. Onglet **En direct** de Participation : elle flashe le code avec son téléphone (ou copie l'adresse) et met la page en favori. Elle voit la liste de ce qui se pilote (Sondages…) ou, s'il n'y en a pas, une invitation à en installer un.
3. Pendant un live, sur le téléphone : **Lancer / Suivant / Arrêter** (gros boutons, 76 px, confirmation « touchez encore » pour ce qui annule), le formulaire **A ou B ?**, la section **Les salles** : dernières personnes arrivées avec **Sourdine / Rétablir** (44 px), et **Vider la salle** (confirmation).
4. Onglet **Salles et pseudos** : les salles, les personnes par pages de 50 (sourdine, retrait), le journal, le téléchargement du journal (tableur), et la liste des **mots interdits** en bas de l'onglet.
5. Si quelqu'un a vu l'adresse secrète : « Créer une nouvelle adresse » (case à cocher claire).

## Réglages et valeurs par défaut
Visible : **mots interdits dans les pseudos** (liste de départ sobre, FR + EN, d'une cinquantaine de mots : noms qui se font passer pour l'équipe, insultes courantes, haine, liens ; « mot » = ce mot seul, « mot* » = commence par, « *mot* » = contient ; testée contre une trentaine de prénoms courants et des faux positifs célèbres). Avancé : longueur minimale (3, 2–10) et maximale (20, 8–30) d'un pseudo ; jours de conservation (14, 1–90) ; nouvelles personnes par heure et par connexion (200, 5–5 000) ; secondes minimales entre deux mises à jour en direct (3, 2–30). Droits : `audience:remote.use` (voir/changer l'adresse secrète — sensible) et `audience:moderate` (sourdine, retrait, vider une salle, journal ; `mute` et `clearRoom` sont aussi appelables par un autre module depuis une de ses actions d'administration, `asCaller`).

## Données gardées et vie privée
- **Le code du navigateur n'est jamais gardé.** Pour chaque salle : un document par personne avec `identifiant (empreinte SHA-256 salée par la salle), pseudo, pseudo plié (pour l'unicité), sourdine, date d'arrivée, dernière visite` ; un document « nom » par pseudo (index d'unicité) ; un document par voix (`identifiant, clé, date`).
- **Aucune adresse IP** (ni en clair, ni dans le journal, ni dans une erreur) ; les limites vivent en mémoire avec un sel qui change chaque jour (et au redémarrage).
- Aucun cookie, aucune requête avec cookie (`credentials: omit`). Un seul stockage local du navigateur (`aud-id`, qui reprend `vp-id` des sondages d'avant : on ne revote pas).
- **Conservation** : personnes inactives effacées après 14 jours (réglable), salles abandonnées retirées (sauf la générale), journal 30 jours, canaux de direct 6 heures (jusqu'à 24 h). **Droit à l'oubli** : le bouton de la page publique, `forget` pour les modules. Déclaré dans `privacy` (repris par la politique de confidentialité du site).
- **Le journal ne contient jamais** l'adresse secrète, un code, une adresse IP ou le contenu d'un vote : « qui (remote, admin, assistant, sondages) a fait quoi, dans quelle salle, quand ».
- **Sauvegarde lisible** : salles (compte) et journal, en tableur ; jamais de pseudo ni de code.

## Bornes et limites (écrites aussi dans l'admin)
200 salles ; 5 000 personnes et 20 000 voix par salle (au plus 500 voix par personne) ; 100 points de direct de 16 Ko ; 500 mots interdits de 40 caractères ; 500 lignes de journal ; 30 modifications de pseudo par heure et par connexion (page publique) et 8 par heure et par personne ; 90 lectures du direct par minute et par connexion ; 40 essais d'adresse secrète ratés par heure et par connexion (réponse 404, puis 429) ; 60 appuis de télécommande par minute ; 8 modules branchés au plus ; 12 pseudos et 4 salles montrés sur la télécommande ; 50 par page dans l'administration. Pas d'espace mémoire non borné : la table des limites ne dépasse pas 5 000 entrées.
**Honnêteté** : « une personne » = un navigateur (vider les données = nouvelle personne) ; les limites arrêtent les curieux et les scripts simples, pas une personne déterminée qui change de connexion ; des lettres d'un autre alphabet qui imitent les nôtres ne sont pas détectées par la liste de mots interdits ; derrière un relais qui ne transmet pas l'adresse réelle tout le monde partage une empreinte.

## Outils pour l'assistant IA
`audience_rooms` (lecture), `audience_journal` (lecture, 1–100 lignes), `audience_mute` (écriture, jamais accordée d'office : sourdine par pseudo), `audience_clear_room` (destructif, jamais accordé d'office). Noms de 13 à 19 caractères (limite 31). Rien ne donne accès à l'adresse secrète de la télécommande.

## Intégrations
- **Sondages 1.1** (`polls`) : voir `docs/ideas/polls.md`. Premier consommateur et premier fournisseur de boutons.
- Prévu pour Quiz, Bingo, Tombola, Mur de questions, Présence, Prédictions (`docs/ideas/FAMILLE-STREAM.md`) : ils appellent `audience.session` et offrent `audience.remote`. Le contrat est exécutable : `tests/contract-ext/audience.md`, `audience.contract.mjs` (16 vérifications, rejouées contre le double et contre le vrai module, dont 100 participants en même temps), double `tests/helpers/fakeAudience.mjs`.
- **Tirage au sort** (1.2.0) : service `audience.draw` v1 (`status`, `enter`), consommé par le Bot Twitch ; page `/participation/tirage`, panneau de télécommande (`draw-open`, `draw-close`, `draw-pick`), écran en direct (canal `screen` de la salle `draw`, secret `drawKey`) et élément d'overlay `draw`. Les personnes (identité, pseudo, sourdine) restent dans la salle `draw` ; le tirage possède ses réglages, ses inscriptions (`de-<id>-<n>`, effacées 24 h après la fermeture) et ses gagnants (historique de 20).
- Contacts : volontairement non lié (voir « idées »). Pas de `privacy.subject` offert : Participation ne garde aucun identifiant de contact ; ses données sont effacées par la personne (bouton), par le ménage (14 jours) ou par Emma.

## Ce qui n'est pas fait, et pourquoi
- **Lien avec une fiche Contacts « seulement si la personne le demande »** : il faudrait une page de consentement, un jeton de rattachement et `privacy.subject` ; sans consommateur qui en a besoin aujourd'hui, on ne stocke rien de plus (principe de minimisation). Idée pour la suite : un bouton « Relier à mon profil » côté Contacts.
- **Pas de pseudo dans Sondages** : un vote n'a pas besoin de nom ; le pseudo servira au quiz, à la tombola et au mur de questions.
- **Pas d'historique de présence**, pas de classement, pas de messagerie, pas de e-mail.
- **Pas de push en continu (SSE)** : l'interrogation douce suffit pour un stream et garde le cœur sans état ; un push pourra remplacer `AudienceDirect` sans changer le contrat.
- **Des alphabets qui imitent le nôtre** (homoglyphes) : non détectés ; la sourdine et le retrait restent à portée d'un doigt.
- **Pas de réglage par salle** (mots interdits, limites) : un seul réglage pour tout le site, pour rester compréhensible.

## Idées pour la suite
Salle « de la semaine » avec un classement sans pression (top 5) ; relier un pseudo à une fiche Contacts à la demande de la personne ; envoi d'un message « bienvenue » à l'arrivée d'une nouvelle personne dans la salle générale (avec la bibliothèque d'alertes) ; mode « invités seulement » (une liste de pseudos autorisés) pour un stream privé ; export du palmarès mensuel.

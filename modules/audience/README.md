# Participation

La base commune des animations de votre stream : **un pseudo par personne sans compte, une seule voix par personne, des limites contre les abus, une télécommande à gros boutons pour votre téléphone, et une mise à jour en direct pour l'écran**. Vous n'avez rien à comprendre ni à régler : ce module **s'installe tout seul** quand vous ajoutez un module d'animation qui en profite (Sondages aujourd'hui ; le quiz, le bingo ou la tombola demain).

## À quoi ça sert
- **Un pseudo, sans compte** : la personne choisit le nom que les autres voient (ou n'en choisit pas : il n'est jamais obligatoire pour voter). Un pseudo est **unique dans une salle**, sans tenir compte des accents ni des majuscules (« Éloïse » et « eloise » sont le même pseudo), de 3 à 20 caractères, avec des lettres, des chiffres, des espaces et des tirets. Une **liste de mots interdits** (modifiable) refuse les insultes et les noms qui se font passer pour l'équipe.
- **Une voix par personne et par salle** : une salle est l'espace d'une animation. Rejouer le même vote est refusé poliment.
- **Des limites contre les abus** : nombre de nouvelles personnes et de votes par heure et par connexion, sans jamais garder l'adresse de la personne.
- **La télécommande** : une page secrète pour votre téléphone, avec de GROS boutons : lancer, arrêter, passer au suivant, « A ou B ? » en un geste, mettre une personne en sourdine, vider une salle. Les modules d'animation y ajoutent eux-mêmes leurs boutons.
- **Le direct** : l'écran de votre stream (OBS) et les pages publiques se mettent à jour tout seuls, sans surcharger le site : la mise à jour est douce, ralentit quand rien ne change, s'arrête quand la page est cachée et demande plus d'espace quand il y a beaucoup de monde.
- **Le journal** : qui a décidé quoi et quand (appuis sur la télécommande, sourdines, salles vidées, choix gagnants des manches). Il se vide tout seul après 30 jours.

## Comment l'utiliser
1. **Rien à faire** pour que ça marche : installez Sondages (ou un autre module d'animation) et Participation arrive avec lui.
2. **La télécommande** : onglet **En direct** → ouvrez l'adresse sur votre téléphone (ou flashez le code). Mettez-la en favori. Elle est **secrète** : toute personne qui la connaît peut utiliser les boutons ; « Créer une nouvelle adresse » rend l'ancienne inutile.
3. **La modération** : onglet **Salles et pseudos** → vous voyez les salles, les personnes (pseudo, sourdine), le journal, et vous réglez les mots interdits en bas de l'onglet. Pendant un live, c'est plus simple depuis la télécommande : « Sourdine » à côté d'un pseudo, « Vider la salle » en bas.
4. **Pour votre public** : la page **Participation** (`/participation`) leur permet de choisir leur pseudo et d'**effacer leurs données** d'un bouton.

## Réglages
Tout marche sans rien régler. Visible tout de suite : la **liste des mots interdits** (une liste de départ sobre, en français et en anglais, que vous pouvez modifier ; « mot » bloque ce mot, « mot* » tout ce qui commence ainsi, « *mot* » tout ce qui le contient). En mode avancé : longueur minimale et maximale d'un pseudo, jours de conservation (14 par défaut), nouvelles personnes par heure et par connexion (200), secondes minimales entre deux mises à jour en direct (3).

## Vie privée : ce qui est gardé
- Aucun compte, aucun cookie. Le navigateur de la personne garde un **code privé au hasard** (dans son stockage local). Le site n'en garde qu'une **version brouillée, différente dans chaque salle** (deux salles ne peuvent pas être reliées), le pseudo choisi (facultatif), un « en sourdine » éventuel et la date de la dernière visite.
- **L'adresse de connexion n'est jamais enregistrée ni journalisée.** Elle sert seulement, brouillée avec un sel qui change chaque jour et n'est jamais écrit sur le disque, à freiner les abus.
- Les personnes inactives sont **effacées au bout de 14 jours** (réglable de 1 à 90), les salles abandonnées aussi, le journal après 30 jours. Aucun minuteur : le ménage se fait quand une personne regarde, par petites tranches.
- Chaque personne peut **tout effacer d'un bouton** (page Participation). Vous pouvez retirer une personne, ou vider une salle.

## Ce que Participation ne garantit pas (honnêtement)
- « Une personne » veut dire « un navigateur ». Qui vide ses données, change de navigateur ou utilise la navigation privée est une nouvelle personne. C'est le prix de la simplicité et de la vie privée.
- Les protections arrêtent les curieux et les scripts simples, **pas une personne déterminée** qui change de connexion. Pour un enjeu important (tirage au sort, concours), ne vous fiez pas à ces seules protections.
- Les pseudos qui imitent d'autres lettres (des lettres d'un autre alphabet qui ressemblent aux nôtres) ne sont pas détectés. La liste de mots interdits aide, elle ne remplace pas votre vigilance : vous pouvez toujours mettre une personne en sourdine.
- Le sel du jour est en mémoire : si le site redémarre, il change (c'est voulu). Derrière un relais qui ne transmet pas l'adresse réelle, tout le public aurait la même empreinte et partageraient la même limite.

## Bornes
200 salles ; 5 000 personnes et 20 000 voix par salle ; 100 points de direct (16 Ko chacun) ; 500 mots interdits ; 500 lignes de journal ; 50 personnes par page dans l'administration ; 8 modules branchés sur la télécommande au plus, 4 salles montrées dessus. Rien ne tourne en arrière-plan.

## Ce que le module ne fait pas
Pas de compte ni de mot de passe, pas de lien avec une fiche Contacts (idée pour la suite : seulement si la personne le demande), pas de messagerie ni de chat, pas d'envoi d'e-mail, pas de classement.

## Pour les développeurs
Service `audience.session` version 1 (méthodes : `info`, `join`, `who`, `setPseudo`, `checkPseudo`, `claim`, `release`, `limit`, `mute`, `clearRoom`, `forget`, `journal`, `livePublish`, `liveRead`, `liveDrop`, `directClient` ; ne lève jamais, répond `{ ok, … }`) ; `mute` et `clearRoom` demandent le droit `moderate` (appel avec `{ asCaller: true }`). Un module d'animation l'exige en **facultatif** (`requires[].optional`) et garde un mode autonome. Les modules qui ont des boutons à montrer offrent `audience.remote` (`describe`, `press`, `tick`). Contrat exécutable : `tests/contract-ext/audience.md`, suite `audience.contract.mjs`, double `tests/helpers/fakeAudience.mjs`. Droits : `audience:remote.use`, `audience:moderate`. Outils pour l'assistant : `audience_rooms`, `audience_journal`, `audience_mute`, `audience_clear_room` (jamais accordés d'office pour les écritures). Détails : `docs/ideas/audience.md`.

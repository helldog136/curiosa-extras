# Statut du live

Affiche une bannière « en direct » et votre lecteur sur l'accueil quand vous êtes en direct **sur Twitch, sur YouTube ou sur les deux**. (Le module s'appelait « Statut live Twitch » : son identifiant `live-status`, ses réglages et son instance n'ont pas changé.)

**Ce module présente, il n'interroge pas Twitch.** Il demande à **Ma Chaîne Twitch** (module `twitch-channel`, service `twitch.live`) si vous êtes en direct ; elle-même passe par le **Connecteur Twitch**. L'application Twitch (client id et secret) se règle **une seule fois, dans le Connecteur Twitch**, et la chaîne dans Ma Chaîne Twitch ; une seule authentification et un seul appel à Twitch servent la bannière, le lecteur et les autres modules. Ma Chaîne Twitch doit être installée et active.

Le lecteur Twitch affiche, hors ligne, un grand panneau blanc « hors ligne ». Dès que le site est relié à Twitch, le lecteur n'apparaît donc **qu'en direct** (réglage « Quand afficher le lecteur » : « Seulement en direct » par défaut, ou « Toujours »). **Sans application Twitch** (dans le Connecteur Twitch) ou sans chaîne (dans Ma Chaîne Twitch), on ne peut pas savoir si vous êtes en direct : le lecteur n'est **pas affiché** (plus de panneau blanc « hors ligne »), sauf si vous choisissez « Toujours ». L'admin de ce module le dit et renvoie vers la bonne page. Si Twitch ne répond pas, ni bannière ni lecteur.

## YouTube (version 1.4.0)

Installez **Chaîne YouTube** (module `youtube-channel`, 1.4.0 ou plus, avec la clé du Connecteur YouTube) : Statut du live l'utilise tout seul, sans réglage. Les deux sources, Twitch et YouTube, sont **facultatives** : une seule suffit. Sans aucune des deux, l'administration le dit (« Installez Ma Chaîne Twitch ou Chaîne YouTube ») et propose de les installer.

- **Bannière** : YouTube seul en direct → « En direct sur YouTube » avec le lien de la vidéo. Plusieurs plateformes en direct → une ligne par plateforme (Twitch, YouTube) avec son titre et son bouton « Regarder ».
- **Lecteur** : un seul lecteur à la fois. Si Twitch et YouTube sont en direct ensemble, le réglage **En direct sur les deux : quel lecteur ?** choisit (Twitch par défaut, comme avant) ; l'autre plateforme reste un lien dans la bannière. Si une seule est en direct, c'est son lecteur.
- **Vie privée** : le lecteur YouTube (adresse `youtube-nocookie.com`) n'est chargé **qu'après le clic** de la personne qui visite sur « Lancer le lecteur YouTube » (réglage **Lecteur YouTube** : « Après un clic », par défaut). « Dès l'ouverture de la page » le charge tout de suite, comme le lecteur Twitch. Tant que la personne qui visite n'a pas cliqué, il n'y a ni image, ni script, ni cadre qui contacte YouTube : le cadre du lecteur est rangé, fermé, dans un bloc repliable.
- **Quota** : chaque vérification coûte **2 unités** de la limite du jour de YouTube (10 000 sur une clé gratuite). Chaîne YouTube garde sa réponse 45 secondes ; Statut du live la garde **3 minutes en direct, 5 minutes hors direct, 2 minutes après une erreur**, quel que soit le nombre de personnes (au plus 960 unités par jour, moins de 10 %). Rien ne tourne en arrière-plan : sans visiteur, aucune vérification. Une personne n'attend jamais plus de 2,5 secondes. Conséquence : un direct YouTube peut apparaître jusqu'à 5 minutes après son début, et disparaître jusqu'à 3 minutes après sa fin.
- **YouTube en panne, clé manquante, limite du jour atteinte** : ni bannière ni lecteur YouTube pour le public ; l'administration dit quoi faire en une phrase, avec le lien du bon réglage. Twitch continue normalement.
- **Un site Twitch seul ne change pas** : sans Chaîne YouTube, aucun appel de plus et exactement le même affichage qu'avant (bannière, lecteur, réglages, instance).
- Pour les développeurs : service facultatif `youtube.live` (méthode `current`, via `callAll`, jamais `fresh`) ; `youtube.mjs` (mémoire des réponses, question partagée, délai de 2,5 s), `view.mjs` (bannière à plusieurs plateformes, lecteur « au clic »). Les deux besoins (`twitch.live`, `youtube.live`) sont `optional`. La plateforme déclarée reste `twitch` (simple regroupement à l'écran).

## Si vous aviez déjà réglé ce module (reprise automatique)

Rien à faire : à la mise à jour (Curiosa 0.2.0), les identifiants Twitch que ce module gardait (chaîne, client id, client secret) sont **repris tout seuls** (la chaîne par Ma Chaîne Twitch, l'application par le Connecteur Twitch), puis effacés d'ici. Ils n'ont plus de champ dans les réglages et ne sont jamais affichés.

- **La copie** ne remplit que les champs **vides** de la Chaîne Twitch (une valeur déjà présente n'est jamais écrasée), sans jamais afficher ni journaliser une valeur. Un champ n'est effacé d'ici qu'une fois **confirmé** dans la Chaîne Twitch ; ce qui n'y est pas encore reste ici, inutilisé.
- **Si la Chaîne Twitch ne répond pas** au moment de la mise à jour, rien n'est effacé et une tâche réessaie chaque heure jusqu'à ce que ce soit fait. Entre-temps, le lecteur n'est pas affiché (sans identifiants Twitch, on ne peut pas savoir si vous êtes en direct).
- **Instance déjà reprise avant** (l'ancien bouton avait été utilisé) : même affichage qu'avant ; les anciennes valeurs, devenues inutiles, sont simplement effacées.
- **Pourquoi par le service** : un module n'a pas le droit d'écrire dans les réglages d'un autre. La copie passe par la méthode `adopt` du service `twitch.live`, qui range les valeurs reprises dans le stockage de la Chaîne Twitch ; ses réglages saisis ont toujours le dessus, champ par champ.
- Avec plusieurs Chaînes Twitch, la chaîne reprise va dans la **première** (par ordre de création), seulement si elle n'en a pas ; l'application va au Connecteur Twitch, qui sert toutes les chaînes du site (il ne remplace jamais une application déjà réglée).
- Pour les développeurs : `legacySettings` (`channel`, `clientId`, `clientSecret`), `dataVersion` 2, `migrations[2]` et tâche `adopt` appellent `adoptLegacy` (`adopt.mjs`) ; elle lit par `ctx.legacy.get` et n'efface par `ctx.legacy.clear` qu'après confirmation. Demande Curiosa 0.2.0.

## Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus)

Une Chaîne Twitch par chaîne : Statut live les interroge **toutes** (`callAll("twitch.live", "status")`) et ne parle toujours pas à Twitch.

- **Une seule en direct** : exactement l'affichage d'avant (bannière d'une ligne, lecteur de cette chaîne).
- **Plusieurs en direct** : la bannière a **une ligne par chaîne** (nom, titre, jeu, spectateurs, bouton « Regarder ») ; le lecteur montre la **première** chaîne en direct (ordre de création des instances) avec une **pastille par chaîne** pour passer de l'une à l'autre (boutons radio en HTML/CSS, sans script, accessibles au clavier).
- **Aucune en direct** : rien. Avec « Toujours », le lecteur de la première chaîne.
- Réglage facultatif **Chaînes à annoncer** : identifiants séparés par des virgules ; vide = toutes.
- **Vieux cœur** (sans `callAll`) : repli sur l'appel unique d'avant (première chaîne seulement). Le module exige pourtant Curiosa 0.1.14 à l'installation.

Module de base de Curiosa (Curiosa License 1.0). Il s'active depuis l'admin, dans **Fonctionnalités**; ses réglages sont sur sa page.

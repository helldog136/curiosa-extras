# Statut live Twitch

Affiche votre lecteur Twitch sur l'accueil et une bannière quand vous êtes en direct.

**Ce module présente, il n'interroge pas Twitch.** Il demande à la **Chaîne Twitch** (module `twitch-channel`, service `twitch.live`) si vous êtes en direct. Le client id, le secret et la chaîne se saisissent donc **une seule fois, dans la Chaîne Twitch** ; une seule authentification et un seul appel à Twitch servent la bannière, le lecteur et les autres modules. La Chaîne Twitch doit être installée et active (il faut installer les deux ensemble, ou mettre à jour les deux ensemble).

Le lecteur Twitch affiche, hors ligne, un grand panneau blanc « hors ligne ». Dès que la Chaîne Twitch a ses identifiants, le lecteur n'apparaît donc **qu'en direct** (réglage « Quand afficher le lecteur » : « Seulement en direct » par défaut, ou « Toujours »). **Sans identifiants Twitch** (dans la Chaîne Twitch), on ne peut pas savoir si vous êtes en direct : le lecteur n'est **pas affiché** (plus de panneau blanc « hors ligne »), sauf si vous choisissez « Toujours ». L'admin de ce module le dit et renvoie vers la Chaîne Twitch. Si Twitch ne répond pas, ni bannière ni lecteur.

## Si vous aviez déjà réglé ce module (reprise automatique)

Rien à faire : à la mise à jour (Curiosa 0.2.0), les identifiants Twitch que ce module gardait (chaîne, client id, client secret) sont **repris tout seuls dans la Chaîne Twitch**, puis effacés d'ici. Ils n'ont plus de champ dans les réglages et ne sont jamais affichés.

- **La copie** ne remplit que les champs **vides** de la Chaîne Twitch (une valeur déjà présente n'est jamais écrasée), sans jamais afficher ni journaliser une valeur. Un champ n'est effacé d'ici qu'une fois **confirmé** dans la Chaîne Twitch ; ce qui n'y est pas encore reste ici, inutilisé.
- **Si la Chaîne Twitch ne répond pas** au moment de la mise à jour, rien n'est effacé et une tâche réessaie chaque heure jusqu'à ce que ce soit fait. Entre-temps, le lecteur n'est pas affiché (sans identifiants Twitch, on ne peut pas savoir si vous êtes en direct).
- **Instance déjà reprise avant** (l'ancien bouton avait été utilisé) : même affichage qu'avant ; les anciennes valeurs, devenues inutiles, sont simplement effacées.
- **Pourquoi par le service** : un module n'a pas le droit d'écrire dans les réglages d'un autre. La copie passe par la méthode `adopt` du service `twitch.live`, qui range les valeurs reprises dans le stockage de la Chaîne Twitch ; ses réglages saisis ont toujours le dessus, champ par champ.
- Avec plusieurs Chaînes Twitch, la reprise va dans la **première** (par ordre de création), uniquement dans ses champs vides ; voir le README de la Chaîne Twitch pour partager les identifiants entre chaînes.
- Pour les développeurs : `legacySettings` (`channel`, `clientId`, `clientSecret`), `dataVersion` 2, `migrations[2]` et tâche `adopt` appellent `adoptLegacy` (`adopt.mjs`) ; elle lit par `ctx.legacy.get` et n'efface par `ctx.legacy.clear` qu'après confirmation. Demande Curiosa 0.2.0.

## Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus)

Une Chaîne Twitch par chaîne : Statut live les interroge **toutes** (`callAll("twitch.live", "status")`) et ne parle toujours pas à Twitch.

- **Une seule en direct** : exactement l'affichage d'avant (bannière d'une ligne, lecteur de cette chaîne).
- **Plusieurs en direct** : la bannière a **une ligne par chaîne** (nom, titre, jeu, spectateurs, bouton « Regarder ») ; le lecteur montre la **première** chaîne en direct (ordre de création des instances) avec une **pastille par chaîne** pour passer de l'une à l'autre (boutons radio en HTML/CSS, sans script, accessibles au clavier).
- **Aucune en direct** : rien. Avec « Toujours », le lecteur de la première chaîne.
- Réglage facultatif **Chaînes à annoncer** : identifiants séparés par des virgules ; vide = toutes.
- **Vieux cœur** (sans `callAll`) : repli sur l'appel unique d'avant (première chaîne seulement). Le module exige pourtant Curiosa 0.1.14 à l'installation.

Module de base de Curiosa (Curiosa License 1.0). Il s'active depuis l'admin, dans **Fonctionnalités**; ses réglages sont sur sa page.

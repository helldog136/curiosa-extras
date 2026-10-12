# Statut live Twitch

Affiche votre lecteur Twitch sur l'accueil et une bannière quand vous êtes en direct.

**Ce module présente, il n'interroge pas Twitch.** Il demande à la **Chaîne Twitch** (module `twitch-channel`, service `twitch.live`) si vous êtes en direct. Le client id, le secret et la chaîne se saisissent donc **une seule fois, dans la Chaîne Twitch** ; une seule authentification et un seul appel à Twitch servent la bannière, le lecteur et les autres modules. La Chaîne Twitch doit être installée et active (il faut installer les deux ensemble, ou mettre à jour les deux ensemble).

Le lecteur Twitch affiche, hors ligne, un grand panneau blanc « hors ligne ». Dès que la Chaîne Twitch a ses identifiants, le lecteur n'apparaît donc **qu'en direct** (réglage « Quand afficher le lecteur » : « Seulement en direct » par défaut, ou « Toujours »). **Sans identifiants Twitch** (ni dans la Chaîne Twitch, ni dans les anciens champs de ce module), on ne peut pas savoir si vous êtes en direct : le lecteur n'est **pas affiché** (plus de panneau blanc « hors ligne »), sauf si vous choisissez « Toujours ». L'admin de ce module le dit et renvoie vers la Chaîne Twitch. Si Twitch ne répond pas, ni bannière ni lecteur.

## Si vous aviez déjà réglé ce module (migration)

Rien ne casse : tant que la Chaîne Twitch n'a pas ses identifiants, les anciens champs (« Chaîne », « Client id », « Client secret », dans les réglages avancés) continuent de servir, exactement comme avant, et la Chaîne Twitch fait l'appel pour eux. Dans l'admin de ce module, un bandeau dit alors : « Les identifiants Twitch se règlent maintenant dans la Chaîne Twitch. Reprenez-les ici », avec un bouton.

- **Le bouton** copie vos anciennes valeurs dans la Chaîne Twitch, **uniquement dans les champs qui y sont vides** (une valeur déjà présente n'est jamais écrasée), sans jamais les afficher. On peut cliquer plusieurs fois sans effet de plus. Le journal d'audit note l'action, sans son contenu.
- **Dès que la Chaîne Twitch est configurée** (par la reprise ou en saisissant ses champs), elle prend le dessus. Les anciens champs ne servent plus : vous pouvez les vider.
- **Revenir en arrière** : les anciens champs ne sont jamais effacés par la reprise. Dans l'admin de la Chaîne Twitch, « Oublier les identifiants repris » supprime la copie : tant que ses propres champs sont vides, ce module reprend ses anciens réglages.
- **Pourquoi un bouton** : un module n'a pas le droit d'écrire dans les réglages d'un autre. La copie passe par une méthode du service (`adopt`) qui range les valeurs reprises dans le stockage de la Chaîne Twitch ; ses réglages saisis ont toujours le dessus, champ par champ.
- Avec plusieurs Chaînes Twitch, la reprise va dans la **première** (par ordre de création), uniquement dans ses champs vides ; voir le README de la Chaîne Twitch pour partager les identifiants entre chaînes.

## Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus)

Une Chaîne Twitch par chaîne : Statut live les interroge **toutes** (`callAll("twitch.live", "status")`) et ne parle toujours pas à Twitch.

- **Une seule en direct** : exactement l'affichage d'avant (bannière d'une ligne, lecteur de cette chaîne).
- **Plusieurs en direct** : la bannière a **une ligne par chaîne** (nom, titre, jeu, spectateurs, bouton « Regarder ») ; le lecteur montre la **première** chaîne en direct (ordre de création des instances) avec une **pastille par chaîne** pour passer de l'une à l'autre (boutons radio en HTML/CSS, sans script, accessibles au clavier).
- **Aucune en direct** : rien. Avec « Toujours », le lecteur de la première chaîne.
- Réglage facultatif **Chaînes à annoncer** : identifiants séparés par des virgules ; vide = toutes.
- **Vieux cœur** (sans `callAll`) : repli sur l'appel unique d'avant (première chaîne seulement). Le module exige pourtant Curiosa 0.1.14 à l'installation.

Module de base de Curiosa (Curiosa License 1.0). Il s'active depuis l'admin, dans **Fonctionnalités**; ses réglages sont sur sa page.

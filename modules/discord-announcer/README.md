# Annonces Discord — module communautaire de Curiosa

Annonce vos nouveautés sur un salon Discord par **webhook entrant** (aucun bot, aucun compte à lier).

- **Source** : tout ce que votre site publie. Le module digère `core.entry` (toute entrée publiée : blog, codes promo…) et `feed.item` (ce que les autres modules offrent au flux RSS), réglables dans *Sources de données*. Il ne connaît aucun module.
- **Anti-doublon** : chaque élément est annoncé une seule fois. Un élément plus ancien que 24 h (réglable) est noté comme vu sans être annoncé : brancher le webhook n'inonde pas le salon avec votre historique. Un envoi échoué est retenté à chaque minute tant que l'élément est récent.
- **Sécurité** : seules les adresses de webhook Discord sont acceptées ; l'URL est un secret (jamais réaffichée) ; un ping (`@everyone`, rôle) ne part que si vous renseignez la mention ; 5 annonces au plus par minute.
- **Journal** : chaque envoi (et chaque échec, avec son nombre de tentatives) dans l'admin, plus un bouton de test.

## Directs Twitch et YouTube (version 1.1.0)

- **Twitch** : comme avant (sujet `stream.live`). Le message d'un direct Twitch seul est inchangé : `🔴 titre (jeu)` puis le lien.
- **YouTube** : si le module **Chaîne YouTube** est installé (facultatif), « En direct sur YouTube : titre » et le lien partent **une seule fois par direct** (reconnu par l'identifiant de la vidéo : une coupure, une reprise ou le redémarrage du site ne le ré-annoncent jamais). Réglage **Annoncer aussi mes directs YouTube** (oui par défaut).
- **Les deux en même temps** : un seul message, jamais deux. Réglage **En direct sur Twitch et YouTube en même temps** : « Un message qui cite les deux » (par défaut, avec les deux liens) ou « Un message, pour la première plateforme vue ». Pour que les deux soient cités ensemble, YouTube est revérifié juste avant l'annonce d'un direct. Si l'autre plateforme n'arrive que plus tard, elle compte pour le même direct (délai entre deux annonces de live, 2 h) et n'est pas ré-annoncée.
- **Texte modifiable** (« Texte de l'annonce de live », facultatif) avec `{platform}` (Twitch, YouTube ou « Twitch et YouTube »), `{title}`, `{game}` et `{url}` (le ou les liens). Sans `{url}`, les liens sont ajoutés à la fin ; les parenthèses vides sont retirées. Vide = la phrase habituelle, traduite. Le texte s'applique aussi aux directs Twitch.
- **Limite de YouTube** : chaque vérification coûte **2 unités** de la limite du jour (10 000). La tâche passe chaque minute mais ne demande à YouTube que **toutes les 10 minutes** (réglage avancé, 5 à 60) : moins de 3 % de la limite du jour. La dernière réponse est gardée dans le stockage ; en cas de panne ou de limite atteinte, le module n'insiste pas avant l'échéance suivante. Un direct YouTube peut donc être annoncé jusqu'à 10 minutes après son début.
- **Aucun minuteur de plus** : la tâche d'une minute d'avant, c'est tout. Mêmes limites d'envoi qu'avant (5 messages au plus par passage, arrêt au premier refus de débit de Discord).
- Un `@` dans un titre de direct est neutralisé : seul le ping que vous avez réglé (« Mention ») peut partir.

Utilise le service du cœur *tâches planifiées* (`tasks`).

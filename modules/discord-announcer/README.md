# Annonces Discord — module communautaire de Curiosa

Annonce vos nouveautés sur un salon Discord par **webhook entrant** (aucun bot, aucun compte à lier).

- **Source** : tout ce que votre site publie. Le module digère `core.entry` (toute entrée publiée : blog, codes promo…) et `feed.item` (ce que les autres modules offrent au flux RSS), réglables dans *Sources de données*. Il ne connaît aucun module.
- **Anti-doublon** : chaque élément est annoncé une seule fois. Un élément plus ancien que 24 h (réglable) est noté comme vu sans être annoncé : brancher le webhook n'inonde pas le salon avec votre historique. Un envoi échoué est retenté à chaque minute tant que l'élément est récent.
- **Sécurité** : seules les adresses de webhook Discord sont acceptées ; l'URL est un secret (jamais réaffichée) ; un ping (`@everyone`, rôle) ne part que si vous renseignez la mention ; 5 annonces au plus par minute.
- **Journal** : chaque envoi (et chaque échec, avec son nombre de tentatives) dans l'admin, plus un bouton de test.

Utilise le service du cœur *tâches planifiées* (`tasks`).

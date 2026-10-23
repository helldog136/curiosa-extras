# Connexion au compte YouTube (Connecteur YouTube 1.3.0)

**Problème.** « Actions du live YouTube » lit le chat avec la seule clé du site (hypothèse non vérifiée : YouTube pourrait la refuser) et ne peut pas répondre dans le chat (écrire exige une connexion au compte).

**Ce que YouTube exige (vérifié dans sa documentation officielle et son document de découverte).** `liveChatMessages.insert` : portée `youtube` ou `youtube.force-ssl` (20 unités). `liveChatMessages.list` : portées `youtube.readonly`, `youtube` ou `youtube.force-ssl` listées, comme pour `videos.list` qui marche avec une clé ; la documentation ne dit **pas** que la clé seule est refusée, et le serveur répond de la même façon aux deux méthodes sans identité (« utilisez une clé API ou une autre identité »). Conclusion : **non prouvé** sans clé réelle ; le connecteur tente la clé, et propose la connexion si elle est refusée (`chat_denied`). Écrire : OAuth certain.

**Flux choisi : « appareil »** (code court à entrer sur google.com/device). Acceptés pour les appareils : `youtube.readonly` et `youtube` (pas `youtube.force-ssl`). Pas d'adresse de retour à déclarer, pas de redirection, rien à vérifier dans une adresse. Contrepartie : écrire demande `youtube` (« gérer votre compte »), plus large que `force-ssl`.

**Ce que fait Emma.** Suit 4 étapes (projet et API activée ; écran d'autorisation « Externe » puis « Publier l'application » ; client « Téléviseurs et périphériques à entrée limitée » ; coller l'ID client et le code secret dans les champs). Puis « Connecter » → code → téléphone → « C'est fait, vérifier ». « Déconnecter » en un clic.

**Données et vie privée.** ID client (texte) et code secret (réglage secret du cœur, jamais réaffiché). Jetons, code d'appareil en attente et dernière issue : stockage privé du connecteur (le cœur n'offre pas d'écriture dans un réglage secret), jamais renvoyés, journalisés, ni exposés (aucun outil MCP).

**Bornes.** 3 adresses Google en liste fermée ; 10 s entre deux demandes de code, 10 par heure ; vérification au plus une fois par intervalle de Google ; code mort après 30 min ; rafraîchissement à la demande (une demande à la fois, pause 1 min après panne) ; messages : 200 caractères, 3 s d'écart, 30 par heure, 20 unités du budget du jour.

**Non fait.** Flux par code d'autorisation avec PKCE (inutile avec le flux appareil) ; portée `force-ssl` ; nom du compte affiché (demanderait une portée de plus) ; `streamList` (flux continu).

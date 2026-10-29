# Module « Actions du live YouTube » (youtube-live-actions 1.0.0)

## Le problème
Emma a déjà, sur Twitch, des récompenses de points de chaîne qui allument ses lumières ou font lire un message chez elle (Connecteur Home Assistant). Sur YouTube, ses viewers soutiennent autrement : Super Chat, Super Sticker, adhésions. Elle veut le même plaisir, avec la même sécurité : rien d'ouvert chez elle, un bouton pour tout couper, un texte lu qui ne peut pas être n'importe quoi.

## Pour qui, et ce qu'il fait
Pour la créatrice qui a Home Assistant et diffuse sur YouTube. Le module **décide** (quelle règle, quelle action) ; Home Assistant **exécute** et protège. Le module ne connaît ni entité, ni scène, ni média de la maison : seulement des noms d'action (`lumieres:rouge`, `tts:lire`, même grammaire que Twitch). Type : intégration, instance unique, onglet « Utiliser » renommé « En direct ».

## Ce que voit le visiteur
Rien : pas de page publique, pas de route. Le viewer qui soutient le direct voit le résultat chez Emma, c'est tout.

## Ce que fait Emma, pas à pas
1. Installe le module ; la page « En direct » propose d'installer ce qui manque (Home Assistant, Chaîne YouTube, Connecteur YouTube) et dit où elle en est.
2. Écrit une règle : genre (Super Chat, Super Sticker, nouvelle adhésion, adhésions offertes), devise et minimum, délai de recharge, action, « lire le message ».
3. « Simuler un don » : même chemin qu'un vrai don, sans rien demander à YouTube ; le résultat est dans le journal.
4. Le jour du direct, ouvre la page **et la laisse ouverte**. Elle lit : « Je lis le chat de votre direct… ».
5. En cas de souci : le gros bouton « Tout couper » (en haut, visible sans défiler sur téléphone), ou « !stop » dans le chat.

## Règles et argent
- Montants en **micros de la devise annoncée, sans conversion** (aucun taux de change fiable ni neutre). Décision : une règle porte UNE devise avec un minimum, ou « toutes les devises » SANS minimum ; pour deux devises avec seuil, deux règles. Un don en dollars ne déclenche donc pas « 5 EUR au moins » (dit dans la page).
- Cadeau d'adhésions : nombre minimum ; le « reçu » de chaque destinataire est ignoré (sinon double compte). Nouvelle adhésion : sans réglage.
- Plusieurs règles peuvent se déclencher pour un même don (trois au plus) : lumière ET voix. 20 règles au plus ; noms de 64 caractères.
- **Un don ne se rembourse pas** : si Home Assistant refuse (coupé, pas en direct, ne répond plus, pas associé, texte refusé, occupé…), l'action n'est pas jouée et le motif est dans le journal, en mots simples. Pour un message de Super Chat refusé : « ne pas le lire » (défaut : les autres règles, lumières comprises, jouent quand même) ou « dire seulement un merci ». Jamais de « points ».
- Un don plus vieux que 120 s (réglable) n'est pas rejoué : ouvrir la page en plein direct ne rallume rien avec des dons d'avant.

## Lecture du chat
- Via `youtube.api` (Connecteur YouTube 1.2.0) : `liveChatMessages.list`, 5 unités de limite par lecture, jamais en cache. Le direct est trouvé par `youtube.live` (Chaîne YouTube 1.4.0, nouveau : les 5 derniers envois puis leur détail, 2 unités, chaque minute hors direct tant que la page est ouverte).
- **Seulement page ouverte.** Aucun minuteur, aucun processus : la page se recharge d'elle-même (battement de cœur) et chaque affichage lance un tour borné. Plusieurs onglets : un seul curseur, une seule opération à la fois, un rendez-vous que personne ne devance : jamais plus d'appels qu'un onglet. Page fermée : plus aucun appel. La page ne se recharge pas si l'onglet est caché dans l'admin (autre onglet du module) ou pendant qu'on tape dans un champ.
- Respect de `pollingIntervalMillis` et du réglage (15 s par défaut, 5 à 60) ; curseur `nextPageToken` ; doublons écartés par empreinte du message (600 gardées) et, côté maison, par la référence du message.
- **Limite du jour** : « environ N % de votre limite YouTube du jour », arrêt doux à 50 % (5 à 90, avancé) ; à 15 s, ≈ 12 % par heure de direct. Reprise à la remise à zéro de YouTube (minuit à Los Angeles).
- Jamais de boucle : pause qui double de 15 s à 10 min ; clé refusée, chat refusé, limite atteinte : pause longue ; direct fini : retour à la recherche ; direct sans chat : « pas de chat ». La page n’attend jamais YouTube plus de 4,5 s.

## « !stop » et « !start »
Reconnus aux **indicateurs de l'auteur donnés par YouTube** (propriétaire, modérateur), jamais au pseudo (testé : un faux « Moderateur » ne coupe rien). `!stop` : propriétaire, et modérateurs YouTube si le réglage le permet (défaut oui) ; `!start` : propriétaire seulement. Appellent `home-assistant.bridge.stop/start`. Plus vieux que 60 s : ignorés. **Ils ne marchent que pendant la lecture** (page ouverte) : la page le dit, et rappelle les vraies protections (gros bouton, interrupteur côté Home Assistant). Pas de réponse dans le chat : voir ci-dessous.

## Ce que YouTube permet ou non (hypothèses NON vérifiées avec le vrai YouTube)
- Lecture du chat avec la **seule clé du site** : on suppose que `liveChatMessages.list` l'accepte pour un chat public (la documentation de YouTube liste des portées OAuth). Si YouTube répond « interdit », le connecteur le range en `chat_denied` (pause 10 min, clé non déclarée refusée) et la page l'explique. Il n'y a **pas d'OAuth** dans le connecteur : le minimum honnête est donc la lecture par clé.
- Un direct public apparaît dans la liste des envois et donne `activeLiveChatId` avec la clé ; un direct privé/non répertorié n'est pas vu.
- **Écrire dans le chat est impossible** avec une clé (OAuth requis). Le module n'envoie donc aucune réponse, sans erreur ; le code est prêt si un jour `youtube.api.status().chat.write` vaut vrai (méthode `chatPost`, qui n'existe pas aujourd'hui).
- Messages datés par `publishedAt` : une horloge de serveur très décalée fausserait le filtre « trop ancien ».

## Intégration avec Home Assistant : écarts constatés
- Le contrat RÉEL de `home-assistant.bridge.enqueue` n'a **pas** de paramètre `test` (l'essai de la propriétaire est une porte interne du module). Ce module l'envoie quand même (`test: true`, compatible si Home Assistant l'adopte), mais aujourd'hui une simulation suit le chemin d'un vrai don : si la maison est ouverte, l'action se joue vraiment (la page le dit) ; sinon le refus est journalisé (« pas en direct », etc.). La branche `ideas/channel-rewards` fait la même hypothèse.
- Home Assistant ne sait être « en direct » que par `twitch.live`. Une personne qui diffuse **seulement** sur YouTube verrait tous les dons refusés (`not_live`) : la page le dit. Piste : un second signal « en direct » fourni par ce module pendant la lecture (service `live` de Home Assistant, avec expiration courte) : à décider avec le lot Home Assistant, non fait ici.

## Réglages et valeurs par défaut
Chaîne (rien à choisir s'il n'y en a qu'une) ; lire le chat (oui) ; modérateurs peuvent `!stop` (oui) ; message refusé : ne pas le lire. Avancé : phrase de merci, cadence 15 s, part de limite 50 %, âge maximal 120 s, devises en plus.

## Données gardées et vie privée
Trois sortes de documents : état (direct, curseur, rendez-vous, compteur de limite, 600 empreintes de messages), règles (20), journal (50 lignes : pseudo YouTube, montant, résultat, jamais le texte). « Vider le journal » efface. Aucune copie de l'identifiant de chaîne (propriétaire : Chaîne YouTube) ni de la clé (Connecteur YouTube). Déclaré dans `privacy`.

## Bornes
20 règles, 50 lignes de journal (purge à la lecture), 600 empreintes, 100 évènements par lecture, 500 messages par page, une lecture à la fois par instance, simulation 1 / 3 s et 30 / h, ≤ 3 actions par don.

## Droits et outils pour l'assistant IA
`yt.manage` (règles, journal, reprendre), `yt.stop` (tout couper), `yt.test` (simuler). Outils : `youtube_live_status`, `youtube_live_journal`, `youtube_live_rules` (lecture, accordés d'office, n'appellent jamais YouTube) ; `youtube_action_simulate` (écriture, jamais accordée d'office).

## Pas fait
Réponses dans le chat ; déclencheur par mot libre (voulu) ; conversion de devises (voulu) ; lecture sans page ouverte (voulu) ; signal « en direct » YouTube pour Home Assistant ; OAuth.

## Idées pour la suite
Signal « en direct » YouTube vers Home Assistant ; connexion au compte pour répondre dans le chat ; objectif cumulé de dons ; règles par palier unique (la plus haute seulement).

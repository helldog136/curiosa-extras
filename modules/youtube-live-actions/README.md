# Actions du live YouTube

Quand quelqu'un soutient votre **direct YouTube**, quelque chose se passe chez vous : vos lumières changent de couleur, un message est lu à voix haute. Le module ne fait que **décider** (« ce Super Chat déclenche telle action ») ; c'est le module **Home Assistant** qui exécute chez vous, avec son gros bouton « Tout couper », sa vérification du texte lu et son interrupteur.

C'est le pendant, pour YouTube, des récompenses de points de chaîne Twitch.

## Ce qui déclenche une action

| Soutien | Ce que YouTube annonce | Réglage de la règle |
|---|---|---|
| **Super Chat** | un montant, une devise, un message | devise + montant minimum, lire le message ou non |
| **Super Sticker** | un montant, une devise | devise + montant minimum |
| **Nouvelle adhésion** | une nouvelle personne membre | rien de plus |
| **Adhésions offertes** | un cadeau de N adhésions | nombre minimum |

Il n'y a **pas** de déclencheur sur un mot écrit dans le chat : seuls les dons et adhésions comptent (et deux commandes réservées, plus bas).

## Pas à pas

1. Installez le module (avec **Home Assistant**, **Chaîne YouTube** et **Connecteur YouTube** : le module propose d'installer ce qui manque). La page « En direct » vous le dit à chaque étape.
2. Écrivez une première règle : par exemple **Super Chat de 5 € ou plus → `lumieres:rouge`**. Le nom de l'action est celui que vous avez relié dans Home Assistant.
3. **Simulez un Super Chat** (« Simuler un don ») pour voir l'action arriver chez vous, sans rien demander à YouTube.
4. Le jour du direct, **ouvrez la page « En direct » et gardez-la ouverte**.

## À savoir (important)

- **Le chat n'est lu que pendant que la page est ouverte** dans un navigateur. Aucun processus ne tourne en arrière-plan : page fermée, plus rien n'est lu et YouTube n'est plus interrogé. Plusieurs onglets ouverts partagent une seule lecture.
- **Un don ne se rembourse pas.** Si Home Assistant refuse (tout est coupé, vous n'êtes pas en direct, le texte du message est refusé…), l'action n'est pas jouée et le motif est écrit dans le journal. Pour le message d'un Super Chat refusé, un réglage dit ce qui se passe : ne pas le lire (par défaut ; les autres règles jouent quand même) ou dire seulement un merci.
- **Les devises ne sont jamais converties.** Une règle « 5 EUR au moins » ne se déclenche pas pour un don en dollars. « Toutes les devises » accepte n'importe quel montant, sans minimum ; sinon une règle par devise.
- **« !stop » et « !start » dans le chat** : le propriétaire de la chaîne et les modérateurs YouTube (réglable) peuvent écrire « !stop » pour tout couper ; seul le propriétaire peut écrire « !start ». On reconnaît ces personnes aux indicateurs que YouTube donne sur l'auteur du message, jamais à leur pseudo. Ces commandes **ne marchent que pendant la lecture** : vos vraies protections sont le gros bouton « Tout couper » de la page, et l'interrupteur dans Home Assistant.
- **Le module ne répond pas dans le chat** : écrire dans un chat demande une connexion à votre compte YouTube, que la clé du site ne permet pas. Il ne répondra que le jour où le connecteur saura écrire.
- **Un seul état « en direct »**, celui de Home Assistant, qui le tient de Twitch. Si vous diffusez seulement sur YouTube, Home Assistant ne vous voit pas en direct et refuse les dons (la page le dit). Voir `docs/ideas/youtube-live-actions.md`.

## La limite du jour de YouTube

YouTube donne 10 000 unités par jour à la clé du site. Lire le chat d'un direct en coûte 5 à chaque lecture : environ **12 % de la limite par heure** à une lecture toutes les 15 secondes. La page l'écrit en clair (« environ N % de votre limite du jour »). Le module **s'arrête doucement** à 50 % de la limite du jour (réglable dans les options avancées), pour laisser de la place aux autres modules YouTube, et reprend à la remise à zéro. Chercher un direct (chaque minute tant que la page est ouverte hors direct, soit environ 1 % de la limite par heure) coûte 2 unités.

## Alertes à l'écran (OBS), version 1.1.0

Le module **publie** les Super Chats, Super Stickers, adhésions et adhésions offertes qu'il voit dans le chat (sujet `live.event`) ; l'**Overlay alertes (OBS)** peut les afficher (il les lit s'il est installé, aucun des deux n'a besoin de l'autre). Que le don déclenche une règle ou non.

- Réglage **Laisser l'overlay d'alertes afficher les dons** (oui par défaut ; sans l'overlay, il ne fait rien).
- Réglage **Lire le chat même sans Home Assistant (alertes OBS seulement)** (non par défaut) : pour qui veut seulement les alertes à l'écran. Le chat est alors lu comme d'habitude (même limite du jour, page « En direct » ouverte) et les dons sont notés « Affiché en alerte seulement » dans le journal. Par défaut, sans Home Assistant, rien n'est lu, comme avant.
- **Comme pour les actions, le chat n'est lu que page « En direct » ouverte** : pas de page ouverte, pas d'alerte. L'overlay ne déclenche jamais cette lecture.
- Les alertes vivent **en mémoire**, 15 minutes au plus, 50 au plus : rien sur le disque, rien à effacer. Un montant n'est jamais publié sans sa devise, et jamais converti.

## Réglages

- **Chaîne YouTube** : rien à choisir s'il n'y en a qu'une.
- **Lire le chat pendant le direct** (oui) ; **les modérateurs YouTube peuvent écrire !stop** (oui) ; **si le message d'un Super Chat est refusé** (ne pas le lire).
- Options avancées : phrase de remerciement, lecture au plus toutes les 15 s (5–60), part de la limite utilisable 50 % (5–90), ignorer les dons de plus de 120 s (30–600), autres devises.

## Droits

`yt.manage` (règles, journal, reprendre), `yt.stop` (Tout couper), `yt.test` (simuler). Administrateurs : oui ; rédacteurs : non.

## Vie privée

Le journal garde le pseudo YouTube, le montant et le résultat (50 lignes). **Le texte des messages n'est jamais écrit sur le disque.** « Vider le journal » efface tout. Si le partage avec l'overlay d'alertes est actif (réglage ci-dessous), le pseudo, le montant et le texte du message restent 15 minutes au plus **en mémoire** (50 évènements au plus), le temps que l'overlay les lise.

## Pour les développeurs

Service demandés (tous facultatifs) : `home-assistant.bridge` (`enqueue`, `stop`, `start`, `status`), `youtube.api` (`request` avec `liveChatMessages.list`, version 1.2.0 du connecteur ; `status`) et `youtube.live` (`current`, Chaîne YouTube 1.4.0). Sujet consommé : `ha.result` (suivi de ce qui s'est passé chez vous). Sujet publié : `live.event` (`{ id, platform, kind, who, at, amount?, currency?, count?, text? }`, `amount` seulement avec `currency` ; file en mémoire de `events.mjs`, 50 évènements, 15 minutes). Outils pour les assistants : `youtube_live_status`, `youtube_live_journal`, `youtube_live_rules` (lecture) et `youtube_action_simulate` (écriture, jamais accordée d'office).

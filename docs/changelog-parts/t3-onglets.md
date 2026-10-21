<!-- Lot T3 : onglets des modules et nettoyage Raid/Story (cœur 0.2.2) -->

### Nouveautés

- **Les pages des modules se rangent en onglets, avec le bon nom.** Le premier onglet porte le nom de ce qu'on y fait : « Fabriquer la vidéo » (Story d'annonce), « Ma liste » (Raid Twitch), « Créneaux » (Planning), « Commandes » (Bot Twitch), « Partenaires », « Chiffres » (Statistiques de la communauté), « Mes streams » (Agenda manuel), « Annonces » (Annonces Discord), « Suggestions » (Suggestions de jeux), « Messages » (Livre d'or). Pour Discord, GitHub, Mastodon, Reddit, Bluesky et la Chaîne YouTube, l'onglet qui ne montre que des chiffres s'appelle « Statistiques » ; « Ma chaîne » pour Ma Chaîne Twitch.
- **Un onglet « Apparence » pour Planning et pour l'overlay Labyrinthe**, qui ont beaucoup de réglages d'aspect : ils ne se mélangent plus aux autres réglages.
- **Moins d'onglets inutiles.** Le Connecteur Twitch, le Connecteur YouTube et « En direct ? » (live-status) n'ont plus d'onglet « Utiliser » : leur état de connexion ou leurs avertissements s'affichent en haut de « Réglages », à côté de la clé ou du réglage concerné.

### Améliorations

- **Raid Twitch ne partage plus ses partenaires sous forme de sujet** : personne ne le lisait plus depuis Story 2.0 (Story lit Contacts directement). Aucune donnée n'est touchée, le dock marche comme avant.

### Pour les développeurs

- Onglets (cœur 0.2.2) : clé `tabs` (`{ id, label?, hidden? }`) et `settings[].tab`, `minCore` 0.2.2. Renommés (`use`) : `stream-story`, `twitch-raid`, `planning`, `twitch-bot`, `partnerships`, `community-stats`, `calendar-manual`, `discord-announcer`, `game-suggestions`, `twitch-channel` (« Ma chaîne » : connexion et chiffres, à garder car un panneau de statistiques ne doit pas passer au-dessus du réglage de la chaîne) et l'exemple `guestbook` ; « Statistiques » : `discord`, `github`, `mastodon`, `reddit`, `bluesky`, `youtube-channel`. Retirés (`hidden`) : `twitch-connector`, `youtube-connector`, `live-status`. Onglet ajouté `look` (« Apparence ») : `planning` (15 réglages `group: "appearance"`) et `maze-overlay` (9). Règle `tabs.reasonable` du kit : 0 ou 1 onglet ajouté, noms de 20 caractères au plus en FR+EN.
- Versions : `stream-story` 2.0.1, `twitch-raid` 2.0.1, `planning` 2.2.0, `maze-overlay` 1.1.0, `twitch-bot` 1.2.1, `partnerships` 2.0.1, `community-stats` 1.1.2, `calendar-manual` 1.0.1, `discord-announcer` 1.0.4, `game-suggestions` 1.2.1, `live-status` 1.3.1, `twitch-channel` 2.0.1, `twitch-connector` 1.0.1, `youtube-connector` 1.0.1, `discord` 1.1.3, `github`/`mastodon`/`reddit`/`bluesky` 1.1.2, `youtube-channel` 1.2.1, `guestbook` (exemple) 1.0.2.
- `twitch-raid` : le sujet `stream.partner` est retiré (`provides`, `exports`, `partners.mjs`, permission `topics`, ses 4 tests, l'exception `NOT_YET_DOCUMENTED` de `tests/repo-rules.test.mjs`, qui est maintenant vide). Vérifié par grep dans le dépôt et le catalogue : plus aucun consommateur depuis Story 2.0. Les tests « trou noir » de la lecture de la liste par le dock restent (`twitch-raid-contacts`, `twitch-raid-large`).
- Textes qui disaient « plus haut / plus bas » d'un réglage devenu un autre onglet : l'aperçu des apparences de `planning` (aide du réglage et introduction du panneau) et la dernière étape de migration de `twitch-raid` renvoient maintenant à l'onglet par son nom.

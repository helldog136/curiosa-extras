## Récompenses en points de chaîne : créez-les depuis votre site

*Vos viewers dépensent leurs points pour changer la couleur de vos lumières ou faire lire un message chez vous. Pour Curiosa 0.2.5 ou plus. Modules touchés : Bot Twitch 1.3.0, Connecteur Twitch 1.2.0.*

### Nouveautés

- **Un onglet « Récompenses » dans le Bot Twitch.** Vous créez, modifiez, mettez en pause et supprimez vos récompenses en points de chaîne **depuis votre site** (elles existent vraiment chez Twitch) : titre, coût, délai de recharge, texte d'aide, « le viewer écrit un message », et l'**action** à lancer, choisie dans une liste (« Lumières : rouge », « Lire le message à voix haute », « Répondre dans le chat »…). Les erreurs s'affichent sous le champ, avec un exemple.
- **Les points sont validés ou rendus tout seuls.** Si l'action a été faite, la récompense est validée ; si la maison refuse (coupée, pas en direct, message refusé…) ou ne répond pas à temps, **les points sont rendus** au viewer, avec un petit message dans le chat si vous le souhaitez. Un échange n'est jamais traité deux fois.
- **Les lumières et la voix, avec le module Home Assistant** (facultatif : sans lui, les récompenses qui répondent dans le chat marchent quand même, et l'onglet propose de l'installer). Hors direct ou quand vous coupez la maison, ses récompenses se **mettent en pause chez Twitch** et reviennent toutes seules.
- **`!stop` et `!start` dans le chat** : vous et les modérateurs que vous nommez coupez la maison avec `!stop` ; vous seule la rebranchez avec `!start`.
- **« Simuler cette récompense »** : un faux échange (viewer « Test ») pour vérifier que tout marche, sans Twitch et sans dépenser de points. Marqué « [Test] » dans le journal des 50 derniers échanges.
- **Pour votre assistant** : voir, créer, modifier et simuler les récompenses (jamais accordé d'office). Nouveau droit « créer, modifier et supprimer les récompenses » pour vos rôles.

### Améliorations

- Le Connecteur Twitch sait demander l'autorisation de gérer les récompenses, **seulement quand vous activez l'onglet** : le chat du bot ne s'arrête jamais pour ça.
- Si votre compte n'est ni Affilié ni Partenaire, la page le dit simplement (« Twitch ne propose pas les points de chaîne à ce compte ») : rien n'est cassé.
- Aucun jeton n'est jamais affiché ; les messages que Twitch envoie sont vérifiés et un même message renvoyé est ignoré.

### Pour les développeurs

- **Connecteur Twitch 1.2.0** : `rewards.mjs` (nouveau) ajoute à la liste fermée, avec le jeton de la chaîne et `channel:manage:redemptions` (autorisation demandable, `EXTRA_SCOPES`) : `GET/POST/PATCH/DELETE channel_points/custom_rewards` et `PATCH channel_points/custom_rewards/redemptions`, requêtes et corps fermés et bornés. Trois lignes ajoutées dans `helix.mjs` (après `ALLOWED`, et dans `check`). Service `twitch.api` v3 inchangé.
- **Bot Twitch 1.3.0** (`minCore` 0.2.5) : `eventsub.mjs` (abonnement `channel.channel_points_custom_reward_redemption.add` v1 sur la route existante, mêmes secret, signature et rejeu ; requêtes Helix ; **hypothèses non vérifiées notées en tête**), `rewards.mjs` (récompenses, pauses), `redeem.mjs` (échanges idempotents par identifiant, pont, `ha.result`, expiration à la lecture, simulation), `kill.mjs` (`!stop`/`!start`), `rewardsAdmin.mjs` (onglet). Besoin **facultatif** `home-assistant.bridge` (`enqueue({ key, text?, viewer, ref, test? })`, `status`, `stop({ by })`, `start({ by })`) ; sujets consommés `ha.result` et `ha.state`. Mots `stop` et `start` réservés aux commandes. Réglages `rewardsNotice`, `stopMods`, `rewardWaitSeconds` (avancé), `extraActions` (avancé). Outils MCP `rewards_list`, `reward_create`, `reward_update`, `reward_simulate`.
- Tests : `channel-rewards-connector`, `channel-rewards` ; aides `fakeHaBridge.mjs` (faux fournisseur du pont) et `fakeRewards.mjs` (faux Twitch des récompenses). `twitch-bot.test.mjs`, `tabs-modules.test.mjs` et `repo-rules.test.mjs` (sujets `ha.result` et `ha.state`, à documenter dans le cœur) mis à jour.
- Conflits probables : `modules/twitch-connector/helix.mjs` et `store.mjs` (avec une branche qui touche la liste fermée), `tests/repo-rules.test.mjs` (`NOT_YET_DOCUMENTED`, la même ligne que `ideas/home-assistant`), `catalogue/index.json` (besoin facultatif `home-assistant.bridge` du bot).

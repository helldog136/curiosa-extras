## Twitch activity 1.2.0 and Alerts overlay 1.4.1: robustness / Activité Twitch 1.2.0 et Overlay alertes 1.4.1 : robustesse

*EN: modules touched: Twitch activity 1.2.0 (new permission: mail), Alerts overlay 1.4.1. Nothing to set up. You are now warned by e-mail when listening stops.*
*FR : modules touchés : Activité Twitch 1.2.0 (nouvelle permission : e-mail), Overlay alertes 1.4.1. Rien à régler. Vous êtes maintenant prévenu par e-mail quand l'écoute s'arrête.*

### What changes for you / Ce qui change pour vous

- **EN: after a gap, the follows and subs you missed are looked up** and added to the journal, marked "possibly missed", and the alerts overlay still shows them within the hour. A restart, an update or a short outage no longer loses them. (Gifts, bits, raids and hype trains cannot be read afterwards.)
- **FR : après une coupure, les follows et abonnements manqués sont recherchés** et ajoutés au journal, marqués « peut-être manqué », et l'overlay alertes les montre encore dans l'heure. Un redémarrage, une mise à jour ou une courte panne ne les perd plus. (Les cadeaux, bits, raids et trains d'enthousiasme ne peuvent pas être relus après coup.)
- **EN: the listening is checked every minute**, not every five.
- **FR : l'écoute est vérifiée chaque minute**, et non toutes les cinq.
- **EN: you are warned by e-mail when listening stops** (token to renew, subscription revoked, site not reachable, Twitch down for 30 minutes): one e-mail per problem, and one when all is back. Never for a fresh install. You can switch it off.
- **FR : vous êtes prévenu par e-mail quand l'écoute s'arrête** (connexion à renouveler, abonnement retiré, site injoignable, Twitch en panne depuis 30 minutes) : un e-mail par problème, et un au retour. Jamais pour une installation neuve. Vous pouvez le couper.
- **EN: a warning when you are live for hours without any event** (3 hours by default, advanced setting). A quiet stream is normal: it only asks you to check.
- **FR : un avertissement quand vous êtes en direct depuis des heures sans aucun événement** (3 heures par défaut, réglage avancé). Un direct calme est normal : on vous demande seulement de vérifier.

### For developers

- Twitch activity 1.2.0: `cycle.mjs` (one pass: subscriptions, gap detection from `okAt` / `checkedAt` / `gapSince`, catch-up, health), `catchup.mjs` (followers by date, subscribers against the baseline `subLogins`, stable keys `catchup-follow-<id>-<ms>` and `catchup-sub-<login>-<hour>`, 50 lines a gap), `health.mjs` (assessment, grace delays, one mail per problem, again after 24 h, one when back), webhook `503` + `Retry-After` on a storage failure, task `listen` every minute, permission `mail`, settings `healthMail` and `silentHours` (advanced). The topic cache is invalidated by every new line.
- Alerts overlay 1.4.1: a `missed` line is kept up to an hour (5 minutes otherwise); the topic is read with the largest limit (200).
- Tests: `tests/twitch-events-robust.test.mjs`, `tests/twitch-alerts-e2e.test.mjs` (both modules, fake Twitch that signs). Assertions of versions updated.

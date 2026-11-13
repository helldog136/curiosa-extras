## Twitch: the "Authorize again" button is always there / Twitch : le bouton « Autoriser de nouveau » est toujours là

*EN: Twitch activity 1.4.0, Twitch bot 1.18.0 and Alerts overlay 1.8.2. When Twitch lacks a permission, the page now shows the "Authorize again with Twitch" button, and a subscription stuck on "waiting for Twitch" repairs itself. No new permission, nothing to set up.*
*FR : Activité Twitch 1.4.0, Bot Twitch 1.18.0 et Overlay alertes 1.8.2. Quand un accord de Twitch manque, la page montre maintenant le bouton « Autoriser de nouveau avec Twitch », et un abonnement bloqué sur « en attente de Twitch » se répare tout seul. Aucune nouvelle permission, rien à régler.*

### What changes for you / Ce qui change pour vous

- **EN: the button was missing.** A red box said "click the button below" with only "Check now" under it. The button is back on Twitch activity and on the Twitch bot (chat, bot account and rewards), with the missing permissions already in the link. **FR : le bouton manquait.** Un cadre rouge disait « cliquez sur le bouton ci-dessous » avec seulement « Vérifier maintenant » dessous. Le bouton est de retour dans Activité Twitch et dans Bot Twitch (chat, compte du bot et récompenses), avec les accords manquants déjà dans le lien.
- **EN: back from Twitch, the warning goes by itself** (the page checks again when it opens). **FR : au retour de Twitch, l'alerte disparaît toute seule** (la page revérifie à l'ouverture).
- **EN: "Channel point reward" no longer turns the page red.** The Twitch bot already handles rewards, so this type, off by default, only shows its own state in the Types tab. **FR : « Récompense en points » ne rend plus la page rouge.** Le Bot Twitch gère déjà les récompenses : ce type, éteint par défaut, n'affiche son état que dans l'onglet Types.
- **EN: a type waiting for Twitch for 3 minutes is created again, once.** The Types tab says "Waiting for Twitch for N min" and the reason in a tooltip. Each change of a type is written to the site log. **FR : un type en attente de Twitch depuis 3 minutes est recréé, une fois.** L'onglet Types dit « En attente de Twitch depuis N min » et la raison dans une info-bulle. Chaque changement d'un type est écrit dans le journal du site.
- **EN: shorter texts**, steps in tooltips, and the Types table lost its "What it covers" column (its text is the tooltip of the type). **FR : textes plus courts**, étapes dans les info-bulles, et le tableau des types perd sa colonne « Ce que ça couvre » (son texte est l'info-bulle du type).
- **EN/FR: in French, the hype train is now « train de la hype »** (it was « train d'enthousiasme »). English is unchanged.

### For developers

- `connectLink` is called with `force: true`, `scopes` (the missing ones) and `returnTo`; when the connector gives no link, a link to its page is shown. Cause: the pages called it without `force`, and the connector answers "connected" (no link) when its own list of wanted permissions, filled only when a page declares it, is satisfied.
- twitch-events: `optional` types (channel point rewards) do not count in the verdict nor the red box; pending age comes from Twitch `created_at`; `healed` once per 15 minutes; log events `type.state` and `type.recreated`; declaration of the permissions on instance creation.
- Not done: automatic refresh of the Types tab while a type waits (needs a core feature: pages run no script).
- Tests: `twitch-authorize-button`.

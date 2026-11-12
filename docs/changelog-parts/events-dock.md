## Twitch activity 1.1.0: an OBS dock for the journal, with Replay / Activité Twitch 1.1.0 : un dock OBS pour le journal, avec Rejouer

*EN: module touched: Twitch activity 1.1.0. Nothing to set up: copy the new address of the tab "OBS dock" into OBS. No new permission. Replaying and pausing the alerts need the Alerts overlay 1.4.0.*
*FR : module touché : Activité Twitch 1.1.0. Rien à régler : copiez la nouvelle adresse de l'onglet « Dock OBS » dans OBS. Aucune nouvelle permission. Rejouer et mettre les alertes en pause demandent l'Overlay alertes 1.4.0.*

### What changes for you / Ce qui change pour vous

- **EN: a dock for OBS (Docks > Custom browser docks) shows your events live**, newest first: a coloured and written badge, the name, the amount, the time ("2 min ago") and a **Replay** button on each line. It works from a narrow panel (about 280 px) to a wide one, dark by default.
- **FR : un dock pour OBS (Docks > Docks de navigateur personnalisés) montre vos événements en direct**, du plus récent au plus ancien : une pastille colorée et écrite, le pseudo, le montant, l'heure (« il y a 2 min ») et un bouton **Rejouer** sur chaque ligne. Il tient dans un panneau étroit (environ 280 px) comme dans un large, sombre par défaut.
- **EN: "This stream", "24 h" or "All kept", a filter by type and a search field.** "This stream" is the default while you are live.
- **FR : « Ce direct », « 24 h » ou « Tout », un filtre par type et une recherche.** « Ce direct » est le choix par défaut pendant votre direct.
- **EN: Replay shows the alert again with the same data**, even if that type is switched off. A double click sends one alert; the button says "Replayed ✓".
- **FR : Rejouer montre de nouveau l'alerte avec les mêmes données**, même si ce type est éteint. Un double clic n'envoie qu'une alerte ; le bouton dit « Rejoué ✓ ».
- **EN: three more buttons for a live: Pause alerts / Resume** (the alerts are held, nothing is lost), **Empty the queue** and **Test** (a menu of types).
- **FR : trois boutons de plus pour un direct : Pause des alertes / Reprendre** (les alertes sont retenues, rien n'est perdu), **Vider la file** et **Tester** (un menu de types).
- **EN: if the site restarts, the dock says "Reconnecting…" and comes back by itself.** The address is secret; "Make a new address" stops the old dock at once (reload the dock in OBS).
- **FR : si le site redémarre, le dock dit « Reconnexion… » et revient tout seul.** L'adresse est secrète ; « Créer une nouvelle adresse » arrête tout de suite l'ancien dock (rechargez le dock dans OBS).

### For developers

- `dock.mjs` (page: one script, nonce policy, no colour or font written, only `--cur-*` tokens), `dockapi.mjs` (secret `dockSecret` in the state document, constant-time compare on digests, 30 wrong keys a minute then 429; routes `dock`, `dock-data` (90 a minute), `dock-act` (40 a minute)), `dockpure.mjs` (`relTime`, `nextDelay`, `visible`: the SAME source runs in the page and in the tests), `dockkit.mjs` (copy of the look helpers of `twitch-raid/dock.mjs`, a test fails on drift), `describe.mjs` (how a line is written, shared with the admin page).
- Optional need `alerts.queue` (service of the Alerts overlay 1.4.0): replay, pause, resume, empty and test are refused with `no_alerts` and the buttons are disabled when no alerts overlay is installed. Replay stays the only write route for assistants too (`twitch_event_replay`).
- Tests: `tests/twitch-events-dock.test.mjs` (address and "New address", scopes and order, privacy of the answer, replay idempotence and rate limit, pause/resume/empty, the page policy and texts, the whole script run in a fake browser: reconnecting with a growing wait, double click, dead address).

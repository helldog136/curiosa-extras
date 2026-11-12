## Overlay elements: featured partners, partners live now, next event / Éléments d'overlay : partenaires à la une, partenaires en direct, prochain événement

*EN: modules touched: Twitch raid 2.4.0 and Events 1.3.0. Twitch raid now needs Curiosa 0.5.0 (Events already did 0.6.0). Nothing to set up, no new permission.*
*FR : modules touchés : Raid Twitch 2.4.0 et Événements 1.3.0. Raid Twitch demande maintenant Curiosa 0.5.0 (Événements demandait déjà la 0.6.0). Rien à régler, aucune nouvelle permission.*

### What changes for you / Ce qui change pour vous

- **EN: two new elements for your overlay pages (Twitch raid).** "Featured partners" shows the channels of your featured picks, with their game and viewers. "Partners live now" shows every partner who is live, the least watched first (1 to 10 channels, "and 3 more live" beyond). Never a person filed under "Do not show", never a stream title or a raid command. When nobody is live, nothing is drawn at all.
- **FR : deux nouveaux éléments pour vos pages d'overlay (Raid Twitch).** « Partenaires à la une » montre les chaînes de votre sélection du moment, avec leur jeu et leur audience. « Partenaires en direct » montre tous les partenaires en direct, les moins regardés d'abord (de 1 à 10 chaînes, « et 3 autres en direct » au-delà). Jamais une personne rangée dans « Ne pas montrer », jamais un titre de direct ni une commande de raid. Quand personne n'est en direct, rien ne s'affiche.
- **EN: a "Next event" element (Events).** It shows the next published event of your agenda: title, day and time in the language of the page, "In 3 days" and, if you want, the place. Nothing is drawn when nothing is coming up.
- **FR : un élément « Prochain événement » (Événements).** Il montre le prochain événement publié de votre agenda : titre, jour et heure dans la langue de la page, « Dans 3 jours » et, si vous le souhaitez, le lieu. Rien ne s'affiche quand rien n'est à venir.
- **EN: "New address" in Twitch raid also changes the address of its overlay elements.** Reload your overlay pages in OBS afterwards. / **FR : « Nouvelle adresse » de Raid Twitch change aussi l'adresse de ses éléments d'overlay.** Rechargez ensuite vos pages d'overlay dans OBS.

### For developers

- `twitch-raid/element.mjs`: `featured` (reads `moment.momentNow`, which never rerolls) and `live` (`source.targets` + `live.liveNow` + `consent.allowedContacts` + the "Never draw" list; up to 500 channels, above that an empty state). Only name, game and viewers leave the module. The address carries the dock secret (`data.dockSecret`), added server side; routes `element/:slug` and `element-data/:slug` answer 404 without it. Unknown states (Twitch or Contacts down, consent unverified) give an empty frame, never an invented "nobody is live". `minCore` is now 0.5.0.
- `events/element.mjs`: `next` (first published, not cancelled, not postponed event whose end is in the future; `whenText` short form, site zone; place only if the option is on). Public data, no secret; routes `element` and `element-data` (120 requests per minute per visitor). No new permission.
- Both pages render nothing (the panel stays `hidden`) when there is nothing to show, follow `--ov-*` tokens with fallbacks, use the shared `data-ov-part` names (`panel`, `title`, `card`, `name`, `text`, `value`, `dot`, `badge`, `foot`) and draw demo content with invented names when the address receives `ov-demo=1`.

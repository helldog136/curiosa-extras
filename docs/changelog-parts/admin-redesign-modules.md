## Admin redesign, modules side: one control for the commissions state, Twitch activity on the Twitch page, shortcuts that name their right / Refonte de l'administration, côté modules : un seul contrôle pour l'état des commandes, l'activité Twitch sur la page Twitch, des raccourcis qui disent leur droit

*EN: no module version changes: the changes ship with the next release of each module. Commissions now needs Curiosa 0.6.0.*
*FR : aucune version de module ne change : les changements partent avec la prochaine version de chaque module. Les commandes demandent maintenant Curiosa 0.6.0.*

### What changes for you / Ce qui change pour vous

- **EN: Commissions: the state is one control.** "Open / Full / Closed" are three buttons side by side with the current one selected, inside the form with the places, the reopening date and the message, and one "Save" saves it all. The list of three "Choose" buttons, the "(current)" mark and the paragraph under it are gone; the explanation sits in the "?" bubble of the field.
- **FR : Commandes : l'état est un seul contrôle.** « Ouvertes / Complet / Fermées » sont trois boutons côte à côte avec l'état actuel sélectionné, dans le formulaire des places, de la date de réouverture et du message ; un seul « Enregistrer » enregistre tout. La liste de trois boutons « Choisir », la marque « (actuel) » et le paragraphe dessous ont disparu ; l'explication est dans la bulle « ? » du champ.
- **EN: Twitch activity: a tab on the Twitch page.** On Curiosa 0.31.0 and later, the journal and the event types also show on "Twitch > Activity" of the Networks group (the connector and the channel stay on "Channel"). The module keeps its own entry in the menu, and an older Curiosa shows it exactly where it was.
- **FR : Activité Twitch : un onglet sur la page Twitch.** Sur Curiosa 0.31.0 et suivants, le journal et les types d'événements s'affichent aussi sur « Twitch > Activité » du groupe Réseaux (le connecteur et la chaîne restent sur « Chaîne »). Le module garde sa propre entrée dans le menu, et un Curiosa plus ancien le montre exactement où il était.
- **EN: Blog and Pages: the dashboard shortcut says its right.** "Write an article" and "Add a page" lead to a page of the core; they now declare the module right `write` (Administration only, so who sees them does not change).
- **FR : Blog et Pages : le raccourci du tableau de bord dit son droit.** « Écrire un article » et « Ajouter une page » mènent à une page du cœur ; ils déclarent maintenant le droit de module `write` (Administration seulement : qui les voit ne change pas).

### For developers

- `docs/ERGONOMIE-ADMIN.md` is again a byte-for-byte copy of the core's (R34 to R37, the new bricks of the table in section 11).
- Commissions: field `kind: "segmented"` in the `saveQueue` form (`mode` is validated there; an older caller that sends no state keeps it); `setMode` stays for the assistant and the tests; `minCore` 0.2.5 → 0.6.0 (the compat kit requires 0.6.0 for `segmented`). Four texts leave the known gaps of `tests/ergonomics-baseline.json` (478 → 474).
- Twitch activity: `places` (`events` from the settings tab, `types` from the types tab) on `networks.twitch.events`; `catalogue/places.json` gives the page `networks.twitch` the tabs `main` ("Channel", first, so the sections without a tab stay there) and `events` ("Activity"). Rewards and the OBS dock are not placed, so `adminMenu` and the sidebar entry stay. The bridge module is still retired by Alerts overlay as before.
- Blog and Pages: `rights[write]` (default Administration yes, Editor no) and `dashboard.quickActions[].right: "write"`; Calendar's shortcut leads to its own page (`?tab=use`) and needs nothing. New tests `tests/twitch-events-place.test.mjs`, `tests/dashboard-core-link-right.test.mjs`, and a case in `tests/commissions.test.mjs`.

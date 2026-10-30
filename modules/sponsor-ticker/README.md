# Overlay sponsors (OBS) — module communautaire de Curiosa

Un bandeau « lower third » : une carte à découpe diagonale qui glisse depuis la droite toutes les
*N* secondes avec le nom du sponsor, son code promo, un résumé et un **QR code**. Trois styles (néon, ciné, broadcast),
couleur d'accent libre, badge « Nouveau » pendant 14 jours.

**Alimentation** (page de l'instance → *Sources de données*) :

| Sujet | Source |
|---|---|
| `sponsor.card` | Le module *Sponsors* (nom, texte, lien, code, logo, date), filtrable par étiquette |
| `core.entry` | N'importe quelle liste d'entrées ayant un code ou un lien (ex. le module *Codes promo* du cœur) |

L'overlay ne connaît aucun de ces modules. Les QR codes sont générés par le cœur (`ctx.api.qr`).

**OBS** : source navigateur sur `https://votre-site/overlays/<clé>` (1920×1080). Réglage avancé « Mode développeur » :
`?dev=1` (apparition après 0,5 s, toutes les 4 s) et `?seed=42` (même ordre à chaque fois), pour tester sans attendre.

**Textes longs et petites sources** : le titre se réduit (jusqu'à 18 px) puis passe sur 2 lignes avant d'être coupé ; le résumé
garde 2 lignes ; la légende du QR affiche le nom de domaine sans « www. » (coupé au milieu seulement s'il dépasse 22 caractères) ; la carte
grandit si le texte l'exige. Dans une source navigateur plus petite que la carte (800×200, 600×150, 340×100…), elle se met à
l'échelle pour rester entièrement visible, avec une marge. À 1920×1080 avec des textes courts, rien ne change.

**Dans une page d'overlay** (section « Overlays » de Curiosa 0.5.0 ou plus) : « Ajouter un élément » propose **Bandeau sponsors**. Le bandeau remplit son cadre à l'échelle (taille naturelle 720 × 180) et suit le style commun de la page (texte clair ou sombre, fond, angles) ; le style (néon, ciné, broadcast), l'accent, la fréquence et la durée restent ceux du module. Option : **Afficher le QR code** (jamais plus que le réglage du module). En mode test, le bandeau reste à l'écran, avec une carte d'exemple s'il n'y a aucun sponsor. Votre adresse OBS actuelle ne change pas.

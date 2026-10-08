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

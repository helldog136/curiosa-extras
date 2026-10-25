## Raid Twitch 2.2.2 : une page publique neutre, et vraiment absente quand elle est éteinte

## Améliorations
- Les mots par défaut de la page publique sont désormais neutres, en français comme en anglais : « En direct en ce moment » et « Voici qui est en direct sur Twitch maintenant. Passez leur dire bonjour ! ». Plus de « membres » ni de « communauté » écrits en dur. Si vous aviez saisi votre propre titre, votre propre phrase ou votre propre bouton, rien ne change pour vous.
- Une page publique éteinte n'existe plus du tout pour vos visiteurs : « page introuvable », sans rien de caché derrière, ni route de rafraîchissement qui réponde.
- L'onglet « Sélection du moment » explique mieux la case « Afficher la page publique » : quand elle est décochée mais que l'adresse existe, il dit ce que voient vos visiteurs et que la page n'apparaît nulle part.
- Une page éteinte n'apparaît plus nulle part : ni dans le menu, ni dans le plan du site que lisent les moteurs de recherche, ni dans `llms.txt`. Rien à retirer à la main. Il faut Curiosa 0.2.12 ou plus.

## Pour les développeurs
- `twitch-raid` 2.2.1 (aucune migration, aucun nouveau fichier serveur ; imports voisins toujours versionnés `?v=`). `public.mjs` : la route `members` éteinte répond `new Response("Not found", { status: 404 })`, identique à une route inconnue du cœur (avant : JSON `{"state":"off"}`). Textes `pub_*` et `fd_list_label` (FR/EN) neutres ; nouvelle clé `mo_page_off_addr` ; `moment-admin.mjs` l'affiche quand la page est éteinte et que `ctx.instance.basePath` est défini.
- `twitch-raid` 2.2.2 : `minCore` 0.2.12 et champ de manifeste `"pageSetting": "publicPage"` (réglage booléen, défaut `false`, `page: true`). Le cœur 0.2.12 masque alors la page du plan du site, de `llms.txt`, du menu, de la résolution `[...path]` et du script de page tant que le réglage est faux. `mo_page_off_addr` (FR/EN) ne parle plus d'une entrée restante du plan du site. Empreintes du dock 2.1 inchangées (`twitch-raid-compat`).
- Tests : `twitch-raid-page-optin` (404 + aucun plan de site côté module + route `members` identique à une route inconnue, textes neutres FR/EN en parité, titre saisi conservé, imports versionnés, avis d'administration).

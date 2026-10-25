## Raid Twitch 2.2.1 : une page publique neutre, et vraiment absente quand elle est éteinte

## Améliorations
- Les mots par défaut de la page publique sont désormais neutres, en français comme en anglais : « En direct en ce moment » et « Voici qui est en direct sur Twitch maintenant. Passez leur dire bonjour ! ». Plus de « membres » ni de « communauté » écrits en dur. Si vous aviez saisi votre propre titre, votre propre phrase ou votre propre bouton, rien ne change pour vous.
- Une page publique éteinte n'existe plus du tout pour vos visiteurs : « page introuvable », sans rien de caché derrière, ni route de rafraîchissement qui réponde.
- L'onglet « Sélection du moment » explique mieux la case « Afficher la page publique » : quand elle est décochée mais que l'adresse existe, il dit ce que voient vos visiteurs et qu'il faut retirer la page du menu en attendant.
- Limite connue : le plan du site que lisent les moteurs de recherche peut encore citer l'adresse d'une page éteinte (c'est le site qui le construit, pas le module). Sans effet pour vos visiteurs.

## Pour les développeurs
- `twitch-raid` 2.2.1 (aucune migration, aucun nouveau fichier serveur ; imports voisins toujours versionnés `?v=`). `public.mjs` : la route `members` éteinte répond `new Response("Not found", { status: 404 })`, identique à une route inconnue du cœur (avant : JSON `{"state":"off"}`). Textes `pub_*` et `fd_list_label` (FR/EN) neutres ; nouvelle clé `mo_page_off_addr` ; `moment-admin.mjs` l'affiche quand la page est éteinte et que `ctx.instance.basePath` est défini.
- Limite du cœur 0.2.11 constatée : `sitemap.ts`, `llms.ts`, `menu*.ts`, `[...path]/page.tsx` et la route `page-script` s'appuient sur `instance.basePath !== null` sans consulter le module. Changement proposé (non fait) : champ de manifeste `pageSetting` (clé d'un réglage booléen) traité comme « pas de page » quand il est faux.
- Tests : `twitch-raid-page-optin` (404 + aucun plan de site côté module + route `members` identique à une route inconnue, textes neutres FR/EN en parité, titre saisi conservé, imports versionnés, avis d'administration).

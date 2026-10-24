# Mascotte 1.0.0

## Nouveautés
- Une petite mascotte discrète dans un coin du site : elle dit bonjour, donne une astuce ou annonce une nouveauté, puis se range.
- Un dessin inclus aux couleurs de votre thème (clair ou sombre), ou votre propre image, ronde ou carrée, avec sa description.
- Vous écrivez ses phrases (140 caractères, 100 au plus), en français et en anglais, partout ou sur certaines pages. Deux gabarits : « Bienvenue discrète » et « Vide ».
- Elle annonce le prochain événement, un direct en cours ou la dernière nouveauté, seulement si l'information existe.
- Le visiteur peut la fermer, la réduire en pastille ou la couper pour toujours, sans cookie.
- Un assistant IA peut proposer des phrases en brouillon ; il ne publie jamais.

## Améliorations
- Une apparition par visite, jamais deux fois la même phrase, 3 messages par jour au plus.
- Sur téléphone, une petite pastille : la bulle s'ouvre seulement si on la touche.
- Aucune animation si « mouvement réduit » ; elle ne cache rien et reste sous le bandeau des cookies.
- Brouillon à l'installation : personne ne la voit avant « Publier ».

## Pour les développeurs
- Module à code, `minCore` 0.2.5, instance unique. `layout.head` + route `mascot.js` (empreinte, `immutable`), `mascot.css` à la demande, route `lines` (GET).
- Besoins facultatifs `event.source`, `twitch.live`, `youtube.live` ; sujets consommés `feed.item` et `mascot.hint` (**à lister dans « Sujets connus » de `docs/MODULES.md` du cœur**).
- Voisins importés avec la version du fichier principal ; tests `mascot-model`, `-lines`, `-admin`, `-routes`, `-client` (navigateur factice, `tests/helpers/mascotDom.mjs`), `-update`.

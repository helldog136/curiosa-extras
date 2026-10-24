## Mascotte 1.0.0 : un petit personnage discret pour donner de la vie au site

*Une mascotte qui dit bonjour, donne une astuce ou annonce le prochain événement, puis se range. Pour Curiosa 0.2.5 ou plus. Module nouveau : Mascotte 1.0.0.*

### Nouveautés

- **Une mascotte sobre, dans le coin de votre choix.** Une apparition par visite après quelques secondes, jamais deux fois de suite la même phrase, 3 messages par jour au plus, pas de son, aucune animation si « mouvement réduit ».
- **Dessin inclus ou votre image.** Le dessin (contente, curieuse, endormie) prend les couleurs de votre thème, clair ou sombre. Votre image : ronde ou carrée, description obligatoire.
- **Vos phrases, vos pages.** 100 phrases de 140 caractères, par langue, partout, sur l'accueil ou certaines pages ; variables comme `{nom_du_site}` ou `{prochain_evenement}` ; information absente = phrase non dite. Gabarits « Bienvenue discrète » et « Vide ».
- **Annonces sans dépendance.** Prochain événement, direct Twitch ou YouTube, dernière nouveauté : chaque source est facultative.
- **Le visiteur garde la main.** Croix de 44 px, pastille, coupure pour toujours, sans cookie. Sur téléphone, une pastille que l'on touche.
- Brouillon à l'installation, aperçu aux couleurs de votre site, bouton « Publier ».

### Pour les développeurs

- `layout.head` + route `mascot.js` (aucun script en ligne), `mascot.css` à la demande, route `lines`. Sujets consommés `feed.item` et `mascot.hint` ; **`mascot.hint` est à lister dans « Sujets connus » de `docs/MODULES.md` du cœur**. Détails : `docs/ideas/mascot.md`.

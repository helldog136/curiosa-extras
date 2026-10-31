# Mascotte

Un petit personnage discret dans un coin de votre site. Il fait une petite apparition, dit bonjour dans une bulle, donne une astuce ou annonce une nouveauté (le prochain événement, un direct en cours, le jeu du jour), puis se range. Il donne de la vie au site sans jamais le gêner.

Il s'adapte à n'importe quelle identité : le dessin inclus prend tout seul les couleurs de votre thème (clair ou sombre), ou vous montrez votre propre image. Les phrases sont les vôtres.

## Ce que voit la personne qui visite

- Une seule apparition par visite, après quelques secondes de calme (8 par défaut). Jamais deux fois la même phrase de suite, jamais plus de 3 messages par jour (réglable), jamais de son.
- Une bulle courte : une salutation, puis une annonce ou une astuce. Un bouton « Voir » quand la phrase a un lien.
- Il peut la **fermer** (croix de 44 px), la **réduire en pastille** (elle reste alors discrètement dans le coin) ou la **couper pour toujours**. Ce choix est gardé dans son navigateur, sans cookie, sans rien envoyer.
- Sur un petit écran, elle ne s'ouvre jamais toute seule : une pastille avec un point apparaît, la bulle s'ouvre si on la touche.
- Elle ne cache jamais le contenu : elle reste dans son coin, avec des marges, sous les fenêtres et le bandeau des cookies du site. Elle n'est pas imprimée.
- « Mouvement réduit » : aucune animation. La bulle ne se ferme jamais pendant qu'on la survole ou qu'on la lit au clavier (Échap pour la fermer).

## Ce que fait la personne qui gère le site

1. Installer le module : des phrases de départ (français et anglais, neutres) sont déjà là, la mascotte est en **brouillon** (personne ne la voit).
2. Onglet **Ma mascotte** : regarder l'aperçu, choisir le dessin inclus (trois humeurs : contente, curieuse, endormie) ou **sa propre image** (rond ou carré, description de l'image obligatoire), donner un **nom**. Cliquer sur **Publier**.
3. Onglet **Phrases** : ajouter, modifier, mettre en brouillon ou supprimer des phrases (140 caractères, 100 au plus). Choisir la langue et, si on veut, les pages où une phrase est dite. Deux **gabarits** : « Bienvenue discrète » et « Vide ».
4. Onglet **Quand et où** : toutes les pages, seulement l'accueil ou certaines pages ; en bas à droite ou à gauche ; options avancées (attente, durée des bulles, messages par jour).
5. Pour la revoir tout de suite : ouvrir `votre-site/?mascot=voir` (cela oublie aussi ce que le navigateur avait retenu).

### Les informations du site dans une phrase

Écrivez `{nom_du_site}`, `{nom}` (le nom de la mascotte), `{prochain_evenement}`, `{date_evenement}`, `{en_direct}`, `{titre_direct}`, `{derniere_nouveaute}` (les noms anglais `{site_name}`, `{name}`, `{next_event}`, `{event_date}`, `{live_now}`, `{live_title}`, `{latest_news}` marchent aussi). **Si l'information n'existe pas, la phrase n'est simplement pas dite** : pas d'erreur, pas de trou. La date est écrite dans la langue et l'heure de la personne qui visite.

## Fonctionne seule, s'enrichit avec les autres modules (tout est facultatif)

- Un module qui propose vos **événements à venir** → les phrases avec `{prochain_evenement}` s'activent.
- Votre chaîne **Twitch** ou **YouTube** → les phrases avec `{en_direct}` s'activent quand vous êtes en direct.
- Vos articles et vidéos publiés → `{derniere_nouveaute}`.
- Tout module peut confier une nouveauté à la mascotte (par exemple le jeu du jour) ; elle la dit comme une annonce. Option « Annoncer aussi les nouveautés des autres modules » pour couper cela.

## Ce qu'elle ne fait pas

- Pas de son, pas de suivi, pas de compte, pas de cookie, rien d'envoyé à un service extérieur.
- Une seule mascotte par site.
- Elle ne se montre pas si le navigateur refuse tout stockage (on ne pourrait pas respecter « une fois par visite »).
- Elle n'est pas un chat en direct : elle ne répond pas aux questions du public.

## Pour un assistant IA

Deux outils : lister les phrases (lecture seule) et en proposer une (toujours enregistrée en brouillon, jamais publiée ; non accordé d'office).

## Vie privée

Le navigateur de la personne qui visite retient ses choix (fermée, pastille, coupée), le nombre de messages du jour et les dernières phrases dites. Rien ne part vers le site ni vers un tiers. Le module le déclare dans la politique de confidentialité du site.

## Dans une page d'overlay

Depuis la 1.1.0 (Curiosa 0.5.0 ou plus), « Ajouter un élément » propose **Mascotte** dans la section « Overlays ». C'est une **version réduite** : un cadre d'overlay n'est pas une page de site, donc l'élément ne reprend rien de ce qui tient à l'affichage d'une page (coin de la page, pages concernées, « une fois par visite », délai, messages par jour, fermer / réduire / couper, mémoire du navigateur). Il montre le dessin inclus (ou votre image, avec sa description) et le **nom** choisis dans le module, avec une bulle qui dit ses phrases à tour de rôle (option **Secondes par phrase**).

**Pour un écran de stream, les phrases viennent uniquement de ce que vous avez écrit pour la mascotte** : vos phrases publiées (jamais un brouillon), dans la langue demandée, avec seulement `{nom_du_site}` et `{nom}`. Une phrase qui emploie une autre information (prochain événement, direct en cours, dernière nouveauté) n'est pas dite, et les nouveautés confiées par d'autres modules ne sont jamais montrées : ces informations viennent d'ailleurs. Une phrase réservée à certaines pages de votre site n'est pas dite non plus. Mascotte en brouillon : le cadre reste vide.

Le dessin inclus prend ici des couleurs fixes (pas celles de votre thème : un cadre d'overlay ne charge jamais le style du site) ; le texte suit le style commun de la page. Toutes les pages d'overlay qui montrent l'élément disent la même phrase au même instant ; rien n'est consommé. En mode test, une phrase d'exemple s'affiche s'il n'y a rien à dire. Sur votre site, rien ne change.

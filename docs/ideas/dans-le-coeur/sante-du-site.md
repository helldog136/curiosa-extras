# Santé du site (`site-check`)

## Le problème
« Mon site est-il en bon état ? » Personne ne relit son site image par image, ne teste ses liens ni ne compare ses traductions. Les défauts s'accumulent sans bruit : images sans description, pages sans texte pour Google, liens morts.

## Pour qui
Emma et toute personne non technique qui gère un site Curiosa. Aucun réglage n'est nécessaire.

## Ce que voit le visiteur
Rien : le module n'a pas de page publique et n'ajoute rien au site.

## Ce que fait Emma, pas à pas
1. Menu « Santé du site » (onglet « Santé »). 2. « Vérifier maintenant » (bouton « en cours » du cœur). 3. Un résumé : « Tout va bien » ou « Quelques petites choses à regarder » avec trois pastilles (Important / Conseillé / Pour info), sans note chiffrée. 4. Des remarques regroupées, chacune en une phrase, une explication « pourquoi » et, par ligne, **Corriger** (ouvre l'écran d'administration de la page, du lien ou des réglages) et **Ignorer** (masque, avec « Tout réafficher »). 5. Si des liens restent à visiter : barre de progression et bouton « Continuer la vérification ». 6. En bas : « Ce que je n'ai pas pu regarder » et l'historique des 5 dernières vérifications.

## Ce qui est vérifié (uniquement par ce que l'API des modules montre)
| Remarque | Importance | Source |
|---|---|---|
| Images du texte sans description (Markdown vide, `<img>` sans `alt`) | Important | `ctx.api.entries.list` (texte) |
| Titre vide | Important | entrées |
| Lien vers une page du site qui n'existe plus (rubrique à adresse propre, toutes langues) | Important | adresses des entrées + `instances.list` |
| Lien externe qui renvoie 404/410 ; image distante disparue | Important | visite des liens |
| Page sans résumé (description pour les moteurs) | Conseillé | entrées (sauf liens sortants et codes) |
| Titres identiques dans une rubrique | Conseillé | entrées |
| Page absente ou identique au texte d'origine dans une autre langue | Conseillé | une lecture par langue |
| Accueil sans accroche (description de l'accueil) | Conseillé | `ctx.api.site` |
| Lien qui ne répond pas, erreur du site, boucle de renvois | Conseillé | visite |
| Pas d'adresse de contact ; site sans page publiée | Pour info | `ctx.api.brand`, entrées |
| Site qui refuse les visites automatiques ; lien qui a changé d'adresse ; adresse sans « s » ; lien non vérifiable cette fois | Pour info | visite |

Liens externes visités : ceux des textes, des champs d'adresse des entrées et des boutons de réseaux sociaux (sujet `social.link`).

## Garde-fous des visites
À la demande seulement (aucune tâche, aucun minuteur). Un passage à la fois (réservation en mémoire + date de fin en données). 200 liens au plus, 25 par site, répartis pour ne jamais frapper deux fois de suite le même site ; 250 ms entre deux visites, 1 s pour le même site ; HEAD puis GET de 2 Ko seulement si besoin ; délai 6 s par demande, 14 s par lien ; 5 redirections suivies à la main, chacune revérifiée ; un paquet s'arrête à 20 s ou 60 liens ; un site qui répond « trop de demandes » n'est plus contacté. Au-delà de 200 liens, la vérification suivante reprend là où la précédente s'est arrêtée. Tout passe par `ctx.api.net` (disjoncteur, pauses, journal) avec un seau de limites propre au module.
**Sécurité** : jamais d'adresse numérique, de nom interne (`localhost`, `.local`, `.lan`, nom sans point…), de port autre que 443, d'identifiants dans l'adresse, ni de nom qui se résout vers une adresse privée/locale/réservée (résolution `node:dns` bornée à 3 s, faite avant toute visite et à chaque redirection) ; destination non sécurisée non visitée. Limite connue : la résolution du cœur (`fetch`) est refaite ensuite ; une réponse DNS changeante entre les deux (« rebinding ») n'est pas couverte sans extension du cœur.

## Données gardées et vie privée
Stockage de l'instance : `report` (dernier rapport, 60 lignes par groupe au plus), `run` (vérification en cours, effacée à la fin, ≤ 200 liens), `state` (où reprendre), `history` (5), `ignored` (200 au plus). Aucune donnée de visiteur, aucun cookie. Les sites visités reçoivent une visite identifiée « SiteHealthCheck/1.0 » avec l'adresse du site, sans cookie ni identifiant.

## Réglages
« Vérifier aussi les liens vers d'autres sites » (oui). Avancés : nombre de liens par vérification (200), sites à ne jamais visiter.

## Outils pour l'assistant IA
`site_health_status` (lecture seule, ne contacte aucun site) ; `site_health_run` (écriture explicite, `continue: true` pour la suite).

## Droits
Actions réservées aux administrateurs (forme « fonction » des actions). Voir « Pour la suite ».

## Ce qui n'est pas fait, et pourquoi (honnêteté affichée aussi dans l'écran)
- **Menu vide** : le cœur n'expose pas le menu aux modules.
- **Titres/descriptions des pages d'autres extensions** (accueil, contact…) : non lisibles (`instances.list` ne donne ni description ni titre de page).
- **Images/fichiers importés** : existence non vérifiable (pas d'accès aux fichiers, et on ne se visite pas soi-même).
- **Images de couverture sans description** : le cœur les traite comme décoratives (`alt=""`), il n'y a pas de champ de description.
- **Pagination des entrées** : `entries.list` plafonne à 200 par rubrique et par langue, sans décalage ; dit à l'écran.
- **Traduction « identique »** : repérée par texte égal à celui de la langue d'origine ; `EntrySummary` n'indique pas le repli, d'où le mot « semble ».
- Une personne qui n'est pas administratrice mais a le droit d'ouvrir le module ne peut pas lancer de vérification (voir ci-dessous).

## Extensions du cœur que cela demanderait (non faites)
1. `ctx.api.nav` (menu en lecture seule) pour « menu vide ».
2. `EntrySummary` : `isFallback`, `availableLocales`, `expired`, et `entries.list({ offset })`/curseur avec corps.
3. `ctx.api.net.request({ redirect: "follow", maxRedirects })` et une garde « adresses publiques seulement » intégrée (résolution vérifiée à la connexion) : aujourd'hui le module la refait.
4. Un suivi d'avancement et une reprise automatique côté cœur pour les actions longues (`ctx.api.progress`), pour ne pas cliquer « Continuer ».
5. Lecture des titres et descriptions des pages de module (`page()` : `title`, `description`) ou d'un résumé SEO de l'instance.
6. Le kit de test (`def.matches`) ne reconnaît pas la forme `{ right, run }` pour les formulaires du panneau : le module aurait pu offrir un droit « lancer une vérification » à un rôle personnalisé.
7. Légende d'image (texte alternatif) pour les couvertures.

## Idées pour la suite
Vérification en tâche planifiée optionnelle (hebdomadaire, avec courriel seulement s'il y a du nouveau) ; contrôle des raccourcis du module de liens courts ; poids des images ; comparaison avec la vérification précédente (« 2 remarques de moins »).

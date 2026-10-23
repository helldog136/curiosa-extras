# Dix idées de modules pour Curiosa (2026-10-22)

Public visé : des personnes qui ont un site personnel et pas de compétences techniques (créatrices et créateurs de contenu, streameuses, artistes, petites associations, indépendants). Fil rouge : « Emma », qui n'ouvre jamais un fichier de configuration. Chaque module doit marcher **sans réglage** après installation, parler simplement (FR + EN), être utilisable sur téléphone, dire quoi faire quand quelque chose ne va pas (erreur sous le champ), et ne jamais afficher de secret.

Règles communes : un propriétaire par donnée, aucune dépendance forte inutile, rien de non borné (pagination, caches avec expiration, pas de minuteur de fond), défensif face aux pannes d'API externes, aucune donnée personnelle de visiteur gardée plus que nécessaire (pas de cookie de suivi, pas d'adresse IP en clair), et rien d'installé d'office.

---

## 1. Mentions légales (`legal-pages`)
**Problème.** Chaque site doit avoir des mentions légales, une politique de confidentialité et une information sur les cookies. Emma ne sait pas quoi écrire, copie un texte d'un autre site (souvent faux) ou n'en met pas.
**Ce que fait Emma.** Un petit assistant de 6 à 8 questions en mots simples (« Qui édite ce site ? », « Habitez-vous en Belgique, en France… ? », « Récoltez-vous des adresses e-mail ? », « Vendez-vous quelque chose ? », « Qui héberge le site ? ») avec des réponses préremplies à partir de ce que le site sait déjà (nom du site, modules installés : formulaire de contact, statistiques, livre d'or…).
**Ce que voit le visiteur.** Trois pages claires (« Mentions légales », « Confidentialité », « Cookies ») générées à partir des réponses, en français et en anglais, avec un lien discret dans le pied de page.
**Ce qui le rend utile.** Le texte de confidentialité s'adapte aux modules réellement actifs (il ne parle pas de statistiques si elles sont coupées) et se met à jour avec un rappel visible quand un module qui récolte des données est ajouté. Il dit en une ligne en haut de l'admin « modèle d'aide, ce n'est pas un conseil juridique ».
**Ce qu'on ne fait pas.** Pas de bandeau de cookies inutile : le module dit honnêtement si le site n'en dépose aucun.

## 2. Liens courts et QR codes (`short-links`)
**Problème.** On colle un lien dans un panneau de stream, une affiche ou un flyer : il est long, illisible, impossible à retenir, et on ne sait jamais s'il sert.
**Ce que fait Emma.** « Nouveau lien » : elle colle une adresse (tolérante), le module propose un nom court lisible (`monsite.be/go/merch`), crée le lien et affiche tout de suite un **QR code** téléchargeable (SVG et PNG) prêt à imprimer.
**Ce que voit le visiteur.** Une redirection instantanée. Si le lien est cassé ou expiré, une page aimable qui propose l'accueil du site.
**Ce qui le rend utile.** Un petit compteur de clics par jour (sans cookie ni adresse IP), pour savoir quel panneau ou quelle affiche amène du monde. Date d'expiration facultative (une offre qui se termine). Redirections « changer la destination sans changer le QR déjà imprimé ».
**Sécurité.** Seuls les liens http(s) sont acceptés ; pas de redirection vers une adresse interne ; nombre de liens borné et pagination.

## 3. Mur des remerciements (`thanks-wall`)
**Problème.** On veut remercier sa communauté (abonnés, modérateurs, donateurs, bêta-testeurs) mais personne n'a le temps de retaper les noms et de retrouver les photos.
**Ce que fait Emma.** Elle choisit une ou plusieurs catégories de **Contacts** (par exemple « Modérateurs », « Soutiens ») : le mur se construit tout seul avec les photos et les noms. Elle peut aussi ajouter un message court par personne et mettre quelqu'un « à l'honneur ce mois-ci ».
**Ce que voit le visiteur.** Une belle page « Merci ! » en grille de cartes avec photos, groupes (« Modération », « Mécènes »…), et une mise à l'honneur. Une personne peut demander à ne pas apparaître : le module respecte un simple interrupteur « ne pas montrer » dans la fiche.
**Intégration.** Lit Contacts (service `contact.book`, besoin obligatoire) ; ne recopie jamais nom ou photo. Sans Contacts, propose de l'installer.
**Ce qu'on ne fait pas.** Pas de récupération automatique des abonnés Twitch (cela demande des droits que l'utilisatrice n'a pas toujours) : on s'appuie sur ses fiches.

## 4. File de commandes (`commissions`)
**Problème.** Les artistes, illustratrices, créateurs de modèles VTuber ou de bijoux répondent cent fois aux mêmes questions : « Vos commandes sont-elles ouvertes ? », « Combien ? », « Où j'en suis dans la file ? ».
**Ce que fait Emma.** Elle règle « ouvert / complet / fermé » d'un clic, le nombre de places, et ses formules (nom, prix indicatif, délai, ce qui est inclus). Elle reçoit les demandes dans une liste simple (nouvelle → acceptée → en cours → livrée), avec des notes privées.
**Ce que voit le visiteur.** Une page « Commandes » qui dit clairement l'état (« 2 places libres », « Complet, réouverture en mars ») et les formules, puis un formulaire court (nom, e-mail, ce que la personne veut, lien d'inspiration). Après l'envoi, un **lien de suivi privé** montre où en est sa commande, sans compte à créer.
**Intégration.** À l'acceptation, propose de créer la fiche dans Contacts (service `contact.book`, facultatif). Pas de paiement : le module ne touche jamais à l'argent.
**Protection.** Champ piège et limite de demandes par heure ; adresse e-mail de la cliente visible seulement de l'équipe.

## 5. Questions fréquentes (`faq`)
**Problème.** On répète les mêmes réponses en chat, par message, en commentaire. Et les moteurs de recherche adorent une bonne FAQ.
**Ce que fait Emma.** Elle écrit des questions/réponses regroupées par thèmes, glisse pour réordonner. Elle voit aussi la **boîte « questions posées »** : les visiteurs peuvent poser une question qui manque, elle la transforme en réponse publiée en un clic.
**Ce que voit le visiteur.** Des questions repliables, une recherche qui filtre en tapant (accents ignorés), un bouton « Cela m'a aidé / Pas vraiment » (compteur sans suivi), un lien direct vers une question précise.
**Ce qui le rend utile.** Marquage de données structurées FAQ pour la recherche, et un outil pour l'assistant IA qui propose des réponses à partir des questions posées.

## 6. Témoignages (`testimonials`)
**Problème.** Un petit commerce ou un créateur sait que les avis rassurent, mais n'a ni le temps de les collecter ni la méthode.
**Ce que fait Emma.** Elle partage un lien « Laissez un avis » (ou un QR via le module des liens courts). Chaque avis arrive en attente : elle lit, valide ou refuse en un clic, peut mettre en avant ses préférés.
**Ce que voit le visiteur.** Un bandeau ou une page d'avis (grille ou défilement lent, sans animation si la personne préfère moins de mouvement), avec étoiles facultatives, prénom, photo facultative. La personne qui écrit coche une case « J'accepte que mon avis soit publié ».
**Utile.** Données structurées d'évaluation moyenne ; export CSV ; suppression d'un avis à la demande de son auteur. Protection contre le spam (piège + limite).

## 7. Sondages (`polls`)
**Problème.** Décider du jeu de demain, du nom d'une mascotte, du prochain tutoriel : on fait des sondages sur des plateformes tierces, les résultats se perdent et personne ne les retrouve.
**Ce que fait Emma.** « Nouveau sondage » : une question, 2 à 8 choix, une date de fin facultative, choix unique ou multiple. Elle copie le lien ou l'affiche sur la page d'accueil.
**Ce que voit le visiteur.** Il vote en un geste, voit les résultats en barres claires (avec le nombre de voix) ; à la fin, le sondage se ferme et montre le résultat final. Un vote par personne **sans compte ni cookie de suivi** (un jeton anonyme dans le navigateur + limite côté serveur).
**Bonus.** Une **source navigateur pour OBS** : les résultats en direct à l'écran pendant un stream. L'historique des sondages passés reste consultable.

## 8. Compte à rebours (`countdown`)
**Problème.** Annoncer un lancement, une sortie, un stream spécial, un anniversaire ou une convention : tout le monde est dans un fuseau différent, et personne ne sait quand « 20 h » tombe chez lui.
**Ce que fait Emma.** Un nom, une date et une heure, son fuseau (détecté). Elle choisit où l'afficher (accueil, page dédiée, overlay de stream).
**Ce que voit le visiteur.** Les jours, heures, minutes qui défilent, **l'heure locale du visiteur** écrite en toutes lettres (« samedi à 21 h chez vous »), un bouton « Ajouter à mon agenda » (.ics) et, une fois l'heure passée, un message choisi par Emma (« C'est parti ! » avec lien).
**Détails.** Plusieurs comptes à rebours possibles ; ceux qui sont passés disparaissent tout seuls après un délai ; sans JavaScript, la date reste lisible.

## 9. Contrôle du site (`site-check`)
**Problème.** « Mon site est-il en bon état ? » Personne ne vérifie les liens cassés, les images sans texte alternatif, les pages sans description, les mots mal traduits.
**Ce que fait Emma.** Une page « Santé de mon site » avec un bouton « Vérifier maintenant ». Résultat en quelques lignes humaines, classées par importance : « 3 images n'ont pas de description (important pour les personnes malvoyantes) », « Le lien vers ‹ Ma boutique › ne répond plus », « La page ‹ À propos › n'a pas de description pour les moteurs de recherche ». Chaque ligne a un bouton « Corriger » qui ouvre le bon écran.
**Garde-fous.** Vérification à la demande (jamais en arrière-plan), bornée (nombre de liens, délais courts, un hôte à la fois, pas de rafale), et fondée sur ce que les modules et le cœur exposent de façon propre.
**Honnêteté.** Si une vérification n'est pas possible, il le dit plutôt que de se taire.

## 10. Cahier de contenu (`content-planner`)
**Problème.** Les idées de vidéos, d'articles, de posts sont éparpillées (notes téléphone, messages à soi-même), on oublie, on republie trop tard.
**Ce que fait Emma.** Un tableau très simple en trois colonnes : « Idées », « En préparation », « Publié ». Une idée = un titre + une phrase + des cases à cocher d'étapes (script, miniature, description, publication) + une date visée + les réseaux concernés. Un **rythme** facultatif (« une vidéo par semaine ») avec un avertissement doux quand on prend du retard.
**Ce que voit Emma sur son téléphone.** Une liste d'abord (pas de glisser-déposer obligatoire), un bouton « J'ai une idée ! » toujours à portée de pouce qui ne demande qu'un titre.
**Intégration.** Les outils pour l'assistant IA permettent de dicter « ajoute une idée : tutoriel sur… » ; privé : rien n'est jamais affiché publiquement.

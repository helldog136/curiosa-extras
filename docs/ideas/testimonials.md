# Témoignages (`testimonials`) — description complète

Module 1.0.0, cœur 0.2.5 ou plus, instance unique, page publique sur `/avis`. Type : **module à code** (page publique, route d'envoi, administration, tâche quotidienne). Un module de contenu « zéro code » ne suffisait pas : il faut un formulaire public, un accord enregistré avec sa date, une modération, un lien de retrait privé et des chiffres (moyenne).

## Le problème et pour qui
Un petit commerce, une créatrice, un artiste, une association sait que les avis rassurent, mais n'a ni la méthode ni le temps. Emma veut un lien à partager, lire chaque avis avant publication, mettre ses préférés en avant, et ne jamais se retrouver avec des données personnelles qu'elle ne sait pas gérer.

## Ce que voit le visiteur
- **Lien « Laisser un avis »** (`/avis/laisser`) : un formulaire pensé pour le téléphone (un champ par ligne, boutons de 44 à 48 px, aucun défilement horizontal). Prénom ou pseudo ; note en étoiles (facultative par défaut, réglable : facultative / obligatoire / aucune) ; avis (600 caractères par défaut) ; e-mail seulement si Emma l'a demandé, et facultatif ; **case d'accord obligatoire** (« J'accepte que mon avis (texte, note et prénom ou pseudo) soit publié sur ce site ») avec un lien vers la page de confidentialité du site.
- **Erreurs** : sous chaque champ, avec un exemple et ce qu'il faut faire ; un résumé en haut reçoit le focus et renvoie vers chaque champ ; ce qui avait été écrit revient dans le formulaire (le brouillon n'est gardé que 30 minutes ; l'accord n'est jamais pré-coché).
- **Après l'envoi** : une page « Merci » qui dit que l'avis sera lu avant d'être publié, et donne **un lien privé** pour le retirer quand on veut. Ce lien n'est pas envoyé par e-mail.
- **Page des avis** (`/avis`) : note moyenne (à partir de 3 notes, sur les seules notes données), bouton « Laisser un avis », filtre par note (à partir de 6 notes : `/avis/etoiles/5`), puis les avis en **grille** paginée (12 par page) ou en **défilement lent** (réglage). Chaque avis : photo ou initiale, prénom, date, étoiles, texte, mention « Favori » si c'en est un.
- **Étoiles accessibles** : chaque note est un élément avec un texte (« Note : 4 sur 5 », lu à voix haute) en plus des icônes ★★★★☆ et de « 4/5 ».
- **Défilement lent** : jamais sans bouton pause (une case à cocher « Pause du défilement », sans script) ; il se met aussi en pause au survol et au clavier ; **aucun mouvement** pour les personnes qui ont demandé moins d'animation (les avis deviennent une grille) ; en dessous de 4 avis, une grille. La liste complète est sur `/avis/tous` (grille paginée).
- **Accueil** : trois morceaux : « Avis à la une » (3 par défaut, de 1 à 12, grille ou défilement lent, favoris d'abord), « Note moyenne » (petit encart), « Invitation à laisser un avis ».

## Ce que fait Emma, pas à pas
1. Installe le module : rien à régler. Elle copie le lien dans l'onglet **Partager** (avec le QR code sur fond blanc, à télécharger).
2. Les avis arrivent dans **À valider** (pastille dans le menu, e-mail de prévenance si le serveur d'e-mail est réglé). Elle lit, clique **Publier** ou **Refuser**. Un conseil lui rappelle de ne pas refuser un avis seulement parce qu'il est critique.
3. **Favori** (bouton qui bascule) met un avis en premier. **Modifier** : corriger une faute, ajouter une photo si la personne l'a envoyée, donner un numéro de place (ordre « à la main »), effacer l'adresse e-mail gardée. **Supprimer** (à la demande de l'auteur, par exemple) efface tout.
4. **Ajouter un avis reçu ailleurs** (message, e-mail) : elle coche que la personne est d'accord ; l'avis entre lui aussi « à valider ».
5. **Télécharger les avis** : un tableur avec la preuve d'accord de chacun (date et texte exacts). Les e-mails n'y sont qu'avec le droit « voir les adresses e-mail » ET le bouton « avec les e-mails ».
6. Recherche, filtre par note, onglets À valider / Publiés / Refusés, 50 avis par page.

## Réglages (tout marche sans rien régler)
Titre, texte d'accueil ; présentation (grille par défaut / défilement lent) ; ordre (favoris d'abord par défaut / plus récents / mieux notés / à la main) ; étoiles (facultatives par défaut) ; note moyenne montrée (oui) ; demander l'e-mail (non) ; prévenir par e-mail (oui). Avancés : avis par page (12), longueur maximale (600), avis par heure et par visiteur (3), jours de conservation de l'e-mail (90), aide aux moteurs de recherche (non) avec ce que les avis décrivent (nom et sorte).
**Il n'existe volontairement aucun réglage « publier sans validation ».**

## Données gardées et vie privée
- Un document par avis : état, prénom, texte, note, favori, place, photo (ajoutée par Emma seulement), e-mail et sa date de fin, **accord (texte, date, langue, recueilli par le visiteur ou par Emma)**, empreinte du lien de retrait (le lien lui-même n'est jamais gardé), dates.
- Pas de cookie. Pas d'adresse IP gardée : les limites de débit vivent en mémoire, avec une empreinte mélangée à un sel tiré au hasard à chaque démarrage. Le visiteur est identifié par le DERNIER nom de l'en-tête de transfert (celui qu'ajoute le serveur devant le site), jamais par le début, qui peut être inventé.
- Durées : e-mail effacé tout seul après 90 jours (l'avis reste) ; avis refusé effacé après 30 jours ; brouillon de formulaire effacé après 30 minutes ; tout part avec l'avis quand il est supprimé ou retiré par son auteur. Le ménage tourne une fois par jour (tâche du cœur) et se rejoue sans effet.
- La déclaration `privacy` du manifeste alimente la page de confidentialité du site.
- Jamais d'adresse e-mail dans : la page publique, l'accueil, la source de stream, les outils pour assistants, la sauvegarde lisible. Elle n'est lisible que dans l'administration avec le droit `email.view`.

## Protections des routes publiques
Champ piège (`website`) ; trois limites : 20 tentatives par heure et par visiteur (bonnes ou mauvaises), 3 avis par heure et par visiteur (réglable), 40 avis par heure pour tout le site ; validation stricte (longueurs, un seul lien au plus, e-mail, note de 1 à 5) ; tout texte échappé à l'affichage, photo et liens vérifiés ; réponses toujours des redirections vers une page du site (jamais d'adresse reçue) ; plafonds : 1 000 avis, 200 en attente, 500 publiés, 100 brouillons ; le même avis envoyé deux fois n'est gardé qu'une fois ; méthode POST exigée (le lien de retrait ne supprime rien en GET).

## Moyenne et données structurées : le choix
Les règles des moteurs (avis réels, visibles, non sélectionnés, pas d'avis sur soi-même) rendent ce balisage risqué. Choix : **éteint par défaut, réservé au mode avancé**, avec une aide qui dit à qui il convient. Quand il est activé : seulement si Emma a nommé ce que les avis décrivent (service, produit, cours, application), au moins 5 notes réelles, la moyenne comptant TOUS les avis publiés notés (jamais seulement les favoris), uniquement sur la page principale des avis (là où ils se lisent) et jamais sur le formulaire, l'accueil ou les pages de remerciement. Le JSON est posé dans le corps de la page (et non dans l'emplacement d'en-tête du cœur, qui s'applique à toutes les pages du site), avec `<`, `>`, `&` échappés pour ne jamais pouvoir fermer la balise.

## Outils pour l'assistant IA
`testimonials_list` (lecture, 20 par page, curseur, filtres état et note, jamais d'e-mail), `testimonials_summary` (lecture), `testimonials_decide` (publier — seulement avec accord —, refuser, remettre à valider, favori ; désactivée par défaut), `testimonials_delete` (destructive, désactivée par défaut).

## Intégrations
Aucune dépendance. Fournit le sujet `overlay.item` (les favoris, ou à défaut les 5 premiers avis) pour une source navigateur de stream. Droits du module : `reviews.moderate`, `reviews.delete`, `email.view`, `reviews.export` (les trois derniers « sensibles »). Sauvegarde lisible : `reviews.csv` sans e-mails.

## Bornes et limites
1 000 avis au plus ; liste d'administration lue en tranches de 500, 50 par page ; export lu morceau par morceau. Le lien de retrait est une adresse secrète : qui la possède peut retirer l'avis (elle peut apparaître dans l'historique du navigateur ou les journaux du serveur web). Le texte de l'e-mail de prévenance est dans la langue du visiteur.

## Ce qui n'est pas fait, et pourquoi
- **Photo envoyée par le visiteur** : l'API des modules ne permet pas d'enregistrer un fichier, et ranger une image dans les données sans la réduire ni la vérifier serait mauvais (taille, données personnelles en plus). Solution la plus proche : Emma ajoute la photo à l'avis, ou l'initiale colorée sert d'avatar.
- **Bouton pause en JavaScript, messages instantanés sous les champs** : le contenu HTML des modules n'exécute pas de script de façon fiable ; tout est fait avec un vrai formulaire (aller-retour au serveur, brouillon de 30 minutes) et une case à cocher.
- **Envoi du lien de retrait par e-mail** : refusé (cela ferait de la page un envoyeur de courrier à n'importe qui).
- Pas de réponse publique, pas de preuve d'achat, pas de glisser-déposer pour l'ordre (un numéro de place à la place), pas d'envoi en masse de validations.

## Idées pour la suite
Réponse publique d'Emma sous un avis ; lien avec le module des liens courts pour un QR plus lisible ; invitation par e-mail via le carnet de contacts ; statistiques « avis par mois » ; import d'avis depuis un fichier ; envoi du ménage aussi à la demande.

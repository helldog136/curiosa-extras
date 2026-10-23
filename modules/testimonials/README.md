# Témoignages

Laissez votre communauté vous écrire un avis, et montrez les meilleurs sur votre site, sans que rien ne soit publié sans que vous l'ayez lu.

## À quoi ça sert

- Vous partagez **un lien « Laisser un avis »** (ou son QR code, à imprimer ou à mettre à l'écran). La page s'ouvre très bien sur un téléphone.
- Chaque avis arrive **« à valider »**. Vous le lisez, vous le **publiez** ou vous le **refusez** d'un clic. Un avis n'est jamais publié tout seul, et jamais sans l'accord de son auteur.
- Vous choisissez vos **favoris** : ils passent en premier.
- Les visiteurs voient une page d'avis en **grille** ou en **défilement lent** (avec un bouton pause ; sans mouvement du tout pour les personnes qui préfèrent moins d'animations), avec la **note moyenne**, et un filtre par note.
- Vous pouvez montrer **3 avis sur la page d'accueil** (Accueil → ajouter une section → « Avis à la une »), la note moyenne, ou une invitation à laisser un avis.

## Ce que la personne remplit

Prénom ou pseudo, note en étoiles (facultative, réglable), avis, et une **case à cocher obligatoire** : « J'accepte que mon avis soit publié sur ce site ». Le texte exact de cet accord et sa date sont gardés avec l'avis. L'adresse e-mail n'est demandée que si vous le décidez ; elle est facultative pour la personne, privée, jamais publiée, et effacée toute seule au bout de 90 jours.

Si un champ est mal rempli, le message apparaît juste en dessous, avec un exemple, et la personne ne retape rien. Après l'envoi, elle reçoit **un lien privé pour retirer son avis** quand elle veut (tout est alors effacé).

## Ce que vous faites

1. Ouvrez l'extension : l'onglet **Avis** liste les avis (à valider, publiés, refusés), avec recherche, filtre par note et 50 avis par page.
2. **Publier**, **Refuser**, **Modifier** (corriger une faute, ajouter une photo si la personne vous l'a envoyée, donner une place), **Favori**, **Supprimer** (par exemple à la demande de l'auteur).
3. **Ajouter un avis reçu ailleurs** (message, e-mail) : vous cochez que la personne est d'accord ; il entre aussi « à valider ».
4. L'onglet **Partager** donne le lien, le QR code à télécharger, et la marche à suivre pour l'accueil.
5. **Télécharger les avis** : un fichier pour votre tableur, avec la preuve d'accord de chaque personne (les e-mails n'y sont qu'avec le droit « voir les adresses e-mail »).

## Réglages (tout marche sans rien régler)

Titre et texte d'accueil, présentation (grille ou défilement lent), ordre (favoris d'abord par défaut, plus récents, mieux notés, ou à la main), étoiles (facultatives, obligatoires, aucune), note moyenne montrée ou non, demande d'e-mail, e-mail de prévenance. En mode avancé : avis par page, longueur maximale, limite par heure, durée de conservation de l'e-mail, et l'aide aux moteurs de recherche.

## Honnêteté de la note moyenne

La moyenne compte **tous** les avis publiés qui ont une note, à partir de 3 notes. Refuser un avis seulement parce qu'il est critique fausserait cette note : le module vous le rappelle. Les données pour moteurs de recherche (étoiles dans les résultats) sont **éteintes par défaut** et réservées au mode avancé : elles ne sont permises que pour un produit, un service ou un cours précis (pas pour vous-même), avec au moins 5 notes réelles, et seulement sur la page où ces avis se lisent.

## Ce que le module ne fait pas

- Pas de photo envoyée par les visiteurs (vous pouvez en ajouter une vous-même à un avis) : une photo est une donnée personnelle de plus à modérer, et le module ne peut pas la réduire.
- Pas de réponse publique aux avis, pas de vérification que la personne est vraiment cliente.
- Pas d'avis publié automatiquement : jamais.
- Pas de cookie, pas d'adresse IP gardée (les limites contre le spam vivent en mémoire, sans adresse lisible).

## Pour les développeurs

Module à code (page publique, route d'envoi, administration, tâche quotidienne de ménage). Données : un document par avis (`reviews`) et quelques brouillons de 30 minutes (`drafts`). Plafonds : 1 000 avis, 500 publiés, 200 en attente. Actions pour assistants : `testimonials_list`, `testimonials_summary`, `testimonials_decide`, `testimonials_delete` (destructive, désactivée par défaut) ; jamais d'adresse e-mail. Sujet fourni : `overlay.item` (favoris). Droits : `reviews.moderate`, `reviews.delete`, `email.view`, `reviews.export`.

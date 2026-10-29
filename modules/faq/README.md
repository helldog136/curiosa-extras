# Questions fréquentes

Une page « Questions fréquentes » prête à l'emploi : vos questions et réponses sont rangées par catégories, chaque question s'ouvre et se referme d'un clic, et le public peut chercher, donner son avis et vous poser la question qui manque.

Fini de répéter les mêmes réponses en direct, par message ou en commentaire : vous les écrivez une fois, ici.

## Ce que voit la personne qui visite

- Une liste de questions qui s'ouvrent et se referment (cela marche même si JavaScript est coupé dans son navigateur).
- Une **recherche** qui filtre en tapant, sans tenir compte des accents ni des majuscules.
- Un bouton **« Cela m'a été utile / Pas vraiment »** sous chaque réponse. Un seul avis par question et par personne ; aucun compte, aucun cookie de suivi.
- Un **lien direct** vers chaque question (à coller dans un message ou dans le chat) : la question s'ouvre toute seule.
- Une petite boîte **« Vous ne trouvez pas votre réponse ? »** pour poser sa question. Aucune donnée personnelle n'est demandée.
- Sur un téléphone, tout est pensé pour le pouce : grands boutons, pas de défilement de côté.

## Ce que vous faites

1. **Installez le module** : la page `/faq` existe tout de suite. Deux exemples de réponses sont déjà prêts, en brouillon (invisibles pour le public) : modifiez-les ou supprimez-les.
2. Dans l'onglet **Ma FAQ**, cliquez sur **Ajouter une question**. Écrivez la question et la réponse (une seule langue suffit), choisissez une catégorie, puis « Publiée ». Pour écrire en gras, en italique, ajouter un lien ou une liste, une petite aide s'affiche sous le champ.
3. Pour **ranger**, créez des catégories (par exemple « Abonnements », « Commandes ») et changez l'ordre avec les boutons **Monter / Descendre**. Rien à glisser-déposer.
4. Dans l'onglet **Questions reçues**, lisez ce que le public a demandé. Une question posée plusieurs fois est comptée une seule fois (« 3 fois »). Cliquez sur **Répondre**, écrivez la réponse, enregistrez : elle est publiée et la question quitte la boîte.
5. De temps en temps, regardez la colonne **Utile / Pas vraiment** : une réponse qui déçoit souvent mérite d'être réécrite.

### Plusieurs langues

Chaque question peut exister en français, en anglais, ou dans les deux. Si une question n'existe que dans une langue, la personne qui visite de l'autre langue la voit quand même, avec la mention « Cette réponse n'existe pas encore dans votre langue » (réglage « Montrer aussi les questions écrites dans une autre langue » : décochez-le pour la cacher).

### Avec un assistant IA

Si vous avez branché un assistant, il peut **lire** vos questions et les questions reçues, et **écrire des brouillons de réponse**. Il ne publie jamais : vous relisez le brouillon (onglet Questions reçues, « Brouillons prêts ») et vous cliquez sur **Publier**. Pour l'autoriser à écrire des brouillons, ouvrez *Assistants IA* dans l'administration et cochez les actions « faq_draft_answer » et « faq_update_draft » pour son accès (elles sont éteintes d'office).

## Réglages

Tout marche sans rien régler. Pour changer :

- **Texte d'introduction** (facultatif), affiché au-dessus des questions.
- **Laisser le public poser une question** (oui).
- **Proposer « Cela m'a été utile / Pas vraiment »** (oui).
- **Montrer aussi les questions écrites dans une autre langue** (oui).
- **Aider les moteurs de recherche à comprendre vos questions** (oui) : la page décrit ses questions publiées à Google et aux autres moteurs.
- **Me prévenir par e-mail d'une nouvelle question** (oui, au plus un e-mail toutes les 6 heures ; demande l'e-mail réglé dans les Réglages du site).
- **Ajouter un lien dans le pied de page** (non).

Sur l'accueil, vous pouvez aussi placer le morceau **« Les questions les plus utiles »**.

## Vie privée

- Une question posée par une personne est gardée **90 jours au plus**, sans nom, sans e-mail, sans adresse. Dès que vous la publiez ou l'écartez, elle est effacée.
- Un avis ajoute 1 à un compteur. Le navigateur de la personne qui visite retient seulement la liste des questions qu'il a notées (jamais envoyée). Pour ne compter qu'un avis, le site garde en mémoire, 24 heures au plus, une empreinte (impossible à relire) de la connexion ; rien n'est écrit sur le disque.
- Aucun cookie de suivi, aucun service extérieur.

## Ce que le module ne fait pas

- Il ne répond pas au public directement : la réponse arrive sur la page, pas par message.
- Il n'a pas de glisser-déposer, ni de photos dans les réponses (du texte, du gras, des liens, des listes).
- Au plus 500 questions, 30 catégories et 200 questions reçues en attente ; une réponse fait 3 000 caractères au plus (une réponse plus longue mérite un article).
- Sans JavaScript : la recherche et le « Tout ouvrir » sont absents, et un lien vers une question amène à la bonne ligne, mais il faut un clic pour l'ouvrir.

## Pour qui développe

Voir `docs/ideas/faq.md` du dépôt : choix du type de module, données, routes, limites et outils pour l'assistant.

# Commandes — la file de commandes de votre site

Vous êtes illustratrice, créatrice de modèles pour VTubers, de bijoux ou d'autre chose, et vous répondez cent fois aux mêmes questions : « vos commandes sont-elles ouvertes ? », « combien ? », « où en est ma commande ? ». Ce module les règle une fois pour toutes.

## Ce que voient vos visiteurs

- Une page **Commandes** (`/commandes`) qui dit clairement l'état : « Commandes ouvertes — 2 places libres », « Complet pour le moment — réouverture prévue le 12 mars 2027 » ou « Commandes fermées ».
- Vos **formules** : nom, prix indicatif, délai, ce qui est inclus.
- Un **formulaire court** quand les commandes sont ouvertes : prénom ou pseudo, adresse e-mail, formule, ce que la personne veut, lien d'inspiration (facultatif).
- Après l'envoi, un **lien de suivi privé** : une page qui montre l'état de la commande et sa place dans la file, sans compte à créer. Ce lien est long et impossible à deviner. La personne peut y annuler ou effacer sa demande.
- Si le site sait envoyer des e-mails, la personne peut cocher « me prévenir » : elle reçoit une confirmation, puis un mot à chaque changement d'état.

## Ce que vous faites

1. Dans **Mes commandes**, vous cliquez sur « Ouvertes », « Complet » ou « Fermées » (au départ, les commandes sont fermées : rien n'est visible tant que vous n'avez pas ouvert).
2. Vous réglez le **nombre de places** (3 au départ). Les places libres se calculent toutes seules d'après vos commandes acceptées et en cours ; quand il n'y en a plus, la page affiche « complet ».
3. Dans **Formules**, vous ajoutez ce que vous proposez. Les prix sont du texte libre (« à partir de 40 € ») : le module ne touche jamais à l'argent.
4. Les demandes arrivent dans la liste (une pastille dans le menu vous prévient). Vous ouvrez une demande, vous la faites avancer : **nouvelle → acceptée → en cours → livrée** (ou refusée / annulée). Vous pouvez écrire un petit message que la cliente verra sur sa page de suivi, et garder des **notes privées**.
5. Si vous avez le module Contacts, vous pouvez cocher « créer aussi sa fiche dans Contacts » en acceptant. L'adresse e-mail est alors gardée dans Contacts et n'est plus dans la commande.
6. Vous pouvez **télécharger la liste** (fichier CSV lisible dans un tableur).

## Vie privée

- L'adresse e-mail et les notes privées ne sont visibles que par l'équipe (et seulement par les personnes qui ont le droit « voir les adresses e-mail »).
- La page de suivi montre un prénom ou pseudo et l'état, jamais l'adresse e-mail ni vos notes.
- Les commandes **terminées** sont effacées toutes seules après 12 mois (réglable, 0 = jamais). Les commandes en cours ne sont jamais effacées.
- La cliente peut annuler ou effacer sa demande depuis son lien.
- Le site ne garde aucune adresse IP et ne dépose aucun cookie.

## Ce que le module ne fait pas

- Pas de paiement, pas de facture, pas de devis calculé : tout est indicatif.
- Pas de fichiers envoyés par la cliente (elle colle un lien d'inspiration).
- Pas de messagerie : si la cliente doit vous répondre, vous écrivez par e-mail comme d'habitude.
- Les formules sont écrites dans une seule langue (la vôtre).

## Limites

- 12 formules au plus. 1 000 commandes gardées en tout (les terminées s'effacent avec le temps). 100 demandes nouvelles en attente au plus.
- Une personne peut envoyer 3 demandes par heure ; une même adresse 3 par jour.
- La description d'une demande tient en 1 500 caractères, le prénom ou pseudo en 40.

## Pour les développeurs

Module en code, une instance. Services : offre `privacy.subject` (export, effacement et redirection des commandes reliées à une fiche Contacts) ; utilise `contact.book` (version 2) **facultativement**. Les droits sont `manage`, `email.view` et `export`. Les outils pour l'assistant IA ne montrent jamais d'adresse e-mail ni de note privée. Détails : `docs/ideas/commissions.md` dans le dépôt des modules.

# Contacts — module communautaire de Curiosa

Votre carnet d'adresses **privé** : personnes, organisations, e-mail, téléphone, autres canaux, relation, notes datées. Aucune page publique.

- **Il offre le service `contact.store`** : le formulaire de contact du site (et tout module qui le requiert) y range ce qu'il reçoit. Chaque message devient un contact **« à vérifier »** dont la note est le message ; un deuxième message de la même adresse ajoute une note au lieu de créer un doublon.
- **Un assistant (MCP)** peut ensuite se renseigner sur la personne, compléter la fiche et la passer « active », ou la supprimer si c'est du spam (la suppression n'est accordée qu'à un jeton explicitement autorisé).
- **Sauvegarde lisible** : un fichier `contacts.csv` (avec les notes) dans chaque sauvegarde.
- **Permissions** : admin, stockage, MCP. Rien n'est envoyé hors du serveur.

Plusieurs carnets peuvent coexister (voir *Modules → Services offerts par plusieurs modules* : un maître reçoit, des répliques copient les nouveaux contacts).

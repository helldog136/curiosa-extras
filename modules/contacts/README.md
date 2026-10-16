# Contacts — module communautaire de Curiosa

Votre carnet d'adresses **privé** : personnes, organisations, e-mail, téléphone, autres canaux, relation, notes datées. Aucune page publique.

- **Il offre le service `contact.store`** : le formulaire de contact du site (et tout module qui le requiert) y range ce qu'il reçoit. Chaque message devient un contact **« à vérifier »** dont la note est le message ; un deuxième message de la même adresse ajoute une note au lieu de créer un doublon.
- **Un assistant (MCP)** peut ensuite se renseigner sur la personne, compléter la fiche et la passer « active », ou la supprimer si c'est du spam (la suppression n'est accordée qu'à un jeton explicitement autorisé).
- **Il offre aussi le service `contact.book`**, pour les modules qui ont besoin des personnes du carnet (aujourd'hui : Partenariats). **Une personne n'existe qu'une fois, ici** : les autres modules ne gardent qu'une référence (l'identifiant de la fiche). Méthodes (réponse `{ ok: true, … }` ou `{ ok: false, error }`, jamais d'exception) :
  - `get({ id })` : la fiche avec ses notes (les 50 dernières) ; `resolve({ ids })` : jusqu'à 100 fiches en résumé (nom, fonction, organisation, e-mail, téléphone, lien d'admin) ; `find({ q, email, name, organisation, limit })` : recherche, critères cumulés ;
  - `create({ name, email, role, organisation, phone, others, relation, status, source, note })` : crée une fiche **active** (ou `to_review` si demandé ; source « partenariats » par défaut) **ou renvoie celle qui existe déjà** (`created: false`, rien n'est modifié) ;
  - `update({ id, … })` : corrige les champs donnés (un e-mail déjà porté par une autre fiche est refusé : `email_taken`) ; `note({ id, text, author })` : ajoute une note datée.
- **Règle de dédoublonnage** (création) : avec un e-mail valide, **même adresse** (majuscules ignorées) ; sans e-mail, **même nom et même organisation** (majuscules, accents et espaces multiples ignorés ; deux organisations vides sont identiques). Un même nom avec une autre organisation reste une autre personne.
- **Sauvegarde lisible** : un fichier `contacts.csv` (avec les notes) dans chaque sauvegarde.
- **Outils MCP** : `contacts_list`, `contact_get`, `contact_create`, `contact_note`, `contact_update` (ces trois-là écrivent : aucun n'est accordé d'office, c'est votre accès IA qui les accorde explicitement), `contact_delete` (destructif, jamais d'office). Leurs descriptions disent à l'assistant quand les utiliser et quand passer par Partenariats (`partner_link_contact` pour rattacher une personne à une marque).
- **Permissions** : admin, stockage, MCP. Rien n'est envoyé hors du serveur.

Plusieurs carnets peuvent coexister (voir *Modules → Services offerts par plusieurs modules* : un maître reçoit, des répliques copient les nouveaux contacts).

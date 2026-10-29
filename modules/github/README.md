# GitHub — module communautaire de Curiosa

Affiche le bouton de votre GitHub (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : Votre identifiant GitHub ou l'adresse de votre profil.
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'une personne amie…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : followers

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `GET /users/<nom>` de l'API publique de GitHub : nombre de followers (followers) du compte ou de l'organisation, gardé 30 minutes. Sans clé GitHub.
- **Limites de la plateforme** : GitHub limite les demandes anonymes à 60 par heure et par adresse du serveur du site : le cache évite d'y arriver, et si cela arrive l'erreur « limite de demandes » est affichée puis se résout dans l'heure.
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« GitHub ne trouve pas ce compte »* : vérifiez votre identifiant dans Réglages.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

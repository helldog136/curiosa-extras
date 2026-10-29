# Reddit — module communautaire de Curiosa

Affiche le bouton de votre Reddit (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : Votre identifiant Reddit ou l'adresse de votre profil ou de votre communauté.
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'une personne amie…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : followers

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `about.json` public de votre communauté (`/r/nom` : nombre de followers) ou de votre profil (`/user/nom` : ses followers), avec un agent HTTP qui nomme le site. Gardé 60 minutes.
- **Limites de la plateforme** : Reddit refuse volontiers les demandes anonymes venues de serveurs (erreur « Reddit limite les demandes », qui se résout seule) et ne montre rien d'un profil ou d'une communauté privés. Le karma n'est pas suivi : il ne correspond à aucun des chiffres partagés.
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« Reddit ne trouve pas ce compte ou cette communauté »* : indiquez l'adresse complète de la communauté (`https://www.reddit.com/r/nom`) ou votre identifiant.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

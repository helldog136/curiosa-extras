# Mastodon — module communautaire de Curiosa

Affiche le bouton de votre Mastodon (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : L'adresse complète de votre profil (ex. https://mastodon.social/@nom).
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'un ami…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : followers et publications

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `/api/v1/accounts/lookup` sur le serveur de votre compte (celui de l'adresse de votre profil) : nombre de followers et de publications, gardé 30 minutes. Seules les adresses https publiques sont appelées : jamais une machine locale ou privée, un port, un identifiant dans l'adresse ; les redirections sont revérifiées à chaque étape.
- **Limites de la plateforme** : Chaque serveur Mastodon fait sa loi : certains refusent la lecture publique (erreur « ce serveur ne montre pas ses chiffres », rien à corriger de votre côté) ou limitent les demandes. Le nombre de followers est celui connu de votre serveur.
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« Ce serveur Mastodon ne trouve pas ce compte »* : l'adresse du profil doit être de la forme `https://serveur/@nom`.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

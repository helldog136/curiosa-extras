# Bluesky — module communautaire de Curiosa

Affiche le bouton de votre Bluesky (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : Votre identifiant Bluesky (ex. nom.bsky.social) ou l'adresse de votre profil.
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'une personne amie…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : followers et publications

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `app.bsky.actor.getProfile` de l'API publique de Bluesky (`public.api.bsky.app`) : nombre de followers et de publications, gardé 30 minutes.
- **Limites de la plateforme** : Bluesky ne publie que des chiffres entiers exacts, mais peut limiter les demandes très fréquentes (erreur « trop de demandes », qui se résout seule).
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« Bluesky ne trouve pas ce compte »* : vérifiez l'identifiant (ex. nom.bsky.social) dans Réglages.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

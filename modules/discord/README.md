# Discord — module communautaire de Curiosa

Affiche le bouton de votre Discord (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : Le code de votre invitation Discord (ex. abcDEF) ou son adresse complète.
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'un ami…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : membres

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `GET /invites/<code>?with_counts=true` : le nombre **approximatif** de membres du serveur, lu à partir d'une invitation publique (le code ou l'adresse `discord.gg/…`). L'invitation du réglage « Lien d'invitation » est utilisée en priorité ; sans elle, le profil est utilisé s'il est lui-même une invitation. Gardé 30 minutes.
- **Limites de la plateforme** : Discord ne donne qu'un nombre approximatif de membres, et seulement avec une invitation qui existe : une invitation expirée ou supprimée ne donne rien. Créez-en une qui n'expire jamais (Discord : paramètres d'invitation, « Expire : jamais »).
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« Ajoutez le lien d'invitation de votre Discord »* : remplissez « Lien d'invitation » dans Réglages. *« Cette invitation n'existe plus »* : créez-en une sans date de fin.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

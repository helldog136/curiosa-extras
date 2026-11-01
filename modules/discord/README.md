# Discord — module communautaire de Curiosa

Affiche le bouton de votre Discord (icône et lien) dans l'en-tête du site. Il fournit le sujet `social.link` au cœur, qui rassemble les boutons de tous vos réseaux, et ses propres chiffres (sujet `social.stat`) : il ne consomme rien et ne stocke rien.

- **Réglage** : l'adresse de votre profil. Collez votre lien d'invitation. Par exemple : https://discord.gg/abcDEF. Le nom seul, l'adresse sans https:// ou sans www. et les adresses courtes sont reconnus ; les paramètres de suivi sont retirés.
- **Plusieurs comptes** : ajoutez une instance par compte (la vôtre, celle d'une personne amie…).
- Seule une adresse https du bon site est acceptée ; rien n'est affiché tant que le profil n'est pas réglé.

## Statistiques : membres

**Suivre mes statistiques** est coché par défaut : ce sont des chiffres publics, aucune clé n'est nécessaire. Décochez pour ne rien suivre.

- **Ce qui est lu** : `GET /invites/<code>?with_counts=true` : le nombre **approximatif** de membres du serveur, lu à partir d'une invitation publique (le code ou l'adresse `discord.gg/…`). L'invitation du réglage « Lien d'invitation » est utilisée en priorité ; sans elle, le profil est utilisé s'il est lui-même une invitation. Gardé 30 minutes.
- **Limites de la plateforme** : Discord ne donne qu'un nombre approximatif de membres, et seulement avec une invitation qui existe : une invitation expirée ou supprimée ne donne rien. Créez-en une qui n'expire jamais (Discord : paramètres d'invitation, « Expire : jamais »).
- **Si ça ne marche pas** : le panneau du module dit en mots simples ce qui se passe. *« Ajoutez le lien d'invitation de votre Discord »* : remplissez « Lien d'invitation » dans Réglages. *« Cette invitation n'existe plus »* : créez-en une sans date de fin.
- Aucun chiffre n'est inventé ni périmé : quand la plateforme ne répond pas, le module publie l'erreur (`auth`, `rate`, `network`, `hidden` ou `config`) et pas de nombre. Plusieurs instances du même compte partagent une seule demande.

## Adresse courte : /discord

**Créer une adresse courte pour votre Discord** est éteint par défaut. Allumé, le cœur crée l'adresse `votresite.be/discord`, qui mène à l'invitation de votre bouton. Elle reste la même si votre invitation change : seule sa destination suit. Les redirections appartiennent au cœur : le module ne fait que la **demander** (clé `shortLink` de son `module.json`), il n'écrit rien lui-même.

- **Éteint par défaut**, parce que c'est une adresse publique de plus sur votre site, que personne n'a demandée : elle ne naît pas d'une mise à jour. Un clic suffit pour l'allumer.
- **Le nom** se change sous « Plus d'options » (vide : `discord`). Lettres minuscules, chiffres et tirets. Changer le nom renomme l'adresse, avec ses chiffres.
- **Si le nom est déjà pris** par l'un de vos liens, rien n'est créé ni modifié : le message sous le champ vous propose un autre nom (par exemple `discord-2`), et la page *Raccourcis de liens* le rappelle avec un bouton vers les réglages.
- **Où la voir** : page *Raccourcis de liens*, avec la pastille « Extension Discord ». Elle se règle ici, pas là-bas : on ne la modifie ni ne la supprime à la main.
- **Si vous coupez l'option**, retirez ce compte ou désinstallez l'extension, l'adresse disparaît avec ses chiffres et le nom redevient libre.
- **Le bouton de l'en-tête** garde l'adresse de votre invitation. Il passe par `/discord` (et ses clics sont comptés) seulement si vous avez activé « Compter les clics sur mes liens » dans *Raccourcis de liens*, comme pour tous les boutons de réseaux.
- **Vie privée** : rien de nouveau n'est collecté. Les chiffres sont ceux de tout lien court (un nombre par jour, sans cookie, sans adresse IP). Sans effet avec un Curiosa plus ancien : le module marche, sans adresse courte.

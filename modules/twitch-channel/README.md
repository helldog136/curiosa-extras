# Chaîne Twitch — module communautaire de Curiosa

**Le seul module qui parle à Twitch.** Client id, client secret (jamais réaffichés) et chaîne se saisissent ici, une fois, avec une application Twitch à vous (dev.twitch.tv/console). Le jeton, les appels et les caches sont gérés ici, et partagés avec les modules qui en ont besoin.

Il fournit :

- le **bouton** Twitch de l'en-tête (`social.link`), aussi repris par le planning pour son bouton « Regarder sur Twitch » ;
- `stream.live` : le live en cours (titre, jeu, début, adresse), vide hors ligne. Les annonces Discord le reprennent ;
- `maze.poster` : vos derniers clips (60 jours) en affiches pour l'overlay labyrinthe ;
- le **service `twitch.live`** (pour les modules qui en dépendent, comme *Statut live Twitch* qui affiche la bannière « en direct » et le lecteur) :
  - `channel()` → `{ channel, url, configured, ready, missing }` : la chaîne de l'instance et ce qui manque, sans appel réseau ;
  - `status({ channel? })` → `{ configured, known, live, channel, url, id?, title?, game?, viewers?, startedAt?, thumbnail?, displayName?, error? }` ; `known` : Twitch a répondu ; `error` : `auth`, `rate`, `network` ou `config`. Ne lève jamais ;
  - `adopt({ channel, clientId, clientSecret })` → `{ adopted: [champs], ready }` : reprise des identifiants d'un autre module (migration), qui ne remplit que les champs vides et ne renvoie jamais de valeur.

Un seul jeton par couple d'identifiants, un seul appel par chaîne (30 s ; 20 s après une erreur, 60 s après un « trop de requêtes »), même quand plusieurs modules le demandent en même temps. **Plusieurs chaînes (version 1.2.0, Curiosa 0.1.14 ou plus).** Ajoutez une instance par chaîne : l'offre `twitch.live` est « chaque instance répond » (`each`), il n'y a donc **aucun maître** à choisir. `channel()` et `status()` sans argument répondent pour la chaîne de l'instance, et *Statut live* les interroge toutes (`callAll`). Deux chaînes aux mêmes identifiants partagent **un seul jeton** ; une requête Twitch par chaîne.

**Même application Twitch pour plusieurs chaînes ?** Le réglage avancé *Utiliser les identifiants d'une autre chaîne* (identifiant de l'autre chaîne, par exemple `helldog136`) reprend son client id et son secret, **seulement là où ils sont vides** : ce que vous saisissez dans l'instance prévaut champ par champ. Un module ne peut pas lire les réglages d'une autre instance : les identifiants complets de chaque chaîne sont donc « prêtés » en mémoire (jamais affichés ni renvoyés) et une copie est gardée dans le stockage de l'instance qui emprunte, pour survivre à un redémarrage. Au tout premier affichage après un redémarrage, si l'instance qui emprunte est lue avant l'autre et n'a pas encore de copie, elle est « pas prête » un instant ; le rechargement suivant suffit. « Oublier les identifiants repris » supprime aussi cette copie.

**Reprise depuis Statut live (migration)** : avec plusieurs chaînes, la reprise va dans la **première** Chaîne Twitch (par ordre de création), uniquement dans ses champs vides ; les autres sont intactes (utilisez le réglage ci-dessus pour partager).

Identifiants repris d'un autre module : ils ne sont jamais affichés ; l'admin le signale et propose « Oublier les identifiants repris ». Ce que vous saisissez dans les réglages a toujours le dessus.

## Statistiques et connexion de votre chaîne (1.3.0)

**Suivre mes statistiques** (désactivé par défaut : il demande votre autorisation) compte vos **followers** et, si vous êtes affilié ou partenaire, vos **abonnés payants**. Le module les publie (sujet `social.stat`) ; un autre module les collecte et garde l'historique. Les cases *Compter mes followers* / *Compter mes abonnés payants* choisissent ce que Twitch doit autoriser : **le minimum** (followers → lecture des followers ; abonnés payants → lecture des abonnements, rien d'autre). Cocher une case après coup demande de reconnecter la chaîne (le panneau le dit).

### Connecter ma chaîne Twitch (une fois)
Le panneau du module, une fois « Suivre mes statistiques » activé et enregistré, guide pas à pas : 1. ouvrir votre application sur dev.twitch.tv/console (type *Confidential*), 2. y ajouter l'**adresse de retour affichée** (bouton *Copier*) dans les adresses de redirection, 3. coller l'identifiant et le secret de l'application dans les réglages, 4. cliquer **Connecter ma chaîne Twitch** puis *Autoriser* chez Twitch. Ensuite : « Connectée en tant que … depuis le … » et **Déconnecter**. Une instance = une connexion ; avec plusieurs chaînes, ajoutez l'adresse de retour de chacune dans la même application Twitch (Twitch accepte plusieurs adresses). Il faut le compte de la chaîne : un autre compte est refusé, avec un message qui dit lequel.

C'est **votre** application Twitch : aucune application centrale de Curiosa, aucun secret partagé. Si la connexion est perdue (mot de passe Twitch changé, accès retiré, application recréée), le panneau montre « Twitch demande de nouveau votre autorisation » avec le bouton ; les chiffres sont alors publiés avec l'erreur `auth` et sans valeur.

### Ce qui est lu, et les limites de Twitch
- `GET /helix/channels/followers` (`total`) avec la portée `moderator:read:followers`, et `GET /helix/subscriptions` (`total`) avec `channel:read:subscriptions` : une requête par chaîne et par chiffre toutes les 5 minutes (20 s après une erreur, 60 s après un « trop de requêtes »), un seul jeton d'application, quel que soit le nombre de consommateurs.
- Les **abonnements ne sont disponibles que pour les affiliés et partenaires** : sinon l'erreur `config` et le message *« Les abonnements ne sont disponibles que pour les affiliés et partenaires Twitch »*. Twitch peut compter votre propre chaîne parmi les abonnés : un écart de 1 est possible.
- Aucune valeur n'est jamais inventée ni périmée : sans connexion ou en cas d'erreur, l'élément porte `error` (`auth`, `rate`, `network`, `config`) et pas de `value`.

### Sécurité de la connexion
Flux « code d'autorisation » avec le secret de **votre** application, côté serveur uniquement.

| Risque | Réponse |
|---|---|
| **Vol ou invention du `state`** (CSRF : faire connecter à l'administrateur le compte de quelqu'un d'autre) | 256 bits aléatoires, créés seulement dans le panneau d'administration (réservé aux administrateurs), gardés dans le stockage de CETTE instance, **à usage unique** (supprimés avant tout appel à Twitch), **10 minutes**. Un `state` inconnu, forgé, rejoué, expiré ou d'une autre instance reçoit la même réponse neutre (400), sans rien écrire ni appeler Twitch ; au-delà de 20 essais invalides en 10 minutes, 429. Limite connue : une route de module ne sait pas **qui** est connecté (le cœur ne le lui dit pas), donc le `state` n'est pas lié à la session de l'administrateur. Il est compensé : un `state` volé ne sert à rien sans compte Twitch **de la chaîne** (le compte autorisé doit être celui de la chaîne réglée, sinon refus et jetons révoqués). |
| **Rejeu du code** | Twitch ne l'accepte qu'une fois ; notre `state` aussi. |
| **Redirection ouverte** | L'adresse de retour est fixe (`<site>/m/<clé>/oauth/callback`) et envoyée telle quelle à Twitch, qui n'accepte que celle enregistrée. Après le rappel, la redirection va toujours vers la page d'administration de l'instance : rien de ce que contient la requête ne choisit la destination. |
| **Secrets dans les journaux** | Aucun appel `console.*` dans le module ; les jetons passent dans le corps ou l'en-tête des requêtes vers Twitch, jamais dans une adresse ; aucune erreur ne les cite. Les réponses du rappel portent `Cache-Control: no-store` et `Referrer-Policy: no-referrer`. |
| **Jeton lisible par un autre module** | Les jetons (accès et renouvellement) sont dans le **stockage de l'instance** : le cœur le réserve à l'instance (`createStore(instanceId)` filtre chaque lecture par instance : une autre instance, même du même module, ne voit rien). Ils ne sont jamais un réglage, ni dans le service `twitch.live`, ni dans un export, ni dans un outil d'assistant. Le stockage fait partie de la sauvegarde du site (chiffrée) : protégez-la. |
| **Jeton qui traîne** | Renouvelé automatiquement avant son expiration et à la réception d'un 401 (une seule tentative, fusionnée entre appels simultanés) ; échec définitif → « À reconnecter ». **Déconnecter** révoque les deux jetons chez Twitch puis les efface. Mauvais compte, autorisation incomplète : jetons révoqués aussitôt. |
| **PKCE** | Non utilisé : Twitch ne le documente pas pour ce flux, et le secret de l'application protège déjà l'échange. |

Risques restants : un administrateur dont la session est volée peut connecter ou déconnecter (comme n'importe quelle action d'administration) ; la sauvegarde contient les jetons (chiffrée) ; l'adresse de retour doit être en https (sauf `localhost` pour des essais).

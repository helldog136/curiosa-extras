# Chaîne YouTube — module communautaire de Curiosa

- **Vidéo mise en avant** (section d'accueil) : la plus vue des vidéos de moins de N jours (30 par défaut), Shorts exclus sauf réglage. La vignette renvoie vers YouTube : on n'intègre **pas** le lecteur, car YouTube compte un lecteur affiché comme une vue.
- **Flux RSS, annonces Discord, overlay labyrinthe** : les vidéos (hors Shorts) sont proposées aux autres fonctionnalités du site qui les affichent ou les annoncent.
- **Réglages** : l'identifiant de chaîne (`UC…`) suffit (flux public, ~15 vidéos ; un test à la première apparition détermine si une vidéo est un Short). Avec la **clé YouTube du site**, saisie une seule fois sur la page du connecteur YouTube, le module obtient en plus les durées exactes, la détection des Shorts et les chiffres de la chaîne.
- Cache de 10 minutes.

## La clé YouTube : une seule fois pour tout le site

La clé YouTube n'est plus réglée ici. Elle est gardée par le **connecteur YouTube** du site : une seule clé pour toutes vos chaînes et toutes les fonctionnalités qui lisent YouTube.

- **Vous aviez déjà mis une clé ici ?** Rien à retaper : à la mise à jour, elle est remise au connecteur, puis effacée d'ici **seulement quand le connecteur confirme l'avoir**. Elle n'est jamais affichée ni écrite dans un journal.
- **Pas encore de connecteur ?** Le panneau de ce module vous propose de l'installer (un bouton). Votre clé reste gardée, masquée, en attendant ; elle sera reprise dès l'installation. En attendant, la vidéo mise en avant et le flux continuent de marcher avec le flux public.

## Statistiques : abonnés, vidéos, vues

Cochez **Suivre mes statistiques** (désactivé par défaut : il demande la clé YouTube du site) pour que le site tienne à jour le nombre de vos **abonnés**, de vos **vidéos** et de vos **vues**. Le module les met à disposition du site ; les statistiques de la communauté les collectent et gardent l'historique.

- **Ce qui est lu** : une seule demande à YouTube par chaîne, gardée 10 minutes par le connecteur (sur les 10 000 unités par jour que donne YouTube, elle en coûte une). Rien d'autre n'est lu, rien n'est stocké ici.
- **Les abonnés sont arrondis par YouTube** : il ne donne que 3 chiffres significatifs (1 234 567 devient 1 230 000, 8 421 devient 8 420). Les vidéos et les vues sont exactes. Pour de petites chaînes l'arrondi ne se voit pas.
- **Jamais de chiffre périmé** : si YouTube ne répond pas, le chiffre est marqué « en erreur » plutôt que de répéter une ancienne valeur.
- **Si ça ne marche pas** (le panneau du module le dit en mots simples) :
  - *« Pour suivre vos statistiques, il faut la clé YouTube du site »* : installez ce que propose le panneau, puis ajoutez votre clé sur sa page. Le reste du module (vidéo mise en avant, flux, bouton) fonctionne sans.
  - *« Ajoutez votre clé YouTube dans Réglages »* : le connecteur est là mais n'a pas encore de clé. Elle est gratuite ; la page du connecteur dit où la créer.
  - *« La clé YouTube est refusée »* : la clé est fausse, le service « YouTube Data v3 » n'est pas activé pour elle, ou elle est restreinte à d'autres adresses.
  - *« YouTube cache votre nombre d'abonnés »* : la chaîne a masqué son compteur. Rendez-le public dans YouTube Studio ; les vidéos et les vues continuent d'être suivies. Jamais de chiffre inventé : le compteur reste « caché » tant que YouTube ne le donne pas.
  - *« YouTube a atteint sa limite de demandes »* : la limite du jour est atteinte, cela reprend tout seul.

## Pour les développeurs

- Sujets fournis : `social.link`, `feed.item` (rubrique `video`), `maze.poster`, `social.stat`. Le module ne connaît aucun consommateur.
- Besoin **facultatif** `youtube.api` (min 1) : sans fournisseur, le panneau renvoie un bloc `suggestInstall` (par service, jamais par nom de module) et le module passe par le flux RSS public.
- Clé reprise : réglage hérité `apiKey` (`legacySettings`, secret, jamais affiché). Migration `dataVersion` 2 et ouverture du panneau : `adopt({ apiKey })`, puis `ctx.legacy.clear("apiKey")` **seulement** si la réponse dit `ready: true`. Rejouable sans effet ; un échec n'efface rien et ne fait jamais échouer la mise à jour.
- Vidéos : `channels.list` (`contentDetails`) → `playlistItems.list` (50) → `videos.list` (`contentDetails,statistics`), soit 3 unités par chaîne et par tranche de 10 minutes ; en cas d'erreur (pas de clé, limite atteinte…), repli sur le flux RSS public. Chiffres : `channels({ ids: [channelId] })`, un résultat de repli daté (`stale`) n'est jamais publié comme valeur.
- Réseau : flux RSS et contrôles « Short » par `ctx.api.net` (délai borné par le temps restant de la page publique) ; appels au service bornés (`timing.serviceMs`).

# Dix nouveaux modules (octobre 2026)

Publiés dans la version 1.15.0 (les propriétaires ont choisi de tout publier et d'ajuster ensuite). Chaque module a sa description complète (`<id>.md`) et ses notes de version (`<id>.changelog.md`) dans ce dossier, et son README métier dans `modules/<id>/`.

| Module | Pour résoudre quel problème |
|---|---|
| `legal-pages` Mentions légales | Écrire les mentions légales, la confidentialité et les cookies sans être juriste |
| `thanks-wall` Mur des remerciements | Remercier la communauté à partir de Contacts |
| `commissions` Commandes | L'état de la file d'un artiste, les formules, le suivi par lien privé |
| `faq` Questions fréquentes | Répondre une fois pour toutes, avec une boîte de questions |
| `testimonials` Témoignages | Collecter et modérer des avis avec consentement |
| `polls` Sondages | Voter sans compte, avec source OBS |
| `countdown` Compte à rebours | Annoncer un événement à l'heure locale du visiteur |
| `content-planner` Cahier de contenu | Ne plus perdre ses idées de contenu |
| `audience` Participation | La base commune des animations de stream : pseudo sans compte, une voix par personne, télécommande, écran en direct, journal |
| `platform-links` Autres plateformes | OnlyFans, Mym, Fansly, Patreon, Ko-fi… en icônes à côté des réseaux, avec page d'avertissement 18+ facultative |

À noter : `polls` (Sondages) est passé en **1.1.0** (manches, sondage rapide, télécommande et écran en direct grâce à Participation ; voir `polls.changelog.md`). `audience` offre le service `audience.session` ; `polls` l'utilise en facultatif et offre `audience.remote`.

- `IDEES-DEPART.md` : le cahier des charges de départ.
- `FAMILLE-STREAM.md` : la suite imaginée à partir des sondages (tombola, roue, bingo, quiz ; la base commune « Participation » existe maintenant : `audience.md`).

## La famille « maison » (octobre 2026, version 1.16.0)

Deux nouveaux modules et une extension du Bot Twitch, qui font réagir la maison de la créatrice (Home Assistant) à son live, avec un gros bouton « Tout couper ». Chacun a sa description (`<id>.md`) et ses notes de version (`<id>.changelog.md`) ; le Bot Twitch 1.3.0 a la sienne dans `../changelog-parts/channel-rewards.md`.

| Module | Pour résoudre quel problème |
|---|---|
| `home-assistant` Home Assistant | Le pont sûr : la file d'ordres, l'association, le coupe-circuit, la modération du texte lu, le journal ; le « en direct » vient de Twitch OU de YouTube. Contrat exact : `home-assistant-contract.md` |
| `twitch-bot` Bot Twitch 1.3.0 | Les récompenses en points de chaîne qui lancent une action (lumières, message lu à voix haute) |
| `youtube-live-actions` Actions du live YouTube 1.1.0 | Les Super Chats, Super Stickers et adhésions qui lancent la même action |

### Le direct YouTube, au même niveau que Twitch (version 1.16.0)

Deux lots assemblés dans la même version. Notes de version : `../changelog-parts/youtube-oauth.md` et `../changelog-parts/live-multi-platform.md` ; description de la connexion du compte : `youtube-oauth.md`.

| Module | Pour résoudre quel problème |
|---|---|
| `youtube-connector` Connecteur YouTube 1.3.0 | Connecter son compte YouTube (code court sur google.com/device) pour lire le chat quand la clé seule est refusée, et y répondre si on le décide (désactivé par défaut) |
| `youtube-live-actions` Actions du live YouTube 1.1.0 | Publie les dons et adhésions (`live.event`) ; lit le chat même sans Home Assistant si on le demande (`readWithoutHouse`) |
| `live-status` Statut du live 1.4.0 | La bannière et le lecteur « en direct » pour YouTube comme pour Twitch |
| `alerts-overlay` Overlay alertes (OBS) 1.1.0 | Afficher les Super Chats, Super Stickers et adhésions à l'écran |
| `discord-announcer` Annonces Discord 1.1.0 | Annoncer aussi les directs YouTube : **désactivé par défaut**, à cocher |

## Devenus des extensions du cœur (et non des modules)
- **Liens courts** : le cœur a déjà des redirections (`/twitch`). On y ajoute le QR code, la date de fin et les statistiques : voir `dans-le-coeur/liens-courts.md`.
- **Santé du site** : intégrée à l'Entretien du cœur, qui a déjà un diagnostic et des outils pour l'assistant IA : voir `dans-le-coeur/sante-du-site.md`.

## Idées notées pour plus tard
- **Mentions légales** : utiliser `ctx.api.privacy.declarations()` du cœur pour préremplir la table « vie privée » au lieu de `known.mjs` (non fait dans la 1.15.0, hors lot).

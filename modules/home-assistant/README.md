# Connecteur Home Assistant

Le connecteur entre vos points de chaîne et votre maison : vos viewers changent la couleur de vos lumières, font lire un message à voix haute chez vous ou lancent les actions que vous nommez (« Lancer l'aspirateur »), **avec leurs points de chaîne Twitch**. Vous gardez la main : un gros bouton **« Tout couper »** arrête tout en un clic, et rien ne se joue quand vous n'êtes pas en direct.

**Il faut Curiosa 0.2.6 ou plus**, l'intégration gratuite « Curiosa » dans Home Assistant (installée avec HACS) et, pour que les viewers puissent déclencher des actions, le Bot Twitch (qui gère les récompenses en points de chaîne) ou « Actions du live YouTube » (Super Chats et adhésions). Pour savoir si vous êtes en direct, ce module s'appuie sur « Ma Chaîne Twitch » **ou** sur « Chaîne YouTube » (facultatifs, mais sans l'un des deux rien n'est joué pour les viewers, par prudence) : il suffit qu'une des deux dise que vous êtes en direct.

## Pour commencer (3 étapes, sur la page du connecteur)
1. **Installer l'intégration** dans Home Assistant avec HACS (le lien est sur la page : https://github.com/helldog136/homeassistant-curiosa).
2. **Associer** : copier le code à 8 caractères affiché sur la page, avec l'adresse de votre site, dans Home Assistant. La page affiche « Home Assistant est connecté ».
3. **Créer une première récompense** dans le Bot Twitch (un bouton de la page y mène : « Créer ou modifier tes récompenses »). Pour une action de votre choix, le Bot Twitch demande seulement un nom (« Lancer l'aspirateur ») ; ce nom apparaît ensuite dans Home Assistant (Curiosa > Configurer), où vous choisissez le script à lancer. Tant qu'aucun script n'est choisi, la page vous le dit (« Actions en attente de liaison ») et les points des viewers sont rendus.

Pour vérifier sans attendre un viewer : bloc **« Tester le pont »** de la page. Il simule un échange de points de chaîne (sans toucher à Twitch ni à YouTube), même hors direct, et vous montre le trajet : envoyé, récupéré par Home Assistant, exécuté.

## Ce que ça protège
- **Rien n'est ouvert chez vous.** C'est Home Assistant qui vient chercher les ordres toutes les quelques secondes ; Curiosa n'appelle jamais chez vous, et Home Assistant n'envoie rien de votre maison (pas de liste d'appareils).
- **Seulement en direct** (avec 5 minutes de marge après la fin). Un ordre qui n'est pas exécuté en 60 secondes (réglable) est abandonné et les points sont rendus.
- **Le texte lu à voix haute est vérifié** : liens, mentions, balises et emojis en trop retirés ; refusé s'il contient un mot de la liste (français et anglais, à compléter ou corriger), un numéro de téléphone, ou s'il est trop long ; attente entre deux messages (par personne et pour tous). Un message refusé n'est pas lu, les points sont rendus et le motif est noté dans le journal.
- **Un bouton pour tout couper**, ici, par la commande `!stop` du Bot Twitch (vous et l'équipe de modération que vous désignez) et par un interrupteur dans Home Assistant. L'équipe de modération peut couper ; seule une personne qui gère le module peut reprendre.
- **Un journal** des 50 dernières actions, avec la raison de chaque refus.

## Réglages
Délai avant d'abandonner un ordre, longueur maximale du message, attentes, pseudo avant le message, refus des numéros, liste de mots. En mode avancé : l'intervalle conseillé à Home Assistant.

## Ce que ça ne fait pas
- Il ne choisit pas vos scènes : c'est l'intégration Home Assistant qui relie chaque action (« Lancer l'aspirateur ») à l'une de vos scènes ou de vos scripts. Il ne reçoit jamais la liste de vos appareils.
- Il ne crée pas les récompenses Twitch ni les noms des actions : c'est le rôle du Bot Twitch (le connecteur lit seulement ces noms, en option).
- Il ne lit pas les messages avant de les laisser passer : la modération est automatique, sans validation humaine.
- Il n'agit jamais hors direct pour les viewers (seul le bouton « Tester » peut le faire).

## Pour qui développe
Service offert : `home-assistant.bridge` (version 1). Sujets fournis : `ha.result`, `ha.state`. Sujet consommé (facultatif) : `home.actions` (`{ key, label }`, fourni par le Bot Twitch), ajouté à la réponse de `pull` en champ `catalog`. Routes publiques : `pair`, `pull`, `ack`. Le contrat exact est dans `docs/ideas/home-assistant-contract.md` du dépôt de modules.

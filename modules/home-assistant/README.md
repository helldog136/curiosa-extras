# Home Assistant

Vos viewers changent la couleur de vos lumières ou font lire un message à voix haute chez vous, **avec leurs points de chaîne Twitch**. Vous gardez la main : un gros bouton **« Tout couper »** arrête tout en un clic, et rien ne se joue quand vous n'êtes pas en direct.

**Il faut Curiosa 0.2.6 ou plus**, l'intégration gratuite « Curiosa » dans Home Assistant (installée avec HACS) et, pour que les viewers puissent déclencher des actions, le Bot Twitch (qui gère les récompenses en points de chaîne) ou « Actions du live YouTube » (Super Chats et adhésions). Pour savoir si vous êtes en direct, ce module s'appuie sur « Ma Chaîne Twitch » **ou** sur « Chaîne YouTube » (facultatifs, mais sans l'un des deux rien n'est joué pour les viewers, par prudence) : il suffit qu'une des deux dise que vous êtes en direct.

## Pour commencer (3 étapes, sur la page du module)
1. **Installez l'intégration** dans Home Assistant avec HACS (le lien est sur la page).
2. **Copiez le code à 8 caractères** affiché sur la page, avec l'adresse de votre site, dans Home Assistant.
3. **C'est tout.** La page affiche « Home Assistant est connecté ».

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
- Il ne choisit pas vos scènes : c'est l'intégration Home Assistant qui relie chaque action (« lumieres:rouge ») à l'une de vos scènes ou de vos scripts.
- Il ne crée pas les récompenses Twitch : c'est le rôle du Bot Twitch.
- Il ne lit pas les messages avant de les laisser passer : la modération est automatique, sans validation humaine.
- Il n'agit jamais hors direct pour les viewers (seul le bouton « Tester » peut le faire).

## Pour les développeurs
Service offert : `home-assistant.bridge` (version 1). Sujets fournis : `ha.result`, `ha.state`. Routes publiques : `pair`, `pull`, `ack`. Le contrat exact est dans `docs/ideas/home-assistant-contract.md` du dépôt de modules.

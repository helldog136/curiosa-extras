# Overlay alertes (OBS) — module communautaire de Curiosa

Une source navigateur pour OBS (`https://votre-site/overlays/<clé>`) qui affiche une alerte (follow, sub, raid…) **dès qu'on la pousse**, en direct (SSE).

Pour pousser une alerte depuis n'importe quel outil (Streamer.bot, relais de webhook, script) :

```
POST https://votre-site/m/<clé>/push
Authorization: Bearer <jeton d'envoi>
{ "kind": "follow", "message": "Alex", "username": "alex" }
```

`kind` : `follow`, `sub`, `raid`, `alert` (le texte est affiché tel quel, jamais interprété comme du HTML). Sans jeton défini, rien ne peut pousser ; le panneau d'admin a un bouton de **test**.
Le flux vit en mémoire dans le processus du serveur (un seul serveur, comme l'installation standard).


## Alertes YouTube (version 1.1.0)

Si le module **Actions du live YouTube** est installé, les **Super Chats, Super Stickers, nouvelles adhésions et adhésions offertes** de votre direct YouTube s'affichent aussi, l'un après l'autre (une file de 50 au plus). Rien à brancher : l'overlay lit le sujet `live.event` que ce module publie (onglet « Sources de données » de l'overlay si vous voulez choisir lesquelles).

- **Montant** : écrit dans la devise du don (« 5,00 € »), jamais converti, jamais sans devise.
- **Texte des messages** : **masqué par défaut** (réglage « Afficher le texte des messages YouTube »). Un message de Super Chat peut contenir n'importe quoi ; coché, il s'affiche coupé à 140 caractères, toujours en texte brut (jamais interprété comme du HTML).
- **Il faut garder la page « En direct » d'Actions du live YouTube ouverte** pendant le direct : c'est elle qui lit le chat. Sans elle, aucune alerte YouTube n'arrive (l'overlay ne déclenche jamais cette lecture). Sans Home Assistant, cochez « Lire le chat même sans Home Assistant » dans Actions du live YouTube.
- **Aucun minuteur de fond** : la page de l'overlay (ouverte dans OBS) vient chercher les nouveautés toutes les 5 secondes (au plus une lecture toutes les 2 secondes par overlay) ; overlay fermé, rien ne tourne. Une alerte n'est jamais affichée deux fois, et une alerte de plus de 2 minutes (OBS rouvert, serveur redémarré) n'est pas rejouée.
- Un bouton **Envoyer un faux Super Chat** montre le rendu sans rien demander à YouTube.
- **Sans Actions du live YouTube, rien ne change** : la page de l'overlay est exactement celle d'avant et ne demande rien de plus. Les alertes poussées (`push`) restent immédiates et remplacent l'alerte à l'écran, comme avant.

## Élément pour les pages d'overlay (version 1.2.0, cœur 0.5.0)

Le module propose l'élément **Alertes** (« garde ses proportions », 640 × 260) à la section **Overlays** de l'administration : vous le placez où vous voulez dans une page d'overlay, avec les autres éléments, et vous ne collez qu'une adresse dans OBS. Il suit le **style commun** de la page (couleur du texte, fond, arrondis) ; la couleur d'accent, le style néon ou sobre et la durée d'affichage restent ceux du module.

- **Une option** : « Alertes affichées » (toutes, celles de la chaîne, ou les dons et adhésions du direct). Deux éléments, un de chaque, permettent de les montrer à deux endroits.
- **Plusieurs pages d'overlay peuvent afficher les alertes en même temps** (ou deux fois le même élément) : chaque page garde son propre repère dans le flux, aucune ne vide la file des autres. Le module garde les 100 dernières alertes en mémoire pour cela. Une page ouverte plus tard ne rejoue pas les anciennes.
- **Mode test** : l'élément montre une alerte d'exemple fixe.
- Les réglages de place et de taille n'existent pas ici : l'élément remplit le cadre donné par la page d'overlay.
- **Rien ne change pour l'overlay actuel** : même adresse, même page, mêmes réglages. La limite d'une lecture du sujet `live.event` toutes les 2 secondes vaut par overlay, quel que soit le nombre de pages qui l'affichent.


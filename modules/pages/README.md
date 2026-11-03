# Pages

Des pages libres à la racine du site (/a-propos, /contact…).

Module de base de Curiosa (Curiosa License 1.0). Il s'active depuis l'admin, dans **Fonctionnalités**; ses réglages sont sur sa page.

## Partir d'un modèle (1.1.0)

Sur la liste des pages, **Partir d'un modèle** crée un **brouillon** prérempli, que vous modifiez avant de le publier. Rien n'est publié sans vous, et chaque modèle commence par une ligne qui dit que c'est un texte d'exemple. Le bouton est aussi proposé quand la liste est vide.

| Modèle | Pour quoi faire |
|---|---|
| Qui sommes-nous | Présenter une association ou un collectif : qui, quoi, comment rejoindre. |
| Infos pratiques | Horaires, adresse et contact, en texte libre. |
| Chronologie | Raconter une histoire en étapes datées. |
| À propos de moi | Se présenter en quelques phrases. |
| Ce que je propose | Une vitrine en texte, avec des liens vers d'autres sites. |

Les textes sont neutres, sans nom ni site réel (seulement `example.com`), et **sans aucun texte juridique** : mentions légales et politique de confidentialité restent à écrire par vous. Dans l'assistant d'installation, la réponse à « Vous êtes… ? » peut proposer certains de ces modèles comme pages d'exemple (voir `catalogue/profiles.json`).

*Pour les développeurs* : les modèles sont déclarés dans `module.json` (`content.templates`, 5 sur 8 possibles). Un cœur plus ancien ignore cette clé : le module marche comme avant, sans bouton.

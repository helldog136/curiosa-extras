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

## Skin de cette page (1.3.0)

Dans l'éditeur d'une page, sous **Options**, le réglage **Skin de cette page** permet d'afficher cette page seule avec un autre skin que celui du site : une vitrine peut avoir une page par skin, chacune étant un vrai aperçu (en-tête, menu et pied de page compris, avec vos réglages « Personnaliser » de ce skin). « Comme le site » reste le choix de départ. Le réglage n'apparaît que si au moins deux skins sont installés. Si le skin est retiré, la page reprend celui du site. Les assistants IA peuvent le choisir sur un brouillon.

*Pour Curiosa 0.45.0 ou plus.* *Pour les développeurs* : le module ajoute seulement `"skin"` à `content.features` et `"minCore": "0.45.0"` ; tout le reste est dans le cœur (voir `docs/PAGE-SKIN.md` du cœur).

## Skin for this page (1.3.0)

In a page's editor, under **Options**, the **Skin for this page** setting shows this one page with a skin other than the site's: a showcase can have one page per skin, each a real preview (header, menu and footer included, with your "Customize" settings for that skin). "Same as the site" stays the default. The setting only shows when at least two skins are installed. If the skin is removed, the page shows the site's. AI assistants can choose it on a draft.

*For Curiosa 0.45.0 or newer.* *For developers*: the module only adds `"skin"` to `content.features` and `"minCore": "0.45.0"`; everything else is in the core (see the core's `docs/PAGE-SKIN.md`).

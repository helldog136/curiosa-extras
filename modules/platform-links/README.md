# Autres plateformes — module communautaire de Curiosa

Ajoutez votre OnlyFans, Mym, Fansly, Patreon, Ko-fi, Tipeee, Liberapay, Buy Me a Coffee, Linktree, ou n'importe quelle autre page, **en icône à côté de vos autres réseaux** (Instagram, Bluesky, Twitch, YouTube…), en haut du site. Les icônes sont placées au même endroit, dans le même alignement et avec le même rendu que celles de vos réseaux : ce module les remet au site, qui les range avec les autres.

## À quoi ça sert

- Vous collez l'adresse de votre page, même sans « https:// » (par exemple `onlyfans.com/monnom`) : elle est complétée toute seule. Pour une plateforme de la liste, votre nom seul suffit.
- Jusqu'à **20 liens**, dans l'ordre que vous choisissez (boutons **Monter** et **Descendre**, pas de glisser-déposer). Vous pouvez masquer un lien sans le retirer.
- Pour chaque lien, vous choisissez s'il y a **une page d'avertissement** avant son ouverture.

## La page d'avertissement (18 ans et plus)

- Par défaut, elle est **active pour OnlyFans, Mym et Fansly**, et **coupée pour les autres plateformes**.
- **Un lien OnlyFans n'est pas forcément du contenu pour adultes** : vous coupez l'avertissement pour toutes ces plateformes dans l'onglet *Réglages*, ou pour un seul lien dans son formulaire (« Non, ouvrir directement »). Quand il est coupé, l'icône ouvre directement la destination.
- La page dit : « Ce lien mène vers un site réservé aux adultes (18 ans et plus). », avec le bouton **J'ai 18 ans ou plus, continuer** et le bouton **Retour au site**. Le titre et le message se changent (dans chaque langue) dans l'onglet *Réglages*.
- Elle fonctionne sans JavaScript, n'est pas indexée par les moteurs de recherche, ne pose aucun cookie et ne compte aucune visite.
- **Ce n'est pas une vérification d'âge** : elle prévient, elle ne contrôle rien et ne remplace pas ce que la loi de votre pays peut demander.

## Ce que la personne qui visite ne voit pas

Pour que la plateforme sache d'où viennent les visites, le module ajoute à chaque adresse le nom de votre site (`utm_source`) et `utm_medium=link`. Rien de personnel n'est transmis, certaines plateformes ignorent ces informations, et vos propres paramètres ne sont jamais remplacés. Cela se règle en mode avancé (interrupteur général, nom de campagne, choix lien par lien) ; en mode simple il n'y a rien à faire.

## Comment les liens s'ouvrent (automatique)

Rien à régler. Un lien direct s'ouvre dans un **nouvel onglet** et indique à la plateforme d'où vient la visite (le nom de domaine de votre site seulement, jamais la page exacte) ; il est marqué « nofollow » pour ne pas être recommandé aux moteurs de recherche. Un lien avec page d'avertissement ouvre cette page dans le même onglet, puis le bouton « continuer » mène à la plateforme.

## Ce que le module ne fait pas

- Il ne vérifie pas l'âge du public et ne garde aucune donnée sur lui (pas de cookie, pas de compteur).
- Il ne montre pas plus de **10 icônes en tout** en haut du site, réseaux compris : c'est la limite du site.
- Les logos de Mym, Fansly et Tipeee ne sont pas fournis par le site : une pastille de lettre sobre les remplace. « Autre » a une flèche générique.
- Il ne copie rien depuis les plateformes (pas de nombre de followers, pas d'images).

## Réglages

- **Prévenir avant d'ouvrir OnlyFans, Mym et Fansly** (oui par défaut).
- **Titre** et **message** de la page d'avertissement (facultatifs, par langue).
- Mode avancé : **Indiquer d'où vient la personne qui visite** (oui par défaut), **nom de campagne**, **choisir l'origine lien par lien**.

## Droits et assistant IA

Seules les personnes autorisées (droit « modifier les liens des autres plateformes », donné aux administrateurs) peuvent changer la liste. Un assistant IA peut lister, ajouter et modifier des liens si vous lui en donnez l'accès ; il ne peut pas en retirer.

## Pour qui développe

Sujet fourni : `social.link`. Données : collection `links` (une ligne par lien). Page d'avertissement : route `go?l=<clé du lien>` de l'instance (`/m/<instance>/go?l=…`), car la page d'un module ne peut pas, dans ce cœur, se déclarer « non indexée » ; elle répond avec `X-Robots-Tag: noindex, nofollow`. La destination vient toujours de la configuration.

Depuis la 1.1.0 (cœur 0.2.13 ou plus), chaque bouton de `social.link` déclare `rel`, `referrerPolicy` et `target` (valeurs de la liste fermée du cœur) : `DIRECT_LINK` pour une icône directe, `NOTICE_LINK` pour une icône vers `/go`. Le bouton de la page `/go` partage `OUTBOUND_REL` / `OUTBOUND_REFERRER`. Sur un cœur plus ancien, ces champs sont ignorés sans danger.

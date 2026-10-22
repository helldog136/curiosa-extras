# Liens courts

Transformez une longue adresse en un **nom court** facile à retenir (par exemple `merch`), avec son **QR code** prêt à imprimer et un petit **compteur de clics par jour**.

## À quoi ça sert
Vous collez un lien dans un panneau de stream, une affiche ou un flyer : il est long, impossible à retenir, et vous ne savez jamais s'il sert. Ici, vous collez l'adresse, le module vous propose un nom court lisible, crée le lien et affiche tout de suite son QR code, à télécharger.

## Comment l'utiliser
1. Ouvrez **Liens courts** dans l'administration (onglet **Mes liens**).
2. Dans **Nouveau lien court**, collez l'adresse de la page (avec ou sans `https://`). Le nom court, la note et la date de fin sont facultatifs : sans nom, il vous en propose un lisible.
3. Cliquez **Créer le lien et son QR code**. Le QR code s'affiche, avec l'adresse courte à copier et trois téléchargements : une image nette (SVG) pour l'imprimeur, un PNG moyen pour un document ou un écran, un PNG grand pour une affiche.
4. **Testez avec votre téléphone avant d'imprimer.**

Pour chaque lien : combien de clics aujourd'hui, ces 7 et 30 derniers jours, et depuis la création, avec un petit graphique.

## Ce que voit le visiteur
Une redirection instantanée. Si le lien a disparu ou si sa date de fin est passée, une page aimable (dans la langue du site) propose de retourner à l'accueil. Vous pouvez écrire votre propre message pour les liens terminés dans les réglages.

## Changer la destination sans changer le QR code
Ouvrez un lien, **Modifier ce lien**, changez l'adresse : le nom court et le QR code déjà imprimé restent les mêmes et mènent à la nouvelle adresse. Le nom court lui-même ne change jamais (c'est ce qui est imprimé).

## Réglages
- **Compter les clics** (oui par défaut) : un nombre par lien et par jour, rien d'autre.
- **Solidité du QR code** (Normal par défaut) : Léger, Normal ou Renforcé (plis, taches).
- **Message d'un lien terminé** (facultatif, par langue).
- En mode avancé : **Début de l'adresse courte**, si votre hébergeur redirige déjà une adresse plus courte (par exemple `https://monsite.be/go/`) vers ce service.

## Vie privée
Aucun cookie, aucune adresse IP, aucun navigateur, aucune provenance : le site ajoute 1 à un compteur du jour pour le lien, c'est tout. Les robots et les aperçus de messagerie ne sont pas comptés. Les chiffres sont comptés en temps universel (la journée change à 1 h ou 2 h du matin en Belgique et en France).

## Sécurité
- Seules les adresses de pages web (`https://` ou `http://`) sont acceptées. Les adresses qui mènent à un ordinateur local, à un réseau privé, à un nom interne (`localhost`, `192.168…`, `monnas.local`…) sont refusées, ainsi que celles qui contiennent un nom d'utilisateur ou qui mènent à un autre lien court de ce site.
- La destination vient toujours de ce que vous avez enregistré, jamais de l'adresse que le visiteur ouvre : impossible d'en faire un lien « ouvert » vers un site quelconque.
- Les noms courts sont uniques, en minuscules, chiffres et tirets ; les mots que le site se garde (`admin`, `api`, les langues, les pages des autres modules…) sont refusés.

## Limites
- 300 liens au plus ; 120 jours de détail par lien (les jours plus anciens restent dans le total).
- Le QR code contient l'adresse courte complète, adresse du site comprise : si vous changez un jour le nom de domaine du site, les QR codes déjà imprimés ne marcheront plus (comme pour toute adresse). Prévenez-vous avant de changer.
- La destination n'est pas visitée par le site : un lien vers une page qui n'existe plus n'est pas détecté.
- En cas de redémarrage du site, les quelques clics notés à la seconde même mais pas encore écrits peuvent manquer.

## Pour les développeurs
Aucune dépendance. Le générateur de QR code (`qr.mjs`) est écrit en JavaScript pur : mode octet, correction L / M / Q, versions 1 à 10, masque choisi par la pénalité de la norme. Il est vérifié par un décodeur écrit pour les tests, par comparaison module par module avec une bibliothèque de référence, et par des lecteurs indépendants (voir `docs/ideas/short-links.md`). Adresse courte : `/m/<clé de l'instance>/go?c=<nom>`.

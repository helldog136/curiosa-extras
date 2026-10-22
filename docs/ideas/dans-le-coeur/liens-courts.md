# Liens courts (`short-links`) — description complète

## Le problème
On colle un lien dans un panneau de stream, une affiche ou un flyer : il est long, impossible à retenir, et on ne sait jamais s'il sert. Emma veut un nom court, un QR code à imprimer, et savoir quel support amène du monde.

## Pour qui
Créatrices et créateurs, streameuses, artistes, petites associations : personnes qui n'ouvrent jamais un fichier de configuration.

## Type de module et pourquoi
Module avec code, instance unique, type « utilitaire », sans page ajoutée au site (donc rien dans le menu des visiteurs). Un module « contenu » zéro code n'aurait ni QR code, ni compteur, ni contrôle des adresses, ni expiration. Le cœur a déjà « Raccourcis de liens » (redirections `/nom` vers une adresse, avec un compteur global) : il n'a ni QR code, ni date de fin, ni chiffres par jour, ni refus des adresses internes ; ce module ne le remplace pas et ne le touche pas.

## Ce que voit le visiteur
Une redirection immédiate (302, jamais mise en mémoire par le navigateur : la destination peut changer). Si le lien n'existe pas ou si sa date de fin est passée : une petite page aimable aux couleurs du site, dans la langue du navigateur (404 ou 410), avec un bouton vers l'accueil. Emma peut écrire son propre message pour les liens terminés. Aucun cookie.

## Ce que fait Emma, pas à pas
1. Administration, **Liens courts** (onglet **Mes liens**). Si l'adresse publique du site n'est pas réglée, un bandeau l'avertit avant qu'elle imprime.
2. **Nouveau lien court** : elle colle une adresse (avec ou sans `https://`, entre guillemets, avec un point final collé d'un message : tout est compris). Facultatifs : nom court, note pour elle, date de fin.
3. Si elle n'écrit pas de nom, il est proposé : d'après la note, sinon la fin de l'adresse, sinon le nom du site (`mug-chat`, `emma`, `youtube`), jamais un code illisible ; en cas de conflit `-2`, `-3`…
4. Elle arrive sur la fiche du lien : QR code, adresse courte à copier, téléchargements (SVG net pour l'imprimeur, PNG moyen 600 px, PNG grand 1500 px), conseils d'impression, chiffres (aujourd'hui, 7 jours, 30 jours, depuis la création) et graphique des 30 derniers jours.
5. Elle peut **changer la destination** (le nom, donc le QR code imprimé, ne changent jamais), la note, la date de fin ; ou supprimer (confirmation en clair).
6. La liste montre 50 liens à la fois (« Voir la suite »), avec une recherche dès 9 liens.
7. Export des clics par jour (tableur) et sauvegarde lisible (`liens.csv`, `clics-par-jour.csv`).

## Réglages et valeurs par défaut (rien à régler)
- Compter les clics : oui.
- Solidité du QR code : Normal (M). Léger (L) ou Renforcé (Q).
- Message d'un lien terminé : vide (message habituel), par langue, texte simple.
- Avancé : début de l'adresse courte (vide). Pour qui fait rediriger `https://monsite.be/go/<nom>` vers `/m/short-links/go?c=<nom>` (règle de réécriture du serveur web). Les QR codes créés ensuite contiennent la forme courte.
- Droit `links.edit` (créer, modifier, supprimer) proposé dans les rôles : administrateurs oui, éditeurs non. Sans lui, la personne voit tout et ne modifie rien.

## Adresses publiques
Adresse courte : `<site>/m/<clé de l'instance>/go?c=<nom>` ; image : `…/qr?c=<nom>&fmt=svg|png&size=s|m|l&dl=1`. **Écart avec le cahier des charges** : le cœur réserve `/go/…` et ne laisse pas un module répondre à un chemin choisi ni faire de redirection depuis une page ; l'adresse « monsite.be/go/merch » n'est donc pas possible sans réécriture côté serveur web (réglage avancé ci-dessus). C'est la solution honnête la plus proche.

## QR code
Générateur en JavaScript pur (`qr.mjs`, sans dépendance) : mode octet (UTF-8), niveaux L/M/Q, versions 1 à 10 (jusqu'à 271 octets), Reed-Solomon, repères, alignement, synchronisation, formats et versions (BCH), masque de moindre pénalité (règles N1 à N4). Dessin (`qr-render.mjs`) : SVG en un seul tracé, zone de silence de 4 modules dans l'image, noir sur blanc plein jamais transparent, texte alternatif ; PNG 1 bit (quelques centaines d'octets), 300 ppp annoncés. Si l'adresse est trop longue pour le niveau choisi, un niveau plus léger est essayé.

### Vérification
- Tests (`tests/short-links-qr.test.mjs`) : octets de correction et informations de format et de version de la norme ; capacités ; relecture par un **décodeur écrit à part** (avec correction d'erreurs, codes abîmés exprès) pour toutes les versions et tous les niveaux, SVG et PNG ; comparaison module par module avec la bibliothèque `qrcode` du cœur pour les 240 combinaisons version × niveau × masque ; masque recalculé par une seconde implémentation de la pénalité.
- À la main : 300 images (toutes versions et niveaux, 8 masques, charges pleines) relues sans erreur par OpenCV (certaines après changement d'échelle : détecteur, pas encodeur) et par jsQR ; PNG et SVG téléchargés depuis le vrai serveur relus par OpenCV.

## Données gardées et vie privée
- `links` : nom, destination, note, date de fin. `stats` : un seul document par lien (total + un nombre par jour sur 120 jours). Jamais une ligne par clic.
- Rien d'autre : pas de cookie, pas d'adresse IP, pas de navigateur, pas de provenance. Les robots, aperçus de messagerie et requêtes d'avance ne sont pas comptés ; 30 clics comptés par minute et par visiteur au plus (empreinte salée en mémoire, jamais écrite, remise à zéro au redémarrage). Jour = jour UTC. Déclaré dans `privacy`.

## Bornes
300 liens ; 120 jours de détail ; adresse ≤ 2 000 caractères ; nom 2 à 32 caractères ; note 80 ; pages de 50 ; images limitées à 120 par minute et par visiteur ; mémoire bornée (600 liens lus, 500 écritures en attente, 5 000 visiteurs, 3 000 compteurs d'images). Aucun minuteur.

## Sécurité de la route publique
Un seul paramètre lu (`c`), destination toujours tirée du stockage et revérifiée à chaque passage ; http/https seulement ; refus de `localhost`, `*.local`, noms sans point, IPv4 privées, locales, réservées, notations détournées (décimale, hexadécimale, octale, pleine chasse), IPv6 non publiques, services de noms « sauvages » (nip.io…), identifiants dans l'adresse, boucle vers un lien court ou une page technique de ce site ; la destination n'est jamais visitée par le serveur. GET/HEAD seulement (405 sinon) ; l'image du QR code n'existe que pour un lien qui existe.
Écriture sur GET : le décompte d'un clic est, par nature, une écriture sur une requête GET (c'est une redirection). Elle est bornée (un nombre par jour, coalescée, jamais bloquante) et la règle du kit « routes.methods » est satisfaite parce qu'une requête sans lien existant n'écrit rien.
Limite connue : pas de résolution de nom, donc un nom de domaine public qui pointerait vers une adresse privée n'est pas détecté (ne concerne que le navigateur du visiteur).

## Outils pour l'assistant IA
`shortlink_list` (lecture), `shortlink_stats` (lecture), `shortlink_create`, `shortlink_update` (écritures, jamais accordées d'office), `shortlink_delete` (destructif). Mêmes règles que l'écran ; erreurs lisibles en anglais, avec suggestion de nom.

## Intégrations
Aucune dépendance. Idée d'un service offert (créer un lien court + QR pour une page d'un autre module, par ex. « Laissez un avis ») : non fait ici.

## Non fait, et pourquoi
Adresse `/go/nom` native (impossible, voir plus haut) ; couleurs ou logo dans le QR code (risque de lecture) ; mise en pause d'un lien ; détection de destinations cassées (le site ne visite pas les adresses) ; statistiques par heure ou par provenance (vie privée) ; niveau H.

## Idées pour la suite
Service pour les autres modules ; pause d'un lien ; modèles d'impression (A6 avec légende) ; contrôle de santé via le module de contrôle du site ; adresse courte native si le cœur permet un chemin racine pour un module.

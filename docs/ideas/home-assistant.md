# Module « Home Assistant » (home-assistant 1.0.0)

## Le problème
Emma veut que ses viewers puissent, avec leurs points de chaîne Twitch, changer la couleur de ses lumières ou faire lire un message à voix haute chez elle, sans jamais mettre sa maison en danger : rien d'ouvert chez elle, rien de joué hors direct, un bouton pour tout couper, et un texte lu à voix haute qui ne peut pas être n'importe quoi.

## Pour qui, et ce qu'il fait
Pour la créatrice qui a Home Assistant à la maison. Le module tient la file des ordres, les confie à Home Assistant quand il vient les chercher (toutes les 3 secondes), vérifie qu'ils ont le droit de partir, et note ce qui s'est passé. Les récompenses Twitch elles-mêmes vivent dans le Bot Twitch (autre lot) ; l'intégration qui exécute chez Emma est l'intégration HACS « Curiosa » (autre dépôt). Type : intégration, instance unique (une seule maison).

## Ce que voit le visiteur
Rien : le module n'a aucune page publique. Les viewers ne voient que leurs récompenses Twitch ; leurs points sont rendus si l'ordre n'a pas pu partir.

## Ce que fait Emma, pas à pas
1. Installe le module (le Bot Twitch et « Ma Chaîne Twitch » aident ; sans « Ma Chaîne Twitch », le pont reste fermé et le dit).
2. Ouvre la page du module, onglet « Utiliser » : l'assistant en 3 étapes (installer l'intégration par HACS avec le lien du dépôt ; copier le code à 8 caractères et l'adresse du site dans Home Assistant ; c'est tout). La page affiche « Home Assistant est connecté ».
3. Teste avec « Tester le pont » (envoie un faux échange de points de chaîne, même hors direct, avec le suivi : envoyé, récupéré, exécuté / ignoré / expiré / refusé, et le délai total).
4. En cas de souci : le gros bouton rouge **« Tout couper »** en haut de page (visible sans défiler sur téléphone). « Reprendre » le remet en route. Un message d'état confirme (pas de boîte de dialogue).
5. Lit le journal des 50 dernières actions, avec le motif de chaque refus.

## Réglages et valeurs par défaut (onglet « Réglages »)
Délai avant d'abandonner un ordre 60 s (15–300) ; longueur maximale du message lu 140 (20–300) ; attente par personne 60 s ; attente globale 10 s ; pseudo avant le message : oui ; refuser les numéros : oui ; liste de mots fournie (FR + EN, 158 entrées) : oui ; mots à refuser en plus ; mots à toujours accepter ; (avancé) intervalle conseillé à Home Assistant 3 s (2–30). La liste fournie est visible dans la page. Choix : liste fournie + mots en plus − mots acceptés, plutôt qu'un gros champ pré-rempli, pour que les mises à jour du module améliorent la liste sans écraser les corrections d'Emma.

## Sécurité
- Home Assistant vient chercher (jamais d'appel de Curiosa vers chez Emma) ; il n'envoie que son jeton, un curseur et un accusé en code (liste fermée).
- Jeton d'appareil : 43 caractères, rendu une seule fois, seule l'empreinte SHA-256 est gardée, comparaison en temps constant, révocable (« Dissocier », ou nouvel appairage). Jamais affiché ni journalisé.
- Code d'appairage : 8 caractères sans ambiguïté, usage unique, 10 minutes, 5 essais, débit limité.
- Débit : 1 s entre deux interrogations, 60 accusés / 10 s, 20 jetons refusés / 5 min, 10 appairages / heure / visiteur.
- Coupe-circuit : bouton, outil assistant (`ha_stop`), service `stop` (commande `!stop` du Bot Twitch) ; reprendre est réservé (droit `ha.manage`, jamais un modérateur).
- Texte lu : nettoyage NFKC, caractères de contrôle, balises SSML/HTML/Markdown, liens et adresses, mentions, emojis (3 au plus), répétitions, longueur, numéros, mots (insensible aux accents, majuscules, chiffres glissés, lettres espacées ou répétées, alphabets proches). Refus : le viewer est remboursé, le motif est au journal, le texte refusé n'est pas gardé.
- « Seulement en direct » : Twitch dit « en direct » (+ 5 minutes de marge). Sans détection fiable, fermé.
- Aucun minuteur de fond : expiration et purge à la lecture.

## Données gardées et vie privée
Quatre documents bornés : état (appareil associé : nom + empreinte, curseur, dernier signe de vie, 50 clés d'action vues), file (50 ordres), résultats (50, 24 h), journal (100 lignes, 7 jours : pseudo Twitch, action, résultat ; le texte lu n'est gardé que s'il a été accepté). « Vider le journal » efface. Déclaré dans `privacy`.

## Bornes
File 50 ; journal 100 (50 à l'écran) ; résultats 50 ; clés vues 50 ; corps 4 Ko ; texte 2 000 caractères avant nettoyage puis ≤ 300 ; lot de 10 actions ; 3 livraisons ; mémoire de débit bornée à 2 000 entrées.

## Droits
`ha.manage` (associer, dissocier, vider, reprendre), `ha.stop` (« Tout couper »), `ha.test` (tester). Administrateurs : oui ; rédacteurs : non.

## Outils pour l'assistant IA
`ha_status`, `ha_journal` (lecture, accordés d'office) ; `ha_stop` et `home_assistant_test` (écritures, jamais accordées d'office). Aucun outil ne reprend, n'associe ni ne dissocie.

## Intégrations
Offre le service `home-assistant.bridge` v1 (utilisé par le Bot Twitch) ; publie les sujets `ha.result` et `ha.state` ; utilise facultativement `twitch.live`. Contrat exact : `home-assistant-contract.md`.

## Décisions prises seules
- Pas d'interrupteur manuel « Je suis en direct » : un oubli ouvrirait la maison hors direct ; sans détection, reste fermé et le dit. Le bouton « Tester » est la seule porte hors direct.
- Reprendre demande `ha.manage` (un modérateur coupe, ne reprend pas).
- Liste de mots : fournie + en plus − acceptés (voir ci-dessus).
- Code d'appairage gardé en clair 10 minutes (pour rester affiché si la page se recharge), jeton jamais.
- Le suivi d'un test se recharge la page toutes les 3 s pendant 60 s au plus (pas de minuteur côté serveur ; petit gestionnaire d'événement sur une image du bloc, car les blocs n'exécutent pas de script).
- Type « intégration » (rangé dans Extensions ; à épingler au menu pour avoir le bouton à portée de main).
- 503 = panne, pas « coupé » (voir le contrat).

## Pas fait
Validation humaine des textes ; commandes de chat qui pilotent la maison ; appel de Curiosa vers Home Assistant ; plusieurs maisons ; notification quand Home Assistant disparaît en plein direct (la page le dit, pas de courriel).

## Idées pour la suite
Pastille d'alerte quand Home Assistant est perdu pendant un direct ; historique de statistiques par récompense ; liste de mots par langue du chat ; mode « répétition » (essai à blanc sans lumière).

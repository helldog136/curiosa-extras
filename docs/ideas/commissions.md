# Commandes (`commissions`) — description complète

Module en **code** (une instance), type « widget » avec page publique `/commandes`. Choisi plutôt qu'un module « contenu » : il faut un formulaire protégé, des liens privés, un calcul de places, des droits, des e-mails et une liaison facultative avec Contacts, ce qu'un module sans code ne sait pas faire. Version 1.0.0, demande Curiosa 0.2.5.

## Le problème, pour qui
Les artistes, illustratrices, créatrices de modèles VTuber ou de bijoux répondent cent fois aux mêmes questions : « Vos commandes sont-elles ouvertes ? », « Combien ? », « Où en est ma commande ? ». Le module est pour Emma (aucun réglage obligatoire, aucun fichier à ouvrir).

## Ce que voit la visiteuse
- **Page `/commandes`** : l'état en une phrase (« Commandes ouvertes — 2 places libres », « Complet pour le moment — réouverture prévue le 12 mars 2027 », « Commandes fermées »), le message de l'équipe, les formules (nom, prix indicatif, délai, contenu), puis un formulaire court **seulement si ouvert** : prénom ou pseudo, e-mail, formule (si l'équipe en a), description, lien d'inspiration facultatif, case « me prévenir par e-mail » (seulement si le site sait envoyer des e-mails).
- Les erreurs s'affichent **sous le champ** avec un exemple ; l'envoi se fait sans quitter la page (petit code dans l'attribut `onsubmit`, qui marche aussi après une navigation sans rechargement). Sans JavaScript, le formulaire part normalement : succès → redirection vers le suivi, refus → page `/commandes/oups/<code>`.
- **Lien de suivi privé** `/commandes/suivi/<lien>` : prénom/pseudo, état, explication, formule, place dans la file (« 2 commandes avant la vôtre », réglable), message de l'équipe, étapes datées, lien à copier, boutons « Annuler ma demande » (nouvelle ou acceptée) et « Effacer ma demande » (nouvelle ou terminée). Jamais l'e-mail, jamais la note privée, jamais le texte de la demande.
- Une carte d'état pour l'accueil (section « État des commandes »).

## Le lien de suivi (sécurité)
32 lettres a–z et 2–7 tirées de 20 octets aléatoires du système = **160 bits**. Le site ne garde que l'**empreinte SHA-256** (avec un préfixe fixe), rangée comme clé d'index du stockage : une copie de la base ou de la sauvegarde ne donne aucun lien. Un lien mal formé n'est jamais cherché ; l'empreinte lue est comparée à celle calculée par `timingSafeEqual` (temps constant). Lien inconnu, périmé ou mal écrit : **la même réponse** (aucune énumération possible). Le lien est montré à la cliente à l'envoi (redirection) et envoyé par e-mail une seule fois ; l'équipe peut en créer un nouveau (l'ancien meurt). Limite honnête : une page publique n'a pas accès à l'adresse du visiteur, donc la page de suivi elle-même n'a pas de limiteur de débit (inutile avec 160 bits) ; les routes « annuler » et « effacer » en ont un (20 essais par heure).

## Ce que fait Emma, pas à pas
1. Installe le module : la page existe et dit « Commandes fermées » (rien n'est ouvert sans qu'elle le décide). Un encadré « Pour commencer » lui donne trois étapes.
2. Onglet **Formules** : ajoute ses formules (nom, prix indicatif en texte libre, délai, contenu, place dans la liste, affichée ou non). 12 au plus.
3. Onglet **Mes commandes** : clique « Choisir » en face d'« Ouvertes » ; règle le nombre de places (3 par défaut, 0 = sans limite), une date de réouverture facultative et un message.
4. Les demandes arrivent (pastille dans le menu ; e-mail à l'équipe au plus une fois par heure). Liste filtrée (nouvelles / en file / terminées / toutes), 50 par page, curseur. Elle ouvre une demande, choisit l'état suivant (proposé d'office), écrit un message pour la cliente, coche « la prévenir » et, si Contacts est là, « créer aussi sa fiche ». Notes privées, nouveau lien de suivi, suppression.
5. Télécharge la liste en CSV (droit « télécharger »).

## États et places
`new` (nouvelle) → `accepted` → `in_progress` → `delivered`, plus `refused` et `cancelled`. Tout changement est daté dans l'historique (30 entrées). **Places libres = places − (acceptées + en cours)**, calculées d'après les commandes (lecture bornée à 1 000 commandes, gardée 10 s en mémoire, invalidée à chaque écriture et quand le stockage est remplacé). Mode « ouvert » avec 0 place libre = « complet » tout seul. Le formulaire est refusé côté serveur quand ce n'est pas ouvert.

## Réglages et valeurs par défaut
Titre (vide = « Commandes »), texte de présentation, « me prévenir par e-mail quand une demande arrive » (oui), « proposer des e-mails aux clientes » (oui), « montrer sa place dans la file » (oui), « garder les commandes terminées N mois » (12 ; 0 = jamais). Avancés : demandes acceptées par heure et par visiteur (3), demandes nouvelles en attente au plus (100). L'état de la file, les places, la date et le message vivent dans le stockage (un document), modifiés par boutons.

## Droits
`manage` (gérer : état, places, formules, faire avancer, notes, suppression), `email.view` (voir les adresses e-mail, sensible), `export` (CSV, sensible). Rôles prédéfinis : administrateur oui, éditeur non. Sans `manage`, la personne ne voit que la liste ; sans `email.view`, jamais une adresse.

## Données gardées et vie privée
- Par commande : pseudo (40 car.), e-mail (200, effacé quand une fiche Contacts est reliée), description (1 500), lien d'inspiration (300), formule (nom copié), état et historique, note privée (2 000), message à la cliente (400), empreinte du lien, langue, accord pour les e-mails. **Pas d'adresse IP, pas de cookie.** Les compteurs de débit sont en mémoire, salés par démarrage.
- Les commandes **terminées** sont effacées après N mois (12 par défaut) par la tâche quotidienne du cœur (200 au plus par passage, idempotente). Les commandes en cours ne sont jamais effacées.
- La cliente peut annuler ou effacer sa demande ; `privacy.subject` (export, effacement, redirection) est offert à Contacts ; l'effacement d'une fiche supprime les commandes reliées.
- Déclaration `privacy` dans le manifeste (reprise par la page Confidentialité du site).

## E-mails (facultatifs)
Si `ctx.api.mail.configured()` : confirmation avec le lien, puis un court message à chaque changement d'état (seulement si la cliente a coché et si l'équipe a coché « la prévenir »). Texte simple, dans la langue de la cliente, **sans fuite** : pseudo, état, lien (une fois). Chaque message dit « si ce n'est pas vous, ignorez-le » (quelqu'un peut taper l'adresse d'une autre personne), une même adresse reçoit au plus 4 messages par jour, rien n'est envoyé sans accord. Envoi « au mieux » : tout est enregistré avant ; une panne ou la limite du cœur (10 par heure et par instance) n'enlève rien. Sans e-mail réglé, le module n'en dépend pas : la case disparaît et un texte l'explique à l'équipe.

## Contacts (facultatif)
`requires: contact.book min 2, optional`. À l'acceptation (case cochée) ou par le bouton « Ajouter aux Contacts », le module appelle `create` (qui retrouve une fiche par e-mail, donc jamais de doublon), ajoute une note courte, relie la commande (`contactId`) et **efface l'e-mail de la commande** : le carnet reste seul propriétaire du nom et de l'adresse. Pour écrire à la cliente ou exporter, l'adresse est relue dans le carnet (appels bornés à 5 s). Fiche fusionnée : suivie et corrigée ; fiche supprimée : bandeau d'explication ; carnet muet : rien ne casse. Offre `privacy.subject`.

## Bornes
12 formules ; 1 000 commandes gardées (503 au-delà, avertissement à 90 %) ; 100 demandes nouvelles en attente (réglable 10–500) ; 3 demandes acceptées par heure et par visiteur, 60 par heure pour tout le site, 3 par jour pour une même adresse, 40 essais par heure et par visiteur ; au plus 2 liens dans la description ; export 500 commandes par lecture ; MCP : 50 par page.

## Outils pour l'assistant IA
Lecture : `commissions_status`, `commissions_list` (jamais d'e-mail ni de note privée ; texte de demande tronqué à 400 caractères, signalé comme donnée), `commissions_formulas`. Écriture (jamais accordée d'office) : `commission_set_status` (avec message et envoi d'e-mail facultatifs), `commissions_set_queue`. Aucune suppression.

## Ce qui n'est pas fait, et pourquoi
Paiement, devis, factures (hors sujet, jamais d'argent) ; fichiers envoyés par la cliente (lien d'inspiration à la place, pas de stockage de fichiers de visiteurs) ; réponse de la cliente (pas de messagerie) ; formules traduites par langue (texte libre, une langue) ; réouverture automatique à la date (la date est informative, l'ouverture reste un geste d'Emma) ; liste d'attente quand c'est complet ; page de suivi sans `noindex` (l'API des modules n'offre pas d'en-tête de page : le lien n'est jamais publié ni listé).

## Idées pour la suite
Formules par langue ; liste d'attente (« prévenez-moi à la réouverture ») ; réouverture automatique ; pièces jointes de la cliente par un module de fichiers ; étiquettes de commande (urgent, cadeau) ; statistiques (délai moyen) ; notification Discord via le module d'annonces.

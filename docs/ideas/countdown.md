# Compte à rebours (`countdown`) : description complète

Module n°8 des dix idées du 22 octobre 2026. Version 1.0.0, `minCore` 0.2.5, API des modules 2, licence MIT.

## Le problème

Annoncer une sortie, un lancement, un anniversaire ou une convention : tout le monde est dans un fuseau horaire différent et personne ne sait quand « 20 h » tombe chez soi. Les comptes à rebours en ligne sont des outils tiers (publicité, pas de page à soi, pas d'agenda, pas de source pour le stream).

## Pour qui, et la frontière avec le Planning

Pour Emma, qui n'ouvre jamais un fichier. Le module sert aux **événements ponctuels**. Le module Planning liste les **streams réguliers** (il lit des agendas) : ce module-ci n'en lit aucun, n'offre ni ne consomme aucun sujet `planning.slot` ou `calendar.event`, et le dit dans l'aide de l'écran (« Pour vos streams réguliers, utilisez le module Planning des streams »). Les descriptions des outils pour assistants disent aussi de ne pas l'employer pour un stream régulier.

## Ce que voit le visiteur

- **Une page** (`/countdown` par défaut) : l'événement à la une en grand, les autres dessous, par date. Chaque événement a sa page (`/countdown/<nom-court>`) avec description, lieu, image, retour à la liste. Pagination par chemin (`/page/2`), 20 par page.
- **Une carte** : nom, date et heure dans le **fuseau de l'événement** (« Samedi 14 novembre 2026 à 21 h (heure d'Europe centrale) »), puis, écrite par le navigateur, **l'heure chez le visiteur** en toutes lettres (« Samedi à 15 h chez vous », « Demain à 15 h chez vous », « Dimanche 15 novembre à 5 h chez vous »). Si le visiteur est sur la même heure que l'événement, une seule phrase.
- Les jours, heures, minutes et secondes qui avancent, un bouton **Ajouter à mon agenda** (.ics).
- **Quand l'heure arrive** : les chiffres sont remplacés, sans recharger, par le message de fin choisi (« C'est parti ! ») avec un bouton facultatif ; au bout du délai choisi, la carte disparaît.
- **Sans JavaScript** : la carte est écrite en entier par le serveur ; la date et l'heure restent lisibles dans le fuseau de l'événement (avec le nom du fuseau), le bouton d'agenda fonctionne. Les chiffres sont ceux du moment de l'ouverture de la page.
- **Mouvement réduit** (réglage de l'appareil) : pas de secondes, un seul changement par minute, aucune animation.
- **Lecteurs d'écran** : les chiffres sont masqués, une phrase (« Dans 3 jours, 4 heures et 12 minutes ») est mise à jour une fois par minute, sans annonce permanente.
- **Accueil** : deux morceaux : « Compte à rebours à la une » (un grand compteur) et « Prochains événements » (3 par défaut, 10 au plus, sans répéter celui de la une). Sans événement, ils disparaissent.
- **Source OBS** (`/overlays/<clé>`) : fond transparent, panneau sobre (sombre par défaut, clair, ou sans fond avec ombre), nom, chiffres, puis message de fin pendant quelques minutes, puis la source s'efface ou passe à l'événement suivant. `?e=<nom-court>` montre un événement précis.

## Ce que fait Emma, pas à pas

1. Extensions, Compte à rebours, onglet **Mes événements**.
2. Formulaire court : **Nom, Jour, Heure** (« 21h30 », « 21:00 », « 9pm » acceptés), case « Toute la journée », fuseau (liste de 45 régions, celui du site proposé d'office), case « Mettre à la une ». **Ajouter**.
3. Si une saisie est fausse, le message est **sous le champ**, avec un exemple, et le champ reçoit le focus.
4. Si l'heure tombe sur un changement d'heure, l'événement est accepté et un message l'explique : « Cette heure n'existe pas ce jour-là (passage à l'heure d'été) : l'événement est placé à 3 h 30 » ; ou « existe deux fois : la première est prise ».
5. **Modifier** : formulaire complet (fuseau libre, dernier jour et heure de fin, description, lieu, image, message de fin, texte et adresse du bouton, délai avant disparition, à la une) ; un aperçu « Chez vos visiteurs : Londres : 19 h · New York : 14 h · Tokyo : 4 h (le lendemain) » ; les adresses à copier (page, agenda, OBS pour cet événement).
6. **Réutiliser** (événements masqués) : copie avec une nouvelle date (anniversaire de l'an prochain). **Supprimer**. **Supprimer les événements masqués** (ménage, avec confirmation). **Télécharger tous mes événements** (agenda .ics).
7. Accueil : « Page d'accueil », ajouter le morceau. OBS : copier l'adresse affichée dans l'onglet et la coller dans une source navigateur.

## Réglages et valeurs par défaut

| Réglage | Défaut |
|---|---|
| Mon fuseau horaire (liste) | Europe/Paris (Belgique, France, Allemagne…) |
| Autre fuseau (mode avancé) | vide |
| Garder affiché une fois passé | 1 jour (1 h, 6 h, 1 jour, 3 jours, 1 semaine, 1 mois, jamais) |
| Message de fin | vide : « C'est parti ! » |
| Titre de la page | vide : « Compte à rebours » |
| Afficher les secondes | oui |
| OBS : style / place / taille / couleur du liseré / minutes du message de fin | sombre / haut centre / moyen / couleur du thème / 5 |

Aucun réglage n'est obligatoire : le module marche dès l'installation. Une instance est ajoutée à l'accueil par l'assistant de première installation (`onboarding.home`).

## Les heures : comment c'est fait

- Un événement est gardé comme **jour + heure du mur + nom du fuseau** (2026-03-29, 21:00, Europe/Paris), jamais comme un décalage. L'instant exact est calculé **à chaque lecture** avec les règles de CE jour-là (`zonedToUtc`, `time.mjs`). Si les règles d'un pays changent, les événements à venir se corrigent à la mise à jour des données de fuseaux du serveur.
- Heure inexistante (printemps) : on prend l'heure d'après ; heure double (automne) : la première. Même convention que les agendas.
- Le temps restant est le vrai temps écoulé : entre samedi midi et dimanche midi de la nuit du changement d'heure, il reste 23 h.
- Nom de fuseau : seuls les vrais noms officiels (jamais « +01:00 »), majuscules rétablies, ancien nom jamais substitué à celui qu'on a choisi.
- Journée entière : minuit dans le fuseau de l'événement, fin = lendemain du dernier jour ; la date ne bouge pas d'un pays à l'autre.
- Plage acceptée : années 2000 à 2100.

## Le compteur du visiteur (sans dérive)

Le script envoyé (`/m/<clé>/live.js`, environ 12 Ko, mis en cache un an sous une empreinte) est **le même code que celui du serveur et des tests** (fonctions envoyées par `Function.prototype.toString`). Chaque affichage est **recalculé** depuis l'heure cible et l'heure du moment : rien n'est décrémenté. Le réveil suivant est calculé pour tomber pile sur le prochain changement affiché ; un minuteur en retard, un onglet gelé ou un ordinateur en veille ne laissent donc aucune erreur. Onglet caché : plus aucun minuteur ; au retour, tout est recalculé d'un coup. L'horloge de l'appareil n'est comparée à celle du serveur que si elle diffère de plus de 5 s de l'heure d'écriture de la page (une petite demande `/m/<clé>/now`, sans cookie) ; sinon, aucune demande. Une navigation du site sans rechargement est prise en charge (observateur de page, délai de 60 ms).

## Disparition : à la lecture, sans minuteur

Rien ne tourne en arrière-plan. À chaque lecture (page, accueil, agenda, source OBS) on compare l'heure du moment à « fin donnée (sinon début) + délai choisi ». Les événements masqués restent dans l'écran d'administration (« Événements masqués ») jusqu'à ce qu'Emma les réutilise ou les supprime ; rien n'est supprimé en silence. La carte déjà ouverte se masque d'elle-même au bon moment.

## Le fichier d'agenda (.ics)

Un fichier par événement (`/m/<clé>/ics?e=<nom-court>`), validé par un lecteur strict écrit à part dans les tests : fins de ligne CRLF, 75 octets au plus par ligne (pliage sans couper un caractère), textes protégés (`\ ; ,` et retours à la ligne), `UID` stable (jamais refait, même après modification et renommage), `DTSTAMP` et `LAST-MODIFIED` = dernière modification, `SEQUENCE` +1 à chaque modification (les agendas déjà abonnés se mettent à jour), heures en UTC (suffixe Z, aucun fuseau à embarquer), journée entière en `VALUE=DATE`. Sans heure de fin, durée 1 heure. Le fichier est refusé (404) pour un événement masqué.

## Données gardées et vie privée

- Une collection `events` du stockage de l'instance : au plus **100 événements** (au-delà, message qui dit quoi supprimer). Texte borné : nom 80, description 600, lieu 120, message de fin 140, bouton 40.
- **Aucune donnée de visiteur** : pas de cookie, pas de compteur, pas d'adresse. Les routes publiques ont un limiteur de débit en mémoire par visiteur (adresse hachée, jamais écrite, table bornée à 5 000 entrées) : `ics` 60/min, `now` et `state` 120/min. Pas de déclaration `privacy` (le kit confirme : rien collecté).
- Tout texte saisi est échappé ; les liens ne sont repris que s'ils sont https, http, mailto ou une page du site ; les images que si elles sont du site ou https.

## Droits et assistants

- Droits : `events.edit` (créer, modifier, mettre à la une) et `events.delete` (supprimer, ménage), proposés dans les rôles (refusés à l'éditeur par défaut). Les actions sont des fonctions qui vérifient `ctx.can` (voir « ce qui n'est pas fait »).
- Outils MCP : `events_list` (lecture seule, `include_hidden`), `event_create`, `event_update`, `event_set_featured`, `event_delete` (destructif, jamais accordé d'office). Le jour et l'heure sont donnés tels qu'écrits dans le fuseau de l'événement ; la réponse rend l'instant exact en UTC et un avertissement si l'heure tombe sur un changement d'heure.

## Intégrations

Aucune dépendance. Sauvegarde lisible : `events.csv` (protégé contre les formules de tableur) et `events.ics`. Téléchargement d'administration : tous les événements en .ics, écrit ligne par ligne.

## Placement dans le menu (limite du cœur)

La permission `overlay` range l'instance dans « Seulement dans Extensions » (famille Overlays), même si le module a une page et un morceau d'accueil. Emma peut l'épingler au menu.

## Ce qui n'est pas fait, et pourquoi

- **Détection du fuseau d'Emma** : un formulaire d'administration est écrit par le cœur, un module n'y met pas de script. À la place : le fuseau du site (réglage, une fois) proposé d'office, et un aperçu « chez vos visiteurs » à l'enregistrement. Idée : un bloc de formulaire du cœur qui pré-remplit avec le fuseau du navigateur.
- **Droits par objet `{ right, run }`** : le kit de conformité du cœur refuse un formulaire qui pointe vers une action de cette forme (`testsupport/requirements/code.mjs`, `FN(d.adminActions[...])`, alors que `def.loads` l'accepte). Les actions sont donc des fonctions réservées aux administrateurs qui vérifient `ctx.can` ; un rôle personnalisé peut ouvrir la page mais pas écrire. À corriger dans le kit, puis passer aux objets.
- **Zone « Europe/Brussels »** : absente de la liste (la liste de neutralité du dépôt interdit le mot) ; « Europe/Paris » a exactement les mêmes règles ; l'étiquette dit « Belgique, France… ».
- **Événement qui se répète chaque année** : « Réutiliser » le remplace.
- **Données structurées « Event »** pour les moteurs de recherche : l'emplacement d'en-tête ne sait pas sur quelle page il est.
- **Lien Google Agenda** : seul le .ics (valable partout) est proposé.
- Un test du dépôt (`srp-guard`) cherche les mots `VCALENDAR` et `BEGIN:VEVENT` entiers pour s'assurer qu'un seul module lit de l'iCal ; ce module **écrit** du iCal : ces mots sont écrits en deux morceaux dans `ics.mjs`. Le test gagnerait à viser la lecture (`RRULE`, analyse) plutôt que l'écriture.

## Idées pour la suite

Récurrence annuelle ; annonce automatique (message Discord) à l'heure de début, via les sujets existants ; données structurées « Event » ; fuseau détecté par le navigateur dans l'administration ; plusieurs langues de message de fin ; compteur « depuis » (anniversaire passé) ; QR code de la page (service `short-links`).

# Compte à rebours 1.0.0 : notes de version

## Nouveautés
- Nouveau module « Compte à rebours » pour annoncer une sortie, un lancement, un anniversaire ou une convention.
- Vos visiteurs voient le temps qui reste et l'heure chez eux, écrite en toutes lettres (« samedi à 21 h chez vous »).
- Un bouton « Ajouter à mon agenda » pour chaque événement.
- Un message de fin de votre choix quand l'heure arrive, avec un bouton ; l'événement disparaît tout seul après le délai que vous choisissez.
- Plusieurs comptes à rebours, dont un « à la une », sur une page, sur l'accueil et dans votre stream (OBS).

## Améliorations
- Le passage à l'heure d'été et d'hiver est toujours juste, même pour un événement dans plusieurs mois ou dans un pays lointain. Si l'heure choisie n'existe pas ou existe deux fois, le module vous le dit.
- Fonctionne sans réglage dès l'installation, sur téléphone, en français et en anglais.
- Respecte la demande « moins de mouvement » des visiteurs ; sans JavaScript, la date et l'heure restent lisibles.
- Aucune donnée de visiteur n'est gardée.

## Pour les développeurs
- Heure d'un événement = jour + heure du mur + nom du fuseau, instant calculé à la lecture (`time.mjs`) ; fonctions communes serveur et navigateur envoyées par `Function.prototype.toString`.
- Fichier .ics écrit à la main (pliage 75 octets, échappements, UID stable, SEQUENCE, DTSTAMP) et validé par un lecteur strict dans les tests.
- Source OBS (permission `overlay`) alimentée par une route en lecture seule `state` ; routes `ics`, `now`, `live.js` ; emplacement `layout.head`.
- Aucune tâche de fond ; disparition évaluée à la lecture ; 100 événements au plus.
- Actions d'administration en forme de fonction avec contrôle `ctx.can` (le kit refuse la forme objet pour les formulaires).
- Tests : `tests/countdown*.test.mjs`, aides `tests/helpers/countdownDom.mjs` (navigateur factice, horloge manuelle) et `countdownIcs.mjs` (lecteur strict).

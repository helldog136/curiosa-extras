# Calendrier iCal — module communautaire de Curiosa

Lit un **Google Agenda** (ou n'importe quel flux iCal) et le met à la disposition du site : le **Planning des streams** l'affiche, et rien d'autre à brancher. Ajoutez une instance par calendrier ; plusieurs peuvent alimenter le même planning.

- **Adresse du calendrier** (secrète) : Google Agenda → Paramètres → votre agenda → « Adresse secrète au format iCal ». Elle est traitée comme un mot de passe : jamais réaffichée une fois enregistrée, jamais écrite dans un journal ni dans un message d'erreur. **Utilisez un agenda dédié** : tout ce qu'il contient devient public.
- **Nom** et **couleur** (facultatifs) : le planning peut montrer d'où vient chaque stream (réglage « Montrer la source »). **Étiquettes** (facultatives, avancé) : un planning peut choisir ses sources par étiquette. **Fuseau horaire** (avancé) : pour les heures écrites sans fuseau et les journées entières. **Minutes entre deux lectures** (avancé, 5 par défaut).
- **Admin** : état de la dernière lecture (nombre d'évènements, erreur en clair) et bouton **« Tester l'adresse »**.

## Ce qu'il lit
Évènements simples et **répétitions** (chaque jour, semaine avec jours choisis, mois, année ; fin par date ou par nombre), dates **exclues**, occurrences **déplacées ou annulées**, **fuseaux horaires**, journées entières et évènements **annulés** (`STATUS:CANCELLED`). Les répétitions sont développées **sur la plage demandée** par le consommateur. Pas d'implémentation complète de la norme (pas de « le 2e mardi du mois »).

## Ce qu'il donne
Le sujet **`calendar.event`** (voir le README du dépôt pour le contrat exact : `id`, `title`, `start`, `end`, `allDay`, `description`, `location`, `url`, `status`, `sourceLabel`, `color`) et le service **`calendar.provider`** (`each` : chaque instance répond pour son calendrier). Les évènements sont **bruts** : le fournisseur n'interprète pas la description (la ligne « Jeu : … » est l'affaire du Planning) et ne connaît aucun consommateur. Il faut Curiosa 0.1.16 ou plus.

## Sécurité
Adresse en `https://` et publique seulement : localhost, réseaux privés et adresses de lien local sont refusés, y compris à chaque redirection (3 au plus). Téléchargement limité à 8 secondes et 5 Mo ; mis en cache (avec `ETag` / `If-Modified-Since` quand le serveur les donne) ; une seule demande à la fois ; après une erreur, pas de nouvelle tentative avant 30 secondes, et la dernière copie (moins de 24 h) est gardée en attendant.

## Reprise automatique
Un Planning installé avant la 2.0.0 gardait lui-même l'adresse. En passant à la 2.0.0, il crée pour vous une instance de ce module avec la même adresse, puis efface son ancien réglage : le planning montre les mêmes évènements.

# Planning des streams — module communautaire de Curiosa

Vos prochains streams, jour par jour, lus depuis un **Google Agenda** (ou n'importe quel flux iCal). Porté du planning
d'un site existant.

- **Page publique** `/planning` : les *N* prochains jours (7 par défaut, réglage avancé), heure du fuseau choisi.
- **Section d'accueil** « Prochains streams » (à placer depuis *Page d'accueil*).
- **Sujet `planning.slot`** : d'autres modules (overlay, bot…) peuvent lire les prochains créneaux.
- **MCP** : `planning_upcoming` (lecture seule, accordée par défaut).
- **Admin** : état du calendrier, prochains créneaux, bouton « Actualiser maintenant ».

## Configurer

Dans Google Agenda : *Paramètres → votre agenda → « Adresse secrète au format iCal »*, à coller dans le réglage de l'instance
(elle n'est plus jamais réaffichée). **Utilisez un agenda dédié** : tout ce qu'il contient devient public.

Pour afficher le jeu d'un créneau, écrivez dans la **description** de l'événement une ligne `Jeu : Nom du jeu` (plusieurs jeux :
séparés par une virgule ou « + », trois maximum). Rien n'est deviné depuis le titre.

## Sécurité

L'adresse doit être en `https://` et publique : localhost, réseaux privés et adresses de lien local sont refusés (le serveur
télécharge l'adresse : pas de requête vers le réseau interne). Téléchargement limité à 8 s et 5 Mo, mis en cache 5 minutes.

## Non repris de la version d'origine

Les jaquettes de jeux (API RAWG) et l'export PNG du planning pour le panneau Twitch.

## Image à partager (PNG)

`https://votre-site/m/<clé>/image` : la semaine en cours (lundi → dimanche) en image PNG aux couleurs du site, prête pour un panneau Twitch ou un réseau social. `?week=1` pour la semaine suivante (jusqu'à 8). Générée par le service du cœur `ctx.api.png`, mise en cache 5 minutes.

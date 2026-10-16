# Évènements saisis à la main — module communautaire de Curiosa

Pour celles et ceux qui n'ont **pas de calendrier en ligne** : écrivez vos évènements dans l'admin, le **Planning des streams** (ou tout autre module qui affiche des calendriers) les montre.

- **Un évènement** : titre, date et heure de début, fin (ou **toute la journée**), description, lieu, lien, **annulé** oui/non, catégorie (pour un stream : le nom du jeu, que le planning affiche quand la description n'a pas de ligne « Jeu : »).
- **Une répétition simple** : aucune, ou **chaque semaine** (jours de la semaine, jusqu'à une date ou un nombre de fois ; sans l'un ni l'autre, jusqu'à ce que vous la supprimiez). Les heures suivent l'heure d'été du fuseau choisi.
- **Simple** : une liste et un formulaire. Rien n'est supprimé sans une confirmation. Jusqu'à 500 évènements par instance.
- **Nom**, **couleur** (facultatifs) et **étiquettes** (avancé) : le planning peut montrer d'où vient chaque stream et choisir ses sources par étiquette. **Fuseau horaire** : celui des heures que vous saisissez.

Les évènements sont gardés dans le stockage du module. Il donne le sujet **`calendar.event`** (contrat dans le README du dépôt) et le service **`calendar.provider`** (`each`) ; il ne connaît aucun consommateur. Il faut Curiosa 0.1.16 ou plus.

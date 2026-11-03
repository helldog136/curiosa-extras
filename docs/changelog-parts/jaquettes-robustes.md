## Jaquettes de jeux : vos jaquettes restent affichées quand RAWG est en panne

*Pour Curiosa 0.6.0 ou plus. Module touché : Jaquettes de jeux 1.2.0.*

### Nouveautés
- Les jaquettes trouvées toutes seules sont gardées (1 000 au plus) : elles survivent aux redémarrages et s'affichent même quand RAWG ne répond pas, y compris après 24 heures.
- Une panne n'est jamais retenue comme « pas de jaquette » ; après trois échecs d'affilée, le site fait des pauses (1, 2, 5, 15 minutes au plus) au lieu d'insister.
- L'état de RAWG se lit en haut de « Jaquettes à vérifier » ; le Journal du site note l'arrêt et le retour une fois.
- « Jaquettes enregistrées » montre aussi les jaquettes trouvées toutes seules (« Voir », « Changer », « Oublier »).
- Réparé : « Corriger » sur un titre à vérifier affichait une erreur.

### Pour les développeurs
- Collection `autoCovers`, disjoncteur en mémoire, `keyState.okAt`, journal `cover.outage` / `cover.back` ; aucune permission, aucun hôte, aucune image téléchargée.

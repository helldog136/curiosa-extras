# Journal des changements : Connecteur Home Assistant

## 1.1.0 : le module devient « Connecteur Home Assistant »

### Nouveautés
- Le module s'appelle maintenant **Connecteur Home Assistant** (comme « Connecteur Twitch »). Rien ne change dans votre installation : même identifiant, mêmes liens, mêmes réglages.
- **Mise en route en 3 étapes** sur la page : installer l'intégration dans Home Assistant, l'associer avec le code, créer une première récompense (un bouton mène au Bot Twitch).
- **« Étape suivante »** : un bouton « Créer ou modifier tes récompenses » vers l'onglet Récompenses du Bot Twitch ; le Bot Twitch a le lien inverse « Relier à ta maison ».
- **« Actions en attente de liaison »** : quand Home Assistant n'a pas encore de script pour une action, la page la nomme (20 au plus) jusqu'à ce qu'elle marche.
- **Les noms de vos actions** (« Lancer l'aspirateur ») viennent du Bot Twitch, en option, et sont donnés à Home Assistant pour qu'il propose de choisir un script. Aucune entité de votre maison n'est envoyée à Curiosa.

### Pour les développeurs
- `pull` ajoute le champ `catalog: [{ key, label }]` (50 au plus, libellé ≤ 60 caractères, toujours présent) : contrat HTTP v1 compatible. Sujet consommé (facultatif) : `home.actions`. `catalog.mjs` (nouveau) borne et met en cache la lecture (30 s, 1,5 s au plus). `haCore.unmapped` : 20 au plus. Aucun changement de route, de service (`home-assistant.bridge` v1), de sujet fourni ni d'identifiant.

# Journal des changements : Home Assistant 1.0.0

## Nouveautés
- Vos viewers peuvent changer la couleur de vos lumières ou faire lire un message à voix haute chez vous avec leurs points de chaîne, grâce à Home Assistant.
- Un gros bouton « Tout couper » arrête tout en un clic ; « Reprendre » remet en marche.
- Un assistant en 3 étapes pour associer Home Assistant, avec un code à 8 caractères.
- Un bloc « Tester le pont » pour vérifier que tout marche sans attendre un viewer, avec le suivi du trajet.
- Les messages lus sont vérifiés : liens, numéros, mots de la liste (français et anglais, que vous complétez), longueur, attentes.
- Un journal des 50 dernières actions, avec la raison de chaque refus.

## Améliorations
- Rien ne se joue hors direct (avec 5 minutes de marge après la fin), et un ordre non exécuté à temps est abandonné : les points sont rendus.
- Rien n'est ouvert chez vous : c'est Home Assistant qui vient chercher les ordres.

## Pour les développeurs
- Nouveau module `home-assistant` (instance unique, minCore 0.2.6) : service `home-assistant.bridge` v1 (`enqueue`, `status`, `stop`, `start`), sujets `ha.result` et `ha.state`, routes publiques `pair`, `pull`, `ack`, droits `ha.manage`, `ha.stop`, `ha.test`, outils `ha_status`, `ha_journal`, `ha_stop`, `home_assistant_test`.
- Contrat HTTP exact : `docs/ideas/home-assistant-contract.md` ; simulateur : `tests/helpers/fakeHaClient.mjs`.
- Les sujets `ha.result` et `ha.state` sont à ajouter au tableau « Sujets connus » de docs/MODULES.md du cœur.

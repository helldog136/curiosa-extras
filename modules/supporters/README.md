# Soutiens

Remerciez les personnes qui vous soutiennent sur une plateforme de mécénat, **sans jamais rendre quelqu'un public sans son accord**.

## À quoi ça sert
- Votre plateforme (Patreon, Ko-fi, ou n'importe laquelle par un fichier) dit qui vous soutient. Ce module le sait, sans que vous retapiez rien.
- Une page publique des soutiens montre **seulement le pseudo que chaque personne a choisi et accepté de montrer**, sous un libellé de palier que vous choisissez. Jamais un montant, jamais un vrai nom, jamais une adresse.
- Facultatif : vous rangez vos soutiens dans Contacts (le carnet d'adresses du site), dans une catégorie de votre choix.

## Pour commencer (rien d'obligatoire)
1. Installez le module. Ouvrez l'onglet « Mes soutiens » : un assistant en étapes vous guide pour la plateforme choisie (réglage « D'où viennent vos soutiens ? »).
2. Collez la clé secrète de la plateforme dans l'onglet Réglages (elle n'est jamais réaffichée), puis cliquez sur « Vérifier et actualiser ». Pas de plateforme connectable ? Importez un fichier CSV.
3. Allumez la page publique quand vous voulez (elle est éteinte au départ, et reste vide tant que personne n'a donné son accord).
4. Pour chaque personne, ouvrez sa ligne, copiez son **lien d'accord personnel** et envoyez-le-lui. Elle y choisit son pseudo et dit oui (ou non). Vous relisez le pseudo, vous cliquez sur « Approuver ».

## Réglages
| Réglage | Par défaut |
|---|---|
| D'où viennent vos soutiens ? | Patreon (aussi : Ko-fi, un fichier importé) |
| Clé secrète de la plateforme | vide (jamais réaffichée) |
| Montrer une page publique des soutiens | **non** |
| Je relis chaque pseudo avant qu'il apparaisse | oui |
| Titre, quelques mots, titre du groupe sans libellé, mots d'accueil de la page d'accord | mots neutres (français et anglais) |
| Catégorie de Contacts pour les soutiens | aucune (suggestion : « Soutiens ») |
| Regrouper par libellé de palier | oui |
| Avancé : jours d'activité d'un don, jours avant d'oublier un soutien arrêté, minutes entre deux actualisations, pseudos par page, catégorie du mur des remerciements | 40 · 365 · 360 · 48 · aucune |

Plusieurs plateformes ? Ajoutez une instance du module par plateforme (chacune a sa page et ses réglages).

## Vie privée en bref
- S'inscrire sur la plateforme **n'est pas** un accord : rien n'est montré sans l'accord séparé de la personne sur son lien personnel, où elle peut aussi se retirer.
- Aucun montant n'est gardé ni montré, aucune adresse e-mail n'est gardée, aucun cookie, rien n'est chargé chez la personne qui visite.
- Le nom donné par la plateforme n'est gardé ici que jusqu'au rangement dans Contacts ; les soutiens arrêtés sont oubliés après un an.
- Contacts peut exporter, effacer ou fusionner ce que le module sait d'une personne.

## Limites
5 000 soutiens, 2 000 membres lus par actualisation, 1 000 lignes par import, 25 par page d'administration, 50 pseudos par page publique. Aucune tâche de fond : une actualisation n'a lieu que si vous la demandez ou si quelqu'un ouvre la page après plusieurs heures.

Documentation complète : `docs/ideas/supporters.md`.

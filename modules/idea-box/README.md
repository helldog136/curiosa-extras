# Boîte à idées

Une page où votre public vous propose des idées. Vous relisez chaque idée, vous la publiez, et vous la faites avancer : proposée, étudiée, planifiée, réalisée. Le public peut soutenir les idées qu'il aime.

Rien n'est à régler pour commencer : installez le module, ouvrez la page `/idees`, c'est prêt.

## Ce que voit votre public

- Un champ **« Votre idée »** et un bouton **« Proposer cette idée »**. Le pseudo est facultatif et se cache sous « Plus d'options » : personne n'a besoin de donner son vrai nom, et aucune adresse e-mail n'est demandée.
- La liste des idées que vous avez publiées, avec leur statut (**Proposée, Étudiée, Planifiée, Réalisée**, et **Écartée** si vous choisissez de la montrer) et, si vous en avez écrit une, votre réponse courte.
- Un champ **« Rechercher une idée »** qui filtre pendant la frappe, et deux tris : **Les plus soutenues** et **Les plus récentes**.
- Un bouton **« Je soutiens »** sur chaque idée proposée, étudiée ou planifiée. Un seul soutien par personne et par idée, sans compte à créer.

## Ce que vous faites (administration, onglet « Idées »)

Un seul tableau, avec une recherche en direct et des pastilles pour trier d'un clic : **À relire**, **Proposée**, **Étudiée**, **Planifiée**, **Réalisée** (et **Écartée**, **Refusée**, **Masquée** quand il y en a), chacune avec son nombre.

- **Publier** : l'interrupteur de la colonne « Publiée ». Un clic, l'idée apparaît sur la page. Éteint, elle disparaît de nouveau.
- **Modifier** : changer le statut, écrire une réponse courte que le public voit (par exemple « Merci, on y pense »), corriger le texte ou le pseudo (sous « Plus d'options »).
- **Refuser** : l'idée quitte la page et reste quelques jours dans le tableau, puis elle est effacée.
- **Fusionner…** (menu « ⋯ ») : pour deux idées qui disent la même chose. Vous choisissez celle que vous gardez ; les soutiens des deux s'additionnent, et personne ne soutient deux fois sans le savoir.
- **Supprimer** (menu « ⋯ ») : efface l'idée et ses soutiens, après confirmation.

Le tableau de bord de votre site vous dit combien d'idées attendent votre relecture, avec un lien direct, et montre les idées les plus soutenues. Chaque idée reçue, publiée, refusée, fusionnée ou supprimée, et chaque changement de statut, est écrit dans le journal du site, sans le texte de l'idée.

## Les réglages

| Réglage | Par défaut | Ce que ça change |
|---|---|---|
| Titre de la page | « Boîte à idées » | Le titre en haut de la page. |
| Texte d'introduction | vide | Quelques mots avant le champ. |
| Publier sans relecture | **éteint** | Allumé, les idées apparaissent tout de suite. Éteint, vous relisez chacune. |
| Permettre de soutenir les idées | allumé | Montre le bouton « Je soutiens ». |
| Montrer les idées écartées | éteint | Une idée écartée reste visible, avec son statut. |

Sous « Plus d'options » : idées par heure et par personne (3), idées en attente au plus (200), longueur d'une idée (500 caractères), durée de garde des idées refusées (30 jours).

## Contre les messages indésirables

Sans service extérieur et sans suivi de votre public :

- un champ piège invisible que seuls les robots remplissent ;
- une limite d'idées par heure et par personne, calculée sans garder d'adresse ;
- une idée limitée en longueur, avec un seul lien permis ;
- un plafond d'idées en attente : au-delà, la page dit de revenir plus tard ;
- un texte déjà publié n'est pas proposé une deuxième fois.

## Ce que le module garde

Le texte de l'idée, le pseudo (s'il est donné), le nombre de soutiens, votre réponse, son statut. **Pas d'adresse e-mail, pas d'adresse IP, pas de nom réel, pas de compte.** Un petit cookie dans le navigateur de la personne retient les numéros des idées qu'elle a soutenues (un an), uniquement pour ne pas compter deux fois : il n'est lu que par votre site. Le module ne charge aucune image, police ni script venant d'un autre site. Cette déclaration est reprise dans la politique de confidentialité du site.

## Limites

- 1 000 idées au plus en tout ; 150 sont montrées sur la page (les mieux classées d'après le tri choisi).
- Le ménage des idées refusées se fait quand vous ouvrez l'administration ou quand une idée arrive : aucune tâche de fond.
- Le soutien est un garde-fou, pas un vote officiel : une personne qui efface ses cookies et change d'adresse peut soutenir deux fois.
- La recherche de la page publique demande JavaScript ; sans lui, le reste (proposer, soutenir, trier) marche comme d'habitude.

## Pour un assistant IA

Trois outils, accordés un par un à chaque assistant : `idea_box_list` (lecture seule), `idea_box_set_status` (statut et réponse courte) et `idea_box_moderate` (publier, retirer de la page, refuser). Aucun ne supprime.

## Pour les développeurs

Droits : `ideas.moderate` (relire, publier, refuser, modifier, fusionner) et `ideas.delete`. Données : collection `ideas` (`text`, `nick`, `state`, `status`, `votes`, `reply`, `refusedAt`, `merged`), `dataVersion` 1 ; un champ absent prend sa valeur par défaut à la lecture, donc les versions suivantes peuvent ajouter des champs sans migration. Le code est coupé en `lib.mjs`, `ops.mjs` (gestes partagés avec l'assistant), `routes.mjs`, `view.mjs`, `admin.mjs`, `mcp.mjs`. Cœur 0.6.0 ou plus (tableau enrichi, interrupteur, champs repliés) ; le tableau de bord et le journal central sont ignorés par un cœur plus ancien.

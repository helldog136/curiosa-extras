## Boîte à idées : votre public vous propose des idées

*Une page où le public propose des idées et soutient celles qu'il aime ; vous relisez, publiez, refusez ou fusionnez. Pour Curiosa 0.6.0 ou plus. Module touché : Boîte à idées 1.0.0 (nouveau).*

### Nouveautés
- Un champ « Votre idée », un bouton « Proposer cette idée », un pseudo facultatif replié sous « Plus d'options ». Aucune adresse e-mail, aucun nom réel.
- La liste des idées retenues avec leur statut (Proposée, Étudiée, Planifiée, Réalisée, Écartée si vous la montrez), une recherche en direct, deux tris, et « Je soutiens » (un soutien par personne et par idée, sans compte).
- Toute idée arrive en attente. Un seul tableau pour la relire : recherche, pastilles avec leur nombre, interrupteur « Publiée », réponse courte visible du public, fusion des doublons (les soutiens s'additionnent).
- « Publier sans relecture » est éteint par défaut.
- Le tableau de bord annonce « n idées à relire » avec un lien direct ; le journal du site garde chaque geste, sans le texte des idées.
- Trois visuels pour la fiche de l'extension.

### Pour les développeurs
- Droits `ideas.moderate` et `ideas.delete`, outils pour assistant IA (`idea_box_list`, `idea_box_set_status`, `idea_box_moderate`), aucune tâche de fond. Tests : `tests/idea-box.test.mjs`, `tests/idea-box-admin.test.mjs`.
- `tests/helpers/ergonomics.mjs` recopié à l'identique depuis le cœur 0.6.2 (la copie de dev était en retard : la CI échouait sur « la copie de l'aide est identique »).

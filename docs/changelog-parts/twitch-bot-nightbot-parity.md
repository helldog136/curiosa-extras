## Bot Twitch : timers, dates de validité, import depuis Nightbot

*Le Bot Twitch rejoint Nightbot sur les commandes, les timers et l'import, et ajoute des dates de validité qui reviennent toutes seules. Pour Curiosa 0.2.5 ou plus. Module touché : Bot Twitch 1.5.0.*

### Nouveautés

- **Des timers.** Un nouvel onglet « Timers » : un message que le bot écrit dans votre chat à intervalle régulier (un rappel du Discord, une astuce…), avec un nombre de minutes, un minimum de lignes de chat, « en direct seulement » ou « toujours », un aperçu et un bouton « Envoyer maintenant ». 20 timers au plus. **Comme chez Nightbot, un timer a besoin que le chat soit actif** : le bot n'a aucun minuteur, il regarde ses timers quand un message arrive. Un seul timer écrit par message, jamais pendant l'arrêt d'urgence, jamais au-delà de la limite de réponses.
- **Des dates de validité sur les commandes et les timers** (Nightbot n'a pas cette fonction). `!movember` du 1er au 30 novembre, `!subtember` en septembre : la période revient **chaque année toute seule**, même à cheval sur le changement d'année. Deux sélecteurs jour / mois, une case « Chaque année », des erreurs claires sous le champ. Hors période la commande ne répond pas mais reste visible et modifiable (« Hors période : se réactive le 1er novembre ») ; la case « Activée » décochée l'emporte toujours.
- **Les morceaux de Nightbot.** Dans vos commandes : `{cible}`, `{requete}`, `{1}` `{2}` `{1:}`, `{compteur}` (avec bouton de remise à zéro), `{chaine}`, `{viewers}`, `{heure}` et `{date}` (avec fuseau), `{aleatoire …}` (une liste ou une plage de nombres) et `{calcul …}` (de l'arithmétique sûre, jamais de JavaScript). Un morceau inconnu ou mal écrit est refusé à la saisie, avec un exemple. Ce que les gens tapent est nettoyé et jamais gardé.
- **`{urlfetch}`, version sûre.** Éteint tant que vous n'avez pas listé, en mode avancé, les sites autorisés. https seulement, jamais d'adresse privée ou locale, aucune redirection suivie, 3 secondes, 400 caractères, 30 secondes de mémoire, 10 demandes par minute.
- **Gérer les commandes depuis le chat.** `!addcom`, `!editcom`, `!delcom` et `!commands` pour vous et votre équipe de modération, avec des réponses claires et exactement les mêmes vérifications que l'administration. Désactivé tant que vous ne cochez pas le réglage. Jamais d'écrasement.
- **Importer depuis Nightbot.** Collez votre liste de commandes et de timers : le site montre, ligne par ligne, ce qui est repris tel quel, adapté (anciennes écritures traduites, niveau « habitué » remplacé par « personnes abonnées ») ou impossible (avec la raison). Vous cochez, vous choisissez quoi faire des noms déjà pris, vous pouvez ajouter une période à chaque ligne, et rien n'est écrit avant votre validation.
- **Pour votre assistant IA** : voir, créer et modifier les timers ; lire (sans rien écrire) puis importer une liste Nightbot ; des périodes sur les commandes et les timers. Aucune écriture n'est accordée d'office. Nouveaux droits « timers » et « import Nightbot » pour vos rôles.
- **Alimenter un tirage au sort de Participation.** Si Participation est installé, le bot lui transmet le pseudo de la personne qui tape le mot du tirage (une fois par personne), sans répondre dans le chat et sans rien garder.

### Améliorations

- Rien ne change pour vos commandes d'avant : elles restent toujours actives, avec les mêmes textes. La migration des données (version 4) ajoute seulement une liste de timers vide.
- Le journal indique « Hors période » avec la date de réouverture, et les timers apparaissent avec le signe ⏱.
- Ce qui n'est pas repris de Nightbot, et pourquoi, est écrit dans le README du module (section « Si vous venez de Nightbot ») : l'habitué, la date de suivi d'une personne, le JavaScript de `$(eval)`, `$(querystring)`.

### Pour les développeurs

- **Bot Twitch 1.5.0** (`dataVersion` 4, `minCore` inchangé 0.2.5) : nouveaux fichiers `calc.mjs` (évaluateur sans JavaScript), `urlfetch.mjs`, `period.mjs`, `timers.mjs` et `timersAdmin.mjs` (onglet), `manage.mjs` (`!addcom`…), `nightbot.mjs` et `importAdmin.mjs` (import), `draw.mjs` (besoin facultatif `audience.draw` v1 (`min` 1) : `status()` → `{ open, keyword: "!mot" ou "", level: all|sub|mod }` gardé 10 s, appel borné à 1,5 s, `enter({ pseudo, platform: "twitch", login, role })` ; le message est comparé tel quel au mot-clé, sans le préfixe du bot), `errors.mjs`. `variables.mjs` : morceaux emboîtés (3 niveaux, 30 au plus), `checkTemplate` renvoie `arg` / `deep`. Stockage : `botConfig.timers`, nouveaux documents `botTimers` (état), `botCounters` (300 au plus), `botImport` (brouillon, 24 h).
- Réglages `chatManage` et `fetchHosts` (avancé) ; droits `timers.manage` et `nightbot.import` ; outils MCP `timers_list`, `timer_create`, `timer_update`, `nightbot_import_preview`, `nightbot_import`. Le schéma d'entrée des outils n'accepte pas d'objet : la période se donne par `activeFrom` / `activeUntil` / `yearly` (textes `MM-JJ` ou `AAAA-MM-JJ`).
- Aucune tâche planifiée ni minuteur de fond n'a été ajouté : les timers, les périodes et le tirage sont évalués à l'arrivée d'un message du chat.
- Tests : `twitch-bot-variables`, `twitch-bot-nightbot`, `twitch-bot-timers`, `twitch-bot-manage`, `twitch-bot-draw`, `twitch-bot-period` ; aide `helpers/botWorld.mjs`.

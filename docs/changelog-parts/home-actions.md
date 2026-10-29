## Récompense → ordre pour la maison : une question simple, des actions nommées

*Une récompense de points de chaîne qui lance « quelque chose chez vous » se règle enfin en mots simples, sans taper de mot technique. Pour Curiosa 0.2.6 ou plus. Modules touchés : Bot Twitch 1.4.0, Connecteur Home Assistant 1.1.0 (le module Home Assistant change de nom), Actions du live YouTube 1.1.1 (textes).*

### Nouveautés

- **Une seule question pour une récompense : « Que se passe-t-il quand quelqu'un prend cette récompense ? »** Les choix sont lisibles : « Répondre dans le chat », « Changer la couleur des lumières » (puis une couleur : rouge, vert, bleu, jaune, orange, violet, rose, blanc), « Lire son message à voix haute » et « Autre chose chez moi ». Les récompenses restent réglées dans le Bot Twitch, leur place naturelle.
- **« Autre chose chez moi » : il suffit de donner un nom** (par exemple « Lancer l'aspirateur »). Curiosa fabrique toute seule ce qu'il faut pour relier l'action à Home Assistant. Si le nom existe déjà, c'est la même action qui est reprise ; le renommer plus tard ne casse rien. La liste **« Tes actions »** permet de les retrouver, de les renommer et de retirer celles dont aucune récompense ne se sert.
- **Le nom de l'action partout, jamais un mot technique** : dans la liste des récompenses, dans le journal et dans les messages. Les erreurs s'affichent sous le champ concerné, avec un exemple.
- **Home Assistant sait comment s'appellent vos actions.** Le Bot Twitch donne les noms de vos actions au Connecteur Home Assistant, qui les passe à l'intégration : elle peut proposer « Lancer l'aspirateur → choisir un script ». Rien de votre maison n'est jamais envoyé à Curiosa.
- **Quand Home Assistant n'a pas encore de script pour une action**, la récompense le dit en toutes lettres (« Home Assistant n'a pas encore de script pour cette action. Ouvre Home Assistant > Curiosa > Configurer pour la relier. »), dans la liste et dans le journal. Les points sont rendus comme avant, mais plus en silence. La page du Connecteur Home Assistant ajoute la liste **« Actions en attente de liaison »**.
- **Deux liens pour s'y retrouver** : sur la page du Connecteur Home Assistant, un bloc « Étape suivante » avec le bouton « Créer ou modifier tes récompenses » ; dans l'onglet Récompenses du Bot Twitch, le lien « Relier à ta maison ». Si l'autre module n'est pas installé, une phrase simple le dit et propose de l'installer.
- **Une mise en route en 3 étapes** sur la page du Connecteur Home Assistant : installer l'intégration dans Home Assistant, l'associer avec le code, créer une première récompense.

### Améliorations

- **« Home Assistant » devient « Connecteur Home Assistant »** (« Home Assistant connector » en anglais), comme « Connecteur Twitch ». Rien à refaire : même module, mêmes liens, mêmes réglages, mêmes récompenses. Les textes du Bot Twitch et d'Actions du live YouTube qui parlaient du « module Home Assistant » ont suivi.
- **Mode avancé** : un réglage « Montrer les identifiants techniques des actions » montre l'identifiant à côté du nom et permet d'en choisir un pour une nouvelle action, pour qui relie sa maison à la main. Par défaut, il n'est jamais montré.
- **Rien à refaire pour vos récompenses actuelles.** L'ancien réglage « Autres actions à choisir » (avancé) continue de marcher : ses mots sont repris automatiquement dans « Tes actions », le mot servant de nom. Aucune récompense ne change, rien n'est perdu.
- Votre assistant IA peut donner un nom à une action en créant ou en modifiant une récompense, et voit le nom des actions.

### Pour les développeurs

- **Bot Twitch 1.4.0** (`dataVersion` 3) : `actions.mjs` (nouveau, fichier feuille) : actions de base, couleurs, actions nommées (collection `homeAction`, 50 au plus), clé fabriquée `perso:<nom>` (minuscules sans accents, `-2`, `-3` si prise, forme `^[a-z0-9][a-z0-9:_-]{0,39}$`, **stable** au renommage), état de liaison par action (`links` dans l'état du bot, 50 au plus : `unmapped` / `ok`), publication du sujet `home.actions`. Migration 3 : les mots de `extraActions` et les clés portées par des récompenses deviennent des actions nommées (idempotente) ; le réglage continue d'être lu. Nouveau réglage avancé `showKeys`. `rewards.mjs` : `check` reçoit `named`, `retarget`. `redeem.mjs` : la raison d'un refus de la maison suit le code de l'accusé (`unmapped`, `disabled`, `expired`), le journal garde le nom (`an`), `adminPathOf`. Aucun nouveau minuteur ni nouvelle tâche. Outils MCP : `customActionName`, `actionName`, `actions`.
- **Connecteur Home Assistant 1.1.0** : `catalog.mjs` (nouveau) lit le sujet facultatif `home.actions` (30 s de cache, 1,5 s au plus, 50 éléments, libellé de 60 caractères, nettoyé) ; `pull` ajoute le champ additif `catalog` (contrat HTTP v1 compatible ; `docs/ideas/home-assistant-contract.md`) ; `haCore.unmapped` (20 au plus) alimente « Actions en attente de liaison ». Identifiant, service `home-assistant.bridge`, routes et sujets fournis inchangés.
- **Actions du live YouTube 1.1.1** : textes seulement (« Connecteur Home Assistant »).
- Sujet `home.actions` ajouté à `docs/TOPICS.md`. Simulateur `tests/helpers/fakeHaClient.mjs` : lit `catalog`, `proposals()`. Test `home-actions.test.mjs` (parcours complet avec les deux vrais modules).
- Conflits probables : `catalogue/index.json` et `package.json` (version), `CHANGELOG.md` (tête du fichier), `modules/twitch-bot/module.json` (version, avec la branche d'écriture neutre), `modules/twitch-bot/locales/*.json`.

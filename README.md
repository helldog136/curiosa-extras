# curiosa-extras

Les modules de [Curiosa](https://github.com/helldog136/Curiosa). Le cœur de Curiosa est volontairement minimal (le site et son admin) : tout le reste vit ici.

| Dossier | Contenu |
|---|---|
| `modules/` | Les fonctionnalités de base (blog, réseaux sociaux, codes promo, pages, bandeau, formulaire de contact, statut live…) et les modules pour la création de contenu (sponsors, planning, contacts, partenariats, overlays de stream…). |
| `examples/` | Deux petits modules à lire pour apprendre à en écrire un. |
| `starter/` | **Le module de départ pour publier son propre module** : un dépôt de module complet (module à la racine, tests, workflow GitHub Actions, README avec le texte d'installation) à copier dans son propre dépôt. Il n'est **pas** au Catalogue. Guide : `docs/PUBLIER-SON-MODULE.md` du dépôt du cœur. |
| `catalogue/index.json` | L'index que le Catalogue de l'admin relit (généré par `scripts/build-index.mjs`). |
| `tests/` | Les tests des modules. |

Chaque module est un dossier autonome (`module.json`, `index.mjs`, `locales/`, `README.md`). Il s'installe depuis le Catalogue, ou à la main avec une adresse de la forme `https://github.com/helldog136/curiosa-extras#:modules/<id>`.

## Branches
Même cycle que le cœur : `dev` reçoit le travail, la fusion de `dev` dans `master` publie. Les versions du cœur embarquent un instantané de `master` pour l'assistant de première installation.

## Les chiffres des réseaux : le contrat `social.stat`
Le module *Statistiques de la communauté* relève, garde et sert (admin, assistant) les chiffres des réseaux de la personne. Chaque module de réseau **possède ses chiffres** et les publie sur le sujet `social.stat` ; Statistiques de la communauté ne fait que les collecter (aucun cumul inventé, aucun affichage public pour l'instant). Un fournisseur déclare `provides: [{ "topic": "social.stat" }]` et implémente `exports["social.stat"](ctx, { locale, limit, tags })`, qui renvoie des éléments :

```js
{ id: "twitch-channel:emma:followers", // stable : "<module>:<clé d'instance>:<type de chiffre>" ("manual" est réservé)
  platform: "twitch", account: "emma_live", accountKey: "emma",
  metric: "followers", // followers (audience gratuite) | paying (audience payante) | content (nombre de contenus) | views (vues cumulées)
                        // + chiffres de PÉRIODE (30 jours glissants, mesurés par le module lui-même) : avg_viewers | peak_viewers | hours_streamed | hours_watched | followers_gained
  label: "Followers Twitch", value: 1250, // entier >= 0 ; ABSENT quand `error` est présent, jamais une valeur périmée
  asOf: "2026-10-14T10:00:00Z", url: "https://…", // url facultative
  error: undefined /* ou "auth" | "rate" | "network" | "hidden" | "config" */ }
```
**Chiffres de période** (version 1.4.0 de *Chaîne Twitch*, 1.1.0 de *Statistiques de la communauté*) : `avg_viewers` (audience moyenne par direct, pondérés par le temps), `peak_viewers` (meilleur pic), `hours_streamed` (temps de direct) et `hours_watched` (audience × temps) **en MINUTES entières malgré leur nom** (l'unité est dite dans le libellé et dans le champ `unit` côté assistant), `followers_gained` (followers gagnés pendant les directs, net, jamais négatif dans ce chiffre). Même forme que les autres : `id` `<module>:<clé>:<chiffre>`, entier >= 0, `asOf`, libellé humain (« Audience moyenne par direct (30 jours) »). `0` veut dire « aucun direct mesuré sur la période ». Liste fermée : un autre nom est rejeté. Un module qui publie des chiffres de période doit les mesurer lui-même (le collecteur n'invente rien) et dire à la personne, en mots simples, ce qui est mesuré et ses limites.

Un élément invalide est écarté seul ; un élément avec `error` ne produit jamais de point d'historique. Le détail (limites de taille, stockage, volumes) est dans `modules/community-stats/README.md`.

## Les événements datés : le contrat `event.source`
Le module *Story d'annonce* (et tout module qui annonce des événements) montre **une seule liste** de ce qui arrive bientôt, de **toutes les sources**, triée par date et heure. Chaque source est un module qui **offre** le service `event.source` (version 1, `each: true` : chaque instance répond pour elle-même, c'est le seul cas où plusieurs modules offrent le même service) avec la méthode `upcoming`, et le consommateur le déclare en **besoin facultatif** (`requires[].optional`). Les streams des agendas, eux, passent par le sujet `planning.slot`.

```js
// services: { "event.source": { async upcoming(ctx, { from, to, limit, locale }) { … } } } — borné, ne lève jamais
{ ok: true,
  source: { kind: "youtube", label: "YouTube" },   // type (minuscules) et nom affiché
  state: "ok",       // "ok" | "setup" (à régler : `message` dit quoi faire, en mots simples) | "down" (ne répond pas pour l'instant)
  message: "…", note: "…",   // facultatifs, 240 caractères : quoi régler / ce qu'il faut savoir (ex. « une vidéo privée programmée n'est pas visible »)
  events: [{
    id: "youtube:AbC123",          // STABLE, préfixé par la source : lettres, chiffres, « : _ . - », 100 au plus
    title: "Ma première",          // 80 caractères
    start: "2026-10-24T18:30:00Z", // UTC ; ou allDay: true + day: "2026-10-24" (minuit du fuseau)
    timezone: "Europe/Brussels",   // IANA, ou vide si la source ne le sait pas
    end: "…",                      // facultatif
    type: "premiere",              // stream | live | premiere | video | event | other
    url: "https://…", image: "https://…", games: ["Hades"],   // facultatifs (https)
  }] }
```
Sources fournies aujourd'hui : *Chaîne YouTube* (directs et premières **publics** programmés), *Ma Chaîne Twitch* (planning de la chaîne) et *Événements* (les rendez-vous **publiés** de vos agendas). Le consommateur borne tout (100 événements par source, 10 sources, 200 au total, délai par source), vérifie chaque champ, écarte seul un événement illisible, dédoublonne un même événement vu par deux sources et trie sur l'instant UTC. Un module qui publie des événements datés n'a qu'à offrir ce service : aucun consommateur n'est à modifier.

## Les jaquettes de jeux : le service `game.cover`
Le module *Jaquettes de jeux* (`game-covers`) trouve la jaquette d'un jeu (clé RAWG saisie une seule fois, corrections « Ce n'est pas le bon jeu ? »). Il **offre** le service `game.cover` (version 1) : `status`, `cover({ title })`, `candidates({ title, search? })`, `fix` et `adopt`. Les modules qui montrent des jaquettes (*Suggestions de jeux*, *Planning*, *Story d'annonce*) le déclarent en **besoin facultatif** (`"requires": [{ "service": "game.cover", "optional": true }]`) : sans lui, ils s'affichent sans jaquette (ou utilisent l'ancienne interface du cœur tant qu'elle existe). Le cœur installe ce module tout seul sur les sites qui utilisaient RAWG.

## Tests
```
git clone https://github.com/helldog136/Curiosa ../Curiosa && (cd ../Curiosa && npm ci)
CURIOSA_DIR=../Curiosa npm test
```
Les tests passent par le chargeur du cœur : un module ne doit utiliser que l'API publique des modules.

**Dossiers temporaires.** Utilisez l'aide `makeTempDir(prefix)` (`tests/helpers/tmp.mjs`) : ne créez jamais de dossier dans `/tmp` sans l'enregistrer. Elle le supprime à la fin du test (`{ t }`), avec `cleanupAll()`, et à la sortie du processus.
`npm test` donne à chaque exécution son propre `TMPDIR` (supprimé à la fin) et liste en clair tout ce que les tests y laissent (échec avec un cœur qui a l'aide tmp, avertissement sinon) ; `KEEP_TEST_TMP=1` garde tout pour déboguer.

**Mises à jour à chaud.** Le serveur d'un module n'importe jamais un fichier voisin avec `import … from "./x.mjs"` (il garderait l'ancienne version après une mise à jour sans redémarrage) : ``await import(`./x.mjs${v}`)``. Un test générique (`tests/hot-update-all.test.mjs`) le vérifie pour tous les modules et rejoue la mise à jour depuis la dernière version publiée ; il a besoin des étiquettes git (`git fetch --tags`). Voir [docs/HOT-UPDATE.md](docs/HOT-UPDATE.md).

**Ergonomie des pages d'administration.** Les règles automatiques de [docs/ERGONOMIE-ADMIN.md](docs/ERGONOMIE-ADMIN.md) (marquées **[auto]**) sont mesurées sur le manifeste et les textes de chaque module par `tests/ergonomics.test.mjs`, avec une **base d'écarts connus** (`tests/ergonomics-baseline.json`) : un écart de la base est un avertissement, un **nouvel** écart (nouveau réglage, nouveau texte) fait échouer le test, et un écart corrigé doit être retiré de la base, qui **ne peut que rétrécir**. `node scripts/ergonomics-baseline.mjs --write` met la base à jour (il refuse d'ajouter un écart), `--report` imprime le tableau « module → nombre d'écarts par règle ». Un **nouveau** module n'a droit à aucun écart. Pour une page produite par du code (`adminPanel`), appelez dans vos tests `assertAdminPageErgonomics(blocks)` (copie locale : `tests/helpers/ergonomics.mjs`) : champs visibles, recherche d'une liste de plus de 10 lignes, étiquette répétée, « Activer / désactiver », erreurs avec exemple. Le reste (une page une tâche, chemin court, un seul bouton principal, etc.) se juge en revue, sur des captures.

## Les visuels des fiches : la clé `previews`
La fiche d'une extension (dans le Catalogue, avant et après l'installation) montre jusqu'à **6 captures** de ce que le module ajoute : une page de commandes, un écran d'administration, un élément d'overlay. Elles se déclarent dans le `module.json` du module (clé `previews`, **sans `minCore`** : un cœur plus ancien ignore la clé et montre la fiche comme avant) ; les images vivent dans `modules/<id>/previews/`. Détail du format côté cœur : CREATE-A-MODULE.md du cœur, section « 18 bis. Montrer le module : `previews` ».

```json
"previews": [
  { "file": "previews/commandes.webp", "type": "admin",
    "caption": { "fr": "Toutes vos commandes dans un seul tableau.", "en": "All your commands in a single table." },
    "alt":     { "fr": "Tableau de commandes avec recherche et interrupteurs.", "en": "Table of commands with search and switches." } }
]
```
- `type` : `public` (une page du site), `admin` (un écran d'administration) ou `overlay` (un élément pour OBS).
- `caption` (140 caractères au plus, vouvoiement, une phrase) et `alt` (250 au plus, décrit l'image pour les lecteurs d'écran, ne répète pas la légende) : **français et anglais obligatoires**.
- Image : **WebP** (ou PNG) de **150 Ko au plus**, 240 à 2400 px de côté, environ **1280 px de large**. Le type est lu dans les octets : une image renommée est refusée.
- `node scripts/build-index.mjs` **recopie la déclaration** (jamais les images) dans l'entrée du catalogue et **refuse** un visuel invalide ou absent ; `--check` échoue si une image référencée manque. `node scripts/shoot-previews.mjs --check` vérifie les images sans rien générer.

**Produire ou refaire les captures (reproductible).** Chaque module qui a des visuels a une « scène » dans `tests/visual/previews/<id>.mjs` : elle fabrique la page avec le **vrai code du module** (rendu public du module, blocs d'administration rendus par les vrais composants du cœur) et des **données inventées**. Le script prend les captures avec Chromium à 1280 px et les enregistre en WebP :
```
CURIOSA_DIR=../Curiosa node scripts/shoot-previews.mjs              # toutes les captures
CURIOSA_DIR=../Curiosa node scripts/shoot-previews.mjs faq planning # seulement ces modules
```
Il faut le dossier du cœur (avec `npm ci`), Playwright et Chromium (`PLAYWRIGHT_MODULE` et `CHROMIUM_PATH` si le vôtre n'est pas trouvé). L'horloge est figée (un lundi d'octobre 2026) : le résultat ne dépend pas du jour où vous tournez la commande. Pour un nouveau module : écrivez sa scène, déclarez `previews` dans son `module.json` (le script vérifie que chaque scène a sa déclaration et inversement), lancez la commande, **regardez chaque image**, puis `node scripts/build-index.mjs`.

**Règles de confidentialité (obligatoires).** Une capture ne montre **jamais** une donnée réelle : ni pseudo, ni nom, ni adresse électronique, ni adresse de site, ni jeton, ni photo d'une vraie personne, ni nom de votre communauté ou de vos partenaires. Utilisez des pseudos génériques, des adresses en `example.org` / `.test`, des illustrations dessinées (`art()` dans `tests/visual/previews/kit.mjs`) et un faux site (« Atelier Démo »). Le script **refuse** de produire une capture dont le texte contient une adresse hors `example.*`, `.test` ou une adresse électronique réelle, et chaque scène peut y ajouter ses propres interdits (`forbid`). Une capture d'écran de votre vrai site n'a pas sa place ici.

## Soutenir le projet

Ces modules sont gratuits. Si vous les aimez, un pourboire est possible sur [helldog136.be/tip-me](https://helldog136.be/tip-me) ; c'est entièrement volontaire, rien n'en dépend.

## Licence
Chaque module déclare la sienne dans son `module.json`. Les modules de base portent la Curiosa License 1.0 (voir le cœur).

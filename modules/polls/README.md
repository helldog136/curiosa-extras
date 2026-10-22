# Sondages

Posez une question à votre communauté (« À quel jeu jouons-nous samedi ? », « Quel nom pour la mascotte ? »), partagez le lien, et regardez les résultats arriver en barres claires. Plus besoin d'un site tiers dont les résultats se perdent : tout reste sur votre site, y compris l'historique.

## À quoi ça sert
- **Un sondage en une minute** : une question, 2 à 8 choix (un par ligne), c'est tout. Le lien à partager apparaît juste après.
- **Un choix ou plusieurs** : vous décidez combien de réponses une personne peut cocher.
- **Une date de fin** (facultative, avec l'heure et le fuseau écrits en toutes lettres) : le sondage se ferme tout seul et affiche son résultat final. Sans date, vous le fermez quand vous voulez.
- **Résultats visibles tout de suite, ou seulement après le vote** : à vous de choisir, sondage par sondage. Une fois le sondage terminé, tout le monde voit le résultat.
- **Résultats lisibles par tous** : chaque barre porte aussi le texte (« 42 % · 17 voix »), « En tête » ou « Gagnant » est écrit, jamais seulement suggéré par une couleur.
- **Un vote par personne, sans compte** (voir plus bas pour la limite honnête).
- **Sur votre stream** : une source navigateur pour OBS montre le sondage en direct, sur fond transparent.
- **Une page publique** (`/polls`) avec les sondages en cours et la liste des sondages passés, et une page par sondage à partager. Un petit encart « Le sondage en cours » peut aussi se poser sur votre page d'accueil.

## Comment l'utiliser
1. **Mes sondages** → « Nouveau sondage » : écrivez la question et les choix, puis « Créer le sondage ». Rien d'autre n'est obligatoire.
2. Copiez le lien affiché (bouton « Copier ») et partagez-le, ou ajoutez la section « Le sondage en cours » à votre accueil (Page d'accueil → Ajouter).
3. Pour le montrer pendant un live : onglet **À l'écran** → copiez l'adresse secrète dans une source « Navigateur » d'OBS. Depuis les détails d'un sondage, « Afficher à l'écran » choisit ce qui s'affiche ; sans choix, c'est le sondage ouvert le plus récent.
4. « Refaire un sondage comme celui-ci » prépare un nouveau formulaire déjà rempli. Un assistant IA peut aussi créer, lire et fermer des sondages.

## Réglages
Tout marche sans rien régler. Trois réglages simples : votre fuseau horaire (par défaut Paris), un texte d'introduction pour la page, et la visibilité des résultats pour les nouveaux sondages. Le mode avancé ajoute la durée de conservation des votes détaillés, la limite de votes par heure et la fréquence de mise à jour à l'écran. L'apparence de l'affichage OBS (place, couleurs) suit le thème du site.

## Vie privée : ce qui est gardé
- Aucun compte, aucun cookie. Le navigateur de la personne garde un **code privé au hasard** (dans son stockage local) ; le site n'en garde qu'une **version brouillée, différente pour chaque sondage** (deux sondages ne peuvent pas être reliés), avec les choix cochés. Aucun nom, aucune adresse.
- Ces votes détaillés sont **effacés 30 jours après la fin** du sondage (réglable de 1 à 90 jours). Restent les totaux.
- L'adresse IP n'est **jamais enregistrée ni journalisée**. Elle sert seulement, brouillée avec un sel qui change chaque jour et n'est jamais écrit sur le disque, à freiner les abus.

## Ce que le sondage ne garantit pas (honnêtement)
- « Un vote par personne » veut dire « un vote par navigateur ». Quelqu'un qui vide les données de son navigateur, en change, ou vote en navigation privée peut voter de nouveau. Il n'y a pas de compte : c'est le prix de la simplicité et de la vie privée.
- Le site freine les abus : au plus 30 votes par heure et par connexion (réglable), 8 essais par sondage en 10 minutes, 120 nouveaux votes par minute pour tout le site, 5 000 votants par sondage, piège à robots. Cela arrête les curieux et les scripts simples, **pas une personne déterminée** qui change de connexion.
- Le sel de l'empreinte est en mémoire : si le site redémarre, il change (c'est voulu). Derrière un relais qui ne transmet pas l'adresse réelle, tous les visiteurs partageraient la même empreinte : la limite par heure serait alors plus vite atteinte.
- Pour un enjeu qui compte (concours, tirage au sort, décision d'association), **ne vous fiez pas à ce résultat seul**.

## Bornes
8 choix au plus ; question de 140 caractères, choix de 60 ; **200 sondages complets** gardés (en en créant un de plus, le plus ancien sondage terminé est archivé automatiquement ; s'il n'y en a aucun, le module le dit) ; **800 sondages archivés** (totaux seulement, les plus anciens sont ensuite effacés) ; 5 000 votants par sondage ; 50 sondages par page. Rien ne tourne en arrière-plan : « ouvert » ou « terminé » se calcule quand on regarde, et le ménage des anciens votes se fait quand quelqu'un vote ou ouvre l'administration.

## Ce que le module ne fait pas
Pas de vote pondéré, pas de classement des choix par ordre de préférence, pas de choix libres proposés par le public, pas de résultats par ville ou par appareil, pas d'envoi d'e-mail aux votants. Pas de lien automatique avec les suggestions de jeux (voir `docs/ideas/polls.md`).

## Pour les développeurs
Données dans le stockage de l'instance : `polls`, `archive`, `b-<id>` (bulletins), `meta`. Les compteurs sont écrits dans une section exclusive par instance (une file en mémoire) ; le bulletin unique par code est garanti par la clé du bulletin (le plus ancien gagne), et « Recompter les voix » refait les totaux depuis les bulletins. Source OBS : `/overlays/<clé>?k=<secret>`, mise à jour douce par `/m/<clé>/live`. Droits : `polls:manage`, `polls:obs.view`. Actions pour l'assistant : `polls_list`, `poll_results`, `poll_create`, `poll_close`.

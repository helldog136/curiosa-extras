# Ergonomie des pages de configuration (règles OBLIGATOIRES)

Ces règles s'appliquent à **toute** page d'administration et à **tout** formulaire : réglages de module, pages d'administration propres à un module, écrans du cœur, éditeurs, assistants. Elles valent pour les agents (IA) comme pour les personnes qui écrivent un module. **Une PR qui touche une page de configuration doit dire, dans son corps, comment chaque règle est respectée** (section « Ergonomie », voir la liste de contrôle en fin de document).

Le point de départ est toujours une personne qui crée du contenu, qui n'est pas technique, qui n'a pas le temps de comprendre un outil, et qui jugera la page en dix secondes. Si elle doit réfléchir à ce qu'un champ veut dire, **c'est la page qui est fausse**, pas elle.

Légende : **[auto]** = vérifié par le kit de test (`admin.ergonomics`) ; **[revue]** = vérifié par la personne qui relit, sur les captures.

## 0. Pourquoi ces règles existent (cas réels, à ne jamais refaire)
- Une liste de trente commandes dont chaque ligne répétait « La vôtre » ou « Toute prête » : une étiquette identique sur toutes les lignes ne dit rien. Cette même liste n'avait **aucune recherche**, deux gros boutons (« Modifier », « Activer / désactiver ») sur chaque ligne et des lignes de hauteurs inégales : impraticable dès qu'on dépasse dix lignes.
- Une période « du 1er novembre au 30 novembre » demandée par **sept champs** (jour, mois, jour, mois, « chaque année », année, année) et deux délais vides sur le même écran.
- Un formulaire « Nouvelle personne » à dix champs alors que la tâche utile tient en deux (un nom et un pseudo).
- Des « clés d'action » à taper à la main pour relier une récompense à une maison connectée.
- Un aperçu de page d'overlay trop petit pour glisser quoi que ce soit, et des listes de choix tronquées (« Semi-tra… »).
- Une aide longue de cinq lignes sous chaque champ.
- Trois listes de commandes collées l'une sous l'autre (partenaires, réseaux, vôtres) alors qu'elles ont les mêmes colonnes.

## 1. La tâche d'abord
**R1 [revue] Une page, une tâche.** Chaque page commence par une phrase (une ligne) qui dit à quoi elle sert, et l'action principale est visible sans défiler. Si une page sert à trois choses, ce sont trois pages ou trois onglets.
**R2 [revue] Le chemin court.** La tâche la plus fréquente se fait avec **au plus deux champs visibles et un clic**. Tout le reste est replié sous « Plus d'options » (ou dans un second onglet), jamais mélangé aux champs du chemin court. Dans la PR : écrire « tâche principale : … ; champs visibles : n ; clics : n ».
**R3 [revue] Un seul bouton principal.** Un verbe d'action précis (« Ajouter la personne », « Enregistrer la commande »), jamais « OK », « Valider » ou « Soumettre ». Les actions secondaires sont discrètes. Une action destructive est séparée, nommée (« Supprimer la commande »), jamais le bouton par défaut, et dit ce qui sera perdu.

## 2. Le budget de champs
**R4 [auto] Au plus 5 champs visibles par formulaire**, 7 par section ouverte ; au-delà, replier ou découper en onglets/étapes. Un champ « avancé » ne compte pas s'il est replié ou derrière le mode avancé.
**R5 [auto] Au plus 7 réglages simples par onglet de réglages de module.** Un module qui en demande davantage a un défaut de conception : choisir des valeurs par défaut, regrouper, ou passer en avancé.
**R6 [revue] Une notion = un champ.** Une période, une durée, une plage, une adresse, une heure : **un seul contrôle compact** (une ligne), jamais un champ par composant (jour, mois, année…). Si le contrôle n'existe pas dans le kit, on le crée une fois, pour tous, au lieu de l'assembler à la main dans chaque module.
**R7 [revue] Les options rares sont des options, pas des champs permanents.** Un champ vide qui ne sert que dans 5 % des cas (une année de fin, un délai par personne) n'est pas affiché tant qu'on ne l'a pas demandé : « Limiter dans le temps », « Ajouter une attente ».
**R8 [revue] Rien d'obligatoire à régler.** La page marche avec ses valeurs par défaut : un champ prérempli par une valeur sensée vaut mieux qu'un champ vide avec une aide. Si un module exige une configuration externe (compte, clé), un assistant en **trois étapes au plus** la guide, avec l'état de chaque étape.

## 3. Les mots
**R9 [auto] Les mots de la personne, pas ceux du code.** Interdits dans les libellés, aides et messages visibles hors mode avancé : clé, slug, instance, topic, sujet (au sens technique), token, jeton, webhook, EventSub, route, service, identifiant, payload, API, JSON, cache, hash, SSE, OAuth (sauf quand un tiers l'impose, avec explication), `{accolades}` non expliquées. Liste modifiable en tête du test.
**R10 [auto] Libellés courts et sans deux-points** : au plus 60 caractères, pas de « : » final, pas de parenthèses de précision à rallonge (« (seulement si la période ne revient pas) » est un signe qu'il faut un autre contrôle, voir R6).
**R11 [auto] Aides courtes.** Une aide visible fait au plus 60 caractères et une ligne ; plus long, elle passe dans la bulle « ? » du cœur. **Tout champ libre a un exemple concret** (« Par exemple : insta, ig »). Une aide ne répète pas le libellé.
**R12 [revue] Même mot pour la même chose partout** (glossaire du dépôt) : « élément », « page d'overlay », « extension », « récompense », « tirage au sort »… Un nouveau mot s'ajoute au glossaire avant d'être utilisé.
**R13 [auto] Ton :** neutre en genre, vouvoiement, phrases de 20 mots au plus, pas de point d'exclamation, pas de « Veuillez », pas de MAJUSCULES, pas de nom de personne réelle ni de site réel dans les textes par défaut.

## 4. Les listes et les lignes
**R14 [revue] Ce qui est identique pour toutes les lignes est un titre, pas une étiquette.** Une ligne n'affiche que **ce qui la distingue** : son nom, son état, et un rôle ou une limite **seulement s'ils sortent de l'ordinaire**. Jamais d'étiquette pour la valeur par défaut (« Tout le monde », « Activée », « La vôtre », « Toute prête »).
**R15 [auto/revue] Toute liste qui peut grandir a une recherche dynamique, dès le départ.** Une liste d'éléments que la personne ajoute elle-même (commandes, contacts, sondages, liens, entrées, récompenses, timers, partenaires…) et qui peut raisonnablement dépasser une dizaine de lignes a, **au-dessus de la liste, un champ « Rechercher »** qui filtre **en direct pendant la frappe** (sans bouton, sans rechargement de la page, insensible à la casse et aux accents, cherche dans tout ce qui est affiché : nom, texte, état). Il est présent **même quand la liste est courte aujourd'hui**, parce qu'elle ne le restera pas. Quand la liste est paginée côté serveur, la recherche interroge le serveur (avec un petit délai) et non la seule page affichée. « Aucun résultat » dit quoi faire (« Effacer la recherche »). En plus : des groupes avec titres et nombres (repliables) pour les listes mixtes ; pagination à 50 au plus ; filtre par état (actif / désactivé) quand l'état compte.
**R16 [revue] Lignes régulières :** même hauteur, même disposition, bouton « Modifier » toujours au même endroit, au plus deux actions visibles par ligne, les autres dans un menu. Un texte long est coupé avec « … » et complet dans une info-bulle.
**R17 [revue] Un interrupteur montre l'état, il n'est pas un verbe.** Activer/désactiver se fait par un **interrupteur** qui affiche l'état courant, directement dans la liste. Jamais un bouton « Activer / désactiver » (la personne ne sait pas dans quel état on est) et jamais deux gros boutons côte à côte sur chaque ligne.
**R30 [revue] Même schéma = un seul tableau.** Quand plusieurs listes ont les mêmes colonnes (par exemple les commandes « à vous », « toutes prêtes », « de partenaires » et « de réseaux »), on n'en fait pas trois listes l'une sous l'autre : **un seul tableau**, où ce qui les distingue (l'origine, le type, la source) devient **une colonne** avec une pastille **colorée ET écrite** (la couleur seule ne suffit jamais : R28), et des filtres rapides au-dessus (« Toutes · Les vôtres · Partenaires · Réseaux »). La recherche couvre tout le tableau (R15). Un élément **produit automatiquement par une autre page** reste une ligne comme les autres, mais son bouton ne dit pas « Modifier » : il **renvoie vers la page qui le produit**, en le disant (« Ouvrir la fiche du partenaire → », « Réglages du réseau → »), pour que la personne sache où se règle la chose. Les sources qui ne produisent encore rien (un partenaire sans commande) ne sont pas des lignes : un seul bouton « Ajouter… » avec recherche ouvre le choix.
**R18 [revue] Un état vide dit quoi faire** : une phrase, un bouton, éventuellement un exemple à ajouter en un clic. Jamais une page blanche.

## 5. Les contrôles
**R19 [revue] Le bon contrôle :** oui/non = case ou interrupteur (jamais une liste) ; 2 à 4 choix = boutons segmentés ou radio ; 5 à 10 = liste ; plus de 10 = recherche. Les listes ne **tronquent jamais** leurs libellés. Pas de case négative (« Ne pas… ») : on écrit ce qu'on veut qui se passe.
**R20 [revue] Les valeurs numériques disent leur unité et leurs bornes** (« 60 secondes, entre 5 et 3600 »), avec un champ qui n'accepte que cela. Un champ vide a une valeur par défaut visible (« Vide : 30 s »).
**R21 [revue] Dates et heures :** un sélecteur de date natif ou une saisie guidée, jamais trois listes ; la période récurrente (« chaque année ») se dit en une phrase (« Du 1er novembre au 30 novembre, chaque année ») avec un aperçu de cette phrase.

## 6. Les retours
**R22 [auto] Erreur sous le champ,** avec ce qu'il faut faire et un exemple (« Écrivez un nombre entier, par exemple 500 »). Jamais de code, de trace ou d'« erreur 500 ». La saisie est conservée ; le premier champ en erreur reçoit le focus.
**R23 [revue] Retour d'action visible là où on a cliqué :** bouton « en cours » pendant l'action, confirmation de réussite proche du bouton, message d'erreur d'un service externe en clair avec la marche à suivre.
**R24 [revue] Réversible ou confirmé :** une action large montre un aperçu avant d'appliquer ; une suppression annonce ce qui sera perdu (« Cette commande et ses 12 utilisations… ») ; l'arrêt d'urgence est visible sans défiler.

## 7. Les liens entre pages
**R25 [revue] Une tâche qui traverse deux modules a un lien direct et dit l'état de l'autre côté** (« Home Assistant : associé ✓ — Créer une récompense → »), jamais « allez voir dans l'autre module ».
**R26 [revue] La première fois :** un exemple prérempli ou un bouton « Ajouter un exemple ». Un assistant (étapes numérotées) seulement s'il y a au moins trois prérequis externes.

## 8. Support et accessibilité
**R27 [revue] PC d'abord pour les outils lourds** (placement, import, tableaux) ; pour le reste, utilisable au téléphone : cibles ≥ 44 px, pas de défilement horizontal, pas de tableau qui déborde.
**R28 [auto/revue] Clavier et lecteur d'écran :** chaque champ a un libellé relié, chaque icône un texte, l'ordre de tabulation suit l'ordre visuel, le focus est visible. Un glisser-déposer a toujours une alternative au clavier.
**R29 [auto] FR et EN à parité exacte** (mêmes clés, mêmes `{variables}`), textes neutres.

## 9. Ce que la PR doit montrer
Une PR qui crée ou change une page de configuration contient :
1. une section **« Ergonomie »** dans son corps : tâche principale, nombre de champs visibles, nombre de clics, ce qui est replié et pourquoi ;
2. des **captures regardées** (1280 px et 390 px, clair et sombre) de l'écran de départ, du chemin court, de l'écran « tout ouvert » et d'une erreur ;
3. le **résultat du kit `admin.ergonomics`** (avertissements compris), sans régression ;
4. pour toute règle écartée : la raison, écrite.
La relecture refuse la PR si un écran dépasse les budgets R4/R5 sans repli, si une règle [auto] échoue, ou si une capture montre un libellé tronqué, une étiquette répétée ou un champ sans objet évident.

## 10. Liste de contrôle (à recopier dans la PR)
- [ ] La page dit à quoi elle sert en une phrase (R1).
- [ ] Tâche principale : ___ ; champs visibles : ___ (≤ 2 pour le chemin court, ≤ 5 au total) ; clics : ___ (R2, R4).
- [ ] Un seul bouton principal, verbe précis ; destructif séparé et confirmé (R3, R24).
- [ ] Aucun mot interdit (R9) ; libellés ≤ 60 caractères sans « : » (R10).
- [ ] Aides ≤ 60 caractères, exemples sur les champs libres (R11).
- [ ] Une notion = un contrôle ; aucune période/durée/adresse en plusieurs champs (R6, R21).
- [ ] Options rares repliées ; rien d'obligatoire (R7, R8).
- [ ] Listes de même schéma fusionnées en un tableau avec colonne d'origine colorée et écrite ; éléments produits ailleurs : bouton vers la page source (R30).
- [ ] Listes qui peuvent grandir : recherche dynamique en direct dès le départ ; aucune étiquette identique répétée ; groupes ; interrupteur d'état dans la ligne (R14, R15, R16, R17).
- [ ] Erreurs sous le champ avec exemple ; retour d'action visible (R22, R23).
- [ ] Liens vers les autres modules avec leur état (R25).
- [ ] FR/EN à parité, ton neutre, vouvoiement (R13, R29).
- [ ] Captures regardées, 1280 et 390 px (section 9).

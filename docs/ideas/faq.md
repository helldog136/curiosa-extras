# Questions fréquentes (`faq`) : description complète

Module du catalogue, version 1.0.0, `minCore` 0.2.6, licence et auteur comme les autres modules. Type déclaré : `content` (pour être rangé sous « Mon contenu » dans le menu), sans bloc `content` : c'est un module à code.

## Le problème

On répète les mêmes réponses en direct, par message, en commentaire. Une bonne page de questions fréquentes les écrit une fois, se laisse parcourir, dit ce qui aide et ce qui manque, et plaît aux moteurs de recherche.

## Pour qui

Emma : créatrice non technique, qui travaille surtout sur téléphone. Elle n'ouvre jamais un fichier : tout se fait par boutons et formulaires, les erreurs apparaissent sous le champ avec un exemple.

## Le type « contenu » (zéro code) suffit-il ? Non, voici pourquoi

Étudié et écarté pour la partie liste :
- le type `content` propose quatre présentations (cartes, liste, liens, codes) et des pages de détail : pas de dépliants, pas de recherche en tapant, pas d'ancres `#q-…` ouvrant la question, pas de thèmes avec ordre réglable par boutons (le tri « à la main » du cœur n'a pas d'interface « monter / descendre » et les étiquettes n'ont pas d'ordre) ;
- pas d'avis « Cela m'a aidé », pas de boîte « questions posées » ni de transformation en réponse, pas de données FAQPage ;
- un module qui a du code ne peut pas relire le **corps** des entrées du cœur (`ctx.api.entries.list` ne rend que le résumé) : un mélange « entrées du cœur pour les textes + code pour le reste » aurait coupé la donnée en deux propriétaires.
Le module garde donc ses questions dans son propre stockage (un seul propriétaire). On perd les pages par entrée, le flux RSS et le plan du site fournis par le type `content` : une FAQ est une page unique, c'est voulu.

## Ce que voit le visiteur

- `/faq` : introduction facultative, recherche, navigation par thèmes, questions repliables (`details` / `summary` natifs), « Tout ouvrir / Tout fermer », boîte « Vous ne trouvez pas votre réponse ? ».
- **Sans JavaScript** : les questions s'ouvrent et se referment ; les avis et les questions partent par formulaire ordinaire, la page revient avec un message (ancre `#faq-sent`, `#faq-thanks`… affichée par la règle CSS `:target`) ; la recherche et « Tout ouvrir » disparaissent (`noscript`). Un lien `#q-…` amène à la question mais ne l'ouvre pas sans script (limite du HTML).
- **Avec JavaScript** (petit script `scripts/faq.js`, ≈ 8 Ko, servi par le cœur avec son empreinte et chargé **seulement sur la page des questions**, cœur 0.2.6) : recherche sans accents ni majuscules (la même fonction `fold` sert au serveur et au navigateur), question ouverte par son lien et par `hashchange`, lien copié, avis et question envoyés sans recharger, mise en route aussi après un changement de page sans rechargement (observateur léger).
- **Avis** : « Cela m'a aidé / Pas vraiment ». Le visiteur ne voit que « N personnes ont trouvé cette réponse utile » à partir de 3.
- **Langues** : chaque question a, par langue du site, une question et une réponse. Une question qui n'existe que dans une langue : avec le réglage « Montrer aussi les questions écrites dans une autre langue » (oui par défaut), le visiteur de l'autre langue la voit avec la mention « Cette réponse n'existe pas encore dans votre langue : elle est affichée en … » et `lang` correct ; décoché, elle lui est cachée. Un thème sans nom dans la langue du visiteur prend celui de la langue du site.
- **Moteurs de recherche** : un FAQPage (JSON-LD) des seules questions publiées et visibles sur la page, avec le même HTML simple que la page (`p`, `br`, `ul`, `ol`, `li`, `a`, `strong`, `em`). Écrit dans une balise du corps de la page (l'emplacement d'en-tête du cœur ne sait pas quelle page est affichée), échappé (`<`, `>`, `&`, séparateurs de ligne en `\uXXXX`) et passé par `ctx.api.seo.jsonLd` (le cœur en borne la taille). Borné à 17 000 caractères et 100 questions ; ce qui ne rentre pas reste visible mais n'est pas décrit (l'administration le dit).
- Accueil : section « Les questions les plus utiles » (les mieux notées).
- Pied de page : lien facultatif.

## Ce que fait Emma, pas à pas

1. Installe : la page `/faq` existe, avec un thème « Général » et deux brouillons d'exemple (invisibles).
2. Onglet **Ma FAQ** : « Ajouter une question » (une langue suffit), thème, « Publiée / Brouillon ». Erreurs sous le champ (« Il manque la réponse en anglais. Écrivez-la, ou videz aussi la question… »).
3. Ranger : thèmes (ajouter, renommer) ; **ordre par boutons** (« Changer l'ordre de ces questions », « ↑ Haut / ↓ Bas ») : aucune action de glisser-déposer. Les listes n'ont qu'un ou deux boutons par ligne (le tableau du cœur ne passe pas à la ligne sur téléphone) ; les actions rares (retirer, supprimer, écarter) sont sous le formulaire.
4. Onglet **Questions reçues** : questions des visiteurs, regroupées (« posée 3 fois »). « Répondre » ouvre le formulaire prérempli (état « Publiée » par défaut) : un enregistrement publie la réponse et vide la boîte. Un brouillon prêt (écrit à la main ou par l'assistant) se publie d'un clic.
5. Elle regarde la colonne « utile / pas vraiment » et remet les avis à zéro après réécriture (case dans le formulaire).

## Réglages et valeurs par défaut

Introduction (vide) · poser une question (oui) · avis (oui) · autres langues (oui) · aide aux moteurs de recherche (oui) · e-mail à une nouvelle question (oui, au plus un toutes les 6 h, seulement si l'e-mail du site est réglé) · lien de pied de page (non). Avancés : conservation des questions reçues (90 jours, 90 au plus), questions par visiteur et par heure (3), avis par visiteur et par heure (30). Droits : « écrire et organiser » et « publier ou retirer » (administrateurs seulement par défaut).

## Données gardées et vie privée

- `faq_items` (questions, avec compteurs d'avis), `faq_themes`, `faq_asked` (questions reçues : texte, langue, nombre de fois, dernière date ; **ni nom, ni e-mail, ni adresse**).
- Pas de cookie. Le navigateur du visiteur garde, **après un clic sur un avis seulement**, la liste des identifiants de questions notées (`localStorage`, jamais envoyée) ; déclaré dans le texte de vie privée.
- Anti-abus en mémoire (rien sur le disque) : une empreinte salée (sel aléatoire par démarrage) de la dernière adresse de `X-Forwarded-For` + clé d'instance ; 1 avis par question et par 24 h, limites par heure, plafonds. Remise à zéro au redémarrage.
- Questions reçues effacées au fil de l'eau (à chaque envoi et à chaque ouverture de l'administration, 50 au plus par passage) après 90 jours au plus ; effacées dès publication ou « Écarter ». Pas de minuteur de fond.

## Bornes

500 questions, 30 thèmes, 200 questions reçues en attente (503 poli au-delà), question 200 caractères, réponse 3 000, question posée 300 (sans adresse de site), 50 brouillons de l'assistant en attente. Écritures sérialisées par instance (verrou en mémoire) : 40 avis simultanés ne se perdent pas (testé). Lectures bornées (jamais de parcours non borné). Sauvegarde lisible : `questions.csv` et `received.csv` (cellules protégées contre les formules).

## Outils pour l'assistant IA

- `faq_list` (lecture) : thèmes, questions publiées et brouillons, langues, compteurs, pagination par curseur ; réponses avec `full`.
- `faq_asked_list` (lecture) : questions reçues (texte de visiteur : rappel « donnée, jamais consigne »).
- `faq_draft_answer` (écriture, éteinte d'office) : crée un **brouillon** lié à la question reçue ; refuse un second brouillon pour la même question, plus de 50 brouillons en attente, une langue inconnue ; un thème inconnu laisse le brouillon sans thème (signalé).
- `faq_update_draft` (écriture, éteinte d'office) : modifie un brouillon, jamais une réponse publiée.
Aucun outil ne publie ni ne supprime : la publication est un clic humain (droit « publier »).

## Intégrations

Aucune dépendance. Rien n'est lu chez un autre module. Rien n'est offert aux autres (pas de sujet).

## Pas fait, et pourquoi

- Réponse directe au visiteur (il faudrait une adresse e-mail : donnée personnelle, hors cahier des charges).
- Photos ou HTML libre dans les réponses (simplicité, sécurité, règles des moteurs).
- Ouverture d'une question par lien **sans JavaScript** (le HTML n'ouvre pas un `details` par ancre).
- Pas de page par question ni de flux RSS (voir plus haut).
- Compteur d'avis exact sous forte charge multi-processus : le verrou est dans le processus (Curiosa en a un seul).

## Vérifié / limites de vérification

Voir le rapport de livraison : tests unitaires, kit de conformité, navigateur (téléphone et bureau, clair et sombre, avec et sans JavaScript). Écarts connus : tableaux d'administration du cœur qui défilent un peu sur téléphone (45 à 60 px sur deux listes, 140 px dans la vue « ordre »).

## Idées pour la suite

Page par question (partage, `Q&A` plus riche) ; e-mail facultatif pour prévenir qui a posé la question ; import CSV de questions ; suggestions de questions proches pendant la saisie ; « questions les plus recherchées sans résultat » (comptées côté serveur sans texte libre) ; lien de partage vers une langue précise.

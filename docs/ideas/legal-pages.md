# Mentions légales (`legal-pages`) : description complète

## Le problème
Chaque site doit dire qui l'édite, ce qu'il fait des données de ses visiteurs et ce qu'il dépose dans leur navigateur. Emma ne sait pas quoi écrire : elle copie un texte d'ailleurs (souvent faux pour son pays) ou n'en met pas.

## Pour qui
Toute personne qui a un site Curiosa et n'a pas de compétences juridiques ou techniques : créatrices, streameuses, artistes, petites associations, indépendants. Pays pris en compte : Belgique, France, Suisse, Canada (Québec ou autre province) et « un autre pays » (textes généraux).

## Choix de type de module
Module avec code, type « widget », **une seule instance**, une page publique (`/legal`), un emplacement de pied de page, un panneau d'administration, trois outils pour assistants IA. Un module « contenu, zéro code » ne suffisait pas : les textes sont fabriqués à partir de réponses, avec des règles par pays et un refus de publier si une réponse manque. Aucune route publique, aucun formulaire, aucun cookie, aucun appel réseau, aucun travail de fond : le module ne reçoit rien des visiteurs.

## Ce que voit le visiteur
- Un lien discret « Mentions légales » en bas de chaque page (réglable : un lien, trois liens, aucun), seulement quand les pages sont publiées.
- `/legal` (accueil des trois pages), `/legal/notice` (Mentions légales), `/legal/privacy` (Confidentialité), `/legal/cookies` (Cookies), dans la langue du visiteur (français ou anglais ; repli sur la langue du site). Pages normales : indexables, titre, description, adresse canonique et langues alternatives gérés par le cœur. Elles complètent la page « Politique de confidentialité » que le cœur écrit lui-même (`/privacy`, jamais modifiée) et y renvoient.
- Chaque page porte sa date de dernière mise à jour.

## Ce que fait Emma, pas à pas
1. Elle ouvre « Mentions légales » dans le menu (une pastille « 1 » dit qu'il y a quelque chose à faire).
2. **Commencer** : 6 à 8 questions, une à la fois, avec une barre de progression : pays ; qui édite (statut, nom, e-mail, prérempli avec l'adresse de contact du site) ; adresse et téléphone ; informations officielles (sauf pour un particulier) ; hébergeur ; ce qu'elle récolte (cases, préremplies d'après les extensions reconnues) ; durée de conservation (seulement si elle reçoit des messages privés) ; ventes.
3. Une erreur s'affiche sous le champ, avec un exemple et ce qu'il faut faire ; rien de ce qui a été tapé n'est perdu.
4. L'accueil de l'assistant montre chaque question, sa réponse et son état (Fait / À compléter / À confirmer), plus un « Bon à savoir » (voir plus bas).
5. **Aperçu** des trois pages en français ou en anglais ; ce qui manque est écrit en gras « ⚠ À compléter : … » avec un lien vers la bonne question ; un bouton copie chaque texte.
6. Elle coche « J'ai relu les textes et je sais que ce sont des modèles d'aide, pas un conseil juridique », puis **publie**. Elle peut republier, ou **retirer** les pages (ses réponses sont gardées).

## « Modèle d'aide, pas un conseil juridique »
Dit en tête de l'accueil, sur chaque écran de l'assistant (version courte), dans la case à cocher de publication, dans l'aperçu, dans le README et dans la description du module. Rien ne prétend être un avis.

## Ce que le site « sait déjà », et d'où ça vient
- **Nom du site** (par langue) et **adresse de contact** : `ctx.api.site()` et `ctx.api.brand()`.
- **Extensions actives** : `ctx.api.instances.list()` donne l'identifiant et le nom de chaque extension active. **Le cœur n'expose pas ce que chaque extension récolte** (sa déclaration `privacy` n'est lue que par sa propre page `/privacy`). Choix fait, sans contournement : une petite table `known.mjs` sert UNIQUEMENT à préremplir (extensions connues qui récoltent : formulaire de contact, livre d'or, suggestions de jeux, bot Twitch, lecteur Twitch ; extensions connues sans effet : réseaux, blog, planning…). Un test vérifie la table contre les manifestes du dépôt. **Toute autre extension (nouvelle, tierce) est inconnue : l'assistant pose une question simple à Emma** (« Les extensions que je ne connais pas récoltent-elles des informations ? ») et refuse de publier sans réponse. Les textes ne disent « aucun cookie de suivi » que si rien d'inconnu n'est déclaré.
- Ce que le cœur ne donne pas non plus (statistiques actives, bandeau de cookies) n'est pas affirmé par nos pages : elles renvoient à `/privacy`, que le cœur tient à jour.

## Jamais de trou, jamais de donnée inventée
Chaque réponse a une règle « nécessaire ou non » selon le pays et le statut (ex. France : hébergeur complet, directeur de la publication, capital pour une société, téléphone ; un particulier français peut ne pas montrer son adresse s'il a donné son identité à l'hébergeur, case à cocher). Une réponse nécessaire qui manque **bloque la publication** et se voit dans l'administration. Une réponse facultative absente fait **omettre la ligne** (jamais « Adresse : »). Les textes définitifs sont fabriqués en mode « final » qui lève une erreur au moindre manque : rien n'est écrit en base avant. Les autorités (APD, CNIL, PFPDT, Commissariat du Canada, CAI du Québec) sont des adresses de sites officiels ; pour « un autre pays », aucune autorité n'est inventée.

## Rappels visibles
Après publication, l'accueil (et la pastille du menu) signalent : une extension qui récolte a été ajoutée ou retirée ; une extension inconnue est apparue (l'étape « récolte » est à reconfirmer et republier) ; une réponse ou le nom du site a changé depuis la publication ; les textes ont plus de 12 mois (réglable, mode avancé). Une extension connue comme sans effet n'ajoute pas de bruit.

## « Bon à savoir » (non bloquant)
Contenu d'un autre service intégré (consentement en Belgique/France, pas de bandeau ajouté) ; liste d'e-mails (désabonnement ; loi anti-pourriel au Canada) ; vente sur le site (conditions de vente non couvertes) ; engagement d'effacer les messages après la durée choisie ; adresse visible d'un particulier français ; contradiction entre une extension détectée et une réponse « non ».

## Réglages et valeurs par défaut
- Liens en bas de page : « un seul lien » (défaut), trois, aucun.
- Rappel de relecture : 12 mois (avancé).
- Droit « publier ou retirer » (sensible, administrateurs par défaut, pas les éditeurs). L'adresse des pages (`legal`) se change dans l'onglet Général du cœur.
- Onglet « Utiliser » renommé « Mes pages légales ».

## Données gardées et vie privée
Trois documents dans le stockage de l'instance : les réponses (brouillon), les textes publiés (FR + EN), un résumé minuscule (date, empreinte, extensions connues). Aucune donnée de visiteur. Sauvegarde lisible : `answers.md`, `published-fr.md`, `published-en.md`.

## Bornes
Un document par collection (les doublons sont rangés), champs bornés (120 à 600 caractères), 8 étapes, pas de pagination nécessaire ; une lecture minuscule par page vue (pied de page). Aucun minuteur.

## Outils pour l'assistant IA
`legal_status` (lecture : où en sont les pages, ce qui manque, rappels, extensions vues), `legal_preview` (lecture : texte brouillon d'une page, FR/EN), `legal_set_answers` (écriture, jamais accordée d'office : prépare un brouillon, **ne valide aucune étape et ne publie jamais**). Aucun outil ne publie.

## Intégrations
Aucune dépendance. Lit le nom du site, l'adresse de contact et la liste des extensions par `ctx.api`. Renvoie vers la page `/privacy` du cœur.

## Ce qui n'est pas fait, et pourquoi
- Conditions de vente, droit de rétractation : hors modèle (signalé).
- Bandeau de consentement et blocage des contenus tiers : le module ne contrôle pas le rendu des autres extensions.
- Effacement automatique des messages : le module ne possède pas les messages.
- Autres langues que le français et l'anglais ; autres pays que les cinq cas ; régimes particuliers (mineurs, santé, presse).
- Lien dans le menu du haut : le cœur ajoute par défaut toute instance à page au menu ; le module le dit à Emma (« décochez Afficher dans le menu »).
- Les sous-pages ne sont pas dans le plan du site (le cœur ne liste que le chemin de l'instance) ; elles sont liées depuis chaque page et le pied de page.
- Le lecteur Twitch de l'extension de statut live n'est pas déclaré dans son manifeste : nos pages le disent, mais `/privacy` du cœur non.

## Idées pour la suite
- Le cœur pourrait exposer à `ctx.api` ce que déclarent les extensions actives (`privacy`) : la table `known.mjs` disparaîtrait.
- Une section « confidentialité » ajoutée à la page `/privacy` du cœur.
- Ajouter les nouvelles extensions du catalogue à la table `known.mjs` après examen de leur déclaration.
- Autres langues, mentions pour la vente.

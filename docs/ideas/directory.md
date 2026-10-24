# Annuaire (`directory`), description complète

Version 1.0.0, cœur 0.2.6 au moins (`ctx.api.visitor.fingerprint` pour limiter le CSV). Type « widget » avec code, `instances: multiple` (annuaire des membres, annuaire des partenaires…), page publique `/annuaire` (chemin proposé).

## Le problème
Une association ou un collectif tient une grosse base de personnes dans Contacts (milliers de fiches). Un « mur » ne suffit plus : il faut pouvoir **chercher** et **filtrer**. Le Mur des remerciements sert à REMERCIER (quelques groupes, mise à l'honneur) ; l'Annuaire sert à RETROUVER (recherche, filtres, tri, pages, fiche, impression, CSV). Contacts ne sait ni chercher dans une grande liste, ni filtrer par plusieurs catégories, ni trier : l'Annuaire lit chaque catégorie publique par paquets de 500 et fait le reste en mémoire.

## Pour qui
Emma (non technique) et son public. Aucun compte visiteur.

## Ce que voit le visiteur
- Liste de cartes (photo ou initiales, nom, ville, catégories en pastilles, titre pour l'équipe), 24 par page (50 au plus), compteur, « Précédent / Suivant » par curseur. Tout fonctionne sans JavaScript.
- Recherche par nom (accents et majuscules ignorés, plusieurs mots ; nom, pseudo, ville, titre d'équipe), filtres par catégories (l'une OU l'autre), tri A–Z / récents / au hasard stable toute la journée.
- Adresses stables : `/annuaire`, `/c/a+b`, `/q/texte`, `/s/new`, `/after/<curseur>`, `/photos`, `/p/<nom>-<identifiant public>` (seul l'identifiant public de 10 caractères compte : un changement de nom ne casse pas le lien ; jamais l'identifiant de Contacts), `/team`, `/print/…`. Le formulaire de recherche passe par une route de lecture qui refait l'adresse à partir de valeurs vérifiées (jamais d'adresse reçue).
- Fiche : nom, titre, ville, catégories, présentation courte, liens vers les comptes, « autres personnes de la même catégorie » (voisines alphabétiques, stables), « Demander la modification ou le retrait de cette fiche ».
- Section Équipe en tête de la première page (titre affiché, ordre choisi) et page `/team`.
- Version imprimable (tableau, 500 lignes) et CSV (5 000 lignes, BOM, formules neutralisées, champs publics seulement, 10 demandes/minute/visiteur).
- « Proposer ma fiche » : la page choisie dans les réglages (ex. celle du formulaire de contact : le module `contact-form` n'a pas de page propre, c'est la propriétaire qui dit où il se trouve), sinon la page d'une instance `contact-form` si elle en a une, sinon l'e-mail réglé, sinon celui du site, sinon pas de bouton. Destinations permises : chemin du site, https, mailto.
- Données structurées Person / Organization (réglage avancé, désactivé par défaut) : seulement ce que la fiche affiche.
- États : Contacts muet = dernier annuaire connu (24 h au plus) puis « L'annuaire se prépare » ; rien de réglé = « se remplit bientôt » ; jamais une erreur.

## Ce que fait Emma, pas à pas
1. Installer (Contacts vient avec). 2. Choisir un gabarit en un clic (**Association**, **Collectif de créateurs**, **Vide**) : mots, catégories de départ créées dans Contacts (avec son droit de créer des catégories, sinon « à relier »), équipe à compléter. 3. Ranger ses fiches dans ces catégories depuis Contacts. 4. Onglet « Mon annuaire » : choisir les catégories publiques (cases à cocher avec recherche, pages de 25, créer une catégorie d'ici), libellé public par langue, ordre ; équipe (chercher une personne, titre par langue, ordre, retirer) ; personnes visibles (recherche, 25 par page) avec « Fiche » (présentation 280 caractères par langue, ville) et « Masquer » ; « masquées ici » avec « Remontrer » ; « Vérifier mon annuaire » après fusion/suppression dans Contacts. Les erreurs s'affichent sous le champ avec un exemple.

## Consentement (même modèle que le mur des remerciements, et pourquoi)
Une personne est visible quand : elle est rangée dans une catégorie PUBLIQUE choisie par la propriétaire (c'est elle qui atteste l'accord, comme pour le mur) OU dans l'équipe ; ET elle n'est pas dans la catégorie « Ne pas montrer » de Contacts (réglage, sinon catégorie nommée « Ne pas montrer » / « Do not show ») ; ET sa fiche n'est pas « à relire » ; ET elle n'est pas masquée ici ; ET, si la propriétaire a réglé une catégorie « a accepté d'apparaître », elle y est aussi (catégorie disparue = personne). La règle « en cas de doute on ne publie pas » est reprise (Contacts ne dit pas qui est caché : on garde le dernier annuaire). Le bouton « Masquer » est local à l'annuaire (un partenaire peut être masqué ici sans l'être ailleurs) et garde Contacts intact ; le retrait global reste la catégorie de Contacts. Pourquoi : une seule vérité par personne (Contacts), le consentement s'exprime par le rangement, comme pour le mur.

## Équipe : d'où vient le titre (décision)
Le champ « Rôle » de Contacts est privé à l'origine (le publier par défaut pourrait fuiter). Le titre affiché et l'ordre sont donc propres à l'annuaire (par fiche, par langue), rattachés au numéro de fiche, avec `privacy.subject`. Option avancée « Reprendre le champ Rôle de Contacts » (désactivée) pour un membre sans titre écrit ici. Contacts n'est pas modifié.

## Réglages (défauts)
Titre, introduction, mot singulier/pluriel, titre de l'équipe (vides : mots du gabarit puis mots neutres FR/EN), noms (comme la fiche / prénom / pseudo), photos (sur demande / toujours / jamais), liens (fiche / liste et fiche / nulle part), présentation, catégories « ne pas montrer », « a accepté », « accepte la carte », page et e-mail de « Proposer ma fiche », libellé du bouton ; avancés : tri de départ, personnes par page (24), imprimable/CSV (oui), données structurées (non), rôle de Contacts (non). Droits : `edit`, `hide`.

## Données et vie privée
Gardé (par numéro de fiche) : `dir_config` (un document : gabarit, mots de départ, catégories publiques avec adresse stable et libellé, équipe avec titre) et `dir_profiles` (présentation, ville, coordonnées arrondies, masquée). Jamais nom, photo, compte, e-mail, téléphone (testé). Aucun cookie, aucune adresse de visiteur gardée, la recherche n'est pas conservée. `privacy.subject` : export, effacement, fusion (jamais d'écrasement). Photos : chargées par le navigateur ; une photo hébergée ailleurs (Twitch/YouTube/Bluesky ou adresse choisie) seulement après le clic « Afficher les photos » (lien `/photos`), sauf réglage « toujours » ; liste blanche des serveurs de photos de réseau ; `referrerpolicy=no-referrer`. Déclaration `privacy` à jour (carte, droit de retrait).

## Carte (`map.place`)
Publié SEULEMENT pour les personnes : dans la catégorie « accepte d'être sur la carte » (réglage ; par défaut aucune), visibles, avec une ville ET des coordonnées. Les coordonnées sont celles de la VILLE, arrondies à 2 décimales, obtenues depuis l'administration à l'enregistrement de la fiche (seul le nom de la ville part vers le service de recherche de lieux d'Open-Meteo via `ctx.api.net`, jamais depuis une page publique) ; jamais d'adresse. Identifiant `directory:<instance>:<identifiant public>`, kind `member`, url de la fiche, note = ville.

## Bornes
40 catégories publiques, 60 d'équipe, 5 000 fiches publiques (présentation/ville/masquées), 10 000 personnes en mémoire par annuaire, 5 000 lues par catégorie (lectures de 500), 6 annuaires en mémoire, mémoire fraîche 2 min (15 s en administration), secours 24 h, reconstruction partagée (une seule lecture pour dix visites), attente courte (1,2 s) quand une ancienne liste existe, appels à Contacts bornés (4 s), aucun minuteur de fond, aucune écriture pendant une visite. Mesuré sur le double de Contacts : 5 000 fiches construites en ~140 ms, page 0,5 ms, recherche 1,3 ms ; mémoire ~26 Mo.
Limites de Contacts utilisées sans le modifier : pas de filtre multi-catégories ni de recherche paginée (donc index local), `search` limité à 30 résultats (administration seulement).

## Outils pour l'assistant IA (lecture seule)
`directory_status`, `directory_categories`, `directory_search`, `directory_person`, `directory_team` : champs publics seulement. Aucune écriture, ni ici ni dans Contacts.

## Intégrations
`contact.book` v2 obligatoire (`categories`, `categoriesResolve`, `list`, `resolve`, `search`, `createCategory` avec `asCaller` pour les catégories de départ) ; `privacy.subject` offert (`each`) ; `map.place` fourni ; `contact-form` facultatif (page choisie ou détectée).

## Ce qui n'est pas fait, et pourquoi
Choix multiple de catégories dans un seul réglage (le cœur n'en a pas : écran à cases dans le panneau) ; relais d'images (impossible honnêtement) ; coordonnées saisies à la main (inutile : la ville suffit) ; recherche tolérant les fautes de frappe ; carte intégrée (module Carte) ; synchronisation Twitch.

## Idées pour la suite
Interrupteur natif « ne pas montrer » dans Contacts ; filtre ET en plus de OU ; champ public « bio » natif dans Contacts ; page de statistiques de recherche (sans suivi).

# Soutiens (module `supporters`, 1.0.0)

## Le problème
Une créatrice est soutenue sur une plateforme de mécénat (Patreon, Ko-fi…). Elle veut remercier ces personnes sur son site, mais :
- retaper la liste à la main est pénible et vite périmé ;
- être membre d'une plateforme n'est **pas** un accord pour apparaître sur un site : montrer quelqu'un sans son accord est une faute de vie privée ;
- elle ne veut pas afficher de montants, ni dépendre d'une seule plateforme.

## Pour qui
Toute personne qui a un site Curiosa et un soutien payant sur une plateforme (ou une liste tenue à la main). Le module ne connaît aucun site ni aucune association : mots, titres et libellés sont réglables.

## Ce que voit le visiteur
- Une page (éteinte au départ) « Merci à nos soutiens » : des pastilles avec **uniquement des pseudos**, groupées sous les libellés de palier choisis par la propriétaire (jamais un montant, un vrai nom, une date). Vide et aimable tant que personne n'a accepté. 48 pseudos par page (réglable, 50 au plus).
- Pas de script, pas de cookie, pas de photo, aucun service tiers.

## Ce que voit la personne soutenue
Un lien personnel que la propriétaire lui envoie : une page « Votre accord » où elle choisit un pseudo (refusés : lien, adresse e-mail, balisage), coche « je suis d'accord » et valide. Elle peut changer son pseudo ou se retirer sur le même lien, à tout moment ; le retrait est immédiat. Les erreurs sont écrites sous le champ, avec un exemple.

## Ce que fait la propriétaire, pas à pas
1. Installer le module : rien d'obligatoire. Onglet « Mes soutiens » : un assistant en étapes pour la plateforme choisie.
2. Coller la clé secrète dans l'onglet Réglages (jamais réaffichée), cliquer « Vérifier et actualiser ». En cas d'erreur : une phrase simple (clé refusée, plateforme injoignable…). Ko-fi : copier l'adresse affichée dans la page Webhooks de Ko-fi. Autre plateforme : importer un fichier CSV.
3. Choisir les libellés publics des paliers (ou un modèle de départ : trois niveaux, numérotés, aucun).
4. Allumer la page publique quand elle est prête.
5. Ouvrir une personne, copier son lien d'accord, le lui envoyer. Le pseudo arrive « à relire » : cliquer « Approuver » (relecture désactivable).
6. Facultatif : « Ranger N soutiens dans Contacts ».

## Réglages et valeurs de départ
Plateforme : Patreon · clé secrète : vide · page publique : **non** · relecture des pseudos : **oui** · titre/intro/titre du groupe sans libellé/mots d'accueil : mots neutres FR+EN · catégorie de Contacts : aucune (suggestion « Soutiens » / « Supporters », trouvée par son nom si elle existe) · regrouper par palier : oui · avancé : jours d'activité d'un don 40 (7–400), oubli après 365 jours (30–1100), actualisation toutes les 360 min (15–1440), 48 pseudos par page (6–50), catégorie du mur des remerciements : aucune. Plusieurs plateformes : une instance par plateforme (chacune a sa page).

## Plateformes (table `providers.mjs`)
- **Patreon** (interrogation) : API v2, hôte autorisé `www.patreon.com` seulement. Lit membres, statut, paliers, date de début ; **ne demande pas l'e-mail** ; ne garde que le rang du palier, jamais le montant. Jusqu'à 2 000 membres par actualisation (10 pages de 200, 25 s) ; liste incomplète = personne n'est déclaré arrêté à tort.
- **Ko-fi** (notification) : route `/m/<clé>/kofi`, jeton de vérification comparé en temps constant, limité en débit (par visiteur et global), corps ≤ 20 Ko, idempotent (300 derniers identifiants), pause après dix mauvais jetons. Seuls dons et abonnements comptent ; e-mail et montant sont ignorés (l'e-mail ne sert qu'à une empreinte irréversible). Aucun appel sortant.
- **Fichier CSV** (secours) : colonnes nom, palier, depuis, statut (FR ou EN, `,` `;` tabulation), 1 000 lignes / 300 Ko, réimport sans doublon, option « les absents ne sont plus actifs ».
- Ajouter une plateforme : une entrée dans la table (texte FR+EN, hôtes, `pull`/`verify`+`parseEvent`/`parseRows`) et une option du réglage ; un test vérifie que les deux listes concordent.

## Vie privée
- Par défaut tout est caché. Public = accord de la personne + pseudo relu + non caché + soutien actif.
- Gardé par soutien : plateforme, numéro de membre (ou empreinte), paliers, date de début, dernier signe, état, accord (pseudo, jour). Le nom donné par la plateforme n'est gardé que **jusqu'au rangement dans Contacts**. Jamais d'e-mail ni de montant. Secret du module : stocké seulement pour fabriquer les liens (recalculés, pas stockés) et les empreintes.
- Les soutiens arrêtés sont oubliés après 365 jours (réglable) ; bouton de nettoyage.
- Service `privacy.subject` (export, effacement, fusion) ; effacer une fiche de Contacts efface ses soutiens ici. « Oublier » existe aussi dans le module.
- Pas de cookie, pas de tiers chez le visiteur ; la page d'accord garde la personne en 404 générique si le lien est faux ; limites de débit sur l'accord.
- Déclaration `privacy` FR+EN : « s'inscrire n'est pas un accord ».

## Contacts (facultatif)
Contacts possède les personnes. Le module y range les soutiens (compte `autre` = `plateforme:numéro`, donc jamais de doublon, nom existant jamais écrasé) dans la catégorie choisie, **seulement** par le bouton protégé par le droit `contacts.file` ; jamais depuis une page publique ou une notification. La catégorie unique proposée d'office par le cœur n'est pas prise sans choix. Retirer quelqu'un de la catégorie du mur est une protection toujours permise.

## Mur des remerciements (facultatif)
Sans modifier le mur existant : un réglage avancé « catégorie pour le mur » range dans cette catégorie de Contacts **seulement** les personnes dont le pseudo accepté est exactement le nom de leur fiche (le mur montre le nom de la fiche) ; elles en sortent immédiatement si elles se retirent, changent de pseudo ou sont cachées. Le service `supporters.public` (v1, lecture seule, `list({limit, cursor})` → `{ ok, items: [{ id, pseudo, tier }], next }`) permettra au mur de consommer directement les pseudos.

## Bornes
5 000 soutiens · 60 paliers · 25 lignes par page d'administration · 100 fiches rangées par clic · 2 000 membres lus par actualisation · 1 000 lignes par import · 50 pseudos par page publique · 40 caractères par pseudo, 40 par libellé. Mémoire de lecture 30 s, actualisation au plus toutes les 360 min (pause de 10 min après une panne), aucune tâche de fond.

## Outils MCP (assistant IA)
Lecture : `supporters_status`, `supporters_list`. Écriture (jamais accordée d'office) : `supporters_refresh`, `supporters_tier_label`, `supporters_approve`, `supporters_hide`, `supporters_consent_link`, `supporters_file_contacts`. Destructif : `supporters_forget`. Aucun outil n'écrit un pseudo à la place de la personne.

## Ce qui n'est pas fait
- Le mur des remerciements ne consomme pas encore `supporters.public` (module non modifié ici).
- Pas d'OAuth Patreon (jeton créateur collé), pas de webhooks Patreon, pas d'autres plateformes que celles de la table.
- Pas d'envoi automatique du lien d'accord (la propriétaire l'envoie elle-même).
- Pas d'e-mail ni de montant, volontairement ; pas de photo.
- Le pseudo saisi est perdu après une erreur de validation (la page se recharge).

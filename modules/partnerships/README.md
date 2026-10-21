# Partenariats — module communautaire de Curiosa

Le suivi **privé** de vos partenariats : marques démarchées, statut (à contacter → envoyé → en discussion →
accepté → publié…), chances, relances dues, journal daté. **Aucune page publique** : rien de ce module n'apparaît sur votre site.

## Un carnet unique : les personnes sont dans Contacts

Ce module n'a **plus de carnet de contacts à lui**. Une personne n'existe qu'une fois, dans le module *Contacts* ; une fiche partenaire ne garde que des **liens** (`contactIds`, des identifiants). Il **requiert** le service `contact.book` de Contacts (comme le formulaire de contact requiert `contact.store`) : activer Partenariats installe et active Contacts au besoin.

- **Sur une fiche** : les contacts liés s'affichent (nom, fonction, e-mail, téléphone, lien vers leur fiche Contacts). On peut **lier** un contact existant (liste ou recherche), en **créer** un (il naît dans Contacts, sans doublon : même e-mail = la personne existante est liée), ou le **délier**. Délier ou supprimer une fiche ne supprime **jamais** une personne.
- **Contacts absent ou désactivé** : la fiche s'affiche quand même, les liens sont conservés (noms « indisponibles »), un message le dit. Rien ne plante.

## Reprise unique des contacts d'avant la 2.0 (à retirer en phase 3)

Jusqu'à la 1.x, ce module portait un petit carnet de contacts et un écran de fusion vers Contacts. **Il n'y a plus ni l'un ni l'autre.** À la mise à jour en 2.0 (`dataVersion` 2), la reprise se fait **toute seule**, sans écran ni bouton :

- **Cas sûrs** (mêmes règles que l'ancien écran de fusion : même e-mail, majuscules ignorées ; sans e-mail, même nom **et** même organisation) : la personne est **créée** dans Contacts, ou **liée** si elle y est déjà (ce que la fiche existante ne savait pas est ajouté en **note**, rien n'est écrasé).
- **Cas douteux** (même e-mail mais autre nom, même nom avec une autre organisation ou un autre e-mail, plusieurs candidats, nom manquant) : une fiche Contacts **« à vérifier »** est créée, avec la note « Repris de Partenariats : à vérifier » (fiche partenaire, raison du doute, e-mail). Elle n'est **jamais** fusionnée avec une fiche existante : l'e-mail n'est mis qu'en note.
- Les liens (`contactIds`) déjà présents ne changent pas ; les personnes reprises s'y ajoutent (50 au plus par fiche : au-delà, la personne existe dans Contacts mais n'est pas liée, c'est compté).
- **Rien n'est perdu.** Les originaux sont d'abord copiés dans `legacyContacts` (copie **inerte** : plus jamais relue une fois la reprise finie, gardée par la sauvegarde complète), puis retirés de `contacts` seulement après le dernier cas réglé. Les trois collections héritées (`contacts`, `legacyContacts`, `meta`) sont déclarées dans `legacyCollections` du manifeste : le rapport d'héritage du cœur les compte.
- **Sans Contacts 2** (absent, trop ancien, qui ne répond pas) : **rien n'est écrit**, un bandeau le dit, et la reprise recommence à l'ouverture suivante de l'administration (aucun minuteur de fond). Chaque appel à Contacts a une attente bornée (5 s) et une reprise ne dépasse pas 40 s par passage ; ce qui est réglé est noté, le reste attend.
- **Rejouable** : un cas réglé est noté (collection `meta`), Contacts ne crée jamais deux fois la même personne ; relancer ne crée aucun doublon.
- Depuis une installation qui avait déjà fusionné ses contacts en 1.x : les cas déjà réglés ou « laissés de côté » le restent, seuls ceux qui attendaient sont repris.
- Si des fiches « à vérifier » ont été créées, un bilan s'affiche 30 jours dans l'administration.

Toute la reprise est dans `migrate.mjs` (plus le mot « à retirer en phase 3 » dans `admin.mjs` et `index.mjs`).

## Vie privée : `privacy.subject`

Partenariats **offre** le service `privacy.subject` (une réponse par instance) pour ce qu'il garde sur une personne de Contacts, c'est-à-dire seulement des **liens** de ses fiches partenaires. Contacts l'appelle :

- `export` `{ contactId }` : les fiches partenaires liées à cette personne (nom de la marque, statut).
- `erase` `{ contactId }` : le lien est retiré de toutes les fiches ; les fiches et leur journal restent.
- `remap` `{ from, to }` : après une fusion de doublons dans Contacts, les liens vers `from` pointent vers `to`, sans doublon.

Les trois répondent `0` pour une fiche inconnue, ne lèvent jamais, et sont rejouables. Une personne **supprimée** de Contacts reste signalée (« Supprimée du carnet »), et une personne **fusionnée** sans que `remap` ait été reçu est suivie par `resolve(...).moved` : le lien se corrige tout seul.

## MCP

`partners_list`, `partner_get` (renvoie aussi les contacts liés : id, nom, fonction, e-mail), `partner_create` (statut « à contacter » ou « en discussion » seulement), `partner_update`, `partner_log`, **`partner_link_contact`** et **`partner_unlink_contact`**. Les outils qui écrivent (`partner_create`, `partner_update`, `partner_log`, `partner_link_contact`, `partner_unlink_contact`) ne sont **accordés qu'explicitement** par votre accès IA ; seule la lecture est accordée d'office. Les outils qui créent, modifient ou suppriment des personnes sont ceux de *Contacts*. `partner_delete` existe mais est **désactivée par défaut** (elle ne supprime que la fiche et son journal). Les modifications d'un assistant sont attribuées à son jeton (`agent:<jeton>`).

Le sujet `partnership.partner` reste fourni (le module *Sponsors* s'en sert). **Réglage avancé** : jours sans nouvelle avant une relance (14). Un seul exemplaire par site.

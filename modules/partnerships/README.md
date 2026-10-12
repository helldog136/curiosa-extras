# Partenariats — module communautaire de Curiosa

Le suivi **privé** de vos partenariats : marques démarchées, statut (à contacter → envoyé → en discussion →
accepté → publié…), chances, relances dues, journal daté. **Aucune page publique** : rien de ce module n'apparaît sur votre site.

## Un carnet unique : les personnes sont dans Contacts

Ce module n'a **plus de carnet de contacts à lui**. Une personne n'existe qu'une fois, dans le module *Contacts* ; une fiche partenaire ne garde que des **liens** (`contactIds`, des identifiants). Il **requiert** le service `contact.book` de Contacts (comme le formulaire de contact requiert `contact.store`) : activer Partenariats installe et active Contacts au besoin.

- **Sur une fiche** : les contacts liés s'affichent (nom, fonction, e-mail, téléphone, lien vers leur fiche Contacts). On peut **lier** un contact existant (liste ou recherche), en **créer** un (il naît dans Contacts, sans doublon : même e-mail = la personne existante est liée), ou le **délier**. Délier ou supprimer une fiche ne supprime **jamais** une personne.
- **Contacts absent ou désactivé** : la fiche s'affiche quand même, les liens sont conservés (noms « indisponibles »), un message le dit. Rien ne plante.

## Fusionner mes contacts avec le module Contacts (données existantes)

Tant que la fusion n'est pas faite, les anciens contacts de ce module restent visibles (lecture seule) et un bandeau « Fusionnez vos contacts » apparaît. Le bouton ouvre un **aperçu** : combien de contacts, combien sont déjà dans Contacts (simplement liés), combien seraient créés, combien sont **ambigus** (avec la liste). Rien ne bouge sans confirmation.

- **Dédoublonnage** : même e-mail (majuscules ignorées) ; sans e-mail, même nom **et** même organisation (majuscules, accents et espaces ignorés). En cas de doute (même e-mail mais autre nom, même nom avec une autre organisation ou un autre e-mail, plusieurs candidats, nom manquant) : **rien n'est fusionné**, le contact est listé pour que vous tranchiez (« C'est cette personne » ou « Laisser de côté »).
- **Sécurité** : les anciens contacts sont d'abord **copiés tels quels** dans la collection `legacyContacts` (incluse dans la sauvegarde, avec un `legacy-contacts.csv` lisible), puis les personnes sont créées/liées une à une. Les existantes ne sont pas modifiées (leurs informations en plus sont ajoutées en **note**).
- **Rejouable** : relancer ne crée aucun doublon. **Annulable** : « Annuler la fusion » retire les liens posés par la fusion et remet l'ancien carnet ; les personnes créées dans Contacts y restent (rien n'y est supprimé).
- **Pourquoi un bouton plutôt qu'une migration automatique** : le cœur exécute une migration au moment de la mise à jour, sans pouvoir demander l'avis du propriétaire ni attendre que Contacts soit présent ; une erreur mettrait tout le module à l'écart. Ici il faut voir les cas douteux et confirmer.

## MCP

`partners_list`, `partner_get` (renvoie aussi les contacts liés : id, nom, fonction, e-mail), `partner_create` (statut « à contacter » ou « en discussion » seulement), `partner_update`, `partner_log`, **`partner_link_contact`** et **`partner_unlink_contact`** (accordées d'office : réversibles, elles ne touchent pas aux personnes). Les outils qui créent, modifient ou suppriment des personnes sont ceux de *Contacts*. `partner_delete` existe mais est **désactivée par défaut** (elle ne supprime que la fiche et son journal). Les modifications d'un assistant sont attribuées à son jeton (`agent:<jeton>`).

Le sujet `partnership.partner` reste fourni (le module *Sponsors* s'en sert). **Réglage avancé** : jours sans nouvelle avant une relance (14). Un seul exemplaire par site.

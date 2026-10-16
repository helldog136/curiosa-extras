# Partenariats — module communautaire de Curiosa

Le suivi **privé** de vos partenariats : marques démarchées, statut (à contacter → envoyé → en discussion →
accepté → publié…), chances, relances dues, journal daté. **Aucune page publique** : rien de ce module n'apparaît sur votre site.

## Un carnet unique : les personnes sont dans Contacts

Ce module n'a **plus de carnet de contacts à lui**. Une personne n'existe qu'une fois, dans le module *Contacts* ; une fiche partenaire ne garde que des **liens** (`contactIds`, des identifiants). Il **requiert** le service `contact.book` de Contacts (comme le formulaire de contact requiert `contact.store`) : activer Partenariats installe et active Contacts au besoin.

- **Sur une fiche** : les contacts liés s'affichent (nom, fonction, e-mail, téléphone, lien vers leur fiche Contacts). On peut **lier** un contact existant (liste ou recherche), en **créer** un (il naît dans Contacts, sans doublon : même e-mail = la personne existante est liée), ou le **délier**. Délier ou supprimer une fiche ne supprime **jamais** une personne.
- **Contacts absent ou désactivé** : la fiche s'affiche quand même, les liens sont conservés (noms « indisponibles »), un message le dit. Rien ne plante.

## Migration temporaire : fusionner mes contacts avec le module Contacts

Tant que la fusion n'est pas faite, les anciens contacts de ce module restent visibles (lecture seule) et un bandeau « Fusionnez vos contacts » apparaît. Le bouton ouvre un **aperçu** : combien de contacts, combien sont déjà dans Contacts (simplement liés), combien seraient créés, combien sont **ambigus** (avec la liste). Rien ne bouge sans confirmation.

- **Dédoublonnage** : même e-mail (majuscules ignorées) ; sans e-mail, même nom **et** même organisation (majuscules, accents et espaces ignorés). En cas de doute (même e-mail mais autre nom, même nom avec une autre organisation ou un autre e-mail, plusieurs candidats, nom manquant) : **rien n'est fusionné**, le contact est listé pour que vous tranchiez (« C'est cette personne » ou « Laisser de côté »).
- **Sécurité** : les anciens contacts sont d'abord **copiés tels quels** dans la collection `legacyContacts` (incluse dans la sauvegarde, avec un `legacy-contacts.csv` lisible), puis les personnes sont créées/liées une à une. Les existantes ne sont pas modifiées (leurs informations en plus sont ajoutées en **note**).
- **Rejouable** : relancer ne crée aucun doublon. **Annulable** : « Annuler la fusion » retire les liens posés par la fusion et remet l'ancien carnet ; les personnes créées dans Contacts y restent (rien n'y est supprimé).
- **Pourquoi un bouton plutôt qu'une migration automatique** : le cœur exécute une migration au moment de la mise à jour, sans pouvoir demander l'avis du propriétaire ni attendre que Contacts soit présent ; une erreur mettrait tout le module à l'écart. Ici il faut voir les cas douteux et confirmer.

**Ce qui est temporaire.** Toute la fusion est dans `merge.mjs` (plus quelques lignes marquées « MIGRATION TEMPORAIRE » dans `admin.mjs`, `tools.mjs`, `index.mjs`, et les textes `merge*`, `why_*`, `old*`, `banner*`, `pending*` des locales). Elle sera **retirée en 1.5.0** (ou dès que plus aucun site n'a d'anciens contacts).

**Quand elle se voit.** Jamais sur un site neuf, ni sans ancien contact : ni bandeau, ni lien, ni mention dans les outils MCP, ni `legacy-contacts.csv`, et aucune collection `legacyContacts` / `meta` n'est créée. Elle apparaît seulement : (1) tant qu'il reste des anciens contacts non fusionnés (bandeau) ; (2) tant que des cas ambigus attendent (lien « à vérifier à la main » et lien en pied de page) ; (3) pendant **30 jours** après la fusion (lien en pied de page pour pouvoir l'annuler, et `legacy-contacts.csv`).

**Après 30 jours.** Plus aucun lien ni fichier lisible, mais rien n'est perdu : la copie `legacyContacts` reste dans le stockage et dans la sauvegarde complète, et la page de fusion reste atteignable en ajoutant `?merge=1` à l'adresse de la page du module, avec son bouton « Annuler la fusion ».

## MCP

`partners_list`, `partner_get` (renvoie aussi les contacts liés : id, nom, fonction, e-mail), `partner_create` (statut « à contacter » ou « en discussion » seulement), `partner_update`, `partner_log`, **`partner_link_contact`** et **`partner_unlink_contact`**. Les outils qui écrivent (`partner_create`, `partner_update`, `partner_log`, `partner_link_contact`, `partner_unlink_contact`) ne sont **accordés qu'explicitement** par votre accès IA ; seule la lecture est accordée d'office. Les outils qui créent, modifient ou suppriment des personnes sont ceux de *Contacts*. `partner_delete` existe mais est **désactivée par défaut** (elle ne supprime que la fiche et son journal). Les modifications d'un assistant sont attribuées à son jeton (`agent:<jeton>`).

Le sujet `partnership.partner` reste fourni (le module *Sponsors* s'en sert). **Réglage avancé** : jours sans nouvelle avant une relance (14). Un seul exemplaire par site.

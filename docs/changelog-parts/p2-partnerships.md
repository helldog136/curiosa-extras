## Partenariats 2.0.0

### Nouveautés

- **Partenariats ne garde plus de carnet de contacts à lui.** L'écran « Contacts à fusionner » et le bouton « Annuler la fusion » disparaissent : toutes vos personnes sont dans Contacts, et les fiches partenaires ne font que s'y référer.
- **Vos anciens contacts sont repris tout seuls à la mise à jour, sans rien à cliquer.** Ceux dont on est sûr (même e-mail, ou même nom et même organisation) sont créés dans Contacts ou rattachés à la personne qui y est déjà. Les cas douteux deviennent des fiches Contacts marquées « à vérifier », avec la note « Repris de Partenariats : à vérifier » : vous les confirmez quand vous voulez. Rien n'est jamais fusionné à votre insu et rien n'est perdu.

### Améliorations

- **Si Contacts n'est pas prêt** (absent, pas encore à jour, ou qui ne répond pas), rien n'est modifié : un message le dit en haut de Partenariats, et la reprise se fait toute seule dès que Contacts répond.
- **Effacer ou fusionner une personne dans Contacts met aussi Partenariats à jour** : le lien est retiré de vos fiches, ou redirigé vers la personne gardée, sans doublon.
- **Une personne fusionnée ou supprimée dans Contacts** est suivie sur vos fiches partenaires (elle ne disparaît plus de la liste). Le comportement des partenariats, le journal et l'accès pour les assistants IA ne changent pas.

### Pour les développeurs

- Partenariats 2.0.0 : `dataVersion` 2 (reprise `migrations[2]` : `migrate.mjs`, à retirer en phase 3), `minCore` 0.2.1, `legacyCollections` : `contacts`, `legacyContacts`, `meta`. `merge.mjs`, les actions `merge*` et `backup.readable` (CSV de l'ancien carnet) sont supprimés.
- Offre `privacy.subject` (`each`, `export` en lecture seule) : export / erase / remap de ses `contactIds`, vérifié par `runPrivacySubjectContract`. Gère `missing` et `moved` (`resolve`). Tout appel à `contact.book` a une attente bornée (5 s).
- Retire l'entrée temporaire `partnerships` de la liste blanche de `tests/legacy-labels.test.mjs` : plus aucun libellé hérité n'est toléré.
- Nouveaux tests : `tests/partnerships-migration.test.mjs` (cas sûrs / douteux, Contacts absent, trop ancien, muet, arrêt en cours de route, rejeu, 50 liens, reprise après une fusion 1.x) et `tests/partnerships-privacy.test.mjs`, contre `fakeContactBook`.

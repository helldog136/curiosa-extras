# Partenariats — module communautaire de Curiosa

Le suivi **privé** de vos partenariats : marques démarchées, statut (à contacter → envoyé → en discussion →
accepté → publié…), chances, relances dues, journal daté, contacts. Porté du suivi de prospection de
un site existant. **Aucune page publique** : rien de ce module n'apparaît sur votre site.

- **Admin** : panneau complet dans la page de l'instance (fiches, journal, contacts) — `adminPanel` + `adminActions`.
- **Lien avec les autres modules** : fournit le sujet `partnership.partner` ; le module *Sponsors* s'en sert pour
  lier un sponsor à sa fiche partenaire.
- **MCP** : `partners_list`, `partner_get`, `partner_create` (statut « à contacter » ou « en discussion » seulement),
  `partner_update`, `partner_log`, `contacts_list`, `contact_create` (créé « à vérifier »), `contact_update`.
  `partner_delete` et `contact_delete` existent mais sont **désactivées par défaut** : à accorder à la main, jeton par jeton (admin → API & MCP). Les modifications faites par un assistant sont attribuées à son jeton (`agent:<jeton>`).
- **Réglage avancé** : nombre de jours sans nouvelle avant qu'une relance soit due (14).

Un seul exemplaire par site (`instances: single`). Les données sont dans le stockage privé de l'instance.

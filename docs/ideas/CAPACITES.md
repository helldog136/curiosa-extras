# Revue de capacités : avant de construire un module

Ce document est à la fois **un processus** (15 minutes, avant d'écrire un module) et **un registre** (une ligne par demande faite au
cœur de Curiosa). Il remplace les remarques éparses « limite du cœur » dispersées dans `docs/ideas/*.md` et `docs/changelog-parts/`.

Public : les personnes qui développent des modules. Le ton est technique ; les textes que verra un visiteur du site, eux, restent en
mots simples, en français et en anglais.

## 1. Le processus

À faire **avant** de construire un module, dans la section « Revue de capacités » de son `docs/ideas/<module>.md`.

1. **Ce que le module doit faire**, en une phrase d'utilisatrice (« je veux que mes visiteurs puissent… »).
2. **Lister les besoins** et, pour chacun, répondre *Existe* (citer la ligne de `PLATFORM.md` ou `MODULES.md` du cœur) / *Existe avec
   une limite* (citer la limite) / *Manque* :
   - données et réglages ; page publique ; routes ; sections et emplacements ;
   - **permission** (le module en a-t-il besoin d'une nouvelle ?) ;
   - **sujet lu par le cœur** (nouveau champ de `social.link`, `feed.item`, `core.entry` ?) ;
   - **champ de manifeste** (clé nouvelle de `module.json`, type de champ de réglage) ;
   - **en-tête ou capacité du navigateur** (géolocalisation, caméra, `Permissions-Policy`…) ;
   - fichiers ; réseau sortant (quels hôtes) ; secrets ; e-mail ;
   - sujets échangés avec d'autres modules (nouveau sujet : registre `docs/TOPICS.md`, **pas** le cœur) ;
   - interface d'administration ; outils MCP pour l'assistant ; rôles et droits.
3. **Pour chaque « Manque » ou « limite »**, appliquer la frontière du § 2 :
   - frontière de confiance (§ 2, condition 1, 2 ou 3) → **demande au cœur**. Écrire : le contrat minimal (3 lignes), la ligne de
     modèle de menace (que peut faire un module bogué ou malveillant avec cette capacité ?), **qui d'autre pourrait s'en servir**
     (au moins un module existant ou prévu) et si elle peut attendre le prochain lot ;
   - vocabulaire, calcul, contenu, appel à une API tierce → **dans le module**, jamais dans le cœur ;
   - ni l'un ni l'autre → **simplifier la fonction** (y renoncer, comme le module de témoignages l'a fait pour la photo du visiteur) et
     noter la friction dans le registre (§ 4).
4. **Critère d'arrêt.** Si la revue conclut « manque dans le cœur » pour un besoin **sans** frontière de confiance, la capacité est
   mal posée : chercher d'abord à l'offrir comme **service d'un autre module** (modèle des connecteurs : un module détient la clé
   d'une plateforme et la rend aux autres par un service).
5. **Un lot par version du cœur.** Regrouper les besoins « demande au cœur » de tous les modules en préparation en **UN lot**, qui
   devient **une seule version du cœur**. Ne pas publier une version par module ni par attribut.
6. **Ordre de travail : le cœur d'abord.**
   1. la capacité est fusionnée dans le cœur (branche `dev`) et testée ;
   2. le cœur est **publié** (étiquette `vX.Y.Z`) ;
   3. seulement ensuite les modules qui en dépendent sont publiés, avec `minCore` = la version du lot ; la CI de ce dépôt teste les
      modules contre le dernier cœur **publié** (le cœur `dev` n'y figure qu'à titre d'information), donc un module qui exige une
      capacité non publiée ne passe pas : c'est voulu.
   Fini le « module publié, capacité le lendemain ».
7. **Ne relever `minCore` que pour un besoin technique** (une permission que l'ancien cœur refuserait, un champ de manifeste sans
   lequel le module est faux). Un champ facultatif ignoré par un ancien cœur ne justifie pas de relèvement.
8. **Rythme.** Les demandes s'accumulent dans le registre (§ 4) ; on publie **un lot de cœur par jour au plus**, sauf faille de
   sécurité, qui part seule et tout de suite (ne jamais la mêler à un lot de fonctions).

## 2. La frontière : ce qui reste dans le cœur

Une chose reste dans le cœur si **au moins une** de ces trois conditions est vraie :

1. **Frontière de confiance.** Un module bogué ou malveillant qui disposerait de cette capacité pourrait lire ou écrire hors de son
   périmètre, atteindre un secret, changer ce que le navigateur autorise, effacer le fichier d'un autre, contacter une adresse
   interne, ou usurper une identité (visiteur, personne connectée).
2. **Règle commune identique pour tous.** Anti-abus, adresse de confiance du visiteur, limites de débit, délais, sauvegarde, journal
   d'audit, droits.
3. **Le cœur doit lire la valeur pour décider quelque chose de sensible.** Il possède alors le **schéma** et les listes fermées, le
   module garde les **valeurs** (exemple : `social.link`).

Ce qui est **vocabulaire** (noms de plateformes, jeux, sujets entre modules, textes, contenus, calculs métier, appels à des API
tierces) va dans un module ou dans un registre tenu avec les modules.

Reste donc au cœur : en-têtes de sécurité ; envoi, signature et suppression des fichiers ; secrets ; réseau sortant borné ;
empreinte et adresse de confiance du visiteur ; e-mail ; rôles et droits ; installation, mise à jour, retour arrière ;
sauvegarde et restauration ; MCP (octroi action par action, audit) ; scripts de page servis par le cœur ; formulaires
d'administration rendus par le cœur ; vie privée ; plan du site et `llms.txt` ; liens courts, santé du site, menu ; valeurs permises
de `rel`, `referrerPolicy`, `target`.

## 3. À ne pas faire

- Un **système de composants d'administration** fournis par les modules : casse la frontière de confiance et le principe « aucun
  JavaScript de module dans l'administration ».
- Laisser un module déclarer ses propres **en-têtes de sécurité**, directives de `Permissions-Policy`, CSP, ou valeurs libres de
  `rel` / `referrerPolicy`.
- Rendre les capacités sensibles « déclaratives et ouvertes » pour économiser quelques lignes par permission : l'économie est
  dérisoire, le risque ne l'est pas.
- Laisser un module **écrire ses propres réglages** : les contournements actuels (valeurs de départ, migrations) sont propres.
- **Fichiers envoyés par les visiteurs** sans demande ferme : risque élevé, effort élevé.
- Remettre dans des modules les fonctions du **site entier** (liens courts, santé du site, menu).
- **Fusionner un correctif de sécurité** avec un lot de fonctions.
- **Supprimer `minCore`** pour « simplifier » : il évite de casser des sites.
- **Rendre le cœur « plus générique » dans l'abstrait**, sans demande d'un module réel.
- Ouvrir une route sur un chemin réservé (`/go`, `/admin`, `/api`), tourner en tâche de fond sans passer par le planificateur,
  recevoir une adresse IP, s'installer ou se mettre à jour sans passer par le catalogue et ses contrôles.
- Inscrire un sujet entre modules dans la documentation du cœur : il va dans `docs/TOPICS.md` de ce dépôt.

## 4. Registre des demandes au cœur

Une ligne par demande : *demandée* / *planifiée dans le lot X* / *faite en version Y* / *refusée parce que…*. Les lignes du début
reprennent l'audit de généricité d'octobre 2026.

| Demande | Module à l'origine | État | Note |
|---|---|---|---|
| Attributs de lien des boutons de réseau (`rel`, `referrerPolicy`, `target`) | `platform-links` | faite (cœur 0.2.13) | Listes fermées, champs facultatifs. Règle d'évolution : `docs/MODULES.md` du cœur |
| Fichiers : revendiquer et supprimer ce qu'envoie l'administration (`ctx.api.files`) | galerie | faite (cœur 0.2.13) | Pour les visiteurs : refusée pour l'instant (§ 3) |
| Présence d'une page décidée par autre chose que l'adresse | pages | faite | |
| Registre des sujets hors du cœur | tous | faite (lot « contrat et hygiène ») | `docs/TOPICS.md` ; le cœur ne documente que les sujets qu'il lit |
| Métadonnées de page : `noindex`, plan du site, segment variable de route | pages | planifiée (lot « pages et rangement ») | |
| Rangement dans l'administration déduit du manifeste (clé `family`) | tous | planifiée (lot « pages et rangement ») | |
| Table de capacités du navigateur (géolocalisation, caméra…) | carte | en attente d'une 2e demande | Aujourd'hui une permission nommée par capacité |
| Choix multiple dans les réglages | plusieurs | en attente d'une 2e demande | |
| Service de jaquettes de jeux hors du cœur (module) | jeux | planifiée | À faire à la prochaine évolution du module concerné |
| Un module qui écrit ses propres réglages | plusieurs | refusée | § 3 |

Ajouter une ligne dès qu'une revue (§ 1) conclut « demande au cœur », la mettre à jour à chaque étape, ne jamais la supprimer.

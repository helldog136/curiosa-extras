## Réseaux sociaux : une adresse à coller, reconnue comme elle vient

*Les 20 modules de réseau social demandent « L'adresse de votre profil » et reconnaissent ce que l'on colle vraiment : le nom seul, l'adresse sans https ou sans www, `@nom@serveur`, les adresses courtes. Le module Annonces Discord est allégé. Pour Curiosa 0.6.0 ou plus. Modules touchés : les 20 réseaux, Annonces Discord 1.2.0.*

### Nouveautés

- **Une seule question, la même partout : « Adresse de votre profil ».** Sous le champ : « Collez le lien de votre page. » et un exemple concret (« Par exemple : https://www.instagram.com/monpseudo »). Le mot « identifiant » et le « (sans @) » disparaissent des 20 modules.
- **Ce que l'on colle vraiment est reconnu.** Le nom seul (avec ou sans @), `instagram.com/monpseudo` sans https, avec ou sans `www.`, les adresses courtes (`fb.me`, `t.me`, `discord.gg`), `@nom@mastodon.social`, `u/pseudo` et `r/communaute` pour Reddit, `monnom.bandcamp.com`, un numéro de profil Steam. Les paramètres de suivi (`igsh`, `utm_…`, `fbclid`, `s`, `t`…) sont retirés. L'ancienne adresse `twitter.com` devient `x.com`.
- **Un seul bouton par compte, quelle que soit la saisie.** Que vous tapiez `monpseudo` ou que vous colliez l'adresse, le bouton s'appelle « Instagram · monpseudo » et mène à la même adresse : le doublon est écarté. Le bouton de X s'appelle « X » (plus « X (Twitter) »).
- **Mastodon** vérifie que l'adresse est celle d'un profil (`/@nom`) : un lien quelconque n'est plus accepté. **Bandcamp** accepte le simple nom. **Facebook** reconnaît `fb.me`.
- **Discord** : le lien d'invitation séparé est replié sous « Plus d'options » ; le profil accepte déjà une invitation.
- **Annonces Discord est allégé.** Deux champs visibles (l'adresse d'envoi et « Annoncer aussi mes directs YouTube ») ; la mention, l'icône et le choix « en même temps » sont repliés sous « Plus d'options », le texte de l'annonce passe en mode avancé. Le mot « webhook » disparaît des textes (« adresse d'envoi du salon »), les délais disent leur unité et leurs bornes, les erreurs disent quoi faire.
- Avec le cœur 0.6.0, les messages d'erreur du compte (Bluesky, GitHub…) renvoient à « l'adresse de votre profil ».

### Pour les développeurs

- **Une seule table pour les 20 réseaux** : `scripts/social-networks.mjs` (hôtes, modèle d'adresse, formes reconnues, exemple, icône). `node scripts/gen-social.mjs` écrit le bloc `profile()` de chaque `index.mjs` (le fichier entier pour les 15 réseaux sans statistiques), le réglage `profile`, la description et la ligne « Réglage » du README ; `--check` vérifie qu'aucun fichier n'a été modifié à la main.
- **`tests/social-generated.test.mjs`** : anti-copie (une seule `profile()` par module, identique à celle de la table), textes communs, 40 collages réels. `profile()` renvoie maintenant `{ url, handle, tag }` ; `handle` garde son sens pour les statistiques.
- `minCore` passe à 0.6.0 pour ces modules (`example` et `rare` sont des clés du cœur 0.6.0). Aucune donnée ne change : les adresses déjà saisies marchent toujours.
- Le kit d'ergonomie est recopié depuis le cœur 0.6.0 (`tests/helpers/ergonomics.mjs`) ; la base des écarts passe de 1185 à 1108 (les 21 modules à 0).
- Versions : 20 réseaux +0.1.0 (1.1.0 ; 1.2.0 pour Bluesky, Discord, GitHub, Mastodon, Reddit), Annonces Discord 1.2.0.

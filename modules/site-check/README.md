# Santé du site

**Votre site est-il en bon état ?** Ce module répond en un clic, avec des phrases simples : « Tout va bien », ou « Quelques petites choses à regarder ».

## À quoi ça sert

Personne ne relit son site image par image. Santé du site le fait pour vous et vous dit, par exemple :

- « 3 images n'ont pas de description » (important pour les personnes malvoyantes) ;
- « 2 pages n'ont pas de description pour les moteurs de recherche » (le petit texte sous le titre dans Google) ;
- « Le lien vers ‹ Ma boutique › ne répond plus » ;
- « 1 page ne semble pas traduite en anglais » ;
- des titres vides ou en double, des liens vers une de vos pages qui n'existe plus.

Chaque remarque a un bouton **Corriger** qui ouvre directement le bon écran. Les remarques sont regroupées et classées : **Important**, **Conseillé**, **Pour info**. Il n'y a ni note, ni pourcentage : si tout va bien, le module vous le dit.

## Comment l'utiliser

1. Ouvrez **Santé du site** dans le menu d'administration.
2. Appuyez sur **Vérifier maintenant**. Cela prend quelques secondes.
3. Lisez le résumé. Pour chaque remarque, appuyez sur **Corriger** (vous arrivez au bon écran) ou sur **Ignorer** si c'est voulu : elle disparaît, et un bouton **Tout réafficher** la ramène.
4. Si vous avez beaucoup de liens vers d'autres sites, la vérification se fait **par petits groupes** : une barre montre l'avancement, et le bouton **Continuer la vérification** traite le groupe suivant. Vous pouvez quitter la page et revenir.
5. Le tableau **Les 5 dernières vérifications** montre si votre site s'améliore.

Aucun réglage n'est nécessaire. Dans les réglages, vous pouvez seulement éteindre la visite des liens vers d'autres sites ; en mode avancé, limiter le nombre de liens regardés ou indiquer des sites à ne jamais visiter.

## Ce que le module fait avec les liens vers d'autres sites

- Il ne le fait **que lorsque vous appuyez sur le bouton**. Jamais en arrière-plan, jamais la nuit.
- Il visite **un site à la fois**, doucement, avec une pause entre chaque visite, et regarde seulement si la page répond (il ne la télécharge pas).
- Il regarde **200 liens au plus** par vérification (au plus 25 vers le même site). Au-delà, la vérification suivante reprend là où la précédente s'est arrêtée.
- Si un site répond « trop de demandes », il n'insiste pas.
- Il ne visite **jamais** une adresse interne ou privée (votre réseau local, votre ordinateur, une adresse faite de chiffres, un port inhabituel) : il ne peut donc pas servir à sonder un réseau ni à attaquer un autre site.
- Les adresses sans le « s » de https sont vérifiées en version sécurisée ; si le site ne la propose pas, le module dit qu'il ne peut pas conclure.
- Certains sites (réseaux sociaux, boutiques) refusent les visites automatiques : le module le dit simplement (« pour info ») au lieu de crier au lien cassé.

## Ce qu'il ne fait pas (et il vous le dit)

Le module ne lit que ce que le site lui montre de façon propre : vos pages et articles publiés, les réglages publics du site et les boutons des réseaux sociaux. Il **ne peut pas** :

- voir si le **menu** est vide (il vous dirige vers l'écran du menu) ;
- lire les titres et descriptions des pages créées par d'autres extensions (accueil, contact, planning…) ;
- vérifier que les images et fichiers importés sur votre site existent encore ;
- tout regarder au-delà de 200 entrées par rubrique.

Cette liste est affichée en bas de la page, **« Ce que je n'ai pas pu regarder »**, pour ne jamais vous laisser croire qu'on a tout vu. Le module **ne modifie rien** sur votre site.

## Vie privée

Le module ne collecte rien sur vos visiteurs. Ses résultats (la dernière vérification, les 5 précédentes et les remarques masquées) restent sur votre site. Quand vous lancez une vérification, le serveur de votre site visite brièvement les adresses de vos liens, comme le ferait un visiteur : ces sites ne reçoivent ni votre nom ni celui de vos visiteurs.

## Pour les développeurs

- Données lues : `ctx.api.instances.list`, `ctx.api.entries.list` (200 entrées au plus par rubrique et par langue), `ctx.api.site`, `ctx.api.brand`, et le sujet `social.link`. Rien n'est lu dans la base.
- Visites : `ctx.api.net.request` uniquement (HEAD, puis GET limité à 2 Ko si besoin), redirections suivies à la main (5 au plus), chaque étape repasse par les mêmes règles de sécurité (`probe.mjs`).
- Assistants IA : `site_health_status` (lecture seule) et `site_health_run` (lance ou continue une vérification).

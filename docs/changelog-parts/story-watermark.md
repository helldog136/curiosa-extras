## Story d'annonce 2.2 : la mention « Made with Curiosa » (au choix)

*Une case à cocher pour signer vos vidéos. Pour Curiosa 0.2.2 ou plus. Module touché : Story d'annonce 2.2.0.*

### Améliorations

- **Une case à cocher : « Ajouter la mention “Made with Curiosa” en bas de la vidéo ».** Elle est **décochée au départ** : rien n'est ajouté à vos vidéos sans que vous le choisissiez. Cochée, un petit texte discret apparaît **au centre, en bas**, sur une pastille aux couleurs de votre fond, lisible sur fond clair comme sombre. Il est placé juste au-dessus de la zone que recouvre Instagram, donc visible en story, et il reste là du début à la fin de la vidéo, sans bouger.
- **Vous le voyez avant de fabriquer la vidéo** : l'aperçu montre la mention dès que vous cochez la case.
- **Votre choix est retenu** pour vos prochaines stories : cochée une fois, elle le reste jusqu'à ce que vous la décochiez. Un modèle enregistré ne la garde pas.
- **Votre assistant** peut la demander (ou non) quand il prépare une vidéo ; sans consigne, il suit votre choix. Les anciens outils et liens continuent de marcher.
- La mention est écrite en anglais, quelle que soit la langue de la vidéo : c'est un nom de marque. Elle ne contient aucun lien et rien n'est envoyé nulle part. La génération de la vidéo ne dure pas plus longtemps.
- Un réglage facultatif (mode avancé) « Ajouter la mention par défaut » donne la valeur de départ de la case.

### Pour les développeurs

- **Story d'annonce 2.2.0** : `createScene({ watermark: true })` réserve 82 px au bas de la zone sûre et dessine la mention en dernier à chaque image (aucune dépendance au temps, donc aucune animation, « mouvement réduit » compris). Texte `WATERMARK_TEXT` dans `pure.mjs` (non traduit), police de la vidéo, 30 px, couleur du texte et de la pastille calculées à partir des couleurs de fond du style (contraste ≥ 4,5:1, pastille ajustée pour les gris moyens). `scene.watermark` décrit la mention (position, couleur, contraste) ou vaut `null`.
- `config.watermark` : booléen, **faux** par défaut (seul `true` l'active) ; gardé dans les préparations, jamais dans les modèles (`story_models` inchangé, `story_models` MCP sans nouveau champ).
- **Le cœur ne permet pas à un module d'écrire ses propres réglages** : le choix de la case est gardé dans `story_prefs` (un document `{ watermark }`, écrit par `act` `prefs.watermark`), et le réglage `watermark` (booléen, avancé, faux) n'est que la valeur de départ tant qu'aucun choix n'a été fait. Route `data` : `defaults.watermark`.
- **MCP `story_prepare`** : paramètre facultatif `watermark` (booléen ; autre type refusé) ; défaut = choix retenu ; la réponse ajoute `prepared.watermark`. Rien d'autre ne change.
- `minCore` inchangé (0.2.2), pas de migration (`dataVersion` 2), texte de vie privée mis à jour (≤ 500 caractères).
- Tests : `stream-story-watermark` (case décochée, choix retenu, MCP, dessin demandé ou non sur toutes les images, place, contraste, parité FR/EN, éditeur) ; trois tests de `stream-story` mis à jour (version, liste des réglages, champ `watermark`).
- Conflits probables avec une version qui touche aussi *Story d'annonce* : `modules/stream-story/module.json` (version, un réglage en fin de `settings`, un paramètre en fin de `story_prepare`, texte `privacy`), `locales/fr.json` et `en.json` (deux clés ajoutées en fin de fichier), `README.md`, `scenes.mjs` (début de `createScene`) et `tests/stream-story.test.mjs`.

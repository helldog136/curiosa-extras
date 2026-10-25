## Galeries photos 1.1.0 : supprimer une photo ou un album efface vraiment les fichiers

*Pour Curiosa 0.2.13 ou plus.*

### Améliorations
- **« Supprimer cette photo » efface ses fichiers du disque** (la photo et sa miniature), et « Supprimer cet album » efface ceux de toutes ses photos et de sa couverture. La place est rendue et les fichiers ne partent plus dans les prochaines sauvegardes. À l'écran, le module dit ce qui a été effacé.
- **« Masquer » reste un simple masquage** : rien n'est effacé, vous pouvez réafficher la photo.
- **Les anciennes photos** (envoyées avant la mise à jour du site) se suppriment sans erreur, mais leur fichier d'origine reste sur le disque : le module le dit honnêtement, sur la fiche de la photo et après la suppression.
- **Si l'envoi d'une photo est refusé** (envoyée il y a plus de 30 minutes, déjà utilisée, envoyée par une autre personne, place du module épuisée…), la page d'envoi l'écrit en mots simples sous la photo concernée, et rien n'est enregistré à moitié.
- La déclaration de vie privée dit que les fichiers sont supprimés du serveur avec la photo ou l'album. Le module demande la permission « Garder et supprimer les fichiers que vous envoyez via ce module ».

### Pour les développeurs
- `minCore` 0.2.13, permission `files`, version 1.1.0. `addUploadedPhoto` revendique l'original et la miniature (`ctx.api.files.claim`) avant d'écrire ; un refus renvoie `{ ok: false, error: "file", reason }` (neuf motifs, une phrase FR+EN chacun) et rend ce qui était déjà revendiqué. Un fichier déjà revendiqué (`already`) est un doublon, jamais supprimé.
- `deletePhoto` et `deleteAlbum` retirent d'abord les données, puis appellent `dropFiles` (`owns` puis `remove`, lots de 8, ni minuteur ni boucle de fond) et rendent `files: { removed, legacy, failed }`. Un fichier non revendiqué (ancienne photo) est compté `legacy`, sans erreur.
- Tests : `gallery-files` (fakeCtx avec `uploads`, `ctx.dumpFiles()`, chaque motif de refus, anciennes photos, lots, masquage) et un test de mise à jour à chaud dans `gallery-update`. Aide `addLegacyPhoto` dans `tests/helpers/galleryKit.mjs`.

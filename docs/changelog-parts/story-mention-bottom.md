## Stream Story: the "Made with Curiosa" mention moves to the very bottom of the video / Story : la mention « Made with Curiosa » passe tout en bas de la vidéo

*EN: for videos made with the mention ticked. Module touched: Stream Story.*
*FR : pour les vidéos faites avec la mention cochée. Module touché : Story.*

### What changes for you / Ce qui change pour vous

- **EN: The mention sits at the very bottom of the picture,** 60 px from the edge, centred, instead of just above the zone that Instagram covers. In the vertical format that zone can now hide it on a phone; the 4:5 format was already there and looks the same.
- **FR : la mention est tout en bas de l'image,** à 60 px du bord, centrée, au lieu d'être juste au-dessus de la zone que recouvre Instagram. En format vertical, cette zone peut maintenant la cacher sur un téléphone ; le format 4:5 y était déjà et ne change pas.
- **EN: The content gets its room back** in the vertical format, because it no longer has to leave space for the mention.
- **FR : le contenu retrouve sa place** en format vertical, car il n'a plus à laisser de la place à la mention.

### For developers

- `scenes.mjs`: the mention is placed from the frame edge (`WM.edge`), the content area only shrinks if the two would meet. No data, setting or route change.

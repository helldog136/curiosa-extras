// Galeries photos : la liste des albums et un album (grille). Les « photos » sont des illustrations dessinées : aucune photo réelle.
import { ctxFor, makeAlbum, def } from "../../helpers/galleryKit.mjs";

export default async function scenes({ siteFrame, blocksHtml, art }) {
  const ctx = ctxFor();
  const albums = [
    { title: "Rencontre de printemps", n: 9, date: "2026-04-18", desc: "Notre première rencontre en vrai : ateliers, rires et gâteaux." },
    { title: "Coulisses du studio", n: 6, date: "2026-06-02", desc: "" },
    { title: "Soirée d'anniversaire de la chaîne", n: 8, date: "2026-09-12", desc: "" },
  ];
  const made = [];
  for (const a of albums) made.push(await makeAlbum(ctx, a));
  // Chaque adresse /uploads/… devient une illustration (couleurs choisies d'après l'ordre d'apparition : toujours les mêmes).
  const seen = new Map();
  const shapes = ["circles", "waves", "blocks"];
  const paint = (html) => html.replace(/\/uploads\/([0-9a-f-]{36})\.jpg(\?[^"' )]*)?/g, (m, id) => {
    if (!seen.has(id)) { const i = seen.size; seen.set(id, art((i * 47 + 200) % 360, (i * 47 + 270) % 360, { w: 800, hgt: 600, shape: shapes[i % 3] })); }
    return seen.get(id);
  });
  const nav = ["Accueil", "Galeries", "Agenda", "Contact"];
  const frame = (p) => paint(siteFrame({ title: p.title, nav, current: "Galeries", body: blocksHtml(p.blocks) }));
  const list = await def.page(ctx, { segments: [] });
  const one = await def.page(ctx, { segments: [made[0].album.slug] });
  return {
    "albums.webp": { html: frame(list), h: 640 },
    "album.webp": { html: frame(one), h: 900 },
  };
}

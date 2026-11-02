// Annuaire : la vitrine publique (membres, filtre par catégorie, recherche). Personnes et noms inventés, avatars dessinés.
import { makeWorld, publish, reset, def, htmlOf, page } from "../../helpers/directory-world.mjs";
import { fakeContactBook } from "../../helpers/fakeContactBook.mjs";

export default async function scenes({ siteFrame, blocksHtml, art }) {
  reset();
  const book = fakeContactBook();
  const artists = book.seedCategory("Artistes");
  const partners = book.seedCategory("Partenaires");
  const names = { [artists]: ["Comète", "Nénuphar", "Brindille", "Lucioles", "Pervenche", "Galet", "Mirabelle", "Origami"], [partners]: ["Atelier Aurore", "Café Bellevue", "Papeterie Lune", "Librairie du Pont"] };
  let n = 0;
  for (const [cat, list] of Object.entries(names)) for (const name of list) book.seedContact({ name, categoryIds: [cat], photo: `https://photos.example.org/avatar/${++n}.png` });
  const w = makeWorld({ book, settings: {} });
  await publish(w.ctx, [{ id: artists, label: "Artistes" }, { id: partners, label: "Partenaires" }]);
  const p = await page(w.ctx);
  const paint = (html) => html.replace(/https:\/\/photos\.example\.org\/avatar\/(\d+)\.png/g, (_, i) => art((Number(i) * 53) % 360, (Number(i) * 53 + 80) % 360, { w: 200, hgt: 200, shape: ["circles", "waves", "blocks"][Number(i) % 3] }));
  return { "page.webp": { html: paint(siteFrame({ title: p.title, nav: ["Accueil", "Annuaire", "Agenda", "Contact"], current: "Annuaire", body: blocksHtml(p.blocks) })), h: 855 } };
}

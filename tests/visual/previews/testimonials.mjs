// Témoignages : la page publique des avis validés (notes, mots des personnes). Avis et pseudos inventés.
import { ctxFor, seed, page } from "../../helpers/testimonials.mjs";

export default async function scenes({ siteFrame, blocksHtml }) {
  const ctx = ctxFor({ locale: "fr", settings: {} });
  const DAY = 86_400_000, now = Date.now();
  const list = [
    ["Pixel", "Une ambiance chaleureuse du début à la fin. J'ai découvert la chaîne par hasard et je ne suis plus parti.", 5, true],
    ["Tulipe", "Des directs qui font du bien, et une communauté qui accueille tout le monde.", 5, false],
    ["Marmotte", "Les ateliers du week-end m'ont appris plus en une soirée qu'en un mois tout seul.", 5, false],
    ["Galet", "Très bons conseils, expliqués simplement. Merci pour votre patience.", 4, false],
    ["Mirabelle", "J'adore les soirées spéciales : on rit beaucoup et on apprend quelque chose à chaque fois.", 5, false],
    ["Ficelle", "Un petit coin d'internet où l'on se sent bien.", 5, false],
  ];
  for (const [i, [name, text, rating, featured]] of list.entries()) await seed(ctx, { name, text, rating, featured, at: now - (i + 2) * DAY });
  const p = await page(ctx);
  return { "page.webp": { html: siteFrame({ title: p.title, nav: ["Accueil", "Avis", "Planning", "Contact"], current: "Avis", body: blocksHtml(p.blocks) }), h: 780 } };
}

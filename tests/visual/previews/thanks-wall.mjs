// Mur des remerciements : la page publique (une personne à l'honneur et des cartes). Personnes inventées (pseudos génériques), avatars dessinés.
import { makeWorld, reset, D, P, def, htmlOf } from "../../helpers/thanks-wall-world.mjs";
import { fakeContactBook } from "../../helpers/fakeContactBook.mjs";

export default async function scenes({ siteFrame, art, esc }) {
  reset();
  const book = fakeContactBook();
  const mods = book.seedCategory("Modération");
  const supporters = book.seedCategory("Soutiens");
  const nicks = {
    mods: ["Comète", "Nénuphar", "Lucioles", "Brindille"],
    sup: ["Pixel", "Tulipe", "Marmotte", "Cerf-volant", "Pervenche", "Galet", "Mirabelle", "Sapin", "Origami", "Ficelle"],
  };
  const photo = (i) => `https://photos.example.org/avatar/${i}.png`;
  let n = 0;
  const add = (name, cat, msg) => { const { id } = book.seedContact({ name, categoryIds: [cat], photo: photo(++n) }); return { id, msg }; };
  const m = nicks.mods.map((x) => add(x, mods));
  const s = nicks.sup.map((x) => add(x, supporters));
  const { ctx } = makeWorld({ book, settings: { category: mods, groupTitle: "Merci à l'équipe de modération", category2: supporters, groupTitle2: "Merci à celles et ceux qui soutiennent la chaîne", title: "Merci !", intro: "Cette communauté existe grâce à vous. Merci d'être là, soir après soir." } });
  const now = P.monthKey();
  await D.setHonor(ctx, { month: now, contactId: s[0].id, why: { fr: "Toujours là dans le chat, avec un mot gentil pour chaque personne qui arrive.", en: "Always in the chat, with a kind word for everyone who arrives." } });
  await D.setMessage(ctx, m[0].id, { fr: "Gardienne du chat" });
  await D.setMessage(ctx, m[1].id, { fr: "Toujours le premier arrivé" });
  await D.setMessage(ctx, s[1].id, { fr: "Des dessins pour chaque direct" });
  await D.setMessage(ctx, s[2].id, { fr: "Le rire le plus communicatif" });
  const page = await def.page(ctx, { segments: [] });
  const paint = (html) => html.replace(/https:\/\/photos\.example\.org\/avatar\/(\d+)\.png/g, (_, i) => art((Number(i) * 53) % 360, (Number(i) * 53 + 80) % 360, { w: 200, hgt: 200, shape: ["circles", "waves", "blocks"][Number(i) % 3] }));
  const body = (page.blocks ?? []).map((b) => b.type === "html" ? `<div>${b.html}</div>` : b.type === "markdown" ? `<p class="leading-relaxed">${esc(b.text)}</p>` : "").join("");
  return { "page.webp": { html: paint(siteFrame({ title: page.title, nav: ["Accueil", "Merci", "Agenda", "Contact"], current: "Merci", body })), h: 1000 } };
}

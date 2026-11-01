// Jeu du jour : la page du quiz du jour (une question, des réponses). Question inventée.
import { ctxFor, addQuestion, def } from "../../helpers/dailyGameKit.mjs";

export default async function scenes({ siteFrame, blocksHtml }) {
  const ctx = ctxFor({ timezone: "Europe/Paris" });
  await addQuestion(ctx, { q: "Quelle couleur obtient-on en mélangeant du bleu et du jaune ?", a: ["Le vert", "L'orange", "Le violet", "Le gris"], correct: 0, e: "Le bleu et le jaune donnent du vert : c'est la base de la peinture." });
  const page = await def.page(ctx, { segments: [] });
  return { "page.webp": { html: siteFrame({ title: page.title, nav: ["Accueil", "Quiz du jour", "Planning", "Contact"], current: "Quiz du jour", body: blocksHtml(page.blocks) }), h: 740 } };
}

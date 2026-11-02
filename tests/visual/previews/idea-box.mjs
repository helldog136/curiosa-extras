// Boîte à idées : la page du public (proposer, rechercher, soutenir), l'écran de relecture et l'écran d'une idée. Idées, pseudos et réponses inventés.
import fs from "node:fs";
import { ctxFor, seed, def, htmlOf, DIR } from "../../helpers/ideaBox.mjs";

export default async function scenes({ siteFrame, adminFrame }) {
  const ctx = ctxFor({ intro: "Dites-nous ce que vous aimeriez voir ici. Nous lisons tout." });
  ctx.instance = { ...(ctx.instance ?? {}), id: "ib1", basePath: "idees" };
  // [texte, pseudo, état, statut, soutiens, réponse]
  const ideas = [
    ["Un stream de cuisine le dimanche, avec une recette choisie par le public", "Lune", "published", "planned", 42, "Merci, on y pense : premier essai en novembre."],
    ["Des sous-titres sur toutes les vidéos", "Galet", "published", "done", 31, "C'est fait, merci d'avoir proposé."],
    ["Une soirée jeux de société en direct", "Pixel", "published", "studied", 24, "On regarde comment l'organiser."],
    ["Un résumé écrit après chaque direct", null, "published", "proposed", 17, ""],
    ["Un quiz entre amis le vendredi soir", "Tulipe", "published", "proposed", 9, ""],
    ["Une chaîne de nuit pour les couche-tard", "Marmotte", "published", "dismissed", 4, "Pas prévu pour l'instant."],
    ["Un coin lecture avec des livres choisis par le public", "Ficelle", "pending", "proposed", 0, ""],
    ["Plus de musique calme pendant les pauses", null, "pending", "proposed", 0, ""],
    ["Un direct de dessin avec des demandes du public", "Mirabelle", "pending", "proposed", 0, ""],
    ["Un direct de dessin avec les demandes du public", "Cerise", "pending", "proposed", 0, ""],
  ];
  const ids = [];
  for (const [text, nick, state, status, votes, reply] of ideas) {
    const id = await seed(ctx, { text, nick, state, status, votes, reply: reply || null });
    ids.push(id);
  }
  const { html } = { html: htmlOf((await def.page(ctx, { segments: [] })).blocks) };
  const script = fs.readFileSync(`${DIR}/scripts/idea-box.js`, "utf8");
  const publicBody = `<p class="leading-relaxed">Dites-nous ce que vous aimeriez voir ici. Nous lisons tout.</p>${html}`;
  const adminCtx = ctxFor({});
  adminCtx.instance = { ...(adminCtx.instance ?? {}), id: "ib1", basePath: "idees" };
  for (const [text, nick, state, status, votes, reply] of ideas) await seed(adminCtx, { text, nick, state, status, votes, reply: reply || null });
  const tabs = [["use", "Idées"], ["settings", "Réglages"], ["general", "Général"]];
  const listBlocks = await def.adminPanel(adminCtx, { query: {} });
  const [editId] = (await adminCtx.api.store.list("ideas", { limit: 100 })).filter((r) => r.data.text.startsWith("Un stream de cuisine")).map((r) => r.id);
  const editBlocks = await def.adminPanel(adminCtx, { query: { edit: editId } });
  return {
    "page.webp": { html: siteFrame({ title: "Boîte à idées", nav: ["Accueil", "Idées", "Planning", "Contact"], current: "Idées", body: publicBody }), scripts: [script], h: 1400 },
    "moderation.webp": { html: adminFrame({ title: "Boîte à idées", icon: "💡", tabs, tab: "use", blocks: listBlocks }), h: 800 },
    "reponse.webp": { html: adminFrame({ title: "Boîte à idées", icon: "💡", tabs, tab: "use", blocks: editBlocks }), h: 640 },
  };
}

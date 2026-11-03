// Jaquettes de jeux — module de Curiosa. LE seul module qui va chercher des jaquettes au nom du site. Il cherche la jaquette d'un titre dans une chaîne de sources (RAWG, puis les jaquettes de boîte de Twitch
// par le Connecteur Twitch, puis le magasin Steam : aucune clé obligatoire), garde les corrections « Quel est le bon jeu ? » de la propriétaire, COPIE l'image choisie sur le site (vie privée : le public ne contacte
// jamais ces services) et rend le service `game.cover` (version 1) aux autres modules (Planning, Story d'annonce, Suggestions de jeux…), qui demandent « la jaquette de ce titre » sans jamais voir de clé.
//   match.mjs   ressemblance des titres (fonctions pures) ;   hosts.mjs  sources, hôtes et chemins d'images permis (fonctions pures) ;   breaker.mjs  disjoncteur d'une source ;
//   fixes.mjs   corrections, journal « à vérifier », petits documents ;   rawg.mjs  clé, requête RAWG, cache ;   sources.mjs  RAWG / Twitch / Steam derrière la même interface ;
//   chain.mjs   l'ordre des sources et le choix de la réponse ;   copies.mjs  copie locale des images et route publique ;   ops.mjs  opérations communes (écran, service, assistant) ;
//   service.mjs le service game.cover ;   panel.mjs l'administration ;   mcp.mjs les outils de l'assistant.
const q = new URL(import.meta.url).search;
const service = await import(new URL("./service.mjs" + q, import.meta.url).href);
const panel = await import(new URL("./panel.mjs" + q, import.meta.url).href);
const mcp = await import(new URL("./mcp.mjs" + q, import.meta.url).href);
const copies = await import(new URL("./copies.mjs" + q, import.meta.url).href);

export default {
  services: { "game.cover": service.methods },
  // La jaquette copiée sur le site, servie par le site lui-même : `/m/<clé>/cover/<repère>` (16 caractères, aucune adresse venue de la personne qui visite, ni cookie, ni paramètre).
  routes: { "cover/:id": (request, ctx) => copies.response(request, ctx) },
  adminPanel: (ctx, args) => panel.render(ctx, args),
  adminActions: panel.actions,
  mcp: mcp.tools,
};

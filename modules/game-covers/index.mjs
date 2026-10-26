// Jaquettes de jeux — module de Curiosa. LE seul module qui parle à RAWG (une base de données de jeux vidéo) au nom du site : il détient la clé d'API (réglage secret, jamais réaffiché),
// cherche la jaquette d'un titre, garde les corrections « Quel est le bon jeu ? » de la propriétaire, et rend le service `game.cover` (version 1) aux autres modules
// (Planning, Story d'annonce, Suggestions de jeux…), qui demandent « la jaquette de ce titre » sans jamais voir la clé.
//   match.mjs   ressemblance des titres (fonctions pures) ;   fixes.mjs  corrections, journal « à vérifier », petits documents ;
//   rawg.mjs    clé, requête (client réseau borné du cœur), cache, choix du jeu ;   ops.mjs  opérations communes (écran, service, assistant) ;
//   service.mjs le service game.cover ;   panel.mjs l'administration ;   mcp.mjs les deux outils de l'assistant.
const q = new URL(import.meta.url).search;
const service = await import(new URL("./service.mjs" + q, import.meta.url).href);
const panel = await import(new URL("./panel.mjs" + q, import.meta.url).href);
const mcp = await import(new URL("./mcp.mjs" + q, import.meta.url).href);

export default {
  services: { "game.cover": service.methods },
  adminPanel: (ctx, args) => panel.render(ctx, args),
  adminActions: panel.actions,
  mcp: mcp.tools,
};

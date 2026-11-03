// Boîte à idées — module de Curiosa.
//
// Le public propose des idées (un champ, un bouton), voit la liste des idées retenues avec leur statut et soutient celles qu'il aime.
// Par défaut, toute idée arrive EN ATTENTE : la personne propriétaire la publie, la refuse ou la fusionne avec un doublon (les soutiens s'additionnent).
// Aucune donnée personnelle gardée au-delà d'un pseudo facultatif ; pas d'e-mail ; pas de service externe ; pas de minuteur (le ménage des idées refusées se fait quand on écrit).
//
// Fichiers : lib.mjs (outils, lecture) · ops.mjs (gestes de la personne propriétaire, partagés avec l'assistant) · routes.mjs (proposer, soutenir) · view.mjs (page publique)
//           admin.mjs (tableau, écran d'une idée, fusion, tableau de bord) · mcp.mjs (assistant IA) · scripts/idea-box.js (recherche en direct de la page publique)

// Chaque fichier voisin est importé AVEC la version du fichier principal : sinon une mise à jour à chaud garderait l'ancien (voir docs/HOT-UPDATE.md).
const v = new URL(import.meta.url).search;
const { forgetInstance, loadAll } = await import(`./lib.mjs${v}`);
const { adminActions, adminPanel, dashboard } = await import(`./admin.mjs${v}`);
const { mcp } = await import(`./mcp.mjs${v}`);
const { routes } = await import(`./routes.mjs${v}`);
const { renderPage } = await import(`./view.mjs${v}`);

const SORTS = { recent: "recent" };

const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };

export default {
  // PAGE PUBLIQUE : /idees (les plus soutenues) · /idees/recent (les plus récentes). Tout autre chemin est une 404.
  async page(ctx, { segments }) {
    if (segments.length > 1 || (segments.length === 1 && !SORTS[segments[0]])) return { notFound: true, blocks: [] };
    const { html } = await renderPage(ctx, segments[0] ? SORTS[segments[0]] : "top");
    const blocks = [];
    const intro = ctx.setting("intro");
    if (intro) blocks.push({ type: "markdown", text: String(intro) });   // écrit par la personne propriétaire : le Markdown est permis
    blocks.push({ type: "html", html });
    return { title: ctx.setting("title") || ctx.t("pageTitle"), description: ctx.t("pageDescription"), blocks, scripts: ["idea-box.js"] };
  },

  routes,
  adminPanel,
  adminActions,
  dashboard,
  mcp,

  backup: {
    async readable(ctx) {
      const ideas = await loadAll(ctx);
      const head = ["id", "date", "state", "status", "supports", "idea", "nickname", "reply"].map(csvCell).join(",");
      const lines = ideas.map((i) => [i.id, new Date(i.at).toISOString(), i.state, i.status, i.votes, i.text, i.nick, i.reply].map(csvCell).join(","));
      return [{ path: "ideas.csv", content: `\ufeff${[head, ...lines].join("\r\n")}\r\n` }];
    },
  },

  hooks: {
    async onInstanceDelete(ctx) { forgetInstance(ctx.instance.key); },
  },
};

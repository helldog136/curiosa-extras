// Boîte à idées — les outils de l'assistant IA : lire les idées, changer un statut (avec une réponse courte), publier ou refuser.
// Mêmes gestes que l'administration (ops.mjs) ; l'acteur écrit au journal est déduit par le cœur. Rien n'est supprimé par l'assistant.
const v = new URL(import.meta.url).search;   // chaque fichier voisin est importé avec la version du module (voir index.mjs)
const { STATUSES, isStatus, loadAll, num } = await import(`./lib.mjs${v}`);
const { saveIdea, setState } = await import(`./ops.mjs${v}`);

const expose = (message) => Object.assign(new Error(message), { expose: true });

export const mcp = {
  async idea_box_list(ctx, args) {
    const want = args?.filter;
    const list = (await loadAll(ctx))
      .filter((i) => !want || want === "all" || i.state === want || (i.state === "published" && i.status === want))
      .sort((a, b) => b.at - a.at)
      .slice(0, num(args?.limit, 30, 1, 100));
    return list.map((i) => ({ id: i.id, idea: i.text, nickname: i.nick || null, state: i.state, status: i.status, supports: i.votes, reply: i.reply || null, receivedAt: new Date(i.at).toISOString() }));
  },
  async idea_box_set_status(ctx, args) {
    if (!isStatus(args?.status)) throw expose(`status must be one of: ${STATUSES.join(", ")}`);
    const r = await saveIdea(ctx, args.id, { status: args.status, ...(args.reply !== undefined ? { reply: args.reply } : {}) });
    if (r.error) throw expose("idea not found");
    if (r.errors) throw expose("the reply is too long (280 characters at most)");
    return { id: r.idea.id, status: r.idea.status, reply: r.idea.reply || null };
  },
  async idea_box_moderate(ctx, args) {
    const state = { publish: "published", hide: "hidden", refuse: "refused" }[args?.decision];
    if (!state) throw expose("decision must be publish, hide or refuse");
    const r = await setState(ctx, args.id, state);
    if (r.error) throw expose("idea not found");
    return { id: r.idea.id, state };
  },
};

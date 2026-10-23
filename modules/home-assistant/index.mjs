// Home Assistant — module de Curiosa : un pont sûr entre les points de chaîne Twitch et la maison.
//
// Ce que fait ce module, et rien d'autre : tenir la file des actions que les viewers ont déclenchées, vérifier qu'elles ont le droit de partir (coupe-circuit, direct,
// modération du texte lu), les confier à Home Assistant quand il vient les chercher, et noter ce qui s'est passé. Home Assistant vient TOUJOURS chercher : rien n'est
// ouvert chez la propriétaire, et Home Assistant n'envoie jamais rien de sa maison (seulement son jeton, un curseur et un accusé en code).
// Ce qui appartient aux autres reste chez eux : les points de chaîne et les récompenses (Bot Twitch), le direct (Ma Chaîne Twitch, facultatif).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const B = await import(`./bridge.mjs${v}`);
const H = await import(`./http.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);

export default {
  routes: {
    pair: (request, ctx) => H.pair(request, ctx),
    pull: (request, ctx) => H.pull(request, ctx),
    ack: (request, ctx) => H.ack(request, ctx),
  },

  services: {
    "home-assistant.bridge": {
      enqueue: async (ctx, args) => {
        // `test: true` (et rien d'autre) : un essai de l'appelant (simulation) — marqué, jamais de points, possible hors direct mais jamais coupé ni sans appairage ; 30 par heure.
        const r = await B.enqueue(ctx, args, { test: args?.test === true });
        if (r.ok) return { ok: true, id: r.id };
        return { ok: false, reason: r.reason === "rate" ? "busy" : r.reason };   // le détail de la modération reste dans le journal ; « trop d'essais » se dit « busy »
      },
      status: (ctx) => B.status(ctx),
      stop: (ctx, args) => B.stop(ctx, args),
      start: (ctx, args) => B.start(ctx, args),
    },
  },

  exports: {
    "ha.result": async (ctx, opts) => B.resultItems(ctx, opts?.limit ?? 50),
    "ha.state": async (ctx) => [await B.stateItem(ctx)],
  },

  adminBadge: admin.badge,
  adminPanel: admin.panel,
  adminActions: admin.actions,
  mcp: tools,
};

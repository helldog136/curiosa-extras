// Bot Twitch — module de Curiosa : le site répond aux commandes (!planning, !jeu…) tapées dans le chat Twitch de la chaîne.
//
// Ce que fait ce module, et rien d'autre : écouter le chat (Twitch appelle une adresse du site à chaque message, il n'y a pas de connexion permanente), décider si une commande doit
// répondre (délais, rôles, direct en cours, arrêt d'urgence) et répondre. Ce qui appartient aux autres reste chez eux et se lit au moment de répondre :
//   - les jetons Twitch : Chaîne Twitch (service `twitch.api`, qui fait les appels sans jamais rendre un jeton) ;
//   - le direct et les followers : Chaîne Twitch (`twitch.live`, `social.stat`) ; le prochain stream : Planning (`planning.slot`) ;
//   - les fiches des partenaires : Sponsors (la commande de chaque partenaire se règle dans sa fiche : voir entry.mjs) ; les adresses des réseaux : les modules de réseaux (`social.link`).
// Seul Chaîne Twitch est indispensable ; Planning, Sponsors et les réseaux sont facultatifs : sans eux, la fonction correspondante est simplement absente et la page le dit.
// Les détails de Twitch (signature, abonnement, format des messages) sont tous dans eventsub.mjs.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const webhook = await import(`./webhook.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const entry = await import(`./entry.mjs${v}`);
const { default: tools } = await import(`./tools.mjs${v}`);
const { ensureListening, diagnose, twitch } = await import(`./listen.mjs${v}`);
const { settingsOf } = await import(`./settings.mjs${v}`);
const { tidy } = await import(`./commands.mjs${v}`);
const es = await import(`./eventsub.mjs${v}`);
const sources = await import(`./sources.mjs${v}`);
const st = await import(`./state.mjs${v}`);

export default {
  routes: {
    // L'adresse que Twitch appelle : /m/<clé>/webhook. Publique par nature ; seule une requête signée avec notre secret est acceptée.
    webhook: async (request, ctx) => (await webhook.handle(request, ctx)).response,
  },

  tasks: {
    // Twitch coupe un abonnement dont le site n'a pas répondu assez de fois : on vérifie qu'il existe et fonctionne, et on le recrée sinon.
    listen: { everyMinutes: 10, run: async (ctx) => { await ensureListening(ctx, settingsOf(ctx)); } },
    // Une fiche de partenaire supprimée, un réseau retiré : la commande est en pause, puis disparaît après deux semaines.
    tidy: {
      everyMinutes: 60,
      run: async (ctx) => {
        const [p, n] = await Promise.all([sources.partners(ctx), sources.networks(ctx)]);
        await tidy(ctx, { partners: p.ok ? new Set(p.items.map((x) => x.id)) : null, networks: n.ok ? new Set(n.items.map((x) => x.key)) : null });
      },
    },
  },

  async adminBadge(ctx) { const c = (await st.readState(ctx)).sub?.code; return c && !["listening", "pending"].includes(c) ? 1 : 0; },
  adminPanel: admin.panel,
  adminActions: admin.actions,
  // La commande d'un partenaire se règle dans SA fiche (section ajoutée à l'éditeur d'entrée de Sponsors par le cœur, seulement si le bot est installé).
  entryPanels: { "chat-command": entry.default },
  mcp: tools,

  hooks: {
    async onInstanceCreate(ctx) { try { await diagnose(ctx, settingsOf(ctx)); } catch { /* la page le dira */ } },
    // Instance supprimée : on retire notre abonnement chez Twitch et nos demandes d'autorisation (le cœur efface le reste).
    async onInstanceDelete(ctx) {
      try {
        const s = settingsOf(ctx);
        const d = await diagnose(ctx, { ...s, replyAs: s.replyAs }, { declare: false });
        const callback = `${String(ctx.api.siteUrl ?? "").replace(/\/+$/, "")}${es.webhookPath(ctx.instance.key)}`;
        if (d.main?.channel && d.main.userId) {
          const list = await twitch(ctx, d.main.channel, es.listRequest());
          const ours = list.ok ? (list.json?.data ?? []).filter((x) => x.transport?.callback === callback) : [];
          for (const x of ours) await twitch(ctx, d.main.channel, es.deleteRequest(x.id));
          for (const slot of ["main", "bot"]) await ctx.api.services.callAll("twitch.api", "wantScopes", { channel: d.main.channel, consumer: ctx.instance.key, slot, scopes: [] });
        }
      } catch { /* au pire, Twitch coupera l'abonnement tout seul */ }
    },
  },
};

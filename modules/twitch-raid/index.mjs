// Raid Twitch — module de Curiosa : la liste de vos chaînes partenaires, et un dock (pour OBS ou un onglet) qui montre lesquelles sont en direct, pour choisir qui raider.
//
// Ce que fait ce module, et rien d'autre : garder la liste de chaînes de la personne, et afficher celles qui sont en direct. Ce qui appartient aux autres reste chez eux :
//   - Twitch et ses jetons : Chaîne Twitch (service `twitch.api`, qui fait l'appel sans jamais rendre un jeton) ; ce module ne parle jamais à Twitch lui-même ;
//   - le raid lui-même : il n'est jamais lancé d'ici. Un clic copie la commande `/raid pseudo`, la personne la colle dans son chat.
// Le dock est une page à l'adresse secrète `/m/<clé>/dock?k=…` ; elle lit `/m/<clé>/live?k=…`. Sans le bon secret : rien (une phrase, aucune donnée).
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const dock = await import(`./dock.mjs${v}`);
const pure = await import(`./pure.mjs${v}`);

const onlyGet = (request) => (request.method === "GET" || request.method === "HEAD" ? null : new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }));
const keyOf = (request) => new URL(request.url).searchParams.get("k") ?? "";

export default {
  routes: {
    // La page du dock.
    async dock(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return dock.deniedPage(ctx);
      return dock.dockPage(ctx, { liveUrl: `/m/${ctx.instance.key}/live?k=${encodeURIComponent(keyOf(request))}` });
    },

    // Ce que la page du dock lit toutes les 45 secondes : { state: "ok", live: [...] } ou l'état qui explique pourquoi il n'y a rien.
    async live(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return Response.json({ state: "denied" }, { status: 403, headers: dock.jsonHeaders });
      const result = await live.liveNow(ctx, await data.readPartners(ctx), admin.settingsOf(ctx));
      return new Response(JSON.stringify({ ...result, now: Date.now() }), { headers: dock.jsonHeaders });
    },
  },

  adminPanel: admin.panel,
  adminActions: admin.actions,

  mcp: {
    // Lecture seule : qui est en direct parmi les partenaires, maintenant.
    async raid_partners_live(ctx) {
      const partners = await data.readPartners(ctx);
      const r = await live.liveNow(ctx, partners, admin.settingsOf(ctx));
      if (r.state === "ok") return { state: "ok", listed: r.listed, live: pure.sortPartners(r.live, "viewers_asc").map((x) => ({ channel: x.login, name: x.name, game: x.game, title: x.title, viewers: x.viewers, liveForMinutes: Math.max(0, Math.round((Date.now() - x.startedAt) / 60000)), raidCommand: pure.raidCommand(x.login) })) };
      return { state: r.state, ...(r.reason ? { reason: r.reason } : {}), listed: partners.length, live: [] };
    },
  },

  backup: {
    // Votre liste, lisible sans Curiosa.
    async readable(ctx) {
      const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
      const rows = await data.readPartners(ctx);
      return [{ path: "partners.csv", content: ["channel,name,note", ...rows.map((p) => [p.login, p.name, p.note].map(cell).join(","))].join("\r\n") }];
    },
  },

  hooks: {
    // Dès la création, l'adresse du dock existe : la page la montre tout de suite.
    async onInstanceCreate(ctx) { try { await data.dockSecret(ctx); } catch { /* elle sera créée à la première visite de la page */ } },
  },
};

// Raid Twitch — module de Curiosa : la liste de vos chaînes partenaires, et un dock (pour OBS ou un onglet) qui montre lesquelles sont en direct, pour choisir qui raider.
//
// Ce que fait ce module, et rien d'autre : afficher, parmi les chaînes de la liste de raid, celles qui sont en direct. Ce qui appartient aux autres reste chez eux :
//   - la liste (2.0) : les fiches d'une catégorie de Contacts (service `contact.book` v2, « Cible de raid » par défaut) ; ce module ne garde ni nom, ni pseudo, ni photo (voir source.mjs) ;
//   - Twitch et ses jetons : le Connecteur Twitch (service `twitch.api`, qui fait l'appel sans jamais rendre un jeton) ; ce module ne parle jamais à Twitch lui-même ;
//   - vos chaînes : Ma Chaîne Twitch (service `twitch.live`) ; le réglage « Chaîne Twitch à utiliser » est un choix parmi elles (voir channel.mjs) ;
//   - le raid lui-même : il n'est jamais lancé d'ici. Un clic copie la commande `/raid pseudo`, la personne la colle dans son chat.
// 2.2 : la « Sélection du moment » (moment.mjs : N membres en direct tirés au hasard, stables pendant une durée réglable) a son dock (`featured`, même clé secrète), sa page publique
// facultative (`page`, éteinte par défaut) et sa route publique `members`. Rien de tout cela ne change le dock ordinaire tant que la propriétaire ne le choisit pas.
// Le dock est une page à l'adresse secrète `/m/<clé>/dock?k=…` ; elle lit `/m/<clé>/live?k=…` (jusqu'à 500 chaînes : tous les membres en direct) ou, au-delà, demande
// `/m/<clé>/pick?k=…` à chaque clic sur « au hasard ». Sans le bon secret : rien (une phrase, aucune donnée). Le site n'interroge Twitch que lorsque quelqu'un regarde ou clique.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const data = await import(`./data.mjs${v}`);
const live = await import(`./live.mjs${v}`);
const admin = await import(`./admin.mjs${v}`);
const dock = await import(`./dock.mjs${v}`);
const pure = await import(`./pure.mjs${v}`);
const source = await import(`./source.mjs${v}`);
const migrate = await import(`./migrate.mjs${v}`);
const privacy = await import(`./privacy.mjs${v}`);
const search = await import(`./search.mjs${v}`);
const channel = await import(`./channel.mjs${v}`);
const moment = await import(`./moment.mjs${v}`);
const featured = await import(`./featured-dock.mjs${v}`);
const pub = await import(`./public.mjs${v}`);

const onlyGet = (request) => (request.method === "GET" || request.method === "HEAD" ? null : new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }));
const keyOf = (request) => new URL(request.url).searchParams.get("k") ?? "";
/** La liste de raid (lue dans Contacts) : { partners } ou, si Contacts n'a pas de liste à donner, l'état à dire ({ state: "not_ready", reason }). */
async function raidList(ctx) {
  const src = await source.targets(ctx);
  return src.state === "ok" ? { partners: src.partners } : { problem: { state: "not_ready", reason: src.problem } };
}

export default {
  routes: {
    // La page du dock.
    async dock(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return dock.deniedPage(ctx);
      const k = encodeURIComponent(keyOf(request));
      // 2.2 : si la propriétaire l'a choisi (réglage « Que montre le dock ordinaire ? »), la même adresse montre la sélection du moment. Par défaut : le dock d'avant, inchangé.
      if (ctx.setting("dockMode") === "selection") return featured.featuredPage(ctx, { dataUrl: `/m/${ctx.instance.key}/featured-data?k=${k}`, againUrl: `/m/${ctx.instance.key}/featured-again?k=${k}` });
      return dock.dockPage(ctx, { liveUrl: `/m/${ctx.instance.key}/live?k=${k}`, pickUrl: `/m/${ctx.instance.key}/pick?k=${k}` });
    },

    // 2.2 — LA SÉLECTION DU MOMENT. Le dock dédié (même clé secrète que le dock ordinaire), ce qu'il lit, « Tirer de nouveau », et la route publique de la page facultative.
    async featured(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return dock.deniedPage(ctx);
      const k = encodeURIComponent(keyOf(request));
      return featured.featuredPage(ctx, { dataUrl: `/m/${ctx.instance.key}/featured-data?k=${k}`, againUrl: `/m/${ctx.instance.key}/featured-again?k=${k}` });
    },
    async "featured-data"(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return Response.json({ state: "denied" }, { status: 403, headers: dock.jsonHeaders });
      return new Response(JSON.stringify(featured.dataPayload(await moment.momentNow(ctx))), { headers: dock.jsonHeaders });
    },
    async "featured-again"(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      if (!(await data.secretMatches(ctx, keyOf(request)))) return Response.json({ state: "denied" }, { status: 403, headers: dock.jsonHeaders });
      return new Response(JSON.stringify(featured.dataPayload(await moment.momentNow(ctx, { reroll: true }))), { headers: dock.jsonHeaders });
    },
    // La page publique lit celle-ci (pas de clé : elle ne donne que les membres de la sélection, et seulement si la page publique est allumée).
    async members(request, ctx) { return pub.membersRoute(request, ctx); },

    // Ce que la page du dock lit toutes les 45 secondes (plus de 500 chaînes : seulement { state: "ok", mode: "random" }, sans aucune demande à Twitch) : { state: "ok", live: [...] } ou l'état qui explique pourquoi il n'y a rien.
    async live(request, ctx) {
      const no = onlyGet(request); if (no) return no;
      if (!(await data.secretMatches(ctx, keyOf(request)))) return Response.json({ state: "denied" }, { status: 403, headers: dock.jsonHeaders });
      const list = await raidList(ctx);
      const result = list.problem ?? await live.liveNow(ctx, list.partners, admin.settingsOf(ctx));
      return new Response(JSON.stringify({ ...result, now: Date.now() }), { headers: dock.jsonHeaders });
    },

    // « Au hasard » (plus de 500 chaînes) : un clic = une recherche. POST seulement (une recherche n'est pas une simple lecture : un robot qui suit des liens n'en lance pas). Corps : { avoid?: pseudo précédent }.
    async pick(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      if (!(await data.secretMatches(ctx, keyOf(request)))) return Response.json({ state: "denied" }, { status: 403, headers: dock.jsonHeaders });
      let avoid = "";
      try { avoid = pure.normalizeLogin(String(JSON.parse((await request.text()).slice(0, 512))?.avoid ?? "")).login ?? ""; } catch { /* corps absent ou illisible : sans importance */ }
      const list = await raidList(ctx);
      const result = list.problem ?? await search.findRandom(ctx, list.partners, admin.settingsOf(ctx), { avoid });
      return new Response(JSON.stringify({ ...result, now: Date.now() }), { headers: dock.jsonHeaders });
    },
  },

  // Vie privée : Contacts demande ce que ce module sait d'une fiche (export), de l'oublier (effacement) ou de suivre une fusion. Voir privacy.mjs.
  services: {
    "privacy.subject": {
      export: (ctx, args) => privacy.subject.export(ctx, args),
      erase: (ctx, args) => privacy.subject.erase(ctx, args),
      remap: (ctx, args) => privacy.subject.remap(ctx, args),
    },
  },

  // 2.2 : la page publique facultative « En direct chez nos membres » (éteinte tant que le réglage « Afficher la page publique » n'est pas coché : elle répond alors comme une page qui n'existe pas).
  page: (ctx, { segments }) => pub.page(ctx, segments),

  adminPanel: admin.panel,
  adminActions: admin.actions,

  mcp: {
    // Lecture seule : qui est en direct parmi les partenaires, maintenant.
    async raid_partners_live(ctx) {
      const list = await raidList(ctx);
      if (list.problem) return { ...list.problem, listed: 0, live: [] };
      const partners = list.partners;
      const r = await live.liveNow(ctx, partners, admin.settingsOf(ctx));
      if (r.state === "ok" && r.mode === "random") {   // plus de 500 chaînes : un membre en direct tiré au hasard, pas la liste
        const f = await search.findRandom(ctx, partners, admin.settingsOf(ctx));
        const one = f.state === "found" ? [{ channel: f.pick.login, name: f.pick.name, game: f.pick.game, title: f.pick.title, viewers: f.pick.viewers, liveForMinutes: Math.max(0, Math.round((Date.now() - f.pick.startedAt) / 60000)), raidCommand: pure.raidCommand(f.pick.login) }] : [];
        if (f.state === "found" || f.state === "none") return { state: "ok", mode: "random", listed: r.listed, live: one };
        return { state: f.state === "limited" ? "error" : f.state, ...(f.state === "limited" ? { reason: "too_many_searches" } : f.reason ? { reason: f.reason } : {}), mode: "random", listed: partners.length, live: [] };
      }
      if (r.state === "ok") return { state: "ok", mode: "full", listed: r.listed, ...(r.partial ? { notChecked: r.partial } : {}), live: pure.sortPartners(r.live, "viewers_asc").map((x) => ({ channel: x.login, name: x.name, game: x.game, title: x.title, viewers: x.viewers, liveForMinutes: Math.max(0, Math.round((Date.now() - x.startedAt) / 60000)), raidCommand: pure.raidCommand(x.login) })) };
      return { state: r.state, ...(r.reason ? { reason: r.reason } : {}), listed: partners.length, live: [] };
    },

    // Lecture seule : la sélection du moment (les membres que montrent le dock de sélection et la page publique). Ne tire pas de nouveau.
    async raid_featured_now(ctx) {
      const r = await moment.momentNow(ctx);
      if (r.state !== "ok") return { state: r.state, ...(r.reason ? { reason: r.reason } : {}), live: [] };
      return { state: "ok", count: r.count, minutes: r.minutes, endsAt: new Date(r.endsAt).toISOString(), ...(r.stale ? { stale: new Date(r.stale).toISOString() } : {}), live: r.picks.map((x) => ({ channel: x.login, name: x.name, game: x.game, title: x.title, viewers: x.viewers, liveForMinutes: Math.max(0, Math.round((Date.now() - x.startedAt) / 60000)), raidCommand: pure.raidCommand(x.login) })) };
    },
  },

  // Données 2 : la chaîne tapée à la main (un pseudo) est notée, avec l'instance de Ma Chaîne Twitch qui l'a, pour le réglage devenu un choix (voir channel.mjs).
  // Données 3 (2.0) : l'ancienne liste propre au module part dans Contacts (fiches, et catégorie « Cible de raid » si elle existe). L'ancien document reste intact.
  // Rejouable, par lots reprenables, ne lève pas pour une panne de Contacts : voir migrate.mjs. À retirer en phase 3.
  migrations: {
    2: async (ctx) => { await channel.rememberTypedChannel(ctx); },
    3: async (ctx) => { await migrate.migrate3(ctx); },
  },

  hooks: {
    // Dès la création, l'adresse du dock existe : la page la montre tout de suite.
    async onInstanceCreate(ctx) { try { await data.dockSecret(ctx); } catch { /* elle sera créée à la première visite de la page */ } },
  },
};

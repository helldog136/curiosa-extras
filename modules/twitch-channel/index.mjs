// Chaîne Twitch — module communautaire de Curiosa. Porté de l'ancien site (Helix, client-credentials).
// C'est LE module qui connaît Twitch : identifiants, jeton, appels et caches sont ici (helix.mjs) et nulle part ailleurs.
// Il les met à disposition des autres modules : le SERVICE `twitch.live` (pour ceux qui en dépendent, comme « Statut live ») et les sujets
// `twitch.api` (parler à Twitch au nom de la chaîne SANS jamais rendre un jeton : voir access.mjs), les sujets
// `social.link` (bouton), `stream.live` (live en cours, vide sinon), `maze.poster` (derniers clips) et `social.stat` (followers, abonnés payants : demande la connexion du compte, voir connect.mjs).
// Sans identifiants valides, tout est vide plutôt qu'en erreur (sauf `social.stat`, qui dit pourquoi il n'a pas de chiffre).
// Le fichier voisin est importé avec la même « version » que celui-ci : après une mise à jour, jamais d'ancien helix.mjs resté en mémoire.
const helix = await import(new URL(`./helix.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const connect = await import(new URL(`./connect.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const live = await import(new URL(`./live.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const analytics = await import(new URL(`./analytics.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const access = await import(new URL(`./access.mjs${new URL(import.meta.url).search}`, import.meta.url).href);
const { LOGIN, hasCredentials, valid, liveStatus, recentClips } = helix;
export const { currentStream } = helix;
export { recentClips };

const ADOPTED = "adopted";
const BORROWED = "borrowed";
const FIELDS = ["channel", "clientId", "clientSecret"];
const text = (v) => String(v ?? "").trim();

/**
 * Chaque instance (une par chaîne) connaît ses propres identifiants ; elle ne peut ni lire les réglages ni le stockage d'une autre.
 * Pour que l'application Twitch d'un propriétaire serve plusieurs chaînes sans qu'il ressaisisse le secret, chaque instance dont les identifiants sont
 * complets les « prête » ici, EN MÉMOIRE SEULEMENT (jamais écrits, affichés ni renvoyés) ; une autre instance qui nomme cette chaîne dans son réglage
 * « Utiliser les identifiants d'une autre chaîne » les reprend (champs vides seulement) et en garde une copie dans SON stockage, pour qu'un redémarrage
 * ne dépende pas de l'ordre dans lequel les instances sont lues. Le module (donc cette mémoire) est partagé par toutes ses instances.
 */
const lent = new Map();   // clé d'instance → { channel, clientId, secret }
export const resetCache = () => { helix.resetCache(); connect.resetConnect(); lent.clear(); };

const firstDoc = async (ctx, collection) => { try { return (await ctx.api.store.list(collection, { limit: 1 }))[0] ?? null; } catch { return null; } };
/** Ce que « Statut live » (ancienne version) a fait reprendre : un seul document, jamais affiché. Les réglages saisis ici ont toujours le dessus. */
const adoptedDoc = (ctx) => firstDoc(ctx, ADOPTED);

/**
 * Identifiants de l'instance, champ par champ : le réglage saisi ici, sinon ceux de l'autre chaîne demandée, sinon la valeur reprise d'un autre module.
 * Renvoie { creds: { channel, clientId, secret }, share: null | { from, state } } ; state : "live" (prêtés à l'instant), "copy" (copie gardée), "none" (introuvables), "self".
 */
async function resolve(ctx) {
  const key = ctx.instance.key;
  const own = { channel: text(ctx.setting("channel")).toLowerCase(), clientId: text(ctx.setting("clientId")), secret: text(ctx.setting("clientSecret")) };
  const from = text(ctx.setting("useCredentialsOf")).toLowerCase();
  const wants = LOGIN.test(from);
  const complete = own.channel && own.clientId && own.secret;
  if (complete) { lent.set(key, own); return { creds: own, share: wants ? { from, state: from === own.channel ? "self" : "none" } : null }; }
  const a = (await adoptedDoc(ctx))?.data ?? {};
  const base = { channel: own.channel || text(a.channel).toLowerCase(), clientId: own.clientId || text(a.clientId), secret: own.secret || text(a.clientSecret) };
  if (base.channel && base.clientId && base.secret) lent.set(key, base); else lent.delete(key);
  if (!wants) return { creds: base, share: null };
  if (from === base.channel) return { creds: base, share: { from, state: "self" } };
  let b = null, state = "none";
  const donor = [...lent].find(([k, v]) => k !== key && v.channel === from)?.[1];
  const doc = await firstDoc(ctx, BORROWED);
  if (donor) {
    b = { clientId: donor.clientId, secret: donor.secret }; state = "live";
    const d = doc?.data ?? {};
    if (d.from !== from || d.clientId !== b.clientId || d.clientSecret !== b.secret) {
      try { const data = { from, clientId: b.clientId, clientSecret: b.secret }; if (doc) await ctx.api.store.update(doc.id, data); else await ctx.api.store.add(BORROWED, data); } catch { /* la copie est un plus */ }
    }
  } else if (doc?.data?.from === from) {
    b = { clientId: text(doc.data.clientId), secret: text(doc.data.clientSecret) }; state = "copy";
  }
  const creds = { channel: base.channel, clientId: own.clientId || b?.clientId || text(a.clientId), secret: own.secret || b?.secret || text(a.clientSecret) };
  return { creds, share: { from, state } };
}
const credentials = async (ctx) => (await resolve(ctx)).creds;
const urlOf = (channel) => (LOGIN.test(channel) ? `https://twitch.tv/${channel}` : null);
const missing = (c) => [!LOGIN.test(c.channel) && "channel", !c.clientId && "clientId", !c.secret && "clientSecret"].filter(Boolean);

/** Un identifiant reçu d'un autre module : texte court sans espace, sinon on l'ignore. */
const plain = (v) => (typeof v === "string" && /^\S{1,200}$/.test(v.trim()) ? v.trim() : "");

/** { creds, results: [{ metric, result }] } pour cette instance, ou null quand il n'y a rien à suivre (interrupteur éteint, chaîne non réglée). Les réponses viennent du cache de helix.mjs. */
async function statsOf(ctx) {
  if (ctx.setting("trackStats") !== true) return null;
  const creds = await credentials(ctx);
  if (!LOGIN.test(creds.channel)) return null;
  const conn = connect.liveConn(ctx, creds);
  return { creds, results: await Promise.all(connect.wantedMetrics(ctx).map(async (metric) => ({ metric, result: await helix.userStat(conn, metric) }))) };
}

const LIVE_METRICS = ["avg_viewers", "peak_viewers", "hours_streamed", "hours_watched", "followers_gained"];
/**
 * Les chiffres de PÉRIODE (30 jours glissants) tirés de l'enregistreur de directs : directs commencés dans les 30 derniers jours.
 * Entiers >= 0 ; les durées sont en MINUTES (hours_streamed, hours_watched : le nom est celui du contrat, l'unité est la minute, dite dans le libellé).
 */
async function liveItems(ctx, creds, results) {
  const d = await live.trackingState(ctx);
  if (!d.since) return [];   // pas encore de première mesure : rien à publier
  const { sessions } = await live.listSessions(ctx, { since: Date.now() - 30 * 86_400_000, limit: 400 });
  const fig = live.periodFigures(sessions);
  const folErr = results.find((r) => r.metric === "followers")?.result.error;
  const asOf = new Date(d.lastOkAt ?? d.since).toISOString();
  const wantsFollowers = ctx.setting("statsFollowers") !== false;
  return LIVE_METRICS.filter((m) => m !== "followers_gained" || wantsFollowers).map((metric) => {
    const error = metric === "followers_gained" && folErr && sessions.length && !fig.knownFollowers ? folErr : null;
    return { id: `twitch-channel:${ctx.instance.key}:${metric}`, platform: "twitch", account: creds.channel, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
      ...(error ? {} : { value: fig[metric] }), asOf, url: urlOf(creds.channel), ...(error ? { error } : {}) };
  });
}

export default {
  mcp: analytics.tools(credentials),
  /** L'enregistreur de directs : repasse chaque minute, mais ne mesure qu'à son rythme (2 minutes en direct, 4 hors direct) ; rien du tout si « Suivre mes statistiques » est décoché. */
  tasks: {
    "record-lives": {
      everyMinutes: 1,
      run: async (ctx) => {
        if (ctx.setting("trackStats") !== true) return;
        const creds = await credentials(ctx);
        await live.trackNow(ctx, creds, connect.liveConn(ctx, creds));
      },
    },
  },
  exports: {
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que la chaîne n'est pas réglée. */
    async "social.link"(ctx) {
      const { channel } = await credentials(ctx);
      return LOGIN.test(channel) ? [{ label: `Twitch · ${channel}`, url: urlOf(channel), icon: "twitch" }] : [];
    },
    async "stream.live"(ctx) {
      const c = await credentials(ctx);
      const s = await currentStream(c);
      return s ? [{ id: s.id, title: s.title, url: urlOf(c.channel), startedAt: s.startedAt, game: s.game ?? undefined }] : [];
    },
    /**
     * Les chiffres de la chaîne pour « social.stat » : followers et/ou abonnés payants, lus avec l'autorisation donnée par « Connecter ma chaîne Twitch ».
     * Une valeur n'est jamais inventée ni périmée : sans connexion, ou si Twitch refuse, l'élément porte `error` et pas de `value`.
     */
    async "social.stat"(ctx, args) {
      const found = await statsOf(ctx);
      if (!found) return [];
      const { creds, results } = found;
      const out = results.map(({ metric, result }) => ({
        id: `twitch-channel:${ctx.instance.key}:${metric}`, platform: "twitch", account: creds.channel, accountKey: ctx.instance.key, metric, label: ctx.t(`stat_${metric}`),
        ...(result.error ? {} : { value: result.value }), asOf: new Date(result.at ?? Date.now()).toISOString(), url: urlOf(creds.channel), ...(result.error ? { error: result.error } : {}),
      }));
      const all = [...out, ...(await liveItems(ctx, creds, results))];
      return Number.isInteger(args?.limit) && args.limit > 0 ? all.slice(0, args.limit) : all;
    },
    async "maze.poster"(ctx, { limit }) {
      return (await recentClips(await credentials(ctx))).slice(0, limit ?? 10).map((x) => ({ title: x.title, url: x.url, ...(x.image ? { image: x.image } : {}), kind: "clip" }));
    },
  },

  services: {
    "twitch.api": access.service(credentials),
    "twitch.live": {
      /** { channel, url, configured, ready, missing } — la chaîne de cette instance et si Twitch est utilisable ; ne fait aucun appel réseau. */
      async channel(ctx) {
        const c = await credentials(ctx);
        return { channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel), configured: hasCredentials(c), ready: valid(c), missing: missing(c) };
      },
      /**
       * L'état de la chaîne : { configured, known, live, channel, url, id, title, game, viewers, startedAt, thumbnail, error? }. Ne lève jamais.
       * `known` : Twitch a répondu (sinon `live` vaut false et `error` dit pourquoi : auth, rate, network, config).
       * args.channel : une autre chaîne, avec les identifiants de cette instance. Sans argument : SA chaîne (chaque instance répond pour elle-même, aucun « maître »).
       * args.legacy : { channel, clientId, clientSecret } d'un consommateur qui n'a pas encore été repris — utilisés SEULEMENT si cette instance n'a pas ses propres identifiants.
       */
      async status(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        let c = await credentials(ctx);
        if (!hasCredentials(c) && a.legacy && typeof a.legacy === "object") {
          c = { channel: c.channel || text(a.legacy.channel).toLowerCase(), clientId: plain(a.legacy.clientId), secret: plain(a.legacy.clientSecret) };
        }
        const other = text(a.channel).toLowerCase();
        if (LOGIN.test(other)) c = { ...c, channel: other };
        const base = { configured: hasCredentials(c), known: false, live: false, channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel) };
        const r = await liveStatus(c);
        if (r.error) return { ...base, error: r.error };
        const s = r.stream;
        return { ...base, known: true, live: !!s, ...(s ? { id: s.id, title: s.title, game: s.game, viewers: s.viewers, startedAt: s.startedAt, thumbnail: s.thumbnail, ...(s.displayName ? { displayName: s.displayName } : {}) } : {}) };
      },
      /**
       * Reprise des identifiants d'un autre module (« Statut live ») : chaque champ vide ICI est rempli, un champ déjà rempli (réglage ou reprise) n'est JAMAIS écrasé.
       * Renvoie { adopted: [champs repris], ready } — jamais une valeur. Idempotent. N'importe quel module qui déclare dépendre de ce service peut l'appeler.
       */
      async adopt(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const incoming = { channel: LOGIN.test(text(a.channel)) ? text(a.channel).toLowerCase() : "", clientId: plain(a.clientId), clientSecret: plain(a.clientSecret) };
        const doc = await adoptedDoc(ctx);
        const had = doc?.data ?? {};
        const next = { ...had };
        const adopted = [];
        for (const f of FIELDS) {
          if (text(ctx.setting(f)) || text(had[f]) || !incoming[f]) continue;
          next[f] = incoming[f];
          adopted.push(f);
        }
        if (adopted.length) {
          if (doc) await ctx.api.store.update(doc.id, next);
          else await ctx.api.store.add(ADOPTED, next);
        }
        return { adopted, ready: valid(await credentials(ctx)) };
      },
    },
  },

  // Retour de Twitch après « Connecter ma chaîne Twitch » : /m/<clé>/oauth/callback (voir connect.mjs pour tout ce qui le protège).
  routes: {
    "oauth/callback": (request, ctx) => connect.callback(request, ctx, credentials),
  },

  async adminPanel(ctx) {
    const base = await sharePanel(ctx);
    const tracking = ctx.setting("trackStats") === true;
    // La connexion de la chaîne sert aux statistiques ET aux modules qui demandent d'autres autorisations (le Bot Twitch : lire et écrire dans le chat).
    if (!tracking && !(await connect.extraScopes(ctx, "main")).length) return base;
    const creds = await credentials(ctx);
    const results = tracking ? (await statsOf(ctx))?.results ?? [] : [];
    const connection = await connect.panel(ctx, creds, async () => results);
    if (!tracking) return [...base, ...connection];
    const connected = !!results.find((r) => r.metric === "followers" && !r.result.error);
    return [...base, ...connection, ...(await analytics.panel(ctx, creds, connected))];
  },
  adminActions: {
    async forgetAdopted(ctx) {
      for (const c of [ADOPTED, BORROWED]) { const doc = await firstDoc(ctx, c); if (doc) await ctx.api.store.remove(doc.id); }
      return { ok: ctx.t("forgotten"), redirect: "?" };
    },
    disconnect: (ctx) => connect.disconnect(ctx),
    async eraseLive(ctx) { await live.eraseAll(ctx); return { ok: ctx.t("live_erased"), redirect: "?" }; },
  },
};

/** Indices visibles d'une reprise d'identifiants : jamais les valeurs. « Oublier » rend la main aux seuls réglages (retour en arrière). */
async function sharePanel(ctx) {
  const { share } = await resolve(ctx);
  const blocks = [];
  if (share) {
    const tone = share.state === "live" || share.state === "copy" ? "info" : "warning";
    blocks.push({ type: "banner", tone, text: ctx.t(`share_${share.state}`, { channel: share.from }) });
  }
  const a = (await adoptedDoc(ctx))?.data ?? {};
  const fields = FIELDS.filter((f) => text(a[f]));
  if (!fields.length) return blocks;
  return [
    ...blocks,
    { type: "banner", tone: "info", text: ctx.t("adoptedNote", { fields: fields.map((f) => ctx.t(`field_${f}`)).join(", ") }) },
    { type: "adminForm", action: "forgetAdopted", submitLabel: ctx.t("forget"), fields: [] },
  ];
}

// Ma Chaîne Twitch — module communautaire de Curiosa (identifiant technique `twitch-channel`, conservé : sauvegardes, adresses de retour, catalogue).
// Depuis la 2.0, ce module ne parle plus à Twitch lui-même et ne garde plus aucun identifiant ni autorisation : tout passe par le Connecteur Twitch
// (service `twitch.api`, exigé), qui possède l'application et les comptes connectés. Ce module garde SA chaîne, ses caches (helix.mjs), ses mesures (live.mjs).
// Il offre le service `twitch.live` (chaque instance répond pour sa chaîne) et fournit `social.link` (bouton), `stream.live` (live en cours), `maze.poster`
// (derniers clips) et `social.stat` (followers, abonnés payants, chiffres de vos directs). Sans Connecteur : bouton et lien seulement, et l'administration
// propose de l'installer (bloc `suggestInstall`, par service, jamais par nom de module).
// Le fichier voisin est importé avec la même « version » que celui-ci : après une mise à jour, jamais d'ancien fichier resté en mémoire.
const v = new URL(import.meta.url).search;
const helix = await import(new URL(`./helix.mjs${v}`, import.meta.url).href);
const connect = await import(new URL(`./connect.mjs${v}`, import.meta.url).href);
const live = await import(new URL(`./live.mjs${v}`, import.meta.url).href);
const analytics = await import(new URL(`./analytics.mjs${v}`, import.meta.url).href);
const hand = await import(new URL(`./handover.mjs${v}`, import.meta.url).href);
const { LOGIN, valid, liveStatus, recentClips } = helix;
export const { currentStream } = helix;
export { recentClips };

const text = (v2) => String(v2 ?? "").trim();
/** Un identifiant reçu d'un autre module : texte court sans espace, sinon on l'ignore. */
const plain = (x) => (typeof x === "string" && /^\S{1,200}$/.test(x.trim()) ? x.trim() : "");
const firstDoc = async (ctx, collection) => { try { return (await ctx.api.store.list(collection, { limit: 1 }))[0] ?? null; } catch { return null; } };

/** La chaîne de l'instance : le réglage, sinon celle reprise de « Statut live ». */
async function channelOf(ctx) {
  const own = text(ctx.setting("channel")).toLowerCase();
  if (own) return own;
  return text((await firstDoc(ctx, hand.ADOPTED))?.data?.channel).toLowerCase();
}

/**
 * La chaîne se fait connaître du Connecteur (une fois par processus) : elle devient une chaîne « connue » (choix par défaut des autres modules)
 * et, pour une installation d'avant la 2.0 dont l'adresse de retour est enregistrée chez Twitch, cette adresse sert à ses liens d'autorisation.
 */
const registered = new Map();   // id d'instance → "chaîne|relais"
async function register(ctx, channel) {
  if (!LOGIN.test(channel)) return;
  const relay = (await hand.stateOf(ctx))?.relay === true;
  const sig = `${channel}|${relay}`;
  if (registered.get(ctx.instance.id) === sig) return;
  const r = await connect.call(ctx, "register", { channel, ...(relay ? { redirectUri: connect.redirectOf(ctx) } : {}) });
  if (r.ok && r.value?.ok) { registered.set(ctx.instance.id, sig); if (registered.size > 200) registered.delete(registered.keys().next().value); }
}

/**
 * Le « client » que helix.mjs utilise : la chaîne et deux appels au Connecteur (bornés, ne lèvent jamais).
 * `wait: false` (sujets lus par d'autres modules, pages) : la chaîne se fait connaître en arrière-plan, sans retenir l'appelant.
 */
async function credentials(ctx, { wait = true } = {}) {
  const channel = await channelOf(ctx);
  if (LOGIN.test(channel)) { const p = register(ctx, channel).catch(() => {}); if (wait) await p; }
  return {
    channel,
    async call(req) {
      const r = await connect.call(ctx, "request", { ...req, channel });
      if (!r.ok) return { error: connect.missingConnector(r) ? "config" : "network" };
      const x = r.value && typeof r.value === "object" ? r.value : {};
      return x.ok ? { status: x.status, json: x.json } : { error: ["config", "auth", "rate", "network", "scope"].includes(x.error) ? x.error : "network" };
    },
    async account() {
      const r = await connect.call(ctx, "account", { channel, slot: "main" });
      return r.ok && r.value?.ok ? r.value : { error: !r.ok && connect.missingConnector(r) ? "config" : "network" };
    },
  };
}
const urlOf = (channel) => (LOGIN.test(channel) ? `https://twitch.tv/${channel}` : null);

/** L'application Twitch est-elle réglée dans le Connecteur ? { present, ready, missing } — sans appel réseau. */
async function connectorState(ctx) {
  const r = await connect.call(ctx, "status", {});
  if (!r.ok) return { present: !connect.missingConnector(r), ready: false, missing: ["clientId", "clientSecret"] };
  const missing = Array.isArray(r.value?.missing) ? r.value.missing.filter((f) => f === "clientId" || f === "clientSecret") : [];
  return { present: true, ready: r.value?.ready === true, missing };
}

/** { creds, results: [{ metric, result }] } pour cette instance, ou null quand il n'y a rien à suivre (interrupteur éteint, chaîne non réglée). Les réponses viennent du cache de helix.mjs. */
async function statsOf(ctx) {
  if (ctx.setting("trackStats") !== true) return null;
  const creds = await credentials(ctx);
  if (!LOGIN.test(creds.channel)) return null;
  return { creds, results: await Promise.all(connect.wantedMetrics(ctx).map(async (metric) => ({ metric, result: await helix.userStat(creds, metric) }))) };
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

/** Reprise silencieuse pour « Statut live » d'avant : ses identifiants vont au Connecteur s'il n'en a pas (une seule tentative par processus et par instance). */
const legacyTried = new Set();
async function adoptLegacy(ctx, legacy) {
  const clientId = plain(legacy?.clientId), clientSecret = plain(legacy?.clientSecret);
  if (!clientId || !clientSecret || legacyTried.has(ctx.instance.id)) return;
  legacyTried.add(ctx.instance.id);
  await connect.call(ctx, "adopt", { clientId, clientSecret });
}

export const resetCache = () => { helix.resetCache(); connect.resetConnect(); hand.resetHandover(); registered.clear(); legacyTried.clear(); };

export default {
  mcp: analytics.tools(credentials),
  /** L'enregistreur de directs : repasse chaque minute, mais ne mesure qu'à son rythme (2 minutes en direct, 4 hors direct) ; rien du tout si « Suivre mes statistiques » est décoché. */
  tasks: {
    "record-lives": {
      everyMinutes: 1,
      run: async (ctx) => {
        if (ctx.setting("trackStats") !== true) return;
        await hand.retry(ctx);
        if (!(await connectorState(ctx)).ready) return;   // pas d'application Twitch : rien à mesurer, rien n'est écrit
        const creds = await credentials(ctx);
        await live.trackNow(ctx, creds, creds);
      },
    },
  },
  exports: {
    /** Le bouton de la chaîne pour le cœur (en-tête) : rien tant que la chaîne n'est pas réglée. Aucun appel à Twitch. */
    async "social.link"(ctx) {
      const channel = await channelOf(ctx);
      return LOGIN.test(channel) ? [{ label: `Twitch · ${channel}`, url: urlOf(channel), icon: "twitch" }] : [];
    },
    async "stream.live"(ctx) {
      const c = await credentials(ctx, { wait: false });
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
    async "maze.poster"(ctx, { limit } = {}) {
      return (await recentClips(await credentials(ctx, { wait: false }))).slice(0, limit ?? 10).map((x) => ({ title: x.title, url: x.url, ...(x.image ? { image: x.image } : {}), kind: "clip" }));
    },
  },

  services: {
    "twitch.live": {
      /** { channel, url, configured, ready, missing } — la chaîne de cette instance et si Twitch est utilisable (application réglée dans le Connecteur) ; aucun appel réseau. */
      async channel(ctx) {
        const channel = await channelOf(ctx);
        const st = await connectorState(ctx);
        return { channel: LOGIN.test(channel) ? channel : null, url: urlOf(channel), configured: st.ready, ready: st.ready && LOGIN.test(channel), missing: [...(LOGIN.test(channel) ? [] : ["channel"]), ...st.missing] };
      },
      /**
       * L'état de la chaîne : { configured, known, live, channel, url, id, title, game, viewers, startedAt, thumbnail, displayName?, error? }. Ne lève jamais.
       * `known` : Twitch a répondu (sinon `live` vaut false et `error` dit pourquoi : auth, rate, network, config).
       * args.channel : une autre chaîne. Sans argument : SA chaîne (chaque instance répond pour elle-même, aucun « maître »).
       * args.legacy : { channel, clientId, clientSecret } d'un consommateur pas encore repris : la chaîne sert si l'instance n'en a pas, et les identifiants
       * sont confiés au Connecteur s'il n'a pas encore d'application (jamais d'écrasement : voir son `adopt`).
       */
      async status(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const c = await credentials(ctx);
        let st = await connectorState(ctx);
        if (!st.ready && a.legacy && typeof a.legacy === "object" && st.present) { await adoptLegacy(ctx, a.legacy); st = await connectorState(ctx); }
        if (!LOGIN.test(c.channel) && a.legacy && typeof a.legacy === "object" && LOGIN.test(text(a.legacy.channel))) c.channel = text(a.legacy.channel).toLowerCase();
        const other = text(a.channel).toLowerCase();
        if (LOGIN.test(other)) c.channel = other;
        const base = { configured: st.ready, known: false, live: false, channel: LOGIN.test(c.channel) ? c.channel : null, url: urlOf(c.channel) };
        if (!st.ready) return { ...base, error: "config" };
        const r = await liveStatus(c);
        if (r.error) return { ...base, error: r.error };
        const s = r.stream;
        return { ...base, known: true, live: !!s, ...(s ? { id: s.id, title: s.title, game: s.game, viewers: s.viewers, startedAt: s.startedAt, thumbnail: s.thumbnail, ...(s.displayName ? { displayName: s.displayName } : {}) } : {}) };
      },
      /**
       * Reprise des identifiants d'un autre module (« Statut live ») : la chaîne remplit celle de cette instance si elle est vide ; l'application va au
       * Connecteur Twitch, qui ne remplit que ses champs vides. Renvoie { adopted: [champs repris], ready } — jamais une valeur. Idempotent.
       */
      async adopt(ctx, args) {
        const a = args && typeof args === "object" ? args : {};
        const adopted = [];
        const channel = LOGIN.test(text(a.channel)) ? text(a.channel).toLowerCase() : "";
        const doc = await firstDoc(ctx, hand.ADOPTED);
        if (channel && !text(ctx.setting("channel")) && !text(doc?.data?.channel)) {
          if (doc) await ctx.api.store.update(doc.id, { ...doc.data, channel }); else await ctx.api.store.add(hand.ADOPTED, { channel });
          adopted.push("channel");
        }
        const clientId = plain(a.clientId), clientSecret = plain(a.clientSecret);
        if (clientId || clientSecret) {
          const r = await connect.call(ctx, "adopt", { clientId, clientSecret, channel: (await channelOf(ctx)) || undefined });
          if (r.ok && Array.isArray(r.value?.adopted)) for (const f of r.value.adopted) if (f === "clientId" || f === "clientSecret") adopted.push(f);
        }
        const now = await channelOf(ctx);
        return { adopted, ready: LOGIN.test(now) && valid({ channel: now, call: () => null }) && (await connectorState(ctx)).ready };
      },
    },
  },

  // Retour de Twitch pour une installation d'avant la 2.0 : /m/<clé>/oauth/callback, relayé au Connecteur (voir connect.mjs).
  routes: {
    [connect.CALLBACK]: (request, ctx) => connect.callback(request, ctx, channelOf),
  },

  // Passage au Connecteur (voir handover.mjs) : jamais d'échec pour « pas encore prêt » ; rejouable.
  migrations: {
    2: async (ctx) => { await hand.handover(ctx); },
  },

  hooks: {
    /** Une chaîne retirée n'est plus proposée par défaut aux autres modules (ses autorisations restent dans le Connecteur, qui les gère). */
    async onInstanceDelete(ctx) {
      const channel = await channelOf(ctx);
      if (LOGIN.test(channel)) await connect.call(ctx, "register", { channel, remove: true });
    },
  },

  async adminPanel(ctx) {
    const blocks = [];
    const st = await connectorState(ctx);
    if (!st.present) {
      // Sans Connecteur : bouton et lien seulement (aucun appel à Twitch) ; le cœur propose d'installer un module qui offre le service, s'il en existe un.
      return [
        { type: "banner", tone: "warning", text: ctx.t("noConnector") },
        { type: "suggestInstall", service: connect.SERVICE, min: 3, reason: ctx.t("suggestReason") },
        ...(await adoptedBlocks(ctx)),
      ];
    }
    const h = await hand.retry(ctx);
    if (h?.state === "conflict") blocks.push({ type: "banner", tone: "warning", text: ctx.t("handover_conflict") });
    else if (h?.state === "pending" && h.reason === "incomplete") blocks.push({ type: "banner", tone: "warning", text: ctx.t("handover_incomplete") });
    blocks.push(...(await adoptedBlocks(ctx)));
    const channel = await channelOf(ctx);
    if (!LOGIN.test(channel)) return blocks;
    await register(ctx, channel);
    const tracking = ctx.setting("trackStats") === true;
    const found = tracking ? await statsOf(ctx) : null;
    const results = found?.results ?? [];
    const connection = await connect.panel(ctx, channel, async () => results);
    if (!tracking) return [...blocks, ...connection];
    const connected = !!results.find((r) => r.metric === "followers" && !r.result.error);
    return [...blocks, ...connection, ...(await analytics.panel(ctx, found?.creds ?? (await credentials(ctx)), connected))];
  },
  adminActions: {
    async forgetAdopted(ctx) {
      const doc = await firstDoc(ctx, hand.ADOPTED);
      if (doc) await ctx.api.store.remove(doc.id);
      return { ok: ctx.t("forgotten"), redirect: "?" };
    },
    disconnect: async (ctx) => connect.disconnect(ctx, await channelOf(ctx)),
    async eraseLive(ctx) { await live.eraseAll(ctx); return { ok: ctx.t("live_erased"), redirect: "?" }; },
  },
};

/** Une chaîne reprise d'un autre module : signalée (jamais une valeur), « oublier » rend la main au seul réglage. */
async function adoptedBlocks(ctx) {
  const a = (await firstDoc(ctx, hand.ADOPTED))?.data ?? {};
  if (!text(a.channel) || text(ctx.setting("channel"))) return [];
  return [
    { type: "banner", tone: "info", text: ctx.t("adoptedNote", { fields: ctx.t("field_channel") }) },
    { type: "adminForm", action: "forgetAdopted", submitLabel: ctx.t("forget"), fields: [] },
  ];
}

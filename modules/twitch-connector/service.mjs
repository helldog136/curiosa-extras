// Le service `twitch.api` (version 3) : ce que le Connecteur met à disposition des autres modules pour parler à Twitch.
// Une seule instance, UNE application Twitch, N comptes connectés (chaque chaîne, et pour chacune un compte « bot » facultatif). Les jetons restent ICI.
// Sur-ensemble de la version 2 (offerte par « Chaîne Twitch » 1.7) : account, wantScopes, connectLink, disconnect, request gardent leurs formes ;
// s'ajoutent connections, exchangeCode, adopt, status, register et retire. Aucune méthode ne rend un jeton, un secret ni un code.
const version = new URL(import.meta.url).search;
const store = await import(new URL(`./store.mjs${version}`, import.meta.url).href);
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const conn = await import(new URL(`./connections.mjs${version}`, import.meta.url).href);
const oauth = await import(new URL(`./oauth.mjs${version}`, import.meta.url).href);
const { LOGIN, slotOf, loginOf, plain } = store;

const HOSTS = [helix.API_HOST, oauth.ID_HOST];
const wantedFor = async (ctx, channel, slot, extra = []) => [...new Set([...(await store.wantedScopes(ctx, channel, slot)), ...extra.filter((s) => store.EXTRA_SCOPES.includes(s))])].sort();

/** État de santé des hôtes de Twitch, vu par le client réseau du cœur (sans aucun appel). */
export async function health(ctx) {
  let list = [];
  try { list = await ctx.api.net.health(); } catch { list = []; }
  return (Array.isArray(list) ? list : []).filter((h) => HOSTS.includes(h?.host)).map((h) => ({ host: h.host, state: h.state, since: h.since, ...(h.retryAt ? { retryAt: h.retryAt } : {}) }));
}

export const methods = {
  /**
   * Où en est la connexion d'une chaîne ? { ok, channel, ready, https, status: "none" | "ok" | "reconnect" | "more", login, userId, scopes, wanted, connectedAt?, result?, adminPath }.
   * Sans `channel` : la première chaîne connue. `ready` : l'application Twitch (identifiant + secret) est réglée et la chaîne est valable. Aucun jeton.
   */
  async account(ctx, args) {
    const slot = slotOf(args?.slot);
    const channel = await store.channelFor(ctx, args?.channel);
    const creds = await store.credsOf(ctx);
    const wanted = await wantedFor(ctx, channel, slot);
    const doc = channel ? (await store.connOf(ctx, slot, channel))?.data ?? null : null;
    const result = channel ? await store.resultOf(ctx, channel, slot) : null;
    const redirect = await store.redirectFor(ctx, channel, conn.ownRedirect(ctx));
    return {
      ok: true, channel: LOGIN.test(channel) ? channel : null, ready: LOGIN.test(channel) && store.hasCreds(creds), https: conn.secure(redirect),
      status: conn.statusOf(doc, creds, wanted), login: doc?.login ?? null, userId: doc?.userId ?? null, scopes: doc?.scopes ?? [], wanted,
      ...(doc?.connectedAt ? { connectedAt: doc.connectedAt } : {}),
      ...(result ? { result: { code: result.code, ...(result.login ? { login: result.login } : {}) } } : {}),
      adminPath: conn.adminPage(ctx),
    };
  },

  /** Un module annonce les autorisations Twitch dont il a besoin pour une chaîne (liste fermée) ; `scopes: []` retire sa demande. */
  async wantScopes(ctx, args) {
    const channel = await store.channelFor(ctx, args?.channel);
    if (!channel) return { ok: false, error: "no_channel" };
    return store.serial(ctx, () => store.want(ctx, { channel, consumer: args?.consumer, slot: args?.slot, scopes: args?.scopes, returnTo: args?.returnTo }));
  },

  /**
   * L'adresse du bouton « Autoriser » de Twitch : { ok, url } ou { ok, url: null, reason: "connected" | "not_ready" | "https" | "nothing" }.
   * `scopes` (facultatif) s'ajoutent aux autorisations demandées ; `returnTo` : la page d'administration où revenir (vérifiée).
   * L'adresse de retour est celle que la chaîne utilisait déjà (installation reprise), sinon celle du Connecteur.
   */
  async connectLink(ctx, args) {
    const slot = slotOf(args?.slot);
    const channel = await store.channelFor(ctx, args?.channel);
    const creds = await store.credsOf(ctx);
    if (!channel) return { ok: true, url: null, reason: "not_ready" };
    const wanted = await wantedFor(ctx, channel, slot, Array.isArray(args?.scopes) ? args.scopes : []);
    const doc = (await store.connOf(ctx, slot, channel))?.data ?? null;
    if (conn.statusOf(doc, creds, wanted) === "ok") return { ok: true, url: null, reason: "connected" };
    const redirectUri = await store.redirectFor(ctx, channel, conn.ownRedirect(ctx));
    if (!conn.secure(redirectUri)) return { ok: true, url: null, reason: "https" };
    if (!store.hasCreds(creds)) return { ok: true, url: null, reason: "not_ready" };
    if (!wanted.length) return { ok: true, url: null, reason: "nothing" };
    const returnTo = typeof args?.returnTo === "string" && store.RETURN_TO.test(args.returnTo) ? args.returnTo : await store.returnPathOf(ctx, channel, slot);
    return { ok: true, url: await store.serial(ctx, () => conn.authorizeLink(ctx, creds, { channel, slot, scopes: wanted, returnTo, redirectUri })) };
  },

  /** Retire une connexion. `slot` doit être dit explicitement ("main" ou "bot"). { ok, reached }. */
  async disconnect(ctx, args) {
    if (args?.slot !== "bot" && args?.slot !== "main") return { ok: false, error: "forbidden" };
    const channel = await store.channelFor(ctx, args?.channel);
    if (!channel) return { ok: true, reached: true };
    const r = await store.serial(ctx, async () => conn.disconnect(ctx, await store.connOf(ctx, args.slot, channel)));
    return { ok: true, reached: r.reached === true };
  },

  /**
   * Un appel à Twitch : { as: "app" | "user", slot?, method, path, query?, body?, channel? }.
   * Rend { ok: true, status, json } (Twitch a répondu, même 4xx) ou { ok: false, error: "forbidden" | "invalid" | "config" | "auth" | "rate" | "network" | "scope" }.
   * `channel` choisit le compte connecté pour un appel « user » (sans lui : la première chaîne connue) ; il est sans effet pour un appel « app ».
   */
  async request(ctx, args) {
    const req = helix.check(args);
    if (req.error) return { ok: false, error: req.error };
    const priority = args?.priority === "background" ? "background" : "interactive";
    return helix.bounded((async () => {
      const creds = await store.credsOf(ctx);
      if (!store.hasCreds(creds)) return { error: "config" };
      if (req.as === "app") return helix.appCall(ctx, creds, req, priority);
      const channel = await store.channelFor(ctx, args?.channel);
      const doc = channel ? await store.connOf(ctx, slotOf(args?.slot), channel) : null;
      if (!doc) return { error: "auth" };
      return helix.userCall(ctx, creds, doc.id, req, priority);
    })()).then((r) => (r.error ? { ok: false, error: r.error } : { ok: true, status: r.status, json: r.json }));
  },

  /** Les comptes connectés : [{ id, login, displayName, slot, channel, scopes, status: "ok" | "expired" | "missing_scopes" }], sans jeton. */
  async connections(ctx) {
    const creds = await store.credsOf(ctx);
    const out = [];
    for (const d of await store.conns(ctx)) {
      const wanted = await store.wantedScopes(ctx, d.data.channel, d.data.slot);
      const st = conn.statusOf(d.data, creds, wanted);
      out.push({ id: d.id, login: d.data.login, displayName: d.data.login, slot: d.data.slot, channel: d.data.channel, scopes: [...(d.data.scopes ?? [])], status: st === "ok" ? "ok" : st === "more" ? "missing_scopes" : "expired" });
    }
    return out;
  },

  /**
   * Le retour de Twitch relayé par un autre module (installation reprise : l'adresse enregistrée chez Twitch est la sienne) :
   * { code, state, redirectUri, error? } → { ok: true, login, slot, returnTo? } | { ok: false, error: "state" | "expired" | "denied" | "network", returnTo? }.
   * `redirectUri` doit être EXACTEMENT celle de l'autorisation (l'état est lié à elle).
   */
  async exchangeCode(ctx, args) {
    const a = args && typeof args === "object" ? args : {};
    const r = await store.serial(ctx, () => conn.exchange(ctx, { code: a.code, state: a.state, redirectUri: typeof a.redirectUri === "string" ? a.redirectUri : "", error: typeof a.error === "string" ? a.error.slice(0, 60) : "" }), oauth.timing.sharedMs * 2).catch(() => ({ ok: false, error: "network" }));
    return r.ok ? { ok: true, login: r.login, slot: r.slot, ...(r.returnTo ? { returnTo: r.returnTo } : {}) } : { ok: false, error: r.error, ...(r.returnTo ? { returnTo: r.returnTo } : {}) };
  },

  /** Reprise de l'application et des connexions d'un autre module (voir connections.mjs). Ne rend jamais une valeur. */
  async adopt(ctx, args) {
    return store.serial(ctx, () => conn.adopt(ctx, args)).catch(() => ({ ok: false, error: "failed", adopted: [], ready: false }));
  },

  /** { ready, missing: ["clientId" | "clientSecret"], health } — sans aucun appel réseau. */
  async status(ctx) {
    const creds = await store.credsOf(ctx);
    return { ready: store.hasCreds(creds), missing: [!creds.clientId && "clientId", !creds.secret && "clientSecret"].filter(Boolean), health: await health(ctx) };
  },

  /**
   * Une chaîne se fait connaître (« Ma Chaîne Twitch ») : { channel, redirectUri?, remove? } → { ok }. `redirectUri` : son adresse de retour, quand
   * l'application Twitch la connaît déjà (installation reprise) ; elle sert alors aux liens d'autorisation de cette chaîne. Idempotent.
   */
  async register(ctx, args) {
    const channel = loginOf(args?.channel);
    if (!channel) return { ok: false, error: "invalid" };
    return store.serial(ctx, async () => {
      if (args?.remove === true) { for (const d of await store.channels(ctx)) if (d.data.channel === channel) await ctx.api.store.remove(d.id); return { ok: true }; }
      const redirect = args?.redirectUri === undefined ? undefined : conn.validRedirect(ctx, args.redirectUri) ? args.redirectUri : null;
      return { ok: await store.remember(ctx, channel, redirect) };
    });
  },

  /**
   * Révoque chez Twitch des jetons d'une AUTRE application (reprise impossible : la chaîne a été reconnectée avec l'application du Connecteur).
   * { clientId, tokens: [≤ 4] } → { revoked: nombre }. Les valeurs ne sont ni gardées ni rendues.
   */
  async retire(ctx, args) {
    const clientId = plain(args?.clientId);
    const tokens = (Array.isArray(args?.tokens) ? args.tokens : []).filter((t) => typeof t === "string" && /^\S{1,2000}$/.test(t)).slice(0, 4);
    if (!clientId || !tokens.length) return { revoked: 0 };
    const rs = await helix.bounded(Promise.all(tokens.map((token) => oauth.revoke(ctx.api.net, { clientId, token }))).then((x) => ({ x })));
    return { revoked: (rs.x ?? []).filter(Boolean).length };
  },
};

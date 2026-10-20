// Le service `twitch.api` : ce que Chaîne Twitch met à disposition d'un autre module (le Bot Twitch) pour parler à Twitch AU NOM de la chaîne.
// Principe : une donnée, un propriétaire. Les jetons (celui de la chaîne et, en option, celui d'un compte « bot ») restent ICI. Ils ne sortent jamais : l'autre module décrit l'appel
// qu'il veut, c'est ce module qui le fait avec le bon jeton et qui rend la réponse de Twitch. La liste des appels permis est fermée (ALLOWED) ; rien d'autre ne passe.
// Chaque instance (une par chaîne) répond pour sa propre chaîne : le service est « each ». Un appelant qui vise une chaîne passe `channel` ; les autres instances répondent « other_channel ».
const version = new URL(import.meta.url).search;
const helix = await import(new URL(`./helix.mjs${version}`, import.meta.url).href);
const connect = await import(new URL(`./connect.mjs${version}`, import.meta.url).href);

/** Les seuls appels permis, par type de jeton. `scopes` : ce que l'autorisation de l'utilisateur doit couvrir. */
export const ALLOWED = {
  app: new Set(["GET users", "GET streams", "GET eventsub/subscriptions", "POST eventsub/subscriptions", "DELETE eventsub/subscriptions"]),
  user: new Map([["POST chat/messages", ["user:write:chat"]]]),
};
const MAX_BODY = 10_000;
const text = (v) => String(v ?? "").trim();
const plainQuery = (q, maxList = 20) => {
  if (q === undefined) return {};
  if (!q || typeof q !== "object" || Array.isArray(q)) return null;
  const out = {};
  for (const [k, v] of Object.entries(q)) {
    if (!/^[a-z_]{1,30}$/.test(k)) return null;
    const list = [].concat(v);
    if (!list.length || list.length > maxList || list.some((x) => !["string", "number"].includes(typeof x) || String(x).length > 200)) return null;
    out[k] = list;
  }
  return Object.keys(out).length <= 10 ? out : null;
};

/**
 * `GET streams` (qui est en direct parmi une liste de chaînes) : une forme stricte. Seuls `user_login` (1 à 100 pseudos Twitch, des textes) et `first` (1 à 100) passent ;
 * rien d'autre (pas de `after`, de `game_id`, de `user_id`…). C'est ce qui sert à un module comme le Raid Twitch ; la réponse est publique (aucun jeton n'y figure).
 */
export const STREAMS_MAX_LOGINS = 100;
const streamsQuery = (q) => {
  if (!q || Object.keys(q).some((k) => k !== "user_login" && k !== "first")) return false;
  const logins = q.user_login;
  if (!Array.isArray(logins) || !logins.length || logins.length > STREAMS_MAX_LOGINS || logins.some((x) => typeof x !== "string" || !helix.LOGIN.test(x))) return false;
  if (q.first === undefined) return true;
  return q.first.length === 1 && /^[0-9]{1,3}$/.test(String(q.first[0])) && Number(q.first[0]) >= 1 && Number(q.first[0]) <= 100;
};

/** `credentialsOf(ctx)` : les identifiants de l'instance (voir index.mjs). */
export function service(credentialsOf) {
  const mine = async (ctx, args) => {
    const creds = await credentialsOf(ctx);
    const wanted = text(args?.channel).toLowerCase();
    if (wanted && wanted !== creds.channel) return { other: true, creds };
    return { other: false, creds };
  };
  const scopesOf = async (ctx, creds, slot) => [...new Set([...(slot === "main" && ctx.setting("trackStats") === true ? connect.wantedScopes(ctx) : []), ...(await connect.extraScopes(ctx, slot))])];

  return {
    /**
     * Où en est la connexion ? { channel, ready, https, status: "none" | "ok" | "reconnect" | "more", login, userId, scopes, wanted, result?, adminPath }
     * `ready` : l'application Twitch (identifiant + secret) et la chaîne sont réglées. `result` : pourquoi la dernière tentative a échoué ({ code, login? }). Aucun jeton.
     */
    async account(ctx, args) {
      const slot = connect.slotOf(args?.slot);
      const { other, creds } = await mine(ctx, args);
      if (other) return { ok: false, error: "other_channel" };
      const wanted = await scopesOf(ctx, creds, slot);
      const doc = await connect.docOf(ctx, slot);
      const result = await connect.resultOf(ctx, slot);
      return {
        ok: true, channel: helix.LOGIN.test(creds.channel) ? creds.channel : null, ready: helix.valid(creds), https: connect.secureSite(ctx),
        status: connect.status(doc, creds, wanted), login: doc?.login ?? null, userId: doc?.userId ?? null, scopes: doc?.scopes ?? [], wanted,
        ...(result ? { result: { code: result.code, ...(result.login ? { login: result.login } : {}) } } : {}),
        adminPath: connect.adminPage(ctx),
      };
    },

    /** Un module annonce les autorisations Twitch dont il a besoin (liste fermée) : elles s'ajoutent à la prochaine connexion. `scopes: []` retire sa demande. */
    async wantScopes(ctx, args) {
      const { other } = await mine(ctx, args);
      if (other) return { ok: false, error: "other_channel" };
      return connect.want(ctx, { consumer: args?.consumer, slot: args?.slot, scopes: args?.scopes, returnTo: args?.returnTo });
    },

    /** L'adresse du bouton « Autoriser » de Twitch pour cet emplacement : { url } ou { url: null, reason: "connected" | "not_ready" | "https" | "nothing" }. */
    async connectLink(ctx, args) {
      const slot = connect.slotOf(args?.slot);
      const { other, creds } = await mine(ctx, args);
      if (other) return { ok: false, error: "other_channel" };
      const wanted = await scopesOf(ctx, creds, slot);
      const doc = await connect.docOf(ctx, slot);
      if (connect.status(doc, creds, wanted) === "ok") return { ok: true, url: null, reason: "connected" };
      if (!connect.secureSite(ctx)) return { ok: true, url: null, reason: "https" };
      if (!helix.valid(creds)) return { ok: true, url: null, reason: "not_ready" };
      if (!wanted.length) return { ok: true, url: null, reason: "nothing" };
      return { ok: true, url: await connect.authorizeLink(ctx, creds, wanted, slot, await connect.returnPath(ctx, slot)) };
    },

    /** Retire la connexion du compte « bot » (jamais celle de la chaîne, qui se gère sur la page de Chaîne Twitch). */
    async disconnect(ctx, args) {
      const { other } = await mine(ctx, args);
      if (other) return { ok: false, error: "other_channel" };
      if (connect.slotOf(args?.slot) !== "bot") return { ok: false, error: "forbidden" };
      const r = await connect.disconnect(ctx, "bot");
      return { ok: true, reached: r.ok === true };
    },

    /**
     * Un appel à Twitch : { as: "app" | "user", slot?, method, path, query?, body?, channel? }.
     * Rend { ok: true, status, json } (Twitch a répondu, même 4xx) ou { ok: false, error: "forbidden" | "invalid" | "config" | "auth" | "rate" | "network" | "scope" | "other_channel" }.
     */
    async request(ctx, args) {
      const a = args && typeof args === "object" ? args : {};
      const { other, creds } = await mine(ctx, a);
      if (other) return { ok: false, error: "other_channel" };
      const method = text(a.method).toUpperCase(), path = text(a.path), as = a.as === "user" ? "user" : a.as === "app" ? "app" : null;
      if (!as) return { ok: false, error: "invalid" };
      const route = `${method} ${path}`;
      const need = as === "app" ? (ALLOWED.app.has(route) ? [] : null) : ALLOWED.user.get(route) ?? null;
      if (need === null) return { ok: false, error: "forbidden" };
      const query = plainQuery(a.query, route === "GET streams" ? STREAMS_MAX_LOGINS : 20);
      if (query === null || (route === "GET streams" && !streamsQuery(query))) return { ok: false, error: "invalid" };
      let body;
      if (a.body !== undefined) {
        if (!a.body || typeof a.body !== "object" || Array.isArray(a.body) || JSON.stringify(a.body).length > MAX_BODY) return { ok: false, error: "invalid" };
        body = a.body;
      }
      const req = { method, path, query, ...(body === undefined ? {} : { body }), scopes: need };
      // Borne dure sur l'ensemble de l'appel (jeton compris) : un Twitch muet ne retient jamais l'appelant plus de `timing.sharedMs`.
      const call = as === "app" ? helix.appCall(creds, req) : helix.userCall(connect.liveConn(ctx, creds, connect.slotOf(a.slot)), req);
      const r = await helix.within(call, helix.timing.sharedMs).catch(() => ({ error: "network" }));
      return r.error ? { ok: false, error: r.error } : { ok: true, status: r.status, json: r.json };
    },
  };
}

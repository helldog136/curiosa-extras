// Faux Twitch pour les tests : répond comme id.twitch.tv et api.twitch.tv (jeton d'application, autorisation, échange du code, renouvellement, validation, révocation, followers, abonnés).
// Aucun réseau : on remplace `globalThis.fetch` par `twitch.fetch`. Tout ce que le module envoie est gardé dans `twitch.log` (méthode, adresse, corps, en-têtes).
// Les en-têtes sont lus sans tenir compte de la casse (le client réseau du cœur, ctx.api.net, les écrit en minuscules) ; un corps texte de formulaire est lu comme un formulaire.
// Pannes (Connecteur Twitch) : `retryAfter` (secondes) accompagne le 429 de `rateLimited` ; `silence` (vrai, ou fonction (url) => vrai) : Twitch ne répond jamais ;
// `truncated` (fonction (url) => vrai) : réponse 200 au JSON coupé au milieu.
const hdr = (init, name) => { const h = init?.headers ?? {}; if (typeof h.get === "function") return h.get(name) ?? undefined; const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase()); return k === undefined ? undefined : h[k]; };
const bodyOf = (init) => {
  const b = init?.body;
  if (b instanceof URLSearchParams) return Object.fromEntries(b);
  if (typeof b === "string" && /x-www-form-urlencoded/.test(String(hdr(init, "content-type") ?? ""))) return Object.fromEntries(new URLSearchParams(b));
  return b ?? null;
};
export function fakeTwitch(opts = {}) {
  const s = {
    clientId: "cid", clientSecret: "SEC-RET", redirects: new Set(["https://example.test/m/tw/oauth/callback"]),
    login: "machaine", userId: "777", followers: 1234, subs: 56, affiliate: true, accessTtl: 3600,
    refreshFails: false, rateLimited: false, down: false, offlineRevoke: false, invalidateAccessOnNext: 0,
    ...opts,
  };
  let n = 0;
  const codes = new Map(), access = new Map(), refresh = new Map();
  const log = [], revoked = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const grant = (g) => {
    const a = `at_${++n}`, r = `rt_${n}`;
    access.set(a, { ...g, valid: true }); refresh.set(r, { ...g, valid: true });
    return json({ access_token: a, refresh_token: r, expires_in: s.accessTtl, scope: g.scopes, token_type: "bearer" });
  };
  const api = {
    log, revoked, state: s, access, refresh, subs: [], chat: [],
    /** L'utilisateur clique « Autoriser » sur la page de Twitch : renvoie l'adresse de retour (avec code et state). Refuse comme Twitch une adresse non enregistrée. */
    approve(authorizeUrl, who = {}) {
      const u = new URL(authorizeUrl);
      if (u.origin + u.pathname !== "https://id.twitch.tv/oauth2/authorize") throw new Error("pas la page d'autorisation de Twitch");
      const p = u.searchParams;
      if (p.get("client_id") !== s.clientId) throw new Error("client_id inconnu");
      if (!s.redirects.has(p.get("redirect_uri"))) throw new Error("redirect_uri non enregistrée");
      const code = `code${++n}abcdefghij`;
      codes.set(code, { login: who.login ?? s.login, userId: who.userId ?? s.userId, scopes: (p.get("scope") ?? "").split(" ").filter(Boolean).filter((x) => !(who.dropScopes ?? []).includes(x)), redirect: p.get("redirect_uri") });
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code); back.searchParams.set("scope", p.get("scope")); back.searchParams.set("state", p.get("state"));
      return back.href;
    },
    expireAccess(token) { const a = access.get(token); if (a) a.valid = false; },
    async fetch(url, init = {}) {
      const u = new URL(String(url));
      const body = bodyOf(init);
      log.push({ method: init.method ?? "GET", url: String(url), path: u.pathname, search: u.search, body, headers: init.headers ?? {} });
      if (s.down) throw new Error("réseau coupé");
      if (s.silence === true || (typeof s.silence === "function" && s.silence(String(url)))) return new Promise((resolve, reject) => { init.signal?.addEventListener?.("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); });
      if (typeof s.truncated === "function" && s.truncated(String(url))) return new Response('{"data":[{"id":"1","login":', { status: 200, headers: { "content-type": "application/json" } });
      if (s.rateLimited && u.hostname === "api.twitch.tv") return new Response("{}", { status: 429, headers: { "content-type": "application/json", ...(s.retryAfter ? { "retry-after": String(s.retryAfter) } : {}) } });
      if (u.hostname === "id.twitch.tv" && u.pathname === "/oauth2/token") {
        if (body.grant_type === "client_credentials") return body.client_secret === s.clientSecret ? json({ access_token: "app_tok", expires_in: 3600 }) : json({ status: 403, message: "invalid client secret" }, 403);
        if (body.client_id !== s.clientId || body.client_secret !== s.clientSecret) return json({ status: 403, message: "invalid client secret" }, 403);
        if (body.grant_type === "authorization_code") {
          const c = codes.get(body.code);
          if (!c || c.redirect !== body.redirect_uri) return json({ status: 400, message: "Invalid authorization code" }, 400);
          codes.delete(body.code);   // un code ne sert qu'une fois
          return grant(c);
        }
        if (body.grant_type === "refresh_token") {
          const r = refresh.get(body.refresh_token);
          if (s.refreshFails || !r || !r.valid) return json({ status: 400, message: "Invalid refresh token" }, 400);
          r.valid = false;   // renouvellement avec rotation : l'ancien ne sert plus
          return grant(r);
        }
        return json({}, 400);
      }
      if (u.hostname === "id.twitch.tv" && u.pathname === "/oauth2/validate") {
        const a = access.get(String(hdr(init, "Authorization") ?? "").replace(/^OAuth /, ""));
        return a?.valid ? json({ client_id: s.clientId, login: a.login, user_id: a.userId, scopes: a.scopes, expires_in: 3000 }) : json({ status: 401, message: "invalid access token" }, 401);
      }
      if (u.hostname === "id.twitch.tv" && u.pathname === "/oauth2/revoke") {
        if (s.offlineRevoke) throw new Error("réseau coupé");
        revoked.push(body.token);
        for (const m of [access, refresh]) if (m.has(body.token)) m.get(body.token).valid = false;
        return new Response(null, { status: 200 });
      }
      if (u.hostname === "api.twitch.tv" && String(hdr(init, "Authorization") ?? "") === "Bearer app_tok") {
        // Jeton d'application : abonnements EventSub (webhook) — voir twitch-api.test.mjs / twitch-bot.test.mjs
        if (hdr(init, "Client-Id") !== s.clientId) return json({ status: 401, message: "Invalid OAuth token" }, 401);
        if (u.pathname === "/helix/eventsub/subscriptions") {
          if (init.method === "GET") { const type = u.searchParams.get("type"); return json({ data: api.subs.filter((x) => !type || x.type === type).map(({ secret, ...pub }) => pub), total: api.subs.length, pagination: {} }); }
          if (init.method === "DELETE") { const i = api.subs.findIndex((x) => x.id === u.searchParams.get("id")); if (i < 0) return json({ status: 404 }, 404); api.subs.splice(i, 1); return new Response(null, { status: 204 }); }
          if (init.method === "POST") {
            const b = JSON.parse(init.body);
            if (s.eventsubDenied) return json({ status: 403, message: "subscription missing proper authorization" }, 403);
            if (api.subs.some((x) => x.type === b.type && x.transport.callback === b.transport.callback && JSON.stringify(x.condition) === JSON.stringify(b.condition) && x.status === "enabled")) return json({ status: 409, message: "subscription already exists" }, 409);
            const sub = { id: `sub${++n}`, status: "webhook_callback_verification_pending", type: b.type, version: b.version, condition: b.condition, transport: { method: b.transport.method, callback: b.transport.callback }, secret: b.transport.secret };
            api.subs.push(sub);
            return json({ data: [{ ...sub, secret: undefined }], total: 1, total_cost: 1, max_total_cost: 10000 }, 202);
          }
        }
        if (u.pathname === "/helix/users") {
          // Avec `login` (répété) : les chaînes connues de `s.users` = [{ login, name, picture }] (nom affiché, photo de profil). Sans : la chaîne elle-même.
          const wanted = u.searchParams.getAll("login").map((x) => x.toLowerCase());
          // la chaîne elle-même (`s.login`) est toujours connue, avec son numéro `s.userId`
          if (wanted.length) return json({ data: [...(s.users ?? []).filter((x) => wanted.includes(x.login)).map((x, i) => ({ id: `${700 + i}`, login: x.login, display_name: x.name ?? x.login, type: "", broadcaster_type: "", description: "", profile_image_url: x.picture ?? "", offline_image_url: "", view_count: 0, created_at: "2020-01-01T00:00:00Z" })), ...(wanted.includes(s.login) && !(s.users ?? []).some((x) => x.login === s.login) ? [{ id: s.userId, login: s.login, display_name: s.login }] : [])] });
          return json({ data: [{ id: s.userId, login: s.login }] });
        }
        if (u.pathname === "/helix/streams" && (init.method ?? "GET") === "GET") {
          // Qui est en direct parmi `user_login` (répété) : `s.streams` = [{ login, name, game, title, viewers, startedAt, type? }]. `first` vaut 20 par défaut, comme chez Twitch. `s.streamsMax` : limite de pseudos par demande (400 au-delà) ; `api.streamCalls` / `api.streamSizes` comptent les demandes.
          const wanted = u.searchParams.getAll("user_login").map((x) => x.toLowerCase()), first = Number(u.searchParams.get("first") ?? 20);
          // `s.streamsMax` : refuse comme Twitch (erreur 400) une demande qui compte plus de pseudos que la limite ; `s.streamsFail(wanted)` vrai : une panne (503) pour cette demande-là
          api.streamCalls = (api.streamCalls ?? 0) + 1; (api.streamSizes ??= []).push(wanted.length);
          if (s.streamsMax && wanted.length > s.streamsMax) return json({ error: "Bad Request", status: 400, message: `The number of user_login query parameters exceeds the maximum of ${s.streamsMax}` }, 400);
          if (s.streamsFail?.(wanted)) return json({ status: 503, message: "unavailable" }, 503);
          return json({ data: (s.streams ?? []).filter((x) => wanted.includes(x.login)).slice(0, first).map((x, i) => ({ id: `${9000 + i}`, user_id: `${500 + i}`, user_login: x.login, user_name: x.name ?? x.login, game_id: "1", game_name: x.game ?? "", type: x.type ?? "live", title: x.title ?? "", viewer_count: x.viewers ?? 0, started_at: x.startedAt ?? new Date().toISOString(), language: "fr", thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg", tags: [], is_mature: false })), pagination: {} });
        }
        if (u.pathname === "/helix/clips") {
          // `s.clips` = [{ title, url, thumbnail_url, created_at, view_count, game_id }] : les clips de la chaîne `s.userId`
          return json({ data: u.searchParams.get("broadcaster_id") === s.userId ? (s.clips ?? []).slice(0, Number(u.searchParams.get("first") ?? 20)) : [], pagination: {} });
        }
        return json({}, 404);
      }
      if (u.hostname === "api.twitch.tv") {
        const t = access.get(String(hdr(init, "Authorization") ?? "").replace(/^Bearer /, ""));
        if (!t?.valid || hdr(init, "Client-Id") !== s.clientId) return json({ status: 401, message: "Invalid OAuth token" }, 401);
        if (u.pathname === "/helix/chat/messages" && init.method === "POST") {
          if (!t.scopes.includes("user:write:chat")) return json({ status: 401, message: "Missing scope: user:write:chat" }, 401);
          const b = JSON.parse(init.body);
          if (b.sender_id !== t.userId) return json({ status: 400, message: "sender mismatch" }, 400);
          if (typeof b.message !== "string" || !b.message || [...b.message].length > 500) return json({ status: 400, message: "bad message" }, 400);
          if (s.chatDown) return json({ status: 503 }, 503);
          const id = `chatmsg${++n}`;
          api.chat.push({ id, broadcaster: b.broadcaster_id, sender: b.sender_id, message: b.message, as: t.login });
          return json({ data: [{ message_id: id, is_sent: !s.chatDropped, ...(s.chatDropped ? { drop_reason: { code: "msg_duplicate", message: "dup" } } : {}) }] });
        }
        if (u.pathname === "/helix/channels/followers") {
          if (!t.scopes.includes("moderator:read:followers")) return json({ status: 401, message: "Missing scope: moderator:read:followers" }, 401);
          return u.searchParams.get("broadcaster_id") === t.userId ? json({ total: s.followers, data: [], pagination: {} }) : json({}, 403);
        }
        if (u.pathname === "/helix/subscriptions") {
          if (!t.scopes.includes("channel:read:subscriptions")) return json({ status: 401, message: "Missing scope: channel:read:subscriptions" }, 401);
          return s.affiliate ? json({ total: s.subs, points: s.subs, data: [] }) : json({ status: 403, message: "The broadcaster must be an affiliate or partner" }, 403);
        }
      }
      return json({}, 404);
    },
  };
  return api;
}
export { hdr };

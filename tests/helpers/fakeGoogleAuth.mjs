// Faux Google pour les tests de la connexion au compte YouTube (Connecteur YouTube 1.3.0) : le flux « appareil » (oauth2.googleapis.com : code, jetons, rafraîchissement, révocation)
// et le chat en direct de YouTube (www.googleapis.com/youtube/v3/liveChat/messages : lecture ET écriture, avec contrôle du jeton et de la portée).
// Il se branche sur `globalThis.fetch` : TOUT passe par le vrai Connecteur et par le vrai client réseau du cœur. Les jetons sont des « appâts » reconnaissables (SECRET dans leur texte) :
// un test peut chercher ces appâts partout (réponses, journaux, panneaux…) et ne doit jamais les trouver.
//
//   const g = fakeGoogle();  globalThis.fetch = g.fetch;
//   g.decision = "approved";                  // pending (défaut) · approved · denied · slow · expired · policy
//   g.next.token = { status: 503, text: "" }  // une réponse forcée pour le PROCHAIN appel de cette porte : device · token · revoke · chatList · chatInsert (ou une fonction)
//   g.calls.all / g.calls.device / g.calls.token / g.calls.revoke / g.calls.chatList / g.calls.chatInsert : [{ url, method, headers, form, json }]
import path from "node:path";
import { pathToFileURL } from "node:url";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch } = kit;

export const CLIENT_ID = "123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com";
export const CLIENT_SECRET = "GOCSPX-fake-client-secret-0001";
export const API_KEY = "FAKE-YT-KEY-0001";
export const CHAT = "Cg0KC2xpdmVjaGF0MQ";
export const SCOPE_READ = "https://www.googleapis.com/auth/youtube.readonly";
export const SCOPE_MANAGE = "https://www.googleapis.com/auth/youtube";
/** Tout ce qui ressemble à un jeton ou à un code d'appareil du faux Google contient SECRET. */
export const SECRET_RE = /SECRET/;
const err = (status, error, extra = {}) => ({ status, json: { error, error_description: "fake", ...extra } });
const reason = (status, why, message = why) => ({ status, json: { error: { code: status, message, errors: [{ domain: "youtube.liveChat", reason: why }] } } });

export function fakeGoogle(opts = {}) {
  const g = {
    decision: "pending",         // ce que répond la porte « token » à la demande d'appareil
    grant: null,                 // portées accordées (défaut : celles demandées) ; ex. [SCOPE_READ] pour simuler « case décochée »
    verificationUrl: opts.verificationUrl ?? "https://www.google.com/device",
    expiresIn: 3600, interval: 5,
    revokedAtGoogle: false,      // l'accès a été retiré depuis le compte Google
    keyWorksForChat: opts.keyWorksForChat ?? true,   // la clé suffit-elle à lire un chat public ? (l'hypothèse à vérifier : réglable)
    messages: [], posted: [], seq: 0,
    next: {}, calls: { all: [], device: [], token: [], revoke: [], chatList: [], chatInsert: [] },
    device: null, access: null, refresh: null, scopes: [],
  };
  const take = async (name, url, init) => {
    const n = g.next[name];
    if (!n) return undefined;
    delete g.next[name];
    return typeof n === "function" ? n(url, init) : n;
  };
  const bearer = (h) => /^Bearer (.+)$/.exec(h.authorization ?? "")?.[1] ?? null;
  const handler = async (url, init) => {
    const u = new URL(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const raw = typeof init?.body === "string" ? init.body : "";
    const form = headers["content-type"]?.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : {};
    let json; try { json = headers["content-type"]?.includes("json") ? JSON.parse(raw) : undefined; } catch { json = undefined; }
    const rec = { url, method, headers, form, json };
    g.calls.all.push(rec);

    if (u.host === "oauth2.googleapis.com") {
      if (u.pathname === "/device/code") {
        g.calls.device.push(rec);
        const forced = await take("device", url, init); if (forced) return forced;
        if (form.client_id !== CLIENT_ID) return err(401, "invalid_client");
        if (![SCOPE_READ, SCOPE_MANAGE].includes(form.scope)) return err(400, "invalid_scope");   // le flux appareil n'accepte que ces deux portées YouTube
        g.device = { code: `4/DEVSECRET-${++g.seq}-CCCCCCCCCCCC`, scope: form.scope };
        return { json: { device_code: g.device.code, user_code: "ABCD-EFGH", verification_url: g.verificationUrl, expires_in: g.expiresIn, interval: g.interval } };
      }
      if (u.pathname === "/token") {
        g.calls.token.push(rec);
        const forced = await take("token", url, init); if (forced) return forced;
        if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET) return err(401, "invalid_client");
        if (form.grant_type === "refresh_token") {
          if (g.revokedAtGoogle || form.refresh_token !== g.refresh) return err(400, "invalid_grant", { error_description: `Token has been expired or revoked (${form.refresh_token})` });
          g.access = `ya29.ATSECRET-${++g.seq}-BBBBBBBBBBBB`;
          return { json: { access_token: g.access, expires_in: g.expiresIn, scope: g.scopes.join(" "), token_type: "Bearer" } };
        }
        if (form.grant_type !== "urn:ietf:params:oauth:grant-type:device_code" || !g.device || form.device_code !== g.device.code) return err(400, "invalid_grant");
        switch (g.decision) {
          case "pending": return err(428, "authorization_pending");
          case "slow": return err(403, "slow_down");
          case "denied": return err(403, "access_denied");
          case "expired": return err(400, "expired_token");
          case "policy": return err(400, "admin_policy_enforced");
          default: {
            g.scopes = g.grant ?? [g.device.scope];
            g.access = `ya29.ATSECRET-${++g.seq}-BBBBBBBBBBBB`; g.refresh = `1//RTSECRET-${++g.seq}-AAAAAAAAAAAAAAAA`; g.revokedAtGoogle = false;
            return { json: { access_token: g.access, refresh_token: g.refresh, expires_in: g.expiresIn, scope: g.scopes.join(" "), token_type: "Bearer" } };
          }
        }
      }
      if (u.pathname === "/revoke") {
        g.calls.revoke.push(rec);
        const forced = await take("revoke", url, init); if (forced) return forced;
        if (form.token && (form.token === g.refresh || form.token === g.access)) { g.revokedAtGoogle = true; return { status: 200, text: "" }; }
        return err(400, "invalid_token");
      }
      return { status: 404, json: {} };
    }

    if (u.host === "www.googleapis.com" && u.pathname === "/youtube/v3/liveChat/messages") {
      const token = bearer(headers);
      const authorized = token && token === g.access && !g.revokedAtGoogle;
      if (method === "POST") {
        g.calls.chatInsert.push(rec);
        const forced = await take("chatInsert", url, init); if (forced) return forced;
        if (token && !authorized) return reason(401, "authError", "Invalid Credentials");
        if (!authorized || !g.scopes.some((s) => s === SCOPE_MANAGE)) return reason(403, "insufficientPermissions", "Insufficient Permission");
        const text = json?.snippet?.textMessageDetails?.messageText;
        g.posted.push({ liveChatId: json?.snippet?.liveChatId, text });
        return { json: { kind: "youtube#liveChatMessage", id: `posted-${g.posted.length}`, snippet: { type: "textMessageEvent" } } };
      }
      g.calls.chatList.push(rec);
      const forced = await take("chatList", url, init); if (forced) return forced;
      if (token && !authorized) return reason(401, "authError", "Invalid Credentials");
      if (!token && !(headers["x-goog-api-key"] === API_KEY && g.keyWorksForChat)) return reason(403, "forbidden", "The request is not properly authorized to retrieve live chat messages");
      return { json: { kind: "youtube#liveChatMessageListResponse", pollingIntervalMillis: 5000, nextPageToken: "t0", items: g.messages } };
    }
    return { status: 404, json: {} };
  };
  g.fetch = fakeFetch({ "*": handler });
  /** Le faux Google devant un autre faux (par exemple le faux direct YouTube des tests d'Actions du live) : les adresses d'OAuth et d'écriture sont à moi, le reste passe à l'autre. */
  g.in_front_of = (other) => {
    const f = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      const u = new URL(url);
      const mine = u.host === "oauth2.googleapis.com" || (u.host === "www.googleapis.com" && u.pathname === "/youtube/v3/liveChat/messages" && (String(init?.method ?? "GET").toUpperCase() === "POST" || /^Bearer /.test(Object.entries(init?.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? "")));
      if (mine) return g.fetch(input, init);
      g.calls.all.push({ url, method: String(init?.method ?? "GET").toUpperCase(), headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), form: {}, passedOn: true });
      return other(input, init);
    };
    f.calls = g.fetch.calls;
    return f;
  };
  return g;
}

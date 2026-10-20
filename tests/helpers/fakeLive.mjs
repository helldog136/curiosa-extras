// Faux Helix « en direct » pour les tests de l'enregistreur de directs : une horloge simulée (Date.now) et des réponses scriptées dans le temps.
// Le jeton d'application (client_credentials) et tout ce qui est « utilisateur » (followers, connexion) sont délégués à fakeTwitch ; ici seulement /users, /streams, /videos, /clips, /games.
import { fakeTwitch, hdr } from "./fakeTwitch.mjs";

export const T0 = Date.parse("2026-10-15T18:00:00Z");
export const MIN = 60_000;

export function fakeLive(opts = {}) {
  const tw = fakeTwitch(opts.twitch);
  const realNow = Date.now;
  const s = {
    clock: T0,
    channels: { machaine: "777", autre: "888", ...(opts.channels ?? {}) },
    streams: {},            // id de chaîne → objet « stream » de Helix, ou absent (hors ligne)
    fail: {},               // chemin (« streams », « videos »…) → code HTTP à renvoyer, ou "throw"
    failOnce: {},           // idem, une seule fois
    videos: [], clips: [], games: { 33214: "Fortnite", 509658: "Just Chatting", 1: "Zelda" },
  };
  const log = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  const api = {
    tw, state: s, log,
    /** Branche l'horloge et le faux réseau ; à défaire avec restore(). */
    install() { Date.now = () => s.clock; globalThis.fetch = (u, i) => api.fetch(u, i); },
    restore(fetch) { Date.now = realNow; globalThis.fetch = fetch; },
    at: (min) => { s.clock = T0 + min * MIN; },
    /** Un direct : champs de Helix. */
    live(channelId, over = {}) {
      s.streams[channelId] = { id: "S1", user_id: channelId, type: "live", title: "Soirée", game_id: "1", game_name: "Zelda", viewer_count: 10, started_at: new Date(T0).toISOString(), language: "fr", ...over };
    },
    offline(channelId = "777") { delete s.streams[channelId]; },
    calls(path) { return log.filter((c) => c.path === `/helix/${path}`); },
    /** Enregistre un jeton d'utilisateur valable et sa connexion dans le stockage du CONNECTEUR Twitch (`connectorCtx` : voir helpers/twitchConnector.mjs). */
    async connect(connectorCtx, scopes = ["moderator:read:followers"], { channel = "machaine", userId = "777" } = {}) {
      tw.access.set("at_user", { login: channel, userId, scopes, valid: true });
      await connectorCtx.api.store.add("twitchConnections", { slot: "main", channel, access: "at_user", refresh: "rt_user", expiresAt: T0 + 1e12, scopes, userId, login: channel, connectedAt: new Date(T0).toISOString(), clientId: "cid", status: "ok" });
    },
    async fetch(url, init = {}) {
      const u = new URL(String(url));
      const bearer = String(hdr(init, "Authorization") ?? "").replace(/^Bearer /, "");
      if (u.hostname === "api.twitch.tv" && bearer === "app_tok") {
        const name = u.pathname.replace("/helix/", "");
        log.push({ path: u.pathname, search: u.search, name, at: s.clock });
        if (s.failOnce[name]) { const f = s.failOnce[name]; delete s.failOnce[name]; if (f === "throw") throw new Error("réseau coupé"); return json({}, f); }
        if (s.fail[name]) { if (s.fail[name] === "throw") throw new Error("réseau coupé"); return json({}, s.fail[name]); }
        if (name === "users") { const id = s.channels[u.searchParams.get("login")]; return json({ data: id ? [{ id, login: u.searchParams.get("login") }] : [] }); }
        if (name === "streams") { const st = s.streams[u.searchParams.get("user_id")]; return json({ data: st ? [st] : [] }); }
        if (name === "videos" || name === "clips") {
          const list = name === "videos" ? s.videos : s.clips;
          const size = Math.min(100, Number(u.searchParams.get("first") ?? 20));
          const from = Number(u.searchParams.get("after") ?? 0);
          const page = list.slice(from, from + size);
          return json({ data: page, pagination: from + size < list.length && name === "videos" ? { cursor: String(from + size) } : {} });
        }
        if (name === "games") return json({ data: u.searchParams.getAll("id").filter((i) => s.games[i]).map((i) => ({ id: i, name: s.games[i] })) });
        return json({}, 404);
      }
      return tw.fetch(url, init);
    },
  };
  return api;
}

export const video = (i, over = {}) => ({ id: `v${i}`, title: `Vidéo ${i}`, type: "archive", url: `https://www.twitch.tv/videos/${i}`, view_count: (i * 37) % 1000, duration: "2h3m4s", published_at: new Date(T0 - i * 86_400_000).toISOString(), ...over });
export const clip = (i, over = {}) => ({ id: `c${i}`, title: `Clip ${i}`, url: `https://clips.twitch.tv/c${i}`, view_count: (i * 13) % 500, game_id: i % 2 ? "1" : "509658", created_at: new Date(T0 - i * 3_600_000).toISOString(), duration: 30.2, ...over });

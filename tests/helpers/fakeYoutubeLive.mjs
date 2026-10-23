// Faux YouTube, côté DIRECT et CHAT, pour les tests des Actions du live YouTube : les réponses réelles de l'interface de données (playlistItems, videos avec liveStreamingDetails,
// liveChat/messages avec pageToken, pollingIntervalMillis et les évènements superChatEvent, superStickerEvent, newSponsorEvent, membershipGiftingEvent), des pannes (403 quota,
// 403 chat terminé, 401, 5xx, trou noir), et le compte des appels. Il se branche sur `globalThis.fetch` : TOUT passe par le vrai Connecteur YouTube et le vrai client réseau du cœur.
//
//   const yt = fakeYoutubeLive();   globalThis.fetch = yt.fetch;
//   yt.goLive({ title: "Mon direct" });  yt.say(yt.superChat({ who: "Léa", micros: 5_000_000, currency: "EUR", comment: "Bravo" }));
//   yt.calls.chat   les appels de lecture du chat : [{ pageToken, maxResults, key }] ; yt.calls.all : toutes les adresses appelées
import path from "node:path";
import { pathToFileURL } from "node:url";

const kit = await import(pathToFileURL(path.join(process.env.CURIOSA_DIR ?? process.cwd(), "testsupport/index.mjs")).href);
const { fakeFetch } = kit;

export const CHANNEL = "UC" + "a".repeat(22);
export const UPLOADS = "UU" + "a".repeat(22);
const reasonBody = (status, reason, message = reason) => ({ status, json: { error: { code: status, message, errors: [{ domain: "youtube.liveChat", reason }] } } });

export function fakeYoutubeLive(opts = {}) {
  const yt = {
    live: null, past: [{ id: "OLDvideo001", title: "Ancienne vidéo" }], messages: [], pollingMs: opts.pollingMs ?? 5000, offline: false,
    calls: { all: [], chat: [], detect: 0, keys: new Set() },
    next: null,        // une réponse forcée pour le prochain appel de chat (ou une fonction)
    detectFail: null,  // idem pour la recherche du direct
    seq: 0,
  };
  yt.goLive = ({ videoId = "LIVEvideo01", title = "Mon direct", chatId = "Cg0KC2xpdmVjaGF0MQ", startedAt = new Date().toISOString(), noChat = false } = {}) => {
    yt.live = { videoId, title, chatId: noChat ? undefined : chatId, startedAt };
    yt.messages = [];
    yt.offline = false;
    return yt.live;
  };
  yt.endLive = () => { if (yt.live) yt.past.unshift({ id: yt.live.videoId, title: yt.live.title }); yt.live = null; };
  yt.say = (...msgs) => { for (const m of msgs) yt.messages.push(m); };

  const author = ({ who = "Léa", owner = false, mod = false, member = false } = {}) => ({ channelId: `UCauthor${who.replace(/\W/g, "").slice(0, 12)}`, displayName: who, isChatOwner: owner, isChatModerator: mod, isChatSponsor: member, isVerified: false, profileImageUrl: "https://yt3.example.test/a.jpg", channelUrl: "https://www.youtube.com/channel/x" });
  const base = (type, o, extra) => ({
    kind: "youtube#liveChatMessage", etag: "e", id: o.id ?? `msg-${++yt.seq}-${Math.random().toString(36).slice(2, 8)}`,
    snippet: { type, liveChatId: yt.live?.chatId ?? "x", authorChannelId: "UCx", publishedAt: new Date(o.at ?? Date.now()).toISOString(), hasDisplayContent: true, displayMessage: o.display ?? "", ...extra },
    authorDetails: author(o),
  });
  yt.text = (o = {}) => base("textMessageEvent", { ...o, display: o.text ?? "bonjour" }, { textMessageDetails: { messageText: o.text ?? "bonjour" } });
  yt.superChat = (o = {}) => base("superChatEvent", o, { superChatDetails: { amountMicros: String(o.micros ?? 5_000_000), currency: o.currency ?? "EUR", amountDisplayString: "5,00 €", tier: 2, ...(o.comment === undefined ? {} : { userComment: o.comment }) } });
  yt.superSticker = (o = {}) => base("superStickerEvent", o, { superStickerDetails: { amountMicros: String(o.micros ?? 2_000_000), currency: o.currency ?? "EUR", amountDisplayString: "2,00 €", tier: 1, superStickerMetadata: { stickerId: "s1", altText: "heart", language: "fr" } } });
  yt.member = (o = {}) => base("newSponsorEvent", { ...o, member: true }, { newSponsorDetails: { memberLevelName: "Fan", isUpgrade: false } });
  yt.gift = (o = {}) => base("membershipGiftingEvent", o, { membershipGiftingDetails: { giftMembershipsCount: o.count ?? 5, giftMembershipsLevelName: "Fan" } });
  yt.received = (o = {}) => base("giftMembershipReceivedEvent", o, { giftMembershipReceivedDetails: { memberLevelName: "Fan", gifterChannelId: "UCg" } });

  const handler = async (url) => {
    yt.calls.all.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/liveChat/messages")) {
      const token = u.searchParams.get("pageToken");
      yt.calls.chat.push({ pageToken: token, maxResults: Number(u.searchParams.get("maxResults")), key: url.includes("key=") });
      if (typeof yt.next === "function") { const r = await yt.next(url); if (r !== undefined) return r; }
      else if (yt.next) { const r = yt.next; yt.next = null; return r; }
      if (!yt.live || u.searchParams.get("liveChatId") !== yt.live.chatId) return reasonBody(404, "liveChatNotFound", "Live chat not found");
      const from = token ? Number(/^t(\d+)$/.exec(token)?.[1] ?? NaN) : Math.max(0, yt.messages.length - 500);
      if (!Number.isFinite(from)) return { status: 400, json: { error: { code: 400, message: "bad token", errors: [{ reason: "invalidPageToken" }] } } };
      const items = yt.messages.slice(from, from + 500);
      return { json: { kind: "youtube#liveChatMessageListResponse", etag: "e", pollingIntervalMillis: yt.pollingMs, pageInfo: { totalResults: items.length, resultsPerPage: 500 }, nextPageToken: `t${from + items.length}`, ...(yt.offline ? { offlineAt: new Date().toISOString() } : {}), items } };
    }
    if (u.pathname.endsWith("/playlistItems")) {
      yt.calls.detect++;
      if (yt.detectFail) return typeof yt.detectFail === "function" ? yt.detectFail(url) : yt.detectFail;
      if (u.searchParams.get("playlistId") !== UPLOADS) return { status: 404, json: { error: { code: 404, message: "playlist", errors: [{ reason: "playlistNotFound" }] } } };
      const list = [...(yt.live ? [{ id: yt.live.videoId }] : []), ...yt.past].slice(0, Number(u.searchParams.get("maxResults") ?? 5));
      return { json: { kind: "youtube#playlistItemListResponse", items: list.map((v) => ({ snippet: { title: v.title ?? "", resourceId: { kind: "youtube#video", videoId: v.id } } })) } };
    }
    if (u.pathname.endsWith("/videos")) {
      yt.calls.detect++;
      if (yt.detectFail) return typeof yt.detectFail === "function" ? yt.detectFail(url) : yt.detectFail;
      const ids = (u.searchParams.get("id") ?? "").split(",");
      const items = ids.map((id) => {
        if (yt.live && id === yt.live.videoId) return { kind: "youtube#video", id, snippet: { title: yt.live.title, liveBroadcastContent: "live" }, liveStreamingDetails: { actualStartTime: yt.live.startedAt, ...(yt.live.chatId ? { activeLiveChatId: yt.live.chatId } : {}) } };
        const p = yt.past.find((x) => x.id === id);
        return p ? { kind: "youtube#video", id, snippet: { title: p.title ?? "", liveBroadcastContent: "none" }, liveStreamingDetails: { actualStartTime: "2026-01-01T10:00:00Z", actualEndTime: "2026-01-01T11:00:00Z" } } : null;
      }).filter(Boolean);
      return { json: { kind: "youtube#videoListResponse", items } };
    }
    return { status: 404, json: { error: { code: 404, message: "unknown", errors: [{ reason: "notFound" }] } } };
  };
  yt.fetch = fakeFetch({ "*": handler });
  yt.reasonBody = reasonBody;
  yt.fail = {
    chatEnded: () => reasonBody(403, "liveChatEnded", "The live chat is no longer live."),
    chatDisabled: () => reasonBody(403, "liveChatDisabled", "Live chat is disabled."),
    denied: () => reasonBody(403, "forbidden", "The request is not properly authorized."),
    quota: () => reasonBody(403, "quotaExceeded", "The request cannot be completed because you have exceeded your quota."),
    server: (status = 503) => ({ status, json: { error: { code: status, message: "backend", errors: [{ reason: "backendError" }] } } }),
    keyInvalid: () => ({ status: 400, json: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }], details: [{ reason: "API_KEY_INVALID" }] } } }),
    silence: () => new Promise(() => {}),
  };
  return yt;
}

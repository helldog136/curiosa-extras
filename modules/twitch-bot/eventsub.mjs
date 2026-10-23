// TOUT ce qui est propre à Twitch dans le Bot Twitch tient dans ce fichier : si la documentation de Twitch diffère de ce qui est écrit ici, c'est ici (et dans ses tests) qu'on corrige.
// Fichier pur : aucune connaissance de Curiosa (ni ctx, ni stockage), aucune requête réseau. Il décrit ce qu'on envoie à Twitch, ce que Twitch envoie, et comment le lire.
//
// HYPOTHÈSES NON VÉRIFIÉES (la documentation de Twitch n'était pas joignable au moment de l'écriture) :
//   - `channel.chat.message` (version 1) accepte le transport « webhook » ;
//   - autorisations : `user:read:chat` pour lire, `user:write:chat` pour répondre (POST /chat/messages), `user:bot` et `channel:bot` quand l'abonnement est créé avec le jeton d'application ;
//   - signature : HMAC-SHA256 de « id + horodatage + corps brut », en-tête `Twitch-Eventsub-Message-Signature: sha256=<hex>` ;
//   - messages : `webhook_callback_verification` (répondre le « challenge » en texte brut), `notification`, `revocation` ; un message de plus de 10 minutes est à refuser ;
//   - RÉCOMPENSES (points de chaîne), ajoutées ensuite — TOUT CE QUI SUIT EST NON VÉRIFIÉ AUPRÈS DE LA DOCUMENTATION (dev.twitch.tv injoignable) :
//       · création / lecture / modification / suppression : POST, GET, PATCH, DELETE `channel_points/custom_rewards` (`broadcaster_id`, `id`) avec le jeton de LA CHAÎNE et l'autorisation `channel:manage:redemptions` (on suppose qu'elle couvre aussi la lecture) ;
//         `only_manageable_rewards=true` ne rend que les récompenses créées par notre application, qui sont les seules qu'elle puisse modifier ou supprimer ;
//       · champs d'une récompense : title (45 car. au plus, unique dans la chaîne), cost (≥ 1), prompt (200 car.), is_enabled, is_paused, is_user_input_required, is_global_cooldown_enabled, global_cooldown_seconds,
//         should_redemptions_skip_request_queue (faux : l'échange reste « UNFULFILLED » et peut être validé ou remboursé) ; 50 récompenses par chaîne au plus (nous nous limitons à 20) ;
//       · valider ou rembourser : PATCH `channel_points/custom_rewards/redemptions?id=&broadcaster_id=&reward_id=` avec { status: "FULFILLED" | "CANCELED" } ; CANCELED rend les points ; seul un échange « UNFULFILLED » d'une récompense de notre application est modifiable ;
//       · comptes sans points de chaîne : 403 dont le message parle d'« affiliate » ou de « partner » ;
//       · abonnement `channel.channel_points_custom_reward_redemption.add` (version 1), condition { broadcaster_user_id }, même transport webhook et même signature que le chat ; évènement : id, user_login, user_name, user_input, status, reward { id, title, cost, prompt }, redeemed_at.
//   - un message du chat fait au plus 500 caractères ; environ 20 messages par 30 secondes pour un compte ordinaire (donc nous restons bien en dessous).
import { createHmac, timingSafeEqual } from "node:crypto";

export const TYPE = "channel.chat.message";
export const SUB_VERSION = "1";
export const MAX_MESSAGE = 500;
/** Au-delà, Twitch n'est plus cru : un message trop ancien est un rejeu. */
export const MAX_AGE_MS = 10 * 60_000;
/** Cadence d'envoi permise par Twitch pour un compte ordinaire (messages par fenêtre) : on reste très en dessous (voir le réglage « débit »). */
export const SEND_LIMIT = { messages: 20, windowMs: 30_000 };

/** Autorisations à demander. `read` : lire le chat ; `write` : y écrire ; `bot` : se présenter comme bot (obligatoire avec le jeton d'application). */
export const SCOPES = {
  /** La chaîne lit ET répond avec son propre compte. */
  own: ["user:read:chat", "user:write:chat", "user:bot", "channel:bot"],
  /** Avec un compte bot séparé : la chaîne autorise le bot sur sa chaîne … */
  ownerForBot: ["channel:bot"],
  /** … et le compte bot lit et écrit. */
  bot: ["user:read:chat", "user:write:chat", "user:bot"],
};

export const H = {
  id: "twitch-eventsub-message-id", type: "twitch-eventsub-message-type", signature: "twitch-eventsub-message-signature", timestamp: "twitch-eventsub-message-timestamp",
};

const hex = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");
/** La signature attendue (« sha256=… ») pour ces trois éléments. */
export const sign = (secret, id, timestamp, rawBody) => `sha256=${hex(secret, `${id}${timestamp}${rawBody}`)}`;

const header = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? "";

/**
 * Vérifie une requête de Twitch. Rend { ok: true, id, type, timestamp } ou { ok: false, reason: "secret" | "headers" | "signature" | "stale" }.
 * La comparaison de signature est à temps constant ; l'horodatage doit être à moins de `maxAgeMs` du moment présent (dans les deux sens).
 */
export function verify({ secret, headers, rawBody, now = Date.now(), maxAgeMs = MAX_AGE_MS }) {
  if (!secret || typeof secret !== "string") return { ok: false, reason: "secret" };
  const id = header(headers, H.id), type = header(headers, H.type), timestamp = header(headers, H.timestamp), got = header(headers, H.signature);
  if (!id || !type || !timestamp || !got || id.length > 200 || got.length > 200) return { ok: false, reason: "headers" };
  const expected = Buffer.from(sign(secret, id, timestamp, rawBody)), actual = Buffer.from(got);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "signature" };
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at) || Math.abs(now - at) > maxAgeMs) return { ok: false, reason: "stale" };
  return { ok: true, id, type, timestamp };
}

/** Lit le corps d'une requête signée : { kind: "challenge", challenge } | { kind: "chat", chat } | { kind: "revocation", status, type } | { kind: "ignored" } | { kind: "invalid" }. */
export function parseBody(messageType, rawBody) {
  let json;
  try { json = JSON.parse(rawBody); } catch { return { kind: "invalid" }; }
  if (!json || typeof json !== "object") return { kind: "invalid" };
  if (messageType === "webhook_callback_verification") return typeof json.challenge === "string" && json.challenge.length <= 500 ? { kind: "challenge", challenge: json.challenge } : { kind: "invalid" };
  if (messageType === "revocation") return { kind: "revocation", status: String(json.subscription?.status ?? "").slice(0, 80), type: String(json.subscription?.type ?? "").slice(0, 80) };
  if (messageType === "notification") {
    if (json.subscription?.type === TYPE_REDEEM) { const redemption = parseRedemption(json.event); return redemption ? { kind: "redemption", redemption } : { kind: "invalid" }; }
    if (json.subscription?.type !== TYPE) return { kind: "ignored" };
    const chat = parseChat(json.event);
    return chat ? { kind: "chat", chat } : { kind: "invalid" };
  }
  return { kind: "ignored" };
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
/** Un message du chat, réduit à ce dont on a besoin ; null si ce n'en est pas un. */
export function parseChat(event) {
  if (!event || typeof event !== "object") return null;
  const text = event.message?.text;
  const chat = {
    messageId: str(event.message_id, 100), broadcasterId: str(event.broadcaster_user_id, 40), chatterId: str(event.chatter_user_id, 40),
    login: str(event.chatter_user_login, 40).toLowerCase(), name: str(event.chatter_user_name, 60),
    text: typeof text === "string" ? text.slice(0, 600) : "", kind: str(event.message_type, 40) || "text",
    // Chat partagé avec une autre chaîne : le message vient d'ailleurs, on ne lui répond pas.
    foreign: !!event.source_broadcaster_user_id && String(event.source_broadcaster_user_id) !== String(event.broadcaster_user_id),
    badges: Array.isArray(event.badges) ? event.badges.map((b) => str(b?.set_id, 40)).filter(Boolean).slice(0, 30) : [],
  };
  return chat.messageId && chat.broadcasterId && chat.chatterId && chat.login ? chat : null;
}

/** Le rôle le plus haut d'un message : 3 la chaîne, 2 modérateur, 1 abonné, 0 tout le monde. */
export function levelOf(chat) {
  const has = (n) => chat.badges.includes(n);
  if (has("broadcaster")) return 3;
  if (has("moderator")) return 2;
  if (has("subscriber") || has("founder")) return 1;
  return 0;
}

/* ───────────── Abonnement (création, lecture, suppression) ───────────── */

export const webhookPath = (instanceKey) => `/m/${instanceKey}/webhook`;

/** Corps de la création : `userId` est le compte qui « lit » le chat (celui qui répond). */
export const subscriptionBody = ({ broadcasterId, userId, callback, secret }) => ({
  type: TYPE, version: SUB_VERSION, condition: { broadcaster_user_id: String(broadcasterId), user_id: String(userId) }, transport: { method: "webhook", callback, secret },
});
export const listRequest = () => ({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: TYPE } });
export const createRequest = (args) => ({ as: "app", method: "POST", path: "eventsub/subscriptions", body: subscriptionBody(args) });
export const deleteRequest = (id) => ({ as: "app", method: "DELETE", path: "eventsub/subscriptions", query: { id } });

/**
 * Parmi les abonnements de Twitch, lesquels sont les nôtres (même adresse de rappel, même chaîne, même compte) et dans quel état ?
 * Rend { state: "enabled" | "pending" | "failed" | "missing", id?, status?, stale: [ids à supprimer] }.
 * « stale » : nos abonnements en panne (Twitch les coupe après des échecs répétés) ou en double.
 */
export function classify(json, { callback, broadcasterId, userId }) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  // Tout ce qui pointe vers NOTRE adresse est à nous. Ce qui concerne un autre compte ou une autre chaîne (réglage changé depuis) est périmé : à supprimer, sinon chaque message arriverait deux fois.
  const mine = rows.filter((s) => s?.type === TYPE && s.transport?.method === "webhook" && s.transport?.callback === callback);
  const same = (s) => String(s.condition?.broadcaster_user_id) === String(broadcasterId) && String(s.condition?.user_id) === String(userId);
  const ours = mine.filter(same), foreign = mine.filter((s) => !same(s)).map((s) => String(s.id));
  const good = ours.find((s) => s.status === "enabled");
  const pending = ours.find((s) => s.status === "webhook_callback_verification_pending");
  const keep = good ?? pending;
  const stale = [...ours.filter((s) => s !== keep).map((s) => String(s.id)), ...foreign];
  if (good) return { state: "enabled", id: String(good.id), status: good.status, stale };
  if (pending) return { state: "pending", id: String(pending.id), status: pending.status, stale };
  if (ours.length) return { state: "failed", status: String(ours[0].status ?? ""), stale };
  return { state: "missing", stale };
}

/** Pourquoi Twitch a coupé un abonnement, en un code que l'interface sait expliquer (« revoked » : l'autorisation a été retirée ; « failures » : notre site ne répondait pas). */
export function failureCode(status) {
  const s = String(status ?? "");
  if (/authorization_revoked|user_removed|moderator_removed|chat_user_banned/.test(s)) return "revoked";
  if (/notification_failures_exceeded|webhook_callback_verification_failed/.test(s)) return "unreachable";
  return "other";
}

/** Lit la réponse à la création : { ok: true, id } | { ok: false, code: "exists" | "denied" | "refused" | "twitch" }. */
export function readCreate(res) {
  if (res.status === 202 || res.status === 200) { const id = res.json?.data?.[0]?.id; return typeof id === "string" ? { ok: true, id } : { ok: false, code: "twitch" }; }
  if (res.status === 409) return { ok: false, code: "exists" };
  if (res.status === 401 || res.status === 403) return { ok: false, code: "denied" };
  if (res.status >= 400 && res.status < 500) return { ok: false, code: "refused", detail: str(res.json?.message, 200) };
  return { ok: false, code: "twitch" };
}

/* ───────────── Réponse dans le chat ───────────── */

export const sendRequest = ({ broadcasterId, senderId, text, slot }) => ({ as: "user", slot, method: "POST", path: "chat/messages", body: { broadcaster_id: String(broadcasterId), sender_id: String(senderId), message: text } });

/** Lit la réponse à l'envoi : { sent: true, messageId } | { sent: false, code: "denied" | "dropped" | "refused" | "twitch", detail? }. */
export function readSend(res) {
  if (res.status === 200) {
    const row = res.json?.data?.[0];
    if (row?.is_sent === true) return { sent: true, messageId: str(row.message_id, 100) };
    return { sent: false, code: "dropped", detail: str(row?.drop_reason?.code, 80) };
  }
  if (res.status === 401 || res.status === 403) return { sent: false, code: "denied" };
  if (res.status >= 400 && res.status < 500) return { sent: false, code: "refused", detail: str(res.json?.message, 200) };
  return { sent: false, code: "twitch" };
}

/* ───────────── Récompenses en points de chaîne (voir les hypothèses en tête de fichier) ───────────── */

export const TYPE_REDEEM = "channel.channel_points_custom_reward_redemption.add";
/** Autorisation à demander à la chaîne (jeton du compte de la chaîne, jamais celui d'un compte bot). */
export const REWARD_SCOPES = ["channel:manage:redemptions"];
export const LIMITS = { title: 45, prompt: 200, maxRewards: 20, maxCooldown: 86_400, maxCost: 1_000_000_000 };
const RID = /^[A-Za-z0-9-]{8,64}$/;
export const validTwitchId = (x) => typeof x === "string" && RID.test(x);

/** Un échange de points, réduit à ce dont on a besoin ; null si ce n'en est pas un. Le message du viewer (`input`) est borné et n'est jamais gardé par nous. */
export function parseRedemption(event) {
  if (!event || typeof event !== "object") return null;
  const r = {
    id: str(event.id, 64), broadcasterId: str(event.broadcaster_user_id, 40), login: str(event.user_login, 40).toLowerCase(), name: str(event.user_name, 60),
    input: str(event.user_input, 500), status: str(event.status, 30).toLowerCase(), rewardId: str(event.reward?.id, 64), rewardTitle: str(event.reward?.title, 80),
    at: Date.parse(str(event.redeemed_at, 40)),
  };
  return validTwitchId(r.id) && validTwitchId(r.rewardId) && r.broadcasterId && r.login ? r : null;
}

export const redeemListRequest = () => ({ as: "app", method: "GET", path: "eventsub/subscriptions", query: { type: TYPE_REDEEM } });
export const redeemCreateRequest = ({ broadcasterId, callback, secret }) => ({ as: "app", method: "POST", path: "eventsub/subscriptions", body: { type: TYPE_REDEEM, version: "1", condition: { broadcaster_user_id: String(broadcasterId) }, transport: { method: "webhook", callback, secret } } });
/** Même idée que `classify` pour l'abonnement aux échanges (condition : la chaîne seulement). */
export function classifyRedeem(json, { callback, broadcasterId }) {
  const rows = (Array.isArray(json?.data) ? json.data : []).filter((s) => s?.type === TYPE_REDEEM && s.transport?.method === "webhook" && s.transport?.callback === callback);
  const ours = rows.filter((s) => String(s.condition?.broadcaster_user_id) === String(broadcasterId)), foreign = rows.filter((s) => !ours.includes(s)).map((s) => String(s.id));
  const good = ours.find((s) => s.status === "enabled"), pending = ours.find((s) => s.status === "webhook_callback_verification_pending"), keep = good ?? pending;
  const stale = [...ours.filter((s) => s !== keep).map((s) => String(s.id)), ...foreign];
  if (good) return { state: "enabled", id: String(good.id), stale };
  if (pending) return { state: "pending", id: String(pending.id), stale };
  return { state: ours.length ? "failed" : "missing", stale };
}

const rewardQuery = (broadcasterId, extra = {}) => ({ broadcaster_id: String(broadcasterId), ...extra });
const base = "channel_points/custom_rewards";
/** Le corps d'une récompense pour Twitch. `r` : { title, cost, prompt, needsInput, cooldown (secondes) } ; `paused` s'ajoute à la modification. */
export function rewardBody(r, extra = {}) {
  return { title: r.title, cost: r.cost, prompt: r.prompt ?? "", is_enabled: true, is_user_input_required: r.needsInput === true, is_global_cooldown_enabled: r.cooldown > 0, global_cooldown_seconds: r.cooldown > 0 ? r.cooldown : 1, should_redemptions_skip_request_queue: false, ...extra };
}
export const rewardRequests = {
  list: (b) => ({ as: "user", slot: "main", method: "GET", path: base, query: rewardQuery(b, { only_manageable_rewards: "true" }) }),
  create: (b, r) => ({ as: "user", slot: "main", method: "POST", path: base, query: rewardQuery(b), body: rewardBody(r) }),
  update: (b, id, r) => ({ as: "user", slot: "main", method: "PATCH", path: base, query: rewardQuery(b, { id }), body: rewardBody(r) }),
  pause: (b, id, paused) => ({ as: "user", slot: "main", method: "PATCH", path: base, query: rewardQuery(b, { id }), body: { is_paused: paused === true } }),
  remove: (b, id) => ({ as: "user", slot: "main", method: "DELETE", path: base, query: rewardQuery(b, { id }) }),
  settle: (b, rewardId, redemptionId, status) => ({ as: "user", slot: "main", method: "PATCH", path: `${base}/redemptions`, query: { id: redemptionId, broadcaster_id: String(b), reward_id: rewardId }, body: { status: status === "FULFILLED" ? "FULFILLED" : "CANCELED" } }),
};

const reward = (x) => (x && validTwitchId(x.id) ? { id: x.id, title: str(x.title, 80), cost: Number.isFinite(x.cost) ? x.cost : 0, enabled: x.is_enabled !== false, paused: x.is_paused === true } : null);
/**
 * Lit la réponse de Twitch à une opération sur les récompenses : { ok: true, rewards: [..] } ou { ok: false, code, detail? } avec code :
 * "na" (compte sans points de chaîne : ni Affilié ni Partenaire) · "denied" (autorisation à redonner) · "duplicate" (titre déjà pris) · "limit" (trop de récompenses) · "gone" (n'existe plus ou n'est pas à nous) · "refused" · "twitch".
 */
export function readReward(res) {
  const msg = str(res.json?.message, 200), low = msg.toLowerCase();
  if (res.status === 200 || res.status === 204) return { ok: true, rewards: (Array.isArray(res.json?.data) ? res.json.data : []).map(reward).filter(Boolean) };
  if (res.status === 403 && /affiliate|partner/.test(low)) return { ok: false, code: "na" };
  if (res.status === 401 || res.status === 403) return { ok: false, code: "denied" };
  if (res.status === 404) return { ok: false, code: "gone" };
  if (res.status === 400 && /duplicate/.test(low)) return { ok: false, code: "duplicate" };
  if (res.status === 400 && /too_many|max/.test(low)) return { ok: false, code: "limit" };
  if (res.status === 429) return { ok: false, code: "rate" };
  if (res.status >= 400 && res.status < 500) return { ok: false, code: "refused", detail: msg };
  return { ok: false, code: "twitch" };
}

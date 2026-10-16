// TOUT ce qui est propre à Twitch dans le Bot Twitch tient dans ce fichier : si la documentation de Twitch diffère de ce qui est écrit ici, c'est ici (et dans ses tests) qu'on corrige.
// Fichier pur : aucune connaissance de Curiosa (ni ctx, ni stockage), aucune requête réseau. Il décrit ce qu'on envoie à Twitch, ce que Twitch envoie, et comment le lire.
//
// HYPOTHÈSES NON VÉRIFIÉES (la documentation de Twitch n'était pas joignable au moment de l'écriture) :
//   - `channel.chat.message` (version 1) accepte le transport « webhook » ;
//   - autorisations : `user:read:chat` pour lire, `user:write:chat` pour répondre (POST /chat/messages), `user:bot` et `channel:bot` quand l'abonnement est créé avec le jeton d'application ;
//   - signature : HMAC-SHA256 de « id + horodatage + corps brut », en-tête `Twitch-Eventsub-Message-Signature: sha256=<hex>` ;
//   - messages : `webhook_callback_verification` (répondre le « challenge » en texte brut), `notification`, `revocation` ; un message de plus de 10 minutes est à refuser ;
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

// Un message du chat YouTube (forme de `liveChatMessages.list`) → un évènement simple, ou rien.
//
//   superChatEvent        un Super Chat : montant en micros d'une devise + message facultatif
//   superStickerEvent     un Super Sticker : montant, pas de texte
//   newSponsorEvent       une nouvelle adhésion (membre)
//   membershipGiftingEvent  des adhésions offertes (le CADEAU, pas chaque reçu : giftMembershipReceivedEvent est ignoré, sinon on compterait deux fois)
//   textMessageEvent      un message : seulement « !stop » et « !start » comptent
//
// QUI A ÉCRIT : on se fie aux INDICATEURS que YouTube donne sur l'auteur (isChatOwner, isChatModerator), jamais à son pseudo : un faux « Modérateur » n'a aucun pouvoir.
const v = new URL(import.meta.url).search; // la version du module se propage aux fichiers voisins (sinon l'ancien code resterait en cache après une mise à jour)
const { cleanName, MAX_MICROS } = await import(`./rules.mjs${v}`);

const num = (v) => { const s = String(v ?? ""); return /^\d{1,16}$/.test(s) ? Number(s) : null; };
const text = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Rend { id, at, kind, who, isOwner, isMod, ... } ou null. `now` sert quand la date du message manque (le message compte alors comme tout frais). */
export function parseItem(item, now = Date.now()) {
  if (!item || typeof item !== "object") return null;
  const sn = item.snippet && typeof item.snippet === "object" ? item.snippet : null;
  const id = typeof item.id === "string" && item.id.length >= 1 && item.id.length <= 300 ? item.id : null;
  if (!sn || !id) return null;
  const author = item.authorDetails && typeof item.authorDetails === "object" ? item.authorDetails : {};
  const at = Date.parse(sn.publishedAt ?? "");
  const base = { id, at: Number.isFinite(at) ? at : now, who: cleanName(author.displayName) || "?", isOwner: author.isChatOwner === true, isMod: author.isChatModerator === true };
  switch (sn.type) {
    case "superChatEvent": case "superStickerEvent": {
      const d = (sn.type === "superChatEvent" ? sn.superChatDetails : sn.superStickerDetails) ?? {};
      const micros = num(d.amountMicros);
      const currency = String(d.currency ?? "").toUpperCase();
      if (micros === null || micros > MAX_MICROS || !/^[A-Z]{3}$/.test(currency)) return { ...base, kind: "invalid" };
      return sn.type === "superChatEvent" ? { ...base, kind: "superchat", micros, currency, text: text(d.userComment, 300) } : { ...base, kind: "supersticker", micros, currency, text: "" };
    }
    case "newSponsorEvent": return { ...base, kind: "member", text: "" };
    case "membershipGiftingEvent": {
      const n = num(sn.membershipGiftingDetails?.giftMembershipsCount);
      return n !== null && n >= 1 && n <= 10_000 ? { ...base, kind: "gift", count: n, text: "" } : { ...base, kind: "invalid" };
    }
    case "textMessageEvent": {
      const m = text(sn.textMessageDetails?.messageText ?? sn.displayMessage, 40).toLowerCase();
      return m === "!stop" || m === "!start" ? { ...base, kind: "command", command: m.slice(1), text: "" } : null;
    }
    default: return null;
  }
}

/** Ce message a-t-il le droit de donner cet ordre ? `!stop` : la propriétaire, et les modérateurs YouTube si le réglage le permet ; `!start` : la propriétaire seulement. */
export const mayCommand = (ev, { modsStop }) => (ev.command === "stop" ? ev.isOwner || (modsStop && ev.isMod) : ev.command === "start" ? ev.isOwner : false);
